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
use crate::failure_policy::{FailureEvent, FailurePolicy, RecoveryAction};
use crate::file_ownership::patterns_overlap;
use crate::review::{review, GateResults, ReviewVerdict};
use crate::symbol_ownership::{intents_block, SymbolIntent};
use crate::task::{TaskGraph, TaskStatus};

/// Do two tasks collide on their declared output lanes, accounting for symbol
/// intent? Two tasks that share a file lane collide UNLESS, on every shared
/// concrete file, BOTH declare symbols and those symbols are pairwise disjoint
/// (proven function-level parallelism, spec §6.2). Anything not symbol-proven —
/// no symbols on either side, a glob lane, or an overlapping range — falls back
/// to file-level exclusivity (the conservative default; never misses a real
/// collision).
fn tasks_collide(
    a_outputs: &[String],
    a_symbols: &[SymbolIntent],
    b_outputs: &[String],
    b_symbols: &[SymbolIntent],
) -> bool {
    for a_out in a_outputs {
        for b_out in b_outputs {
            if !patterns_overlap(a_out, b_out) {
                continue;
            }
            // Shared lane. Safe only if both sides claim symbols on this concrete
            // file and they are disjoint. A glob output never equals a concrete
            // symbol path, so it stays file-exclusive.
            let here = |syms: &[SymbolIntent]| -> Vec<SymbolIntent> {
                syms.iter()
                    .filter(|s| &s.path == a_out || &s.path == b_out)
                    .cloned()
                    .collect()
            };
            let a_here = here(a_symbols);
            let b_here = here(b_symbols);
            if a_here.is_empty() || b_here.is_empty() {
                return true; // no symbol proof on this lane -> file-level exclusivity
            }
            if a_here
                .iter()
                .any(|a| b_here.iter().any(|b| intents_block(a, b)))
            {
                return true; // overlapping symbol ranges -> serialize
            }
        }
    }
    false
}

/// Maximum times a task's worker may CRASH before it is left `Failed` (BR9
/// recovery). With `2`, a crashed task is reassigned once; a second crash fails
/// it. Bounded independently from rework so transient infra crashes never steal
/// a review-rework attempt.
pub const MAX_CRASH_ATTEMPTS: u32 = 2;

/// Maximum times a task's branch may be REVIEW-REJECTED and re-dispatched for
/// rework before it is left `Failed`. Independent from crash recovery; either
/// budget exhausting fails the task so a poison task cannot loop forever.
pub const MAX_REWORK_ATTEMPTS: u32 = 2;

/// Maximum times a task's worker may HANG (exceed the wall-clock budget, be
/// killed, and reassigned) before it is left `Failed`. Independent from crash
/// and rework so a slow-but-recoverable path is bounded without stealing the
/// other budgets, and a hang can escalate distinctly (failure policy: a timeout
/// escalates to the planner, a crash notifies the reviewer).
pub const MAX_TIMEOUT_ATTEMPTS: u32 = 2;

/// Why a task is being requeued — selects which independent retry budget applies.
#[derive(Clone, Copy)]
enum FailureKind {
    /// Its worker process crashed (non-zero exit).
    Crash,
    /// Its branch failed review.
    Rework,
    /// Its worker hung past the wall-clock budget and was killed.
    Timeout,
}

/// Split result of a completion poll (BR9 recovery): which dispatched agents
/// finished cleanly (`succeeded` -> review) vs. crashed (`failed` -> reassign)
/// since the last tick. Mirrors `agent::ReapOutcome`; kept loop-local so the
/// pure loop does not depend on the agent runtime.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct Completions {
    pub succeeded: Vec<String>,
    pub failed: Vec<String>,
    /// Dispatched agents that HUNG past the wall-clock budget and were killed
    /// since the last tick (-> recovery/reassign on the timeout budget). A hung
    /// worker never exits, so it is surfaced here by the adapter (which owns the
    /// session clock + the kill) rather than by the exit-based `failed` split.
    pub timed_out: Vec<String>,
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

