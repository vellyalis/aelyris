//! Phase 3B-2 — IPC surface for semantic history search.
//!
//! The store itself runs in a dedicated thread pool-free environment; every
//! IPC call just forwards to `HistoryStore` which holds its own connection.

use tauri::{AppHandle, Manager};

use crate::history::{SearchFilters, SearchHit};
use crate::ManagedHistoryStore;

/// Semantic search over command history. Returns up to `limit` hits sorted by
/// cosine similarity (descending); ties broken by most-recent.
#[tauri::command]
pub fn semantic_search_history(
    app: AppHandle,
    query: String,
    limit: usize,
    filters: Option<SearchFilters>,
) -> Result<Vec<SearchHit>, String> {
    let store = app
        .try_state::<ManagedHistoryStore>()
        .ok_or_else(|| "HistoryStore unavailable".to_string())?;
    let filters = filters.unwrap_or_default();
    store.inner().search(&query, limit.clamp(1, 200), &filters)
}

/// Force a backfill of unindexed command_history rows. Runs on the calling
/// thread — cheap for small deltas, so the frontend can call it after a
/// long-running agent session completes to flush the queue.
#[tauri::command]
pub fn rebuild_history_index(app: AppHandle) -> Result<usize, String> {
    let store = app
        .try_state::<ManagedHistoryStore>()
        .ok_or_else(|| "HistoryStore unavailable".to_string())?;
    store.inner().backfill()
}
