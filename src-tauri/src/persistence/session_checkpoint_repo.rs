use rusqlite::params;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::str::FromStr;

use crate::agent::context_lifecycle::ContextRemaining;
use crate::agent::session_lifecycle::{
    checkpoint_record_digest, validate_handoff_acceptance_record, HandoffAcceptanceRecord,
};
use crate::db::Database;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SessionCheckpointRecord {
    pub logical_session_id: String,
    pub checkpoint_seq: u64,
    pub pty_id: String,
    pub cli: String,
    pub model: String,
    pub cwd: String,
    pub worktree_branch: Option<String>,
    pub worktree_path: Option<String>,
    pub repo_path: Option<String>,
    pub status: String,
    pub approval_prompt: Option<String>,
    pub cost: f64,
    pub tokens_used: u64,
    pub started_at: u64,
    pub last_activity: u64,
    pub turn_count: u64,
    pub context_remaining: Option<ContextRemaining>,
    pub summary_json: Option<Value>,
    pub summary_path: Option<String>,
    pub inflight_ref: Option<String>,
    pub predecessor_session_id: Option<String>,
    pub created_at: u64,
    pub updated_at: u64,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SessionHandoffState {
    PendingSummary,
    Checkpointed,
    SuccessorSpawning,
    SuccessorSpawned,
    SuccessorAcked,
    PredecessorRetired,
    Failed,
}

impl SessionHandoffState {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::PendingSummary => "pending_summary",
            Self::Checkpointed => "checkpointed",
            Self::SuccessorSpawning => "successor_spawning",
            Self::SuccessorSpawned => "successor_spawned",
            Self::SuccessorAcked => "successor_acked",
            Self::PredecessorRetired => "predecessor_retired",
            Self::Failed => "failed",
        }
    }
}

impl FromStr for SessionHandoffState {
    type Err = String;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "pending_summary" => Ok(Self::PendingSummary),
            "checkpointed" => Ok(Self::Checkpointed),
            "successor_spawning" => Ok(Self::SuccessorSpawning),
            "successor_spawned" => Ok(Self::SuccessorSpawned),
            "successor_acked" => Ok(Self::SuccessorAcked),
            "predecessor_retired" => Ok(Self::PredecessorRetired),
            "failed" => Ok(Self::Failed),
            other => Err(format!("unknown session handoff state: {other}")),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SessionHandoffRecord {
    pub predecessor_id: String,
    pub successor_id: String,
    pub handoff_seq: u64,
    pub state: SessionHandoffState,
    pub correlation_id: String,
    pub checkpoint_seq: Option<u64>,
    pub summary_path: Option<String>,
    pub failure_reason: Option<String>,
    pub created_at: u64,
    pub updated_at: u64,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum HandoffOutcome {
    Pending,
    Accepted,
    RetryableFailure,
    TerminalFailure,
}

impl HandoffOutcome {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Accepted => "accepted",
            Self::RetryableFailure => "retryable_failure",
            Self::TerminalFailure => "terminal_failure",
        }
    }
}

impl FromStr for HandoffOutcome {
    type Err = String;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "pending" => Ok(Self::Pending),
            "accepted" => Ok(Self::Accepted),
            "retryable_failure" => Ok(Self::RetryableFailure),
            "terminal_failure" => Ok(Self::TerminalFailure),
            other => Err(format!("unknown session handoff outcome: {other}")),
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum HandoffCleanupStatus {
    NotRequired,
    Pending,
    Stopped,
    Quarantined,
}

impl HandoffCleanupStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::NotRequired => "not_required",
            Self::Pending => "pending",
            Self::Stopped => "stopped",
            Self::Quarantined => "quarantined",
        }
    }
}

impl FromStr for HandoffCleanupStatus {
    type Err = String;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "not_required" => Ok(Self::NotRequired),
            "pending" => Ok(Self::Pending),
            "stopped" => Ok(Self::Stopped),
            "quarantined" => Ok(Self::Quarantined),
            other => Err(format!("unknown session handoff cleanup status: {other}")),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SessionHandoffDurabilityRecord {
    pub handoff: SessionHandoffRecord,
    pub predecessor_pty_id: Option<String>,
    pub successor_pty_id: Option<String>,
    pub successor_checkpoint_seq: Option<u64>,
    pub baton_version: u64,
    pub acceptance: Option<HandoffAcceptanceRecord>,
    pub acceptance_digest: Option<String>,
    pub outcome: HandoffOutcome,
    pub cleanup_status: HandoffCleanupStatus,
}

impl SessionHandoffDurabilityRecord {
    pub fn requires_reconciliation(&self) -> bool {
        match self.outcome {
            HandoffOutcome::Accepted => {
                self.handoff.state != SessionHandoffState::PredecessorRetired
            }
            HandoffOutcome::Pending => true,
            HandoffOutcome::RetryableFailure | HandoffOutcome::TerminalFailure => matches!(
                self.cleanup_status,
                HandoffCleanupStatus::Pending | HandoffCleanupStatus::Quarantined
            ),
        }
    }
}

const CHECKPOINT_COLUMNS: &str = "logical_session_id, checkpoint_seq, pty_id, cli, model, cwd, \
     worktree_branch, worktree_path, repo_path, status, approval_prompt, cost, tokens_used, started_at, \
     last_activity, turn_count, context_remaining_json, summary_json, summary_path, \
     inflight_ref, predecessor_session_id, created_at, updated_at";

const HANDOFF_COLUMNS: &str = "predecessor_id, successor_id, handoff_seq, state, correlation_id, \
     checkpoint_seq, summary_path, failure_reason, created_at, updated_at, \
     predecessor_pty_id, successor_pty_id, successor_checkpoint_seq, baton_version, \
     acceptance_json, acceptance_digest, outcome, cleanup_status";

pub struct SessionCheckpointRepo;

impl SessionCheckpointRepo {
    pub fn next_checkpoint_seq(db: &Database, logical_session_id: &str) -> Result<u64, String> {
        let next: i64 = db
            .conn()
            .query_row(
                "SELECT COALESCE(MAX(checkpoint_seq), 0) + 1 FROM session_checkpoints WHERE logical_session_id = ?1",
                params![logical_session_id],
                |row| row.get(0),
            )
            .map_err(|e| format!("load next checkpoint seq for {logical_session_id}: {e}"))?;
        nonnegative_u64("checkpoint_seq", next)
    }

    pub fn next_handoff_seq(db: &Database, predecessor_id: &str) -> Result<u64, String> {
        let next: i64 = db
            .conn()
            .query_row(
                "SELECT COALESCE(MAX(handoff_seq), 0) + 1 FROM session_handoffs WHERE predecessor_id = ?1",
                params![predecessor_id],
                |row| row.get(0),
            )
            .map_err(|e| format!("load next handoff seq for {predecessor_id}: {e}"))?;
        nonnegative_u64("handoff_seq", next)
    }

    /// Append the next immutable checkpoint while the caller holds the single
    /// `ManagedDb` owner lock. This keeps sequence selection and insert in one
    /// critical section across manual and automatic checkpoint writers.
    pub fn append_checkpoint(
        db: &Database,
        checkpoint: &SessionCheckpointRecord,
    ) -> Result<SessionCheckpointRecord, String> {
        db.conn()
            .execute_batch("BEGIN IMMEDIATE")
            .map_err(|error| format!("begin checkpoint append transaction: {error}"))?;
        let result = (|| {
            let mut appended = checkpoint.clone();
            appended.checkpoint_seq = Self::next_checkpoint_seq(db, &appended.logical_session_id)?;
            Self::upsert_checkpoint(db, &appended)
        })();
        match result {
            Ok(appended) => {
                db.conn()
                    .execute_batch("COMMIT")
                    .map_err(|error| format!("commit checkpoint append transaction: {error}"))?;
                Ok(appended)
            }
            Err(error) => {
                let _ = db.conn().execute_batch("ROLLBACK");
                Err(error)
            }
        }
    }

