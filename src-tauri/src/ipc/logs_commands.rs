//! IPC surface for the in-app structured log viewer (Tier 🟡 #7).
//!
//! Two read-only commands. Both pull from the global `LogRing`
//! installed by `logging::init`; neither emits events, so they are
//! safe to call from a polling loop in the frontend without back-
//! pressuring the rest of the IPC channel.

use tauri::State;

use crate::logging::{LogEntry, LogRing};

/// Default fetch size for the initial load — covers a screenful at
/// reasonable text density without sending the whole ring.
const DEFAULT_RECENT: usize = 200;
/// Hard cap regardless of caller-supplied value, so a buggy frontend
/// cannot drag the entire 1024-entry buffer over the IPC channel
/// every tick.
const MAX_LIMIT: usize = 1024;

#[tauri::command]
pub fn logs_recent(limit: Option<usize>, ring: State<'_, LogRing>) -> Vec<LogEntry> {
    let n = limit.unwrap_or(DEFAULT_RECENT).min(MAX_LIMIT);
    ring.recent(n)
}

#[tauri::command]
pub fn logs_since(after_seq: u64, limit: Option<usize>, ring: State<'_, LogRing>) -> Vec<LogEntry> {
    let n = limit.unwrap_or(MAX_LIMIT).min(MAX_LIMIT);
    ring.since(after_seq, n)
}
