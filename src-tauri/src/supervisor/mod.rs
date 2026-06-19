//! Supervisor — the Architect's health view of the autonomous loop.
//!
//! A pure assessment one level ABOVE the orchestrator: it reads the Task Graph +
//! budget snapshot and reports whether the loop is healthy, degraded, or stuck,
//! plus machine-readable `directives` (re-decompose a given-up task, unblock a
//! blocked one, halt on budget) that the super-supervisor — the Architect agent
//! (or a human) — acts on. The orchestrator drives the loop; the supervisor
//! watches the orchestrator so a run can proceed unattended and still surface
//! when it needs a higher-level decision. Pure -> 100% unit-testable; exposed
//! read-only via the `aether.supervisor.health` MCP verb.
//!
//! See docs/specs/AETHER_COCKPIT_REQUIREMENTS_2026-06-13.md (Agent Hierarchy).

use serde::{Deserialize, Serialize};

use crate::cost::{CostCaps, CostUsage};
use crate::orchestrator::{plan, LoopState};
use crate::task::{TaskGraph, TaskStatus};

/// The Architect's verdict on the loop.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum HealthState {
    /// Work is progressing (or complete) and nothing has been given up on.
    Healthy,
    /// Still progressing, but some tasks were given up on (Failed) or are
    /// Blocked — the Architect should look, but the loop is not wedged.
    Degraded,
    /// No path forward without intervention: the loop is stalled or halted while
    /// unfinished work remains. The Architect MUST act (re-decompose / unblock /
    /// raise caps) or the run cannot finish.
    Stuck,
}

/// A machine-readable recommendation for the Architect / orchestrator. The
/// supervisor only *flags* what to do — the actual re-decomposition/unblocking
/// is the LLM's job, so the mechanism never guesses product intent.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case", tag = "kind")]
pub enum Directive {
    /// A task exhausted its retry budget (Failed). The planner should break it
    /// down differently and re-dispatch the pieces.
    ReDecompose { task_id: String },
    /// A task is Blocked (a dependency Failed). Its dependency must be resolved
    /// (re-decomposed/redone) before it can proceed.
    Unblock { task_id: String },
    /// A budget cap halted the loop — stop dispatching until budgets reset/raise.
    Halt,
}

/// The supervisor's report on the loop, polled by the Architect.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct HealthReport {
    pub state: HealthState,
    /// The orchestrator's own loop state this pass (active/complete/stalled/halted).
    pub loop_state: LoopState,
    pub total: usize,
    pub running: usize,
    pub ready: usize,
    pub review: usize,
    pub blocked: usize,
    pub failed: usize,
    pub done: usize,
    /// At/over a concurrency or budget cap (dispatch is throttled).
    pub budget_pressure: bool,
    /// What the Architect should do, in priority-ish order (halt first).
    pub directives: Vec<Directive>,
}

