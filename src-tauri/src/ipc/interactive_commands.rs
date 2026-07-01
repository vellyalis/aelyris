use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::broadcast;

use crate::agent::context_lifecycle::{
    parse_claude_context_remaining_from_grid, unix_now_secs, ContextRemaining,
};
use crate::agent::output_monitor;
use crate::agent::session_lifecycle::{
    build_summary_prompt, canonical_summary_files_for_checkpoint, next_summary_seq,
    parse_redacted_summary, read_redacted_summary, summary_files, wait_for_done_marker,
    SessionSummaryDoc, SummaryValidationContext, SummaryValidationReport,
};
use crate::agent::{AgentCli, InteractiveSessionInfo, InteractiveSessionManager};
use crate::ghostdiff::{self, LayerRegistry, LayerTint, WatcherPool};
use crate::persistence::{SessionCheckpointRecord, SessionCheckpointRepo};
use crate::pty::{ExitInfo, PtyManager};
use crate::pty_sidecar::{PtySidecarClient, PtySidecarState};
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
    // Count only LIVE interactive sessions — a lingering "done" one (e.g. a
    // crashed interactive CLI) is not occupying a slot and must not block spawns.
    let active_agents = app.state::<InteractiveSessionManager>().active_count()
        + app
            .state::<crate::agent::AgentManager>()
            .list_sessions()
            .len();
    app.state::<std::sync::Arc<crate::cost::CostManager>>()
        .guard_spawn(active_agents)?;

    // Resolve the agent's CLI command (program + args + env) from its model and
    // optional initial prompt. This launches the live INTERACTIVE claude TUI (no
    // headless `-p`), so the operator watches the agent work and can talk to it.
    // `false` = NOT autonomous: the human keeps the edit-approval gate (the
    // autonomy loop's *fleet* workers use `agent_shell_command_spec` with `true`).
    let (program, args, env) =
        crate::agent::interactive::agent_command_spec(model_str, initial_prompt.as_deref(), false)?;

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
        logical_session_id: session_id.clone(),
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
        approval_prompt: None,
        cwd: resolved_cwd,
        worktree_branch: worktree_branch.clone(),
        worktree_path: worktree_path.clone(),
        repo_path: repo_path.clone(),
        cost: 0.0,
        tokens_used: 0,
        started_at: now,
        last_activity: now,
        turn_count: 0,
        context_remaining: Some(ContextRemaining::unknown_proxy(&cli, now)),
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

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionSummarizeResult {
    pub session_id: String,
    pub logical_session_id: String,
    pub handoff_seq: u64,
    pub summary_path: String,
    pub done_path: String,
    pub redaction_count: usize,
    pub validation: SummaryValidationReport,
    pub summary: SessionSummaryDoc,
}

