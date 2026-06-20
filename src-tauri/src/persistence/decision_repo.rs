//! `DecisionRepo` — persistence for the Context Store (shared ADR).
//!
//! Maps `ContextStore`'s `BTreeMap<String, String>` onto the
//! `context_decisions` table (FR-1). `load_all` rebuilds the in-memory map on
//! startup; `upsert`/`delete` are write-through on each real change. The
//! `BTreeMap` re-orders deterministically on load, so we store rows unordered.

use std::collections::BTreeMap;

use rusqlite::params;

use crate::db::Database;

pub struct DecisionRepo;

impl DecisionRepo {
    /// Load every persisted decision into a fresh map (startup restore).
    pub fn load_all(db: &Database) -> Result<BTreeMap<String, String>, String> {
        let mut stmt = db
            .conn()
            .prepare("SELECT key, value FROM context_decisions")
            .map_err(|e| format!("Prepare load decisions: {}", e))?;
        let rows = stmt
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })
            .map_err(|e| format!("Query decisions: {}", e))?;
        let mut out = BTreeMap::new();
        for row in rows {
            let (key, value) = row.map_err(|e| format!("Read decision row: {}", e))?;
            out.insert(key, value);
        }
        Ok(out)
    }

    /// Insert or update a single decision (write-through on a real change).
    pub fn upsert(db: &Database, key: &str, value: &str) -> Result<(), String> {
        db.conn()
            .execute(
                "INSERT INTO context_decisions (key, value, updated_at)
                 VALUES (?1, ?2, datetime('now'))
                 ON CONFLICT(key) DO UPDATE SET
                     value = excluded.value,
                     updated_at = excluded.updated_at",
                params![key, value],
            )
            .map(|_| ())
            .map_err(|e| format!("Upsert decision: {}", e))
    }

    /// Remove a decision (write-through on a real removal).
    pub fn delete(db: &Database, key: &str) -> Result<(), String> {
        db.conn()
            .execute("DELETE FROM context_decisions WHERE key = ?1", params![key])
            .map(|_| ())
            .map_err(|e| format!("Delete decision: {}", e))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn upsert_then_load_round_trips() {
        let db = Database::open_memory().unwrap();
        DecisionRepo::upsert(&db, "auth_method", "jwt").unwrap();
        DecisionRepo::upsert(&db, "database", "postgresql").unwrap();
        let all = DecisionRepo::load_all(&db).unwrap();
        assert_eq!(all.get("auth_method").map(String::as_str), Some("jwt"));
        assert_eq!(all.get("database").map(String::as_str), Some("postgresql"));
        assert_eq!(all.len(), 2);
    }

    #[test]
    fn upsert_overwrites_existing_value() {
        let db = Database::open_memory().unwrap();
        DecisionRepo::upsert(&db, "framework", "remix").unwrap();
        DecisionRepo::upsert(&db, "framework", "nextjs").unwrap();
        let all = DecisionRepo::load_all(&db).unwrap();
        assert_eq!(all.get("framework").map(String::as_str), Some("nextjs"));
        assert_eq!(all.len(), 1);
    }

    #[test]
    fn delete_removes_decision() {
        let db = Database::open_memory().unwrap();
        DecisionRepo::upsert(&db, "cache", "redis").unwrap();
        DecisionRepo::delete(&db, "cache").unwrap();
        assert!(DecisionRepo::load_all(&db).unwrap().is_empty());
        // Deleting a missing key is a no-op, not an error.
        DecisionRepo::delete(&db, "cache").unwrap();
    }
}