/// Assess the health of the loop from a graph + budget snapshot. Pure: same
/// inputs as `orchestrator::plan` (which it reuses for the loop state).
pub fn assess(graph: &TaskGraph, caps: &CostCaps, usage: &CostUsage) -> HealthReport {
    let tasks = graph.list();
    let count = |status: TaskStatus| tasks.iter().filter(|task| task.status == status).count();
    let running = count(TaskStatus::Running);
    let ready = count(TaskStatus::Ready);
    let review = count(TaskStatus::Review);
    let blocked = count(TaskStatus::Blocked);
    let failed = count(TaskStatus::Failed);
    let done = count(TaskStatus::Done);
    let total = tasks.len();

    let loop_state = plan(graph, caps, usage).state;

    // Directives: halt first (budget), then one per give-up (Failed -> re-decompose)
    // and per Blocked task (its dependency needs resolving).
    let mut directives = Vec::new();
    if loop_state == LoopState::HaltedByBudget {
        directives.push(Directive::Halt);
    }
    for task in tasks.iter() {
        match task.status {
            TaskStatus::Failed => directives.push(Directive::ReDecompose {
                task_id: task.id.clone(),
            }),
            TaskStatus::Blocked => directives.push(Directive::Unblock {
                task_id: task.id.clone(),
            }),
            _ => {}
        }
    }

    let budget_pressure = caps.over_budget(usage).is_some()
        || caps
            .max_agents
            .is_some_and(|max| usage.active_agents >= max);

    // Verdict:
    // - Stuck: the loop cannot progress on its own (stalled / halted) while
    //   unfinished work remains — a higher-level decision is required.
    // - Degraded: progressing, but something was given up on / is blocked.
    // - Healthy: progressing or complete with no give-ups.
    let unfinished = total > done;
    let state =
        if matches!(loop_state, LoopState::Stalled | LoopState::HaltedByBudget) && unfinished {
            HealthState::Stuck
        } else if failed > 0 || blocked > 0 {
            HealthState::Degraded
        } else {
            HealthState::Healthy
        };

    HealthReport {
        state,
        loop_state,
        total,
        running,
        ready,
        review,
        blocked,
        failed,
        done,
        budget_pressure,
        directives,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::task::graph::Task;

    fn caps(max_agents: Option<usize>) -> CostCaps {
        CostCaps {
            max_agents,
            ..CostCaps::default()
        }
    }

    #[test]
    fn healthy_when_progressing_with_no_give_ups() {
        let mut g = TaskGraph::new();
        g.add(Task::new("a", "A")).unwrap();
        g.add(Task::new("b", "B")).unwrap();
        g.recompute_ready();
        g.transition("a", TaskStatus::Running).unwrap();
        let h = assess(&g, &caps(Some(4)), &CostUsage::default());
        assert_eq!(h.state, HealthState::Healthy);
        assert_eq!(h.loop_state, LoopState::Active);
        assert_eq!(h.running, 1);
        assert_eq!(h.ready, 1);
        assert!(h.directives.is_empty());
    }

    #[test]
    fn complete_graph_is_healthy() {
        let mut g = TaskGraph::new();
        g.add(Task::new("a", "A")).unwrap();
        g.recompute_ready();
        g.transition("a", TaskStatus::Running).unwrap();
        g.transition("a", TaskStatus::Review).unwrap();
        g.transition("a", TaskStatus::Done).unwrap();
        let h = assess(&g, &caps(Some(4)), &CostUsage::default());
        assert_eq!(h.state, HealthState::Healthy);
        assert_eq!(h.loop_state, LoopState::Complete);
        assert_eq!(h.done, 1);
        assert!(h.directives.is_empty());
    }

    #[test]
    fn degraded_and_recommends_redecompose_when_a_task_is_given_up() {
        let mut g = TaskGraph::new();
        g.add(Task::new("a", "A")).unwrap();
        g.add(Task::new("b", "B")).unwrap();
        g.recompute_ready();
        // a is Failed (gave up), b is still running -> loop progresses but degraded.
        g.transition("a", TaskStatus::Running).unwrap();
        g.transition("a", TaskStatus::Failed).unwrap();
        g.transition("b", TaskStatus::Running).unwrap();
        let h = assess(&g, &caps(Some(4)), &CostUsage::default());
        assert_eq!(h.state, HealthState::Degraded);
        assert_eq!(h.failed, 1);
        assert!(h.directives.contains(&Directive::ReDecompose {
            task_id: "a".to_string()
        }));
    }

    #[test]
    fn stuck_when_stalled_with_unfinished_work() {
        let mut g = TaskGraph::new();
        g.add(Task::new("dep", "dep")).unwrap();
        g.add(Task::new("child", "child").with_dependencies(["dep".into()]))
            .unwrap();
        g.recompute_ready();
        // dep failed -> child Blocked; nothing running/ready -> Stalled, work remains.
        g.transition("dep", TaskStatus::Running).unwrap();
        g.transition("dep", TaskStatus::Failed).unwrap();
        g.recompute_ready();
        let h = assess(&g, &caps(Some(4)), &CostUsage::default());
        assert_eq!(h.state, HealthState::Stuck);
        assert_eq!(h.loop_state, LoopState::Stalled);
        // The Architect is told exactly what to act on.
        assert!(h.directives.contains(&Directive::ReDecompose {
            task_id: "dep".to_string()
        }));
        assert!(h.directives.contains(&Directive::Unblock {
            task_id: "child".to_string()
        }));
    }

    #[test]
    fn halt_and_budget_pressure_when_over_budget() {
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
        let h = assess(&g, &budget, &over);
        assert_eq!(h.loop_state, LoopState::HaltedByBudget);
        assert_eq!(h.state, HealthState::Stuck); // unfinished work + halted
        assert!(h.budget_pressure);
        assert!(h.directives.contains(&Directive::Halt));
    }
}
