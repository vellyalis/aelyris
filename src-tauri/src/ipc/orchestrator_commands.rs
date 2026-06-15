use std::sync::Arc;

use tauri::State;

use crate::cost::{CostManager, CostUsage};
use crate::orchestrator::{plan, DispatchPlan};
use crate::task::TaskManager;

/// The orchestrator's next scheduling decision for the live task graph: which
/// tasks to dispatch now (priority-ordered, concurrency-capped against the
/// caller-supplied `usage`) and where the autonomy loop stands
/// (`active`/`complete`/`stalled`/`halted_by_budget`).
///
/// Read-only and side-effect free — it drives the cockpit's loop view and lets
/// the orchestrator AI inspect the plan before dispatching. The actual
/// dispatch/review/merge pass (`orchestrator::autonomy::step`/`run`) is driven
/// by the runtime loop once the concrete I/O ports are wired (BR9).
#[tauri::command]
pub fn orchestrator_plan(
    tasks: State<'_, TaskManager>,
    cost: State<'_, Arc<CostManager>>,
    usage: CostUsage,
) -> DispatchPlan {
    let caps = cost.caps();
    tasks.read(|graph| plan(graph, &caps, &usage))
}
