//! Phase 3D-1: HTTP + WebSocket API exposing PTY sessions to external clients.
//!
//! # Routes
//!
//! ```text
//! POST   /sessions             { shell, cols, rows, cwd? } -> { id }
//! GET    /sessions             -> [TerminalInfo]
//! DELETE /sessions/:id         -> 204
//! POST   /sessions/:id/resize  { cols, rows } -> 204
//! GET    /sessions/:id/stream  -> WebSocket upgrade
//!   server -> client: binary frames of PTY output
//!   client -> server: binary or text frames written into the PTY
//! ```
//!
//! All routes require a `Authorization: Bearer <token>` header. The token is
//! read from the `AETHER_API_TOKEN` env var at startup; if unset, a random
//! token is generated and logged once so the running user can copy it.
//!
//! Sessions created via this API land in the same `PtyManager` as Tauri-spawned
//! sessions, so they show up in `list_terminals` etc. Reads are fanned out
//! through `PtyManager::subscribe_output` (v2c) so the UI and the API can
//! concurrently consume the same byte stream without racing on the physical
//! master. Input/resize from multiple clients still races — the PTY has a
//! single write side by design; higher-level arbitration is out of scope.

use std::collections::HashMap;
use std::net::{IpAddr, SocketAddr};
use std::path::{Component, Path as FsPath, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use axum::{
    extract::{
        ws::{Message, WebSocket},
        ConnectInfo, Path, Request, State, WebSocketUpgrade,
    },
    http::{
        header::{self, AUTHORIZATION, CONTENT_TYPE},
        HeaderValue, Method, StatusCode,
    },
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{delete, get, post},
    Json, Router,
};
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use subtle::ConstantTimeEq;
use thiserror::Error;
use tokio::sync::{broadcast, Mutex as AsyncMutex, Notify};
use tower_http::cors::{AllowOrigin, CorsLayer};

use crate::pty::{PtyError, PtyManager, ShellType, TerminalInfo};

pub const DEFAULT_PORT: u16 = 9333;
pub const PROCESS_KIND_EMBEDDED: &str = "embedded-api";
pub const PROCESS_KIND_SIDE_CAR: &str = "pty-sidecar";

/// Per-frame write deadline for the WS send half.
///
/// A well-behaved consumer drains bytes as fast as the PTY produces them,
/// so `sender.send(...)` is effectively non-blocking. A misbehaving
/// consumer that authenticates and then stops reading TCP would otherwise
/// pin the reader task indefinitely while keeping the broadcast ring
/// close to full. Timing out the write disconnects that client and lets
/// the ring drain for the rest.
const WS_WRITE_TIMEOUT: Duration = Duration::from_secs(30);
pub const WS_MAX_INPUT_FRAME_BYTES: usize = 1024 * 1024;

/// Server-controlled sentinel template for broadcast `Lagged` events.
///
/// Encoded as a dim-rendered ANSI sequence so a client that renders the
/// WS binary stream straight into a terminal sees a visible gap marker.
/// The only variable substitution is the numeric `n` (a `u64` chunk
/// count) produced by `tokio::sync::broadcast::RecvError::Lagged(n)`:
/// the server controls the surrounding bytes in full, so nothing
/// attacker-influenced can reach the sentinel — but downstream tools
/// that replay raw WS binary into other terminals should be aware that
/// the API may emit bare ANSI.
fn lag_sentinel_bytes(n: u64) -> Vec<u8> {
    format!("\x1b[2m[dropped {} chunks]\x1b[0m", n).into_bytes()
}

/// Hard cap on concurrent PTY sessions attributable to the API. Guards
/// against a misbehaving authorized client looping `POST /sessions` until
/// the host runs out of file descriptors. Applies to the total `PtyManager`
/// session count (which includes UI-spawned sessions) since the underlying
/// resource pool is shared.
pub const MAX_PTY_SESSIONS: usize = 32;

/// Default allowed CORS origin — the Tauri dev server. In release builds the
/// webview loads from `tauri://localhost` which does not send `Origin` so is
/// unaffected by CORS; the list only matters for browser clients. Override
/// via `AETHER_API_CORS_ORIGIN` (comma-separated, e.g. `https://foo,https://bar`).
pub const DEFAULT_CORS_ORIGIN: &str = "http://127.0.0.1:1420";

/// REST rate-limit bucket: tolerant enough for local UI reload/reconnect storms
/// while still bounding a runaway authenticated client.
pub const REST_BURST: f64 = 240.0;
pub const REST_REFILL_PER_SEC: f64 = 20.0;

/// WebSocket connect bucket: enough burst for local UI reconnect storms and
/// negative auth probes, while still bounding a runaway local client.
pub const WS_BURST: f64 = 16.0;
pub const WS_REFILL_PER_SEC: f64 = 4.0;

// ─── State ──────────────────────────────────────────────────────────────────

/// Runtime state shared by all handlers.
///
/// Cloning is cheap: `PtyManager` wraps an `Arc<Mutex<...>>` internally, and
/// the shutdown `Notify` is wrapped in an `Arc`.
#[derive(Clone)]
pub struct ApiState {
    pub pty: PtyManager,
    pub auth: AuthConfig,
    pub shutdown: Arc<Notify>,
    /// Cap on total `PtyManager` sessions before `POST /sessions` returns
    /// 400. Defaulted from `MAX_PTY_SESSIONS`; overridable so integration
    /// tests can force the limit cheaply.
    pub max_sessions: usize,
    /// Per-IP rate limiter shared across handlers. Clone is cheap (just
    /// bumps an `Arc`), and the internal state is `Mutex`-guarded.
    pub rate_limiter: Arc<RateLimiter>,
    /// Allowed CORS origins. Applied as a `tower_http::cors::CorsLayer` in
    /// `router()`. Defaulted from `AETHER_API_CORS_ORIGIN`; browser clients
    /// from other origins get no `Access-Control-Allow-Origin` header and
    /// will fail the preflight.
    pub cors_origins: Vec<HeaderValue>,
    /// One-shot WebSocket upgrade tickets (v2b). Issued by
    /// `POST /sessions/:id/stream-ticket`, consumed by the WS upgrade's
    /// `?ticket=<uuid>` query parameter.
    pub tickets: Arc<TicketRegistry>,
    /// Lightweight process identity used by the Tauri host to reject an
    /// unrelated/stale process that happens to be bound to the sidecar port.
    pub process_kind: &'static str,
    pub instance_id: String,
    create_lock: Arc<AsyncMutex<()>>,
}

impl ApiState {
    pub fn new(pty: PtyManager, auth: AuthConfig) -> Self {
        Self {
            pty,
            auth,
            shutdown: Arc::new(Notify::new()),
            max_sessions: MAX_PTY_SESSIONS,
            rate_limiter: Arc::new(RateLimiter::new()),
            cors_origins: default_cors_origins(),
            tickets: Arc::new(TicketRegistry::new()),
            process_kind: PROCESS_KIND_EMBEDDED,
            instance_id: uuid::Uuid::new_v4().to_string(),
            create_lock: Arc::new(AsyncMutex::new(())),
        }
    }

    /// Override the session cap. Used by integration tests; production
    /// callers rely on the default.
    pub fn with_max_sessions(mut self, cap: usize) -> Self {
        self.max_sessions = cap;
        self
    }

    /// Swap the rate limiter. Used by integration tests that want either
    /// `RateLimiter::unlimited()` (most tests) or a tight-burst config
    /// (rate-limit tests).
    pub fn with_rate_limiter(mut self, rl: Arc<RateLimiter>) -> Self {
        self.rate_limiter = rl;
        self
    }

    /// Override the CORS origin list. Used by tests to assert preflight
    /// behaviour without mutating the process env.
    pub fn with_cors_origins(mut self, origins: Vec<HeaderValue>) -> Self {
        self.cors_origins = origins;
        self
    }

    /// Swap the ticket registry. Used by tests that want to pre-populate
    /// tickets or share a registry across multiple `ApiState` clones.
    pub fn with_tickets(mut self, tickets: Arc<TicketRegistry>) -> Self {
        self.tickets = tickets;
        self
    }

    pub fn with_process_kind(mut self, process_kind: &'static str) -> Self {
        self.process_kind = process_kind;
        self
    }

    /// Signal the running server to stop gracefully. Safe to call even if no
    /// server is running — the Notify is just dropped.
    pub fn trigger_shutdown(&self) {
        self.shutdown.notify_waiters();
    }
}

/// Read the comma-separated `AETHER_API_CORS_ORIGIN` env var. Individual
/// typos are logged at `warn` and skipped. If the entire list fails to
/// parse, we fall back to the dev-server default rather than leave the
/// server with a zero-origin allow-list (which silently breaks every
/// browser client). Returns the dev-server default when unset / empty.
fn default_cors_origins() -> Vec<HeaderValue> {
    match std::env::var("AETHER_API_CORS_ORIGIN") {
        Ok(s) if !s.trim().is_empty() => {
            let parsed: Vec<HeaderValue> = s
                .split(',')
                .filter_map(|raw| {
                    let trimmed = raw.trim();
                    match HeaderValue::from_str(trimmed) {
                        Ok(v) => Some(v),
                        Err(_) => {
                            log::warn!(
                                "api: AETHER_API_CORS_ORIGIN entry {:?} is not a valid \
                                 HeaderValue — dropping",
                                trimmed
                            );
                            None
                        }
                    }
                })
                .collect();
            if parsed.is_empty() {
                log::warn!(
                    "api: AETHER_API_CORS_ORIGIN parsed to zero valid origins — \
                     falling back to {}",
                    DEFAULT_CORS_ORIGIN
                );
                vec![HeaderValue::from_static(DEFAULT_CORS_ORIGIN)]
            } else {
                parsed
            }
        }
        _ => vec![HeaderValue::from_static(DEFAULT_CORS_ORIGIN)],
    }
}

// ─── Rate limiter ───────────────────────────────────────────────────────────

/// Hard cap on the number of distinct peer-IP entries tracked by the rate
/// limiter. An attacker walking a wide IP range (or a NAT that rotates
/// source addresses) cannot force unbounded memory growth: once we hit the
/// cap, insertion of a new IP evicts the oldest entry (FIFO). Chosen to
/// absorb realistic NAT / VPN churn without meaningful memory cost —
/// 4096 × ~56 B ≈ 230 KiB.
pub const MAX_RATE_LIMIT_IPS: usize = 4096;

/// Per-IP token-bucket rate limiter with two independent buckets — one for
/// REST requests, one for WebSocket upgrades. Buckets are keyed on the peer
/// IP from the TCP connection (see `ConnectInfo<SocketAddr>`). The peer IP
/// comes from the TCP layer — we deliberately do NOT read `X-Forwarded-For`
/// or `X-Real-IP`. If this server is ever put behind a reverse proxy, the
/// rate-limit key collapses to the proxy's IP and must be replaced by a
/// `rightmost-trusted-proxy` strategy with an explicit trusted CIDR list.
///
/// Scope choice: we key on IP rather than on token because the current API
/// is a single-token deployment — keying on token would be a global rate
/// limit. A future multi-tenant revision can swap the key type without
/// changing the handler side.
///
/// Eviction: bounded at `MAX_RATE_LIMIT_IPS` with FIFO eviction. Restart
/// wipes the state.
pub struct RateLimiter {
    inner: Mutex<RateLimiterInner>,
    rest_burst: f64,
    rest_refill_per_sec: f64,
    ws_burst: f64,
    ws_refill_per_sec: f64,
    max_ips: usize,
    /// When true, `check_*` short-circuits to `true` and never touches the
    /// bucket map. Used by tests that care about functional correctness,
    /// not throttling. Prefer this over "infinite burst" configs — it
    /// removes all floating-point magnitude fragility.
    bypass: bool,
}

struct RateLimiterInner {
    buckets: HashMap<IpAddr, Bucket>,
    /// FIFO insertion order for eviction. Invariant: exactly the same
    /// set of keys as `buckets`.
    order: std::collections::VecDeque<IpAddr>,
}

struct Bucket {
    rest_tokens: f64,
    ws_tokens: f64,
    last_refill: Instant,
}

impl RateLimiter {
    /// Production defaults: generous local REST burst/refill, 1 WS upgrade/sec
    /// (burst 3), cap `MAX_RATE_LIMIT_IPS` tracked IPs.
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(RateLimiterInner {
                buckets: HashMap::new(),
                order: std::collections::VecDeque::new(),
            }),
            rest_burst: REST_BURST,
            rest_refill_per_sec: REST_REFILL_PER_SEC,
            ws_burst: WS_BURST,
            ws_refill_per_sec: WS_REFILL_PER_SEC,
            max_ips: MAX_RATE_LIMIT_IPS,
            bypass: false,
        }
    }

    /// Test helper: never rate-limits. `check_*` returns `true` without
    /// touching the bucket map, so tests are immune to floating-point
    /// magnitude concerns.
    pub fn unlimited() -> Self {
        Self {
            inner: Mutex::new(RateLimiterInner {
                buckets: HashMap::new(),
                order: std::collections::VecDeque::new(),
            }),
            rest_burst: 0.0,
            rest_refill_per_sec: 0.0,
            ws_burst: 0.0,
            ws_refill_per_sec: 0.0,
            max_ips: MAX_RATE_LIMIT_IPS,
            bypass: true,
        }
    }

    /// Test helper: tight config for rate-limit assertions. Accepts `f64`
    /// directly to avoid lossy casts — callers pass literals like `2.0`.
    pub fn with_limits(
        rest_burst: f64,
        rest_refill_per_sec: f64,
        ws_burst: f64,
        ws_refill_per_sec: f64,
    ) -> Self {
        Self {
            inner: Mutex::new(RateLimiterInner {
                buckets: HashMap::new(),
                order: std::collections::VecDeque::new(),
            }),
            rest_burst,
            rest_refill_per_sec,
            ws_burst,
            ws_refill_per_sec,
            max_ips: MAX_RATE_LIMIT_IPS,
            bypass: false,
        }
    }

    pub fn check_rest(&self, ip: IpAddr) -> bool {
        if self.bypass {
            return true;
        }
        // Snapshot `Instant::now()` outside the critical section — HPET /
        // TSC queries can take 50–300 ns on Windows, no reason to hold a
        // contended Mutex across that.
        let now = Instant::now();
        let mut inner = self.inner.lock().unwrap();
        let inserted = self.touch(&mut inner, ip, now);
        let b = inner.buckets.get_mut(&ip).expect("touch populated bucket");
        if !inserted {
            self.refill(b, now);
        }
        if b.rest_tokens >= 1.0 {
            b.rest_tokens -= 1.0;
            true
        } else {
            false
        }
    }

    pub fn check_ws(&self, ip: IpAddr) -> bool {
        if self.bypass {
            return true;
        }
        let now = Instant::now();
        let mut inner = self.inner.lock().unwrap();
        let inserted = self.touch(&mut inner, ip, now);
        let b = inner.buckets.get_mut(&ip).expect("touch populated bucket");
        if !inserted {
            self.refill(b, now);
        }
        if b.ws_tokens >= 1.0 {
            b.ws_tokens -= 1.0;
            true
        } else {
            false
        }
    }

    /// Ensure a bucket exists for `ip`, evicting the oldest entry if we
    /// would exceed `max_ips`. Returns `true` when a fresh bucket was
    /// inserted (so caller skips `refill`, since the bucket is already at
    /// full burst).
    fn touch(&self, inner: &mut RateLimiterInner, ip: IpAddr, now: Instant) -> bool {
        if inner.buckets.contains_key(&ip) {
            return false;
        }
        if inner.order.len() >= self.max_ips {
            if let Some(oldest) = inner.order.pop_front() {
                inner.buckets.remove(&oldest);
            }
        }
        inner.buckets.insert(
            ip,
            Bucket {
                rest_tokens: self.rest_burst,
                ws_tokens: self.ws_burst,
                last_refill: now,
            },
        );
        inner.order.push_back(ip);
        true
    }

    fn refill(&self, b: &mut Bucket, now: Instant) {
        let dt = now.duration_since(b.last_refill).as_secs_f64();
        b.rest_tokens = (b.rest_tokens + dt * self.rest_refill_per_sec).min(self.rest_burst);
        b.ws_tokens = (b.ws_tokens + dt * self.ws_refill_per_sec).min(self.ws_burst);
        b.last_refill = now;
    }

    /// Number of distinct IPs currently held in the bucket map. Exposed for
    /// testing the FIFO eviction behaviour from both unit and integration
    /// tests; not part of the stable API.
    #[doc(hidden)]
    pub fn tracked_ip_count(&self) -> usize {
        self.inner.lock().unwrap().order.len()
    }
}