#[tauri::command]
pub async fn session_summarize(
    app: AppHandle,
    session_id: String,
    reason: Option<String>,
    timeout_ms: Option<u64>,
) -> Result<SessionSummarizeResult, String> {
    let session_mgr = app.state::<InteractiveSessionManager>();
    let info = find_interactive_session(&session_mgr, &session_id)?;
    if info.status != "idle" {
        return Err(format!(
            "session_summarize requires an idle session; {} is {}",
            info.id, info.status
        ));
    }

    let worktree_path = info.worktree_path.as_deref().unwrap_or(&info.cwd);
    let dir = crate::agent::session_lifecycle::handoff_dir(worktree_path);
    std::fs::create_dir_all(&dir)
        .map_err(|err| format!("create handoff directory failed: {err}"))?;
    let seq = next_summary_seq(&dir, &info.logical_session_id);
    let files = summary_files(worktree_path, &info.logical_session_id, seq);
    let reason = reason.unwrap_or_else(|| "manual".to_string());
    let prompt = build_summary_prompt(&info.logical_session_id, seq, &files, &reason);

    session_mgr.update_status(&info.id, "summarizing")?;
    emit_interactive_sessions(&app, &session_mgr);

    let request = format!("{}\r\n", prompt);
    if let Err(err) = write_interactive_input(&app, &info, request.as_bytes()).await {
        let _ = session_mgr.update_status(&info.id, "blocked");
        emit_interactive_sessions(&app, &session_mgr);
        return Err(format!("session_summarize prompt injection failed: {err}"));
    }

    let timeout =
        std::time::Duration::from_millis(timeout_ms.unwrap_or(60_000).clamp(1_000, 600_000));
    if let Err(err) = wait_for_done_marker(&files.done_path, timeout).await {
        let _ = session_mgr.update_status(&info.id, "blocked");
        emit_interactive_sessions(&app, &session_mgr);
        return Err(err);
    }

    let context = build_summary_validation_context(&app, &info);
    let (redacted, validation) = match read_redacted_summary(&files, &context) {
        Ok(result) => result,
        Err(err) => {
            let _ = session_mgr.update_status(&info.id, "blocked");
            emit_interactive_sessions(&app, &session_mgr);
            return Err(err);
        }
    };

    session_mgr.update_status(&info.id, "idle")?;
    emit_interactive_sessions(&app, &session_mgr);

    Ok(SessionSummarizeResult {
        session_id: info.id,
        logical_session_id: info.logical_session_id,
        handoff_seq: seq,
        summary_path: files.summary_path.display().to_string(),
        done_path: files.done_path.display().to_string(),
        redaction_count: redacted.redaction_count,
        validation,
        summary: redacted.summary,
    })
}
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionCheckpointResult {
    pub session_id: String,
    pub logical_session_id: String,
    pub checkpoint_seq: u64,
    pub summary_path: Option<String>,
    pub inflight_ref: Option<String>,
    pub redaction_count: usize,
    pub identity_context_persisted: bool,
    pub checkpoint: SessionCheckpointRecord,
}

#[tauri::command]
pub fn session_checkpoint(
    app: AppHandle,
    session_id: String,
    summary_json: Option<Value>,
    summary_seq: Option<u64>,
    inflight_ref: Option<String>,
    predecessor_session_id: Option<String>,
) -> Result<SessionCheckpointResult, String> {
    let session_mgr = app.state::<InteractiveSessionManager>();
    let info = find_interactive_session(&session_mgr, &session_id)?;
    let summary = checkpoint_summary_from_inputs(&app, &info, summary_json, summary_seq)?;
    let db = app
        .try_state::<crate::db::ManagedDb>()
        .ok_or_else(|| "session_checkpoint requires database state".to_string())?;
    let checkpoint_seq =
        db.with(|d| SessionCheckpointRepo::next_checkpoint_seq(d, &info.logical_session_id))?;
    let now = unix_now_secs();
    let record = SessionCheckpointRecord {
        logical_session_id: info.logical_session_id.clone(),
        checkpoint_seq,
        pty_id: info.pty_id.clone(),
        cli: agent_cli_label(&info.cli).to_string(),
        model: info.model.clone(),
        cwd: info.cwd.clone(),
        worktree_branch: info.worktree_branch.clone(),
        worktree_path: info.worktree_path.clone(),
        repo_path: info.repo_path.clone(),
        status: info.status.clone(),
        cost: info.cost,
        tokens_used: info.tokens_used,
        started_at: info.started_at,
        last_activity: info.last_activity,
        turn_count: info.turn_count,
        context_remaining: info.context_remaining.clone(),
        summary_json: summary.summary_json.clone(),
        summary_path: summary.summary_path.clone(),
        inflight_ref: inflight_ref.or(summary.inflight_ref),
        predecessor_session_id,
        created_at: now,
        updated_at: now,
    };
    let checkpoint = db.with(|d| SessionCheckpointRepo::upsert_checkpoint(d, &record))?;
    let identity_context_persisted = persist_agent_identity_context(&app, &info, &checkpoint);
    Ok(SessionCheckpointResult {
        session_id: info.id,
        logical_session_id: checkpoint.logical_session_id.clone(),
        checkpoint_seq: checkpoint.checkpoint_seq,
        summary_path: checkpoint.summary_path.clone(),
        inflight_ref: checkpoint.inflight_ref.clone(),
        redaction_count: summary.redaction_count,
        identity_context_persisted,
        checkpoint,
    })
}

