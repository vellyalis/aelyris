//! Snapshot data model — wraps `term::GridSnapshot` with metadata that the
//! frontend timeline needs (id, timestamp, trigger kind). The full grid is
//! transferred as-is; compression is deferred to a later phase.

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::term::GridSnapshot;

/// Uuid-backed snapshot id. Newtype keeps the wire format as a plain string
/// and prevents accidental mixing with other ids (terminal, session, …).
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct SnapshotId(pub String);

impl SnapshotId {
    pub fn new() -> Self {
        Self(Uuid::new_v4().to_string())
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl Default for SnapshotId {
    fn default() -> Self {
        Self::new()
    }
}

/// Why a snapshot was captured. MVP emits `UserSubmitted` from the PTY write
/// path when the user presses Enter; `UserMarked` is reserved for an explicit
/// IPC. `PromptDetected` is a placeholder for later OSC 133 detection.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum SnapshotTrigger {
    /// User pressed Enter in the PTY input. Captures state *before* the shell
    /// starts producing output for the command.
    UserSubmitted,
    /// Frontend asked for a manual bookmark. Optional label for UI hover.
    UserMarked {
        #[serde(skip_serializing_if = "Option::is_none", default)]
        label: Option<String>,
    },
    /// Shell-reported prompt boundary (OSC 133 etc.). Reserved for 3C-3b.
    PromptDetected,
}

/// Full snapshot record — id + metadata + grid. `captured_at` is unix seconds
/// so the frontend can format it without round-tripping through a Date object
/// on the Rust side.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalSnapshot {
    pub id: SnapshotId,
    pub session_id: String,
    pub captured_at: u64,
    pub trigger: SnapshotTrigger,
    pub grid: GridSnapshot,
}

/// Compact summary — everything except the full grid. The timeline UI lists
/// hundreds of these per session so shipping the full cells vec would be
/// wasteful (8 KB × 100 = 800 KB on every list call).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotSummary {
    pub id: SnapshotId,
    pub session_id: String,
    pub captured_at: u64,
    pub trigger: SnapshotTrigger,
    pub cols: u16,
    pub rows: u16,
}

impl SnapshotSummary {
    pub fn from_snapshot(snap: &TerminalSnapshot) -> Self {
        Self {
            id: snap.id.clone(),
            session_id: snap.session_id.clone(),
            captured_at: snap.captured_at,
            trigger: snap.trigger.clone(),
            cols: snap.grid.cols,
            rows: snap.grid.rows,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn blank_grid(cols: u16, rows: u16) -> GridSnapshot {
        use crate::term::{CellSnapshot, CursorShapeSnapshot, CursorSnapshot};
        let row: Vec<_> = (0..cols).map(|_| CellSnapshot::blank()).collect();
        GridSnapshot {
            cols,
            rows,
            cells: (0..rows).map(|_| row.clone()).collect(),
            cursor: CursorSnapshot {
                row: 0,
                col: 0,
                shape: CursorShapeSnapshot::Block,
                blinking: false,
                visible: true,
            },
            images: Vec::new(),
        }
    }

    fn sample_snapshot(session: &str, cols: u16, rows: u16) -> TerminalSnapshot {
        TerminalSnapshot {
            id: SnapshotId::new(),
            session_id: session.to_string(),
            captured_at: 1_700_000_000,
            trigger: SnapshotTrigger::UserSubmitted,
            grid: blank_grid(cols, rows),
        }
    }

    #[test]
    fn snapshot_id_is_unique_per_new() {
        let a = SnapshotId::new();
        let b = SnapshotId::new();
        assert_ne!(a, b);
    }

    #[test]
    fn snapshot_round_trips_through_serde() {
        let snap = sample_snapshot("s1", 4, 2);
        let json = serde_json::to_string(&snap).expect("serialize");
        let parsed: TerminalSnapshot = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(parsed, snap);
    }

    #[test]
    fn summary_strips_grid_cells() {
        let snap = sample_snapshot("s1", 10, 3);
        let summary = SnapshotSummary::from_snapshot(&snap);
        assert_eq!(summary.id, snap.id);
        assert_eq!(summary.session_id, "s1");
        assert_eq!(summary.cols, 10);
        assert_eq!(summary.rows, 3);
        assert_eq!(summary.trigger, SnapshotTrigger::UserSubmitted);

        // Summary json must not contain cell data.
        let json = serde_json::to_string(&summary).expect("serialize");
        assert!(!json.contains("\"cells\""));
    }

    #[test]
    fn trigger_variants_tag_on_wire() {
        let marked = SnapshotTrigger::UserMarked {
            label: Some("boom".into()),
        };
        let json = serde_json::to_string(&marked).unwrap();
        assert!(json.contains("\"kind\":\"userMarked\""));
        assert!(json.contains("\"label\":\"boom\""));

        let submitted = SnapshotTrigger::UserSubmitted;
        let json = serde_json::to_string(&submitted).unwrap();
        assert!(json.contains("\"kind\":\"userSubmitted\""));
    }

    #[test]
    fn user_marked_without_label_is_omitted() {
        let t = SnapshotTrigger::UserMarked { label: None };
        let json = serde_json::to_string(&t).unwrap();
        assert!(
            !json.contains("\"label\""),
            "label:null should be omitted, got {json}"
        );
    }
}
