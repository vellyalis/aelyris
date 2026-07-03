use std::sync::{Arc, Mutex};

use super::{Intent, IntentStatus};
use crate::db::ManagedDb;
use crate::persistence::IntentRepo;

/// Thread-safe owner of the Intent Bus, managed in Tauri state. Append-only
/// proposals with in-place status resolution; `open()` is the live deliberation
/// queue peers read before acting.
#[derive(Default)]
pub struct IntentBus {
    intents: Mutex<Vec<Intent>>,
    seq: Mutex<u64>,
    db: Mutex<Option<Arc<ManagedDb>>>,
}

impl IntentBus {
    pub fn new() -> Self {
        Self::default()
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Vec<Intent>> {
        self.intents
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn next_id(&self) -> String {
        let mut seq = self.seq.lock().unwrap_or_else(|p| p.into_inner());
        *seq += 1;
        format!("intent-{seq}")
    }

    fn db(&self) -> Option<Arc<ManagedDb>> {
        self.db
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone()
    }

    /// Attach the persistence backend and restore persisted deliberations into
    /// memory. The restored max `intent-N` suffix seeds the next generated id so
    /// a restart cannot collide with an existing row.
    pub fn attach_db(&self, db: Arc<ManagedDb>) -> Result<usize, String> {
        let restored = db.with(IntentRepo::load_all)?;
        let max_seq = restored
            .iter()
            .filter_map(|intent| intent.id.strip_prefix("intent-")?.parse::<u64>().ok())
            .max()
            .unwrap_or(0);
        let len = restored.len();
        *self.lock() = restored;
        *self
            .seq
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = max_seq;
        *self
            .db
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(db);
        Ok(len)
    }

    /// Propose an intent. `created_at` is caller-supplied (the IPC/MCP layer
    /// stamps it) so this stays free of ambient clock reads. Returns the stored
    /// intent (status `Open`).
    pub fn propose(
        &self,
        agent_id: impl Into<String>,
        proposal: impl Into<String>,
        targets: Vec<String>,
        created_at: u64,
    ) -> Intent {
        let intent = Intent {
            id: self.next_id(),
            agent_id: agent_id.into(),
            proposal: proposal.into(),
            targets,
            status: IntentStatus::Open,
            created_at,
        };
        let db = self.db();
        let mut intents = self.lock();
        intents.push(intent.clone());
        if let Some(db) = db {
            if let Err(e) = db.with(|d| IntentRepo::upsert(d, &intent)) {
                tracing::error!(intent_id = %intent.id, error = %e, "intent persist failed");
            }
        }
        intent
    }

    /// Open (still-deliberating) intents, in proposal order.
    pub fn open(&self) -> Vec<Intent> {
        self.lock()
            .iter()
            .filter(|intent| intent.status == IntentStatus::Open)
            .cloned()
            .collect()
    }

    /// Every intent, in proposal order.
    pub fn all(&self) -> Vec<Intent> {
        self.lock().clone()
    }

    /// Resolve an intent to a terminal status. Returns the updated intent, or
    /// `None` if the id is unknown.
    pub fn resolve(&self, id: &str, status: IntentStatus) -> Option<Intent> {
        let db = self.db();
        let mut intents = self.lock();
        let intent = intents.iter_mut().find(|intent| intent.id == id)?;
        if intent.status == status {
            return Some(intent.clone());
        }
        intent.status = status;
        let updated = intent.clone();
        if let Some(db) = db {
            if let Err(e) = db.with(|d| IntentRepo::update_status(d, id, status)) {
                tracing::error!(intent_id = %id, status = %status.as_str(), error = %e, "intent status persist failed");
            }
        }
        Some(updated)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn propose_then_open_lists_it() {
        let bus = IntentBus::new();
        let intent = bus.propose(
            "agent-a",
            "switch auth_method to JWT",
            vec!["src/auth/**".into()],
            100,
        );
        assert_eq!(intent.status, IntentStatus::Open);
        assert_eq!(intent.agent_id, "agent-a");
        let open = bus.open();
        assert_eq!(open.len(), 1);
        assert_eq!(open[0].proposal, "switch auth_method to JWT");
    }

    #[test]
    fn ids_are_unique_and_sequential() {
        let bus = IntentBus::new();
        let a = bus.propose("x", "a", vec![], 1);
        let b = bus.propose("x", "b", vec![], 2);
        assert_ne!(a.id, b.id);
    }

    #[test]
    fn resolve_moves_it_out_of_open() {
        let bus = IntentBus::new();
        let intent = bus.propose("agent-a", "use Redis", vec![], 100);
        let resolved = bus.resolve(&intent.id, IntentStatus::Accepted).unwrap();
        assert_eq!(resolved.status, IntentStatus::Accepted);
        assert!(bus.open().is_empty());
        assert_eq!(bus.all().len(), 1);
    }

    #[test]
    fn resolve_unknown_is_none() {
        let bus = IntentBus::new();
        assert!(bus.resolve("nope", IntentStatus::Rejected).is_none());
    }

    #[test]
    fn intents_survive_a_simulated_restart_via_db() {
        let db = Arc::new(ManagedDb::new(crate::db::Database::open_memory().unwrap()));
        let first = IntentBus::new();
        assert_eq!(first.attach_db(db.clone()).unwrap(), 0);
        let open = first.propose(
            "agent-a",
            "extract AuthService",
            vec!["src/auth.rs".into()],
            100,
        );
        let rejected = first.propose("agent-b", "switch auth_method to JWT", vec![], 101);
        first.resolve(&rejected.id, IntentStatus::Rejected).unwrap();
        drop(first);

        let second = IntentBus::new();
        assert_eq!(second.attach_db(db).unwrap(), 2);
        assert_eq!(second.all().len(), 2);
        assert_eq!(second.open(), vec![open.clone()]);
        assert_eq!(second.all()[1].status, IntentStatus::Rejected);

        let next = second.propose("agent-c", "add tests", vec![], 102);
        assert_eq!(next.id, "intent-3");
    }
}
