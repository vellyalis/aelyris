//! Autonomy loop coordinator — composes the scheduling brain (`plan`), the
//! review verdict, and task transitions over injected I/O ports.
//!
//! The ports (dispatch an agent, gather gate results, merge a branch) are a
//! trait so the entire loop coordination is unit-testable with fakes; the real
//! LLM/PTY/git implementations are thin adapters wired at runtime. This is how
//! the autonomous build loop (one instruction -> parallel impl -> review ->
//! auto-merge) is implemented with 100% confidence in its logic, leaving only
//! the I/O adapters for the live environment. See
//! docs/specs/AETHER_COCKPIT_REQUIREMENTS_2026-06-13.md (Agent Hierarchy, BR9,
//! Acceptance: end-to-end autonomy).

use super::{plan, LoopState};
use crate::cost::{CostCaps, CostUsage};
use crate::review::{review, GateResults, ReviewVerdict};
use crate::task::{TaskGraph, TaskStatus};

/// Runtime side effects the loop drives. Real impl: LLM-spawned agents, PTY
/// monitoring, git merge. Tests: a fake that records calls and returns scripted
/// gate results.
pub trait LoopPorts {
    /// Start an agent for `task_id`. `Ok` means the task is now Running.
    fn dispatch(&mut self, task_id: &str) -> Result<(), String>;
    /// Quality-gate results for a task awaiting review.
    fn gate(&mut self, task_id: &str) -> GateResults;
    /// The reviewer agent's id (must differ from the implementer to merge).
    fn reviewer_id(&self) -> String;
    /// The agent that implemented `task_id`.
    fn implementer_id(&self, task_id: &str) -> String;
    /// Merge the reviewed branch for `task_id` into the target.
    fn merge(&mut self, task_id: &str) -> Result<(), String>;
}

/// What one coordination step did.
#[derive(Debug, Clone, PartialEq)]
pub struct StepReport {
    pub dispatched: Vec<String>,
    pub merged: Vec<String>,
    pub rejected: Vec<String>,
    pub state: LoopState,
}

fn running_count(graph: &TaskGraph) -> usize {
    graph
        .list()
        .iter()
        .filter(|task| task.status == TaskStatus::Running)
        .count()
}

