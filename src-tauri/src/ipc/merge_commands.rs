//! Read-only merge-queue IPC: list pending durable merge intents and fetch a
//! capped three-dot review diff. Raw request/approve handlers were retired when
//! exact-candidate review became the only generic cockpit merge authority.
//!
//! These are thin wrappers over `control::merge` and `git::diff_three_dot` —
//! the merge logic (OID binding, CAS claim, StaleTips/NeedsReconcile guards)
//! already lives there and on the MCP face. The durable store is held in app
//! state as `Option<Arc<MergeIntentStore>>`; we fail closed with a clear error
//! when it is not attached. The raw MCP request verb is retired; this module
//! retains only read-side projections over intents minted by trusted owners.
//! rather than silently no-op, so a restart-lost RAM path can't reopen.

use std::sync::Arc;

use tauri::State;

use crate::merge_intent::store::MergeIntentStore;
use crate::merge_intent::MergeIntent;

/// Hard cap on the previewed three-dot patch so a huge branch can't flood the
/// webview. Matches the spirit of the byte-capped `diff_three_dot`.
const MERGE_DIFF_MAX_BYTES: usize = 200_000;

fn require_store(
    store: &State<'_, Option<Arc<MergeIntentStore>>>,
) -> Result<Arc<MergeIntentStore>, String> {
    store
        .inner()
        .clone()
        .ok_or_else(|| "merge persistence is not attached".to_string())
}

/// List durable merge intents that have not reached a clean terminal state.
#[tauri::command]
pub fn merge_intents_pending(
    merge_store: State<'_, Option<Arc<MergeIntentStore>>>,
) -> Result<Vec<MergeIntent>, String> {
    let store = require_store(&merge_store)?;
    store.list_unresolved()
}

/// Capped three-dot review diff (`base...branch`) for previewing a merge before
/// requesting it. Read-only; never mutates the repo.
#[tauri::command]
pub fn merge_diff(
    repo_path: String,
    base: String,
    branch: String,
    max_bytes: Option<usize>,
) -> Result<String, String> {
    crate::git::diff_three_dot(
        &repo_path,
        &base,
        &branch,
        max_bytes.unwrap_or(MERGE_DIFF_MAX_BYTES),
    )
}
