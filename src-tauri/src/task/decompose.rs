//! Goal -> plan: the LLM half of autonomous planning.
//!
//! [`decompose_to_plan`] turns a one-line goal ("build an authenticated todo
//! API") into a VALIDATED task plan by asking an LLM to decompose it, then
//! running the result through [`validate_plan`]. If the LLM's plan is invalid,
//! the validator's errors are fed BACK into the next prompt so the LLM fixes its
//! own plan — a bounded self-correcting loop. There is no fallback: if no valid
//! plan emerges within the attempt budget, it fails loudly rather than running a
//! degraded or hand-canned plan.
//!
//! The LLM call is INJECTED (`llm: Fn(&str) -> Result<String, String>`), so the
//! prompt contract, JSON extraction, and the retry/validation wiring are all
//! unit-tested with a fake model; the real `claude` spawn is a thin adapter at
//! the call site.

use serde::Deserialize;

use super::graph::{Task, TaskPriority};
use super::planner::validate_plan;
use super::status::TaskStatus;

/// A symbol the planner declares a task will EDIT — NAME + mode only. The planner
/// NEVER asserts a range or confidence (it cannot prove them — that would mislabel a
/// guess as exact); [`crate::task::symbol_enrich::enrich_plan_with_symbols`] verifies the
/// name against real source to mint the exact `Confidence::Parser` range, or drops it.
#[derive(Debug, Clone, Deserialize)]
pub(crate) struct PlannedSymbolTarget {
    pub(crate) path: String,
    pub(crate) symbol: String,
    #[serde(default = "default_write_mode")]
    pub(crate) mode: crate::symbol_ownership::ClaimMode,
}

fn default_write_mode() -> crate::symbol_ownership::ClaimMode {
    crate::symbol_ownership::ClaimMode::Write
}

/// The shape the LLM must emit per task — the subset of [`Task`] a planner
/// authors. Everything else (status, recovery counters) is runtime state.
#[derive(Debug, Deserialize)]
pub(crate) struct PlannedTask {
    id: String,
    title: String,
    #[serde(default)]
    description: String,
    owner: String,
    outputs: Vec<String>,
    #[serde(default)]
    dependencies: Vec<String>,
    source_branch: String,
    target_branch: String,
    #[serde(default)]
    priority: Option<String>,
    /// Optional symbol targets (names only) for same-file parallelism. Verified by
    /// enrichment before validation; never trusted as-is.
    #[serde(default)]
    pub(crate) symbol_targets: Vec<PlannedSymbolTarget>,
}

impl PlannedTask {
    pub(crate) fn into_task(self) -> Task {
        Task {
            id: self.id,
            title: self.title,
            description: self.description,
            status: TaskStatus::Pending,
            owner: Some(self.owner),
            model: None,
            priority: self
                .priority
                .as_deref()
                .and_then(|p| p.parse().ok())
                .unwrap_or(TaskPriority::Medium),
            estimate: None,
            dependencies: self.dependencies,
            outputs: self.outputs,
            symbols: Vec::new(),
            source_branch: Some(self.source_branch),
            target_branch: Some(self.target_branch),
            crash_attempts: 0,
            rework_attempts: 0,
            timeout_attempts: 0,
        }
    }
}

