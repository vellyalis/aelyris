//! In-memory snapshot store with per-session ring buffer semantics.
//!
//! One `VecDeque` per terminal session. When the buffer fills past
//! `max_per_session`, the oldest entry is evicted so long-running shells
//! don't unbounded-grow memory. Snapshot ids remain unique globally — lookup
//! walks all sessions, which is O(total snapshots) but bounded (≤ 100 per
//! session × handful of sessions).

use std::collections::{HashMap, VecDeque};
use std::sync::Mutex;

use super::types::{SnapshotId, SnapshotSummary, TerminalSnapshot};

/// MVP cap — 100 snapshots per session × ~8KB grid ≈ 800KB worst case.
pub const DEFAULT_MAX_PER_SESSION: usize = 100;

pub struct SnapshotStore {
    sessions: Mutex<HashMap<String, VecDeque<TerminalSnapshot>>>,
    max_per_session: usize,
}

impl SnapshotStore {
    pub fn new() -> Self {
        Self::with_max(DEFAULT_MAX_PER_SESSION)
    }

    pub fn with_max(max_per_session: usize) -> Self {
        assert!(max_per_session > 0, "snapshot cap must be positive");
        Self {
            sessions: Mutex::new(HashMap::new()),
            max_per_session,
        }
    }

    pub fn max_per_session(&self) -> usize {
        self.max_per_session
    }

    /// Push a snapshot into its session's buffer, evicting the oldest entry
    /// if we're at the cap. Returns the id of the stored snapshot (copied
    /// out before the move so callers can reference it without re-locking).
    pub fn push(&self, snap: TerminalSnapshot) -> SnapshotId {
        let id = snap.id.clone();
        let Ok(mut guard) = self.sessions.lock() else {
            log::warn!("snapshot store mutex poisoned; dropping snapshot");
            return id;
        };
        let buf = guard.entry(snap.session_id.clone()).or_default();
        if buf.len() >= self.max_per_session {
            buf.pop_front();
        }
        buf.push_back(snap);
        id
    }

    /// Return compact summaries for `session_id`, ordered oldest-to-newest
    /// (the timeline UI renders left-to-right in capture order).
    pub fn list(&self, session_id: &str) -> Vec<SnapshotSummary> {
        let Ok(guard) = self.sessions.lock() else {
            return Vec::new();
        };
        guard
            .get(session_id)
            .map(|buf| buf.iter().map(SnapshotSummary::from_snapshot).collect())
            .unwrap_or_default()
    }

    /// Fetch a full snapshot by id. O(total snapshots) — acceptable at MVP
    /// sizes; revisit with a secondary index when we ship persistence.
    pub fn get(&self, snapshot_id: &str) -> Option<TerminalSnapshot> {
        let Ok(guard) = self.sessions.lock() else {
            return None;
        };
        for buf in guard.values() {
            if let Some(hit) = buf.iter().find(|s| s.id.as_str() == snapshot_id) {
                return Some(hit.clone());
            }
        }
        None
    }

    /// Drop all snapshots for a session — invoked from `close_terminal` so
    /// reopened session ids start clean.
    pub fn remove_session(&self, session_id: &str) {
        if let Ok(mut guard) = self.sessions.lock() {
            guard.remove(session_id);
        }
    }

    /// Test helper / telemetry — how many snapshots exist for a session.
    pub fn session_count(&self, session_id: &str) -> usize {
        self.sessions
            .lock()
            .ok()
            .and_then(|g| g.get(session_id).map(|b| b.len()))
            .unwrap_or(0)
    }
}

impl Default for SnapshotStore {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::snapshot::types::{SnapshotTrigger, TerminalSnapshot};
    use crate::term::{CellSnapshot, CursorShapeSnapshot, CursorSnapshot, GridSnapshot};

    fn blank_grid() -> GridSnapshot {
        GridSnapshot {
            cols: 2,
            rows: 1,
            cells: vec![vec![CellSnapshot::blank(), CellSnapshot::blank()]],
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

    fn snap(session: &str, at: u64) -> TerminalSnapshot {
        TerminalSnapshot {
            id: SnapshotId::new(),
            session_id: session.to_string(),
            captured_at: at,
            trigger: SnapshotTrigger::UserSubmitted,
            grid: blank_grid(),
        }
    }

    #[test]
    fn push_and_list_round_trip() {
        let store = SnapshotStore::new();
        let a = store.push(snap("s", 100));
        let b = store.push(snap("s", 101));
        let list = store.list("s");
        assert_eq!(list.len(), 2);
        assert_eq!(list[0].id, a);
        assert_eq!(list[1].id, b);
        assert_eq!(list[0].captured_at, 100);
        assert_eq!(list[1].captured_at, 101);
    }

    #[test]
    fn get_returns_full_snapshot() {
        let store = SnapshotStore::new();
        let id = store.push(snap("s", 100));
        let got = store.get(id.as_str()).expect("snapshot present");
        assert_eq!(got.id, id);
        assert_eq!(got.captured_at, 100);
        assert_eq!(got.grid.cols, 2);
    }

    #[test]
    fn get_miss_returns_none() {
        let store = SnapshotStore::new();
        store.push(snap("s", 100));
        assert!(store.get("no-such-id").is_none());
    }

    #[test]
    fn eviction_removes_oldest() {
        let store = SnapshotStore::with_max(3);
        let a = store.push(snap("s", 1));
        let b = store.push(snap("s", 2));
        let c = store.push(snap("s", 3));
        let d = store.push(snap("s", 4));

        let list = store.list("s");
        assert_eq!(list.len(), 3);
        let ids: Vec<_> = list.iter().map(|s| s.id.clone()).collect();
        assert_eq!(ids, vec![b, c, d]);
        // `a` must be evicted and no longer retrievable by id.
        assert!(store.get(a.as_str()).is_none());
    }

    #[test]
    fn per_session_isolation() {
        let store = SnapshotStore::new();
        let a = store.push(snap("s1", 1));
        let b = store.push(snap("s2", 2));
        let l1 = store.list("s1");
        let l2 = store.list("s2");
        assert_eq!(l1.len(), 1);
        assert_eq!(l2.len(), 1);
        assert_eq!(l1[0].id, a);
        assert_eq!(l2[0].id, b);
    }

    #[test]
    fn remove_session_drops_all() {
        let store = SnapshotStore::new();
        store.push(snap("s", 1));
        store.push(snap("s", 2));
        assert_eq!(store.session_count("s"), 2);
        store.remove_session("s");
        assert_eq!(store.session_count("s"), 0);
        assert!(store.list("s").is_empty());
    }

    #[test]
    fn remove_session_does_not_touch_others() {
        let store = SnapshotStore::new();
        store.push(snap("s1", 1));
        store.push(snap("s2", 2));
        store.remove_session("s1");
        assert_eq!(store.session_count("s1"), 0);
        assert_eq!(store.session_count("s2"), 1);
    }

    #[test]
    fn get_across_sessions() {
        let store = SnapshotStore::new();
        let a = store.push(snap("s1", 1));
        let b = store.push(snap("s2", 2));
        assert!(store.get(a.as_str()).is_some());
        assert!(store.get(b.as_str()).is_some());
    }

    #[test]
    fn summary_omits_grid_cells() {
        let store = SnapshotStore::new();
        store.push(snap("s", 1));
        let list = store.list("s");
        let json = serde_json::to_string(&list[0]).unwrap();
        assert!(!json.contains("\"cells\""));
    }

    #[test]
    #[should_panic(expected = "snapshot cap must be positive")]
    fn zero_cap_panics() {
        let _ = SnapshotStore::with_max(0);
    }
}
