use crate::proofbook::{self, ProofbookError, ProofbookErrorCode, ProofbookRunLedger};
use serde::Serialize;
use tauri::{AppHandle, Manager};

use super::commands::record_audit_event;
use super::proofbook_commands::{emit_proofbook_update, require_proofbook_effect_admitted};

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProofbookAgentSessionArtifactEvidence {
    pub path: String,
    pub present: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProofbookAgentSessionSettlementCandidate {
    pub run_id: String,
    pub ledger_revision: u64,
    pub step_id: String,
    pub session_id: String,
    pub pane_id: Option<String>,
    pub pty_id: Option<String>,
    pub worktree_path: Option<String>,
    pub runtime_status: Option<String>,
    pub eligible: bool,
    pub resulting_status: Option<String>,
    pub proof_kind: Option<String>,
    pub done_signal: Option<String>,
    pub proof_sources: Vec<String>,
    pub expected_artifacts: Vec<ProofbookAgentSessionArtifactEvidence>,
    pub blockers: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct RuntimeSettlementEvidence {
    runtime_status: Option<String>,
    identity_blockers: Vec<String>,
}

#[tauri::command]
pub fn proofbook_agent_session_settlement_candidate(
    app: AppHandle,
    project_path: String,
    run_id: String,
    step_id: String,
    expected_revision: u64,
) -> Result<ProofbookAgentSessionSettlementCandidate, ProofbookError> {
    let context = app
        .state::<proofbook::ProofbookRunner>()
        .agent_session_settlement_context(&project_path, &run_id, &step_id, expected_revision)?;
    let runtime = runtime_settlement_evidence(&app, &context)?;
    Ok(derive_agent_session_settlement_candidate(&context, runtime))
}

#[tauri::command]
pub fn settle_current_proofbook_agent_session(
    app: AppHandle,
    project_path: String,
    run_id: String,
    step_id: String,
    expected_revision: u64,
    expected_session_id: String,
) -> Result<ProofbookRunLedger, ProofbookError> {
    require_proofbook_effect_admitted(
        app.state::<std::sync::Arc<crate::startup_reconciliation::StartupReconciliationState>>()
            .inner(),
        "Proofbook runtime-owned agent-session settlement",
    )?;
    let runner = app.state::<proofbook::ProofbookRunner>();
    let context = runner.agent_session_settlement_context(
        &project_path,
        &run_id,
        &step_id,
        expected_revision,
    )?;
    if context.session_id != expected_session_id {
        return Err(ProofbookError::new(
            ProofbookErrorCode::ValidationFailed,
            "Proofbook agentSession runtime identity changed; refresh completion evidence",
        )
        .with_step(step_id));
    }
    let candidate = derive_agent_session_settlement_candidate(
        &context,
        runtime_settlement_evidence(&app, &context)?,
    );
    let proof = completion_proof_from_candidate(&candidate)?;
    let ledger = runner.settle_agent_session_if_current(
        &project_path,
        &run_id,
        &step_id,
        expected_revision,
        &expected_session_id,
        proof,
    )?;
    record_audit_event(
        &app,
        "proofbook",
        "runtime_owned_agent_session_settled",
        "info",
        Some("proofbook"),
        Some(&run_id),
        "Proofbook agentSession settled from current Aelyris-owned runtime evidence",
        serde_json::json!({
            "projectPath": project_path,
            "stepId": step_id,
            "sessionId": expected_session_id,
            "expectedRevision": expected_revision,
            "runtimeStatus": candidate.runtime_status,
            "proofKind": candidate.proof_kind,
            "proofSources": candidate.proof_sources,
            "expectedArtifactCount": candidate.expected_artifacts.len(),
            "freeFormProofAccepted": false,
            "status": ledger.status,
        }),
    );
    emit_proofbook_update(&app, &ledger);
    Ok(ledger)
}

fn runtime_settlement_evidence(
    app: &AppHandle,
    context: &proofbook::ProofbookAgentSessionSettlementContext,
) -> Result<RuntimeSettlementEvidence, ProofbookError> {
    let mut identity_blockers = Vec::new();
    if context.visible {
        let session = app
            .state::<crate::agent::InteractiveSessionManager>()
            .get(&context.session_id)
            .map_err(|message| {
                ProofbookError::new(ProofbookErrorCode::ValidationFailed, message)
                    .with_step(context.step_id.clone())
            })?;
        let Some(session) = session else {
            return Ok(RuntimeSettlementEvidence {
                runtime_status: None,
                identity_blockers: vec!["runtime_session_missing".to_string()],
            });
        };
        if context.pty_id.as_deref() != Some(session.pty_id.as_str()) {
            identity_blockers.push("runtime_pty_identity_changed".to_string());
        }
        if context.backend != session.backend {
            identity_blockers.push("runtime_backend_identity_changed".to_string());
        }
        let expected_scope = context
            .worktree_path
            .as_deref()
            .unwrap_or(context.repo_path.as_str());
        let actual_scope = session
            .worktree_path
            .as_deref()
            .or(session.repo_path.as_deref())
            .unwrap_or(session.cwd.as_str());
        if !same_runtime_path(expected_scope, actual_scope) {
            identity_blockers.push("runtime_workspace_identity_changed".to_string());
        }
        return Ok(RuntimeSettlementEvidence {
            runtime_status: Some(session.status),
            identity_blockers,
        });
    }

    let session = app
        .state::<crate::agent::AgentManager>()
        .list_sessions()
        .into_iter()
        .find(|session| session.id == context.session_id);
    let Some(session) = session else {
        return Ok(RuntimeSettlementEvidence {
            runtime_status: None,
            identity_blockers: vec!["runtime_session_missing".to_string()],
        });
    };
    if context.backend != "headless" {
        identity_blockers.push("runtime_backend_identity_changed".to_string());
    }
    let expected_scope = context
        .worktree_path
        .as_deref()
        .unwrap_or(context.repo_path.as_str());
    if !same_runtime_path(expected_scope, &session.cwd) {
        identity_blockers.push("runtime_workspace_identity_changed".to_string());
    }
    Ok(RuntimeSettlementEvidence {
        runtime_status: Some(session.status),
        identity_blockers,
    })
}

fn derive_agent_session_settlement_candidate(
    context: &proofbook::ProofbookAgentSessionSettlementContext,
    runtime: RuntimeSettlementEvidence,
) -> ProofbookAgentSessionSettlementCandidate {
    let expected_artifacts = context
        .expected_artifacts
        .iter()
        .map(|artifact| ProofbookAgentSessionArtifactEvidence {
            path: artifact.path.clone(),
            present: artifact.present,
        })
        .collect::<Vec<_>>();
    let mut blockers = runtime.identity_blockers;
    let mut eligible = false;
    let mut resulting_status = None;
    let mut proof_kind = None;
    let mut done_signal = None;
    let mut proof_sources = Vec::new();

    match runtime.runtime_status.as_deref() {
        Some("done") if blockers.is_empty() => {
            let missing_artifacts = expected_artifacts
                .iter()
                .filter(|artifact| !artifact.present)
                .count();
            if missing_artifacts > 0 {
                blockers.push(format!("expected_artifacts_missing:{missing_artifacts}"));
            } else {
                eligible = true;
                resulting_status = Some("passed".to_string());
                done_signal = Some(format!(
                    "aelyris.runtime.session:{}:done",
                    context.session_id
                ));
                proof_sources.push("runtimeSessionStatus".to_string());
                if expected_artifacts.is_empty() {
                    proof_kind = Some("runtimeSessionStatus".to_string());
                } else {
                    proof_kind = Some("requiredArtifactSettlement".to_string());
                    proof_sources.push("requiredArtifactSettlement".to_string());
                }
            }
        }
        Some("failed" | "error") if blockers.is_empty() => {
            eligible = true;
            resulting_status = Some("failed".to_string());
            proof_kind = Some("runtimeSessionStatus".to_string());
            proof_sources.push("runtimeSessionStatus".to_string());
        }
        Some("blocked") if blockers.is_empty() => {
            eligible = true;
            resulting_status = Some("blocked".to_string());
            proof_kind = Some("runtimeSessionStatus".to_string());
            proof_sources.push("runtimeSessionStatus".to_string());
        }
        Some(status) if blockers.is_empty() => {
            blockers.push(format!("runtime_session_not_terminal:{status}"));
        }
        None if blockers.is_empty() => blockers.push("runtime_session_missing".to_string()),
        _ => {}
    }

    ProofbookAgentSessionSettlementCandidate {
        run_id: context.run_id.clone(),
        ledger_revision: context.ledger_revision,
        step_id: context.step_id.clone(),
        session_id: context.session_id.clone(),
        pane_id: context.pane_id.clone(),
        pty_id: context.pty_id.clone(),
        worktree_path: context.worktree_path.clone(),
        runtime_status: runtime.runtime_status,
        eligible,
        resulting_status,
        proof_kind,
        done_signal,
        proof_sources,
        expected_artifacts,
        blockers,
    }
}

fn completion_proof_from_candidate(
    candidate: &ProofbookAgentSessionSettlementCandidate,
) -> Result<proofbook::ProofbookAgentSessionCompletionProof, ProofbookError> {
    if !candidate.eligible {
        return Err(ProofbookError::new(
            ProofbookErrorCode::ValidationFailed,
            format!(
                "Proofbook agentSession runtime evidence is not settlement-ready: {}",
                candidate.blockers.join(", ")
            ),
        )
        .with_step(candidate.step_id.clone()));
    }
    let resulting_status = candidate.resulting_status.as_deref().ok_or_else(|| {
        ProofbookError::new(
            ProofbookErrorCode::ValidationFailed,
            "Proofbook agentSession settlement candidate has no resulting status",
        )
        .with_step(candidate.step_id.clone())
    })?;
    let (blocker_code, blocker_message) = match resulting_status {
        "failed" => (
            Some("agent_session_runtime_failed".to_string()),
            Some("Aelyris runtime session reported failure".to_string()),
        ),
        "blocked" => (
            Some("agent_session_runtime_blocked".to_string()),
            Some("Aelyris runtime session is blocked".to_string()),
        ),
        _ => (None, None),
    };
    Ok(proofbook::ProofbookAgentSessionCompletionProof {
        status: resulting_status.to_string(),
        proof_kind: candidate
            .proof_kind
            .clone()
            .unwrap_or_else(|| "runtimeSessionStatus".to_string()),
        done_signal: candidate.done_signal.clone(),
        final_report_path: None,
        artifact_paths: Vec::new(),
        reviewer_batch_id: None,
        blocker_code,
        blocker_message,
        summary: None,
    })
}

fn same_runtime_path(left: &str, right: &str) -> bool {
    normalize_runtime_path(left) == normalize_runtime_path(right)
}

fn normalize_runtime_path(path: &str) -> String {
    path.replace('\\', "/")
        .trim_end_matches('/')
        .to_ascii_lowercase()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn settlement_context(
        expected_artifacts: Vec<proofbook::ProofbookAgentSessionExpectedArtifact>,
    ) -> proofbook::ProofbookAgentSessionSettlementContext {
        proofbook::ProofbookAgentSessionSettlementContext {
            run_id: "run-1".to_string(),
            ledger_revision: 7,
            step_id: "agent".to_string(),
            session_id: "session-1".to_string(),
            pane_id: Some("pane-1".to_string()),
            pty_id: Some("pty-1".to_string()),
            backend: "native".to_string(),
            visible: true,
            repo_path: "C:/repo".to_string(),
            worktree_path: Some("C:/repo/.worktrees/agent".to_string()),
            worktree_branch: Some("proofbook-agent".to_string()),
            expected_artifacts,
        }
    }

    #[test]
    fn runtime_owned_candidate_requires_terminal_identity_and_expected_artifacts() {
        let ready = derive_agent_session_settlement_candidate(
            &settlement_context(vec![proofbook::ProofbookAgentSessionExpectedArtifact {
                path: ".aelyris/proofbooks/summary.md".to_string(),
                present: true,
            }]),
            RuntimeSettlementEvidence {
                runtime_status: Some("done".to_string()),
                identity_blockers: Vec::new(),
            },
        );
        assert!(ready.eligible);
        assert_eq!(ready.resulting_status.as_deref(), Some("passed"));
        assert_eq!(
            ready.proof_kind.as_deref(),
            Some("requiredArtifactSettlement")
        );
        assert_eq!(
            ready.done_signal.as_deref(),
            Some("aelyris.runtime.session:session-1:done")
        );
        assert_eq!(
            completion_proof_from_candidate(&ready)
                .unwrap()
                .artifact_paths,
            Vec::<String>::new()
        );

        let missing = derive_agent_session_settlement_candidate(
            &settlement_context(vec![proofbook::ProofbookAgentSessionExpectedArtifact {
                path: ".aelyris/proofbooks/summary.md".to_string(),
                present: false,
            }]),
            RuntimeSettlementEvidence {
                runtime_status: Some("done".to_string()),
                identity_blockers: Vec::new(),
            },
        );
        assert!(!missing.eligible);
        assert_eq!(missing.blockers, ["expected_artifacts_missing:1"]);
        assert!(completion_proof_from_candidate(&missing).is_err());

        let active = derive_agent_session_settlement_candidate(
            &settlement_context(Vec::new()),
            RuntimeSettlementEvidence {
                runtime_status: Some("coding".to_string()),
                identity_blockers: Vec::new(),
            },
        );
        assert!(!active.eligible);
        assert_eq!(active.blockers, ["runtime_session_not_terminal:coding"]);

        let replaced = derive_agent_session_settlement_candidate(
            &settlement_context(Vec::new()),
            RuntimeSettlementEvidence {
                runtime_status: Some("done".to_string()),
                identity_blockers: vec!["runtime_pty_identity_changed".to_string()],
            },
        );
        assert!(!replaced.eligible);
        assert_eq!(replaced.blockers, ["runtime_pty_identity_changed"]);
    }

    #[test]
    fn runtime_failure_and_blocker_candidates_are_backend_generated() {
        for (runtime_status, resulting_status, code) in [
            ("failed", "failed", "agent_session_runtime_failed"),
            ("error", "failed", "agent_session_runtime_failed"),
            ("blocked", "blocked", "agent_session_runtime_blocked"),
        ] {
            let candidate = derive_agent_session_settlement_candidate(
                &settlement_context(Vec::new()),
                RuntimeSettlementEvidence {
                    runtime_status: Some(runtime_status.to_string()),
                    identity_blockers: Vec::new(),
                },
            );
            assert!(candidate.eligible);
            assert_eq!(
                candidate.resulting_status.as_deref(),
                Some(resulting_status)
            );
            let proof = completion_proof_from_candidate(&candidate).unwrap();
            assert_eq!(proof.status, resulting_status);
            assert_eq!(proof.blocker_code.as_deref(), Some(code));
            assert!(proof.summary.is_none());
            assert!(proof.artifact_paths.is_empty());
        }
    }

    #[test]
    fn runtime_path_identity_is_windows_separator_and_case_stable() {
        assert!(same_runtime_path(
            "C:\\Repo\\.worktrees\\Agent\\",
            "c:/repo/.worktrees/agent"
        ));
        assert!(!same_runtime_path("C:/repo/a", "C:/repo/b"));
    }

    #[test]
    fn candidate_wire_contract_is_camel_case_and_has_no_free_form_proof_fields() {
        let candidate = derive_agent_session_settlement_candidate(
            &settlement_context(Vec::new()),
            RuntimeSettlementEvidence {
                runtime_status: Some("done".to_string()),
                identity_blockers: Vec::new(),
            },
        );
        let value = serde_json::to_value(candidate).unwrap();

        assert_eq!(value["runId"], "run-1");
        assert_eq!(value["ledgerRevision"], 7);
        assert_eq!(value["sessionId"], "session-1");
        assert_eq!(value["runtimeStatus"], "done");
        assert_eq!(value["resultingStatus"], "passed");
        for forbidden in [
            "completionProof",
            "comment",
            "summary",
            "finalReportContent",
            "commandOutput",
            "reviewerPayload",
        ] {
            assert!(
                value.get(forbidden).is_none(),
                "unexpected field: {forbidden}"
            );
        }
    }
}
