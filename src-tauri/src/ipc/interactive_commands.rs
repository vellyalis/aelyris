use std::io::Read;
use tauri::{AppHandle, Emitter, Manager};
use serde::{Deserialize, Serialize};

use crate::agent::{InteractiveSessionManager, InteractiveSessionInfo, AgentCli};
use crate::agent::output_monitor;
use crate::pty::PtyManager;

#[derive(Debug, Serialize, Deserialize)]
pub struct SpawnResult {
    pub session_id: String,
    pub pty_id: String,
    pub worktree_path: Option<String>,
}

/// Spawn an interactive AI agent in a PTY terminal.
/// Works with any CLI: claude, gemini, codex, or custom.
#[tauri::command]
pub fn spawn_interactive_agent(
    app: AppHandle,
    cwd: String,
    model: Option<String>,
    initial_prompt: Option<String>,
    branch_name: Option<String>,
    cols: u16,
    rows: u16,
) -> Result<SpawnResult, String> {
    let model_str = model.as_deref().unwrap_or("sonnet");
    let cli = AgentCli::from_model(model_str);
    cli.validate()?;
    let (program, mut args) = cli.program_and_args(Some(model_str));

    // Validate branch_name if provided (prevent path traversal / shell injection)
    if let Some(ref branch) = branch_name {
        if branch.is_empty() || branch.len() > 200 {
            return Err("Branch name must be 1-200 characters".to_string());
        }
        if !branch.chars().all(|c| c.is_alphanumeric() || c == '-' || c == '_' || c == '/' || c == '.') {
            return Err("Branch name contains invalid characters".to_string());
        }
        if branch.contains("..") || branch.starts_with('-') || branch.starts_with('.') {
            return Err("Branch name contains unsafe patterns".to_string());
        }
    }

    // If branch_name is set, create a worktree and use it as cwd
    let (resolved_cwd, worktree_branch, worktree_path, repo_path) = if let Some(ref branch) = branch_name {
        let wt = crate::git::create_worktree(&cwd, branch)?;
        let wt_path = wt.path.clone();
        (wt_path.clone(), Some(branch.clone()), Some(wt_path), Some(cwd.clone()))
    } else {
        (cwd.clone(), None, None, None)
    };

    // If initial_prompt is provided and this is Claude, pass it via -p flag
    // so Claude starts working immediately (but stays interactive after)
    if let Some(ref prompt) = initial_prompt {
        match cli {
            AgentCli::Claude => {
                // Use --verbose to get richer output for monitoring
                args.push("--verbose".to_string());
                args.push("-p".to_string());
                args.push(prompt.clone());
            }
            AgentCli::Codex => {
                args.push("-p".to_string());
                args.push(prompt.clone());
            }
            AgentCli::Gemini => {
                args.push("-p".to_string());
                args.push(prompt.clone());
            }
            AgentCli::Custom(_) => {
                // No standard way to pass prompt for custom CLIs
            }
        }
    }

    // Environment vars for the agent process
    let mut env = std::collections::HashMap::new();
    env.insert("AETHER_AGENT_CLI".to_string(), format!("{:?}", cli));
    env.insert("AETHER_AGENT_MODEL".to_string(), model_str.to_string());

    // Spawn via PtyManager (reuses existing PTY infrastructure)
    let pty_manager = app.state::<PtyManager>();
    let pty_id = pty_manager.spawn_command(
        &program,
        &args,
        cols,
        rows,
        Some(&resolved_cwd),
        Some(env),
    )?;

    // Register interactive session
    let session_id = pty_id.clone(); // session ID = pty ID for simplicity
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();

    let info = InteractiveSessionInfo {
        id: session_id.clone(),
        pty_id: pty_id.clone(),
        cli: cli.clone(),
        status: if initial_prompt.is_some() { "thinking".to_string() } else { "idle".to_string() },
        model: model_str.to_string(),
        initial_prompt: initial_prompt.clone(),
        cwd: resolved_cwd,
        worktree_branch,
        worktree_path: worktree_path.clone(),
        repo_path,
        cost: 0.0,
        tokens_used: 0,
        started_at: now,
    };

    let session_mgr = app.state::<InteractiveSessionManager>();
    session_mgr.register(info)?;

    // Start output monitoring thread
    // Reads PTY output, applies CLI-specific parser, and emits session updates
    let reader = pty_manager.take_reader(&pty_id)?;
    let app_handle = app.clone();
    let sid = session_id.clone();
    let monitor_cli = cli.clone();

    std::thread::spawn(move || {
        run_output_monitor(reader, &sid, &monitor_cli, &app_handle);
    });

    // Emit initial session list
    emit_interactive_sessions(&app, &session_mgr);

    log::info!(
        "Spawned interactive agent {} (cli={:?}, model={})",
        session_id, cli, model_str,
    );

    Ok(SpawnResult {
        session_id,
        pty_id,
        worktree_path,
    })
}

