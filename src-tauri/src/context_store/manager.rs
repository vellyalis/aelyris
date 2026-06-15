use std::collections::BTreeMap;
use std::sync::Mutex;

use super::{ContextStore, DecisionChange};

/// Thread-safe owner of the shared Context Store, managed in Tauri state.
/// `set`/`remove` return `Some(change)` only when something actually changed,
/// so the caller broadcasts `DECISION_CHANGED` exactly once per real change.
#[derive(Default)]
pub struct ContextStoreManager {
    store: Mutex<ContextStore>,
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

    pub fn set(&self, key: impl Into<String>, value: impl Into<String>) -> Option<DecisionChange> {
        self.lock().set(key, value)
    }

    pub fn remove(&self, key: &str) -> Option<DecisionChange> {
        self.lock().remove(key)
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
}
