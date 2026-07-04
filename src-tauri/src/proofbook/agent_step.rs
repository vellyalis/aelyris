use crate::proofbook::ledger::{
    self, ProofbookRunError, ProofbookRunLedger, ProofbookStepOutcome, ProofbookStepStatus,
};
use crate::proofbook::{ProofbookError, ProofbookStep};
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProofbookAgentSessionRequest {
    pub task: String,
    pub role: String,
    pub provider: String,
    pub model: String,
    pub repo_path: String,
    pub worktree_branch: Option<String>,
    pub worktree_path: Option<String>,
    pub visible: bool,
    pub headless_reason: Option<String>,
    pub timeout_ms: Option<u64>,
    pub expected_artifacts: Vec<String>,
    pub cols: u16,
    pub rows: u16,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProofbookAgentSessionSpawn {
    pub session_id: String,
    pub pane_id: Option<String>,
    pub pty_id: Option<String>,
    pub backend: String,
    pub provider: String,
    pub model: String,
    pub repo_path: String,
    pub worktree_path: Option<String>,
    pub worktree_branch: Option<String>,
    pub visible: bool,
}

pub trait ProofbookAgentSessionExecutor {
    fn start_agent_session(
        &self,
        run_id: &str,
        ledger: &ProofbookRunLedger,
        step: &ProofbookStep,
        request: &ProofbookAgentSessionRequest,
    ) -> Result<ProofbookAgentSessionSpawn, ProofbookError>;
}

pub fn execute_agent_session_step(
    root: &Path,
    ledger: &ProofbookRunLedger,
    step: &ProofbookStep,
    executor: Option<&dyn ProofbookAgentSessionExecutor>,
) -> Result<ProofbookStepOutcome, ProofbookError> {
    let request = match build_agent_session_request(root, ledger, step) {
        Ok(request) => request,
        Err(outcome) => return Ok(outcome),
    };

    let Some(executor) = executor else {
        return Ok(ProofbookStepOutcome::blocked(
            "agent_session_runtime_unavailable",
            "Proofbook agentSession steps require the PB-4 agent runtime",
        ));
    };

    let spawn = executor.start_agent_session(&ledger.run_id, ledger, step, &request)?;
    let visible_mode = if request.visible {
        "visible"
    } else {
        "headless"
    };
    let cost_tokens_status = "unknown";
    let output = serde_json::json!({
        "kind": "agentSession",
        "sessionId": spawn.session_id,
        "paneId": spawn.pane_id,
        "ptyId": spawn.pty_id,
        "backend": spawn.backend,
        "provider": spawn.provider,
        "model": spawn.model,
        "role": request.role,
        "repoPath": spawn.repo_path,
        "worktreePath": spawn.worktree_path,
        "worktreeBranch": spawn.worktree_branch,
        "visibleMode": visible_mode,
        "headlessReason": request.headless_reason,
        "costTokensStatus": cost_tokens_status,
        "timeoutMs": request.timeout_ms,
        "expectedArtifacts": request.expected_artifacts,
        "lifecycleArtifacts": {
            "summary": [],
            "checkpoint": [],
            "handoff": [],
            "resume": [],
            "resetContext": [],
            "finalReport": [],
            "commandEvidence": []
        }
    });

    Ok(ProofbookStepOutcome {
        status: ProofbookStepStatus::Running,
        structured_output: Some(output),
        error: None,
        ..ProofbookStepOutcome::passed()
    })
}

fn build_agent_session_request(
    root: &Path,
    ledger: &ProofbookRunLedger,
    step: &ProofbookStep,
) -> Result<ProofbookAgentSessionRequest, ProofbookStepOutcome> {
    let Some(task) = string_param(step, "task") else {
        return Err(invalid_config("agentSession step requires task"));
    };
    let Some(role) = string_param(step, "role").or_else(|| string_param(step, "mode")) else {
        return Err(invalid_config("agentSession step requires role or mode"));
    };
    let role_key = role.to_ascii_lowercase();
    let visible = bool_param(step, "visible").unwrap_or(true);
    let headless_reason = string_param(step, "headlessReason");

    if !visible && !is_headless_allowed_role(&role_key) {
        return Err(ProofbookStepOutcome::failed(
            "agent_session_headless_not_allowed",
            "headless agentSession is only allowed for planner, reviewer, or batch roles",
        ));
    }
    if !visible && headless_reason.as_deref().unwrap_or("").trim().is_empty() {
        return Err(invalid_config(
            "headless agentSession requires headlessReason",
        ));
    }
    if declares_cost_cap(step) {
        return Err(ProofbookStepOutcome::failed(
            "agent_session_cost_unknown",
            "agentSession cost/token observation is unknown for this PB-4 slice",
        ));
    }

    let model = string_param(step, "model")
        .or_else(|| string_param(step, "provider"))
        .unwrap_or_else(|| "sonnet".to_string());
    let provider = string_param(step, "provider").unwrap_or_else(|| provider_from_model(&model));
    let repo_path = string_param(step, "repoPath").unwrap_or_else(|| ledger.project_path.clone());
    let repo_path = contained_path(root, &repo_path, "repoPath")?;
    let worktree_path = match string_param(step, "worktreePath") {
        Some(path) => Some(contained_path(root, &path, "worktreePath")?),
        None => None,
    };
    let worktree_branch = string_param(step, "branch");
    if let Some(branch) = worktree_branch.as_deref() {
        if let Err(error) = crate::git::validate_branch_name(branch) {
            return Err(ProofbookStepOutcome::failed(
                "agent_session_invalid_config",
                format!("invalid agentSession branch: {error}"),
            ));
        }
    }
    if string_param(step, "sessionId").is_some() || string_param(step, "paneId").is_some() {
        return Err(ProofbookStepOutcome::failed(
            "agent_session_identity_mismatch",
            "PB-4 cannot attach an existing agent session without matching lifecycle proof",
        ));
    }

    Ok(ProofbookAgentSessionRequest {
        task,
        role,
        provider,
        model,
        repo_path,
        worktree_branch,
        worktree_path,
        visible,
        headless_reason,
        timeout_ms: u64_param(step, "timeoutMs"),
        expected_artifacts: string_vec_param(step, "expectedArtifacts"),
        cols: u16_param(step, "cols").unwrap_or(120),
        rows: u16_param(step, "rows").unwrap_or(30),
    })
}

fn invalid_config(message: impl Into<String>) -> ProofbookStepOutcome {
    ProofbookStepOutcome::failed("agent_session_invalid_config", message)
}

fn contained_path(
    root: &Path,
    raw_path: &str,
    field: &str,
) -> Result<String, ProofbookStepOutcome> {
    crate::proofbook::validator::ensure_path_under_root(root, raw_path, field)
        .map(ledger::normalize_path)
        .map_err(|error| {
            ProofbookStepOutcome::failed("agent_session_invalid_config", error.message)
        })
}

fn is_headless_allowed_role(role: &str) -> bool {
    matches!(role, "planner" | "reviewer" | "batch")
}

fn provider_from_model(model: &str) -> String {
    let lower = model.to_ascii_lowercase();
    if lower.contains("codex") {
        "codex".to_string()
    } else if lower.contains("gemini") {
        "gemini".to_string()
    } else {
        "claude".to_string()
    }
}

fn string_param(step: &ProofbookStep, key: &str) -> Option<String> {
    match step.params.get(key)? {
        serde_yaml::Value::String(value) => {
            let trimmed = value.trim();
            (!trimmed.is_empty()).then(|| trimmed.to_string())
        }
        serde_yaml::Value::Bool(value) => Some(value.to_string()),
        serde_yaml::Value::Number(value) => Some(value.to_string()),
        _ => None,
    }
}

fn bool_param(step: &ProofbookStep, key: &str) -> Option<bool> {
    match step.params.get(key)? {
        serde_yaml::Value::Bool(value) => Some(*value),
        serde_yaml::Value::String(value) => value.parse().ok(),
        _ => None,
    }
}

fn u64_param(step: &ProofbookStep, key: &str) -> Option<u64> {
    match step.params.get(key)? {
        serde_yaml::Value::Number(value) => value.as_u64(),
        serde_yaml::Value::String(value) => value.parse().ok(),
        _ => None,
    }
}

fn u16_param(step: &ProofbookStep, key: &str) -> Option<u16> {
    u64_param(step, key).and_then(|value| u16::try_from(value).ok())
}

fn string_vec_param(step: &ProofbookStep, key: &str) -> Vec<String> {
    match step.params.get(key) {
        Some(serde_yaml::Value::Sequence(values)) => values
            .iter()
            .filter_map(|value| match value {
                serde_yaml::Value::String(text) => {
                    let trimmed = text.trim();
                    (!trimmed.is_empty()).then(|| trimmed.to_string())
                }
                _ => None,
            })
            .collect(),
        Some(serde_yaml::Value::String(value)) if !value.trim().is_empty() => {
            vec![value.trim().to_string()]
        }
        _ => Vec::new(),
    }
}

fn declares_cost_cap(step: &ProofbookStep) -> bool {
    ["costCap", "maxCost", "tokenCap", "tokensCap", "maxTokens"]
        .iter()
        .any(|key| step.params.contains_key(*key))
}

pub fn interrupted_agent_session_error() -> ProofbookRunError {
    ProofbookRunError::new(
        "agent_session_interrupted_by_restart",
        "running agentSession step was interrupted by process restart",
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::proofbook::{parse_proofbook, ProofbookRunStatus};
    use std::fs;

    fn write_proofbook(
        project: &Path,
        yaml: &str,
    ) -> (String, crate::proofbook::ProofbookDefinition) {
        let dir = project.join(".aelyris").join("proofbooks");
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("agent.proofbook.yaml");
        fs::write(&path, yaml).unwrap();
        let path = path.to_string_lossy().to_string();
        let definition = parse_proofbook(&path).unwrap();
        (path, definition)
    }

    #[test]
    fn agent_session_requires_task_and_role() {
        let project = tempfile::tempdir().unwrap();
        let (path, definition) = write_proofbook(
            project.path(),
            r#"
schema: aelyris.proofbook.v1
id: agent-missing
steps:
  - id: agent
    type: agentSession
settlement:
  requiredSteps: [agent]
"#,
        );
        let ledger =
            ledger::new_run_ledger(project.path(), &path, &definition, &serde_json::json!({}))
                .unwrap();

        let outcome =
            execute_agent_session_step(project.path(), &ledger, &definition.steps[0], None)
                .unwrap();

        assert_eq!(outcome.status, ProofbookStepStatus::Failed);
        assert_eq!(outcome.error.unwrap().code, "agent_session_invalid_config");
    }

    #[test]
    fn agent_session_headless_implementation_fails_closed() {
        let project = tempfile::tempdir().unwrap();
        let (path, definition) = write_proofbook(
            project.path(),
            r#"
schema: aelyris.proofbook.v1
id: agent-headless-impl
steps:
  - id: agent
    type: agentSession
    task: build
    role: implementation
    visible: false
    headlessReason: no-ui
settlement:
  requiredSteps: [agent]
"#,
        );
        let ledger =
            ledger::new_run_ledger(project.path(), &path, &definition, &serde_json::json!({}))
                .unwrap();

        let outcome =
            execute_agent_session_step(project.path(), &ledger, &definition.steps[0], None)
                .unwrap();

        assert_eq!(outcome.status, ProofbookStepStatus::Failed);
        assert_eq!(
            outcome.error.unwrap().code,
            "agent_session_headless_not_allowed"
        );
    }

    #[test]
    fn agent_session_cost_cap_requires_observable_cost() {
        let project = tempfile::tempdir().unwrap();
        let (path, definition) = write_proofbook(
            project.path(),
            r#"
schema: aelyris.proofbook.v1
id: agent-cost
steps:
  - id: agent
    type: agentSession
    task: review
    role: reviewer
    visible: false
    headlessReason: review batch
    maxTokens: 10
settlement:
  requiredSteps: [agent]
"#,
        );
        let ledger =
            ledger::new_run_ledger(project.path(), &path, &definition, &serde_json::json!({}))
                .unwrap();

        let outcome =
            execute_agent_session_step(project.path(), &ledger, &definition.steps[0], None)
                .unwrap();

        assert_eq!(outcome.status, ProofbookStepStatus::Failed);
        assert_eq!(outcome.error.unwrap().code, "agent_session_cost_unknown");
        assert_eq!(ledger.status, ProofbookRunStatus::Pending);
    }
}
