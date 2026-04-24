//! Native engine session registry (Phase 2 — Task 5).
//!
//! One `NativeSession` per PTY id: owns a `TermEngine` fed by the PTY read
//! loop and a `DiffTracker` that yields coalesced `GridDiff`s to emit over
//! IPC. Every PTY that flows through the native pipeline registers here.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use super::diff::{DiffTracker, GridDiff};
use super::engine::TermEngine;
use super::prompt_marks::PromptMark;
use super::snapshot::GridSnapshot;

/// Outcome of a single `advance` call — a (possibly-empty) diff plus every
/// OSC 133 prompt mark that was *newly* completed inside the byte buffer.
/// Both fields are optional to the caller: diffs are coalesced by the 60fps
/// window, but prompt marks are always returned the instant they parse so
/// the UI can jump-to-prompt without waiting for the next frame.
#[derive(Debug, Default)]
pub struct AdvanceResult {
    pub diff: Option<GridDiff>,
    pub new_marks: Vec<PromptMark>,
}

/// Minimum gap between emitted diffs per session. 16ms ~= 60fps cap.
const COALESCE_INTERVAL: Duration = Duration::from_millis(16);

struct NativeSession {
    engine: TermEngine,
    tracker: DiffTracker,
    last_emit_at: Instant,
}

pub struct NativeTerminalRegistry {
    sessions: Mutex<HashMap<String, NativeSession>>,
}

impl NativeTerminalRegistry {
    pub fn new() -> Self {
        Self { sessions: Mutex::new(HashMap::new()) }
    }

    /// Create a session for `id`.
    pub fn create(&self, id: &str, cols: u16, rows: u16) -> Result<(), String> {
        let engine = TermEngine::new(cols as usize, rows as usize).map_err(|e| e.to_string())?;
        let session = NativeSession {
            engine,
            tracker: DiffTracker::new(),
            // Back-date so the very first advance can emit immediately.
            last_emit_at: Instant::now()
                .checked_sub(COALESCE_INTERVAL)
                .unwrap_or_else(Instant::now),
        };
        let mut guard = self.lock()?;
        guard.insert(id.to_string(), session);
        Ok(())
    }

    /// Feed PTY bytes into the engine and return an [`AdvanceResult`] with
    /// the (coalesced) diff plus every newly-parsed OSC 133 mark. A missing
    /// session yields an empty result.
    ///
    /// Prompt marks are not subject to the 60fps coalescer — they are low
    /// frequency (one per shell prompt) and the UI needs them synchronously
    /// for "jump to prompt" to feel responsive.
    pub fn advance(&self, id: &str, bytes: &[u8]) -> AdvanceResult {
        let Ok(mut guard) = self.lock() else {
            return AdvanceResult::default();
        };
        let Some(session) = guard.get_mut(id) else {
            return AdvanceResult::default();
        };
        let new_marks = session.engine.advance(bytes);

        let now = Instant::now();
        if now.duration_since(session.last_emit_at) < COALESCE_INTERVAL {
            return AdvanceResult { diff: None, new_marks };
        }
        let diff = session.tracker.diff(&session.engine);
        if diff.is_noop() {
            return AdvanceResult { diff: None, new_marks };
        }
        session.last_emit_at = now;
        AdvanceResult { diff: Some(diff), new_marks }
    }

    /// Full history of prompt marks retained for the given session.
    pub fn prompt_marks(&self, id: &str) -> Vec<PromptMark> {
        let Ok(guard) = self.lock() else {
            return Vec::new();
        };
        guard
            .get(id)
            .map(|session| session.engine.prompt_marks())
            .unwrap_or_default()
    }

    /// Current scrollback size for the session (rows retained above the
    /// visible screen). Returns 0 for missing sessions so the UI can
    /// branch on `> 0` without re-checking session existence.
    pub fn history_size(&self, id: &str) -> usize {
        let Ok(guard) = self.lock() else {
            return 0;
        };
        guard.get(id).map(|s| s.engine.history_size()).unwrap_or(0)
    }

