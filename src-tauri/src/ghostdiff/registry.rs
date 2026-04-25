//! Thread-safe registry of active ghost diff layers.
//!
//! Keeps I/O out of this module on purpose: `register()` takes the base SHA
//! from the caller (captured earlier via [`diff_engine::capture_head_sha`]),
//! and `refresh()` takes the already-computed `Vec<FileDelta>` from the
//! caller (produced via [`diff_engine::compute_diff`]). The watcher is the
//! component that wires those calls together.
//!
//! Events are produced via `poll()` so the main thread can drain them
//! on its 500ms tick and `emit()` them to the frontend — the same pattern
//! used by `AutoRepairManager`.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::mpsc;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

use super::layer::{
    FileDelta, Layer, LayerContent, LayerId, LayerSource, LayerSummary, LayerTint,
};
use crate::term::GridSnapshot;

/// Snapshot the watcher needs to recompute a diff for one layer.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LayerSourceSnapshot {
    pub id: LayerId,
    pub worktree_path: PathBuf,
    pub base_sha: String,
}

/// Event stream consumed by the main app loop and re-emitted to the frontend.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum LayerEvent {
    Updated(LayerSummary),
    Completed(LayerId),
    Removed(LayerId),
}

/// Registry of active ghost layers.
pub struct LayerRegistry {
    layers: Mutex<HashMap<LayerId, Layer>>,
    tx: mpsc::Sender<LayerEvent>,
    rx: Mutex<mpsc::Receiver<LayerEvent>>,
}

impl LayerRegistry {
    pub fn new() -> Self {
        let (tx, rx) = mpsc::channel();
        Self {
            layers: Mutex::new(HashMap::new()),
            tx,
            rx: Mutex::new(rx),
        }
    }

    /// Register a fresh worktree-backed layer. Duplicate IDs are rejected.
    #[allow(clippy::too_many_arguments)]
    pub fn register_worktree_layer(
        &self,
        id: LayerId,
        worktree_path: PathBuf,
        branch: String,
        repo_path: PathBuf,
        tint: LayerTint,
        base_sha: String,
        created_at: u64,
    ) -> Result<(), String> {
        let mut guard = self.lock_layers()?;
        if guard.contains_key(&id) {
            return Err(format!("layer already registered: {id}"));
        }
        let mut layer = Layer::new_worktree(
            id.clone(),
            worktree_path,
            branch,
            repo_path,
            tint,
            created_at,
        );
        // Replace the default "HEAD" with the captured SHA so subsequent diffs
        // are stable even after the agent commits inside the worktree.
        // `new_worktree` always builds `LayerContent::Diff` so this branch is
        // taken in practice, but `if let` keeps the match exhaustive now that
        // `LayerContent` has more than one variant (3C-3b).
        if let LayerContent::Diff { base_revision, .. } = &mut layer.content {
            *base_revision = base_sha;
        }
        let summary = layer.summary();
        guard.insert(id, layer);
        drop(guard);
        let _ = self.tx.send(LayerEvent::Updated(summary));
        Ok(())
    }

    /// Register a read-only "peek at another branch" layer (Phase 3C-2).
    /// Duplicate IDs are rejected. Diff content is populated by a follow-up
    /// `refresh()` call from the IPC handler once `git diff` returns.
    pub fn register_branch_comparison_layer(
        &self,
        id: LayerId,
        repo_path: PathBuf,
        base_branch: String,
        head_branch: String,
        tint: LayerTint,
        created_at: u64,
    ) -> Result<(), String> {
        let mut guard = self.lock_layers()?;
        if guard.contains_key(&id) {
            return Err(format!("layer already registered: {id}"));
        }
        let layer = Layer::new_branch_comparison(
            id.clone(),
            repo_path,
            base_branch,
            head_branch,
            tint,
            created_at,
        );
        let summary = layer.summary();
        guard.insert(id, layer);
        drop(guard);
        let _ = self.tx.send(LayerEvent::Updated(summary));
        Ok(())
    }

