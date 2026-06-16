//! Deterministic final-exam harness — drives the WHOLE autonomy LOOP over a
//! realistic multi-task feature build with faults injected (a crashed worker, a
//! review-rejected branch, two tasks contending for one file lane), and checks
//! the loop's coordination/safety guarantees hold to completion with zero human
//! intervention. See docs/specs/AETHER_COCKPIT_REQUIREMENTS_2026-06-13.md
//! (Acceptance: end-to-end autonomy).
//!
//! Scope — be precise about what this proves and what it does NOT:
//!   * It drives the real `step`/loop logic deterministically. The I/O ports
//!     (`ScriptedFleet`) are SIMULATED: `merge` records to a vec (no git) and
//!     `dispatch` queues a completion (no process). So this proves the loop
//!     COORDINATION is correct given working I/O — not the I/O itself.
//!   * Real git merge through the adapter is covered separately by the
//!     `control::loop_ports` tests (real temp-repo FF/3-way merges); the real
//!     crash-vs-success exit-code sensor by `agent::claude::reap_tests`; the
//!     mechanical gate by `control::gate_runner` + the real-exit-code test.
//!   * A real end-to-end run with real LLM agents + real git (and the A/B
//!     benchmark) is NOT performed here — that is environment/auth-dependent and
//!     out of cargo's reach. This harness is the deterministic mechanism proof,
//!     not that real LLM output is good.
//!
//! The eight acceptance cases, and how each is treated here:
//!   ① decomposition  — INPUT, not proven: the Task Graph is given (it is the
//!                       orchestrator's job to produce it)
//!   ② ownership      — per-tick invariant: no two running tasks share a lane
//!                       (binds — mutation-checked: removing the guard fires it)
//!   ③ context sync   — a review-rejected (stale) task is re-dispatched, not lost
//!   ④ event handoff  — a dependent auto-starts once its deps merge (no waiting)
//!   ⑤ self-scaling   — NOT a runtime feature; the binding cap below stands in
//!                       for the bound (real scaling is the orchestrator's call)
//!   ⑥ cost control   — the cap genuinely BINDS (max concurrency == cap)
//!   ⑦ recovery       — a crashed worker's task is reassigned and still completes
//!   ⑧ merge          — every (simulated) merge happens in dependency order to
//!                       completion

#![cfg(test)]

use std::collections::HashMap;

use super::autonomy::{step, Completions, LoopPorts};
use super::LoopState;
use crate::cost::{CostCaps, CostUsage};
use crate::file_ownership::patterns_overlap;
use crate::review::GateResults;
use crate::task::graph::Task;
use crate::task::{TaskGraph, TaskStatus};

const GREEN: GateResults = GateResults {
    tests_pass: true,
    lint_pass: true,
    types_pass: true,
    design_consistent: true,
    context_aligned: true,
};

/// A controlled fleet of workers with scripted faults. Each dispatched task
/// "finishes" on the next poll — cleanly, unless a crash is scripted for that
/// attempt (then it is reported failed, and the loop must reassign it). A task's
/// gate is green unless a red review is scripted (then `context_aligned` is
/// false, and the loop must re-dispatch it for rework). Deterministic: no time,
/// no randomness — outcomes depend only on the scripted counters.
struct ScriptedFleet {
    reviewer: String,
    /// Remaining crashes to inject before a task's agent finishes cleanly.
    crashes: HashMap<String, u32>,
    /// Remaining red reviews before a task's gate goes green.
    red_reviews: HashMap<String, u32>,
    pending_finish: Vec<String>,
    pending_fail: Vec<String>,
    /// The order branches were merged in — for the dependency-order assertion.
    merged: Vec<String>,
}

impl ScriptedFleet {
    fn new(reviewer: &str) -> Self {
        Self {
            reviewer: reviewer.to_string(),
            crashes: HashMap::new(),
            red_reviews: HashMap::new(),
            pending_finish: Vec::new(),
            pending_fail: Vec::new(),
            merged: Vec::new(),
        }
    }

    /// Decrement a scripted counter, returning whether it fired this time.
    fn fire(counter: &mut HashMap<String, u32>, task_id: &str) -> bool {
        match counter.get_mut(task_id) {
            Some(n) if *n > 0 => {
                *n -= 1;
                true
            }
            _ => false,
        }
    }
}

