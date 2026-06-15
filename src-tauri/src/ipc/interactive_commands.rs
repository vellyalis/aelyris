use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::broadcast;

use crate::agent::output_monitor;
use crate::agent::{AgentCli, InteractiveSessionInfo, InteractiveSessionManager};
use crate::ghostdiff::{self, LayerRegistry, LayerTint, WatcherPool};
use crate::pty::PtyManager;
use crate::pty_sidecar::PtySidecarState;
use crate::term::NativeTerminalRegistry;

#[derive(Debug, Serialize, Deserialize)]
pub struct SpawnResult {
    pub session_id: String,
    pub pty_id: String,
    pub worktree_path: Option<String>,
    pub backend: String,
}

fn persist_prompt_mark_exit_code(
    app: &AppHandle,
    terminal_id: &str,
    mark: &crate::term::PromptMark,
) {
    if let Some(journal) = app.try_state::<Arc<crate::term::CommandBlockJournal>>() {
        journal.record_prompt_mark(terminal_id, *mark);
    }
    if mark.kind != crate::term::PromptMarkKind::CommandEnd {
        return;
    }
    let Some(exit_code) = mark.exit_code else {
        return;
    };
    let Some(db) = app.try_state::<crate::db::ManagedDb>() else {
        return;
    };
    if let Err(err) = db.with(|d| {
        d.update_latest_command_exit_code(terminal_id, exit_code)
            .map(|_| ())
    }) {
        log::warn!(
            "interactive command history exit-code update failed terminal={terminal_id}: {err}"
        );
    }
}

