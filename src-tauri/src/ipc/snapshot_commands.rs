//! Phase 3C-3a — IPC for the terminal snapshot store.
//!
//! The frontend TimelineBar calls `list_snapshots` for its session and
//! fetches full grid state via `get_snapshot` when the user scrubs to a
//! point. `mark_snapshot` is the "capture now" bookmark that doesn't require
//! an Enter — useful when the user wants to pin a state before running a
//! risky command.

use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::ghostdiff::{LayerRegistry, LayerSummary, LayerTint};
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

/// Max bytes for a user-supplied mark label. Anything longer is truncated
/// at the UTF-8 boundary so we don't let a single mark balloon every
/// subsequent `list_snapshots` payload.
const MAX_LABEL_LEN: usize = 256;

fn sanitize_label(raw: Option<String>) -> Option<String> {
    let s = raw?;
    if s.is_empty() {
        return None;
    }
    if s.len() <= MAX_LABEL_LEN {
        return Some(s);
    }
    // Truncate without splitting a multi-byte char.
    let mut end = MAX_LABEL_LEN;
    while end > 0 && !s.is_char_boundary(end) {
        end -= 1;
    }
    Some(s[..end].to_string())
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
        trigger: SnapshotTrigger::UserMarked {
            label: sanitize_label(args.label),
        },
        grid,
    };

    store.inner().push(snap.clone());
    Ok(SnapshotSummary::from_snapshot(&snap))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitize_label_passes_short_strings() {
        assert_eq!(sanitize_label(Some("hi".into())).as_deref(), Some("hi"));
    }

    #[test]
    fn sanitize_label_empty_becomes_none() {
        assert!(sanitize_label(Some(String::new())).is_none());
    }

    #[test]
    fn sanitize_label_none_stays_none() {
        assert!(sanitize_label(None).is_none());
    }

    #[test]
    fn sanitize_label_truncates_at_max() {
        let long = "x".repeat(MAX_LABEL_LEN + 10);
        let out = sanitize_label(Some(long)).expect("some");
        assert_eq!(out.len(), MAX_LABEL_LEN);
    }

    #[test]
    fn sanitize_label_truncates_on_char_boundary() {
        // 6 multi-byte characters — each 3 bytes. Strings of different
        // multiples of 3 near MAX_LABEL_LEN exercise the boundary walker.
        let mut s = "あ".repeat((MAX_LABEL_LEN / 3) + 5);
        // Pad with an extra "あ" to make sure len > MAX_LABEL_LEN.
        s.push('あ');
        let out = sanitize_label(Some(s)).expect("some");
        assert!(out.len() <= MAX_LABEL_LEN);
        // Output is still valid UTF-8 (no split byte).
        assert_eq!(out, String::from_utf8(out.as_bytes().to_vec()).unwrap());
    }
}

/// Phase 3C-3b — spin up a read-only overlay from a captured snapshot. The
/// resulting `Layer` shows up in the ghost-diff panel alongside other
/// overlays and is dismissed via the existing `dismiss_ghost_layer` IPC.
/// Apply / Tab operations are automatically rejected via the existing
/// `is_read_only` gate on `apply_ghost_hunk` / `apply_ghost_file`.
#[tauri::command]
pub fn start_snapshot_overlay(
    app: AppHandle,
    snapshot_id: String,
) -> Result<LayerSummary, String> {
    let store = app
        .try_state::<Arc<SnapshotStore>>()
        .ok_or_else(|| "snapshot store missing".to_string())?;
    let registry = app
        .try_state::<Arc<LayerRegistry>>()
        .ok_or_else(|| "LayerRegistry state missing".to_string())?;

    let snap = store
        .inner()
        .get(&snapshot_id)
        .ok_or_else(|| format!("snapshot {snapshot_id} not found — may have been evicted"))?;

    let layer_id = format!("snapshot-{}", uuid::Uuid::new_v4());
    let created_at = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);

    registry.register_snapshot_layer(
        layer_id.clone(),
        snap.session_id.clone(),
        snap.id.0.clone(),
        snap.captured_at,
        snap.grid.clone(),
        LayerTint::snapshot(),
        created_at,
    )?;

    registry
        .list()
        .into_iter()
        .find(|s| s.id == layer_id)
        .ok_or_else(|| "layer vanished immediately after registration".to_string())
}
