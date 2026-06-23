//! Real `LoopPorts` adapter — wires the autonomy loop's I/O ports to the actual
//! merge backend (`perform_merge` + the serialized `MergeQueue`) while keeping
//! the quality-gate runner and the agent dispatcher behind injected traits.
//!
//! This makes the review -> auto-merge path real and still fully
//! unit-testable: a green review of a task with bound branches performs a real
//! git merge, with gate results and agent spawning supplied by injectable
//! adapters. Only the concrete gate-runner (shells out to test/lint) and
//! dispatcher (spawns an agent) are runtime-gated. See
//! docs/specs/AETHER_COCKPIT_REQUIREMENTS_2026-06-13.md (BR9, Acceptance:
//! end-to-end autonomy).

use std::sync::{Arc, Mutex};

use crate::agent::AgentManager;
use crate::control::agent::{start_headless, HeadlessSpawnSpec};
use crate::control::merge::{MergeIntentStatus, MergeQueue, MergeRequest};
use crate::control::pane_fleet::PaneFleet;
use crate::event_bus::{AgentEvent, AgentEventKind, EventBus};
use crate::file_ownership::FileOwnership;
use crate::git::{perform_merge, MergeOutcome};
use crate::orchestrator::autonomy::{Completions, LoopPorts};
use crate::review::GateResults;
use crate::symbol_ownership::{SymbolIntent, SymbolOwnership};

/// Wall-clock budget for a single dispatched agent before it is treated as hung
/// and killed (BR9 hang recovery). Deliberately generous so a legitimately long
/// real-agent run is never killed; a worker stuck past this is genuinely hung
/// (it never exits), so it is killed and its task reassigned on the bounded
/// timeout budget rather than wedging the loop in `Running` forever.
const AGENT_HANG_TIMEOUT_SECS: u64 = 1800;

/// Current Unix epoch in seconds, for the hang detector's wall-clock budget.
fn now_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// Runs the quality gate for a task's branch. Real impl shells out to the
/// project's test/lint/type-check commands; tests inject scripted results.
pub trait GateRunner {
    fn run(&self, task_id: &str, branch: &str) -> GateResults;
}

/// Spawns an implementer agent for a task and reports which dispatched agents
/// have finished. The real impl owns the agent runtime (it spawned them), so it
/// is the natural source of both signals; tests record the call.
pub trait Dispatcher {
    fn dispatch(&self, task_id: &str, branch: Option<&str>) -> Result<(), String>;
    /// Dispatched agents that finished since the last poll, split by exit
    /// outcome (clean exit vs. crash) — the autonomy loop's completion +
    /// recovery sensor. Default none — a dispatcher that does not track
    /// completion (e.g. a test recorder). The real agent dispatcher reports
    /// process exits here so the loop can move clean exits `Running -> Review`
    /// and recover crashed workers.
    fn poll_completions(&self) -> Completions {
        Completions::default()
    }
}

/// Resolves a task's merge info: its `(source, target)` branches and the agent
/// that implemented it. Backed by a `TaskManager` snapshot at runtime.
pub trait TaskInfo {
    fn branches(&self, task_id: &str) -> Option<(String, String)>;
    fn implementer(&self, task_id: &str) -> String;
}

/// Concrete `TaskInfo` over a point-in-time snapshot of the Task Graph.
///
/// Captured *before* a loop step mutates the graph so the autonomy controller
/// can run `step` while holding the `TaskManager` graph lock without the
/// adapter re-locking the same `Mutex` (std `Mutex` is not reentrant — a
/// re-lock from inside the step would deadlock). Branch bindings and owners are
/// stable across a step (only task *status* changes), so the pre-step snapshot
/// stays correct for the whole pass.
pub struct TaskBranchSnapshot {
    branches: std::collections::HashMap<String, (String, String)>,
    owners: std::collections::HashMap<String, String>,
}

impl TaskBranchSnapshot {
    /// Capture every task's `(source, target)` branch binding and owner from the
    /// graph. Tasks without both branches are simply absent from `branches`
    /// (the merge port turns a missing binding into an error — an unbound task
    /// cannot be merged).
    pub fn from_graph(graph: &crate::task::TaskGraph) -> Self {
        let mut branches = std::collections::HashMap::new();
        let mut owners = std::collections::HashMap::new();
        for task in graph.list() {
            if let (Some(source), Some(target)) = (&task.source_branch, &task.target_branch) {
                branches.insert(task.id.clone(), (source.clone(), target.clone()));
            }
            if let Some(owner) = &task.owner {
                owners.insert(task.id.clone(), owner.clone());
            }
        }
        Self { branches, owners }
    }
}

impl TaskInfo for TaskBranchSnapshot {
    fn branches(&self, task_id: &str) -> Option<(String, String)> {
        self.branches.get(task_id).cloned()
    }

    fn implementer(&self, task_id: &str) -> String {
        self.owners.get(task_id).cloned().unwrap_or_default()
    }
}

/// Concrete `LoopPorts`: merges through the real git backend + serialized
/// queue, and delegates gate/dispatch to injected adapters.
pub struct LoopPortsAdapter<G, D, T> {
    repo_path: String,
    reviewer_id: String,
    queue: MergeQueue,
    gate_runner: G,
    dispatcher: D,
    task_info: T,
    /// The live symbol-ownership map, so the dispatch gate can consult what agents
    /// are ACTUALLY editing now (spec §6.5). `None` => declared-intent gate only.
    symbol_ownership: Option<Arc<Mutex<SymbolOwnership>>>,
}

impl<G, D, T> LoopPortsAdapter<G, D, T> {
    pub fn new(
        repo_path: impl Into<String>,
        reviewer_id: impl Into<String>,
        gate_runner: G,
        dispatcher: D,
        task_info: T,
        symbol_ownership: Option<Arc<Mutex<SymbolOwnership>>>,
    ) -> Self {
        Self {
            repo_path: repo_path.into(),
            reviewer_id: reviewer_id.into(),
            queue: MergeQueue::new(),
            gate_runner,
            dispatcher,
            task_info,
            symbol_ownership,
        }
    }

    /// The merge queue (intents + their resolved outcomes) after the loop ran.
    pub fn queue(&self) -> &MergeQueue {
        &self.queue
    }
}

