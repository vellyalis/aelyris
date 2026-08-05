//! The real generic TaskGraph reviewer. It freezes only backend-declared task
//! outputs, proves the entire source history stays inside that boundary, runs
//! deterministic gates and semantic review in a clean detached checkout at the
//! exact candidate OID, and returns an in-process binding consumed by the merge
//! owner. Raw gate booleans are evidence for the UI, never merge authority.

use std::collections::{BTreeMap, HashMap};
use std::path::Path;
use std::sync::Arc;

use serde::Serialize;
use tauri::State;

use crate::context_store::ContextStoreManager;
use crate::control::loop_ports::ReviewedCandidateBinding;
use crate::review::{self, GateResults, ReviewVerdict};
use crate::task::{
    CockpitGateCommandEvidence, CockpitGateSuiteEnvelope, MissionGateEvidence,
    MissionPlanActivation, TaskManager, TaskStatus,
};

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
    pub mission_lineage: Option<MissionReviewedLineage>,
}

#[derive(Debug, Clone)]
pub(crate) struct MissionReviewedLineage {
    pub activation: MissionPlanActivation,
    pub evidence: MissionGateEvidence,
    pub review: crate::review::MissionReviewRecord,
}

struct FrozenCockpitReview {
    candidate: crate::git::OwnedCandidateSnapshot,
    diff: String,
    deterministic_gates: GateResults,
    gate_suite: Option<CockpitGateSuiteEnvelope>,
    reasons: Vec<ReasonEntry>,
}

/// Render the shared decisions as a stable bullet list for the judge prompt.
fn format_decisions(decisions: &BTreeMap<String, String>) -> String {
    decisions
        .iter()
        .map(|(k, v)| format!("- {k}: {v}"))
        .collect::<Vec<_>>()
        .join("\n")
}

fn now_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}

fn cargo_target_dir(
    repository_root: &str,
    command: &review::GateCommand,
) -> Option<std::path::PathBuf> {
    let program = Path::new(&command.program)
        .file_stem()
        .and_then(|name| name.to_str())?
        .to_ascii_lowercase();
    if program != "cargo" {
        return None;
    }
    let manifest = command
        .args
        .windows(2)
        .find(|pair| pair[0] == "--manifest-path")
        .map(|pair| std::path::PathBuf::from(&pair[1]));
    let crate_root = match manifest {
        Some(path) if path.is_absolute() => path.parent()?.to_path_buf(),
        Some(path) => Path::new(repository_root)
            .join(path)
            .parent()?
            .to_path_buf(),
        None => Path::new(repository_root).to_path_buf(),
    };
    Some(crate_root.join("target"))
}

fn gate_commands_require_node_modules(commands: &[review::GateCommand]) -> bool {
    commands.iter().any(|command| {
        let program = Path::new(&command.program)
            .file_stem()
            .and_then(|name| name.to_str())
            .unwrap_or(&command.program)
            .to_ascii_lowercase();
        program == "pnpm"
            || (program == "corepack" && command.args.first().map(String::as_str) == Some("pnpm"))
    })
}

fn run_cockpit_gate_suite(
    detached: &Path,
    repository_root: &str,
    candidate: &crate::git::OwnedCandidateSnapshot,
    commands: &[review::GateCommand],
) -> Result<
    (
        GateResults,
        Option<CockpitGateSuiteEnvelope>,
        Vec<ReasonEntry>,
    ),
    String,