    /// Register a read-only time-travel snapshot layer (Phase 3C-3b). The
    /// captured grid is embedded directly so the frontend can render the
    /// past terminal state without a follow-up fetch.
    #[allow(clippy::too_many_arguments)]
    pub fn register_snapshot_layer(
        &self,
        id: LayerId,
        session_id: String,
        snapshot_id: String,
        captured_at: u64,
        grid: GridSnapshot,
        tint: LayerTint,
        created_at: u64,
    ) -> Result<(), String> {
        let mut guard = self.lock_layers()?;
        if guard.contains_key(&id) {
            return Err(format!("layer already registered: {id}"));
        }
        let layer = Layer::new_snapshot(
            id.clone(),
            session_id,
            snapshot_id,
            captured_at,
            grid,
            tint,
            created_at,
        );
        let summary = layer.summary();
        guard.insert(id, layer);
        drop(guard);
        let _ = self.tx.send(LayerEvent::Updated(summary));
        Ok(())
    }

    /// Remove a layer. No-op if unknown.
    pub fn unregister(&self, id: &str) -> Result<(), String> {
        let removed = {
            let mut guard = self.lock_layers()?;
            guard.remove(id).is_some()
        };
        if removed {
            let _ = self.tx.send(LayerEvent::Removed(id.to_string()));
        }
        Ok(())
    }

    /// Replace a layer's file deltas with freshly computed ones and emit an
    /// `Updated` event. Silently no-ops for snapshot layers (their content
    /// is terminal state, not file hunks) or for unknown ids.
    pub fn refresh(&self, id: &str, files: Vec<FileDelta>) -> Result<(), String> {
        let summary = {
            let mut guard = self.lock_layers()?;
            let Some(layer) = guard.get_mut(id) else {
                return Ok(());
            };
            match &mut layer.content {
                LayerContent::Diff { files: stored, .. } => {
                    *stored = files;
                }
                // Snapshot layers have no file deltas — refreshing them with
                // `Vec<FileDelta>` is a category error from the caller.
                // Dropping the payload silently keeps the invariant and
                // avoids a panic path in the watcher pool.
                LayerContent::TerminalState { .. } => {
                    log::debug!(
                        "refresh(files) on snapshot layer {id} ignored — \
                         snapshot content is immutable after registration"
                    );
                    return Ok(());
                }
            }
            layer.summary()
        };
        let _ = self.tx.send(LayerEvent::Updated(summary));
        Ok(())
    }

    /// Flag a layer as complete (agent run ended). Emits `Completed` and a
    /// refreshed `Updated` so the UI picks up both state changes in one tick.
    pub fn mark_complete(&self, id: &str) -> Result<(), String> {
        let summary = {
            let mut guard = self.lock_layers()?;
            let Some(layer) = guard.get_mut(id) else {
                return Ok(());
            };
            if layer.is_complete {
                return Ok(());
            }
            layer.is_complete = true;
            layer.summary()
        };
        let _ = self.tx.send(LayerEvent::Completed(id.to_string()));
        let _ = self.tx.send(LayerEvent::Updated(summary));
        Ok(())
    }

    /// Every layer's summary, sorted oldest-first for stable UI ordering.
    pub fn list(&self) -> Vec<LayerSummary> {
        let guard = match self.layers.lock() {
            Ok(g) => g,
            Err(_) => return Vec::new(),
        };
        let mut summaries: Vec<LayerSummary> = guard.values().map(|l| l.summary()).collect();
        summaries.sort_by_key(|s| s.created_at);
        summaries
    }

