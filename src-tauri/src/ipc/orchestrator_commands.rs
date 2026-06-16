use std::collections::HashMap;
use std::sync::Arc;

use serde_json::json;
use tauri::{AppHandle, Emitter, State};

use super::event_commands::publish_and_emit;
use crate::agent::AgentManager;
use crate::control::agent::{start_headless, HeadlessSpawnSpec};
use crate::control::loop_ports::{Dispatcher, GateRunner, LoopPortsAdapter, TaskBranchSnapshot};
use crate::cost::{CostManager, CostUsage};
use crate::event_bus::{AgentEvent, AgentEventKind, EventBus};
use crate::orchestrator::autonomy::{step, StepReport};
use crate::orchestrator::{plan, DispatchPlan};
use crate::review::GateResults;
use crate::task::{TaskGraph, TaskManager};

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
    tasks: State<'_, TaskManager>,
    cost: State<'_, Arc<CostManager>>,
    usage: CostUsage,
) -> DispatchPlan {
    let caps = cost.caps();
    tasks.read(|graph| plan(graph, &caps, &usage))
}

/// Gate runner whose verdicts are supplied by the caller (the Reviewer agent /
/// cockpit) rather than run mechanically. A task with no supplied verdict is
/// treated as all-red, so it is never merged without an explicit green — the
/// safe default under full autonomy.
struct ScriptedGate {
    verdicts: HashMap<String, GateResults>,
}

const ALL_RED: GateResults = GateResults {
    tests_pass: false,
    lint_pass: false,
    types_pass: false,
    design_consistent: false,
    context_aligned: false,
};

impl GateRunner for ScriptedGate {
    fn run(&self, task_id: &str, _branch: &str) -> GateResults {
        self.verdicts.get(task_id).copied().unwrap_or(ALL_RED)
    }
}

/// Dispatches a ready task by spawning a real headless implementer agent in the
/// task's isolated worktree. The prompt/cwd are captured from the graph
/// snapshot before the step (see `spawn_specs`). A task with no spawn spec
/// (shouldn't happen for a known task) is an error, leaving it un-dispatched.
struct AgentDispatcher<'a> {
    manager: &'a AgentManager,
    specs: HashMap<String, HeadlessSpawnSpec>,
}

impl Dispatcher for AgentDispatcher<'_> {
    fn dispatch(&self, task_id: &str, _branch: Option<&str>) -> Result<(), String> {
        let spec = self
            .specs
            .get(task_id)
            .cloned()
            .ok_or_else(|| format!("no spawn spec for task {task_id}"))?;
        start_headless(self.manager, spec).map(|_session_id| ())
    }
}

/// Per-task spawn spec (prompt + worktree cwd) captured before the step, used by
/// the dispatcher when a Ready task is dispatched. Prompt = title + description;
/// cwd = the predicted isolated worktree path for the task's source branch (or
/// the repo root when the task has no bound branch).
fn spawn_specs(graph: &TaskGraph, repo_path: &str) -> HashMap<String, HeadlessSpawnSpec> {
    graph
        .list()
        .into_iter()
        .map(|task| {
            let prompt = if task.description.trim().is_empty() {
                task.title.clone()
            } else {
                format!("{}\n\n{}", task.title, task.description)
            };
            let cwd = match &task.source_branch {
                Some(branch) => crate::control::worktree::predict_path(repo_path, branch)
                    .to_string_lossy()
                    .into_owned(),
                None => repo_path.to_string(),
            };
            (
                task.id.clone(),
                HeadlessSpawnSpec {
                    prompt,
                    cwd,
                    model: None,
                    allowed_tools: None,
                    resume_id: None,
                },
            )
        })
        .collect()
}

/// Drive one autonomy step over the live Task Graph (BR9). This is the runtime
/// adapter that connects the unit-tested loop coordinator
/// (`orchestrator::autonomy::step`) to real I/O:
/// - reviews are resolved with the caller-supplied gate verdicts (`gates`):
///   all-green + reviewer != owner -> a **real git merge** into the target
///   branch via the serialized merge queue; red -> back to `Running`;
/// - ready tasks are dispatched up to the cost cap by **spawning real headless
///   implementer agents** in their worktrees.
///
/// `gates` maps a task id to the Reviewer's verdict (a task with no entry is
/// treated as all-red and never merged). The whole step runs inside the graph
/// lock; the merge/branch info is read from a pre-step snapshot so the loop can
/// never re-lock the graph (which would deadlock). Emits `task-graph-updated`
/// (statuses moved) and `orchestrator-step` (the `StepReport` for the loop
/// view), and publishes a `TaskCompleted` event for every merged task so the
/// Event Bus stays consistent with manual transitions.
// Five of the arguments are injected Tauri state (app/tasks/cost/agents/bus);
// only `usage`/`repo_path`/`reviewer_id`/`gates` are the caller's, so bundling
// would only change the invoke contract for no gain (cf. `mux_split_pane`).
#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub fn orchestrator_step(
    app: AppHandle,
    tasks: State<'_, TaskManager>,
    cost: State<'_, Arc<CostManager>>,
    agents: State<'_, AgentManager>,
    bus: State<'_, EventBus>,
    usage: CostUsage,
    repo_path: String,
    reviewer_id: String,
    gates: HashMap<String, GateResults>,
) -> StepReport {
    let caps = cost.caps();
    let manager = agents.inner();
    let report = tasks.with_graph_mut(|graph| {
        // Snapshots captured before the step mutates the graph — the adapter
        // never re-locks the manager (std Mutex is not reentrant).
        let info = TaskBranchSnapshot::from_graph(graph);
        let specs = spawn_specs(graph, &repo_path);
        let mut ports = LoopPortsAdapter::new(
            repo_path.clone(),
            reviewer_id.clone(),
            ScriptedGate { verdicts: gates },
            AgentDispatcher { manager, specs },
            info,
        );
        step(graph, &caps, &usage, &mut ports)
    });

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
