//! `TaskRepo` — persistence for the Task Graph (FR-2).
//!
//! The Task Graph's live state (status, crash/rework/timeout attempts, branch
//! bindings, outputs) is mutated through `TaskManager` — including the opaque
//! revisioned snapshot/apply boundary the autonomy loop drives. Rather than try to
//! diff which tasks changed inside that closure (a missed site = a silent
//! durability hole), `save_graph` persists the WHOLE graph snapshot atomically
//! after each mutation. The graph is small (a single operator's fleet), so a
//! full re-upsert per mutation is cheap and eliminates the missed-write-through
//! bug class entirely. `load_graph` restores exact statuses (no recompute).

use std::collections::HashMap;
use std::str::FromStr;

use rusqlite::{params, OptionalExtension};

use crate::db::Database;
use crate::task::graph::{Task, TaskGraph, TaskPriority};
use crate::task::mission::{
    decision_unix_ms, validate_decision_principal, MissionGateEvidence, MissionPlanActivation,
    MissionPlanError, MissionPlanPreview, MissionPlanStatus,
};
use crate::task::status::TaskStatus;

/// Raw columns of one `tasks` row, before enum/JSON parsing (which happens
/// outside the rusqlite closure so parse errors surface as `String`).
struct RawTask {
    id: String,
    title: String,
    description: String,
    status: String,
    owner: Option<String>,
    model: Option<String>,
    priority: String,
    estimate: Option<i64>,
    outputs_json: String,
    source_branch: Option<String>,
    target_branch: Option<String>,
    crash_attempts: i64,
    rework_attempts: i64,
    timeout_attempts: i64,
}

struct RawMissionPlan {
    plan_id: String,
    plan_revision: i64,
    request_id: String,
    mission_id: String,
    mission_revision: i64,
    request_digest: String,
    content_digest: String,
    preview_json: String,
    status: String,
    decision_principal_id: Option<String>,
    decision_reason: Option<String>,
    created_at_ms: i64,
    decided_at_ms: Option<i64>,
}

pub struct TaskRepo;

impl TaskRepo {
    /// Persist the entire graph atomically (full snapshot, write-through).
    pub fn save_graph(db: &Database, graph: &TaskGraph) -> Result<(), String> {
        let conn = db.conn();
        let tx = conn
            .unchecked_transaction()
            .map_err(|e| format!("Begin task tx: {e}"))?;
        Self::save_graph_tx(&tx, graph)?;
        tx.commit().map_err(|e| format!("Commit task tx: {e}"))
    }