    /// Source snapshot for one layer — used by the watcher callback on each
    /// debounced fs event. Returns `None` for layer kinds that do not back a
    /// fs watcher (`BranchComparison` / `Snapshot`, Phases 3C-2 / 3C-3).
    pub fn get_source_snapshot(&self, id: &str) -> Option<LayerSourceSnapshot> {
        let guard = self.layers.lock().ok()?;
        let layer = guard.get(id)?;
        match &layer.source {
            LayerSource::Worktree { path, .. } => {
                let base_sha = match &layer.content {
                    LayerContent::Diff { base_revision, .. } => base_revision.clone(),
                    // Unreachable in practice: worktree layers are only ever
                    // constructed with Diff content via `Layer::new_worktree`.
                    // Use a sentinel instead of `unreachable!()` so a future
                    // refactor can't turn this into a runtime panic.
                    LayerContent::TerminalState { .. } => String::new(),
                };
                Some(LayerSourceSnapshot {
                    id: layer.id.clone(),
                    worktree_path: path.clone(),
                    base_sha,
                })
            }
            LayerSource::BranchComparison { .. } => None,
            LayerSource::Snapshot { .. } => None,
        }
    }

    /// `true` if this layer refuses `apply_*` operations (e.g. branch
    /// comparisons, which the user does not own). IPC reads this before
    /// touching the main worktree.
    pub fn is_read_only(&self, id: &str) -> bool {
        let Ok(guard) = self.layers.lock() else { return false };
        guard.get(id).map(|l| l.is_read_only()).unwrap_or(false)
    }

    /// Repo path for a layer — IPC uses this to resolve the main file target
    /// when the user accepts a hunk back into main.
    pub fn repo_path(&self, id: &str) -> Option<PathBuf> {
        let guard = self.layers.lock().ok()?;
        let layer = guard.get(id)?;
        layer.repo_path().cloned()
    }

    /// Whether a layer id is currently registered.
    pub fn contains(&self, id: &str) -> bool {
        self.layers
            .lock()
            .map(|g| g.contains_key(id))
            .unwrap_or(false)
    }

    /// Source snapshots for every layer that still needs refreshing. Used by
    /// the watcher when it needs the base SHA without re-locking per event.
    pub fn source_snapshots(&self) -> Vec<LayerSourceSnapshot> {
        let guard = match self.layers.lock() {
            Ok(g) => g,
            Err(_) => return Vec::new(),
        };
        guard
            .values()
            .filter_map(|l| match &l.source {
                LayerSource::Worktree { path, .. } => {
                    let base_sha = match &l.content {
                        LayerContent::Diff { base_revision, .. } => base_revision.clone(),
                        LayerContent::TerminalState { .. } => String::new(),
                    };
                    Some(LayerSourceSnapshot {
                        id: l.id.clone(),
                        worktree_path: path.clone(),
                        base_sha,
                    })
                }
                // Branch comparisons (3C-2) and snapshot overlays (3C-3) are
                // not fs-watched — they only refresh on explicit user
                // trigger, so the watcher pool has nothing to do with them.
                LayerSource::BranchComparison { .. } => None,
                LayerSource::Snapshot { .. } => None,
            })
            .collect()
    }

    /// Fetch a full `FileDelta` for IPC `get_ghost_layer_file`.
    pub fn get_file(&self, id: &str, path: &str) -> Option<FileDelta> {
        let guard = self.layers.lock().ok()?;
        let layer = guard.get(id)?;
        layer.find_file(path).cloned()
    }

    /// Remove one hunk from a file delta after the caller has patched main
    /// on disk. Returns the snapshot that was removed so callers can log /
    /// verify. Silently no-ops if the layer/file/hunk isn't registered.
    pub fn remove_hunk(
        &self,
        id: &str,
        file_path: &str,
        hunk_index: usize,
    ) -> Result<Option<super::layer::DiffHunk>, String> {
        let (taken, summary) = {
            let mut guard = self.lock_layers()?;
            let Some(layer) = guard.get_mut(id) else {
                return Ok(None);
            };
            let taken = match &mut layer.content {
                LayerContent::Diff { files, .. } => {
                    let Some(file) = files.iter_mut().find(|f| f.path == file_path) else {
                        return Ok(None);
                    };
                    if hunk_index >= file.hunks.len() {
                        return Ok(None);
                    }
                    let taken = file.hunks.remove(hunk_index);
                    // Drop files that ran out of hunks so the panel's file
                    // count reflects reality.
                    if file.hunks.is_empty() {
                        let orphan = file.path.clone();
                        files.retain(|f| f.path != orphan);
                    }
                    taken
                }
                // Snapshot layers carry no hunks — any remove request is a
                // category error from the caller. IPC already rejects via
                // `is_read_only`, but we handle it here too for safety.
                LayerContent::TerminalState { .. } => return Ok(None),
            };
            (taken, layer.summary())
        };
        let _ = self.tx.send(LayerEvent::Updated(summary));
        Ok(Some(taken))
    }