impl Default for RateLimiter {
    fn default() -> Self {
        Self::new()
    }
}

// ─── WebSocket upgrade tickets (v2b) ────────────────────────────────────────

/// Seconds a freshly issued stream ticket is accepted for. The WS upgrade
/// is expected immediately after the ticket is issued — 10s covers
/// realistic browser roundtrips without extending the window an attacker
/// could brute-force a leaked ticket in.
pub const TICKET_TTL_SECS: u64 = 10;

/// Hard cap on the number of live (unredeemed, unexpired) tickets. Prevents
/// a pathological client from accumulating tickets by issuing without
/// redeeming. Expired entries are pruned lazily on every operation.
pub const MAX_LIVE_TICKETS: usize = 1024;

/// Opaque ticket identifier. Newtype over `String` rather than a bare
/// `&str`/`String` so API signatures like `redeem_for_session(ticket,
/// session_id)` cannot silently swap the two arguments (they would still
/// compile but the wrong one would take the wrong slot). Cheap to clone.
#[derive(Clone, Debug, Eq, PartialEq, Hash)]
pub struct TicketId(String);

impl TicketId {
    pub fn as_str(&self) -> &str {
        &self.0
    }

    pub fn into_string(self) -> String {
        self.0
    }
}

impl From<String> for TicketId {
    fn from(s: String) -> Self {
        TicketId(s)
    }
}

