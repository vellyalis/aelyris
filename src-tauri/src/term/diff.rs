//! Grid diff engine (Phase 2 — Task 4).
//!
//! Pure function layer: given the previous snapshot and a current engine,
//! produce a `GridDiff` describing what changed. No timers / no IPC here —
//! coalescing (e.g. 16ms batching) lives in the IPC layer (Task 5).
//!
//! Wire format:
//!   - `full = true`   → first emit or resize; `rows` holds every line.
//!   - `full = false`  → only rows whose cell contents changed are present;
//!     cursor is always included so UI keeps it in sync
//!     even when the grid itself is untouched.

use serde::{Deserialize, Serialize};

use super::engine::TermEngine;
use super::snapshot::{CellSnapshot, CursorSnapshot, GridSnapshot, ImageRef};

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
    /// Inline image overlay state for this frame.
    /// - `Some(images)`: the frontend should replace its image set wholesale.
    ///   Populated on every `full=true` diff (so (re)mounts always seed
    ///   correct images) and on partial diffs whenever the visible image
    ///   set changed since the last emit (anchor scrolled out, new image
    ///   landed, etc).
    /// - `None`: image set unchanged from the prev frame; the frontend
    ///   carries `prev.images` through.
    ///
    /// `#[serde(skip_serializing_if = "Option::is_none")]` keeps the
    /// wire byte-compatible with frames that don't touch images.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub images: Option<Vec<ImageRef>>,
}

impl GridDiff {
    /// True when nothing changed — neither grid cells, cursor, nor images.
    /// IPC layer uses this to skip sending empty frames.
    pub fn is_noop(&self) -> bool {
        !self.full && self.rows.is_empty() && !self.cursor_changed && self.images.is_none()
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
            .map(|(i, row)| RowDiff {
                row: i as u16,
                cells: row.clone(),
            })
            .collect();
        return GridDiff {
            cols: next.cols,
            rows_total: next.rows,
            full: true,
            rows,
            cursor: next.cursor,
            cursor_changed: true,
            // Always populate on full frames so a (re)mount that consumes
            // this diff seeds the correct image set, even when prev had a
            // different (or no) image overlay set.
            images: Some(next.images.clone()),
        };
    }

    let prev = prev.expect("full == false guarantees Some");
    let mut changed = Vec::new();
    for (i, row) in next.cells.iter().enumerate() {
        if prev.cells.get(i) != Some(row) {
            changed.push(RowDiff {
                row: i as u16,
                cells: row.clone(),
            });
        }
    }

    // Image overlays change without writing visible cells (anchor
    // scrolling, OSC eviction, new payload landing on a previously-empty
    // cell), so we can't piggyback them on `rows`. Emit the new set on
    // any change; emit `None` when unchanged so the frontend carries
    // prev.images through.
    let images = if prev.images != next.images {
        Some(next.images.clone())
    } else {
        None
    };

