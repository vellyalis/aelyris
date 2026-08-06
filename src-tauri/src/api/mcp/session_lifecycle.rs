use super::super::{ApiError, ApiResult, ApiState};

pub(super) fn authenticated_actor(actor: &str) -> ApiResult<&str> {
    let actor = actor.trim();
    if actor.is_empty() {
        Err(ApiError::Forbidden(
            "authenticated session-lifecycle Principal is unavailable".to_string(),
        ))
    } else {
        Ok(actor)
    }
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

fn target_value<'a>(
    operation: &str,
    args: &'a serde_json::Map<String, serde_json::Value>,
) -> &'a str {
    match operation {
        "resume" => args
            .get("logical_session_id")
            .and_then(serde_json::Value::as_str)
            .unwrap_or("<latest>"),
        _ => args
            .get("session_id")
            .and_then(serde_json::Value::as_str)
            .unwrap_or("<missing>"),
    }
}

fn target_digest(operation: &str, args: &serde_json::Map<String, serde_json::Value>) -> String {
    crate::command_risk::approval::command_hash(&format!(
        "aelyris.session-lifecycle-target\n{operation}\n{}",
        target_value(operation, args)
    ))
    .as_str()
    .to_string()
}

fn input_digest(operation: &str, args: &serde_json::Map<String, serde_json::Value>) -> String {
    let canonical = canonicalize(&serde_json::Value::Object(args.clone()));
    let encoded = serde_json::to_string(&canonical).unwrap_or_else(|_| "{}".to_string());
    crate::command_risk::approval::command_hash(&format!(
        "aelyris.session-lifecycle-input\n{operation}\n{encoded}"
    ))
    .as_str()
    .to_string()
}

fn safe_result_summary(operation: &str, result: &serde_json::Value) -> serde_json::Value {
    match operation {
        "summarize" => serde_json::json!({
            "handoffSeq": result.get("handoffSeq").cloned(),
            "redactionCount": result.get("redactionCount").cloned(),
            "validationProduced": result.get("validation").is_some(),
            "summaryProduced": result.get("summary").is_some(),
        }),
        "checkpoint" => serde_json::json!({
            "checkpointSeq": result.get("checkpointSeq").cloned(),
            "redactionCount": result.get("redactionCount").cloned(),
            "identityContextPersisted": result.get("identityContextPersisted").cloned(),
            "checkpointProduced": result.get("checkpoint").is_some(),
        }),
        "handoff" => serde_json::json!({
            "handoffSeq": result.get("handoffSeq").cloned(),
            "checkpointSeq": result.get("checkpointSeq").cloned(),
            "successorCheckpointSeq": result.get("successorCheckpointSeq").cloned(),
            "retiredPredecessor": result.get("retiredPredecessor").cloned(),
            "auditTraceEvents": result.get("auditTraceEvents").cloned(),
            "acceptanceProduced": result.get("acceptance").is_some(),
        }),
        "resume" => serde_json::json!({
            "reconciledHandoffs": result.get("reconciledHandoffs").cloned(),
            "unresolvedBefore": result.get("unresolvedBefore").cloned(),
            "unresolvedAfter": result.get("unresolvedAfter").cloned(),
            "adopted": result
                .get("adoptedLogicalSessionId")
                .is_some_and(|value| !value.is_null()),
            "checkpointSeq": result.get("checkpointSeq").cloned(),
            "ackReconfirmed": result.get("ackReconfirmed").cloned(),
        }),
        "reset_context" => serde_json::json!({
            "resetContext": result.get("resetContext").cloned(),
            "worktreeDeleted": result.get("worktreeDeleted").cloned(),
            "handoffSeq": result.pointer("/handoff/handoffSeq").cloned(),
            "retiredPredecessor": result.pointer("/handoff/retiredPredecessor").cloned(),
        }),
        _ => serde_json::json!({ "resultProduced": true }),
    }
}

fn rejection_code(error: &ApiError) -> &'static str {
    match error {
        ApiError::Internal(message)
            if message.contains("session lifecycle runtime is not attached") =>
        {
            "session_lifecycle_runtime_unavailable"
        }
        ApiError::Internal(_) => "session_lifecycle_internal",
        ApiError::BadRequest(_) => "session_lifecycle_rejected",
        ApiError::NotFound(_) => "session_lifecycle_not_found",
        ApiError::Conflict(_) => "session_lifecycle_conflict",
        ApiError::Forbidden(_) => "session_lifecycle_forbidden",
        ApiError::Unauthorized => "session_lifecycle_unauthorized",
        ApiError::RateLimited => "session_lifecycle_rate_limited",
        ApiError::ServiceUnavailable(_) | ApiError::ContinuityUnavailable(_) => {
            "session_lifecycle_unavailable"
        }
        ApiError::CommandRiskBlocked(_)
        | ApiError::TerminalWriteRejected(_, _)
        | ApiError::ContinuityEvent(_) => "session_lifecycle_guard_rejected",
    }
}

#[allow(clippy::too_many_arguments)]
fn audit(
    state: &ApiState,
    actor: &str,
    operation: &str,
    target_digest: &str,
    input_digest: &str,
    result_summary: Option<serde_json::Value>,
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
        correlation_id: Some(target_digest.to_string()),
        kind: "mcp_session_lifecycle_authority".to_string(),
        severity: if status == "accepted" {
            "info".to_string()
        } else {
            "warning".to_string()
        },
        source: "mcp-session-lifecycle".to_string(),
        confidence: None,
        payload_json: serde_json::json!({
            "actor": actor,
            "operation": operation,
            "targetDigest": target_digest,
            "inputDigest": input_digest,
            "resultSummary": result_summary,
            "status": status,
            "rejectionCode": rejection_code,
            "lifecycleValuesLogged": false,
            "resultValuesLogged": false,
        }),
    };
    if let Err(error) = db.with(|database| database.append_audit_journal_event(&event)) {
        tracing::error!(actor, operation, target_digest, error = %error, "session lifecycle audit failed");
    }
}

pub(super) fn finish(
    state: &ApiState,
    actor: &str,
    operation: &str,
    args: &serde_json::Map<String, serde_json::Value>,
    result: ApiResult<serde_json::Value>,
) -> ApiResult<serde_json::Value> {
    let target_digest = target_digest(operation, args);
    let input_digest = input_digest(operation, args);
    match result {
        Ok(value) => {
            audit(
                state,
                actor,
                operation,
                &target_digest,
                &input_digest,
                Some(safe_result_summary(operation, &value)),
                "accepted",
                None,
            );
            Ok(value)
        }
        Err(error) => {
            audit(
                state,
                actor,
                operation,
                &target_digest,
                &input_digest,
                None,
                "rejected",
                Some(rejection_code(&error)),
            );
            Err(error)
        }
    }
}
