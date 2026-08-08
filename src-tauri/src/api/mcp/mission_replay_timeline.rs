use super::super::{ApiError, ApiResult, ApiState};
use super::dispatch::{arg_string, arg_usize};

const ALLOWED_ARGUMENTS: &[&str] = &["repoPath", "limit"];
const DEFAULT_LIMIT: usize = 20;
const MAX_LIMIT: usize = 100;
const MAX_REPOSITORY_PATH_CHARS: usize = 4_096;
const RESPONSE_SCHEMA: &str = "aelyris.mission-replay-timeline-read/v1";

fn authenticated_actor(actor: &str) -> ApiResult<&str> {
    let actor = actor.trim();
    if actor.is_empty() {
        Err(ApiError::Forbidden(
            "authenticated Mission replay timeline Principal is unavailable".to_string(),
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
            "aelyris.mission.replay_timeline does not accept `{bad}`; Mission, task, event, packet, checkpoint private material, cursor, recovery, and rollback authority are backend-owned"
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
    digest("aelyris.mission-replay-timeline-repository", repo_path)
}

fn input_digest(repository_digest: &str, effective_limit: usize) -> String {
    digest(
        "aelyris.mission-replay-timeline-input",
        &format!("{repository_digest}\n{effective_limit}"),
    )
}

fn timeline_hash_digest(timeline_hash: &str) -> String {
    digest("aelyris.mission-replay-timeline-hash", timeline_hash)
}

fn map_replay_error(error: crate::mission_replay::MissionReplayError) -> ApiError {
    match error {
        crate::mission_replay::MissionReplayError::Durability(message) => {
            ApiError::ServiceUnavailable(message)
        }
        crate::mission_replay::MissionReplayError::EventLimitExceeded { max } => {
            ApiError::Conflict(format!(
                "mission_replay_timeline_event_limit_exceeded: finite bound is {max}"
            ))
        }
        crate::mission_replay::MissionReplayError::Inconsistent(message) => {
            ApiError::Conflict(format!("mission_replay_timeline_inconsistent: {message}"))
        }
        crate::mission_replay::MissionReplayError::Serialization(message) => ApiError::Internal(
            format!("mission_replay_timeline_serialization_failed: {message}"),
        ),
    }
}

fn rejection_code(error: &ApiError) -> &'static str {
    match error {
        ApiError::ServiceUnavailable(_) => "mission_replay_timeline_durability_unavailable",
        ApiError::Conflict(message) if message.contains("event_limit_exceeded") => {
            "mission_replay_timeline_event_limit_exceeded"
        }
        ApiError::Conflict(message) if message.contains("timeline_inconsistent") => {
            "mission_replay_timeline_inconsistent"
        }
        ApiError::BadRequest(_) => "mission_replay_timeline_request_invalid",
        _ => "mission_replay_timeline_read_failed",
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
    replay_invoked: bool,
    timeline_hash_digest: Option<&str>,
    requested_limit: Option<usize>,
    effective_limit: usize,
    total_checkpoint_count: Option<usize>,
    returned_checkpoint_count: Option<usize>,
    has_more: Option<bool>,
    final_completed_work_count: Option<usize>,
    final_packet_backed_state: Option<&str>,
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
        kind: "mcp_mission_replay_timeline_read".to_string(),
        severity: if status == "accepted" {
            "info".to_string()
        } else {
            "warning".to_string()
        },
        source: "mcp-mission-replay-timeline".to_string(),
        confidence: None,
        payload_json: serde_json::json!({
            "actor": actor,
            "operation": "read_replay_timeline",
            "repositoryDigest": repository_digest,
            "inputDigest": input_digest,
            "status": status,
            "outcome": outcome,
            "rejectionCode": rejection_code,
            "replayInvoked": replay_invoked,
            "timelineHashDigest": timeline_hash_digest,
            "requestedLimit": requested_limit,
            "effectiveLimit": effective_limit,
            "totalCheckpointCount": total_checkpoint_count,
            "returnedCheckpointCount": returned_checkpoint_count,
            "hasMore": has_more,
            "finalCompletedWorkCount": final_completed_work_count,
            "finalPacketBackedState": final_packet_backed_state,
            "projectionSideEffectCount": 0,
            "repositoryPathLogged": false,
            "goalOrContextLogged": false,
            "missionOrPlanIdentityLogged": false,
            "taskIdentityOrPayloadLogged": false,
            "executionIdentityLogged": false,
            "eventIdentitySequenceOrPayloadLogged": false,
            "oidValuesLogged": false,
            "reviewOrEvidenceLogged": false,
            "packetIdentityOrContentsLogged": false,
            "checkpointPrivateMaterialLogged": false,
            "rawTimelineHashLogged": false,
        }),
    };
    if let Err(error) = db.with(|database| database.append_audit_journal_event(&event)) {
        tracing::error!(
            actor,
            repository_digest,
            error = %error,
            "Mission replay timeline read audit failed"
        );
    }
}

fn exposure_metadata() -> serde_json::Value {
    serde_json::json!({
        "repositoryPathExposed": false,
        "rawGoalOrContextExposed": false,
        "taskIdentityOrPayloadExposed": false,
        "executionIdentityExposed": false,
        "eventIdentityOrPayloadExposed": false,
        "globalEventSequenceExposed": false,
        "oidValuesExposed": false,
        "reviewOrEvidenceExposed": false,
        "packetIdentityOrContentsExposed": false,
        "checkpointPrivateMaterialExposed": false,
        "recoveryOrRollbackAuthorityExposed": false,
    })
}

fn not_found_projection(
    requested_limit: Option<usize>,
    effective_limit: usize,
) -> serde_json::Value {
    serde_json::json!({
        "schema": RESPONSE_SCHEMA,
        "outcome": "not_found",
        "found": false,
        "requestedLimit": requested_limit,
        "effectiveLimit": effective_limit,
        "notFound": {
            "code": "accepted_cockpit_mission_not_found",
            "syntheticTimelineCreated": false,
        },
        "timeline": null,
        "exposure": exposure_metadata(),
    })
}

fn success_projection(
    timeline: crate::mission_replay::MissionReplayTimelineProjection,
    requested_limit: Option<usize>,
    effective_limit: usize,
) -> ApiResult<serde_json::Value> {
    let total_checkpoint_count = timeline.checkpoints.len();
    let returned_start = total_checkpoint_count.saturating_sub(effective_limit);
    let checkpoints = timeline.checkpoints[returned_start..].to_vec();
    let returned_checkpoint_count = checkpoints.len();
    let has_more = returned_start > 0;
    let mission = serde_json::to_value(timeline.mission)
        .map_err(|error| ApiError::Internal(format!("serialize replay Mission: {error}")))?;
    let source = serde_json::to_value(timeline.source)
        .map_err(|error| ApiError::Internal(format!("serialize replay source: {error}")))?;
    let guarantees = serde_json::to_value(timeline.guarantees)
        .map_err(|error| ApiError::Internal(format!("serialize replay guarantees: {error}")))?;
    Ok(serde_json::json!({
        "schema": RESPONSE_SCHEMA,
        "outcome": "ok",
        "found": true,
        "requestedLimit": requested_limit,
        "effectiveLimit": effective_limit,
        "timeline": {
            "mission": mission,
            "timelineHash": timeline.timeline_hash,
            "totalCheckpointCount": total_checkpoint_count,
            "returnedCheckpointCount": returned_checkpoint_count,
            "returnedStartPosition": checkpoints.first().map(|checkpoint| checkpoint.position),
            "hasMore": has_more,
            "checkpoints": checkpoints,
            "finalTaskStatusCounts": timeline.final_task_status_counts,
            "finalCompletedWorkCount": timeline.final_completed_work_count,
            "finalPacketBackedMissionState": timeline.final_packet_backed_mission_state,
            "source": source,
            "guarantees": guarantees,
        },
        "exposure": exposure_metadata(),
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
        let error = ApiError::ServiceUnavailable(
            "Mission replay timeline TaskManager owner is unavailable".to_string(),
        );
        audit(
            state,
            actor,
            &repository_digest,
            &input_digest,
            "rejected",
            "error",
            Some(rejection_code(&error)),
            false,
            None,
            requested_limit,
            effective_limit,
            None,
            None,
            None,
            None,
            None,
        );
        error
    })?;
    let events = state.event_bus.as_ref().ok_or_else(|| {
        let error = ApiError::ServiceUnavailable(
            "Mission replay timeline durable Event Bus owner is unavailable".to_string(),
        );
        audit(
            state,
            actor,
            &repository_digest,
            &input_digest,
            "rejected",
            "error",
            Some(rejection_code(&error)),
            false,
            None,
            requested_limit,
            effective_limit,
            None,
            None,
            None,
            None,
            None,
        );
        error
    })?;

    let timeline =
        match crate::mission_replay::replay_current_mission_timeline(tasks, events, &repo_path) {
            Ok(timeline) => timeline,
            Err(error) => {
                let error = map_replay_error(error);
                audit(
                    state,
                    actor,
                    &repository_digest,
                    &input_digest,
                    "rejected",
                    "error",
                    Some(rejection_code(&error)),
                    true,
                    None,
                    requested_limit,
                    effective_limit,
                    None,
                    None,
                    None,
                    None,
                    None,
                );
                return Err(error);
            }
        };
    let Some(timeline) = timeline else {
        let result = not_found_projection(requested_limit, effective_limit);
        audit(
            state,
            actor,
            &repository_digest,
            &input_digest,
            "accepted",
            "not_found",
            None,
            true,
            None,
            requested_limit,
            effective_limit,
            Some(0),
            Some(0),
            Some(false),
            Some(0),
            Some("incomplete"),
        );
        return Ok(result);
    };

    let total_checkpoint_count = timeline.checkpoints.len();
    let returned_checkpoint_count = total_checkpoint_count.min(effective_limit);
    let has_more = total_checkpoint_count > returned_checkpoint_count;
    let timeline_audit_digest = timeline_hash_digest(&timeline.timeline_hash);
    let final_completed_work_count = timeline.final_completed_work_count;
    let final_packet_backed_state = timeline.final_packet_backed_mission_state.clone();
    let result = success_projection(timeline, requested_limit, effective_limit)?;
    audit(
        state,
        actor,
        &repository_digest,
        &input_digest,
        "accepted",
        "ok",
        None,
        true,
        Some(&timeline_audit_digest),
        requested_limit,
        effective_limit,
        Some(total_checkpoint_count),
        Some(returned_checkpoint_count),
        Some(has_more),
        Some(final_completed_work_count),
        Some(&final_packet_backed_state),
    );
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn caller_cannot_shape_checkpoint_or_recovery_authority() {
        let allowed = serde_json::json!({ "repoPath": "C:/repo", "limit": 20 })
            .as_object()
            .unwrap()
            .clone();
        assert!(validate_arguments(&allowed).is_ok());
        for forbidden in [
            "missionId",
            "planId",
            "taskId",
            "eventId",
            "afterSeq",
            "checkpointId",
            "checkpointHash",
            "cursor",
            "restore",
            "rollback",
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
            MAX_LIMIT
        );
    }

    #[test]
    fn exposure_keeps_private_replay_material_closed() {
        let exposure = exposure_metadata();
        for flag in [
            "repositoryPathExposed",
            "rawGoalOrContextExposed",
            "taskIdentityOrPayloadExposed",
            "executionIdentityExposed",
            "eventIdentityOrPayloadExposed",
            "globalEventSequenceExposed",
            "oidValuesExposed",
            "reviewOrEvidenceExposed",
            "packetIdentityOrContentsExposed",
            "checkpointPrivateMaterialExposed",
            "recoveryOrRollbackAuthorityExposed",
        ] {
            assert_eq!(exposure[flag], false, "flag {flag}");
        }
    }
}
