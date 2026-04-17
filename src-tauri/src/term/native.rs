//! Native engine session registry (Phase 2 — Task 5).
//!
//! One `NativeSession` per PTY id: owns a `TermEngine` fed by the PTY read
//! loop and a `DiffTracker` that yields coalesced `GridDiff`s to emit over
//! IPC. Controlled by the `AETHER_TERM_NATIVE=1` env flag — when disabled,
//! every method is a cheap no-op so the existing xterm.js pipeline keeps
//! running untouched.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use super::diff::{DiffTracker, GridDiff};
use super::engine::TermEngine;
use super::snapshot::GridSnapshot;

/// Minimum gap between emitted diffs per session. 16ms ~= 60fps cap.
const COALESCE_INTERVAL: Duration = Duration::from_millis(16);

struct NativeSession {
    engine: TermEngine,
    tracker: DiffTracker,
    last_emit_at: Instant,
}

pub struct NativeTerminalRegistry {
    enabled: bool,
    sessions: Mutex<HashMap<String, NativeSession>>,
}

impl NativeTerminalRegistry {
    pub fn new() -> Self {
        Self::with_enabled(Self::env_enabled())
    }

    /// Test hook — bypass the env check.
    pub fn with_enabled(enabled: bool) -> Self {
        Self { enabled, sessions: Mutex::new(HashMap::new()) }
    }

    fn env_enabled() -> bool {
        std::env::var("AETHER_TERM_NATIVE").ok().as_deref() == Some("1")
    }

    pub fn is_enabled(&self) -> bool {
        self.enabled
    }

    /// Create a session for `id`. No-op if the registry is disabled.
    pub fn create(&self, id: &str, cols: u16, rows: u16) -> Result<(), String> {
        if !self.enabled {
            return Ok(());
        }
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

    /// Feed PTY bytes into the engine and return a diff if the coalesce
    /// window has elapsed. Returns `None` when disabled, missing, or within
    /// the window.
    pub fn advance(&self, id: &str, bytes: &[u8]) -> Option<GridDiff> {
        if !self.enabled {
            return None;
        }
        let mut guard = self.lock().ok()?;
        let session = guard.get_mut(id)?;
        session.engine.advance(bytes);

        let now = Instant::now();
        if now.duration_since(session.last_emit_at) < COALESCE_INTERVAL {
            return None;
        }
        let diff = session.tracker.diff(&session.engine);
        if diff.is_noop() {
            return None;
        }
        session.last_emit_at = now;
        Some(diff)
    }

    /// Force-emit any pending state, ignoring the coalesce window. Used on
    /// resize / reconnect so the UI doesn't miss the final frame.
    pub fn flush(&self, id: &str) -> Option<GridDiff> {
        if !self.enabled {
            return None;
        }
        let mut guard = self.lock().ok()?;
        let session = guard.get_mut(id)?;
        let diff = session.tracker.diff(&session.engine);
        if diff.is_noop() {
            return None;
        }
        session.last_emit_at = Instant::now();
        Some(diff)
    }

    /// Resize the engine for `id`. Returns a full-frame diff if enabled and
    /// the session exists.
    pub fn resize(&self, id: &str, cols: u16, rows: u16) -> Result<Option<GridDiff>, String> {
        if !self.enabled {
            return Ok(None);
        }
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
        if !self.enabled {
            return None;
        }
        let guard = self.lock().ok()?;
        let session = guard.get(id)?;
        Some(session.engine.snapshot())
    }

    pub fn remove(&self, id: &str) {
        if !self.enabled {
            return;
        }
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
    fn disabled_registry_is_noop() {
        let reg = NativeTerminalRegistry::with_enabled(false);
        assert!(!reg.is_enabled());
        assert!(reg.create("x", 10, 5).is_ok());
        assert!(reg.advance("x", b"hi").is_none());
        assert!(reg.snapshot("x").is_none());
        assert!(reg.resize("x", 20, 5).unwrap().is_none());
        reg.remove("x");
    }

    #[test]
    fn first_advance_emits_full_frame() {
        let reg = NativeTerminalRegistry::with_enabled(true);
        reg.create("t", 10, 2).expect("create");
        let diff = reg.advance("t", b"hi").expect("emit");
        assert!(diff.full);
        assert_eq!(diff.rows.len(), 2);
    }

    #[test]
    fn coalesce_window_suppresses_second_emit() {
        let reg = NativeTerminalRegistry::with_enabled(true);
        reg.create("t", 10, 2).expect("create");
        assert!(reg.advance("t", b"a").is_some());
        // Immediately followed — still inside the 16ms window.
        assert!(reg.advance("t", b"b").is_none());
    }

    #[test]
    fn flush_bypasses_window() {
        let reg = NativeTerminalRegistry::with_enabled(true);
        reg.create("t", 10, 2).expect("create");
        assert!(reg.advance("t", b"a").is_some());
        assert!(reg.advance("t", b"b").is_none()); // coalesced
        // Flush should see the pending "b" and emit it.
        let diff = reg.flush("t").expect("flush emits pending");
        assert!(!diff.full);
        assert_eq!(diff.rows.len(), 1);
        assert_eq!(diff.rows[0].cells[1].ch, 'b');
    }

    #[test]
    fn resize_emits_full_frame() {
        let reg = NativeTerminalRegistry::with_enabled(true);
        reg.create("t", 10, 2).expect("create");
        let _ = reg.advance("t", b"x");
        let diff = reg.resize("t", 20, 3).expect("ok").expect("some");
        assert!(diff.full);
        assert_eq!(diff.cols, 20);
        assert_eq!(diff.rows_total, 3);
    }

    #[test]
    fn remove_drops_session() {
        let reg = NativeTerminalRegistry::with_enabled(true);
        reg.create("t", 4, 1).expect("create");
        assert!(reg.snapshot("t").is_some());
        reg.remove("t");
        assert!(reg.snapshot("t").is_none());
        assert!(reg.advance("t", b"x").is_none());
    }

    #[test]
    fn snapshot_matches_engine_state() {
        let reg = NativeTerminalRegistry::with_enabled(true);
        reg.create("t", 5, 1).expect("create");
        let _ = reg.advance("t", b"abc");
        let snap = reg.snapshot("t").expect("some");
        assert_eq!(snap.cols, 5);
        assert_eq!(snap.cells[0][0].ch, 'a');
        assert_eq!(snap.cells[0][2].ch, 'c');
    }
}