    /// Read a contiguous window of scrollback rows. See
    /// [`TermEngine::history_rows`] for index semantics.
    pub fn history_rows(
        &self,
        id: &str,
        from_n: usize,
        count: usize,
    ) -> Vec<Vec<super::snapshot::CellSnapshot>> {
        let Ok(guard) = self.lock() else {
            return Vec::new();
        };
        guard
            .get(id)
            .map(|s| s.engine.history_rows(from_n, count))
            .unwrap_or_default()
    }

    /// Force-emit any pending state, ignoring the coalesce window. Used on
    /// resize / reconnect so the UI doesn't miss the final frame.
    pub fn flush(&self, id: &str) -> Option<GridDiff> {
        let mut guard = self.lock().ok()?;
        let session = guard.get_mut(id)?;
        let diff = session.tracker.diff(&session.engine);
        if diff.is_noop() {
            return None;
        }
        session.last_emit_at = Instant::now();
        Some(diff)
    }

    /// Resize the engine for `id`. Returns a full-frame diff if the session
    /// exists.
    pub fn resize(&self, id: &str, cols: u16, rows: u16) -> Result<Option<GridDiff>, String> {
        let mut guard = self.lock()?;
        let Some(session) = guard.get_mut(id) else {
            return Ok(None);
        };
        session.engine.resize(cols as usize, rows as usize).map_err(|e| e.to_string())?;
        // Resize forces a full frame via the tracker's dimension check.
        let diff = session.tracker.diff(&session.engine);
        session.last_emit_at = Instant::now();
        Ok(Some(diff))
    }

    /// Build a fresh full snapshot without touching the diff tracker. Used
    /// when the frontend (re)mounts and needs to bootstrap from scratch.
    pub fn snapshot(&self, id: &str) -> Option<GridSnapshot> {
        let guard = self.lock().ok()?;
        let session = guard.get(id)?;
        Some(session.engine.snapshot())
    }

    pub fn remove(&self, id: &str) {
        if let Ok(mut guard) = self.lock() {
            guard.remove(id);
        }
    }

    fn lock(&self) -> Result<std::sync::MutexGuard<'_, HashMap<String, NativeSession>>, String> {
        self.sessions.lock().map_err(|_| "native registry mutex poisoned".to_string())
    }
}

impl Default for NativeTerminalRegistry {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn first_advance_emits_full_frame() {
        let reg = NativeTerminalRegistry::new();
        reg.create("t", 10, 2).expect("create");
        let result = reg.advance("t", b"hi");
        let diff = result.diff.expect("emit");
        assert!(diff.full);
        assert_eq!(diff.rows.len(), 2);
        assert!(result.new_marks.is_empty());
    }

    #[test]
    fn coalesce_window_suppresses_second_emit() {
        let reg = NativeTerminalRegistry::new();
        reg.create("t", 10, 2).expect("create");
        assert!(reg.advance("t", b"a").diff.is_some());
        // Immediately followed — still inside the 16ms window.
        assert!(reg.advance("t", b"b").diff.is_none());
    }

    #[test]
    fn flush_bypasses_window() {
        let reg = NativeTerminalRegistry::new();
        reg.create("t", 10, 2).expect("create");
        assert!(reg.advance("t", b"a").diff.is_some());
        assert!(reg.advance("t", b"b").diff.is_none()); // coalesced
        // Flush should see the pending "b" and emit it.
        let diff = reg.flush("t").expect("flush emits pending");
        assert!(!diff.full);
        assert_eq!(diff.rows.len(), 1);
        assert_eq!(diff.rows[0].cells[1].ch, 'b');
    }

    #[test]
    fn resize_emits_full_frame() {
        let reg = NativeTerminalRegistry::new();
        reg.create("t", 10, 2).expect("create");
        let _ = reg.advance("t", b"x");
        let diff = reg.resize("t", 20, 3).expect("ok").expect("some");
        assert!(diff.full);
        assert_eq!(diff.cols, 20);
        assert_eq!(diff.rows_total, 3);
    }

