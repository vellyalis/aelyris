use std::collections::{BTreeMap, HashMap, HashSet};

use super::super::{ApiError, ApiResult, ApiState};
use super::dispatch::arg_string;

const ALLOWED_ARGUMENTS: &[&str] = &["repoPath"];
const MAX_REPOSITORY_PATH_CHARS: usize = 4_096;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum TaskCompletionState {
    Pending,
    Blocked,
    Done,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct WorkPacketReference {
    task_id: String,
    work_unit_id: String,
    packet_id: String,
    packet_digest: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct CompletionMaterial {
    work_packets: Vec<WorkPacketReference>,
    mission_packet_id: String,
    mission_packet_digest: String,
    receipt_digest: String,
}

fn authenticated_actor(actor: &str) -> ApiResult<&str> {
    let actor = actor.trim();
    if actor.is_empty() {
        Err(ApiError::Forbidden(
            "authenticated Mission completion Principal is unavailable".to_string(),
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
            "aelyris.mission.completion does not accept `{bad}`; Mission, plan, task, packet, OID, event, review, and settlement authority are backend-owned"
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
    digest("aelyris.mission-completion-repository", repo_path)
}

fn input_digest(repository_digest: &str) -> String {
    digest("aelyris.mission-completion-input", repository_digest)
}

fn map_plan_error(error: crate::task::MissionPlanError) -> ApiError {
    match error {
        crate::task::MissionPlanError::DurabilityUnavailable => {
            ApiError::ServiceUnavailable("Mission completion durability is unavailable".to_string())
        }
        crate::task::MissionPlanError::Validation(message) => {
            ApiError::Conflict(format!("mission_completion_inconsistent: {message}"))
        }
        crate::task::MissionPlanError::ContentConflict(message)
        | crate::task::MissionPlanError::IllegalTransition {
            from: message,
            to: _,
        } => ApiError::Conflict(format!("mission_completion_inconsistent: {message}")),
        crate::task::MissionPlanError::NotFound { .. } => ApiError::Conflict(
            "mission_completion_inconsistent: durable plan lookup unexpectedly failed".to_string(),
        ),
        crate::task::MissionPlanError::Persistence(message) => ApiError::Internal(message),
    }
}

fn rejection_code(error: &ApiError) -> &'static str {
    match error {
        ApiError::ServiceUnavailable(_) => "mission_completion_durability_unavailable",
        ApiError::Conflict(message) if message.contains("mission_completion_inconsistent") => {
            "mission_completion_inconsistent"
        }
        ApiError::BadRequest(_) => "mission_completion_request_invalid",
        _ => "mission_completion_read_failed",
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
    task_count: Option<usize>,
    done_count: Option<usize>,
    blocked_count: Option<usize>,
    work_packet_count: Option<usize>,
    mission_packet_present: Option<bool>,
    receipt_returned: bool,
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
        kind: "mcp_mission_completion_read".to_string(),
        severity: if status == "accepted" {
            "info".to_string()
        } else {
            "warning".to_string()
        },
        source: "mcp-mission-completion".to_string(),
        confidence: None,
        payload_json: serde_json::json!({
            "actor": actor,
            "operation": "read_completion",
            "repositoryDigest": repository_digest,
            "inputDigest": input_digest,
            "status": status,
            "outcome": outcome,
            "rejectionCode": rejection_code,
            "taskCount": task_count,
            "doneCount": done_count,
            "blockedCount": blocked_count,
            "workPacketCount": work_packet_count,
            "missionPacketPresent": mission_packet_present,
            "receiptReturned": receipt_returned,
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
            "Mission completion read audit failed"
        );
    }
}

fn task_counts(
    tasks: &[crate::task::Task],
) -> (BTreeMap<String, usize>, usize, usize, TaskCompletionState) {
    let mut counts = BTreeMap::<String, usize>::new();
    let mut done_count = 0usize;
    let mut blocked_count = 0usize;
    for task in tasks {
        let status = task.status.as_str().to_string();
        *counts.entry(status).or_default() += 1;
        match task.status {
            crate::task::TaskStatus::Done => done_count += 1,
            crate::task::TaskStatus::Blocked | crate::task::TaskStatus::Failed => {
                blocked_count += 1
            }
            _ => {}
        }
    }
    let state = if tasks.is_empty() {
        TaskCompletionState::Blocked
    } else if done_count == tasks.len() {
        TaskCompletionState::Done
    } else if blocked_count > 0 {
        TaskCompletionState::Blocked
    } else {
        TaskCompletionState::Pending
    };
    (counts, done_count, blocked_count, state)
}

fn completion_receipt_digest(
    mission_id: &str,
    mission_revision: u64,
    plan_id: &str,
    plan_revision: u64,
    work_packets: &[WorkPacketReference],
    mission_packet_id: &str,
    mission_packet_digest: &str,
) -> String {
    let mut material = format!(
        "missionId={mission_id}\nmissionRevision={mission_revision}\nplanId={plan_id}\nplanRevision={plan_revision}"
    );
    for packet in work_packets {
        material.push_str(&format!(
            "\ntask={}\nworkUnit={}\nworkPacket={}\nworkPacketDigest={}",
            packet.task_id, packet.work_unit_id, packet.packet_id, packet.packet_digest
        ));
    }
    material.push_str(&format!(
        "\nmissionPacket={mission_packet_id}\nmissionPacketDigest={mission_packet_digest}"
    ));
    digest("aelyris.mission-completion-receipt/v1", &material)
}

fn validate_completion_material(
    snapshot: &super::mission_continuity::CurrentMissionSnapshot,
    activations: Vec<crate::task::MissionPlanActivation>,
    work_packets: Vec<crate::task::CompletedWorkPacket>,
    mission_packet: crate::task::MissionCompletionPacket,
) -> ApiResult<CompletionMaterial> {
    let mission = &snapshot.mission;
    let task_ids = snapshot
        .tasks
        .iter()
        .map(|task| task.id.as_str())
        .collect::<HashSet<_>>();
    if activations.len() != snapshot.tasks.len() {
        return Err(ApiError::Conflict(
            "mission_completion_inconsistent: activation count differs from current Mission task count"
                .to_string(),
        ));
    }
    let mut activation_by_task = HashMap::new();
    for activation in activations {
        if !task_ids.contains(activation.task_id.as_str())
            || activation.plan_id != mission.plan_id
            || activation.plan_revision != mission.plan_revision
            || activation.mission_id != mission.mission_definition.mission_id
            || activation.mission_revision != mission.mission_definition.revision
            || activation.plan_content_digest != mission.content_digest
            || !crate::control::loop_ports::canonical_repo_paths_equal(
                &activation.repository_root,
                &mission.repository_root,
            )
            .map_err(ApiError::Internal)?
        {
            return Err(ApiError::Conflict(
                "mission_completion_inconsistent: durable activation differs from the current accepted Mission"
                    .to_string(),
            ));
        }
        if activation_by_task
            .insert(activation.task_id.clone(), activation)
            .is_some()
        {
            return Err(ApiError::Conflict(
                "mission_completion_inconsistent: duplicate activation task identity".to_string(),
            ));
        }
    }

    if work_packets.len() != snapshot.tasks.len() {
        return Err(ApiError::Conflict(
            "mission_completion_inconsistent: completed TaskGraph lacks an exact WorkPacket set"
                .to_string(),
        ));
    }
    let mut packet_by_activation = HashMap::new();
    for packet in work_packets {
        packet.validate().map_err(map_plan_error)?;
        if packet_by_activation
            .insert(packet.activation_id.clone(), packet)
            .is_some()
        {
            return Err(ApiError::Conflict(
                "mission_completion_inconsistent: duplicate WorkPacket activation identity"
                    .to_string(),
            ));
        }
    }

    mission_packet.validate().map_err(map_plan_error)?;
    if mission_packet.mission_id != mission.mission_definition.mission_id
        || mission_packet.mission_revision != mission.mission_definition.revision
    {
        return Err(ApiError::Conflict(
            "mission_completion_inconsistent: MissionCompletionPacket identity differs from current Mission"
                .to_string(),
        ));
    }

    let mut references = Vec::with_capacity(snapshot.tasks.len());
    let mut expected_packet_map = BTreeMap::new();
    for task in &snapshot.tasks {
        let activation = activation_by_task.get(&task.id).ok_or_else(|| {
            ApiError::Conflict(
                "mission_completion_inconsistent: current Mission task lacks activation"
                    .to_string(),
            )
        })?;
        let packet = packet_by_activation
            .remove(&activation.activation_id)
            .ok_or_else(|| {
                ApiError::Conflict(
                    "mission_completion_inconsistent: current Mission task lacks WorkPacket"
                        .to_string(),
                )
            })?;
        if packet.plan_id != mission.plan_id
            || packet.plan_revision != mission.plan_revision
            || packet.mission_id != mission.mission_definition.mission_id
            || packet.mission_revision != mission.mission_definition.revision
            || packet.work_unit_id != activation.work_unit_id
            || packet.plan_content_digest != mission.content_digest
        {
            return Err(ApiError::Conflict(
                "mission_completion_inconsistent: WorkPacket lineage differs from aggregate Mission completion"
                    .to_string(),
            ));
        }
        expected_packet_map.insert(activation.work_unit_id.clone(), packet.packet_id.clone());
        references.push(WorkPacketReference {
            task_id: task.id.clone(),
            work_unit_id: activation.work_unit_id.clone(),
            packet_id: packet.packet_id,
            packet_digest: packet.packet_digest,
        });
    }
    if !packet_by_activation.is_empty()
        || mission_packet.required_work_unit_packet_ids_by_work_unit != expected_packet_map
    {
        return Err(ApiError::Conflict(
            "mission_completion_inconsistent: aggregate packet map differs from exact current Mission WorkPackets"
                .to_string(),
        ));
    }

    let receipt_digest = completion_receipt_digest(
        &mission.mission_definition.mission_id,
        mission.mission_definition.revision,
        &mission.plan_id,
        mission.plan_revision,
        &references,
        &mission_packet.packet_id,
        &mission_packet.packet_digest,
    );
    Ok(CompletionMaterial {
        work_packets: references,
        mission_packet_id: mission_packet.packet_id,
        mission_packet_digest: mission_packet.packet_digest,
        receipt_digest,
    })
}

fn continuity_metadata() -> serde_json::Value {
    serde_json::json!({
        "source": "sqlite-backed-task-manager-settlement",
        "readOnly": true,
        "restartSafe": true,
        "principalScoped": true,
        "settlementReplayed": false,
        "plannerInvoked": false,
        "reviewerInvoked": false,
        "mergeInvoked": false,
        "eventAckInvoked": false,
        "gitMutated": false,
        "secondReceiptOwnerUsed": false,
    })
}

fn exposure_metadata() -> serde_json::Value {
    serde_json::json!({
        "repositoryPathExposed": false,
        "rawGoalExposed": false,
        "rawContextExposed": false,
        "taskIdentityExposed": false,
        "taskDescriptionsExposed": false,
        "dependencyValuesExposed": false,
        "outputPathsExposed": false,
        "branchNamesExposed": false,
        "modelAssignmentsExposed": false,
        "symbolValuesExposed": false,
        "oidValuesExposed": false,
        "rawReviewOrEvidenceExposed": false,
        "eventHistoryExposed": false,
        "packetContentsExposed": false,
    })
}

fn base_projection(
    snapshot: &super::mission_continuity::CurrentMissionSnapshot,
    outcome: &str,
    status_counts: &BTreeMap<String, usize>,
) -> serde_json::Value {
    serde_json::json!({
        "outcome": outcome,
        "completed": outcome == "completed",
        "mission": {
            "missionId": snapshot.mission.mission_definition.mission_id,
            "missionRevision": snapshot.mission.mission_definition.revision,
            "planId": snapshot.mission.plan_id,
            "planRevision": snapshot.mission.plan_revision,
            "status": snapshot.mission.status.as_str(),
        },
        "taskSummary": {
            "taskCount": snapshot.tasks.len(),
            "statusCounts": status_counts,
        },
        "continuity": continuity_metadata(),
        "exposure": exposure_metadata(),
    })
}

fn not_found_projection() -> serde_json::Value {
    serde_json::json!({
        "outcome": "not_found",
        "completed": false,
        "notFound": {
            "code": "accepted_cockpit_mission_not_found",
            "syntheticMissionCreated": false,
        },
        "completion": null,
        "continuity": continuity_metadata(),
        "exposure": exposure_metadata(),
    })
}

fn incomplete_projection(
    snapshot: &super::mission_continuity::CurrentMissionSnapshot,
    outcome: &str,
    status_counts: &BTreeMap<String, usize>,
) -> serde_json::Value {
    let mut projection = base_projection(snapshot, outcome, status_counts);
    projection["completion"] = serde_json::json!({
        "packetBacked": false,
        "workPacketCount": 0,
        "missionCompletionPacketPresent": false,
        "receiptDigest": null,
    });
    projection
}

fn completed_projection(
    snapshot: &super::mission_continuity::CurrentMissionSnapshot,
    status_counts: &BTreeMap<String, usize>,
    material: &CompletionMaterial,
) -> serde_json::Value {
    let mut projection = base_projection(snapshot, "completed", status_counts);
    projection["completion"] = serde_json::json!({
        "packetBacked": true,
        "workPacketIds": material
            .work_packets
            .iter()
            .map(|packet| packet.packet_id.clone())
            .collect::<Vec<_>>(),
        "workPacketCount": material.work_packets.len(),
        "missionCompletionPacketId": material.mission_packet_id,
        "missionCompletionPacketPresent": true,
        "receiptDigest": material.receipt_digest,
        "exactPacketReferencesReturned": true,
    });
    projection
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

    let snapshot = match super::mission_continuity::load_current(state, &repo_path) {
        Ok(snapshot) => snapshot,
        Err(error) => {
            audit(
                state,
                actor,
                &repository_digest,
                &input_digest,
                "rejected",
                "error",
                Some(rejection_code(&error)),
                None,
                None,
                None,
                None,
                None,
                false,
            );
            return Err(error);
        }
    };
    let Some(snapshot) = snapshot else {
        let result = not_found_projection();
        audit(
            state,
            actor,
            &repository_digest,
            &input_digest,
            "accepted",
            "not_found",
            None,
            Some(0),
            Some(0),
            Some(0),
            Some(0),
            Some(false),
            false,
        );
        return Ok(result);
    };

    let (status_counts, done_count, blocked_count, task_state) = task_counts(&snapshot.tasks);
    match task_state {
        TaskCompletionState::Pending => {
            let result = incomplete_projection(&snapshot, "pending", &status_counts);
            audit(
                state,
                actor,
                &repository_digest,
                &input_digest,
                "accepted",
                "pending",
                None,
                Some(snapshot.tasks.len()),
                Some(done_count),
                Some(blocked_count),
                Some(0),
                Some(false),
                false,
            );
            Ok(result)
        }
        TaskCompletionState::Blocked => {
            if snapshot.tasks.is_empty() {
                let error = ApiError::Conflict(
                    "mission_completion_inconsistent: current Mission contains no tasks"
                        .to_string(),
                );
                audit(
                    state,
                    actor,
                    &repository_digest,
                    &input_digest,
                    "rejected",
                    "inconsistent",
                    Some(rejection_code(&error)),
                    Some(0),
                    Some(0),
                    Some(0),
                    None,
                    None,
                    false,
                );
                return Err(error);
            }
            let result = incomplete_projection(&snapshot, "blocked", &status_counts);
            audit(
                state,
                actor,
                &repository_digest,
                &input_digest,
                "accepted",
                "blocked",
                None,
                Some(snapshot.tasks.len()),
                Some(done_count),
                Some(blocked_count),
                Some(0),
                Some(false),
                false,
            );
            Ok(result)
        }
        TaskCompletionState::Done => {
            let tasks = state.task_manager.as_ref().ok_or_else(|| {
                ApiError::Internal("task graph is not attached to this MCP process".to_string())
            })?;
            let material = (|| {
                let activations = tasks
                    .mission_activations(&snapshot.mission.plan_id, snapshot.mission.plan_revision)
                    .map_err(map_plan_error)?;
                let work_packets = tasks
                    .completed_work_packets_for_plan(
                        &snapshot.mission.plan_id,
                        snapshot.mission.plan_revision,
                    )
                    .map_err(map_plan_error)?;
                let mission_packet = tasks
                    .cockpit_mission_completion_packet(
                        &snapshot.mission.plan_id,
                        snapshot.mission.plan_revision,
                    )
                    .map_err(map_plan_error)?
                    .ok_or_else(|| {
                        ApiError::Conflict(
                            "mission_completion_inconsistent: completed TaskGraph lacks MissionCompletionPacket"
                                .to_string(),
                        )
                    })?;
                validate_completion_material(&snapshot, activations, work_packets, mission_packet)
            })();
            let material = match material {
                Ok(material) => material,
                Err(error) => {
                    audit(
                        state,
                        actor,
                        &repository_digest,
                        &input_digest,
                        "rejected",
                        "inconsistent",
                        Some(rejection_code(&error)),
                        Some(snapshot.tasks.len()),
                        Some(done_count),
                        Some(blocked_count),
                        None,
                        None,
                        false,
                    );
                    return Err(error);
                }
            };
            let result = completed_projection(&snapshot, &status_counts, &material);
            audit(
                state,
                actor,
                &repository_digest,
                &input_digest,
                "accepted",
                "completed",
                None,
                Some(snapshot.tasks.len()),
                Some(done_count),
                Some(blocked_count),
                Some(material.work_packets.len()),
                Some(true),
                true,
            );
            Ok(result)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn caller_cannot_shape_completion_authority() {
        let allowed = serde_json::json!({ "repoPath": "C:/repo" })
            .as_object()
            .unwrap()
            .clone();
        assert!(validate_arguments(&allowed).is_ok());
        for forbidden in [
            "missionId",
            "planId",
            "taskId",
            "workPacketId",
            "missionCompletionPacketId",
            "oid",
            "eventCursor",
            "reviewId",
            "settle",
            "limit",
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
    fn task_state_is_pending_blocked_or_done_without_guessing_completion() {
        let mut pending = crate::task::Task::new("pending", "hidden");
        pending.status = crate::task::TaskStatus::Ready;
        let (_, done, blocked, state) = task_counts(std::slice::from_ref(&pending));
        assert_eq!((done, blocked, state), (0, 0, TaskCompletionState::Pending));

        let mut failed = crate::task::Task::new("failed", "hidden");
        failed.status = crate::task::TaskStatus::Failed;
        let (_, done, blocked, state) = task_counts(&[pending, failed]);
        assert_eq!((done, blocked, state), (0, 1, TaskCompletionState::Blocked));

        let mut done_task = crate::task::Task::new("done", "hidden");
        done_task.status = crate::task::TaskStatus::Done;
        let (_, done, blocked, state) = task_counts(std::slice::from_ref(&done_task));
        assert_eq!((done, blocked, state), (1, 0, TaskCompletionState::Done));
    }

    #[test]
    fn receipt_digest_is_deterministic_and_domain_separated() {
        let packets = vec![WorkPacketReference {
            task_id: "task-a".to_string(),
            work_unit_id: "work-a".to_string(),
            packet_id: "packet-a".to_string(),
            packet_digest: "a".repeat(64),
        }];
        let first = completion_receipt_digest(
            "mission",
            1,
            "plan",
            1,
            &packets,
            "mission-packet",
            &"b".repeat(64),
        );
        let second = completion_receipt_digest(
            "mission",
            1,
            "plan",
            1,
            &packets,
            "mission-packet",
            &"b".repeat(64),
        );
        assert_eq!(first, second);
        assert_eq!(first.len(), 64);
        assert_ne!(first, repository_digest("mission"));
    }

    #[test]
    fn not_found_is_explicit_and_contains_no_synthetic_receipt() {
        let projection = not_found_projection();
        assert_eq!(projection["outcome"], "not_found");
        assert_eq!(projection["completed"], false);
        assert_eq!(projection["notFound"]["syntheticMissionCreated"], false);
        assert!(projection["completion"].is_null());
        assert_eq!(projection["continuity"]["settlementReplayed"], false);
        assert_eq!(projection["exposure"]["packetContentsExposed"], false);
    }

    #[test]
    fn completed_projection_exposes_references_not_packet_contents() {
        let preview_json = serde_json::json!({
            "schema": "aelyris.mission_plan_preview/v1"
        });
        assert_eq!(preview_json["schema"], "aelyris.mission_plan_preview/v1");
        let material = CompletionMaterial {
            work_packets: vec![WorkPacketReference {
                task_id: "task-a".to_string(),
                work_unit_id: "work-a".to_string(),
                packet_id: "work-packet".to_string(),
                packet_digest: "a".repeat(64),
            }],
            mission_packet_id: "mission-packet".to_string(),
            mission_packet_digest: "b".repeat(64),
            receipt_digest: "c".repeat(64),
        };
        let serialized = serde_json::to_string(&serde_json::json!({
            "workPacketIds": material
                .work_packets
                .iter()
                .map(|packet| packet.packet_id.clone())
                .collect::<Vec<_>>(),
            "missionCompletionPacketId": material.mission_packet_id,
            "receiptDigest": material.receipt_digest,
            "packetContentsExposed": false,
        }))
        .unwrap();
        assert!(serialized.contains("work-packet"));
        assert!(serialized.contains("mission-packet"));
        assert!(!serialized.contains(&material.work_packets[0].packet_digest));
        assert!(!serialized.contains(&material.mission_packet_digest));
    }
}
