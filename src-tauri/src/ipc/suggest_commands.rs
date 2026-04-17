//! Phase 3A-2: IPC for the fish-style command suggestion engine.
//!
//! Frontend calls `suggest_next(prefix)` on every keystroke while the user
//! is composing a command. The engine is pre-seeded from DB history at
//! startup (see `lib.rs::setup`) and kept live by `suggest_record(cmd)`
//! which `save_command_history` calls internally on every Enter.

use std::sync::{Arc, Mutex};

use tauri::{AppHandle, Manager};

use crate::suggest::SuggestEngine;

/// Return the completion suffix for `prefix`, or `None` if nothing matches.
/// Cheap (single mutex lock); safe to call per-keystroke.
#[tauri::command]
pub fn suggest_next(app: AppHandle, prefix: String) -> Option<String> {
    let state = app.try_state::<Arc<Mutex<SuggestEngine>>>()?;
    let guard = state.inner().lock().ok()?;
    guard.suggest(&prefix)
}

/// Record a command into the engine so the next prefix match can include it.
/// `save_command_history` already calls this internally, but exposing the
/// command lets tests and the frontend force a record without writing to DB.
#[tauri::command]
pub fn suggest_record(app: AppHandle, command: String) -> Result<(), String> {
    let state = app
        .try_state::<Arc<Mutex<SuggestEngine>>>()
        .ok_or_else(|| "SuggestEngine state missing".to_string())?;
    let mut guard = state
        .inner()
        .lock()
        .map_err(|_| "SuggestEngine mutex poisoned".to_string())?;
    guard.record(&command);
    Ok(())
}