impl<G: GateRunner, D: Dispatcher, T: TaskInfo> LoopPorts for LoopPortsAdapter<G, D, T> {
    fn dispatch(&mut self, task_id: &str) -> Result<(), String> {
        let source = self.task_info.branches(task_id).map(|(source, _)| source);
        // Loop-owned worktree: create the task's isolated worktree (idempotent —
        // a re-dispatch after rework reuses it) before spawning, so the worker has
        // a real cwd without the conductor pre-creating it.
        if let Some(branch) = source.as_deref() {
            crate::control::worktree::ensure_for_branch(&self.repo_path, branch)?;
        }
        self.dispatcher.dispatch(task_id, source.as_deref())
    }

    fn poll_completions(&mut self) -> Completions {
        self.dispatcher.poll_completions()
    }

    fn gate(&mut self, task_id: &str) -> GateResults {
        let branch = self
            .task_info
            .branches(task_id)
            .map(|(source, _)| source)
            .unwrap_or_default();
        self.gate_runner.run(task_id, &branch)
    }

    fn reviewer_id(&self) -> String {
        self.reviewer_id.clone()
    }

    fn implementer_id(&self, task_id: &str) -> String {
        self.task_info.implementer(task_id)
    }

    fn merge(&mut self, task_id: &str) -> Result<(), String> {
        let (source, target) = self
            .task_info
            .branches(task_id)
            .ok_or_else(|| format!("task {task_id} has no source/target branch"))?;
        let worktree = crate::control::worktree::predict_path(&self.repo_path, &source);
        let intent = self.queue.enqueue(MergeRequest {
            session_id: task_id.to_string(),
            source_branch: source.clone(),
            target_branch: target.clone(),
        })?;
        self.queue.begin(&intent.intent_id)?;
        // Loop-owned worktree (commit-to-merge): commit the green-reviewed worker's
        // worktree on `source` BEFORE merging, so perform_merge sees the real work
        // ahead of `target`. Without this the source tip never moved (the agent
        // writes files but never commits) and every merge was an empty
        // AlreadyMerged. Only when the isolated worktree exists on disk (a repo-root
        // task owns nothing to commit). Done AFTER begin so a commit failure resolves
        // the intent as Rejected (audit evidence) and fails the merge -> the loop
        // requeues for rework (never strands); Ok(None) (empty diff) is fine.
        if worktree.is_dir() {
            if let Err(e) = crate::control::worktree::commit_for_branch(
                &self.repo_path,
                &source,
                &format!("aether: {task_id}"),
            ) {
                self.queue
                    .resolve(&intent.intent_id, MergeIntentStatus::Rejected)?;
                return Err(format!("commit worktree for {source} failed: {e}"));
            }
        }
        match perform_merge(&self.repo_path, &source, &target) {
            Ok(MergeOutcome::Conflict { paths }) => {
                self.queue
                    .resolve(&intent.intent_id, MergeIntentStatus::Conflict)?;
                Err(format!("merge conflict: {}", paths.join(", ")))
            }
            Ok(_) => {
                self.queue
                    .resolve(&intent.intent_id, MergeIntentStatus::Merged)?;
                // Loop-owned worktree (cleanup): the branch is merged, so reclaim
                // its isolated worktree AND delete the merged branch — otherwise
                // they pile up on disk across a long-running fleet. Best-effort and
                // guarded on the worktree existing: the merge already succeeded, so
                // a cleanup failure must not turn a Done task back into an error.
                if worktree.is_dir() {
                    if let Err(e) =
                        crate::control::worktree::remove_for_branch(&self.repo_path, &source, true)
                    {
                        log::warn!(
                            "post-merge worktree cleanup for {source} failed (non-fatal): {e}"
                        );
                    }
                }
                Ok(())
            }
            Err(err) => {
                self.queue
                    .resolve(&intent.intent_id, MergeIntentStatus::Rejected)?;
                Err(err)
            }
        }
    }

    fn symbol_blocking(&self, intents: &[SymbolIntent]) -> bool {
        let Some(map) = self.symbol_ownership.as_ref() else {
            return false;
        };
        if intents.is_empty() {
            return false;
        }
        let now = now_secs();
        let owner = map.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        intents
            .iter()
            .any(|intent| owner.intent_blocked(intent, now))
    }
}

/// Dispatches a ready task by spawning a real headless implementer agent in the
/// task's isolated worktree, and reports finished agents (process exit) back to
/// the loop. Prompt/cwd are captured from the graph snapshot before the step.
struct AgentDispatcher<'a> {
    manager: &'a AgentManager,
    specs: std::collections::HashMap<String, HeadlessSpawnSpec>,
}

impl Dispatcher for AgentDispatcher<'_> {
    fn dispatch(&self, task_id: &str, _branch: Option<&str>) -> Result<(), String> {
        let spec = self
            .specs
            .get(task_id)
            .cloned()
            .ok_or_else(|| format!("no spawn spec for task {task_id}"))?;
        let session_id = start_headless(self.manager, spec)?;
        // Tag the session so the completion sensor maps its exit back to the task.
        let _ = self.manager.set_task(&session_id, task_id);
        Ok(())
    }

    fn poll_completions(&self) -> Completions {
        let outcome = self.manager.reap();
        // Kill + surface any worker hung past the wall-clock budget. A hang never
        // exits, so reap() above never sees it; without this a stuck agent would
        // wedge its task in Running forever. The loop recovers these on the
        // bounded timeout budget.
        let timed_out = self
            .manager
            .reap_timed_out(AGENT_HANG_TIMEOUT_SECS, now_secs());
        Completions {
            succeeded: outcome.succeeded,
            failed: outcome.failed,
            timed_out,
        }
    }
}

/// Per-task spawn spec (prompt + worktree cwd) captured before the step, used by
/// the dispatcher when a Ready task is dispatched. Prompt = title + description;
/// cwd = the predicted isolated worktree path for the task's source branch (or
/// the repo root when the task has no bound branch).
fn spawn_specs(
    graph: &crate::task::TaskGraph,
    repo_path: &str,
    adr_header: &str,
) -> std::collections::HashMap<String, HeadlessSpawnSpec> {
    graph
        .list()
        .into_iter()
        .map(|task| {
            (
                task.id.clone(),
                HeadlessSpawnSpec {
                    prompt: task_agent_prompt(task, adr_header),
                    cwd: task_worktree_cwd(task, repo_path),
                    // Route to the task's explicit `model` if set, else its
                    // `owner` (back-compat). `owner` stays the implementer
                    // identity for the reviewer-!=-implementer merge gate.
                    model: task.agent_model(),
                    allowed_tools: None,
                    resume_id: None,
                },
            )
        })
        .collect()
}

