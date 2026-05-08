//! Phase 3C-1a+1c+2: IPC for the Ghost Diff Overlay.
//!
//! Exposes the `LayerRegistry` state (registered in `lib.rs`) to the
//! frontend — list layers, fetch per-file deltas, dismiss a layer, accept
//! hunks back into the user's main worktree (3C-1c), and spin up read-only
//! branch-comparison overlays (3C-2).

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::ghostdiff::{
    self, FileDelta, LayerRegistry, LayerSnapshot, LayerSummary, LayerTint, WatcherPool,
};

/// Bootstrap response for the frontend's listener-arming contract: every
/// active layer plus the registry's monotonic event sequence. The
/// frontend filters incoming `ghost-diff:layer-*` events by comparing
/// their `seq` against this snapshot's `seq`, so events that already
/// reflect in the snapshot are dropped (avoiding duplicate apply) and
/// events that fired between the listener registering and this IPC
/// returning are still applied (no missed mutations).
#[tauri::command]
pub fn list_ghost_layers(app: AppHandle) -> LayerSnapshot {
    let Some(state) = app.try_state::<Arc<LayerRegistry>>() else {
        return LayerSnapshot {
            layers: Vec::new(),
            seq: 0,
        };
    };
    state.snapshot()
}

/// Fetch the full `FileDelta` for a single file inside a layer. Returns
/// `None` if the layer was dismissed or the file is no longer in the diff.
#[tauri::command]
pub fn get_ghost_layer_file(
    app: AppHandle,
    layer_id: String,
    file_path: String,
) -> Option<FileDelta> {
    let state = app.try_state::<Arc<LayerRegistry>>()?;
    state.get_file(&layer_id, &file_path)
}

/// Remove a ghost layer (user clicked "dismiss" or the session ended).
///
/// Both the registry entry and the fs watcher must be torn down here — the
/// auto-repair poller only syncs watchers for jobs it owns, so a manual
/// Dismiss on an orchestra-registered layer would otherwise leak the
/// notify thread.
#[tauri::command]
pub fn dismiss_ghost_layer(app: AppHandle, layer_id: String) -> Result<(), String> {
    let registry = app
        .try_state::<Arc<LayerRegistry>>()
        .ok_or_else(|| "LayerRegistry state missing".to_string())?;
    let pool = app
        .try_state::<Arc<WatcherPool>>()
        .ok_or_else(|| "WatcherPool state missing".to_string())?;
    ghostdiff::unregister_and_unwatch(registry.inner(), pool.inner(), &layer_id);
    Ok(())
}

/// Drop a single file from a ghost layer without touching main or the
/// layer's other files. Used by editor Esc — plan calls for dismissing
/// the current file's ghost paint without collateral damage to other
/// files tracked by the same layer.
#[tauri::command]
pub fn dismiss_ghost_file(
    app: AppHandle,
    layer_id: String,
    file_path: String,
) -> Result<bool, String> {
    let registry = app
        .try_state::<Arc<LayerRegistry>>()
        .ok_or_else(|| "LayerRegistry state missing".to_string())?;
    registry.clear_file_hunks(&layer_id, &file_path)
}

/// Result payload for `apply_ghost_hunk` / `apply_ghost_file`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyHunkResult {
    /// The main file's new content, so the frontend can push it into
    /// Monaco without a separate `read_file` round-trip.
    pub updated_content: String,
    /// Absolute path of the main file that was written.
    pub file_path: String,
    /// Remaining hunk count for this file in the layer after the apply.
    pub remaining_hunks: usize,
}

/// Accept a single ghost hunk back into the main worktree.
#[tauri::command]
pub fn apply_ghost_hunk(
    app: AppHandle,
    layer_id: String,
    file_path: String,
    hunk_index: u32,
) -> Result<ApplyHunkResult, String> {
    let registry = app
        .try_state::<Arc<LayerRegistry>>()
        .ok_or_else(|| "LayerRegistry state missing".to_string())?;

    // Phase 3C-2: read-only layers (e.g. branch comparisons) must refuse
    // apply operations — the source revision is not owned by the user.
    if registry.is_read_only(&layer_id) {
        return Err(format!("layer {layer_id} is read-only — apply is rejected"));
    }

    let delta = registry
        .get_file(&layer_id, &file_path)
        .ok_or_else(|| format!("ghost file not found: {layer_id}:{file_path}"))?;
    let hunk_idx = hunk_index as usize;
    let hunk = delta
        .hunks
        .get(hunk_idx)
        .ok_or_else(|| format!("hunk index {hunk_index} out of range"))?
        .clone();

    let repo_path = registry
        .repo_path(&layer_id)
        .ok_or_else(|| format!("layer {layer_id} has no repo path"))?;
    let target = resolve_main_path(&repo_path, &file_path)?;

    let current =
        std::fs::read_to_string(&target).map_err(|e| format!("read {}: {e}", target.display()))?;
    let patched = ghostdiff::apply::apply_hunk_to_main(&current, &hunk)?;
    std::fs::write(&target, &patched).map_err(|e| format!("write {}: {e}", target.display()))?;

    // Drop the applied hunk so the panel count + inline paint refresh.
    let _ = registry.remove_hunk(&layer_id, &file_path, hunk_idx);

    // Query remaining hunks on the fresh snapshot. `None` means the file
    // was removed entirely — treat as zero remaining.
    let remaining_hunks = registry
        .get_file(&layer_id, &file_path)
        .map(|d| d.hunks.len())
        .unwrap_or(0);

    Ok(ApplyHunkResult {
        updated_content: patched,
        file_path: target.to_string_lossy().into_owned(),
        remaining_hunks,
    })
}

