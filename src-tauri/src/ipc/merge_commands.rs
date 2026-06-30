//! Merge-queue IPC: list pending durable merge intents, request + approve a
//! durable intent, and fetch a capped three-dot review diff.
//!
//! These are thin wrappers over `control::merge` and `git::diff_three_dot` —
//! the merge logic (OID binding, CAS claim, StaleTips/NeedsReconcile guards)
//! already lives there and on the MCP face. The durable store is held in app
//! state as `Option<Arc<MergeIntentStore>>`; we fail closed with a clear error
//! when it is not attached (mirrors `aelyris.request_merge` in the MCP face)
//! rather than silently no-op, so a restart-lost RAM path can't reopen.

use std::sync::Arc;

use tauri::State;

use crate::control::merge::DurableMergeExecution;
use crate::merge_intent::store::MergeIntentStore;
use crate::merge_intent::MergeIntent;

/// Hard cap on the previewed three-dot patch so a huge branch can't flood the
/// webview. Matches the spirit of the byte-capped `diff_three_dot`.
const MERGE_DIFF_MAX_BYTES: usize = 200_000;

fn now_secs_i64() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

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

/// Request a durable, OID-bound merge intent for a done branch. Captures the
/// branch tips at request time so approval can never be re-pointed.
#[tauri::command]
pub fn request_merge_intent(
    merge_store: State<'_, Option<Arc<MergeIntentStore>>>,
    repo_path: String,
    task_id: String,
    session_id: Option<String>,
    source_branch: String,
    target_branch: String,
) -> Result<MergeIntent, String> {
    let store = require_store(&merge_store)?;
    // Snapshot any uncommitted worktree edits onto the source branch BEFORE
    // binding OIDs. A finished agent often leaves work uncommitted; without this
    // the intent would bind the pre-work tip and an approve would see an empty /
    // AlreadyMerged merge while the real change sits only in the worktree. The
    // loop/review paths commit first for the same reason. Best-effort: a commit
    // hiccup just leaves the existing tip, which is still bound correctly.
    let _ = crate::control::worktree::commit_for_branch(
        &repo_path,
        &source_branch,
        &format!("aelyris: merge request {source_branch}"),
    );
    crate::control::merge::request_durable_intent(
        &store,
        &repo_path,
        &task_id,
        session_id.as_deref(),
        &source_branch,
        &target_branch,
        now_secs_i64(),
    )
}

/// Approve a durable merge intent: OID-bound, CAS-claimed merge. The Err string
/// surfaces StaleTips / NeedsReconcile / not-claimable outcomes so the UI can
/// tell the operator the merge did not land, instead of assuming success.
#[tauri::command]
pub fn approve_merge_intent(
    merge_store: State<'_, Option<Arc<MergeIntentStore>>>,
    intent_id: String,
    reviewer_id: String,
    gates_digest: Option<String>,
) -> Result<DurableMergeExecution, String> {
    let store = require_store(&merge_store)?;
    crate::control::merge::approve_durable_intent(
        &store,
        &intent_id,
        &reviewer_id,
        gates_digest.as_deref(),
        now_secs_i64(),
    )
    .map_err(|err| err.to_string())
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
