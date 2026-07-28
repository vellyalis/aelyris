//! Durable WorkExecutionAttempt repository for A4.9.
//!
//! `TaskManager` is the domain owner; this repository is its SQLite adapter.
//! Every external-effect lane first reserves an immutable execution identity,
//! then advances the current fence with a generation-and-revision CAS. A stale
//! process therefore cannot publish a late result into a newer attempt.

use std::str::FromStr;

use rusqlite::{params, OptionalExtension, Row};
use uuid::Uuid;

use crate::db::Database;
use crate::task::{
    ExecutionEffect, ExecutionFence, ExecutionFenceError, ExecutionFenceState, ExecutionIdentity,
    ExecutionReservation, ExecutionRuntime, ExecutionToken, WorkExecutionAttempt,
    WorkExecutionState,
};

struct RawAttempt {
    attempt_id: String,
    task_id: String,
    execution_generation: i64,
    runtime: String,
    agent_run_id: String,
    process_generation: i64,
    session_id: String,
    pty_session_id: Option<String>,
    state: String,
    fence_effect: String,
    fence_state: String,
    fence_revision: i64,
    ownership_claim_ids_json: String,
    reservation_event_id: String,
    merge_intent_id: Option<String>,
    last_error: Option<String>,
    created_at: i64,
    updated_at: i64,
}

impl RawAttempt {
    fn from_row(row: &Row<'_>) -> rusqlite::Result<Self> {
        Ok(Self {
            attempt_id: row.get(0)?,
            task_id: row.get(1)?,
            execution_generation: row.get(2)?,
            runtime: row.get(3)?,
            agent_run_id: row.get(4)?,
            process_generation: row.get(5)?,
            session_id: row.get(6)?,
            pty_session_id: row.get(7)?,
            state: row.get(8)?,
            fence_effect: row.get(9)?,
            fence_state: row.get(10)?,
            fence_revision: row.get(11)?,
            ownership_claim_ids_json: row.get(12)?,
            reservation_event_id: row.get(13)?,
            merge_intent_id: row.get(14)?,
            last_error: row.get(15)?,
            created_at: row.get(16)?,
            updated_at: row.get(17)?,
        })
    }

    fn into_attempt(self) -> Result<WorkExecutionAttempt, ExecutionFenceError> {
        let positive = |field: &'static str, value: i64| {
            u64::try_from(value).map_err(|_| {
                ExecutionFenceError::Persistence(format!(
                    "invalid {field} {value} in work_execution_attempts"
                ))
            })
        };
        let require_uuid_v7 = |field: &'static str, value: &str| {
            let parsed = Uuid::parse_str(value).map_err(|error| {
                ExecutionFenceError::Persistence(format!(
                    "invalid {field} UUID in work_execution_attempts: {error}"
                ))
            })?;
            if parsed.get_version_num() != 7 || parsed.hyphenated().to_string() != value {
                return Err(ExecutionFenceError::Persistence(format!(
                    "invalid {field} UUIDv7 identity in work_execution_attempts"
                )));
            }
            Ok(())
        };
        let runtime =
            ExecutionRuntime::from_str(&self.runtime).map_err(ExecutionFenceError::Persistence)?;
        require_uuid_v7("attempt_id", &self.attempt_id)?;
        require_uuid_v7("agent_run_id", &self.agent_run_id)?;
        require_uuid_v7("session_id", &self.session_id)?;
        require_uuid_v7("reservation_event_id", &self.reservation_event_id)?;
        match (runtime, self.pty_session_id.as_deref()) {
            (ExecutionRuntime::VisiblePty, Some(pty_session_id)) => {
                require_uuid_v7("pty_session_id", pty_session_id)?;
            }
            (ExecutionRuntime::VisiblePty, None) => {
                return Err(ExecutionFenceError::Persistence(
                    "visible_pty execution is missing pty_session_id in work_execution_attempts"
                        .to_string(),
                ));
            }
            (ExecutionRuntime::Headless, Some(_)) => {
                return Err(ExecutionFenceError::Persistence(
                    "headless execution has pty_session_id in work_execution_attempts".to_string(),
                ));
            }
            (ExecutionRuntime::Headless, None) => {}
        }
        Ok(WorkExecutionAttempt {
            identity: ExecutionIdentity {
                attempt_id: self.attempt_id,
                task_id: self.task_id,
                execution_generation: positive("execution_generation", self.execution_generation)?,
                agent_run_id: self.agent_run_id,
                process_generation: positive("process_generation", self.process_generation)?,
                session_id: self.session_id,
                pty_session_id: self.pty_session_id,
            },
            runtime,
            state: WorkExecutionState::from_str(&self.state)
                .map_err(ExecutionFenceError::Persistence)?,
            fence: ExecutionFence {
                effect: ExecutionEffect::from_str(&self.fence_effect)
                    .map_err(ExecutionFenceError::Persistence)?,
                state: ExecutionFenceState::from_str(&self.fence_state)
                    .map_err(ExecutionFenceError::Persistence)?,
                revision: positive("fence_revision", self.fence_revision)?,
            },
            ownership_claim_ids: serde_json::from_str(&self.ownership_claim_ids_json).map_err(
                |error| {
                    ExecutionFenceError::Persistence(format!(
                        "parse ownership claim identities: {error}"
                    ))
                },
            )?,
            reservation_event_id: self.reservation_event_id,
            merge_intent_id: self.merge_intent_id,
            last_error: self.last_error,
            created_at: positive("created_at", self.created_at)?,
            updated_at: positive("updated_at", self.updated_at)?,
        })
    }
}

