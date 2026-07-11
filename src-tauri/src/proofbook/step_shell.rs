use crate::command_risk::{classify_command, CommandRiskOptions, CommandRiskSeverity};
use crate::process::{
    hidden_command, run_supervised, SupervisedCommandConfig, SupervisedCommandStatus,
};
use crate::proofbook::ledger::{
    self, ProofbookRunError, ProofbookStepOutcome, ProofbookStepStatus,
};
use crate::proofbook::{ProofbookError, ProofbookErrorCode, ProofbookStep};
use serde_json::json;
use std::path::{Path, PathBuf};
use std::time::Duration;

pub fn execute_shell_step(
    project_root: &Path,
    run_id: &str,
    step: &ProofbookStep,
    verifier: bool,
) -> Result<ProofbookStepOutcome, ProofbookError> {
    let Some(command_text) = string_param(step, "command") else {
        return Ok(ProofbookStepOutcome::failed(
            "missing_command",
            "shell/verifier step requires a command field",
        ));
    };
    let cwd = step_cwd(project_root, step)?;
    let options = CommandRiskOptions {
        workspace_root: Some(ledger::normalize_path(project_root)),
        safe_paths: vec![ledger::normalize_path(&cwd)],
    };
    let report = classify_command(&command_text, &options);
    let risk = serde_json::to_value(&report).ok();

    match report.severity {
        CommandRiskSeverity::Deny => {
            return Ok(ProofbookStepOutcome {
                status: ProofbookStepStatus::Blocked,
                risk,
                error: Some(ProofbookRunError::new(
                    "blocked_by_policy",
                    "command-risk policy denied the command before spawn",
                )),
                ..ProofbookStepOutcome::passed()
            });
        }
        CommandRiskSeverity::Review => {
            let gate_id = format!("pb-gate-{run_id}-{}-command-risk", step.id);
            let gate_hash = format!(
                "sha256:{}",
                ledger::hash_bytes(format!("{run_id}:{}:{command_text}", step.id).as_bytes())
            );
            return Ok(ProofbookStepOutcome::waiting_gate(
                json!({
                    "gateId": gate_id,
                    "gateHash": gate_hash,
                    "kind": "commandRisk",
                    "default": "reject",
                    "options": ["approve", "reject"],
                    "reason": "Command requires operator approval before Proofbook PB-2 can spawn it.",
                    "commandPreview": report.preview,
                }),
                risk,
            ));
        }
        CommandRiskSeverity::Allow => {}
    }

    let timeout_ms = u64_param(step, "timeoutMs").unwrap_or(10 * 60 * 1_000);
    let output_limit_bytes = u64_param(step, "outputLimitBytes")
        .unwrap_or(1024 * 1024)
        .clamp(1, 16 * 1024 * 1024) as usize;
    let mut command = shell_command(&command_text);
    command.current_dir(&cwd);
    let output = run_supervised(
        &mut command,
        &SupervisedCommandConfig {
            deadline: Duration::from_millis(timeout_ms.clamp(10, 60 * 60 * 1_000)),
            output_limit_bytes,
            cancellation: None,
        },
    )
    .map_err(|error| {
        ProofbookError::new(
            ProofbookErrorCode::IoError,
            format!("failed to spawn proofbook command: {error}"),
        )
        .with_step(step.id.clone())
    })?;

    let stdout_text = String::from_utf8_lossy(&output.stdout_tail).to_string();
    let stderr_text = String::from_utf8_lossy(&output.stderr_tail).to_string();
    let stdout =
        ledger::write_text_artifact(project_root, run_id, &step.id, "stdout", &stdout_text)?;
    let stderr =
        ledger::write_text_artifact(project_root, run_id, &step.id, "stderr", &stderr_text)?;
    let mut artifacts = vec![stdout.clone(), stderr.clone()];
    let mut artifact_refs = vec![stdout.id.clone(), stderr.id.clone()];
    let redaction_count = stdout.redaction_count + stderr.redaction_count;
    let exit_code = output.exit_code;

    if output.status != SupervisedCommandStatus::Exited {
        let (code, message, status) = supervision_failure(output.status, timeout_ms);
        return Ok(ProofbookStepOutcome {
            status,
            stdout_ref: Some(stdout.id),
            stderr_ref: Some(stderr.id),
            exit_code,
            artifacts,
            artifact_refs,
            redaction_count,
            risk,
            error: Some(ProofbookRunError::new(code, message)),
            ..ProofbookStepOutcome::passed()
        });
    }

    if verifier {
        let expected = expected_artifact_paths(step);
        if expected.is_empty() {
            return Ok(ProofbookStepOutcome {
                status: ProofbookStepStatus::Failed,
                stdout_ref: Some(stdout.id),
                stderr_ref: Some(stderr.id),
                exit_code,
                artifacts,
                artifact_refs,
                redaction_count,
                risk,
                error: Some(ProofbookRunError::new(
                    "missing_expected_artifact",
                    "verifier step requires expectedArtifact or expectedArtifacts",
                )),
                ..ProofbookStepOutcome::passed()
            });
        }
        for artifact in expected {
            let path = resolve_under_root(project_root, &artifact)?;
            if !path.exists() {
                return Ok(ProofbookStepOutcome {
                    status: ProofbookStepStatus::Failed,
                    stdout_ref: Some(stdout.id),
                    stderr_ref: Some(stderr.id),
                    exit_code,
                    artifacts,
                    artifact_refs,
                    redaction_count,
                    risk,
                    error: Some(ProofbookRunError::new(
                        "missing_expected_artifact",
                        format!("expected artifact does not exist: {artifact}"),
                    )),
                    ..ProofbookStepOutcome::passed()
                });
            }
            let recorded =
                ledger::record_existing_artifact(project_root, &step.id, "expected", &path)?;
            artifact_refs.push(recorded.id.clone());
            artifacts.push(recorded);
        }
    }

    let passed = exit_code == Some(0);
    Ok(ProofbookStepOutcome {
        status: if passed {
            ProofbookStepStatus::Passed
        } else {
            ProofbookStepStatus::Failed
        },
        stdout_ref: Some(stdout.id),
        stderr_ref: Some(stderr.id),
        exit_code,
        structured_output: Some(json!({
            "commandPreview": crate::command_risk::redact_sensitive_command(&command_text),
            "cwd": ledger::normalize_path(&cwd),
        })),
        artifacts,
        artifact_refs,
        redaction_count,
        risk,
        error: if passed {
            None
        } else {
            Some(ProofbookRunError::new(
                "command_failed",
                format!("command exited with code {:?}", exit_code),
            ))
        },
    })
}