    pub fn upsert_checkpoint(
        db: &Database,
        checkpoint: &SessionCheckpointRecord,
    ) -> Result<SessionCheckpointRecord, String> {
        validate_checkpoint(checkpoint)?;
        let context_remaining_json = checkpoint
            .context_remaining
            .as_ref()
            .map(canonical_json)
            .transpose()?;
        let summary_json = checkpoint
            .summary_json
            .as_ref()
            .map(canonical_json)
            .transpose()?;
        db.conn()
            .execute(
                "INSERT INTO session_checkpoints (
                    logical_session_id, checkpoint_seq, pty_id, cli, model, cwd,
                    worktree_branch, worktree_path, repo_path, status, approval_prompt, cost, tokens_used,
                    started_at, last_activity, turn_count, context_remaining_json,
                    summary_json, summary_path, inflight_ref, predecessor_session_id,
                    created_at, updated_at
                 ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21,?22,?23)
                 ON CONFLICT(logical_session_id, checkpoint_seq) DO UPDATE SET
                    pty_id = excluded.pty_id,
                    cli = excluded.cli,
                    model = excluded.model,
                    cwd = excluded.cwd,
                    worktree_branch = excluded.worktree_branch,
                    worktree_path = excluded.worktree_path,
                    repo_path = excluded.repo_path,
                    status = excluded.status,
                    approval_prompt = excluded.approval_prompt,
                    cost = excluded.cost,
                    tokens_used = excluded.tokens_used,
                    started_at = excluded.started_at,
                    last_activity = excluded.last_activity,
                    turn_count = excluded.turn_count,
                    context_remaining_json = excluded.context_remaining_json,
                    summary_json = excluded.summary_json,
                    summary_path = excluded.summary_path,
                    inflight_ref = excluded.inflight_ref,
                    predecessor_session_id = excluded.predecessor_session_id,
                    updated_at = excluded.updated_at",
                params![
                    checkpoint.logical_session_id,
                    checkpoint.checkpoint_seq,
                    checkpoint.pty_id,
                    checkpoint.cli,
                    checkpoint.model,
                    checkpoint.cwd,
                    checkpoint.worktree_branch,
                    checkpoint.worktree_path,
                    checkpoint.repo_path,
                    checkpoint.status,
                    checkpoint.approval_prompt,
                    checkpoint.cost,
                    checkpoint.tokens_used,
                    checkpoint.started_at,
                    checkpoint.last_activity,
                    checkpoint.turn_count,
                    context_remaining_json,
                    summary_json,
                    checkpoint.summary_path,
                    checkpoint.inflight_ref,
                    checkpoint.predecessor_session_id,
                    checkpoint.created_at,
                    checkpoint.updated_at,
                ],
            )
            .map_err(|e| {
                format!(
                    "upsert session checkpoint {}#{}: {e}",
                    checkpoint.logical_session_id, checkpoint.checkpoint_seq
                )
            })?;
        Self::get_checkpoint(
            db,
            &checkpoint.logical_session_id,
            checkpoint.checkpoint_seq,
        )?
        .ok_or_else(|| {
            format!(
                "session checkpoint {}#{} vanished after upsert",
                checkpoint.logical_session_id, checkpoint.checkpoint_seq
            )
        })
    }

    pub fn get_checkpoint(
        db: &Database,
        logical_session_id: &str,
        checkpoint_seq: u64,
    ) -> Result<Option<SessionCheckpointRecord>, String> {
        let sql = format!(
            "SELECT {CHECKPOINT_COLUMNS} FROM session_checkpoints WHERE logical_session_id = ?1 AND checkpoint_seq = ?2"
        );
        let raw = db
            .conn()
            .query_row(
                &sql,
                params![logical_session_id, checkpoint_seq],
                checkpoint_from_row,
            )
            .map(Some)
            .or_else(|e| match e {
                rusqlite::Error::QueryReturnedNoRows => Ok(None),
                other => Err(format!(
                    "load session checkpoint {logical_session_id}#{checkpoint_seq}: {other}"
                )),
            })?;
        raw.map(raw_checkpoint_into_record).transpose()
    }

    pub fn load_latest(
        db: &Database,
        logical_session_id: &str,
    ) -> Result<Option<SessionCheckpointRecord>, String> {
        let sql = format!(
            "SELECT {CHECKPOINT_COLUMNS} FROM session_checkpoints WHERE logical_session_id = ?1 ORDER BY checkpoint_seq DESC LIMIT 1"
        );
        let raw = db
            .conn()
            .query_row(&sql, params![logical_session_id], checkpoint_from_row)
            .map(Some)
            .or_else(|e| match e {
                rusqlite::Error::QueryReturnedNoRows => Ok(None),
                other => Err(format!(
                    "load latest checkpoint {logical_session_id}: {other}"
                )),
            })?;
        raw.map(raw_checkpoint_into_record).transpose()
    }

    pub fn load_latest_all(db: &Database) -> Result<Vec<SessionCheckpointRecord>, String> {
        let sql = format!(
            "SELECT {CHECKPOINT_COLUMNS} FROM session_checkpoints c
             WHERE checkpoint_seq = (
                SELECT MAX(checkpoint_seq)
                FROM session_checkpoints c2
                WHERE c2.logical_session_id = c.logical_session_id
             )
             ORDER BY updated_at ASC"
        );
        let mut stmt = db
            .conn()
            .prepare(&sql)
            .map_err(|e| format!("prepare latest session checkpoints: {e}"))?;
        let rows: Vec<RawCheckpointRow> = stmt
            .query_map([], checkpoint_from_row)
            .map_err(|e| format!("query latest session checkpoints: {e}"))?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(|e| format!("read latest session checkpoint rows: {e}"))?;
        rows.into_iter().map(raw_checkpoint_into_record).collect()
    }

    pub fn ensure_successor_continuation_checkpoint(
        db: &Database,
        successor_generation: &SessionCheckpointRecord,
        accepted_checkpoint: &SessionCheckpointRecord,
        predecessor_session_id: &str,
        now: u64,
    ) -> Result<SessionCheckpointRecord, String> {
        require_nonempty(predecessor_session_id, "predecessor_session_id")?;
        validate_checkpoint(successor_generation)?;
        validate_checkpoint(accepted_checkpoint)?;
        if successor_generation.logical_session_id == predecessor_session_id {
            return Err(
                "successor continuation checkpoint cannot point to itself as predecessor"
                    .to_string(),
            );
        }

        db.conn()
            .execute_batch("BEGIN IMMEDIATE")
            .map_err(|error| format!("begin successor continuation transaction: {error}"))?;
        let result = (|| {
            let sql = format!(
                "SELECT {CHECKPOINT_COLUMNS}
                   FROM session_checkpoints
                  WHERE logical_session_id = ?1
                    AND pty_id = ?2
                    AND predecessor_session_id = ?3
                  ORDER BY checkpoint_seq DESC
                  LIMIT 1"
            );
            let raw = db
                .conn()
                .query_row(
                    &sql,
                    params![
                        successor_generation.logical_session_id,
                        successor_generation.pty_id,
                        predecessor_session_id,
                    ],
                    checkpoint_from_row,
                )
                .map(Some)
                .or_else(|error| match error {
                    rusqlite::Error::QueryReturnedNoRows => Ok(None),
                    other => Err(format!(
                        "load successor continuation checkpoint {}: {other}",
                        successor_generation.logical_session_id
                    )),
                })?;
            if let Some(existing) = raw.map(raw_checkpoint_into_record).transpose()? {
                let exact = existing.summary_json == accepted_checkpoint.summary_json
                    && existing.summary_path == accepted_checkpoint.summary_path
                    && existing.inflight_ref == accepted_checkpoint.inflight_ref;
                if exact {
                    return Ok(existing);
                }
                return Err(format!(
                    "successor continuation checkpoint conflict for {} generation {}",
                    successor_generation.logical_session_id, successor_generation.pty_id
                ));
            }

            let mut continuation = successor_generation.clone();
            continuation.checkpoint_seq =
                Self::next_checkpoint_seq(db, &continuation.logical_session_id)?;
            continuation.summary_json = accepted_checkpoint.summary_json.clone();
            continuation.summary_path = accepted_checkpoint.summary_path.clone();
            continuation.inflight_ref = accepted_checkpoint.inflight_ref.clone();
            continuation.predecessor_session_id = Some(predecessor_session_id.to_string());
            continuation.created_at = now;
            continuation.updated_at = now;
            Self::upsert_checkpoint(db, &continuation)
        })();
        match result {
            Ok(checkpoint) => {
                db.conn().execute_batch("COMMIT").map_err(|error| {
                    format!("commit successor continuation transaction: {error}")
                })?;
                Ok(checkpoint)
            }
            Err(error) => {
                let _ = db.conn().execute_batch("ROLLBACK");
                Err(error)
            }
        }
    }