> {
    let mut pass = HashMap::from([("tests", false), ("lint", false), ("types", false)]);
    let mut reasons = Vec::new();
    let mut exact_commands = Vec::new();
    for kind in [
        review::GateKind::Tests,
        review::GateKind::Lint,
        review::GateKind::Types,
    ] {
        let gate = kind.as_str();
        let selected = commands
            .iter()
            .filter(|command| command.kind == kind)
            .collect::<Vec<_>>();
        if selected.is_empty() {
            reasons.push(ReasonEntry {
                gate: gate.into(),
                reason: format!("no {gate} command configured"),
            });
            continue;
        }
        let mut all_passed = true;
        for command in selected {
            let argv = std::iter::once(command.program.clone())
                .chain(command.args.iter().cloned())
                .collect::<Vec<_>>();
            let cargo_target = cargo_target_dir(repository_root, command);
            let exact = crate::control::gate_runner::run_exact_command_with_cargo_target(
                &argv,
                &detached.to_string_lossy(),
                cargo_target.as_deref(),
            )?;
            if exact.result != "passed" {
                all_passed = false;
                reasons.push(ReasonEntry {
                    gate: gate.into(),
                    reason: format!(
                        "exact command {:?} returned {} (exit {:?})",
                        argv, exact.result, exact.exit_code
                    ),
                });
            }
            exact_commands.push(CockpitGateCommandEvidence {
                gate: gate.into(),
                command_argv: exact.command_argv,
                command_fingerprint: exact.command_fingerprint,
                environment_fingerprint: exact.environment_fingerprint,
                result: exact.result,
                exit_code: exact.exit_code,
                evidence_digest: exact.evidence_digest,
                started_at_unix_ms: exact.started_at_unix_ms,
                ended_at_unix_ms: exact.ended_at_unix_ms,
            });
        }
        pass.insert(gate, all_passed);
    }
    let gates = GateResults {
        tests_pass: pass["tests"],
        lint_pass: pass["lint"],
        types_pass: pass["types"],
        design_consistent: false,
        context_aligned: false,
    };
    let suite = if gates.tests_pass && gates.lint_pass && gates.types_pass {
        let suite = CockpitGateSuiteEnvelope {
            schema: crate::task::COCKPIT_GATE_SUITE_CONTRACT_VERSION.into(),
            target_oid: candidate.target_oid.clone(),
            candidate_oid: candidate.source_oid.clone(),
            commands: exact_commands,
        };
        suite.validate().map_err(|error| error.to_string())?;
        Some(suite)
    } else {
        None
    };
    Ok((gates, suite, reasons))
}

fn verify_detached_candidate_unchanged(detached: &Path, candidate_oid: &str) -> Result<(), String> {
    let expected = candidate_oid
        .parse::<git2::Oid>()
        .map_err(|error| format!("invalid detached review candidate OID: {error}"))?;
    let repository = git2::Repository::open(detached)
        .map_err(|error| format!("reopen detached review worktree: {error}"))?;
    let current = repository
        .head()
        .and_then(|head| head.peel_to_commit())
        .map_err(|error| format!("read detached review HEAD after gates: {error}"))?
        .id();
    if current != expected {
        return Err(format!(
            "gate command moved detached review HEAD from {expected} to {current}"
        ));
    }
    let mut options = git2::StatusOptions::new();
    options
        .include_untracked(false)
        .include_ignored(false)
        .recurse_untracked_dirs(false);
    if !repository
        .statuses(Some(&mut options))
        .map_err(|error| format!("read detached review status after gates: {error}"))?
        .is_empty()
    {
        return Err("gate command changed tracked candidate content".to_string());
    }
    Ok(())
}

fn freeze_cockpit_review(
    repo_path: &str,
    source_branch: &str,
    target_branch: &str,
    owned_paths: &[String],
) -> Result<FrozenCockpitReview, String> {
    crate::git::validate_branch_name(source_branch)?;
    let worktree = crate::control::worktree::predict_path(repo_path, source_branch);
    if !worktree.is_dir() {
        return Err(format!(
            "worktree for branch '{source_branch}' not found at {} — create it before review",
            worktree.display()
        ));
    }
    let candidate = crate::git::freeze_owned_worktree_candidate(
        repo_path,
        source_branch,
        target_branch,
        owned_paths,
        &format!("aelyris: review {source_branch}"),
    )?;
    let diff = crate::git::diff_between_oids(
        repo_path,
        &candidate.merge_base_oid,
        &candidate.source_oid,
        REVIEW_DIFF_CAP,
    )?;
    let mut detached =
        crate::git::DetachedReviewWorktree::create(repo_path, &candidate.source_oid)?;
    let commands = review::detect_gate_commands(detached.path());
    if gate_commands_require_node_modules(&commands) {
        detached
            .project_node_modules_from(&[worktree.clone(), std::path::PathBuf::from(repo_path)])?;
    }
    let (deterministic_gates, gate_suite, reasons) =
        run_cockpit_gate_suite(detached.path(), repo_path, &candidate, &commands)?;
    verify_detached_candidate_unchanged(detached.path(), &candidate.source_oid)?;
    Ok(FrozenCockpitReview {
        candidate,
        diff,
        deterministic_gates,
        gate_suite,
        reasons,
    })
}