fn supervision_failure(
    status: SupervisedCommandStatus,
    timeout_ms: u64,
) -> (&'static str, String, ProofbookStepStatus) {
    match status {
        SupervisedCommandStatus::TimedOut => (
            "command_timeout",
            format!("command exceeded timeoutMs={timeout_ms}"),
            ProofbookStepStatus::Failed,
        ),
        SupervisedCommandStatus::Cancelled => (
            "command_cancelled",
            "command was cancelled".to_string(),
            ProofbookStepStatus::Cancelled,
        ),
        SupervisedCommandStatus::Exited => unreachable!("normal exit is not a supervision failure"),
    }
}

fn shell_command(command_text: &str) -> std::process::Command {
    #[cfg(windows)]
    {
        let mut command = hidden_command("cmd");
        command.args(["/C", command_text]);
        command
    }
    #[cfg(not(windows))]
    {
        let mut command = hidden_command("sh");
        command.args(["-c", command_text]);
        command
    }
}

fn step_cwd(project_root: &Path, step: &ProofbookStep) -> Result<PathBuf, ProofbookError> {
    match string_param(step, "cwd") {
        Some(cwd) => resolve_under_root(project_root, &cwd),
        None => Ok(project_root.to_path_buf()),
    }
}

pub(crate) fn resolve_under_root(
    project_root: &Path,
    raw_path: &str,
) -> Result<PathBuf, ProofbookError> {
    let raw = Path::new(raw_path);
    let candidate = if raw.is_absolute() {
        raw.to_path_buf()
    } else {
        project_root.join(raw)
    };
    crate::proofbook::validator::ensure_path_under_root(
        project_root,
        &candidate.to_string_lossy(),
        "path",
    )
}

pub(crate) fn string_param(step: &ProofbookStep, key: &str) -> Option<String> {
    match step.params.get(key) {
        Some(serde_yaml::Value::String(value)) => Some(value.clone()),
        Some(serde_yaml::Value::Number(value)) => Some(value.to_string()),
        _ => None,
    }
}

pub(crate) fn u64_param(step: &ProofbookStep, key: &str) -> Option<u64> {
    match step.params.get(key) {
        Some(serde_yaml::Value::Number(value)) => value.as_u64(),
        Some(serde_yaml::Value::String(value)) => value.parse().ok(),
        _ => None,
    }
}

fn expected_artifact_paths(step: &ProofbookStep) -> Vec<String> {
    if let Some(single) = string_param(step, "expectedArtifact") {
        return vec![single];
    }
    match step.params.get("expectedArtifacts") {
        Some(serde_yaml::Value::Sequence(items)) => items
            .iter()
            .filter_map(|item| match item {
                serde_yaml::Value::String(value) => Some(value.clone()),
                _ => None,
            })
            .collect(),
        _ => Vec::new(),
    }
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;
    use std::collections::BTreeMap;

    fn shell_step(command: &str, timeout_ms: u64, output_limit_bytes: u64) -> ProofbookStep {
        let mut params = BTreeMap::new();
        params.insert("command".to_string(), serde_yaml::Value::from(command));
        params.insert("timeoutMs".to_string(), serde_yaml::Value::from(timeout_ms));
        params.insert(
            "outputLimitBytes".to_string(),
            serde_yaml::Value::from(output_limit_bytes),
        );
        ProofbookStep {
            id: "bounded-shell".to_string(),
            kind: "shell".to_string(),
            depends_on: Vec::new(),
            params,
        }
    }

    #[test]
    fn proofbook_shell_maps_supervision_failures_to_typed_outcomes() {
        let timeout = supervision_failure(SupervisedCommandStatus::TimedOut, 50);
        assert_eq!(timeout.0, "command_timeout");
        assert_eq!(timeout.2, ProofbookStepStatus::Failed);
        let cancelled = supervision_failure(SupervisedCommandStatus::Cancelled, 50);
        assert_eq!(cancelled.0, "command_cancelled");
        assert_eq!(cancelled.2, ProofbookStepStatus::Cancelled);
    }

    #[test]
    fn proofbook_shell_caps_flooded_output_artifact() {
        let root = tempfile::tempdir().unwrap();
        let step = shell_step(&format!("echo {}", "x".repeat(5000)), 10_000, 257);
        let outcome = execute_shell_step(root.path(), "flood-run", &step, false).unwrap();
        assert_eq!(outcome.status, ProofbookStepStatus::Passed);
        let stdout = outcome
            .artifacts
            .iter()
            .find(|artifact| artifact.kind == "stdout")
            .unwrap();
        let stdout_path = root.path().join(&stdout.path);
        assert!(std::fs::metadata(stdout_path).unwrap().len() <= 257);
    }
}