    pub fn insert_or_get_handoff(
        db: &Database,
        handoff: &SessionHandoffRecord,
    ) -> Result<SessionHandoffRecord, String> {
        validate_handoff(handoff)?;
        db.conn()
            .execute(
                "INSERT INTO session_handoffs (
                    predecessor_id, successor_id, handoff_seq, state, correlation_id,
                    checkpoint_seq, summary_path, failure_reason, created_at, updated_at,
                    baton_version
                 ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)
                 ON CONFLICT(predecessor_id, handoff_seq) DO NOTHING",
                params![
                    handoff.predecessor_id,
                    handoff.successor_id,
                    handoff.handoff_seq,
                    handoff.state.as_str(),
                    handoff.correlation_id,
                    handoff.checkpoint_seq,
                    handoff.summary_path,
                    handoff.failure_reason,
                    handoff.created_at,
                    handoff.updated_at,
                    handoff.handoff_seq,
                ],
            )
            .map_err(|e| {
                format!(
                    "insert session handoff {}#{}: {e}",
                    handoff.predecessor_id, handoff.handoff_seq
                )
            })?;
        let stored = Self::get_handoff(db, &handoff.predecessor_id, handoff.handoff_seq)?
            .ok_or_else(|| {
                format!(
                    "session handoff {}#{} vanished after insert",
                    handoff.predecessor_id, handoff.handoff_seq
                )
            })?;
        if stored.predecessor_id != handoff.predecessor_id
            || stored.successor_id != handoff.successor_id
            || stored.handoff_seq != handoff.handoff_seq
            || stored.correlation_id != handoff.correlation_id
        {
            return Err(format!(
                "session handoff exact replay collision for {}#{}",
                handoff.predecessor_id, handoff.handoff_seq
            ));
        }
        Ok(stored)
    }

    pub fn get_handoff(
        db: &Database,
        predecessor_id: &str,
        handoff_seq: u64,
    ) -> Result<Option<SessionHandoffRecord>, String> {
        Ok(
            Self::get_handoff_durability(db, predecessor_id, handoff_seq)?
                .map(|record| record.handoff),
        )
    }

    pub fn get_handoff_durability(
        db: &Database,
        predecessor_id: &str,
        handoff_seq: u64,
    ) -> Result<Option<SessionHandoffDurabilityRecord>, String> {
        let sql = format!(
            "SELECT {HANDOFF_COLUMNS} FROM session_handoffs WHERE predecessor_id = ?1 AND handoff_seq = ?2"
        );
        let raw = db
            .conn()
            .query_row(&sql, params![predecessor_id, handoff_seq], handoff_from_row)
            .map(Some)
            .or_else(|e| match e {
                rusqlite::Error::QueryReturnedNoRows => Ok(None),
                other => Err(format!(
                    "load session handoff {predecessor_id}#{handoff_seq}: {other}"
                )),
            })?;
        raw.map(raw_handoff_into_durability_record).transpose()
    }

    pub fn bind_handoff_generations(
        db: &Database,
        predecessor_id: &str,
        handoff_seq: u64,
        predecessor_pty_id: &str,
        predecessor_checkpoint_seq: u64,
        successor_pty_id: &str,
        successor_checkpoint_seq: u64,
        baton_version: u64,
        now: u64,
    ) -> Result<SessionHandoffDurabilityRecord, String> {
        require_nonempty(predecessor_pty_id, "predecessor_pty_id")?;
        require_nonempty(successor_pty_id, "successor_pty_id")?;
        if baton_version == 0 || baton_version != handoff_seq {
            return Err(format!(
                "baton_version must exactly equal handoff_seq: {baton_version} != {handoff_seq}"
            ));
        }
        let current = Self::get_handoff_durability(db, predecessor_id, handoff_seq)?
            .ok_or_else(|| format!("session handoff not found: {predecessor_id}#{handoff_seq}"))?;
        let exact = current.predecessor_pty_id.as_deref() == Some(predecessor_pty_id)
            && current.handoff.checkpoint_seq == Some(predecessor_checkpoint_seq)
            && current.successor_pty_id.as_deref() == Some(successor_pty_id)
            && current.successor_checkpoint_seq == Some(successor_checkpoint_seq)
            && current.baton_version == baton_version;
        if exact {
            return Ok(current);
        }
        if current.handoff.state != SessionHandoffState::SuccessorSpawning
            || current.predecessor_pty_id.is_some()
            || current.successor_pty_id.is_some()
            || current.successor_checkpoint_seq.is_some()
        {
            return Err(format!(
                "session handoff generation collision for {predecessor_id}#{handoff_seq}"
            ));
        }
        let changed = db
            .conn()
            .execute(
                "UPDATE session_handoffs
                 SET state = 'successor_spawned',
                     checkpoint_seq = ?3,
                     predecessor_pty_id = ?4,
                     successor_pty_id = ?5,
                     successor_checkpoint_seq = ?6,
                     baton_version = ?7,
                     updated_at = ?8
                 WHERE predecessor_id = ?1 AND handoff_seq = ?2
                   AND state = 'successor_spawning'
                   AND predecessor_pty_id IS NULL
                   AND successor_pty_id IS NULL
                   AND successor_checkpoint_seq IS NULL",
                params![
                    predecessor_id,
                    handoff_seq,
                    predecessor_checkpoint_seq,
                    predecessor_pty_id,
                    successor_pty_id,
                    successor_checkpoint_seq,
                    baton_version,
                    now,
                ],
            )
            .map_err(|error| {
                format!("bind session handoff generations {predecessor_id}#{handoff_seq}: {error}")
            })?;
        if changed != 1 {
            return Err(format!(
                "session handoff generation CAS conflict for {predecessor_id}#{handoff_seq}"
            ));
        }
        Self::get_handoff_durability(db, predecessor_id, handoff_seq)?.ok_or_else(|| {
            format!(
                "session handoff vanished after generation bind: {predecessor_id}#{handoff_seq}"
            )
        })
    }

    pub fn record_handoff_acceptance(
        db: &Database,
        predecessor_id: &str,
        handoff_seq: u64,
        acceptance: &HandoffAcceptanceRecord,
        now: u64,
    ) -> Result<SessionHandoffDurabilityRecord, String> {
        validate_handoff_acceptance_record(acceptance)?;
        let current = Self::get_handoff_durability(db, predecessor_id, handoff_seq)?
            .ok_or_else(|| format!("session handoff not found: {predecessor_id}#{handoff_seq}"))?;
        validate_acceptance_binding(&current, acceptance)?;
        let accepted_checkpoint = Self::get_checkpoint(
            db,
            &acceptance.accepted_checkpoint.logical_session_id,
            acceptance.accepted_checkpoint.checkpoint_seq,
        )?
        .ok_or_else(|| {
            format!(
                "accepted checkpoint is missing: {}#{}",
                acceptance.accepted_checkpoint.logical_session_id,
                acceptance.accepted_checkpoint.checkpoint_seq
            )
        })?;
        let stored_checkpoint_digest = checkpoint_record_digest(&accepted_checkpoint)?;
        if stored_checkpoint_digest != acceptance.accepted_checkpoint.checkpoint_digest {
            return Err(format!(
                "accepted checkpoint digest mismatch: {} != {}",
                acceptance.accepted_checkpoint.checkpoint_digest, stored_checkpoint_digest
            ));
        }
        if let Some(stored) = current.acceptance.as_ref() {
            if stored == acceptance
                && current.acceptance_digest.as_deref() == Some(acceptance.digest.as_str())
                && current.outcome == HandoffOutcome::Accepted
            {
                return Ok(current);
            }
            return Err(format!(
                "session handoff acceptance exact replay conflict for {predecessor_id}#{handoff_seq}"
            ));
        }
        if current.handoff.state != SessionHandoffState::SuccessorSpawned
            || current.outcome != HandoffOutcome::Pending
        {
            return Err(format!(
                "session handoff acceptance CAS conflict for {predecessor_id}#{handoff_seq}"
            ));
        }
        let acceptance_json = serde_json::to_string(acceptance)
            .map_err(|error| format!("serialize handoff acceptance: {error}"))?;
        let changed = db
            .conn()
            .execute(
                "UPDATE session_handoffs
                 SET state = 'successor_acked',
                     acceptance_json = ?3,
                     acceptance_digest = ?4,
                     outcome = 'accepted',
                     updated_at = ?5
                 WHERE predecessor_id = ?1 AND handoff_seq = ?2
                   AND state = 'successor_spawned'
                   AND outcome = 'pending'
                   AND acceptance_json IS NULL
                   AND acceptance_digest IS NULL",
                params![
                    predecessor_id,
                    handoff_seq,
                    acceptance_json,
                    acceptance.digest,
                    now,
                ],
            )
            .map_err(|error| {
                format!("record session handoff acceptance {predecessor_id}#{handoff_seq}: {error}")
            })?;
        if changed != 1 {
            return Err(format!(
                "session handoff acceptance CAS conflict for {predecessor_id}#{handoff_seq}"
            ));
        }
        Self::get_handoff_durability(db, predecessor_id, handoff_seq)?.ok_or_else(|| {
            format!("session handoff vanished after acceptance: {predecessor_id}#{handoff_seq}")
        })
    }

    pub fn record_handoff_failure(
        db: &Database,
        predecessor_id: &str,
        handoff_seq: u64,
        outcome: HandoffOutcome,
        cleanup_status: HandoffCleanupStatus,
        failure_reason: &str,
        now: u64,
    ) -> Result<SessionHandoffDurabilityRecord, String> {
        if !matches!(
            outcome,
            HandoffOutcome::RetryableFailure | HandoffOutcome::TerminalFailure
        ) {
            return Err(
                "handoff failure outcome must be retryable_failure or terminal_failure".to_string(),
            );
        }
        require_nonempty(failure_reason, "failure_reason")?;
        let current = Self::get_handoff_durability(db, predecessor_id, handoff_seq)?
            .ok_or_else(|| format!("session handoff not found: {predecessor_id}#{handoff_seq}"))?;
        if current.handoff.state == SessionHandoffState::Failed {
            let exact = current.outcome == outcome
                && current.cleanup_status == cleanup_status
                && current.handoff.failure_reason.as_deref() == Some(failure_reason);
            if exact {
                return Ok(current);
            }
            return Err(format!(
                "failed session handoff cannot reopen or change outcome: {predecessor_id}#{handoff_seq}"
            ));
        }
        let changed = db
            .conn()
            .execute(
                "UPDATE session_handoffs
                 SET state = 'failed',
                     outcome = ?3,
                     cleanup_status = ?4,
                     failure_reason = ?5,
                     updated_at = ?6
                 WHERE predecessor_id = ?1 AND handoff_seq = ?2
                   AND state = ?7",
                params![
                    predecessor_id,
                    handoff_seq,
                    outcome.as_str(),
                    cleanup_status.as_str(),
                    failure_reason,
                    now,
                    current.handoff.state.as_str(),
                ],
            )
            .map_err(|error| {
                format!("record session handoff failure {predecessor_id}#{handoff_seq}: {error}")
            })?;
        if changed != 1 {
            return Err(format!(
                "session handoff failure CAS conflict for {predecessor_id}#{handoff_seq}"
            ));
        }
        Self::get_handoff_durability(db, predecessor_id, handoff_seq)?.ok_or_else(|| {
            format!("session handoff vanished after failure record: {predecessor_id}#{handoff_seq}")
        })
    }

    pub fn set_handoff_cleanup_status(
        db: &Database,
        predecessor_id: &str,
        handoff_seq: u64,
        cleanup_status: HandoffCleanupStatus,
        promote_terminal: bool,
        now: u64,
    ) -> Result<SessionHandoffDurabilityRecord, String> {
        let current = Self::get_handoff_durability(db, predecessor_id, handoff_seq)?
            .ok_or_else(|| format!("session handoff not found: {predecessor_id}#{handoff_seq}"))?;
        if current.handoff.state != SessionHandoffState::Failed {
            return Err(format!(
                "cleanup status requires failed handoff: {predecessor_id}#{handoff_seq}"
            ));
        }
        let outcome = if promote_terminal {
            HandoffOutcome::TerminalFailure
        } else {
            current.outcome
        };
        if current.cleanup_status == cleanup_status && current.outcome == outcome {
            return Ok(current);
        }
        let allowed = matches!(
            (current.cleanup_status, cleanup_status),
            (HandoffCleanupStatus::Pending, HandoffCleanupStatus::Stopped)
                | (
                    HandoffCleanupStatus::Pending,
                    HandoffCleanupStatus::Quarantined
                )
                | (
                    HandoffCleanupStatus::Quarantined,
                    HandoffCleanupStatus::Stopped
                )
        );
        if !allowed {
            return Err(format!(
                "invalid handoff cleanup transition {:?} -> {:?}",
                current.cleanup_status, cleanup_status
            ));
        }
        let changed = db
            .conn()
            .execute(
                "UPDATE session_handoffs
                 SET cleanup_status = ?3, outcome = ?4, updated_at = ?5
                 WHERE predecessor_id = ?1 AND handoff_seq = ?2
                   AND state = 'failed' AND cleanup_status = ?6 AND outcome = ?7",
                params![
                    predecessor_id,
                    handoff_seq,
                    cleanup_status.as_str(),
                    outcome.as_str(),
                    now,
                    current.cleanup_status.as_str(),
                    current.outcome.as_str(),
                ],
            )
            .map_err(|error| {
                format!("set session handoff cleanup {predecessor_id}#{handoff_seq}: {error}")
            })?;
        if changed != 1 {
            return Err(format!(
                "session handoff cleanup CAS conflict for {predecessor_id}#{handoff_seq}"
            ));
        }
        Self::get_handoff_durability(db, predecessor_id, handoff_seq)?.ok_or_else(|| {
            format!("session handoff vanished after cleanup update: {predecessor_id}#{handoff_seq}")
        })
    }

    pub fn list_handoffs_requiring_reconciliation(
        db: &Database,
    ) -> Result<Vec<SessionHandoffDurabilityRecord>, String> {
        let sql = format!("SELECT {HANDOFF_COLUMNS} FROM session_handoffs ORDER BY created_at ASC");
        let mut stmt = db
            .conn()
            .prepare(&sql)
            .map_err(|error| format!("prepare handoffs requiring reconciliation: {error}"))?;
        let rows: Vec<RawHandoffRow> = stmt
            .query_map([], handoff_from_row)
            .map_err(|error| format!("query handoffs requiring reconciliation: {error}"))?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(|error| format!("read handoffs requiring reconciliation: {error}"))?;
        rows.into_iter()
            .map(raw_handoff_into_durability_record)
            .filter_map(|record| match record {
                Ok(record) if record.requires_reconciliation() => Some(Ok(record)),
                Ok(_) => None,
                Err(error) => Some(Err(error)),
            })
            .collect()
    }

    pub fn set_handoff_state(
        db: &Database,
        predecessor_id: &str,
        handoff_seq: u64,
        state: SessionHandoffState,
        checkpoint_seq: Option<u64>,
        summary_path: Option<&str>,
        failure_reason: Option<&str>,
        now: u64,
    ) -> Result<(), String> {
        let current = Self::get_handoff(db, predecessor_id, handoff_seq)?
            .ok_or_else(|| format!("session handoff not found: {predecessor_id}#{handoff_seq}"))?;
        if current.state == state {
            let checkpoint_matches = checkpoint_seq
                .map(|value| current.checkpoint_seq == Some(value))
                .unwrap_or(true);
            let summary_matches = summary_path
                .map(|value| current.summary_path.as_deref() == Some(value))
                .unwrap_or(true);
            let failure_matches = current.failure_reason.as_deref() == failure_reason;
            if checkpoint_matches && summary_matches && failure_matches {
                return Ok(());
            }
            return Err(format!(
                "session handoff exact replay conflict for {predecessor_id}#{handoff_seq}"
            ));
        }
        let allowed = matches!(
            (current.state, state),
            (
                SessionHandoffState::PendingSummary,
                SessionHandoffState::Checkpointed
            ) | (
                SessionHandoffState::Checkpointed,
                SessionHandoffState::SuccessorSpawning
            ) | (
                SessionHandoffState::SuccessorSpawning,
                SessionHandoffState::SuccessorSpawned
            ) | (
                SessionHandoffState::SuccessorSpawned,
                SessionHandoffState::SuccessorAcked
            ) | (
                SessionHandoffState::SuccessorAcked,
                SessionHandoffState::PredecessorRetired
            )
        );
        if !allowed {
            return Err(format!(
                "invalid session handoff transition {} -> {} for {predecessor_id}#{handoff_seq}",
                current.state.as_str(),
                state.as_str()
            ));
        }
        let changed = db
            .conn()
            .execute(
                "UPDATE session_handoffs
                 SET state = ?3,
                     checkpoint_seq = COALESCE(?4, checkpoint_seq),
                     summary_path = COALESCE(?5, summary_path),
                     failure_reason = ?6,
                     updated_at = ?7
                 WHERE predecessor_id = ?1 AND handoff_seq = ?2 AND state = ?8",
                params![
                    predecessor_id,
                    handoff_seq,
                    state.as_str(),
                    checkpoint_seq,
                    summary_path,
                    failure_reason,
                    now,
                    current.state.as_str(),
                ],
            )
            .map_err(|e| {
                format!("set session handoff {predecessor_id}#{handoff_seq} state: {e}")
            })?;
        if changed == 1 {
            Ok(())
        } else {
            Err(format!(
                "session handoff state CAS conflict: {predecessor_id}#{handoff_seq}"
            ))
        }
    }

    pub fn list_unresolved_handoffs(db: &Database) -> Result<Vec<SessionHandoffRecord>, String> {
        let sql = format!(
            "SELECT {HANDOFF_COLUMNS} FROM session_handoffs WHERE state NOT IN ('predecessor_retired','failed') ORDER BY created_at ASC"
        );
        let mut stmt = db
            .conn()
            .prepare(&sql)
            .map_err(|e| format!("prepare unresolved session handoffs: {e}"))?;
        let rows: Vec<RawHandoffRow> = stmt
            .query_map([], handoff_from_row)
            .map_err(|e| format!("query unresolved session handoffs: {e}"))?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(|e| format!("read unresolved session handoff rows: {e}"))?;
        rows.into_iter().map(raw_handoff_into_record).collect()
    }

    pub fn load_latest_handoff_for_session(
        db: &Database,
        logical_session_id: &str,
    ) -> Result<Option<SessionHandoffRecord>, String> {
        let sql = format!(
            "SELECT {HANDOFF_COLUMNS} FROM session_handoffs
             WHERE predecessor_id = ?1 OR successor_id = ?1
             ORDER BY updated_at DESC, handoff_seq DESC
             LIMIT 1"
        );
        let raw = db
            .conn()
            .query_row(&sql, params![logical_session_id], handoff_from_row)
            .map(Some)
            .or_else(|e| match e {
                rusqlite::Error::QueryReturnedNoRows => Ok(None),
                other => Err(format!(
                    "load latest session handoff for {logical_session_id}: {other}"
                )),
            })?;
        raw.map(raw_handoff_into_record).transpose()
    }
}

