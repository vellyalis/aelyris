use super::super::{ApiError, ApiResult, ApiState};
use super::dispatch::arg_string;

const ALLOWED_ARGUMENTS: &[&str] = &["repoPath", "taskId"];

fn authenticated_actor(actor: &str) -> ApiResult<&str> {
    let actor = actor.trim();
    if actor.is_empty() {
        Err(ApiError::Forbidden(
            "authenticated Mission settlement Principal is unavailable".to_string(),
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
            "aelyris.mission.review_and_settle does not accept `{bad}`; review, OID, merge, and packet authority are backend-owned"
        )));
    }
    Ok(())
}

fn digest(label: &str, value: &str) -> String {
    crate::command_risk::approval::command_hash(&format!("{label}\n{value}"))
        .as_str()
        .to_string()
}

fn repository_digest(repo_path: &str) -> String {
    digest("aelyris.mission-settlement-repository", repo_path)
}

fn task_digest(task_id: &str) -> String {
    digest("aelyris.mission-settlement-task", task_id)
}

fn input_digest(repo_path: &str, task_id: &str) -> String {
    digest(
        "aelyris.mission-review-and-settle-input",
        &format!("{repo_path}\n{task_id}"),
    )
}

fn rejection_code(error: &str) -> &'static str {
    if error.contains("startup_reconciliation_pending") {
        "startup_reconciliation_pending"
    } else if error.contains("startup_reconciliation_failed") {
        "startup_reconciliation_failed"
    } else if error.contains("not attached") || error.contains("unavailable") {
        "runtime_owner_unavailable"
    } else if error.contains("unknown task") || error.contains("no activation") {
        "task_not_found_or_unbound"
    } else if error.contains("not in review")
        || error.contains("review candidate")
        || error.contains("no exact gate evidence")
    {
        "task_not_review_ready"
    } else if error.contains("reviewer") {
        "independent_review_failed"
    } else if error.contains("merge") {
        "exact_oid_merge_failed"
    } else if error.contains("settlement") || error.contains("packet") {
        "mission_settlement_failed"
    } else {
        "mission_review_and_settle_failed"
    }
}

#[allow(clippy::too_many_arguments)]
fn audit(
    state: &ApiState,
    actor: &str,
    repository_digest: &str,
    task_digest: &str,
    input_digest: &str,
    status: &str,
    rejection_code: Option<&str>,
    outcome: Option<&str>,
    review_accepted: Option<bool>,
    merged: Option<bool>,
    settled: Option<bool>,
    work_packet_present: Option<bool>,
    mission_packet_present: Option<bool>,
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
        correlation_id: Some(task_digest.to_string()),
        kind: "mcp_mission_review_settlement_authority".to_string(),
        severity: if status == "accepted" {
            "info".to_string()
        } else {
            "warning".to_string()
        },
        source: "mcp-mission-review-settlement".to_string(),
        confidence: None,
        payload_json: serde_json::json!({
            "actor": actor,
            "operation": "review_and_settle",
            "repositoryDigest": repository_digest,
            "taskDigest": task_digest,
            "inputDigest": input_digest,
            "status": status,
            "rejectionCode": rejection_code,
            "outcome": outcome,
            "reviewAccepted": review_accepted,
            "merged": merged,
            "settled": settled,
            "workPacketPresent": work_packet_present,
            "missionCompletionPacketPresent": mission_packet_present,
            "callerSuppliedVerdict": false,
            "callerSuppliedCandidateOid": false,
            "callerSuppliedReviewerIdentity": false,
            "callerSuppliedMergeAuthority": false,
            "callerSuppliedPacket": false,
            "reviewValuesLogged": false,
            "repositoryPathLogged": false,
            "taskIdentityLogged": false,
            "oidValuesLogged": false,
            "packetIdentitiesLogged": false,
        }),
    };
    if let Err(error) = db.with(|database| database.append_audit_journal_event(&event)) {
        tracing::error!(actor, task_digest, error = %error, "Mission review settlement audit failed");
    }
}

