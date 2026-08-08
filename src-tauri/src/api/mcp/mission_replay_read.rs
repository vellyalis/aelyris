use super::super::{ApiError, ApiResult, ApiState};
use super::dispatch::arg_string;

const ALLOWED_ARGUMENTS: &[&str] = &["repoPath"];
const MAX_REPOSITORY_PATH_CHARS: usize = 4_096;
const RESPONSE_SCHEMA: &str = "aelyris.mission-replay-read/v1";

fn authenticated_actor(actor: &str) -> ApiResult<&str> {
    let actor = actor.trim();
    if actor.is_empty() {
        Err(ApiError::Forbidden(
            "authenticated Mission replay Principal is unavailable".to_string(),
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
            "aelyris.mission.replay does not accept `{bad}`; Mission, TaskGraph, execution, event, packet, replay cursor, checkpoint, and recovery authority are backend-owned"
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
    digest("aelyris.mission-replay-read-repository", repo_path)
}

fn input_digest(repository_digest: &str) -> String {
    digest("aelyris.mission-replay-read-input", repository_digest)
}

fn replay_hash_digest(replay_hash: &str) -> String {
    digest("aelyris.mission-replay-read-hash", replay_hash)
}

fn map_replay_error(error: crate::mission_replay::MissionReplayError) -> ApiError {
    match error {
        crate::mission_replay::MissionReplayError::Durability(message) => {
            ApiError::ServiceUnavailable(message)
        }
        crate::mission_replay::MissionReplayError::EventLimitExceeded { max } => {
            ApiError::Conflict(format!(
                "mission_replay_event_limit_exceeded: finite bound is {max}"
            ))
        }
        crate::mission_replay::MissionReplayError::Inconsistent(message) => {
            ApiError::Conflict(format!("mission_replay_inconsistent: {message}"))
        }
        crate::mission_replay::MissionReplayError::Serialization(message) => {
            ApiError::Internal(format!("mission_replay_serialization_failed: {message}"))
        }
    }
}

fn rejection_code(error: &ApiError) -> &'static str {
    match error {
        ApiError::ServiceUnavailable(_) => "mission_replay_durability_unavailable",
        ApiError::Conflict(message) if message.contains("event_limit_exceeded") => {
            "mission_replay_event_limit_exceeded"
        }
        ApiError::Conflict(message) if message.contains("mission_replay_inconsistent") => {
            "mission_replay_inconsistent"
        }
        ApiError::BadRequest(_) => "mission_replay_request_invalid",
        _ => "mission_replay_read_failed",
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
    replay_hash_digest: Option<&str>,
    task_count: Option<usize>,
    execution_count: Option<usize>,
    durable_event_count: Option<usize>,
    scanned_event_count: Option<usize>,
    work_packet_count: Option<usize>,
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
        correlation_id: Some(repository_digest.to_string()),
        kind: "mcp_mission_replay_read".to_string(),
        severity: if status == "accepted" {
            "info".to_string()
        } else {
            "warning".to_string()
        },
        source: "mcp-mission-replay".to_string(),
        confidence: None,
        payload_json: serde_json::json!({
            "actor": actor,
            "operation": "read_replay",
            "repositoryDigest": repository_digest,
            "inputDigest": input_digest,
            "status": status,
            "outcome": outcome,
            "rejectionCode": rejection_code,
            "replayInvoked": replay_invoked,
            "replayHashDigest": replay_hash_digest,
            "taskCount": task_count,
            "executionCount": execution_count,
            "durableEventCount": durable_event_count,
            "scannedEventCount": scanned_event_count,
            "workPacketCount": work_packet_count,
            "missionPacketPresent": mission_packet_present,
            "projectionSideEffectCount": 0,
            "repositoryPathLogged": false,
            "goalOrContextLogged": false,
            "missionIdentityLogged": false,
            "planIdentityLogged": false,
            "taskOrExecutionIdentityLogged": false,
            "eventPayloadLogged": false,
            "oidValuesLogged": false,
            "reviewOrEvidenceLogged": false,
            "packetIdentityLogged": false,
            "packetContentsLogged": false,
            "rawReplayHashLogged": false,
        }),
    };
    if let Err(error) = db.with(|database| database.append_audit_journal_event(&event)) {
        tracing::error!(
            actor,
            repository_digest,
            error = %error,
            "Mission replay read audit failed"
        );
    }
}

fn exposure_metadata() -> serde_json::Value {
    serde_json::json!({
        "repositoryPathExposed": false,
        "rawGoalOrContextExposed": false,
        "taskPayloadExposed": false,
        "executionIdentityExposed": false,
        "eventPayloadExposed": false,
        "oidValuesExposed": false,
        "reviewOrEvidenceExposed": false,
        "packetIdentityExposed": false,
        "packetContentsExposed": false,
    })
}

fn not_found_projection() -> serde_json::Value {
    serde_json::json!({
        "schema": RESPONSE_SCHEMA,
        "outcome": "not_found",
        "found": false,
        "notFound": {
            "code": "accepted_cockpit_mission_not_found",
            "syntheticReplayCreated": false,
        },
        "replay": null,
        "exposure": exposure_metadata(),
    })
}

fn success_projection(
    replay: crate::mission_replay::MissionReplayProjection,
) -> ApiResult<serde_json::Value> {
    let replay = serde_json::to_value(replay)
        .map_err(|error| ApiError::Internal(format!("serialize Mission replay: {error}")))?;
    Ok(serde_json::json!({
        "schema": RESPONSE_SCHEMA,
        "outcome": "ok",
        "found": true,
        "replay": replay,
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
    let repository_digest = repository_digest(&repo_path);
    let input_digest = input_digest(&repository_digest);

    let tasks = state.task_manager.as_ref().ok_or_else(|| {
        let error = ApiError::ServiceUnavailable(
            "Mission replay TaskManager owner is unavailable".to_string(),
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
            None,
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
            "Mission replay durable Event Bus owner is unavailable".to_string(),
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
            None,
            None,
            None,
            None,
            None,
            None,
        );
        error
    })?;

    let replay = match crate::mission_replay::replay_current_mission(tasks, events, &repo_path) {
        Ok(replay) => replay,
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

    let Some(replay) = replay else {
        let result = not_found_projection();
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
            Some(0),
            Some(0),
            Some(0),
            Some(0),
            Some(0),
            Some(false),
        );
        return Ok(result);
    };

    let replay_audit_digest = replay_hash_digest(&replay.replay_hash);
    let source = replay.source.clone();
    let result = success_projection(replay)?;
    audit(
        state,
        actor,
        &repository_digest,
        &input_digest,
        "accepted",
        "ok",
        None,
        true,
        Some(&replay_audit_digest),
        Some(source.task_count),
        Some(source.execution_count),
        Some(source.durable_event_count),
        Some(source.durable_event_scanned_count),
        Some(source.work_packet_count),
        Some(source.mission_completion_packet_present),
    );
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn caller_cannot_shape_replay_or_recovery_authority() {
        let allowed = serde_json::json!({ "repoPath": "C:/repo" })
            .as_object()
            .unwrap()
            .clone();
        assert!(validate_arguments(&allowed).is_ok());
        for forbidden in [
            "missionId",
            "planId",
            "taskId",
            "attemptId",
            "eventId",
            "afterSeq",
            "limit",
            "checkpointId",
            "replayHash",
            "restore",
            "settle",
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
    fn not_found_is_explicit_and_creates_no_synthetic_replay() {
        let projection = not_found_projection();
        assert_eq!(projection["outcome"], "not_found");
        assert_eq!(projection["found"], false);
        assert_eq!(projection["notFound"]["syntheticReplayCreated"], false);
        assert!(projection["replay"].is_null());
    }

    #[test]
    fn exposure_metadata_keeps_payloads_and_authority_closed() {
        let exposure = exposure_metadata();
        for flag in [
            "repositoryPathExposed",
            "rawGoalOrContextExposed",
            "taskPayloadExposed",
            "executionIdentityExposed",
            "eventPayloadExposed",
            "oidValuesExposed",
            "reviewOrEvidenceExposed",
            "packetIdentityExposed",
            "packetContentsExposed",
        ] {
            assert_eq!(exposure[flag], false, "flag {flag}");
        }
    }
}