/// A task the loop gave up on this step (a retry budget was exhausted, leaving
/// it `Failed`) plus the failure policy's recommended action. The adapter turns
/// each of these into an `EscalationRaised` event so a Failed task is pushed to
/// the supervisor/reviewer rather than left silently terminal — the
/// auto-escalation that keeps the loop safe to run unattended.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Escalation {
    pub task_id: String,
    /// Which retry budget the task exhausted: `crash` / `rework` / `timeout`.
    pub reason: String,
    /// What the failure policy recommends the supervisor do about it.
    pub action: RecoveryAction,
}

/// What one coordination step did. Serialized for the `orchestrator_step` IPC
/// return value + the `orchestrator-step` event the cockpit loop view consumes.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct StepReport {
    pub dispatched: Vec<String>,
    pub merged: Vec<String>,
    pub rejected: Vec<String>,
    /// Tasks whose worker died this step (crashed with a non-zero exit, or hung
    /// past the wall-clock budget and was killed) and were reassigned
    /// (re-dispatchable again) rather than lost. A task that exhausts its retry
    /// budget is not listed here — it is left `Failed` in the graph (visible via
    /// the task list and the loop `state`). See BR9 recovery.
    #[serde(default)]
    pub recovered: Vec<String>,
    /// Tasks the loop gave up on this step (a retry budget exhausted -> Failed),
    /// each with the failure policy's recommended action. The adapter publishes
    /// an `EscalationRaised` event per entry so a Failed task is never left
    /// silently — it is pushed to the supervisor/reviewer.
    #[serde(default)]
    pub escalations: Vec<Escalation>,
    pub state: LoopState,
}

fn running_count(graph: &TaskGraph) -> usize {
    graph
        .list()
        .iter()
        .filter(|task| task.status == TaskStatus::Running)
        .count()
}

/// Send a failed task back for another attempt, bounded by the retry budget for
/// its `kind`. Used for both a crashed worker (caller passes a `Running` task,
/// `FailureKind::Crash`) and a review-rejected branch (caller passes a `Review`
/// task, `FailureKind::Rework`) — `-> Failed` is legal from either. Crash and
/// rework draw on SEPARATE budgets, so a transient crash never consumes a
/// rework. Under budget it goes `Failed -> Pending` so the dependency gate
/// re-promotes it to `Ready` and it is re-dispatched the same tick with the
/// CURRENT ADR (every dispatch re-injects the shared context); past the budget
/// it stays `Failed` (terminal), so a task is never silently lost and a poison
/// task cannot loop forever. Returns whether it was requeued.
fn requeue_or_fail(graph: &mut TaskGraph, id: &str, kind: FailureKind) -> bool {
    let _ = graph.transition(id, TaskStatus::Failed);
    let (attempts, max) = match kind {
        FailureKind::Crash => (graph.record_crash(id), MAX_CRASH_ATTEMPTS),
        FailureKind::Rework => (graph.record_rework(id), MAX_REWORK_ATTEMPTS),
        FailureKind::Timeout => (graph.record_timeout(id), MAX_TIMEOUT_ATTEMPTS),
    };
    if attempts < max {
        let _ = graph.transition(id, TaskStatus::Pending);
        true
    } else {
        false
    }
}