    /// Drop every hunk for a file — used by Shift+Tab / file-level accept
    /// after the caller has written the full `head_content` to main.
    pub fn clear_file_hunks(&self, id: &str, file_path: &str) -> Result<bool, String> {
        let (removed, summary) = {
            let mut guard = self.lock_layers()?;
            let Some(layer) = guard.get_mut(id) else {
                return Ok(false);
            };
            let removed = match &mut layer.content {
                LayerContent::Diff { files, .. } => {
                    let before = files.len();
                    files.retain(|f| f.path != file_path);
                    before != files.len()
                }
                // Snapshot layers have no per-file content.
                LayerContent::TerminalState { .. } => false,
            };
            (removed, layer.summary())
        };
        if removed {
            let _ = self.tx.send(LayerEvent::Updated(summary));
        }
        Ok(removed)
    }

    /// Drain pending events. Call from the main-thread poller.
    pub fn poll(&self) -> Vec<LayerEvent> {
        let mut events = Vec::new();
        if let Ok(rx) = self.rx.lock() {
            while let Ok(ev) = rx.try_recv() {
                events.push(ev);
            }
        }
        events
    }

    fn lock_layers(
        &self,
    ) -> Result<std::sync::MutexGuard<'_, HashMap<LayerId, Layer>>, String> {
        self.layers
            .lock()
            .map_err(|_| "ghostdiff layer lock poisoned".to_string())
    }
}

impl Default for LayerRegistry {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ghostdiff::layer::{DiffHunk, HunkLine};

    fn make_delta(path: &str) -> FileDelta {
        FileDelta {
            path: path.into(),
            hunks: vec![DiffHunk {
                base_start: 1,
                base_len: 1,
                head_start: 1,
                head_len: 2,
                lines: vec![
                    HunkLine::Remove("a".into()),
                    HunkLine::Add("b".into()),
                    HunkLine::Add("c".into()),
                ],
            }],
            base_content: "a".into(),
            head_content: "b\nc".into(),
        }
    }

    fn reg_layer(r: &LayerRegistry, id: &str, created_at: u64) {
        r.register_worktree_layer(
            id.into(),
            format!("/tmp/wt/{id}").into(),
            format!("branch/{id}"),
            "/tmp/repo".into(),
            LayerTint::auto_repair(),
            "abc123".into(),
            created_at,
        )
        .unwrap();
    }

    #[test]
    fn register_emits_updated_event() {
        let r = LayerRegistry::new();
        reg_layer(&r, "j1", 0);
        let events = r.poll();
        assert_eq!(events.len(), 1);
        match &events[0] {
            LayerEvent::Updated(s) => assert_eq!(s.id, "j1"),
            _ => panic!("expected Updated"),
        }
    }

    #[test]
    fn duplicate_register_rejected() {
        let r = LayerRegistry::new();
        reg_layer(&r, "j1", 0);
        let err = r
            .register_worktree_layer(
                "j1".into(),
                "/tmp/wt".into(),
                "b".into(),
                "/tmp/repo".into(),
                LayerTint::auto_repair(),
                "abc".into(),
                1,
            )
            .unwrap_err();
        assert!(err.contains("already registered"));
    }

    #[test]
    fn refresh_updates_files_and_emits_updated() {
        let r = LayerRegistry::new();
        reg_layer(&r, "j1", 0);
        let _ = r.poll();
        r.refresh("j1", vec![make_delta("a.ts"), make_delta("b.ts")])
            .unwrap();
        let events = r.poll();
        assert_eq!(events.len(), 1);
        match &events[0] {
            LayerEvent::Updated(s) => {
                assert_eq!(s.file_count, 2);
                assert_eq!(s.hunk_count, 2);
            }
            _ => panic!("expected Updated"),
        }
    }