/// Spawn an interactive AI agent in a PTY terminal.
/// Works with any CLI: claude, gemini, codex, or custom.
#[tauri::command]
pub async fn spawn_interactive_agent(
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

    // Cost gate (BR7): refuse a new agent when the live fleet is at the cap.
    let active_agents = app
        .state::<InteractiveSessionManager>()
        .list()
        .map(|sessions| sessions.len())
        .unwrap_or(0)
        + app
            .state::<crate::agent::AgentManager>()
            .list_sessions()
            .len();
    app.state::<std::sync::Arc<crate::cost::CostManager>>()
        .guard_spawn(active_agents)?;

    let (program, mut args) = cli.program_and_args(Some(model_str));

    // Validate branch_name if provided (prevent path traversal / shell injection)
    if let Some(ref branch) = branch_name {
        crate::git::validate_branch_name(branch)?;
    }

    // If branch_name is set, create a worktree and use it as cwd
    let (resolved_cwd, worktree_branch, worktree_path, repo_path) =
        if let Some(ref branch) = branch_name {
            let wt = crate::git::create_worktree(&cwd, branch)?;
            let wt_path = wt.path.clone();
            (
                wt_path.clone(),
                Some(branch.clone()),
                Some(wt_path),
                Some(cwd.clone()),
            )
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

    // Spawn through the long-lived sidecar when available. AI CLI sessions
    // exercise the same IME / clipboard / reconnect boundary as normal panes,
    // so keeping them on the daemon path is part of the product contract.
    let sidecar_client = app
        .try_state::<PtySidecarState>()
        .and_then(|state| state.client());
    let (pty_id, output_rx, backend) = if let Some(client) = sidecar_client {
        let pty_id = client
            .spawn_command(&program, &args, cols, rows, Some(&resolved_cwd), Some(&env))
            .await?;
        let output_rx = match client.subscribe_output(&pty_id).await {
            Ok(rx) => rx,
            Err(err) => {
                let _ = client.close(&pty_id).await;
                return Err(err);
            }
        };
        (pty_id, output_rx, "sidecar".to_string())
    } else {
        log::warn!(
            "interactive agent {} is using native in-process PTY fallback; sidecar unavailable",
            program
        );
        let pty_manager = app.state::<PtyManager>();
        let pty_id = pty_manager.spawn_command(
            &program,
            &args,
            cols,
            rows,
            Some(&resolved_cwd),
            Some(env),
        )?;
        let output_rx = pty_manager.subscribe_output(&pty_id)?;
        (pty_id, output_rx, "native".to_string())
    };

    // Register interactive session
    let session_id = pty_id.clone(); // session ID = pty ID for simplicity
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();

    let info = InteractiveSessionInfo {
        id: session_id.clone(),
        pty_id: pty_id.clone(),
        backend: backend.clone(),
        cli: cli.clone(),
        status: if initial_prompt.is_some() {
            "thinking".to_string()
        } else {
            "idle".to_string()
        },
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
                log::warn!(
                    "ghostdiff: orchestra register failed for {}: {e}",
                    session_id
                );
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
    let app_handle = app.clone();
    let sid = session_id.clone();
    let monitor_cli = cli.clone();
    let monitor_registry = native_registry.clone();
    let monitor_alive = flush_alive.clone();

    tauri::async_runtime::spawn(async move {
        run_output_monitor(
            output_rx,
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
        session_id,
        cli,
        model_str,
    );

    Ok(SpawnResult {
        session_id,
        pty_id,
        worktree_path,
        backend,
    })
}

/// Stop an interactive agent session
#[tauri::command]
pub async fn stop_interactive_agent(app: AppHandle, id: String) -> Result<(), String> {
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
    close_interactive_pty(&app, &pty_id).await;

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
pub async fn end_session_and_remove_worktree(app: AppHandle, id: String) -> Result<(), String> {
    let session_mgr = app.state::<InteractiveSessionManager>();

    // Get session info before removing
    let info = session_mgr.get(&id)?;
    session_mgr.update_status(&id, "done")?;

    // Close PTY (use pty_id from session info)
    let pty_id = info
        .as_ref()
        .map(|s| s.pty_id.clone())
        .unwrap_or_else(|| id.clone());
    close_interactive_pty(&app, &pty_id).await;

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
                emit_interactive_sessions(&app, &session_mgr);
                let message = format!("failed to remove worktree for session {}: {}", id, e);
                log::warn!("{}", message);
                return Err(message);
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
pub fn list_interactive_agents(app: AppHandle) -> Result<Vec<InteractiveSessionInfo>, String> {
    let session_mgr = app.state::<InteractiveSessionManager>();
    session_mgr.list()
}

// --- Internal helpers ---

async fn close_interactive_pty(app: &AppHandle, pty_id: &str) {
    if let Some(client) = app
        .try_state::<PtySidecarState>()
        .and_then(|state| state.client())
    {
        match client.close(pty_id).await {
            Ok(()) => return,
            Err(err) => {
                log::warn!(
                    "interactive agent sidecar close failed for {}: {}; trying native fallback",
                    pty_id,
                    err
                );
            }
        }
    }

    let pty_manager = app.state::<PtyManager>();
    let _ = pty_manager.close(pty_id);
}

fn emit_interactive_sessions(app: &AppHandle, mgr: &InteractiveSessionManager) {
    match mgr.list() {
        Ok(sessions) => {
            let _ = app.emit("interactive-sessions-updated", &sessions);
            super::emit_agent_fleet(app);
        }
        Err(err) => {
            log::error!("interactive sessions list failed: {}", err);
            let _ = app.emit("interactive-sessions-error", &err);
        }
    }
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
                    persist_prompt_mark_exit_code(app, session_id, &mark);
                    let _ = app.emit(&format!("term:prompt-mark-{}", session_id), mark);
                }

                // Parse for status/cost (strip ANSI first)
                if let Ok(text) = std::str::from_utf8(data) {
                    let clean = output_monitor::strip_ansi(text);
                    let result = parser.parse_chunk(&clean);

                    let mut changed = false;

                    if let Some(status) = result
                        .status
                        .as_ref()
                        .and_then(output_monitor::DetectedStatus::to_agent_run_status)
                    {
                        let status_str = status.as_str();
                        if status_str != last_status {
                            match session_mgr.update_status(session_id, status_str) {
                                Ok(()) => {
                                    last_status = status_str.to_string();
                                    changed = true;
                                }
                                Err(err) => {
                                    log::warn!(
                                        "interactive session status update skipped: {}",
                                        err
                                    );
                                }
                            }
                        }
                    }

                    if result.usage.cost.is_some() || result.usage.tokens.is_some() {
                        if let Ok(Some(current)) = session_mgr.get(session_id) {
                            let cost = result.usage.cost.unwrap_or(current.cost);
                            let tokens = result.usage.tokens.unwrap_or(current.tokens_used);
                            match session_mgr.update_usage(session_id, cost, tokens) {
                                Ok(()) => changed = true,
                                Err(err) => {
                                    log::warn!("interactive session usage update skipped: {}", err);
                                }
                            }
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
                log::warn!(
                    "ui: agent {} monitor lagged, dropped {} chunks",
                    session_id,
                    n
                );
                continue;
            }
            Err(broadcast::error::RecvError::Closed) => break,
        }
    }

    // Stop the flush ticker so the background thread can exit.
    flush_alive.store(false, Ordering::Release);

    // Process exited — update status
    if let Err(err) = session_mgr.update_status(session_id, "done") {
        log::warn!("interactive session final status update skipped: {}", err);
    }
    emit_interactive_sessions(app, &session_mgr);

    // Emit exit event
    let _ = app.emit(&format!("pty-exit-{}", session_id), ());
}
