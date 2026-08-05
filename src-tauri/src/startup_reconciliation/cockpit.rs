//! Restart resumption for the two cockpit-only post-merge boundaries.
//!
//! This module owns no durable truth. It consumes the packet/attempt facts that
//! `TaskManager`, `TaskRepo`, and the execution fence already own, then invokes
//! their idempotent settlement/finalization operations in authority order.

use super::*;

/// Resume only packet-authorized cockpit cleanup after the startup authority
/// audit has proved the durable world consistent. Each retry is idempotent:
/// worktree/branch deletion tolerates an earlier partial cleanup, ownership
/// deletion is keyed by Task, and the release event reuses the immutable packet
/// UUID as its Event Bus idempotency key.
pub fn resume_packet_backed_cockpit_finalizations(
    tasks: &TaskManager,
    db: &ManagedDb,
    ownership: &Arc<Mutex<FileOwnership>>,
    symbol_ownership: &Arc<Mutex<SymbolOwnership>>,
    events: &Arc<EventBus>,
) -> Result<usize, String> {
    let mut task_ids = tasks
        .list()
        .into_iter()
        .map(|task| task.id)
        .collect::<Vec<_>>();
    task_ids.sort();
    let mut resumed = 0usize;
    for task_id in task_ids {
        let Some((activation, packet)) = tasks
            .pending_cockpit_finalization(&task_id)
            .map_err(|error| error.to_string())?
        else {
            continue;
        };
        crate::control::loop_ports::finalize_settled_cockpit_task(
            tasks,
            db,
            ownership,
            symbol_ownership,
            events,
            &activation,
            &packet,
        )?;
        resumed = resumed.saturating_add(1);
    }
    Ok(resumed)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct StartupCockpitResumeReport {
    pub settlements: usize,
    pub finalizations: usize,
}

/// Resume the two post-merge cockpit boundaries in authority order. A Task with
/// a durable merge receipt but no packet is first handed to `TaskManager`'s
/// existing settlement owner; only the resulting immutable work packet may then
/// authorize resource cleanup and the Finalization fence. The second pass also
/// recovers Tasks whose packet was already durable before the crash.
pub fn resume_cockpit_settlements_and_finalizations(
    tasks: &TaskManager,
    db: &ManagedDb,
    ownership: &Arc<Mutex<FileOwnership>>,
    symbol_ownership: &Arc<Mutex<SymbolOwnership>>,
    events: &Arc<EventBus>,
) -> Result<StartupCockpitResumeReport, String> {
    let mut task_ids = tasks
        .list()
        .into_iter()
        .map(|task| task.id)
        .collect::<Vec<_>>();
    task_ids.sort();
    let mut settlements = 0usize;
    let mut finalizations = 0usize;
    for task_id in &task_ids {
        let Some(attempt) = tasks.current_execution(task_id) else {
            continue;
        };
        if !tasks.is_resumable_cockpit_settlement(&attempt)? {
            continue;
        }
        let activation = tasks
            .mission_activation_for_task(task_id)
            .map_err(|error| error.to_string())?
            .ok_or_else(|| {
                format!("resumable cockpit settlement lost activation for task {task_id}")
            })?;
        let outcome = tasks
            .settle_cockpit_task(task_id)
            .map_err(|error| error.to_string())?;
        crate::control::loop_ports::finalize_settled_cockpit_task(
            tasks,
            db,
            ownership,
            symbol_ownership,
            events,
            &activation,
            &outcome.work_packet,
        )?;
        settlements = settlements.saturating_add(1);
        finalizations = finalizations.saturating_add(1);
    }
    finalizations = finalizations.saturating_add(resume_packet_backed_cockpit_finalizations(
        tasks,
        db,
        ownership,
        symbol_ownership,
        events,
    )?);
    Ok(StartupCockpitResumeReport {
        settlements,
        finalizations,
    })
}