impl std::fmt::Display for TicketId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        self.0.fmt(f)
    }
}

/// One-shot WebSocket upgrade tickets. Clients exchange their long-lived
/// bearer token for a short-lived ticket via `POST /sessions/:id/stream-ticket`,
/// then present the ticket on the WS upgrade URL as `?ticket=<uuid>`. This
/// lets browsers avoid putting the long-lived token in URL query strings
/// (which tend to leak into proxy logs and browser history).
///
/// Each ticket is bound to a specific session_id: redemption only succeeds
/// when the redeemed ticket's session_id matches the WS URL's path.
///
/// Eviction semantics (single-tenant assumption): when `max_live` is hit
/// we evict the oldest-by-expiry entry. This is safe for Aether's
/// single-token, single-user deployment — any authenticated caller is
/// already trusted. If this module ever grows multi-tenant auth, swap
/// this policy for per-tenant quotas before landing the multi-tenant
/// change. See `docs/phase3/3d-1-v2-plan.md` for the follow-up note.
pub struct TicketRegistry {
    tickets: Mutex<HashMap<TicketId, TicketEntry>>,
    max_live: usize,
    ttl: Duration,
}

struct TicketEntry {
    session_id: String,
    expires_at: Instant,
}

impl TicketRegistry {
    pub fn new() -> Self {
        Self {
            tickets: Mutex::new(HashMap::new()),
            max_live: MAX_LIVE_TICKETS,
            ttl: Duration::from_secs(TICKET_TTL_SECS),
        }
    }

