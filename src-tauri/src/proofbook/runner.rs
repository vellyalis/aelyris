use crate::proofbook::ledger::{
    self, ProofbookGateDecision, ProofbookResidualBlocker, ProofbookRunError, ProofbookRunLedger,
    ProofbookRunStatus, ProofbookStepOutcome, ProofbookStepStatus,
};
use crate::proofbook::{
    parse_proofbook, validate_definition, ProofbookDefinition, ProofbookError, ProofbookErrorCode,
    ProofbookStep, ProofbookStepKind,
};
use serde_json::json;
use std::collections::BTreeMap;
use std::path::Path;
use std::sync::{Arc, Mutex};

#[derive(Clone, Default)]
pub struct ProofbookRunner {
    runs: Arc<Mutex<BTreeMap<String, ProofbookRunLedger>>>,
}

impl ProofbookRunner {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn start_run(
        &self,
        project_path: &str,
        proofbook_path: &str,
        inputs: serde_json::Value,
    ) -> Result<ProofbookRunLedger, ProofbookError> {
        let root = crate::proofbook::validator::canonical_project_root(project_path)?;
        let proofbook_path = resolve_proofbook_path(&root, proofbook_path)?;
        let definition = parse_proofbook(&proofbook_path)?;
        let report = validate_definition(project_path, &definition, &proofbook_path);
        if !report.valid {
            return Err(validation_failed(report.errors));
        }

        let mut ledger = ledger::new_run_ledger(&root, &proofbook_path, &definition, &inputs)?;
        ledger::write_ledger(&root, &ledger)?;
        self.remember(ledger.clone())?;
        self.drive_run(&root, &definition, &mut ledger)?;
        self.remember(ledger.clone())?;
        Ok(ledger)
    }

    pub fn status(
        &self,
        project_path: &str,
        run_id: &str,
    ) -> Result<ProofbookRunLedger, ProofbookError> {
        let root = crate::proofbook::validator::canonical_project_root(project_path)?;
        self.load_run(&root, run_id)
    }

    pub fn list_runs(&self, project_path: &str) -> Result<Vec<ProofbookRunLedger>, ProofbookError> {
        self.restore_project(project_path)?;
        let root = crate::proofbook::validator::canonical_project_root(project_path)?;
        ledger::list_ledgers(&root)
    }

