use std::collections::HashMap;
use std::net::{SocketAddr, TcpStream};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use tokio::sync::{broadcast, Mutex as AsyncMutex};
use tokio_tungstenite::tungstenite::Message;

use crate::mux::graph::MuxGraph;
use crate::pty::{ShellType, TerminalInfo};

const SIDE_CAR_PORT: u16 = 9334;
const TOKEN_FILE_NAME: &str = "aelyris-pty-server.token";
const INPUT_AUTHORITY_TOKEN_FILE_NAME: &str = "aelyris-input-authority.token";
const HTTP_TIMEOUT: Duration = Duration::from_secs(3);
const HTTP_CONNECT_TIMEOUT: Duration = Duration::from_millis(750);
const SIDECAR_READY_TIMEOUT: Duration = Duration::from_secs(2);
const SIDECAR_READY_POLL_INTERVAL: Duration = Duration::from_millis(50);
const SIDECAR_PROBE_CONNECT_TIMEOUT: Duration = Duration::from_millis(75);

pub type StreamStateCallback = Arc<dyn Fn(&str, SidecarStreamState) + Send + Sync>;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SidecarStreamState {
    pub state: &'static str,
    pub attempt: u32,
}

#[derive(Clone)]
pub struct PtySidecarClient {
    base_url: String,
    token: String,
    input_authority_token: String,
    http: reqwest::Client,
    streams: Arc<Mutex<HashMap<String, SidecarStream>>>,
    stream_connect_lock: Arc<AsyncMutex<()>>,
    on_stream_state: Option<StreamStateCallback>,
}

#[derive(Clone)]
pub struct PtySidecarState {
    client: Arc<Mutex<Option<PtySidecarClient>>>,
    native_backend_locked: Arc<AtomicBool>,
}

impl PtySidecarState {
    pub fn new(client: Option<PtySidecarClient>) -> Self {
        Self {
            client: Arc::new(Mutex::new(client)),
            native_backend_locked: Arc::new(AtomicBool::new(false)),
        }
    }

    pub fn client(&self) -> Option<PtySidecarClient> {
        if self.native_backend_locked.load(Ordering::Acquire) {
            return None;
        }
        self.client.lock().ok().and_then(|client| client.clone())
    }

    pub fn set_client(&self, client: PtySidecarClient) -> Result<(), String> {
        if self.native_backend_locked.load(Ordering::Acquire) {
            return Err("native PTY backend already selected for this app session".to_string());
        }
        let mut slot = self
            .client
            .lock()
            .map_err(|_| "PTY sidecar state lock poisoned".to_string())?;
        if self.native_backend_locked.load(Ordering::Acquire) {
            return Err("native PTY backend already selected for this app session".to_string());
        }
        *slot = Some(client);
        Ok(())
    }

    pub fn lock_native_backend(&self) {
        self.native_backend_locked.store(true, Ordering::Release);
        if let Ok(mut slot) = self.client.lock() {
            *slot = None;
        }
    }
}

#[derive(Clone)]
struct SidecarStream {
    output_tx: broadcast::Sender<Vec<u8>>,
}

impl PtySidecarClient {
    pub fn set_stream_state_callback(&mut self, callback: StreamStateCallback) {
        self.on_stream_state = Some(callback);
    }

    fn report_stream_state(&self, id: &str, state: &'static str, attempt: u32) {
        if let Some(callback) = &self.on_stream_state {
            callback(id, SidecarStreamState { state, attempt });
        }
    }
}

#[derive(Debug, Deserialize)]
struct CreateSessionResponse {
    id: String,
}

#[derive(Debug, Deserialize)]
struct StreamTicket {
    ticket: String,
}

#[derive(Debug, Deserialize)]
struct CaptureResponse {
    text: String,
}

#[derive(Debug, Deserialize)]
struct HealthResponse {
    process_kind: String,
    instance_id: String,
    protocol_version: u32,
    exe: String,
    pid: u32,
    version: String,
}

#[derive(Serialize)]
struct CreateSessionBody<'a> {
    shell: &'a str,
    cols: u16,
    rows: u16,
    #[serde(skip_serializing_if = "Option::is_none")]
    cwd: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    id: Option<&'a str>,
}

#[derive(Serialize)]
struct CreateCommandSessionBody<'a> {
    program: &'a str,
    args: &'a [String],
    cols: u16,
    rows: u16,
    #[serde(skip_serializing_if = "Option::is_none")]
    cwd: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    env: Option<&'a HashMap<String, String>>,
}