/// Stop an interactive agent session
#[tauri::command]
pub fn stop_interactive_agent(app: AppHandle, id: String) -> Result<(), String> {
    let pty_manager = app.state::<PtyManager>();
    let session_mgr = app.state::<InteractiveSessionManager>();

    // Retrieve session info to get pty_id (currently session_id == pty_id)
    let pty_id = match session_mgr.get(&id)? {
        Some(info) => info.pty_id,
        None => id.clone(), // fallback: assume session_id == pty_id
    };

    // Close PTY (kills the process, output monitor thread will exit on read EOF)
    let _ = pty_manager.close(&pty_id);

    // Unregister session
    session_mgr.unregister(&id)?;

    emit_interactive_sessions(&app, &session_mgr);
    log::info!("Stopped interactive agent {}", id);
    Ok(())
}

/// End session AND remove its worktree (unified lifecycle)
#[tauri::command]
pub fn end_session_and_remove_worktree(app: AppHandle, id: String) -> Result<(), String> {
    let session_mgr = app.state::<InteractiveSessionManager>();

    // Get session info before removing
    let info = session_mgr.get(&id)?;

    // Close PTY (use pty_id from session info)
    let pty_manager = app.state::<PtyManager>();
    let pty_id = info.as_ref().map(|s| s.pty_id.clone()).unwrap_or_else(|| id.clone());
    let _ = pty_manager.close(&pty_id);

    // Remove worktree if one was created
    if let Some(session) = &info {
        if let (Some(repo_path), Some(branch)) = (&session.repo_path, &session.worktree_branch) {
            if let Err(e) = crate::git::remove_worktree(repo_path, branch, true) {
                log::warn!("Failed to remove worktree for session {}: {}", id, e);
            }
        }
    }

    // Unregister session
    session_mgr.unregister(&id)?;

    emit_interactive_sessions(&app, &session_mgr);
    log::info!("Ended session and removed worktree for {}", id);
    Ok(())
}

/// List all interactive sessions
#[tauri::command]
pub fn list_interactive_agents(app: AppHandle) -> Vec<InteractiveSessionInfo> {
    let session_mgr = app.state::<InteractiveSessionManager>();
    session_mgr.list()
}

// --- Internal helpers ---

fn emit_interactive_sessions(app: &AppHandle, mgr: &InteractiveSessionManager) {
    let sessions = mgr.list();
    let _ = app.emit("interactive-sessions-updated", &sessions);
}

