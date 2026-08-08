#[cfg(not(test))]
use tauri::Emitter;

use super::super::{ApiError, ApiResult, ApiState};

fn authenticated_actor(actor: &str) -> ApiResult<&str> {
    let actor = actor.trim();
    if actor.is_empty() {
        Err(ApiError::Forbidden(
            "authenticated runtime-owned Proofbook settlement Principal is unavailable".to_string(),
        ))
    } else {
        Ok(actor)
    }
}

fn required_string(
    args: &serde_json::Map<String, serde_json::Value>,
    key: &str,
) -> ApiResult<String> {
    args.get(key)
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .ok_or_else(|| ApiError::BadRequest(format!("MCP argument `{key}` is required")))
}

fn required_u64(args: &serde_json::Map<String, serde_json::Value>, key: &str) -> ApiResult<u64> {
    args.get(key)
        .and_then(serde_json::Value::as_u64)
        .ok_or_else(|| {
            ApiError::BadRequest(format!(
                "MCP argument `{key}` must be a non-negative integer"
            ))
        })
}

fn canonicalize(value: &serde_json::Value) -> serde_json::Value {
    match value {
        serde_json::Value::Object(object) => {
            let mut keys = object.keys().collect::<Vec<_>>();
            keys.sort();
            let mut canonical = serde_json::Map::new();
            for key in keys {
                canonical.insert(key.clone(), canonicalize(&object[key]));
            }
            serde_json::Value::Object(canonical)
        }
        serde_json::Value::Array(items) => {
            serde_json::Value::Array(items.iter().map(canonicalize).collect())
        }
        _ => value.clone(),
    }
}

fn settlement_digest(
    project_path: &str,
    run_id: &str,
    step_id: &str,
    expected_revision: u64,
    expected_session_id: &str,
) -> String {
    crate::command_risk::approval::command_hash(&format!(
        "aelyris.proofbook-runtime-settlement\n{project_path}\n{run_id}\n{step_id}\n{expected_revision}\n{expected_session_id}"
    ))
    .as_str()
    .to_string()
}

fn input_digest(args: &serde_json::Map<String, serde_json::Value>) -> String {
    let canonical = canonicalize(&serde_json::Value::Object(args.clone()));
    let encoded = serde_json::to_string(&canonical).unwrap_or_else(|_| "{}".to_string());
    crate::command_risk::approval::command_hash(&format!(
        "aelyris.proofbook-runtime-settlement-input\n{encoded}"
    ))
    .as_str()
    .to_string()
}

fn rejection_code(error: &ApiError) -> &'static str {
    match error {
        ApiError::Internal(message) if message.contains("Proofbook runner runtime") => {
            "proofbook_runner_unavailable"
        }
        ApiError::BadRequest(message) if message.contains("StaleLedgerRevision") => {
            "proofbook_stale_ledger_revision"
        }
        ApiError::BadRequest(message) if message.contains("runtime identity changed") => {
            "proofbook_runtime_identity_changed"
        }
        ApiError::BadRequest(message) if message.contains("expected_artifacts_missing") => {
            "proofbook_expected_artifacts_missing"
        }
        ApiError::BadRequest(message) if message.contains("not settlement-ready") => {
            "proofbook_runtime_not_settlement_ready"
        }
        ApiError::BadRequest(_) => "proofbook_runtime_settlement_rejected",
        ApiError::Internal(_) => "proofbook_runtime_settlement_internal",
        ApiError::Forbidden(_) => "proofbook_runtime_settlement_forbidden",
        ApiError::Unauthorized => "proofbook_runtime_settlement_unauthorized",
        ApiError::NotFound(_) => "proofbook_runtime_settlement_not_found",
        ApiError::Conflict(_) => "proofbook_runtime_settlement_conflict",
        ApiError::RateLimited => "proofbook_runtime_settlement_rate_limited",
        ApiError::ServiceUnavailable(_)
        | ApiError::TelemetryUnavailable(_)
        | ApiError::ContinuityUnavailable(_) => "proofbook_runtime_settlement_unavailable",
        ApiError::CommandRiskBlocked(_)
        | ApiError::TerminalWriteRejected(_, _)
        | ApiError::ContinuityEvent(_) => "proofbook_runtime_settlement_guard_rejected",
    }
}