/// The decomposition contract handed to the LLM. Explicit about the rules the
/// validator enforces, so the model can satisfy them first time.
fn decomposition_prompt(goal: &str, context: &str, prior_errors: &[String]) -> String {
    let mut p = String::new();
    p.push_str(
        "You are the PLANNER for an autonomous multi-agent build runtime. Decompose the GOAL \
into a dependency-ordered task graph that worker agents will implement in PARALLEL in isolated \
git worktrees, then merge.\n\n\
Output ONLY a JSON array (no prose, no code fence) of task objects with EXACTLY these fields:\n\
  id            unique kebab-case string\n\
  title         the full instruction the worker agent will receive (be specific and self-contained)\n\
  owner         a worker identity, e.g. \"worker-a\" (distinct owners can run in parallel)\n\
  outputs       array of file glob patterns this task will WRITE (e.g. [\"src/auth/**\"])\n\
  dependencies  array of ids that must finish before this task (omit or [] for roots)\n\
  source_branch the task's feature branch, e.g. \"feat/auth\"\n\
  target_branch the branch to merge into, almost always \"main\"\n\
  priority      one of low|medium|high|critical (optional, default medium)\n\
  symbol_targets array of { path, symbol, mode } (optional) — the EXISTING functions/classes a task \
will edit. ONLY use this to let TWO parallel tasks edit DIFFERENT symbols in the SAME existing file: name \
the exact existing symbols each task writes (mode \"write\"). The system VERIFIES every name against the \
real source; do NOT invent line ranges or a confidence, and do NOT name symbols in files that do not exist yet.\n\n\
HARD RULES (a plan violating any of these is rejected):\n\
  - the dependency graph MUST be acyclic\n\
  - every dependency id MUST name another task in this plan\n\
  - tasks that can run in PARALLEL (no dependency path between them) MUST own DISJOINT file lanes, \
EXCEPT they may share ONE concrete existing file if EACH declares disjoint symbol_targets (verified existing \
functions) on it; otherwise give them disjoint outputs or a dependency between them\n\
  - every task MUST declare at least one output, an owner, and both branches\n\n",
    );
    if !context.trim().is_empty() {
        p.push_str("PROJECT CONTEXT:\n");
        p.push_str(context.trim());
        p.push_str("\n\n");
    }
    p.push_str("GOAL:\n");
    p.push_str(goal.trim());
    p.push('\n');
    if !prior_errors.is_empty() {
        p.push_str(
            "\nYour PREVIOUS plan was REJECTED for these reasons — fix ALL of them and re-emit the full corrected JSON array:\n",
        );
        for e in prior_errors {
            p.push_str("  - ");
            p.push_str(e);
            p.push('\n');
        }
    }
    p
}

/// Extract the JSON array from an LLM response that may wrap it in prose or a
/// ```` ```json ```` fence.
fn extract_json_array(response: &str) -> Result<&str, String> {
    let start = response
        .find('[')
        .ok_or_else(|| "LLM response contained no JSON array".to_string())?;
    let end = response
        .rfind(']')
        .ok_or_else(|| "LLM response had no closing ']' for its JSON array".to_string())?;
    if end <= start {
        return Err("LLM response JSON array was malformed (']' before '[')".to_string());
    }
    Ok(&response[start..=end])
}

fn parse_plan(response: &str) -> Result<Vec<PlannedTask>, String> {
    let json = extract_json_array(response)?;
    let raw: Vec<PlannedTask> =
        serde_json::from_str(json).map_err(|e| format!("could not parse the plan JSON: {e}"))?;
    if raw.is_empty() {
        return Err("the plan is empty — a goal must decompose into at least one task".to_string());
    }
    Ok(raw)
}