pub async fn restore_interactive_sessions(
    app: &AppHandle,
    sidecar: PtySidecarClient,
) -> Result<usize, String> {
    let Some(db) = app.try_state::<crate::db::ManagedDb>() else {
        return Ok(0);
    };
    let checkpoints = db.with(SessionCheckpointRepo::load_latest_all)?;
    if checkpoints.is_empty() {
        return Ok(0);
    }
    let live = sidecar.list_info().await?;
    let live_ids: std::collections::HashSet<String> =
        live.into_iter().map(|info| info.id).collect();
    let session_mgr = app.state::<InteractiveSessionManager>();
    let native_registry = app.state::<Arc<NativeTerminalRegistry>>().inner().clone();
    let mut restored = 0usize;

    for checkpoint in checkpoints {
        if checkpoint.status == "done" || !live_ids.contains(&checkpoint.pty_id) {
            continue;
        }
        if session_mgr.get(&checkpoint.pty_id)?.is_some() {
            continue;
        }
        let cli = agent_cli_from_label(&checkpoint.cli);
        let info = InteractiveSessionInfo {
            id: checkpoint.pty_id.clone(),
            logical_session_id: checkpoint.logical_session_id.clone(),
            pty_id: checkpoint.pty_id.clone(),
            backend: "sidecar".to_string(),
            cli: cli.clone(),
            status: checkpoint.status.clone(),
            model: checkpoint.model.clone(),
            initial_prompt: None,
            approval_prompt: None,
            cwd: checkpoint.cwd.clone(),
            worktree_branch: checkpoint.worktree_branch.clone(),
            worktree_path: checkpoint.worktree_path.clone(),
            repo_path: checkpoint.repo_path.clone(),
            cost: checkpoint.cost,
            tokens_used: checkpoint.tokens_used,
            started_at: checkpoint.started_at,
            last_activity: checkpoint.last_activity,
            turn_count: checkpoint.turn_count,
            context_remaining: checkpoint.context_remaining.clone(),
        };
        session_mgr.register(info)?;
        if let Err(err) = native_registry.create(&checkpoint.pty_id, 120, 30) {
            log::debug!(
                "restore_interactive_sessions native create skipped for {}: {}",
                checkpoint.pty_id,
                err
            );
        }
        // `adopt_sidecar_terminals` already wires the surviving sidecar PTY to
        // the native renderer and output buffers. Re-subscribing here would
        // double-render and double-parse every byte; RT-1c only restores the
        // interactive session/status metadata over that adopted stream.
        restored = restored.saturating_add(1);
    }

    if restored > 0 {
        emit_interactive_sessions(app, &session_mgr);
    }
    Ok(restored)
}

struct CheckpointSummaryInput {
    summary_json: Option<Value>,
    summary_path: Option<String>,
    inflight_ref: Option<String>,
    redaction_count: usize,
}

fn checkpoint_summary_from_inputs(
    app: &AppHandle,
    info: &InteractiveSessionInfo,
    summary_json: Option<Value>,
    summary_seq: Option<u64>,
) -> Result<CheckpointSummaryInput, String> {
    if summary_json.is_some() && summary_seq.is_some() {
        return Err(
            "session_checkpoint accepts either summary_json or summary_seq, not both".to_string(),
        );
    }
    let Some(raw) = summary_json
        .map(|value| serde_json::to_string(&value))
        .transpose()
        .map_err(|err| format!("serialize checkpoint summary_json failed: {err}"))?
        .or_else(|| None)
    else {
        if let Some(seq) = summary_seq {
            return checkpoint_summary_from_backend_file(app, info, seq);
        }
        return Ok(CheckpointSummaryInput {
            summary_json: None,
            summary_path: None,
            inflight_ref: None,
            redaction_count: 0,
        });
    };
    checkpoint_summary_from_raw(app, info, raw, None)
}

fn checkpoint_summary_from_backend_file(
    app: &AppHandle,
    info: &InteractiveSessionInfo,
    seq: u64,
) -> Result<CheckpointSummaryInput, String> {
    let worktree_path = info.worktree_path.as_deref().unwrap_or(&info.cwd);
    let files =
        canonical_summary_files_for_checkpoint(worktree_path, &info.logical_session_id, seq)?;
    let summary_path = files.summary_path.display().to_string();
    let context = build_summary_validation_context(app, info);
    let (redacted, _validation) = read_redacted_summary(&files, &context)?;
    let inflight_ref = redacted.summary.in_flight_diff.r#ref.clone();
    Ok(CheckpointSummaryInput {
        summary_json: Some(redacted.summary_json),
        summary_path: Some(summary_path),
        inflight_ref,
        redaction_count: redacted.redaction_count,
    })
}

