use super::super::{ApiError, ApiResult, ApiState};
use super::dispatch::{arg_string, arg_usize};

fn authenticated_actor(actor: &str) -> ApiResult<&str> {
    let actor = actor.trim();
    if actor.is_empty() {
        Err(ApiError::Forbidden(
            "authenticated orchestrator-step Principal is unavailable".to_string(),
        ))
    } else {
        Ok(actor)
    }
}

fn repository_digest(repo_path: &str) -> String {
    crate::command_risk::approval::command_hash(&format!(
        "aelyris.orchestrator-repository\n{repo_path}"
    ))
    .as_str()
    .to_string()
}

fn input_digest(repo_path: &str, active_agents: usize) -> String {
    crate::command_risk::approval::command_hash(&format!(
        "aelyris.orchestrator-step-input\n{repo_path}\n{active_agents}"
    ))
    .as_str()
    .to_string()
}

fn loop_state_name(state: crate::orchestrator::LoopState) -> &'static str {
    match state {
        crate::orchestrator::LoopState::Active => "active",
        crate::orchestrator::LoopState::Complete => "complete",
        crate::orchestrator::LoopState::Stalled => "stalled",
        crate::orchestrator::LoopState::HaltedByBudget => "halted_by_budget",
    }
}

fn rejection_code(error: &str) -> &'static str {
    if error.contains("startup_reconciliation_pending") {
        "startup_reconciliation_pending"
    } else if error.contains("startup_reconciliation_failed") {
        "startup_reconciliation_failed"
    } else if error.contains("repo path must exist")
        || error.contains("repo path must be a directory")
    {
        "repository_path_invalid"
    } else if error.contains("mutation in progress") {
        "task_graph_mutation_in_progress"
    } else {
        "orchestrator_step_failed"
    }
}

#[allow(clippy::too_many_arguments)]
fn audit(
    state: &ApiState,
    actor: &str,
    repository_digest: &str,
    input_digest: &str,
    status: &str,
    rejection_code: Option<&str>,
    report_state: Option<&str>,
    dispatched: Option<usize>,
    merged: Option<usize>,
    settlement_pending: Option<usize>,
    rejected: Option<usize>,
    recovered: Option<usize>,
    escalations: Option<usize>,
    report_produced: bool,
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
        correlation_id: Some(repository_digest.to_string()),
        kind: "mcp_orchestrator_step_authority".to_string(),
        severity: if status == "accepted" {
            "info".to_string()
        } else {
            "warning".to_string()
        },
        source: "mcp-orchestrator-step".to_string(),
        confidence: None,
        payload_json: serde_json::json!({
            "actor": actor,
            "operation": "run_step",
            "repositoryDigest": repository_digest,
            "inputDigest": input_digest,
            "status": status,
            "rejectionCode": rejection_code,
            "reportState": report_state,
            "dispatchedCount": dispatched,
            "mergedCount": merged,
            "settlementPendingCount": settlement_pending,
            "rejectedCount": rejected,
            "recoveredCount": recovered,
            "escalationCount": escalations,
            "reportProduced": report_produced,
            "executionValuesLogged": false,
        }),
    };
    if let Err(error) = db.with(|database| database.append_audit_journal_event(&event)) {
        tracing::error!(actor, repository_digest, error = %error, "orchestrator-step audit failed");
    }
}

fn missing_owner(
    state: &ApiState,
    actor: &str,
    repository_digest: &str,
    input_digest: &str,
    code: &'static str,
    message: &'static str,
) -> ApiError {
    audit(
        state,
        actor,
        repository_digest,
        input_digest,
        "rejected",
        Some(code),
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        false,
    );
    ApiError::Internal(message.to_string())
}

pub(super) fn execute(
    state: &ApiState,
    actor: &str,
    args: &serde_json::Map<String, serde_json::Value>,
) -> ApiResult<serde_json::Value> {
    let actor = authenticated_actor(actor)?;
    let repo_path = arg_string(args, "repoPath")?;
    let active_agents = arg_usize(args, "activeAgents", 0)?;
    let repository_digest = repository_digest(&repo_path);
    let input_digest = input_digest(&repo_path, active_agents);

    let startup = state.startup_reconciliation.as_ref().ok_or_else(|| {
        missing_owner(
            state,
            actor,
            &repository_digest,
            &input_digest,
            "startup_reconciliation_unavailable",
            "startup reconciliation barrier is not attached to this process",
        )
    })?;
    let tasks = state.task_manager.as_ref().ok_or_else(|| {
        missing_owner(
            state,
            actor,
            &repository_digest,
            &input_digest,
            "task_graph_unavailable",
            "task graph is not attached to this process",
        )
    })?;
    let cost = state.cost_manager.as_ref().ok_or_else(|| {
        missing_owner(
            state,
            actor,
            &repository_digest,
            &input_digest,
            "cost_manager_unavailable",
            "cost manager is not attached to this process",
        )
    })?;
    let agents = state.agent_manager.as_ref().ok_or_else(|| {
        missing_owner(
            state,
            actor,
            &repository_digest,
            &input_digest,
            "agent_runtime_unavailable",
            "agent runtime is not attached to this process",
        )
    })?;
    let ownership = state.file_ownership.as_ref().ok_or_else(|| {
        missing_owner(
            state,
            actor,
            &repository_digest,
            &input_digest,
            "file_ownership_unavailable",
            "file ownership is not attached to this process",
        )
    })?;
    let events = state.event_bus.as_ref().ok_or_else(|| {
        missing_owner(
            state,
            actor,
            &repository_digest,
            &input_digest,
            "event_bus_unavailable",
            "event bus is not attached to this process",
        )
    })?;
    let context = state.context_store.as_ref().ok_or_else(|| {
        missing_owner(
            state,
            actor,
            &repository_digest,
            &input_digest,
            "context_store_unavailable",
            "context store is not attached to this process",
        )
    })?;
    let usage = crate::cost::CostUsage {
        active_agents,
        ..Default::default()
    };
    let report = match crate::control::loop_ports::run_step(
        startup,
        tasks,
        cost,
        agents,
        ownership,
        state.symbol_ownership.clone(),
        events,
        context,
        &usage,
        repo_path,
        "mcp-dispatch-only".to_string(),
        std::collections::HashMap::new(),
        std::collections::HashMap::new(),
        None,
        state.merge_store.clone(),
        state.db.as_deref(),
    ) {
        Ok(report) => report,
        Err(error) => {
            let code = rejection_code(&error);
            audit(
                state,
                actor,
                &repository_digest,
                &input_digest,
                "rejected",
                Some(code),
                None,
                None,
                None,
                None,
                None,
                None,
                None,
                false,
            );
            return Err(ApiError::Internal(error));
        }
    };
    audit(
        state,
        actor,
        &repository_digest,
        &input_digest,
        "accepted",
        None,
        Some(loop_state_name(report.state)),
        Some(report.dispatched.len()),
        Some(report.merged.len()),
        Some(report.settlement_pending.len()),
        Some(report.rejected.len()),
        Some(report.recovered.len()),
        Some(report.escalations.len()),
        true,
    );
    Ok(serde_json::json!({ "report": report }))
}
