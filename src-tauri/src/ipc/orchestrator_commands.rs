use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use serde_json::json;
use tauri::{AppHandle, Emitter, Manager, State};

use super::event_commands::publish_and_emit;
use crate::context_store::ContextStoreManager;
use crate::control::loop_ports::{run_step_visible, PANE_COLS, PANE_ROWS};
use crate::control::pane_fleet::PaneFleet;
use crate::cost::{CostManager, CostUsage};
use crate::event_bus::{AgentEvent, AgentEventKind, EventBus};
use crate::file_ownership::FileOwnership;
use crate::orchestrator::autonomy::StepReport;
use crate::orchestrator::{plan, DispatchPlan};
use crate::pty::PtyManager;
use crate::review::GateResults;
use crate::symbol_ownership::SymbolOwnership;
use crate::task::TaskManager;
use crate::term::NativeTerminalRegistry;

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
/// (PTY exit) `Running -> Review`, and dispatch ready tasks by spawning each in a
/// **visible PTY pane** (1 pane = 1 agent) routed to its owner's model. The loop
/// logic lives in `control::loop_ports::run_step_visible`; this command adds the
/// cockpit-side broadcasts: `task-graph-updated`, `orchestrator-step`, and a
/// `TaskCompleted` event per merged task. (The MCP face keeps the headless
/// `run_step`.)
// Six of the arguments are injected Tauri state (app/tasks/cost/fleet/bus/...);
// only `usage`/`repo_path`/`reviewer_id`/`gates` are the caller's.
#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub fn orchestrator_step(
    app: AppHandle,
    tasks: State<'_, Arc<TaskManager>>,
    cost: State<'_, Arc<CostManager>>,
    fleet: State<'_, PaneFleet>,
    bus: State<'_, Arc<EventBus>>,
    ownership: State<'_, Arc<Mutex<FileOwnership>>>,
    symbol_ownership: State<'_, Arc<Mutex<SymbolOwnership>>>,
    context: State<'_, Arc<ContextStoreManager>>,
    merge_store: State<'_, Option<Arc<crate::merge_intent::store::MergeIntentStore>>>,
    usage: CostUsage,
    repo_path: String,
    reviewer_id: String,
    gates: HashMap<String, GateResults>,
) -> StepReport {
    let report = run_step_visible(
        &tasks,
        &cost,
        &fleet,
        &ownership,
        Some(symbol_ownership.inner().clone()),
        &bus,
        &context,
        &usage,
        repo_path,
        reviewer_id,
        gates,
        // The cockpit face supplies reviewer verdicts directly; mechanical gate
        // commands are an MCP-face (autonomous) opt-in.
        None,
        merge_store.inner().clone(),
        // P4 (Supervisor 実体): the loop driver durably records every give-up (a
        // retry budget exhausted -> Failed) to the audit journal, so a Failed
        // task survives restart instead of living only in the volatile Event Bus
        // ring. ManagedDb is always managed (file, or in-memory fallback).
        Some(app.state::<crate::db::ManagedDb>().inner()),
    );

    // Make each freshly dispatched agent visible: the loop spawned its PTY
    // through PaneFleet; connect that terminal to the frontend (native engine +
    // render monitor) and announce it as `AgentSpawned` so the cockpit fleet
    // grid mounts a live pane per agent (1 pane = 1 agent). Errors here only
    // affect the picture, never the loop's own completion/recovery.
    if !report.dispatched.is_empty() {
        let pty = app.state::<PtyManager>().inner().clone();
        let native_registry = app.state::<Arc<NativeTerminalRegistry>>().inner().clone();
        for task_id in &report.dispatched {
            let Some(terminal_id) = fleet.terminal_of(task_id) else {
                continue;
            };
            let model = tasks
                .read(|graph| graph.get(task_id).and_then(|task| task.agent_model()))
                .unwrap_or_else(|| "sonnet".to_string());
            super::interactive_commands::spawn_loop_pane_render(
                &app,
                &pty,
                native_registry.clone(),
                terminal_id.clone(),
                PANE_COLS,
                PANE_ROWS,
            );
            publish_and_emit(
                &app,
                &bus,
                AgentEvent::new(
                    AgentEventKind::AgentSpawned,
                    json!({ "taskId": task_id, "terminalId": terminal_id, "model": model }),
                ),
            );
        }
    }

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
