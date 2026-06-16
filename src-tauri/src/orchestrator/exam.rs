//! Deterministic final-exam harness — drives the WHOLE autonomy loop over a
//! realistic multi-task feature build with faults injected (a crashed worker, a
//! review-rejected branch, two tasks contending for one file lane), and asserts
//! the runtime's coordination + safety guarantees hold end-to-end with zero
//! human intervention. See docs/specs/AETHER_COCKPIT_REQUIREMENTS_2026-06-13.md
//! (Acceptance: end-to-end autonomy). This is the cargo-deterministic proof that
//! a misbehaving agent can never corrupt the integration — LLM output quality is
//! out of scope here (caught by the real gates), but every mechanism the loop
//! must enforce is proven.
//!
//! The eight acceptance cases, and where each is asserted:
//!   ① decomposition  — the input Task Graph (the orchestrator's job; given here)
//!   ② ownership      — per-step: no two running tasks share an overlapping lane
//!   ③ context sync   — a review-rejected (stale) task is re-dispatched, not lost
//!   ④ event handoff  — a dependent auto-starts once its deps merge (no waiting)
//!   ⑤ self-scaling   — the orchestrator's; the cap below stands in for the bound
//!   ⑥ cost control   — per-step: running count never exceeds the agent cap
//!   ⑦ recovery       — a crashed worker's task is reassigned and still completes
//!   ⑧ merge          — every branch merges, in dependency order, to completion

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

/// The whole exam in one deterministic run: an "EC site" decomposed into eight
/// tasks with real dependencies and file lanes, one crashing worker, one
/// stale/rejected branch, and two tasks contending for the auth lane — driven to
/// completion with no human in the loop, asserting every guarantee every tick.
#[test]
fn ten_agents_finish_one_feature_without_a_human_manager() {
    // ① Decomposition: distinct owners, declared deps, disjoint-by-design lanes
    //    (except the deliberately-contended auth lane below).
    let mut g = TaskGraph::new();
    g.add(task("auth", "claude", &[], &["src/auth/**"]))
        .unwrap();
    // Contends for the auth lane on purpose — must serialize behind `auth` (②).
    g.add(task("auth_tests", "gemini", &[], &["src/auth/test/**"]))
        .unwrap();
    g.add(task("db", "codex", &[], &["src/db/**"])).unwrap();
    g.add(task("search", "gemini", &[], &["src/search/**"]))
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
        "auth_tests",
        "db",
        "search",
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
    let mut final_state = LoopState::Active;

    for _ in 0..50 {
        let usage = CostUsage {
            active_agents: running_ids(&g).len(),
            ..Default::default()
        };
        let report = step(&mut g, &caps, &usage, &mut fleet);

        // ⑥ Cost control: the live agent count never exceeds the cap.
        let running = running_ids(&g);
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
    assert_eq!(g.get("db").unwrap().attempts, 1);

    // ③ Context sync: the stale/rejected branch was re-dispatched for rework
    //    (one attempt burned) and still merged — no stale work merged, none lost.
    assert!(
        rejected.contains(&"api".to_string()),
        "api was not reworked"
    );
    assert_eq!(g.get("api").unwrap().attempts, 1);

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
