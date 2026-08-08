use super::super::{ApiError, ApiResult, ApiState};
use super::dispatch::arg_string;

const ALLOWED_ARGUMENTS: &[&str] = &["repoPath"];
const MAX_REPOSITORY_PATH_CHARS: usize = 4_096;

fn authenticated_actor(actor: &str) -> ApiResult<&str> {
    let actor = actor.trim();
    if actor.is_empty() {
        Err(ApiError::Forbidden(
            "authenticated Mission run-next Principal is unavailable".to_string(),
        ))
    } else {
        Ok(actor)
    }
}

fn validate_arguments(args: &serde_json::Map<String, serde_json::Value>) -> ApiResult<()> {
    if let Some(bad) = args
        .keys()
        .find(|key| !ALLOWED_ARGUMENTS.contains(&key.as_str()))
    {
        return Err(ApiError::BadRequest(format!(
            "aelyris.mission.run_next does not accept `{bad}`; Mission, task, usage, model, command, branch, gate, reviewer, merge, and packet authority are backend-owned"
        )));
    }
    Ok(())
}

fn bounded_repository_path(repo_path: &str) -> ApiResult<()> {
    if repo_path.chars().count() > MAX_REPOSITORY_PATH_CHARS {
        Err(ApiError::BadRequest(format!(
            "MCP argument `repoPath` exceeds the {MAX_REPOSITORY_PATH_CHARS}-character bound"
        )))
    } else {
        Ok(())
    }
}

fn digest(label: &str, value: &str) -> String {
    crate::command_risk::approval::command_hash(&format!("{label}\n{value}"))
        .as_str()
        .to_string()
}

fn repository_digest(repo_path: &str) -> String {
    digest("aelyris.mission-run-next-repository", repo_path)
}

fn input_digest(repo_path: &str) -> String {
    digest("aelyris.mission-run-next-input", repo_path)
}

#[cfg(not(test))]
fn now_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}

fn loop_state_name(state: crate::orchestrator::LoopState) -> &'static str {
    match state {
        crate::orchestrator::LoopState::Active => "active",
        crate::orchestrator::LoopState::Complete => "complete",
        crate::orchestrator::LoopState::Stalled => "stalled",
        crate::orchestrator::LoopState::HaltedByBudget => "halted_by_budget",
    }
}

#[derive(Debug, Clone)]
struct AdmissionFacts {
    usage: crate::cost::CostUsage,
    decision: crate::cost::SpawnDecision,
}

fn derive_admission(
    snapshot: crate::control::pane_fleet::PaneFleetUsageSnapshot,
    caps: &crate::cost::CostCaps,
) -> ApiResult<AdmissionFacts> {
    let mut unknown = Vec::new();
    if caps.max_tokens.is_some() {
        unknown.push("tokens");
    }
    if caps.max_cost_usd.is_some() {
        unknown.push("cost");
    }
    if !unknown.is_empty() {
        return Err(ApiError::TelemetryUnavailable(format!(
            "mission_run_next_budget_telemetry_unknown: configured {} telemetry is not owned by PaneFleet",
            unknown.join(",")
        )));
    }

    // Disabled token/cost axes may safely carry zero because they cannot affect
    // admission. Agent count and maximum visible runtime are exact PaneFleet
    // facts. A configured runtime cap therefore remains fully enforceable.
    let usage = crate::cost::CostUsage {
        active_agents: snapshot.active_agents,
        tokens_used: 0,
        cost_usd: 0.0,
        runtime_secs: snapshot.runtime_secs,
    };
    Ok(AdmissionFacts {
        decision: caps.can_spawn(&usage),
        usage,
    })
}