#[derive(Serialize)]
struct ResizeBody {
    cols: u16,
    rows: u16,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SplitMuxPaneBody<'a> {
    target_pane_id: &'a str,
    axis: &'a str,
    shell: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    cwd: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    title: Option<&'a str>,
    cols: u16,
    rows: u16,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SwapMuxPanesBody<'a> {
    first_pane_id: &'a str,
    second_pane_id: &'a str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct JoinMuxPaneBody<'a> {
    source_pane_id: &'a str,
    target_pane_id: &'a str,
    axis: &'a str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct EvenMuxLayoutBody<'a> {
    axis: &'a str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RotateMuxLayoutBody<'a> {
    direction: &'a str,
}

#[derive(Serialize)]
struct SynchronizeMuxPanesBody {
    enabled: bool,
}

#[derive(Serialize)]
struct ZoomMuxPaneBody {
    zoomed: bool,
}

impl PtySidecarClient {
    pub fn new(token: String, input_authority_token: String) -> Self {
        let http = reqwest::Client::builder()
            .timeout(HTTP_TIMEOUT)
            .connect_timeout(HTTP_CONNECT_TIMEOUT)
            .build()
            .unwrap_or_else(|err| {
                log::warn!("PTY sidecar HTTP client timeout config failed: {err}");
                reqwest::Client::new()
            });
        Self {
            base_url: format!("http://127.0.0.1:{SIDE_CAR_PORT}"),
            token,
            input_authority_token,
            http,
            streams: Arc::new(Mutex::new(HashMap::new())),
            stream_connect_lock: Arc::new(AsyncMutex::new(())),
            on_stream_state: None,
        }
    }

    pub async fn spawn(
        &self,
        shell: &ShellType,
        cols: u16,
        rows: u16,
        cwd: Option<&str>,
    ) -> Result<String, String> {
        let body = CreateSessionBody {
            shell: shell_name(shell),
            cols,
            rows,
            cwd,
            id: None,
        };
        let created = self.post_create_session(&body, "spawn").await?;
        if let Err(err) = self.ensure_stream(&created.id).await {
            let _ = self.close(&created.id).await;
            return Err(err);
        }
        Ok(created.id)
    }

    pub async fn spawn_with_id(
        &self,
        id: &str,
        shell: &ShellType,
        cols: u16,
        rows: u16,
        cwd: Option<&str>,
    ) -> Result<(), String> {
        let body = CreateSessionBody {
            shell: shell_name(shell),
            cols,
            rows,
            cwd,
            id: Some(id),
        };
        let created = self.post_create_session(&body, "respawn").await?;
        if created.id != id {
            return Err(format!(
                "PTY server respawn returned unexpected id {} for requested {}",
                created.id, id
            ));
        }
        if let Err(err) = self.ensure_stream(id).await {
            let _ = self.close(id).await;
            return Err(err);
        }
        Ok(())
    }

    pub async fn spawn_command(
        &self,
        program: &str,
        args: &[String],
        cols: u16,
        rows: u16,
        cwd: Option<&str>,
        env: Option<&HashMap<String, String>>,
    ) -> Result<String, String> {
        let body = CreateCommandSessionBody {
            program,
            args,
            cols,
            rows,
            cwd,
            env,
        };
        let created = self.post_create_command_session(&body).await?;
        if let Err(err) = self.ensure_stream(&created.id).await {
            let _ = self.close(&created.id).await;
            return Err(err);
        }
        Ok(created.id)
    }

    async fn post_create_session(
        &self,
        body: &CreateSessionBody<'_>,
        label: &str,
    ) -> Result<CreateSessionResponse, String> {
        const MAX_CREATE_ATTEMPTS: u64 = 5;
        for attempt in 1..=MAX_CREATE_ATTEMPTS {
            let res = self
                .http
                .post(format!("{}/sessions", self.base_url))
                .bearer_auth(&self.token)
                .json(body)
                .send()
                .await
                .map_err(|err| format!("PTY server {label} request failed: {err}"))?;
            if res.status().is_success() {
                return res
                    .json::<CreateSessionResponse>()
                    .await
                    .map_err(|err| format!("PTY server {label} response invalid: {err}"));
            }
            let status = res.status();
            if status == reqwest::StatusCode::TOO_MANY_REQUESTS && attempt < MAX_CREATE_ATTEMPTS {
                tokio::time::sleep(Duration::from_millis(300 * attempt)).await;
                continue;
            }
            let detail = res.text().await.unwrap_or_default();
            let detail = detail.trim();
            if detail.is_empty() {
                return Err(format!("PTY server {label} failed: {status}"));
            }
            return Err(format!("PTY server {label} failed: {status}: {detail}"));
        }
        Err(format!("PTY server {label} failed: retry budget exhausted"))
    }

    async fn post_create_command_session(
        &self,
        body: &CreateCommandSessionBody<'_>,
    ) -> Result<CreateSessionResponse, String> {
        const MAX_CREATE_ATTEMPTS: u64 = 5;
        for attempt in 1..=MAX_CREATE_ATTEMPTS {
            let res = self
                .http
                .post(format!("{}/commands", self.base_url))
                .bearer_auth(&self.token)
                .json(body)
                .send()
                .await
                .map_err(|err| format!("PTY server command spawn request failed: {err}"))?;
            if res.status().is_success() {
                return res
                    .json::<CreateSessionResponse>()
                    .await
                    .map_err(|err| format!("PTY server command spawn response invalid: {err}"));
            }
            let status = res.status();
            if status == reqwest::StatusCode::TOO_MANY_REQUESTS && attempt < MAX_CREATE_ATTEMPTS {
                tokio::time::sleep(Duration::from_millis(300 * attempt)).await;
                continue;
            }
            let detail = res.text().await.unwrap_or_default();
            let detail = detail.trim();
            if detail.is_empty() {
                return Err(format!("PTY server command spawn failed: {status}"));
            }
            return Err(format!(
                "PTY server command spawn failed: {status}: {detail}"
            ));
        }
        Err("PTY server command spawn failed: retry budget exhausted".to_string())
    }

    pub async fn write_authorized(
        &self,
        envelope: &crate::command_risk::authority::TerminalWriteEnvelope,
        payload: &[u8],
    ) -> Result<crate::command_risk::authority::TerminalWriteAck, String> {
        if payload.len() > crate::api::WS_MAX_INPUT_FRAME_BYTES {
            return Err(format!(
                "PTY sidecar input frame too large for {}: {} bytes",
                envelope.terminal_id,
                payload.len()
            ));
        }
        #[derive(Serialize)]
        #[serde(rename_all = "camelCase")]
        struct Body<'a> {
            envelope: &'a crate::command_risk::authority::TerminalWriteEnvelope,
            payload: &'a [u8],
        }
        let response = self
            .http
            .post(format!("{}/internal/terminal-write", self.base_url))
            .bearer_auth(&self.token)
            .header("x-aelyris-input-authority", &self.input_authority_token)
            .json(&Body { envelope, payload })
            .send()
            .await
            .map_err(|err| format!("PTY server terminal write request failed: {err}"))?;
        if response.status().is_success() {
            return response
                .json()
                .await
                .map_err(|err| format!("PTY server terminal write ACK invalid: {err}"));
        }
        let status = response.status();
        let detail = response.text().await.unwrap_or_default();
        Err(format!(
            "PTY server terminal write rejected ({status}): {}",
            detail.trim()
        ))
    }

    pub async fn sync_interactive_approval_state(
        &self,
        terminal_id: &str,
        session_id: &str,
        prompt_key: Option<&str>,
    ) -> Result<(), String> {
        #[derive(Serialize)]
        #[serde(rename_all = "camelCase")]
        struct Body<'a> {
            terminal_id: &'a str,
            session_id: &'a str,
            prompt_key: Option<&'a str>,
        }
        let response = self
            .http
            .post(format!(
                "{}/internal/interactive-approval-state",
                self.base_url
            ))
            .bearer_auth(&self.token)
            .header("x-aelyris-input-authority", &self.input_authority_token)
            .json(&Body {
                terminal_id,
                session_id,
                prompt_key,
            })
            .send()
            .await
            .map_err(|err| format!("PTY server approval-state sync failed: {err}"))?;
        if response.status().is_success() {
            Ok(())
        } else {
            let status = response.status();
            let detail = response.text().await.unwrap_or_default();
            Err(format!(
                "PTY server approval-state sync rejected ({status}): {}",
                detail.trim()
            ))
        }
    }

    pub async fn resize(&self, id: &str, cols: u16, rows: u16) -> Result<(), String> {
        let res = self
            .http
            .post(format!("{}/sessions/{}/resize", self.base_url, id))
            .bearer_auth(&self.token)
            .json(&ResizeBody { cols, rows })
            .send()
            .await
            .map_err(|err| format!("PTY server resize request failed: {err}"))?;
        if res.status().is_success() {
            Ok(())
        } else {
            Err(format!("PTY server resize failed: {}", res.status()))
        }
    }

    // Parameter list mirrors the sidecar HTTP split-pane request body;
    // bundling into a struct would just duplicate SplitMuxPaneBody.
    #[allow(clippy::too_many_arguments)]
    pub async fn mux_split_pane(
        &self,
        workspace_id: &str,
        target_pane_id: &str,
        axis: &str,
        shell: &ShellType,
        cols: u16,
        rows: u16,
        cwd: Option<&str>,
        title: Option<&str>,
    ) -> Result<String, String> {
        let body = SplitMuxPaneBody {
            target_pane_id,
            axis,
            shell: shell_name(shell),
            cwd,
            title,
            cols,
            rows,
        };
        let res = self
            .http
            .post(format!(
                "{}/mux/workspaces/{}/panes/split",
                self.base_url, workspace_id
            ))
            .bearer_auth(&self.token)
            .json(&body)
            .send()
            .await
            .map_err(|err| format!("PTY server mux split request failed: {err}"))?;
        if !res.status().is_success() {
            let status = res.status();
            let detail = res.text().await.unwrap_or_default();
            return Err(format!(
                "PTY server mux split failed: {status}: {}",
                detail.trim()
            ));
        }
        let created = res
            .json::<CreateSessionResponse>()
            .await
            .map_err(|err| format!("PTY server mux split response invalid: {err}"))?;
        self.ensure_stream(&created.id).await?;
        Ok(created.id)
    }

    pub async fn mux_close_pane(&self, workspace_id: &str, pane_id: &str) -> Result<(), String> {
        let res = self
            .http
            .delete(format!(
                "{}/mux/workspaces/{}/panes/{}",
                self.base_url, workspace_id, pane_id
            ))
            .bearer_auth(&self.token)
            .send()
            .await
            .map_err(|err| format!("PTY server mux pane close request failed: {err}"))?;
        if let Ok(mut streams) = self.streams.lock() {
            streams.remove(pane_id);
        }
        if res.status().is_success() {
            Ok(())
        } else {
            let status = res.status();
            let detail = res.text().await.unwrap_or_default();
            Err(format!(
                "PTY server mux pane close failed: {status}: {}",
                detail.trim()
            ))
        }
    }

    pub async fn mux_get_workspace(&self, workspace_id: &str) -> Result<Option<MuxGraph>, String> {
        let res = self
            .http
            .get(format!("{}/mux/workspaces/{}", self.base_url, workspace_id))
            .bearer_auth(&self.token)
            .send()
            .await
            .map_err(|err| format!("PTY server mux workspace request failed: {err}"))?;
        if res.status() == reqwest::StatusCode::NOT_FOUND {
            return Ok(None);
        }
        if !res.status().is_success() {
            let status = res.status();
            let detail = res.text().await.unwrap_or_default();
            return Err(format!(
                "PTY server mux workspace failed: {status}: {}",
                detail.trim()
            ));
        }
        res.json::<MuxGraph>()
            .await
            .map(Some)
            .map_err(|err| format!("PTY server mux workspace response invalid: {err}"))
    }

    pub async fn mux_swap_panes(
        &self,
        workspace_id: &str,
        first_pane_id: &str,
        second_pane_id: &str,
    ) -> Result<(), String> {
        let res = self
            .http
            .post(format!(
                "{}/mux/workspaces/{}/panes/swap",
                self.base_url, workspace_id
            ))
            .bearer_auth(&self.token)
            .json(&SwapMuxPanesBody {
                first_pane_id,
                second_pane_id,
            })
            .send()
            .await
            .map_err(|err| format!("PTY server mux swap request failed: {err}"))?;
        if res.status().is_success() {
            Ok(())
        } else {
            let status = res.status();
            let detail = res.text().await.unwrap_or_default();
            Err(format!(
                "PTY server mux swap failed: {status}: {}",
                detail.trim()
            ))
        }
    }

    pub async fn mux_break_pane(&self, workspace_id: &str, pane_id: &str) -> Result<(), String> {
        let res = self
            .http
            .post(format!(
                "{}/mux/workspaces/{}/panes/{}/break",
                self.base_url, workspace_id, pane_id
            ))
            .bearer_auth(&self.token)
            .send()
            .await
            .map_err(|err| format!("PTY server mux break request failed: {err}"))?;
        if res.status().is_success() {
            Ok(())
        } else {
            let status = res.status();
            let detail = res.text().await.unwrap_or_default();
            Err(format!(
                "PTY server mux break failed: {status}: {}",
                detail.trim()
            ))
        }
    }

    pub async fn mux_join_pane(
        &self,
        workspace_id: &str,
        source_pane_id: &str,
        target_pane_id: &str,
        axis: &str,
    ) -> Result<(), String> {
        let res = self
            .http
            .post(format!(
                "{}/mux/workspaces/{}/panes/join",
                self.base_url, workspace_id
            ))
            .bearer_auth(&self.token)
            .json(&JoinMuxPaneBody {
                source_pane_id,
                target_pane_id,
                axis,
            })
            .send()
            .await
            .map_err(|err| format!("PTY server mux join request failed: {err}"))?;
        if res.status().is_success() {
            Ok(())
        } else {
            let status = res.status();
            let detail = res.text().await.unwrap_or_default();
            Err(format!(
                "PTY server mux join failed: {status}: {}",
                detail.trim()
            ))
        }
    }

    pub async fn mux_set_panes_synchronized(
        &self,
        workspace_id: &str,
        enabled: bool,
    ) -> Result<(), String> {
        let res = self
            .http
            .post(format!(
                "{}/mux/workspaces/{}/panes/synchronize",
                self.base_url, workspace_id
            ))
            .bearer_auth(&self.token)
            .json(&SynchronizeMuxPanesBody { enabled })
            .send()
            .await
            .map_err(|err| format!("PTY server mux synchronize request failed: {err}"))?;
        if res.status().is_success() {
            Ok(())
        } else {
            let status = res.status();
            let detail = res.text().await.unwrap_or_default();
            Err(format!(
                "PTY server mux synchronize failed: {status}: {}",
                detail.trim()
            ))
        }
    }

    pub async fn mux_apply_layout(
        &self,
        workspace_id: &str,
        command: &str,
        axis: Option<&str>,
    ) -> Result<(), String> {
        let endpoint = match command {
            "equalize" => "equalize",
            "tiled" => "tiled",
            "even" => "even",
            "rotate-next" | "rotate-previous" => "rotate",
            other => return Err(format!("unknown mux layout command: {other}")),
        };
        let mut request = self
            .http
            .post(format!(
                "{}/mux/workspaces/{}/layout/{}",
                self.base_url, workspace_id, endpoint
            ))
            .bearer_auth(&self.token);
        if endpoint == "even" {
            let axis = axis.ok_or_else(|| "even layout requires an axis".to_string())?;
            request = request.json(&EvenMuxLayoutBody { axis });
        } else if endpoint == "rotate" {
            let direction = if command == "rotate-previous" {
                "previous"
            } else {
                "next"
            };
            request = request.json(&RotateMuxLayoutBody { direction });
        }
        let res = request
            .send()
            .await
            .map_err(|err| format!("PTY server mux layout request failed: {err}"))?;
        if res.status().is_success() {
            Ok(())
        } else {
            let status = res.status();
            let detail = res.text().await.unwrap_or_default();
            Err(format!(
                "PTY server mux layout failed: {status}: {}",
                detail.trim()
            ))
        }
    }

    pub async fn mux_set_pane_zoom(
        &self,
        workspace_id: &str,
        pane_id: &str,
        zoomed: bool,
    ) -> Result<(), String> {
        let res = self
            .http
            .post(format!(
                "{}/mux/workspaces/{}/panes/{}/zoom",
                self.base_url, workspace_id, pane_id
            ))
            .bearer_auth(&self.token)
            .json(&ZoomMuxPaneBody { zoomed })
            .send()
            .await
            .map_err(|err| format!("PTY server mux zoom request failed: {err}"))?;
        if res.status().is_success() {
            Ok(())
        } else {
            let status = res.status();
            let detail = res.text().await.unwrap_or_default();
            Err(format!(
                "PTY server mux zoom failed: {status}: {}",
                detail.trim()
            ))
        }
    }

    pub async fn close(&self, id: &str) -> Result<(), String> {
        let res = self
            .http
            .delete(format!("{}/sessions/{}", self.base_url, id))
            .bearer_auth(&self.token)
            .send()
            .await
            .map_err(|err| format!("PTY server close request failed: {err}"))?;
        if let Ok(mut streams) = self.streams.lock() {
            streams.remove(id);
        }
        if res.status().is_success() || res.status() == reqwest::StatusCode::NOT_FOUND {
            Ok(())
        } else {
            Err(format!("PTY server close failed: {}", res.status()))
        }
    }

    pub async fn list(&self) -> Result<Vec<String>, String> {
        Ok(self
            .list_info()
            .await?
            .into_iter()
            .map(|info| info.id)
            .collect())
    }

    pub async fn list_info(&self) -> Result<Vec<TerminalInfo>, String> {
        let res = self
            .http
            .get(format!("{}/sessions", self.base_url))
            .bearer_auth(&self.token)
            .send()
            .await
            .map_err(|err| format!("PTY server list request failed: {err}"))?;
        if !res.status().is_success() {
            return Err(format!("PTY server list failed: {}", res.status()));
        }
        res.json::<Vec<TerminalInfo>>()
            .await
            .map_err(|err| format!("PTY server list response invalid: {err}"))
    }

    /// Fetch the daemon-side scrollback tail for a session. Used to backfill
    /// the native renderer when re-adopting sessions that survived an app
    /// restart; `clean=false` keeps ANSI sequences so colors replay intact.
    pub async fn capture(&self, id: &str, lines: usize) -> Result<String, String> {
        let res = self
            .http
            .get(format!("{}/sessions/{}/capture", self.base_url, id))
            .query(&[("lines", lines.to_string().as_str()), ("clean", "false")])
            .bearer_auth(&self.token)
            .send()
            .await
            .map_err(|err| format!("PTY server capture request failed: {err}"))?;
        if !res.status().is_success() {
            return Err(format!("PTY server capture failed: {}", res.status()));
        }
        res.json::<CaptureResponse>()
            .await
            .map(|body| body.text)
            .map_err(|err| format!("PTY server capture response invalid: {err}"))
    }

    /// Ask the daemon to close all sessions and exit (opt-in app setting).
    /// Falls back to terminating the process tree for daemons that predate
    /// the shutdown endpoint. The caller bridges this into the sync exit
    /// handler (kept async here so the startup-probe `block_on` budget in
    /// this file stays at one).
    pub async fn shutdown_daemon(&self) {
        let result = async {
            let res = self
                .http
                .post(format!("{}/daemon/shutdown", self.base_url))
                .bearer_auth(&self.token)
                .send()
                .await
                .map_err(|err| format!("shutdown request failed: {err}"))?;
            if res.status().is_success() {
                return Ok(());
            }
            Err(format!("shutdown endpoint returned {}", res.status()))
        }
        .await;
        match result {
            Ok(()) => log::info!("PTY sidecar daemon shutdown requested"),
            Err(reason) => {
                log::warn!("PTY sidecar graceful shutdown unavailable ({reason}); terminating process tree");
                if let Ok(health) = self.health().await {
                    if health.pid != 0 {
                        terminate_process_tree(health.pid);
                    }
                }
            }
        }
    }

    async fn health(&self) -> Result<HealthResponse, String> {
        let res = self
            .http
            .get(format!("{}/health", self.base_url))
            .bearer_auth(&self.token)
            .send()
            .await
            .map_err(|err| format!("PTY server health request failed: {err}"))?;
        if !res.status().is_success() {
            return Err(format!("PTY server health failed: {}", res.status()));
        }
        res.json::<HealthResponse>()
            .await
            .map_err(|err| format!("PTY server health response invalid: {err}"))
    }

    pub async fn subscribe_output(&self, id: &str) -> Result<broadcast::Receiver<Vec<u8>>, String> {
        self.ensure_stream(id).await?;
        self.streams
            .lock()
            .map_err(|_| "PTY sidecar stream lock poisoned".to_string())?
            .get(id)
            .map(|stream| stream.output_tx.subscribe())
            .ok_or_else(|| format!("PTY sidecar stream missing for {id}"))
    }

    async fn ensure_stream(&self, id: &str) -> Result<(), String> {
        let _connect_guard = self.stream_connect_lock.lock().await;
        if self
            .streams
            .lock()
            .map_err(|_| "PTY sidecar stream lock poisoned".to_string())?
            .contains_key(id)
        {
            return Ok(());
        }

        let socket = self.connect_stream_socket(id).await?;
        let (output_tx, _) = broadcast::channel::<Vec<u8>>(1024);

        self.streams
            .lock()
            .map_err(|_| "PTY sidecar stream lock poisoned".to_string())?
            .insert(
                id.to_string(),
                SidecarStream {
                    output_tx: output_tx.clone(),
                },
            );

        // One supervisor task owns both directions for this terminal. The
        // output broadcast and input queue outlive individual WS sockets, so
        // a transient disconnect (write stall, TCP reset) is healed by
        // reconnecting in place: UI subscribers keep their receiver and the
        // session keeps streaming instead of being misreported as exited.
        let client = self.clone();
        let supervisor_id = id.to_string();
        tauri::async_runtime::spawn(async move {
            client
                .run_stream_supervisor(supervisor_id, socket, output_tx)
                .await;
        });

        Ok(())
    }

    async fn connect_stream_socket(
        &self,
        id: &str,
    ) -> Result<
        tokio_tungstenite::WebSocketStream<
            tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
        >,
        String,
    > {
        let ticket = self.issue_stream_ticket(id).await?;
        let ws_url = format!(
            "ws://127.0.0.1:{SIDE_CAR_PORT}/sessions/{}/stream?ticket={}",
            id, ticket
        );
        let (socket, _) = tokio_tungstenite::connect_async(&ws_url)
            .await
            .map_err(|err| format!("PTY server stream connect failed: {err}"))?;
        Ok(socket)
    }

    async fn run_stream_supervisor(
        &self,
        id: String,
        socket: tokio_tungstenite::WebSocketStream<
            tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
        >,
        output_tx: broadcast::Sender<Vec<u8>>,
    ) {
        let mut socket = Some(socket);
        loop {
            let current = match socket.take() {
                Some(current) => current,
                None => match self.reconnect_stream_socket(&id).await {
                    Some(current) => {
                        // Bytes emitted while disconnected are gone from this
                        // live stream; say so instead of splicing silently.
                        let _ = output_tx.send(
                            b"\r\n\x1b[2m[stream reconnected; output may have gaps]\x1b[0m\r\n"
                                .to_vec(),
                        );
                        current
                    }
                    None => break,
                },
            };
            let (_ws_write, mut ws_read) = current.split();
            loop {
                match ws_read.next().await {
                    Some(Ok(Message::Binary(bytes))) => {
                        let _ = output_tx.send(bytes.to_vec());
                    }
                    Some(Ok(Message::Text(text))) => {
                        let _ = output_tx.send(text.to_string().into_bytes());
                    }
                    Some(Ok(Message::Close(_))) | Some(Err(_)) | None => break,
                    Some(Ok(_)) => {}
                }
            }
        }
        if let Ok(mut streams) = self.streams.lock() {
            streams.remove(&id);
        }
    }

    /// Re-establish the WS stream for a session after a transient drop.
    /// Retries with backoff while the daemon is reachable and still lists the
    /// session; gives up (ending the stream like a real exit) once the
    /// session is gone or the daemon stays unreachable.
    async fn reconnect_stream_socket(
        &self,
        id: &str,
    ) -> Option<
        tokio_tungstenite::WebSocketStream<
            tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
        >,
    > {
        const MAX_DAEMON_UNREACHABLE_STRIKES: u32 = 10;
        let mut unreachable_strikes = 0u32;
        let mut delay = Duration::from_millis(500);
        let mut attempt = 0u32;
        loop {
            tokio::time::sleep(delay).await;
            attempt += 1;
            self.report_stream_state(id, "reconnecting", attempt);
            delay = (delay * 2).min(Duration::from_secs(5));
            match self.list().await {
                Ok(ids) => {
                    unreachable_strikes = 0;
                    if !ids.iter().any(|known| known == id) {
                        log::info!("PTY sidecar session {id} ended while stream was down");
                        self.report_stream_state(id, "gone", attempt);
                        return None;
                    }
                }
                Err(err) => {
                    unreachable_strikes += 1;
                    if unreachable_strikes >= MAX_DAEMON_UNREACHABLE_STRIKES {
                        log::warn!(
                            "PTY sidecar unreachable while reconnecting stream {id}; giving up: {err}"
                        );
                        self.report_stream_state(id, "gone", attempt);
                        return None;
                    }
                    continue;
                }
            }
            match self.connect_stream_socket(id).await {
                Ok(socket) => {
                    log::info!("PTY sidecar stream {id} reconnected");
                    self.report_stream_state(id, "recovered", attempt);
                    return Some(socket);
                }
                Err(err) => {
                    log::debug!("PTY sidecar stream {id} reconnect attempt failed: {err}");
                }
            }
        }
    }

    async fn issue_stream_ticket(&self, id: &str) -> Result<String, String> {
        const MAX_TICKET_ATTEMPTS: u64 = 5;
        for attempt in 1..=MAX_TICKET_ATTEMPTS {
            let res = self
                .http
                .post(format!(
                    "{}/sessions/{}/stream-ticket?mode=read",
                    self.base_url, id
                ))
                .bearer_auth(&self.token)
                .send()
                .await
                .map_err(|err| format!("PTY server stream ticket request failed: {err}"))?;
            if res.status().is_success() {
                let ticket = res
                    .json::<StreamTicket>()
                    .await
                    .map_err(|err| format!("PTY server stream ticket response invalid: {err}"))?;
                return Ok(ticket.ticket);
            }
            if res.status() == reqwest::StatusCode::TOO_MANY_REQUESTS
                && attempt < MAX_TICKET_ATTEMPTS
            {
                tokio::time::sleep(Duration::from_millis(300 * attempt)).await;
                continue;
            }
            return Err(format!(
                "PTY server stream ticket failed for {id}: {}",
                res.status()
            ));
        }
        Err(format!(
            "PTY server stream ticket failed for {id}: retry budget exhausted"
        ))
    }
}

pub fn launch_or_connect() -> Option<PtySidecarClient> {
    let token = load_or_create_token().ok()?;
    let input_authority_token = load_or_create_input_authority_token().ok()?;
    let client = PtySidecarClient::new(token.clone(), input_authority_token.clone());
    if probe_expected_sidecar(&client) {
        return Some(client);
    }
    if let Err(err) = spawn_server_process(&token, &input_authority_token) {
        log::warn!("PTY sidecar launch failed: {err}");
        return None;
    }
    let started_at = Instant::now();
    while started_at.elapsed() < SIDECAR_READY_TIMEOUT {
        std::thread::sleep(SIDECAR_READY_POLL_INTERVAL);
        if probe_expected_sidecar(&client) {
            log::info!("PTY sidecar connected on 127.0.0.1:{SIDE_CAR_PORT}");
            return Some(client);
        }
    }
    log::warn!("PTY sidecar did not become ready");
    None
}

fn probe_expected_sidecar(client: &PtySidecarClient) -> bool {
    if !sidecar_tcp_probe_open(SIDECAR_PROBE_CONNECT_TIMEOUT) {
        return false;
    }
    let expected = match current_server_exe() {
        Ok(expected) => expected,
        Err(err) => {
            log::debug!("PTY sidecar probe failed to resolve expected exe: {err}");
            return false;
        }
    };
    match tauri::async_runtime::block_on(async {
        let health = client.health().await?;
        let sessions = client.list().await?;
        Ok::<_, String>((health, sessions))
    }) {
        Ok((health, sessions)) => {
            if health.process_kind != crate::api::PROCESS_KIND_SIDE_CAR {
                log::warn!(
                    "PTY sidecar probe rejected process kind {} on 127.0.0.1:{}",
                    health.process_kind,
                    SIDE_CAR_PORT
                );
                return false;
            }
            if health.pid == 0 || health.instance_id.trim().is_empty() {
                log::warn!(
                    "PTY sidecar probe rejected invalid identity pid={} instance_id={:?}",
                    health.pid,
                    health.instance_id
                );
                return false;
            }
            if !same_file_name(&health.exe, &expected)
                || !same_canonical_path(&health.exe, &expected)
            {
                log::warn!(
                    "PTY sidecar probe rejected unexpected executable {:?}; expected {:?}",
                    health.exe,
                    expected
                );
                return false;
            }
            if health.protocol_version != crate::api::DAEMON_PROTOCOL_VERSION {
                log::warn!(
                    "PTY sidecar probe rejected protocol {} on 127.0.0.1:{}; expected {}",
                    health.protocol_version,
                    SIDE_CAR_PORT,
                    crate::api::DAEMON_PROTOCOL_VERSION
                );
                if sessions.is_empty() {
                    terminate_stale_expected_sidecar(&health, &expected, "protocol");
                } else {
                    // Never kill a daemon that still hosts live sessions:
                    // surviving agent work outranks backend selection. This
                    // app run falls back to the native backend; the daemon
                    // stays reachable for an app build that speaks its
                    // protocol.
                    log::warn!(
                        "PTY sidecar protocol mismatch left running: {} live session(s) would be destroyed (pid={})",
                        sessions.len(),
                        health.pid
                    );
                }
                return false;
            }
            if health.version != env!("CARGO_PKG_VERSION") {
                if sessions.is_empty() {
                    // Session-free daemon from another build: refresh it so
                    // the freshly spawned binary picks up fixes.
                    log::info!(
                        "refreshing session-free PTY sidecar {} -> {}",
                        health.version,
                        env!("CARGO_PKG_VERSION")
                    );
                    terminate_stale_expected_sidecar(&health, &expected, "version-refresh");
                    return false;
                }
                // Same wire protocol, different app build: the daemon is
                // compatible by definition of DAEMON_PROTOCOL_VERSION, and
                // killing it would destroy sessions that survived an app
                // update. Adopt it.
                log::info!(
                    "PTY sidecar version {} differs from app {} but speaks protocol {}; adopting ({} live session(s))",
                    health.version,
                    env!("CARGO_PKG_VERSION"),
                    health.protocol_version,
                    sessions.len()
                );
            }
            true
        }
        Err(err) => {
            log::debug!("PTY sidecar probe failed: {err}");
            false
        }
    }
}

fn sidecar_tcp_probe_open(timeout: Duration) -> bool {
    let addr = SocketAddr::from(([127, 0, 0, 1], SIDE_CAR_PORT));
    TcpStream::connect_timeout(&addr, timeout).is_ok()
}

fn same_file_name(actual: &str, expected: &std::path::Path) -> bool {
    let actual_name = std::path::Path::new(actual)
        .file_name()
        .and_then(|name| name.to_str());
    let expected_name = expected.file_name().and_then(|name| name.to_str());
    actual_name == expected_name
}

fn same_canonical_path(actual: &str, expected: &std::path::Path) -> bool {
    let Ok(actual) = std::fs::canonicalize(actual) else {
        return false;
    };
    let Ok(expected) = std::fs::canonicalize(expected) else {
        return false;
    };
    actual == expected
}

fn terminate_stale_expected_sidecar(
    health: &HealthResponse,
    expected: &std::path::Path,
    reason: &str,
) {
    if health.pid == 0 {
        return;
    }
    if !same_file_name(&health.exe, expected) || !same_canonical_path(&health.exe, expected) {
        return;
    }
    log::warn!(
        "terminating stale PTY sidecar pid={} reason={} exe={:?}",
        health.pid,
        reason,
        health.exe
    );
    terminate_process_tree(health.pid);
}

#[cfg(windows)]
fn terminate_process_tree(pid: u32) {
    let pid = pid.to_string();
    if let Err(err) = crate::process::hidden_command("taskkill")
        .arg("/PID")
        .arg(&pid)
        .arg("/T")
        .arg("/F")
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
    {
        log::warn!("failed to terminate stale PTY sidecar pid={pid}: {err}");
    }
}

#[cfg(not(windows))]
fn terminate_process_tree(_pid: u32) {}

fn spawn_server_process(token: &str, input_authority_token: &str) -> Result<(), String> {
    let exe = current_server_exe()?;
    let mut command = crate::process::hidden_command(exe);
    command
        .env("AELYRIS_API_TOKEN", token)
        .env("AELYRIS_INPUT_AUTHORITY_TOKEN", input_authority_token)
        .env("AELYRIS_PTY_SERVER_PORT", SIDE_CAR_PORT.to_string())
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());
    // Give the daemon a durable scrollback store next to the token file.
    // Without it the daemon only keeps an in-memory ring, capping how much
    // history a re-adopted session can backfill after an app restart.
    if std::env::var(crate::pty::PTY_SCROLLBACK_DIR_ENV).is_err() {
        if let Some(dir) = token_path()?.parent() {
            command.env(
                crate::pty::PTY_SCROLLBACK_DIR_ENV,
                dir.join("pty-scrollback"),
            );
        }
    }

