//! `MergeRepo` — durable persistence for P0-3 merge intents.
//!
//! The SQLite `merge_intents` table is the SOURCE OF TRUTH for the operator/MCP
//! merge approval path. The merge-defining columns are immutable (enforced by an
//! `UPDATE` trigger in the migration), so an approver can only reference an intent
//! by id — never re-point the merge. The state transition that CLAIMS a merge is a
//! conditional `UPDATE` (compare-and-swap): the row, not any in-memory copy, is the
//! arbiter, so a claim survives restarts and serializes across callers.

use rusqlite::params;
use std::str::FromStr;

use crate::db::Database;
use crate::merge_intent::{MergeIntent, MergeIntentState};

/// Raw columns of one `merge_intents` row, before the `state` enum is parsed
/// (parsing happens outside the rusqlite closure so a bad value surfaces as
/// `String`, not a panic).
struct RawMergeRow {
    intent_id: String,
    repo_path: String,
    source_branch: String,
    target_branch: String,
    source_oid: String,
    target_oid: String,
    merge_base_oid: Option<String>,
    task_id: String,
    created_at: i64,
    state: String,
    updated_at: i64,
    session_id: Option<String>,
    reviewer_id: Option<String>,
    gates_digest: Option<String>,
}

const COLUMNS: &str = "intent_id, repo_path, source_branch, target_branch, \
     source_oid, target_oid, merge_base_oid, task_id, created_at, state, \
     updated_at, session_id, reviewer_id, gates_digest";

impl RawMergeRow {
    fn from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Self> {
        Ok(Self {
            intent_id: row.get(0)?,
            repo_path: row.get(1)?,
            source_branch: row.get(2)?,
            target_branch: row.get(3)?,
            source_oid: row.get(4)?,
            target_oid: row.get(5)?,
            merge_base_oid: row.get(6)?,
            task_id: row.get(7)?,
            created_at: row.get(8)?,
            state: row.get(9)?,
            updated_at: row.get(10)?,
            session_id: row.get(11)?,
            reviewer_id: row.get(12)?,
            gates_digest: row.get(13)?,
        })
    }

    fn into_intent(self) -> Result<MergeIntent, String> {
        Ok(MergeIntent {
            state: MergeIntentState::from_str(&self.state)
                .map_err(|e| format!("merge intent {}: {e}", self.intent_id))?,
            intent_id: self.intent_id,
            repo_path: self.repo_path,
            source_branch: self.source_branch,
            target_branch: self.target_branch,
            source_oid: self.source_oid,
            target_oid: self.target_oid,
            merge_base_oid: self.merge_base_oid,
            task_id: self.task_id,
            created_at: self.created_at,
            updated_at: self.updated_at,
            session_id: self.session_id,
            reviewer_id: self.reviewer_id,
            gates_digest: self.gates_digest,
        })
    }
}

pub struct MergeRepo;

impl MergeRepo {
    /// Insert a new intent, or return the EXISTING intent if one already holds the
    /// same idempotency key `(task_id, source_oid, target_oid)`. The duplicate
    /// request resolves to the original — no second row, no second merge claim.
    pub fn insert_or_get(db: &Database, intent: &MergeIntent) -> Result<MergeIntent, String> {
        let conn = db.conn();
        // `DO NOTHING` on the idempotency index: a duplicate request is a no-op
        // insert; we then read back whichever row owns the key (mine or the prior).
        conn.execute(
            "INSERT INTO merge_intents (
                 intent_id, repo_path, source_branch, target_branch,
                 source_oid, target_oid, merge_base_oid, task_id, created_at,
                 state, updated_at, session_id, reviewer_id, gates_digest
             ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14)
             ON CONFLICT(task_id, source_oid, target_oid) DO NOTHING",
            params![
                intent.intent_id,
                intent.repo_path,
                intent.source_branch,
                intent.target_branch,
                intent.source_oid,
                intent.target_oid,
                intent.merge_base_oid,
                intent.task_id,
                intent.created_at,
                intent.state.as_str(),
                intent.updated_at,
                intent.session_id,
                intent.reviewer_id,
                intent.gates_digest,
            ],
        )
        .map_err(|e| format!("insert merge intent {}: {e}", intent.intent_id))?;