#[allow(clippy::type_complexity)]
type RawCheckpointRow = (
    String,
    i64,
    String,
    String,
    String,
    String,
    Option<String>,
    Option<String>,
    Option<String>,
    String,
    Option<String>,
    f64,
    i64,
    i64,
    i64,
    i64,
    Option<String>,
    Option<String>,
    Option<String>,
    Option<String>,
    Option<String>,
    i64,
    i64,
);

type RawHandoffRow = (
    String,
    String,
    i64,
    String,
    String,
    Option<i64>,
    Option<String>,
    Option<String>,
    i64,
    i64,
    Option<String>,
    Option<String>,
    Option<i64>,
    i64,
    Option<String>,
    Option<String>,
    String,
    String,
);

fn checkpoint_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<RawCheckpointRow> {
    Ok((
        row.get(0)?,
        row.get(1)?,
        row.get(2)?,
        row.get(3)?,
        row.get(4)?,
        row.get(5)?,
        row.get(6)?,
        row.get(7)?,
        row.get(8)?,
        row.get(9)?,
        row.get(10)?,
        row.get(11)?,
        row.get(12)?,
        row.get(13)?,
        row.get(14)?,
        row.get(15)?,
        row.get(16)?,
        row.get(17)?,
        row.get(18)?,
        row.get(19)?,
        row.get(20)?,
        row.get(21)?,
        row.get(22)?,
    ))
}

