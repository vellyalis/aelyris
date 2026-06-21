use std::collections::BTreeMap;
use std::sync::{Mutex, OnceLock};

use super::{ContextStore, DecisionChange};
use crate::db::ManagedDb;

/// Thread-safe owner of the shared Context Store, managed in Tauri state.
/// `set`/`remove` return `Some(change)` only when something actually changed,
/// so the caller broadcasts `DECISION_CHANGED` exactly once per real change.
///
/// Decisions are durably persisted: once [`attach_db`](Self::attach_db) wires a
/// DB handle at launch, every real change is written through to SQLite so the
/// world-model survives an app restart instead of resetting to empty. Persistence
/// is best-effort (a DB error never fails the in-memory op) and runs UNDER the
/// store lock so the in-memory map and the DB never diverge under concurrent
/// writes; ADR writes are rare (project decisions), so the brief lock hold across
/// SQLite I/O is immaterial to the `all()` read hot path injected into every prompt.
#[derive(Default)]
pub struct ContextStoreManager {
    store: Mutex<ContextStore>,
    db: OnceLock<ManagedDb>,
}

impl ContextStoreManager {
    pub fn new() -> Self {
        Self::default()
    }

    /// Wire the durable store. Called once at launch, AFTER `hydrate`, so the
    /// restore replay does not re-persist what it just read. A second call is a
    /// programming error (the first DB handle stays wired) — log it so a future
    /// double-init can't silently send writes to the wrong connection.
    pub fn attach_db(&self, db: ManagedDb) {
        if self.db.set(db).is_err() {
            log::warn!(
                "context store: attach_db called more than once; keeping the first DB handle"
            );
        }
    }

    /// Silently load restored decisions at launch. Bypasses change detection and
    /// `DECISION_CHANGED`/persistence entirely — a restore must not re-emit events
    /// or re-write rows. Call BEFORE `attach_db`.
    pub fn hydrate(&self, decisions: BTreeMap<String, String>) {
        self.lock().replace_all(decisions);
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, ContextStore> {
        self.store
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    pub fn set(&self, key: impl Into<String>, value: impl Into<String>) -> Option<DecisionChange> {
        let mut store = self.lock();
        let change = store.set(key, value);
        // Persist under the lock, only on a real change so the identical-set
        // no-op never writes (keeps the DB and DECISION_CHANGED in lockstep).
        if let Some(change) = &change {
            self.persist(change);
        }
        change
    }

    pub fn remove(&self, key: &str) -> Option<DecisionChange> {
        let mut store = self.lock();
        let change = store.remove(key);
        if let Some(change) = &change {
            self.persist(change);
        }
        change
    }

    pub fn get(&self, key: &str) -> Option<String> {
        self.lock().get(key).map(str::to_string)
    }

    pub fn all(&self) -> BTreeMap<String, String> {
        self.lock().all().clone()
    }

    /// Best-effort write-through of one decision change: `Some(value)` upserts,
    /// `None` (removal) deletes. Errors are logged, never propagated — the
    /// in-memory write already succeeded and must not be undone by a transient
    /// DB failure. A no-op when no DB is attached (e.g. unit tests).
    fn persist(&self, change: &DecisionChange) {
        let Some(db) = self.db.get() else {
            return;
        };
        let result = match &change.value {
            Some(value) => db.with(|d| d.upsert_context_decision(&change.key, value)),
            None => db.with(|d| d.delete_context_decision(&change.key)),
        };
        if let Err(err) = result {
            log::warn!(
                "context store: persisting decision '{}' failed: {err}",
                change.key
            );
        }
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
    fn persists_changes_so_a_fresh_manager_restores_after_restart() {
        use crate::db::{Database, ManagedDb};
        let db = ManagedDb::new(Database::open_memory().unwrap());

        let mgr = ContextStoreManager::new();
        mgr.attach_db(db.clone());
        mgr.set("auth_method", "jwt");
        mgr.set("framework", "remix");
        mgr.set("framework", "nextjs"); // overwrite persists last-write-wins
        mgr.remove("auth_method"); // removal persists too

        // Simulate a restart: a brand-new manager hydrated from the SAME db.
        let reloaded = ContextStoreManager::new();
        let decisions = db.with(|d| d.load_context_decisions()).unwrap();
        reloaded.hydrate(decisions);

        assert_eq!(reloaded.get("framework").as_deref(), Some("nextjs"));
        assert_eq!(
            reloaded.get("auth_method"),
            None,
            "removed decision must not come back"
        );
        assert_eq!(reloaded.all().len(), 1);
    }

    #[test]
    fn hydrate_is_silent_and_never_persists() {
        use crate::db::{Database, ManagedDb};
        let db = ManagedDb::new(Database::open_memory().unwrap());
        let mgr = ContextStoreManager::new();
        // NOTE: production restores hydrate-THEN-attach (see lib.rs). Here we
        // deliberately do the INVERSE (attach first) to prove the stronger
        // invariant: hydrate never persists even when a DB is already wired.
        mgr.attach_db(db.clone());
        let mut seed = BTreeMap::new();
        seed.insert("k".to_string(), "v".to_string());
        mgr.hydrate(seed);
        assert!(db.with(|d| d.load_context_decisions()).unwrap().is_empty());
        assert_eq!(mgr.get("k").as_deref(), Some("v"));
    }
}