fn checkpoint_summary_from_raw(
    app: &AppHandle,
    info: &InteractiveSessionInfo,
    raw: String,
    summary_path: Option<String>,
) -> Result<CheckpointSummaryInput, String> {
    let context = build_summary_validation_context(app, info);
    let (redacted, _validation) = parse_redacted_summary(&raw, &context)?;
    let inflight_ref = redacted.summary.in_flight_diff.r#ref.clone();
    Ok(CheckpointSummaryInput {
        summary_json: Some(redacted.summary_json),
        summary_path,
        inflight_ref,
        redaction_count: redacted.redaction_count,
    })
}

fn persist_agent_identity_context(
    app: &AppHandle,
    info: &InteractiveSessionInfo,
    checkpoint: &SessionCheckpointRecord,
) -> bool {
    let Some(db) = app.try_state::<crate::db::ManagedDb>() else {
        return false;
    };
    let context_usage_json = serde_json::json!({
        "schema": "aelyris.context_usage.v1",
        "source": "session_checkpoint",
        "logicalSessionId": &checkpoint.logical_session_id,
        "ptyId": &checkpoint.pty_id,
        "checkpointSeq": checkpoint.checkpoint_seq,
        "status": &checkpoint.status,
        "turnCount": checkpoint.turn_count,
        "lastActivity": checkpoint.last_activity,
        "contextRemaining": &checkpoint.context_remaining,
        "updatedAt": checkpoint.updated_at,
    });
    let record = crate::db::AgentIdentityRecord {
        session_id: checkpoint.logical_session_id.clone(),
        workspace_id: "runtime-visible-agent".to_string(),
        provider: agent_cli_label(&info.cli).to_string(),
        purpose: "visible_agent".to_string(),
        worktree_path: info
            .worktree_path
            .clone()
            .or_else(|| Some(info.cwd.clone())),
        context_usage_json,
        auth_state: "unknown".to_string(),
        install_state: "runtime".to_string(),
        binary_source: "visible_pty".to_string(),
        profile_source: "runtime".to_string(),
        usage_limits_json: serde_json::json!({}),
        guardrail_profile: "runtime_core".to_string(),
        updated_at: String::new(),
    };
    match db.with(|d| d.upsert_agent_identity(&record).map(|_| ())) {
        Ok(()) => true,
        Err(err) => {
            log::warn!(
                "session_checkpoint context_usage_json persistence failed for {}: {}",
                checkpoint.logical_session_id,
                err
            );
            false
        }
    }
}

fn agent_cli_label(cli: &AgentCli) -> &str {
    match cli {
        AgentCli::Claude => "claude",
        AgentCli::Gemini => "gemini",
        AgentCli::Codex => "codex",
        AgentCli::Custom(_) => "custom",
    }
}

fn agent_cli_from_label(value: &str) -> AgentCli {
    match value.to_ascii_lowercase().as_str() {
        "claude" => AgentCli::Claude,
        "gemini" => AgentCli::Gemini,
        "codex" => AgentCli::Codex,
        other if other.starts_with("custom:") => AgentCli::Custom(other[7..].to_string()),
        other => AgentCli::Custom(other.to_string()),
    }
}
/// List all interactive sessions
#[tauri::command]
pub fn list_interactive_agents(app: AppHandle) -> Result<Vec<InteractiveSessionInfo>, String> {
    let session_mgr = app.state::<InteractiveSessionManager>();
    session_mgr.list()
}

// --- Internal helpers ---

fn find_interactive_session(
    session_mgr: &InteractiveSessionManager,
    id_or_logical_id: &str,
) -> Result<InteractiveSessionInfo, String> {
    if let Some(info) = session_mgr.get(id_or_logical_id)? {
        return Ok(info);
    }
    session_mgr
        .list()?
        .into_iter()
        .find(|info| info.logical_session_id == id_or_logical_id)
        .ok_or_else(|| format!("interactive session not found: {id_or_logical_id}"))
}