    // NOTE: the sidecar is deliberately NOT assigned to the app's kill-on-close
    // job. It is the PTY daemon that must OUTLIVE the app to enable
    // detach/reattach (the next app launch adopts its live sessions, see
    // terminate_stale_expected_sidecar vs. adoption above). Its own agent/shell
    // children are still orphan-safe: the sidecar assigns every PTY child to ITS
    // OWN kill-on-close job (see PtyManager::spawn_command_with_id), so whenever
    // the sidecar exits — cleanly, or terminated as stale on the next launch —
    // the OS kills every agent it hosts. A sidecar abandoned by a crashed app
    // that never relaunches is the one residual case; it is a single process
    // (not accumulating) and the next Aelyris launch reaps it.
    command
        .spawn()
        .map(|_| ())
        .map_err(|err| format!("failed to spawn sidecar: {err}"))
}

fn current_server_exe() -> Result<PathBuf, String> {
    let current = std::env::current_exe().map_err(|err| err.to_string())?;
    let exe_name = if cfg!(windows) {
        "aelyris-pty-server.exe"
    } else {
        "aelyris-pty-server"
    };
    let sibling = current.with_file_name(exe_name);
    if sibling.exists() {
        return Ok(sibling);
    }
    let host = option_env!("TAURI_ENV_TARGET_TRIPLE").unwrap_or("x86_64-pc-windows-msvc");
    let bundled_name = if cfg!(windows) {
        format!("aelyris-pty-server-{host}.exe")
    } else {
        format!("aelyris-pty-server-{host}")
    };
    if let Some(workspace_binary) = current
        .parent()
        .and_then(|release| release.parent())
        .and_then(|target| target.parent())
        .map(|src_tauri| src_tauri.join("binaries").join(&bundled_name))
        .filter(|p| p.exists())
    {
        return Ok(workspace_binary);
    }
    let dev = current
        .parent()
        .and_then(|p| p.parent())
        .map(|p| p.join(exe_name))
        .filter(|p| p.exists());
    dev.ok_or_else(|| format!("sidecar executable not found next to {:?}", current))
}

