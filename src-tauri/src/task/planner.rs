//! Build-plan validation — the gate that makes LLM-authored planning SAFE.
//!
//! The orchestrator LLM decomposes a goal ("build an auth'd e-commerce site")
//! into a set of [`Task`]s. This module turns that raw set into a verified,
//! dependency-ordered plan — or REJECTS it with every problem listed at once.
//! There is no partial acceptance and no silent fallback: a malformed plan never
//! becomes a half-built graph. The LLM reads the errors and re-plans.
//!
//! Pure (no IO / no LLM), so the rules are unit-tested directly. It complements
//! [`super::graph::TaskGraph::add`] (which already rejects duplicate ids and
//! dangling deps one-at-a-time) by validating a WHOLE self-contained plan up
//! front: acyclicity, declared lanes/owner/branches, and — the part nothing else
//! checks — that tasks which can run in PARALLEL own DISJOINT file lanes, so the
//! dispatch lane-gate can never deadlock or silently serialise them.

use std::collections::{HashMap, HashSet};

use super::graph::Task;
use crate::file_ownership::patterns_overlap;
use crate::git::validate_branch_name;

/// Validate a self-contained plan (every dependency names another task IN THE
/// SAME plan) and return the tasks in a valid dependency order — each task after
/// everything it depends on, ties broken by the original plan order. On ANY
/// problem, returns the full, sorted, de-duplicated error list and nothing is
/// created; the caller must fix the plan rather than proceed with a partial one.
pub fn validate_plan(tasks: Vec<Task>) -> Result<Vec<Task>, Vec<String>> {
    let mut errs: Vec<String> = Vec::new();

    // ---- unique, non-empty ids ----
    let mut seen: HashSet<&str> = HashSet::new();
    for t in &tasks {
        if t.id.trim().is_empty() {
            errs.push("a task has an empty id".to_string());
        } else if !seen.insert(t.id.as_str()) {
            errs.push(format!("duplicate task id: {}", t.id));
        }
    }
    let ids: HashSet<&str> = tasks.iter().map(|t| t.id.as_str()).collect();

    // ---- per-task required fields (a task must be dispatchable) ----
    for t in &tasks {
        if t.outputs.iter().all(|o| o.trim().is_empty()) {
            errs.push(format!(
                "task {} declares no outputs — every task needs at least one file pattern to own a lane",
                t.id
            ));
        }
        if t.owner.as_deref().map(str::trim).unwrap_or("").is_empty() {
            errs.push(format!(
                "task {} has no owner (the implementer identity)",
                t.id
            ));
        }
        match (t.source_branch.as_deref(), t.target_branch.as_deref()) {
            (Some(s), Some(tg)) => {
                if let Err(e) = validate_branch_name(s) {
                    errs.push(format!("task {} source_branch invalid: {e}", t.id));
                }
                if let Err(e) = validate_branch_name(tg) {
                    errs.push(format!("task {} target_branch invalid: {e}", t.id));
                }
            }
            _ => errs.push(format!(
                "task {} must set both source_branch and target_branch",
                t.id
            )),
        }
        for dep in &t.dependencies {
            if dep == &t.id {
                errs.push(format!("task {} depends on itself", t.id));
            } else if !ids.contains(dep.as_str()) {
                errs.push(format!("task {} depends on unknown task {dep}", t.id));
            }
        }
    }

    // ---- transitive ancestors (for cycle detection + parallelism) ----
    let ancestors = transitive_ancestors(&tasks, &ids);
    let has_cycle = tasks
        .iter()
        .any(|t| ancestors[t.id.as_str()].contains(t.id.as_str()));
    if has_cycle {
        errs.push("the plan has a dependency cycle".to_string());
    }

    // ---- lane disjointness among PARALLEL-runnable tasks ----
    // Two tasks may run concurrently unless one (transitively) depends on the
    // other. Concurrent tasks must own disjoint output lanes, else the dispatch
    // lane-gate would serialise or deadlock them. (Skip when cyclic — the
    // parallelism relation is meaningless then.)
    if !has_cycle {
        for (i, a) in tasks.iter().enumerate() {
            for b in tasks.iter().skip(i + 1) {
                let ordered = ancestors[a.id.as_str()].contains(b.id.as_str())
                    || ancestors[b.id.as_str()].contains(a.id.as_str());
                if ordered {
                    continue;
                }
                for oa in &a.outputs {
                    for ob in &b.outputs {
                        if patterns_overlap(oa, ob) {
                            errs.push(format!(
                                "tasks {} and {} can run in parallel but their output lanes overlap ({oa} vs {ob}) — give them disjoint outputs or a dependency between them",
                                a.id, b.id
                            ));
                        }
                    }
                }
            }
        }
    }

    if !errs.is_empty() {
        errs.sort();
        errs.dedup();
        return Err(errs);
    }

    // Compute the order as owned ids WHILE the `&tasks` borrows are alive, then
    // let them end so `tasks` can be moved and reordered.
    let rank: HashMap<String, usize> = topo_order(&tasks, &ancestors)
        .into_iter()
        .enumerate()
        .map(|(i, id)| (id, i))
        .collect();
    let mut sorted = tasks;
    sorted.sort_by_key(|t| rank.get(&t.id).copied().unwrap_or(usize::MAX));
    Ok(sorted)
}

