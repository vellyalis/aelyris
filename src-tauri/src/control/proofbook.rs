use serde::Serialize;

use crate::agent::{AgentManager, InteractiveSessionManager};
use crate::proofbook::{self, ProofbookError, ProofbookErrorCode, ProofbookRunLedger};

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

#[derive(Debug, Clone)]
pub struct ProofbookAgentSessionSettlementOutcome {
    pub ledger: ProofbookRunLedger,
    pub candidate: ProofbookAgentSessionSettlementCandidate,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct RuntimeSettlementEvidence {
    runtime_status: Option<String>,
    identity_blockers: Vec<String>,
}

pub fn agent_session_settlement_candidate(
    runner: &proofbook::ProofbookRunner,
    interactive_sessions: Option<&InteractiveSessionManager>,
    agent_manager: Option<&AgentManager>,
    project_path: &str,
    run_id: &str,
    step_id: &str,
    expected_revision: u64,
) -> Result<ProofbookAgentSessionSettlementCandidate, ProofbookError> {
    let context = runner.agent_session_settlement_context(
        project_path,
        run_id,
        step_id,
        expected_revision,
    )?;
    let runtime = runtime_settlement_evidence(interactive_sessions, agent_manager, &context)?;
    Ok(derive_agent_session_settlement_candidate(&context, runtime))
}

pub fn settle_current_agent_session(
    runner: &proofbook::ProofbookRunner,
    interactive_sessions: Option<&InteractiveSessionManager>,
    agent_manager: Option<&AgentManager>,
    project_path: &str,
    run_id: &str,
    step_id: &str,
    expected_revision: u64,
    expected_session_id: &str,
) -> Result<ProofbookAgentSessionSettlementOutcome, ProofbookError> {
    let context = runner.agent_session_settlement_context(
        project_path,
        run_id,
        step_id,
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
        runtime_settlement_evidence(interactive_sessions, agent_manager, &context)?,
    );
    let proof = completion_proof_from_candidate(&candidate)?;
    let ledger = runner.settle_agent_session_if_current(
        project_path,
        run_id,
        step_id,
        expected_revision,
        expected_session_id,
        proof,
    )?;
    Ok(ProofbookAgentSessionSettlementOutcome { ledger, candidate })
}

fn runtime_settlement_evidence(
    interactive_sessions: Option<&InteractiveSessionManager>,
    agent_manager: Option<&AgentManager>,
    context: &proofbook::ProofbookAgentSessionSettlementContext,
) -> Result<RuntimeSettlementEvidence, ProofbookError> {
    let mut identity_blockers = Vec::new();
    if context.visible {
        let Some(interactive_sessions) = interactive_sessions else {
            return Ok(missing_runtime_evidence());
        };
        let session = interactive_sessions
            .get(&context.session_id)
            .map_err(|message| {
                ProofbookError::new(ProofbookErrorCode::ValidationFailed, message)
                    .with_step(context.step_id.clone())
            })?;
        let Some(session) = session else {
            return Ok(missing_runtime_evidence());
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

    let Some(agent_manager) = agent_manager else {
        return Ok(missing_runtime_evidence());
    };
    let session = agent_manager
        .list_sessions()
        .into_iter()
        .find(|session| session.id == context.session_id);
    let Some(session) = session else {
        return Ok(missing_runtime_evidence());
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

fn missing_runtime_evidence() -> RuntimeSettlementEvidence {
    RuntimeSettlementEvidence {
        runtime_status: None,
        identity_blockers: vec!["runtime_session_missing".to_string()],
    }
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
    use crate::agent::{AgentCli, InteractiveSessionInfo};
    use crate::proofbook::{
        ProofbookAgentSessionExecutor, ProofbookAgentSessionRequest, ProofbookAgentSessionSpawn,
        ProofbookRunStatus, ProofbookStep, ProofbookStepStatus,
    };
    use serde_json::json;
    use std::fs;

    struct FixedVisibleAgentExecutor;

    impl ProofbookAgentSessionExecutor for FixedVisibleAgentExecutor {
        fn start_agent_session(
            &self,
            _run_id: &str,
            _ledger: &ProofbookRunLedger,
            _step: &ProofbookStep,
            request: &ProofbookAgentSessionRequest,
        ) -> Result<ProofbookAgentSessionSpawn, ProofbookError> {
            Ok(ProofbookAgentSessionSpawn {
                session_id: "runtime-owned-session".to_string(),
                pane_id: Some("runtime-owned-pane".to_string()),
                pty_id: Some("runtime-owned-pty".to_string()),
                backend: "native".to_string(),
                provider: request.provider.clone(),
                model: request.model.clone(),
                repo_path: request.repo_path.clone(),
                worktree_path: request.worktree_path.clone(),
                worktree_branch: request.worktree_branch.clone(),
                visible: true,
            })
        }
    }

    fn write_agent_proofbook(project: &std::path::Path) -> String {
        let dir = project.join(".aelyris").join("proofbooks");
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("runtime-owned.proofbook.yaml");
        fs::write(
            &path,
            r#"
schema: aelyris.proofbook.v1
id: runtime-owned-agent-settlement
steps:
  - id: agent
    type: agentSession
    task: finish the current runtime-owned agent session
    role: implementation
    expectedArtifacts:
      - .aelyris/proofbooks/runtime-summary.md
settlement:
  requiredSteps: [agent]
"#,
        )
        .unwrap();
        path.to_string_lossy().to_string()
    }

    fn register_runtime_session(
        manager: &InteractiveSessionManager,
        context: &proofbook::ProofbookAgentSessionSettlementContext,
        pty_id: &str,
        status: &str,
    ) {
        manager
            .register(InteractiveSessionInfo {
                id: context.session_id.clone(),
                logical_session_id: "runtime-owned-logical".to_string(),
                pty_id: pty_id.to_string(),
                backend: context.backend.clone(),
                cli: AgentCli::Codex,
                status: status.to_string(),
                model: "gpt-test".to_string(),
                initial_prompt: None,
                approval_prompt: None,
                cwd: context.repo_path.clone(),
                worktree_branch: context.worktree_branch.clone(),
                worktree_path: context.worktree_path.clone(),
                repo_path: Some(context.repo_path.clone()),
                cost: 0.0,
                tokens_used: 0,
                started_at: 1,
                last_activity: 1,
                turn_count: 0,
                context_remaining: None,
            })
            .unwrap();
    }

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
    }

    #[test]
    fn candidate_wire_contract_has_no_free_form_proof_fields() {
        let candidate = derive_agent_session_settlement_candidate(
            &settlement_context(Vec::new()),
            RuntimeSettlementEvidence {
                runtime_status: Some("done".to_string()),
                identity_blockers: Vec::new(),
            },
        );
        let value = serde_json::to_value(candidate).unwrap();
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

    #[test]
    fn settlement_rechecks_runtime_identity_artifacts_and_revision_before_mutation() {
        let project = tempfile::tempdir().unwrap();
        let expected_artifact = project
            .path()
            .join(".aelyris")
            .join("proofbooks")
            .join("runtime-summary.md");
        fs::create_dir_all(expected_artifact.parent().unwrap()).unwrap();
        fs::write(&expected_artifact, "ready").unwrap();
        let proofbook_path = write_agent_proofbook(project.path());
        let project_path = project.path().to_string_lossy().to_string();
        let runner = proofbook::ProofbookRunner::new();
        let running = runner
            .start_run_with_agent_executor(
                &project_path,
                &proofbook_path,
                json!({}),
                &FixedVisibleAgentExecutor,
            )
            .unwrap();
        let context = runner
            .agent_session_settlement_context(
                &project_path,
                &running.run_id,
                "agent",
                running.revision,
            )
            .unwrap();
        let sessions = InteractiveSessionManager::new();
        register_runtime_session(
            &sessions,
            &context,
            context.pty_id.as_deref().unwrap(),
            "done",
        );

        let candidate = agent_session_settlement_candidate(
            &runner,
            Some(&sessions),
            None,
            &project_path,
            &running.run_id,
            "agent",
            running.revision,
        )
        .unwrap();
        assert!(candidate.eligible);
        assert_eq!(candidate.resulting_status.as_deref(), Some("passed"));

        sessions.unregister(&context.session_id).unwrap();
        register_runtime_session(&sessions, &context, "replacement-pty", "done");
        let identity_error = settle_current_agent_session(
            &runner,
            Some(&sessions),
            None,
            &project_path,
            &running.run_id,
            "agent",
            running.revision,
            &context.session_id,
        )
        .unwrap_err();
        assert_eq!(identity_error.code, ProofbookErrorCode::ValidationFailed);
        let unchanged = runner.status(&project_path, &running.run_id).unwrap();
        assert_eq!(unchanged.revision, running.revision);
        assert_eq!(unchanged.steps[0].status, ProofbookStepStatus::Running);

        sessions.unregister(&context.session_id).unwrap();
        register_runtime_session(
            &sessions,
            &context,
            context.pty_id.as_deref().unwrap(),
            "done",
        );
        fs::remove_file(&expected_artifact).unwrap();
        let artifact_error = settle_current_agent_session(
            &runner,
            Some(&sessions),
            None,
            &project_path,
            &running.run_id,
            "agent",
            running.revision,
            &context.session_id,
        )
        .unwrap_err();
        assert_eq!(artifact_error.code, ProofbookErrorCode::ValidationFailed);
        let unchanged = runner.status(&project_path, &running.run_id).unwrap();
        assert_eq!(unchanged.revision, running.revision);
        assert_eq!(unchanged.status, ProofbookRunStatus::Running);

        fs::write(&expected_artifact, "ready again").unwrap();
        let settled = settle_current_agent_session(
            &runner,
            Some(&sessions),
            None,
            &project_path,
            &running.run_id,
            "agent",
            running.revision,
            &context.session_id,
        )
        .unwrap();
        assert_eq!(settled.ledger.status, ProofbookRunStatus::Passed);
        assert_eq!(settled.ledger.steps[0].status, ProofbookStepStatus::Passed);
        assert_eq!(
            settled.candidate.proof_kind.as_deref(),
            Some("requiredArtifactSettlement")
        );

        let stale = agent_session_settlement_candidate(
            &runner,
            Some(&sessions),
            None,
            &project_path,
            &running.run_id,
            "agent",
            running.revision,
        )
        .unwrap_err();
        assert_eq!(stale.code, ProofbookErrorCode::StaleLedgerRevision);
    }

    #[test]
    fn runtime_failure_blocker_and_windows_path_identity_remain_backend_generated() {
        for (runtime_status, resulting_status, blocker_code) in [
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
            let proof = completion_proof_from_candidate(&candidate).unwrap();
            assert_eq!(proof.status, resulting_status);
            assert_eq!(proof.blocker_code.as_deref(), Some(blocker_code));
            assert!(proof.summary.is_none());
            assert!(proof.artifact_paths.is_empty());
        }
        assert!(same_runtime_path(
            "C:\\Repo\\.worktrees\\Agent\\",
            "c:/repo/.worktrees/agent"
        ));
        assert!(!same_runtime_path("C:/repo/a", "C:/repo/b"));
    }
}
