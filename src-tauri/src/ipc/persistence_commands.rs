//! Agent-session, command-history, and audit persistence IPC commands,
//! extracted from `commands.rs`. Pure module move — no behavior change.
use tauri::{AppHandle, Manager};

use std::sync::{Arc, Mutex};

use super::commands::persist_command_block;

// ── Agent session persistence ──

/// Save agent session to database for persistence across restarts
#[tauri::command]
pub fn save_agent_to_db(
    app: AppHandle,
    id: String,
    model: String,
    prompt: String,
    status: String,
    cost: f64,
    tokens_used: u64,
) -> Result<(), String> {
    let db = app.state::<crate::db::ManagedDb>();
    db.with(|d| d.save_agent_session(&id, &model, &prompt, &status, cost, tokens_used))
}

/// Update agent session in database
#[tauri::command]
pub fn update_agent_in_db(
    app: AppHandle,
    id: String,
    status: String,
    cost: f64,
    tokens_used: u64,
) -> Result<(), String> {
    let db = app.state::<crate::db::ManagedDb>();
    db.with(|d| d.update_agent_session(&id, &status, cost, tokens_used))
}

/// List recent agent sessions from database
#[tauri::command]
pub fn list_agent_history(
    app: AppHandle,
    limit: usize,
) -> Result<Vec<crate::db::AgentSessionRecord>, String> {
    let db = app.state::<crate::db::ManagedDb>();
    db.with(|d| d.list_agent_sessions(limit))
}

#[tauri::command]
pub fn save_agent_telemetry_snapshot(app: AppHandle, snapshot_json: String) -> Result<(), String> {
    let db = app.state::<crate::db::ManagedDb>();
    db.with(|d| d.save_agent_telemetry_snapshot(&snapshot_json))
}

#[tauri::command]
pub fn list_agent_telemetry_snapshots(
    app: AppHandle,
    limit: usize,
) -> Result<Vec<crate::db::AgentTelemetrySnapshotRecord>, String> {
    let db = app.state::<crate::db::ManagedDb>();
    db.with(|d| d.list_agent_telemetry_snapshots(limit))
}

// ── Command History ──

/// Save a command to history (DB) and feed the in-memory SuggestEngine
/// so fish-style autosuggest picks up the new command on the very next
/// keystroke without waiting for a DB reseed.
///
/// Also kicks off a best-effort semantic-index insert on a detached thread
/// (Phase 3B-2) — we deliberately avoid blocking the PTY reader on the
/// embedding round-trip even though the default embedder is fast.
#[tauri::command]
pub fn save_command_history(
    app: AppHandle,
    terminal_id: String,
    command: String,
    cwd: String,
) -> Result<i64, String> {
    let cwd = normalize_command_history_cwd(&cwd);
    if let Some(journal) = app.try_state::<Arc<crate::term::CommandBlockJournal>>() {
        if let Some(existing_id) = journal.open_command_history_id(&terminal_id, &command, &cwd) {
            return Ok(existing_id);
        }
    }
    let db = app.state::<crate::db::ManagedDb>();
    let command_id = db.with(|d| d.save_command(&terminal_id, &command, &cwd))?;
    if let Some(journal) = app.try_state::<Arc<crate::term::CommandBlockJournal>>() {
        if let Some(record) = journal.record_command(&terminal_id, command_id, &command, &cwd) {
            persist_command_block(&app, &record);
        }
    }
    if let Some(engine) = app.try_state::<Arc<Mutex<crate::suggest::SuggestEngine>>>() {
        if let Ok(mut guard) = engine.inner().lock() {
            guard.record(&command);
        }
    }
    // Semantic index. Keep this best-effort and off the PTY hot path.
    if let Some(store) = app.try_state::<crate::ManagedHistoryStore>() {
        let store = store.inner().clone();
        let cmd = command.clone();
        std::thread::Builder::new()
            .name("history-index".into())
            .spawn(move || {
                if let Err(e) = store.index_command(command_id, &cmd) {
                    log::warn!("history index failed (id {command_id}): {e}");
                }
            })
            .ok();
    }
    Ok(command_id)
}