/// Decompose `goal` into a VALIDATED, dependency-ordered plan. Asks `llm` to
/// decompose; on a validation failure, re-asks with the errors appended (up to
/// `max_attempts`). Returns the ordered tasks ready for `submit_plan`, or an
/// error describing why no valid plan could be produced — never a fallback plan.
pub fn decompose_to_plan(
    goal: &str,
    context: &str,
    repo_root: &std::path::Path,
    llm: impl Fn(&str) -> Result<String, String>,
    max_attempts: usize,
) -> Result<Vec<Task>, String> {
    let mut prior_errors: Vec<String> = Vec::new();
    for attempt in 1..=max_attempts.max(1) {
        let prompt = decomposition_prompt(goal, context, &prior_errors);
        let response = llm(&prompt).map_err(|e| format!("planner LLM call failed: {e}"))?;
        let planned = match parse_plan(&response) {
            Ok(t) => t,
            Err(e) => {
                // A parse failure is also feedback the LLM can act on.
                prior_errors = vec![e];
                continue;
            }
        };
        // VERIFY each declared symbol target against real source -> Task.symbols at
        // Confidence::Parser (the ONLY mint path). Unverifiable targets (missing file,
        // unknown/ambiguous name, glob/unsafe path) are dropped to file-level and
        // reported as diagnostics so the planner can fix names or add a dependency.
        let (tasks, unresolved) =
            crate::task::symbol_enrich::enrich_plan_with_symbols(repo_root, planned);
        match validate_plan(tasks) {
            Ok(ordered) => return Ok(ordered),
            Err(mut errs) => {
                // Surface why same-file parallelism was rejected (the unproven symbol),
                // not just the collision, so the next attempt is actionable.
                errs.extend(unresolved);
                errs.sort();
                errs.dedup();
                prior_errors = errs;
                let _ = attempt;
            }
        }
    }
    Err(format!(
        "the planner LLM could not produce a valid plan in {} attempt(s); last problems: {}",
        max_attempts.max(1),
        prior_errors.join("; ")
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;

    const GOOD_PLAN: &str = r#"
    Here is the plan:
    [
      {"id":"auth","title":"Build auth module","owner":"worker-a","outputs":["src/auth/**"],"source_branch":"feat/auth","target_branch":"main"},
      {"id":"ui","title":"Build the UI","owner":"worker-b","outputs":["src/ui/**"],"source_branch":"feat/ui","target_branch":"main"},
      {"id":"wire","title":"Wire UI to auth","owner":"worker-a","outputs":["src/app.ts"],"dependencies":["auth","ui"],"source_branch":"feat/wire","target_branch":"main"}
    ]
    "#;

    #[test]
    fn decomposes_a_valid_plan_in_one_attempt_ordered() {
        let tasks = decompose_to_plan(
            "build app",
            "rust",
            std::path::Path::new("."),
            |_| Ok(GOOD_PLAN.to_string()),
            3,
        )
        .unwrap();
        let ids: Vec<&str> = tasks.iter().map(|t| t.id.as_str()).collect();
        // `wire` depends on auth+ui, so it comes last.
        assert_eq!(ids.last(), Some(&"wire"));
        assert_eq!(tasks.len(), 3);
        assert_eq!(tasks[0].status, TaskStatus::Pending);
    }

    #[test]
    fn feeds_validation_errors_back_and_succeeds_on_retry() {
        // First attempt: two parallel tasks share a lane (invalid). Second: fixed.
        let calls = Cell::new(0);
        let bad = r#"[
          {"id":"a","title":"A","owner":"w","outputs":["src/shared/**"],"source_branch":"feat/a","target_branch":"main"},
          {"id":"b","title":"B","owner":"w","outputs":["src/shared/x"],"source_branch":"feat/b","target_branch":"main"}
        ]"#;
        let good = r#"[
          {"id":"a","title":"A","owner":"w","outputs":["src/a/**"],"source_branch":"feat/a","target_branch":"main"},
          {"id":"b","title":"B","owner":"w","outputs":["src/b/**"],"source_branch":"feat/b","target_branch":"main"}
        ]"#;
        let plan = decompose_to_plan(
            "g",
            "",
            std::path::Path::new("."),
            |prompt| {
                let n = calls.get();
                calls.set(n + 1);
                // The retry prompt must carry the prior rejection reason.
                if n == 0 {
                    assert!(!prompt.contains("REJECTED"));
                    Ok(bad.to_string())
                } else {
                    assert!(prompt.contains("collide"), "errors fed back to LLM");
                    Ok(good.to_string())
                }
            },
            3,
        )
        .unwrap();
        assert_eq!(calls.get(), 2);
        assert_eq!(plan.len(), 2);
    }

    #[test]
    fn fails_loudly_without_fallback_when_no_valid_plan() {
        let bad = r#"[{"id":"a","title":"A","owner":"w","outputs":[],"source_branch":"feat/a","target_branch":"main"}]"#;
        let err = decompose_to_plan(
            "g",
            "",
            std::path::Path::new("."),
            |_| Ok(bad.to_string()),
            2,
        )
        .unwrap_err();
        assert!(err.contains("could not produce a valid plan"), "{err}");
        assert!(err.contains("declares no outputs"), "{err}");
    }

    #[test]
    fn surfaces_a_malformed_json_response() {
        let err = decompose_to_plan(
            "g",
            "",
            std::path::Path::new("."),
            |_| Ok("no json here".to_string()),
            1,
        )
        .unwrap_err();
        assert!(
            err.contains("no JSON array") || err.contains("could not parse"),
            "{err}"
        );
    }

    #[test]
    fn propagates_an_llm_call_failure() {
        let err = decompose_to_plan(
            "g",
            "",
            std::path::Path::new("."),
            |_| Err("model offline".to_string()),
            2,
        )
        .unwrap_err();
        assert!(err.contains("planner LLM call failed"), "{err}");
    }
}