async fn write_interactive_input(
    app: &AppHandle,
    info: &InteractiveSessionInfo,
    data: &[u8],
) -> Result<(), String> {
    if let Some(client) = app
        .try_state::<PtySidecarState>()
        .and_then(|state| state.client())
    {
        return client.write(&info.pty_id, data).await;
    }
    app.state::<PtyManager>().write(&info.pty_id, data)
}

fn build_summary_validation_context(
    app: &AppHandle,
    info: &InteractiveSessionInfo,
) -> SummaryValidationContext {
    let repo_path = info
        .repo_path
        .as_deref()
        .or(info.worktree_path.as_deref())
        .unwrap_or(&info.cwd);
    let git_status = crate::git::git_status(repo_path).ok();
    let tasks = app
        .try_state::<Arc<crate::task::TaskManager>>()
        .map(|manager| manager.list())
        .unwrap_or_default();
    let decisions = app
        .try_state::<Arc<crate::context_store::ContextStoreManager>>()
        .map(|manager| manager.all())
        .unwrap_or_default();
    SummaryValidationContext {
        git_status,
        tasks,
        decisions,
    }
}

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

/// Feed one PTY output chunk into the native terminal engine for `id` and emit
/// the resulting grid diff + any OSC 133 prompt marks. Shared by the interactive
/// agent monitor and the autonomy loop's visible-pane renderer so both render a
/// PTY through the same engine path (`term:diff-{id}` + `term:prompt-mark-{id}`).
fn emit_native_advance(
    app: &AppHandle,
    native_registry: &NativeTerminalRegistry,
    id: &str,
    data: &[u8],
) {
    let advance_result = native_registry.advance(id, data);
    if let Some(diff) = advance_result.diff {
        let _ = app.emit(&format!("term:diff-{}", id), diff);
    }
    for mark in advance_result.new_marks {
        persist_prompt_mark_exit_code(app, id, &mark);
        let _ = app.emit(&format!("term:prompt-mark-{}", id), mark);
    }
}

/// Connect an autonomy-loop-dispatched agent terminal (Face 1) to the frontend
/// so the cockpit's fleet grid can mount it as a live pane. The loop spawns the
/// PTY through `PaneFleet`; this wires that terminal exactly like an interactive
/// agent — a native engine session + a render monitor emitting `term:diff-{id}`
/// and `pty-exit-{id}`. Unlike `run_output_monitor` it does not parse status/cost
/// or touch the interactive session manager (a loop pane is owned by the loop,
/// not the interactive fleet); it is purely the render bridge.
pub(crate) fn spawn_loop_pane_render(
    app: &AppHandle,
    pty: &PtyManager,
    native_registry: Arc<NativeTerminalRegistry>,
    terminal_id: String,
    cols: u16,
    rows: u16,
) {
    if let Err(e) = native_registry.create(&terminal_id, cols, rows) {
        log::warn!("native engine create failed for loop pane {terminal_id}: {e}");
    }
    let rx = match pty.subscribe_output(&terminal_id) {
        Ok(rx) => rx,
        Err(err) => {
            log::warn!("loop pane {terminal_id} output subscribe failed: {err}");
            // Don't leak the engine session we just created; nothing will render.
            native_registry.remove(&terminal_id);
            return;
        }
    };

    // Per-PTY flush ticker (matches the interactive pipeline) so the last
    // unsettled diff isn't stuck inside the coalesce window.
    let flush_alive = Arc::new(AtomicBool::new(true));
    {
        let alive = flush_alive.clone();
        let flush_registry = native_registry.clone();
        let flush_handle = app.clone();
        let flush_id = terminal_id.clone();
        std::thread::spawn(move || {
            while alive.load(Ordering::Acquire) {
                std::thread::sleep(std::time::Duration::from_millis(33));
                if let Some(diff) = flush_registry.flush(&flush_id) {
                    let _ = flush_handle.emit(&format!("term:diff-{}", flush_id), diff);
                }
            }
        });
    }

    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        run_loop_pane_monitor(rx, &terminal_id, &app_handle, native_registry, flush_alive).await;
    });
}

