//! SQLite-backed vector store for command history embeddings.
//!
//! The design is intentionally simple: we keep `command_embeddings.vector`
//! as a little-endian f32 BLOB and perform cosine similarity in Rust on
//! load. The shell-history corpus is tiny (tens of thousands at the most),
//! so a brute-force scan is under 50 ms and avoids loading a sqlite
//! extension.

use std::sync::Mutex;

use rusqlite::{params, Connection};

use super::embedding::{cosine, Embedder};
use super::types::{HistoryEntry, SearchFilters, SearchHit};

/// Thread-safe wrapper over a dedicated connection to the Aether DB. A
/// separate connection (pointing at the same file) keeps embedding writes
/// off the main `ManagedDb` lock so PTY save paths stay non-blocking.
pub struct HistoryStore<E: Embedder> {
    conn: Mutex<Connection>,
    embedder: E,
}

impl<E: Embedder> HistoryStore<E> {
    pub fn open(conn: Connection, embedder: E) -> Self {
        Self {
            conn: Mutex::new(conn),
            embedder,
        }
    }

    pub fn embedder(&self) -> &E {
        &self.embedder
    }

    /// Embed + persist the vector for a single command_history row. Idempotent:
    /// re-indexing the same `command_id` overwrites the existing vector so a
    /// future model swap can backfill the whole table.
    pub fn index_command(&self, command_id: i64, text: &str) -> Result<(), String> {
        let vec = self.embedder.embed(text);
        if vec.iter().all(|v| *v == 0.0) {
            // Nothing to index (e.g. whitespace-only command).
            return Ok(());
        }
        let bytes = vec_to_bytes(&vec);
        let dim = vec.len() as i64;
        let model = self.embedder.model_id();

        let conn = self
            .conn
            .lock()
            .map_err(|_| "HistoryStore mutex poisoned")?;
        conn.execute(
            "INSERT OR REPLACE INTO command_embeddings (command_id, dim, vector, model, indexed_at)
             VALUES (?1, ?2, ?3, ?4, datetime('now'))",
            params![command_id, dim, bytes, model],
        )
        .map_err(|e| format!("index_command: {e}"))?;
        Ok(())
    }

    /// Backfill every row in `command_history` that does not yet have an
    /// embedding (or whose embedding was produced by a different model).
    /// Returns the number of rows indexed.
    pub fn backfill(&self) -> Result<usize, String> {
        let model = self.embedder.model_id().to_string();
        let conn = self
            .conn
            .lock()
            .map_err(|_| "HistoryStore mutex poisoned")?;

        let mut stmt = conn
            .prepare(
                "SELECT h.id, h.command FROM command_history h
                 LEFT JOIN command_embeddings e ON e.command_id = h.id
                 WHERE e.command_id IS NULL OR e.model != ?1",
            )
            .map_err(|e| format!("backfill prepare: {e}"))?;

        let rows: Vec<(i64, String)> = stmt
            .query_map(params![model], |r| Ok((r.get(0)?, r.get(1)?)))
            .map_err(|e| format!("backfill query: {e}"))?
            .collect::<Result<_, _>>()
            .map_err(|e| format!("backfill collect: {e}"))?;
        drop(stmt);

        let mut count = 0usize;
        for (id, cmd) in rows {
            let vec = self.embedder.embed(&cmd);
            if vec.iter().all(|v| *v == 0.0) {
                continue;
            }
            let bytes = vec_to_bytes(&vec);
            conn.execute(
                "INSERT OR REPLACE INTO command_embeddings (command_id, dim, vector, model, indexed_at)
                 VALUES (?1, ?2, ?3, ?4, datetime('now'))",
                params![id, vec.len() as i64, bytes, self.embedder.model_id()],
            )
            .map_err(|e| format!("backfill insert: {e}"))?;
            count += 1;
        }
        Ok(count)
    }