/// `ancestors[x]` = every task `x` transitively depends on (over known ids).
/// A task appearing in its own ancestor set means a dependency cycle.
fn transitive_ancestors<'a>(
    tasks: &'a [Task],
    ids: &HashSet<&'a str>,
) -> HashMap<&'a str, HashSet<&'a str>> {
    let direct: HashMap<&str, Vec<&str>> = tasks
        .iter()
        .map(|t| {
            let deps: Vec<&str> = t
                .dependencies
                .iter()
                .map(String::as_str)
                .filter(|d| ids.contains(d) && *d != t.id.as_str())
                .collect();
            (t.id.as_str(), deps)
        })
        .collect();

    let mut anc: HashMap<&str, HashSet<&str>> = HashMap::new();
    for t in tasks {
        let mut acc: HashSet<&str> = HashSet::new();
        let mut stack: Vec<&str> = direct[t.id.as_str()].clone();
        while let Some(d) = stack.pop() {
            // `insert` returns false on revisit, bounding the walk even with a
            // cycle (each node is expanded at most once).
            if acc.insert(d) {
                stack.extend(direct.get(d).into_iter().flatten().copied());
            }
        }
        anc.insert(t.id.as_str(), acc);
    }
    anc
}

/// Stable topological order (owned ids): a task is emitted once all its
/// ancestors are emitted, always choosing the lowest original-plan-index ready
/// task so the result is deterministic. Precondition: the plan is acyclic.
fn topo_order(tasks: &[Task], ancestors: &HashMap<&str, HashSet<&str>>) -> Vec<String> {
    let ids: Vec<&str> = tasks.iter().map(|t| t.id.as_str()).collect();
    let mut placed: HashSet<&str> = HashSet::new();
    let mut emitted: Vec<String> = Vec::new();

    while emitted.len() < ids.len() {
        let mut progressed = false;
        for &id in &ids {
            if placed.contains(id) {
                continue;
            }
            let ready = ancestors[id].iter().all(|a| placed.contains(a));
            if ready {
                placed.insert(id);
                emitted.push(id.to_string());
                progressed = true;
                break; // re-scan from the front so ties keep plan order
            }
        }
        if !progressed {
            break; // unreachable when acyclic; defensive against a logic slip
        }
    }
    emitted
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::task::graph::TaskPriority;

    /// A fully-specified, dispatchable task for plan tests.
    fn task(id: &str, outputs: &[&str], deps: &[&str]) -> Task {
        Task {
            id: id.to_string(),
            title: format!("do {id}"),
            description: String::new(),
            status: crate::task::status::TaskStatus::Pending,
            owner: Some("worker".to_string()),
            model: None,
            priority: TaskPriority::Medium,
            estimate: None,
            dependencies: deps.iter().map(|s| s.to_string()).collect(),
            outputs: outputs.iter().map(|s| s.to_string()).collect(),
            symbols: Vec::new(),
            source_branch: Some(format!("feat/{id}")),
            target_branch: Some("main".to_string()),
            crash_attempts: 0,
            rework_attempts: 0,
            timeout_attempts: 0,
        }
    }

    #[test]
    fn accepts_a_well_formed_plan_and_orders_deps_first() {
        // c depends on a and b (which are parallel + disjoint lanes).
        let plan = vec![
            task("a", &["src/a/**"], &[]),
            task("b", &["src/b/**"], &[]),
            task("c", &["src/c/**"], &["a", "b"]),
        ];
        let ordered = validate_plan(plan).expect("valid");
        let ids: Vec<&str> = ordered.iter().map(|t| t.id.as_str()).collect();
        // c must come after both a and b.
        let pc = ids.iter().position(|x| *x == "c").unwrap();
        assert!(pc > ids.iter().position(|x| *x == "a").unwrap());
        assert!(pc > ids.iter().position(|x| *x == "b").unwrap());
    }

    #[test]
    fn reorders_a_plan_given_out_of_dependency_order() {
        // dependent listed BEFORE its dependency — must still sort correctly.
        let plan = vec![
            task("c", &["src/c/**"], &["a"]),
            task("a", &["src/a/**"], &[]),
        ];
        let ids: Vec<String> = validate_plan(plan)
            .unwrap()
            .into_iter()
            .map(|t| t.id)
            .collect();
        assert_eq!(ids, vec!["a".to_string(), "c".to_string()]);
    }

    #[test]
    fn rejects_a_dependency_cycle() {
        let mut a = task("a", &["src/a/**"], &["b"]);
        let b = task("b", &["src/b/**"], &["a"]);
        a.dependencies = vec!["b".to_string()];
        let errs = validate_plan(vec![a, b]).unwrap_err();
        assert!(errs.iter().any(|e| e.contains("cycle")), "{errs:?}");
    }

    #[test]
    fn rejects_self_dependency_and_dangling_dependency() {
        let errs = validate_plan(vec![
            task("a", &["src/a/**"], &["a"]),
            task("b", &["src/b/**"], &["ghost"]),
        ])
        .unwrap_err();
        assert!(
            errs.iter().any(|e| e.contains("depends on itself")),
            "{errs:?}"
        );
        assert!(
            errs.iter().any(|e| e.contains("unknown task ghost")),
            "{errs:?}"
        );
    }

    #[test]
    fn rejects_duplicate_ids() {
        let errs = validate_plan(vec![
            task("a", &["src/a/**"], &[]),
            task("a", &["src/b/**"], &[]),
        ])
        .unwrap_err();
        assert!(
            errs.iter().any(|e| e.contains("duplicate task id: a")),
            "{errs:?}"
        );
    }

    #[test]
    fn rejects_missing_outputs_owner_and_branches() {
        let mut t = task("a", &["src/a/**"], &[]);
        t.outputs = vec![];
        t.owner = None;
        t.source_branch = None;
        let errs = validate_plan(vec![t]).unwrap_err();
        assert!(
            errs.iter().any(|e| e.contains("declares no outputs")),
            "{errs:?}"
        );
        assert!(errs.iter().any(|e| e.contains("no owner")), "{errs:?}");
        assert!(
            errs.iter()
                .any(|e| e.contains("must set both source_branch and target_branch")),
            "{errs:?}"
        );
    }

    #[test]
    fn rejects_overlapping_lanes_for_parallel_tasks() {
        // a and b are independent (parallel) but both write src/shared/**.
        let errs = validate_plan(vec![
            task("a", &["src/shared/**"], &[]),
            task("b", &["src/shared/x.rs"], &[]),
        ])
        .unwrap_err();
        assert!(
            errs.iter()
                .any(|e| e.contains("run in parallel but their output lanes overlap")),
            "{errs:?}"
        );
    }

    #[test]
    fn allows_overlapping_lanes_when_one_depends_on_the_other() {
        // Same overlapping outputs, but b depends on a -> they never run together.
        let ordered = validate_plan(vec![
            task("a", &["src/shared/**"], &[]),
            task("b", &["src/shared/x.rs"], &["a"]),
        ]);
        assert!(
            ordered.is_ok(),
            "ordered overlap should be allowed: {ordered:?}"
        );
    }

    #[test]
    fn reports_every_problem_at_once_not_just_the_first() {
        let mut t = task("a", &["src/a/**"], &["ghost"]);
        t.owner = None;
        let errs = validate_plan(vec![t]).unwrap_err();
        // both the dangling dep AND the missing owner are surfaced.
        assert!(errs.len() >= 2, "{errs:?}");
        assert!(errs.iter().any(|e| e.contains("unknown task ghost")));
        assert!(errs.iter().any(|e| e.contains("no owner")));
    }
}