/// The prompt a dispatched agent runs for `task`: title (+ description) prefixed
/// with the shared ADR header so every agent works from the same world-model
/// (e.g. it knows auth_method=jwt) rather than blind. Shared by the headless and
/// visible-pane spec builders so both inject the same prompt.
fn task_agent_prompt(task: &crate::task::graph::Task, adr_header: &str) -> String {
    let task_prompt = if task.description.trim().is_empty() {
        task.title.clone()
    } else {
        format!("{}\n\n{}", task.title, task.description)
    };
    if adr_header.is_empty() {
        task_prompt
    } else {
        format!("{adr_header}{task_prompt}")
    }
}

/// The working directory a dispatched agent runs in: the predicted isolated
/// worktree for the task's source branch, or the repo root when it has no bound
/// branch. Shared by the headless and visible-pane spec builders.
fn task_worktree_cwd(task: &crate::task::graph::Task, repo_path: &str) -> String {
    match &task.source_branch {
        Some(branch) => crate::control::worktree::predict_path(repo_path, branch)
            .to_string_lossy()
            .into_owned(),
        None => repo_path.to_string(),
    }
}

/// Default visible-pane geometry for a loop-dispatched agent. Wide enough for a
/// CLI agent's output to read well in a fleet-grid tile; the frontend resizes
/// the PTY to the real tile size once the pane mounts. `pub(crate)` so the IPC
/// face creates the native engine session at the same size the PTY was spawned.
pub(crate) const PANE_COLS: u16 = 120;
pub(crate) const PANE_ROWS: u16 = 32;

/// Per-task visible-pane spawn spec captured before the step (the PTY counterpart
/// of `HeadlessSpawnSpec`): the prompt + worktree cwd + routed model the
/// `PaneDispatcher` turns into a `claude/codex/gemini` CLI invocation in a fresh
/// visible terminal.
#[derive(Debug, Clone)]
struct PaneSpawnSpec {
    prompt: String,
    cwd: String,
    model: Option<String>,
    cols: u16,
    rows: u16,
    /// The task's declared output paths (relative to `cwd`). The visible fleet's
    /// structural completion signal: an interactive agent never exits, so it is
    /// reported done once these all exist in its worktree (see `PaneFleet`).
    outputs: Vec<String>,
}

/// Like `spawn_specs` but for the visible-pane runtime: each ready task becomes a
/// `PaneSpawnSpec` carrying the same ADR-prefixed prompt, worktree cwd, and
/// routed model, plus the default pane geometry.
fn pane_spawn_specs(
    graph: &crate::task::TaskGraph,
    repo_path: &str,
    adr_header: &str,
) -> std::collections::HashMap<String, PaneSpawnSpec> {
    graph
        .list()
        .into_iter()
        .map(|task| {
            (
                task.id.clone(),
                PaneSpawnSpec {
                    prompt: task_agent_prompt(task, adr_header),
                    cwd: task_worktree_cwd(task, repo_path),
                    model: task.agent_model(),
                    cols: PANE_COLS,
                    rows: PANE_ROWS,
                    outputs: task.outputs.clone(),
                },
            )
        })
        .collect()
}

/// Dispatches a ready task by spawning its implementer agent in a **visible PTY
/// pane** (1 pane = 1 agent) through the shared `PaneFleet`. The CLI command is
/// resolved from the task's model + prompt via `agent_shell_command_spec` (the
/// interactive TUI inside a PowerShell pane); completion is sensed structurally
/// from declared outputs (the interactive TUI never exits). This is the visible
/// counterpart of `AgentDispatcher`. The AgentInspector's hand-spawned agents use
/// the sibling `agent_command_spec` (interactive TUI, launched directly).
struct PaneDispatcher<'a> {
    fleet: &'a PaneFleet,
    specs: std::collections::HashMap<String, PaneSpawnSpec>,
}

impl Dispatcher for PaneDispatcher<'_> {
    fn dispatch(&self, task_id: &str, _branch: Option<&str>) -> Result<(), String> {
        let spec = self
            .specs
            .get(task_id)
            .cloned()
            .ok_or_else(|| format!("no pane spawn spec for task {task_id}"))?;
        let model = spec.model.as_deref().unwrap_or("sonnet");
        // Loop workers run INSIDE a visible PowerShell pane (split pane → shell →
        // AI CLI), as the live INTERACTIVE TUI (not headless -p), autonomous (own
        // worktree) so they auto-accept edits and build. Because the interactive
        // session never exits, completion is sensed structurally from the task's
        // declared outputs appearing in the worktree (passed to the fleet here).
        let (program, args, env) =
            crate::agent::interactive::agent_shell_command_spec(model, &spec.prompt, true)?;
        self.fleet.spawn(
            task_id,
            &program,
            &args,
            spec.cols,
            spec.rows,
            &spec.cwd,
            env,
            spec.outputs.clone(),
        )?;
        Ok(())
    }

    fn poll_completions(&self) -> Completions {
        // Same wall-clock hang budget as the headless dispatcher; a pane that
        // never exits is killed and its task recovered on the timeout budget.
        self.fleet
            .poll_completions(AGENT_HANG_TIMEOUT_SECS, now_secs())
    }
}

/// Drive one autonomy step over the live Task Graph with the real runtime ports
/// (BR9): caller-supplied gate verdicts resolve reviews into a real git merge,
/// finished agents (process exit) move `Running -> Review`, and ready tasks are
/// dispatched by spawning real headless agents (routed to the task owner's
/// model). Shared by the cockpit IPC (Face 1) and the MCP server (Face 2) so
/// both faces drive exactly the same loop over the same managed state.
///
/// The whole step runs inside the graph lock; branch/owner info is read from a
/// pre-step snapshot so the loop never re-locks the graph (which would
/// deadlock). The caller paces repeated calls (agents run between calls); each
/// call surfaces the agents finished since the last one.
/// Render the shared ADR (Context Store decisions) as a prompt header injected
/// into every dispatched agent, so all agents work from the same world-model.
/// Empty when there are no decisions.
fn build_adr_header(adr: &std::collections::BTreeMap<String, String>) -> String {
    if adr.is_empty() {
        return String::new();
    }
    let mut header =
        String::from("[Project decisions — align your work to these shared decisions]\n");
    for (key, value) in adr {
        header.push_str(&format!("- {key}: {value}\n"));
    }
    header.push('\n');
    header
}

