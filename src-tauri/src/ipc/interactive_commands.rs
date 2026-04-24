use tokio::sync::broadcast;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, Emitter, Manager};
use serde::{Deserialize, Serialize};

use crate::agent::{InteractiveSessionManager, InteractiveSessionInfo, AgentCli};
use crate::agent::output_monitor;
use crate::ghostdiff::{self, LayerRegistry, LayerTint, WatcherPool};
use crate::pty::PtyManager;
use crate::term::NativeTerminalRegistry;

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
        worktree_branch: worktree_branch.clone(),
        worktree_path: worktree_path.clone(),
        repo_path: repo_path.clone(),
        cost: 0.0,
        tokens_used: 0,
        started_at: now,
    };

    let session_mgr = app.state::<InteractiveSessionManager>();
    session_mgr.register(info)?;

    // Phase 3C-1a: orchestra agents running in a worktree get mirrored as
    // a ghost layer so the panel (and later editor ghosts) see their work.
    // Non-worktree sessions are skipped — there's no isolated diff to show.
    if let (Some(wt_path), Some(wt_branch), Some(repo)) = (
        worktree_path.clone(),
        worktree_branch.clone(),
        repo_path.clone(),
    ) {
        if let (Some(layer_reg), Some(pool)) = (
            app.try_state::<Arc<LayerRegistry>>(),
            app.try_state::<Arc<WatcherPool>>(),
        ) {
            let registry = layer_reg.inner().clone();
            let watcher_pool = pool.inner().clone();
            if let Err(e) = ghostdiff::register_worktree_and_watch(
                &registry,
                &watcher_pool,
                session_id.clone(),
                std::path::PathBuf::from(&wt_path),
                wt_branch,
                std::path::PathBuf::from(&repo),
                LayerTint::orchestra_default(),
            ) {
                log::warn!("ghostdiff: orchestra register failed for {}: {e}", session_id);
            }
        }
    }

    // Register the PTY with the native engine so the frontend's
    // TerminalCanvas can subscribe to its grid diffs.
    let native_registry = app.state::<Arc<NativeTerminalRegistry>>().inner().clone();
    if let Err(e) = native_registry.create(&pty_id, cols, rows) {
        log::warn!("native engine create failed for agent {}: {}", pty_id, e);
    }

    // Per-PTY flush ticker: matches the regular terminal pipeline so the
    // last unsettled diff doesn't stay stuck inside the 16ms coalesce.
    let flush_alive = Arc::new(AtomicBool::new(true));
    {
        let alive = flush_alive.clone();
        let flush_registry = native_registry.clone();
        let flush_handle = app.clone();
        let flush_id = pty_id.clone();
        std::thread::spawn(move || {
            while alive.load(Ordering::Acquire) {
                std::thread::sleep(std::time::Duration::from_millis(33));
                if let Some(diff) = flush_registry.flush(&flush_id) {
                    let _ = flush_handle.emit(&format!("term:diff-{}", flush_id), diff);
                }
            }
        });
    }

    // Start output monitoring task.
    //
    // Subscribes to the PtyManager broadcast so this monitor can coexist
    // with the external API on the same session without stealing bytes
    // from each other (3D-1 v2c).
    let rx = pty_manager.subscribe_output(&pty_id)?;
    let app_handle = app.clone();
    let sid = session_id.clone();
    let monitor_cli = cli.clone();
    let monitor_registry = native_registry.clone();
    let monitor_alive = flush_alive.clone();

    tauri::async_runtime::spawn(async move {
        run_output_monitor(
            rx,
            &sid,
            &monitor_cli,
            &app_handle,
            monitor_registry,
            monitor_alive,
        )
        .await;
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

    // Update status to "done" before closing PTY so the frontend sees the
    // final state even if the output monitor thread hasn't caught up yet.
    let _ = session_mgr.update_status(&id, "done");

    // Close PTY (kills the process, output monitor thread will exit on read EOF)
    let _ = pty_manager.close(&pty_id);

    // Tear down native engine session for this PTY.
    app.state::<Arc<NativeTerminalRegistry>>().remove(&pty_id);

    // Remove ghost layer if one was registered.
    if let (Some(layer_reg), Some(pool)) = (
        app.try_state::<Arc<LayerRegistry>>(),
        app.try_state::<Arc<WatcherPool>>(),
    ) {
        let registry = layer_reg.inner().clone();
        let watcher_pool = pool.inner().clone();
        ghostdiff::unregister_and_unwatch(&registry, &watcher_pool, &id);
    }

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

    // Tear down native engine session for this PTY.
    app.state::<Arc<NativeTerminalRegistry>>().remove(&pty_id);

    // Remove ghost layer *before* the worktree disappears so the watcher
    // doesn't get a storm of fs events from the deletion itself.
    if let (Some(layer_reg), Some(pool)) = (
        app.try_state::<Arc<LayerRegistry>>(),
        app.try_state::<Arc<WatcherPool>>(),
    ) {
        let registry = layer_reg.inner().clone();
        let watcher_pool = pool.inner().clone();
        ghostdiff::unregister_and_unwatch(&registry, &watcher_pool, &id);
    }

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

/// Reads PTY output from the broadcast channel, applies CLI parser, emits
/// status updates. Also emits the raw output as `pty-output-{id}` and feeds
/// the native engine so TerminalCanvas can render the agent PTY.
async fn run_output_monitor(
    mut rx: broadcast::Receiver<Vec<u8>>,
    session_id: &str,
    cli: &AgentCli,
    app: &AppHandle,
    native_registry: Arc<NativeTerminalRegistry>,
    flush_alive: Arc<AtomicBool>,
) {
    let parser = output_monitor::create_parser(cli);
    let session_mgr = app.state::<InteractiveSessionManager>();
    let mut last_status = String::new();

    loop {
        match rx.recv().await {
            Ok(chunk) => {
                let data: &[u8] = &chunk;

                // Emit raw output as byte array (no base64 overhead)
                let event = format!("pty-output-{}", session_id);
                let _ = app.emit(&event, chunk.clone());

                // Fan out to native engine for grid-based rendering, plus
                // OSC 133 prompt marks. Diffs are 60fps-coalesced; prompt
                // marks are emitted immediately.
                let advance_result = native_registry.advance(session_id, data);
                if let Some(diff) = advance_result.diff {
                    let _ = app.emit(&format!("term:diff-{}", session_id), diff);
                }
                for mark in advance_result.new_marks {
                    let _ = app.emit(&format!("term:prompt-mark-{}", session_id), mark);
                }

                // Parse for status/cost (strip ANSI first)
                if let Ok(text) = std::str::from_utf8(data) {
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
            Err(broadcast::error::RecvError::Lagged(n)) => {
                // Missing a chunk means the CLI parser sees a discontinuity,
                // but status/cost detection is self-healing: the next chunk
                // will re-trigger detection. Logging is enough.
                log::warn!("ui: agent {} monitor lagged, dropped {} chunks", session_id, n);
                continue;
            }
            Err(broadcast::error::RecvError::Closed) => break,
        }
    }

    // Stop the flush ticker so the background thread can exit.
    flush_alive.store(false, Ordering::Release);

    // Process exited — update status
    let _ = session_mgr.update_status(session_id, "done");
    emit_interactive_sessions(app, &session_mgr);

    // Emit exit event
    let _ = app.emit(&format!("pty-exit-{}", session_id), ());
}