pub(crate) fn normalize_command_history_cwd(cwd: &str) -> String {
    let normalized = cwd.trim().replace('\\', "/");
    let normalized = normalized.trim_end_matches('/');
    if normalized.is_empty() {
        ".".to_string()
    } else if normalized.len() == 2 && normalized.ends_with(':') {
        format!("{normalized}/")
    } else {
        normalized.to_string()
    }
}

/// Search command history
#[tauri::command]
pub fn search_command_history(
    app: AppHandle,
    query: String,
    limit: usize,
) -> Result<Vec<crate::db::CommandRecord>, String> {
    let db = app.state::<crate::db::ManagedDb>();
    db.with(|d| d.search_commands(&query, limit))
}

/// Get recent unique commands
#[tauri::command]
pub fn recent_commands(app: AppHandle, limit: usize) -> Result<Vec<String>, String> {
    let db = app.state::<crate::db::ManagedDb>();
    db.with(|d| d.recent_commands(limit))
}

/// Read the latest operational audit events. This intentionally exposes
/// metadata only after the write-side callers have redacted raw terminal
/// input, so UI panels can inspect failures without leaking prompts.
#[tauri::command]
pub fn recent_audit_events(
    app: AppHandle,
    limit: usize,
    category: Option<String>,
    severity: Option<String>,
    entity_id: Option<String>,
) -> Result<Vec<crate::db::AuditEventRecord>, String> {
    let db = app.state::<crate::db::ManagedDb>();
    db.with(|d| {
        d.query_audit_events(
            limit,
            category.as_deref(),
            severity.as_deref(),
            entity_id.as_deref(),
        )
    })
}

#[tauri::command]
pub fn append_audit_event(
    app: AppHandle,
    event: crate::db::AuditJournalAppend,
) -> Result<crate::db::AuditJournalEventRecord, String> {
    crate::audit::append_audit_event_and_emit(&app, event)
}

#[tauri::command]
pub fn append_audit_events(
    app: AppHandle,
    events: Vec<crate::db::AuditJournalAppend>,
) -> Result<Vec<crate::db::AuditJournalEventRecord>, String> {
    crate::audit::append_audit_events_and_emit(&app, events)
}

#[tauri::command]
pub fn list_audit_events(
    app: AppHandle,
    filter: crate::db::AuditJournalFilter,
) -> Result<Vec<crate::db::AuditJournalEventRecord>, String> {
    let db = app.state::<crate::db::ManagedDb>();
    db.with(|d| d.list_audit_journal_events(&filter))
}

#[tauri::command]
pub fn get_audit_trace(
    app: AppHandle,
    correlation_id: String,
    workspace_id: Option<String>,
) -> Result<Vec<crate::db::AuditJournalEventRecord>, String> {
    let db = app.state::<crate::db::ManagedDb>();
    db.with(|d| d.get_audit_trace(&correlation_id, workspace_id.as_deref()))
}

#[tauri::command]
pub fn get_latest_snapshot(
    app: AppHandle,
    workspace_id: String,
) -> Result<crate::db::AuditJournalSnapshotRecord, String> {
    let db = app.state::<crate::db::ManagedDb>();
    db.with(|d| d.get_latest_audit_snapshot(&workspace_id))
}

#[tauri::command]
pub fn rebuild_snapshot_from_events(
    app: AppHandle,
    workspace_id: String,
) -> Result<crate::db::AuditJournalSnapshotRecord, String> {
    let db = app.state::<crate::db::ManagedDb>();
    db.with(|d| d.rebuild_audit_snapshot_from_events(&workspace_id))
}

#[tauri::command]
pub fn compact_event_journal(
    app: AppHandle,
    workspace_id: String,
    before_sequence: i64,
) -> Result<crate::db::AuditJournalCompactResult, String> {
    let db = app.state::<crate::db::ManagedDb>();
    db.with(|d| d.compact_audit_event_journal(&workspace_id, before_sequence))
}
