use axum::Json;

use super::super::{ApiError, ApiResult, ApiState};
use super::dispatch::{arg_string, event_bus_error_response};

fn authenticated_actor(actor: &str) -> ApiResult<&str> {
    let actor = actor.trim();
    if actor.is_empty() {
        Err(ApiError::Forbidden(
            "authenticated event acknowledgement Principal is unavailable".to_string(),
        ))
    } else {
        Ok(actor)
    }
}

fn consumer_digest(consumer_id: &str) -> String {
    crate::command_risk::approval::command_hash(&format!("aelyris.event-consumer\n{consumer_id}"))
        .as_str()
        .to_string()
}

fn event_digest(event_id: &str) -> String {
    crate::command_risk::approval::command_hash(&format!("aelyris.event\n{event_id}"))
        .as_str()
        .to_string()
}

fn input_digest(consumer_id: &str, seq_wire: &str, event_id: &str) -> String {
    crate::command_risk::approval::command_hash(&format!(
        "aelyris.event-ack-input\n{consumer_id}\n{seq_wire}\n{event_id}"
    ))
    .as_str()
    .to_string()
}

fn error_code(error: &crate::event_bus::EventBusError) -> &'static str {
    match error {
        crate::event_bus::EventBusError::DurabilityUnavailable => "durability_unavailable",
        crate::event_bus::EventBusError::InvalidEventIdentity => "invalid_event_identity",
        crate::event_bus::EventBusError::InvalidConsumerIdentity => "invalid_consumer_identity",
        crate::event_bus::EventBusError::AppendFailed { .. } => "append_failed",
        crate::event_bus::EventBusError::QueryFailed { .. } => "query_failed",
        crate::event_bus::EventBusError::CorruptRow { .. } => "corrupt_row",
        crate::event_bus::EventBusError::StreamInvariant { .. } => "stream_invariant",
        crate::event_bus::EventBusError::CursorOutOfRange { .. } => "cursor_out_of_range",
        crate::event_bus::EventBusError::ConsumerCursorCorrupt { .. } => "consumer_cursor_corrupt",
        crate::event_bus::EventBusError::Gap { .. } => "event_gap",
        crate::event_bus::EventBusError::AckIdentityMismatch { .. } => "ack_identity_mismatch",
        crate::event_bus::EventBusError::AckRegression { .. } => "ack_regression",
    }
}

#[allow(clippy::too_many_arguments)]
fn audit(
    state: &ApiState,
    actor: &str,
    consumer_digest: &str,
    event_digest: &str,
    input_digest: &str,
    ack_seq: Option<i64>,
    outcome: Option<&str>,
    status: &str,
    rejection_code: Option<&str>,
    cursor_advanced: Option<bool>,
    already_acknowledged: Option<bool>,
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
        correlation_id: Some(consumer_digest.to_string()),
        kind: "mcp_event_ack_authority".to_string(),
        severity: if status == "accepted" {
            "info".to_string()
        } else {
            "warning".to_string()
        },
        source: "mcp-event-ack".to_string(),
        confidence: None,
        payload_json: serde_json::json!({
            "actor": actor,
            "operation": "ack",
            "consumerDigest": consumer_digest,
            "eventDigest": event_digest,
            "inputDigest": input_digest,
            "ackSeq": ack_seq,
            "outcome": outcome,
            "status": status,
            "rejectionCode": rejection_code,
            "cursorAdvanced": cursor_advanced,
            "alreadyAcknowledged": already_acknowledged,
            "deliveryValuesLogged": false,
        }),
    };
    if let Err(error) = db.with(|database| database.append_audit_journal_event(&event)) {
        tracing::error!(actor, consumer_digest, error = %error, "event acknowledgement audit failed");
    }
}

pub(super) fn acknowledge(
    state: &ApiState,
    actor: &str,
    args: &serde_json::Map<String, serde_json::Value>,
) -> ApiResult<Json<serde_json::Value>> {
    let actor = authenticated_actor(actor)?;
    let consumer_id = arg_string(args, "consumerId")?;
    let event_id = arg_string(args, "eventId")?;
    let seq_wire = args
        .get("seq")
        .map(serde_json::Value::to_string)
        .unwrap_or_else(|| "missing".to_string());
    let consumer_digest = consumer_digest(&consumer_id);
    let event_digest = event_digest(&event_id);
    let input_digest = input_digest(&consumer_id, &seq_wire, &event_id);
    let seq = match args.get("seq").and_then(serde_json::Value::as_i64) {
        Some(seq) if seq >= 1 => seq,
        _ => {
            audit(
                state,
                actor,
                &consumer_digest,
                &event_digest,
                &input_digest,
                None,
                None,
                "rejected",
                Some("invalid_ack_sequence"),
                Some(false),
                None,
            );
            return Err(ApiError::BadRequest(
                "seq must be an integer >= 1".to_string(),
            ));
        }
    };
    let Some(bus) = state.event_bus.as_ref() else {
        let error = crate::event_bus::EventBusError::DurabilityUnavailable;
        audit(
            state,
            actor,
            &consumer_digest,
            &event_digest,
            &input_digest,
            Some(seq),
            None,
            "rejected",
            Some(error_code(&error)),
            Some(false),
            None,
        );
        return Ok(event_bus_error_response("aelyris.event.ack", error));
    };
    let receipt = match bus.ack(&consumer_id, seq, &event_id) {
        Ok(receipt) => receipt,
        Err(error) => {
            audit(
                state,
                actor,
                &consumer_digest,
                &event_digest,
                &input_digest,
                Some(seq),
                Some("rejected"),
                "rejected",
                Some(error_code(&error)),
                Some(false),
                None,
            );
            return Ok(event_bus_error_response("aelyris.event.ack", error));
        }
    };
    let outcome = if receipt.already_acked {
        "already_acknowledged"
    } else {
        "advanced"
    };
    audit(
        state,
        actor,
        &consumer_digest,
        &event_digest,
        &input_digest,
        Some(receipt.ack_seq),
        Some(outcome),
        "accepted",
        None,
        Some(!receipt.already_acked),
        Some(receipt.already_acked),
    );
    Ok(Json(serde_json::json!({
        "schema": "aelyris.mcp.server.v1",
        "tool": "aelyris.event.ack",
        "ok": true,
        "result": { "ack": receipt },
    })))
}