fn handoff_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<RawHandoffRow> {
    Ok((
        row.get(0)?,
        row.get(1)?,
        row.get(2)?,
        row.get(3)?,
        row.get(4)?,
        row.get(5)?,
        row.get(6)?,
        row.get(7)?,
        row.get(8)?,
        row.get(9)?,
        row.get(10)?,
        row.get(11)?,
        row.get(12)?,
        row.get(13)?,
        row.get(14)?,
        row.get(15)?,
        row.get(16)?,
        row.get(17)?,
    ))
}

fn raw_checkpoint_into_record(row: RawCheckpointRow) -> Result<SessionCheckpointRecord, String> {
    Ok(SessionCheckpointRecord {
        logical_session_id: row.0,
        checkpoint_seq: nonnegative_u64("checkpoint_seq", row.1)?,
        pty_id: row.2,
        cli: row.3,
        model: row.4,
        cwd: row.5,
        worktree_branch: row.6,
        worktree_path: row.7,
        repo_path: row.8,
        status: row.9,
        approval_prompt: row.10,
        cost: row.11,
        tokens_used: nonnegative_u64("tokens_used", row.12)?,
        started_at: nonnegative_u64("started_at", row.13)?,
        last_activity: nonnegative_u64("last_activity", row.14)?,
        turn_count: nonnegative_u64("turn_count", row.15)?,
        context_remaining: parse_json_opt("context_remaining_json", row.16)?,
        summary_json: parse_json_opt("summary_json", row.17)?,
        summary_path: row.18,
        inflight_ref: row.19,
        predecessor_session_id: row.20,
        created_at: nonnegative_u64("created_at", row.21)?,
        updated_at: nonnegative_u64("updated_at", row.22)?,
    })
}

fn raw_handoff_into_record(row: RawHandoffRow) -> Result<SessionHandoffRecord, String> {
    Ok(raw_handoff_into_durability_record(row)?.handoff)
}