/// Accept every hunk for a file at once (Shift+Tab) by writing the full
/// `head_content` to main and clearing the file from the layer.
#[tauri::command]
pub fn apply_ghost_file(
    app: AppHandle,
    layer_id: String,
    file_path: String,
) -> Result<ApplyHunkResult, String> {
    let registry = app
        .try_state::<Arc<LayerRegistry>>()
        .ok_or_else(|| "LayerRegistry state missing".to_string())?;

    if registry.is_read_only(&layer_id) {
        return Err(format!("layer {layer_id} is read-only — apply is rejected"));
    }

    let delta = registry
        .get_file(&layer_id, &file_path)
        .ok_or_else(|| format!("ghost file not found: {layer_id}:{file_path}"))?;

    let repo_path = registry
        .repo_path(&layer_id)
        .ok_or_else(|| format!("layer {layer_id} has no repo path"))?;
    let target = resolve_main_path(&repo_path, &file_path)?;

    std::fs::write(&target, &delta.head_content)
        .map_err(|e| format!("write {}: {e}", target.display()))?;

    let _ = registry.clear_file_hunks(&layer_id, &file_path);

    Ok(ApplyHunkResult {
        updated_content: delta.head_content,
        file_path: target.to_string_lossy().into_owned(),
        remaining_hunks: 0,
    })
}

/// Phase 3C-2: spin up a read-only overlay comparing `head_branch` against
/// the user's current `base_branch`. The registered layer shows up in the
/// panel alongside agent-owned layers but applies / Tab are rejected.
#[tauri::command]
pub fn start_branch_comparison(
    app: AppHandle,
    repo_path: String,
    base_branch: String,
    head_branch: String,
) -> Result<LayerSummary, String> {
    if base_branch == head_branch {
        return Err("base and head branches must differ".into());
    }
    let repo = PathBuf::from(&repo_path);
    if !repo.exists() {
        return Err(format!("repo path does not exist: {repo_path}"));
    }

    let registry = app
        .try_state::<Arc<LayerRegistry>>()
        .ok_or_else(|| "LayerRegistry state missing".to_string())?;

    let id = format!("branch-{}", uuid::Uuid::new_v4());
    let created_at = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);

    registry.register_branch_comparison_layer(
        id.clone(),
        repo.clone(),
        base_branch.clone(),
        head_branch.clone(),
        LayerTint::branch_comparison(),
        created_at,
    )?;

    // Populate the diff. On failure, roll back the empty registration so
    // the panel doesn't show a ghost that will never gain content.
    let deltas = match ghostdiff::diff_engine::compute_branch_comparison(
        &repo,
        &base_branch,
        &head_branch,
    ) {
        Ok(d) => d,
        Err(e) => {
            let _ = registry.unregister(&id);
            return Err(e);
        }
    };
    let _ = registry.refresh(&id, deltas);

    registry
        .list()
        .into_iter()
        .find(|s| s.id == id)
        .ok_or_else(|| "layer vanished immediately after registration".to_string())
}

/// Join `repo_path` and `file_path` safely — reject path traversal attempts.
fn resolve_main_path(repo_path: &Path, file_path: &str) -> Result<PathBuf, String> {
    if file_path.contains("..") {
        return Err(format!("rejecting traversal path: {file_path}"));
    }
    let mut out = repo_path.to_path_buf();
    for seg in file_path.split(&['/', '\\']).filter(|s| !s.is_empty()) {
        if seg == "." || seg == ".." {
            return Err(format!("rejecting traversal path: {file_path}"));
        }
        out.push(seg);
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolve_main_path_joins_segments() {
        let repo: PathBuf = "/tmp/repo".into();
        let p = resolve_main_path(&repo, "src/foo.ts").unwrap();
        assert_eq!(p, PathBuf::from("/tmp/repo/src/foo.ts"));
    }

    #[test]
    fn resolve_main_path_rejects_parent_traversal() {
        let repo: PathBuf = "/tmp/repo".into();
        assert!(resolve_main_path(&repo, "src/../../etc/passwd").is_err());
        assert!(resolve_main_path(&repo, "../etc/passwd").is_err());
    }

    #[test]
    fn resolve_main_path_accepts_backslash_separators() {
        let repo: PathBuf = "/tmp/repo".into();
        let p = resolve_main_path(&repo, "src\\foo.ts").unwrap();
        assert_eq!(p, PathBuf::from("/tmp/repo/src/foo.ts"));
    }
}