const SELECT_COLUMNS: &str = "
    attempt_id, task_id, execution_generation, runtime,
    agent_run_id, process_generation, session_id, pty_session_id,
    state, fence_effect, fence_state, fence_revision,
    ownership_claim_ids_json, reservation_event_id, merge_intent_id,
    last_error, created_at, updated_at
";

pub struct WorkExecutionRepo;

impl WorkExecutionRepo {
    /// Reserve the next monotonic generation and all execution identities in one
    /// transaction. A new generation is allowed only after an explicit failure;
    /// unresolved and completed attempts fail closed.
    pub fn reserve(
        db: &Database,
        reservation: &ExecutionReservation,
    ) -> Result<WorkExecutionAttempt, ExecutionFenceError> {
        if reservation.task_id.trim().is_empty() {
            return Err(ExecutionFenceError::InvalidTransition(
                "task_id is required".to_string(),
            ));
        }
        if reservation
            .ownership_claim_ids
            .iter()
            .any(|id| id.trim().is_empty())
        {
            return Err(ExecutionFenceError::InvalidTransition(
                "ownership claim identities must be non-empty".to_string(),
            ));
        }

        let conn = db.conn();
        let tx = conn.unchecked_transaction().map_err(|error| {
            ExecutionFenceError::Persistence(format!("begin execution reservation: {error}"))
        })?;
        let result = (|| {
            let latest = tx
                .query_row(
                    &format!(
                        "SELECT {SELECT_COLUMNS}
                         FROM work_execution_attempts
                         WHERE task_id = ?1
                         ORDER BY execution_generation DESC
                         LIMIT 1"
                    ),
                    [&reservation.task_id],
                    RawAttempt::from_row,
                )
                .optional()
                .map_err(|error| {
                    ExecutionFenceError::Persistence(format!(
                        "read latest execution generation: {error}"
                    ))
                })?;

            let generation = if let Some(raw) = latest {
                let prior = raw.into_attempt()?;
                if !prior.state.allows_successor() {
                    return Err(ExecutionFenceError::ActiveAttempt {
                        task_id: reservation.task_id.clone(),
                        attempt_id: prior.identity.attempt_id,
                        state: prior.state.as_str().to_string(),
                    });
                }
                prior
                    .identity
                    .execution_generation
                    .checked_add(1)
                    .ok_or_else(|| {
                        ExecutionFenceError::Persistence(
                            "execution generation overflow".to_string(),
                        )
                    })?
            } else {
                1
            };

            let attempt_id = Uuid::now_v7().to_string();
            let agent_run_id = Uuid::now_v7().to_string();
            let session_id = Uuid::now_v7().to_string();
            let pty_session_id = matches!(reservation.runtime, ExecutionRuntime::VisiblePty)
                .then(|| Uuid::now_v7().to_string());
            let reservation_event_id = Uuid::now_v7().to_string();
            let claims_json =
                serde_json::to_string(&reservation.ownership_claim_ids).map_err(|error| {
                    ExecutionFenceError::Persistence(format!(
                        "serialize ownership claim identities: {error}"
                    ))
                })?;

            tx.execute(
                "INSERT INTO work_execution_attempts (
                     attempt_id, task_id, execution_generation, runtime,
                     agent_run_id, process_generation, session_id, pty_session_id,
                     state, fence_effect, fence_state, fence_revision,
                     ownership_claim_ids_json, reservation_event_id,
                     created_at, updated_at
                 ) VALUES (
                     ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8,
                     'reserved', 'reservation', 'reserved', 1,
                     ?9, ?10, ?11, ?11
                 )",
                params![
                    attempt_id,
                    reservation.task_id,
                    generation,
                    reservation.runtime.as_str(),
                    agent_run_id,
                    generation,
                    session_id,
                    pty_session_id,
                    claims_json,
                    reservation_event_id,
                    reservation.now,
                ],
            )
            .map_err(|error| {
                ExecutionFenceError::Persistence(format!("insert execution reservation: {error}"))
            })?;

            Self::current_for_task_tx(&tx, &reservation.task_id)?.ok_or_else(|| {
                ExecutionFenceError::Persistence(
                    "inserted execution reservation could not be reloaded".to_string(),
                )
            })
        })();

