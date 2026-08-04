//! The REAL Reviewer's IPC face (BR9 / autonomy gap #2). The conductor calls
//! [`review_branch`] instead of hand-canning "all green": it runs the project's
//! tests/lint/types in the task's worktree AND asks the planner LLM whether the
//! diff honors the shared decisions and the task, then returns a verdict grounded
//! in evidence. The returned `gates` feed straight into `orchestrator_step`'s
//! verdict map, so the loop merges only what a real review passed.

use std::collections::BTreeMap;
use std::sync::Arc;

use serde::Serialize;
use tauri::State;

use crate::context_store::ContextStoreManager;
use crate::review::{self, GateResults, ReviewVerdict};
use crate::task::{TaskManager, TaskStatus};

/// Cap on the diff text handed to the semantic judge — keeps a huge branch from
/// blowing the model's context. Whole lines; truncation is marked. Shares the
/// judge's in-prompt clip budget so the two layers can't silently disagree.
const REVIEW_DIFF_CAP: usize = crate::review::judge::MAX_DIFF_CHARS;

/// One red gate and why, surfaced so a rejection is actionable for the worker.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReasonEntry {
    pub gate: String,
    pub reason: String,
}

/// What the conductor gets back from a real branch review: the combined gates (to
/// feed the loop's `orchestrator_step`), the merge verdict, a convenience
/// `merge_ok` flag, and the reason for every red gate.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchReviewReport {
    pub gates: GateResults,
    pub verdict: ReviewVerdict,
    pub merge_ok: bool,
    pub reasons: Vec<ReasonEntry>,
}

/// Render the shared decisions as a stable bullet list for the judge prompt.
fn format_decisions(decisions: &BTreeMap<String, String>) -> String {
    decisions
        .iter()
        .map(|(k, v)| format!("- {k}: {v}"))
        .collect::<Vec<_>>()
        .join("\n")
}

/// REAL REVIEWER: review a worker's `source_branch` end-to-end and return a merge
/// verdict grounded in evidence. Runs the deterministic gates in the branch's
/// worktree (detected from its manifest — Rust → cargo, Node/TS → pnpm) AND runs
/// the LLM semantic judge over the three-dot diff (branch vs. its merge-base with
/// `target_branch`) against the shared decisions + the task. There is no
/// assumed-green: an unconfigured gate or an un-runnable judge reds that gate, so
/// the loop can never merge work the review didn't actually pass.
///
/// Blocking work (spawning gate processes + claude) runs off the async runtime.
#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn review_branch(
    context: State<'_, Arc<ContextStoreManager>>,
    tasks: State<'_, Arc<TaskManager>>,
    repo_path: String,
    task_id: String,
    reviewer_id: String,
    model: Option<String>,
) -> Result<BranchReviewReport, String> {
    let task = tasks
        .get(&task_id)
        .ok_or_else(|| format!("cannot review unknown task '{task_id}'"))?;
    if task.status != TaskStatus::Review {
        return Err(format!(
            "cannot review task '{task_id}' while it is '{}'",
            task.status.as_str()
        ));
    }
    let source_branch = task
        .source_branch
        .ok_or_else(|| format!("task '{task_id}' has no source branch"))?;
    let target_branch = task
        .target_branch
        .ok_or_else(|| format!("task '{task_id}' has no target branch"))?;
    let task_title = task.title;
    let implementer_id = task
        .owner
        .ok_or_else(|| format!("task '{task_id}' has no implementer identity"))?;
    let owned_paths = task.outputs;
    let mdl = model
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "codex".to_string());
    let adr = format_decisions(&context.all());

    let result = tauri::async_runtime::spawn_blocking(move || -> Result<_, String> {
        // The worktree is where the worker built. Fail loudly if it isn't on disk
        // (the loop creates it at dispatch) — otherwise gates would red with a
        // confusing "no command configured" instead of the real cause. Validate
        // the branch first so the predicted path is safe to build.
        crate::git::validate_branch_name(&source_branch)?;
        let worktree = crate::control::worktree::predict_path(&repo_path, &source_branch);
        if !worktree.is_dir() {
            return Err(format!(
                "worktree for branch '{source_branch}' not found at {} — create it before review",
                worktree.display()
            ));
        }
        // Snapshot only the worker's declared outputs onto its branch BEFORE diffing,
        // so the judge sees the real change. The loop commits each worktree at merge
        // time too; this idempotent call moves the source tip without ever staging
        // build caches, completion markers, or undeclared worker files.
        crate::control::worktree::commit_owned_for_branch(
            &repo_path,
            &source_branch,
            &owned_paths,
            &format!("aelyris: review {source_branch}"),
        )?;
        let diff = crate::git::diff_three_dot(
            &repo_path,
            &target_branch,
            &source_branch,
            REVIEW_DIFF_CAP,
        )?;
        let commands = review::detect_gate_commands(&worktree);
        let input = review::ReviewInputs {
            worktree: &worktree,
            task_title: &task_title,
            adr_context: &adr,
            diff: &diff,
            reviewer_id: &reviewer_id,
            implementer_id: &implementer_id,
            commands: &commands,
        };
        Ok(review::review_branch(&input, review::spawn_run, |prompt| {
            crate::agent::reviewer_oneshot(prompt, &mdl, &worktree)
        }))
    })
    .await
    .map_err(|e| format!("reviewer task join error: {e}"))??;

    Ok(BranchReviewReport {
        merge_ok: matches!(result.verdict, ReviewVerdict::Merge),
        gates: result.gates,
        verdict: result.verdict,
        reasons: result
            .reasons
            .into_iter()
            .map(|(gate, reason)| ReasonEntry { gate, reason })
            .collect(),
    })
}