    fn save_graph_tx(tx: &rusqlite::Transaction<'_>, graph: &TaskGraph) -> Result<(), String> {
        for (sort_order, task) in graph.list().iter().enumerate() {
            let outputs_json = serde_json::to_string(&task.outputs)
                .map_err(|e| format!("Serialize outputs for {}: {e}", task.id))?;
            tx.execute(
                "INSERT INTO tasks (
                     id, title, description, status, owner, model, priority,
                     estimate, outputs_json, source_branch, target_branch,
                     crash_attempts, rework_attempts, timeout_attempts, sort_order
                 ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15)
                 ON CONFLICT(id) DO UPDATE SET
                     title = excluded.title,
                     description = excluded.description,
                     status = excluded.status,
                     owner = excluded.owner,
                     model = excluded.model,
                     priority = excluded.priority,
                     estimate = excluded.estimate,
                     outputs_json = excluded.outputs_json,
                     source_branch = excluded.source_branch,
                     target_branch = excluded.target_branch,
                     crash_attempts = excluded.crash_attempts,
                     rework_attempts = excluded.rework_attempts,
                     timeout_attempts = excluded.timeout_attempts,
                     sort_order = excluded.sort_order",
                params![
                    task.id,
                    task.title,
                    task.description,
                    task.status.as_str(),
                    task.owner,
                    task.model,
                    task.priority.as_str(),
                    task.estimate,
                    outputs_json,
                    task.source_branch,
                    task.target_branch,
                    task.crash_attempts,
                    task.rework_attempts,
                    task.timeout_attempts,
                    sort_order as i64,
                ],
            )
            .map_err(|e| format!("Upsert task {}: {e}", task.id))?;

            // Replace this task's dependency edges (deps are append-only in the
            // graph, but a clean replace keeps load deterministic and is robust
            // to any future edge removal).
            tx.execute(
                "DELETE FROM task_dependencies WHERE task_id = ?1",
                params![task.id],
            )
            .map_err(|e| format!("Clear deps for {}: {e}", task.id))?;
            for dep in &task.dependencies {
                tx.execute(
                    "INSERT OR IGNORE INTO task_dependencies (task_id, dep_id) VALUES (?1, ?2)",
                    params![task.id, dep],
                )
                .map_err(|e| format!("Insert dep {}->{}: {e}", task.id, dep))?;
            }
        }
        Ok(())
    }

    /// Rebuild the graph from SQLite (startup restore). Tasks are re-added in
    /// `sort_order`, so each task's dependencies (which reference earlier tasks)
    /// are already present and the DAG invariant holds by construction.
    pub fn load_graph(db: &Database) -> Result<TaskGraph, String> {
        let conn = db.conn();

        // Dependency edges, grouped by task.
        let mut deps: HashMap<String, Vec<String>> = HashMap::new();
        {
            // ORDER BY rowid preserves each task's dependency Vec order: save
            // re-inserts deps in Vec order, so rowid is monotonic in that order.
            let mut stmt = conn
                .prepare("SELECT task_id, dep_id FROM task_dependencies ORDER BY rowid")
                .map_err(|e| format!("Prepare load deps: {e}"))?;
            let rows = stmt
                .query_map([], |row| {
                    Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
                })
                .map_err(|e| format!("Query deps: {e}"))?;
            for row in rows {
                let (task_id, dep_id) = row.map_err(|e| format!("Read dep row: {e}"))?;
                deps.entry(task_id).or_default().push(dep_id);
            }
        }

        // Task rows in insertion order.
        let mut stmt = conn
            .prepare(
                "SELECT id, title, description, status, owner, model, priority,
                        estimate, outputs_json, source_branch, target_branch,
                        crash_attempts, rework_attempts, timeout_attempts
                 FROM tasks ORDER BY sort_order ASC, rowid ASC",
            )
            .map_err(|e| format!("Prepare load tasks: {e}"))?;
        let raws: Vec<RawTask> = stmt
            .query_map([], |row| {
                Ok(RawTask {
                    id: row.get(0)?,
                    title: row.get(1)?,
                    description: row.get(2)?,
                    status: row.get(3)?,
                    owner: row.get(4)?,
                    model: row.get(5)?,
                    priority: row.get(6)?,
                    estimate: row.get(7)?,
                    outputs_json: row.get(8)?,
                    source_branch: row.get(9)?,
                    target_branch: row.get(10)?,
                    crash_attempts: row.get(11)?,
                    rework_attempts: row.get(12)?,
                    timeout_attempts: row.get(13)?,
                })
            })
            .map_err(|e| format!("Query tasks: {e}"))?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(|e| format!("Read task rows: {e}"))?;

        let mut graph = TaskGraph::new();
        for raw in raws {
            let outputs: Vec<String> = serde_json::from_str(&raw.outputs_json)
                .map_err(|e| format!("Parse outputs for {}: {e}", raw.id))?;
            let task = Task {
                dependencies: deps.remove(&raw.id).unwrap_or_default(),
                status: TaskStatus::from_str(&raw.status)
                    .map_err(|e| format!("Task {}: {e}", raw.id))?,
                priority: TaskPriority::from_str(&raw.priority)
                    .map_err(|e| format!("Task {}: {e}", raw.id))?,
                // Values were written from u32 so they always fit; try_from
                // guards against a corrupt/out-of-range DB row without wrapping.
                estimate: raw.estimate.and_then(|v| u32::try_from(v).ok()),
                crash_attempts: u32::try_from(raw.crash_attempts).unwrap_or(0),
                rework_attempts: u32::try_from(raw.rework_attempts).unwrap_or(0),
                timeout_attempts: u32::try_from(raw.timeout_attempts).unwrap_or(0),
                outputs,
                // Symbol intents are not persisted yet (re-declared per session);
                // a restored task falls back to file-level exclusivity until then.
                symbols: Vec::new(),
                id: raw.id,
                title: raw.title,
                description: raw.description,
                owner: raw.owner,
                model: raw.model,
                source_branch: raw.source_branch,
                target_branch: raw.target_branch,
            };
            graph
                .add(task)
                .map_err(|e| format!("Rebuild task graph: {e}"))?;
        }
        Ok(graph)
    }

    /// Insert an inert A7.1 preview. Same key + same immutable content is an
    /// idempotent read; a digest mismatch fails closed.
    pub fn insert_mission_plan_preview(
        db: &Database,
        preview: &MissionPlanPreview,
    ) -> Result<MissionPlanPreview, MissionPlanError> {
        preview.verify_integrity()?;
        if preview.status != MissionPlanStatus::Previewed {
            return Err(MissionPlanError::Validation(
                "only previewed Mission plans may be inserted".into(),
            ));
        }
        let plan_revision = i64::try_from(preview.plan_revision)
            .map_err(|_| MissionPlanError::Validation("planRevision exceeds SQLite i64".into()))?;
        if let Some(existing) =
            Self::load_mission_plan(db, &preview.plan_id, preview.plan_revision)?
        {
            return if existing.content_digest == preview.content_digest {
                Ok(existing)
            } else {
                Err(MissionPlanError::ContentConflict(format!(
                    "{} revision {} already has a different digest",
                    preview.plan_id, preview.plan_revision
                )))
            };
        }
        let prior: Option<(i64, String, String, i64, String)> = db
            .conn()
            .query_row(
                "SELECT plan_revision, request_id, mission_id, mission_revision, status
                   FROM mission_plan_revisions
                  WHERE plan_id = ?1
                  ORDER BY plan_revision DESC
                  LIMIT 1",
                params![preview.plan_id],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                    ))
                },
            )
            .optional()
            .map_err(|error| MissionPlanError::Persistence(error.to_string()))?;
        match prior {
            None if plan_revision != 1 => {
                return Err(MissionPlanError::ContentConflict(
                    "the first A7 plan revision must be 1".into(),
                ));
            }
            Some((
                prior_revision,
                prior_request,
                prior_mission,
                prior_mission_revision,
                status,
            )) if plan_revision != prior_revision + 1
                || prior_request != preview.request_id
                || prior_mission != preview.mission_definition.mission_id
                || prior_mission_revision != prior_revision
                || !matches!(status.as_str(), "rejected" | "cancelled") =>
            {
                return Err(MissionPlanError::ContentConflict(
                    "a new A7 plan revision must immediately follow a rejected or cancelled revision of the same request and Mission".into(),
                ));
            }
            _ => {}
        }
        let request_collision: Option<(String, String)> = db
            .conn()
            .query_row(
                "SELECT plan_id, content_digest FROM mission_plan_revisions
                 WHERE request_id = ?1 AND plan_revision = ?2",
                params![preview.request_id, preview.plan_revision],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()
            .map_err(|error| MissionPlanError::Persistence(error.to_string()))?;
        if let Some((plan_id, digest)) = request_collision {
            return Err(MissionPlanError::ContentConflict(format!(
                "request {} revision {} already maps to plan {} digest {}",
                preview.request_id, preview.plan_revision, plan_id, digest
            )));
        }
        let preview_json = serde_json::to_string(preview)
            .map_err(|error| MissionPlanError::Persistence(error.to_string()))?;
        let mission_revision =
            i64::try_from(preview.mission_definition.revision).map_err(|_| {
                MissionPlanError::Validation("mission revision exceeds SQLite i64".into())
            })?;
        let created_at_ms = i64::try_from(preview.persisted_at_unix_ms).map_err(|_| {
            MissionPlanError::Validation("persisted time exceeds SQLite i64".into())
        })?;
        db.conn()
            .execute(
                "INSERT INTO mission_plan_revisions (
                    plan_id, plan_revision, request_id, mission_id, mission_revision,
                    request_digest, content_digest, preview_json, status,
                    decision_principal_id, decision_reason, created_at_ms, decided_at_ms
                 ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,'previewed',NULL,NULL,?9,NULL)",
                params![
                    preview.plan_id,
                    plan_revision,
                    preview.request_id,
                    preview.mission_definition.mission_id,
                    mission_revision,
                    preview.request_digest,
                    preview.content_digest,
                    preview_json,
                    created_at_ms,
                ],
            )
            .map_err(|error| MissionPlanError::Persistence(error.to_string()))?;
        Self::load_mission_plan(db, &preview.plan_id, preview.plan_revision)?.ok_or_else(|| {
            MissionPlanError::Persistence("inserted Mission plan could not be reloaded".into())
        })
    }

    pub fn load_mission_plan(
        db: &Database,
        plan_id: &str,
        plan_revision: u64,
    ) -> Result<Option<MissionPlanPreview>, MissionPlanError> {
        let revision = i64::try_from(plan_revision)
            .map_err(|_| MissionPlanError::Validation("planRevision exceeds SQLite i64".into()))?;
        let raw = db
            .conn()
            .query_row(
                "SELECT plan_id, plan_revision, request_id, mission_id, mission_revision,
                        request_digest, content_digest, preview_json, status,
                        decision_principal_id, decision_reason, created_at_ms, decided_at_ms
                   FROM mission_plan_revisions
                  WHERE plan_id = ?1 AND plan_revision = ?2",
                params![plan_id, revision],
                raw_mission_plan,
            )
            .optional()
            .map_err(|error| MissionPlanError::Persistence(error.to_string()))?;
        raw.map(decode_mission_plan).transpose()
    }

    pub fn list_mission_plans(
        db: &Database,
        request_id: Option<&str>,
    ) -> Result<Vec<MissionPlanPreview>, MissionPlanError> {
        let raws = match request_id {
            Some(request_id) => {
                let mut statement = db
                    .conn()
                    .prepare(
                        "SELECT plan_id, plan_revision, request_id, mission_id, mission_revision,
                                request_digest, content_digest, preview_json, status,
                                decision_principal_id, decision_reason, created_at_ms, decided_at_ms
                           FROM mission_plan_revisions WHERE request_id = ?1
                          ORDER BY created_at_ms, plan_id, plan_revision",
                    )
                    .map_err(|error| MissionPlanError::Persistence(error.to_string()))?;
                let rows = statement
                    .query_map(params![request_id], raw_mission_plan)
                    .map_err(|error| MissionPlanError::Persistence(error.to_string()))?
                    .collect::<rusqlite::Result<Vec<_>>>()
                    .map_err(|error| MissionPlanError::Persistence(error.to_string()))?;
                rows
            }
            None => {
                let mut statement = db
                    .conn()
                    .prepare(
                        "SELECT plan_id, plan_revision, request_id, mission_id, mission_revision,
                                request_digest, content_digest, preview_json, status,
                                decision_principal_id, decision_reason, created_at_ms, decided_at_ms
                           FROM mission_plan_revisions
                          ORDER BY created_at_ms, plan_id, plan_revision",
                    )
                    .map_err(|error| MissionPlanError::Persistence(error.to_string()))?;
                let rows = statement
                    .query_map([], raw_mission_plan)
                    .map_err(|error| MissionPlanError::Persistence(error.to_string()))?
                    .collect::<rusqlite::Result<Vec<_>>>()
                    .map_err(|error| MissionPlanError::Persistence(error.to_string()))?;
                rows
            }
        };
        raws.into_iter().map(decode_mission_plan).collect()
    }

    pub fn load_mission_activation(
        db: &Database,
        plan_id: &str,
        plan_revision: u64,
    ) -> Result<Option<MissionPlanActivation>, MissionPlanError> {
        let revision = i64::try_from(plan_revision)
            .map_err(|_| MissionPlanError::Validation("planRevision exceeds SQLite i64".into()))?;
        db.conn()
            .query_row(
                "SELECT activation_id, plan_id, plan_revision, mission_id, mission_revision,
                        work_unit_id, task_id, plan_content_digest, accepted_base_oid,
                        repository_root, source_branch, target_branch, owned_targets_json,
                        test_argv_json, activated_by, activated_at_ms
                   FROM mission_plan_activations
                  WHERE plan_id=?1 AND plan_revision=?2",
                params![plan_id, revision],
                |row| {
                    let plan_revision: i64 = row.get(2)?;
                    let mission_revision: i64 = row.get(4)?;
                    let activated_at: i64 = row.get(15)?;
                    let owned: String = row.get(12)?;
                    let argv: String = row.get(13)?;
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        plan_revision,
                        row.get::<_, String>(3)?,
                        mission_revision,
                        row.get::<_, String>(5)?,
                        row.get::<_, String>(6)?,
                        row.get::<_, String>(7)?,
                        row.get::<_, String>(8)?,
                        row.get::<_, String>(9)?,
                        row.get::<_, String>(10)?,
                        row.get::<_, String>(11)?,
                        owned,
                        argv,
                        row.get::<_, String>(14)?,
                        activated_at,
                    ))
                },
            )
            .optional()
            .map_err(|error| MissionPlanError::Persistence(error.to_string()))?
            .map(|row| {
                Ok(MissionPlanActivation {
                    schema: "aelyris.mission_plan_activation/v1".into(),
                    activation_id: row.0,
                    plan_id: row.1,
                    plan_revision: u64::try_from(row.2).map_err(|_| {
                        MissionPlanError::Persistence("negative plan revision".into())
                    })?,
                    mission_id: row.3,
                    mission_revision: u64::try_from(row.4).map_err(|_| {
                        MissionPlanError::Persistence("negative mission revision".into())
                    })?,
                    work_unit_id: row.5,
                    task_id: row.6,
                    plan_content_digest: row.7,
                    accepted_base_oid: row.8,
                    repository_root: row.9,
                    source_branch: row.10,
                    target_branch: row.11,
                    owned_targets: serde_json::from_str(&row.12).map_err(|error| {
                        MissionPlanError::Persistence(format!("decode activation targets: {error}"))
                    })?,
                    test_argv: serde_json::from_str(&row.13).map_err(|error| {
                        MissionPlanError::Persistence(format!("decode activation argv: {error}"))
                    })?,
                    activated_by: row.14,
                    activated_at_unix_ms: u64::try_from(row.15).map_err(|_| {
                        MissionPlanError::Persistence("negative activation time".into())
                    })?,
                })
            })
            .transpose()
    }

    pub fn load_mission_activation_for_task(
        db: &Database,
        task_id: &str,
    ) -> Result<Option<MissionPlanActivation>, MissionPlanError> {
        let key: Option<(String, i64)> = db
            .conn()
            .query_row(
                "SELECT plan_id, plan_revision FROM mission_plan_activations WHERE task_id=?1",
                [task_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()
            .map_err(|error| MissionPlanError::Persistence(error.to_string()))?;
        match key {
            Some((plan_id, revision)) => Self::load_mission_activation(
                db,
                &plan_id,
                u64::try_from(revision).map_err(|_| {
                    MissionPlanError::Persistence("negative activation plan revision".into())
                })?,
            ),
            None => Ok(None),
        }
    }

    /// Commit the activation fact and the whole staged TaskGraph in one SQLite
    /// transaction. A crash can expose both or neither, never executable graph
    /// state without its accepted-plan authority binding.
    pub fn persist_mission_activation(
        db: &Database,
        activation: &MissionPlanActivation,
        graph: &TaskGraph,
    ) -> Result<MissionPlanActivation, MissionPlanError> {
        if let Some(existing) =
            Self::load_mission_activation(db, &activation.plan_id, activation.plan_revision)?
        {
            return if existing == *activation {
                Ok(existing)
            } else {
                Err(MissionPlanError::ContentConflict(
                    "Mission plan revision already has a different activation".into(),
                ))
            };
        }
        let plan_revision = i64::try_from(activation.plan_revision)
            .map_err(|_| MissionPlanError::Validation("planRevision exceeds SQLite i64".into()))?;
        let mission_revision = i64::try_from(activation.mission_revision).map_err(|_| {
            MissionPlanError::Validation("missionRevision exceeds SQLite i64".into())
        })?;
        let activated_at_ms = i64::try_from(activation.activated_at_unix_ms).map_err(|_| {
            MissionPlanError::Validation("activatedAtUnixMs exceeds SQLite i64".into())
        })?;
        let conn = db.conn();
        let tx = conn.unchecked_transaction().map_err(|error| {
            MissionPlanError::Persistence(format!("begin activation tx: {error}"))
        })?;
        let accepted: Option<(String, String, i64)> = tx
            .query_row(
                "SELECT status, content_digest, mission_revision FROM mission_plan_revisions
                  WHERE plan_id=?1 AND plan_revision=?2",
                params![activation.plan_id, plan_revision],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .optional()
            .map_err(|error| MissionPlanError::Persistence(error.to_string()))?;
        if accepted
            != Some((
                "accepted".into(),
                activation.plan_content_digest.clone(),
                mission_revision,
            ))
        {
            return Err(MissionPlanError::ContentConflict(
                "activation no longer matches an accepted immutable plan".into(),
            ));
        }
        Self::save_graph_tx(&tx, graph).map_err(MissionPlanError::Persistence)?;
        let owned = serde_json::to_string(&activation.owned_targets)
            .map_err(|error| MissionPlanError::Persistence(error.to_string()))?;
        let argv = serde_json::to_string(&activation.test_argv)
            .map_err(|error| MissionPlanError::Persistence(error.to_string()))?;
        tx.execute(
            "INSERT INTO mission_plan_activations (
                activation_id,plan_id,plan_revision,mission_id,mission_revision,work_unit_id,
                task_id,plan_content_digest,accepted_base_oid,repository_root,source_branch,
                target_branch,owned_targets_json,test_argv_json,activated_by,activated_at_ms
             ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16)",
            params![
                activation.activation_id,
                activation.plan_id,
                plan_revision,
                activation.mission_id,
                mission_revision,
                activation.work_unit_id,
                activation.task_id,
                activation.plan_content_digest,
                activation.accepted_base_oid,
                activation.repository_root,
                activation.source_branch,
                activation.target_branch,
                owned,
                argv,
                activation.activated_by,
                activated_at_ms,
            ],
        )
        .map_err(|error| {
            MissionPlanError::Persistence(format!("insert Mission activation: {error}"))
        })?;
        tx.commit().map_err(|error| {
            MissionPlanError::Persistence(format!("commit activation tx: {error}"))
        })?;
        Ok(activation.clone())
    }

    pub fn insert_mission_gate_evidence(
        db: &Database,
        evidence: &MissionGateEvidence,
    ) -> Result<MissionGateEvidence, MissionPlanError> {
        if evidence.tested_oid != evidence.candidate_oid {
            return Err(MissionPlanError::Validation(
                "testedOid must equal candidateOid".into(),
            ));
        }
        let execution_generation = i64::try_from(evidence.execution_generation).map_err(|_| {
            MissionPlanError::Validation("executionGeneration exceeds SQLite i64".into())
        })?;
        let started_at_ms = i64::try_from(evidence.started_at_unix_ms).map_err(|_| {
            MissionPlanError::Validation("startedAtUnixMs exceeds SQLite i64".into())
        })?;
        let ended_at_ms = i64::try_from(evidence.ended_at_unix_ms)
            .map_err(|_| MissionPlanError::Validation("endedAtUnixMs exceeds SQLite i64".into()))?;
        let argv = serde_json::to_string(&evidence.command_argv)
            .map_err(|error| MissionPlanError::Persistence(error.to_string()))?;
        db.conn()
            .execute(
                "INSERT INTO mission_gate_evidence (
                    evidence_id,activation_id,plan_content_digest,attempt_id,execution_generation,
                    agent_run_id,runtime_domain_id,pty_session_id,gate_id,contract_version,
                    command_argv_json,command_fingerprint,environment_fingerprint,result,
                    evidence_digest,base_oid,candidate_oid,tested_oid,started_at_ms,ended_at_ms
                 ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20)",
                params![
                    evidence.evidence_id,
                    evidence.activation_id,
                    evidence.plan_content_digest,
                    evidence.attempt_id,
                    execution_generation,
                    evidence.agent_run_id,
                    evidence.runtime_domain_id,
                    evidence.pty_session_id,
                    evidence.gate_id,
                    evidence.contract_version,
                    argv,
                    evidence.command_fingerprint,
                    evidence.environment_fingerprint,
                    evidence.result,
                    evidence.evidence_digest,
                    evidence.base_oid,
                    evidence.candidate_oid,
                    evidence.tested_oid,
                    started_at_ms,
                    ended_at_ms,
                ],
            )
            .map_err(|error| {
                MissionPlanError::Persistence(format!("insert Mission gate evidence: {error}"))
            })?;
        Ok(evidence.clone())
    }

    pub fn load_mission_gate_evidence(
        db: &Database,
        activation_id: &str,
    ) -> Result<Option<MissionGateEvidence>, MissionPlanError> {
        db.conn()
            .query_row(
                "SELECT evidence_id,activation_id,plan_content_digest,attempt_id,execution_generation,
                        agent_run_id,runtime_domain_id,pty_session_id,gate_id,contract_version,
                        command_argv_json,command_fingerprint,environment_fingerprint,result,
                        evidence_digest,base_oid,candidate_oid,tested_oid,started_at_ms,ended_at_ms
                   FROM mission_gate_evidence WHERE activation_id=?1
                  ORDER BY ended_at_ms DESC LIMIT 1",
                [activation_id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?,
                        row.get::<_, String>(3)?, row.get::<_, i64>(4)?, row.get::<_, String>(5)?,
                        row.get::<_, String>(6)?, row.get::<_, String>(7)?, row.get::<_, String>(8)?,
                        row.get::<_, String>(9)?, row.get::<_, String>(10)?, row.get::<_, String>(11)?,
                        row.get::<_, String>(12)?, row.get::<_, String>(13)?, row.get::<_, String>(14)?,
                        row.get::<_, String>(15)?, row.get::<_, String>(16)?, row.get::<_, String>(17)?,
                        row.get::<_, i64>(18)?, row.get::<_, i64>(19)?,
                    ))
                },
            )
            .optional()
            .map_err(|error| MissionPlanError::Persistence(error.to_string()))?
            .map(|row| {
                Ok(MissionGateEvidence {
                    schema: "aelyris.mission_gate_evidence/v1".into(),
                    evidence_id: row.0,
                    activation_id: row.1,
                    plan_content_digest: row.2,
                    attempt_id: row.3,
                    execution_generation: u64::try_from(row.4).map_err(|_| MissionPlanError::Persistence("negative evidence generation".into()))?,
                    agent_run_id: row.5,
                    runtime_domain_id: row.6,
                    pty_session_id: row.7,
                    gate_id: row.8,
                    contract_version: row.9,
                    command_argv: serde_json::from_str(&row.10).map_err(|error| MissionPlanError::Persistence(format!("decode evidence argv: {error}")))?,
                    command_fingerprint: row.11,
                    environment_fingerprint: row.12,
                    result: row.13,
                    evidence_digest: row.14,
                    base_oid: row.15,
                    candidate_oid: row.16,
                    tested_oid: row.17,
                    started_at_unix_ms: u64::try_from(row.18).map_err(|_| MissionPlanError::Persistence("negative evidence start".into()))?,
                    ended_at_unix_ms: u64::try_from(row.19).map_err(|_| MissionPlanError::Persistence("negative evidence end".into()))?,
                })
            })
            .transpose()
    }

    pub fn load_mission_gate_evidence_by_id(
        db: &Database,
        evidence_id: &str,
    ) -> Result<Option<MissionGateEvidence>, MissionPlanError> {
        db.conn()
            .query_row(
                "SELECT evidence_id,activation_id,plan_content_digest,attempt_id,execution_generation,
                        agent_run_id,runtime_domain_id,pty_session_id,gate_id,contract_version,
                        command_argv_json,command_fingerprint,environment_fingerprint,result,
                        evidence_digest,base_oid,candidate_oid,tested_oid,started_at_ms,ended_at_ms
                   FROM mission_gate_evidence WHERE evidence_id=?1",
                [evidence_id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?,
                        row.get::<_, String>(3)?, row.get::<_, i64>(4)?, row.get::<_, String>(5)?,
                        row.get::<_, String>(6)?, row.get::<_, String>(7)?, row.get::<_, String>(8)?,
                        row.get::<_, String>(9)?, row.get::<_, String>(10)?, row.get::<_, String>(11)?,
                        row.get::<_, String>(12)?, row.get::<_, String>(13)?, row.get::<_, String>(14)?,
                        row.get::<_, String>(15)?, row.get::<_, String>(16)?, row.get::<_, String>(17)?,
                        row.get::<_, i64>(18)?, row.get::<_, i64>(19)?,
                    ))
                },
            )
            .optional()
            .map_err(|error| MissionPlanError::Persistence(error.to_string()))?
            .map(|row| {
                Ok(MissionGateEvidence {
                    schema: "aelyris.mission_gate_evidence/v1".into(),
                    evidence_id: row.0,
                    activation_id: row.1,
                    plan_content_digest: row.2,
                    attempt_id: row.3,
                    execution_generation: u64::try_from(row.4).map_err(|_| MissionPlanError::Persistence("negative evidence generation".into()))?,
                    agent_run_id: row.5,
                    runtime_domain_id: row.6,
                    pty_session_id: row.7,
                    gate_id: row.8,
                    contract_version: row.9,
                    command_argv: serde_json::from_str(&row.10).map_err(|error| MissionPlanError::Persistence(format!("decode evidence argv: {error}")))?,
                    command_fingerprint: row.11,
                    environment_fingerprint: row.12,
                    result: row.13,
                    evidence_digest: row.14,
                    base_oid: row.15,
                    candidate_oid: row.16,
                    tested_oid: row.17,
                    started_at_unix_ms: u64::try_from(row.18).map_err(|_| MissionPlanError::Persistence("negative evidence start".into()))?,
                    ended_at_unix_ms: u64::try_from(row.19).map_err(|_| MissionPlanError::Persistence("negative evidence end".into()))?,
                })
            })
            .transpose()
    }

    pub fn decide_mission_plan(
        db: &Database,
        plan_id: &str,
        plan_revision: u64,
        target: MissionPlanStatus,
        decision_principal_id: &str,
        decision_reason: Option<&str>,
    ) -> Result<MissionPlanPreview, MissionPlanError> {
        if !target.is_terminal() {
            return Err(MissionPlanError::IllegalTransition {
                from: "previewed".into(),
                to: target.as_str().into(),
            });
        }
        validate_decision_principal(decision_principal_id)?;
        let reason = decision_reason
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToOwned::to_owned);
        if matches!(
            target,
            MissionPlanStatus::Rejected | MissionPlanStatus::Cancelled
        ) && reason.is_none()
        {
            return Err(MissionPlanError::Validation(
                "reject/cancel requires a nonempty reason".into(),
            ));
        }
        if target == MissionPlanStatus::Accepted && reason.is_some() {
            return Err(MissionPlanError::Validation(
                "accept does not carry a rejection/cancellation reason".into(),
            ));
        }
        let existing = Self::load_mission_plan(db, plan_id, plan_revision)?.ok_or_else(|| {
            MissionPlanError::NotFound {
                plan_id: plan_id.to_string(),
                plan_revision,
            }
        })?;
        if existing.status == target {
            if existing.decision_principal_id.as_deref() == Some(decision_principal_id)
                && existing.decision_reason == reason
            {
                return Ok(existing);
            }
            return Err(MissionPlanError::ContentConflict(
                "terminal retry does not match the durable decision".into(),
            ));
        }
        if existing.status != MissionPlanStatus::Previewed {
            return Err(MissionPlanError::IllegalTransition {
                from: existing.status.as_str().into(),
                to: target.as_str().into(),
            });
        }
        let decided_at = decision_unix_ms()?;
        let decided_at_i64 = i64::try_from(decided_at)
            .map_err(|_| MissionPlanError::Validation("decision time exceeds SQLite i64".into()))?;
        let revision = i64::try_from(plan_revision)
            .map_err(|_| MissionPlanError::Validation("planRevision exceeds SQLite i64".into()))?;
        let updated = db
            .conn()
            .execute(
                "UPDATE mission_plan_revisions
                    SET status = ?3, decision_principal_id = ?4,
                        decision_reason = ?5, decided_at_ms = ?6
                  WHERE plan_id = ?1 AND plan_revision = ?2 AND status = 'previewed'",
                params![
                    plan_id,
                    revision,
                    target.as_str(),
                    decision_principal_id,
                    reason,
                    decided_at_i64,
                ],
            )
            .map_err(|error| {
                if error
                    .to_string()
                    .contains("idx_mission_plan_one_accepted_definition")
                    || error.to_string().contains("UNIQUE constraint failed")
                {
                    MissionPlanError::ContentConflict(
                        "Mission definition revision already has an accepted plan".into(),
                    )
                } else {
                    MissionPlanError::Persistence(error.to_string())
                }
            })?;
        if updated != 1 {
            return Err(MissionPlanError::ContentConflict(
                "Mission plan decision lost its compare-and-swap".into(),
            ));
        }
        Self::load_mission_plan(db, plan_id, plan_revision)?.ok_or_else(|| {
            MissionPlanError::Persistence("decided Mission plan could not be reloaded".into())
        })
    }
}