/// Reads PTY output in a background thread, applies CLI parser, emits status updates.
/// Also emits the raw output as `pty-output-{id}` for xterm.js rendering (same as regular PTY).
fn run_output_monitor(
    mut reader: Box<dyn Read + Send>,
    session_id: &str,
    cli: &AgentCli,
    app: &AppHandle,
) {
    let parser = output_monitor::create_parser(cli);
    let session_mgr = app.state::<InteractiveSessionManager>();
    let mut buf = [0u8; 4096];
    let mut last_status = String::new();

    loop {
        match reader.read(&mut buf) {
            Ok(0) => break, // EOF — process exited
            Ok(n) => {
                let chunk = &buf[..n];

                // Emit raw output as byte array (no base64 overhead)
                let bytes_vec: Vec<u8> = chunk.to_vec();
                let event = format!("pty-output-{}", session_id);
                let _ = app.emit(&event, bytes_vec);

                // Parse for status/cost (strip ANSI first)
                if let Ok(text) = std::str::from_utf8(chunk) {
                    let clean = output_monitor::strip_ansi(text);
                    let result = parser.parse_chunk(&clean);

                    let mut changed = false;

                    if let Some(status) = result.status {
                        let status_str = match status {
                            output_monitor::DetectedStatus::Thinking => "thinking",
                            output_monitor::DetectedStatus::Coding => "coding",
                            output_monitor::DetectedStatus::Idle => "idle",
                            output_monitor::DetectedStatus::Done => "done",
                            output_monitor::DetectedStatus::WaitingPermission => "waiting",
                            output_monitor::DetectedStatus::Unknown => "unknown",
                        };
                        if status_str != last_status {
                            let _ = session_mgr.update_status(session_id, status_str);
                            last_status = status_str.to_string();
                            changed = true;
                        }
                    }

                    if result.usage.cost.is_some() || result.usage.tokens.is_some() {
                        if let Ok(Some(current)) = session_mgr.get(session_id) {
                            let cost = result.usage.cost.unwrap_or(current.cost);
                            let tokens = result.usage.tokens.unwrap_or(current.tokens_used);
                            let _ = session_mgr.update_usage(session_id, cost, tokens);
                            changed = true;
                        }
                    }

                    if changed {
                        emit_interactive_sessions(app, &session_mgr);
                    }
                }
            }
            Err(_) => break, // read error — PTY closed
        }
    }

    // Process exited — update status
    let _ = session_mgr.update_status(session_id, "done");
    emit_interactive_sessions(app, &session_mgr);

    // Emit exit event
    let _ = app.emit(&format!("pty-exit-{}", session_id), ());
}

fn base64_encode(bytes: &[u8]) -> String {
    use std::io::Write;
    let mut buf = Vec::with_capacity(bytes.len() * 4 / 3 + 4);
    {
        let mut encoder = Base64Encoder::new(&mut buf);
        let _ = encoder.write_all(bytes);
        let _ = encoder.finish();
    }
    String::from_utf8(buf).unwrap_or_default()
}

// Minimal base64 encoder (avoids adding another crate)
struct Base64Encoder<W: std::io::Write> {
    inner: W,
    buffer: [u8; 3],
    len: usize,
}

const B64_CHARS: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

impl<W: std::io::Write> Base64Encoder<W> {
    fn new(inner: W) -> Self {
        Self { inner, buffer: [0; 3], len: 0 }
    }

    fn flush_block(&mut self) -> std::io::Result<()> {
        if self.len == 0 { return Ok(()); }
        let b = &self.buffer;
        let mut out = [b'='; 4];
        out[0] = B64_CHARS[(b[0] >> 2) as usize];
        out[1] = B64_CHARS[((b[0] & 0x03) << 4 | b[1] >> 4) as usize];
        if self.len > 1 {
            out[2] = B64_CHARS[((b[1] & 0x0f) << 2 | b[2] >> 6) as usize];
        }
        if self.len > 2 {
            out[3] = B64_CHARS[(b[2] & 0x3f) as usize];
        }
        self.inner.write_all(&out)?;
        self.buffer = [0; 3];
        self.len = 0;
        Ok(())
    }

    fn finish(mut self) -> std::io::Result<()> {
        self.flush_block()
    }
}

impl<W: std::io::Write> std::io::Write for Base64Encoder<W> {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        let mut written = 0;
        for &byte in buf {
            self.buffer[self.len] = byte;
            self.len += 1;
            if self.len == 3 {
                self.flush_block()?;
            }
            written += 1;
        }
        Ok(written)
    }

    fn flush(&mut self) -> std::io::Result<()> {
        self.inner.flush()
    }
}
