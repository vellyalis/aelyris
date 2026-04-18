//! Phase 3C-1a: IPC for the Ghost Diff Overlay.
//!
//! Exposes the `LayerRegistry` state (registered in `lib.rs`) to the
//! frontend — list layers, fetch per-file deltas, dismiss a layer, and
//! (stub for 3C-1c) apply a hunk back to the main worktree.

use std::sync::Arc;

use tauri::{AppHandle, Manager};

use crate::ghostdiff::{self, FileDelta, LayerRegistry, LayerSummary, WatcherPool};

/// All currently-active ghost layers (sorted oldest-first).
#[tauri::command]
pub fn list_ghost_layers(app: AppHandle) -> Vec<LayerSummary> {
    let Some(state) = app.try_state::<Arc<LayerRegistry>>() else {
        return Vec::new();
    };
    state.list()
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

/// 3C-1c stub: apply a single hunk from a ghost layer back to the main
/// worktree. Implemented in a later sub-phase; for now we fail loudly so
/// the frontend keybind wiring can be built and tested against a real IPC.
#[tauri::command]
pub fn apply_ghost_hunk(
    _app: AppHandle,
    _layer_id: String,
    _file_path: String,
    _hunk_index: u32,
) -> Result<(), String> {
    Err("apply_ghost_hunk is not implemented yet (Phase 3C-1c)".to_string())
}
