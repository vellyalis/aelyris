use axum::Json;

use super::super::{ApiError, ApiResult, ApiState};
#[cfg(not(test))]
use super::dispatch::mcp_app_handle;
use super::dispatch::{arg_string, resolve_mcp_terminal_ref};
use super::schema_tool_error;

fn authenticated_actor(actor: &str) -> ApiResult<&str> {
    let actor = actor.trim();
    if actor.is_empty() {
        Err(ApiError::Forbidden(
            "authenticated approval resolution Principal is unavailable".to_string(),
        ))
    } else {
        Ok(actor)
    }
}

fn terminal_digest(terminal_id: &str) -> String {
    crate::command_risk::approval::command_hash(&format!(
        "aelyris.approval-terminal\n{terminal_id}"
    ))
    .as_str()
    .to_string()
}

fn prompt_digest(expected_prompt_key: &str) -> String {
    crate::command_risk::approval::command_hash(&format!(
        "aelyris.approval-prompt\n{expected_prompt_key}"
    ))
    .as_str()
    .to_string()
}

/// Deliberately excludes both the decision value and independent approval
/// authority material. Those inputs are low-entropy or credential-bearing, so
/// even a one-way digest would reveal more than the authority journal needs.
fn input_digest(terminal_digest: &str, prompt_digest: &str) -> String {
    crate::command_risk::approval::command_hash(&format!(
        "aelyris.approval-resolution-input\n{terminal_digest}\n{prompt_digest}\ndecision-present\nauthority-present"
    ))
    .as_str()
    .to_string()
}

fn rejection_code(error: &str) -> &'static str {
    if error.contains("stale_approval") {
        "stale_approval"
    } else if error.contains("approval_capability_required") {
        "approval_capability_required"
    } else if error.contains("invalid decision") {
        "invalid_approval_decision"
    } else if error.contains("unknown terminal reference") {
        "terminal_reference_invalid"
    } else {
        "approval_resolution_failed"
    }
}

fn error_payload(error: &str) -> serde_json::Value {
    if error.contains("stale_approval") {
        serde_json::json!({ "stale_approval": error })
    } else {
        serde_json::json!({ "error": error })
    }
}

#[allow(clippy::too_many_arguments)]
fn audit(
    state: &ApiState,
    actor: &str,
    terminal_digest: &str,
    prompt_digest: &str,
    input_digest: &str,
    result_class: Option<&str>,
    status: &str,
    rejection_code: Option<&str>,
    authority_verified: Option<bool>,
    resolution_applied: Option<bool>,
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
        correlation_id: Some(terminal_digest.to_string()),
        kind: "mcp_approval_resolution_authority".to_string(),
        severity: if status == "accepted" {
            "info".to_string()
        } else {
            "warning".to_string()
        },
        source: "mcp-approval-resolution".to_string(),
        confidence: None,
        payload_json: serde_json::json!({
            "actor": actor,
            "operation": "resolve",
            "terminalDigest": terminal_digest,
            "promptDigest": prompt_digest,
            "inputDigest": input_digest,
            "resultClass": result_class,
            "status": status,
            "rejectionCode": rejection_code,
            "authorityVerified": authority_verified,
            "resolutionApplied": resolution_applied,
            "approvalValuesLogged": false,
            "authorityMaterialLogged": false,
        }),
    };
    if let Err(error) = db.with(|database| database.append_audit_journal_event(&event)) {
        tracing::error!(actor, terminal_digest, error = %error, "approval resolution audit failed");
    }
}

#[cfg(not(test))]
async fn resolve_core(
    state: &ApiState,
    terminal_id: String,
    decision: String,
    expected_prompt_key: String,
) -> ApiResult<Result<(), String>> {
    let app = mcp_app_handle(state)?;
    Ok(
        crate::ipc::resolve_interactive_approval_core_without_inbox_audit(
            app,
            terminal_id,
            decision,
            Some(expected_prompt_key),
        )
        .await,
    )
}

#[cfg(test)]
async fn resolve_core(
    _state: &ApiState,
    _terminal_id: String,
    decision: String,
    expected_prompt_key: String,
) -> ApiResult<Result<(), String>> {
    if !matches!(decision.as_str(), "approve" | "deny") {
        return Ok(Err(format!(
            "invalid decision '{decision}' (expected approve|deny)"
        )));
    }
    if expected_prompt_key == "stale-test" {
        Ok(Err(
            "stale_approval: prompt fingerprint changed for session test".to_string(),
        ))
    } else {
        Ok(Ok(()))
    }
}

pub(super) async fn resolve(
    state: &ApiState,
    actor: &str,
    args: &serde_json::Map<String, serde_json::Value>,
) -> ApiResult<Json<serde_json::Value>> {
    let actor = authenticated_actor(actor)?;
    let terminal_ref = arg_string(args, "terminalId")?;
    let decision = arg_string(args, "decision")?;
    let expected_prompt_key = arg_string(args, "expectedPromptKey")?;
    let approval_authority = arg_string(args, "humanApprovalCapability")?;

    let raw_terminal_digest = terminal_digest(&terminal_ref);
    let prompt_digest = prompt_digest(&expected_prompt_key);
    let raw_input_digest = input_digest(&raw_terminal_digest, &prompt_digest);
    let terminal_id = match resolve_mcp_terminal_ref(state, &terminal_ref) {
        Ok(terminal_id) => terminal_id,
        Err(ApiError::BadRequest(error)) => {
            let code = rejection_code(&error);
            audit(
                state,
                actor,
                &raw_terminal_digest,
                &prompt_digest,
                &raw_input_digest,
                Some("rejected"),
                "rejected",
                Some(code),
                None,
                Some(false),
            );
            return Ok(schema_tool_error(
                "aelyris.approval.resolve",
                error_payload(&error),
            ));
        }
        Err(error) => {
            audit(
                state,
                actor,
                &raw_terminal_digest,
                &prompt_digest,
                &raw_input_digest,
                Some("rejected"),
                "rejected",
                Some("terminal_resolution_failed"),
                None,
                Some(false),
            );
            return Err(error);
        }
    };
    let terminal_digest = terminal_digest(&terminal_id);
    let input_digest = input_digest(&terminal_digest, &prompt_digest);

    if !state.auth.verify_input_authority(Some(&approval_authority)) {
        let error =
            "approval_capability_required: public API possession cannot resolve a human approval";
        audit(
            state,
            actor,
            &terminal_digest,
            &prompt_digest,
            &input_digest,
            Some("rejected"),
            "rejected",
            Some("approval_capability_required"),
            Some(false),
            Some(false),
        );
        return Ok(schema_tool_error(
            "aelyris.approval.resolve",
            error_payload(error),
        ));
    }

    match resolve_core(state, terminal_id, decision, expected_prompt_key).await? {
        Ok(()) => {
            audit(
                state,
                actor,
                &terminal_digest,
                &prompt_digest,
                &input_digest,
                Some("resolved"),
                "accepted",
                None,
                Some(true),
                Some(true),
            );
            Ok(Json(serde_json::json!({
                "schema": "aelyris.mcp.server.v1",
                "tool": "aelyris.approval.resolve",
                "ok": true,
                "result": { "ok": true },
            })))
        }
        Err(error) => {
            let code = rejection_code(&error);
            audit(
                state,
                actor,
                &terminal_digest,
                &prompt_digest,
                &input_digest,
                Some("rejected"),
                "rejected",
                Some(code),
                Some(true),
                Some(false),
            );
            Ok(schema_tool_error(
                "aelyris.approval.resolve",
                error_payload(&error),
            ))
        }
    }
}