        match result {
            Ok(attempt) => {
                tx.commit().map_err(|error| {
                    ExecutionFenceError::Persistence(format!(
                        "commit execution reservation: {error}"
                    ))
                })?;
                Ok(attempt)
            }
            Err(error) => {
                let _ = tx.rollback();
                Err(error)
            }
        }
    }

    pub fn current_for_task(
        db: &Database,
        task_id: &str,
    ) -> Result<Option<WorkExecutionAttempt>, ExecutionFenceError> {
        Self::current_for_task_conn(db.conn(), task_id)
    }

    pub fn load_latest(db: &Database) -> Result<Vec<WorkExecutionAttempt>, ExecutionFenceError> {
        let mut statement = db
            .conn()
            .prepare(&format!(
                "SELECT {SELECT_COLUMNS}
                 FROM work_execution_attempts AS candidate
                 WHERE execution_generation = (
                     SELECT MAX(current.execution_generation)
                     FROM work_execution_attempts AS current
                     WHERE current.task_id = candidate.task_id
                 )
                 ORDER BY task_id"
            ))
            .map_err(|error| {
                ExecutionFenceError::Persistence(format!(
                    "prepare latest execution attempt load: {error}"
                ))
            })?;
        let rows = statement
            .query_map([], RawAttempt::from_row)
            .map_err(|error| {
                ExecutionFenceError::Persistence(format!(
                    "query latest execution attempts: {error}"
                ))
            })?;
        rows.map(|row| {
            row.map_err(|error| {
                ExecutionFenceError::Persistence(format!(
                    "read latest execution attempt row: {error}"
                ))
            })?
            .into_attempt()
        })
        .collect()
    }

    /// Advance the current attempt only when both generation identity and fence
    /// revision match. A late process from an older generation receives
    /// `StaleGeneration` even if the TaskGraph snapshot was never persisted.
    #[allow(clippy::too_many_arguments)]
    pub fn compare_and_swap(
        db: &Database,
        token: &ExecutionToken,
        expected_revision: u64,
        next_work_state: WorkExecutionState,
        next_effect: ExecutionEffect,
        next_fence_state: ExecutionFenceState,
        merge_intent_id: Option<&str>,
        last_error: Option<&str>,
        now: u64,
    ) -> Result<WorkExecutionAttempt, ExecutionFenceError> {
        let current = Self::current_for_task(db, &token.task_id)?
            .ok_or_else(|| ExecutionFenceError::NotFound(token.task_id.clone()))?;
        if current.identity.execution_generation != token.execution_generation
            || current.identity.attempt_id != token.attempt_id
        {
            return Err(ExecutionFenceError::StaleGeneration {
                task_id: token.task_id.clone(),
                attempted: token.execution_generation,
                current: current.identity.execution_generation,
            });
        }
        if current.fence.revision != expected_revision {
            return Err(ExecutionFenceError::InvalidTransition(format!(
                "expected fence revision {expected_revision}, current revision {}",
                current.fence.revision
            )));
        }
        Self::validate_transition(
            &current,
            next_work_state,
            next_effect,
            next_fence_state,
            merge_intent_id,
            now,
        )?;

        let next_revision = expected_revision.checked_add(1).ok_or_else(|| {
            ExecutionFenceError::Persistence("execution fence revision overflow".to_string())
        })?;
        let conn = db.conn();
        let changed = conn
            .execute(
                "UPDATE work_execution_attempts
                 SET state = ?1,
                     fence_effect = ?2,
                     fence_state = ?3,
                     fence_revision = ?4,
                     merge_intent_id = COALESCE(?5, merge_intent_id),
                     last_error = ?6,
                     updated_at = ?7
                 WHERE attempt_id = ?8
                   AND task_id = ?9
                   AND execution_generation = ?10
                   AND fence_revision = ?11
                   AND execution_generation = (
                       SELECT MAX(current.execution_generation)
                       FROM work_execution_attempts AS current
                       WHERE current.task_id = ?9
                   )",
                params![
                    next_work_state.as_str(),
                    next_effect.as_str(),
                    next_fence_state.as_str(),
                    next_revision,
                    merge_intent_id,
                    last_error,
                    now,
                    token.attempt_id,
                    token.task_id,
                    token.execution_generation,
                    expected_revision,
                ],
            )
            .map_err(|error| {
                ExecutionFenceError::Persistence(format!(
                    "advance execution fence with CAS: {error}"
                ))
            })?;

        if changed == 1 {
            return Self::current_for_task(db, &token.task_id)?.ok_or_else(|| {
                ExecutionFenceError::Persistence(
                    "advanced execution attempt could not be reloaded".to_string(),
                )
            });
        }

        match Self::current_for_task(db, &token.task_id)? {
            None => Err(ExecutionFenceError::NotFound(token.task_id.clone())),
            Some(current)
                if current.identity.execution_generation != token.execution_generation
                    || current.identity.attempt_id != token.attempt_id =>
            {
                Err(ExecutionFenceError::StaleGeneration {
                    task_id: token.task_id.clone(),
                    attempted: token.execution_generation,
                    current: current.identity.execution_generation,
                })
            }
            Some(current) => Err(ExecutionFenceError::InvalidTransition(format!(
                "expected fence revision {expected_revision}, current revision {}",
                current.fence.revision
            ))),
        }
    }

    fn validate_transition(
        current: &WorkExecutionAttempt,
        next_work_state: WorkExecutionState,
        next_effect: ExecutionEffect,
        next_fence_state: ExecutionFenceState,
        merge_intent_id: Option<&str>,
        now: u64,
    ) -> Result<(), ExecutionFenceError> {
        let invalid = |message: String| ExecutionFenceError::InvalidTransition(message);
        if now < current.updated_at {
            return Err(invalid(format!(
                "updated_at cannot regress from {} to {now}",
                current.updated_at
            )));
        }
        if merge_intent_id.is_some_and(|id| id.trim().is_empty()) {
            return Err(invalid(
                "merge intent identity must be non-empty".to_string(),
            ));
        }
        if matches!(
            current.state,
            WorkExecutionState::Completed | WorkExecutionState::NeedsReconcile
        ) {
            return Err(invalid(format!(
                "{} execution attempt is terminal",
                current.state.as_str()
            )));
        }
        if current.state == WorkExecutionState::Failed {
            return Err(invalid(
                "failed execution attempt can only be followed by a new generation".to_string(),
            ));
        }

        match current.fence.state {
            ExecutionFenceState::Reserved => {
                if next_effect != current.fence.effect {
                    return Err(invalid(
                        "a reserved fence cannot change its effect".to_string(),
                    ));
                }
                match next_fence_state {
                    ExecutionFenceState::EffectStarted => {
                        if next_work_state != current.state {
                            return Err(invalid(
                                "starting an effect cannot advance work state".to_string(),
                            ));
                        }
                    }
                    ExecutionFenceState::Committed => {
                        let expected = committed_work_state(next_effect);
                        if next_work_state != expected
                            && next_work_state != WorkExecutionState::Failed
                        {
                            return Err(invalid(format!(
                                "{} commit requires work state {} or failed",
                                next_effect.as_str(),
                                expected.as_str()
                            )));
                        }
                    }
                    ExecutionFenceState::NeedsReconcile => {
                        if next_work_state != WorkExecutionState::NeedsReconcile {
                            return Err(invalid(
                                "quarantined reserved fence must enter needs_reconcile".to_string(),
                            ));
                        }
                    }
                    ExecutionFenceState::Reserved => {
                        return Err(invalid(
                            "reserved fence must start or commit before advancing".to_string(),
                        ));
                    }
                }
            }
            ExecutionFenceState::EffectStarted => {
                if next_effect != current.fence.effect {
                    return Err(invalid(
                        "an effect_started fence cannot change its effect".to_string(),
                    ));
                }
                match next_fence_state {
                    ExecutionFenceState::Committed => {
                        let expected = committed_work_state(next_effect);
                        if next_work_state != expected {
                            return Err(invalid(format!(
                                "started {} effect must commit to {}, never {}",
                                next_effect.as_str(),
                                expected.as_str(),
                                next_work_state.as_str()
                            )));
                        }
                    }
                    ExecutionFenceState::NeedsReconcile => {
                        if next_work_state != WorkExecutionState::NeedsReconcile {
                            return Err(invalid(
                                "uncertain external effect must enter needs_reconcile".to_string(),
                            ));
                        }
                    }
                    ExecutionFenceState::Reserved | ExecutionFenceState::EffectStarted => {
                        return Err(invalid(
                            "effect_started fence must commit or enter needs_reconcile".to_string(),
                        ));
                    }
                }
            }
            ExecutionFenceState::Committed => {
                if next_effect == current.fence.effect
                    && next_fence_state == ExecutionFenceState::NeedsReconcile
                    && next_work_state == WorkExecutionState::NeedsReconcile
                {
                    // The effect itself is committed, but a required successor
                    // reservation/result projection could not be made durable.
                    // Quarantine instead of losing the one-shot observation.
                    return Ok(());
                }
                if next_effect == current.fence.effect
                    && next_fence_state == ExecutionFenceState::Committed
                    && next_work_state == WorkExecutionState::Failed
                {
                    // A process exit, rejected review, or other fully observed
                    // post-effect outcome may close the generation as failed.
                    return Ok(());
                }
                let expected_next =
                    next_execution_effect(current.fence.effect).ok_or_else(|| {
                        invalid(format!(
                            "{} is the final execution effect",
                            current.fence.effect.as_str()
                        ))
                    })?;
                if next_effect != expected_next
                    || next_fence_state != ExecutionFenceState::Reserved
                    || next_work_state != current.state
                {
                    return Err(invalid(format!(
                        "committed {} must reserve {} without advancing work state",
                        current.fence.effect.as_str(),
                        expected_next.as_str()
                    )));
                }
            }
            ExecutionFenceState::NeedsReconcile => {
                return Err(invalid(
                    "needs_reconcile fence is terminal until A4.10 reconciliation".to_string(),
                ));
            }
        }
        Ok(())
    }

    fn current_for_task_conn(
        conn: &rusqlite::Connection,
        task_id: &str,
    ) -> Result<Option<WorkExecutionAttempt>, ExecutionFenceError> {
        conn.query_row(
            &format!(
                "SELECT {SELECT_COLUMNS}
                 FROM work_execution_attempts
                 WHERE task_id = ?1
                 ORDER BY execution_generation DESC
                 LIMIT 1"
            ),
            [task_id],
            RawAttempt::from_row,
        )
        .optional()
        .map_err(|error| {
            ExecutionFenceError::Persistence(format!("read current execution attempt: {error}"))
        })?
        .map(RawAttempt::into_attempt)
        .transpose()
    }

    fn current_for_task_tx(
        tx: &rusqlite::Transaction<'_>,
        task_id: &str,
    ) -> Result<Option<WorkExecutionAttempt>, ExecutionFenceError> {
        tx.query_row(
            &format!(
                "SELECT {SELECT_COLUMNS}
                 FROM work_execution_attempts
                 WHERE task_id = ?1
                 ORDER BY execution_generation DESC
                 LIMIT 1"
            ),
            [task_id],
            RawAttempt::from_row,
        )
        .optional()
        .map_err(|error| {
            ExecutionFenceError::Persistence(format!(
                "read current execution attempt in transaction: {error}"
            ))
        })?
        .map(RawAttempt::into_attempt)
        .transpose()
    }
}

