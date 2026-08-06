use super::super::{ApiError, ApiResult, ApiState};

pub(super) fn authenticated_actor(actor: &str) -> ApiResult<&str> {
    let actor = actor.trim();
    if actor.is_empty() {
        Err(ApiError::Forbidden(
            "authenticated Proofbook compatibility-mutation Principal is unavailable".to_string(),
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

fn run_digest(operation: &str, args: &serde_json::Map<String, serde_json::Value>) -> String {
    let project = args
        .get("projectPath")
        .and_then(serde_json::Value::as_str)
        .unwrap_or("<missing-project>");
    let run = args
        .get("runId")
        .and_then(serde_json::Value::as_str)
        .unwrap_or("<missing-run>");
    let step = args
        .get("stepId")
        .and_then(serde_json::Value::as_str)
        .unwrap_or("");
    crate::command_risk::approval::command_hash(&format!(
        "aelyris.proofbook-compat-target\n{operation}\n{project}\n{run}\n{step}"
    ))
    .as_str()
    .to_string()
}

fn input_digest(operation: &str, args: &serde_json::Map<String, serde_json::Value>) -> String {
    let canonical = canonicalize(&serde_json::Value::Object(args.clone()));
    let encoded = serde_json::to_string(&canonical).unwrap_or_else(|_| "{}".to_string());
    crate::command_risk::approval::command_hash(&format!(
        "aelyris.proofbook-compat-input\n{operation}\n{encoded}"
    ))
    .as_str()
    .to_string()
}

fn result_summary(result: &serde_json::Value) -> serde_json::Value {
    serde_json::json!({
        "revision": result.get("revision").cloned(),
        "status": result.get("status").cloned(),
        "stepCount": result
            .get("steps")
            .and_then(serde_json::Value::as_array)
            .map(Vec::len),
        "eventCount": result
            .get("events")
            .and_then(serde_json::Value::as_array)
            .map(Vec::len),
    })
}

fn rejection_code(error: &ApiError) -> &'static str {
    match error {
        ApiError::Internal(message) if message.contains("Proofbook runner runtime") => {
            "proofbook_runner_unavailable"
        }
        ApiError::BadRequest(message) if message.contains("invalid agentSession proof") => {
            "proofbook_completion_proof_invalid"
        }
        ApiError::BadRequest(_) => "proofbook_compat_mutation_rejected",
        ApiError::Internal(_) => "proofbook_compat_mutation_internal",
        ApiError::Forbidden(_) => "proofbook_compat_mutation_forbidden",
        ApiError::Unauthorized => "proofbook_compat_mutation_unauthorized",
        ApiError::NotFound(_) => "proofbook_compat_mutation_not_found",
        ApiError::Conflict(_) => "proofbook_compat_mutation_conflict",
        ApiError::RateLimited => "proofbook_compat_mutation_rate_limited",
        ApiError::ServiceUnavailable(_) | ApiError::ContinuityUnavailable(_) => {
            "proofbook_compat_mutation_unavailable"
        }
        ApiError::CommandRiskBlocked(_)
        | ApiError::TerminalWriteRejected(_, _)
        | ApiError::ContinuityEvent(_) => "proofbook_compat_mutation_guard_rejected",
    }
}

fn audit(
    state: &ApiState,
    actor: &str,
    operation: &str,
    run_digest: &str,
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
        correlation_id: Some(run_digest.to_string()),
        kind: "mcp_proofbook_compat_mutation_authority".to_string(),
        severity: if status == "accepted" {
            "info".to_string()
        } else {
            "warning".to_string()
        },
        source: "mcp-proofbook-compat-mutation".to_string(),
        confidence: None,
        payload_json: serde_json::json!({
            "actor": actor,
            "operation": operation,
            "runDigest": run_digest,
            "inputDigest": input_digest,
            "resultSummary": result_summary,
            "status": status,
            "rejectionCode": rejection_code,
            "proofbookValuesLogged": false,
            "completionProofLogged": false,
        }),
    };
    if let Err(error) = db.with(|database| database.append_audit_journal_event(&event)) {
        tracing::error!(actor, operation, run_digest, error = %error, "Proofbook compatibility mutation audit failed");
    }
}

pub(super) fn finish(
    state: &ApiState,
    actor: &str,
    operation: &str,
    args: &serde_json::Map<String, serde_json::Value>,
    result: ApiResult<serde_json::Value>,
) -> ApiResult<serde_json::Value> {
    let run_digest = run_digest(operation, args);
    let input_digest = input_digest(operation, args);
    match result {
        Ok(value) => {
            audit(
                state,
                actor,
                operation,
                &run_digest,
                &input_digest,
                Some(result_summary(&value)),
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
                &run_digest,
                &input_digest,
                None,
                "rejected",
                Some(rejection_code(&error)),
            );
            Err(error)
        }
    }
}
