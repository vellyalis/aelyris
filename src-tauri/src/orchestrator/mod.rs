//! Orchestrator scheduling — the deterministic brain of the autonomous loop.
//!
//! See docs/specs/AETHER_COCKPIT_REQUIREMENTS_2026-06-13.md (Agent Hierarchy /
//! Acceptance: end-to-end autonomy). The full loop is: LLM decomposition ->
//! `plan` (this) -> dispatch agents -> monitor -> transition tasks -> repeat.
//! The LLM decomposition and the actual agent spawn/monitor are runtime side
//! effects injected by the controller; this module owns only the pure
//! scheduling decision (what to dispatch next, and whether to continue) so it
//! is unit-testable with 100% confidence.

pub mod autonomy;
#[cfg(test)]
mod exam;

use serde::{Deserialize, Serialize};

use crate::cost::{CostCaps, CostUsage};
use crate::task::{TaskGraph, TaskStatus};

/// Where the loop stands after a planning pass.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LoopState {
    /// Work is dispatchable now or already in flight — keep looping.
    Active,
    /// Every task reached `Done` (or there is no work) — success terminal.
    Complete,
    /// Nothing is running and nothing can become ready (only blocked/failed
    /// tasks remain) — the loop must surface this rather than spin.
    Stalled,
    /// A budget cap (tokens/cost/runtime) halted the loop.
    HaltedByBudget,
}

/// The scheduling decision for one planning pass.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DispatchPlan {
    /// Task ids the controller should start now (priority-ordered, capped by
    /// the remaining concurrency slots).
    pub to_dispatch: Vec<String>,
    pub state: LoopState,
}

/// Decide what to dispatch and where the loop stands.
///
/// `usage.active_agents` is the live agent/concurrency count (one agent per
/// running task); the controller keeps it in step with the graph's `Running`
/// tasks. Budget caps halt the whole loop; the agent cap bounds how many ready
/// tasks may start this pass.
pub fn plan(graph: &TaskGraph, caps: &CostCaps, usage: &CostUsage) -> DispatchPlan {
    if caps.over_budget(usage).is_some() {
        return DispatchPlan {
            to_dispatch: Vec::new(),
            state: LoopState::HaltedByBudget,
        };
    }

    let tasks = graph.list();
    if tasks.is_empty() || tasks.iter().all(|task| task.status == TaskStatus::Done) {
        return DispatchPlan {
            to_dispatch: Vec::new(),
            state: LoopState::Complete,
        };
    }

    let running = tasks
        .iter()
        .filter(|task| task.status == TaskStatus::Running)
        .count();

    let ready = graph.ready_tasks(); // priority-ordered, highest first
    let slots = match caps.max_agents {
        Some(max) => max.saturating_sub(usage.active_agents),
        None => ready.len(),
    };
    let to_dispatch: Vec<String> = ready
        .iter()
        .take(slots)
        .map(|task| task.id.clone())
        .collect();

    // Stalled: nothing to start this pass AND nothing in flight, yet work
    // remains (the non-Done tasks left are blocked or failed).
    let state = if to_dispatch.is_empty() && running == 0 {
        LoopState::Stalled
    } else {
        LoopState::Active
    };

    DispatchPlan { to_dispatch, state }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::task::graph::{Task, TaskPriority};

    fn caps(max_agents: Option<usize>) -> CostCaps {
        CostCaps {
            max_agents,
            ..CostCaps::default()
        }
    }

    fn usage(active: usize) -> CostUsage {
        CostUsage {
            active_agents: active,
            ..Default::default()
        }
    }

    #[test]
    fn empty_graph_is_complete() {
        let g = TaskGraph::new();
        let plan = plan(&g, &caps(Some(4)), &usage(0));
        assert_eq!(plan.state, LoopState::Complete);
        assert!(plan.to_dispatch.is_empty());
    }

    #[test]
    fn over_budget_halts() {
        let mut g = TaskGraph::new();
        g.add(Task::new("a", "A")).unwrap();
        g.recompute_ready();
        let budget = CostCaps {
            max_agents: Some(4),
            max_tokens: Some(100),
            ..CostCaps::default()
        };
        let over = CostUsage {
            tokens_used: 100,
            ..Default::default()
        };
        assert_eq!(plan(&g, &budget, &over).state, LoopState::HaltedByBudget);
    }

    #[test]
    fn dispatches_ready_tasks_up_to_concurrency() {
        let mut g = TaskGraph::new();
        for id in ["a", "b", "c", "d", "e"] {
            g.add(Task::new(id, id)).unwrap();
        }
        g.recompute_ready(); // all five become Ready (roots)
        let plan = plan(&g, &caps(Some(3)), &usage(0));
        assert_eq!(plan.state, LoopState::Active);
        assert_eq!(plan.to_dispatch.len(), 3); // capped by max_agents
    }

    #[test]
    fn dispatches_in_priority_order() {
        let mut g = TaskGraph::new();
        let mut low = Task::new("low", "low");
        low.priority = TaskPriority::Low;
        let mut crit = Task::new("crit", "crit");
        crit.priority = TaskPriority::Critical;
        g.add(low).unwrap();
        g.add(crit).unwrap();
        g.recompute_ready();
        let plan = plan(&g, &caps(Some(1)), &usage(0));
        assert_eq!(plan.to_dispatch, ["crit"]); // highest priority first
    }

    #[test]
    fn no_slots_when_at_capacity_but_still_active() {
        let mut g = TaskGraph::new();
        g.add(Task::new("a", "A")).unwrap();
        g.add(Task::new("b", "B")).unwrap();
        g.recompute_ready();
        // a is running, capacity full -> dispatch nothing, but loop is Active.
        g.transition("a", TaskStatus::Running).unwrap();
        let plan = plan(&g, &caps(Some(1)), &usage(1));
        assert!(plan.to_dispatch.is_empty());
        assert_eq!(plan.state, LoopState::Active);
    }

    #[test]
    fn stalls_when_only_blocked_tasks_remain() {
        let mut g = TaskGraph::new();
        g.add(Task::new("dep", "dep")).unwrap();
        g.add(Task::new("child", "child").with_dependencies(["dep".into()]))
            .unwrap();
        g.recompute_ready(); // dep (root) -> Ready
                             // Fail the dependency -> child becomes Blocked, dep is Failed (terminal).
        g.transition("dep", TaskStatus::Running).unwrap();
        g.transition("dep", TaskStatus::Failed).unwrap();
        g.recompute_ready();
        let plan = plan(&g, &caps(Some(4)), &usage(0));
        assert!(plan.to_dispatch.is_empty());
        assert_eq!(plan.state, LoopState::Stalled);
    }

    #[test]
    fn unbounded_agents_dispatch_all_ready() {
        let mut g = TaskGraph::new();
        for id in ["a", "b", "c"] {
            g.add(Task::new(id, id)).unwrap();
        }
        g.recompute_ready();
        let plan = plan(&g, &caps(None), &usage(0));
        assert_eq!(plan.to_dispatch.len(), 3);
        assert_eq!(plan.state, LoopState::Active);
    }
}
