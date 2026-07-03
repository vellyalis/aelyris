//! Persistence for the Intent Bus deliberation queue.
//!
//! The `IntentBus` remains the single in-memory owner and calls this repo for
//! startup restore plus best-effort write-through on real changes.

use rusqlite::params;

use crate::db::Database;
use crate::intent::{Intent, IntentStatus};

pub struct IntentRepo;

impl IntentRepo {
    pub fn load_all(db: &Database) -> Result<Vec<Intent>, String> {
        let mut stmt = db
            .conn()
            .prepare(
                "SELECT id, agent_id, proposal, targets_json, status, created_at
                 FROM intents
                 ORDER BY created_at ASC, id ASC",
            )
            .map_err(|e| format!("Prepare load intents: {e}"))?;
        let rows = stmt
            .query_map([], |row| {
                let targets_json: String = row.get(3)?;
                let status_raw: String = row.get(4)?;
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    targets_json,
                    status_raw,
                    row.get::<_, u64>(5)?,
                ))
            })
            .map_err(|e| format!("Query intents: {e}"))?;

        let mut out = Vec::new();
        for row in rows {
            let (id, agent_id, proposal, targets_json, status_raw, created_at) =
                row.map_err(|e| format!("Read intent row: {e}"))?;
            let targets = serde_json::from_str::<Vec<String>>(&targets_json)
                .map_err(|e| format!("Parse intent targets for {id}: {e}"))?;
            let status = parse_status(&status_raw)
                .ok_or_else(|| format!("Parse intent status for {id}: {status_raw}"))?;
            out.push(Intent {
                id,
                agent_id,
                proposal,
                targets,
                status,
                created_at,
            });
        }
        Ok(out)
    }

    pub fn upsert(db: &Database, intent: &Intent) -> Result<(), String> {
        let targets_json = serde_json::to_string(&intent.targets)
            .map_err(|e| format!("Serialize intent targets: {e}"))?;
        db.conn()
            .execute(
                "INSERT INTO intents
                    (id, agent_id, proposal, targets_json, status, created_at, updated_at)
                 VALUES
                    (?1, ?2, ?3, ?4, ?5, ?6, CAST(strftime('%s', 'now') AS INTEGER))
                 ON CONFLICT(id) DO UPDATE SET
                    agent_id = excluded.agent_id,
                    proposal = excluded.proposal,
                    targets_json = excluded.targets_json,
                    status = excluded.status,
                    created_at = excluded.created_at,
                    updated_at = excluded.updated_at",
                params![
                    intent.id,
                    intent.agent_id,
                    intent.proposal,
                    targets_json,
                    intent.status.as_str(),
                    intent.created_at
                ],
            )
            .map(|_| ())
            .map_err(|e| format!("Upsert intent: {e}"))
    }

    pub fn update_status(db: &Database, id: &str, status: IntentStatus) -> Result<(), String> {
        db.conn()
            .execute(
                "UPDATE intents
                 SET status = ?2, updated_at = CAST(strftime('%s', 'now') AS INTEGER)
                 WHERE id = ?1",
                params![id, status.as_str()],
            )
            .map(|_| ())
            .map_err(|e| format!("Update intent status: {e}"))
    }
}

fn parse_status(value: &str) -> Option<IntentStatus> {
    match value {
        "open" => Some(IntentStatus::Open),
        "accepted" => Some(IntentStatus::Accepted),
        "rejected" => Some(IntentStatus::Rejected),
        "superseded" => Some(IntentStatus::Superseded),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn upsert_update_status_then_load_round_trips() {
        let db = Database::open_memory().unwrap();
        let intent = Intent {
            id: "intent-1".to_string(),
            agent_id: "agent-a".to_string(),
            proposal: "extract AuthService".to_string(),
            targets: vec!["src/auth.rs".to_string()],
            status: IntentStatus::Open,
            created_at: 100,
        };
        IntentRepo::upsert(&db, &intent).unwrap();
        IntentRepo::update_status(&db, &intent.id, IntentStatus::Accepted).unwrap();

        let loaded = IntentRepo::load_all(&db).unwrap();
        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0].id, "intent-1");
        assert_eq!(loaded[0].targets, vec!["src/auth.rs"]);
        assert_eq!(loaded[0].status, IntentStatus::Accepted);
    }
}
