use crate::api::{ApiError, ApiResult, ApiState, McpPendingDecision};

use super::dispatch::{arg_optional_string, arg_string, push_pending};

fn authenticated_actor(actor: &str) -> ApiResult<&str> {
    let actor = actor.trim();
    if actor.is_empty() {
        Err(ApiError::Forbidden(
            "authenticated approval-request Principal is unavailable".to_string(),
        ))
    } else {
        Ok(actor)
    }
}

fn digest(namespace: &str, values: &[&str]) -> String {
    crate::command_risk::approval::command_hash(&format!(
        "aelyris.approval-request-{namespace}\n{}",
        values.join("\n")
    ))
    .as_str()
    .to_string()
}

#[allow(clippy::too_many_arguments)]
fn audit_request(
    state: &ApiState,
    actor: &str,
    session_digest: &str,
    tool_digest: &str,
    input_digest: &str,
    result_class: Option<&str>,
    status: &str,
    rejection_code: Option<&str>,
    request_applied: Option<bool>,
    pending_count: Option<usize>,
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
        correlation_id: Some(session_digest.to_string()),
        kind: "mcp_approval_request_authority".to_string(),
        severity: if status == "accepted" {
            "info".to_string()
        } else {
            "warning".to_string()
        },
        source: "mcp-approval-request".to_string(),
        confidence: None,
        payload_json: serde_json::json!({
            "actor": actor,
            "operation": "request_approval",
            "sessionDigest": session_digest,
            "toolDigest": tool_digest,
            "inputDigest": input_digest,
            "resultClass": result_class,
            "status": status,
            "rejectionCode": rejection_code,
            "requestApplied": request_applied,
            "pendingCount": pending_count,
            "requestValuesLogged": false,
            "watchdogRuleLogged": false,
        }),
    };
    if let Err(error) = db.with(|database| database.append_audit_journal_event(&event)) {
        tracing::error!(
            actor,
            session_digest,
            error = %error,
            "approval request audit failed"
        );
    }
}

pub(super) fn request(
    state: &ApiState,
    actor: &str,
    args: &serde_json::Map<String, serde_json::Value>,
) -> ApiResult<serde_json::Value> {
    let actor = authenticated_actor(actor)?;
    let session_id = arg_string(args, "sessionId")?;
    let tool = arg_string(args, "tool")?;
    let summary = arg_optional_string(args, "summary");
    let risk = arg_optional_string(args, "risk").unwrap_or_else(|| "medium".to_string());
    let session_digest = digest("session", &[session_id.as_str()]);
    let tool_digest = digest("tool", &[tool.as_str()]);
    let input_digest = digest(
        "input",
        &[
            session_id.as_str(),
            tool.as_str(),
            summary.as_deref().unwrap_or(""),
            risk.as_str(),
        ],
    );

    let rules = crate::watchdog::load_watchdog_rules();
    let engine = crate::watchdog::engine::WatchdogEngine::new(rules);
    match crate::control::approval::evaluate(&engine, &tool) {
        crate::control::approval::ApprovalGateDecision::AutoApprove { rule } => {
            audit_request(
                state,
                actor,
                &session_digest,
                &tool_digest,
                &input_digest,
                Some("auto_approved"),
                "accepted",
                None,
                Some(false),
                None,
            );
            Ok(serde_json::json!({
                "intentId": null,
                "status": "auto_approved",
                "rule": rule,
            }))
        }
        crate::control::approval::ApprovalGateDecision::AutoDeny { rule } => {
            audit_request(
                state,
                actor,
                &session_digest,
                &tool_digest,
                &input_digest,
                Some("auto_denied"),
                "accepted",
                None,
                Some(false),
                None,
            );
            Ok(serde_json::json!({
                "intentId": null,
                "status": "auto_denied",
                "rule": rule,
            }))
        }
        crate::control::approval::ApprovalGateDecision::PendingUser => {
            let item = McpPendingDecision {
                id: format!("approval:{}", uuid::Uuid::new_v4()),
                session_id,
                kind: "permission_required".to_string(),
                title: format!("Approval requested for {tool}"),
                summary,
                risk,
                status: "pending".to_string(),
            };
            let item = match push_pending(state, item) {
                Ok(item) => item,
                Err(error) => {
                    audit_request(
                        state,
                        actor,
                        &session_digest,
                        &tool_digest,
                        &input_digest,
                        Some("pending"),
                        "rejected",
                        Some("approval_pending_queue_failed"),
                        None,
                        None,
                    );
                    return Err(error);
                }
            };
            let pending_count = state.mcp_pending.lock().ok().map(|queue| queue.len());
            audit_request(
                state,
                actor,
                &session_digest,
                &tool_digest,
                &input_digest,
                Some("pending"),
                "accepted",
                None,
                Some(true),
                pending_count,
            );
            Ok(serde_json::json!({
                "intentId": item.id,
                "status": "pending",
                "item": item,
            }))
        }
    }
}
