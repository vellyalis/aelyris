//! Phase 3C-3a — IPC for the terminal snapshot store.
//!
//! The frontend TimelineBar calls `list_snapshots` for its session and
//! fetches full grid state via `get_snapshot` when the user scrubs to a
//! point. `mark_snapshot` is the "capture now" bookmark that doesn't require
//! an Enter — useful when the user wants to pin a state before running a
//! risky command.

use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::snapshot::{
    SnapshotStore, SnapshotSummary, SnapshotTrigger, TerminalSnapshot,
};
use crate::term::NativeTerminalRegistry;

/// Wire-level summary used by the timeline list endpoint. Mirrors
/// `SnapshotSummary` — re-exported through this module so frontend types stay
/// under a single generated file.
pub type SnapshotSummaryDto = SnapshotSummary;

/// Return all snapshots for `session_id`, oldest-to-newest.
#[tauri::command]
pub fn list_snapshots(
    app: AppHandle,
    session_id: String,
) -> Vec<SnapshotSummaryDto> {
    let Some(store) = app.try_state::<Arc<SnapshotStore>>() else {
        return Vec::new();
    };
    store.inner().list(&session_id)
}

/// Fetch the full snapshot (including grid cells) by id. Returns `None` when
/// the id is unknown or has been evicted from its ring buffer.
#[tauri::command]
pub fn get_snapshot(
    app: AppHandle,
    snapshot_id: String,
) -> Option<TerminalSnapshot> {
    let store = app.try_state::<Arc<SnapshotStore>>()?;
    store.inner().get(&snapshot_id)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MarkSnapshotArgs {
    pub session_id: String,
    #[serde(default)]
    pub label: Option<String>,
}

/// Explicitly capture a snapshot for `session_id` regardless of Enter — the
/// "bookmark now" entry point. Returns the summary of the new snapshot so
/// the UI can scroll the timeline to it.
#[tauri::command]
pub fn mark_snapshot(
    app: AppHandle,
    args: MarkSnapshotArgs,
) -> Result<SnapshotSummaryDto, String> {
    let native_registry = app
        .try_state::<Arc<NativeTerminalRegistry>>()
        .ok_or_else(|| "native terminal registry missing".to_string())?;
    let store = app
        .try_state::<Arc<SnapshotStore>>()
        .ok_or_else(|| "snapshot store missing".to_string())?;

    let grid = native_registry
        .inner()
        .snapshot(&args.session_id)
        .ok_or_else(|| format!("no terminal session {}", args.session_id))?;

    let captured_at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);

    let snap = TerminalSnapshot {
        id: crate::snapshot::SnapshotId::new(),
        session_id: args.session_id.clone(),
        captured_at,
        trigger: SnapshotTrigger::UserMarked { label: args.label },
        grid,
    };

    store.inner().push(snap.clone());
    Ok(SnapshotSummary::from_snapshot(&snap))
}
