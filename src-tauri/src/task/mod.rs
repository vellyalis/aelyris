//! Task Graph subsystem.
//!
//! The canonical orchestration model for the autonomous build loop: every unit
//! of work is a `Task` with a lifecycle and explicit dependencies, so the
//! Planner can fan work out and the loop can gate `Ready` on completed deps.
//! See docs/specs/AETHER_COCKPIT_REQUIREMENTS_2026-06-13.md, Binding
//! Requirement 4. This is distinct from the UI kanban board
//! (`src/shared/types/kanban.ts`), which is a presentation projection.

pub mod decompose;
pub mod graph;
pub mod manager;
pub mod planner;
pub mod replan;
pub mod status;

pub use decompose::decompose_to_plan;
pub use graph::{Task, TaskGraph, TaskGraphError, TaskPriority};
pub use manager::TaskManager;
pub use planner::validate_plan;
pub use replan::{replan_into, ReplanOutcome};
pub use status::{TaskStatus, TASK_STATUS_NAMES};

/// Transform a loaded task graph for safe restore after a restart. Collapses the
/// volatile in-flight states (`Running`, `Review`) down to `Ready`: at crash the
/// worker process for such a task is gone (headless agents exited; visible-pane
/// PTYs died with the app), so leaving it `Running`/`Review` would stall the loop
/// waiting for a completion event that never fires. Every other field — topology,
/// branch bindings, outputs, and especially the three retry budgets — is preserved
/// verbatim, so a poison task that already exhausted its budget cannot reset and
/// loop forever. The task-graph analog of the mux snapshot's volatile-field reset.
pub fn tasks_for_restore(tasks: Vec<Task>) -> Vec<Task> {
    let known: std::collections::HashSet<String> = tasks.iter().map(|t| t.id.clone()).collect();
    tasks
        .into_iter()
        .map(|mut task| {
            // Defense-in-depth against a corrupt / partially-migrated persisted
            // graph: a dependency id absent from the loaded set is unsatisfiable.
            // Leaving it would let the gate (which filter_maps missing deps) treat
            // the task as "all deps done" and wrongly dispatch it. Mark it Failed
            // (terminal — never dispatched, but replannable) instead. Normal graphs
            // never hit this: `add()` enforces deps exist and tasks are never deleted.
            if task.dependencies.iter().any(|dep| !known.contains(dep)) {
                log::warn!(
                    "task graph: task '{}' depends on a task missing from the restored graph; marking Failed",
                    task.id
                );
                task.status = TaskStatus::Failed;
                return task;
            }
            // Collapse volatile in-flight states (Running, Review) to Ready — the
            // worker died at crash — so the loop safely re-dispatches them.
            if matches!(task.status, TaskStatus::Running | TaskStatus::Review) {
                task.status = TaskStatus::Ready;
            }
            task
        })
        .collect()
}

#[cfg(test)]
mod restore_tests {
    use super::*;

    #[test]
    fn restore_resets_in_flight_to_ready_and_preserves_budgets() {
        let mut running = Task::new("r", "Running");
        running.status = TaskStatus::Running;
        running.crash_attempts = 2;
        running.timeout_attempts = 1;
        let mut review = Task::new("v", "Review");
        review.status = TaskStatus::Review;
        review.rework_attempts = 2;
        let mut done = Task::new("d", "Done");
        done.status = TaskStatus::Done;
        let mut failed = Task::new("f", "Failed");
        failed.status = TaskStatus::Failed;
        let mut blocked = Task::new("b", "Blocked");
        blocked.status = TaskStatus::Blocked;

        let out = tasks_for_restore(vec![running, review, done, failed, blocked]);

        // Volatile in-flight states collapse to Ready (re-dispatchable next tick).
        assert_eq!(out[0].status, TaskStatus::Ready);
        assert_eq!(out[1].status, TaskStatus::Ready);
        // Stable states are untouched.
        assert_eq!(out[2].status, TaskStatus::Done);
        assert_eq!(out[3].status, TaskStatus::Failed);
        assert_eq!(out[4].status, TaskStatus::Blocked);
        // Retry budgets survive (a poison task can't reset and loop forever).
        assert_eq!(out[0].crash_attempts, 2);
        assert_eq!(out[0].timeout_attempts, 1);
        assert_eq!(out[1].rework_attempts, 2);
    }

    #[test]
    fn restore_marks_a_task_with_a_dangling_dependency_failed() {
        let mut ok = Task::new("ok", "OK");
        ok.status = TaskStatus::Running; // valid, in-flight
        let mut orphan = Task::new("orphan", "Orphan");
        orphan.status = TaskStatus::Ready;
        orphan.dependencies = vec!["missing".to_string()]; // dep absent from the set

        let out = tasks_for_restore(vec![ok, orphan]);
        // The valid in-flight task is reset to Ready as usual.
        assert_eq!(out[0].status, TaskStatus::Ready);
        // The task whose dependency is missing is Failed, not wrongly dispatched.
        assert_eq!(out[1].status, TaskStatus::Failed);
    }
}