    #[test]
    fn refresh_unknown_layer_is_noop() {
        let r = LayerRegistry::new();
        r.refresh("nope", vec![make_delta("a.ts")]).unwrap();
        assert!(r.poll().is_empty());
    }

    #[test]
    fn mark_complete_emits_completed_and_updated() {
        let r = LayerRegistry::new();
        reg_layer(&r, "j1", 0);
        let _ = r.poll();
        r.mark_complete("j1").unwrap();
        let events = r.poll();
        assert_eq!(events.len(), 2);
        assert!(matches!(events[0], LayerEvent::Completed(_)));
        match &events[1] {
            LayerEvent::Updated(s) => assert!(s.is_complete),
            _ => panic!("expected Updated"),
        }
    }

    #[test]
    fn mark_complete_is_idempotent() {
        let r = LayerRegistry::new();
        reg_layer(&r, "j1", 0);
        let _ = r.poll();
        r.mark_complete("j1").unwrap();
        let _ = r.poll();
        r.mark_complete("j1").unwrap();
        assert!(r.poll().is_empty());
    }

    #[test]
    fn unregister_emits_removed() {
        let r = LayerRegistry::new();
        reg_layer(&r, "j1", 0);
        let _ = r.poll();
        r.unregister("j1").unwrap();
        let events = r.poll();
        assert_eq!(events.len(), 1);
        assert!(matches!(&events[0], LayerEvent::Removed(id) if id == "j1"));
    }

    #[test]
    fn unregister_unknown_is_silent() {
        let r = LayerRegistry::new();
        r.unregister("nope").unwrap();
        assert!(r.poll().is_empty());
    }

    #[test]
    fn list_returns_stable_sorted_summaries() {
        let r = LayerRegistry::new();
        reg_layer(&r, "j2", 200);
        reg_layer(&r, "j1", 100);
        reg_layer(&r, "j3", 300);
        let list = r.list();
        let ids: Vec<_> = list.iter().map(|s| s.id.clone()).collect();
        assert_eq!(ids, vec!["j1", "j2", "j3"]);
    }

    #[test]
    fn source_snapshots_expose_base_sha() {
        let r = LayerRegistry::new();
        reg_layer(&r, "j1", 0);
        let snaps = r.source_snapshots();
        assert_eq!(snaps.len(), 1);
        assert_eq!(snaps[0].id, "j1");
        assert_eq!(snaps[0].base_sha, "abc123");
    }

    #[test]
    fn get_file_returns_clone() {
        let r = LayerRegistry::new();
        reg_layer(&r, "j1", 0);
        r.refresh("j1", vec![make_delta("a.ts")]).unwrap();
        assert!(r.get_file("j1", "a.ts").is_some());
        assert!(r.get_file("j1", "missing").is_none());
    }

    fn make_delta_two_hunks(path: &str) -> FileDelta {
        FileDelta {
            path: path.into(),
            hunks: vec![
                DiffHunk {
                    base_start: 1,
                    base_len: 1,
                    head_start: 1,
                    head_len: 1,
                    lines: vec![HunkLine::Remove("a".into()), HunkLine::Add("b".into())],
                },
                DiffHunk {
                    base_start: 10,
                    base_len: 1,
                    head_start: 10,
                    head_len: 1,
                    lines: vec![HunkLine::Remove("x".into()), HunkLine::Add("y".into())],
                },
            ],
            base_content: "a\n...\nx".into(),
            head_content: "b\n...\ny".into(),
        }
    }

    #[test]
    fn remove_hunk_drops_one_and_keeps_others() {
        let r = LayerRegistry::new();
        reg_layer(&r, "j1", 0);
        r.refresh("j1", vec![make_delta_two_hunks("a.ts")]).unwrap();
        let _ = r.poll();

        let taken = r.remove_hunk("j1", "a.ts", 0).unwrap();
        assert!(taken.is_some());
        let events = r.poll();
        assert_eq!(events.len(), 1);
        match &events[0] {
            LayerEvent::Updated(s) => {
                assert_eq!(s.hunk_count, 1);
                assert_eq!(s.file_count, 1);
            }
            _ => panic!("expected Updated"),
        }
    }

