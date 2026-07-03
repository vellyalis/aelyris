use rusqlite::params;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::str::FromStr;

use crate::agent::context_lifecycle::ContextRemaining;
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

const CHECKPOINT_COLUMNS: &str = "logical_session_id, checkpoint_seq, pty_id, cli, model, cwd, \
     worktree_branch, worktree_path, repo_path, status, cost, tokens_used, started_at, \
     last_activity, turn_count, context_remaining_json, summary_json, summary_path, \
     inflight_ref, predecessor_session_id, created_at, updated_at";

const HANDOFF_COLUMNS: &str = "predecessor_id, successor_id, handoff_seq, state, correlation_id, \
     checkpoint_seq, summary_path, failure_reason, created_at, updated_at";

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
                    worktree_branch, worktree_path, repo_path, status, cost, tokens_used,
                    started_at, last_activity, turn_count, context_remaining_json,
                    summary_json, summary_path, inflight_ref, predecessor_session_id,
                    created_at, updated_at
                 ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21,?22)
                 ON CONFLICT(logical_session_id, checkpoint_seq) DO UPDATE SET
                    pty_id = excluded.pty_id,
                    cli = excluded.cli,
                    model = excluded.model,
                    cwd = excluded.cwd,
                    worktree_branch = excluded.worktree_branch,
                    worktree_path = excluded.worktree_path,
                    repo_path = excluded.repo_path,
                    status = excluded.status,
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

    pub fn insert_or_get_handoff(
        db: &Database,
        handoff: &SessionHandoffRecord,
    ) -> Result<SessionHandoffRecord, String> {
        validate_handoff(handoff)?;
        db.conn()
            .execute(
                "INSERT INTO session_handoffs (
                    predecessor_id, successor_id, handoff_seq, state, correlation_id,
                    checkpoint_seq, summary_path, failure_reason, created_at, updated_at
                 ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)
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
                ],
            )
            .map_err(|e| {
                format!(
                    "insert session handoff {}#{}: {e}",
                    handoff.predecessor_id, handoff.handoff_seq
                )
            })?;
        Self::get_handoff(db, &handoff.predecessor_id, handoff.handoff_seq)?.ok_or_else(|| {
            format!(
                "session handoff {}#{} vanished after insert",
                handoff.predecessor_id, handoff.handoff_seq
            )
        })
    }

    pub fn get_handoff(
        db: &Database,
        predecessor_id: &str,
        handoff_seq: u64,
    ) -> Result<Option<SessionHandoffRecord>, String> {
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
        raw.map(raw_handoff_into_record).transpose()
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
        let changed = db
            .conn()
            .execute(
                "UPDATE session_handoffs
                 SET state = ?3,
                     checkpoint_seq = COALESCE(?4, checkpoint_seq),
                     summary_path = COALESCE(?5, summary_path),
                     failure_reason = ?6,
                     updated_at = ?7
                 WHERE predecessor_id = ?1 AND handoff_seq = ?2",
                params![
                    predecessor_id,
                    handoff_seq,
                    state.as_str(),
                    checkpoint_seq,
                    summary_path,
                    failure_reason,
                    now,
                ],
            )
            .map_err(|e| {
                format!("set session handoff {predecessor_id}#{handoff_seq} state: {e}")
            })?;
        if changed == 1 {
            Ok(())
        } else {
            Err(format!(
                "session handoff not found: {predecessor_id}#{handoff_seq}"
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
        cost: row.10,
        tokens_used: nonnegative_u64("tokens_used", row.11)?,
        started_at: nonnegative_u64("started_at", row.12)?,
        last_activity: nonnegative_u64("last_activity", row.13)?,
        turn_count: nonnegative_u64("turn_count", row.14)?,
        context_remaining: parse_json_opt("context_remaining_json", row.15)?,
        summary_json: parse_json_opt("summary_json", row.16)?,
        summary_path: row.17,
        inflight_ref: row.18,
        predecessor_session_id: row.19,
        created_at: nonnegative_u64("created_at", row.20)?,
        updated_at: nonnegative_u64("updated_at", row.21)?,
    })
}

fn raw_handoff_into_record(row: RawHandoffRow) -> Result<SessionHandoffRecord, String> {
    Ok(SessionHandoffRecord {
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
    })
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
    fn handoff_intent_is_idempotent_and_stateful() {
        let db = Database::open_memory().unwrap();
        let first = SessionCheckpointRepo::insert_or_get_handoff(&db, &handoff(1)).unwrap();
        let mut duplicate = handoff(1);
        duplicate.successor_id = "different-successor".to_string();
        let stored = SessionCheckpointRepo::insert_or_get_handoff(&db, &duplicate).unwrap();
        assert_eq!(first.successor_id, stored.successor_id);

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
        SessionCheckpointRepo::insert_or_get_handoff(&db, &handoff(1)).unwrap();
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
}