fn rejection_code(error: &str) -> &'static str {
    if error.contains("budget_telemetry_unknown") {
        "budget_telemetry_unknown"
    } else if error.contains("accepted_cockpit_mission_not_found") {
        "accepted_mission_not_found"
    } else if error.contains("outside the accepted cockpit Mission")
        || error.contains("TaskGraph binding")
    {
        "mission_taskgraph_mismatch"
    } else if error.contains("startup_reconciliation_pending") {
        "startup_reconciliation_pending"
    } else if error.contains("startup_reconciliation_failed") {
        "startup_reconciliation_failed"
    } else if error.contains("not attached") || error.contains("unavailable") {
        "runtime_owner_unavailable"
    } else if error.contains("repo path") || error.contains("repository") {
        "repository_invalid"
    } else if error.contains("review boundary") {
        "review_boundary_violation"
    } else {
        "mission_run_next_failed"
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
    outcome: Option<&str>,
    loop_state: Option<&str>,
    admission_evaluable: bool,
    blocked_by: Option<&str>,
    dispatched_count: Option<usize>,
    recovered_count: Option<usize>,
    review_ready_count: Option<usize>,
    attention_count: Option<usize>,
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
        kind: "mcp_mission_run_next_authority".to_string(),
        severity: if status == "accepted" {
            "info".to_string()
        } else {
            "warning".to_string()
        },
        source: "mcp-mission-run-next".to_string(),
        confidence: None,
        payload_json: serde_json::json!({
            "actor": actor,
            "operation": "run_next",
            "repositoryDigest": repository_digest,
            "inputDigest": input_digest,
            "status": status,
            "rejectionCode": rejection_code,
            "outcome": outcome,
            "loopState": loop_state,
            "admissionEvaluable": admission_evaluable,
            "blockedBy": blocked_by,
            "dispatchedCount": dispatched_count,
            "recoveredCount": recovered_count,
            "reviewReadyCount": review_ready_count,
            "attentionCount": attention_count,
            "visibleRuntime": true,
            "callerSuppliedUsage": false,
            "callerSuppliedTaskIdentity": false,
            "callerSuppliedModelOrCommand": false,
            "callerSuppliedReviewOrMergeAuthority": false,
            "reviewInvoked": false,
            "mergeInvoked": false,
            "settlementInvoked": false,
            "repositoryPathLogged": false,
            "taskIdentityLogged": false,
            "terminalIdentityLogged": false,
            "rawUsageLogged": false,
            "promptOrCommandLogged": false,
        }),
    };
    if let Err(error) = db.with(|database| database.append_audit_journal_event(&event)) {
        tracing::error!(actor, repository_digest, error = %error, "Mission run-next audit failed");
    }
}

fn project_report(
    report: crate::orchestrator::autonomy::StepReport,
    decision: &crate::cost::SpawnDecision,
    review_ready_task_ids: Vec<String>,
) -> ApiResult<serde_json::Value> {
    if !report.merged.is_empty() || !report.settlement_pending.is_empty() {
        return Err(ApiError::Internal(
            "Mission run-next crossed the independent review boundary".to_string(),
        ));
    }

    let escalated_task_ids = report
        .escalations
        .iter()
        .map(|entry| entry.task_id.clone())
        .collect::<Vec<_>>();
    let mut attention_task_ids = report.rejected.clone();
    attention_task_ids.extend(escalated_task_ids.iter().cloned());
    attention_task_ids.sort();
    attention_task_ids.dedup();

    let dispatched_count = report.dispatched.len();
    let recovered_count = report.recovered.len();
    let review_ready_count = review_ready_task_ids.len();
    let attention_count = attention_task_ids.len();

    let outcome = if !report.dispatched.is_empty() {
        "dispatched"
    } else if !report.recovered.is_empty() {
        "recovered"
    } else if !review_ready_task_ids.is_empty() {
        "awaiting_review"
    } else if !attention_task_ids.is_empty() {
        "attention_required"
    } else if report.state == crate::orchestrator::LoopState::Complete {
        "complete"
    } else if !decision.allowed {
        "admission_blocked"
    } else {
        "no_change"
    };
    let blocked_by = decision.blocked_by.map(crate::cost::CostLimit::as_str);

    Ok(serde_json::json!({
        "outcome": outcome,
        "step": {
            "loopState": loop_state_name(report.state),
            "dispatchedTaskIds": report.dispatched,
            "recoveredTaskIds": report.recovered,
            "reviewReadyTaskIds": review_ready_task_ids,
            "attentionTaskIds": attention_task_ids,
            "counts": {
                "dispatched": dispatched_count,
                "recovered": recovered_count,
                "reviewReady": review_ready_count,
                "attention": attention_count,
            },
        },
        "admission": {
            "source": "pane-fleet+cost-manager",
            "evaluable": true,
            "allowed": decision.allowed,
            "blockedBy": blocked_by,
            "agentTelemetry": "exact",
            "runtimeTelemetry": "exact",
            "tokenTelemetry": "not_required",
            "costTelemetry": "not_required",
            "callerSuppliedUsage": false,
            "rawUsageReturned": false,
        },
        "runtime": {
            "visiblePty": true,
            "paneFleetOwnerReused": true,
            "headlessDispatcherUsed": false,
            "onePanePerAgent": true,
        },
        "boundaries": {
            "callerSuppliedTaskIdentity": false,
            "callerSuppliedModelOrCommand": false,
            "callerSuppliedReviewOrMergeAuthority": false,
            "reviewInvoked": false,
            "mergeInvoked": false,
            "settlementInvoked": false,
            "repositoryPathExposed": false,
            "worktreePathsExposed": false,
            "terminalIdsExposed": false,
            "promptsOrCommandsExposed": false,
            "providerOutputExposed": false,
            "rawUsageExposed": false,
            "reviewEvidenceExposed": false,
            "oidValuesExposed": false,
            "packetContentsExposed": false,
        }
    }))
}