    /// Issue a fresh ticket for `session_id`. Returns `(ticket, ttl)`; the
    /// HTTP handler converts `ttl` to `expires_in_ms` for the JSON
    /// response. `Duration` is the more idiomatic shape for the internal
    /// API — callers that want milliseconds can call `.as_millis()`.
    pub fn issue(&self, session_id: &str) -> (TicketId, Duration) {
        let now = Instant::now();
        let mut map = self.tickets.lock().unwrap();
        Self::prune_expired(&mut map, now);
        // If we're at cap, drop the oldest-by-expiry. In the single-tenant
        // model this is acceptable; see the `TicketRegistry` doc-comment
        // for the multi-tenant consideration.
        if map.len() >= self.max_live {
            if let Some(oldest_key) = map
                .iter()
                .min_by_key(|(_, e)| e.expires_at)
                .map(|(k, _)| k.clone())
            {
                map.remove(&oldest_key);
            }
        }
        let ticket = TicketId(uuid::Uuid::new_v4().to_string());
        let expires_at = now + self.ttl;
        map.insert(
            ticket.clone(),
            TicketEntry {
                session_id: session_id.to_string(),
                expires_at,
            },
        );
        (ticket, self.ttl)
    }

    /// Redeem a ticket for a specific session. Returns `true` on the first
    /// redemption of a valid ticket that was issued for `session_id` and
    /// has not yet expired; all other cases (unknown ticket, expired,
    /// already redeemed, session mismatch) return `false`. The `TicketId`
    /// newtype ensures the arguments cannot be silently swapped.
    pub fn redeem_for_session(&self, ticket: &TicketId, session_id: &str) -> bool {
        let now = Instant::now();
        let mut map = self.tickets.lock().unwrap();
        Self::prune_expired(&mut map, now);
        let Some(entry) = map.get(ticket) else {
            return false;
        };
        if entry.session_id != session_id {
            return false;
        }
        if entry.expires_at <= now {
            // Shouldn't happen after prune, but defensive.
            map.remove(ticket);
            return false;
        }
        // One-shot: remove on successful redeem.
        map.remove(ticket);
        true
    }

    fn prune_expired(map: &mut HashMap<TicketId, TicketEntry>, now: Instant) {
        map.retain(|_, e| e.expires_at > now);
    }

    /// Test-only accessor for the number of live tickets. Kept as
    /// `#[doc(hidden)] pub` rather than `#[cfg(test)]` because integration
    /// tests live in a separate crate and do NOT see items gated on
    /// `cfg(test)` of the library crate; `doc(hidden)` is the narrowest
    /// scope that still exposes the accessor to them.
    #[doc(hidden)]
    pub fn live_count(&self) -> usize {
        self.tickets.lock().unwrap().len()
    }
}

impl Default for TicketRegistry {
    fn default() -> Self {
        Self::new()
    }
}

// ─── Auth ───────────────────────────────────────────────────────────────────

#[derive(Clone)]
pub struct AuthConfig {
    /// `None` disables auth entirely. Only used in tests.
    token: Option<String>,
}

impl AuthConfig {
    /// Read `AETHER_API_TOKEN` from the environment. If the variable is unset
    /// or empty, generate a random UUID and log it once at WARN level so the
    /// operator can see it in the app's log output.
    pub fn from_env() -> Self {
        let token = match std::env::var("AETHER_API_TOKEN") {
            Ok(t) if !t.is_empty() => t,
            _ => {
                let generated = uuid::Uuid::new_v4().to_string();
                log::warn!(
                    "api: AETHER_API_TOKEN not set — generated ephemeral token: {}",
                    generated
                );
                generated
            }
        };
        Self { token: Some(token) }
    }

    /// Build with an explicit token. Used when the caller wants to force a
    /// specific value (e.g. config-file-driven).
    pub fn with_token(token: impl Into<String>) -> Self {
        Self {
            token: Some(token.into()),
        }
    }

    /// Disable auth. Intended for test harnesses only — production code paths
    /// always call `from_env()` which guarantees a token is set.
    pub fn disabled() -> Self {
        Self { token: None }
    }

    /// Check an `Authorization` header value against the configured token.
    /// Uses the `subtle` crate's audited constant-time comparison to avoid
    /// leaking token length / prefix via timing side channels. Length
    /// mismatches short-circuit to false — the length itself is not secret
    /// (it's either the configured token's length or a client guess).
    pub fn verify(&self, header: Option<&str>) -> bool {
        let Some(required) = self.token.as_deref() else {
            return true;
        };
        let Some(h) = header else { return false };
        let Some(provided) = h.strip_prefix("Bearer ") else {
            return false;
        };
        ct_eq(provided.as_bytes(), required.as_bytes())
    }

    /// Check a bare token string (e.g. from a query-string parameter).
    /// Constant-time; returns `true` when auth is disabled.
    pub fn verify_token(&self, provided: &str) -> bool {
        let Some(required) = self.token.as_deref() else {
            return true;
        };
        ct_eq(provided.as_bytes(), required.as_bytes())
    }
}

/// Constant-time byte equality via the `subtle` crate. Length mismatches
/// short-circuit to `false`; this is intentional (the length of either input
/// is not a secret in this module's threat model).
fn ct_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    bool::from(a.ct_eq(b))
}

async fn auth_middleware(
    State(state): State<ApiState>,
    req: Request,
    next: Next,
) -> Result<Response, ApiError> {
    let header = req
        .headers()
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok());
    let is_ws = req.uri().path().ends_with("/stream");

    // Bound local hammering before token verification too. This does allow
    // unauthenticated traffic to touch the bucket map, but the map is capped
    // at MAX_RATE_LIMIT_IPS, so memory stays bounded while brute-force/DoS
    // attempts are throttled.
    let ip = req
        .extensions()
        .get::<ConnectInfo<SocketAddr>>()
        .map(|ci| ci.0.ip())
        .unwrap_or(IpAddr::from([127, 0, 0, 1]));
    let allowed = if is_ws {
        state.rate_limiter.check_ws(ip)
    } else {
        state.rate_limiter.check_rest(ip)
    };
    if !allowed {
        return Err(ApiError::RateLimited);
    }

    let authorized = if state.auth.verify(header) {
        true
    } else if is_ws {
        // WebSocket query-string auth accepts only short-lived, single-use
        // tickets minted by `POST /sessions/:id/stream-ticket`. Long-lived
        // bearer tokens are deliberately rejected in URLs because query
        // strings leak into logs, browser history, and debugging tools.
        let path = req.uri().path().to_string();
        req.uri()
            .query()
            .map(|q| {
                for pair in q.split('&') {
                    if let Some(raw) = pair.strip_prefix("ticket=") {
                        let decoded = percent_decode(raw);
                        if let Some(session_id) = extract_stream_session_id(&path) {
                            let ticket = TicketId::from(decoded);
                            if state.tickets.redeem_for_session(&ticket, session_id) {
                                return true;
                            }
                        }
                    }
                }
                false
            })
            .unwrap_or(false)
    } else {
        false
    };

    if !authorized {
        return Err(ApiError::Unauthorized);
    }

    Ok(next.run(req).await)
}