/// Capture each task's `(owner, declared output paths)` before a step so the
/// dispatch/merge in the report can claim/free the right file lanes. Shared by
/// the headless and visible-pane step runners.
fn capture_lanes(
    tasks: &crate::task::TaskManager,
) -> std::collections::HashMap<String, (String, Vec<String>)> {
    tasks.read(|graph| {
        graph
            .list()
            .iter()
            .filter_map(|task| {
                task.owner
                    .as_ref()
                    .map(|owner| (task.id.clone(), (owner.clone(), task.outputs.clone())))
            })
            .collect()
    })
}

#[allow(clippy::too_many_arguments)]
pub fn run_step(
    tasks: &crate::task::TaskManager,
    cost: &crate::cost::CostManager,
    agents: &AgentManager,
    ownership: &Mutex<FileOwnership>,
    symbol_ownership: Option<Arc<Mutex<SymbolOwnership>>>,
    events: &EventBus,
    context: &crate::context_store::ContextStoreManager,
    usage: &crate::cost::CostUsage,
    repo_path: String,
    reviewer_id: String,
    gates: std::collections::HashMap<String, GateResults>,
    gate_commands: Option<crate::control::gate_runner::GateCommands>,
    db: Option<&crate::db::ManagedDb>,
) -> crate::orchestrator::autonomy::StepReport {
    let caps = cost.caps();
    // The shared ADR, injected into every agent dispatched this step.
    let adr_header = build_adr_header(&context.all());
    // Each task's owner + declared file paths (outputs), captured before the
    // step so dispatched/merged tasks can claim/free their file lanes.
    let lanes = capture_lanes(tasks);
    let report = tasks.with_graph_mut(|graph| {
        // Snapshots captured before the step mutates the graph — the adapter
        // never re-locks the manager (std Mutex is not reentrant).
        let info = TaskBranchSnapshot::from_graph(graph);
        let specs = spawn_specs(graph, &repo_path, &adr_header);
        // Objective gates (tests/lint/types) run mechanically in each task's
        // worktree when a command is configured; otherwise they (and the
        // subjective gates always) fall back to the caller's supplied verdict.
        let gate_runner = crate::control::gate_runner::ProcessGateRunner::new(
            repo_path.clone(),
            gate_commands.unwrap_or_default(),
            gates,
            crate::control::gate_runner::SystemCommandRunner,
        );
        let mut ports = LoopPortsAdapter::new(
            repo_path,
            reviewer_id,
            gate_runner,
            AgentDispatcher {
                manager: agents,
                specs,
            },
            info,
            symbol_ownership.clone(),
        );
        crate::orchestrator::autonomy::step(graph, &caps, usage, &mut ports)
    });
    apply_file_lanes(ownership, events, &lanes, &report);
    publish_escalations(events, &report);
    // Durable half of the escalation surface: persist each give-up when a db is
    // attached, so a Failed task survives restart on BOTH faces (P4). The Event
    // Bus publish above keeps live cockpit visibility.
    if let Some(db) = db {
        crate::supervisor::escalation_sink::persist_escalations(db, &report);
    }
    report
}

/// Drive one autonomy step exactly like [`run_step`], but dispatch each ready
/// task into a **visible PTY pane** (1 pane = 1 agent) through the shared
/// `PaneFleet` instead of an invisible headless child. The loop logic, gates,
/// merge, file lanes, and escalations are identical — only the dispatch backend
/// differs (`PaneDispatcher` over `PaneFleet` vs. `AgentDispatcher` over
/// `AgentManager`), and completion is sensed from PTY exit rather than a drained
/// subprocess. This is the cockpit (Face 1) path so the operator sees each agent
/// working in its own terminal; the MCP face keeps the headless `run_step`.
#[allow(clippy::too_many_arguments)]
pub fn run_step_visible(
    tasks: &crate::task::TaskManager,
    cost: &crate::cost::CostManager,
    fleet: &PaneFleet,
    ownership: &Mutex<FileOwnership>,
    symbol_ownership: Option<Arc<Mutex<SymbolOwnership>>>,
    events: &EventBus,
    context: &crate::context_store::ContextStoreManager,
    usage: &crate::cost::CostUsage,
    repo_path: String,
    reviewer_id: String,
    gates: std::collections::HashMap<String, GateResults>,
    gate_commands: Option<crate::control::gate_runner::GateCommands>,
    db: Option<&crate::db::ManagedDb>,
) -> crate::orchestrator::autonomy::StepReport {
    let caps = cost.caps();
    let adr_header = build_adr_header(&context.all());
    let lanes = capture_lanes(tasks);
    let report = tasks.with_graph_mut(|graph| {
        let info = TaskBranchSnapshot::from_graph(graph);
        let specs = pane_spawn_specs(graph, &repo_path, &adr_header);
        let gate_runner = crate::control::gate_runner::ProcessGateRunner::new(
            repo_path.clone(),
            gate_commands.unwrap_or_default(),
            gates,
            crate::control::gate_runner::SystemCommandRunner,
        );
        let mut ports = LoopPortsAdapter::new(
            repo_path,
            reviewer_id,
            gate_runner,
            PaneDispatcher { fleet, specs },
            info,
            symbol_ownership.clone(),
        );
        crate::orchestrator::autonomy::step(graph, &caps, usage, &mut ports)
    });
    apply_file_lanes(ownership, events, &lanes, &report);
    publish_escalations(events, &report);
    // Durable half of the escalation surface: persist each give-up when a db is
    // attached, so a Failed task survives restart on BOTH faces (P4). The Event
    // Bus publish above keeps live cockpit visibility.
    if let Some(db) = db {
        crate::supervisor::escalation_sink::persist_escalations(db, &report);
    }
    report
}

/// Push each give-up escalation from the step onto the coordination stream as an
/// `EscalationRaised` event (review channel), so a task the loop left `Failed`
/// (a retry budget exhausted) is surfaced to the supervisor/reviewer — via the
/// cockpit event feed AND the MCP `event.recent` the orchestrator polls — rather
/// than dying silently. Published after the step (no graph lock held).
fn publish_escalations(events: &EventBus, report: &crate::orchestrator::autonomy::StepReport) {
    for esc in &report.escalations {
        events.publish(AgentEvent::new(
            AgentEventKind::EscalationRaised,
            serde_json::json!({
                "taskId": esc.task_id,
                "reason": esc.reason,
                "action": esc.action,
            }),
        ));
    }
}

