use crate::proofbook::{
    self, ProofbookError, ProofbookErrorCode, ProofbookRunLedger, ProofbookSummary,
    ProofbookValidationReport,
};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter, Manager};

use super::commands::record_audit_event;

#[tauri::command]
pub fn list_proofbooks(project_path: String) -> Vec<ProofbookSummary> {
    proofbook::list_proofbook_files(&project_path)
}

#[tauri::command]
pub fn validate_proofbook(
    project_path: String,
    proofbook_path: String,
) -> Result<ProofbookValidationReport, ProofbookError> {
    let root = proofbook::validator::canonical_project_root(&project_path)?;
    let proofbook_path = resolve_candidate_path(&root, &proofbook_path)?;

    match proofbook::parse_proofbook(&proofbook_path) {
        Ok(definition) => Ok(proofbook::validate_definition(
            &project_path,
            &definition,
            &proofbook_path,
        )),
        Err(error) => Ok(ProofbookValidationReport {
            definition_id: None,
            path: proofbook_path,
            valid: false,
            errors: vec![error],
        }),
    }
}

#[tauri::command]
pub fn start_proofbook_run(
    app: AppHandle,
    project_path: String,
    proofbook_path: String,
    inputs: Option<serde_json::Value>,
) -> Result<ProofbookRunLedger, ProofbookError> {
    let runner = app.state::<proofbook::ProofbookRunner>();
    let executor = IpcProofbookAgentExecutor { app: app.clone() };
    let ledger = runner.start_run_with_agent_executor(
        &project_path,
        &proofbook_path,
        inputs.unwrap_or_else(|| serde_json::json!({})),
        &executor,
    )?;
    record_audit_event(
        &app,
        "proofbook",
        "run_started",
        "info",
        Some("proofbook"),
        Some(&ledger.run_id),
        "Proofbook run started",
        serde_json::json!({
            "projectPath": project_path,
            "proofbookPath": proofbook_path,
            "status": ledger.status,
        }),
    );
    emit_proofbook_update(&app, &ledger);
    Ok(ledger)
}

#[tauri::command]
pub fn proofbook_run_status(
    app: AppHandle,
    project_path: String,
    run_id: String,
) -> Result<ProofbookRunLedger, ProofbookError> {
    app.state::<proofbook::ProofbookRunner>()
        .status(&project_path, &run_id)
}

#[tauri::command]
pub fn list_proofbook_runs(
    app: AppHandle,
    project_path: String,
) -> Result<Vec<ProofbookRunLedger>, ProofbookError> {
    app.state::<proofbook::ProofbookRunner>()
        .list_runs(&project_path)
}

#[tauri::command]
pub fn cancel_proofbook_run(
    app: AppHandle,
    project_path: String,
    run_id: String,
) -> Result<ProofbookRunLedger, ProofbookError> {
    let ledger = app
        .state::<proofbook::ProofbookRunner>()
        .cancel_run(&project_path, &run_id)?;
    record_audit_event(
        &app,
        "proofbook",
        "run_cancelled",
        "warn",
        Some("proofbook"),
        Some(&run_id),
        "Proofbook run cancelled",
        serde_json::json!({ "projectPath": project_path }),
    );
    emit_proofbook_update(&app, &ledger);
    Ok(ledger)
}

#[tauri::command]
pub fn resolve_proofbook_manual_gate(
    app: AppHandle,
    project_path: String,
    run_id: String,
    gate_id: String,
    gate_hash: String,
    decision: String,
    actor: Option<String>,
    comment: Option<String>,
) -> Result<ProofbookRunLedger, ProofbookError> {
    let ledger = app
        .state::<proofbook::ProofbookRunner>()
        .resolve_manual_gate(
            &project_path,
            &run_id,
            gate_id.clone(),
            gate_hash,
            decision.clone(),
            actor.clone(),
            comment.clone(),
        )?;
    record_audit_event(
        &app,
        "proofbook",
        "manual_gate_decided",
        "info",
        Some("proofbook"),
        Some(&run_id),
        "Proofbook manual gate decided",
        serde_json::json!({
            "gateId": gate_id,
            "decision": decision,
            "actor": actor,
            "comment": comment,
            "status": ledger.status,
        }),
    );
    emit_proofbook_update(&app, &ledger);
    Ok(ledger)
}

struct IpcProofbookAgentExecutor {
    app: AppHandle,
}