fn load_or_create_token() -> Result<String, String> {
    load_or_create_token_at(token_path()?)
}

#[cfg(test)]
mod tests {
    use super::SidecarStreamState;

    #[test]
    fn stream_state_payload_serializes_contract_shape() {
        for (state, attempt) in [("reconnecting", 2), ("recovered", 2), ("gone", 10)] {
            let value = serde_json::to_value(SidecarStreamState { state, attempt }).unwrap();
            assert_eq!(value, serde_json::json!({ "state": state, "attempt": attempt }));
        }
    }
}

fn load_or_create_input_authority_token() -> Result<String, String> {
    load_or_create_token_at(input_authority_token_path()?)
}

fn load_or_create_token_at(path: PathBuf) -> Result<String, String> {
    if let Ok(token) = std::fs::read_to_string(&path) {
        let trimmed = token.trim();
        if !trimmed.is_empty() {
            harden_token_file(&path)?;
            return Ok(trimmed.to_string());
        }
    }
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|err| err.to_string())?;
    }
    let token = uuid::Uuid::new_v4().to_string();
    write_token_file(&path, &token)?;
    harden_token_file(&path)?;
    Ok(token)
}

fn write_token_file(path: &std::path::Path, token: &str) -> Result<(), String> {
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        const FILE_ATTRIBUTE_HIDDEN: u32 = 0x2;
        options.attributes(FILE_ATTRIBUTE_HIDDEN);
    }
    let mut file = options.open(path).map_err(|err| err.to_string())?;
    std::io::Write::write_all(&mut file, token.as_bytes()).map_err(|err| err.to_string())
}

