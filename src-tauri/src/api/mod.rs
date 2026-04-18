//! Phase 3D-1 spike: HTTP + WebSocket API exposing PTY sessions to external
//! clients (curl / websocat / future remote orchestrators).
//!
//! Routes:
//!   POST   /sessions             { shell, cols, rows, cwd? } -> { id }
//!   GET    /sessions             -> [TerminalInfo]
//!   DELETE /sessions/:id         -> 204
//!   GET    /sessions/:id/stream  WebSocket upgrade
//!     - server -> client: binary frames of PTY output
//!     - client -> server: binary or text frames written into the PTY
//!
//! Server runs on 127.0.0.1:9333 alongside the Tauri app. Sessions created via
//! this API land in the same `PtyManager` as Tauri-spawned sessions, so they
//! show up in `list_terminals` etc., but the spike does not yet auto-attach
//! the Tauri frontend to externally-created PTYs.

use std::io::Read;
use std::net::SocketAddr;

use axum::{
    extract::{
        ws::{Message, WebSocket},
        Path, State, WebSocketUpgrade,
    },
    http::StatusCode,
    response::IntoResponse,
    routing::{delete, get, post},
    Json, Router,
};
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::pty::{PtyManager, ShellType};

pub const DEFAULT_PORT: u16 = 9333;

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

#[derive(Serialize)]
struct ApiError {
    error: String,
}

fn err(status: StatusCode, msg: impl Into<String>) -> (StatusCode, Json<ApiError>) {
    (status, Json(ApiError { error: msg.into() }))
}

/// Lenient shell parsing — accepts common aliases so spike clients can use
/// either the wire format ("powershell") or shorthand ("pwsh").
fn parse_shell(s: &str) -> Result<ShellType, String> {
    match s.to_lowercase().as_str() {
        "pwsh" | "powershell" | "ps" => Ok(ShellType::PowerShell),
        "cmd" => Ok(ShellType::Cmd),
        "gitbash" | "bash" => Ok(ShellType::GitBash),
        "wsl" => Ok(ShellType::Wsl),
        other => Err(format!("unknown shell: {}", other)),
    }
}

/// Spawn the API server. Returns once the listener is bound; the server itself
/// runs forever until the Tauri app terminates.
pub async fn serve(app: AppHandle, port: u16) -> std::io::Result<()> {
    let router = Router::new()
        .route("/sessions", post(create_session).get(list_sessions))
        .route("/sessions/:id", delete(close_session))
        .route("/sessions/:id/stream", get(ws_session))
        .with_state(app);

    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    let listener = tokio::net::TcpListener::bind(addr).await?;
    log::info!("Phase 3D-1 spike: PTY API listening on http://{}", addr);
    axum::serve(listener, router).await
}

async fn create_session(
    State(app): State<AppHandle>,
    Json(body): Json<CreateSessionBody>,
) -> Result<Json<CreateSessionResponse>, (StatusCode, Json<ApiError>)> {
    let shell = parse_shell(&body.shell).map_err(|e| err(StatusCode::BAD_REQUEST, e))?;
    let pty = app.state::<PtyManager>();
    let id = pty
        .spawn(&shell, body.cols, body.rows, body.cwd.as_deref())
        .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, e))?;
    Ok(Json(CreateSessionResponse { id }))
}

async fn list_sessions(State(app): State<AppHandle>) -> Json<Vec<crate::pty::TerminalInfo>> {
    Json(app.state::<PtyManager>().list_info())
}

async fn close_session(State(app): State<AppHandle>, Path(id): Path<String>) -> StatusCode {
    match app.state::<PtyManager>().close(&id) {
        Ok(_) => StatusCode::NO_CONTENT,
        Err(_) => StatusCode::NOT_FOUND,
    }
}

async fn ws_session(
    ws: WebSocketUpgrade,
    State(app): State<AppHandle>,
    Path(id): Path<String>,
) -> axum::response::Response {
    // take_reader before upgrade so we surface NOT_FOUND as a normal HTTP
    // error rather than an opaque WS handshake failure.
    let reader = match app.state::<PtyManager>().take_reader(&id) {
        Ok(r) => r,
        Err(e) => return err(StatusCode::NOT_FOUND, e).into_response(),
    };
    ws.on_upgrade(move |socket| handle_ws(socket, app, id, reader))
}

async fn handle_ws(
    socket: WebSocket,
    app: AppHandle,
    id: String,
    mut reader: Box<dyn Read + Send>,
) {
    log::info!("api: WS session {} opened", id);
    let (mut sender, mut receiver) = socket.split();
    let (tx, mut rx) = tokio::sync::mpsc::channel::<Vec<u8>>(64);

    // Reader task: blocking PTY read -> tokio mpsc.
    // This task ends naturally when the PTY closes (read returns 0).
    let read_id = id.clone();
    let _read_task = tokio::task::spawn_blocking(move || {
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
    let write_app = app.clone();
    let write_id = id.clone();
    let mut recv_task = tokio::spawn(async move {
        while let Some(msg) = receiver.next().await {
            let bytes = match msg {
                Ok(Message::Binary(b)) => b,
                Ok(Message::Text(t)) => t.into_bytes(),
                Ok(Message::Close(_)) | Err(_) => break,
                Ok(_) => continue, // ping/pong handled by axum
            };
            if let Err(e) = write_app.state::<PtyManager>().write(&write_id, &bytes) {
                log::warn!("api: PTY write to {} failed: {}", write_id, e);
                break;
            }
        }
    });

    // First task to finish brings down the session.
    tokio::select! {
        _ = (&mut send_task) => recv_task.abort(),
        _ = (&mut recv_task) => send_task.abort(),
    }
    log::info!("api: WS session {} closed", id);
}