/// Drive one coordination step:
/// 1. Resolve every task awaiting `Review`: gate -> verdict -> merge+`Done`,
///    reject back to `Running`, or `Blocked` on a self-review.
/// 2. Re-run the dependency gate (a merge can unblock dependents).
/// 3. Plan and dispatch ready tasks up to the concurrency/budget limit,
///    transitioning each dispatched task to `Running`.
///
/// `usage` is the pre-step agent/budget snapshot; the returned `state` reflects
/// the graph after this step's transitions.
pub fn step(
    graph: &mut TaskGraph,
    caps: &CostCaps,
    usage: &CostUsage,
    ports: &mut impl LoopPorts,
) -> StepReport {
    let mut merged = Vec::new();
    let mut rejected = Vec::new();

    // 1. Resolve reviews.
    let in_review: Vec<String> = graph
        .list()
        .iter()
        .filter(|task| task.status == TaskStatus::Review)
        .map(|task| task.id.clone())
        .collect();
    for id in in_review {
        let gates = ports.gate(&id);
        match review(&gates, &ports.reviewer_id(), &ports.implementer_id(&id)) {
            ReviewVerdict::Merge => {
                if ports.merge(&id).is_ok() {
                    let _ = graph.transition(&id, TaskStatus::Done);
                    merged.push(id);
                } else {
                    // Merge failed (e.g. conflict) -> rework.
                    let _ = graph.transition(&id, TaskStatus::Running);
                }
            }
            ReviewVerdict::Reject { .. } => {
                let _ = graph.transition(&id, TaskStatus::Running);
                rejected.push(id);
            }
            ReviewVerdict::SelfReviewBlocked => {
                // No distinct reviewer this pass: leave the task awaiting review
                // (Review is terminal-ish here) and flag it so the controller
                // assigns a different reviewer before the next step. Don't merge,
                // don't rework — the work itself isn't the problem.
                rejected.push(id);
            }
        }
    }

    // 2. Dependency gate (merges may have unblocked dependents).
    graph.recompute_ready();

    // 3. Plan + dispatch.
    let dispatch_plan = plan(graph, caps, usage);
    let mut dispatched = Vec::new();
    for id in &dispatch_plan.to_dispatch {
        if ports.dispatch(id).is_ok() {
            let _ = graph.transition(id, TaskStatus::Running);
            dispatched.push(id.clone());
        }
    }

    // Final state reflects the graph after this step (running count updated).
    let usage_after = CostUsage {
        active_agents: running_count(graph),
        ..*usage
    };
    let state = plan(graph, caps, &usage_after).state;

    StepReport {
        dispatched,
        merged,
        rejected,
        state,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::task::graph::Task;
    use std::collections::HashMap;

    /// Records calls; gate results and merge outcomes are scripted per task.
    struct FakePorts {
        reviewer: String,
        implementer: String,
        gates: HashMap<String, GateResults>,
        merge_ok: bool,
        dispatched: Vec<String>,
        merged: Vec<String>,
    }

    impl FakePorts {
        fn new() -> Self {
            Self {
                reviewer: "reviewer".to_string(),
                implementer: "impl".to_string(),
                gates: HashMap::new(),
                merge_ok: true,
                dispatched: Vec::new(),
                merged: Vec::new(),
            }
        }
    }

    const GREEN: GateResults = GateResults {
        tests_pass: true,
        lint_pass: true,
        types_pass: true,
        design_consistent: true,
        context_aligned: true,
    };

    impl LoopPorts for FakePorts {
        fn dispatch(&mut self, task_id: &str) -> Result<(), String> {
            self.dispatched.push(task_id.to_string());
            Ok(())
        }
        fn gate(&mut self, task_id: &str) -> GateResults {
            *self.gates.get(task_id).unwrap_or(&GREEN)
        }
        fn reviewer_id(&self) -> String {
            self.reviewer.clone()
        }
        fn implementer_id(&self, _task_id: &str) -> String {
            self.implementer.clone()
        }
        fn merge(&mut self, task_id: &str) -> Result<(), String> {
            if self.merge_ok {
                self.merged.push(task_id.to_string());
                Ok(())
            } else {
                Err("conflict".to_string())
            }
        }
    }

    fn caps(max: usize) -> CostCaps {
        CostCaps {
            max_agents: Some(max),
            ..CostCaps::default()
        }
    }

    #[test]
    fn dispatches_ready_tasks_to_running() {
        let mut g = TaskGraph::new();
        g.add(Task::new("a", "A")).unwrap();
        g.add(Task::new("b", "B")).unwrap();
        g.recompute_ready();
        let mut ports = FakePorts::new();
        let report = step(&mut g, &caps(4), &CostUsage::default(), &mut ports);
        assert_eq!(report.dispatched.len(), 2);
        assert_eq!(g.get("a").unwrap().status, TaskStatus::Running);
        assert_eq!(report.state, LoopState::Active);
        assert_eq!(ports.dispatched, ["a", "b"]);
    }

    #[test]
    fn green_review_merges_and_completes() {
        let mut g = TaskGraph::new();
        g.add(Task::new("a", "A")).unwrap();
        g.recompute_ready();
        g.transition("a", TaskStatus::Running).unwrap();
        g.transition("a", TaskStatus::Review).unwrap();
        let mut ports = FakePorts::new();
        let report = step(&mut g, &caps(4), &CostUsage::default(), &mut ports);
        assert_eq!(report.merged, ["a"]);
        assert_eq!(g.get("a").unwrap().status, TaskStatus::Done);
        assert_eq!(report.state, LoopState::Complete);
        assert_eq!(ports.merged, ["a"]);
    }

    #[test]
    fn red_review_sends_back_to_running() {
        let mut g = TaskGraph::new();
        g.add(Task::new("a", "A")).unwrap();
        g.recompute_ready();
        g.transition("a", TaskStatus::Running).unwrap();
        g.transition("a", TaskStatus::Review).unwrap();
        let mut ports = FakePorts::new();
        ports.gates.insert(
            "a".to_string(),
            GateResults {
                tests_pass: false,
                ..GREEN
            },
        );
        let report = step(&mut g, &caps(4), &CostUsage::default(), &mut ports);
        assert_eq!(report.rejected, ["a"]);
        assert!(report.merged.is_empty());
        assert_eq!(g.get("a").unwrap().status, TaskStatus::Running);
    }

    #[test]
    fn self_review_blocks() {
        let mut g = TaskGraph::new();
        g.add(Task::new("a", "A")).unwrap();
        g.recompute_ready();
        g.transition("a", TaskStatus::Running).unwrap();
        g.transition("a", TaskStatus::Review).unwrap();
        let mut ports = FakePorts::new();
        ports.implementer = "reviewer".to_string(); // same as reviewer
        let report = step(&mut g, &caps(4), &CostUsage::default(), &mut ports);
        assert!(report.merged.is_empty());
        assert_eq!(report.rejected, ["a"]);
        // Work isn't reworked; it stays awaiting a distinct reviewer.
        assert_eq!(g.get("a").unwrap().status, TaskStatus::Review);
    }

    #[test]
    fn merge_unblocks_dependents_in_the_same_step() {
        let mut g = TaskGraph::new();
        g.add(Task::new("dep", "Dep")).unwrap();
        g.add(Task::new("child", "Child").with_dependencies(["dep".into()]))
            .unwrap();
        g.recompute_ready();
        g.transition("dep", TaskStatus::Running).unwrap();
        g.transition("dep", TaskStatus::Review).unwrap();
        let mut ports = FakePorts::new();
        // dep passes review -> Done -> child becomes Ready -> dispatched, all in one step.
        let report = step(&mut g, &caps(4), &CostUsage::default(), &mut ports);
        assert_eq!(report.merged, ["dep"]);
        assert!(report.dispatched.contains(&"child".to_string()));
        assert_eq!(g.get("child").unwrap().status, TaskStatus::Running);
    }

    #[test]
    fn failed_merge_returns_to_running() {
        let mut g = TaskGraph::new();
        g.add(Task::new("a", "A")).unwrap();
        g.recompute_ready();
        g.transition("a", TaskStatus::Running).unwrap();
        g.transition("a", TaskStatus::Review).unwrap();
        let mut ports = FakePorts::new();
        ports.merge_ok = false;
        let report = step(&mut g, &caps(4), &CostUsage::default(), &mut ports);
        assert!(report.merged.is_empty());
        assert_eq!(g.get("a").unwrap().status, TaskStatus::Running);
    }
}