    #[test]
    fn remove_hunk_drops_empty_file_from_layer() {
        let r = LayerRegistry::new();
        reg_layer(&r, "j1", 0);
        r.refresh("j1", vec![make_delta("a.ts")]).unwrap();
        let _ = r.poll();

        let taken = r.remove_hunk("j1", "a.ts", 0).unwrap();
        assert!(taken.is_some());
        // No remaining hunks → file drops from the layer.
        let summaries = r.list();
        assert_eq!(summaries[0].file_count, 0);
    }

    #[test]
    fn remove_hunk_silent_on_unknown_layer() {
        let r = LayerRegistry::new();
        let taken = r.remove_hunk("nope", "a.ts", 0).unwrap();
        assert!(taken.is_none());
        assert!(r.poll().is_empty());
    }

    #[test]
    fn remove_hunk_silent_on_out_of_range_index() {
        let r = LayerRegistry::new();
        reg_layer(&r, "j1", 0);
        r.refresh("j1", vec![make_delta("a.ts")]).unwrap();
        let _ = r.poll();
        let taken = r.remove_hunk("j1", "a.ts", 99).unwrap();
        assert!(taken.is_none());
        assert!(r.poll().is_empty());
    }

    #[test]
    fn clear_file_hunks_drops_file_and_emits_updated() {
        let r = LayerRegistry::new();
        reg_layer(&r, "j1", 0);
        r.refresh(
            "j1",
            vec![make_delta_two_hunks("a.ts"), make_delta("b.ts")],
        )
        .unwrap();
        let _ = r.poll();

        let removed = r.clear_file_hunks("j1", "a.ts").unwrap();
        assert!(removed);
        let list = r.list();
        assert_eq!(list[0].file_count, 1);
        assert_eq!(list[0].file_paths, vec!["b.ts"]);
        let events = r.poll();
        assert_eq!(events.len(), 1);
        assert!(matches!(events[0], LayerEvent::Updated(_)));
    }

    #[test]
    fn clear_file_hunks_returns_false_on_missing_file() {
        let r = LayerRegistry::new();
        reg_layer(&r, "j1", 0);
        r.refresh("j1", vec![make_delta("a.ts")]).unwrap();
        let _ = r.poll();
        let removed = r.clear_file_hunks("j1", "missing.ts").unwrap();
        assert!(!removed);
        assert!(r.poll().is_empty());
    }

    // ─── Phase 3C-2 branch comparison ────────────────────────────────────

    #[test]
    fn register_branch_comparison_layer_and_mark_read_only() {
        let r = LayerRegistry::new();
        r.register_branch_comparison_layer(
            "bc1".into(),
            "/tmp/repo".into(),
            "main".into(),
            "feature/foo".into(),
            LayerTint::branch_comparison(),
            0,
        )
        .expect("register");
        assert!(r.contains("bc1"));
        assert!(r.is_read_only("bc1"));
        // Repo path is reachable (IPC needs it later for resolve_main_path).
        assert_eq!(
            r.repo_path("bc1")
                .map(|p| p.to_string_lossy().to_string()),
            Some("/tmp/repo".to_string())
        );
        // Branch comparisons are not fs-watched — no snapshot returned.
        assert!(r.get_source_snapshot("bc1").is_none());
        // Worktree layers remain unaffected.
        reg_layer(&r, "wt1", 1);
        assert!(!r.is_read_only("wt1"));
    }

    #[test]
    fn is_read_only_false_for_unknown_layer() {
        let r = LayerRegistry::new();
        // Missing layers must not look read-only (caller would then get a
        // confusing reject instead of "not found").
        assert!(!r.is_read_only("nope"));
    }

