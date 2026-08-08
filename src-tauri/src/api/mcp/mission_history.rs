use std::collections::BTreeMap;

use super::super::{ApiError, ApiResult, ApiState};
use super::dispatch::{arg_string, arg_usize};

const ALLOWED_ARGUMENTS: &[&str] = &["repoPath", "limit"];
const DEFAULT_LIMIT: usize = 20;
const MAX_LIMIT: usize = 100;
const MAX_REPOSITORY_PATH_CHARS: usize = 4_096;

fn authenticated_actor(actor: &str) -> ApiResult<&str> {
    let actor = actor.trim();
    if actor.is_empty() {
        Err(ApiError::Forbidden(
            "authenticated Mission history Principal is unavailable".to_string(),
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
            "aelyris.mission.history does not accept `{bad}`; Mission, plan, task, packet, OID, event, review, evidence, and history authority are backend-owned"
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

fn digest(domain: &str, value: &str) -> String {
    crate::command_risk::approval::command_hash(&format!("{domain}\n{value}"))
        .as_str()
        .to_string()
}

fn repository_digest(repo_path: &str) -> String {
    digest("aelyris.mission-history-repository", repo_path)
}

fn input_digest(repository_digest: &str, effective_limit: usize) -> String {
    digest(
        "aelyris.mission-history-input",
        &format!("{repository_digest}\n{effective_limit}"),
    )
}

fn map_history_error(error: crate::task::MissionPlanError) -> ApiError {
    match error {
        crate::task::MissionPlanError::DurabilityUnavailable => {
            ApiError::ServiceUnavailable("Mission history durability is unavailable".to_string())
        }
        crate::task::MissionPlanError::Validation(message)
        | crate::task::MissionPlanError::ContentConflict(message)
        | crate::task::MissionPlanError::IllegalTransition {
            from: message,
            to: _,
        } => ApiError::Conflict(format!("mission_history_inconsistent: {message}")),
        crate::task::MissionPlanError::NotFound { .. } => ApiError::Conflict(
            "mission_history_inconsistent: durable plan unexpectedly disappeared".to_string(),
        ),
        crate::task::MissionPlanError::Persistence(message) => ApiError::Internal(message),
    }
}

fn rejection_code(error: &ApiError) -> &'static str {
    match error {
        ApiError::ServiceUnavailable(_) => "mission_history_durability_unavailable",
        ApiError::Conflict(message) if message.contains("mission_history_inconsistent") => {
            "mission_history_inconsistent"
        }
        ApiError::BadRequest(_) => "mission_history_request_invalid",
        _ => "mission_history_read_failed",
    }
}

#[allow(clippy::too_many_arguments)]
fn audit(
    state: &ApiState,
    actor: &str,
    repository_digest: &str,
    input_digest: &str,
    status: &str,
    outcome: &str,
    rejection_code: Option<&str>,
    requested_limit: Option<usize>,
    effective_limit: usize,
    returned_count: Option<usize>,
    completed_count: Option<usize>,
    incomplete_count: Option<usize>,
    terminal_noncompletion_count: Option<usize>,
    inconsistent_count: Option<usize>,
    has_more: Option<bool>,
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
        kind: "mcp_mission_history_read".to_string(),
        severity: if status == "accepted" {
            "info".to_string()
        } else {
            "warning".to_string()
        },
        source: "mcp-mission-history".to_string(),
        confidence: None,
        payload_json: serde_json::json!({
            "actor": actor,
            "operation": "read_history",
            "repositoryDigest": repository_digest,
            "inputDigest": input_digest,
            "status": status,
            "outcome": outcome,
            "rejectionCode": rejection_code,
            "requestedLimit": requested_limit,
            "effectiveLimit": effective_limit,
            "returnedCount": returned_count,
            "completedCount": completed_count,
            "incompleteCount": incomplete_count,
            "terminalNoncompletionCount": terminal_noncompletion_count,
            "inconsistentCount": inconsistent_count,
            "hasMore": has_more,
            "repositoryPathLogged": false,
            "goalOrContextLogged": false,
            "missionIdentityLogged": false,
            "planIdentityLogged": false,
            "taskIdentityLogged": false,
            "packetIdentityLogged": false,
            "packetContentsLogged": false,
            "oidValuesLogged": false,
            "eventReviewEvidenceLogged": false,
        }),
    };
    if let Err(error) = db.with(|database| database.append_audit_journal_event(&event)) {
        tracing::error!(
            actor,
            repository_digest,
            error = %error,
            "Mission history read audit failed"
        );
    }
}

fn exposure_metadata() -> serde_json::Value {
    serde_json::json!({
        "source": "sqlite-backed-task-manager-mission-history",
        "readOnly": true,
        "restartSafe": true,
        "bounded": true,
        "historyCacheUsed": false,
        "historyIndexUsed": false,
        "eventHistoryUsed": false,
        "repositoryPathExposed": false,
        "rawGoalExposed": false,
        "rawContextExposed": false,
        "plannerPayloadExposed": false,
        "taskIdentityExposed": false,
        "taskDescriptionsExposed": false,
        "dependencyValuesExposed": false,
        "outputPathsExposed": false,
        "branchNamesExposed": false,
        "modelAssignmentsExposed": false,
        "symbolValuesExposed": false,
        "oidValuesExposed": false,
        "eventPayloadHistoryExposed": false,
        "reviewOrEvidenceExposed": false,
        "packetIdentityExposed": false,
        "packetContentsExposed": false,
    })
}

fn current_identity(
    mission: Option<&crate::task::MissionPlanPreview>,
) -> Option<(&str, u64, &str, u64)> {
    mission.map(|mission| {
        (
            mission.plan_id.as_str(),
            mission.plan_revision,
            mission.mission_definition.mission_id.as_str(),
            mission.mission_definition.revision,
        )
    })
}

fn is_current(
    preview: &crate::task::MissionPlanPreview,
    identity: Option<(&str, u64, &str, u64)>,
) -> bool {
    identity.is_some_and(|(plan_id, plan_revision, mission_id, mission_revision)| {
        plan_id == preview.plan_id
            && plan_revision == preview.plan_revision
            && mission_id == preview.mission_definition.mission_id
            && mission_revision == preview.mission_definition.revision
    })
}

fn status_counts(tasks: &[crate::task::Task]) -> BTreeMap<String, usize> {
    let mut counts = BTreeMap::new();
    for task in tasks {
        *counts.entry(task.status.as_str().to_string()).or_insert(0) += 1;
    }
    counts
}

fn completion_projection(
    tasks: &crate::task::TaskManager,
    preview: &crate::task::MissionPlanPreview,
) -> ApiResult<serde_json::Value> {
    if preview.status != crate::task::MissionPlanStatus::Accepted {
        return Ok(serde_json::json!({
            "state": preview.status.as_str(),
            "packetBacked": false,
            "workPacketCount": 0,
            "missionCompletionPacketPresent": false,
            "receiptDigest": null,
        }));
    }
    match super::mission_completion::read_durable_completion(tasks, preview) {
        Ok(super::mission_completion::DurableCompletionRead::Incomplete { work_packet_count }) => {
            Ok(serde_json::json!({
                "state": "incomplete",
                "packetBacked": false,
                "workPacketCount": work_packet_count,
                "missionCompletionPacketPresent": false,
                "receiptDigest": null,
            }))
        }
        Ok(super::mission_completion::DurableCompletionRead::Completed {
            work_packet_count,
            receipt_digest,
        }) => Ok(serde_json::json!({
            "state": "completed",
            "packetBacked": true,
            "workPacketCount": work_packet_count,
            "missionCompletionPacketPresent": true,
            "receiptDigest": receipt_digest,
        })),
        Err(ApiError::Conflict(_)) => Ok(serde_json::json!({
            "state": "inconsistent",
            "packetBacked": false,
            "workPacketCount": 0,
            "missionCompletionPacketPresent": false,
            "receiptDigest": null,
        })),
        Err(error) => Err(error),
    }
}

fn current_task_projection(
    preview: &crate::task::MissionPlanPreview,
    current_snapshot: &Result<Option<super::mission_continuity::CurrentMissionSnapshot>, ApiError>,
) -> serde_json::Value {
    match current_snapshot {
        Ok(Some(snapshot))
            if snapshot.mission.plan_id == preview.plan_id
                && snapshot.mission.plan_revision == preview.plan_revision
                && snapshot.mission.mission_definition.mission_id
                    == preview.mission_definition.mission_id
                && snapshot.mission.mission_definition.revision
                    == preview.mission_definition.revision =>
        {
            serde_json::json!({
                "available": true,
                "exact": true,
                "taskCount": snapshot.tasks.len(),
                "statusCounts": status_counts(&snapshot.tasks),
            })
        }
        Ok(_) => serde_json::json!({
            "available": false,
            "exact": false,
            "reason": "current_task_projection_unavailable",
        }),
        Err(_) => serde_json::json!({
            "available": false,
            "exact": false,
            "reason": "current_task_projection_inconsistent",
        }),
    }
}

fn entry_projection(
    tasks: &crate::task::TaskManager,
    preview: crate::task::MissionPlanPreview,
    current: bool,
    current_snapshot: &Result<Option<super::mission_continuity::CurrentMissionSnapshot>, ApiError>,
) -> ApiResult<serde_json::Value> {
    let task_count = preview
        .cockpit_task_plan
        .as_ref()
        .map_or(0, std::vec::Vec::len);
    let completion = completion_projection(tasks, &preview)?;
    Ok(serde_json::json!({
        "missionId": preview.mission_definition.mission_id,
        "missionRevision": preview.mission_definition.revision,
        "planId": preview.plan_id,
        "planRevision": preview.plan_revision,
        "status": preview.status.as_str(),
        "current": current,
        "taskCount": task_count,
        "currentTaskSummary": if current {
            current_task_projection(&preview, current_snapshot)
        } else {
            serde_json::Value::Null
        },
        "completion": completion,
    }))
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
    let requested_limit = args
        .get("limit")
        .and_then(serde_json::Value::as_u64)
        .and_then(|value| usize::try_from(value).ok());
    let effective_limit = arg_usize(args, "limit", DEFAULT_LIMIT)?.clamp(1, MAX_LIMIT);
    let repository_digest = repository_digest(&repo_path);
    let input_digest = input_digest(&repository_digest, effective_limit);
    let tasks = state.task_manager.as_ref().ok_or_else(|| {
        let error = ApiError::Internal("task graph is not attached to this MCP process".into());
        audit(
            state,
            actor,
            &repository_digest,
            &input_digest,
            "rejected",
            "error",
            Some(rejection_code(&error)),
            requested_limit,
            effective_limit,
            None,
            None,
            None,
            None,
            None,
            None,
        );
        error
    })?;

    let current = tasks
        .current_cockpit_mission(&repo_path)
        .map_err(map_history_error)?;
    let current_identity = current_identity(current.as_ref());
    let current_snapshot = super::mission_continuity::load_current(state, &repo_path);
    let query_limit = effective_limit.saturating_add(1);
    let mut previews = match tasks.cockpit_mission_history(&repo_path, query_limit) {
        Ok(previews) => previews,
        Err(error) => {
            let error = map_history_error(error);
            audit(
                state,
                actor,
                &repository_digest,
                &input_digest,
                "rejected",
                "error",
                Some(rejection_code(&error)),
                requested_limit,
                effective_limit,
                None,
                None,
                None,
                None,
                None,
                None,
            );
            return Err(error);
        }
    };
    let has_more = previews.len() > effective_limit;
    previews.truncate(effective_limit);

    let mut entries = Vec::with_capacity(previews.len());
    for preview in previews {
        let current = is_current(&preview, current_identity);
        entries.push(entry_projection(
            tasks,
            preview,
            current,
            &current_snapshot,
        )?);
    }

    let completed_count = entries
        .iter()
        .filter(|entry| entry["completion"]["state"] == "completed")
        .count();
    let incomplete_count = entries
        .iter()
        .filter(|entry| entry["completion"]["state"] == "incomplete")
        .count();
    let terminal_noncompletion_count = entries
        .iter()
        .filter(|entry| {
            matches!(
                entry["completion"]["state"].as_str(),
                Some("rejected" | "cancelled" | "previewed")
            )
        })
        .count();
    let inconsistent_count = entries
        .iter()
        .filter(|entry| entry["completion"]["state"] == "inconsistent")
        .count();
    let outcome = if entries.is_empty() { "empty" } else { "ok" };
    let returned_count = entries.len();
    let result = serde_json::json!({
        "outcome": outcome,
        "repositoryDigest": repository_digest,
        "requestedLimit": requested_limit,
        "effectiveLimit": effective_limit,
        "returnedCount": returned_count,
        "hasMore": has_more,
        "entries": entries,
        "boundary": exposure_metadata(),
    });
    audit(
        state,
        actor,
        result["repositoryDigest"].as_str().unwrap_or_default(),
        &input_digest,
        "accepted",
        outcome,
        None,
        requested_limit,
        effective_limit,
        Some(returned_count),
        Some(completed_count),
        Some(incomplete_count),
        Some(terminal_noncompletion_count),
        Some(inconsistent_count),
        Some(has_more),
    );
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn caller_cannot_shape_history_or_completion_authority() {
        let allowed = serde_json::json!({ "repoPath": "C:/repo", "limit": 10 })
            .as_object()
            .unwrap()
            .clone();
        assert!(validate_arguments(&allowed).is_ok());
        for forbidden in [
            "missionId",
            "planId",
            "taskId",
            "workPacketId",
            "candidateOid",
            "eventId",
            "afterSeq",
            "reviewId",
            "evidenceId",
            "cursor",
        ] {
            let mut args = allowed.clone();
            args.insert(forbidden.to_string(), serde_json::json!("forged"));
            assert!(matches!(
                validate_arguments(&args),
                Err(ApiError::BadRequest(message)) if message.contains(forbidden)
            ));
        }
    }

    #[test]
    fn limit_is_server_bounded() {
        let args = serde_json::json!({ "repoPath": "C:/repo", "limit": 10_000 })
            .as_object()
            .unwrap()
            .clone();
        assert_eq!(
            arg_usize(&args, "limit", DEFAULT_LIMIT)
                .unwrap()
                .clamp(1, MAX_LIMIT),
            100
        );
        let default_args = serde_json::json!({ "repoPath": "C:/repo" })
            .as_object()
            .unwrap()
            .clone();
        assert_eq!(
            arg_usize(&default_args, "limit", DEFAULT_LIMIT).unwrap(),
            20
        );
    }

    #[test]
    fn exposure_metadata_excludes_history_payloads() {
        let exposure = exposure_metadata();
        assert_eq!(exposure["readOnly"], true);
        assert_eq!(exposure["restartSafe"], true);
        assert_eq!(exposure["bounded"], true);
        assert_eq!(exposure["historyCacheUsed"], false);
        assert_eq!(exposure["eventHistoryUsed"], false);
        for flag in [
            "repositoryPathExposed",
            "rawGoalExposed",
            "rawContextExposed",
            "plannerPayloadExposed",
            "taskIdentityExposed",
            "taskDescriptionsExposed",
            "dependencyValuesExposed",
            "outputPathsExposed",
            "branchNamesExposed",
            "modelAssignmentsExposed",
            "symbolValuesExposed",
            "oidValuesExposed",
            "eventPayloadHistoryExposed",
            "reviewOrEvidenceExposed",
            "packetIdentityExposed",
            "packetContentsExposed",
        ] {
            assert_eq!(exposure[flag], false, "flag {flag}");
        }
    }
}
