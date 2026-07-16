use std::panic::{catch_unwind, resume_unwind, AssertUnwindSafe};
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
/// truth. The autonomy loop mutates a revisioned clone and applies it through
/// one CAS boundary (status, crash/rework/timeout counters, branch bindings),
/// and every accepted mutation persists the WHOLE staged graph before publishing
/// it to memory — eliminating the "missed write-through site" bug class. A `db` is attached at startup
/// ([`attach_db`]); when absent (tests, non-persistent mode) the manager is
/// purely in-memory, exactly as before. Persist failures are returned and leave
/// the prior in-memory graph intact.
#[derive(Default)]
struct TaskGraphState {
    graph: TaskGraph,
    revision: u64,
    active_autonomy_lease: Option<u64>,
    next_lease: u64,
}

#[derive(Default)]
pub struct TaskManager {
    state: Mutex<TaskGraphState>,
    db: Mutex<Option<Arc<ManagedDb>>>,
    persistence: Mutex<()>,
    durability_required: bool,
}

impl TaskManager {
    pub fn new() -> Self {
        Self::default()
    }

    /// Production constructor: authoritative mutations fail closed until a
    /// durable database is attached. `new()` is the explicit ephemeral mode for
    /// isolated domain tests.
    pub fn new_durable() -> Self {
        Self {
            durability_required: true,
            ..Self::default()
        }
    }

    /// Poison-tolerant lock: a panicked holder must not wedge the whole task
    /// subsystem, so recover the inner graph rather than propagate the poison.
    fn lock(&self) -> std::sync::MutexGuard<'_, TaskGraphState> {
        self.state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn db(&self) -> Option<Arc<ManagedDb>> {
        self.db
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone()
    }

    fn require_mutation_available(state: &TaskGraphState) -> Result<(), TaskGraphError> {
        match state.active_autonomy_lease {
            Some(lease) => Err(TaskGraphError::MutationInProgress(lease)),
            None => Ok(()),
        }
    }

    fn publish_mutation(state: &mut TaskGraphState, graph: TaskGraph) {
        state.graph = graph;
        state.revision = state.revision.saturating_add(1);
    }

    fn persistence_lock(&self) -> std::sync::MutexGuard<'_, ()> {
        self.persistence
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn persist_graph(&self, graph: &TaskGraph) -> Result<(), TaskGraphError> {
        match self.db() {
            Some(db) => db
                .with(|database| TaskRepo::save_graph(database, graph))
                .map_err(TaskGraphError::Persistence),
            None if self.durability_required => Err(TaskGraphError::Persistence(
                "Task Graph durability is unavailable".to_string(),
            )),
            None => Ok(()),
        }
    }

    /// Stage one mutation on a clone, commit the complete graph snapshot, then
    /// publish it to the hot cache. Holding the state lock across the database
    /// commit intentionally serializes authoritative writers: a failed commit
    /// can never race with or be hidden by a later in-memory revision.
    fn commit_mutation<R>(
        &self,
        mutation: impl FnOnce(&mut TaskGraph) -> Result<(R, bool), TaskGraphError>,
    ) -> Result<R, TaskGraphError> {
        let _writer = self.persistence_lock();
        let mut state = self.lock();
        Self::require_mutation_available(&state)?;
        let mut staging = state.graph.clone();
        let (result, changed) = mutation(&mut staging)?;
        if changed {
            self.persist_graph(&staging)?;
            Self::publish_mutation(&mut state, staging);
        }
        Ok(result)
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
        let _writer = self.persistence_lock();
        let mut state = self.lock();
        Self::require_mutation_available(&state).map_err(|error| error.to_string())?;
        db.with(|database| TaskRepo::save_graph(database, &restored))?;
        *self
            .db
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(db);
        Self::publish_mutation(&mut state, restored);
        Ok(len)
    }

    /// Add a task, then re-run the dependency gate. Returns the ids whose
    /// status changed as a result (e.g. a root task that became `Ready`).
    pub fn create(&self, task: Task) -> Result<Vec<String>, TaskGraphError> {
        self.commit_mutation(|graph| {
            graph.add(task)?;
            let changed = graph.recompute_ready();
            Ok((changed, true))
        })
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
        self.commit_mutation(|staging| {
            for task in ordered {
                staging.add(task)?;
            }
            let changed = staging.recompute_ready();
            Ok((changed, true))
        })
        .map_err(|error| vec![format!("plan rejected — {error}")])
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
        let _writer = self.persistence_lock();
        let mut state = self.lock();
        let outcome = {
            Self::require_mutation_available(&state).map_err(|error| vec![error.to_string()])?;
            let mut staging = state.graph.clone();
            let outcome = super::replan::replan_into(&mut staging, failed_id, subtasks)?;
            self.persist_graph(&staging)
                .map_err(|error| vec![error.to_string()])?;
            Self::publish_mutation(&mut state, staging);
            outcome
        };
        Ok(outcome)
    }

