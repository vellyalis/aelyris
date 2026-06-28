//! `OwnershipRepo` — durable active file/symbol ownership projection.
//!
//! The pure ownership cores stay I/O-free. This repo owns the SQLite schema
//! boundary for restart restore and write-through persistence of active claims.

use rusqlite::params;
#[cfg(test)]
use rusqlite::OptionalExtension;

use crate::db::Database;
use crate::file_ownership::OwnershipClaim;
use crate::symbol_ownership::{ClaimMode, Confidence, SymbolClaim, SymbolRange};

pub struct OwnershipRepo;

fn u64_to_i64(value: u64) -> i64 {
    i64::try_from(value).unwrap_or(i64::MAX)
}

fn i64_to_u64(field: &str, value: i64) -> Result<u64, String> {
    u64::try_from(value).map_err(|_| format!("{field} must be non-negative: {value}"))
}

fn i64_to_u32(field: &str, value: i64) -> Result<u32, String> {
    u32::try_from(value).map_err(|_| format!("{field} out of range: {value}"))
}

fn mode_as_str(mode: ClaimMode) -> &'static str {
    match mode {
        ClaimMode::Write => "write",
        ClaimMode::Review => "review",
        ClaimMode::Test => "test",
        ClaimMode::Read => "read",
    }
}

fn parse_mode(value: &str) -> Result<ClaimMode, String> {
    match value {
        "write" => Ok(ClaimMode::Write),
        "review" => Ok(ClaimMode::Review),
        "test" => Ok(ClaimMode::Test),
        "read" => Ok(ClaimMode::Read),
        other => Err(format!("unknown symbol ownership mode: {other}")),
    }
}

fn confidence_as_str(confidence: Confidence) -> &'static str {
    match confidence {
        Confidence::Lsp => "lsp",
        Confidence::Parser => "parser",
        Confidence::DiffHunk => "diff-hunk",
    }
}

fn parse_confidence(value: &str) -> Result<Confidence, String> {
    match value {
        "lsp" => Ok(Confidence::Lsp),
        "parser" => Ok(Confidence::Parser),
        "diff-hunk" => Ok(Confidence::DiffHunk),
        other => Err(format!("unknown symbol ownership confidence: {other}")),
    }
}

