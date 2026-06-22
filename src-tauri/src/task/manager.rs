use std::sync::{Arc, Mutex};

use super::graph::{Task, TaskGraph, TaskGraphError};
use super::planner::validate_plan;
use super::status::TaskStatus;
use crate::db::ManagedDb;
use crate::persistence::TaskRepo;

/// Thread-safe owner of the Task Graph, managed in Tauri state (mirrors the
/// `AgentManager` / `InteractiveSessionManager` pattern). Mutating operations
/// re-run the dependency gate so callers get the ids that became `Ready` (or
/// `Blocked`) and can broadcast a `task-graph-updated` event.
///
/// In-memory is the hot read cache; SQLite (via [`TaskRepo`]) is the source of
/// truth. Because `with_graph_mut` lets the autonomy loop mutate the graph
/// opaquely (status, crash/rework/timeout counters, branch bindings), every
/// mutating method persists the WHOLE graph snapshot afterwards — eliminating
/// the "missed write-through site" bug class. A `db` is attached at startup
/// ([`attach_db`]); when absent (tests, non-persistent mode) the manager is
/// purely in-memory, exactly as before. Persist failures are logged loudly,
/// never silently swallowed.
#[derive(Default)]
pub struct TaskManager {
    graph: Mutex<TaskGraph>,
    db: Mutex<Option<Arc<ManagedDb>>>,
}

impl TaskManager {
    pub fn new() -> Self {
        Self::default()
    }

    /// Poison-tolerant lock: a panicked holder must not wedge the whole task
    /// subsystem, so recover the inner graph rather than propagate the poison.
    fn lock(&self) -> std::sync::MutexGuard<'_, TaskGraph> {
        self.graph
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn db(&self) -> Option<Arc<ManagedDb>> {
        self.db
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone()
    }

    /// Persist the full graph snapshot. Called while the graph lock is held so
    /// the in-memory state and SQLite never diverge. A no-op without a `db`.
    fn persist(&self, graph: &TaskGraph) {
        if let Some(db) = self.db() {
            if let Err(e) = db.with(|d| TaskRepo::save_graph(d, graph)) {
                tracing::error!(error = %e, "task graph persist failed");
            }
        }
    }

    /// Attach the persistence backend and restore any persisted graph into
    /// memory. Called once at startup after the database is opened. Returns the
    /// number of restored tasks.
    pub fn attach_db(&self, db: Arc<ManagedDb>) -> Result<usize, String> {
        let loaded = db.with(TaskRepo::load_graph)?;
        // Collapse the volatile in-flight states (Running/Review) before the graph
        // goes live: at crash the worker for such a task is gone (headless agents
        // exited; visible-pane PTYs died with the app), so leaving it Running/Review
        // would stall the loop forever on a completion event that never fires. Without
        // this the restore is a verbatim reload and an interrupted build never resumes.
        // `tasks_for_restore` drops them to Pending (preserving topology and the retry
        // budgets, so a poison task can't reset and loop), then `recompute_ready`
        // re-derives readiness from the actual dep states — a dependent is only
        // re-readied once its deps are Done, never dispatched out of order. `load_graph`
        // already proved every dependency exists (its own `add` would have errored
        // otherwise), so rebuilding in the same order re-adds cleanly.
        let collapsed =
            crate::task::tasks_for_restore(loaded.list().into_iter().cloned().collect());
        let mut restored = TaskGraph::new();
        for task in collapsed {
            restored
                .add(task)
                .map_err(|e| format!("Rebuild task graph after restore collapse: {e}"))?;
        }
        restored.recompute_ready();
        let len = restored.len();
        *self.lock() = restored;
        *self
            .db
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(db);
        Ok(len)
    }

    /// Add a task, then re-run the dependency gate. Returns the ids whose
    /// status changed as a result (e.g. a root task that became `Ready`).
    pub fn create(&self, task: Task) -> Result<Vec<String>, TaskGraphError> {
        let mut graph = self.lock();
        graph.add(task)?;
        let changed = graph.recompute_ready();
        self.persist(&graph);
        Ok(changed)
    }

