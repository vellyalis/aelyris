use super::super::{ApiError, ApiResult, ApiState};
use super::dispatch::{arg_string, now_secs};

fn authenticated_actor(actor: &str) -> ApiResult<&str> {
    let actor = actor.trim();
    if actor.is_empty() {
        Err(ApiError::Forbidden(
            "authenticated review-rejection Principal is unavailable".to_string(),
        ))
    } else {
        Ok(actor)
    }
}

fn intent_digest(intent_id: &str) -> String {
    crate::command_risk::approval::command_hash(&format!("aelyris.review-intent\n{intent_id}"))
        .as_str()
        .to_string()
}

fn input_digest(intent_id: &str, reason: Option<&str>) -> String {
    crate::command_risk::approval::command_hash(&format!(
        "aelyris.review-rejection-input\n{intent_id}\n{}",
        reason.unwrap_or("")
    ))
    .as_str()
    .to_string()
}

#[allow(clippy::too_many_arguments)]
fn audit(
    state: &ApiState,
    actor: &str,
    intent_digest: &str,
    input_digest: &str,
    initial_state: Option<&str>,
    resulting_state: Option<&str>,
    status: &str,
    rejection_code: Option<&str>,
    transition_applied: bool,
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
        correlation_id: Some(intent_digest.to_string()),
        kind: "mcp_review_rejection_authority".to_string(),
        severity: if status == "accepted" {
            "info".to_string()
        } else {
            "warning".to_string()
        },
        source: "mcp-review-rejection".to_string(),
        confidence: None,
        payload_json: serde_json::json!({
            "actor": actor,
            "operation": "reject",
            "intentDigest": intent_digest,
            "inputDigest": input_digest,
            "initialState": initial_state,
            "resultingState": resulting_state,
            "status": status,
            "rejectionCode": rejection_code,
            "transitionApplied": transition_applied,
            "reviewValuesLogged": false,
        }),
    };
    if let Err(error) = db.with(|database| database.append_audit_journal_event(&event)) {
        tracing::error!(actor, intent_digest, error = %error, "review rejection audit failed");
    }
}

pub(super) fn reject(
    state: &ApiState,
    actor: &str,
    args: &serde_json::Map<String, serde_json::Value>,
) -> ApiResult<serde_json::Value> {
    let actor = authenticated_actor(actor)?;
    const REJECT_ALLOWED: &[&str] = &["intentId", "reason"];
    if let Some(bad) = args
        .keys()
        .find(|key| !REJECT_ALLOWED.contains(&key.as_str()))
    {
        return Err(ApiError::BadRequest(format!(
            "aelyris.review.reject does not accept `{bad}`"
        )));
    }
    let intent_id = arg_string(args, "intentId")?;
    let reason = match args.get("reason") {
        None => None,
        Some(serde_json::Value::String(reason)) => Some(reason.clone()),
        Some(_) => return Err(ApiError::BadRequest("reason must be a string".to_string())),
    };
    let intent_digest = intent_digest(&intent_id);
    let input_digest = input_digest(&intent_id, reason.as_deref());
    let store = match state.merge_store.as_ref() {
        Some(store) => store,
        None => {
            audit(
                state,
                actor,
                &intent_digest,
                &input_digest,
                None,
                None,
                "rejected",
                Some("merge_store_unavailable"),
                false,
            );
            return Err(ApiError::Internal(
                "merge persistence is not attached to this process".to_string(),
            ));
        }
    };
    let intent = match store.get(&intent_id) {
        Ok(Some(intent)) => intent,
        Ok(None) => {
            audit(
                state,
                actor,
                &intent_digest,
                &input_digest,
                None,
                None,
                "rejected",
                Some("intent_not_found"),
                false,
            );
            return Err(ApiError::NotFound(intent_id));
        }
        Err(error) => {
            audit(
                state,
                actor,
                &intent_digest,
                &input_digest,
                None,
                None,
                "rejected",
                Some("intent_lookup_failed"),
                false,
            );
            return Err(ApiError::Internal(error));
        }
    };
    let initial_state = intent.state.as_str();
    match store.reject(&intent_id, now_secs() as i64) {
        Ok(true) => {
            audit(
                state,
                actor,
                &intent_digest,
                &input_digest,
                Some(initial_state),
                Some("rejected"),
                "accepted",
                None,
                true,
            );
            Ok(serde_json::json!({
                "intentId": intent_id,
                "status": "rejected",
                "reason": reason,
            }))
        }
        Ok(false) => {
            audit(
                state,
                actor,
                &intent_digest,
                &input_digest,
                Some(initial_state),
                Some(initial_state),
                "rejected",
                Some("intent_not_rejectable"),
                false,
            );
            Err(ApiError::BadRequest(format!(
                "intent {intent_id} cannot be rejected (state {initial_state}): it is merging or already resolved"
            )))
        }
        Err(error) => {
            audit(
                state,
                actor,
                &intent_digest,
                &input_digest,
                Some(initial_state),
                Some(initial_state),
                "rejected",
                Some("review_rejection_persistence_failed"),
                false,
            );
            Err(ApiError::Internal(error))
        }
    }
}