/// Render-only monitor for a loop pane: pumps PTY output into the native engine
/// (grid diffs + prompt marks), mirrors raw bytes as `pty-output-{id}`, and on
/// exit emits `pty-exit-{id}` and tears down the engine session. The loop's own
/// `PaneFleet` waiter owns completion/recovery — this only drives the picture.
async fn run_loop_pane_monitor(
    mut rx: broadcast::Receiver<Vec<u8>>,
    terminal_id: &str,
    app: &AppHandle,
    native_registry: Arc<NativeTerminalRegistry>,
    flush_alive: Arc<AtomicBool>,
) {
    loop {
        match rx.recv().await {
            Ok(chunk) => {
                let _ = app.emit(&format!("pty-output-{}", terminal_id), chunk.clone());
                emit_native_advance(app, &native_registry, terminal_id, &chunk);
            }
            Err(broadcast::error::RecvError::Lagged(n)) => {
                log::warn!(
                    "loop pane {} monitor lagged, dropped {} chunks",
                    terminal_id,
                    n
                );
                continue;
            }
            Err(broadcast::error::RecvError::Closed) => break,
        }
    }
    flush_alive.store(false, Ordering::Release);
    native_registry.remove(terminal_id);
    // We reach here when the broadcast channel closes, which happens once BOTH
    // the instance's `output_tx` (dropped when `PaneFleet::poll_completions`
    // reaps the pane via close/remove_exited) AND the reader thread's cloned
    // sender are gone — so this is the authoritative "the fleet pane ended"
    // signal for the frontend (it may lag the reap until the reader exits, but
    // it is not lost). Emit a real
    // `ExitInfo` payload, NOT `()`: the renderer's `pty-exit` handler does
    // `setExitInfo(payload)`, and a null payload would CLEAR the exit state
    // instead of setting it — leaving the dead pane mounted and re-firing resize
    // against a gone PTY (the 404 "Terminal degraded" spam). `code: None,
    // crashed: false` = a quiet "exited" banner (the loop owns real
    // success/failure via task status; this only stops the resize loop and shows
    // the pane as done).
    let _ = app.emit(
        &format!("pty-exit-{}", terminal_id),
        ExitInfo {
            code: None,
            crashed: false,
        },
    );
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
                emit_native_advance(app, &native_registry, session_id, data);

                // Parse for status/cost (strip ANSI first)
                if let Ok(text) = std::str::from_utf8(data) {
                    let clean = output_monitor::strip_ansi(text);
                    let result = parser.parse_chunk(&clean);

                    let mut changed = false;
                    if matches!(cli, &AgentCli::Claude) {
                        if let Some(snapshot) = native_registry.snapshot(session_id) {
                            if let Some(context_remaining) =
                                parse_claude_context_remaining_from_grid(&snapshot, unix_now_secs())
                            {
                                match session_mgr
                                    .update_context_remaining(session_id, context_remaining)
                                {
                                    Ok(()) => changed = true,
                                    Err(err) => {
                                        log::warn!(
                                            "interactive context remaining update skipped: {}",
                                            err
                                        );
                                    }
                                }
                            }
                        }
                    }

                    if let Some(detected) = result.status.as_ref() {
                        if let Some(status) = detected.to_agent_run_status() {
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
                            // Carry the captured permission menu so the Decision
                            // Inbox shows WHAT is being approved (P2-A) and only
                            // marks real menus resolvable (P2-B). `update_status`
                            // above already cleared it on any non-waiting status,
                            // so it is only ever SET here, on the gate itself.
                            if *detected == output_monitor::DetectedStatus::WaitingPermission {
                                if let Some(prompt) = result.approval_prompt.clone() {
                                    match session_mgr.set_approval_prompt(session_id, Some(prompt))
                                    {
                                        Ok(true) => changed = true,
                                        Ok(false) => {}
                                        Err(err) => {
                                            log::warn!(
                                                "interactive approval prompt update skipped: {}",
                                                err
                                            );
                                        }
                                    }
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

    // Emit exit event with a real `ExitInfo` payload (not `()`): the renderer's
    // `pty-exit` handler stores the payload via `setExitInfo`, and a null payload
    // would clear the exit state rather than set it. Same contract as the loop
    // pane monitor above — every `pty-exit-<id>` carries `{ code, crashed }`.
    let _ = app.emit(
        &format!("pty-exit-{}", session_id),
        ExitInfo {
            code: None,
            crashed: false,
        },
    );
}