    /// Transition a task, then re-run the gate (finishing a dependency can
    /// unblock dependents). Returns ids whose status changed by the gate.
    pub fn transition(&self, id: &str, to: TaskStatus) -> Result<Vec<String>, TaskGraphError> {
        self.commit_mutation(|graph| {
            graph.transition(id, to)?;
            let changed = graph.recompute_ready();
            Ok((changed, true))
        })
    }

    /// Re-run the dependency gate explicitly. Returns ids whose status changed.
    /// Persists only when the gate actually changed something — a no-op gate
    /// pass must not issue a full-graph write (and add WAL write contention).
    pub fn recompute_ready(&self) -> Result<Vec<String>, TaskGraphError> {
        self.commit_mutation(|graph| {
            let changed = graph.recompute_ready();
            let did_change = !changed.is_empty();
            Ok((changed, did_change))
        })
    }

    /// A snapshot of every task in insertion order.
    pub fn list(&self) -> Vec<Task> {
        self.lock().graph.list().into_iter().cloned().collect()
    }

    pub fn get(&self, id: &str) -> Option<Task> {
        self.lock().graph.get(id).cloned()
    }

    /// Run a read-only computation over the locked graph without exposing or
    /// cloning it. Lets a higher layer (the orchestrator's scheduling decision)
    /// read the graph while keeping `task` independent of `orchestrator`.
    pub fn read<R>(&self, f: impl FnOnce(&TaskGraph) -> R) -> R {
        f(&self.lock().graph)
    }