fn raw_handoff_into_durability_record(
    row: RawHandoffRow,
) -> Result<SessionHandoffDurabilityRecord, String> {
    let acceptance: Option<HandoffAcceptanceRecord> =
        parse_json_opt("acceptance_json", row.14.clone())?;
    match (&acceptance, &row.15) {
        (None, None) => {}
        (Some(record), Some(digest)) => {
            validate_handoff_acceptance_record(record)?;
            if &record.digest != digest {
                return Err(format!(
                    "session handoff acceptance digest column mismatch: {} != {}",
                    record.digest, digest
                ));
            }
        }
        _ => {
            return Err(
                "session handoff acceptance_json and acceptance_digest must both be present"
                    .to_string(),
            )
        }
    }
    let record = SessionHandoffDurabilityRecord {
        handoff: SessionHandoffRecord {
            predecessor_id: row.0,
            successor_id: row.1,
            handoff_seq: nonnegative_u64("handoff_seq", row.2)?,
            state: SessionHandoffState::from_str(&row.3)?,
            correlation_id: row.4,
            checkpoint_seq: row
                .5
                .map(|value| nonnegative_u64("checkpoint_seq", value))
                .transpose()?,
            summary_path: row.6,
            failure_reason: row.7,
            created_at: nonnegative_u64("created_at", row.8)?,
            updated_at: nonnegative_u64("updated_at", row.9)?,
        },
        predecessor_pty_id: row.10,
        successor_pty_id: row.11,
        successor_checkpoint_seq: row
            .12
            .map(|value| nonnegative_u64("successor_checkpoint_seq", value))
            .transpose()?,
        baton_version: nonnegative_u64("baton_version", row.13)?,
        acceptance,
        acceptance_digest: row.15,
        outcome: HandoffOutcome::from_str(&row.16)?,
        cleanup_status: HandoffCleanupStatus::from_str(&row.17)?,
    };
    if let Some(acceptance) = record.acceptance.as_ref() {
        validate_acceptance_binding(&record, acceptance)?;
    }
    if record.outcome == HandoffOutcome::Accepted && record.acceptance.is_none() {
        return Err(format!(
            "accepted session handoff is missing structured acceptance: {}#{}",
            record.handoff.predecessor_id, record.handoff.handoff_seq
        ));
    }
    Ok(record)
}

fn validate_checkpoint(checkpoint: &SessionCheckpointRecord) -> Result<(), String> {
    require_nonempty(&checkpoint.logical_session_id, "logical_session_id")?;
    require_nonempty(&checkpoint.pty_id, "pty_id")?;
    require_nonempty(&checkpoint.cli, "cli")?;
    require_nonempty(&checkpoint.model, "model")?;
    require_nonempty(&checkpoint.cwd, "cwd")?;
    require_nonempty(&checkpoint.status, "status")?;
    Ok(())
}

fn validate_handoff(handoff: &SessionHandoffRecord) -> Result<(), String> {
    require_nonempty(&handoff.predecessor_id, "predecessor_id")?;
    require_nonempty(&handoff.successor_id, "successor_id")?;
    require_nonempty(&handoff.correlation_id, "correlation_id")?;
    Ok(())
}

fn validate_acceptance_binding(
    handoff: &SessionHandoffDurabilityRecord,
    acceptance: &HandoffAcceptanceRecord,
) -> Result<(), String> {
    let matches = acceptance.predecessor_generation.logical_session_id
        == handoff.handoff.predecessor_id
        && Some(acceptance.predecessor_generation.pty_id.as_str())
            == handoff.predecessor_pty_id.as_deref()
        && Some(acceptance.predecessor_generation.checkpoint_seq) == handoff.handoff.checkpoint_seq
        && acceptance.successor_generation.logical_session_id == handoff.handoff.successor_id
        && Some(acceptance.successor_generation.pty_id.as_str())
            == handoff.successor_pty_id.as_deref()
        && Some(acceptance.successor_generation.checkpoint_seq) == handoff.successor_checkpoint_seq
        && acceptance.accepted_checkpoint.logical_session_id == handoff.handoff.predecessor_id
        && Some(acceptance.accepted_checkpoint.checkpoint_seq) == handoff.handoff.checkpoint_seq
        && acceptance.accepted_checkpoint.summary_path.as_str()
            == handoff.handoff.summary_path.as_deref().unwrap_or_default()
        && acceptance.baton_version == handoff.baton_version
        && acceptance.baton_version == handoff.handoff.handoff_seq;
    if matches {
        Ok(())
    } else {
        Err(format!(
            "handoff acceptance does not match bound generations for {}#{}",
            handoff.handoff.predecessor_id, handoff.handoff.handoff_seq
        ))
    }
}

fn require_nonempty(value: &str, label: &str) -> Result<(), String> {
    if value.trim().is_empty() {
        Err(format!("{label} is required"))
    } else {
        Ok(())
    }
}

fn nonnegative_u64(label: &str, value: i64) -> Result<u64, String> {
    u64::try_from(value).map_err(|_| format!("{label} must be non-negative, got {value}"))
}

fn canonical_json<T: Serialize>(value: &T) -> Result<String, String> {
    serde_json::to_string(value).map_err(|e| format!("serialize checkpoint JSON: {e}"))
}

