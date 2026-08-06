use serde::Serialize;

use crate::agent::{AgentActivity, AgentSessionInfo};

use super::super::ApiState;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct AgentActivityProjection {
    session_id: String,
    task_id: Option<String>,
    status: String,
    model: String,
    activity: Option<AgentActivity>,
}

pub(super) fn project_sessions(
    mut sessions: Vec<AgentSessionInfo>,
) -> Vec<AgentActivityProjection> {
    sessions.sort_by(|left, right| left.id.cmp(&right.id));
    sessions
        .into_iter()
        .map(|session| AgentActivityProjection {
            session_id: session.id,
            task_id: session.task_id,
            status: session.status,
            model: session.model,
            activity: session.current_activity,
        })
        .collect()
}

pub(super) fn get(state: &ApiState) -> serde_json::Value {
    let available = state.agent_manager.is_some();
    let fleet = state
        .agent_manager
        .as_ref()
        .map(|manager| project_sessions(manager.list_sessions()))
        .unwrap_or_default();
    let session_count = fleet.len();

    serde_json::json!({
        "available": available,
        "source": "rust-agent-manager",
        "sessionCount": session_count,
        "fleet": fleet,
        "activityTargetValuesExposed": true,
        "promptValuesExposed": false,
        "interactiveActivityInvented": false,
        "readOnly": true,
    })
}
