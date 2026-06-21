use std::sync::{Mutex, OnceLock};

use super::graph::{Task, TaskGraph, TaskGraphError};
use super::status::TaskStatus;
use crate::db::ManagedDb;

/// Thread-safe owner of the Task Graph, managed in Tauri state (mirrors the
/// `AgentManager` / `InteractiveSessionManager` pattern). Mutating operations
/// re-run the dependency gate so callers get the ids that became `Ready` (or
/// `Blocked`) and can broadcast a `task-graph-updated` event.
///
/// The graph is durably persisted: once [`attach_db`](Self::attach_db) wires a DB
/// handle at launch, every mutating op writes the whole graph through to SQLite so
/// an interrupted autonomous build survives an app restart. Persistence is
/// best-effort (a DB error never fails the in-memory op) and runs UNDER the graph
/// lock so memory and the DB never diverge. All graph mutations funnel through this
/// manager (create/transition/recompute_ready/with_graph_mut), so this is the
/// single save-on-write choke point.
#[derive(Default)]
pub struct TaskManager {
    graph: Mutex<TaskGraph>,
    db: OnceLock<ManagedDb>,
}

impl TaskManager {
    pub fn new() -> Self {
        Self::default()
    }

    /// Wire the durable store. Called once at launch, AFTER `hydrate`, so the
    /// restore replay does not re-persist what it just read. A second call is a
    /// programming error (the first handle stays wired) — log it.
    pub fn attach_db(&self, db: ManagedDb) {
        if self.db.set(db).is_err() {
            log::warn!("task graph: attach_db called more than once; keeping the first DB handle");
        }
    }

    /// Silently restore the graph at launch from a (volatile-reset) snapshot.
    /// Bypasses persistence — a restore must not re-write the rows it just read.
    /// Call BEFORE `attach_db`.
    pub fn hydrate(&self, tasks: Vec<Task>) {
        self.lock().hydrate_restore(tasks);
    }

    /// Poison-tolerant lock: a panicked holder must not wedge the whole task
    /// subsystem, so recover the inner graph rather than propagate the poison.
    fn lock(&self) -> std::sync::MutexGuard<'_, TaskGraph> {
        self.graph
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// Best-effort whole-graph write-through. Snapshots the LOCKED graph handed in
    /// (no re-lock — the caller already holds the guard) and replaces the persisted
    /// snapshot. Errors are logged, never propagated — the in-memory mutation
    /// already succeeded. A no-op when no DB is attached (e.g. unit tests).
    fn persist_locked(&self, graph: &TaskGraph) {
        let Some(db) = self.db.get() else {
            return;
        };
        let snapshot: Vec<Task> = graph.list().into_iter().cloned().collect();
        if let Err(err) = db.with(|d| d.replace_task_graph(&snapshot)) {
            log::warn!("task graph: persist failed: {err}");
        }
    }

    /// Add a task, then re-run the dependency gate. Returns the ids whose
    /// status changed as a result (e.g. a root task that became `Ready`).
    pub fn create(&self, task: Task) -> Result<Vec<String>, TaskGraphError> {
        let mut graph = self.lock();
        graph.add(task)?;
        let changed = graph.recompute_ready();
        self.persist_locked(&graph);
        Ok(changed)
    }

    /// Transition a task, then re-run the gate (finishing a dependency can
    /// unblock dependents). Returns ids whose status changed by the gate.
    pub fn transition(&self, id: &str, to: TaskStatus) -> Result<Vec<String>, TaskGraphError> {
        let mut graph = self.lock();
        graph.transition(id, to)?;
        let changed = graph.recompute_ready();
        self.persist_locked(&graph);
        Ok(changed)
    }

    /// Re-run the dependency gate explicitly. Returns ids whose status changed.
    pub fn recompute_ready(&self) -> Vec<String> {
        let mut graph = self.lock();
        let changed = graph.recompute_ready();
        // An idempotent no-op recompute must not churn the DB.
        if !changed.is_empty() {
            self.persist_locked(&graph);
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
    /// the live graph in one critical section. The whole graph is persisted once
    /// after the closure returns (one step mutates many tasks), reusing the held
    /// lock — no re-entry into the manager.
    ///
    /// The closure holds the graph lock, so it must not re-enter the manager
    /// (`get`/`list`/`read`/... would deadlock — std `Mutex` is not reentrant).
    /// Any task metadata the loop needs (branch bindings, owners) must be read
    /// from the `&mut TaskGraph` it is handed — e.g. via a `TaskBranchSnapshot`
    /// captured before the mutation.
    pub fn with_graph_mut<R>(&self, f: impl FnOnce(&mut TaskGraph) -> R) -> R {
        let mut graph = self.lock();
        let result = f(&mut graph);
        self.persist_locked(&graph);
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

    #[test]
    fn persists_and_restores_with_in_flight_reset_after_restart() {
        use crate::db::{Database, ManagedDb};
        let db = ManagedDb::new(Database::open_memory().unwrap());

        let mgr = TaskManager::new();
        mgr.attach_db(db.clone());
        mgr.create(Task::new("a", "A")).unwrap(); // root -> Ready after the gate
        mgr.create(Task::new("b", "B").with_dependencies(["a".to_string()]))
            .unwrap(); // depends on a -> Pending
        mgr.transition("a", TaskStatus::Running).unwrap(); // a is now in-flight

        // Simulate a restart: a fresh manager loaded from the SAME db, volatile-reset.
        let reloaded = TaskManager::new();
        let loaded = db.with(|d| d.load_task_graph()).unwrap();
        reloaded.hydrate(super::super::tasks_for_restore(loaded));

        // Topology + insertion order survived the restart.
        let ids: Vec<String> = reloaded.list().into_iter().map(|t| t.id).collect();
        assert_eq!(ids, ["a", "b"]);
        // The mid-flight task came back Ready (re-dispatchable); the dependent
        // stays Pending. Nothing is stuck Running with no live worker.
        assert_eq!(reloaded.get("a").unwrap().status, TaskStatus::Ready);
        assert_eq!(reloaded.get("b").unwrap().status, TaskStatus::Pending);
    }
}