impl proofbook::ProofbookAgentSessionExecutor for IpcProofbookAgentExecutor {
    fn start_agent_session(
        &self,
        _run_id: &str,
        _ledger: &ProofbookRunLedger,
        _step: &proofbook::ProofbookStep,
        request: &proofbook::ProofbookAgentSessionRequest,
    ) -> Result<proofbook::ProofbookAgentSessionSpawn, ProofbookError> {
        if request.visible {
            let cwd = request
                .worktree_path
                .clone()
                .unwrap_or_else(|| request.repo_path.clone());
            let branch = if request.worktree_path.is_some() {
                None
            } else {
                request.worktree_branch.clone()
            };
            let result = tauri::async_runtime::block_on(crate::ipc::spawn_interactive_agent(
                self.app.clone(),
                cwd,
                Some(request.model.clone()),
                Some(request.task.clone()),
                branch,
                request.cols,
                request.rows,
            ))
            .map_err(|message| {
                ProofbookError::new(ProofbookErrorCode::ValidationFailed, message)
                    .with_field("agentSession")
            })?;
            return Ok(proofbook::ProofbookAgentSessionSpawn {
                session_id: result.session_id,
                pane_id: Some(result.pty_id.clone()),
                pty_id: Some(result.pty_id),
                backend: result.backend,
                provider: request.provider.clone(),
                model: request.model.clone(),
                repo_path: request.repo_path.clone(),
                worktree_path: request.worktree_path.clone().or(result.worktree_path),
                worktree_branch: request.worktree_branch.clone(),
                visible: true,
            });
        }

        let manager = self.app.state::<crate::agent::AgentManager>();
        let cwd = request
            .worktree_path
            .clone()
            .unwrap_or_else(|| request.repo_path.clone());
        let session_id = crate::control::agent::start_headless(
            &manager,
            crate::control::agent::HeadlessSpawnSpec {
                prompt: request.task.clone(),
                cwd,
                model: Some(request.model.clone()),
                allowed_tools: None,
                resume_id: None,
            },
        )
        .map_err(|message| {
            ProofbookError::new(ProofbookErrorCode::ValidationFailed, message)
                .with_field("agentSession")
        })?;
        Ok(proofbook::ProofbookAgentSessionSpawn {
            session_id,
            pane_id: None,
            pty_id: None,
            backend: "headless".to_string(),
            provider: request.provider.clone(),
            model: request.model.clone(),
            repo_path: request.repo_path.clone(),
            worktree_path: request.worktree_path.clone(),
            worktree_branch: request.worktree_branch.clone(),
            visible: false,
        })
    }
}

fn emit_proofbook_update(app: &AppHandle, ledger: &ProofbookRunLedger) {
    let _ = app.emit("proofbook-updated", ledger);
}

fn resolve_candidate_path(root: &Path, raw_path: &str) -> Result<String, ProofbookError> {
    let raw = Path::new(raw_path);
    let candidate = if raw.is_absolute() {
        raw.to_path_buf()
    } else {
        root.join(raw)
    };
    proofbook::validator::ensure_path_under_root(root, &candidate.to_string_lossy(), "path")?;
    Ok(normalize_path(&candidate))
}

fn normalize_path(path: &PathBuf) -> String {
    path.to_string_lossy().replace('\\', "/")
}

#[allow(dead_code)]
fn proofbook_runtime_not_available(operation: &str) -> Result<(), ProofbookError> {
    Err(ProofbookError::runtime_not_available(operation))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn write_project_proofbook(project: &Path, yaml: &str) -> String {
        let dir = project.join(".aelyris").join("proofbooks");
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("release.proofbook.yaml");
        fs::write(&path, yaml).unwrap();
        path.to_string_lossy().to_string()
    }

    #[test]
    fn proofbook_ipc_validate_returns_structured_report() {
        let temp = tempfile::tempdir().unwrap();
        let path = write_project_proofbook(
            temp.path(),
            r#"
schema: aelyris.proofbook.v1
id: release-closeout
steps:
  - id: status
    type: shell
settlement:
  requiredSteps: [status]
"#,
        );

        let report = validate_proofbook(temp.path().to_string_lossy().to_string(), path).unwrap();

        assert!(report.valid, "{:?}", report.errors);
        assert_eq!(report.definition_id.as_deref(), Some("release-closeout"));
    }

    #[test]
    fn proofbook_ipc_validate_folds_parse_errors_into_report() {
        let temp = tempfile::tempdir().unwrap();
        let path = write_project_proofbook(temp.path(), "schema: [");

        let report = validate_proofbook(temp.path().to_string_lossy().to_string(), path).unwrap();

        assert!(!report.valid);
        assert_eq!(report.errors[0].code, ProofbookErrorCode::YamlParseError);
    }

    #[test]
    fn proofbook_ipc_validate_rejects_path_escape_as_caller_error() {
        let temp = tempfile::tempdir().unwrap();
        let outside = tempfile::NamedTempFile::new().unwrap();

        let error = validate_proofbook(
            temp.path().to_string_lossy().to_string(),
            outside.path().to_string_lossy().to_string(),
        )
        .unwrap_err();

        assert_eq!(error.code, ProofbookErrorCode::PathOutsideProject);
    }

    #[test]
    fn proofbook_ipc_runtime_boundary_is_fail_closed() {
        let error = proofbook_runtime_not_available("run").unwrap_err();

        assert_eq!(error.code, ProofbookErrorCode::RuntimeNotAvailable);
        assert_eq!(
            serde_json::to_value(&error).unwrap()["code"],
            "runtime_not_available"
        );
    }
}