/// Minimal `%xx` percent-decoder for the query-string token path. We don't
/// pull in a full URL crate because tokens are short and the only characters
/// that actually need decoding here are user-supplied (env-configured) tokens
/// with unusual characters. Malformed sequences are left as-is.
fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let (Some(h), Some(l)) = (
                (bytes[i + 1] as char).to_digit(16),
                (bytes[i + 2] as char).to_digit(16),
            ) {
                out.push(((h << 4) | l) as u8);
                i += 3;
                continue;
            }
        }
        // '+' is legacy form-encoded space; tolerate it.
        if bytes[i] == b'+' {
            out.push(b' ');
            i += 1;
            continue;
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

// ─── Error type ─────────────────────────────────────────────────────────────

#[derive(Debug, Error)]
pub enum ApiError {
    #[error("not found: {0}")]
    NotFound(String),

    #[error("bad request: {0}")]
    BadRequest(String),

    #[error("unauthorized")]
    Unauthorized,

    #[error("rate limit exceeded")]
    RateLimited,

    #[error("internal error: {0}")]
    Internal(String),
}

#[derive(Serialize)]
struct ErrorBody {
    error: String,
    code: &'static str,
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let (status, code) = match &self {
            ApiError::NotFound(_) => (StatusCode::NOT_FOUND, "not_found"),
            ApiError::BadRequest(_) => (StatusCode::BAD_REQUEST, "bad_request"),
            ApiError::Unauthorized => (StatusCode::UNAUTHORIZED, "unauthorized"),
            ApiError::RateLimited => (StatusCode::TOO_MANY_REQUESTS, "rate_limited"),
            ApiError::Internal(_) => (StatusCode::INTERNAL_SERVER_ERROR, "internal"),
        };
        (
            status,
            Json(ErrorBody {
                error: self.to_string(),
                code,
            }),
        )
            .into_response()
    }
}

type ApiResult<T> = Result<T, ApiError>;

/// Map a typed PtyError onto the right HTTP status without string-matching.
fn map_pty_err(id: &str, e: PtyError) -> ApiError {
    match e {
        PtyError::NotFound(_) => ApiError::NotFound(id.to_string()),
        other => ApiError::Internal(other.to_string()),
    }
}

// ─── Router / serve ─────────────────────────────────────────────────────────

/// Build the router. Exposed so integration tests can drive it with a custom
/// listener / state without going through the TCP bind path.
///
/// Layer order (outermost first): `CorsLayer` → auth+rate-limit middleware →
/// handlers. This means OPTIONS preflight requests are answered by the CORS
/// layer before the auth check, so browsers can discover allowed methods
/// without a token.
pub fn router(state: ApiState) -> Router {
    let cors = build_cors_layer(&state.cors_origins);
    Router::new()
        .route("/sessions", post(create_session).get(list_sessions))
        .route("/sessions/:id", delete(close_session))
        .route("/sessions/:id/resize", post(resize_session))
        .route("/sessions/:id/stream-ticket", post(issue_stream_ticket))
        .route("/sessions/:id/stream", get(ws_session))
        .route("/health", get(health))
        .route_layer(middleware::from_fn_with_state(
            state.clone(),
            auth_middleware,
        ))
        .with_state(state)
        .layer(cors)
}

/// CORS policy: allow the configured origins only, restrict methods to the
/// REST surface we actually expose, and allow the two headers clients send
/// (`Authorization` for the bearer token, `Content-Type` for JSON bodies).
/// Credentials are not enabled — the API is token-based, not cookie-based.
fn build_cors_layer(origins: &[HeaderValue]) -> CorsLayer {
    CorsLayer::new()
        .allow_origin(AllowOrigin::list(origins.iter().cloned()))
        .allow_methods([Method::GET, Method::POST, Method::DELETE])
        .allow_headers([AUTHORIZATION, CONTENT_TYPE])
}

/// Bind `127.0.0.1:port` and serve until the state's shutdown Notify fires.
pub async fn serve(state: ApiState, port: u16) -> std::io::Result<()> {
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    let listener = tokio::net::TcpListener::bind(addr).await?;
    log::info!("3D-1: PTY API listening on http://{}", addr);
    serve_on_listener(state, listener).await
}

/// Serve on a pre-bound listener. Used by tests that want an OS-assigned port.
/// Populates `ConnectInfo<SocketAddr>` so the rate limiter can key on peer IP.
pub async fn serve_on_listener(
    state: ApiState,
    listener: tokio::net::TcpListener,
) -> std::io::Result<()> {
    let shutdown = state.shutdown.clone();
    let app = router(state).into_make_service_with_connect_info::<SocketAddr>();
    axum::serve(listener, app)
        .with_graceful_shutdown(async move {
            shutdown.notified().await;
            log::info!("3D-1: PTY API shutting down");
        })
        .await
}

// ─── Request/response types ─────────────────────────────────────────────────

#[derive(Deserialize)]
struct CreateSessionBody {
    #[serde(default = "default_shell")]
    shell: String,
    #[serde(default = "default_cols")]
    cols: u16,
    #[serde(default = "default_rows")]
    rows: u16,
    #[serde(default)]
    cwd: Option<String>,
    #[serde(default)]
    id: Option<String>,
}

fn default_shell() -> String {
    "powershell".to_string()
}
fn default_cols() -> u16 {
    80
}
fn default_rows() -> u16 {
    24
}

#[derive(Serialize)]
struct CreateSessionResponse {
    id: String,
}

#[derive(Serialize)]
pub struct HealthResponse {
    process_kind: &'static str,
    instance_id: String,
    pid: u32,
    exe: String,
    version: &'static str,
}

#[derive(Deserialize)]
struct ResizeBody {
    cols: u16,
    rows: u16,
}