/// Requeue a failed task, OR — if its retry budget is exhausted (`requeue_or_fail`
/// returns false, leaving it `Failed`) — record an escalation so the supervisor
/// is told about the give-up rather than the task dying silently. The failure
/// policy maps the exhausted budget to an action (a crash/rework notifies the
/// reviewer, a repeated timeout escalates to the planner for re-decomposition).
/// Returns whether the task was requeued (so the caller still drives its
/// recovered/rejected reporting). Pure: the policy is a value, no I/O.
fn requeue_or_escalate(
    graph: &mut TaskGraph,
    id: &str,
    kind: FailureKind,
    policy: &FailurePolicy,
    escalations: &mut Vec<Escalation>,
) -> bool {
    if requeue_or_fail(graph, id, kind) {
        return true;
    }
    let (reason, event) = match kind {
        FailureKind::Crash => (
            "crash",
            FailureEvent::AgentCrashed {
                retries: MAX_CRASH_ATTEMPTS,
            },
        ),
        FailureKind::Rework => ("rework", FailureEvent::TaskFailed),
        FailureKind::Timeout => ("timeout", FailureEvent::Timeout),
    };
    escalations.push(Escalation {
        task_id: id.to_string(),
        reason: reason.to_string(),
        action: policy.decide(event),
    });
    false
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
    let mut escalations = Vec::new();
    // The retry budgets the loop enforces (crash/rework/timeout = 2 each) are the
    // "give-up" point, so the policy's restart budget mirrors the crash budget:
    // an exhausted crash -> NotifyReviewer, an exhausted timeout -> EscalateToPlanner.
    let policy = FailurePolicy::with_max_restarts(MAX_CRASH_ATTEMPTS);

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
        if requeue_or_escalate(graph, &id, FailureKind::Crash, &policy, &mut escalations) {
            recovered.push(id);
        }
    }
    for id in completions.timed_out {
        // A worker that hung past the wall-clock budget was killed by the adapter
        // (a hang never exits, so it never appears in `failed`). Recover its task
        // on the independent timeout budget — re-dispatched with the current ADR,
        // or `Failed` past the budget — so a stuck agent can never wedge the loop.
        if graph.get(&id).map(|task| task.status) != Some(TaskStatus::Running) {
            continue;
        }
        if requeue_or_escalate(graph, &id, FailureKind::Timeout, &policy, &mut escalations) {
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
                    // Merge failed (e.g. a conflict because the target advanced
                    // under the branch). The headless agent has already exited,
                    // so leaving the task `Running` would strand it with no
                    // worker (no completion event will ever fire again). Requeue
                    // for rework on the rework budget — re-dispatched the same
                    // tick with the current ADR, or `Failed` past the budget —
                    // exactly like a review rejection. Never strands.
                    requeue_or_escalate(graph, &id, FailureKind::Rework, &policy, &mut escalations);
                    rejected.push(id);
                }
            }
            ReviewVerdict::Reject { .. } => {
                // Rework: the branch failed review. Re-dispatch it for another
                // attempt with the CURRENT ADR (so an agent that built on stale
                // context is redone with the new decision), bounded by the retry
                // budget. A headless agent has already exited, so leaving the
                // task `Running` would strand it with no worker — requeue instead.
                requeue_or_escalate(graph, &id, FailureKind::Rework, &policy, &mut escalations);
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
    //
    //    The concurrency count is recomputed from the graph here (not taken from
    //    the pre-step `usage`) so that a worker that crashed or merged THIS tick
    //    has already freed its slot — otherwise a recovered task would wait an
    //    extra tick behind its own just-vacated slot.
    let live_usage = CostUsage {
        active_agents: running_count(graph),
        ..*usage
    };
    let dispatch_plan = plan(graph, caps, &live_usage);
    // Each running task occupies its output lanes AND its declared symbol ranges.
    // A new task collides when its lanes overlap a busy one UNLESS both sides prove
    // disjoint symbols on the shared file (function-level parallelism, §6.2).
    let mut occupied: Vec<(Vec<String>, Vec<SymbolIntent>)> = graph
        .list()
        .iter()
        .filter(|task| task.status == TaskStatus::Running)
        .map(|task| (task.outputs.clone(), task.symbols.clone()))
        .collect();
    let mut dispatched = Vec::new();
    for id in &dispatch_plan.to_dispatch {
        let (outputs, symbols) = graph
            .get(id)
            .map(|task| (task.outputs.clone(), task.symbols.clone()))
            .unwrap_or_default();
        let lane_busy = occupied
            .iter()
            .any(|(busy_out, busy_sym)| tasks_collide(&outputs, &symbols, busy_out, busy_sym));
        if lane_busy {
            continue;
        }
        if ports.dispatch(id).is_ok() {
            let _ = graph.transition(id, TaskStatus::Running);
            occupied.push((outputs, symbols));
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
        escalations,
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
    /// Every reassignment performed while driving the loop (a crashed or
    /// hung-and-killed worker's task sent back for another attempt). See BR9.
    pub recovered: Vec<String>,
    /// Every give-up escalation raised while driving the loop (a task whose retry
    /// budget was exhausted, surfaced to the supervisor with a recovery action).
    pub escalations: Vec<Escalation>,
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
        escalations: Vec::new(),
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
        report.escalations.extend(r.escalations);
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
    use crate::failure_policy::RecoveryAction;
    use crate::symbol_ownership::{ClaimMode, Confidence, SymbolRange};
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
        /// Tasks reported as hung-and-killed on the next poll — models a worker
        /// that exceeded the wall-clock budget and was killed by the adapter.
        pending_timeout: Vec<String>,
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
                pending_timeout: Vec::new(),
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
                timed_out: std::mem::take(&mut self.pending_timeout),
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

    fn write_intent(path: &str, start: u32, end: u32) -> SymbolIntent {
        SymbolIntent {
            path: path.to_string(),
            symbol: format!("fn_{start}"),
            range: SymbolRange::new(start, end),
            mode: ClaimMode::Write,
            confidence: Confidence::Lsp,
        }
    }

    fn task_on_file(id: &str, file: &str, symbols: Vec<SymbolIntent>) -> Task {
        let mut task = Task::new(id, id);
        task.outputs = vec![file.to_string()];
        task.symbols = symbols;
        task
    }

    #[test]
    fn disjoint_symbols_in_one_file_co_dispatch() {
        // The headline product claim: two tasks editing the SAME file on DISJOINT
        // functions run in parallel (file ownership alone would have serialized them).
        let mut g = TaskGraph::new();
        g.add(task_on_file(
            "a",
            "src/x.rs",
            vec![write_intent("src/x.rs", 1, 20)],
        ))
        .unwrap();
        g.add(task_on_file(
            "b",
            "src/x.rs",
            vec![write_intent("src/x.rs", 40, 60)],
        ))
        .unwrap();
        g.recompute_ready();
        let mut ports = FakePorts::new();
        let report = step(&mut g, &caps(4), &CostUsage::default(), &mut ports);
        assert_eq!(report.dispatched.len(), 2);
        assert_eq!(g.get("a").unwrap().status, TaskStatus::Running);
        assert_eq!(g.get("b").unwrap().status, TaskStatus::Running);
    }

    #[test]
    fn overlapping_symbols_in_one_file_serialize() {
        // Same file, OVERLAPPING ranges -> the second task serializes (blocked this
        // tick); it dispatches once the first frees the range.
        let mut g = TaskGraph::new();
        g.add(task_on_file(
            "a",
            "src/x.rs",
            vec![write_intent("src/x.rs", 1, 30)],
        ))
        .unwrap();
        g.add(task_on_file(
            "b",
            "src/x.rs",
            vec![write_intent("src/x.rs", 20, 50)],
        ))
        .unwrap();
        g.recompute_ready();
        let mut ports = FakePorts::new();
        let report = step(&mut g, &caps(4), &CostUsage::default(), &mut ports);
        assert_eq!(report.dispatched, ["a"]);
        assert_eq!(g.get("a").unwrap().status, TaskStatus::Running);
        assert_eq!(g.get("b").unwrap().status, TaskStatus::Ready);
    }

    #[test]
    fn same_file_without_symbols_stays_file_exclusive() {
        // No symbol proof on either side -> file-level exclusivity (the
        // conservative fallback): the shared file serializes, as before.
        let mut g = TaskGraph::new();
        g.add(task_on_file("a", "src/x.rs", vec![])).unwrap();
        g.add(task_on_file("b", "src/x.rs", vec![])).unwrap();
        g.recompute_ready();
        let mut ports = FakePorts::new();
        let report = step(&mut g, &caps(4), &CostUsage::default(), &mut ports);
        assert_eq!(report.dispatched, ["a"]);
        assert_eq!(g.get("b").unwrap().status, TaskStatus::Ready);
    }

    #[test]
    fn disjoint_files_always_co_dispatch() {
        // Sanity: different files are unaffected by the symbol layer.
        let mut g = TaskGraph::new();
        g.add(task_on_file("a", "src/x.rs", vec![])).unwrap();
        g.add(task_on_file("b", "src/y.rs", vec![])).unwrap();
        g.recompute_ready();
        let mut ports = FakePorts::new();
        let report = step(&mut g, &caps(4), &CostUsage::default(), &mut ports);
        assert_eq!(report.dispatched.len(), 2);
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
        assert_eq!(g.get("a").unwrap().rework_attempts, 1);
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
        // Always-red review can't loop forever: after MAX_REWORK_ATTEMPTS the
        // task lands Failed (terminal) and the loop stops, instead of churning.
        let report = run(&mut g, &caps(4), &CostUsage::default(), 20, &mut ports);
        assert_eq!(g.get("a").unwrap().status, TaskStatus::Failed);
        assert_eq!(g.get("a").unwrap().rework_attempts, MAX_REWORK_ATTEMPTS);
        assert!(matches!(
            report.state,
            LoopState::Stalled | LoopState::Complete
        ));
        // The rework give-up is escalated so the reviewer re-plans/inspects.
        assert!(report.escalations.iter().any(|e| e.task_id == "a"
            && e.reason == "rework"
            && e.action == RecoveryAction::NotifyReviewer));
    }

    #[test]
    fn merge_conflict_redispatches_for_rework_not_stranded() {
        let mut g = TaskGraph::new();
        g.add(Task::new("a", "A")).unwrap();
        g.recompute_ready();
        g.transition("a", TaskStatus::Running).unwrap();
        g.transition("a", TaskStatus::Review).unwrap();
        let mut ports = FakePorts::new();
        ports.merge_ok = false; // review is green, but the merge conflicts
        let report = step(&mut g, &caps(4), &CostUsage::default(), &mut ports);
        // A conflicted merge is NOT a successful merge.
        assert!(report.merged.is_empty());
        // The task is requeued for rework (same tick, current ADR), NOT stranded
        // in Running with no live agent — the headless agent already exited, so a
        // Review->Running transition would leave it with no completion source
        // forever (the C-22 stall this test guards against).
        assert_eq!(report.rejected, ["a"]);
        assert!(report.dispatched.contains(&"a".to_string()));
        assert_eq!(g.get("a").unwrap().status, TaskStatus::Running);
        assert_eq!(g.get("a").unwrap().rework_attempts, 1);
        // A merge conflict draws on the rework budget, not the crash budget.
        assert_eq!(g.get("a").unwrap().crash_attempts, 0);
    }

    #[test]
    fn repeated_merge_conflicts_exhaust_retries_then_fail() {
        let mut g = TaskGraph::new();
        g.add(Task::new("a", "A")).unwrap();
        g.recompute_ready();
        g.transition("a", TaskStatus::Running).unwrap();
        g.transition("a", TaskStatus::Review).unwrap();
        let mut ports = FakePorts::new();
        ports.merge_ok = false; // every merge conflicts
        ports.auto_finish = true; // each re-dispatched agent finishes -> Review again
                                  // A perpetually-conflicting merge can't loop forever: after
                                  // MAX_REWORK_ATTEMPTS the task lands Failed (terminal) and the loop stops.
        let report = run(&mut g, &caps(4), &CostUsage::default(), 20, &mut ports);
        assert_eq!(g.get("a").unwrap().status, TaskStatus::Failed);
        assert_eq!(g.get("a").unwrap().rework_attempts, MAX_REWORK_ATTEMPTS);
        assert!(matches!(
            report.state,
            LoopState::Stalled | LoopState::Complete
        ));
        // The rework give-up is escalated so the reviewer re-plans/inspects.
        assert!(report.escalations.iter().any(|e| e.task_id == "a"
            && e.reason == "rework"
            && e.action == RecoveryAction::NotifyReviewer));
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
        assert_eq!(g.get("a").unwrap().crash_attempts, 1);
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
        assert_eq!(g.get("a").unwrap().crash_attempts, MAX_CRASH_ATTEMPTS);
        // ...and the give-up is auto-escalated to the supervisor (repeated crash
        // -> notify reviewer), not left silently Failed.
        assert_eq!(r2.escalations.len(), 1);
        assert_eq!(r2.escalations[0].task_id, "a");
        assert_eq!(r2.escalations[0].reason, "crash");
        assert_eq!(r2.escalations[0].action, RecoveryAction::NotifyReviewer);
    }

    #[test]
    fn crash_and_rework_budgets_are_independent() {
        // A transient crash must not steal a legitimate rework attempt: a task
        // that crashes once AND is rejected once still has budget on both axes
        // and is re-dispatched, not failed.
        let mut g = TaskGraph::new();
        g.add(Task::new("a", "A")).unwrap();
        g.recompute_ready();
        g.transition("a", TaskStatus::Running).unwrap();
        let mut ports = FakePorts::new();

        // Crash once -> recovered (crash_attempts=1), re-dispatched -> Running.
        ports.pending_fail = vec!["a".to_string()];
        let r1 = step(&mut g, &caps(4), &CostUsage::default(), &mut ports);
        assert_eq!(r1.recovered, ["a"]);
        assert_eq!(g.get("a").unwrap().crash_attempts, 1);

        // Now finish and reject once -> reworked (rework_attempts=1), NOT failed,
        // because the rework budget is separate from the (already-used) crash one.
        g.transition("a", TaskStatus::Review).unwrap();
        ports.gates.insert(
            "a".to_string(),
            GateResults {
                tests_pass: false,
                ..GREEN
            },
        );
        let r2 = step(&mut g, &caps(4), &CostUsage::default(), &mut ports);
        assert_eq!(r2.rejected, ["a"]);
        assert_eq!(g.get("a").unwrap().status, TaskStatus::Running); // re-dispatched
        assert_eq!(g.get("a").unwrap().crash_attempts, 1);
        assert_eq!(g.get("a").unwrap().rework_attempts, 1);
    }

    #[test]
    fn timeout_redispatches_for_recovery_not_stranded() {
        let mut g = TaskGraph::new();
        g.add(Task::new("a", "A")).unwrap();
        g.recompute_ready();
        g.transition("a", TaskStatus::Running).unwrap();
        let mut ports = FakePorts::new();
        // The adapter killed a worker hung past its budget and surfaces its task.
        ports.pending_timeout = vec!["a".to_string()];
        let report = step(&mut g, &caps(4), &CostUsage::default(), &mut ports);
        // Recovered on the timeout budget and re-dispatched the same tick — NOT
        // stranded in Running with no live agent (a hang never exits, so without
        // this the task would wedge forever).
        assert_eq!(report.recovered, ["a"]);
        assert!(report.dispatched.contains(&"a".to_string()));
        assert_eq!(g.get("a").unwrap().status, TaskStatus::Running);
        assert_eq!(g.get("a").unwrap().timeout_attempts, 1);
        // A timeout draws on its own budget, not crash or rework.
        assert_eq!(g.get("a").unwrap().crash_attempts, 0);
        assert_eq!(g.get("a").unwrap().rework_attempts, 0);
    }

    #[test]
    fn repeated_timeouts_exhaust_retries_then_fail() {
        let mut g = TaskGraph::new();
        g.add(Task::new("a", "A")).unwrap();
        g.recompute_ready();
        g.transition("a", TaskStatus::Running).unwrap();
        let mut ports = FakePorts::new();

        // First timeout: reassigned (attempt 1), re-dispatched -> Running.
        ports.pending_timeout = vec!["a".to_string()];
        let r1 = step(&mut g, &caps(4), &CostUsage::default(), &mut ports);
        assert_eq!(r1.recovered, ["a"]);
        assert_eq!(g.get("a").unwrap().status, TaskStatus::Running);

        // Second timeout: budget exhausted -> stays Failed (terminal), never lost.
        ports.pending_timeout = vec!["a".to_string()];
        let r2 = step(&mut g, &caps(4), &CostUsage::default(), &mut ports);
        assert!(r2.recovered.is_empty());
        assert_eq!(g.get("a").unwrap().status, TaskStatus::Failed);
        assert_eq!(g.get("a").unwrap().timeout_attempts, MAX_TIMEOUT_ATTEMPTS);
        // A repeated hang escalates to the planner for re-decomposition.
        assert_eq!(r2.escalations.len(), 1);
        assert_eq!(r2.escalations[0].reason, "timeout");
        assert_eq!(r2.escalations[0].action, RecoveryAction::EscalateToPlanner);
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
