use serde::Serialize;

use crate::api::McpPendingDecision;
use crate::merge_intent::MergeIntent;

use super::super::{ApiError, ApiResult, ApiState};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PendingApprovalProjection {
    id: String,
    kind: String,
    risk: String,
    status: String,
    session_digest: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct MergeIntentProjection {
    intent_id: String,
    state: String,
    created_at: i64,
    updated_at: i64,
    requestor_present: bool,
    reviewer_present: bool,
    gate_evidence_present: bool,
}

fn session_digest(session_id: &str) -> String {
    crate::command_risk::approval::command_hash(&format!(
        "aelyris.pending-decision-session\n{session_id}"
    ))
    .as_str()
    .to_string()
}

fn project_pending(item: McpPendingDecision) -> PendingApprovalProjection {
    PendingApprovalProjection {
        id: item.id,
        kind: item.kind,
        risk: item.risk,
        status: item.status,
        session_digest: session_digest(&item.session_id),
    }
}

fn project_merge(intent: MergeIntent) -> MergeIntentProjection {
    MergeIntentProjection {
        intent_id: intent.intent_id,
        state: intent.state.as_str().to_string(),
        created_at: intent.created_at,
        updated_at: intent.updated_at,
        requestor_present: intent.session_id.is_some(),
        reviewer_present: intent.reviewer_id.is_some(),
        gate_evidence_present: intent.gates_digest.is_some(),
    }
}

pub(super) fn get(state: &ApiState) -> ApiResult<serde_json::Value> {
    let pending = state
        .mcp_pending
        .lock()
        .map_err(|_| ApiError::Internal("MCP pending queue lock poisoned".to_string()))?
        .iter()
        .filter(|item| item.status == "pending")
        .cloned()
        .map(project_pending)
        .collect::<Vec<_>>();
    let merge_store_available = state.merge_store.is_some();
    let mut merge_intents = match state.merge_store.as_ref() {
        Some(store) => store
            .list_unresolved()
            .map_err(ApiError::Internal)?
            .into_iter()
            .map(project_merge)
            .collect::<Vec<_>>(),
        None => Vec::new(),
    };
    merge_intents.sort_by(|left, right| left.intent_id.cmp(&right.intent_id));

    Ok(serde_json::json!({
        "pendingQueueAvailable": true,
        "mergeStoreAvailable": merge_store_available,
        "pendingCount": pending.len(),
        "mergeIntentCount": merge_intents.len(),
        "pending": pending,
        "mergeIntents": merge_intents,
        "decisionValuesExposed": false,
        "mergeTargetsExposed": false,
        "grantToolExposed": false,
        "readOnly": true,
    }))
}
