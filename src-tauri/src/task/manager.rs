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
        let restored = db.with(TaskRepo::load_graph)?;
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
        assert_eq!(second.get("dep").unwrap().status, TaskStatus::Running);
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
        assert_eq!(t.status, TaskStatus::Running);
        assert_eq!(t.crash_attempts, 2);
        assert_eq!(t.timeout_attempts, 1);
        assert_eq!(t.rework_attempts, 0);
    }
}
