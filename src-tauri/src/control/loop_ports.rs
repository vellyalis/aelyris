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

use crate::agent::AgentManager;
use crate::control::agent::{start_headless, HeadlessSpawnSpec};
use crate::control::merge::{MergeIntentStatus, MergeQueue, MergeRequest};
use crate::git::{perform_merge, MergeOutcome};
use crate::orchestrator::autonomy::LoopPorts;
use crate::review::GateResults;

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
    /// Task ids whose dispatched agent has finished since the last poll (the
    /// autonomy loop's completion sensor). Default none — a dispatcher that does
    /// not track completion (e.g. a test recorder). The real agent dispatcher
    /// reports process exits here so the loop can move work `Running -> Review`.
    fn poll_finished(&self) -> Vec<String> {
        Vec::new()
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
}

impl<G, D, T> LoopPortsAdapter<G, D, T> {
    pub fn new(
        repo_path: impl Into<String>,
        reviewer_id: impl Into<String>,
        gate_runner: G,
        dispatcher: D,
        task_info: T,
    ) -> Self {
        Self {
            repo_path: repo_path.into(),
            reviewer_id: reviewer_id.into(),
            queue: MergeQueue::new(),
            gate_runner,
            dispatcher,
            task_info,
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
        self.dispatcher.dispatch(task_id, source.as_deref())
    }

    fn poll_finished(&mut self) -> Vec<String> {
        self.dispatcher.poll_finished()
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
        let intent = self.queue.enqueue(MergeRequest {
            session_id: task_id.to_string(),
            source_branch: source.clone(),
            target_branch: target.clone(),
        })?;
        self.queue.begin(&intent.intent_id)?;
        match perform_merge(&self.repo_path, &source, &target) {
            Ok(MergeOutcome::Conflict { paths }) => {
                self.queue
                    .resolve(&intent.intent_id, MergeIntentStatus::Conflict)?;
                Err(format!("merge conflict: {}", paths.join(", ")))
            }
            Ok(_) => {
                self.queue
                    .resolve(&intent.intent_id, MergeIntentStatus::Merged)?;
                Ok(())
            }
            Err(err) => {
                self.queue
                    .resolve(&intent.intent_id, MergeIntentStatus::Rejected)?;
                Err(err)
            }
        }
    }
}

/// Gate runner whose verdicts are supplied by the caller (the Reviewer agent /
/// cockpit) rather than run mechanically. A task with no supplied verdict is
/// treated as all-red, so it is never merged without an explicit green — the
/// safe default under full autonomy.
struct ScriptedGate {
    verdicts: std::collections::HashMap<String, GateResults>,
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

    fn poll_finished(&self) -> Vec<String> {
        self.manager.reap_finished()
    }
}

/// Per-task spawn spec (prompt + worktree cwd) captured before the step, used by
/// the dispatcher when a Ready task is dispatched. Prompt = title + description;
/// cwd = the predicted isolated worktree path for the task's source branch (or
/// the repo root when the task has no bound branch).
fn spawn_specs(
    graph: &crate::task::TaskGraph,
    repo_path: &str,
) -> std::collections::HashMap<String, HeadlessSpawnSpec> {
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
                    model: task.owner.clone(),
                    allowed_tools: None,
                    resume_id: None,
                },
            )
        })
        .collect()
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
#[allow(clippy::too_many_arguments)]
pub fn run_step(
    tasks: &crate::task::TaskManager,
    cost: &crate::cost::CostManager,
    agents: &AgentManager,
    usage: &crate::cost::CostUsage,
    repo_path: String,
    reviewer_id: String,
    gates: std::collections::HashMap<String, GateResults>,
) -> crate::orchestrator::autonomy::StepReport {
    let caps = cost.caps();
    tasks.with_graph_mut(|graph| {
        // Snapshots captured before the step mutates the graph — the adapter
        // never re-locks the manager (std Mutex is not reentrant).
        let info = TaskBranchSnapshot::from_graph(graph);
        let specs = spawn_specs(graph, &repo_path);
        let mut ports = LoopPortsAdapter::new(
            repo_path,
            reviewer_id,
            ScriptedGate { verdicts: gates },
            AgentDispatcher {
                manager: agents,
                specs,
            },
            info,
        );
        crate::orchestrator::autonomy::step(graph, &caps, usage, &mut ports)
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cost::{CostCaps, CostUsage};
    use crate::orchestrator::autonomy::step;
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
        )
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
        );

        let report = step(&mut graph, &caps(4), &CostUsage::default(), &mut ports);

        assert_eq!(report.merged, ["t"]);
        assert_eq!(graph.get("t").unwrap().status, TaskStatus::Done);
        assert_eq!(repo.refname_to_id("refs/heads/main").unwrap(), feature_tip);
    }
}
