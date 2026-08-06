use super::super::{ApiError, ApiResult, ApiState, McpPendingDecision};
use super::dispatch::{arg_optional_string, arg_string, push_pending_detailed};

fn authenticated_approval_request_actor(actor: &str) -> ApiResult<&str> {
    let actor = actor.trim();
    if actor.is_empty() {
        Err(ApiError::Forbidden(
            "authenticated approval-request Principal is unavailable".to_string(),
        ))
    } else {
        Ok(actor)
    }
}

fn approval_session_digest(session_id: &str) -> String {
    crate::command_risk::approval::command_hash(&format!(
        "aelyris.approval-request-session\n{session_id}"
    ))
    .as_str()
    .to_string()
}

fn approval_tool_digest(tool: &str) -> String {
    crate::command_risk::approval::command_hash(&format!("aelyris.approval-request-tool\n{tool}"))
        .as_str()
        .to_string()
}

fn approval_input_digest(
    session_id: &str,
    tool: &str,
    summary: Option<&str>,
    risk: &str,
) -> String {
    crate::command_risk::approval::command_hash(&format!(
        "aelyris.approval-request-input\n{session_id}\n{tool}\n{}\n{risk}",
        summary.unwrap_or("")
    ))
    .as_str()
    .to_string()
}

#[allow(clippy::too_many_arguments)]
fn audit_approval_request(
    state: &ApiState,
    actor: &str,
    session_digest: &str,
    tool_digest: &str,
    input_digest: &str,
    decision_class: Option<&str>,
    rule_matched: Option<bool>,
    queue_inserted: Option<bool>,
    queue_depth: Option<usize>,
    queue_overflowed: Option<bool>,
    overflow_event_published: Option<bool>,
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
            "operation": "request",
            "sessionDigest": session_digest,
            "toolDigest": tool_digest,
            "inputDigest": input_digest,
            "decisionClass": decision_class,
            "ruleMatched": rule_matched,
            "queueInserted": queue_inserted,
            "queueDepth": queue_depth,
            "queueOverflowed": queue_overflowed,
            "overflowEventPublished": overflow_event_published,
            "status": status,
            "rejectionCode": rejection_code,
            "requestValuesLogged": false,
            "watchdogRuleLogged": false,
            "pendingIdentityLogged": false,
        }),
    };
    if let Err(error) = db.with(|database| database.append_audit_journal_event(&event)) {
        tracing::error!(actor, session_digest, error = %error, "approval request audit failed");
    }
}

#[cfg(not(test))]
pub(super) fn request(
    state: &ApiState,
    actor: &str,
    args: &serde_json::Map<String, serde_json::Value>,
) -> ApiResult<serde_json::Value> {
    let rules = crate::watchdog::load_watchdog_rules();
    let engine = crate::watchdog::engine::WatchdogEngine::new(rules);
    request_with_engine(state, actor, args, &engine)
}

#[cfg(test)]
pub(super) fn request(
    state: &ApiState,
    actor: &str,
    args: &serde_json::Map<String, serde_json::Value>,
) -> ApiResult<serde_json::Value> {
    let engine =
        crate::watchdog::engine::WatchdogEngine::new(crate::watchdog::WatchdogRules::default());
    request_with_engine(state, actor, args, &engine)
}

pub(super) fn request_with_engine(
    state: &ApiState,
    actor: &str,
    args: &serde_json::Map<String, serde_json::Value>,
    engine: &crate::watchdog::engine::WatchdogEngine,
) -> ApiResult<serde_json::Value> {
    let actor = authenticated_approval_request_actor(actor)?;
    let session_id = arg_string(args, "sessionId")?;
    let tool = arg_string(args, "tool")?;
    let summary = arg_optional_string(args, "summary");
    let risk = arg_optional_string(args, "risk").unwrap_or_else(|| "medium".to_string());
    let session_digest = approval_session_digest(&session_id);
    let tool_digest = approval_tool_digest(&tool);
    let input_digest = approval_input_digest(&session_id, &tool, summary.as_deref(), &risk);

    match crate::control::approval::evaluate(engine, &tool) {
        crate::control::approval::ApprovalGateDecision::AutoApprove { rule } => {
            audit_approval_request(
                state,
                actor,
                &session_digest,
                &tool_digest,
                &input_digest,
                Some("auto_approved"),
                Some(true),
                Some(false),
                None,
                Some(false),
                None,
                "accepted",
                None,
            );
            Ok(serde_json::json!({
                "intentId": null,
                "status": "auto_approved",
                "rule": rule,
            }))
        }
        crate::control::approval::ApprovalGateDecision::AutoDeny { rule } => {
            audit_approval_request(
                state,
                actor,
                &session_digest,
                &tool_digest,
                &input_digest,
                Some("auto_denied"),
                Some(true),
                Some(false),
                None,
                Some(false),
                None,
                "accepted",
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
            match push_pending_detailed(state, item) {
                Ok(outcome) => {
                    audit_approval_request(
                        state,
                        actor,
                        &session_digest,
                        &tool_digest,
                        &input_digest,
                        Some("pending_user"),
                        Some(false),
                        Some(true),
                        Some(outcome.queue_depth),
                        Some(outcome.overflowed),
                        outcome.overflow_event_published,
                        "accepted",
                        None,
                    );
                    Ok(serde_json::json!({
                        "intentId": outcome.item.id,
                        "status": "pending",
                        "item": outcome.item,
                    }))
                }
                Err(failure) => {
                    let rejection_code = if failure.item_inserted
                        && failure.overflowed
                        && failure.overflow_event_published == Some(false)
                    {
                        "approval_overflow_event_publication_failed"
                    } else {
                        "approval_pending_queue_failed"
                    };
                    audit_approval_request(
                        state,
                        actor,
                        &session_digest,
                        &tool_digest,
                        &input_digest,
                        Some("pending_user"),
                        Some(false),
                        Some(failure.item_inserted),
                        failure.queue_depth,
                        Some(failure.overflowed),
                        failure.overflow_event_published,
                        "rejected",
                        Some(rejection_code),
                    );
                    Err(failure.error)
                }
            }
        }
    }
}