fn committed_work_state(effect: ExecutionEffect) -> WorkExecutionState {
    match effect {
        ExecutionEffect::Reservation | ExecutionEffect::FirstEffect => WorkExecutionState::Reserved,
        ExecutionEffect::Spawn => WorkExecutionState::Running,
        ExecutionEffect::Review => WorkExecutionState::Review,
        ExecutionEffect::CandidateFreeze | ExecutionEffect::Merge => WorkExecutionState::MergeReady,
        ExecutionEffect::Finalization => WorkExecutionState::Completed,
    }
}

fn next_execution_effect(effect: ExecutionEffect) -> Option<ExecutionEffect> {
    match effect {
        ExecutionEffect::Reservation => Some(ExecutionEffect::FirstEffect),
        ExecutionEffect::FirstEffect => Some(ExecutionEffect::Spawn),
        ExecutionEffect::Spawn => Some(ExecutionEffect::Review),
        ExecutionEffect::Review => Some(ExecutionEffect::CandidateFreeze),
        ExecutionEffect::CandidateFreeze => Some(ExecutionEffect::Merge),
        ExecutionEffect::Merge => Some(ExecutionEffect::Finalization),
        ExecutionEffect::Finalization => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn setup() -> Database {
        let db = Database::open_memory().unwrap();
        db.conn()
            .execute("INSERT INTO tasks (id, title) VALUES ('task-a', 'A')", [])
            .unwrap();
        db
    }

    fn reservation(now: u64) -> ExecutionReservation {
        ExecutionReservation {
            task_id: "task-a".to_string(),
            runtime: ExecutionRuntime::Headless,
            ownership_claim_ids: vec!["claim-a".to_string()],
            now,
        }
    }

    fn simulate_out_of_band_identity_corruption(db: &Database, field: &str, value: &str) {
        db.conn()
            .execute_batch("DROP TRIGGER trg_work_execution_attempts_identity_immutable;")
            .unwrap();
        db.conn()
            .execute(
                &format!(
                    "UPDATE work_execution_attempts SET {field} = ?1 WHERE task_id = 'task-a'"
                ),
                [value],
            )
            .unwrap();
    }

    #[test]
    fn reserve_persists_all_pre_effect_identities() {
        let db = setup();
        let attempt = WorkExecutionRepo::reserve(&db, &reservation(10)).unwrap();
        assert_eq!(attempt.identity.execution_generation, 1);
        assert_eq!(attempt.identity.process_generation, 1);
        assert!(!attempt.identity.agent_run_id.is_empty());
        assert!(!attempt.identity.session_id.is_empty());
        assert_eq!(attempt.identity.pty_session_id, None);
        assert_eq!(attempt.ownership_claim_ids, ["claim-a"]);
        assert_eq!(attempt.state, WorkExecutionState::Reserved);
        assert_eq!(attempt.fence.effect, ExecutionEffect::Reservation);
        assert_eq!(attempt.fence.state, ExecutionFenceState::Reserved);

        assert_eq!(
            WorkExecutionRepo::current_for_task(&db, "task-a")
                .unwrap()
                .unwrap(),
            attempt
        );
    }

    #[test]
    fn load_rejects_non_v7_or_noncanonical_generated_execution_identities() {
        for field in [
            "attempt_id",
            "agent_run_id",
            "session_id",
            "reservation_event_id",
        ] {
            let db = setup();
            WorkExecutionRepo::reserve(&db, &reservation(10)).unwrap();
            simulate_out_of_band_identity_corruption(&db, field, &Uuid::new_v4().to_string());

            let error = WorkExecutionRepo::current_for_task(&db, "task-a").unwrap_err();
            assert!(
                matches!(error, ExecutionFenceError::Persistence(message) if message.contains(field) && message.contains("UUIDv7")),
                "{field} corruption must fail closed"
            );
        }

        let db = setup();
        let attempt = WorkExecutionRepo::reserve(&db, &reservation(10)).unwrap();
        simulate_out_of_band_identity_corruption(
            &db,
            "attempt_id",
            &attempt.identity.attempt_id.to_uppercase(),
        );
        let error = WorkExecutionRepo::current_for_task(&db, "task-a").unwrap_err();
        assert!(
            matches!(error, ExecutionFenceError::Persistence(message) if message.contains("attempt_id") && message.contains("UUIDv7"))
        );
    }

    #[test]
    fn visible_execution_load_requires_canonical_uuid_v7_pty_identity() {
        let db = setup();
        let mut visible = reservation(10);
        visible.runtime = ExecutionRuntime::VisiblePty;
        let attempt = WorkExecutionRepo::reserve(&db, &visible).unwrap();
        assert!(attempt.identity.pty_session_id.is_some());

        simulate_out_of_band_identity_corruption(
            &db,
            "pty_session_id",
            &Uuid::new_v4().to_string(),
        );
        let error = WorkExecutionRepo::load_latest(&db).unwrap_err();
        assert!(
            matches!(error, ExecutionFenceError::Persistence(message) if message.contains("pty_session_id") && message.contains("UUIDv7"))
        );
    }

    #[test]
    fn unresolved_attempt_blocks_duplicate_external_effect_generation() {
        let db = setup();
        let first = WorkExecutionRepo::reserve(&db, &reservation(10)).unwrap();
        assert!(matches!(
            WorkExecutionRepo::reserve(&db, &reservation(11)),
            Err(ExecutionFenceError::ActiveAttempt {
                attempt_id,
                state,
                ..
            }) if attempt_id == first.identity.attempt_id && state == "reserved"
        ));
    }

    #[test]
    fn successor_is_monotonic_and_rejects_late_prior_generation() {
        let db = setup();
        let first = WorkExecutionRepo::reserve(&db, &reservation(10)).unwrap();
        let failed = WorkExecutionRepo::compare_and_swap(
            &db,
            &first.token(),
            first.fence.revision,
            WorkExecutionState::Failed,
            ExecutionEffect::Reservation,
            ExecutionFenceState::Committed,
            None,
            Some("spawn failed before child ownership"),
            11,
        )
        .unwrap();
        let second = WorkExecutionRepo::reserve(&db, &reservation(12)).unwrap();
        assert_eq!(second.identity.execution_generation, 2);

        assert_eq!(
            WorkExecutionRepo::compare_and_swap(
                &db,
                &failed.token(),
                failed.fence.revision,
                WorkExecutionState::Review,
                ExecutionEffect::Review,
                ExecutionFenceState::Committed,
                None,
                None,
                13,
            ),
            Err(ExecutionFenceError::StaleGeneration {
                task_id: "task-a".to_string(),
                attempted: 1,
                current: 2,
            })
        );
        assert_eq!(
            WorkExecutionRepo::current_for_task(&db, "task-a")
                .unwrap()
                .unwrap()
                .identity
                .attempt_id,
            second.identity.attempt_id
        );
    }

    #[test]
    fn compare_and_swap_rejects_duplicate_revision() {
        let db = setup();
        let first = WorkExecutionRepo::reserve(&db, &reservation(10)).unwrap();
        let reservation_committed = WorkExecutionRepo::compare_and_swap(
            &db,
            &first.token(),
            first.fence.revision,
            WorkExecutionState::Reserved,
            ExecutionEffect::Reservation,
            ExecutionFenceState::Committed,
            None,
            None,
            11,
        )
        .unwrap();
        WorkExecutionRepo::compare_and_swap(
            &db,
            &reservation_committed.token(),
            reservation_committed.fence.revision,
            WorkExecutionState::Reserved,
            ExecutionEffect::FirstEffect,
            ExecutionFenceState::Reserved,
            None,
            None,
            12,
        )
        .unwrap();
        assert!(matches!(
            WorkExecutionRepo::compare_and_swap(
                &db,
                &reservation_committed.token(),
                reservation_committed.fence.revision,
                WorkExecutionState::Running,
                ExecutionEffect::FirstEffect,
                ExecutionFenceState::EffectStarted,
                None,
                None,
                13,
            ),
            Err(ExecutionFenceError::InvalidTransition(message))
                if message.contains("current revision 3")
        ));
    }

    #[test]
    fn current_token_cannot_skip_effects_or_regress_timestamp() {
        let db = setup();
        let first = WorkExecutionRepo::reserve(&db, &reservation(10)).unwrap();
        assert!(matches!(
            WorkExecutionRepo::compare_and_swap(
                &db,
                &first.token(),
                first.fence.revision,
                WorkExecutionState::Completed,
                ExecutionEffect::Finalization,
                ExecutionFenceState::Committed,
                None,
                None,
                11,
            ),
            Err(ExecutionFenceError::InvalidTransition(message))
                if message.contains("cannot change its effect")
        ));
        assert!(matches!(
            WorkExecutionRepo::compare_and_swap(
                &db,
                &first.token(),
                first.fence.revision,
                WorkExecutionState::Reserved,
                ExecutionEffect::Reservation,
                ExecutionFenceState::EffectStarted,
                None,
                None,
                9,
            ),
            Err(ExecutionFenceError::InvalidTransition(message))
                if message.contains("updated_at cannot regress")
        ));
    }

    #[test]
    fn started_external_effect_cannot_be_closed_as_safe_failure() {
        let db = setup();
        let first = WorkExecutionRepo::reserve(&db, &reservation(10)).unwrap();
        let started = WorkExecutionRepo::compare_and_swap(
            &db,
            &first.token(),
            first.fence.revision,
            WorkExecutionState::Reserved,
            ExecutionEffect::Reservation,
            ExecutionFenceState::EffectStarted,
            None,
            None,
            11,
        )
        .unwrap();
        assert!(matches!(
            WorkExecutionRepo::compare_and_swap(
                &db,
                &started.token(),
                started.fence.revision,
                WorkExecutionState::Failed,
                ExecutionEffect::Reservation,
                ExecutionFenceState::Committed,
                None,
                Some("uncertain"),
                12,
            ),
            Err(ExecutionFenceError::InvalidTransition(message))
                if message.contains("never failed")
        ));
        let reconcile = WorkExecutionRepo::compare_and_swap(
            &db,
            &started.token(),
            started.fence.revision,
            WorkExecutionState::NeedsReconcile,
            ExecutionEffect::Reservation,
            ExecutionFenceState::NeedsReconcile,
            None,
            Some("effect outcome unknown"),
            12,
        )
        .unwrap();
        assert_eq!(reconcile.state, WorkExecutionState::NeedsReconcile);
    }

    #[test]
    fn reserved_and_committed_quarantine_are_terminal_and_never_reopen() {
        for committed in [false, true] {
            let db = setup();
            let first = WorkExecutionRepo::reserve(&db, &reservation(10)).unwrap();
            let current = if committed {
                WorkExecutionRepo::compare_and_swap(
                    &db,
                    &first.token(),
                    first.fence.revision,
                    WorkExecutionState::Reserved,
                    ExecutionEffect::Reservation,
                    ExecutionFenceState::Committed,
                    None,
                    None,
                    11,
                )
                .unwrap()
            } else {
                first
            };
            let quarantined = WorkExecutionRepo::compare_and_swap(
                &db,
                &current.token(),
                current.fence.revision,
                WorkExecutionState::NeedsReconcile,
                current.fence.effect,
                ExecutionFenceState::NeedsReconcile,
                None,
                Some("settlement durability unavailable"),
                12,
            )
            .unwrap();
            assert_eq!(quarantined.state, WorkExecutionState::NeedsReconcile);
            assert!(matches!(
                WorkExecutionRepo::compare_and_swap(
                    &db,
                    &quarantined.token(),
                    quarantined.fence.revision,
                    WorkExecutionState::Failed,
                    quarantined.fence.effect,
                    ExecutionFenceState::Committed,
                    None,
                    None,
                    13,
                ),
                Err(ExecutionFenceError::InvalidTransition(message))
                    if message.contains("terminal")
            ));
            assert!(matches!(
                WorkExecutionRepo::reserve(&db, &reservation(14)),
                Err(ExecutionFenceError::ActiveAttempt { .. })
            ));
        }
    }
}