fn raw_mission_plan(row: &rusqlite::Row<'_>) -> rusqlite::Result<RawMissionPlan> {
    Ok(RawMissionPlan {
        plan_id: row.get(0)?,
        plan_revision: row.get(1)?,
        request_id: row.get(2)?,
        mission_id: row.get(3)?,
        mission_revision: row.get(4)?,
        request_digest: row.get(5)?,
        content_digest: row.get(6)?,
        preview_json: row.get(7)?,
        status: row.get(8)?,
        decision_principal_id: row.get(9)?,
        decision_reason: row.get(10)?,
        created_at_ms: row.get(11)?,
        decided_at_ms: row.get(12)?,
    })
}

fn decode_mission_plan(raw: RawMissionPlan) -> Result<MissionPlanPreview, MissionPlanError> {
    let mut preview: MissionPlanPreview = serde_json::from_str(&raw.preview_json)
        .map_err(|error| MissionPlanError::Persistence(format!("decode Mission plan: {error}")))?;
    // The immutable JSON is always the original preview. Verify it before applying
    // the separately mutable terminal projection from typed columns.
    preview.verify_integrity()?;
    let plan_revision = u64::try_from(raw.plan_revision)
        .map_err(|_| MissionPlanError::Persistence("negative plan revision".into()))?;
    let mission_revision = u64::try_from(raw.mission_revision)
        .map_err(|_| MissionPlanError::Persistence("negative mission revision".into()))?;
    let created_at = u64::try_from(raw.created_at_ms)
        .map_err(|_| MissionPlanError::Persistence("negative plan creation time".into()))?;
    if preview.plan_id != raw.plan_id
        || preview.plan_revision != plan_revision
        || preview.request_id != raw.request_id
        || preview.mission_definition.mission_id != raw.mission_id
        || preview.mission_definition.revision != mission_revision
        || preview.request_digest != raw.request_digest
        || preview.content_digest != raw.content_digest
        || preview.persisted_at_unix_ms != created_at
    {
        return Err(MissionPlanError::Persistence(
            "Mission plan typed columns do not match immutable JSON".into(),
        ));
    }
    preview.status = raw.status.parse()?;
    preview.decision_principal_id = raw.decision_principal_id;
    preview.decision_reason = raw.decision_reason;
    preview.decided_at_unix_ms = raw
        .decided_at_ms
        .map(u64::try_from)
        .transpose()
        .map_err(|_| MissionPlanError::Persistence("negative decision time".into()))?;
    preview.verify_integrity()?;
    Ok(preview)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rich_task(id: &str, title: &str) -> Task {
        let mut t = Task::new(id, title);
        t.priority = TaskPriority::High;
        t.owner = Some("backend".to_string());
        t.model = Some("codex".to_string());
        t.estimate = Some(42);
        t.outputs = vec!["src/a.rs".to_string(), "agent/x".to_string()];
        t
    }

    #[test]
    fn save_then_load_round_trips_structure_status_and_counters() {
        let db = Database::open_memory().unwrap();
        let mut graph = TaskGraph::new();
        graph.add(rich_task("dep", "Dep")).unwrap();
        graph
            .add(
                rich_task("child", "Child")
                    .with_dependencies(["dep".to_string()])
                    .with_branches("agent/child", "main"),
            )
            .unwrap();
        graph.add(Task::new("solo", "Solo")).unwrap();
        // Drive lifecycle + recovery counters so we exercise every column.
        graph.recompute_ready();
        graph.transition("dep", TaskStatus::Running).unwrap();
        graph.record_crash("dep");
        graph.record_rework("child");
        graph.record_timeout("child");

        TaskRepo::save_graph(&db, &graph).unwrap();
        let restored = TaskRepo::load_graph(&db).unwrap();

        // Insertion order preserved.
        let ids: Vec<&str> = restored.list().iter().map(|t| t.id.as_str()).collect();
        assert_eq!(ids, ["dep", "child", "solo"]);

        let dep = restored.get("dep").unwrap();
        assert_eq!(dep.status, TaskStatus::Running);
        assert_eq!(dep.crash_attempts, 1);
        assert_eq!(dep.priority, TaskPriority::High);
        assert_eq!(dep.owner.as_deref(), Some("backend"));
        assert_eq!(dep.model.as_deref(), Some("codex"));
        assert_eq!(dep.estimate, Some(42));
        assert_eq!(dep.outputs, vec!["src/a.rs", "agent/x"]);

        let child = restored.get("child").unwrap();
        assert_eq!(child.dependencies, vec!["dep".to_string()]);
        assert_eq!(child.rework_attempts, 1);
        assert_eq!(child.timeout_attempts, 1);
        assert_eq!(child.source_branch.as_deref(), Some("agent/child"));
        assert_eq!(child.target_branch.as_deref(), Some("main"));
    }

    #[test]
    fn save_is_idempotent_and_reflects_later_changes() {
        let db = Database::open_memory().unwrap();
        let mut graph = TaskGraph::new();
        graph.add(Task::new("a", "A")).unwrap();
        TaskRepo::save_graph(&db, &graph).unwrap();
        // Mutate and re-save: the updated status must overwrite, not duplicate.
        graph.recompute_ready();
        graph.transition("a", TaskStatus::Running).unwrap();
        TaskRepo::save_graph(&db, &graph).unwrap();
        let restored = TaskRepo::load_graph(&db).unwrap();
        assert_eq!(restored.len(), 1);
        assert_eq!(restored.get("a").unwrap().status, TaskStatus::Running);
    }

    #[test]
    fn load_from_empty_db_is_empty() {
        let db = Database::open_memory().unwrap();
        assert!(TaskRepo::load_graph(&db).unwrap().is_empty());
    }

    #[test]
    fn mission_preview_insert_is_idempotent_and_conflicting_content_is_rejected() {
        let db = Database::open_memory().unwrap();
        let preview =
            crate::task::mission::tests::fixed_preview(crate::task::mission::tests::fixed_input())
                .unwrap();
        let first = TaskRepo::insert_mission_plan_preview(&db, &preview).unwrap();
        let second = TaskRepo::insert_mission_plan_preview(&db, &preview).unwrap();
        assert_eq!(first, second);

        let conflict = crate::task::mission::tests::fixed_preview_at_root(
            crate::task::mission::tests::fixed_input(),
            "D:/different-a7-fixture-repository",
        )
        .unwrap();
        assert!(matches!(
            TaskRepo::insert_mission_plan_preview(&db, &conflict),
            Err(MissionPlanError::ContentConflict(_))
        ));
    }

    #[test]
    fn mission_preview_load_detects_typed_column_tamper() {
        let db = Database::open_memory().unwrap();
        let preview =
            crate::task::mission::tests::fixed_preview(crate::task::mission::tests::fixed_input())
                .unwrap();
        TaskRepo::insert_mission_plan_preview(&db, &preview).unwrap();
        // Simulate storage corruption after removing the trigger that normally
        // rejects it. The typed-column/immutable-JSON cross-check must fail.
        db.conn()
            .execute_batch(
                "DROP TRIGGER trg_mission_plan_content_immutable;
                 DROP TRIGGER trg_mission_plan_terminal_transition;",
            )
            .unwrap();
        db.conn()
            .execute(
                "UPDATE mission_plan_revisions SET request_digest = ?1",
                params!["0".repeat(64)],
            )
            .unwrap();
        assert!(TaskRepo::load_mission_plan(&db, &preview.plan_id, 1).is_err());
    }

    #[test]
    fn mission_revision_chain_requires_terminal_nonaccepted_predecessor() {
        let db = Database::open_memory().unwrap();
        let first_input = crate::task::mission::tests::fixed_input();
        let actor = first_input.mission_definition.created_by.clone();
        let plan_id = first_input.plan_id.clone();
        let first = crate::task::mission::tests::fixed_preview(first_input).unwrap();
        TaskRepo::insert_mission_plan_preview(&db, &first).unwrap();

        let mut second_input = crate::task::mission::tests::fixed_input();
        second_input.plan_revision = 2;
        second_input.mission_definition.revision = 2;
        second_input
            .mission_definition
            .work_graph_definition_revision = 2;
        second_input.work_units[0].definition_revision = 2;
        let second = crate::task::mission::tests::fixed_preview(second_input).unwrap();
        assert!(matches!(
            TaskRepo::insert_mission_plan_preview(&db, &second),
            Err(MissionPlanError::ContentConflict(_))
        ));

        TaskRepo::decide_mission_plan(
            &db,
            &plan_id,
            1,
            MissionPlanStatus::Cancelled,
            &actor,
            Some("authoritative HEAD moved"),
        )
        .unwrap();
        assert_eq!(
            TaskRepo::insert_mission_plan_preview(&db, &second)
                .unwrap()
                .plan_revision,
            2
        );
    }
}