    /// Submit a whole LLM-authored build plan ATOMICALLY. The plan is validated
    /// ([`validate_plan`]: acyclic DAG, declared lanes/owner/branches, and —
    /// crucially — parallel tasks own DISJOINT file lanes) and staged on a clone
    /// of the live graph; the clone is swapped in only if EVERY task adds cleanly
    /// (no id collision with existing tasks). On any problem the whole plan is
    /// rejected with every error listed and the live graph is untouched — no
    /// partial graph, no silent fallback. This is the gate that lets the
    /// orchestrator LLM plan freely and safely. Returns the ids the gate moved to
    /// `Ready`/`Blocked`.
    pub fn submit_plan(&self, tasks: Vec<Task>) -> Result<Vec<String>, Vec<String>> {
        let ordered = validate_plan(tasks)?;
        let mut graph = self.lock();
        let mut staging = graph.clone();
        for task in ordered {
            staging
                .add(task)
                .map_err(|e| vec![format!("plan rejected — {e}")])?;
        }
        let changed = staging.recompute_ready();
        *graph = staging;
        self.persist(&graph);
        Ok(changed)
    }

    /// Mid-run RE-PLAN (autonomy gap #3): splice a Planner re-decomposition of a
    /// terminally-`Failed` task into the live graph ATOMICALLY. The subtasks are
    /// validated as a plan and added, and every task that depended on the failed
    /// task is rewired onto the new subtask sinks so the chain resumes — all
    /// staged on a clone and swapped in only on success, exactly like
    /// [`submit_plan`]. On any problem (the task isn't failed, an invalid subplan,
    /// an id collision) the whole re-plan is rejected and the live graph is
    /// untouched. The subtasks are authored by the Planner LLM at the call site;
    /// this method is the pure, atomic graph mutation.
    pub fn replan_failed_task(
        &self,
        failed_id: &str,
        subtasks: Vec<Task>,
    ) -> Result<super::replan::ReplanOutcome, Vec<String>> {
        let mut graph = self.lock();
        let mut staging = graph.clone();
        let outcome = super::replan::replan_into(&mut staging, failed_id, subtasks)?;
        *graph = staging;
        self.persist(&graph);
        Ok(outcome)
    }

    /// Transition a task, then re-run the gate (finishing a dependency can
    /// unblock dependents). Returns ids whose status changed by the gate.
    pub fn transition(&self, id: &str, to: TaskStatus) -> Result<Vec<String>, TaskGraphError> {
        let mut graph = self.lock();
        graph.transition(id, to)?;
        let changed = graph.recompute_ready();
        self.persist(&graph);
        Ok(changed)
    }

    /// Re-run the dependency gate explicitly. Returns ids whose status changed.
    /// Persists only when the gate actually changed something — a no-op gate
    /// pass must not issue a full-graph write (and add WAL write contention).
    pub fn recompute_ready(&self) -> Vec<String> {
        let mut graph = self.lock();
        let changed = graph.recompute_ready();
        if !changed.is_empty() {
            self.persist(&graph);
        }
        changed
    }

    /// A snapshot of every task in insertion order.
    pub fn list(&self) -> Vec<Task> {
        self.lock().list().into_iter().cloned().collect()
    }

    pub fn get(&self, id: &str) -> Option<Task> {
        self.lock().get(id).cloned()
    }

    /// Run a read-only computation over the locked graph without exposing or
    /// cloning it. Lets a higher layer (the orchestrator's scheduling decision)
    /// read the graph while keeping `task` independent of `orchestrator`.
    pub fn read<R>(&self, f: impl FnOnce(&TaskGraph) -> R) -> R {
        f(&self.lock())
    }

