use std::collections::BTreeMap;
use std::sync::Arc;

use serde_json::json;
use tauri::{AppHandle, Emitter, State};

use super::event_commands::publish_and_emit;
use crate::context_store::{ContextStoreManager, DecisionChange};
use crate::event_bus::{AgentEvent, AgentEventKind, EventBus};

/// A full-snapshot event for store hydration.
const CONTEXT_STORE_UPDATED: &str = "context-store-updated";

/// A real ADR change (BR6) flows through the Event Bus as a `DECISION_CHANGED`
/// event (unified fleet feed) and emits a full snapshot for the store hook.
fn broadcast(
    app: &AppHandle,
    bus: &EventBus,
    manager: &ContextStoreManager,
    change: &DecisionChange,
) {
    let payload = serde_json::to_value(change).unwrap_or(json!(null));
    publish_and_emit(
        app,
        bus,
        AgentEvent::new(AgentEventKind::DecisionChanged, payload),
    );
    let _ = app.emit(CONTEXT_STORE_UPDATED, manager.all());
}

/// Set a shared decision. Broadcasts `DECISION_CHANGED` only on a real change;
/// returns the change (or `None` on an identical no-op).
#[tauri::command]
pub fn context_set(
    app: AppHandle,
    manager: State<'_, Arc<ContextStoreManager>>,
    bus: State<'_, Arc<EventBus>>,
    key: String,
    value: String,
) -> Result<Option<DecisionChange>, String> {
    let change = manager.set(key, value)?;
    if let Some(ref change) = change {
        broadcast(&app, &bus, &manager, change);
    }
    Ok(change)
}

#[tauri::command]
pub fn context_get(manager: State<'_, Arc<ContextStoreManager>>, key: String) -> Option<String> {
    manager.get(&key)
}

#[tauri::command]
pub fn context_all(manager: State<'_, Arc<ContextStoreManager>>) -> BTreeMap<String, String> {
    manager.all()
}

#[tauri::command]
pub fn context_remove(
    app: AppHandle,
    manager: State<'_, Arc<ContextStoreManager>>,
    bus: State<'_, Arc<EventBus>>,
    key: String,
) -> Result<Option<DecisionChange>, String> {
    let change = manager.remove(&key)?;
    if let Some(ref change) = change {
        broadcast(&app, &bus, &manager, change);
    }
    Ok(change)
}