#[cfg(not(test))]
fn execute_attached(state: &ApiState, repo_path: String) -> ApiResult<serde_json::Value> {
    use std::sync::{Arc, Mutex};
    use tauri::Manager;

    let app = state.app_handle.clone().ok_or_else(|| {
        ApiError::Internal(
            "visible Mission run-next runtime is not attached to this MCP process".to_string(),
        )
    })?;
    let tasks = app
        .try_state::<Arc<crate::task::TaskManager>>()
        .ok_or_else(|| ApiError::Internal("task graph is not attached".to_string()))?;
    let startup = app
        .try_state::<Arc<crate::startup_reconciliation::StartupReconciliationState>>()
        .ok_or_else(|| {
            ApiError::Internal("startup reconciliation barrier is not attached".to_string())
        })?;
    let cost = app
        .try_state::<Arc<crate::cost::CostManager>>()
        .ok_or_else(|| ApiError::Internal("cost manager is not attached".to_string()))?;
    let fleet = app
        .try_state::<crate::control::pane_fleet::PaneFleet>()
        .ok_or_else(|| ApiError::Internal("visible pane fleet is not attached".to_string()))?;
    let bus = app
        .try_state::<Arc<crate::event_bus::EventBus>>()
        .ok_or_else(|| ApiError::Internal("event bus is not attached".to_string()))?;
    let ownership = app
        .try_state::<Arc<Mutex<crate::file_ownership::FileOwnership>>>()
        .ok_or_else(|| ApiError::Internal("file ownership is not attached".to_string()))?;
    let symbol_ownership = app
        .try_state::<Arc<Mutex<crate::symbol_ownership::SymbolOwnership>>>()
        .ok_or_else(|| ApiError::Internal("symbol ownership is not attached".to_string()))?;
    let context = app
        .try_state::<Arc<crate::context_store::ContextStoreManager>>()
        .ok_or_else(|| ApiError::Internal("context store is not attached".to_string()))?;
    let merge_store = app
        .try_state::<Option<Arc<crate::merge_intent::store::MergeIntentStore>>>()
        .ok_or_else(|| ApiError::Internal("merge persistence is not attached".to_string()))?;

    let facts = derive_admission(fleet.admission_usage_snapshot(now_secs()), &cost.caps())?;
    let report = crate::ipc::orchestrator_step(
        app.clone(),
        tasks.clone(),
        startup,
        cost,
        fleet,
        bus,
        ownership,
        symbol_ownership,
        context,
        merge_store,
        facts.usage,
        repo_path,
    )
    .map_err(|error| {
        if error.contains("repo path") || error.contains("repository") {
            ApiError::BadRequest(error)
        } else {
            ApiError::Internal(error)
        }
    })?;
    let review_ready_task_ids = tasks
        .list()
        .into_iter()
        .filter(|task| task.status == crate::task::TaskStatus::Review)
        .map(|task| task.id)
        .collect::<Vec<_>>();
    project_report(report, &facts.decision, review_ready_task_ids)
}

#[cfg(test)]
fn execute_attached(_state: &ApiState, _repo_path: String) -> ApiResult<serde_json::Value> {
    Err(ApiError::Internal(
        "visible Mission run-next runtime is not attached to this MCP process".to_string(),
    ))
}