fn harden_token_file(path: &std::path::Path) -> Result<(), String> {
    #[cfg(windows)]
    {
        harden_token_file_windows(path)?;
    }
    #[cfg(not(windows))]
    {
        let _ = path;
    }
    Ok(())
}

#[cfg(windows)]
fn harden_token_file_windows(path: &std::path::Path) -> Result<(), String> {
    let sid = current_user_sid_for_icacls()?;
    let status = crate::process::hidden_command("icacls")
        .arg(path)
        .arg("/inheritance:r")
        .arg("/grant:r")
        .arg(format!("*{sid}:F"))
        .arg("/grant:r")
        .arg("*S-1-5-18:F")
        .arg("/grant:r")
        .arg("*S-1-5-32-544:F")
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .map_err(|err| format!("failed to run icacls for token file: {err}"))?;
    if !status.success() {
        return Err(format!("icacls failed for token file with status {status}"));
    }

    let _ = crate::process::hidden_command("attrib")
        .arg("+H")
        .arg(path)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status();
    Ok(())
}

#[cfg(windows)]
fn current_user_sid_for_icacls() -> Result<String, String> {
    let output = crate::process::hidden_command("whoami")
        .args(["/user", "/fo", "csv", "/nh"])
        .output()
        .map_err(|err| format!("failed to query current user SID: {err}"))?;
    if !output.status.success() {
        return Err(format!("whoami /user failed with status {}", output.status));
    }
    let text = String::from_utf8_lossy(&output.stdout);
    text.split('"')
        .find(|part| part.starts_with("S-1-"))
        .map(str::to_string)
        .ok_or_else(|| "current user SID was not present in whoami output".to_string())
}

fn token_path() -> Result<PathBuf, String> {
    if let Ok(local_app_data) = std::env::var("LOCALAPPDATA") {
        return Ok(PathBuf::from(local_app_data)
            .join("Aelyris")
            .join(TOKEN_FILE_NAME));
    }
    let home = std::env::home_dir().ok_or_else(|| "home directory unavailable".to_string())?;
    Ok(home.join(".aelyris").join(TOKEN_FILE_NAME))
}

fn input_authority_token_path() -> Result<PathBuf, String> {
    token_path().map(|path| path.with_file_name(INPUT_AUTHORITY_TOKEN_FILE_NAME))
}

fn shell_name(shell: &ShellType) -> &'static str {
    match shell {
        ShellType::PowerShell => "powershell",
        ShellType::Cmd => "cmd",
        ShellType::GitBash => "gitbash",
        ShellType::Wsl => "wsl",
    }
}