/// Reflect this step's dispatch/merge into the shared File Ownership + coordination
/// stream (BR5/BR8): a dispatched task claims its declared file paths for its
/// agent and publishes `FileLocked`; a merged task releases them and publishes
/// `FileReleased`. This is what lets peers see "who is touching what" and
/// dispatch non-overlapping lanes. Ownership is mutated under its own lock, then
/// events are published after releasing it (no nested locks).
fn apply_file_lanes(
    ownership: &Mutex<FileOwnership>,
    events: &EventBus,
    lanes: &std::collections::HashMap<String, (String, Vec<String>)>,
    report: &crate::orchestrator::autonomy::StepReport,
) {
    let mut to_publish = Vec::new();
    {
        let Ok(mut owner) = ownership.lock() else {
            return;
        };
        for id in &report.dispatched {
            if let Some((agent, paths)) = lanes.get(id) {
                if paths.is_empty() {
                    continue;
                }
                for path in paths {
                    owner.assign(agent.clone(), path.clone());
                }
                to_publish.push(AgentEvent::new(
                    AgentEventKind::FileLocked,
                    serde_json::json!({ "task": id, "agent": agent, "paths": paths }),
                ));
            }
        }
        for id in &report.merged {
            if let Some((agent, paths)) = lanes.get(id) {
                if paths.is_empty() {
                    continue;
                }
                for path in paths {
                    owner.release(agent, path);
                }
                to_publish.push(AgentEvent::new(
                    AgentEventKind::FileReleased,
                    serde_json::json!({ "task": id, "agent": agent, "paths": paths }),
                ));
            }
        }
    }
    for event in to_publish {
        events.publish(event);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::control::gate_runner::{
        CommandRunner, GateCommands, ProcessGateRunner, SystemCommandRunner,
    };
    use crate::cost::{CostCaps, CostUsage};
    use crate::orchestrator::autonomy::{step, StepReport};
    use crate::orchestrator::LoopState;
    use crate::task::graph::Task;
    use crate::task::{TaskGraph, TaskStatus};
    use git2::{build::CheckoutBuilder, Repository};
    use std::cell::RefCell;
    use std::collections::HashMap;
    use std::path::Path;

    const GREEN: GateResults = GateResults {
        tests_pass: true,
        lint_pass: true,
        types_pass: true,
        design_consistent: true,
        context_aligned: true,
    };

    struct FakeGate(GateResults);
    impl GateRunner for FakeGate {
        fn run(&self, _task_id: &str, _branch: &str) -> GateResults {
            self.0
        }
    }

    #[derive(Default)]
    struct RecordingDispatcher {
        calls: RefCell<Vec<String>>,
    }
    impl Dispatcher for RecordingDispatcher {
        fn dispatch(&self, task_id: &str, _branch: Option<&str>) -> Result<(), String> {
            self.calls.borrow_mut().push(task_id.to_string());
            Ok(())
        }
    }

    struct MapInfo {
        branches: HashMap<String, (String, String)>,
        implementer: String,
    }
    impl TaskInfo for MapInfo {
        fn branches(&self, task_id: &str) -> Option<(String, String)> {
            self.branches.get(task_id).cloned()
        }
        fn implementer(&self, _task_id: &str) -> String {
            self.implementer.clone()
        }
    }

    fn caps(max: usize) -> CostCaps {
        CostCaps {
            max_agents: Some(max),
            ..CostCaps::default()
        }
    }

    fn init_repo() -> (tempfile::TempDir, Repository) {
        let dir = tempfile::tempdir().unwrap();
        let repo = Repository::init(dir.path()).unwrap();
        repo.set_head("refs/heads/main").unwrap();
        (dir, repo)
    }

    fn commit(repo: &Repository, files: &[(&str, &str)], parents: &[git2::Oid]) -> git2::Oid {
        let workdir = repo.workdir().unwrap().to_path_buf();
        for (name, content) in files {
            std::fs::write(workdir.join(name), content).unwrap();
        }
        let mut index = repo.index().unwrap();
        for (name, _) in files {
            index.add_path(Path::new(name)).unwrap();
        }
        index.write().unwrap();
        let tree = repo.find_tree(index.write_tree().unwrap()).unwrap();
        let sig = git2::Signature::now("Test", "t@test").unwrap();
        let parent_commits: Vec<git2::Commit> = parents
            .iter()
            .map(|oid| repo.find_commit(*oid).unwrap())
            .collect();
        let parent_refs: Vec<&git2::Commit> = parent_commits.iter().collect();
        repo.commit(Some("HEAD"), &sig, &sig, "c", &tree, &parent_refs)
            .unwrap()
    }

    fn checkout(repo: &Repository, branch: &str) {
        repo.set_head(&format!("refs/heads/{branch}")).unwrap();
        repo.checkout_head(Some(CheckoutBuilder::new().force()))
            .unwrap();
    }

    /// A feature branch one commit ahead of main, with main checked out.
    fn repo_with_feature_ahead() -> (tempfile::TempDir, Repository, git2::Oid) {
        let (dir, repo) = init_repo();
        let a = commit(&repo, &[("a.txt", "A")], &[]);
        repo.branch("feature", &repo.find_commit(a).unwrap(), false)
            .unwrap();
        checkout(&repo, "feature");
        let b = commit(&repo, &[("b.txt", "B")], &[a]);
        checkout(&repo, "main");
        (dir, repo, b)
    }

    fn review_task_graph() -> TaskGraph {
        let mut graph = TaskGraph::new();
        graph
            .add(Task::new("t", "T").with_branches("feature", "main"))
            .unwrap();
        graph.recompute_ready();
        graph.transition("t", TaskStatus::Running).unwrap();
        graph.transition("t", TaskStatus::Review).unwrap();
        graph
    }

    fn adapter_for(
        repo: &Repository,
        gate: GateResults,
    ) -> LoopPortsAdapter<FakeGate, RecordingDispatcher, MapInfo> {
        let mut branches = HashMap::new();
        branches.insert("t".to_string(), ("feature".to_string(), "main".to_string()));
        LoopPortsAdapter::new(
            repo.workdir().unwrap().to_str().unwrap().to_string(),
            "reviewer",
            FakeGate(gate),
            RecordingDispatcher::default(),
            MapInfo {
                branches,
                implementer: "implementer".to_string(),
            },
            None,
        )
    }

    #[test]
    fn symbol_blocking_consults_the_live_ownership_map() {
        use crate::orchestrator::autonomy::LoopPorts;
        use crate::symbol_ownership::{
            ClaimMode, Confidence, SymbolClaim, SymbolIntent, SymbolOwnership, SymbolRange,
        };
        let map = Arc::new(Mutex::new(SymbolOwnership::new()));
        // A running agent holds a LIVE exact write claim on src/x.rs 40-60.
        map.lock().unwrap().claim(
            SymbolClaim {
                claim_id: "c1".to_string(),
                agent_id: "a".to_string(),
                task_id: None,
                path: "src/x.rs".to_string(),
                symbol: "foo".to_string(),
                range: SymbolRange::new(40, 60),
                mode: ClaimMode::Write,
                lease_expires_at: u64::MAX,
                confidence: Confidence::Lsp,
            },
            0,
        );
        let ports = LoopPortsAdapter::new(
            "repo",
            "reviewer",
            FakeGate(GREEN),
            RecordingDispatcher::default(),
            MapInfo {
                branches: HashMap::new(),
                implementer: "i".to_string(),
            },
            Some(map),
        );
        let intent = |s, e| SymbolIntent {
            path: "src/x.rs".to_string(),
            symbol: "bar".to_string(),
            range: SymbolRange::new(s, e),
            mode: ClaimMode::Write,
            confidence: Confidence::Lsp,
        };
        // A ready task DECLARING an overlapping range is blocked by the running
        // agent's LIVE claim — the drift the declared-intent gate alone would miss.
        assert!(ports.symbol_blocking(&[intent(50, 55)]));
        // A disjoint declaration is free to dispatch; no intents blocks nothing.
        assert!(!ports.symbol_blocking(&[intent(1, 20)]));
        assert!(!ports.symbol_blocking(&[]));
    }

    #[test]
    fn green_review_performs_a_real_merge() {
        let (_dir, repo, feature_tip) = repo_with_feature_ahead();
        let mut graph = review_task_graph();
        let mut ports = adapter_for(&repo, GREEN);

        let report = step(&mut graph, &caps(4), &CostUsage::default(), &mut ports);

        assert_eq!(report.merged, ["t"]);
        assert_eq!(graph.get("t").unwrap().status, TaskStatus::Done);
        // The real merge moved main to the feature tip.
        assert_eq!(repo.refname_to_id("refs/heads/main").unwrap(), feature_tip);
        assert_eq!(ports.queue().intents()[0].status, "merged");
    }

    #[test]
    fn red_gate_rejects_without_merging() {
        let (_dir, repo, _feature_tip) = repo_with_feature_ahead();
        let main_before = repo.refname_to_id("refs/heads/main").unwrap();
        let mut graph = review_task_graph();
        let mut ports = adapter_for(
            &repo,
            GateResults {
                tests_pass: false,
                ..GREEN
            },
        );

        let report = step(&mut graph, &caps(4), &CostUsage::default(), &mut ports);

        assert!(report.merged.is_empty());
        assert_eq!(report.rejected, ["t"]);
        assert_eq!(graph.get("t").unwrap().status, TaskStatus::Running);
        // Nothing merged: main is untouched and no intent was queued.
        assert_eq!(repo.refname_to_id("refs/heads/main").unwrap(), main_before);
        assert!(ports.queue().intents().is_empty());
    }

    /// Feature and main both edit `shared.txt` divergently from a common base, so
    /// merging feature into main is a real 3-way CONFLICT.
    fn repo_with_conflicting_feature() -> (tempfile::TempDir, Repository) {
        let (dir, repo) = init_repo();
        let a = commit(&repo, &[("shared.txt", "base")], &[]);
        repo.branch("feature", &repo.find_commit(a).unwrap(), false)
            .unwrap();
        checkout(&repo, "feature");
        commit(&repo, &[("shared.txt", "feature change")], &[a]);
        checkout(&repo, "main");
        commit(&repo, &[("shared.txt", "main change")], &[a]);
        (dir, repo)
    }

    #[test]
    fn merge_conflict_escalates_and_never_strands_the_task() {
        // C-22 regression: a real merge conflict (green review, but the branch
        // can't merge because main advanced under it) must NOT leave the task
        // `Running` with no worker forever. The headless agent already exited, so
        // the loop requeues for rework; with the rework budget pre-consumed this
        // conflict exhausts it -> the task is left `Failed` AND escalated (pushed
        // to the supervisor / durable escalation sink), never silently stranded.
        let (_dir, repo) = repo_with_conflicting_feature();
        let main_before = repo.refname_to_id("refs/heads/main").unwrap();
        let mut graph = review_task_graph(); // task "t" in Review, branches feature/main
        graph.record_rework("t"); // 1 of MAX_REWORK_ATTEMPTS (2) already used
        let mut ports = adapter_for(&repo, GREEN); // reviewer is green; the MERGE conflicts

        let report = step(&mut graph, &caps(4), &CostUsage::default(), &mut ports);

        // Did not merge: main is untouched, task is not Done.
        assert!(report.merged.is_empty());
        assert_eq!(repo.refname_to_id("refs/heads/main").unwrap(), main_before);
        assert_eq!(report.rejected, ["t"]);
        // Not stranded: the task is terminal `Failed`, not a worker-less `Running`.
        assert_eq!(graph.get("t").unwrap().status, TaskStatus::Failed);
        // Escalated, not silent: the give-up is surfaced with its reason.
        assert!(report
            .escalations
            .iter()
            .any(|e| e.task_id == "t" && e.reason == "rework"));
        // The merge intent recorded the conflict outcome.
        assert_eq!(ports.queue().intents()[0].status, "conflict");
    }

    #[test]
    fn snapshot_reads_branches_and_owner_from_the_graph() {
        let mut graph = TaskGraph::new();
        let mut bound = Task::new("t", "T").with_branches("feature", "main");
        bound.owner = Some("impl-agent".to_string());
        graph.add(bound).unwrap();
        graph.add(Task::new("u", "U")).unwrap(); // no branches, no owner

        let snap = TaskBranchSnapshot::from_graph(&graph);

        assert_eq!(
            snap.branches("t"),
            Some(("feature".to_string(), "main".to_string()))
        );
        assert_eq!(snap.implementer("t"), "impl-agent");
        // Unbound task: no branch pair (the merge port errors on this) and an
        // empty implementer (distinct from any real reviewer id).
        assert_eq!(snap.branches("u"), None);
        assert_eq!(snap.implementer("u"), "");
        // A task absent from the graph snapshot is simply unknown.
        assert_eq!(snap.branches("ghost"), None);
    }

    #[test]
    fn snapshot_drives_a_real_merge_through_the_adapter() {
        // The concrete snapshot (not the test-only MapInfo) resolves the branch
        // pair for a real green-review merge.
        let (_dir, repo, feature_tip) = repo_with_feature_ahead();
        let mut graph = review_task_graph();
        let snapshot = TaskBranchSnapshot::from_graph(&graph);
        let mut ports = LoopPortsAdapter::new(
            repo.workdir().unwrap().to_str().unwrap().to_string(),
            "reviewer",
            FakeGate(GREEN),
            RecordingDispatcher::default(),
            snapshot,
            None,
        );

        let report = step(&mut graph, &caps(4), &CostUsage::default(), &mut ports);

        assert_eq!(report.merged, ["t"]);
        assert_eq!(graph.get("t").unwrap().status, TaskStatus::Done);
        assert_eq!(repo.refname_to_id("refs/heads/main").unwrap(), feature_tip);
    }

    /// A command runner with a constant verdict — proves the mechanical-gate
    /// wiring (ProcessGateRunner -> step -> real merge) deterministically, with
    /// the actual process exit-code mapping covered separately below.
    struct ConstRunner(bool);
    impl CommandRunner for ConstRunner {
        fn run(&self, _argv: &[String], _cwd: &str) -> bool {
            self.0
        }
    }

    fn mechanical_gate(repo_path: &str, command_ok: bool) -> ProcessGateRunner<ConstRunner> {
        let mut verdicts = HashMap::new();
        verdicts.insert("t".to_string(), GREEN); // reviewer claims green
        ProcessGateRunner::new(
            repo_path,
            GateCommands {
                test: Some(vec!["pnpm".into(), "test".into()]),
                ..Default::default()
            },
            verdicts,
            ConstRunner(command_ok),
        )
    }

    #[test]
    fn failing_mechanical_test_gate_blocks_a_real_merge() {
        // Even with a green reviewer verdict, a failing mechanical test gate
        // overrides tests_pass -> no merge happens (⑧): main is untouched.
        let (_dir, repo, _feature_tip) = repo_with_feature_ahead();
        let repo_path = repo.workdir().unwrap().to_str().unwrap().to_string();
        let main_before = repo.refname_to_id("refs/heads/main").unwrap();
        let mut graph = review_task_graph();
        let mut branches = HashMap::new();
        branches.insert("t".to_string(), ("feature".to_string(), "main".to_string()));
        let mut ports = LoopPortsAdapter::new(
            repo_path.clone(),
            "reviewer",
            mechanical_gate(&repo_path, false),
            RecordingDispatcher::default(),
            MapInfo {
                branches,
                implementer: "implementer".to_string(),
            },
            None,
        );

        let report = step(&mut graph, &caps(4), &CostUsage::default(), &mut ports);

        assert!(report.merged.is_empty());
        assert_eq!(report.rejected, ["t"]);
        assert_eq!(graph.get("t").unwrap().status, TaskStatus::Running);
        assert_eq!(repo.refname_to_id("refs/heads/main").unwrap(), main_before);
        assert!(ports.queue().intents().is_empty());
    }

    #[test]
    fn passing_mechanical_test_gate_allows_a_real_merge() {
        // A passing mechanical gate + green subjective verdict merges for real.
        let (_dir, repo, feature_tip) = repo_with_feature_ahead();
        let repo_path = repo.workdir().unwrap().to_str().unwrap().to_string();
        let mut graph = review_task_graph();
        let mut branches = HashMap::new();
        branches.insert("t".to_string(), ("feature".to_string(), "main".to_string()));
        let mut ports = LoopPortsAdapter::new(
            repo_path.clone(),
            "reviewer",
            mechanical_gate(&repo_path, true),
            RecordingDispatcher::default(),
            MapInfo {
                branches,
                implementer: "implementer".to_string(),
            },
            None,
        );

        let report = step(&mut graph, &caps(4), &CostUsage::default(), &mut ports);

        assert_eq!(report.merged, ["t"]);
        assert_eq!(graph.get("t").unwrap().status, TaskStatus::Done);
        assert_eq!(repo.refname_to_id("refs/heads/main").unwrap(), feature_tip);
    }

    #[cfg(windows)]
    #[test]
    fn system_command_runner_maps_real_exit_codes() {
        // The real runner faithfully maps a process's exit status, so the gate
        // above reflects genuine test outcomes.
        let dir = tempfile::tempdir().unwrap();
        let cwd = dir.path().to_str().unwrap();
        let runner = SystemCommandRunner;
        let argv = |code: &str| {
            vec![
                "cmd".to_string(),
                "/c".to_string(),
                "exit".to_string(),
                code.to_string(),
            ]
        };
        assert!(runner.run(&argv("0"), cwd), "exit 0 -> pass");
        assert!(!runner.run(&argv("1"), cwd), "exit 1 -> fail");
        // A command that cannot even spawn is a gate failure (can't prove green).
        assert!(!runner.run(&["definitely_not_a_real_binary_zzz".to_string()], cwd));
    }

    #[test]
    fn adr_header_lists_decisions_and_is_empty_when_none() {
        assert!(build_adr_header(&std::collections::BTreeMap::new()).is_empty());
        let mut adr = std::collections::BTreeMap::new();
        adr.insert("auth_method".to_string(), "jwt".to_string());
        adr.insert("database".to_string(), "postgresql".to_string());
        let header = build_adr_header(&adr);
        assert!(header.contains("auth_method: jwt"));
        assert!(header.contains("database: postgresql"));
        assert!(header.ends_with("\n\n"));
    }

    #[test]
    fn spawn_specs_inject_the_current_adr_into_every_prompt() {
        // Convergence (③): every dispatched agent — a fresh one or a task
        // re-dispatched after a mid-flight decision change — carries the CURRENT
        // ADR ahead of its task, so no agent ever runs on stale context.
        // `run_step` rebuilds this header from `context.all()` each step, so the
        // decision an agent sees is always the latest.
        let mut graph = TaskGraph::new();
        graph.add(Task::new("t", "Build login")).unwrap();
        let mut adr = std::collections::BTreeMap::new();
        adr.insert("auth_method".to_string(), "jwt".to_string());
        let header = build_adr_header(&adr);

        let specs = spawn_specs(&graph, "/repo", &header);
        let spec = specs.get("t").unwrap();

        assert!(spec.prompt.starts_with("[Project decisions"));
        assert!(spec.prompt.contains("auth_method: jwt"));
        assert!(spec.prompt.contains("Build login"));
    }

    fn lane(task: &str, agent: &str, path: &str) -> HashMap<String, (String, Vec<String>)> {
        let mut lanes = HashMap::new();
        lanes.insert(
            task.to_string(),
            (agent.to_string(), vec![path.to_string()]),
        );
        lanes
    }

    #[test]
    fn dispatched_task_claims_its_lane_and_publishes_file_locked() {
        let ownership = Mutex::new(FileOwnership::new());
        let bus = EventBus::new();
        let lanes = lane("t", "agent-a", "src/auth/login.ts");
        let report = StepReport {
            dispatched: vec!["t".to_string()],
            merged: vec![],
            rejected: vec![],
            recovered: vec![],
            escalations: vec![],
            state: LoopState::Active,
        };
        apply_file_lanes(&ownership, &bus, &lanes, &report);
        assert_eq!(
            ownership.lock().unwrap().owner_of("src/auth/login.ts"),
            Some("agent-a")
        );
        let events = bus.recent();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].kind, AgentEventKind::FileLocked);
        assert_eq!(events[0].payload["agent"], "agent-a");
    }

    #[test]
    fn merged_task_releases_its_lane_and_publishes_file_released() {
        let ownership = Mutex::new(FileOwnership::new());
        ownership
            .lock()
            .unwrap()
            .assign("agent-a", "src/auth/login.ts");
        let bus = EventBus::new();
        let lanes = lane("t", "agent-a", "src/auth/login.ts");
        let report = StepReport {
            dispatched: vec![],
            merged: vec!["t".to_string()],
            rejected: vec![],
            recovered: vec![],
            escalations: vec![],
            state: LoopState::Complete,
        };
        apply_file_lanes(&ownership, &bus, &lanes, &report);
        assert_eq!(
            ownership.lock().unwrap().owner_of("src/auth/login.ts"),
            None
        );
        let events = bus.recent();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].kind, AgentEventKind::FileReleased);
    }

    #[test]
    fn step_escalations_are_published_to_the_coordination_stream() {
        // A give-up escalation from the step (a task the loop left Failed) is
        // pushed onto the coordination stream so the supervisor/reviewer is told
        // — via the cockpit feed AND the MCP `event.recent` — rather than the
        // task dying silently.
        let bus = EventBus::new();
        let report = StepReport {
            dispatched: vec![],
            merged: vec![],
            rejected: vec![],
            recovered: vec![],
            escalations: vec![crate::orchestrator::autonomy::Escalation {
                task_id: "t".to_string(),
                reason: "timeout".to_string(),
                action: crate::failure_policy::RecoveryAction::EscalateToPlanner,
            }],
            state: LoopState::Stalled,
        };
        publish_escalations(&bus, &report);
        let events = bus.recent();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].kind, AgentEventKind::EscalationRaised);
        assert_eq!(events[0].payload["taskId"], "t");
        assert_eq!(events[0].payload["reason"], "timeout");
        assert_eq!(events[0].payload["action"], "escalate_to_planner");
    }

    #[test]
    fn dispatch_creates_the_tasks_worktree() {
        // Loop-owned worktree (create): dispatching a Ready task with a bound
        // source branch creates its isolated worktree — the conductor no longer has
        // to pre-create it.
        let (_dir, repo) = init_repo();
        commit(&repo, &[("base.txt", "base")], &[]);
        let repo_path = repo.workdir().unwrap().to_str().unwrap().to_string();
        let mut graph = TaskGraph::new();
        graph
            .add(Task::new("t", "T").with_branches("agent/build", "main"))
            .unwrap();
        graph.recompute_ready(); // t -> Ready
        let mut branches = HashMap::new();
        branches.insert(
            "t".to_string(),
            ("agent/build".to_string(), "main".to_string()),
        );
        let mut ports = LoopPortsAdapter::new(
            repo_path.clone(),
            "reviewer",
            FakeGate(GREEN),
            RecordingDispatcher::default(),
            MapInfo {
                branches,
                implementer: "impl".to_string(),
            },
            None,
        );

        let report = step(&mut graph, &caps(4), &CostUsage::default(), &mut ports);

        assert!(report.dispatched.contains(&"t".to_string()));
        assert_eq!(graph.get("t").unwrap().status, TaskStatus::Running);
        assert!(
            crate::control::worktree::predict_path(&repo_path, "agent/build").is_dir(),
            "the loop created the task's isolated worktree at dispatch"
        );
    }

    #[test]
    fn loop_commits_the_worktree_then_merges_then_removes_it() {
        // Loop-owned worktree (commit + cleanup): a Review task whose isolated
        // worktree holds UNCOMMITTED worker output. A green review must commit the
        // worktree (so the branch advances), merge it into main, and reclaim the
        // worktree — with no external git mutation.
        let (_dir, repo) = init_repo();
        commit(&repo, &[("base.txt", "base")], &[]);
        let repo_path = repo.workdir().unwrap().to_str().unwrap().to_string();

        crate::control::worktree::ensure_for_branch(&repo_path, "agent/feat").unwrap();
        let wt = crate::control::worktree::predict_path(&repo_path, "agent/feat");
        std::fs::write(wt.join("GREETING.md"), "hello").unwrap();
        assert!(wt.is_dir());

        let mut graph = TaskGraph::new();
        graph
            .add(Task::new("t", "T").with_branches("agent/feat", "main"))
            .unwrap();
        graph.recompute_ready();
        graph.transition("t", TaskStatus::Running).unwrap();
        graph.transition("t", TaskStatus::Review).unwrap();
        let mut branches = HashMap::new();
        branches.insert(
            "t".to_string(),
            ("agent/feat".to_string(), "main".to_string()),
        );
        let mut ports = LoopPortsAdapter::new(
            repo_path.clone(),
            "reviewer",
            FakeGate(GREEN),
            RecordingDispatcher::default(),
            MapInfo {
                branches,
                implementer: "implementer".to_string(),
            },
            None,
        );

        let report = step(&mut graph, &caps(4), &CostUsage::default(), &mut ports);

        assert_eq!(report.merged, ["t"]);
        assert_eq!(graph.get("t").unwrap().status, TaskStatus::Done);
        // The worker's uncommitted file was committed by the loop and merged to main.
        let main_tip = repo.head().unwrap().peel_to_commit().unwrap();
        assert!(
            main_tip
                .tree()
                .unwrap()
                .get_path(Path::new("GREETING.md"))
                .is_ok(),
            "worker output committed by the loop reached main"
        );
        // The merged task's worktree was reclaimed.
        assert!(!wt.is_dir(), "loop removed the merged task's worktree");
    }
}