#[allow(clippy::too_many_arguments)]
async fn review_mission_task_candidate(
    tasks: Arc<TaskManager>,
    repo_path: String,
    task_id: String,
    activation: MissionPlanActivation,
    model: String,
    source_branch: String,
    target_branch: String,
    owned_paths: Vec<String>,
) -> Result<ReviewedTaskCandidate, String> {
    if activation.task_id != task_id
        || activation.repository_root != repo_path
        || activation.source_branch != source_branch
        || activation.target_branch != target_branch
        || activation
            .owned_targets
            .iter()
            .collect::<std::collections::HashSet<_>>()
            != owned_paths.iter().collect::<std::collections::HashSet<_>>()
    {
        return Err("cockpit Task no longer matches its immutable Mission activation".into());
    }
    let preview = tasks
        .mission_plan(&activation.plan_id, activation.plan_revision)
        .map_err(|error| error.to_string())?;
    if !preview.is_cockpit_profile() || preview.status != crate::task::MissionPlanStatus::Accepted {
        return Err("cockpit Task is not backed by an accepted Mission revision".into());
    }
    let review_repo_path = repo_path.clone();
    let review_source_branch = source_branch.clone();
    let review_target_branch = target_branch.clone();
    let review_owned_paths = owned_paths.clone();
    let frozen = tauri::async_runtime::spawn_blocking(move || {
        freeze_cockpit_review(
            &review_repo_path,
            &review_source_branch,
            &review_target_branch,
            &review_owned_paths,
        )
    })
    .await
    .map_err(|error| format!("cockpit gate task join error: {error}"))??;

    let reviewer_id = COCKPIT_REVIEWER_ID.to_string();
    if frozen.gate_suite.is_none() {
        let mut gates = frozen.deterministic_gates;
        gates.design_consistent = false;
        gates.context_aligned = false;
        let mut reasons = frozen.reasons;
        reasons.push(ReasonEntry {
            gate: "design".into(),
            reason: "semantic review not run because deterministic evidence is red".into(),
        });
        reasons.push(ReasonEntry {
            gate: "context".into(),
            reason: "semantic review not run because deterministic evidence is red".into(),
        });
        let verdict = ReviewVerdict::Reject {
            failed_gates: gates.failed_gates(),
        };
        let gates_digest = crate::control::gate_runner::gate_results_digest(&gates)?;
        let report = BranchReviewReport {
            gates,
            verdict,
            merge_ok: false,
            reasons,
            candidate_source_oid: frozen.candidate.source_oid.clone(),
            candidate_target_oid: frozen.candidate.target_oid.clone(),
            reviewer_model: crate::review::mission::A7_REVIEW_MODEL.into(),
        };
        let binding = ReviewedCandidateBinding {
            repo_path,
            source_branch,
            target_branch,
            source_oid: frozen.candidate.source_oid,
            target_oid: frozen.candidate.target_oid,
            reviewer_id,
            gates: report.gates,
            gates_digest,
            mission_authority: None,
        };
        return Ok(ReviewedTaskCandidate {
            report,
            binding,
            mission_lineage: None,
        });
    }

    let current = tasks
        .current_execution(&task_id)
        .ok_or_else(|| "cockpit Mission review lacks a visible execution attempt".to_string())?;
    let token = current.token();
    if current.fence.effect == crate::task::ExecutionEffect::Spawn
        && current.fence.state == crate::task::ExecutionFenceState::Committed
    {
        tasks
            .reserve_execution_effect(
                &token,
                crate::task::ExecutionEffect::Review,
                None,
                now_secs(),
            )
            .map_err(|error| error.to_string())?;
    }
    let reserved = tasks
        .current_execution(&task_id)
        .ok_or_else(|| "cockpit Mission review attempt vanished".to_string())?;
    if reserved.fence.effect != crate::task::ExecutionEffect::Review
        || reserved.fence.state != crate::task::ExecutionFenceState::Reserved
    {
        return Err("cockpit Mission review does not own the reserved Review fence".into());
    }
    let pty_session_id = reserved
        .identity
        .pty_session_id
        .clone()
        .ok_or_else(|| "cockpit Mission review attempt lacks a PTY identity".to_string())?;
    let evidence = MissionGateEvidence::from_cockpit_gate_suite(
        &activation,
        reserved.identity.attempt_id.clone(),
        reserved.identity.execution_generation,
        reserved.identity.agent_run_id.clone(),
        pty_session_id,
        frozen.gate_suite.ok_or_else(|| {
            "green cockpit deterministic gates lost their typed evidence suite".to_string()
        })?,
    )
    .map_err(|error| error.to_string())?;
    let builder = crate::review::mission::builder_runtime_attestation_for_policy(
        &evidence,
        &model,
        crate::review::mission::COCKPIT_REVIEW_POLICY_VERSION,
    )?;
    let reviewer_prompt = crate::review::mission::build_review_prompt(
        &preview,
        &activation,
        &evidence,
        &frozen.candidate.changed_paths,
        &frozen.diff,
    )?;
    let invocation = tauri::async_runtime::spawn_blocking(move || {
        crate::agent::codex_a7_review_oneshot(&reviewer_prompt)
    })
    .await
    .map_err(|error| format!("fixed reviewer task join error: {error}"))??;
    let reviewed_at_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_millis()
        .try_into()
        .map_err(|_| "review time exceeds u64".to_string())?;
    let review = crate::review::review_exact_candidate(
        &preview,
        &activation,
        &evidence,
        &frozen.candidate.changed_paths,
        &frozen.diff,
        reviewed_at_ms,
        &builder,
        false,
        &invocation,
    )?;
    tasks
        .persist_mission_review_bundle(&activation, &evidence, &invocation, &review)
        .map_err(|error| error.to_string())?;

    let accepted = review.verdict == crate::review::MissionReviewVerdict::AcceptedExactOid;
    let gates = GateResults {
        tests_pass: frozen.deterministic_gates.tests_pass,
        lint_pass: frozen.deterministic_gates.lint_pass,
        types_pass: frozen.deterministic_gates.types_pass,
        design_consistent: accepted,
        context_aligned: accepted,
    };
    let mut reasons = frozen.reasons;
    if !accepted {
        reasons.extend(review.findings.iter().map(|finding| ReasonEntry {
            gate: "design".into(),
            reason: finding.message.clone(),
        }));
        reasons.extend(
            review
                .clause_coverage
                .iter()
                .filter(|coverage| !coverage.accepted)
                .map(|coverage| ReasonEntry {
                    gate: "context".into(),
                    reason: coverage.reason.clone(),
                }),
        );
    }
    let verdict = if accepted {
        ReviewVerdict::Merge
    } else {
        ReviewVerdict::Reject {
            failed_gates: gates.failed_gates(),
        }
    };
    let gates_digest = crate::control::gate_runner::gate_results_digest(&gates)?;
    let report = BranchReviewReport {
        gates,
        verdict,
        merge_ok: accepted,
        reasons,
        candidate_source_oid: frozen.candidate.source_oid.clone(),
        candidate_target_oid: frozen.candidate.target_oid.clone(),
        reviewer_model: crate::review::mission::A7_REVIEW_MODEL.into(),
    };
    let reviewer_id = review.reviewer_independence.reviewer_principal_id.clone();
    let binding = ReviewedCandidateBinding {
        repo_path,
        source_branch,
        target_branch,
        source_oid: frozen.candidate.source_oid,
        target_oid: frozen.candidate.target_oid,
        reviewer_id,
        gates: report.gates,
        gates_digest,
        mission_authority: Some(crate::control::loop_ports::MissionReviewedAuthority {
            activation_id: activation.activation_id.clone(),
            mission_id: activation.mission_id.clone(),
            mission_revision: activation.mission_revision,
            work_unit_id: activation.work_unit_id.clone(),
            tested_evidence_id: evidence.evidence_id.clone(),
            review_id: review.review_id.clone(),
            reviewer_independence_digest: review.reviewer_independence.digest.clone(),
        }),
    };
    Ok(ReviewedTaskCandidate {
        report,
        binding,
        mission_lineage: Some(MissionReviewedLineage {
            activation,
            evidence,
            review,
        }),
    })
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
    if let Some(activation) = tasks
        .mission_activation_for_task(&task_id)
        .map_err(|error| error.to_string())?
    {
        return review_mission_task_candidate(
            tasks,
            repo_path,
            task_id,
            activation,
            mdl,
            source_branch,
            target_branch,
            owned_paths,
        )
        .await;
    }
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
        let mut detached = crate::git::DetachedReviewWorktree::create(
            &review_repo_path,
            &candidate.source_oid,
        )?;
        let commands = review::detect_gate_commands(detached.path());
        if gate_commands_require_node_modules(&commands) {
            detached.project_node_modules_from(&[
                worktree.clone(),
                std::path::PathBuf::from(&review_repo_path),
            ])?;
        }
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
        mission_authority: None,
    };
    Ok(ReviewedTaskCandidate {
        report,
        binding,
        mission_lineage: None,
    })
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

