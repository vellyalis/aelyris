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

use serde::{Deserialize, Serialize};

use super::{plan, LoopState};
use crate::cost::{CostCaps, CostUsage};
use crate::file_ownership::patterns_overlap;
use crate::review::{review, GateResults, ReviewVerdict};
use crate::task::{TaskGraph, TaskStatus};

/// Maximum times a task is dispatched before a repeated crash leaves it
/// `Failed` (BR9 recovery). With `2`, a crashed task is reassigned once; a
/// second crash marks it permanently failed so a poison task cannot loop
/// forever (the stall then surfaces via the loop state, never a lost task).
pub const MAX_TASK_ATTEMPTS: u32 = 2;

/// Split result of a completion poll (BR9 recovery): which dispatched agents
/// finished cleanly (`succeeded` -> review) vs. crashed (`failed` -> reassign)
/// since the last tick. Mirrors `agent::ReapOutcome`; kept loop-local so the
/// pure loop does not depend on the agent runtime.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct Completions {
    pub succeeded: Vec<String>,
    pub failed: Vec<String>,
}

/// Runtime side effects the loop drives. Real impl: LLM-spawned agents, PTY
/// monitoring, git merge. Tests: a fake that records calls and returns scripted
/// gate results.
pub trait LoopPorts {
    /// Start an agent for `task_id`. `Ok` means the task is now Running.
    fn dispatch(&mut self, task_id: &str) -> Result<(), String>;
    /// Dispatched agents that finished since the last call, split by exit
    /// outcome: a clean exit is `succeeded` (-> review), a crash is `failed`
    /// (-> recovery/reassign). Agent completion is a runtime event (process
    /// exit) surfaced here so the pure loop can both advance finished work and
    /// recover a dead worker without an external transition. Default: nothing
    /// finished (callers that drive transitions themselves need not implement).
    fn poll_completions(&mut self) -> Completions {
        Completions::default()
    }
    /// Quality-gate results for a task awaiting review.
    fn gate(&mut self, task_id: &str) -> GateResults;
    /// The reviewer agent's id (must differ from the implementer to merge).
    fn reviewer_id(&self) -> String;
    /// The agent that implemented `task_id`.
    fn implementer_id(&self, task_id: &str) -> String;
    /// Merge the reviewed branch for `task_id` into the target.
    fn merge(&mut self, task_id: &str) -> Result<(), String>;
}

/// What one coordination step did. Serialized for the `orchestrator_step` IPC
/// return value + the `orchestrator-step` event the cockpit loop view consumes.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct StepReport {
    pub dispatched: Vec<String>,
    pub merged: Vec<String>,
    pub rejected: Vec<String>,
    /// Tasks whose agent crashed this step and were reassigned (re-dispatchable
    /// again) rather than lost. A task that exhausts its retry budget is not
    /// listed here — it is left `Failed` in the graph (visible via the task list
    /// and the loop `state`). See BR9 recovery.
    #[serde(default)]
    pub recovered: Vec<String>,
    pub state: LoopState,
}

fn running_count(graph: &TaskGraph) -> usize {
    graph
        .list()
        .iter()
        .filter(|task| task.status == TaskStatus::Running)
        .count()
}