#[cfg(not(test))]
async fn execute_attached(
    state: &ApiState,
    repo_path: String,
    task_id: String,
) -> ApiResult<serde_json::Value> {
    use std::sync::{Arc, Mutex};
    use tauri::Manager;

    let app = state.app_handle.clone().ok_or_else(|| {
        ApiError::Internal(
            "Mission review and settlement runtime is not attached to this MCP process".to_string(),
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

    let report = crate::ipc::orchestrator_review_and_merge(
        app.clone(),
        tasks,
        startup,
        cost,
        fleet,
        bus,
        ownership,
        symbol_ownership,
        context,
        merge_store,
        repo_path,
        task_id.clone(),
    )
    .await
    .map_err(|error| {
        if error.contains("unknown task")
            || error.contains("not in review")
            || error.contains("repository identity changed")
        {
            ApiError::BadRequest(error)
        } else {
            ApiError::Internal(error)
        }
    })?;

    let outcome = if report.settled {
        "settled"
    } else if report.merged {
        "merged_without_mission_settlement"
    } else {
        "review_rejected"
    };
    Ok(serde_json::json!({
        "taskId": task_id,
        "outcome": outcome,
        "review": {
            "accepted": report.review.merge_ok,
            "reasons": report.review.reasons,
            "candidateSourceOid": report.review.candidate_source_oid,
            "reviewerModel": report.review.reviewer_model,
            "backendOwned": true,
            "callerSuppliedVerdict": false,
            "callerSuppliedCandidateOid": false,
            "callerSuppliedReviewerIdentity": false,
        },
        "merged": report.merged,
        "settled": report.settled,
        "workPacketId": report.work_packet_id,
        "missionCompletionPacketId": report.mission_completion_packet_id,
        "callerSuppliedMergeAuthority": false,
        "callerSuppliedPacket": false,
    }))
}

#[cfg(test)]
async fn execute_attached(
    _state: &ApiState,
    _repo_path: String,
    _task_id: String,
) -> ApiResult<serde_json::Value> {
    Err(ApiError::Internal(
        "Mission review and settlement runtime is not attached to this MCP process".to_string(),
    ))
}

pub(super) async fn execute(
    state: &ApiState,
    actor: &str,
    args: &serde_json::Map<String, serde_json::Value>,
) -> ApiResult<serde_json::Value> {
    let actor = authenticated_actor(actor)?;
    validate_arguments(args)?;
    let repo_path = arg_string(args, "repoPath")?;
    let task_id = arg_string(args, "taskId")?;
    let repository_digest = repository_digest(&repo_path);
    let task_digest = task_digest(&task_id);
    let input_digest = input_digest(&repo_path, &task_id);

    match execute_attached(state, repo_path, task_id).await {
        Ok(value) => {
            let review_accepted = value
                .pointer("/review/accepted")
                .and_then(serde_json::Value::as_bool);
            let merged = value.get("merged").and_then(serde_json::Value::as_bool);
            let settled = value.get("settled").and_then(serde_json::Value::as_bool);
            let outcome = value.get("outcome").and_then(serde_json::Value::as_str);
            audit(
                state,
                actor,
                &repository_digest,
                &task_digest,
                &input_digest,
                "accepted",
                None,
                outcome,
                review_accepted,
                merged,
                settled,
                Some(
                    value
                        .get("workPacketId")
                        .is_some_and(|value| !value.is_null()),
                ),
                Some(
                    value
                        .get("missionCompletionPacketId")
                        .is_some_and(|value| !value.is_null()),
                ),
            );
            Ok(value)
        }
        Err(error) => {
            let message = error.to_string();
            audit(
                state,
                actor,
                &repository_digest,
                &task_digest,
                &input_digest,
                "rejected",
                Some(rejection_code(&message)),
                None,
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
    fn caller_cannot_shape_review_merge_or_packet_authority() {
        for forbidden in [
            "verdict",
            "reviewerId",
            "candidateSourceOid",
            "candidateTargetOid",
            "gatesDigest",
            "mergeToken",
            "workPacket",
            "missionCompletionPacket",
        ] {
            let mut args = serde_json::Map::new();
            args.insert("repoPath".to_string(), serde_json::json!("C:/repo"));
            args.insert("taskId".to_string(), serde_json::json!("task-1"));
            args.insert(forbidden.to_string(), serde_json::json!("caller-value"));
            assert!(matches!(
                validate_arguments(&args),
                Err(ApiError::BadRequest(message)) if message.contains(forbidden)
            ));
        }
    }

    #[test]
    fn authority_digests_are_domain_separated() {
        let repository = repository_digest("C:/secret/repo");
        let task = task_digest("secret-task");
        let input = input_digest("C:/secret/repo", "secret-task");
        assert_eq!(repository.len(), 64);
        assert_eq!(task.len(), 64);
        assert_eq!(input.len(), 64);
        assert_ne!(repository, task);
        assert_ne!(repository, input);
        assert_ne!(task, input);
    }
}