pub(super) fn execute(
    state: &ApiState,
    actor: &str,
    args: &serde_json::Map<String, serde_json::Value>,
) -> ApiResult<serde_json::Value> {
    let actor = authenticated_actor(actor)?;
    validate_arguments(args)?;
    let repo_path = arg_string(args, "repoPath")?;
    bounded_repository_path(&repo_path)?;
    let repository_digest = repository_digest(&repo_path);
    let input_digest = input_digest(&repo_path);

    let result = (|| {
        let current = super::mission_continuity::read_current(state, &repo_path)?;
        if current.get("found").and_then(serde_json::Value::as_bool) != Some(true) {
            return Err(ApiError::BadRequest(
                "accepted_cockpit_mission_not_found".to_string(),
            ));
        }
        execute_attached(state, repo_path)
    })();

    match result {
        Ok(value) => {
            let outcome = value.get("outcome").and_then(serde_json::Value::as_str);
            let loop_state = value
                .pointer("/step/loopState")
                .and_then(serde_json::Value::as_str);
            let blocked_by = value
                .pointer("/admission/blockedBy")
                .and_then(serde_json::Value::as_str);
            let count = |pointer: &str| {
                value
                    .pointer(pointer)
                    .and_then(serde_json::Value::as_u64)
                    .and_then(|value| usize::try_from(value).ok())
            };
            audit(
                state,
                actor,
                &repository_digest,
                &input_digest,
                "accepted",
                None,
                outcome,
                loop_state,
                true,
                blocked_by,
                count("/step/counts/dispatched"),
                count("/step/counts/recovered"),
                count("/step/counts/reviewReady"),
                count("/step/counts/attention"),
            );
            Ok(value)
        }
        Err(error) => {
            let message = error.to_string();
            audit(
                state,
                actor,
                &repository_digest,
                &input_digest,
                "rejected",
                Some(rejection_code(&message)),
                None,
                None,
                !message.contains("budget_telemetry_unknown"),
                None,
                None,
                None,
                None,
                None,
            );
            Err(error)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn caller_cannot_shape_usage_task_or_review_authority() {
        for forbidden in [
            "activeAgents",
            "tokensUsed",
            "costUsd",
            "runtimeSecs",
            "taskId",
            "model",
            "command",
            "branch",
            "gates",
            "reviewerId",
            "verdict",
            "mergeToken",
            "workPacket",
        ] {
            let mut args = serde_json::Map::new();
            args.insert("repoPath".to_string(), serde_json::json!("C:/repo"));
            args.insert(forbidden.to_string(), serde_json::json!("caller-value"));
            assert!(matches!(
                validate_arguments(&args),
                Err(ApiError::BadRequest(message)) if message.contains(forbidden)
            ));
        }
    }

    #[test]
    fn admission_uses_exact_visible_facts_and_enforces_runtime() {
        let caps = crate::cost::CostCaps {
            max_agents: Some(4),
            max_tokens: None,
            max_cost_usd: None,
            max_runtime_secs: Some(30),
        };
        let within = derive_admission(
            crate::control::pane_fleet::PaneFleetUsageSnapshot {
                active_agents: 2,
                runtime_secs: 29,
            },
            &caps,
        )
        .expect("exact runtime is evaluable");
        assert_eq!(within.usage.active_agents, 2);
        assert_eq!(within.usage.runtime_secs, 29);
        assert!(within.decision.allowed);

        let blocked = derive_admission(
            crate::control::pane_fleet::PaneFleetUsageSnapshot {
                active_agents: 2,
                runtime_secs: 30,
            },
            &caps,
        )
        .expect("exact runtime remains evaluable at cap");
        assert!(!blocked.decision.allowed);
        assert_eq!(
            blocked.decision.blocked_by,
            Some(crate::cost::CostLimit::Runtime)
        );
    }

    #[test]
    fn configured_token_or_cost_caps_fail_closed_without_owned_telemetry() {
        for caps in [
            crate::cost::CostCaps {
                max_agents: Some(4),
                max_tokens: Some(1),
                max_cost_usd: None,
                max_runtime_secs: None,
            },
            crate::cost::CostCaps {
                max_agents: Some(4),
                max_tokens: None,
                max_cost_usd: Some(1.0),
                max_runtime_secs: None,
            },
        ] {
            assert!(matches!(
                derive_admission(
                    crate::control::pane_fleet::PaneFleetUsageSnapshot {
                        active_agents: 0,
                        runtime_secs: 0,
                    },
                    &caps,
                ),
                Err(ApiError::TelemetryUnavailable(message))
                    if message.contains("budget_telemetry_unknown")
            ));
        }
    }

    #[test]
    fn projection_refuses_review_merge_or_settlement_crossing() {
        let report = crate::orchestrator::autonomy::StepReport {
            dispatched: Vec::new(),
            merged: vec!["task-1".to_string()],
            settlement_pending: Vec::new(),
            rejected: Vec::new(),
            recovered: Vec::new(),
            escalations: Vec::new(),
            state: crate::orchestrator::LoopState::Active,
        };
        let decision = crate::cost::CostCaps::default().can_spawn(&Default::default());
        assert!(matches!(
            project_report(report, &decision, Vec::new()),
            Err(ApiError::Internal(message)) if message.contains("review boundary")
        ));
    }
}
