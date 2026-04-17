//! Grid diff engine (Phase 2 — Task 4).
//!
//! Pure function layer: given the previous snapshot and a current engine,
//! produce a `GridDiff` describing what changed. No timers / no IPC here —
//! coalescing (e.g. 16ms batching) lives in the IPC layer (Task 5).
//!
//! Wire format:
//!   - `full = true`   → first emit or resize; `rows` holds every line.
//!   - `full = false`  → only rows whose cell contents changed are present;
//!                       cursor is always included so UI keeps it in sync
//!                       even when the grid itself is untouched.

use serde::{Deserialize, Serialize};

use super::engine::TermEngine;
use super::snapshot::{CellSnapshot, CursorSnapshot, GridSnapshot};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RowDiff {
    pub row: u16,
    pub cells: Vec<CellSnapshot>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GridDiff {
    pub cols: u16,
    pub rows_total: u16,
    pub full: bool,
    pub rows: Vec<RowDiff>,
    pub cursor: CursorSnapshot,
    pub cursor_changed: bool,
}

impl GridDiff {
    /// True when nothing changed — neither grid cells nor cursor.
    /// IPC layer uses this to skip sending empty frames.
    pub fn is_noop(&self) -> bool {
        !self.full && self.rows.is_empty() && !self.cursor_changed
    }
}

#[derive(Debug, Default)]
pub struct DiffTracker {
    prev: Option<GridSnapshot>,
}

impl DiffTracker {
    pub fn new() -> Self {
        Self { prev: None }
    }

    /// Drop the cached snapshot — next `diff()` will emit a full frame.
    pub fn reset(&mut self) {
        self.prev = None;
    }

    /// Compute the diff against `engine`'s current state and update the cache.
    pub fn diff(&mut self, engine: &TermEngine) -> GridDiff {
        let next = engine.snapshot();
        let diff = diff_snapshots(self.prev.as_ref(), &next);
        self.prev = Some(next);
        diff
    }
}

/// Core diff logic — pure, no hidden state. Exposed for tests and for
/// callers that want to diff two materialised snapshots directly.
pub fn diff_snapshots(prev: Option<&GridSnapshot>, next: &GridSnapshot) -> GridDiff {
    let full = match prev {
        None => true,
        Some(p) => p.cols != next.cols || p.rows != next.rows,
    };

    if full {
        let rows = next
            .cells
            .iter()
            .enumerate()
            .map(|(i, row)| RowDiff { row: i as u16, cells: row.clone() })
            .collect();
        return GridDiff {
            cols: next.cols,
            rows_total: next.rows,
            full: true,
            rows,
            cursor: next.cursor,
            cursor_changed: true,
        };
    }

    let prev = prev.expect("full == false guarantees Some");
    let mut changed = Vec::new();
    for (i, row) in next.cells.iter().enumerate() {
        if prev.cells.get(i) != Some(row) {
            changed.push(RowDiff { row: i as u16, cells: row.clone() });
        }
    }

    GridDiff {
        cols: next.cols,
        rows_total: next.rows,
        full: false,
        rows: changed,
        cursor: next.cursor,
        cursor_changed: prev.cursor != next.cursor,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn first_diff_is_full() {
        let mut tracker = DiffTracker::new();
        let engine = TermEngine::new(4, 2).expect("engine");
        let d = tracker.diff(&engine);
        assert!(d.full);
        assert_eq!(d.rows.len(), 2);
        assert_eq!(d.rows[0].row, 0);
        assert_eq!(d.rows[0].cells.len(), 4);
    }

    #[test]
    fn repeated_diff_on_quiet_engine_is_noop() {
        let mut tracker = DiffTracker::new();
        let engine = TermEngine::new(4, 2).expect("engine");
        let _ = tracker.diff(&engine);
        let d2 = tracker.diff(&engine);
        assert!(!d2.full);
        assert!(d2.rows.is_empty());
        assert!(d2.is_noop());
    }

    #[test]
    fn writing_one_row_emits_one_row_diff() {
        let mut tracker = DiffTracker::new();
        let mut engine = TermEngine::new(10, 3).expect("engine");
        let _ = tracker.diff(&engine);
        engine.advance_str("hello");
        let d = tracker.diff(&engine);
        assert!(!d.full);
        assert_eq!(d.rows.len(), 1);
        assert_eq!(d.rows[0].row, 0);
        assert_eq!(d.rows[0].cells[0].ch, 'h');
    }

    #[test]
    fn writing_across_lines_emits_multiple_rows() {
        let mut tracker = DiffTracker::new();
        let mut engine = TermEngine::new(10, 3).expect("engine");
        let _ = tracker.diff(&engine);
        engine.advance_str("ab\r\ncd");
        let d = tracker.diff(&engine);
        assert_eq!(d.rows.len(), 2);
        let rows: Vec<u16> = d.rows.iter().map(|r| r.row).collect();
        assert_eq!(rows, vec![0, 1]);
    }

    #[test]
    fn cursor_only_move_does_not_emit_rows() {
        // Writing "a" then backspacing leaves the cell blank again but cursor has moved.
        // Verify we don't over-emit when only cursor changes.
        let mut engine = TermEngine::new(10, 2).expect("engine");
        let snap_a = engine.snapshot();
        // Simulate a cursor-only change by tweaking the cached snapshot's cursor.
        let mut snap_b = snap_a.clone();
        snap_b.cursor.col = 3;
        let d = diff_snapshots(Some(&snap_a), &snap_b);
        assert!(!d.full);
        assert!(d.rows.is_empty());
        assert_eq!(d.cursor.col, 3);
        assert!(!d.is_noop(), "cursor change should not be noop by cursor value");
    }

    #[test]
    fn resize_triggers_full_frame() {
        let mut tracker = DiffTracker::new();
        let engine_small = TermEngine::new(4, 2).expect("engine");
        let _ = tracker.diff(&engine_small);

        let engine_large = TermEngine::new(6, 3).expect("engine");
        let d = tracker.diff(&engine_large);
        assert!(d.full);
        assert_eq!(d.cols, 6);
        assert_eq!(d.rows_total, 3);
        assert_eq!(d.rows.len(), 3);
    }

    #[test]
    fn reset_forces_next_diff_to_full() {
        let mut tracker = DiffTracker::new();
        let engine = TermEngine::new(4, 2).expect("engine");
        let _ = tracker.diff(&engine);
        tracker.reset();
        let d = tracker.diff(&engine);
        assert!(d.full);
    }

    #[test]
    fn diff_is_serde_round_trippable() {
        let mut engine = TermEngine::new(3, 1).expect("engine");
        engine.advance_str("x");
        let d = diff_snapshots(None, &engine.snapshot());
        let json = serde_json::to_string(&d).expect("serialize");
        let parsed: GridDiff = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(parsed, d);
    }
}