impl OwnershipRepo {
    pub fn load_file_claims(db: &Database, now: u64) -> Result<Vec<OwnershipClaim>, String> {
        Self::prune_expired(db, now)?;
        let mut stmt = db
            .conn()
            .prepare(
                "SELECT task_id, agent_id, pattern, lease_expires_at
                 FROM file_ownership_claims
                 ORDER BY updated_at ASC, claim_id ASC",
            )
            .map_err(|e| format!("prepare load file ownership claims: {e}"))?;
        let rows = stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, Option<String>>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, Option<i64>>(3)?,
                ))
            })
            .map_err(|e| format!("query file ownership claims: {e}"))?;

        let mut claims = Vec::new();
        for row in rows {
            let (task_id, agent_id, pattern, lease_expires_at) =
                row.map_err(|e| format!("read file ownership row: {e}"))?;
            claims.push(OwnershipClaim {
                task_id,
                agent_id,
                pattern,
                lease_expires_at: lease_expires_at
                    .map(|value| i64_to_u64("file lease_expires_at", value))
                    .transpose()?,
            });
        }
        Ok(claims)
    }

    pub fn upsert_file_claim(
        db: &Database,
        claim: &OwnershipClaim,
        now: u64,
    ) -> Result<(), String> {
        db.conn()
            .execute(
                "INSERT INTO file_ownership_claims (
                    claim_id, task_id, agent_id, pattern, lease_expires_at, updated_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
                 ON CONFLICT(claim_id) DO UPDATE SET
                    task_id = excluded.task_id,
                    agent_id = excluded.agent_id,
                    pattern = excluded.pattern,
                    lease_expires_at = excluded.lease_expires_at,
                    updated_at = excluded.updated_at",
                params![
                    claim.stable_id(),
                    claim.task_id,
                    claim.agent_id,
                    claim.pattern,
                    claim.lease_expires_at.map(u64_to_i64),
                    u64_to_i64(now),
                ],
            )
            .map(|_| ())
            .map_err(|e| format!("upsert file ownership claim {}: {e}", claim.stable_id()))
    }

    pub fn delete_file_claim(db: &Database, agent_id: &str, pattern: &str) -> Result<bool, String> {
        let changed = db
            .conn()
            .execute(
                "DELETE FROM file_ownership_claims
                 WHERE agent_id = ?1 AND pattern = ?2",
                params![agent_id, pattern],
            )
            .map_err(|e| format!("delete file ownership claim: {e}"))?;
        Ok(changed > 0)
    }

    pub fn delete_file_claims_for_task(db: &Database, task_id: &str) -> Result<usize, String> {
        db.conn()
            .execute(
                "DELETE FROM file_ownership_claims WHERE task_id = ?1",
                params![task_id],
            )
            .map_err(|e| format!("delete file ownership claims for task {task_id}: {e}"))
    }

    pub fn load_symbol_claims(db: &Database, now: u64) -> Result<Vec<SymbolClaim>, String> {
        Self::prune_expired(db, now)?;
        let mut stmt = db
            .conn()
            .prepare(
                "SELECT claim_id, agent_id, task_id, path, symbol, start_line, end_line,
                        mode, confidence, lease_expires_at
                 FROM symbol_ownership_claims
                 ORDER BY updated_at ASC, claim_id ASC",
            )
            .map_err(|e| format!("prepare load symbol ownership claims: {e}"))?;
        let rows = stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, Option<String>>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, i64>(5)?,
                    row.get::<_, i64>(6)?,
                    row.get::<_, String>(7)?,
                    row.get::<_, String>(8)?,
                    row.get::<_, i64>(9)?,
                ))
            })
            .map_err(|e| format!("query symbol ownership claims: {e}"))?;

        let mut claims = Vec::new();
        for row in rows {
            let (
                claim_id,
                agent_id,
                task_id,
                path,
                symbol,
                start_line,
                end_line,
                mode,
                confidence,
                lease_expires_at,
            ) = row.map_err(|e| format!("read symbol ownership row: {e}"))?;
            claims.push(SymbolClaim {
                claim_id,
                agent_id,
                task_id,
                path,
                symbol,
                range: SymbolRange::new(
                    i64_to_u32("start_line", start_line)?,
                    i64_to_u32("end_line", end_line)?,
                ),
                mode: parse_mode(&mode)?,
                lease_expires_at: i64_to_u64("symbol lease_expires_at", lease_expires_at)?,
                confidence: parse_confidence(&confidence)?,
            });
        }
        Ok(claims)
    }

    pub fn upsert_symbol_claim(db: &Database, claim: &SymbolClaim, now: u64) -> Result<(), String> {
        db.conn()
            .execute(
                "INSERT INTO symbol_ownership_claims (
                    claim_id, agent_id, task_id, path, symbol, start_line, end_line,
                    mode, confidence, lease_expires_at, updated_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
                 ON CONFLICT(claim_id) DO UPDATE SET
                    agent_id = excluded.agent_id,
                    task_id = excluded.task_id,
                    path = excluded.path,
                    symbol = excluded.symbol,
                    start_line = excluded.start_line,
                    end_line = excluded.end_line,
                    mode = excluded.mode,
                    confidence = excluded.confidence,
                    lease_expires_at = excluded.lease_expires_at,
                    updated_at = excluded.updated_at",
                params![
                    claim.claim_id,
                    claim.agent_id,
                    claim.task_id,
                    claim.path,
                    claim.symbol,
                    claim.range.start_line,
                    claim.range.end_line,
                    mode_as_str(claim.mode),
                    confidence_as_str(claim.confidence),
                    u64_to_i64(claim.lease_expires_at),
                    u64_to_i64(now),
                ],
            )
            .map(|_| ())
            .map_err(|e| format!("upsert symbol ownership claim {}: {e}", claim.claim_id))
    }

    pub fn delete_symbol_claim(db: &Database, claim_id: &str) -> Result<bool, String> {
        let changed = db
            .conn()
            .execute(
                "DELETE FROM symbol_ownership_claims WHERE claim_id = ?1",
                params![claim_id],
            )
            .map_err(|e| format!("delete symbol ownership claim {claim_id}: {e}"))?;
        Ok(changed > 0)
    }

    pub fn delete_symbol_claims_for_task(db: &Database, task_id: &str) -> Result<usize, String> {
        db.conn()
            .execute(
                "DELETE FROM symbol_ownership_claims WHERE task_id = ?1",
                params![task_id],
            )
            .map_err(|e| format!("delete symbol ownership claims for task {task_id}: {e}"))
    }

    pub fn delete_symbol_claims_for_prefix(db: &Database, prefix: &str) -> Result<usize, String> {
        let like = format!("{}%", prefix.replace('%', "\\%").replace('_', "\\_"));
        db.conn()
            .execute(
                "DELETE FROM symbol_ownership_claims
                 WHERE claim_id LIKE ?1 ESCAPE '\\'",
                params![like],
            )
            .map_err(|e| format!("delete symbol ownership claims for prefix {prefix}: {e}"))
    }

    pub fn reconcile_symbol_claims(
        db: &Database,
        delete_claim_ids: &[String],
        delete_prefixes: &[String],
        upsert_claims: &[SymbolClaim],
        now: u64,
    ) -> Result<(), String> {
        db.conn()
            .execute_batch("BEGIN IMMEDIATE")
            .map_err(|e| format!("begin symbol ownership reconcile: {e}"))?;
        let result = (|| {
            for claim_id in delete_claim_ids {
                Self::delete_symbol_claim(db, claim_id)?;
            }
            for prefix in delete_prefixes {
                Self::delete_symbol_claims_for_prefix(db, prefix)?;
            }
            for claim in upsert_claims {
                Self::upsert_symbol_claim(db, claim, now)?;
            }
            Ok(())
        })();
        match result {
            Ok(()) => db
                .conn()
                .execute_batch("COMMIT")
                .map_err(|e| format!("commit symbol ownership reconcile: {e}")),
            Err(err) => {
                let _ = db.conn().execute_batch("ROLLBACK");
                Err(err)
            }
        }
    }

    pub fn prune_expired(db: &Database, now: u64) -> Result<usize, String> {
        let now = u64_to_i64(now);
        let file_deleted = db
            .conn()
            .execute(
                "DELETE FROM file_ownership_claims
                 WHERE lease_expires_at IS NOT NULL AND lease_expires_at < ?1",
                params![now],
            )
            .map_err(|e| format!("prune expired file ownership claims: {e}"))?;
        let symbol_deleted = db
            .conn()
            .execute(
                "DELETE FROM symbol_ownership_claims WHERE lease_expires_at < ?1",
                params![now],
            )
            .map_err(|e| format!("prune expired symbol ownership claims: {e}"))?;
        Ok(file_deleted + symbol_deleted)
    }

    #[cfg(test)]
    fn count_file_rows(db: &Database) -> Result<usize, String> {
        db.conn()
            .query_row("SELECT COUNT(*) FROM file_ownership_claims", [], |row| {
                row.get::<_, usize>(0)
            })
            .optional()
            .map(|value| value.unwrap_or(0))
            .map_err(|e| format!("count file ownership rows: {e}"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Database;
    use crate::file_ownership::FileOwnership;
    use crate::symbol_ownership::SymbolOwnership;

    fn symbol_claim(id: &str, task_id: Option<&str>, expires: u64) -> SymbolClaim {
        SymbolClaim {
            claim_id: id.to_string(),
            agent_id: "agent-a".to_string(),
            task_id: task_id.map(str::to_string),
            path: "src/auth/login.rs".to_string(),
            symbol: "login".to_string(),
            range: SymbolRange::new(10, 20),
            mode: ClaimMode::Write,
            lease_expires_at: expires,
            confidence: Confidence::Parser,
        }
    }

    #[test]
    fn file_claim_round_trip_dedupes_duplicate_claims() {
        let db = Database::open_memory().unwrap();
        let claim = OwnershipClaim::new("agent-a", "src/auth/**");
        OwnershipRepo::upsert_file_claim(&db, &claim, 10).unwrap();
        OwnershipRepo::upsert_file_claim(&db, &claim, 11).unwrap();

        let claims = OwnershipRepo::load_file_claims(&db, 12).unwrap();
        assert_eq!(claims.len(), 1);
        assert_eq!(claims[0].agent_id, "agent-a");
        assert_eq!(claims[0].pattern, "src/auth/**");
        assert_eq!(OwnershipRepo::count_file_rows(&db).unwrap(), 1);
    }

    #[test]
    fn expired_claims_are_pruned_before_restore() {
        let db = Database::open_memory().unwrap();
        let mut file = OwnershipClaim::new("agent-a", "src/old/**");
        file.lease_expires_at = Some(5);
        OwnershipRepo::upsert_file_claim(&db, &file, 1).unwrap();
        OwnershipRepo::upsert_symbol_claim(&db, &symbol_claim("s1", None, 5), 1).unwrap();

        assert_eq!(OwnershipRepo::load_file_claims(&db, 6).unwrap().len(), 0);
        assert_eq!(OwnershipRepo::load_symbol_claims(&db, 6).unwrap().len(), 0);
    }

    #[test]
    fn symbol_claim_round_trips_full_range_mode_and_confidence() {
        let db = Database::open_memory().unwrap();
        let claim = symbol_claim("s1", Some("task-a"), 50);
        OwnershipRepo::upsert_symbol_claim(&db, &claim, 10).unwrap();

        let restored = OwnershipRepo::load_symbol_claims(&db, 20).unwrap();
        assert_eq!(restored, vec![claim]);
    }

    #[test]
    fn release_for_task_removes_file_and_symbol_claims() {
        let db = Database::open_memory().unwrap();
        let mut file = OwnershipClaim::new("agent-a", "src/auth/**");
        file.task_id = Some("task-a".to_string());
        OwnershipRepo::upsert_file_claim(&db, &file, 10).unwrap();
        OwnershipRepo::upsert_symbol_claim(&db, &symbol_claim("s1", Some("task-a"), 50), 10)
            .unwrap();

        assert_eq!(
            OwnershipRepo::delete_file_claims_for_task(&db, "task-a").unwrap(),
            1
        );
        assert_eq!(
            OwnershipRepo::delete_symbol_claims_for_task(&db, "task-a").unwrap(),
            1
        );
        assert!(OwnershipRepo::load_file_claims(&db, 20).unwrap().is_empty());
        assert!(OwnershipRepo::load_symbol_claims(&db, 20)
            .unwrap()
            .is_empty());
    }

    #[test]
    fn fresh_owners_hydrate_from_same_database_like_restart() {
        let db = Database::open_memory().unwrap();
        let file_claim = OwnershipClaim::new("agent-a", "src/auth/**");
        let symbol_claim = symbol_claim("s1", Some("task-a"), 50);
        OwnershipRepo::upsert_file_claim(&db, &file_claim, 10).unwrap();
        OwnershipRepo::upsert_symbol_claim(&db, &symbol_claim, 10).unwrap();

        let mut file_owner = FileOwnership::new();
        file_owner.hydrate(OwnershipRepo::load_file_claims(&db, 20).unwrap());
        let mut symbol_owner = SymbolOwnership::new();
        symbol_owner.hydrate(OwnershipRepo::load_symbol_claims(&db, 20).unwrap(), 20);

        assert_eq!(file_owner.owner_of("src/auth/login.rs"), Some("agent-a"));
        assert_eq!(
            symbol_owner
                .live_claims(20)
                .into_iter()
                .map(|claim| claim.claim_id.as_str())
                .collect::<Vec<_>>(),
            vec!["s1"]
        );
    }
}
