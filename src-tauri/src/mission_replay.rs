use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::event_bus::{EventBus, EventBusError, SeqEvent};
use crate::task::{
    CompletedWorkPacket, MissionCompletionPacket, MissionPlanError, MissionPlanPreview, Task,
    TaskManager, WorkExecutionAttempt,
};

const REPLAY_SCHEMA: &str = "aelyris.mission-replay/v1";
const MATERIAL_SCHEMA: &str = "aelyris.mission-replay-material/v1";
const EVENT_BATCH_LIMIT: usize = 256;
const MAX_REPLAY_EVENTS: usize = 4_096;

#[derive(Debug, thiserror::Error)]
pub enum MissionReplayError {
    #[error("Mission replay durability is unavailable: {0}")]
    Durability(String),
    #[error("Mission replay source is inconsistent: {0}")]
    Inconsistent(String),
    #[error("Mission replay event stream exceeds the finite bound of {max} events")]
    EventLimitExceeded { max: usize },
    #[error("Mission replay serialization failed: {0}")]
    Serialization(String),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MissionReplayIdentity {
    pub mission_id: String,
    pub mission_revision: u64,
    pub plan_id: String,
    pub plan_revision: u64,
    pub status: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MissionReplaySourceSummary {
    pub task_count: usize,
    pub execution_count: usize,
    pub durable_event_count: usize,
    pub durable_event_scanned_count: usize,
    pub durable_event_high_water_seq: i64,
    pub work_packet_count: usize,
    pub mission_completion_packet_present: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MissionReplayGuarantees {
    pub read_only: bool,
    pub deterministic: bool,
    pub restart_safe: bool,
    pub side_effect_count: usize,
    pub existing_mission_owner_used: bool,
    pub existing_task_graph_owner_used: bool,
    pub existing_execution_owner_used: bool,
    pub existing_event_bus_owner_used: bool,
    pub existing_packet_owner_used: bool,
    pub second_journal_used: bool,
    pub second_task_graph_used: bool,
    pub second_packet_store_used: bool,
    pub replay_cache_used: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MissionReplayProjection {
    pub schema: String,
    pub mission: MissionReplayIdentity,
    pub replay_hash: String,
    pub source: MissionReplaySourceSummary,
    pub guarantees: MissionReplayGuarantees,
}

fn mission_error(error: MissionPlanError) -> MissionReplayError {
    match error {
        MissionPlanError::DurabilityUnavailable => {
            MissionReplayError::Durability("Mission/packet SQLite owner is unavailable".into())
        }
        other => MissionReplayError::Inconsistent(other.to_string()),
    }
}

fn event_error(error: EventBusError) -> MissionReplayError {
    match error {
        EventBusError::DurabilityUnavailable => {
            MissionReplayError::Durability("durable Event Bus owner is unavailable".into())
        }
        other => MissionReplayError::Inconsistent(other.to_string()),
    }
}

fn canonicalize(value: &Value) -> Value {
    match value {
        Value::Object(map) => {
            let mut keys = map.keys().collect::<Vec<_>>();
            keys.sort();
            let mut canonical = serde_json::Map::new();
            for key in keys {
                canonical.insert(key.clone(), canonicalize(&map[key]));
            }
            Value::Object(canonical)
        }
        Value::Array(values) => Value::Array(values.iter().map(canonicalize).collect()),
        _ => value.clone(),
    }
}

fn hash_value(domain: &str, value: &Value) -> Result<String, MissionReplayError> {
    let canonical = canonicalize(value);
    let text = serde_json::to_string(&canonical)
        .map_err(|error| MissionReplayError::Serialization(error.to_string()))?;
    Ok(
        crate::command_risk::approval::command_hash(&format!("{domain}\n{text}"))
            .as_str()
            .to_string(),
    )
}

fn canonical_sort_key(value: &Value) -> Result<String, MissionReplayError> {
    serde_json::to_string(&canonicalize(value))
        .map_err(|error| MissionReplayError::Serialization(error.to_string()))
}

fn sort_json_array(values: &mut [Value]) -> Result<(), MissionReplayError> {
    let mut keyed = values
        .iter()
        .cloned()
        .map(|value| Ok((canonical_sort_key(&value)?, value)))
        .collect::<Result<Vec<_>, MissionReplayError>>()?;
    keyed.sort_by(|left, right| left.0.cmp(&right.0));
    for (target, (_, value)) in values.iter_mut().zip(keyed) {
        *target = value;
    }
    Ok(())
}

fn normalized_task_value(task: &Task) -> Result<Value, MissionReplayError> {
    let mut value = serde_json::to_value(task)
        .map_err(|error| MissionReplayError::Serialization(error.to_string()))?;
    let object = value.as_object_mut().ok_or_else(|| {
        MissionReplayError::Serialization("Task did not serialize to an object".into())
    })?;
    for field in ["dependencies", "outputs", "symbols"] {
        if let Some(values) = object.get_mut(field).and_then(Value::as_array_mut) {
            sort_json_array(values)?;
        }
    }
    Ok(value)
}

fn task_material(
    tasks: Vec<Task>,
    planned_ids: &BTreeSet<String>,
) -> Result<Vec<Value>, MissionReplayError> {
    let mut by_id = BTreeMap::new();
    for task in tasks {
        if !planned_ids.contains(&task.id) {
            continue;
        }
        let task_id = task.id.clone();
        let value = normalized_task_value(&task)?;
        let digest = hash_value("aelyris.mission-replay-task/v1", &value)?;
        if by_id
            .insert(
                task_id.clone(),
                json!({
                    "taskId": task_id,
                    "status": task.status.as_str(),
                    "taskDigest": digest,
                }),
            )
            .is_some()
        {
            return Err(MissionReplayError::Inconsistent(format!(
                "duplicate TaskGraph identity {task_id}"
            )));
        }
    }
    if by_id.len() != planned_ids.len() {
        let missing = planned_ids
            .iter()
            .filter(|task_id| !by_id.contains_key(*task_id))
            .cloned()
            .collect::<Vec<_>>();
        return Err(MissionReplayError::Inconsistent(format!(
            "accepted Mission tasks are missing from TaskGraph: {}",
            missing.join(",")
        )));
    }
    Ok(by_id.into_values().collect())
}

fn execution_material(
    executions: &[WorkExecutionAttempt],
) -> Result<Vec<Value>, MissionReplayError> {
    executions
        .iter()
        .map(|attempt| {
            let mut portable = attempt.clone();
            portable.repo_path.clear();
            portable.ownership_claim_ids.sort();
            let value = serde_json::to_value(&portable)
                .map_err(|error| MissionReplayError::Serialization(error.to_string()))?;
            let digest = hash_value("aelyris.mission-replay-execution/v1", &value)?;
            Ok(json!({
                "taskId": attempt.identity.task_id,
                "attemptId": attempt.identity.attempt_id,
                "executionGeneration": attempt.identity.execution_generation,
                "runtime": attempt.runtime.as_str(),
                "state": attempt.state.as_str(),
                "fence": {
                    "effect": attempt.fence.effect.as_str(),
                    "state": attempt.fence.state.as_str(),
                    "revision": attempt.fence.revision,
                },
                "executionDigest": digest,
            }))
        })
        .collect()
}

fn event_material(events: &[SeqEvent]) -> Result<Vec<Value>, MissionReplayError> {
    events
        .iter()
        .enumerate()
        .map(|(index, entry)| {
            let payload_digest = hash_value(
                "aelyris.mission-replay-event-payload/v1",
                &entry.event.payload,
            )?;
            Ok(json!({
                "position": index.saturating_add(1),
                "eventId": entry.event.event_id.clone(),
                "kind": entry.event.kind.as_str(),
                "channel": entry.event.channel.as_str(),
                "payloadDigest": payload_digest,
            }))
        })
        .collect()
}

fn selected_executions(
    executions: Vec<WorkExecutionAttempt>,
    planned_ids: &BTreeSet<String>,
) -> Vec<WorkExecutionAttempt> {
    let mut selected = executions
        .into_iter()
        .filter(|attempt| planned_ids.contains(&attempt.identity.task_id))
        .collect::<Vec<_>>();
    selected.sort_by(|left, right| {
        left.identity
            .task_id
            .cmp(&right.identity.task_id)
            .then_with(|| left.identity.attempt_id.cmp(&right.identity.attempt_id))
    });
    selected
}

fn insert_identity(identities: &mut BTreeSet<String>, value: impl Into<String>) {
    let value = value.into();
    if !value.is_empty() {
        identities.insert(value);
    }
}

fn replay_scope_identities(
    mission: &MissionPlanPreview,
    planned_ids: &BTreeSet<String>,
    executions: &[WorkExecutionAttempt],
    work_packets: &[CompletedWorkPacket],
    mission_packet: Option<&MissionCompletionPacket>,
) -> BTreeSet<String> {
    let mut identities = BTreeSet::new();
    insert_identity(
        &mut identities,
        mission.mission_definition.mission_id.clone(),
    );
    insert_identity(&mut identities, mission.plan_id.clone());
    insert_identity(&mut identities, mission.request_id.clone());
    for task_id in planned_ids {
        insert_identity(&mut identities, task_id.clone());
    }
    for work_unit_id in &mission.work_unit_ids {
        insert_identity(&mut identities, work_unit_id.clone());
    }
    if let Some(task_plan) = &mission.cockpit_task_plan {
        for task in task_plan {
            if let Some(work_unit_id) = &task.work_unit_id {
                insert_identity(&mut identities, work_unit_id.clone());
            }
        }
    }
    for attempt in executions {
        for value in [
            Some(attempt.identity.attempt_id.as_str()),
            Some(attempt.identity.task_id.as_str()),
            Some(attempt.identity.agent_run_id.as_str()),
            Some(attempt.identity.session_id.as_str()),
            attempt.identity.pty_session_id.as_deref(),
            Some(attempt.reservation_event_id.as_str()),
            attempt.merge_intent_id.as_deref(),
        ]
        .into_iter()
        .flatten()
        {
            insert_identity(&mut identities, value.to_string());
        }
        for claim_id in &attempt.ownership_claim_ids {
            insert_identity(&mut identities, claim_id.clone());
        }
    }
    for packet in work_packets {
        for value in [
            Some(packet.packet_id.as_str()),
            Some(packet.activation_id.as_str()),
            Some(packet.work_unit_id.as_str()),
            Some(packet.gate_evidence_id.as_str()),
            Some(packet.review_id.as_str()),
            Some(packet.merge_intent_id.as_str()),
            Some(packet.merge_receipt_id.as_str()),
            packet.supersedes_packet_id.as_deref(),
        ]
        .into_iter()
        .flatten()
        {
            insert_identity(&mut identities, value.to_string());
        }
    }
    if let Some(packet) = mission_packet {
        insert_identity(&mut identities, packet.packet_id.clone());
        for (work_unit_id, packet_id) in &packet.required_work_unit_packet_ids_by_work_unit {
            insert_identity(&mut identities, work_unit_id.clone());
            insert_identity(&mut identities, packet_id.clone());
        }
    }
    identities
}

fn value_contains_identity(value: &Value, identities: &BTreeSet<String>) -> bool {
    match value {
        Value::String(value) => identities.contains(value),
        Value::Array(values) => values
            .iter()
            .any(|value| value_contains_identity(value, identities)),
        Value::Object(values) => values
            .values()
            .any(|value| value_contains_identity(value, identities)),
        _ => false,
    }
}

fn event_matches_scope(event: &SeqEvent, identities: &BTreeSet<String>) -> bool {
    identities.contains(&event.event.event_id)
        || value_contains_identity(&event.event.payload, identities)
}

fn packet_material(
    mut work_packets: Vec<CompletedWorkPacket>,
    mission_packet: Option<MissionCompletionPacket>,
) -> Result<Value, MissionReplayError> {
    for packet in &work_packets {
        packet.validate().map_err(mission_error)?;
    }
    work_packets.sort_by(|left, right| left.packet_id.cmp(&right.packet_id));
    let work_packets = work_packets
        .into_iter()
        .map(|packet| {
            json!({
                "packetId": packet.packet_id,
                "packetDigest": packet.packet_digest,
                "workUnitId": packet.work_unit_id,
                "integratedOid": packet.integrated_oid,
            })
        })
        .collect::<Vec<_>>();
    let mission_packet = match mission_packet {
        Some(packet) => {
            packet.validate().map_err(mission_error)?;
            json!({
                "packetId": packet.packet_id,
                "packetDigest": packet.packet_digest,
                "integratedOid": packet.integrated_oid,
                "requiredWorkPacketCount": packet.required_work_unit_packet_ids_by_work_unit.len(),
            })
        }
        None => Value::Null,
    };
    Ok(json!({
        "workPackets": work_packets,
        "missionCompletionPacket": mission_packet,
    }))
}

fn read_event_stream_with_limit(
    event_bus: &EventBus,
    max_events: usize,
) -> Result<(i64, Vec<SeqEvent>), MissionReplayError> {
    let frontier = event_bus.frontier().map_err(event_error)?;
    if frontier.high_water_seq <= 0 {
        return Ok((frontier.high_water_seq, Vec::new()));
    }
    let mut after_seq = 0_i64;
    let mut events = Vec::new();
    while after_seq < frontier.high_water_seq {
        let batch = event_bus
            .since(after_seq, EVENT_BATCH_LIMIT)
            .map_err(event_error)?;
        if batch.events.is_empty() {
            return Err(MissionReplayError::Inconsistent(format!(
                "durable Event Bus stopped before frontier {}",
                frontier.high_water_seq
            )));
        }
        for event in batch.events {
            if event.seq > frontier.high_water_seq {
                break;
            }
            if events.len() >= max_events {
                return Err(MissionReplayError::EventLimitExceeded { max: max_events });
            }
            after_seq = event.seq;
            events.push(event);
        }
    }
    Ok((frontier.high_water_seq, events))
}

fn planned_task_ids(mission: &MissionPlanPreview) -> Result<BTreeSet<String>, MissionReplayError> {
    let task_plan = mission.cockpit_task_plan.as_ref().ok_or_else(|| {
        MissionReplayError::Inconsistent(
            "current accepted cockpit Mission has no immutable task plan".into(),
        )
    })?;
    let ids = task_plan
        .iter()
        .map(|task| task.id.clone())
        .collect::<BTreeSet<_>>();
    if ids.len() != task_plan.len() {
        return Err(MissionReplayError::Inconsistent(
            "current accepted cockpit Mission contains duplicate task identity".into(),
        ));
    }
    Ok(ids)
}

/// Build one inert canonical replay projection from the existing durable owners.
/// This function performs no audit append and invokes no effect owner; callers may
/// compare its hash before/after restart without changing the source state.
pub fn replay_current_mission(
    task_manager: &TaskManager,
    event_bus: &EventBus,
    repo_path: &str,
) -> Result<Option<MissionReplayProjection>, MissionReplayError> {
    let Some(mission) = task_manager
        .current_cockpit_mission(repo_path)
        .map_err(mission_error)?
    else {
        return Ok(None);
    };
    let planned_ids = planned_task_ids(&mission)?;
    let tasks = task_material(task_manager.list(), &planned_ids)?;
    let selected_executions = selected_executions(task_manager.execution_snapshot(), &planned_ids);
    let execution_count = selected_executions.len();
    let executions = execution_material(&selected_executions)?;
    let work_packets = task_manager
        .completed_work_packets_for_plan(&mission.plan_id, mission.plan_revision)
        .map_err(mission_error)?;
    let work_packet_count = work_packets.len();
    let mission_packet = task_manager
        .cockpit_mission_completion_packet(&mission.plan_id, mission.plan_revision)
        .map_err(mission_error)?;
    let mission_packet_present = mission_packet.is_some();
    let scope_identities = replay_scope_identities(
        &mission,
        &planned_ids,
        &selected_executions,
        &work_packets,
        mission_packet.as_ref(),
    );
    let (event_high_water_seq, scanned_events) =
        read_event_stream_with_limit(event_bus, MAX_REPLAY_EVENTS)?;
    let scanned_event_count = scanned_events.len();
    let selected_events = scanned_events
        .into_iter()
        .filter(|event| event_matches_scope(event, &scope_identities))
        .collect::<Vec<_>>();
    let event_count = selected_events.len();
    let events = event_material(&selected_events)?;
    let packets = packet_material(work_packets, mission_packet)?;
    let identity = MissionReplayIdentity {
        mission_id: mission.mission_definition.mission_id.clone(),
        mission_revision: mission.mission_definition.revision,
        plan_id: mission.plan_id.clone(),
        plan_revision: mission.plan_revision,
        status: mission.status.as_str().to_string(),
    };
    let material = json!({
        "schema": MATERIAL_SCHEMA,
        "mission": {
            "missionId": identity.mission_id.clone(),
            "missionRevision": mission.mission_definition.revision,
            "planId": identity.plan_id.clone(),
            "planRevision": mission.plan_revision,
            "status": mission.status.as_str(),
            "repositoryId": mission.repository_id.clone(),
            "requestDigest": mission.request_digest.clone(),
            "contentDigest": mission.content_digest.clone(),
            "acceptedHeadOid": mission.accepted_mission_head_oid.clone(),
        },
        "tasks": tasks,
        "executions": executions,
        "durableEvents": {
            "eventCount": event_count,
            "events": events,
        },
        "packets": packets,
    });
    let replay_hash = hash_value("aelyris.mission-replay-projection/v1", &material)?;
    Ok(Some(MissionReplayProjection {
        schema: REPLAY_SCHEMA.to_string(),
        mission: identity,
        replay_hash,
        source: MissionReplaySourceSummary {
            task_count: planned_ids.len(),
            execution_count,
            durable_event_count: event_count,
            durable_event_scanned_count: scanned_event_count,
            durable_event_high_water_seq: event_high_water_seq,
            work_packet_count,
            mission_completion_packet_present: mission_packet_present,
        },
        guarantees: MissionReplayGuarantees {
            read_only: true,
            deterministic: true,
            restart_safe: true,
            side_effect_count: 0,
            existing_mission_owner_used: true,
            existing_task_graph_owner_used: true,
            existing_execution_owner_used: true,
            existing_event_bus_owner_used: true,
            existing_packet_owner_used: true,
            second_journal_used: false,
            second_task_graph_used: false,
            second_packet_store_used: false,
            replay_cache_used: false,
        },
    }))
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use super::*;
    use crate::db::{Database, ManagedDb};
    use crate::event_bus::{AgentEvent, AgentEventKind};

    fn commit_repo(path: &std::path::Path) {
        let repo = git2::Repository::init(path).unwrap();
        let signature = git2::Signature::now("Replay test", "replay@example.invalid").unwrap();
        let tree_id = {
            let mut index = repo.index().unwrap();
            index.write_tree().unwrap()
        };
        let tree = repo.find_tree(tree_id).unwrap();
        repo.commit(Some("HEAD"), &signature, &signature, "fixture", &tree, &[])
            .unwrap();
    }

    fn task() -> Task {
        let mut task =
            Task::new("replay-task", "Replay task").with_branches("agent/replay-task", "main");
        task.owner = Some("replay-implementer".to_string());
        task.model = Some("codex".to_string());
        task.outputs = vec!["src/replay.rs".to_string()];
        task
    }

    #[test]
    fn canonical_hash_ignores_object_key_order_and_detects_fact_change() {
        let left = json!({"b": 2, "a": {"y": 2, "x": 1}});
        let right = json!({"a": {"x": 1, "y": 2}, "b": 2});
        assert_eq!(
            hash_value("test", &left).unwrap(),
            hash_value("test", &right).unwrap()
        );
        let changed = json!({"a": {"x": 1, "y": 3}, "b": 2});
        assert_ne!(
            hash_value("test", &left).unwrap(),
            hash_value("test", &changed).unwrap()
        );
    }

    #[test]
    fn task_digest_normalizes_set_like_arrays() {
        let mut left = task();
        left.dependencies = vec!["b".to_string(), "a".to_string()];
        left.outputs = vec!["z.rs".to_string(), "a.rs".to_string()];
        let mut right = left.clone();
        right.dependencies.reverse();
        right.outputs.reverse();
        let ids = BTreeSet::from([left.id.clone()]);
        assert_eq!(
            task_material(vec![left], &ids).unwrap(),
            task_material(vec![right], &ids).unwrap()
        );
    }

    #[test]
    fn event_stream_fails_closed_at_the_explicit_bound() {
        let db = Arc::new(ManagedDb::new(Database::open_memory().unwrap()));
        let bus = EventBus::new_durable();
        bus.attach_db(db);
        bus.publish(AgentEvent::new(
            AgentEventKind::TaskCreated,
            json!({"id": "one"}),
        ))
        .unwrap();
        bus.publish(AgentEvent::new(
            AgentEventKind::TaskCreated,
            json!({"id": "two"}),
        ))
        .unwrap();
        assert!(matches!(
            read_event_stream_with_limit(&bus, 1),
            Err(MissionReplayError::EventLimitExceeded { max: 1 })
        ));
    }

    #[test]
    fn replay_is_read_only_and_hashes_identically_after_restart() {
        let repository = tempfile::tempdir().unwrap();
        commit_repo(repository.path());
        let repo_path = repository.path().to_string_lossy().into_owned();
        let database_dir = tempfile::tempdir().unwrap();
        let database_path = database_dir.path().join("replay.sqlite3");

        let latest_projection = {
            let db = Arc::new(ManagedDb::new(Database::open(&database_path).unwrap()));
            let tasks = TaskManager::new_durable();
            tasks.attach_db(db.clone()).unwrap();
            tasks
                .submit_cockpit_plan(
                    "Build deterministic Mission replay",
                    vec![task()],
                    &repo_path,
                    &uuid::Uuid::now_v7().to_string(),
                )
                .unwrap();
            let events = EventBus::new_durable();
            events.attach_db(db);
            events
                .publish(AgentEvent::new(
                    AgentEventKind::TaskCreated,
                    json!({"id": "unrelated-before"}),
                ))
                .unwrap();
            events
                .publish(AgentEvent::new(
                    AgentEventKind::TaskCreated,
                    json!({"id": "replay-task"}),
                ))
                .unwrap();
            let before_tasks = serde_json::to_value(tasks.list()).unwrap();
            let before_frontier = events.frontier().unwrap();
            let before_unrelated_append = replay_current_mission(&tasks, &events, &repo_path)
                .unwrap()
                .unwrap();
            events
                .publish(AgentEvent::new(
                    AgentEventKind::TaskCreated,
                    json!({"id": "unrelated-after"}),
                ))
                .unwrap();
            let projection = replay_current_mission(&tasks, &events, &repo_path)
                .unwrap()
                .unwrap();
            assert_eq!(
                before_unrelated_append.replay_hash, projection.replay_hash,
                "unrelated durable events must not perturb the Mission replay hash"
            );
            assert_eq!(projection.guarantees.side_effect_count, 0);
            assert_eq!(projection.source.task_count, 1);
            assert_eq!(projection.source.durable_event_count, 1);
            assert_eq!(projection.source.durable_event_scanned_count, 3);
            assert_eq!(serde_json::to_value(tasks.list()).unwrap(), before_tasks);
            assert_eq!(
                events.frontier().unwrap().high_water_seq,
                before_frontier.high_water_seq + 1
            );
            projection
        };

        let restarted_projection = {
            let db = Arc::new(ManagedDb::new(Database::open(&database_path).unwrap()));
            let tasks = TaskManager::new_durable();
            tasks.attach_db(db.clone()).unwrap();
            let events = EventBus::new_durable();
            events.attach_db(db);
            replay_current_mission(&tasks, &events, &repo_path)
                .unwrap()
                .unwrap()
        };

        assert_eq!(latest_projection, restarted_projection);
        assert_eq!(latest_projection.schema, REPLAY_SCHEMA);
        assert!(latest_projection.guarantees.read_only);
        assert!(latest_projection.guarantees.deterministic);
        assert!(latest_projection.guarantees.restart_safe);
        assert!(!latest_projection.guarantees.second_journal_used);
        assert!(!latest_projection.guarantees.second_task_graph_used);
        assert!(!latest_projection.guarantees.second_packet_store_used);
        assert!(!latest_projection.guarantees.replay_cache_used);
    }
}
