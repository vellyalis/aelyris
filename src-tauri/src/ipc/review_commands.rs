//! The real generic TaskGraph reviewer. It freezes only backend-declared task
//! outputs, proves the entire source history stays inside that boundary, runs
//! deterministic gates and semantic review in a clean detached checkout at the
//! exact candidate OID, and returns an in-process binding consumed by the merge
//! owner. Raw gate booleans are evidence for the UI, never merge authority.

use std::collections::BTreeMap;
use std::sync::Arc;

use serde::Serialize;
use tauri::State;

use crate::context_store::ContextStoreManager;
use crate::control::loop_ports::ReviewedCandidateBinding;
use crate::review::{self, GateResults, ReviewVerdict};
use crate::task::{TaskManager, TaskStatus};

pub(crate) const COCKPIT_REVIEWER_ID: &str = "cockpit-independent-reviewer";

/// Cap on the diff text handed to the semantic judge — keeps a huge branch from
/// blowing the model's context. Whole lines; truncation is marked. Shares the
/// judge's in-prompt clip budget so the two layers can't silently disagree.
const REVIEW_DIFF_CAP: usize = crate::review::judge::MAX_DIFF_CHARS;

/// One red gate and why, surfaced so a rejection is actionable for the worker.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReasonEntry {
    pub gate: String,
    pub reason: String,
}

/// What the conductor gets back from a real branch review: the combined gates (to
/// feed the loop's `orchestrator_step`), the merge verdict, a convenience
/// `merge_ok` flag, and the reason for every red gate.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchReviewReport {
    pub gates: GateResults,
    pub verdict: ReviewVerdict,
    pub merge_ok: bool,
    pub reasons: Vec<ReasonEntry>,
    pub candidate_source_oid: String,
    pub candidate_target_oid: String,
    pub reviewer_model: String,
}

pub(crate) struct ReviewedTaskCandidate {
    pub report: BranchReviewReport,
    pub binding: ReviewedCandidateBinding,
}

/// Render the shared decisions as a stable bullet list for the judge prompt.
fn format_decisions(decisions: &BTreeMap<String, String>) -> String {
    decisions
        .iter()
        .map(|(k, v)| format!("- {k}: {v}"))
        .collect::<Vec<_>>()
        .join("\n")
}

pub(crate) async fn review_task_candidate(
    context: Arc<ContextStoreManager>,
    tasks: Arc<TaskManager>,
    repo_path: String,
    task_id: String,
) -> Result<ReviewedTaskCandidate, String> {
    let repo_path = crate::control::loop_ports::canonical_dispatch_repo_path(&repo_path)?;
    let task = tasks
        .get(&task_id)
        .ok_or_else(|| format!("cannot review unknown task '{task_id}'"))?;
    if task.status != TaskStatus::Review {
        return Err(format!(
            "cannot review task '{task_id}' while it is '{}'",
            task.status.as_str()
        ));
    }
    let mdl = task
        .agent_model()
        .map(|value| crate::agent::interactive::resolve_agent_model(&value))
        .unwrap_or_else(|| "codex".to_string());
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
    let adr = format_decisions(&context.all());
    let reviewer_model = mdl.clone();
    let reviewer_id = COCKPIT_REVIEWER_ID.to_string();
    let review_repo_path = repo_path.clone();
    let review_source_branch = source_branch.clone();
    let review_target_branch = target_branch.clone();
    let review_reviewer_id = reviewer_id.clone();

    let (result, candidate) =
        tauri::async_runtime::spawn_blocking(move || -> Result<_, String> {
        // The worktree is where the worker built. Fail loudly if it isn't on disk
        // (the loop creates it at dispatch) — otherwise gates would red with a
        // confusing "no command configured" instead of the real cause. Validate
        // the branch first so the predicted path is safe to build.
        crate::git::validate_branch_name(&review_source_branch)?;
        let worktree =
            crate::control::worktree::predict_path(&review_repo_path, &review_source_branch);
        if !worktree.is_dir() {
            return Err(format!(
                "worktree for branch '{review_source_branch}' not found at {} — create it before review",
                worktree.display()
            ));
        }
        let candidate = crate::git::freeze_owned_worktree_candidate(
            &review_repo_path,
            &review_source_branch,
            &review_target_branch,
            &owned_paths,
            &format!("aelyris: review {review_source_branch}"),
        )?;
        let diff = crate::git::diff_between_oids(
            &review_repo_path,
            &candidate.merge_base_oid,
            &candidate.source_oid,
            REVIEW_DIFF_CAP,
        )?;
        // Gate and judge the immutable candidate, not the worker's possibly noisy
        // runtime directory. Tool-generated files in this detached checkout are
        // discarded when the guard drops and can never enter the source branch.
        let detached = crate::git::DetachedReviewWorktree::create(
            &review_repo_path,
            &candidate.source_oid,
        )?;
        let commands = review::detect_gate_commands(detached.path());
        let input = review::ReviewInputs {
            worktree: detached.path(),
            task_title: &task_title,
            adr_context: &adr,
            diff: &diff,
            reviewer_id: &review_reviewer_id,
            implementer_id: &implementer_id,
            commands: &commands,
        };
        let result = review::review_branch(&input, review::spawn_run, |prompt| {
            crate::agent::reviewer_oneshot(prompt, &mdl, detached.path())
        });
        Ok((result, candidate))
    })
    .await
    .map_err(|e| format!("reviewer task join error: {e}"))??;

    let gates_digest = crate::control::gate_runner::gate_results_digest(&result.gates)?;
    let report = BranchReviewReport {
        merge_ok: matches!(result.verdict, ReviewVerdict::Merge),
        gates: result.gates,
        verdict: result.verdict,
        reasons: result
            .reasons
            .into_iter()
            .map(|(gate, reason)| ReasonEntry { gate, reason })
            .collect(),
        candidate_source_oid: candidate.source_oid.clone(),
        candidate_target_oid: candidate.target_oid.clone(),
        reviewer_model,
    };
    let binding = ReviewedCandidateBinding {
        repo_path,
        source_branch,
        target_branch,
        source_oid: candidate.source_oid,
        target_oid: candidate.target_oid,
        reviewer_id,
        gates: report.gates,
        gates_digest,
    };
    Ok(ReviewedTaskCandidate { report, binding })
}

/// Review-evidence face retained for inspectors. It may freeze the current
/// declared candidate, but exposes no reusable merge token; only the
/// backend-owned combined review-and-merge command can consume the in-process
/// exact-OID binding.
#[tauri::command]
pub async fn review_branch(
    context: State<'_, Arc<ContextStoreManager>>,
    tasks: State<'_, Arc<TaskManager>>,
    repo_path: String,
    task_id: String,
) -> Result<BranchReviewReport, String> {
    review_task_candidate(
        context.inner().clone(),
        tasks.inner().clone(),
        repo_path,
        task_id,
    )
    .await
    .map(|candidate| candidate.report)
}
