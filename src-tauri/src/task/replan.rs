//! Mid-run RE-PLANNING (autonomy gap #3): splice a Planner re-decomposition of a
//! terminally-failed task into the live graph.
//!
//! When a task exhausts its retry budget the loop leaves it `Failed` and raises a
//! `RecoveryAction::EscalateToPlanner` escalation. Instead of that escalation
//! being only a human alert, the runtime asks the Planner to re-decompose the
//! failed task into smaller subtasks (the LLM half — [`super::decompose_to_plan`],
//! off the graph lock) and then calls [`TaskManager::replan_failed_task`], which
//! uses [`replan_into`] to splice the validated subtasks in and REWIRE the failed
//! task's blocked dependents onto the new subtask sinks — so the dependency chain
//! resumes through the fresh work rather than stalling on the dead task.
//!
//! This module is the pure, I/O-free splice: it takes already-authored subtasks
//! and mutates a graph, so it is unit-tested without an LLM. The manager wraps it
//! in a clone-stage-swap for atomicity (mirrors `submit_plan`).

use std::collections::HashSet;

use super::graph::{Task, TaskGraph};
use super::planner::validate_plan;
use super::status::TaskStatus;

/// What a re-plan splice did, for the caller's report/events.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReplanOutcome {
    /// The subtask ids added to the graph (dependency order).
    pub subtask_ids: Vec<String>,
    /// Existing tasks whose dependencies were rewired off the failed task onto
    /// the subtask sinks (the failed task's former dependents).
    pub rewired_dependents: Vec<String>,
    /// Ids the dependency gate moved to `Ready`/`Blocked` after the splice.
    pub readied: Vec<String>,
}

/// The plan's SINK tasks: ids that no other task in the plan depends on (the
/// terminal nodes of the re-decomposition). A dependent of the failed task must
/// wait on ALL sinks, so the chain only resumes once the whole re-plan completes.
fn plan_sinks(tasks: &[Task]) -> Vec<String> {
    let depended: HashSet<&str> = tasks
        .iter()
        .flat_map(|t| t.dependencies.iter().map(String::as_str))
        .collect();
    let mut sinks: Vec<String> = tasks
        .iter()
        .filter(|t| !depended.contains(t.id.as_str()))
        .map(|t| t.id.clone())
        .collect();
    // Sorted so a rewired dependent's new dependency list is deterministic
    // regardless of the plan's internal ordering.
    sinks.sort();
    sinks
}

