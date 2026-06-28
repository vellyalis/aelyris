use std::sync::{Arc, Mutex};

use tauri::{AppHandle, Manager, State};

use crate::context_store::ContextStoreManager;
use crate::event_bus::EventBus;
use crate::file_ownership::FileOwnership;
use crate::merge_intent::store::MergeIntentStore;
use crate::shared_brain::{snapshot, SharedBrainInputs, SharedBrainSnapshot};
use crate::symbol_ownership::SymbolOwnership;

fn now_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

#[tauri::command]
pub fn shared_brain_snapshot(
    app: AppHandle,
    file_ownership: State<'_, Arc<Mutex<FileOwnership>>>,
    symbol_ownership: State<'_, Arc<Mutex<SymbolOwnership>>>,
    event_bus: State<'_, Arc<EventBus>>,
    context_store: State<'_, Arc<ContextStoreManager>>,
    merge_store: State<'_, Option<Arc<MergeIntentStore>>>,
) -> Result<SharedBrainSnapshot, String> {
    let workspace_id = app
        .path()
        .app_data_dir()
        .ok()
        .and_then(|path| path.to_str().map(str::to_string))
        .unwrap_or_else(|| "local".to_string());
    snapshot(SharedBrainInputs {
        workspace_id: &workspace_id,
        agents: super::agent_fleet_snapshot(&app),
        file_ownership: Some(file_ownership.inner()),
        symbol_ownership: Some(symbol_ownership.inner()),
        event_bus: Some(event_bus.inner()),
        context_store: Some(context_store.inner()),
        merge_store: merge_store.inner().as_ref(),
        now: now_secs(),
    })
}