    /// Run a mutating computation over the locked graph. The autonomy
    /// controller uses this to drive `orchestrator::autonomy::step`/`run` over
    /// the live graph in one critical section.
    ///
    /// The closure holds the graph lock, so it must not re-enter the manager
    /// (`get`/`list`/`read`/... would deadlock — std `Mutex` is not reentrant).
    /// Any task metadata the loop needs (branch bindings, owners) must be read
    /// from the `&mut TaskGraph` it is handed — e.g. via a `TaskBranchSnapshot`
    /// captured before the mutation.
    pub fn with_graph_mut<R>(&self, f: impl FnOnce(&mut TaskGraph) -> R) -> R {
        let mut graph = self.lock();
        let result = f(&mut graph);
        // The closure may have mutated status, recovery counters, or branch
        // bindings (the autonomy loop does all three). Persist the snapshot so
        // none of it is lost on restart.
        self.persist(&graph);
        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::task::graph::Task;

    #[test]
    fn create_runs_the_dependency_gate() {
        let mgr = TaskManager::new();
        let changed = mgr.create(Task::new("root", "Root")).unwrap();
        assert_eq!(changed, ["root"]);
        assert_eq!(mgr.get("root").unwrap().status, TaskStatus::Ready);
    }

    #[test]
    fn create_rejects_unknown_dependency() {
        let mgr = TaskManager::new();
        assert!(mgr
            .create(Task::new("b", "B").with_dependencies(["missing".to_string()]))
            .is_err());
    }

    /// A fully-specified, dispatchable task for plan-submission tests.
    fn full(id: &str, outputs: &[&str], deps: &[&str]) -> Task {
        let mut t = Task::new(id, format!("do {id}"));
        t.owner = Some("worker".to_string());
        t.outputs = outputs.iter().map(|s| s.to_string()).collect();
        t.dependencies = deps.iter().map(|s| s.to_string()).collect();
        t.source_branch = Some(format!("feat/{id}"));
        t.target_branch = Some("main".to_string());
        t
    }

    #[test]
    fn submit_plan_adds_a_valid_plan_atomically_in_dependency_order() {
        let mgr = TaskManager::new();
        let changed = mgr
            .submit_plan(vec![
                full("c", &["src/c/**"], &["a"]), // listed before its dependency on purpose
                full("a", &["src/a/**"], &[]),
            ])
            .unwrap();
        assert_eq!(mgr.list().len(), 2);
        assert_eq!(mgr.get("a").unwrap().status, TaskStatus::Ready);
        assert_eq!(mgr.get("c").unwrap().status, TaskStatus::Pending);
        assert!(changed.contains(&"a".to_string()));
    }

    #[test]
    fn submit_plan_rejects_an_invalid_plan_and_leaves_the_graph_untouched() {
        let mgr = TaskManager::new();
        mgr.create(Task::new("existing", "E")).unwrap();
        // Two parallel tasks with overlapping lanes -> the whole plan is rejected.
        let errs = mgr
            .submit_plan(vec![
                full("x", &["src/shared/**"], &[]),
                full("y", &["src/shared/y.rs"], &[]),
            ])
            .unwrap_err();
        assert!(errs.iter().any(|e| e.contains("overlap")), "{errs:?}");
        assert_eq!(mgr.list().len(), 1, "no plan task was added");
        assert!(mgr.get("x").is_none() && mgr.get("y").is_none());
    }

    #[test]
    fn submit_plan_rejects_a_plan_colliding_with_an_existing_task() {
        let mgr = TaskManager::new();
        mgr.create(Task::new("dup", "D")).unwrap();
        let errs = mgr
            .submit_plan(vec![full("dup", &["src/dup/**"], &[])])
            .unwrap_err();
        assert!(errs.iter().any(|e| e.contains("dup")), "{errs:?}");
        assert_eq!(mgr.list().len(), 1, "graph untouched on collision");
    }

    #[test]
    fn finishing_a_dependency_unblocks_dependents_on_transition() {
        let mgr = TaskManager::new();
        mgr.create(Task::new("dep", "Dep")).unwrap();
        mgr.create(Task::new("child", "Child").with_dependencies(["dep".to_string()]))
            .unwrap();
        assert_eq!(mgr.get("child").unwrap().status, TaskStatus::Pending);

        mgr.transition("dep", TaskStatus::Running).unwrap();
        let changed = mgr.transition("dep", TaskStatus::Done).unwrap();
        assert!(changed.contains(&"child".to_string()));
        assert_eq!(mgr.get("child").unwrap().status, TaskStatus::Ready);
    }

    #[test]
    fn replan_failed_task_splices_subtasks_and_rewires_atomically() {
        let mgr = TaskManager::new();
        mgr.create(Task::new("dead", "Build")).unwrap();
        mgr.create(Task::new("child", "Use").with_dependencies(["dead".to_string()]))
            .unwrap();
        // `create` already gated `dead` to Ready (a root); drive it to Failed.
        mgr.transition("dead", TaskStatus::Running).unwrap();
        mgr.transition("dead", TaskStatus::Failed).unwrap();
        assert_eq!(mgr.get("child").unwrap().status, TaskStatus::Blocked);

        let outcome = mgr
            .replan_failed_task("dead", vec![full("x1", &["src/x1/**"], &[])])
            .unwrap();
        assert_eq!(outcome.subtask_ids, ["x1"]);
        assert_eq!(outcome.rewired_dependents, ["child"]);
        // child is rewired onto the new sink and the subtask is live in the graph.
        assert_eq!(mgr.get("child").unwrap().dependencies, ["x1"]);
        assert_eq!(mgr.get("x1").unwrap().status, TaskStatus::Ready);
    }

    #[test]
    fn replan_failed_task_rejects_and_leaves_graph_untouched() {
        let mgr = TaskManager::new();
        mgr.create(Task::new("dead", "Build")).unwrap(); // -> Ready (root)
        mgr.transition("dead", TaskStatus::Running).unwrap();
        mgr.transition("dead", TaskStatus::Failed).unwrap();
        // A subtask colliding with the existing `dead` id rejects the whole splice.
        let errs = mgr
            .replan_failed_task("dead", vec![full("dead", &["src/d/**"], &[])])
            .unwrap_err();
        assert!(!errs.is_empty());
        assert_eq!(mgr.list().len(), 1, "graph untouched on a rejected re-plan");
    }

    #[test]
    fn replan_refuses_a_task_that_is_not_failed() {
        let mgr = TaskManager::new();
        mgr.create(Task::new("live", "Live")).unwrap(); // Ready, not Failed
        let errs = mgr
            .replan_failed_task("live", vec![full("x1", &["src/x1/**"], &[])])
            .unwrap_err();
        assert!(errs[0].contains("not failed"), "{errs:?}");
        assert_eq!(mgr.list().len(), 1, "no subtask leaked in");
    }

    #[test]
    fn read_runs_a_closure_over_the_locked_graph() {
        let mgr = TaskManager::new();
        mgr.create(Task::new("a", "A")).unwrap();
        mgr.create(Task::new("b", "B")).unwrap();
        let ready = mgr.read(|g| g.ready_tasks().len());
        assert_eq!(ready, 2); // both roots are Ready after the gate
    }

    #[test]
    fn list_is_a_cloned_snapshot() {
        let mgr = TaskManager::new();
        mgr.create(Task::new("a", "A")).unwrap();
        mgr.create(Task::new("b", "B")).unwrap();
        let ids: Vec<String> = mgr.list().into_iter().map(|t| t.id).collect();
        assert_eq!(ids, ["a", "b"]);
    }

    #[test]
    fn with_graph_mut_drives_a_mutation_over_the_live_graph() {
        let mgr = TaskManager::new();
        mgr.create(Task::new("a", "A")).unwrap(); // -> Ready
        let from = mgr.with_graph_mut(|graph| {
            let before = graph.get("a").unwrap().status;
            graph.transition("a", TaskStatus::Running).unwrap();
            before
        });
        assert_eq!(from, TaskStatus::Ready);
        // The mutation is visible on the shared graph after the lock is released.
        assert_eq!(mgr.get("a").unwrap().status, TaskStatus::Running);
    }

    fn mem_db() -> Arc<ManagedDb> {
        Arc::new(ManagedDb::new(crate::db::Database::open_memory().unwrap()))
    }

    #[test]
    fn graph_survives_a_simulated_restart_via_db() {
        let db = mem_db();
        let first = TaskManager::new();
        assert_eq!(first.attach_db(db.clone()).unwrap(), 0);
        first.create(Task::new("dep", "Dep")).unwrap();
        first
            .create(Task::new("child", "Child").with_dependencies(["dep".to_string()]))
            .unwrap();
        first.transition("dep", TaskStatus::Running).unwrap();
        drop(first);

        // A brand-new manager attached to the SAME db restores the live graph.
        let second = TaskManager::new();
        assert_eq!(second.attach_db(db).unwrap(), 2);
        // `dep` was Running at "crash"; restore collapses the volatile in-flight
        // state to Pending, then recompute_ready re-derives it to Ready (dep has no
        // unfinished dependencies) so the loop re-dispatches it (its worker is gone).
        // The exact persisted status is still round-tripped by TaskRepo::load_graph —
        // the collapse + re-gate is applied at the manager's attach_db restore
        // boundary, not in the repo. Topology (child's dependency on dep) is preserved.
        assert_eq!(second.get("dep").unwrap().status, TaskStatus::Ready);
        assert_eq!(
            second.get("child").unwrap().dependencies,
            vec!["dep".to_string()]
        );
    }

    #[test]
    fn autonomy_style_mutations_through_with_graph_mut_are_persisted() {
        // The autonomy loop mutates the graph opaquely via with_graph_mut —
        // crash/rework/timeout counters must survive restart (the bug class
        // full-snapshot persistence closes).
        let db = mem_db();
        let first = TaskManager::new();
        first.attach_db(db.clone()).unwrap();
        first.create(Task::new("t", "T")).unwrap();
        first.with_graph_mut(|graph| {
            graph.transition("t", TaskStatus::Running).unwrap();
            graph.record_crash("t");
            graph.record_crash("t");
            graph.record_timeout("t");
        });
        drop(first);

        let second = TaskManager::new();
        second.attach_db(db).unwrap();
        let t = second.get("t").unwrap();
        // Restore collapses the volatile Running state to Pending and recompute_ready
        // re-readies it (no deps -> deps vacuously all-Done -> Ready), but the retry
        // budgets MUST survive verbatim — otherwise a poison task that already burned
        // its crash/timeout budget would reset and loop forever.
        assert_eq!(t.status, TaskStatus::Ready);
        assert_eq!(t.crash_attempts, 2);
        assert_eq!(t.timeout_attempts, 1);
        assert_eq!(t.rework_attempts, 0);
    }

    #[test]
    fn restore_regates_a_dependent_and_never_dispatches_it_before_its_dependency() {
        // Defense-in-depth for the dependency gate across restart. We persist an
        // (artificially) inconsistent crashed state — A Running AND B Running where B
        // depends on A — which the live gate never produces (B couldn't have started
        // until A was Done). Restore must NOT trust the persisted in-flight status: it
        // collapses both to Pending then recompute_ready re-derives readiness, so the
        // dependent B stays gated (NOT Ready) while only the root A is re-dispatchable.
        // Were the collapse straight to Ready, B would be dispatched out of order
        // against an unfinished dependency.
        let db = mem_db();
        {
            let mut g = TaskGraph::new();
            let mut a = Task::new("a", "A");
            a.status = TaskStatus::Running;
            g.add(a).unwrap();
            let mut b = Task::new("b", "B").with_dependencies(["a".to_string()]);
            b.status = TaskStatus::Running;
            g.add(b).unwrap();
            db.with(|d| TaskRepo::save_graph(d, &g)).unwrap();
        }

        let mgr = TaskManager::new();
        assert_eq!(mgr.attach_db(db).unwrap(), 2);
        // Root A (no deps) is re-readied for dispatch.
        assert_eq!(mgr.get("a").unwrap().status, TaskStatus::Ready);
        // Dependent B is re-gated to Pending — its dep A is not Done, so it must NOT
        // be Ready (the loop would otherwise run it ahead of A).
        assert_eq!(mgr.get("b").unwrap().status, TaskStatus::Pending);
    }
}
