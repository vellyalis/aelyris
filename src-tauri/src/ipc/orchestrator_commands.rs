use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use serde_json::json;
use tauri::{AppHandle, Emitter, Manager, State};

use super::event_commands::publish_and_emit;
use crate::context_store::ContextStoreManager;
use crate::control::loop_ports::{
    freeze_and_test_mission_candidate, run_step_visible, PANE_COLS, PANE_ROWS,
};
use crate::control::pane_fleet::PaneFleet;
use crate::cost::{CostManager, CostUsage};
use crate::event_bus::{AgentEvent, AgentEventKind, EventBus};
use crate::file_ownership::FileOwnership;
use crate::orchestrator::autonomy::StepReport;
use crate::orchestrator::{plan, DispatchPlan};
use crate::pty::PtyManager;
use crate::review::GateResults;
use crate::startup_reconciliation::StartupReconciliationState;
use crate::symbol_ownership::SymbolOwnership;
use crate::task::{MissionGateEvidence, MissionPlanActivation, TaskManager};
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
    startup: State<'_, Arc<StartupReconciliationState>>,
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
) -> Result<StepReport, String> {
    let event_repo_path = repo_path.clone();
    let report = run_step_visible(
        &startup,
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
        None,
    )?;
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
                    json!({
                        "taskId": task_id,
                        "terminalId": terminal_id,
                        "model": model,
                        "repoPath": &event_repo_path,
                    }),
                ),
            )?;
        }
    }

    let _ = app.emit("task-graph-updated", tasks.list());
    let _ = app.emit("orchestrator-step", &report);
    for id in &report.merged {
        publish_and_emit(
            &app,
            &bus,
            AgentEvent::new(AgentEventKind::TaskCompleted, json!({ "id": id })),
        )?;
    }
    Ok(report)
}

/// One explicit A7.2 control-plane tick. The caller selects only the immutable
/// accepted plan revision; repository, branch, role, owned target, gate argv,
/// and execution actor/generation are derived by backend owners. The route
/// dispatches one visible implementer, then on a later tick freezes and tests
/// its owned diff. It never invokes independent review, acceptance, merge, or
/// packet settlement (A7.3+).
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MissionPlanRunReport {
    pub activation: MissionPlanActivation,
    pub step: StepReport,
    pub gate_evidence: Option<MissionGateEvidence>,
}

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub fn mission_plan_run(
    app: AppHandle,
    tasks: State<'_, Arc<TaskManager>>,
    startup: State<'_, Arc<StartupReconciliationState>>,
    cost: State<'_, Arc<CostManager>>,
    fleet: State<'_, PaneFleet>,
    bus: State<'_, Arc<EventBus>>,
    ownership: State<'_, Arc<Mutex<FileOwnership>>>,
    symbol_ownership: State<'_, Arc<Mutex<SymbolOwnership>>>,
    context: State<'_, Arc<ContextStoreManager>>,
    plan_id: String,
    plan_revision: u64,
) -> Result<MissionPlanRunReport, String> {
    let activation = tasks
        .activate_mission_plan(&plan_id, plan_revision)
        .map_err(|error| error.to_string())?;
    let mut report = run_step_visible(
        &startup,
        &tasks,
        &cost,
        &fleet,
        &ownership,
        Some(symbol_ownership.inner().clone()),
        &bus,
        &context,
        &CostUsage::default(),
        activation.repository_root.clone(),
        // The generic loop checks separation before touching its gate/review/
        // merge ports. Matching the immutable implementer role keeps the task
        // waiting at Review, where the A7.2 exact candidate path takes over.
        "implementer".into(),
        HashMap::new(),
        None,
        None,
        Some(app.state::<crate::db::ManagedDb>().inner()),
        Some(&activation.task_id),
    )?;
    // The generic loop reports a same-role reviewer as `rejected` while leaving
    // the task untouched at Review. In this typed route that is the intentional
    // pre-review stop, not a rejected implementation; A7.3 supplies the first
    // independent reviewer later.
    report
        .rejected
        .retain(|task_id| task_id != &activation.task_id);

    if report.dispatched == [activation.task_id.clone()] {
        let terminal_id = fleet
            .terminal_of(&activation.task_id)
            .ok_or_else(|| "visible Mission dispatch has no PTY binding".to_string())?;
        let pty = app.state::<PtyManager>().inner().clone();
        let native_registry = app.state::<Arc<NativeTerminalRegistry>>().inner().clone();
        super::interactive_commands::spawn_loop_pane_render(
            &app,
            &pty,
            native_registry,
            terminal_id.clone(),
            PANE_COLS,
            PANE_ROWS,
        );
        publish_and_emit(
            &app,
            &bus,
            AgentEvent::new(
                AgentEventKind::AgentSpawned,
                json!({
                    "taskId": activation.task_id,
                    "terminalId": terminal_id,
                    "model": tasks
                        .get(&activation.task_id)
                        .and_then(|task| task.agent_model())
                        .unwrap_or_else(|| "sonnet".into()),
                    "repoPath": activation.repository_root,
                    "missionId": activation.mission_id,
                    "workUnitId": activation.work_unit_id,
                    "activationId": activation.activation_id,
                }),
            ),
        )?;
    }

    let gate_evidence = freeze_and_test_mission_candidate(&tasks, &activation)?;
    let _ = app.emit("task-graph-updated", tasks.list());
    let _ = app.emit("orchestrator-step", &report);
    Ok(MissionPlanRunReport {
        activation,
        step: report,
        gate_evidence,
    })
}
