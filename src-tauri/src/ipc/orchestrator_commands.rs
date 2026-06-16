use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use serde_json::json;
use tauri::{AppHandle, Emitter, State};

use super::event_commands::publish_and_emit;
use crate::agent::AgentManager;
use crate::control::loop_ports::run_step;
use crate::cost::{CostManager, CostUsage};
use crate::event_bus::{AgentEvent, AgentEventKind, EventBus};
use crate::file_ownership::FileOwnership;
use crate::orchestrator::autonomy::StepReport;
use crate::orchestrator::{plan, DispatchPlan};
use crate::review::GateResults;
use crate::task::TaskManager;

/// The orchestrator's next scheduling decision for the live task graph: which
/// tasks to dispatch now (priority-ordered, concurrency-capped against the
/// caller-supplied `usage`) and where the autonomy loop stands
/// (`active`/`complete`/`stalled`/`halted_by_budget`).
///
/// Read-only and side-effect free — it drives the cockpit's loop view and lets
/// the orchestrator AI inspect the plan before dispatching. The actual
/// dispatch/review/merge pass is `orchestrator_step` below.
#[tauri::command]
pub fn orchestrator_plan(
    tasks: State<'_, Arc<TaskManager>>,
    cost: State<'_, Arc<CostManager>>,
    usage: CostUsage,
) -> DispatchPlan {
    let caps = cost.caps();
    tasks.read(|graph| plan(graph, &caps, &usage))
}

/// Drive one autonomy step over the live Task Graph (BR9): resolve reviews with
/// the caller-supplied gate verdicts into a real git merge, move finished agents
/// (process exit) `Running -> Review`, and dispatch ready tasks by spawning real
/// headless agents routed to each task owner's model. The loop logic lives in
/// `control::loop_ports::run_step`, shared with the MCP face; this command adds
/// the cockpit-side broadcasts: `task-graph-updated`, `orchestrator-step`, and a
/// `TaskCompleted` event per merged task.
// Five of the arguments are injected Tauri state (app/tasks/cost/agents/bus);
// only `usage`/`repo_path`/`reviewer_id`/`gates` are the caller's.
#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub fn orchestrator_step(
    app: AppHandle,
    tasks: State<'_, Arc<TaskManager>>,
    cost: State<'_, Arc<CostManager>>,
    agents: State<'_, AgentManager>,
    bus: State<'_, Arc<EventBus>>,
    ownership: State<'_, Arc<Mutex<FileOwnership>>>,
    usage: CostUsage,
    repo_path: String,
    reviewer_id: String,
    gates: HashMap<String, GateResults>,
) -> StepReport {
    let report = run_step(
        &tasks,
        &cost,
        &agents,
        &ownership,
        &bus,
        &usage,
        repo_path,
        reviewer_id,
        gates,
    );

    let _ = app.emit("task-graph-updated", tasks.list());
    let _ = app.emit("orchestrator-step", &report);
    for id in &report.merged {
        publish_and_emit(
            &app,
            &bus,
            AgentEvent::new(AgentEventKind::TaskCompleted, json!({ "id": id })),
        );
    }
    report
}