        Self::get_by_key(db, &intent.task_id, &intent.source_oid, &intent.target_oid)?
            .ok_or_else(|| format!("merge intent {} vanished after insert", intent.intent_id))
    }

    /// Look up an intent by its id.
    pub fn get(db: &Database, intent_id: &str) -> Result<Option<MergeIntent>, String> {
        let sql = format!("SELECT {COLUMNS} FROM merge_intents WHERE intent_id = ?1");
        let raw = db
            .conn()
            .query_row(&sql, params![intent_id], RawMergeRow::from_row)
            .map(Some)
            .or_else(|e| match e {
                rusqlite::Error::QueryReturnedNoRows => Ok(None),
                other => Err(format!("load merge intent {intent_id}: {other}")),
            })?;
        raw.map(RawMergeRow::into_intent).transpose()
    }

    /// Look up the intent that owns an idempotency key, if any.
    pub fn get_by_key(
        db: &Database,
        task_id: &str,
        source_oid: &str,
        target_oid: &str,
    ) -> Result<Option<MergeIntent>, String> {
        let sql = format!(
            "SELECT {COLUMNS} FROM merge_intents \
             WHERE task_id = ?1 AND source_oid = ?2 AND target_oid = ?3"
        );
        let raw = db
            .conn()
            .query_row(
                &sql,
                params![task_id, source_oid, target_oid],
                RawMergeRow::from_row,
            )
            .map(Some)
            .or_else(|e| match e {
                rusqlite::Error::QueryReturnedNoRows => Ok(None),
                other => Err(format!("load merge intent by key: {other}")),
            })?;
        raw.map(RawMergeRow::into_intent).transpose()
    }

    /// Compare-and-swap the claim into `merging`: succeeds (returns `true`) ONLY if
    /// the row is still claimable (`queued`/`ready_to_merge`). A losing racer (or a
    /// terminal/already-merging row) gets `false`. This conditional `UPDATE` — not
    /// any in-memory check — is the merge claim arbiter (hard boundary #5).
    pub fn claim_for_merge(db: &Database, intent_id: &str, now: i64) -> Result<bool, String> {
        let changed = db
            .conn()
            .execute(
                "UPDATE merge_intents SET state = 'merging', updated_at = ?2 \
                 WHERE intent_id = ?1 AND state IN ('queued','ready_to_merge')",
                params![intent_id, now],
            )
            .map_err(|e| format!("claim merge intent {intent_id}: {e}"))?;
        Ok(changed == 1)
    }

    /// Move an intent to a new lifecycle state (the terminal/attention write after
    /// a merge attempt). The immutable-column trigger guarantees this can only
    /// touch `state`/`updated_at`.
    pub fn set_state(
        db: &Database,
        intent_id: &str,
        state: MergeIntentState,
        now: i64,
    ) -> Result<(), String> {
        let changed = db
            .conn()
            .execute(
                "UPDATE merge_intents SET state = ?2, updated_at = ?3 WHERE intent_id = ?1",
                params![intent_id, state.as_str(), now],
            )
            .map_err(|e| format!("set merge intent {intent_id} state: {e}"))?;
        if changed == 1 {
            Ok(())
        } else {
            Err(format!("merge intent not found: {intent_id}"))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn intent(intent_id: &str, task: &str, src_oid: &str, tgt_oid: &str) -> MergeIntent {
        MergeIntent {
            intent_id: intent_id.to_string(),
            repo_path: "C:/repo".to_string(),
            source_branch: "agent/feature".to_string(),
            target_branch: "main".to_string(),
            source_oid: src_oid.to_string(),
            target_oid: tgt_oid.to_string(),
            merge_base_oid: Some("base0".to_string()),
            task_id: task.to_string(),
            created_at: 1000,
            state: MergeIntentState::Queued,
            updated_at: 1000,
            session_id: Some("agent-1".to_string()),
            reviewer_id: None,
            gates_digest: None,
        }
    }

    #[test]
    fn insert_then_get_round_trips_every_column() {
        let db = Database::open_memory().unwrap();
        let i = intent("m1", "task-1", "src111", "tgt111");
        let stored = MergeRepo::insert_or_get(&db, &i).unwrap();
        assert_eq!(stored, i);
        let loaded = MergeRepo::get(&db, "m1").unwrap().unwrap();
        assert_eq!(loaded, i);
        assert!(MergeRepo::get(&db, "ghost").unwrap().is_none());
    }

    #[test]
    fn duplicate_idempotency_key_returns_the_original_intent() {
        let db = Database::open_memory().unwrap();
        let first =
            MergeRepo::insert_or_get(&db, &intent("m1", "task-1", "srcAAA", "tgtBBB")).unwrap();
        // A SECOND request for the same (task, source_oid, target_oid) — even with a
        // fresh intent id — must resolve to the FIRST intent, not create a new row.
        let second = MergeRepo::insert_or_get(
            &db,
            &intent("m2-different-id", "task-1", "srcAAA", "tgtBBB"),
        )
        .unwrap();
        assert_eq!(second.intent_id, "m1", "duplicate resolves to the original");
        assert_eq!(first, second);
        // A different target commit is a DIFFERENT intent.
        let other =
            MergeRepo::insert_or_get(&db, &intent("m3", "task-1", "srcAAA", "tgtCCC")).unwrap();
        assert_eq!(other.intent_id, "m3");
    }

    #[test]
    fn claim_is_a_compare_and_swap_only_one_winner() {
        let db = Database::open_memory().unwrap();
        MergeRepo::insert_or_get(&db, &intent("m1", "task-1", "s", "t")).unwrap();
        // First claim wins.
        assert!(MergeRepo::claim_for_merge(&db, "m1", 2000).unwrap());
        assert_eq!(
            MergeRepo::get(&db, "m1").unwrap().unwrap().state,
            MergeIntentState::Merging
        );
        // Second claim on the now-`merging` row loses (not claimable).
        assert!(!MergeRepo::claim_for_merge(&db, "m1", 2001).unwrap());
        // A terminal row is never claimable.
        MergeRepo::set_state(&db, "m1", MergeIntentState::Merged, 3000).unwrap();
        assert!(!MergeRepo::claim_for_merge(&db, "m1", 3001).unwrap());
        // An unknown id is never claimable.
        assert!(!MergeRepo::claim_for_merge(&db, "ghost", 4000).unwrap());
    }

    #[test]
    fn immutable_columns_cannot_be_rewritten_via_set_state() {
        // The trigger must reject any UPDATE that touches a merge-defining column.
        // We can't go through set_state (it only writes state), so prove the trigger
        // directly: a raw UPDATE of target_branch must ABORT, while a state-only
        // UPDATE succeeds.
        let db = Database::open_memory().unwrap();
        MergeRepo::insert_or_get(&db, &intent("m1", "task-1", "s", "t")).unwrap();
        let conn = db.conn();
        let err = conn
            .execute(
                "UPDATE merge_intents SET target_branch = 'evil' WHERE intent_id = 'm1'",
                [],
            )
            .unwrap_err();
        assert!(
            err.to_string().contains("immutable"),
            "trigger should block immutable-column UPDATE, got: {err}"
        );
        // The merge target is unchanged.
        assert_eq!(
            MergeRepo::get(&db, "m1").unwrap().unwrap().target_branch,
            "main"
        );
        // State-only update is allowed.
        MergeRepo::set_state(&db, "m1", MergeIntentState::Rejected, 5000).unwrap();
        assert_eq!(
            MergeRepo::get(&db, "m1").unwrap().unwrap().state,
            MergeIntentState::Rejected
        );
    }

    /// The immutability guarantee must hold against EVERY write path, not just the
    /// repo's own methods: `INSERT OR REPLACE` (delete+reinsert), a NULL primary
    /// key (which slips past `<>`), a `merge_base_oid` flip between NULL and '',
    /// and an outright DELETE. All must be blocked at the DB layer (boundary #4).
    #[test]
    fn db_guards_block_replace_null_id_merge_base_flip_and_delete() {
        let db = Database::open_memory().unwrap();
        // Row A: concrete merge_base. Row B: NULL merge_base (same s/t, other task).
        MergeRepo::insert_or_get(&db, &intent("mA", "task-A", "s", "t")).unwrap();
        let mut b = intent("mB", "task-B", "s", "t");
        b.merge_base_oid = None;
        MergeRepo::insert_or_get(&db, &b).unwrap();
        let conn = db.conn();

        // 1. INSERT OR REPLACE cannot rewrite immutable columns: REPLACE deletes the
        //    conflicting row first, which the append-only DELETE guard aborts (so the
        //    UPDATE trigger can't be sidestepped via delete+reinsert).
        let replace = conn.execute(
            "INSERT OR REPLACE INTO merge_intents
                (intent_id, repo_path, source_branch, target_branch, source_oid,
                 target_oid, merge_base_oid, task_id, created_at, state, updated_at)
             VALUES ('mA','EVIL','evil_src','evil_tgt','s','t',NULL,'task-A',1,'queued',1)",
            [],
        );
        assert!(replace.is_err(), "INSERT OR REPLACE must be blocked");
        assert_eq!(
            MergeRepo::get(&db, "mA").unwrap().unwrap().repo_path,
            "C:/repo",
            "the merge target survived the REPLACE attempt"
        );

        // 2. Nulling the PRIMARY KEY bypasses `<>` (NULL <> x is NULL); `IS NOT`
        //    must still catch it.
        let null_id = conn.execute(
            "UPDATE merge_intents SET intent_id=NULL WHERE intent_id='mA'",
            [],
        );
        assert!(
            null_id.is_err() && null_id.unwrap_err().to_string().contains("immutable"),
            "nulling the intent_id must be blocked"
        );

        // 3. merge_base_oid NULL->'' and a concrete change are both real changes the
        //    null-safe `IS NOT` must reject (IFNULL coalescing would have let NULL->''
        //    through).
        for sql in [
            "UPDATE merge_intents SET merge_base_oid='' WHERE intent_id='mB'", // NULL -> ''
            "UPDATE merge_intents SET merge_base_oid='x' WHERE intent_id='mA'", // base0 -> x
        ] {
            assert!(conn.execute(sql, []).is_err(), "must be blocked: {sql}");
        }
        assert!(MergeRepo::get(&db, "mB")
            .unwrap()
            .unwrap()
            .merge_base_oid
            .is_none());

        // 4. A merge intent is permanent — it can never be deleted.
        assert!(conn
            .execute("DELETE FROM merge_intents WHERE intent_id='mA'", [])
            .is_err());
    }
}