#[cfg(test)]
mod exact_candidate_tests {
    use super::*;

    fn committed_repository() -> (tempfile::TempDir, String) {
        let directory = tempfile::tempdir().unwrap();
        let repository = git2::Repository::init(directory.path()).unwrap();
        repository.set_head("refs/heads/main").unwrap();
        std::fs::write(directory.path().join("tracked.txt"), "candidate\n").unwrap();
        let mut index = repository.index().unwrap();
        index.add_path(std::path::Path::new("tracked.txt")).unwrap();
        index.write().unwrap();
        let tree_id = index.write_tree().unwrap();
        let tree = repository.find_tree(tree_id).unwrap();
        let signature = git2::Signature::now("Gate proof", "gate-proof@example.invalid").unwrap();
        let oid = repository
            .commit(
                Some("HEAD"),
                &signature,
                &signature,
                "candidate",
                &tree,
                &[],
            )
            .unwrap()
            .to_string();
        drop(tree);
        drop(index);
        drop(repository);
        (directory, oid)
    }

    #[test]
    fn exact_gate_proof_rejects_a_successful_command_that_changes_tracked_content() {
        let (directory, candidate_oid) = committed_repository();
        verify_detached_candidate_unchanged(directory.path(), &candidate_oid).unwrap();

        std::fs::write(directory.path().join("tracked.txt"), "changed by gate\n").unwrap();
        assert!(
            verify_detached_candidate_unchanged(directory.path(), &candidate_oid)
                .unwrap_err()
                .contains("changed tracked candidate content")
        );
    }

    #[test]
    fn cargo_cache_follows_the_detected_manifest_root() {
        let nested = review::GateCommand {
            kind: review::GateKind::Tests,
            program: "cargo".into(),
            args: vec![
                "test".into(),
                "--manifest-path".into(),
                "src-tauri/Cargo.toml".into(),
            ],
        };
        assert_eq!(
            cargo_target_dir("C:/repo", &nested).unwrap(),
            Path::new("C:/repo").join("src-tauri").join("target")
        );
        let root = review::GateCommand {
            kind: review::GateKind::Tests,
            program: "cargo".into(),
            args: vec!["test".into()],
        };
        assert_eq!(
            cargo_target_dir("C:/repo", &root).unwrap(),
            Path::new("C:/repo").join("target")
        );
    }
}