fn parse_json_opt<T>(label: &str, value: Option<String>) -> Result<Option<T>, String>
where
    T: for<'de> Deserialize<'de>,
{
    value
        .map(|text| serde_json::from_str(&text).map_err(|e| format!("parse {label}: {e}")))
        .transpose()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent::context_lifecycle::ContextRemaining;
    use crate::agent::session_lifecycle::{
        build_handoff_acceptance_record, AcceptedCheckpointRef, HandoffGenerationIdentity,
    };
    use crate::agent::AgentCli;

    fn checkpoint(seq: u64) -> SessionCheckpointRecord {
        SessionCheckpointRecord {
            logical_session_id: "logical-a".to_string(),
            checkpoint_seq: seq,
            pty_id: "pty-a".to_string(),
            cli: "claude".to_string(),
            model: "sonnet".to_string(),
            cwd: "C:/repo".to_string(),
            worktree_branch: Some("agent/a".to_string()),
            worktree_path: Some("C:/repo/.worktrees/a".to_string()),
            repo_path: Some("C:/repo".to_string()),
            status: "idle".to_string(),
            approval_prompt: Some("approve fixture".to_string()),
            cost: 1.5,
            tokens_used: 42,
            started_at: 10,
            last_activity: 20,
            turn_count: 3,
            context_remaining: Some(ContextRemaining::unknown_proxy(&AgentCli::Claude, 20)),
            summary_json: Some(serde_json::json!({
                "schema": "aelyris.session.v1",
                "goal": "ship checkpoint"
            })),
            summary_path: Some("C:/repo/.aelyris/handoff/logical-a.1.json".to_string()),
            inflight_ref: Some("stash:abc".to_string()),
            predecessor_session_id: Some("logical-prev".to_string()),
            created_at: 30,
            updated_at: 30,
        }
    }

    fn handoff(seq: u64) -> SessionHandoffRecord {
        SessionHandoffRecord {
            predecessor_id: "logical-a".to_string(),
            successor_id: "logical-b".to_string(),
            handoff_seq: seq,
            state: SessionHandoffState::PendingSummary,
            correlation_id: "corr-a".to_string(),
            checkpoint_seq: None,
            summary_path: None,
            failure_reason: None,
            created_at: 100,
            updated_at: 100,
        }
    }

    #[test]
    fn checkpoint_round_trips_and_latest_is_stable() {
        let db = Database::open_memory().unwrap();
        let first = SessionCheckpointRepo::upsert_checkpoint(&db, &checkpoint(1)).unwrap();
        let second = SessionCheckpointRepo::upsert_checkpoint(&db, &checkpoint(2)).unwrap();
        assert_eq!(first.checkpoint_seq, 1);
        assert_eq!(second.checkpoint_seq, 2);

        let latest = SessionCheckpointRepo::load_latest(&db, "logical-a")
            .unwrap()
            .unwrap();
        assert_eq!(latest.checkpoint_seq, 2);
        assert_eq!(
            latest.context_remaining.unwrap().source,
            "status_time_turn_proxy"
        );
        assert_eq!(
            latest.summary_json.unwrap()["schema"],
            serde_json::json!("aelyris.session.v1")
        );
        assert_eq!(
            SessionCheckpointRepo::next_checkpoint_seq(&db, "logical-a").unwrap(),
            3
        );
    }

    #[test]
    fn checkpoint_upsert_is_idempotent_for_same_sequence() {
        let db = Database::open_memory().unwrap();
        let mut one = checkpoint(1);
        SessionCheckpointRepo::upsert_checkpoint(&db, &one).unwrap();
        one.status = "summarizing".to_string();
        one.updated_at = 31;
        SessionCheckpointRepo::upsert_checkpoint(&db, &one).unwrap();

        let rows = SessionCheckpointRepo::load_latest_all(&db).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].status, "summarizing");
    }

    #[test]
    fn append_checkpoint_allocates_monotonic_sequences() {
        let db = Database::open_memory().unwrap();
        let mut record = checkpoint(0);
        let first = SessionCheckpointRepo::append_checkpoint(&db, &record).unwrap();
        record.status = "thinking".to_string();
        let second = SessionCheckpointRepo::append_checkpoint(&db, &record).unwrap();
        assert_eq!((first.checkpoint_seq, second.checkpoint_seq), (1, 2));
        assert_eq!(
            SessionCheckpointRepo::load_latest(&db, "logical-a")
                .unwrap()
                .unwrap()
                .status,
            "thinking"
        );
    }

    #[test]
    fn concurrent_database_connections_allocate_unique_sequences() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("multi-instance.db");
        let left = Database::open(&path).unwrap();
        let right = Database::open(&path).unwrap();
        let left_thread = std::thread::spawn(move || {
            SessionCheckpointRepo::append_checkpoint(&left, &checkpoint(0)).unwrap()
        });
        let right_thread = std::thread::spawn(move || {
            SessionCheckpointRepo::append_checkpoint(&right, &checkpoint(0)).unwrap()
        });
        let mut sequences = vec![
            left_thread.join().unwrap().checkpoint_seq,
            right_thread.join().unwrap().checkpoint_seq,
        ];
        sequences.sort_unstable();
        assert_eq!(sequences, vec![1, 2]);
        let verify = Database::open(&path).unwrap();
        assert_eq!(
            SessionCheckpointRepo::next_checkpoint_seq(&verify, "logical-a").unwrap(),
            3
        );
    }

    #[test]
    fn locked_database_returns_explicit_checkpoint_error_without_mutation() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("locked.db");
        let lock_owner = Database::open(&path).unwrap();
        let writer = Database::open(&path).unwrap();
        writer
            .conn()
            .busy_timeout(std::time::Duration::from_millis(25))
            .unwrap();
        lock_owner.conn().execute_batch("BEGIN IMMEDIATE").unwrap();
        let error = SessionCheckpointRepo::append_checkpoint(&writer, &checkpoint(0)).unwrap_err();
        assert!(error.contains("begin checkpoint append transaction"));
        lock_owner.conn().execute_batch("ROLLBACK").unwrap();
        assert_eq!(
            SessionCheckpointRepo::next_checkpoint_seq(&writer, "logical-a").unwrap(),
            1
        );
    }

    #[test]
    fn handoff_intent_is_idempotent_and_stateful() {
        let db = Database::open_memory().unwrap();
        let first = SessionCheckpointRepo::insert_or_get_handoff(&db, &handoff(1)).unwrap();
        let mut duplicate = handoff(1);
        duplicate.successor_id = "different-successor".to_string();
        let error = SessionCheckpointRepo::insert_or_get_handoff(&db, &duplicate).unwrap_err();
        assert!(error.contains("exact replay collision"), "{error}");
        let stored = SessionCheckpointRepo::insert_or_get_handoff(&db, &handoff(1)).unwrap();
        assert_eq!(first, stored);

        SessionCheckpointRepo::set_handoff_state(
            &db,
            "logical-a",
            1,
            SessionHandoffState::Checkpointed,
            Some(7),
            Some("C:/repo/.aelyris/handoff/logical-a.1.json"),
            None,
            120,
        )
        .unwrap();
        let updated = SessionCheckpointRepo::get_handoff(&db, "logical-a", 1)
            .unwrap()
            .unwrap();
        assert_eq!(updated.state, SessionHandoffState::Checkpointed);
        assert_eq!(updated.checkpoint_seq, Some(7));
        assert_eq!(
            SessionCheckpointRepo::list_unresolved_handoffs(&db)
                .unwrap()
                .len(),
            1
        );
        assert_eq!(
            SessionCheckpointRepo::next_handoff_seq(&db, "logical-a").unwrap(),
            2
        );
    }

    #[test]
    fn handoff_defining_columns_are_immutable_and_rows_are_permanent() {
        let db = Database::open_memory().unwrap();
        SessionCheckpointRepo::insert_or_get_handoff(&db, &handoff(1)).unwrap();
        let update_err = db
            .conn()
            .execute(
                "UPDATE session_handoffs SET successor_id = 'evil' WHERE predecessor_id = 'logical-a'",
                [],
            )
            .unwrap_err()
            .to_string();
        assert!(update_err.contains("session_handoffs: handoff-defining columns are immutable"));
        let delete_err = db
            .conn()
            .execute(
                "DELETE FROM session_handoffs WHERE predecessor_id = 'logical-a'",
                [],
            )
            .unwrap_err()
            .to_string();
        assert!(delete_err.contains("session_handoffs: rows are permanent"));
    }

    #[test]
    fn loads_latest_handoff_for_predecessor_or_successor() {
        let db = Database::open_memory().unwrap();
        let mut legacy_acked = handoff(1);
        legacy_acked.state = SessionHandoffState::SuccessorAcked;
        SessionCheckpointRepo::insert_or_get_handoff(&db, &legacy_acked).unwrap();
        SessionCheckpointRepo::set_handoff_state(
            &db,
            "logical-a",
            1,
            SessionHandoffState::PredecessorRetired,
            Some(4),
            Some("C:/repo/.aelyris/handoff/logical-a.1.json"),
            None,
            150,
        )
        .unwrap();

        let by_predecessor =
            SessionCheckpointRepo::load_latest_handoff_for_session(&db, "logical-a")
                .unwrap()
                .unwrap();
        let by_successor = SessionCheckpointRepo::load_latest_handoff_for_session(&db, "logical-b")
            .unwrap()
            .unwrap();

        assert_eq!(
            by_predecessor.state,
            SessionHandoffState::PredecessorRetired
        );
        assert_eq!(by_successor.predecessor_id, "logical-a");
        assert_eq!(by_successor.successor_id, "logical-b");
    }

    fn bound_handoff(db: &Database) -> SessionHandoffDurabilityRecord {
        let mut accepted_checkpoint = checkpoint(7);
        accepted_checkpoint.summary_path =
            Some("C:/repo/.aelyris/handoff/logical-a.1.json".to_string());
        SessionCheckpointRepo::upsert_checkpoint(db, &accepted_checkpoint).unwrap();
        let intent = handoff(1);
        SessionCheckpointRepo::insert_or_get_handoff(db, &intent).unwrap();
        SessionCheckpointRepo::set_handoff_state(
            db,
            "logical-a",
            1,
            SessionHandoffState::Checkpointed,
            Some(7),
            Some("C:/repo/.aelyris/handoff/logical-a.1.json"),
            None,
            105,
        )
        .unwrap();
        SessionCheckpointRepo::set_handoff_state(
            db,
            "logical-a",
            1,
            SessionHandoffState::SuccessorSpawning,
            None,
            None,
            None,
            110,
        )
        .unwrap();
        SessionCheckpointRepo::bind_handoff_generations(
            db,
            "logical-a",
            1,
            "pty-a",
            7,
            "pty-b",
            2,
            1,
            120,
        )
        .unwrap()
    }

    fn acceptance(db: &Database) -> HandoffAcceptanceRecord {
        let checkpoint = SessionCheckpointRepo::get_checkpoint(db, "logical-a", 7)
            .unwrap()
            .unwrap();
        build_handoff_acceptance_record(
            HandoffGenerationIdentity {
                logical_session_id: "logical-a".to_string(),
                pty_id: "pty-a".to_string(),
                checkpoint_seq: 7,
            },
            HandoffGenerationIdentity {
                logical_session_id: "logical-b".to_string(),
                pty_id: "pty-b".to_string(),
                checkpoint_seq: 2,
            },
            AcceptedCheckpointRef {
                logical_session_id: "logical-a".to_string(),
                checkpoint_seq: 7,
                summary_path: "C:/repo/.aelyris/handoff/logical-a.1.json".to_string(),
                checkpoint_digest: checkpoint_record_digest(&checkpoint).unwrap(),
            },
            1,
        )
        .unwrap()
    }

    #[test]
    fn structured_handoff_acceptance_is_digest_validated_exact_replay_only_and_cas_bound() {
        let db = Database::open_memory().unwrap();
        bound_handoff(&db);
        let accepted = SessionCheckpointRepo::record_handoff_acceptance(
            &db,
            "logical-a",
            1,
            &acceptance(&db),
            130,
        )
        .unwrap();
        assert_eq!(accepted.outcome, HandoffOutcome::Accepted);
        assert_eq!(accepted.handoff.state, SessionHandoffState::SuccessorAcked);

        let replay = SessionCheckpointRepo::record_handoff_acceptance(
            &db,
            "logical-a",
            1,
            &acceptance(&db),
            140,
        )
        .unwrap();
        assert_eq!(replay.acceptance, accepted.acceptance);

        let mut tampered = acceptance(&db);
        tampered.successor_generation.pty_id = "pty-evil".to_string();
        let error =
            SessionCheckpointRepo::record_handoff_acceptance(&db, "logical-a", 1, &tampered, 150)
                .unwrap_err();
        assert!(error.contains("digest mismatch"), "{error}");

        let mut rebound = acceptance(&db);
        rebound.successor_generation.pty_id = "pty-evil".to_string();
        rebound = build_handoff_acceptance_record(
            rebound.predecessor_generation,
            rebound.successor_generation,
            rebound.accepted_checkpoint,
            rebound.baton_version,
        )
        .unwrap();
        let error =
            SessionCheckpointRepo::record_handoff_acceptance(&db, "logical-a", 1, &rebound, 160)
                .unwrap_err();
        assert!(
            error.contains("does not match bound generations")
                || error.contains("exact replay conflict"),
            "{error}"
        );
    }

    #[test]
    fn structured_handoff_accepted_boot_crash_ensures_one_exact_lineage_checkpoint() {
        let db = Database::open_memory().unwrap();
        bound_handoff(&db);
        let mut successor_generation = checkpoint(2);
        successor_generation.logical_session_id = "logical-b".to_string();
        successor_generation.pty_id = "pty-b".to_string();
        successor_generation.summary_json = None;
        successor_generation.summary_path = None;
        successor_generation.inflight_ref = None;
        successor_generation.predecessor_session_id = None;
        SessionCheckpointRepo::upsert_checkpoint(&db, &successor_generation).unwrap();
        let acceptance = acceptance(&db);
        SessionCheckpointRepo::record_handoff_acceptance(&db, "logical-a", 1, &acceptance, 130)
            .unwrap();
        let accepted_checkpoint = SessionCheckpointRepo::get_checkpoint(&db, "logical-a", 7)
            .unwrap()
            .unwrap();

        let first = SessionCheckpointRepo::ensure_successor_continuation_checkpoint(
            &db,
            &successor_generation,
            &accepted_checkpoint,
            "logical-a",
            140,
        )
        .unwrap();
        let replay = SessionCheckpointRepo::ensure_successor_continuation_checkpoint(
            &db,
            &successor_generation,
            &accepted_checkpoint,
            "logical-a",
            150,
        )
        .unwrap();

        assert_eq!(first.checkpoint_seq, replay.checkpoint_seq);
        assert_eq!(first.pty_id, "pty-b");
        assert_eq!(first.predecessor_session_id.as_deref(), Some("logical-a"));
        assert_eq!(first.summary_json, accepted_checkpoint.summary_json);
        assert_eq!(first.summary_path, accepted_checkpoint.summary_path);
        assert_eq!(first.inflight_ref, accepted_checkpoint.inflight_ref);
        let lineage_count: i64 = db
            .conn()
            .query_row(
                "SELECT COUNT(*) FROM session_checkpoints
                  WHERE logical_session_id = 'logical-b'
                    AND pty_id = 'pty-b'
                    AND predecessor_session_id = 'logical-a'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(lineage_count, 1);

        SessionCheckpointRepo::set_handoff_state(
            &db,
            "logical-a",
            1,
            SessionHandoffState::PredecessorRetired,
            Some(7),
            Some("C:/repo/.aelyris/handoff/logical-a.1.json"),
            None,
            160,
        )
        .unwrap();
    }

    #[test]
    fn structured_handoff_generation_collision_is_rejected_without_rebinding() {
        let db = Database::open_memory().unwrap();
        let first = bound_handoff(&db);
        let error = SessionCheckpointRepo::bind_handoff_generations(
            &db,
            "logical-a",
            1,
            "pty-a",
            7,
            "pty-collision",
            3,
            1,
            130,
        )
        .unwrap_err();
        assert!(error.contains("generation collision"), "{error}");
        let stored = SessionCheckpointRepo::get_handoff_durability(&db, "logical-a", 1)
            .unwrap()
            .unwrap();
        assert_eq!(stored.successor_pty_id, first.successor_pty_id);
        assert_eq!(
            stored.successor_checkpoint_seq,
            first.successor_checkpoint_seq
        );
    }

    #[test]
    fn structured_handoff_state_cas_allows_only_one_competing_advancement() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("handoff-cas.db");
        let seed = Database::open(&path).unwrap();
        SessionCheckpointRepo::insert_or_get_handoff(&seed, &handoff(1)).unwrap();
        drop(seed);

        let left = Database::open(&path).unwrap();
        let right = Database::open(&path).unwrap();
        let left_thread = std::thread::spawn(move || {
            SessionCheckpointRepo::set_handoff_state(
                &left,
                "logical-a",
                1,
                SessionHandoffState::Checkpointed,
                Some(7),
                Some("left.json"),
                None,
                120,
            )
        });
        let right_thread = std::thread::spawn(move || {
            SessionCheckpointRepo::set_handoff_state(
                &right,
                "logical-a",
                1,
                SessionHandoffState::Checkpointed,
                Some(8),
                Some("right.json"),
                None,
                121,
            )
        });
        let results = [left_thread.join().unwrap(), right_thread.join().unwrap()];
        assert_eq!(results.iter().filter(|result| result.is_ok()).count(), 1);
        assert_eq!(results.iter().filter(|result| result.is_err()).count(), 1);
    }

    #[test]
    fn structured_handoff_failure_outcomes_are_durable_terminal_never_reopens_and_quarantine_reconciles(
    ) {
        let db = Database::open_memory().unwrap();
        bound_handoff(&db);
        let failed = SessionCheckpointRepo::record_handoff_failure(
            &db,
            "logical-a",
            1,
            HandoffOutcome::RetryableFailure,
            HandoffCleanupStatus::Pending,
            "ack timeout",
            130,
        )
        .unwrap();
        assert!(failed.requires_reconciliation());

        let quarantined = SessionCheckpointRepo::set_handoff_cleanup_status(
            &db,
            "logical-a",
            1,
            HandoffCleanupStatus::Quarantined,
            true,
            140,
        )
        .unwrap();
        assert_eq!(quarantined.outcome, HandoffOutcome::TerminalFailure);
        assert!(quarantined.requires_reconciliation());
        assert_eq!(
            SessionCheckpointRepo::list_handoffs_requiring_reconciliation(&db)
                .unwrap()
                .len(),
            1
        );
        let regress = SessionCheckpointRepo::record_handoff_failure(
            &db,
            "logical-a",
            1,
            HandoffOutcome::RetryableFailure,
            HandoffCleanupStatus::Pending,
            "late retry",
            145,
        )
        .unwrap_err();
        assert!(
            regress.contains("cannot reopen or change outcome"),
            "{regress}"
        );
        let still_quarantined = SessionCheckpointRepo::get_handoff_durability(&db, "logical-a", 1)
            .unwrap()
            .unwrap();
        assert_eq!(still_quarantined.outcome, HandoffOutcome::TerminalFailure);
        assert_eq!(
            still_quarantined.cleanup_status,
            HandoffCleanupStatus::Quarantined
        );
        let reopen = SessionCheckpointRepo::set_handoff_state(
            &db,
            "logical-a",
            1,
            SessionHandoffState::SuccessorSpawned,
            None,
            None,
            None,
            150,
        )
        .unwrap_err();
        assert!(
            reopen.contains("invalid session handoff transition failed"),
            "{reopen}"
        );
    }
}