impl LoopPorts for ScriptedFleet {
    fn dispatch(&mut self, task_id: &str) -> Result<(), String> {
        // The dispatched agent finishes next tick — crashing this attempt if one
        // is scripted, otherwise exiting cleanly into review.
        if Self::fire(&mut self.crashes, task_id) {
            self.pending_fail.push(task_id.to_string());
        } else {
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
        if Self::fire(&mut self.red_reviews, task_id) {
            GateResults {
                context_aligned: false,
                ..GREEN
            }
        } else {
            GREEN
        }
    }

    fn reviewer_id(&self) -> String {
        self.reviewer.clone()
    }

    fn implementer_id(&self, task_id: &str) -> String {
        // Distinct from the reviewer so separation of duties never blocks merge.
        format!("impl-{task_id}")
    }

    fn merge(&mut self, task_id: &str) -> Result<(), String> {
        self.merged.push(task_id.to_string());
        Ok(())
    }
}

fn task(id: &str, owner: &str, deps: &[&str], outputs: &[&str]) -> Task {
    let mut t = Task::new(id, id);
    t.owner = Some(owner.to_string());
    t.dependencies = deps.iter().map(|d| d.to_string()).collect();
    t.outputs = outputs.iter().map(|o| o.to_string()).collect();
    t
}

fn running_ids(graph: &TaskGraph) -> Vec<String> {
    graph
        .list()
        .iter()
        .filter(|t| t.status == TaskStatus::Running)
        .map(|t| t.id.clone())
        .collect()
}

fn outputs_of(graph: &TaskGraph, id: &str) -> Vec<String> {
    graph.get(id).map(|t| t.outputs.clone()).unwrap_or_default()
}

fn merge_pos(merged: &[String], id: &str) -> usize {
    merged
        .iter()
        .position(|m| m == id)
        .unwrap_or_else(|| panic!("{id} was never merged"))
}

/// The whole exam in one deterministic run: an "EC site" decomposed into ten
/// tasks with real dependencies and file lanes, one crashing worker, one
/// stale/rejected branch, and two tasks contending for the auth lane — driven to
/// completion with no human in the loop, checking the per-tick safety invariants
/// (lane-disjoint running set, agent cap) and the final outcome.
///
/// The cap is made to genuinely BIND: five disjoint-lane roots are ready at the
/// first tick but the cap is four, so exactly four start and the fifth waits.
/// Without the cap a fifth would start, so `max_running == cap` below is a real
/// constraint, not a vacuous `<= cap`. (Lane enforcement is likewise mutation-
/// checked: removing the dispatch guard makes auth and auth_tests co-run and the
/// lane-collision assertion fires.)
#[test]
fn ten_agents_finish_one_feature_without_a_human_manager() {
    // ① Decomposition: distinct owners, declared deps, disjoint-by-design lanes
    //    (except the deliberately-contended auth lane). Five no-dep roots come
    //    first so the cap (4) binds at tick 1 with one root left waiting.
    let mut g = TaskGraph::new();
    g.add(task("auth", "claude", &[], &["src/auth/**"]))
        .unwrap();
    g.add(task("db", "codex", &[], &["src/db/**"])).unwrap();
    g.add(task("search", "gemini", &[], &["src/search/**"]))
        .unwrap();
    g.add(task("infra", "gemini", &[], &["src/infra/**"]))
        .unwrap();
    g.add(task("docs", "claude", &[], &["src/docs/**"]))
        .unwrap();
    // Contends for the auth lane on purpose — must serialize behind `auth` (②).
    g.add(task("auth_tests", "gemini", &[], &["src/auth/test/**"]))
        .unwrap();
    g.add(task("notify", "gemini", &["auth"], &["src/notify/**"]))
        .unwrap();
    g.add(task("api", "codex", &["auth", "db"], &["src/api/**"]))
        .unwrap();
    g.add(task("ui", "claude", &["api"], &["src/ui/**"]))
        .unwrap();
    g.add(task("analytics", "codex", &["api"], &["src/analytics/**"]))
        .unwrap();
    g.recompute_ready();

    let all_ids = [
        "auth",
        "db",
        "search",
        "infra",
        "docs",
        "auth_tests",
        "notify",
        "api",
        "ui",
        "analytics",
    ];

    let mut fleet = ScriptedFleet::new("reviewer");
    fleet.crashes.insert("db".to_string(), 1); // ⑦ db's first worker crashes
    fleet.red_reviews.insert("api".to_string(), 1); // ③ api's first review is stale

    let cap = 4usize;
    let caps = CostCaps {
        max_agents: Some(cap),
        ..CostCaps::default()
    };

    let mut recovered = Vec::new();
    let mut rejected = Vec::new();
    let mut max_running = 0usize;
    let mut final_state = LoopState::Active;

    for _ in 0..50 {
        let usage = CostUsage {
            active_agents: running_ids(&g).len(),
            ..Default::default()
        };
        let report = step(&mut g, &caps, &usage, &mut fleet);

        // ⑥ Cost control: the live agent count never exceeds the cap.
        let running = running_ids(&g);
        max_running = max_running.max(running.len());
        assert!(
            running.len() <= cap,
            "agent cap exceeded: {} running",
            running.len()
        );

        // ② Ownership: no two concurrently-running tasks share a file lane.
        for i in 0..running.len() {
            for j in (i + 1)..running.len() {
                let a = outputs_of(&g, &running[i]);
                let b = outputs_of(&g, &running[j]);
                for pa in &a {
                    for pb in &b {
                        assert!(
                            !patterns_overlap(pa, pb),
                            "lane collision: {} ({pa}) vs {} ({pb})",
                            running[i],
                            running[j]
                        );
                    }
                }
            }
        }

        recovered.extend(report.recovered);
        rejected.extend(report.rejected);
        final_state = report.state;
        if matches!(
            final_state,
            LoopState::Complete | LoopState::Stalled | LoopState::HaltedByBudget
        ) {
            break;
        }
    }

    // ⑥ Cost control BINDS: five disjoint roots were ready at tick 1 but the cap
    //    is four, so concurrency peaked at exactly the cap — without the cap a
    //    fifth would have started. (`<= cap` held every tick above.)
    assert_eq!(max_running, cap, "the agent cap did not actually bind");

    // ⑧ Completion: the loop reached a successful terminal state and every task
    //    merged to Done — nothing lost, nothing stuck.
    assert_eq!(final_state, LoopState::Complete, "loop did not complete");
    for id in all_ids {
        assert_eq!(
            g.get(id).unwrap().status,
            TaskStatus::Done,
            "{id} did not finish"
        );
    }
    assert_eq!(fleet.merged.len(), all_ids.len(), "not every branch merged");

    // ⑦ Recovery: the crashed worker's task was reassigned (one attempt burned)
    //    and still completed — never lost.
    assert!(
        recovered.contains(&"db".to_string()),
        "db was not recovered"
    );
    assert_eq!(g.get("db").unwrap().crash_attempts, 1);

    // ③ Context sync: the stale/rejected branch was re-dispatched for rework
    //    (one attempt burned) and still merged — no stale work merged, none lost.
    assert!(
        rejected.contains(&"api".to_string()),
        "api was not reworked"
    );
    assert_eq!(g.get("api").unwrap().rework_attempts, 1);

    // ④ Event handoff + ⑧ dependency-ordered integration: a dependent only merges
    //    after all its dependencies, proving deps auto-started their dependents.
    let m = &fleet.merged;
    assert!(merge_pos(m, "auth") < merge_pos(m, "api"));
    assert!(merge_pos(m, "db") < merge_pos(m, "api"));
    assert!(merge_pos(m, "auth") < merge_pos(m, "notify"));
    assert!(merge_pos(m, "api") < merge_pos(m, "ui"));
    assert!(merge_pos(m, "api") < merge_pos(m, "analytics"));
    // The contended lane serialized: auth_tests merged after auth freed the lane.
    assert!(merge_pos(m, "auth") < merge_pos(m, "auth_tests"));
}

/// A focused companion: when more independent work exists than the cap allows,
/// the loop still drives all of it to completion across ticks (⑤/⑥ — the cap
/// bounds concurrency without losing throughput).
#[test]
fn work_beyond_the_cap_still_all_completes() {
    let mut g = TaskGraph::new();
    for i in 0..10 {
        let id = format!("t{i}");
        g.add(task(&id, "claude", &[], &[&format!("src/mod{i}/**")]))
            .unwrap();
    }
    g.recompute_ready();
    let mut fleet = ScriptedFleet::new("reviewer");
    let cap = 3usize;
    let caps = CostCaps {
        max_agents: Some(cap),
        ..CostCaps::default()
    };

    let mut state = LoopState::Active;
    for _ in 0..50 {
        let usage = CostUsage {
            active_agents: running_ids(&g).len(),
            ..Default::default()
        };
        let report = step(&mut g, &caps, &usage, &mut fleet);
        assert!(running_ids(&g).len() <= cap);
        state = report.state;
        if state == LoopState::Complete {
            break;
        }
    }
    assert_eq!(state, LoopState::Complete);
    assert_eq!(fleet.merged.len(), 10);
}