/// Send a failed task back for another attempt, bounded by the retry budget.
/// Used for both a crashed worker (caller passes a `Running` task) and a
/// review-rejected branch (caller passes a `Review` task) — `-> Failed` is legal
/// from either. Under budget it goes `Failed -> Pending` so the dependency gate
/// re-promotes it to `Ready` and it is re-dispatched the same tick with the
/// CURRENT ADR (every dispatch re-injects the shared context); past the budget
/// it stays `Failed` (terminal), so a task is never silently lost and a poison
/// task cannot loop forever. Returns whether it was requeued.
fn requeue_or_fail(graph: &mut TaskGraph, id: &str) -> bool {
    let _ = graph.transition(id, TaskStatus::Failed);
    let attempts = graph.record_attempt(id);
    if attempts < MAX_TASK_ATTEMPTS {
        let _ = graph.transition(id, TaskStatus::Pending);
        true
    } else {
        false
    }
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
    let mut recovered = Vec::new();

    // 0. Sense agent completions and split by outcome (BR9 recovery). A clean
    //    exit moves the `Running` task into review in this same step. A crash
    //    routes the task back for reassignment (bounded retries, then `Failed`)
    //    so a dead worker is re-dispatched rather than its task lost.
    let completions = ports.poll_completions();
    for id in completions.succeeded {
        let _ = graph.transition(&id, TaskStatus::Review);
    }
    for id in completions.failed {
        // Only recover a task genuinely in flight (its agent owned a Running task).
        if graph.get(&id).map(|task| task.status) != Some(TaskStatus::Running) {
            continue;
        }
        if requeue_or_fail(graph, &id) {
            recovered.push(id);
        }
    }

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
                // Rework: the branch failed review. Re-dispatch it for another
                // attempt with the CURRENT ADR (so an agent that built on stale
                // context is redone with the new decision), bounded by the retry
                // budget. A headless agent has already exited, so leaving the
                // task `Running` would strand it with no worker — requeue instead.
                requeue_or_fail(graph, &id);
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

    // 3. Plan + dispatch, enforcing disjoint file lanes (BR8). Never co-dispatch
    //    a task whose declared `outputs` overlap a task already running (or one
    //    just dispatched this tick) — ownership is *enforced*, not merely
    //    detected, so two agents can never edit the same file at once. A
    //    lane-blocked task simply stays Ready and is retried once the occupying
    //    task merges and frees its lane.
    let dispatch_plan = plan(graph, caps, usage);
    let mut occupied: Vec<String> = graph
        .list()
        .iter()
        .filter(|task| task.status == TaskStatus::Running)
        .flat_map(|task| task.outputs.clone())
        .collect();
    let mut dispatched = Vec::new();
    for id in &dispatch_plan.to_dispatch {
        let outputs = graph
            .get(id)
            .map(|task| task.outputs.clone())
            .unwrap_or_default();
        let lane_busy = outputs
            .iter()
            .any(|out| occupied.iter().any(|busy| patterns_overlap(out, busy)));
        if lane_busy {
            continue;
        }
        if ports.dispatch(id).is_ok() {
            let _ = graph.transition(id, TaskStatus::Running);
            occupied.extend(outputs);
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
        recovered,
        state,
    }
}

/// Aggregate outcome of driving the loop to a terminal state.
#[derive(Debug, Clone, PartialEq)]
pub struct RunReport {
    pub steps: usize,
    pub dispatched: Vec<String>,
    pub merged: Vec<String>,
    pub rejected: Vec<String>,
    /// Every reassignment performed while driving the loop (a crashed task sent
    /// back for another attempt). See BR9 recovery.
    pub recovered: Vec<String>,
    pub state: LoopState,
}

/// Drive the autonomy loop until it reaches a terminal state
/// (`Complete`/`Stalled`/`HaltedByBudget`) or `max_steps` is exhausted — a
/// safety bound so a pathological cycle (e.g. an implementer that never finishes)
/// can never spin forever. `base_usage` supplies the budget axes (tokens/cost);
/// the live agent count is recomputed from the graph before each step, so the
/// caller does not track it. This is the controller the runtime invokes (on the
/// next tick / agent-completion event) to push "one instruction -> parallel
/// impl -> review -> auto-merge" forward to quiescence.
pub fn run(
    graph: &mut TaskGraph,
    caps: &CostCaps,
    base_usage: &CostUsage,
    max_steps: usize,
    ports: &mut impl LoopPorts,
) -> RunReport {
    let mut report = RunReport {
        steps: 0,
        dispatched: Vec::new(),
        merged: Vec::new(),
        rejected: Vec::new(),
        recovered: Vec::new(),
        state: LoopState::Active,
    };
    for _ in 0..max_steps {
        let usage = CostUsage {
            active_agents: running_count(graph),
            ..*base_usage
        };
        let r = step(graph, caps, &usage, ports);
        report.steps += 1;
        report.dispatched.extend(r.dispatched);
        report.merged.extend(r.merged);
        report.rejected.extend(r.rejected);
        report.recovered.extend(r.recovered);
        report.state = r.state;
        if matches!(
            r.state,
            LoopState::Complete | LoopState::Stalled | LoopState::HaltedByBudget
        ) {
            break;
        }
    }
    report
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
        /// When set, every dispatched task is reported finished on the next
        /// `poll_completions` — models an implementer that completes within a tick.
        auto_finish: bool,
        pending_finish: Vec<String>,
        /// Tasks reported as crashed (non-zero exit) on the next poll — models a
        /// dead worker the loop must recover.
        pending_fail: Vec<String>,
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
                auto_finish: false,
                pending_finish: Vec::new(),
                pending_fail: Vec::new(),
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
            if self.auto_finish {
                self.pending_finish.push(task_id.to_string());
            }
            Ok(())
        }
        fn poll_completions(&mut self) -> Completions {
            Completions {
                succeeded: std::mem::take(&mut self.pending_finish),
                failed: std::mem::take(&mut self.pending_fail),
            }
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
    fn red_review_redispatches_for_rework() {
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
        // Rejected work is re-dispatched the same tick (with the current ADR),
        // not stranded in Running with no live agent.
        assert!(report.dispatched.contains(&"a".to_string()));
        assert_eq!(g.get("a").unwrap().status, TaskStatus::Running);
        assert_eq!(g.get("a").unwrap().attempts, 1);
    }

    #[test]
    fn repeated_review_rejections_exhaust_retries_then_fail() {
        let mut g = TaskGraph::new();
        g.add(Task::new("a", "A")).unwrap();
        g.recompute_ready();
        g.transition("a", TaskStatus::Running).unwrap();
        g.transition("a", TaskStatus::Review).unwrap();
        let mut ports = FakePorts::new();
        ports.auto_finish = true; // each re-dispatched agent finishes -> Review again
        ports.gates.insert(
            "a".to_string(),
            GateResults {
                tests_pass: false,
                ..GREEN
            },
        );
        // Always-red review can't loop forever: after MAX_TASK_ATTEMPTS the task
        // lands Failed (terminal) and the loop stops, instead of churning.
        let report = run(&mut g, &caps(4), &CostUsage::default(), 20, &mut ports);
        assert_eq!(g.get("a").unwrap().status, TaskStatus::Failed);
        assert_eq!(g.get("a").unwrap().attempts, MAX_TASK_ATTEMPTS);
        assert!(matches!(
            report.state,
            LoopState::Stalled | LoopState::Complete
        ));
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

    #[test]
    fn clean_exit_moves_running_task_into_review() {
        let mut g = TaskGraph::new();
        g.add(Task::new("a", "A")).unwrap();
        g.recompute_ready();
        g.transition("a", TaskStatus::Running).unwrap();
        let mut ports = FakePorts::new();
        ports.pending_finish = vec!["a".to_string()];
        // The finished task enters review and merges in the same step.
        let report = step(&mut g, &caps(4), &CostUsage::default(), &mut ports);
        assert_eq!(report.merged, ["a"]);
        assert_eq!(g.get("a").unwrap().status, TaskStatus::Done);
    }

    #[test]
    fn crash_reassigns_and_redispatches_task() {
        let mut g = TaskGraph::new();
        g.add(Task::new("a", "A")).unwrap();
        g.recompute_ready();
        g.transition("a", TaskStatus::Running).unwrap();
        let mut ports = FakePorts::new();
        ports.pending_fail = vec!["a".to_string()];
        // A dead worker's task is recovered and re-dispatched within the same
        // tick — never lost (⑦ Recovery).
        let report = step(&mut g, &caps(4), &CostUsage::default(), &mut ports);
        assert_eq!(report.recovered, ["a"]);
        assert!(report.dispatched.contains(&"a".to_string()));
        assert_eq!(g.get("a").unwrap().status, TaskStatus::Running);
        assert_eq!(g.get("a").unwrap().attempts, 1);
    }

    #[test]
    fn repeated_crashes_exhaust_retries_then_fail() {
        let mut g = TaskGraph::new();
        g.add(Task::new("a", "A")).unwrap();
        g.recompute_ready();
        g.transition("a", TaskStatus::Running).unwrap();
        let mut ports = FakePorts::new();

        // First crash: reassigned (attempt 1) and re-dispatched -> Running.
        ports.pending_fail = vec!["a".to_string()];
        let r1 = step(&mut g, &caps(4), &CostUsage::default(), &mut ports);
        assert_eq!(r1.recovered, ["a"]);
        assert_eq!(g.get("a").unwrap().status, TaskStatus::Running);

        // Second crash: retry budget exhausted -> stays Failed (terminal), not
        // recovered, not re-dispatched, but never silently lost.
        ports.pending_fail = vec!["a".to_string()];
        let r2 = step(&mut g, &caps(4), &CostUsage::default(), &mut ports);
        assert!(r2.recovered.is_empty());
        assert!(!r2.dispatched.contains(&"a".to_string()));
        assert_eq!(g.get("a").unwrap().status, TaskStatus::Failed);
        assert_eq!(g.get("a").unwrap().attempts, MAX_TASK_ATTEMPTS);
    }

    #[test]
    fn crash_and_clean_exit_in_same_tick_are_independent() {
        let mut g = TaskGraph::new();
        g.add(Task::new("ok", "OK")).unwrap();
        g.add(Task::new("bad", "BAD")).unwrap();
        g.recompute_ready();
        g.transition("ok", TaskStatus::Running).unwrap();
        g.transition("bad", TaskStatus::Running).unwrap();
        let mut ports = FakePorts::new();
        ports.pending_finish = vec!["ok".to_string()];
        ports.pending_fail = vec!["bad".to_string()];
        let report = step(&mut g, &caps(4), &CostUsage::default(), &mut ports);
        // ok: clean exit -> review -> green -> merged. bad: crash -> recovered.
        assert_eq!(report.merged, ["ok"]);
        assert_eq!(g.get("ok").unwrap().status, TaskStatus::Done);
        assert_eq!(report.recovered, ["bad"]);
        assert_eq!(g.get("bad").unwrap().status, TaskStatus::Running);
    }

    fn task_with_outputs(id: &str, outputs: &[&str]) -> Task {
        let mut task = Task::new(id, id);
        task.outputs = outputs.iter().map(|o| o.to_string()).collect();
        task
    }

    #[test]
    fn does_not_codispatch_tasks_with_overlapping_lanes() {
        // a and b both touch src/auth; c is disjoint. a and c may run together;
        // b is held so two agents never edit the same file (② ownership enforced).
        let mut g = TaskGraph::new();
        g.add(task_with_outputs("a", &["src/auth/**"])).unwrap();
        g.add(task_with_outputs("b", &["src/auth/login.ts"]))
            .unwrap();
        g.add(task_with_outputs("c", &["src/ui/**"])).unwrap();
        g.recompute_ready();
        let mut ports = FakePorts::new();
        let report = step(&mut g, &caps(4), &CostUsage::default(), &mut ports);
        assert!(report.dispatched.contains(&"a".to_string()));
        assert!(report.dispatched.contains(&"c".to_string()));
        assert!(!report.dispatched.contains(&"b".to_string()));
        assert_eq!(g.get("a").unwrap().status, TaskStatus::Running);
        // b is not lost — it stays Ready and is retried once a's lane frees.
        assert_eq!(g.get("b").unwrap().status, TaskStatus::Ready);
    }

    #[test]
    fn held_lane_task_dispatches_once_the_occupant_merges() {
        let mut g = TaskGraph::new();
        g.add(task_with_outputs("a", &["src/auth/**"])).unwrap();
        g.add(task_with_outputs("b", &["src/auth/login.ts"]))
            .unwrap();
        g.recompute_ready();
        let mut ports = FakePorts::new();
        ports.auto_finish = true; // a finishes -> review -> merge next tick

        // Tick 1: a dispatched, b held (lane busy).
        let r1 = step(&mut g, &caps(4), &CostUsage::default(), &mut ports);
        assert_eq!(r1.dispatched, ["a"]);
        assert_eq!(g.get("b").unwrap().status, TaskStatus::Ready);

        // Tick 2: a finishes + merges (Done) -> lane free -> b dispatched.
        let r2 = step(&mut g, &caps(4), &CostUsage::default(), &mut ports);
        assert!(r2.merged.contains(&"a".to_string()));
        assert!(r2.dispatched.contains(&"b".to_string()));
        assert_eq!(g.get("b").unwrap().status, TaskStatus::Running);
    }

    #[test]
    fn run_drives_dependency_chain_to_complete() {
        let mut g = TaskGraph::new();
        g.add(Task::new("a", "A")).unwrap();
        g.add(Task::new("b", "B").with_dependencies(["a".into()]))
            .unwrap();
        g.recompute_ready(); // a Ready, b Blocked
        let mut ports = FakePorts::new();
        ports.auto_finish = true; // every dispatched agent finishes next tick

        let report = run(&mut g, &caps(4), &CostUsage::default(), 20, &mut ports);

        assert_eq!(report.state, LoopState::Complete);
        assert_eq!(g.get("a").unwrap().status, TaskStatus::Done);
        assert_eq!(g.get("b").unwrap().status, TaskStatus::Done);
        assert!(report.merged.contains(&"a".to_string()));
        assert!(report.merged.contains(&"b".to_string()));
        // a must merge before b is dispatched (dependency order).
        assert!(report.steps >= 3 && report.steps <= 5);
    }

    #[test]
    fn run_stops_at_max_steps_when_an_agent_never_finishes() {
        let mut g = TaskGraph::new();
        g.add(Task::new("a", "A")).unwrap();
        g.recompute_ready();
        let mut ports = FakePorts::new(); // auto_finish = false: a runs forever
        let report = run(&mut g, &caps(4), &CostUsage::default(), 5, &mut ports);
        assert_eq!(report.steps, 5);
        assert_eq!(report.state, LoopState::Active);
        assert_eq!(g.get("a").unwrap().status, TaskStatus::Running);
    }

    #[test]
    fn run_breaks_immediately_on_stall() {
        let mut g = TaskGraph::new();
        g.add(Task::new("dep", "dep")).unwrap();
        g.add(Task::new("child", "child").with_dependencies(["dep".into()]))
            .unwrap();
        g.recompute_ready();
        g.transition("dep", TaskStatus::Running).unwrap();
        g.transition("dep", TaskStatus::Failed).unwrap(); // child now Blocked
        g.recompute_ready();
        let mut ports = FakePorts::new();
        let report = run(&mut g, &caps(4), &CostUsage::default(), 20, &mut ports);
        assert_eq!(report.state, LoopState::Stalled);
        assert_eq!(report.steps, 1);
    }

    #[test]
    fn run_halts_when_over_budget() {
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
        let mut ports = FakePorts::new();
        let report = run(&mut g, &budget, &over, 20, &mut ports);
        assert_eq!(report.state, LoopState::HaltedByBudget);
        assert_eq!(report.steps, 1);
    }
}
