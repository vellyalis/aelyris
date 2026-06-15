use std::sync::Mutex;

use super::graph::{Task, TaskGraph, TaskGraphError};
use super::status::TaskStatus;

/// Thread-safe owner of the Task Graph, managed in Tauri state (mirrors the
/// `AgentManager` / `InteractiveSessionManager` pattern). Mutating operations
/// re-run the dependency gate so callers get the ids that became `Ready` (or
/// `Blocked`) and can broadcast a `task-graph-updated` event.
#[derive(Default)]
pub struct TaskManager {
    graph: Mutex<TaskGraph>,
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

    /// Add a task, then re-run the dependency gate. Returns the ids whose
    /// status changed as a result (e.g. a root task that became `Ready`).
    pub fn create(&self, task: Task) -> Result<Vec<String>, TaskGraphError> {
        let mut graph = self.lock();
        graph.add(task)?;
        Ok(graph.recompute_ready())
    }

    /// Transition a task, then re-run the gate (finishing a dependency can
    /// unblock dependents). Returns ids whose status changed by the gate.
    pub fn transition(&self, id: &str, to: TaskStatus) -> Result<Vec<String>, TaskGraphError> {
        let mut graph = self.lock();
        graph.transition(id, to)?;
        Ok(graph.recompute_ready())
    }

    /// Re-run the dependency gate explicitly. Returns ids whose status changed.
    pub fn recompute_ready(&self) -> Vec<String> {
        self.lock().recompute_ready()
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
}
