use std::collections::BTreeMap;

use tauri::{AppHandle, Emitter, State};

use crate::context_store::{ContextStoreManager, DecisionChange};

/// The per-change ADR event (BR6) and a full-snapshot event for hydration.
const DECISION_CHANGED: &str = "decision-changed";
const CONTEXT_STORE_UPDATED: &str = "context-store-updated";

fn broadcast(app: &AppHandle, manager: &ContextStoreManager, change: &DecisionChange) {
    let _ = app.emit(DECISION_CHANGED, change);
    let _ = app.emit(CONTEXT_STORE_UPDATED, manager.all());
}

/// Set a shared decision. Broadcasts `DECISION_CHANGED` only on a real change;
/// returns the change (or `None` on an identical no-op).
#[tauri::command]
pub fn context_set(
    app: AppHandle,
    manager: State<'_, ContextStoreManager>,
    key: String,
    value: String,
) -> Option<DecisionChange> {
    let change = manager.set(key, value);
    if let Some(ref change) = change {
        broadcast(&app, &manager, change);
    }
    change
}

#[tauri::command]
pub fn context_get(manager: State<'_, ContextStoreManager>, key: String) -> Option<String> {
    manager.get(&key)
}

#[tauri::command]
pub fn context_all(manager: State<'_, ContextStoreManager>) -> BTreeMap<String, String> {
    manager.all()
}

#[tauri::command]
pub fn context_remove(
    app: AppHandle,
    manager: State<'_, ContextStoreManager>,
    key: String,
) -> Option<DecisionChange> {
    let change = manager.remove(&key);
    if let Some(ref change) = change {
        broadcast(&app, &manager, change);
    }
    change
}