    /// Run a semantic search. `limit` is the number of top hits returned.
    pub fn search(
        &self,
        query: &str,
        limit: usize,
        filters: &SearchFilters,
    ) -> Result<Vec<SearchHit>, String> {
        if query.trim().is_empty() || limit == 0 {
            return Ok(Vec::new());
        }
        let q_vec = self.embedder.embed(query);
        if q_vec.iter().all(|v| *v == 0.0) {
            return Ok(Vec::new());
        }

        let mut sql = String::from(
            "SELECT h.id, h.command, h.cwd, h.exit_code, h.executed_at, e.vector, e.dim
             FROM command_embeddings e
             JOIN command_history h ON h.id = e.command_id
             WHERE e.model = ?1",
        );
        let mut bound: Vec<Box<dyn rusqlite::ToSql>> =
            vec![Box::new(self.embedder.model_id().to_string())];

        if let Some(since) = &filters.since {
            sql.push_str(" AND h.executed_at >= ?");
            sql.push_str(&(bound.len() + 1).to_string());
            bound.push(Box::new(since.clone()));
        }
        if let Some(until) = &filters.until {
            sql.push_str(" AND h.executed_at <= ?");
            sql.push_str(&(bound.len() + 1).to_string());
            bound.push(Box::new(until.clone()));
        }
        if let Some(prefix) = &filters.cwd_prefix {
            sql.push_str(" AND h.cwd LIKE ?");
            sql.push_str(&(bound.len() + 1).to_string());
            bound.push(Box::new(format!("{prefix}%")));
        }
        if filters.only_failed.unwrap_or(false) {
            sql.push_str(" AND h.exit_code IS NOT NULL AND h.exit_code != 0");
        }

        let conn = self
            .conn
            .lock()
            .map_err(|_| "HistoryStore mutex poisoned")?;
        let mut stmt = conn
            .prepare(&sql)
            .map_err(|e| format!("search prepare: {e}"))?;

        let params_iter: Vec<&dyn rusqlite::ToSql> = bound.iter().map(|b| b.as_ref()).collect();
        let hits_iter = stmt
            .query_map(params_iter.as_slice(), |row| {
                let id: i64 = row.get(0)?;
                let command: String = row.get(1)?;
                let cwd: String = row.get(2)?;
                let exit_code: Option<i32> = row.get(3)?;
                let executed_at: String = row.get(4)?;
                let vec_bytes: Vec<u8> = row.get(5)?;
                let dim: i64 = row.get(6)?;
                Ok((id, command, cwd, exit_code, executed_at, vec_bytes, dim))
            })
            .map_err(|e| format!("search query: {e}"))?;

        let mut ranked: Vec<SearchHit> = Vec::new();
        for row in hits_iter {
            let (id, command, cwd, exit_code, executed_at, bytes, dim) =
                row.map_err(|e| format!("search row: {e}"))?;
            let vec = match bytes_to_vec(&bytes, dim as usize) {
                Some(v) => v,
                None => continue,
            };
            let score = cosine(&q_vec, &vec);
            if score <= 0.0 {
                continue;
            }
            ranked.push(SearchHit {
                entry: HistoryEntry {
                    command_id: id,
                    command,
                    cwd,
                    exit_code,
                    executed_at,
                },
                score,
            });
        }

        // Partial sort: keep the highest `limit` hits, newest wins on ties.
        ranked.sort_by(|a, b| {
            b.score
                .partial_cmp(&a.score)
                .unwrap_or(std::cmp::Ordering::Equal)
                .then_with(|| b.entry.executed_at.cmp(&a.entry.executed_at))
        });
        ranked.truncate(limit);
        Ok(ranked)
    }
}

fn vec_to_bytes(v: &[f32]) -> Vec<u8> {
    let mut out = Vec::with_capacity(v.len() * 4);
    for f in v {
        out.extend_from_slice(&f.to_le_bytes());
    }
    out
}