    GridDiff {
        cols: next.cols,
        rows_total: next.rows,
        full: false,
        rows: changed,
        cursor: next.cursor,
        cursor_changed: prev.cursor != next.cursor,
        images,
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
        let engine = TermEngine::new(10, 2).expect("engine");
        let snap_a = engine.snapshot();
        // Simulate a cursor-only change by tweaking the cached snapshot's cursor.
        let mut snap_b = snap_a.clone();
        snap_b.cursor.col = 3;
        let d = diff_snapshots(Some(&snap_a), &snap_b);
        assert!(!d.full);
        assert!(d.rows.is_empty());
        assert_eq!(d.cursor.col, 3);
        assert!(
            !d.is_noop(),
            "cursor change should not be noop by cursor value"
        );
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

    fn image(id: u64, cell_row: u16) -> ImageRef {
        ImageRef {
            id,
            cell_row,
            cell_col: 0,
            width_px: 100,
            height_px: 50,
            cell_w: None,
            cell_h: None,
        }
    }

    fn snap_with_images(images: Vec<ImageRef>) -> GridSnapshot {
        let engine = TermEngine::new(4, 2).expect("engine");
        let mut s = engine.snapshot();
        s.images = images;
        s
    }

    #[test]
    fn full_diff_always_carries_images() {
        // Forced reset by `term_snapshot` emits a full=true diff. Without
        // images on the wire, the frontend would either drop visible images
        // or have to guess from a stale `initial`. Always populate.
        let next = snap_with_images(vec![image(1, 0), image(2, 1)]);
        let d = diff_snapshots(None, &next);
        assert!(d.full);
        assert_eq!(d.images, Some(vec![image(1, 0), image(2, 1)]));
    }

    #[test]
    fn full_diff_with_no_images_carries_empty_set() {
        // `Some(vec![])` means "the engine has no images right now". Distinct
        // from `None` ("unchanged from prev"). On full=true the frontend has
        // no prev to carry, so we must emit Some.
        let engine = TermEngine::new(4, 2).expect("engine");
        let next = engine.snapshot();
        let d = diff_snapshots(None, &next);
        assert!(d.full);
        assert_eq!(d.images, Some(vec![]));
    }

    #[test]
    fn partial_diff_omits_images_when_unchanged() {
        let prev = snap_with_images(vec![image(1, 0)]);
        let mut next = prev.clone();
        // Tweak cursor so the diff isn't a complete noop.
        next.cursor.col = 1;
        let d = diff_snapshots(Some(&prev), &next);
        assert!(!d.full);
        assert_eq!(d.images, None, "unchanged image set must serialize away");
    }

    #[test]
    fn partial_diff_emits_images_when_image_added() {
        let prev = snap_with_images(vec![image(1, 0)]);
        let next = snap_with_images(vec![image(1, 0), image(2, 1)]);
        let d = diff_snapshots(Some(&prev), &next);
        assert!(!d.full);
        assert_eq!(d.images, Some(vec![image(1, 0), image(2, 1)]));
    }

    #[test]
    fn partial_diff_emits_empty_set_when_all_images_evicted() {
        // Anchor scrolled out of the visible window — the snapshot layer
        // drops it. The diff must surface `Some(vec![])` so the frontend
        // clears its overlay; carrying prev would leave a phantom image.
        let prev = snap_with_images(vec![image(1, 0)]);
        let next = snap_with_images(vec![]);
        let d = diff_snapshots(Some(&prev), &next);
        assert!(!d.full);
        assert_eq!(d.images, Some(vec![]));
    }

    #[test]
    fn image_only_change_is_not_noop() {
        // Anchor moved (e.g. terminal scrolled while text didn't repaint).
        // Without `images.is_none()` in is_noop, the IPC layer would drop
        // this frame and the frontend would render the image at the old row.
        let prev = snap_with_images(vec![image(1, 0)]);
        let next = snap_with_images(vec![image(1, 1)]);
        let d = diff_snapshots(Some(&prev), &next);
        assert!(!d.is_noop());
        assert_eq!(d.images, Some(vec![image(1, 1)]));
        assert!(d.rows.is_empty());
        assert!(!d.cursor_changed);
    }

    #[test]
    fn image_diff_is_serde_round_trippable() {
        let prev = snap_with_images(vec![image(1, 0)]);
        let next = snap_with_images(vec![image(2, 1)]);
        let d = diff_snapshots(Some(&prev), &next);
        let json = serde_json::to_string(&d).expect("serialize");
        // None images must serialize away — verify with the unchanged case.
        let mut prev2 = prev.clone();
        prev2.cursor.col = 1;
        let d_unchanged = diff_snapshots(Some(&prev), &prev2);
        let json_unchanged = serde_json::to_string(&d_unchanged).expect("serialize");
        assert!(
            !json_unchanged.contains("images"),
            "unchanged image set must not appear on the wire (got: {json_unchanged})"
        );
        let parsed: GridDiff = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(parsed, d);
    }
}
