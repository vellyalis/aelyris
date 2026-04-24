# Phase 3D-1 v2 Plan

Scope v2 of the HTTP/WS PTY API after v1 landed in `c0e2042` (merge of
`spike/3d-1-terminal-api`) as part of `v0.2.0`.

v1 status: 14/14 `scripts/verify-3d1.mjs` live PASS (2026-04-24), 343 `cargo
test` PASS (serial), reviewed by security-reviewer + rust-reviewer, HIGH+MEDIUM
closed.

## Why split v2 into sub-PRs

Each item below is independently valuable and independently reviewable. Landing
them as one PR would (a) bloat review surface, (b) couple deployment risk
(TLS / reader-share touch different layers), (c) delay the easy wins (CORS,
rate limit) behind the heavy ones.

| sub-PR | theme | depends on | rough size |
|--------|-------|-----------|------------|
| v2a | CORS + rate limit | — | small (1 day) |
| v2b | upgrade-ticket WS auth + subtle crate | v2a merged (WS auth surface) | medium (1–2 days) |
| v2c | reader share with Tauri frontend (PtyManager redesign) | v2a merged | large (3–5 days) |
| v2d | TLS | v2a+v2b merged | medium (1–2 days) |

## v2a — CORS + rate limit ✅ LANDED

Landed as `feat/3d-1-v2a-cors-ratelimit`, merged into
`refactor/tauri-react-migration`. Summary of what shipped:

- `tower_http::cors::CorsLayer` outside the auth middleware; OPTIONS
  preflights bypass auth, matched origins get back the full CORS header set.
- `AETHER_API_CORS_ORIGIN` env var (comma-separated) overrides the default
  `http://127.0.0.1:1420`. Typos logged as warn; fully invalid list falls
  back to the default.
- Per-IP token-bucket rate limiter keyed on `ConnectInfo<SocketAddr>` peer
  IP (documented to never swap to `X-Forwarded-For` without a trusted-proxy
  CIDR list). REST 60/min (burst 60), WS upgrade 1/sec (burst 3). Applied
  after auth so 401 is never masked by 429.
- Bounded at `MAX_RATE_LIMIT_IPS=4096` with FIFO eviction to kill the DoS
  path where a rotating IP source would grow the map unbounded.
- `RateLimiter::unlimited()` uses an explicit `bypass: bool` flag rather
  than sentinel `f64::MAX` values — zero fragile floating-point magnitude.
- 10 new integration tests in `test_api_3d1_v2a.rs`.

### Original rationale (kept for context)

**Deliverables**:
- `tower_http::cors::CorsLayer` mounted on the axum router.
  - Default: allow `http://127.0.0.1:1420` (Tauri dev origin) only, methods
    `GET/POST/DELETE`, headers `Authorization,Content-Type`, credentials off.
  - Override via `AETHER_API_CORS_ORIGIN` env var (comma-separated list) — wide
    open (`*`) must require explicit opt-in.
- Per-token rate limit. Leaky-bucket via `tower::ServiceBuilder` +
  `tower_governor` (already a common Rust crate) or a hand-rolled limiter.
  - Default: 60 req/min across all REST endpoints per token.
  - WS connect also subject to rate limit (1 / sec / token) to prevent
    socket-churn attacks.
- Integration tests: 429 response, CORS preflight (OPTIONS) → 204 with correct
  headers.

**Out of scope for v2a**: sliding-window precision, distributed rate limit.

## v2b — upgrade-ticket WS auth + subtle crate ✅ LANDED

Landed as `feat/3d-1-v2b-upgrade-ticket`, merged into
`refactor/tauri-react-migration`. Summary of what shipped:

- `POST /sessions/:id/stream-ticket` returns `{ticket: <uuid>, expires_in_ms: 10000}`.
  Relative `expires_in_ms` (not absolute) to sidestep client-server clock skew.
- WS upgrade accepts `?ticket=<uuid>` as the preferred path. Legacy
  `?token=<t>` still accepted but logs a one-per-process deprecation warning.
- Tickets are single-use, 10 s TTL, bound to a specific `session_id`, cap
  at 1024 live tickets with oldest-by-expiry eviction.
- Newtype `TicketId(String)` on public APIs prevents the
  `redeem_for_session(ticket, session_id)` argument swap at type level.
- `subtle::ConstantTimeEq` replaces the hand-rolled token comparison.
- `scripts/verify-3d1.mjs`: 18 checks (was 14).
- 11 new integration tests in `test_api_3d1_v2b.rs`.

### v2b follow-ups deferred to future PRs

- **Multi-tenant ticket eviction.** The single-tenant model uses
  oldest-by-expiry eviction on overflow. Under multi-tenant auth this would
  let one tenant starve another's live tickets. Switch to per-tenant quotas
  before landing any multi-tenant change.
- **`PtyManager::contains(id)`.** `issue_stream_ticket` currently does an
  `O(n)` scan via `pty.list()`. Fine at `MAX_PTY_SESSIONS=32`; promote to a
  dedicated method when `PtyManager` is touched anyway (expected during v2c).
- **`?token=` removal.** One release after v2b lands, remove the legacy
  query-string path entirely. Tracked here so it doesn't get forgotten.

## v2c — reader share with Tauri frontend

**Why**: v1's `PtyManager::take_reader` moves the reader out of the manager.
That means the running Tauri UI and the API cannot both read the same PTY.
Practical consequence: turning on the API starves the UI (or vice versa). For
headless / remote use this is fine; for "same box, same user driving both
panes" it blocks the very use-case of 3D-1.

**Deliverables**:
- `PtyManager::subscribe_output(id) -> broadcast::Receiver<Bytes>` — returns a
  new subscriber on every call. Internally the PTY read loop fan-outs to a
  `tokio::sync::broadcast::channel` (capacity tuned for burst-safe, e.g. 1024).
- Tauri commands migrate from `take_reader` → `subscribe_output`.
- API's WS handler migrates to `subscribe_output`.
- Backpressure policy: slow consumers get `RecvError::Lagged(n)` → API inserts
  a sentinel `\x1b[2m[dropped Nb]\x1b[0m` into the WS stream so the client can
  see a gap; UI drops silently.
- Tests: multiple simultaneous readers receive identical bytes; slow reader
  does not stall fast reader.

**Risk**: behaviour change — anything relying on "only one reader" breaks.
Audit call sites before merging.

## v2d — TLS

**Why last**: only needed when we actually expose 9333 beyond localhost. Until
then, pure additional attack surface.

**Deliverables**:
- `AETHER_API_TLS_CERT` + `AETHER_API_TLS_KEY` env vars (or paths). Uses
  `axum-server` + `rustls`. Fallback: plain HTTP on localhost.
- Auto-generate self-signed cert into `%LOCALAPPDATA%\aether-terminal\tls\` on
  first run if the env vars are unset but `AETHER_API_BIND` is non-loopback.
  Prints SHA-256 fingerprint on stdout — user pins it client-side.
- `scripts/verify-3d1.mjs` gains a `--tls` flag that uses the generated cert.
- Docs: how to put a real cert in place for production exposure.

## Tracking

- Branch naming: `feat/3d-1-v2a-cors-ratelimit`, etc.
- Each merges into `refactor/tauri-react-migration` under `v0.2.x` / `v0.3.0`.
- Each updates `scripts/verify-3d1.mjs` PASS count (currently 14/14).

## Decision point

Order v2a → v2c → v2b → v2d is an alternative — if the dogfood pain is
"turning on API kills my UI PTY," bump v2c ahead of v2b. Re-evaluate after
a week of dogfood (see `project_dogfood_log.md`).