    pub fn cancel_run(
        &self,
        project_path: &str,
        run_id: &str,
    ) -> Result<ProofbookRunLedger, ProofbookError> {
        let root = crate::proofbook::validator::canonical_project_root(project_path)?;
        let mut ledger = self.load_run(&root, run_id)?;
        ledger.status = ProofbookRunStatus::Cancelled;
        for step in &mut ledger.steps {
            if matches!(
                step.status,
                ProofbookStepStatus::Pending | ProofbookStepStatus::Running
            ) {
                step.status = ProofbookStepStatus::Cancelled;
                step.completed_at = Some(ledger::now_timestamp());
            }
        }
        ledger.append_event(
            "run_cancelled",
            None,
            "Proofbook run cancelled by operator",
            Some("cancelled".to_string()),
            None,
        );
        ledger::write_ledger(&root, &ledger)?;
        self.remember(ledger.clone())?;
        Ok(ledger)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn resolve_manual_gate(
        &self,
        project_path: &str,
        run_id: &str,
        gate_id: String,
        gate_hash: String,
        decision: String,
        actor: Option<String>,
        comment: Option<String>,
    ) -> Result<ProofbookRunLedger, ProofbookError> {
        let root = crate::proofbook::validator::canonical_project_root(project_path)?;
        let mut ledger = self.load_run(&root, run_id)?;
        let Some((step_id, gate_kind)) = waiting_gate_for(&ledger, &gate_id) else {
            return Err(ProofbookError::new(
                ProofbookErrorCode::RunNotFound,
                format!("no waiting Proofbook gate found for {gate_id}"),
            ));
        };
        if gate_kind != "manualGate" {
            return Err(ProofbookError::runtime_not_available(
                "resolving command-risk gates is not implemented in PB-2",
            ));
        }
        let expected_hash = gate_hash_for(&ledger, &gate_id).unwrap_or_default();
        if expected_hash != gate_hash {
            return Err(ProofbookError::new(
                ProofbookErrorCode::StaleGateHash,
                "Proofbook gate hash mismatch; refresh run status and retry",
            )
            .with_step(step_id));
        }

        let normalized_decision = decision.trim().to_ascii_lowercase();
        let gate_decision = crate::proofbook::step_manual_gate::decision(
            gate_id,
            gate_hash,
            step_id.clone(),
            normalized_decision.clone(),
            actor,
            comment,
        );
        apply_gate_decision(&mut ledger, &step_id, gate_decision, &normalized_decision);
        ledger.status = if normalized_decision == "approve" || normalized_decision == "approved" {
            ProofbookRunStatus::Running
        } else {
            ProofbookRunStatus::Failed
        };
        ledger::write_ledger(&root, &ledger)?;

        if ledger.status == ProofbookRunStatus::Running {
            let definition = parse_proofbook(&ledger.definition_path)?;
            let current_hash = ledger::hash_json(&definition)?;
            if current_hash != ledger.definition_hash {
                ledger.status = ProofbookRunStatus::Failed;
                ledger.residual_blockers.push(ProofbookResidualBlocker {
                    code: "definition_changed_after_gate".to_string(),
                    step_id: Some(step_id),
                    message: "Proofbook definition changed after the gate was issued.".to_string(),
                });
                ledger.append_event(
                    "run_failed",
                    None,
                    "Proofbook definition changed after manual gate approval",
                    Some("failed".to_string()),
                    Some(ProofbookRunError::new(
                        "definition_changed_after_gate",
                        "refresh and restart the Proofbook run before continuing",
                    )),
                );
                ledger::write_ledger(&root, &ledger)?;
            } else {
                let report =
                    validate_definition(project_path, &definition, &ledger.definition_path);
                if !report.valid {
                    let error = validation_failed(report.errors);
                    ledger.status = ProofbookRunStatus::Failed;
                    ledger.residual_blockers.push(ProofbookResidualBlocker {
                        code: "validation_failed_after_gate".to_string(),
                        step_id: None,
                        message: error.message.clone(),
                    });
                    ledger.append_event(
                        "run_failed",
                        None,
                        "Proofbook validation failed after manual gate approval",
                        Some("failed".to_string()),
                        Some(ProofbookRunError::new(
                            "validation_failed_after_gate",
                            error.message,
                        )),
                    );
                    ledger::write_ledger(&root, &ledger)?;
                } else {
                    self.drive_run(&root, &definition, &mut ledger)?;
                }
            }
        }
        self.remember(ledger.clone())?;
        Ok(ledger)
    }

    pub fn restore_project(&self, project_path: &str) -> Result<usize, ProofbookError> {
        let root = crate::proofbook::validator::canonical_project_root(project_path)?;
        let mut restored = 0;
        for mut ledger in ledger::list_ledgers(&root)? {
            let mut changed = false;
            if ledger.status == ProofbookRunStatus::Running {
                for step in &mut ledger.steps {
                    if step.status == ProofbookStepStatus::Running {
                        step.status = ProofbookStepStatus::Blocked;
                        step.completed_at = Some(ledger::now_timestamp());
                        step.error = Some(ProofbookRunError::new(
                            "interrupted_by_restart",
                            "running step was interrupted by process restart",
                        ));
                        changed = true;
                    }
                }
                if changed {
                    ledger.status = ProofbookRunStatus::Failed;
                    ledger.residual_blockers.push(ProofbookResidualBlocker {
                        code: "interrupted_by_restart".to_string(),
                        step_id: None,
                        message: "A running Proofbook step was found during hydration.".to_string(),
                    });
                    ledger.append_event(
                        "run_hydrated_fail_closed",
                        None,
                        "Converted dead running steps to interrupted_by_restart",
                        Some("failed".to_string()),
                        Some(ProofbookRunError::new(
                            "interrupted_by_restart",
                            "running steps cannot be resumed blindly",
                        )),
                    );
                    ledger::write_ledger(&root, &ledger)?;
                }
            }
            let id = ledger.run_id.clone();
            let mut runs = self.runs.lock().map_err(|_| {
                ProofbookError::new(
                    ProofbookErrorCode::IoError,
                    "proofbook runner lock poisoned",
                )
            })?;
            if !runs.contains_key(&id) {
                restored += 1;
            }
            runs.insert(id, ledger);
        }
        Ok(restored)
    }

    fn drive_run(
        &self,
        root: &Path,
        definition: &ProofbookDefinition,
        ledger: &mut ProofbookRunLedger,
    ) -> Result<(), ProofbookError> {
        if matches!(
            ledger.status,
            ProofbookRunStatus::Cancelled | ProofbookRunStatus::Failed
        ) {
            return Ok(());
        }
        ledger.status = ProofbookRunStatus::Running;
        ledger.append_event(
            "run_started",
            None,
            "Proofbook runner started deterministic queue",
            Some("running".to_string()),
            None,
        );
        ledger::write_ledger(root, ledger)?;

        loop {
            let mut progressed = false;
            for step in &definition.steps {
                if ledger.step(&step.id).map(|s| s.status) != Some(ProofbookStepStatus::Pending) {
                    continue;
                }
                if !dependencies_passed(ledger, step) {
                    continue;
                }
                progressed = true;
                self.mark_step_running(root, ledger, step)?;
                let outcome = self.execute_step(root, &ledger.run_id, step)?;
                self.apply_step_outcome(root, ledger, step, outcome)?;
                match ledger.step(&step.id).map(|s| s.status) {
                    Some(ProofbookStepStatus::WaitingGate) => return Ok(()),
                    Some(ProofbookStepStatus::Failed | ProofbookStepStatus::Blocked) => {
                        return Ok(())
                    }
                    _ => {}
                }
            }
            if !progressed {
                break;
            }
        }

        self.settle_run(root, definition, ledger)?;
        Ok(())
    }

    fn mark_step_running(
        &self,
        root: &Path,
        ledger: &mut ProofbookRunLedger,
        step: &ProofbookStep,
    ) -> Result<(), ProofbookError> {
        let now = ledger::now_timestamp();
        if let Some(summary) = ledger.step_mut(&step.id) {
            summary.status = ProofbookStepStatus::Running;
            summary.started_at.get_or_insert_with(|| now.clone());
            summary.attempt = summary.attempt.saturating_add(1);
        }
        ledger.append_event(
            "step_started",
            Some(step.id.clone()),
            format!("Proofbook step {} started", step.id),
            Some("running".to_string()),
            None,
        );
        ledger::write_ledger(root, ledger)
    }

    fn execute_step(
        &self,
        root: &Path,
        run_id: &str,
        step: &ProofbookStep,
    ) -> Result<ProofbookStepOutcome, ProofbookError> {
        match ProofbookStepKind::from_wire(&step.kind) {
            Some(ProofbookStepKind::Shell) => {
                crate::proofbook::step_shell::execute_shell_step(root, run_id, step, false)
            }
            Some(ProofbookStepKind::Verifier) => {
                crate::proofbook::step_shell::execute_shell_step(root, run_id, step, true)
            }
            Some(ProofbookStepKind::WaitFor) => {
                crate::proofbook::step_wait::execute_wait_for_step(root, step)
            }
            Some(ProofbookStepKind::ManualGate) => Ok(
                crate::proofbook::step_manual_gate::wait_for_manual_gate(run_id, step),
            ),
            Some(kind) => Ok(ProofbookStepOutcome::blocked(
                "not_implemented",
                format!("Proofbook step kind {kind:?} is not executable in PB-2"),
            )),
            None => Ok(ProofbookStepOutcome::failed(
                "unknown_step_type",
                format!("unknown proofbook step type: {}", step.kind),
            )),
        }
    }

    fn apply_step_outcome(
        &self,
        root: &Path,
        ledger: &mut ProofbookRunLedger,
        step: &ProofbookStep,
        outcome: ProofbookStepOutcome,
    ) -> Result<(), ProofbookError> {
        let completed_at = ledger::now_timestamp();
        let status = outcome.status;
        let error = outcome.error.clone();
        let artifact_refs = outcome.artifact_refs.clone();
        if let Some(summary) = ledger.step_mut(&step.id) {
            summary.status = status;
            summary.completed_at = if status == ProofbookStepStatus::WaitingGate {
                None
            } else {
                Some(completed_at.clone())
            };
            summary.duration_ms = ledger::duration_ms(&summary.started_at, &completed_at);
            summary.stdout_ref = outcome.stdout_ref;
            summary.stderr_ref = outcome.stderr_ref;
            summary.exit_code = outcome.exit_code;
            summary.structured_output = outcome.structured_output;
            summary.artifact_refs = artifact_refs;
            summary.redaction_count = outcome.redaction_count;
            summary.risk = outcome.risk;
            summary.error = error.clone();
        }
        ledger.artifacts.extend(outcome.artifacts);

        match status {
            ProofbookStepStatus::Passed => {
                ledger.append_event(
                    "step_passed",
                    Some(step.id.clone()),
                    format!("Proofbook step {} passed", step.id),
                    Some("passed".to_string()),
                    None,
                );
            }
            ProofbookStepStatus::WaitingGate => {
                ledger.status = ProofbookRunStatus::WaitingGate;
                ledger.append_event(
                    "step_waiting_gate",
                    Some(step.id.clone()),
                    format!("Proofbook step {} is waiting for a gate", step.id),
                    Some("waiting_gate".to_string()),
                    error,
                );
            }
            ProofbookStepStatus::Blocked => {
                ledger.status = if error
                    .as_ref()
                    .is_some_and(|e| e.code == "blocked_by_policy")
                {
                    ProofbookRunStatus::BlockedByPolicy
                } else {
                    ProofbookRunStatus::Failed
                };
                if let Some(error) = error.clone() {
                    ledger.residual_blockers.push(ProofbookResidualBlocker {
                        code: error.code.clone(),
                        step_id: Some(step.id.clone()),
                        message: error.message.clone(),
                    });
                }
                ledger.append_event(
                    "step_blocked",
                    Some(step.id.clone()),
                    format!("Proofbook step {} blocked", step.id),
                    Some("blocked".to_string()),
                    error,
                );
            }
            ProofbookStepStatus::Failed => {
                ledger.status = ProofbookRunStatus::Failed;
                if let Some(error) = error.clone() {
                    ledger.residual_blockers.push(ProofbookResidualBlocker {
                        code: error.code.clone(),
                        step_id: Some(step.id.clone()),
                        message: error.message.clone(),
                    });
                }
                ledger.append_event(
                    "step_failed",
                    Some(step.id.clone()),
                    format!("Proofbook step {} failed", step.id),
                    Some("failed".to_string()),
                    error,
                );
            }
            ProofbookStepStatus::Cancelled
            | ProofbookStepStatus::Skipped
            | ProofbookStepStatus::Pending
            | ProofbookStepStatus::Running => {}
        }
        ledger::write_ledger(root, ledger)
    }

    fn settle_run(
        &self,
        root: &Path,
        definition: &ProofbookDefinition,
        ledger: &mut ProofbookRunLedger,
    ) -> Result<(), ProofbookError> {
        let Some(settlement) = definition.settlement.as_ref() else {
            ledger.status = ProofbookRunStatus::Failed;
            return ledger::write_ledger(root, ledger);
        };
        for required in &settlement.required_steps {
            if ledger.step(required).map(|s| s.status) != Some(ProofbookStepStatus::Passed) {
                ledger.status = ProofbookRunStatus::Failed;
                ledger.residual_blockers.push(ProofbookResidualBlocker {
                    code: "required_step_not_passed".to_string(),
                    step_id: Some(required.clone()),
                    message: format!("required step did not pass: {required}"),
                });
                ledger.append_event(
                    "run_failed",
                    None,
                    format!("required step did not pass: {required}"),
                    Some("failed".to_string()),
                    Some(ProofbookRunError::new("required_step_not_passed", required)),
                );
                ledger::write_ledger(root, ledger)?;
                return Ok(());
            }
        }
        for artifact in &settlement.required_artifacts {
            let path = crate::proofbook::step_shell::resolve_under_root(root, artifact)?;
            if !path.exists() {
                ledger.status = ProofbookRunStatus::Failed;
                ledger.residual_blockers.push(ProofbookResidualBlocker {
                    code: "missing_required_artifact".to_string(),
                    step_id: None,
                    message: format!("required artifact does not exist: {artifact}"),
                });
                ledger.append_event(
                    "run_failed",
                    None,
                    format!("required artifact does not exist: {artifact}"),
                    Some("failed".to_string()),
                    Some(ProofbookRunError::new(
                        "missing_required_artifact",
                        artifact,
                    )),
                );
                ledger::write_ledger(root, ledger)?;
                return Ok(());
            }
        }
        ledger.status = ProofbookRunStatus::Passed;
        ledger.append_event(
            "run_passed",
            None,
            "Proofbook settlement passed",
            Some("passed".to_string()),
            None,
        );
        ledger::write_ledger(root, ledger)
    }

    fn remember(&self, ledger: ProofbookRunLedger) -> Result<(), ProofbookError> {
        self.runs
            .lock()
            .map_err(|_| {
                ProofbookError::new(
                    ProofbookErrorCode::IoError,
                    "proofbook runner lock poisoned",
                )
            })?
            .insert(ledger.run_id.clone(), ledger);
        Ok(())
    }

    fn load_run(&self, root: &Path, run_id: &str) -> Result<ProofbookRunLedger, ProofbookError> {
        if let Some(ledger) = self
            .runs
            .lock()
            .map_err(|_| {
                ProofbookError::new(
                    ProofbookErrorCode::IoError,
                    "proofbook runner lock poisoned",
                )
            })?
            .get(run_id)
            .cloned()
        {
            return Ok(ledger);
        }
        let path = ledger::ledger_path(root, run_id);
        if !path.exists() {
            return Err(ProofbookError::new(
                ProofbookErrorCode::RunNotFound,
                format!("Proofbook run not found: {run_id}"),
            ));
        }
        let ledger = ledger::read_ledger(&path)?;
        self.remember(ledger.clone())?;
        Ok(ledger)
    }
}

fn resolve_proofbook_path(root: &Path, raw_path: &str) -> Result<String, ProofbookError> {
    let raw = Path::new(raw_path);
    let candidate = if raw.is_absolute() {
        raw.to_path_buf()
    } else {
        root.join(raw)
    };
    let path = crate::proofbook::validator::ensure_path_under_root(
        root,
        &candidate.to_string_lossy(),
        "proofbookPath",
    )?;
    Ok(ledger::normalize_path(path))
}

fn validation_failed(errors: Vec<ProofbookError>) -> ProofbookError {
    let message = errors
        .first()
        .map(|error| format!("proofbook validation failed: {}", error.message))
        .unwrap_or_else(|| "proofbook validation failed".to_string());
    ProofbookError::new(ProofbookErrorCode::ValidationFailed, message)
}

fn dependencies_passed(ledger: &ProofbookRunLedger, step: &ProofbookStep) -> bool {
    step.depends_on.iter().all(|dependency| {
        ledger
            .step(dependency)
            .map(|summary| summary.status == ProofbookStepStatus::Passed)
            .unwrap_or(false)
    })
}

fn waiting_gate_for(ledger: &ProofbookRunLedger, gate_id: &str) -> Option<(String, String)> {
    for step in &ledger.steps {
        if step.status != ProofbookStepStatus::WaitingGate {
            continue;
        }
        let output = step.structured_output.as_ref()?;
        if output.get("gateId").and_then(|v| v.as_str()) == Some(gate_id) {
            let kind = output
                .get("kind")
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string();
            return Some((step.step_id.clone(), kind));
        }
    }
    None
}

fn gate_hash_for(ledger: &ProofbookRunLedger, gate_id: &str) -> Option<String> {
    ledger.steps.iter().find_map(|step| {
        let output = step.structured_output.as_ref()?;
        if output.get("gateId").and_then(|v| v.as_str()) == Some(gate_id) {
            output
                .get("gateHash")
                .and_then(|v| v.as_str())
                .map(str::to_string)
        } else {
            None
        }
    })
}

fn apply_gate_decision(
    ledger: &mut ProofbookRunLedger,
    step_id: &str,
    decision: ProofbookGateDecision,
    normalized_decision: &str,
) {
    let passed = normalized_decision == "approve" || normalized_decision == "approved";
    if let Some(step) = ledger.step_mut(step_id) {
        step.status = if passed {
            ProofbookStepStatus::Passed
        } else {
            ProofbookStepStatus::Failed
        };
        step.completed_at = Some(ledger::now_timestamp());
        step.gate_decision = Some(decision.clone());
        if !passed {
            step.error = Some(ProofbookRunError::new(
                "manual_gate_rejected",
                "manual Proofbook gate was rejected",
            ));
        }
    }
    ledger.decisions.push(decision.clone());
    if !passed {
        ledger.residual_blockers.push(ProofbookResidualBlocker {
            code: "manual_gate_rejected".to_string(),
            step_id: Some(step_id.to_string()),
            message: "manual Proofbook gate was rejected".to_string(),
        });
    }
    ledger.append_event(
        "manual_gate_decided",
        Some(step_id.to_string()),
        format!("Proofbook manual gate decided: {normalized_decision}"),
        Some(if passed { "passed" } else { "failed" }.to_string()),
        if passed {
            None
        } else {
            Some(ProofbookRunError::new(
                "manual_gate_rejected",
                "manual Proofbook gate was rejected",
            ))
        },
    );
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn write_proofbook(project: &Path, yaml: &str) -> String {
        let dir = project.join(".aelyris").join("proofbooks");
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("test.proofbook.yaml");
        fs::write(&path, yaml).unwrap();
        path.to_string_lossy().to_string()
    }

    fn project_path(project: &tempfile::TempDir) -> String {
        project.path().to_string_lossy().to_string()
    }

    #[test]
    fn proofbook_runner_writes_ledger_before_shell_execution_and_passes() {
        let project = tempfile::tempdir().unwrap();
        let proofbook = write_proofbook(
            project.path(),
            r#"
schema: aelyris.proofbook.v1
id: pb2-smoke
steps:
  - id: echo
    type: shell
    command: echo proofbook
settlement:
  requiredSteps: [echo]
"#,
        );
        let runner = ProofbookRunner::new();

        let ledger = runner
            .start_run(&project_path(&project), &proofbook, json!({}))
            .unwrap();

        assert_eq!(ledger.status, ProofbookRunStatus::Passed);
        assert!(ledger::ledger_path(project.path(), &ledger.run_id).exists());
        assert_eq!(ledger.steps[0].status, ProofbookStepStatus::Passed);
        assert!(ledger
            .artifacts
            .iter()
            .any(|artifact| artifact.kind == "stdout"));
        assert!(ledger
            .events
            .iter()
            .any(|event| event.kind == "run_created"));
    }

    #[test]
    fn proofbook_runner_gates_review_command_before_spawn() {
        let project = tempfile::tempdir().unwrap();
        let proofbook = write_proofbook(
            project.path(),
            r#"
schema: aelyris.proofbook.v1
id: pb2-gated
steps:
  - id: commit
    type: shell
    command: git commit -m proofbook
settlement:
  requiredSteps: [commit]
"#,
        );
        let runner = ProofbookRunner::new();

        let ledger = runner
            .start_run(&project_path(&project), &proofbook, json!({}))
            .unwrap();

        assert_eq!(ledger.status, ProofbookRunStatus::WaitingGate);
        assert_eq!(ledger.steps[0].status, ProofbookStepStatus::WaitingGate);
        let gate = ledger.steps[0].structured_output.as_ref().unwrap();
        assert_eq!(gate["kind"], "commandRisk");
    }

    #[test]
    fn proofbook_runner_resolves_manual_gate_and_continues() {
        let project = tempfile::tempdir().unwrap();
        let proofbook = write_proofbook(
            project.path(),
            r#"
schema: aelyris.proofbook.v1
id: pb2-manual
steps:
  - id: approve
    type: manualGate
    gateId: release-check
    options: [approve, reject]
    default: reject
    risk: medium
  - id: echo
    type: shell
    command: echo after-gate
    dependsOn: [approve]
settlement:
  requiredSteps: [approve, echo]
"#,
        );
        let runner = ProofbookRunner::new();
        let waiting = runner
            .start_run(&project_path(&project), &proofbook, json!({}))
            .unwrap();
        let gate = waiting.steps[0].structured_output.as_ref().unwrap();

        let done = runner
            .resolve_manual_gate(
                &project_path(&project),
                &waiting.run_id,
                "release-check".to_string(),
                gate["gateHash"].as_str().unwrap().to_string(),
                "approve".to_string(),
                Some("tester".to_string()),
                Some("ok".to_string()),
            )
            .unwrap();

        assert_eq!(done.status, ProofbookRunStatus::Passed);
        assert_eq!(done.decisions.len(), 1);
        assert_eq!(done.steps[1].status, ProofbookStepStatus::Passed);
    }

    #[test]
    fn proofbook_runner_fails_closed_when_definition_changes_after_gate() {
        let project = tempfile::tempdir().unwrap();
        let proofbook = write_proofbook(
            project.path(),
            r#"
schema: aelyris.proofbook.v1
id: pb2-manual-drift
steps:
  - id: approve
    type: manualGate
    gateId: release-check
  - id: echo
    type: shell
    command: echo original
    dependsOn: [approve]
settlement:
  requiredSteps: [approve, echo]
"#,
        );
        let runner = ProofbookRunner::new();
        let waiting = runner
            .start_run(&project_path(&project), &proofbook, json!({}))
            .unwrap();
        let gate = waiting.steps[0].structured_output.as_ref().unwrap();

        fs::write(
            &proofbook,
            r#"
schema: aelyris.proofbook.v1
id: pb2-manual-drift
steps:
  - id: approve
    type: manualGate
    gateId: release-check
  - id: echo
    type: shell
    command: echo changed
    dependsOn: [approve]
settlement:
  requiredSteps: [approve, echo]
"#,
        )
        .unwrap();

        let done = runner
            .resolve_manual_gate(
                &project_path(&project),
                &waiting.run_id,
                "release-check".to_string(),
                gate["gateHash"].as_str().unwrap().to_string(),
                "approve".to_string(),
                Some("tester".to_string()),
                Some("ok".to_string()),
            )
            .unwrap();

        assert_eq!(done.status, ProofbookRunStatus::Failed);
        assert_eq!(done.steps[1].status, ProofbookStepStatus::Pending);
        assert!(done
            .residual_blockers
            .iter()
            .any(|blocker| blocker.code == "definition_changed_after_gate"));
    }
    #[test]
    fn proofbook_runner_wait_for_file_passes_without_busy_looping() {
        let project = tempfile::tempdir().unwrap();
        fs::write(project.path().join("ready.txt"), "ok").unwrap();
        let proofbook = write_proofbook(
            project.path(),
            r#"
schema: aelyris.proofbook.v1
id: pb2-wait
steps:
  - id: wait
    type: waitFor
    path: ready.txt
    intervalMs: 10
    timeoutMs: 100
settlement:
  requiredSteps: [wait]
"#,
        );
        let runner = ProofbookRunner::new();

        let ledger = runner
            .start_run(&project_path(&project), &proofbook, json!({}))
            .unwrap();

        assert_eq!(ledger.status, ProofbookRunStatus::Passed);
        assert_eq!(ledger.steps[0].status, ProofbookStepStatus::Passed);
    }

    #[test]
    fn proofbook_runner_marks_future_step_kinds_not_implemented() {
        let project = tempfile::tempdir().unwrap();
        let proofbook = write_proofbook(
            project.path(),
            r#"
schema: aelyris.proofbook.v1
id: pb2-future
steps:
  - id: mcp
    type: mcpTool
settlement:
  requiredSteps: [mcp]
"#,
        );
        let runner = ProofbookRunner::new();

        let ledger = runner
            .start_run(&project_path(&project), &proofbook, json!({}))
            .unwrap();

        assert_eq!(ledger.status, ProofbookRunStatus::Failed);
        assert_eq!(ledger.steps[0].status, ProofbookStepStatus::Blocked);
        assert_eq!(
            ledger.steps[0].error.as_ref().unwrap().code,
            "not_implemented"
        );
    }

    #[test]
    fn proofbook_runner_hydrates_running_steps_fail_closed() {
        let project = tempfile::tempdir().unwrap();
        let proofbook = write_proofbook(
            project.path(),
            r#"
schema: aelyris.proofbook.v1
id: pb2-hydrate
steps:
  - id: echo
    type: shell
    command: echo proofbook
settlement:
  requiredSteps: [echo]
"#,
        );
        let definition = parse_proofbook(&proofbook).unwrap();
        let mut ledger =
            ledger::new_run_ledger(project.path(), &proofbook, &definition, &json!({})).unwrap();
        ledger.status = ProofbookRunStatus::Running;
        ledger.steps[0].status = ProofbookStepStatus::Running;
        ledger::write_ledger(project.path(), &ledger).unwrap();

        let runner = ProofbookRunner::new();
        assert_eq!(runner.restore_project(&project_path(&project)).unwrap(), 1);
        let restored = runner
            .status(&project_path(&project), &ledger.run_id)
            .unwrap();

        assert_eq!(restored.status, ProofbookRunStatus::Failed);
        assert_eq!(
            restored.steps[0].error.as_ref().unwrap().code,
            "interrupted_by_restart"
        );
    }
}
