use crate::control::proofbook as proofbook_control;
use crate::proofbook::{self, ProofbookError, ProofbookRunLedger};
use tauri::{AppHandle, Manager};

use super::commands::record_audit_event;
use super::proofbook_commands::{emit_proofbook_update, require_proofbook_effect_admitted};

pub use crate::control::proofbook::ProofbookAgentSessionSettlementCandidate;

#[tauri::command]
pub fn proofbook_agent_session_settlement_candidate(
    app: AppHandle,
    project_path: String,
    run_id: String,
    step_id: String,
    expected_revision: u64,
) -> Result<ProofbookAgentSessionSettlementCandidate, ProofbookError> {
    let runner = app.state::<proofbook::ProofbookRunner>();
    let interactive = app.state::<crate::agent::InteractiveSessionManager>();
    let agents = app.state::<crate::agent::AgentManager>();
    proofbook_control::agent_session_settlement_candidate(
        runner.inner(),
        Some(interactive.inner()),
        Some(agents.inner()),
        &project_path,
        &run_id,
        &step_id,
        expected_revision,
    )
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
    let interactive = app.state::<crate::agent::InteractiveSessionManager>();
    let agents = app.state::<crate::agent::AgentManager>();
    let outcome = proofbook_control::settle_current_agent_session(
        runner.inner(),
        Some(interactive.inner()),
        Some(agents.inner()),
        &project_path,
        &run_id,
        &step_id,
        expected_revision,
        &expected_session_id,
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
            "runtimeStatus": outcome.candidate.runtime_status,
            "proofKind": outcome.candidate.proof_kind,
            "proofSources": outcome.candidate.proof_sources,
            "expectedArtifactCount": outcome.candidate.expected_artifacts.len(),
            "freeFormProofAccepted": false,
            "status": outcome.ledger.status,
        }),
    );
    emit_proofbook_update(&app, &outcome.ledger);
    Ok(outcome.ledger)
}
