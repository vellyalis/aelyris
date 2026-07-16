use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};

use super::{ContextStore, DecisionChange};
use crate::db::ManagedDb;
use crate::persistence::DecisionRepo;

/// Thread-safe owner of the shared Context Store, managed in Tauri state.
/// `set`/`remove` return `Some(change)` only when something actually changed,
/// so the caller broadcasts `DECISION_CHANGED` exactly once per real change.
///
/// In-memory is the hot read cache; SQLite (via [`DecisionRepo`]) is the source
/// of truth. A `db` is attached at startup ([`attach_db`]); when absent (tests,
/// non-persistent mode) the manager behaves exactly as before — purely
/// in-memory. With a database attached, each real change is persisted before it
/// is published to memory. Persistence failure is returned to the caller and
/// leaves the prior in-memory value intact.
#[derive(Default)]
pub struct ContextStoreManager {
    store: Mutex<ContextStore>,
    db: Mutex<Option<Arc<ManagedDb>>>,
    durability_required: bool,
}

impl ContextStoreManager {
    pub fn new() -> Self {
        Self::default()
    }

    /// Production constructor: mutations must fail closed until a durable
    /// database has been attached. `new()` remains the explicit ephemeral mode
    /// used by isolated domain tests.
    pub fn new_durable() -> Self {
        Self {
            durability_required: true,
            ..Self::default()
        }
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, ContextStore> {
        self.store
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn db(&self) -> Option<Arc<ManagedDb>> {
        self.db
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone()
    }

    /// Attach the persistence backend and restore any persisted decisions into
    /// memory. Called once at startup after the database is opened. Returns the
    /// number of restored decisions.
    pub fn attach_db(&self, db: Arc<ManagedDb>) -> Result<usize, String> {
        let restored = db.with(DecisionRepo::load_all)?;
        let len = restored.len();
        *self.lock() = ContextStore::from_map(restored);
        *self
            .db
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(db);
        Ok(len)
    }

    pub fn set(
        &self,
        key: impl Into<String>,
        value: impl Into<String>,
    ) -> Result<Option<DecisionChange>, String> {
        let key = key.into();
        let value = value.into();
        let mut store = self.lock();
        let previous = store.get(&key).map(str::to_string);
        if previous.as_deref() == Some(value.as_str()) {
            return Ok(None);
        }
        match self.db() {
            Some(db) => db
                .with(|database| DecisionRepo::upsert(database, &key, &value))
                .map_err(|error| format!("Persist context decision '{key}': {error}"))?,
            None if self.durability_required => {
                return Err("Context Store durability is unavailable".to_string())
            }
            None => {}
        }
        Ok(store.set(key, value))
    }

    pub fn remove(&self, key: &str) -> Result<Option<DecisionChange>, String> {
        let mut store = self.lock();
        if store.get(key).is_none() {
            return Ok(None);
        }
        match self.db() {
            Some(db) => db
                .with(|database| DecisionRepo::delete(database, key))
                .map_err(|error| format!("Delete context decision '{key}': {error}"))?,
            None if self.durability_required => {
                return Err("Context Store durability is unavailable".to_string())
            }
            None => {}
        }
        Ok(store.remove(key))
    }

    pub fn get(&self, key: &str) -> Option<String> {
        self.lock().get(key).map(str::to_string)
    }

    pub fn all(&self) -> BTreeMap<String, String> {
        self.lock().all().clone()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn set_reports_change_and_get_reads_back() {
        let mgr = ContextStoreManager::new();
        let change = mgr.set("auth_method", "jwt").unwrap().unwrap();
        assert_eq!(change.value.as_deref(), Some("jwt"));
        assert_eq!(mgr.get("auth_method").as_deref(), Some("jwt"));
    }

    #[test]
    fn identical_set_is_noop() {
        let mgr = ContextStoreManager::new();
        mgr.set("database", "postgresql").unwrap();
        assert!(mgr.set("database", "postgresql").unwrap().is_none());
    }

    #[test]
    fn all_snapshots_every_decision() {
        let mgr = ContextStoreManager::new();
        mgr.set("framework", "nextjs").unwrap();
        mgr.set("auth_method", "jwt").unwrap();
        let all = mgr.all();
        assert_eq!(all.get("framework").map(String::as_str), Some("nextjs"));
        assert_eq!(all.get("auth_method").map(String::as_str), Some("jwt"));
        assert_eq!(all.len(), 2);
    }

    #[test]
    fn remove_reports_then_noop() {
        let mgr = ContextStoreManager::new();
        mgr.set("cache", "redis").unwrap();
        assert!(mgr.remove("cache").unwrap().is_some());
        assert!(mgr.remove("cache").unwrap().is_none());
        assert_eq!(mgr.get("cache"), None);
    }

    #[test]
    fn decisions_survive_a_simulated_restart_via_db() {
        // First session: attach a fresh db, set decisions (write-through).
        let db = Arc::new(ManagedDb::new(crate::db::Database::open_memory().unwrap()));
        let first = ContextStoreManager::new();
        assert_eq!(first.attach_db(db.clone()).unwrap(), 0);
        first.set("auth_method", "jwt").unwrap();
        first.set("database", "postgresql").unwrap();
        first.set("database", "postgresql").unwrap(); // no-op, must not double-write
        drop(first);

        // Second session: a brand-new manager attached to the SAME db restores.
        let second = ContextStoreManager::new();
        let restored = second.attach_db(db).unwrap();
        assert_eq!(restored, 2);
        assert_eq!(second.get("auth_method").as_deref(), Some("jwt"));
        assert_eq!(second.get("database").as_deref(), Some("postgresql"));
    }

    #[test]
    fn remove_is_persisted_across_restart() {
        let db = Arc::new(ManagedDb::new(crate::db::Database::open_memory().unwrap()));
        let first = ContextStoreManager::new();
        first.attach_db(db.clone()).unwrap();
        first.set("cache", "redis").unwrap();
        first.remove("cache").unwrap();
        drop(first);

        let second = ContextStoreManager::new();
        assert_eq!(second.attach_db(db).unwrap(), 0);
        assert_eq!(second.get("cache"), None);
    }

    #[test]
    fn persistence_failure_does_not_publish_a_set_or_remove() {
        let db = Arc::new(ManagedDb::new(crate::db::Database::open_memory().unwrap()));
        let mgr = ContextStoreManager::new();
        mgr.attach_db(db.clone()).unwrap();
        mgr.set("stable", "committed").unwrap();
        db.with(|database| {
            database
                .conn()
                .execute("DROP TABLE context_decisions", [])
                .map(|_| ())
                .map_err(|error| error.to_string())
        })
        .unwrap();

        assert!(mgr.set("new", "uncommitted").is_err());
        assert_eq!(mgr.get("new"), None);
        assert!(mgr.remove("stable").is_err());
        assert_eq!(mgr.get("stable").as_deref(), Some("committed"));
    }

    #[test]
    fn production_mode_rejects_mutation_until_durability_is_attached() {
        let mgr = ContextStoreManager::new_durable();
        assert!(mgr.set("key", "value").is_err());
        assert_eq!(mgr.get("key"), None);
    }
}
