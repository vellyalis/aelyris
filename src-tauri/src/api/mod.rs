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
//! sessions, so they show up in `list_terminals` etc. Simultaneous UI +
//! external control of the same session is possible for reading (readers are
//! cloned, not consumed) but input/resize will race — a broadcast layer is
//! deferred to v2.

use std::io::Read;
use std::net::SocketAddr;
use std::sync::Arc;

use axum::{
    extract::{
        ws::{Message, WebSocket},
        Path, Request, State, WebSocketUpgrade,
    },
    http::{header, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{delete, get, post},
    Json, Router,
};
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use thiserror::Error;
use tokio::sync::Notify;

use crate::pty::{PtyError, PtyManager, ShellType, TerminalInfo};

pub const DEFAULT_PORT: u16 = 9333;

/// Hard cap on concurrent PTY sessions attributable to the API. Guards
/// against a misbehaving authorized client looping `POST /sessions` until
/// the host runs out of file descriptors. Applies to the total `PtyManager`
/// session count (which includes UI-spawned sessions) since the underlying
/// resource pool is shared.
pub const MAX_PTY_SESSIONS: usize = 32;

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
}

impl ApiState {
    pub fn new(pty: PtyManager, auth: AuthConfig) -> Self {
        Self {
            pty,
            auth,
            shutdown: Arc::new(Notify::new()),
            max_sessions: MAX_PTY_SESSIONS,
        }
    }

    /// Override the session cap. Used by integration tests; production
    /// callers rely on the default.
    pub fn with_max_sessions(mut self, cap: usize) -> Self {
        self.max_sessions = cap;
        self
    }

    /// Signal the running server to stop gracefully. Safe to call even if no
    /// server is running — the Notify is just dropped.
    pub fn trigger_shutdown(&self) {
        self.shutdown.notify_waiters();
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
    /// Uses a constant-time comparison to avoid leaking token length / prefix
    /// via timing side channels.
    pub fn verify(&self, header: Option<&str>) -> bool {
        let Some(required) = self.token.as_deref() else {
            return true;
        };
        let Some(h) = header else { return false };
        let Some(provided) = h.strip_prefix("Bearer ") else {
            return false;
        };
        constant_time_eq(provided.as_bytes(), required.as_bytes())
    }

    /// Check a bare token string (e.g. from a query-string parameter).
    /// Constant-time; returns `true` when auth is disabled.
    pub fn verify_token(&self, provided: &str) -> bool {
        let Some(required) = self.token.as_deref() else {
            return true;
        };
        constant_time_eq(provided.as_bytes(), required.as_bytes())
    }
}

/// Constant-time byte equality. Returns false for length mismatch (length is
/// not a secret here — it's either the full configured token or a client
/// guess, both low-sensitivity).
fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff = 0u8;
    for (x, y) in a.iter().zip(b.iter()) {
        diff |= x ^ y;
    }
    diff == 0
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
    if state.auth.verify(header) {
        return Ok(next.run(req).await);
    }

    // Query-string fallback: browsers and Node's built-in WebSocket can't
    // set custom headers on the upgrade request, so we also accept
    // `?token=<t>` on WS endpoints. Everywhere else the header path is the
    // only supported form.
    //
    // SECURITY NOTE: URLs tend to leak into logs (access logs, reverse-proxy
    // logs, `RUST_LOG` trace output). We do not log request URIs anywhere
    // in this module, but future additions must scrub `?token=` before
    // emitting any log line that includes a full URI.
    if req.uri().path().ends_with("/stream") {
        if let Some(q) = req.uri().query() {
            for pair in q.split('&') {
                if let Some(raw) = pair.strip_prefix("token=") {
                    let decoded = percent_decode(raw);
                    if state.auth.verify_token(&decoded) {
                        return Ok(next.run(req).await);
                    }
                }
            }
        }
    }

