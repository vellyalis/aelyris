use std::path::Path;

use serde_json::Value;

use super::ledger::{ProofbookRunLedger, ProofbookStepSummary};
use super::{ProofbookError, ProofbookErrorCode};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProofbookAgentSessionExpectedArtifact {
    pub path: String,
    pub present: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProofbookAgentSessionSettlementContext {
    pub run_id: String,
    pub ledger_revision: u64,
    pub step_id: String,
    pub session_id: String,
    pub pane_id: Option<String>,
    pub pty_id: Option<String>,
    pub backend: String,
    pub visible: bool,
    pub repo_path: String,
    pub worktree_path: Option<String>,
    pub worktree_branch: Option<String>,
    pub expected_artifacts: Vec<ProofbookAgentSessionExpectedArtifact>,
}

pub(crate) fn expected_artifacts(summary: &ProofbookStepSummary) -> Vec<String> {
    summary
        .structured_output
        .as_ref()
        .and_then(|output| output.get("expectedArtifacts"))
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .filter_map(trim_optional)
                .collect()
        })
        .unwrap_or_default()
}

pub(crate) fn context_from(
    root: &Path,
    ledger: &ProofbookRunLedger,
    summary: &ProofbookStepSummary,
) -> Result<ProofbookAgentSessionSettlementContext, ProofbookError> {
    let output = summary.structured_output.as_ref().ok_or_else(|| {
        settlement_validation(
            &summary.step_id,
            "Proofbook agentSession runtime identity is unavailable",
        )
    })?;
    if output.get("kind").and_then(Value::as_str) != Some("agentSession") {
        return Err(settlement_validation(
            &summary.step_id,
            "Proofbook agentSession runtime identity has an unexpected kind",
        ));
    }
    let session_id = required_runtime_identity(output, "sessionId", &summary.step_id)?;
    let backend = required_runtime_identity(output, "backend", &summary.step_id)?;
    let repo_path = required_runtime_identity(output, "repoPath", &summary.step_id)?;
    let visible_mode = required_runtime_identity(output, "visibleMode", &summary.step_id)?;
    let visible = match visible_mode.as_str() {
        "visible" => true,
        "headless" => false,
        _ => {
            return Err(settlement_validation(
                &summary.step_id,
                "Proofbook agentSession runtime visibility is invalid",
            ));
        }
    };
    let pane_id = optional_runtime_identity(output, "paneId");
    let pty_id = optional_runtime_identity(output, "ptyId");
    if visible && pty_id.is_none() {
        return Err(settlement_validation(
            &summary.step_id,
            "Visible Proofbook agentSession is missing its PTY identity",
        ));
    }
    let expected_artifacts = expected_artifacts(summary)
        .into_iter()
        .map(|raw_path| {
            let resolved = super::step_shell::resolve_under_root(root, &raw_path)?;
            Ok(ProofbookAgentSessionExpectedArtifact {
                path: raw_path,
                present: resolved.is_file(),
            })
        })
        .collect::<Result<Vec<_>, ProofbookError>>()?;

    Ok(ProofbookAgentSessionSettlementContext {
        run_id: ledger.run_id.clone(),
        ledger_revision: ledger.revision,
        step_id: summary.step_id.clone(),
        session_id,
        pane_id,
        pty_id,
        backend,
        visible,
        repo_path,
        worktree_path: optional_runtime_identity(output, "worktreePath"),
        worktree_branch: optional_runtime_identity(output, "worktreeBranch"),
        expected_artifacts,
    })
}

fn required_runtime_identity(
    output: &Value,
    key: &str,
    step_id: &str,
) -> Result<String, ProofbookError> {
    output
        .get(key)
        .and_then(Value::as_str)
        .and_then(trim_optional)
        .ok_or_else(|| {
            settlement_validation(
                step_id,
                format!("Proofbook agentSession runtime identity is missing {key}"),
            )
        })
}

fn optional_runtime_identity(output: &Value, key: &str) -> Option<String> {
    output
        .get(key)
        .and_then(Value::as_str)
        .and_then(trim_optional)
}

fn trim_optional(value: &str) -> Option<String> {
    let trimmed = value.trim();
    (!trimmed.is_empty()).then(|| trimmed.to_string())
}

fn settlement_validation(step_id: &str, detail: impl Into<String>) -> ProofbookError {
    ProofbookError::new(ProofbookErrorCode::ValidationFailed, detail.into()).with_step(step_id)
}