    #[test]
    fn source_snapshots_skip_branch_comparisons() {
        let r = LayerRegistry::new();
        reg_layer(&r, "wt1", 0);
        r.register_branch_comparison_layer(
            "bc1".into(),
            "/tmp/repo".into(),
            "main".into(),
            "feature".into(),
            LayerTint::branch_comparison(),
            1,
        )
        .unwrap();
        let snaps = r.source_snapshots();
        assert_eq!(snaps.len(), 1);
        assert_eq!(snaps[0].id, "wt1");
    }

    // ─── Phase 3C-3b snapshot overlays ────────────────────────────────────

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

    fn reg_snapshot(r: &LayerRegistry, id: &str, created_at: u64) {
        r.register_snapshot_layer(
            id.into(),
            format!("session-{id}"),
            format!("snap-id-{id}"),
            42,
            blank_grid(4, 2),
            LayerTint::snapshot(),
            created_at,
        )
        .unwrap();
    }

    #[test]
    fn register_snapshot_layer_marks_read_only_and_complete() {
        let r = LayerRegistry::new();
        reg_snapshot(&r, "s1", 10);
        assert!(r.contains("s1"));
        assert!(r.is_read_only("s1"));
        // No repo_path / worktree source → fs-watch skipped.
        assert!(r.get_source_snapshot("s1").is_none());
        assert!(r.repo_path("s1").is_none());
        let list = r.list();
        assert_eq!(list.len(), 1);
        assert!(list[0].is_complete);
        assert_eq!(list[0].file_count, 0);
        assert_eq!(list[0].hunk_count, 0);
    }

    #[test]
    fn register_snapshot_layer_rejects_duplicate_id() {
        let r = LayerRegistry::new();
        reg_snapshot(&r, "s1", 0);
        let err = r
            .register_snapshot_layer(
                "s1".into(),
                "session-x".into(),
                "snap-x".into(),
                0,
                blank_grid(2, 1),
                LayerTint::snapshot(),
                0,
            )
            .unwrap_err();
        assert!(err.contains("already registered"));
    }

    #[test]
    fn source_snapshots_skip_snapshot_overlays() {
        let r = LayerRegistry::new();
        reg_layer(&r, "wt1", 0);
        reg_snapshot(&r, "s1", 1);
        let snaps = r.source_snapshots();
        assert_eq!(snaps.len(), 1);
        assert_eq!(snaps[0].id, "wt1");
    }

    #[test]
    fn refresh_on_snapshot_layer_is_noop() {
        let r = LayerRegistry::new();
        reg_snapshot(&r, "s1", 0);
        let _ = r.poll(); // drain the register Updated event
        // Refresh with a bogus file delta must silently no-op — snapshot
        // content is immutable after registration.
        r.refresh("s1", vec![make_delta("a.ts")]).unwrap();
        assert!(r.poll().is_empty(), "snapshot refresh should emit nothing");
        // File count stays zero because the TerminalState content is unchanged.
        let list = r.list();
        assert_eq!(list[0].file_count, 0);
    }

    #[test]
    fn remove_hunk_on_snapshot_layer_returns_none() {
        let r = LayerRegistry::new();
        reg_snapshot(&r, "s1", 0);
        let taken = r.remove_hunk("s1", "any.ts", 0).unwrap();
        assert!(taken.is_none());
    }

    #[test]
    fn clear_file_hunks_on_snapshot_layer_returns_false() {
        let r = LayerRegistry::new();
        reg_snapshot(&r, "s1", 0);
        let removed = r.clear_file_hunks("s1", "any.ts").unwrap();
        assert!(!removed);
    }

    #[test]
    fn branch_comparison_register_rejects_duplicate_id() {
        let r = LayerRegistry::new();
        r.register_branch_comparison_layer(
            "bc1".into(),
            "/tmp/repo".into(),
            "main".into(),
            "feature".into(),
            LayerTint::branch_comparison(),
            0,
        )
        .unwrap();
        let err = r
            .register_branch_comparison_layer(
                "bc1".into(),
                "/tmp/repo".into(),
                "main".into(),
                "other".into(),
                LayerTint::branch_comparison(),
                0,
            )
            .unwrap_err();
        assert!(err.contains("already registered"));
    }
}