    #[test]
    fn remove_drops_session() {
        let reg = NativeTerminalRegistry::new();
        reg.create("t", 4, 1).expect("create");
        assert!(reg.snapshot("t").is_some());
        reg.remove("t");
        assert!(reg.snapshot("t").is_none());
        assert!(reg.advance("t", b"x").diff.is_none());
    }

    #[test]
    fn snapshot_matches_engine_state() {
        let reg = NativeTerminalRegistry::new();
        reg.create("t", 5, 1).expect("create");
        let _ = reg.advance("t", b"abc");
        let snap = reg.snapshot("t").expect("some");
        assert_eq!(snap.cols, 5);
        assert_eq!(snap.cells[0][0].ch, 'a');
        assert_eq!(snap.cells[0][2].ch, 'c');
    }

    #[test]
    fn prompt_marks_are_surfaced_through_advance_result() {
        use crate::term::prompt_marks::PromptMarkKind;

        let reg = NativeTerminalRegistry::new();
        reg.create("t", 40, 5).expect("create");
        let result = reg.advance("t", b"$ \x1b]133;A\x07");
        assert_eq!(result.new_marks.len(), 1);
        assert_eq!(result.new_marks[0].kind, PromptMarkKind::PromptStart);
    }

    #[test]
    fn prompt_marks_accessor_returns_retained_history() {
        use crate::term::prompt_marks::PromptMarkKind;

        let reg = NativeTerminalRegistry::new();
        reg.create("t", 40, 5).expect("create");
        let _ = reg.advance("t", b"\x1b]133;A\x07");
        let _ = reg.advance("t", b"\x1b]133;D;0\x07");
        let history = reg.prompt_marks("t");
        assert_eq!(history.len(), 2);
        assert_eq!(history[0].kind, PromptMarkKind::PromptStart);
        assert_eq!(history[1].kind, PromptMarkKind::CommandEnd);
        assert_eq!(history[1].exit_code, Some(0));
    }

    #[test]
    fn prompt_marks_for_missing_session_are_empty() {
        let reg = NativeTerminalRegistry::new();
        assert!(reg.prompt_marks("ghost").is_empty());
    }

    #[test]
    fn history_size_is_zero_for_missing_session() {
        let reg = NativeTerminalRegistry::new();
        assert_eq!(reg.history_size("ghost"), 0);
    }

    #[test]
    fn history_size_grows_with_output_that_exceeds_screen() {
        let reg = NativeTerminalRegistry::new();
        reg.create("t", 30, 3).expect("create");
        for i in 0..10 {
            let _ = reg.advance("t", format!("row-{i}\r\n").as_bytes());
        }
        assert!(
            reg.history_size("t") >= 7,
            "expected >= 7 history rows, got {}",
            reg.history_size("t")
        );
    }

    #[test]
    fn history_rows_returns_most_recent_first() {
        let reg = NativeTerminalRegistry::new();
        reg.create("t", 30, 2).expect("create");
        for i in 0..5 {
            let _ = reg.advance("t", format!("row-{i}\r\n").as_bytes());
        }
        let rows = reg.history_rows("t", 0, 3);
        assert_eq!(rows.len(), 3);
        // Most-recent-first: first returned row ends with "row-3" (the
        // last line to scroll off before the screen currently holds
        // row-4 / blank).
        let first_text: String = rows[0].iter().map(|c| c.ch).collect();
        assert!(first_text.starts_with("row-3"), "got {first_text:?}");
    }

    #[test]
    fn history_rows_beyond_retained_returns_empty() {
        let reg = NativeTerminalRegistry::new();
        reg.create("t", 20, 2).expect("create");
        let _ = reg.advance("t", b"only one line\r\n");
        let rows = reg.history_rows("t", 100, 10);
        assert!(rows.is_empty());
    }
}
