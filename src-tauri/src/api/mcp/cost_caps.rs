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