fn parse_shell(s: &str) -> Result<ShellType, ApiError> {
    match s.to_lowercase().as_str() {
        "pwsh" | "powershell" | "ps" => Ok(ShellType::PowerShell),
        "cmd" => Ok(ShellType::Cmd),
        "gitbash" | "bash" => Ok(ShellType::GitBash),
        "wsl" => Ok(ShellType::Wsl),
        other => Err(ApiError::BadRequest(format!("unknown shell: {}", other))),
    }
}

fn validate_api_cwd(path: &str) -> Result<(), ApiError> {
    if path.trim().is_empty() {
        return Ok(());
    }
    if path.contains('\0') {
        return Err(ApiError::BadRequest("cwd contains a NUL byte".into()));
    }
    let slash_path = path.replace('\\', "/");
    let lower_slash_path = slash_path.to_lowercase();
    if lower_slash_path.starts_with("//?/unc/")
        || ((slash_path.starts_with("//") || slash_path.starts_with("\\\\"))
            && !lower_slash_path.starts_with("//?/"))
    {
        return Err(ApiError::BadRequest("UNC cwd paths are not allowed".into()));
    }
    let raw_path = FsPath::new(path);
    if raw_path
        .components()
        .any(|component| matches!(component, Component::ParentDir))
    {
        return Err(ApiError::BadRequest(
            "cwd path traversal is not allowed".into(),
        ));
    }
    if is_dangerous_api_cwd(raw_path) {
        return Err(ApiError::BadRequest(
            "cwd cannot point at a system directory".into(),
        ));
    }
    let canonical = std::fs::canonicalize(raw_path)
        .map_err(|_| ApiError::BadRequest("cwd must exist and be accessible".into()))?;
    if !canonical.is_dir() {
        return Err(ApiError::BadRequest("cwd must be a directory".into()));
    }
    if is_dangerous_api_cwd(&canonical) {
        return Err(ApiError::BadRequest(
            "cwd cannot point at a system directory".into(),
        ));
    }
    Ok(())
}

fn home_dir_for_cwd() -> Option<PathBuf> {
    std::env::var_os("USERPROFILE")
        .filter(|value| !value.is_empty())
        .or_else(|| std::env::var_os("HOME").filter(|value| !value.is_empty()))
        .map(PathBuf::from)
}

fn expand_api_cwd(path: &str) -> Result<String, ApiError> {
    let trimmed = path.trim();
    if trimmed == "~" {
        return home_dir_for_cwd()
            .map(|home| home.to_string_lossy().to_string())
            .ok_or_else(|| ApiError::BadRequest("cwd home directory is unavailable".into()));
    }
    if let Some(rest) = trimmed
        .strip_prefix("~/")
        .or_else(|| trimmed.strip_prefix("~\\"))
    {
        let home = home_dir_for_cwd()
            .ok_or_else(|| ApiError::BadRequest("cwd home directory is unavailable".into()))?;
        return Ok(home.join(rest).to_string_lossy().to_string());
    }
    Ok(trimmed.to_string())
}

fn strip_local_verbatim_prefix(path: &str) -> String {
    if let Some(rest) = path.strip_prefix(r"\\?\") {
        if rest.to_lowercase().starts_with(r"unc\") {
            return path.to_string();
        }
        return rest.to_string();
    }
    if let Some(rest) = path.strip_prefix("//?/") {
        if rest.to_lowercase().starts_with("unc/") {
            return path.to_string();
        }
        return rest.to_string();
    }
    path.to_string()
}

fn api_cwd_policy_text(path: &FsPath) -> String {
    let mut normalized = path.to_string_lossy().replace('\\', "/").to_lowercase();
    if let Some(stripped) = normalized.strip_prefix("//?/") {
        normalized = stripped.to_string();
    }
    normalized
}

fn is_dangerous_api_cwd(path: &FsPath) -> bool {
    let normalized = api_cwd_policy_text(path);
    let dangerous = [
        "c:/windows",
        "c:/program files",
        "c:/program files (x86)",
        "d:/windows",
        "/etc",
        "/usr",
        "/bin",
        "/sbin",
    ];
    dangerous
        .iter()
        .any(|prefix| normalized == *prefix || normalized.starts_with(&format!("{prefix}/")))
}

fn normalize_api_cwd(cwd: Option<String>) -> Result<Option<String>, ApiError> {
    let Some(cwd) = cwd else {
        return Ok(None);
    };
    let trimmed = cwd.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }
    let expanded = expand_api_cwd(trimmed)?;
    validate_api_cwd(&expanded)?;
    Ok(Some(strip_local_verbatim_prefix(&expanded)))
}

// ─── Handlers ───────────────────────────────────────────────────────────────

async fn create_session(
    State(state): State<ApiState>,
    Json(body): Json<CreateSessionBody>,
) -> ApiResult<Json<CreateSessionResponse>> {
    let shell = parse_shell(&body.shell)?;
    if body.cols == 0 || body.rows == 0 {
        return Err(ApiError::BadRequest("cols and rows must be > 0".into()));
    }
    let _create_guard = state.create_lock.lock().await;
    if state.pty.list_info().len() >= state.max_sessions {
        return Err(ApiError::BadRequest(format!(
            "session limit reached ({})",
            state.max_sessions
        )));
    }
    let cwd = normalize_api_cwd(body.cwd)?;
    let id = if let Some(id) = body.id.as_deref() {
        validate_session_id(id)?;
        state
            .pty
            .spawn_with_id(id, &shell, body.cols, body.rows, cwd.as_deref())
            .map_err(ApiError::Internal)?;
        id.to_string()
    } else {
        state
            .pty
            .spawn(&shell, body.cols, body.rows, cwd.as_deref())
            .map_err(ApiError::Internal)?
    };
    if !state.pty.reap_child_on_exit(&id) {
        log::warn!("api: PTY {} was created without an exit reaper", id);
    }
    Ok(Json(CreateSessionResponse { id }))
}

fn validate_session_id(id: &str) -> Result<(), ApiError> {
    if uuid::Uuid::parse_str(id).is_ok() {
        Ok(())
    } else {
        Err(ApiError::BadRequest("session id must be a UUID".into()))
    }
}

async fn list_sessions(State(state): State<ApiState>) -> Json<Vec<TerminalInfo>> {
    Json(state.pty.list_info())
}

async fn health(State(state): State<ApiState>) -> Json<HealthResponse> {
    Json(HealthResponse {
        process_kind: state.process_kind,
        instance_id: state.instance_id,
        pid: std::process::id(),
        exe: std::env::current_exe()
            .map(|path| path.display().to_string())
            .unwrap_or_default(),
        version: env!("CARGO_PKG_VERSION"),
    })
}

