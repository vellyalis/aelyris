use serde::Serialize;

use crate::agent::context_lifecycle::ContextRemaining;
use crate::agent::{AgentRunMode, AgentRunStatus, AgentSession};

use super::super::ApiState;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct FleetSessionProjection {
    id: String,
    logical_session_id: Option<String>,
    run_mode: AgentRunMode,
    status: AgentRunStatus,
    model: String,
    cost: f64,
    tokens_used: u64,
    started_at: Option<u64>,
    last_activity: Option<u64>,
    turn_count: Option<u64>,
    context_remaining: Option<ContextRemaining>,
    cli: Option<String>,
    backend: Option<String>,
    pty_id: Option<String>,
    short_id: Option<u32>,
    predecessor_session_id: Option<String>,
    lineage_count: usize,
    approval_pending: bool,
    worktree_attached: bool,
    repository_attached: bool,
}

pub(super) fn project_session(session: AgentSession) -> FleetSessionProjection {
    FleetSessionProjection {
        id: session.id,
        logical_session_id: session.logical_session_id,
        run_mode: session.run_mode,
        status: session.status,
        model: session.model,
        cost: session.cost,
        tokens_used: session.tokens_used,
        started_at: session.started_at,
        last_activity: session.last_activity,
        turn_count: session.turn_count,
        context_remaining: session.context_remaining,
        cli: session.cli,
        backend: session.backend,
        pty_id: session.pty_id,
        short_id: session.short_id,
        predecessor_session_id: session.predecessor_session_id,
        lineage_count: session.lineage.len(),
        approval_pending: session.approval_prompt.is_some(),
        worktree_attached: session.worktree_path.is_some() || session.worktree_branch.is_some(),
        repository_attached: session.repo_path.is_some(),
    }
}

pub(super) fn get(state: &ApiState) -> serde_json::Value {
    let available = state.agent_manager.is_some();
    let sessions = state
        .agent_manager
        .as_ref()
        .map(crate::control::agent::list_headless)
        .unwrap_or_default()
        .into_iter()
        .map(project_session)
        .collect::<Vec<_>>();

    serde_json::json!({
        "available": available,
        "source": "rust-agent-manager",
        "sessions": sessions,
        "telemetryBoundary": "reported_aelyris_telemetry",
        "providerBillingClaimed": false,
        "promptValuesExposed": false,
        "workspacePathsExposed": false,
        "readOnly": true,
    })
}