    /// Run one autonomy pass on a revisioned snapshot with no graph mutex held
    /// across dispatcher/gate/merge side effects. Other writers fail fast with
    /// `MutationInProgress` while the lease exists; readers remain available.
    /// The mutated snapshot is installed only if the lease and revision still
    /// match, then persisted outside the graph lock.
    pub fn run_autonomy_step<R>(
        &self,
        f: impl FnOnce(&mut TaskGraph) -> R,
    ) -> Result<R, TaskGraphError> {
        let (mut snapshot, expected_revision, lease) = {
            let mut state = self.lock();
            Self::require_mutation_available(&state)?;
            state.next_lease = state.next_lease.saturating_add(1).max(1);
            let lease = state.next_lease;
            state.active_autonomy_lease = Some(lease);
            (state.graph.clone(), state.revision, lease)
        };

        let outcome = catch_unwind(AssertUnwindSafe(|| f(&mut snapshot)));
        let result = match outcome {
            Ok(result) => result,
            Err(payload) => {
                let mut state = self.lock();
                if state.active_autonomy_lease == Some(lease) {
                    state.active_autonomy_lease = None;
                }
                drop(state);
                resume_unwind(payload);
            }
        };

        let _writer = self.persistence_lock();
        {
            let mut state = self.lock();
            if state.active_autonomy_lease != Some(lease) || state.revision != expected_revision {
                let actual = state.revision;
                if state.active_autonomy_lease == Some(lease) {
                    state.active_autonomy_lease = None;
                }
                return Err(TaskGraphError::StaleRevision {
                    expected: expected_revision,
                    actual,
                });
            }
            if let Err(error) = self.persist_graph(&snapshot) {
                state.active_autonomy_lease = None;
                return Err(error);
            }
            state.active_autonomy_lease = None;
            Self::publish_mutation(&mut state, snapshot);
        }
        Ok(result)
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
        assert!(errs.iter().any(|e| e.contains("collide")), "{errs:?}");
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
    fn autonomy_snapshot_apply_drives_a_mutation_over_the_live_graph() {
        let mgr = TaskManager::new();
        mgr.create(Task::new("a", "A")).unwrap(); // -> Ready
        let from = mgr
            .run_autonomy_step(|graph| {
                let before = graph.get("a").unwrap().status;
                graph.transition("a", TaskStatus::Running).unwrap();
                before
            })
            .unwrap();
        assert_eq!(from, TaskStatus::Ready);
        // The mutation is visible on the shared graph after the lock is released.
        assert_eq!(mgr.get("a").unwrap().status, TaskStatus::Running);
    }

    #[test]
    fn autonomy_side_effect_window_keeps_reads_live_and_writers_fail_fast() {
        let manager = Arc::new(TaskManager::new());
        manager.create(Task::new("a", "A")).unwrap();
        let (entered_tx, entered_rx) = std::sync::mpsc::channel();
        let (release_tx, release_rx) = std::sync::mpsc::channel();
        let worker = manager.clone();
        let handle = std::thread::spawn(move || {
            worker.run_autonomy_step(|graph| {
                entered_tx.send(()).unwrap();
                release_rx.recv().unwrap();
                graph.transition("a", TaskStatus::Running).unwrap();
            })
        });
        entered_rx
            .recv_timeout(std::time::Duration::from_secs(1))
            .unwrap();

        assert_eq!(manager.list().len(), 1, "reads stay available under lease");
        assert!(matches!(
            manager.create(Task::new("b", "B")),
            Err(TaskGraphError::MutationInProgress(_))
        ));
        release_tx.send(()).unwrap();
        handle.join().unwrap().unwrap();
        assert_eq!(manager.get("a").unwrap().status, TaskStatus::Running);
        assert!(manager.get("b").is_none());
    }

    #[test]
    fn autonomy_apply_rejects_revision_drift_and_clears_lease() {
        let manager = Arc::new(TaskManager::new());
        manager.create(Task::new("a", "A")).unwrap();
        let (entered_tx, entered_rx) = std::sync::mpsc::channel();
        let (release_tx, release_rx) = std::sync::mpsc::channel();
        let worker = manager.clone();
        let handle = std::thread::spawn(move || {
            worker.run_autonomy_step(|graph| {
                entered_tx.send(()).unwrap();
                release_rx.recv().unwrap();
                graph.transition("a", TaskStatus::Running).unwrap();
            })
        });
        entered_rx.recv().unwrap();
        {
            // Inject impossible internal drift to prove the final CAS guard. Public
            // writers cannot do this: they fail fast while the lease is active.
            let mut state = manager.lock();
            state.revision += 1;
        }
        release_tx.send(()).unwrap();
        assert!(matches!(
            handle.join().unwrap(),
            Err(TaskGraphError::StaleRevision { .. })
        ));
        assert_eq!(manager.get("a").unwrap().status, TaskStatus::Ready);
        manager.create(Task::new("b", "B")).unwrap();
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
    fn autonomy_snapshot_mutations_are_persisted() {
        // The autonomy loop mutates a revisioned snapshot —
        // crash/rework/timeout counters must survive restart (the bug class
        // full-snapshot persistence closes).
        let db = mem_db();
        let first = TaskManager::new();
        first.attach_db(db.clone()).unwrap();
        first.create(Task::new("t", "T")).unwrap();
        first
            .run_autonomy_step(|graph| {
                graph.transition("t", TaskStatus::Running).unwrap();
                graph.record_crash("t");
                graph.record_crash("t");
                graph.record_timeout("t");
            })
            .unwrap();
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

    #[test]
    fn persistence_failure_does_not_publish_staged_graph_mutation() {
        let db = mem_db();
        let mgr = TaskManager::new();
        mgr.attach_db(db.clone()).unwrap();
        db.with(|database| {
            database
                .conn()
                .execute("DROP TABLE tasks", [])
                .map(|_| ())
                .map_err(|error| error.to_string())
        })
        .unwrap();

        assert!(matches!(
            mgr.create(Task::new("uncommitted", "Uncommitted")),
            Err(TaskGraphError::Persistence(_))
        ));
        assert!(mgr.get("uncommitted").is_none());
        assert!(mgr.list().is_empty());
    }

    #[test]
    fn production_mode_rejects_mutation_until_durability_is_attached() {
        let mgr = TaskManager::new_durable();
        assert!(matches!(
            mgr.create(Task::new("blocked", "Blocked")),
            Err(TaskGraphError::Persistence(_))
        ));
        assert!(mgr.get("blocked").is_none());
    }

    #[test]
    fn autonomy_persistence_failure_keeps_prior_graph_and_releases_lease() {
        let db = mem_db();
        let mgr = TaskManager::new();
        mgr.attach_db(db.clone()).unwrap();
        mgr.create(Task::new("stable", "Stable")).unwrap();
        db.with(|database| {
            database
                .conn()
                .execute("DROP TABLE tasks", [])
                .map(|_| ())
                .map_err(|error| error.to_string())
        })
        .unwrap();

        assert!(matches!(
            mgr.run_autonomy_step(|graph| {
                graph.transition("stable", TaskStatus::Running).unwrap();
            }),
            Err(TaskGraphError::Persistence(_))
        ));
        assert_eq!(mgr.get("stable").unwrap().status, TaskStatus::Ready);
        assert_eq!(mgr.lock().active_autonomy_lease, None);
    }
}
