use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::event_bus::{AgentEventKind, EventBus, EventBusError, SeqEvent};
use crate::task::{
    CompletedWorkPacket, MissionCompletionPacket, MissionPlanError, MissionPlanPreview, Task,
    TaskManager, TaskStatus, WorkExecutionAttempt,
};

const REPLAY_SCHEMA: &str = "aelyris.mission-replay/v1";
const MATERIAL_SCHEMA: &str = "aelyris.mission-replay-material/v1";
const TIMELINE_SCHEMA: &str = "aelyris.mission-replay-timeline/v1";
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

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MissionReplayCheckpoint {
    pub position: usize,
    pub event_kind: String,
    pub task_status_counts: BTreeMap<String, usize>,
    pub completed_work_count: usize,
    pub packet_backed_mission_state: String,
    pub checkpoint_hash: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MissionReplayTimelineProjection {
    pub schema: String,
    pub mission: MissionReplayIdentity,
    pub timeline_hash: String,
    pub checkpoint_count: usize,
    pub checkpoints: Vec<MissionReplayCheckpoint>,
    pub final_task_status_counts: BTreeMap<String, usize>,
    pub final_completed_work_count: usize,
    pub final_packet_backed_mission_state: String,
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
    selected_task_rows(tasks, planned_ids)?
        .into_iter()
        .map(|task| {
            let task_id = task.id.clone();
            let value = normalized_task_value(&task)?;
            let digest = hash_value("aelyris.mission-replay-task/v1", &value)?;
            Ok(json!({
                "taskId": task_id,
                "status": task.status.as_str(),
                "taskDigest": digest,
            }))
        })
        .collect()
}

fn selected_task_rows(
    tasks: Vec<Task>,
    planned_ids: &BTreeSet<String>,
) -> Result<Vec<Task>, MissionReplayError> {
    let mut by_id = BTreeMap::new();
    for task in tasks {
        if !planned_ids.contains(&task.id) {
            continue;
        }
        let task_id = task.id.clone();
        if by_id.insert(task_id.clone(), task).is_some() {
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

#[derive(Debug, Clone, PartialEq, Eq)]
struct PacketExpectations {
    work_packet_ids_by_task: BTreeMap<String, String>,
    mission_packet_id: Option<String>,
}

fn replay_guarantees() -> MissionReplayGuarantees {
    MissionReplayGuarantees {
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
    }
}

fn replay_identity(mission: &MissionPlanPreview) -> MissionReplayIdentity {
    MissionReplayIdentity {
        mission_id: mission.mission_definition.mission_id.clone(),
        mission_revision: mission.mission_definition.revision,
        plan_id: mission.plan_id.clone(),
        plan_revision: mission.plan_revision,
        status: mission.status.as_str().to_string(),
    }
}

fn plan_dependencies(
    mission: &MissionPlanPreview,
) -> Result<BTreeMap<String, Vec<String>>, MissionReplayError> {
    let plan = mission.cockpit_task_plan.as_ref().ok_or_else(|| {
        MissionReplayError::Inconsistent(
            "current accepted cockpit Mission has no immutable task plan".into(),
        )
    })?;
    let known = plan
        .iter()
        .map(|task| task.id.clone())
        .collect::<BTreeSet<_>>();
    let mut dependencies = BTreeMap::new();
    for task in plan {
        if task
            .dependencies
            .iter()
            .any(|dependency| !known.contains(dependency))
        {
            return Err(MissionReplayError::Inconsistent(format!(
                "Mission task {} references an unknown dependency",
                task.id
            )));
        }
        let mut task_dependencies = task.dependencies.clone();
        task_dependencies.sort();
        task_dependencies.dedup();
        if dependencies
            .insert(task.id.clone(), task_dependencies)
            .is_some()
        {
            return Err(MissionReplayError::Inconsistent(format!(
                "duplicate immutable Mission task {}",
                task.id
            )));
        }
    }
    Ok(dependencies)
}

fn status_counts(statuses: &BTreeMap<String, TaskStatus>) -> BTreeMap<String, usize> {
    let mut counts = BTreeMap::new();
    for status in statuses.values() {
        *counts.entry(status.as_str().to_string()).or_insert(0) += 1;
    }
    counts
}

fn recompute_dependency_gate(
    statuses: &mut BTreeMap<String, TaskStatus>,
    dependencies: &BTreeMap<String, Vec<String>>,
) -> Result<(), MissionReplayError> {
    let mut changes = Vec::new();
    for (task_id, task_dependencies) in dependencies {
        let current = *statuses.get(task_id).ok_or_else(|| {
            MissionReplayError::Inconsistent(format!(
                "replay status is missing Mission task {task_id}"
            ))
        })?;
        if !matches!(current, TaskStatus::Pending | TaskStatus::Blocked) {
            continue;
        }
        let dependency_statuses = task_dependencies
            .iter()
            .map(|dependency| {
                statuses.get(dependency).copied().ok_or_else(|| {
                    MissionReplayError::Inconsistent(format!(
                        "replay dependency {dependency} is missing"
                    ))
                })
            })
            .collect::<Result<Vec<_>, _>>()?;
        let next = if dependency_statuses.contains(&TaskStatus::Failed) {
            Some(TaskStatus::Blocked)
        } else if dependency_statuses
            .iter()
            .all(|status| *status == TaskStatus::Done)
        {
            Some(TaskStatus::Ready)
        } else {
            None
        };
        if let Some(next) = next.filter(|next| *next != current) {
            changes.push((task_id.clone(), next));
        }
    }
    for (task_id, status) in changes {
        statuses.insert(task_id, status);
    }
    Ok(())
}

fn initial_statuses(
    dependencies: &BTreeMap<String, Vec<String>>,
) -> Result<BTreeMap<String, TaskStatus>, MissionReplayError> {
    let mut statuses = dependencies
        .keys()
        .cloned()
        .map(|task_id| (task_id, TaskStatus::Pending))
        .collect::<BTreeMap<_, _>>();
    recompute_dependency_gate(&mut statuses, dependencies)?;
    Ok(statuses)
}

fn transition_replay_task(
    statuses: &mut BTreeMap<String, TaskStatus>,
    dependencies: &BTreeMap<String, Vec<String>>,
    task_id: &str,
    target: TaskStatus,
    event_kind: AgentEventKind,
) -> Result<(), MissionReplayError> {
    let current = statuses.get(task_id).copied().ok_or_else(|| {
        MissionReplayError::Inconsistent(format!(
            "Mission event {} references unknown task {task_id}",
            event_kind.as_str()
        ))
    })?;
    if current == target {
        return Ok(());
    }
    if !current.can_transition(target) {
        return Err(MissionReplayError::Inconsistent(format!(
            "illegal replay lifecycle transition for {task_id}: {} -> {} from {}",
            current.as_str(),
            target.as_str(),
            event_kind.as_str()
        )));
    }
    statuses.insert(task_id.to_string(), target);
    recompute_dependency_gate(statuses, dependencies)
}

fn payload_string(payload: &Value, key: &str) -> Result<Option<String>, MissionReplayError> {
    let Some(value) = payload.get(key) else {
        return Ok(None);
    };
    if value.is_null() {
        return Ok(None);
    }
    value
        .as_str()
        .map(|value| Some(value.to_string()))
        .ok_or_else(|| {
            MissionReplayError::Inconsistent(format!(
                "Mission event field {key} must be a string or null"
            ))
        })
}

fn event_task_id(event: &SeqEvent) -> Result<Option<String>, MissionReplayError> {
    let mut values = Vec::new();
    for key in ["taskId", "task"] {
        if let Some(value) = payload_string(&event.event.payload, key)? {
            values.push(value);
        }
    }
    if matches!(
        event.event.kind,
        AgentEventKind::TaskCreated
            | AgentEventKind::TaskCompleted
            | AgentEventKind::ReviewRequired
    ) {
        if let Some(value) = payload_string(&event.event.payload, "id")? {
            values.push(value);
        }
    }
    values.sort();
    values.dedup();
    match values.len() {
        0 => Ok(None),
        1 => Ok(values.pop()),
        _ => Err(MissionReplayError::Inconsistent(format!(
            "Mission event {} contains conflicting task identities",
            event.event.kind.as_str()
        ))),
    }
}

fn event_requires_task(kind: AgentEventKind) -> bool {
    matches!(
        kind,
        AgentEventKind::TaskCreated
            | AgentEventKind::TaskCompleted
            | AgentEventKind::ReviewRequired
            | AgentEventKind::ExecutionReserved
            | AgentEventKind::AgentSpawned
            | AgentEventKind::EscalationRaised
    )
}

fn event_target_status(kind: AgentEventKind) -> Option<TaskStatus> {
    match kind {
        AgentEventKind::ExecutionReserved | AgentEventKind::AgentSpawned => {
            Some(TaskStatus::Running)
        }
        AgentEventKind::ReviewRequired => Some(TaskStatus::Review),
        AgentEventKind::TaskCompleted => Some(TaskStatus::Done),
        AgentEventKind::EscalationRaised => Some(TaskStatus::Failed),
        AgentEventKind::BlockerRaised => Some(TaskStatus::Blocked),
        _ => None,
    }
}

fn packet_expectations(
    mission: &MissionPlanPreview,
    work_packets: &[CompletedWorkPacket],
    mission_packet: Option<&MissionCompletionPacket>,
) -> Result<PacketExpectations, MissionReplayError> {
    let plan = mission.cockpit_task_plan.as_ref().ok_or_else(|| {
        MissionReplayError::Inconsistent(
            "current accepted cockpit Mission has no immutable task plan".into(),
        )
    })?;
    let mut task_by_work_unit = BTreeMap::new();
    for task in plan {
        if let Some(work_unit_id) = &task.work_unit_id {
            if task_by_work_unit
                .insert(work_unit_id.clone(), task.id.clone())
                .is_some()
            {
                return Err(MissionReplayError::Inconsistent(format!(
                    "duplicate Mission work unit {work_unit_id}"
                )));
            }
        }
    }

    let mut packet_ids_by_work_unit = BTreeMap::new();
    let mut work_packet_ids_by_task = BTreeMap::new();
    for packet in work_packets {
        packet.validate().map_err(mission_error)?;
        if packet.plan_id != mission.plan_id
            || packet.plan_revision != mission.plan_revision
            || packet.mission_id != mission.mission_definition.mission_id
            || packet.mission_revision != mission.mission_definition.revision
            || packet.plan_content_digest != mission.content_digest
        {
            return Err(MissionReplayError::Inconsistent(
                "CompletedWorkPacket lineage differs from current Mission".into(),
            ));
        }
        let task_id = task_by_work_unit.get(&packet.work_unit_id).ok_or_else(|| {
            MissionReplayError::Inconsistent(format!(
                "CompletedWorkPacket references unknown work unit {}",
                packet.work_unit_id
            ))
        })?;
        if work_packet_ids_by_task
            .insert(task_id.clone(), packet.packet_id.clone())
            .is_some()
        {
            return Err(MissionReplayError::Inconsistent(format!(
                "multiple CompletedWorkPackets exist for Mission task {task_id}"
            )));
        }
        packet_ids_by_work_unit.insert(packet.work_unit_id.clone(), packet.packet_id.clone());
    }

    let mission_packet_id = if let Some(packet) = mission_packet {
        packet.validate().map_err(mission_error)?;
        if packet.mission_id != mission.mission_definition.mission_id
            || packet.mission_revision != mission.mission_definition.revision
            || packet.required_work_unit_packet_ids_by_work_unit != packet_ids_by_work_unit
        {
            return Err(MissionReplayError::Inconsistent(
                "MissionCompletionPacket lineage differs from current Mission packets".into(),
            ));
        }
        Some(packet.packet_id.clone())
    } else {
        None
    };

    Ok(PacketExpectations {
        work_packet_ids_by_task,
        mission_packet_id,
    })
}

fn checkpoint(
    position: usize,
    event_kind: &str,
    statuses: &BTreeMap<String, TaskStatus>,
    seen_work_packets: &BTreeMap<String, String>,
    mission_packet_seen: bool,
) -> Result<MissionReplayCheckpoint, MissionReplayError> {
    let packet_backed_mission_state = if mission_packet_seen
        && seen_work_packets.len() == statuses.len()
        && statuses.values().all(|status| *status == TaskStatus::Done)
    {
        "completed"
    } else {
        "incomplete"
    };
    let private_statuses = statuses
        .iter()
        .map(|(task_id, status)| (task_id.clone(), status.as_str().to_string()))
        .collect::<BTreeMap<_, _>>();
    let material = json!({
        "position": position,
        "eventKind": event_kind,
        "taskStatuses": private_statuses,
        "seenWorkPacketsByTask": seen_work_packets,
        "missionPacketSeen": mission_packet_seen,
        "packetBackedMissionState": packet_backed_mission_state,
    });
    Ok(MissionReplayCheckpoint {
        position,
        event_kind: event_kind.to_string(),
        task_status_counts: status_counts(statuses),
        completed_work_count: seen_work_packets.len(),
        packet_backed_mission_state: packet_backed_mission_state.to_string(),
        checkpoint_hash: hash_value("aelyris.mission-replay-checkpoint/v1", &material)?,
    })
}

fn apply_completion_references(
    event: &SeqEvent,
    task_id: &str,
    expectations: &PacketExpectations,
    seen_work_packets: &mut BTreeMap<String, String>,
    mission_packet_seen: &mut bool,
) -> Result<(), MissionReplayError> {
    let settled = match event.event.payload.get("settled") {
        Some(value) => value.as_bool().ok_or_else(|| {
            MissionReplayError::Inconsistent("TaskCompleted settled field must be boolean".into())
        })?,
        None => false,
    };
    let work_packet_id = payload_string(&event.event.payload, "workPacketId")?;
    let mission_packet_id = payload_string(&event.event.payload, "missionCompletionPacketId")?;
    if !settled && (work_packet_id.is_some() || mission_packet_id.is_some()) {
        return Err(MissionReplayError::Inconsistent(
            "unsettled TaskCompleted event carries packet references".into(),
        ));
    }
    if settled && work_packet_id.is_none() {
        return Err(MissionReplayError::Inconsistent(
            "settled TaskCompleted event lacks WorkPacket identity".into(),
        ));
    }
    if let Some(work_packet_id) = work_packet_id {
        let expected = expectations
            .work_packet_ids_by_task
            .get(task_id)
            .ok_or_else(|| {
                MissionReplayError::Inconsistent(format!(
                    "TaskCompleted references a WorkPacket absent from durable settlement for {task_id}"
                ))
            })?;
        if expected != &work_packet_id {
            return Err(MissionReplayError::Inconsistent(format!(
                "TaskCompleted WorkPacket differs from durable settlement for {task_id}"
            )));
        }
        if seen_work_packets
            .insert(task_id.to_string(), work_packet_id)
            .is_some()
        {
            return Err(MissionReplayError::Inconsistent(format!(
                "duplicate packet-backed TaskCompleted event for {task_id}"
            )));
        }
    }
    if let Some(mission_packet_id) = mission_packet_id {
        let expected = expectations.mission_packet_id.as_ref().ok_or_else(|| {
            MissionReplayError::Inconsistent(
                "TaskCompleted references a MissionCompletionPacket absent from durable settlement"
                    .into(),
            )
        })?;
        if expected != &mission_packet_id || *mission_packet_seen {
            return Err(MissionReplayError::Inconsistent(
                "TaskCompleted MissionCompletionPacket is duplicate or differs from durable settlement"
                    .into(),
            ));
        }
        *mission_packet_seen = true;
    }
    Ok(())
}

fn reduce_checkpoints(
    mission: &MissionPlanPreview,
    current_tasks: &[Task],
    events: &[SeqEvent],
    expectations: &PacketExpectations,
) -> Result<Vec<MissionReplayCheckpoint>, MissionReplayError> {
    let dependencies = plan_dependencies(mission)?;
    let mut statuses = initial_statuses(&dependencies)?;
    let mut seen_event_ids = BTreeSet::new();
    let mut seen_work_packets = BTreeMap::new();
    let mut mission_packet_seen = false;
    let mut previous_seq = 0_i64;
    let mut checkpoints = vec![checkpoint(
        0,
        "mission_accepted",
        &statuses,
        &seen_work_packets,
        mission_packet_seen,
    )?];

    for (index, event) in events.iter().enumerate() {
        if event.seq <= previous_seq {
            return Err(MissionReplayError::Inconsistent(
                "Mission event sequence regressed or duplicated".into(),
            ));
        }
        previous_seq = event.seq;
        if !seen_event_ids.insert(event.event.event_id.clone()) {
            return Err(MissionReplayError::Inconsistent(format!(
                "duplicate Mission event identity {}",
                event.event.event_id
            )));
        }
        let task_id = event_task_id(event)?;
        if let Some(task_id) = task_id.as_ref() {
            if !statuses.contains_key(task_id) {
                return Err(MissionReplayError::Inconsistent(format!(
                    "Mission event {} references unknown task {task_id}",
                    event.event.kind.as_str()
                )));
            }
        } else if event_requires_task(event.event.kind) {
            return Err(MissionReplayError::Inconsistent(format!(
                "Mission event {} lacks exact task identity",
                event.event.kind.as_str()
            )));
        }

        if event.event.kind == AgentEventKind::TaskCreated {
            // The immutable accepted Mission already owns initial task identity.
        } else if let Some(target) = event_target_status(event.event.kind) {
            if let Some(task_id) = task_id.as_deref() {
                transition_replay_task(
                    &mut statuses,
                    &dependencies,
                    task_id,
                    target,
                    event.event.kind,
                )?;
            }
        }
        if event.event.kind == AgentEventKind::TaskCompleted {
            apply_completion_references(
                event,
                task_id
                    .as_deref()
                    .expect("TaskCompleted task checked above"),
                expectations,
                &mut seen_work_packets,
                &mut mission_packet_seen,
            )?;
        }
        checkpoints.push(checkpoint(
            index.saturating_add(1),
            event.event.kind.as_str(),
            &statuses,
            &seen_work_packets,
            mission_packet_seen,
        )?);
    }

    let current = current_tasks
        .iter()
        .map(|task| (task.id.clone(), task.status))
        .collect::<BTreeMap<_, _>>();
    if current != statuses {
        return Err(MissionReplayError::Inconsistent(
            "historical replay does not converge on the current TaskGraph".into(),
        ));
    }
    for (task_id, status) in &statuses {
        let packet_present = expectations.work_packet_ids_by_task.contains_key(task_id);
        if *status == TaskStatus::Done && !packet_present {
            return Err(MissionReplayError::Inconsistent(format!(
                "Done Mission task {task_id} lacks immutable WorkPacket"
            )));
        }
        if *status != TaskStatus::Done && packet_present {
            return Err(MissionReplayError::Inconsistent(format!(
                "non-Done Mission task {task_id} already owns immutable WorkPacket"
            )));
        }
    }
    if seen_work_packets != expectations.work_packet_ids_by_task {
        return Err(MissionReplayError::Inconsistent(
            "historical replay packet events do not match durable WorkPackets".into(),
        ));
    }
    let all_done = statuses.values().all(|status| *status == TaskStatus::Done);
    if all_done {
        if expectations.mission_packet_id.is_none() || !mission_packet_seen {
            return Err(MissionReplayError::Inconsistent(
                "fully Done Mission lacks packet-backed Mission completion event".into(),
            ));
        }
    } else if expectations.mission_packet_id.is_some() || mission_packet_seen {
        return Err(MissionReplayError::Inconsistent(
            "incomplete Mission unexpectedly owns MissionCompletionPacket".into(),
        ));
    }
    Ok(checkpoints)
}

/// Reconstruct bounded historical task-state checkpoints from the immutable
/// accepted plan and the same Mission-scoped durable event sequence used by V2-M0.
/// The reducer is observation-only and requires final convergence with current
/// TaskGraph plus immutable packet truth.
pub fn replay_current_mission_timeline(
    task_manager: &TaskManager,
    event_bus: &EventBus,
    repo_path: &str,
) -> Result<Option<MissionReplayTimelineProjection>, MissionReplayError> {
    let Some(mission) = task_manager
        .current_cockpit_mission(repo_path)
        .map_err(mission_error)?
    else {
        return Ok(None);
    };
    let planned_ids = planned_task_ids(&mission)?;
    let current_tasks = selected_task_rows(task_manager.list(), &planned_ids)?;
    let selected_executions = selected_executions(task_manager.execution_snapshot(), &planned_ids);
    let work_packets = task_manager
        .completed_work_packets_for_plan(&mission.plan_id, mission.plan_revision)
        .map_err(mission_error)?;
    let mission_packet = task_manager
        .cockpit_mission_completion_packet(&mission.plan_id, mission.plan_revision)
        .map_err(mission_error)?;
    let expectations = packet_expectations(&mission, &work_packets, mission_packet.as_ref())?;
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
    let checkpoints =
        reduce_checkpoints(&mission, &current_tasks, &selected_events, &expectations)?;
    let last = checkpoints.last().ok_or_else(|| {
        MissionReplayError::Inconsistent("Mission replay produced no checkpoint".into())
    })?;
    let final_task_status_counts = last.task_status_counts.clone();
    let final_completed_work_count = last.completed_work_count;
    let final_packet_backed_mission_state = last.packet_backed_mission_state.clone();
    let timeline_material = json!({
        "schema": TIMELINE_SCHEMA,
        "mission": replay_identity(&mission),
        "checkpointHashes": checkpoints
            .iter()
            .map(|checkpoint| checkpoint.checkpoint_hash.clone())
            .collect::<Vec<_>>(),
    });
    let timeline_hash = hash_value("aelyris.mission-replay-timeline/v1", &timeline_material)?;
    Ok(Some(MissionReplayTimelineProjection {
        schema: TIMELINE_SCHEMA.to_string(),
        mission: replay_identity(&mission),
        timeline_hash,
        checkpoint_count: checkpoints.len(),
        checkpoints,
        final_task_status_counts,
        final_completed_work_count,
        final_packet_backed_mission_state,
        source: MissionReplaySourceSummary {
            task_count: planned_ids.len(),
            execution_count: selected_executions.len(),
            durable_event_count: selected_events.len(),
            durable_event_scanned_count: scanned_event_count,
            durable_event_high_water_seq: event_high_water_seq,
            work_packet_count: work_packets.len(),
            mission_completion_packet_present: mission_packet.is_some(),
        },
        guarantees: replay_guarantees(),
    }))
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

    fn seq_event(seq: i64, id: &str, kind: AgentEventKind, payload: Value) -> SeqEvent {
        SeqEvent {
            seq,
            event: AgentEvent::new(kind, payload).with_idempotency_key(id),
        }
    }

    #[test]
    fn timeline_hashes_identically_after_restart_without_volatile_status_fiction() {
        let repository = tempfile::tempdir().unwrap();
        commit_repo(repository.path());
        let repo_path = repository.path().to_string_lossy().into_owned();
        let database_dir = tempfile::tempdir().unwrap();
        let database_path = database_dir.path().join("timeline.sqlite3");

        let first = {
            let db = Arc::new(ManagedDb::new(Database::open(&database_path).unwrap()));
            let tasks = TaskManager::new_durable();
            tasks.attach_db(db.clone()).unwrap();
            tasks
                .submit_cockpit_plan(
                    "Reconstruct Mission review state",
                    vec![task()],
                    &repo_path,
                    &uuid::Uuid::now_v7().to_string(),
                )
                .unwrap();
            let events = EventBus::new_durable();
            events.attach_db(db);
            events
                .publish(
                    AgentEvent::new(AgentEventKind::TaskCreated, json!({"id": "replay-task"}))
                        .with_idempotency_key("timeline-created"),
                )
                .unwrap();
            let before_tasks = serde_json::to_value(tasks.list()).unwrap();
            let before_frontier = events.frontier().unwrap();
            let projection = replay_current_mission_timeline(&tasks, &events, &repo_path)
                .unwrap()
                .unwrap();
            assert_eq!(serde_json::to_value(tasks.list()).unwrap(), before_tasks);
            assert_eq!(events.frontier().unwrap(), before_frontier);
            projection
        };

        let restarted = {
            let db = Arc::new(ManagedDb::new(Database::open(&database_path).unwrap()));
            let tasks = TaskManager::new_durable();
            tasks.attach_db(db.clone()).unwrap();
            let events = EventBus::new_durable();
            events.attach_db(db);
            replay_current_mission_timeline(&tasks, &events, &repo_path)
                .unwrap()
                .unwrap()
        };

        assert_eq!(first, restarted);
        assert_eq!(first.checkpoint_count, 2);
        assert_eq!(first.checkpoints[0].event_kind, "mission_accepted");
        assert_eq!(first.checkpoints[1].event_kind, "task_created");
        assert_eq!(first.final_task_status_counts["ready"], 1);
        assert_eq!(first.final_completed_work_count, 0);
        assert_eq!(first.final_packet_backed_mission_state, "incomplete");
        assert_eq!(first.guarantees.side_effect_count, 0);
    }

    #[test]
    fn reducer_marks_completion_only_from_exact_packet_references() {
        let repository = tempfile::tempdir().unwrap();
        commit_repo(repository.path());
        let repo_path = repository.path().to_string_lossy().into_owned();
        let db = Arc::new(ManagedDb::new(Database::open_memory().unwrap()));
        let tasks = TaskManager::new_durable();
        tasks.attach_db(db).unwrap();
        let (_, mission) = tasks
            .submit_cockpit_plan(
                "Reduce packet-backed completion",
                vec![task()],
                &repo_path,
                &uuid::Uuid::now_v7().to_string(),
            )
            .unwrap();
        let mut done_task = task();
        done_task.status = TaskStatus::Done;
        let events = vec![
            seq_event(
                1,
                "packet-created",
                AgentEventKind::TaskCreated,
                json!({"id": "replay-task"}),
            ),
            seq_event(
                2,
                "packet-running",
                AgentEventKind::ExecutionReserved,
                json!({"taskId": "replay-task"}),
            ),
            seq_event(
                3,
                "packet-review",
                AgentEventKind::ReviewRequired,
                json!({"id": "replay-task"}),
            ),
            seq_event(
                4,
                "packet-done",
                AgentEventKind::TaskCompleted,
                json!({
                    "id": "replay-task",
                    "settled": true,
                    "workPacketId": "work-packet-1",
                    "missionCompletionPacketId": "mission-packet-1",
                }),
            ),
        ];
        let expectations = PacketExpectations {
            work_packet_ids_by_task: BTreeMap::from([(
                "replay-task".to_string(),
                "work-packet-1".to_string(),
            )]),
            mission_packet_id: Some("mission-packet-1".to_string()),
        };
        let checkpoints =
            reduce_checkpoints(&mission, &[done_task], &events, &expectations).unwrap();
        let last = checkpoints.last().unwrap();
        assert_eq!(last.task_status_counts["done"], 1);
        assert_eq!(last.completed_work_count, 1);
        assert_eq!(last.packet_backed_mission_state, "completed");
    }

    #[test]
    fn reducer_fails_unknown_task_and_illegal_lifecycle_transition() {
        let repository = tempfile::tempdir().unwrap();
        commit_repo(repository.path());
        let repo_path = repository.path().to_string_lossy().into_owned();
        let db = Arc::new(ManagedDb::new(Database::open_memory().unwrap()));
        let tasks = TaskManager::new_durable();
        tasks.attach_db(db).unwrap();
        let (_, mission) = tasks
            .submit_cockpit_plan(
                "Reject invalid replay events",
                vec![task()],
                &repo_path,
                &uuid::Uuid::now_v7().to_string(),
            )
            .unwrap();
        let current = tasks.list();
        let empty = PacketExpectations {
            work_packet_ids_by_task: BTreeMap::new(),
            mission_packet_id: None,
        };
        let unknown = vec![seq_event(
            1,
            "unknown-task",
            AgentEventKind::ReviewRequired,
            json!({
                "missionId": mission.mission_definition.mission_id,
                "taskId": "not-a-mission-task",
            }),
        )];
        assert!(matches!(
            reduce_checkpoints(&mission, &current, &unknown, &empty),
            Err(MissionReplayError::Inconsistent(message)) if message.contains("unknown task")
        ));
        let illegal = vec![seq_event(
            1,
            "illegal-review",
            AgentEventKind::ReviewRequired,
            json!({"id": "replay-task"}),
        )];
        assert!(matches!(
            reduce_checkpoints(&mission, &current, &illegal, &empty),
            Err(MissionReplayError::Inconsistent(message)) if message.contains("illegal replay lifecycle transition")
        ));
    }

    #[test]
    fn reducer_rejects_done_without_immutable_packets() {
        let repository = tempfile::tempdir().unwrap();
        commit_repo(repository.path());
        let repo_path = repository.path().to_string_lossy().into_owned();
        let db = Arc::new(ManagedDb::new(Database::open_memory().unwrap()));
        let tasks = TaskManager::new_durable();
        tasks.attach_db(db).unwrap();
        let (_, mission) = tasks
            .submit_cockpit_plan(
                "Reject packet-free Done replay",
                vec![task()],
                &repo_path,
                &uuid::Uuid::now_v7().to_string(),
            )
            .unwrap();
        let mut done_task = task();
        done_task.status = TaskStatus::Done;
        let events = vec![
            seq_event(
                1,
                "missing-packet-running",
                AgentEventKind::ExecutionReserved,
                json!({"taskId": "replay-task"}),
            ),
            seq_event(
                2,
                "missing-packet-done",
                AgentEventKind::TaskCompleted,
                json!({"id": "replay-task"}),
            ),
        ];
        let empty = PacketExpectations {
            work_packet_ids_by_task: BTreeMap::new(),
            mission_packet_id: None,
        };
        assert!(matches!(
            reduce_checkpoints(&mission, &[done_task], &events, &empty),
            Err(MissionReplayError::Inconsistent(message)) if message.contains("lacks immutable WorkPacket")
        ));
    }
}