async fn close_session(
    State(state): State<ApiState>,
    Path(id): Path<String>,
) -> ApiResult<StatusCode> {
    state.pty.close(&id).map_err(|e| map_pty_err(&id, e))?;
    Ok(StatusCode::NO_CONTENT)
}

async fn resize_session(
    State(state): State<ApiState>,
    Path(id): Path<String>,
    Json(body): Json<ResizeBody>,
) -> ApiResult<StatusCode> {
    if body.cols == 0 || body.rows == 0 {
        return Err(ApiError::BadRequest("cols and rows must be > 0".into()));
    }
    state
        .pty
        .resize(&id, body.cols, body.rows)
        .map_err(|e| map_pty_err(&id, e))?;
    Ok(StatusCode::NO_CONTENT)
}

/// v2b: mint a one-shot WebSocket upgrade ticket bound to `:id`. The client
/// then opens `ws://.../sessions/:id/stream?ticket=<uuid>` within
/// `TICKET_TTL_SECS`.
async fn issue_stream_ticket(
    State(state): State<ApiState>,
    Path(id): Path<String>,
) -> ApiResult<Json<StreamTicket>> {
    // Session must already exist — avoids minting tickets for nonexistent
    // ids, which would otherwise look like a successful ticket issuance
    // but fail loudly on WS upgrade. `contains` is O(1) on the HashMap;
    // `list` was O(n) with an allocation per id.
    if !state.pty.contains(&id) {
        return Err(ApiError::NotFound(id));
    }
    let (ticket, ttl) = state.tickets.issue(&id);
    Ok(Json(StreamTicket {
        ticket: ticket.into_string(),
        expires_in_ms: ttl.as_millis() as u64,
    }))
}

#[derive(Serialize)]
struct StreamTicket {
    ticket: String,
    /// Duration until the ticket expires, in milliseconds. Relative rather
    /// than absolute so clients don't have to reason about server-vs-client
    /// clock skew.
    expires_in_ms: u64,
}

/// Extract `<id>` from a WS upgrade path of the shape `/sessions/<id>/stream`.
/// Returns `None` for any other shape. Used by `auth_middleware` to scope a
/// ticket redemption to the right session.
///
/// NOTE: this runs in the auth middleware on the raw pre-routing URI path,
/// which is still percent-encoded. The session-id path segment in Aether
/// is always a UUID v4 (hex + dashes) — neither character needs escaping —
/// so a direct `strip_prefix` / `strip_suffix` is safe. If the session-id
/// format ever changes to allow characters that URL-encode, this function
/// must decode the segment before comparing.
fn extract_stream_session_id(path: &str) -> Option<&str> {
    path.strip_prefix("/sessions/")
        .and_then(|rest| rest.strip_suffix("/stream"))
}

async fn ws_session(
    ws: WebSocketUpgrade,
    State(state): State<ApiState>,
    Path(id): Path<String>,
) -> Response {
    // Subscribe before the upgrade so a missing/closed session surfaces as a
    // normal HTTP error instead of an opaque WS handshake failure.
    let rx = match state.pty.subscribe_output(&id) {
        Ok(r) => r,
        Err(e) => return map_pty_err(&id, e).into_response(),
    };
    ws.on_upgrade(move |socket| handle_ws(socket, state, id, rx))
}

async fn handle_ws(
    socket: WebSocket,
    state: ApiState,
    id: String,
    mut rx: broadcast::Receiver<Vec<u8>>,
) {
    log::info!("api: WS session {} opened", id);
    let (mut sender, mut receiver) = socket.split();

    // Send task: broadcast rx -> WS.
    //
    // `Lagged(n)` injects the dim-rendered sentinel produced by
    // [`lag_sentinel_bytes`] so a slow client sees that bytes were skipped
    // instead of silently diverging from the server's view.
    //
    // Each `sender.send(...)` is wrapped in a [`WS_WRITE_TIMEOUT`]: a
    // client that TCP-stalls on the receive side would otherwise pin the
    // task forever and keep the broadcast ring perpetually near-full.
    // Hitting the timeout disconnects the misbehaving client and lets the
    // ring drain for everyone else.
    let read_id = id.clone();
    let mut send_task = tokio::spawn(async move {
        loop {
            match rx.recv().await {
                Ok(chunk) => {
                    match tokio::time::timeout(
                        WS_WRITE_TIMEOUT,
                        sender.send(Message::Binary(chunk)),
                    )
                    .await
                    {
                        Ok(Ok(())) => {}
                        Ok(Err(_)) => break,
                        Err(_) => {
                            log::warn!(
                                "api: WS {} write stalled beyond {:?}, closing",
                                read_id,
                                WS_WRITE_TIMEOUT,
                            );
                            break;
                        }
                    }
                }
                Err(broadcast::error::RecvError::Lagged(n)) => {
                    log::warn!("api: WS {} lagged, dropped {} chunks", read_id, n);
                    let sentinel = lag_sentinel_bytes(n);
                    match tokio::time::timeout(
                        WS_WRITE_TIMEOUT,
                        sender.send(Message::Binary(sentinel)),
                    )
                    .await
                    {
                        Ok(Ok(())) => {}
                        Ok(Err(_)) | Err(_) => break,
                    }
                }
                Err(broadcast::error::RecvError::Closed) => {
                    log::debug!("api: PTY {} broadcast closed", read_id);
                    break;
                }
            }
        }
    });

    // Receive task: WS messages -> PTY write.
    let write_state = state.clone();
    let write_id = id.clone();
    let mut recv_task = tokio::spawn(async move {
        while let Some(msg) = receiver.next().await {
            let bytes = match msg {
                Ok(Message::Binary(b)) => b,
                Ok(Message::Text(t)) => t.into_bytes(),
                Ok(Message::Close(_)) | Err(_) => break,
                Ok(_) => continue, // ping/pong handled by axum
            };
            if bytes.len() > WS_MAX_INPUT_FRAME_BYTES {
                log::warn!(
                    "api: WS {} input frame too large: {} bytes",
                    write_id,
                    bytes.len()
                );
                break;
            }
            if let Err(e) = write_state.pty.write(&write_id, &bytes) {
                log::warn!("api: PTY write to {} failed: {}", write_id, e);
                break;
            }
        }
    });

    // Shutdown signal aborts both tasks so the server can drain on exit.
    let shutdown = state.shutdown.clone();
    tokio::select! {
        _ = (&mut send_task) => recv_task.abort(),
        _ = (&mut recv_task) => send_task.abort(),
        _ = shutdown.notified() => {
            send_task.abort();
            recv_task.abort();
        }
    }

    log::info!("api: WS session {} closed", id);
}

