//! Ghost Diff Overlay (Phase 3C-1).
//!
//! Produces "layers" — per-worktree diff overlays — that the editor can
//! paint as inline ghost lines. The module is split into:
//!
//! - [`layer`] — pure data types (`Layer`, `FileDelta`, `DiffHunk`, ...)
//! - [`diff_engine`] — compute a worktree's diff against its HEAD
//! - [`registry`] — thread-safe `LayerRegistry` keyed by session/job id
//! - [`watcher`] — per-layer fs watcher that triggers refreshes
//!
//! Public surface kept small: callers register a worktree, the registry
//! keeps the diff fresh, and the frontend subscribes via IPC events.

pub mod apply;
pub mod diff_engine;
pub mod layer;
pub mod registry;
pub mod watcher;

use std::path::PathBuf;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

pub use layer::{
    DiffHunk, FileDelta, HunkLine, Layer, LayerContent, LayerId, LayerSource, LayerSummary,
    LayerTint,
};
pub use registry::{LayerEvent, LayerRegistry, LayerSourceSnapshot};
pub use watcher::WatcherPool;

/// Convenience wiring: register a worktree-backed layer, spawn its fs
/// watcher (which will refresh the diff on every debounced event), and run
/// one initial `compute_diff` so the UI sees the layer populated even
/// before the agent writes anything.
///
/// Used by both `AutoRepairManager` polling (lib.rs) and the orchestra
/// spawn IPC. On any error the partial state is cleaned up.
pub fn register_worktree_and_watch(
    registry: &Arc<LayerRegistry>,
    pool: &Arc<WatcherPool>,
    id: LayerId,
    worktree_path: PathBuf,
    branch: String,
    repo_path: PathBuf,
    tint: LayerTint,
) -> Result<(), String> {
    let base_sha = diff_engine::capture_head_sha(&repo_path)?;
    let created_at = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);

    registry.register_worktree_layer(
        id.clone(),
        worktree_path.clone(),
        branch,
        repo_path,
        tint,
        base_sha,
        created_at,
    )?;

    // Watcher callback: compute diff + push into registry on every change.
    let reg_clone = registry.clone();
    let on_change: watcher::OnChange = Arc::new(move |layer_id: &str| {
        let Some(snap) = reg_clone.get_source_snapshot(layer_id) else {
            return;
        };
        match diff_engine::compute_diff(&snap.worktree_path, &snap.base_sha) {
            Ok(deltas) => {
                let _ = reg_clone.refresh(layer_id, deltas);
            }
            Err(e) => {
                log::warn!("ghostdiff refresh failed for {layer_id}: {e}");
            }
        }
    });

    if let Err(e) = pool.watch(id.clone(), worktree_path.clone(), on_change) {
        // Rollback the registry entry so the UI doesn't show a ghost layer
        // whose worktree isn't actually being watched.
        let _ = registry.unregister(&id);
        return Err(e);
    }

    // Initial diff so the panel shows content immediately.
    if let Some(snap) = registry.get_source_snapshot(&id) {
        match diff_engine::compute_diff(&snap.worktree_path, &snap.base_sha) {
            Ok(deltas) => {
                let _ = registry.refresh(&id, deltas);
            }
            Err(e) => {
                log::warn!("ghostdiff initial diff failed for {id}: {e}");
            }
        }
    }

    Ok(())
}

/// Stop watching a layer and remove it from the registry.
///
/// Order matters: registry unregister *first*, then watcher unwatch. An
/// in-flight debounced fs event can fire the watcher's `on_change` callback
/// in the narrow window before the `Debouncer` is dropped; by removing the
/// registry entry first, `get_source_snapshot(id)` returns `None` and the
/// callback becomes a silent no-op instead of running `git diff` against a
/// worktree that's about to be `rm -rf`'d.
pub fn unregister_and_unwatch(
    registry: &Arc<LayerRegistry>,
    pool: &Arc<WatcherPool>,
    id: &str,
) {
    let _ = registry.unregister(id);
    pool.unwatch(id);
}