fn bytes_to_vec(bytes: &[u8], dim: usize) -> Option<Vec<f32>> {
    if bytes.len() != dim * 4 {
        return None;
    }
    let mut out = Vec::with_capacity(dim);
    for chunk in bytes.chunks_exact(4) {
        out.push(f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]));
    }
    Some(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::migrations::run_migrations;
    use crate::history::embedding::HashingNgramEmbedder;
    use rusqlite::Connection;

    /// Build a fresh in-memory store. The store holds the only connection;
    /// tests insert rows via `insert_cmd` which takes the mutex.
    fn store() -> HistoryStore<HashingNgramEmbedder> {
        let conn = Connection::open_in_memory().unwrap();
        run_migrations(&conn).unwrap();
        HistoryStore::open(conn, HashingNgramEmbedder::new())
    }

    fn insert_cmd(
        store: &HistoryStore<HashingNgramEmbedder>,
        cmd: &str,
        cwd: &str,
        exit: Option<i32>,
    ) -> i64 {
        let conn = store.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO command_history (terminal_id, command, cwd, exit_code) VALUES (?1, ?2, ?3, ?4)",
            params!["t1", cmd, cwd, exit],
        )
        .unwrap();
        conn.last_insert_rowid()
    }

    #[test]
    fn search_returns_higher_score_for_near_matches() {
        let store = store();
        let cargo_id = insert_cmd(&store, "cargo build --release", "/repo", Some(0));
        let push_id = insert_cmd(&store, "git push origin main", "/repo", Some(0));
        store
            .index_command(cargo_id, "cargo build --release")
            .unwrap();
        store
            .index_command(push_id, "git push origin main")
            .unwrap();

        let hits = store.search("cargo", 5, &SearchFilters::default()).unwrap();
        assert!(!hits.is_empty(), "expected at least one hit");
        assert!(
            hits[0].entry.command.contains("cargo"),
            "top hit should be cargo, got {:?}",
            hits[0].entry.command
        );
    }

    #[test]
    fn backfill_indexes_existing_rows() {
        let store = store();
        insert_cmd(&store, "pnpm test", "/repo", Some(0));
        insert_cmd(&store, "pnpm build", "/repo", Some(0));

        let n = store.backfill().unwrap();
        assert_eq!(n, 2);

        let hits = store.search("test", 5, &SearchFilters::default()).unwrap();
        assert!(hits.iter().any(|h| h.entry.command == "pnpm test"));
    }

    #[test]
    fn filters_only_failed() {
        let store = store();
        insert_cmd(&store, "cargo build", "/repo", Some(0));
        insert_cmd(&store, "cargo build", "/repo", Some(101));
        store.backfill().unwrap();

        let hits = store
            .search(
                "cargo",
                5,
                &SearchFilters {
                    only_failed: Some(true),
                    ..Default::default()
                },
            )
            .unwrap();
        assert!(!hits.is_empty());
        assert!(hits.iter().all(|h| h.entry.exit_code == Some(101)));
    }

    #[test]
    fn filters_cwd_prefix() {
        let store = store();
        insert_cmd(&store, "ls -la", "/projects/a", Some(0));
        insert_cmd(&store, "ls -la", "/projects/b", Some(0));
        store.backfill().unwrap();

        let hits = store
            .search(
                "ls",
                5,
                &SearchFilters {
                    cwd_prefix: Some("/projects/a".into()),
                    ..Default::default()
                },
            )
            .unwrap();
        assert!(!hits.is_empty());
        assert!(hits.iter().all(|h| h.entry.cwd.starts_with("/projects/a")));
    }

    #[test]
    fn empty_query_returns_empty() {
        let store = store();
        let hits = store.search("   ", 5, &SearchFilters::default()).unwrap();
        assert!(hits.is_empty());
    }

    #[test]
    fn respects_limit() {
        let store = store();
        for i in 0..10 {
            insert_cmd(&store, &format!("cargo run --bin x{i}"), "/repo", Some(0));
        }
        store.backfill().unwrap();

        let hits = store.search("cargo", 3, &SearchFilters::default()).unwrap();
        assert_eq!(hits.len(), 3);
    }

    #[test]
    fn reindex_overwrites_existing() {
        let store = store();
        let id = insert_cmd(&store, "git status", "/repo", Some(0));
        store.index_command(id, "git status").unwrap();
        store.index_command(id, "git status").unwrap();

        let conn = store.conn.lock().unwrap();
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM command_embeddings WHERE command_id = ?1",
                params![id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 1);
    }
}