    Err(ApiError::Unauthorized)
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
pub fn router(state: ApiState) -> Router {
    Router::new()
        .route("/sessions", post(create_session).get(list_sessions))
        .route("/sessions/:id", delete(close_session))
        .route("/sessions/:id/resize", post(resize_session))
        .route("/sessions/:id/stream", get(ws_session))
        .route_layer(middleware::from_fn_with_state(
            state.clone(),
            auth_middleware,
        ))
        .with_state(state)
}

/// Bind `127.0.0.1:port` and serve until the state's shutdown Notify fires.
pub async fn serve(state: ApiState, port: u16) -> std::io::Result<()> {
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    let listener = tokio::net::TcpListener::bind(addr).await?;
    log::info!("3D-1: PTY API listening on http://{}", addr);
    serve_on_listener(state, listener).await
}

/// Serve on a pre-bound listener. Used by tests that want an OS-assigned port.
pub async fn serve_on_listener(
    state: ApiState,
    listener: tokio::net::TcpListener,
) -> std::io::Result<()> {
    let shutdown = state.shutdown.clone();
    let app = router(state);
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

// ─── Handlers ───────────────────────────────────────────────────────────────

async fn create_session(
    State(state): State<ApiState>,
    Json(body): Json<CreateSessionBody>,
) -> ApiResult<Json<CreateSessionResponse>> {
    let shell = parse_shell(&body.shell)?;
    if body.cols == 0 || body.rows == 0 {
        return Err(ApiError::BadRequest("cols and rows must be > 0".into()));
    }
    if state.pty.list_info().len() >= state.max_sessions {
        return Err(ApiError::BadRequest(format!(
            "session limit reached ({})",
            state.max_sessions
        )));
    }
    let id = state
        .pty
        .spawn(&shell, body.cols, body.rows, body.cwd.as_deref())
        .map_err(ApiError::Internal)?;
    Ok(Json(CreateSessionResponse { id }))
}

async fn list_sessions(State(state): State<ApiState>) -> Json<Vec<TerminalInfo>> {
    Json(state.pty.list_info())
}

async fn close_session(
    State(state): State<ApiState>,
    Path(id): Path<String>,
) -> ApiResult<StatusCode> {
    state
        .pty
        .close(&id)
        .map_err(|e| map_pty_err(&id, e))?;
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

async fn ws_session(
    ws: WebSocketUpgrade,
    State(state): State<ApiState>,
    Path(id): Path<String>,
) -> Response {
    // Clone the reader before upgrade so errors surface as normal HTTP
    // responses rather than an opaque WS handshake failure.
    let reader = match state.pty.take_reader(&id) {
        Ok(r) => r,
        Err(e) => return map_pty_err(&id, e).into_response(),
    };
    ws.on_upgrade(move |socket| handle_ws(socket, state, id, reader))
}

async fn handle_ws(
    socket: WebSocket,
    state: ApiState,
    id: String,
    mut reader: Box<dyn Read + Send>,
) {
    log::info!("api: WS session {} opened", id);
    let (mut sender, mut receiver) = socket.split();
    let (tx, mut rx) = tokio::sync::mpsc::channel::<Vec<u8>>(64);

    // Reader task: blocking PTY read -> tokio mpsc. Ends when PTY closes or
    // when `tx` is dropped (which happens as soon as `send_task` finishes).
    //
    // Note: `abort()` on a `spawn_blocking` handle does NOT interrupt the
    // blocking `reader.read()`. The task only really exits when the PTY
    // produces data (and `tx.blocking_send` fails because the channel is
    // closed) or when the PTY itself is dropped and the read returns EOF/err.
    // For graceful shutdown this is fine: the `ExitRequested` hook calls
    // `PtyManager::close_all`, which drops `PtyInstance` / master, which
    // unblocks the read.
    let read_id = id.clone();
    let read_task = tokio::task::spawn_blocking(move || {
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => {
                    log::debug!("api: PTY {} EOF", read_id);
                    break;
                }
                Ok(n) => {
                    if tx.blocking_send(buf[..n].to_vec()).is_err() {
                        break;
                    }
                }
                Err(e) => {
                    log::debug!("api: PTY {} read error: {}", read_id, e);
                    break;
                }
            }
        }
    });

    // Forward task: rx -> WS sender.
    let mut send_task = tokio::spawn(async move {
        while let Some(chunk) = rx.recv().await {
            if sender.send(Message::Binary(chunk)).await.is_err() {
                break;
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

    // Detach the blocking read task. The spawn_blocking documentation
    // intentionally leaks the JoinHandle if it is not awaited — that is
    // acceptable here because (a) the abort() below is a best-effort signal
    // that the task no longer needs to park its thread, and (b) the task
    // self-terminates as soon as its PTY reader is dropped (see close_all in
    // the ExitRequested hook). Tracking the handle explicitly keeps the
    // lifecycle visible.
    read_task.abort();

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
    fn constant_time_eq_matches_stdlib_for_equal_len() {
        assert!(constant_time_eq(b"abc", b"abc"));
        assert!(!constant_time_eq(b"abc", b"abd"));
        assert!(!constant_time_eq(b"abc", b"abcd"));
        assert!(constant_time_eq(b"", b""));
    }

    #[test]
    fn parse_shell_accepts_aliases() {
        assert!(matches!(parse_shell("pwsh").unwrap(), ShellType::PowerShell));
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

        let r = ApiError::Internal("x".into()).into_response();
        assert_eq!(r.status(), StatusCode::INTERNAL_SERVER_ERROR);
    }
}
