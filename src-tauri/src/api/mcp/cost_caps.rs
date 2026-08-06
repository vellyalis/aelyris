#[cfg(not(test))]
use tauri::Emitter;

use super::super::{ApiError, ApiResult, ApiState};

pub(super) fn get(state: &ApiState) -> ApiResult<serde_json::Value> {
    let manager = state.cost_manager.as_ref().ok_or_else(|| {
        ApiError::Internal("cost manager is not attached to this MCP process".to_string())
    })?;
    Ok(serde_json::json!({
        "caps": manager.caps(),
        "policy": manager.policy(),
        "source": "shared-cost-manager",
        "telemetryBoundary": "reported_aelyris_telemetry",
        "providerBillingClaimed": false,
        "unknownUsageZeroFilled": false,
        "readOnly": true,
    }))
}

fn required_usize(
    args: &serde_json::Map<String, serde_json::Value>,
    key: &str,
) -> ApiResult<usize> {
    let value = args
        .get(key)
        .and_then(serde_json::Value::as_u64)
        .ok_or_else(|| ApiError::BadRequest(format!("MCP argument `{key}` must be an integer")))?;
    usize::try_from(value)
        .map_err(|_| ApiError::BadRequest(format!("MCP argument `{key}` is too large")))
}

fn nullable_u64(
    args: &serde_json::Map<String, serde_json::Value>,
    key: &str,
) -> ApiResult<Option<u64>> {
    let value = args
        .get(key)
        .ok_or_else(|| ApiError::BadRequest(format!("MCP argument `{key}` is required")))?;
    if value.is_null() {
        return Ok(None);
    }
    value.as_u64().map(Some).ok_or_else(|| {
        ApiError::BadRequest(format!("MCP argument `{key}` must be integer or null"))
    })
}

fn nullable_f64(
    args: &serde_json::Map<String, serde_json::Value>,
    key: &str,
) -> ApiResult<Option<f64>> {
    let value = args
        .get(key)
        .ok_or_else(|| ApiError::BadRequest(format!("MCP argument `{key}` is required")))?;
    if value.is_null() {
        return Ok(None);
    }
    let number = value.as_f64().ok_or_else(|| {
        ApiError::BadRequest(format!("MCP argument `{key}` must be number or null"))
    })?;
    if !number.is_finite() || number < 0.0 {
        return Err(ApiError::BadRequest(format!(
            "MCP argument `{key}` must be finite and non-negative"
        )));
    }
    Ok(Some(number))
}

pub(super) fn can_spawn(
    state: &ApiState,
    args: &serde_json::Map<String, serde_json::Value>,
) -> ApiResult<serde_json::Value> {
    let manager = state.cost_manager.as_ref().ok_or_else(|| {
        ApiError::Internal("cost manager is not attached to this MCP process".to_string())
    })?;
    let active_agents = required_usize(args, "active_agents")?;
    let tokens_used = nullable_u64(args, "tokens_used")?;
    let cost_usd = nullable_f64(args, "cost_usd")?;
    let runtime_secs = nullable_u64(args, "runtime_secs")?;
    let caps = manager.caps();

    let mut enabled_axes = vec!["active_agents"];
    let mut unknown_axes = Vec::new();
    let mut ignored_unknown_axes = Vec::new();
    for (axis, cap_enabled, known) in [
        (
            "tokens_used",
            caps.max_tokens.is_some(),
            tokens_used.is_some(),
        ),
        ("cost_usd", caps.max_cost_usd.is_some(), cost_usd.is_some()),
        (
            "runtime_secs",
            caps.max_runtime_secs.is_some(),
            runtime_secs.is_some(),
        ),
    ] {
        if cap_enabled {
            enabled_axes.push(axis);
            if !known {
                unknown_axes.push(axis);
            }
        } else if !known {
            ignored_unknown_axes.push(axis);
        }
    }

    let usage_projection = serde_json::json!({
        "active_agents": active_agents,
        "tokens_used": tokens_used,
        "cost_usd": cost_usd,
        "runtime_secs": runtime_secs,
    });
    if !unknown_axes.is_empty() {
        return Ok(serde_json::json!({
            "evaluable": false,
            "decision": null,
            "enabledAxes": enabled_axes,
            "unknownAxes": unknown_axes,
            "ignoredUnknownAxes": ignored_unknown_axes,
            "reportedUsage": usage_projection,
            "source": "shared-cost-manager",
            "telemetryBoundary": "reported_aelyris_telemetry",
            "providerBillingClaimed": false,
            "unknownUsageZeroFilled": false,
            "readOnly": true,
        }));
    }

    let decision = manager.can_spawn(&crate::cost::CostUsage {
        active_agents,
        tokens_used: tokens_used.unwrap_or(0),
        cost_usd: cost_usd.unwrap_or(0.0),
        runtime_secs: runtime_secs.unwrap_or(0),
    });
    Ok(serde_json::json!({
        "evaluable": true,
        "decision": decision,
        "enabledAxes": enabled_axes,
        "unknownAxes": [],
        "ignoredUnknownAxes": ignored_unknown_axes,
        "reportedUsage": usage_projection,
        "source": "shared-cost-manager",
        "telemetryBoundary": "reported_aelyris_telemetry",
        "providerBillingClaimed": false,
        "unknownUsageZeroFilled": false,
        "readOnly": true,
    }))
}