/// Splice a re-decomposition of `failed_id` into `graph`. Pure (no I/O): the
/// caller supplies the subtasks (from the Planner) and is responsible for
/// atomicity — `TaskManager::replan_failed_task` runs this on a CLONE and only
/// swaps it in on `Ok`, so a rejected re-plan never leaves a partial graph.
///
/// Steps: (1) require `failed_id` to exist and be terminally `Failed` — re-plan is
/// for tasks the loop gave up on, not live ones; (2) validate the subtasks as a
/// plan ([`validate_plan`]: acyclic, disjoint parallel lanes, declared
/// owner/outputs/branches); (3) add them (an id collision with an existing task
/// rejects the whole splice); (4) rewire every dependent of `failed_id` onto the
/// subtask sinks; (5) re-run the dependency gate. The failed task is left in the
/// graph (terminal, an audit record) but orphaned — nothing depends on it anymore.
pub fn replan_into(
    graph: &mut TaskGraph,
    failed_id: &str,
    subtasks: Vec<Task>,
) -> Result<ReplanOutcome, Vec<String>> {
    match graph.get(failed_id) {
        None => return Err(vec![format!("cannot re-plan unknown task '{failed_id}'")]),
        Some(task) if task.status != TaskStatus::Failed => {
            return Err(vec![format!(
                "cannot re-plan '{failed_id}' — it is '{}', not failed (re-plan is only for a task the loop gave up on)",
                task.status.as_str()
            )]);
        }
        _ => {}
    }

    let ordered = validate_plan(subtasks)?;
    let subtask_ids: Vec<String> = ordered.iter().map(|t| t.id.clone()).collect();
    let sinks = plan_sinks(&ordered);

    for task in ordered {
        graph
            .add(task)
            .map_err(|e| vec![format!("re-plan rejected — {e}")])?;
    }
    let rewired_dependents = graph.rewire_dependency(failed_id, &sinks);
    let readied = graph.recompute_ready();

    Ok(ReplanOutcome {
        subtask_ids,
        rewired_dependents,
        readied,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A fully-specified, dispatchable subtask (validate_plan requires all of these).
    fn sub(id: &str, outputs: &[&str], deps: &[&str]) -> Task {
        let mut t = Task::new(id, format!("do {id}"));
        t.owner = Some("worker".to_string());
        t.outputs = outputs.iter().map(|s| s.to_string()).collect();
        t.dependencies = deps.iter().map(|s| s.to_string()).collect();
        t.source_branch = Some(format!("feat/{id}"));
        t.target_branch = Some("main".to_string());
        t
    }

    /// Build a graph with a terminally-FAILED `dead` task and a `child` blocked on it.
    fn failed_with_blocked_child() -> TaskGraph {
        let mut g = TaskGraph::new();
        g.add(Task::new("dead", "Build the thing")).unwrap();
        g.add(Task::new("child", "Use the thing").with_dependencies(["dead".into()]))
            .unwrap();
        g.transition("dead", TaskStatus::Ready).unwrap();
        g.transition("dead", TaskStatus::Running).unwrap();
        g.transition("dead", TaskStatus::Failed).unwrap();
        g.recompute_ready(); // child -> Blocked (dep failed)
        assert_eq!(g.get("child").unwrap().status, TaskStatus::Blocked);
        g
    }

    #[test]
    fn splices_subtasks_and_rewires_the_blocked_dependent_onto_the_sink() {
        let mut g = failed_with_blocked_child();
        // Re-decompose `dead` into x1 -> x2 (x2 is the sink).
        let outcome = replan_into(
            &mut g,
            "dead",
            vec![
                sub("x1", &["src/x1/**"], &[]),
                sub("x2", &["src/x2/**"], &["x1"]),
            ],
        )
        .unwrap();

        assert_eq!(outcome.subtask_ids, ["x1", "x2"]);
        assert_eq!(outcome.rewired_dependents, ["child"]);
        // child now waits on the sink (x2), not the dead task.
        assert_eq!(g.get("child").unwrap().dependencies, ["x2"]);
        // x1 (a root subtask) is Ready; child stays Blocked until the re-plan finishes.
        assert_eq!(g.get("x1").unwrap().status, TaskStatus::Ready);
        assert_eq!(g.get("child").unwrap().status, TaskStatus::Blocked);

        // Drive the subtasks to Done in dependency order — the gate then promotes child.
        g.transition("x1", TaskStatus::Running).unwrap();
        g.transition("x1", TaskStatus::Done).unwrap();
        g.recompute_ready(); // x2: Pending -> Ready (its dep x1 is Done)
        g.transition("x2", TaskStatus::Running).unwrap();
        g.transition("x2", TaskStatus::Done).unwrap();
        g.recompute_ready(); // child: Blocked -> Ready (all deps Done)
        assert_eq!(
            g.get("child").unwrap().status,
            TaskStatus::Ready,
            "the chain resumes through the re-planned subtasks"
        );
    }

    #[test]
    fn a_leaf_failure_is_recovered_with_no_rewire() {
        let mut g = TaskGraph::new();
        g.add(Task::new("dead", "Leaf")).unwrap();
        g.transition("dead", TaskStatus::Ready).unwrap();
        g.transition("dead", TaskStatus::Running).unwrap();
        g.transition("dead", TaskStatus::Failed).unwrap();
        let outcome = replan_into(&mut g, "dead", vec![sub("x1", &["src/x1/**"], &[])]).unwrap();
        assert_eq!(outcome.subtask_ids, ["x1"]);
        assert!(
            outcome.rewired_dependents.is_empty(),
            "no dependents to rewire"
        );
        assert_eq!(g.get("x1").unwrap().status, TaskStatus::Ready);
    }

    #[test]
    fn refuses_to_replan_a_task_that_is_not_failed() {
        let mut g = TaskGraph::new();
        g.add(Task::new("live", "Live")).unwrap();
        g.transition("live", TaskStatus::Ready).unwrap();
        g.transition("live", TaskStatus::Running).unwrap();
        let err = replan_into(&mut g, "live", vec![sub("x1", &["src/x1/**"], &[])]).unwrap_err();
        assert!(err[0].contains("not failed"), "{err:?}");
        // The graph is untouched — no subtask leaked in.
        assert!(g.get("x1").is_none());
    }

    #[test]
    fn refuses_to_replan_an_unknown_task() {
        let mut g = TaskGraph::new();
        let err = replan_into(&mut g, "ghost", vec![sub("x1", &["src/x1/**"], &[])]).unwrap_err();
        assert!(err[0].contains("unknown task"), "{err:?}");
    }

    #[test]
    fn rejects_an_invalid_subplan_overlapping_lanes() {
        let mut g = failed_with_blocked_child();
        // Two parallel subtasks share a file lane -> validate_plan rejects.
        let err = replan_into(
            &mut g,
            "dead",
            vec![
                sub("x1", &["src/shared/**"], &[]),
                sub("x2", &["src/shared/x.rs"], &[]),
            ],
        )
        .unwrap_err();
        assert!(err.iter().any(|e| e.contains("collide")), "{err:?}");
    }

    #[test]
    fn rejects_a_subtask_colliding_with_an_existing_id() {
        let mut g = failed_with_blocked_child();
        // A subtask reuses the existing `child` id -> add collision rejects the splice.
        let err = replan_into(&mut g, "dead", vec![sub("child", &["src/c/**"], &[])]).unwrap_err();
        assert!(err.iter().any(|e| e.contains("child")), "{err:?}");
    }

    #[test]
    fn plan_sinks_finds_all_terminal_nodes() {
        // a -> c, b -> c : c is the sole sink. Diamond a->{b,c}->d : d is the sink.
        let tasks = vec![
            sub("a", &["src/a/**"], &[]),
            sub("b", &["src/b/**"], &["a"]),
            sub("c", &["src/c/**"], &["a"]),
            sub("d", &["src/d/**"], &["b", "c"]),
        ];
        assert_eq!(plan_sinks(&tasks), ["d"]);
        // Two independent leaves -> two sinks.
        let two = vec![sub("p", &["src/p/**"], &[]), sub("q", &["src/q/**"], &[])];
        let mut sinks = plan_sinks(&two);
        sinks.sort();
        assert_eq!(sinks, ["p", "q"]);
    }
}
