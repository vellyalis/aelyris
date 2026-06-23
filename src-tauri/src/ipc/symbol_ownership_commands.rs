//! Symbol Ownership IPC — the operator/cockpit surface over the tested
//! [`SymbolOwnership`] core. Thin pass-throughs (the logic + tests live in
//! `crate::symbol_ownership`); these only translate the Tauri boundary
//! (flat args + clock `now`) into the pure core calls.

use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{SystemTime, UNIX_EPOCH};

use tauri::State;

use crate::symbol_ownership::{
    ClaimMode, ClaimOutcome, Confidence, SymbolClaim, SymbolConflict, SymbolOwnership, SymbolRange,
};

/// Default lease for a claim that does not specify one (seconds). Short enough
/// that a crashed agent's lane self-releases promptly, long enough to survive a
/// normal edit/refresh cycle.
const DEFAULT_LEASE_SECS: u64 = 300;

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn lock(state: &Mutex<SymbolOwnership>) -> MutexGuard<'_, SymbolOwnership> {
    state
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Record a symbol claim and return the outcome (`granted` / `warned` /
/// `blocked`). The lease is computed here from `now + leaseSecs` so the pure core
/// stays clock-free. A `blocked` outcome means the claim was NOT recorded.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn symbol_claim(
    state: State<'_, Arc<Mutex<SymbolOwnership>>>,
    claim_id: String,
    agent_id: String,
    task_id: Option<String>,
    path: String,
    symbol: String,
    start_line: u32,
    end_line: u32,
    mode: ClaimMode,
    confidence: Confidence,
    lease_secs: Option<u64>,
) -> ClaimOutcome {
    let now = now_secs();
    let claim = SymbolClaim {
        claim_id,
        agent_id,
        task_id,
        path,
        symbol,
        range: SymbolRange::new(start_line, end_line),
        mode,
        lease_expires_at: now.saturating_add(lease_secs.unwrap_or(DEFAULT_LEASE_SECS)),
        confidence,
    };
    lock(&state).claim(claim, now)
}

/// Extend a live claim's lease (the heartbeat/refresh signal). Returns whether a
/// live claim with `claimId` was found.
#[tauri::command]
pub fn symbol_refresh(
    state: State<'_, Arc<Mutex<SymbolOwnership>>>,
    claim_id: String,
    lease_secs: Option<u64>,
) -> bool {
    let now = now_secs();
    lock(&state).refresh(&claim_id, now, lease_secs.unwrap_or(DEFAULT_LEASE_SECS))
}

/// Drop a claim by id; returns whether one was removed.
#[tauri::command]
pub fn symbol_release(state: State<'_, Arc<Mutex<SymbolOwnership>>>, claim_id: String) -> bool {
    lock(&state).release(&claim_id)
}

/// Release every claim a task held (call on merge/fail). Returns the count freed.
#[tauri::command]
pub fn symbol_release_task(
    state: State<'_, Arc<Mutex<SymbolOwnership>>>,
    task_id: String,
) -> usize {
    lock(&state).release_for_task(&task_id)
}

/// All live claims (lease not lapsed) — the per-agent / per-file view the cockpit
/// renders. Expired claims are swept first so the snapshot is current.
#[tauri::command]
pub fn symbol_claims(state: State<'_, Arc<Mutex<SymbolOwnership>>>) -> Vec<SymbolClaim> {
    let now = now_secs();
    let mut owner = lock(&state);
    owner.expire(now);
    owner.live_claims(now).into_iter().cloned().collect()
}

/// All live cross-agent overlaps (Block + Warn) — what the UI conflict badge and
/// the scheduler's pre-dispatch check read.
#[tauri::command]
pub fn symbol_conflicts(state: State<'_, Arc<Mutex<SymbolOwnership>>>) -> Vec<SymbolConflict> {
    let now = now_secs();
    let mut owner = lock(&state);
    owner.expire(now);
    owner.conflicts(now)
}