#[allow(clippy::too_many_arguments)]
fn audit(
    state: &ApiState,
    actor: &str,
    settlement_digest: &str,
    input_digest: &str,
    ledger_revision: Option<u64>,
    ledger_status: Option<&str>,
    expected_artifact_count: Option<usize>,
    proof_source_count: Option<usize>,
    blocker_count: Option<usize>,
    status: &str,
    rejection_code: Option<&str>,
) {
    let Some(db) = state.db.as_ref() else {
        return;
    };
    let event = crate::db::AuditJournalAppend {
        workspace_id: state.governance.tenant_of(actor),
        thread_id: None,
        session_id: None,
        pane_id: None,
        terminal_id: None,
        agent_id: Some(actor.to_string()),
        workflow_id: None,
        task_id: None,
        correlation_id: Some(settlement_digest.to_string()),
        kind: "mcp_proofbook_runtime_settlement_authority".to_string(),
        severity: if status == "accepted" {
            "info".to_string()
        } else {
            "warning".to_string()
        },
        source: "mcp-proofbook-runtime-settlement".to_string(),
        confidence: None,
        payload_json: serde_json::json!({
            "actor": actor,
            "operation": "settle_current_agent_session",
            "settlementDigest": settlement_digest,
            "inputDigest": input_digest,
            "ledgerRevision": ledger_revision,
            "ledgerStatus": ledger_status,
            "expectedArtifactCount": expected_artifact_count,
            "proofSourceCount": proof_source_count,
            "blockerCount": blocker_count,
            "status": status,
            "rejectionCode": rejection_code,
            "runtimeValuesLogged": false,
            "completionProofLogged": false,
            "externalProcessTerminationClaimed": false,
            "reviewAcceptanceClaimed": false,
            "mergeClaimed": false,
        }),
    };
    if let Err(error) = db.with(|database| database.append_audit_journal_event(&event)) {
        tracing::error!(actor, settlement_digest, error = %error, "runtime-owned Proofbook settlement audit failed");
    }
}

pub(super) fn settle(
    state: &ApiState,
    actor: &str,
    args: &serde_json::Map<String, serde_json::Value>,
) -> ApiResult<axum::Json<serde_json::Value>> {
    let actor = authenticated_actor(actor)?;
    let project_path = required_string(args, "projectPath")?;
    let run_id = required_string(args, "runId")?;
    let step_id = required_string(args, "stepId")?;
    let expected_revision = required_u64(args, "expectedRevision")?;
    let expected_session_id = required_string(args, "expectedSessionId")?;
    let settlement_digest = settlement_digest(
        &project_path,
        &run_id,
        &step_id,
        expected_revision,
        &expected_session_id,
    );
    let input_digest = input_digest(args);

    if let Some(startup) = state.startup_reconciliation.as_ref() {
        if let Err(error) =
            startup.require_effect_admitted("Proofbook MCP runtime-owned agent-session settlement")
        {
            let api_error = ApiError::ServiceUnavailable(error);
            audit(
                state,
                actor,
                &settlement_digest,
                &input_digest,
                None,
                None,
                None,
                None,
                None,
                "rejected",
                Some(rejection_code(&api_error)),
            );
            return Err(api_error);
        }
    }

    let runner = match state.proofbook_runner.clone() {
        Some(runner) => runner,
        None => {
            let api_error = ApiError::Internal(
                "Proofbook runner runtime is not attached to this MCP process".to_string(),
            );
            audit(
                state,
                actor,
                &settlement_digest,
                &input_digest,
                None,
                None,
                None,
                None,
                None,
                "rejected",
                Some(rejection_code(&api_error)),
            );
            return Err(api_error);
        }
    };

    let outcome = match crate::control::proofbook::settle_current_agent_session(
        &runner,
        state.interactive_session_manager.as_ref(),
        state.agent_manager.as_ref(),
        &project_path,
        &run_id,
        &step_id,
        expected_revision,
        &expected_session_id,
    ) {
        Ok(outcome) => outcome,
        Err(error) => {
            let api_error = ApiError::BadRequest(error.to_string());
            audit(
                state,
                actor,
                &settlement_digest,
                &input_digest,
                None,
                None,
                None,
                None,
                None,
                "rejected",
                Some(rejection_code(&api_error)),
            );
            return Err(api_error);
        }
    };

    #[cfg(not(test))]
    if let Some(app) = state.app_handle.as_ref() {
        let _ = app.emit("proofbook-updated", &outcome.ledger);
    }
    let ledger_status = serde_json::to_value(outcome.ledger.status)
        .ok()
        .and_then(|value| value.as_str().map(ToOwned::to_owned));
    audit(
        state,
        actor,
        &settlement_digest,
        &input_digest,
        Some(outcome.ledger.revision),
        ledger_status.as_deref(),
        Some(outcome.candidate.expected_artifacts.len()),
        Some(outcome.candidate.proof_sources.len()),
        Some(outcome.candidate.blockers.len()),
        "accepted",
        None,
    );
    let ledger = serde_json::to_value(outcome.ledger)
        .map_err(|error| ApiError::Internal(format!("serialize MCP result failed: {error}")))?;
    Ok(axum::Json(serde_json::json!({
        "schema": "aelyris.mcp.server.v1",
        "tool": "aelyris.proofbook.settle_current_agent_session",
        "ok": true,
        "result": ledger,
    })))
}
