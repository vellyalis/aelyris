use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use tauri::State;

use crate::db::ManagedDb;
use crate::file_ownership::{FileOwnership, OwnershipClaim, OwnershipConflict};
use crate::persistence::OwnershipRepo;

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn lock(state: &Mutex<FileOwnership>) -> std::sync::MutexGuard<'_, FileOwnership> {
    state
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Assign a path pattern to an agent and return the resulting cross-agent
/// conflicts so the Planner sees collisions up front (BR8). Thin pass-through
/// over the tested FileOwnership core.
#[tauri::command]
pub fn ownership_assign(
    state: State<'_, Arc<Mutex<FileOwnership>>>,
    db: State<'_, ManagedDb>,
    agent_id: String,
    pattern: String,
) -> Result<Vec<OwnershipConflict>, String> {
    let claim = OwnershipClaim::new(agent_id, pattern);
    db.with(|d| OwnershipRepo::upsert_file_claim(d, &claim, now_secs()))?;
    let mut owner = lock(&state);
    owner.assign_claim(claim);
    Ok(owner.conflicts())
}

/// The agent that owns `path` (first matching claim), if any.
#[tauri::command]
pub fn ownership_owner_of(
    state: State<'_, Arc<Mutex<FileOwnership>>>,
    path: String,
) -> Option<String> {
    lock(&state).owner_of(&path).map(str::to_string)
}

/// All current ownership claims.
#[tauri::command]
pub fn ownership_claims(
    state: State<'_, Arc<Mutex<FileOwnership>>>,
    db: State<'_, ManagedDb>,
) -> Result<Vec<OwnershipClaim>, String> {
    let now = now_secs();
    db.with(|d| OwnershipRepo::prune_expired(d, now).map(|_| ()))?;
    let mut owner = lock(&state);
    owner.expire(now);
    Ok(owner.claims().to_vec())
}

/// All current cross-agent ownership conflicts.
#[tauri::command]
pub fn ownership_conflicts(state: State<'_, Arc<Mutex<FileOwnership>>>) -> Vec<OwnershipConflict> {
    lock(&state).conflicts()
}