// ─── Unit tests ─────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn auth_verifies_matching_bearer() {
        let cfg = AuthConfig::with_token("secret123");
        assert!(cfg.verify(Some("Bearer secret123")));
    }

    #[test]
    fn auth_rejects_missing_header() {
        let cfg = AuthConfig::with_token("secret123");
        assert!(!cfg.verify(None));
    }

    #[test]
    fn auth_rejects_wrong_token() {
        let cfg = AuthConfig::with_token("secret123");
        assert!(!cfg.verify(Some("Bearer wrong")));
    }

    #[test]
    fn auth_rejects_missing_bearer_prefix() {
        let cfg = AuthConfig::with_token("secret123");
        assert!(!cfg.verify(Some("secret123")));
        assert!(!cfg.verify(Some("Basic secret123")));
    }

    #[test]
    fn auth_rejects_truncated_token() {
        let cfg = AuthConfig::with_token("secret123");
        assert!(!cfg.verify(Some("Bearer secret12")));
    }

    #[test]
    fn auth_disabled_accepts_anything() {
        let cfg = AuthConfig::disabled();
        assert!(cfg.verify(None));
        assert!(cfg.verify(Some("Bearer anything")));
        assert!(cfg.verify_token(""));
        assert!(cfg.verify_token("garbage"));
    }

    #[test]
    fn verify_token_matches_only_exact() {
        let cfg = AuthConfig::with_token("s3cret");
        assert!(cfg.verify_token("s3cret"));
        assert!(!cfg.verify_token("s3cre"));
        assert!(!cfg.verify_token("s3cretx"));
        assert!(!cfg.verify_token(""));
    }

    #[test]
    fn ct_eq_matches_stdlib_for_equal_len() {
        assert!(ct_eq(b"abc", b"abc"));
        assert!(!ct_eq(b"abc", b"abd"));
        assert!(!ct_eq(b"abc", b"abcd"));
        assert!(ct_eq(b"", b""));
    }

    #[test]
    fn parse_shell_accepts_aliases() {
        assert!(matches!(
            parse_shell("pwsh").unwrap(),
            ShellType::PowerShell
        ));
        assert!(matches!(
            parse_shell("POWERSHELL").unwrap(),
            ShellType::PowerShell
        ));
        assert!(matches!(parse_shell("cmd").unwrap(), ShellType::Cmd));
        assert!(matches!(parse_shell("bash").unwrap(), ShellType::GitBash));
    }

    #[test]
    fn parse_shell_rejects_unknown() {
        let err = parse_shell("fish").unwrap_err();
        assert!(matches!(err, ApiError::BadRequest(_)));
    }

    #[test]
    fn validate_api_cwd_blocks_traversal_and_system_dirs() {
        assert!(matches!(
            validate_api_cwd("C:/Users/owner/../Windows"),
            Err(ApiError::BadRequest(_))
        ));
        assert!(matches!(
            validate_api_cwd("C:/Windows/System32"),
            Err(ApiError::BadRequest(_))
        ));
        assert!(matches!(
            validate_api_cwd("\\\\server\\share"),
            Err(ApiError::BadRequest(_))
        ));
    }

    #[test]
    fn normalize_api_cwd_allows_empty_and_existing_dirs() {
        assert_eq!(normalize_api_cwd(None).unwrap(), None);
        assert_eq!(normalize_api_cwd(Some("   ".into())).unwrap(), None);
        let cwd = std::env::current_dir().unwrap();
        assert_eq!(
            normalize_api_cwd(Some(cwd.to_string_lossy().to_string())).unwrap(),
            Some(cwd.to_string_lossy().to_string())
        );
    }

    #[test]
    fn normalize_api_cwd_allows_home_relative_and_unicode_dirs() {
        if let Some(home) = home_dir_for_cwd() {
            assert_eq!(
                normalize_api_cwd(Some("~".into())).unwrap(),
                Some(home.to_string_lossy().to_string())
            );
        }

        let unicode_dir =
            std::env::temp_dir().join(format!("aether-cwd-馬-{}", std::process::id()));
        std::fs::create_dir_all(&unicode_dir).unwrap();
        assert_eq!(
            normalize_api_cwd(Some(unicode_dir.to_string_lossy().to_string())).unwrap(),
            Some(unicode_dir.to_string_lossy().to_string())
        );
        let _ = std::fs::remove_dir_all(unicode_dir);
    }

    #[test]
    fn normalize_api_cwd_accepts_local_verbatim_paths_but_rejects_unc_verbatim() {
        let cwd = std::env::current_dir().unwrap();
        let verbatim = format!(r"\\?\{}", cwd.to_string_lossy());
        assert_eq!(
            normalize_api_cwd(Some(verbatim)).unwrap(),
            Some(cwd.to_string_lossy().to_string())
        );
        assert!(matches!(
            normalize_api_cwd(Some(r"\\?\UNC\server\share".into())),
            Err(ApiError::BadRequest(_))
        ));
    }

    #[test]
    fn percent_decode_passthrough_and_sequences() {
        assert_eq!(percent_decode("abc"), "abc");
        assert_eq!(percent_decode("a%20b"), "a b");
        assert_eq!(percent_decode("a+b"), "a b");
        assert_eq!(percent_decode("%2B%21"), "+!");
        // Malformed sequences are passed through.
        assert_eq!(percent_decode("a%2"), "a%2");
        assert_eq!(percent_decode("a%zz"), "a%zz");
        // Round-trip of a URL-encoded token works.
        let token = "with space/plus+and%25";
        let encoded = "with%20space%2Fplus%2Band%2525";
        assert_eq!(percent_decode(encoded), token);
    }

    #[test]
    fn api_error_renders_expected_status() {
        use axum::response::IntoResponse;
        let r = ApiError::NotFound("x".into()).into_response();
        assert_eq!(r.status(), StatusCode::NOT_FOUND);

        let r = ApiError::BadRequest("x".into()).into_response();
        assert_eq!(r.status(), StatusCode::BAD_REQUEST);

        let r = ApiError::Unauthorized.into_response();
        assert_eq!(r.status(), StatusCode::UNAUTHORIZED);

        let r = ApiError::RateLimited.into_response();
        assert_eq!(r.status(), StatusCode::TOO_MANY_REQUESTS);

        let r = ApiError::Internal("x".into()).into_response();
        assert_eq!(r.status(), StatusCode::INTERNAL_SERVER_ERROR);
    }
}
