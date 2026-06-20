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
/// in-memory. Write-through happens only on a real change. A persist failure is
/// logged loudly (never silently swallowed) while the in-memory change — already
/// authoritative for the running session — stands.
#[derive(Default)]
pub struct ContextStoreManager {
    store: Mutex<ContextStore>,
    db: Mutex<Option<Arc<ManagedDb>>>,
}

impl ContextStoreManager {
    pub fn new() -> Self {
        Self::default()
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

    pub fn set(&self, key: impl Into<String>, value: impl Into<String>) -> Option<DecisionChange> {
        let change = self.lock().set(key, value)?;
        if let (Some(db), Some(value)) = (self.db(), change.value.as_deref()) {
            if let Err(e) = db.with(|d| DecisionRepo::upsert(d, &change.key, value)) {
                tracing::error!(key = %change.key, error = %e, "context decision persist failed");
            }
        }
        Some(change)
    }

    pub fn remove(&self, key: &str) -> Option<DecisionChange> {
        let change = self.lock().remove(key)?;
        if let Some(db) = self.db() {
            if let Err(e) = db.with(|d| DecisionRepo::delete(d, &change.key)) {
                tracing::error!(key = %change.key, error = %e, "context decision delete persist failed");
            }
        }
        Some(change)
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
        let change = mgr.set("auth_method", "jwt").unwrap();
        assert_eq!(change.value.as_deref(), Some("jwt"));
        assert_eq!(mgr.get("auth_method").as_deref(), Some("jwt"));
    }

    #[test]
    fn identical_set_is_noop() {
        let mgr = ContextStoreManager::new();
        mgr.set("database", "postgresql");
        assert!(mgr.set("database", "postgresql").is_none());
    }

    #[test]
    fn all_snapshots_every_decision() {
        let mgr = ContextStoreManager::new();
        mgr.set("framework", "nextjs");
        mgr.set("auth_method", "jwt");
        let all = mgr.all();
        assert_eq!(all.get("framework").map(String::as_str), Some("nextjs"));
        assert_eq!(all.get("auth_method").map(String::as_str), Some("jwt"));
        assert_eq!(all.len(), 2);
    }

    #[test]
    fn remove_reports_then_noop() {
        let mgr = ContextStoreManager::new();
        mgr.set("cache", "redis");
        assert!(mgr.remove("cache").is_some());
        assert!(mgr.remove("cache").is_none());
        assert_eq!(mgr.get("cache"), None);
    }

    #[test]
    fn decisions_survive_a_simulated_restart_via_db() {
        // First session: attach a fresh db, set decisions (write-through).
        let db = Arc::new(ManagedDb::new(crate::db::Database::open_memory().unwrap()));
        let first = ContextStoreManager::new();
        assert_eq!(first.attach_db(db.clone()).unwrap(), 0);
        first.set("auth_method", "jwt");
        first.set("database", "postgresql");
        first.set("database", "postgresql"); // no-op, must not double-write
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
        first.set("cache", "redis");
        first.remove("cache");
        drop(first);

        let second = ContextStoreManager::new();
        assert_eq!(second.attach_db(db).unwrap(), 0);
        assert_eq!(second.get("cache"), None);
    }
}