fn authenticated_actor(actor: &str) -> ApiResult<&str> {
    let actor = actor.trim();
    if actor.is_empty() {
        Err(ApiError::Forbidden(
            "authenticated cost-cap mutation Principal is unavailable".to_string(),
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

fn value_digest(label: &str, value: &serde_json::Value) -> String {
    let canonical = canonicalize(value);
    let encoded = serde_json::to_string(&canonical).unwrap_or_else(|_| "null".to_string());
    crate::command_risk::approval::command_hash(&format!("aelyris.cost-caps-{label}\n{encoded}"))
        .as_str()
        .to_string()
}

fn parse_caps(value: &serde_json::Value, field: &str) -> ApiResult<crate::cost::CostCaps> {
    serde_json::from_value(value.clone())
        .map_err(|error| ApiError::BadRequest(format!("invalid_cost_caps_input: {field}: {error}")))
}

fn audit(
    state: &ApiState,
    actor: &str,
    expected_digest: &str,
    replacement_digest: &str,
    outcome: Option<&str>,
    changed: Option<bool>,
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
        correlation_id: Some(expected_digest.to_string()),
        kind: "mcp_cost_caps_mutation_authority".to_string(),
        severity: if status == "accepted" {
            "info".to_string()
        } else {
            "warning".to_string()
        },
        source: "mcp-cost-caps-mutation".to_string(),
        confidence: None,
        payload_json: serde_json::json!({
            "actor": actor,
            "operation": "set_caps",
            "expectedDigest": expected_digest,
            "replacementDigest": replacement_digest,
            "outcome": outcome,
            "changed": changed,
            "status": status,
            "rejectionCode": rejection_code,
            "capValuesLogged": false,
            "providerUsageLogged": false,
            "providerBillingClaimed": false,
            "unknownUsageZeroFilled": false,
        }),
    };
    if let Err(error) = db.with(|database| database.append_audit_journal_event(&event)) {
        tracing::error!(actor, expected_digest, error = %error, "cost cap mutation audit failed");
    }
}

fn map_update_error(error: crate::cost::CostCapsUpdateError) -> ApiError {
    match error {
        crate::cost::CostCapsUpdateError::Validation(error) => {
            ApiError::BadRequest(error.to_string())
        }
        crate::cost::CostCapsUpdateError::Persistence(error) => {
            ApiError::Internal(error.to_string())
        }
        crate::cost::CostCapsUpdateError::Conflict(error) => ApiError::Conflict(error.to_string()),
    }
}

pub(super) fn set(
    state: &ApiState,
    actor: &str,
    args: &serde_json::Map<String, serde_json::Value>,
) -> ApiResult<serde_json::Value> {
    let actor = authenticated_actor(actor)?;
    let expected_value = args
        .get("expectedCaps")
        .cloned()
        .unwrap_or(serde_json::Value::Null);
    let replacement_value = args.get("caps").cloned().unwrap_or(serde_json::Value::Null);
    let expected_digest = value_digest("expected", &expected_value);
    let replacement_digest = value_digest("replacement", &replacement_value);
    let expected = match parse_caps(&expected_value, "expectedCaps") {
        Ok(value) => value,
        Err(error) => {
            audit(
                state,
                actor,
                &expected_digest,
                &replacement_digest,
                None,
                Some(false),
                "rejected",
                Some("cost_caps_input_invalid"),
            );
            return Err(error);
        }
    };
    let replacement = match parse_caps(&replacement_value, "caps") {
        Ok(value) => value,
        Err(error) => {
            audit(
                state,
                actor,
                &expected_digest,
                &replacement_digest,
                None,
                Some(false),
                "rejected",
                Some("cost_caps_input_invalid"),
            );
            return Err(error);
        }
    };
    let manager = match state.cost_manager.as_ref() {
        Some(manager) => manager,
        None => {
            audit(
                state,
                actor,
                &expected_digest,
                &replacement_digest,
                None,
                Some(false),
                "rejected",
                Some("cost_manager_unavailable"),
            );
            return Err(ApiError::Internal(
                "cost manager is not attached to this MCP process".to_string(),
            ));
        }
    };

    let outcome = match manager.set_caps_if_current(expected, replacement) {
        Ok(outcome) => outcome,
        Err(error) => {
            let rejection_code = match &error {
                crate::cost::CostCapsUpdateError::Validation(_) => "invalid_cost_caps",
                crate::cost::CostCapsUpdateError::Persistence(_) => "cost_caps_persistence_failed",
                crate::cost::CostCapsUpdateError::Conflict(_) => "stale_cost_caps",
            };
            audit(
                state,
                actor,
                &expected_digest,
                &replacement_digest,
                Some(match &error {
                    crate::cost::CostCapsUpdateError::Validation(_) => "validation_failed",
                    crate::cost::CostCapsUpdateError::Persistence(_) => "persistence_failed",
                    crate::cost::CostCapsUpdateError::Conflict(_) => "stale",
                }),
                Some(false),
                "rejected",
                Some(rejection_code),
            );
            return Err(map_update_error(error));
        }
    };

    #[cfg(not(test))]
    if outcome.changed {
        if let Some(app) = state.app_handle.as_ref() {
            let _ = app.emit(crate::ipc::COST_CAPS_UPDATED, outcome.caps);
        }
    }
    audit(
        state,
        actor,
        &expected_digest,
        &replacement_digest,
        Some(if outcome.changed {
            "updated"
        } else {
            "unchanged"
        }),
        Some(outcome.changed),
        "accepted",
        None,
    );
    Ok(serde_json::json!({
        "caps": outcome.caps,
        "policy": manager.policy(),
        "changed": outcome.changed,
        "source": "shared-cost-manager",
        "telemetryBoundary": "reported_aelyris_telemetry",
        "providerBillingClaimed": false,
        "unknownUsageZeroFilled": false,
    }))
}
