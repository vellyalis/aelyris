//! Context Store — the shared architectural decision record (ADR) every agent
//! aligns to.
//!
//! See docs/specs/AETHER_COCKPIT_REQUIREMENTS_2026-06-13.md, Binding
//! Requirement 6. Holds project-level decisions (e.g. `auth_method` -> `jwt`,
//! `database` -> `postgresql`, `framework` -> `nextjs`). A change returns a
//! `DecisionChange` so the caller can broadcast `DECISION_CHANGED` to the
//! fleet. This is distinct from the frontend "context pack" (prompt
//! code-context); this store is project decisions, not source excerpts.

pub mod manager;

pub use manager::ContextStoreManager;

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// A single decision change, used as the `DECISION_CHANGED` payload.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DecisionChange {
    pub key: String,
    /// The value before this change, if the key already existed.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub previous: Option<String>,
    /// The value after this change. `None` means the decision was removed.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub value: Option<String>,
}

/// In-memory shared decision record. `BTreeMap` keeps `all()` deterministically
/// ordered, which makes snapshots/diffs stable.
#[derive(Debug, Default)]
pub struct ContextStore {
    decisions: BTreeMap<String, String>,
}

impl ContextStore {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn len(&self) -> usize {
        self.decisions.len()
    }

    pub fn is_empty(&self) -> bool {
        self.decisions.is_empty()
    }

    pub fn get(&self, key: &str) -> Option<&str> {
        self.decisions.get(key).map(String::as_str)
    }

    pub fn all(&self) -> &BTreeMap<String, String> {
        &self.decisions
    }

    /// Set a decision. Returns `Some(change)` when the value is new or differs
    /// (the caller broadcasts `DECISION_CHANGED`); `None` when the value is
    /// identical to what is already stored (a no-op that must not spam agents).
    pub fn set(
        &mut self,
        key: impl Into<String>,
        value: impl Into<String>,
    ) -> Option<DecisionChange> {
        let key = key.into();
        let value = value.into();
        let previous = self.decisions.get(&key).cloned();
        if previous.as_deref() == Some(value.as_str()) {
            return None;
        }
        self.decisions.insert(key.clone(), value.clone());
        Some(DecisionChange {
            key,
            previous,
            value: Some(value),
        })
    }

    /// Remove a decision. Returns `Some(change)` (with `value: None`) when the
    /// key existed; `None` otherwise.
    pub fn remove(&mut self, key: &str) -> Option<DecisionChange> {
        let previous = self.decisions.remove(key)?;
        Some(DecisionChange {
            key: key.to_string(),
            previous: Some(previous),
            value: None,
        })
    }

    /// Replace ALL decisions wholesale for a silent restore-on-launch. Bypasses
    /// change detection and `DECISION_CHANGED` entirely — a restored map must not
    /// re-emit events or re-persist. Restricted to this module tree (the manager's
    /// `hydrate` is the only caller) so nothing else can bypass change detection.
    pub(in crate::context_store) fn replace_all(&mut self, decisions: BTreeMap<String, String>) {
        self.decisions = decisions;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn set_new_decision_reports_change_with_no_previous() {
        let mut store = ContextStore::new();
        let change = store.set("auth_method", "jwt").unwrap();
        assert_eq!(change.key, "auth_method");
        assert_eq!(change.previous, None);
        assert_eq!(change.value.as_deref(), Some("jwt"));
        assert_eq!(store.get("auth_method"), Some("jwt"));
    }

    #[test]
    fn setting_identical_value_is_a_noop() {
        let mut store = ContextStore::new();
        store.set("database", "postgresql").unwrap();
        assert!(store.set("database", "postgresql").is_none());
    }

    #[test]
    fn changing_a_value_reports_previous() {
        let mut store = ContextStore::new();
        store.set("framework", "remix");
        let change = store.set("framework", "nextjs").unwrap();
        assert_eq!(change.previous.as_deref(), Some("remix"));
        assert_eq!(change.value.as_deref(), Some("nextjs"));
    }

    #[test]
    fn remove_reports_change_then_is_noop() {
        let mut store = ContextStore::new();
        store.set("cache", "redis");
        let change = store.remove("cache").unwrap();
        assert_eq!(change.previous.as_deref(), Some("redis"));
        assert_eq!(change.value, None);
        assert!(store.remove("cache").is_none());
        assert_eq!(store.get("cache"), None);
    }

    #[test]
    fn all_is_deterministically_ordered() {
        let mut store = ContextStore::new();
        store.set("framework", "nextjs");
        store.set("auth_method", "jwt");
        store.set("database", "postgresql");
        let keys: Vec<&str> = store.all().keys().map(String::as_str).collect();
        assert_eq!(keys, ["auth_method", "database", "framework"]);
    }

    #[test]
    fn replace_all_overwrites_wholesale() {
        let mut store = ContextStore::new();
        store.set("a", "1");
        let mut restored = BTreeMap::new();
        restored.insert("x".to_string(), "10".to_string());
        restored.insert("y".to_string(), "20".to_string());
        store.replace_all(restored);
        // The prior in-memory decision is gone; only the restored map remains.
        assert_eq!(store.get("a"), None);
        assert_eq!(store.get("x"), Some("10"));
        let keys: Vec<&str> = store.all().keys().map(String::as_str).collect();
        assert_eq!(keys, ["x", "y"]);
    }
}
