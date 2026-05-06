use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};

/// Metadata for a named pane, used for send-keys-by-name resolution
#[derive(Debug, Clone, serde::Serialize)]
pub struct PaneEntry {
    pub terminal_id: String,
    pub name: String,
    pub role: String,
    pub shell_type: String,
    pub cwd: String,
}

/// Registry mapping terminal IDs and user-assigned names to pane metadata.
/// Enables send-keys-by-name and pane listing with human-readable labels.
#[derive(Clone)]
pub struct PaneRegistry {
    entries: Arc<Mutex<HashMap<String, PaneEntry>>>,
}

impl PaneRegistry {
    pub fn new() -> Self {
        Self {
            entries: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// Register a new pane
    pub fn register(&self, terminal_id: &str, shell_type: &str, cwd: &str) {
        if let Ok(mut entries) = self.entries.lock() {
            entries.insert(
                terminal_id.to_string(),
                PaneEntry {
                    terminal_id: terminal_id.to_string(),
                    name: String::new(),
                    role: String::new(),
                    shell_type: shell_type.to_string(),
                    cwd: cwd.to_string(),
                },
            );
        }
    }

    /// Ensure a pane exists without overwriting existing user metadata.
    ///
    /// Respawn after an intentional `close_terminal` can recreate a PTY id
    /// after the registry entry was removed. Crash respawn, on the other
    /// hand, usually still has name/role metadata that must survive.
    pub fn ensure_registered(&self, terminal_id: &str, shell_type: &str, cwd: &str) {
        if let Ok(mut entries) = self.entries.lock() {
            entries
                .entry(terminal_id.to_string())
                .or_insert_with(|| PaneEntry {
                    terminal_id: terminal_id.to_string(),
                    name: String::new(),
                    role: String::new(),
                    shell_type: shell_type.to_string(),
                    cwd: cwd.to_string(),
                });
        }
    }

    /// Rename a pane
    pub fn rename(&self, terminal_id: &str, name: &str) -> Result<(), String> {
        let mut entries = self
            .entries
            .lock()
            .map_err(|_| "Lock poisoned".to_string())?;
        let normalized = normalize_label(name, 64);
        if !normalized.is_empty() {
            let name_lower = normalized.to_lowercase();
            if entries
                .values()
                .any(|e| e.terminal_id != terminal_id && e.name.to_lowercase() == name_lower)
            {
                return Err(format!("Pane name '{}' is already in use", normalized));
            }
        }
        let entry = entries
            .get_mut(terminal_id)
            .ok_or_else(|| format!("Pane {} not found", terminal_id))?;
        entry.name = normalized;
        Ok(())
    }

    /// Assign a workstation role to a pane (build, test, review, agent...).
    pub fn set_role(&self, terminal_id: &str, role: &str) -> Result<(), String> {
        let mut entries = self
            .entries
            .lock()
            .map_err(|_| "Lock poisoned".to_string())?;
        let entry = entries
            .get_mut(terminal_id)
            .ok_or_else(|| format!("Pane {} not found", terminal_id))?;
        entry.role = normalize_label(role, 32);
        Ok(())
    }

    /// Find terminal_id by name (first match)
    pub fn find_by_name(&self, name: &str) -> Option<String> {
        self.find_all_by_name(name).into_iter().next()
    }

    /// Find all terminal IDs by name. More than one result means old state
    /// contains duplicate names; new renames reject that ambiguity.
    pub fn find_all_by_name(&self, name: &str) -> Vec<String> {
        let Ok(entries) = self.entries.lock() else {
            return Vec::new();
        };
        let name_lower = name.to_lowercase();
        let mut ids: Vec<String> = entries
            .values()
            .filter(|e| !e.name.is_empty() && e.name.to_lowercase() == name_lower)
            .map(|e| e.terminal_id.clone())
            .collect();
        ids.sort();
        ids
    }

    /// Resolve a pane name only when it is unambiguous.
    pub fn find_by_name_unique(&self, name: &str) -> Result<Option<String>, String> {
        let mut ids = self.find_all_by_name(name);
        if ids.len() > 1 {
            return Err(format!(
                "Pane name '{}' is ambiguous ({} matches)",
                name,
                ids.len()
            ));
        }
        Ok(ids.pop())
    }

    /// Resolve a user-facing pane target for backend send-key routing.
    ///
    /// Exact terminal IDs are durable single-pane targets. `@role` and
    /// `role:<name>` are explicit scoped broadcasts. Bare labels may resolve
    /// by pane name or role, but not both; that ambiguity should be surfaced
    /// to callers instead of silently selecting the first match.
    pub fn resolve_send_target(&self, target: &str) -> Result<Vec<String>, String> {
        let trimmed = target.trim();
        if trimmed.is_empty() {
            return Ok(Vec::new());
        }

        if let Ok(entries) = self.entries.lock() {
            if entries.contains_key(trimmed) {
                return Ok(vec![trimmed.to_string()]);
            }
        }

        if let Some(role) = trimmed.strip_prefix('@') {
            return Ok(self.find_by_role(role.trim()));
        }
        if let Some(role) = trimmed.strip_prefix("role:") {
            return Ok(self.find_by_role(role.trim()));
        }

        let name_match = self.find_by_name_unique(trimmed)?;
        let role_matches = self.find_by_role(trimmed);
        if name_match.is_some() && !role_matches.is_empty() {
            return Err(format!(
                "Pane target '{}' is ambiguous (matched pane name and role); use pane id, @role, or role:{}",
                trimmed, trimmed
            ));
        }
        if let Some(terminal_id) = name_match {
            return Ok(vec![terminal_id]);
        }
        Ok(role_matches)
    }

    /// Find all terminal IDs by role. Multiple panes can intentionally share
    /// a role, so role-addressed sends behave like a scoped broadcast.
    pub fn find_by_role(&self, role: &str) -> Vec<String> {
        let Ok(entries) = self.entries.lock() else {
            return Vec::new();
        };
        let role_lower = role.to_lowercase();
        let mut ids: Vec<String> = entries
            .values()
            .filter(|e| !e.role.is_empty() && e.role.to_lowercase() == role_lower)
            .map(|e| e.terminal_id.clone())
            .collect();
        ids.sort();
        ids
    }

    /// List all registered panes
    pub fn list(&self) -> Vec<PaneEntry> {
        self.entries
            .lock()
            .map(|e| e.values().cloned().collect())
            .unwrap_or_default()
    }

    /// List pane metadata for currently active terminal IDs only.
    ///
    /// The registry preserves user labels and roles across some restart paths,
    /// so the active PTY list is the source of truth for live-count surfaces.
    pub fn list_active(&self, active_terminal_ids: &[String]) -> Vec<PaneEntry> {
        let Ok(entries) = self.entries.lock() else {
            return Vec::new();
        };
        let mut seen = HashSet::new();
        let mut panes = Vec::new();
        for terminal_id in active_terminal_ids {
            if !seen.insert(terminal_id.clone()) {
                continue;
            }
            panes.push(
                entries
                    .get(terminal_id)
                    .cloned()
                    .unwrap_or_else(|| PaneEntry {
                        terminal_id: terminal_id.clone(),
                        name: String::new(),
                        role: String::new(),
                        shell_type: "shell".to_string(),
                        cwd: String::new(),
                    }),
            );
        }
        panes
    }

    /// Remove a pane
    pub fn remove(&self, terminal_id: &str) {
        if let Ok(mut entries) = self.entries.lock() {
            entries.remove(terminal_id);
        }
    }
}

fn normalize_label(value: &str, max_len: usize) -> String {
    value
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .take(max_len)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_register_and_list() {
        let reg = PaneRegistry::new();
        reg.register("abc", "cmd", "C:/proj");
        reg.register("def", "powershell", "C:/proj2");
        assert_eq!(reg.list().len(), 2);
    }

    #[test]
    fn test_rename_and_find() {
        let reg = PaneRegistry::new();
        reg.register("abc", "cmd", ".");
        reg.rename("abc", "  server   pane  ").unwrap();
        assert_eq!(reg.list()[0].name, "server pane");
        reg.rename("abc", "server").unwrap();
        assert_eq!(reg.find_by_name("server"), Some("abc".to_string()));
        assert_eq!(reg.find_by_name("Server"), Some("abc".to_string())); // case-insensitive
    }

    #[test]
    fn test_rename_rejects_duplicate_names_case_insensitive() {
        let reg = PaneRegistry::new();
        reg.register("abc", "cmd", ".");
        reg.register("def", "powershell", ".");
        reg.rename("abc", "server").unwrap();

        let err = reg.rename("def", "SERVER").unwrap_err();
        assert!(err.contains("already in use"));
    }

    #[test]
    fn test_unique_name_lookup_rejects_legacy_ambiguity() {
        let reg = PaneRegistry::new();
        reg.register("abc", "cmd", ".");
        reg.register("def", "powershell", ".");
        {
            let mut entries = reg.entries.lock().unwrap();
            entries.get_mut("abc").unwrap().name = "server".to_string();
            entries.get_mut("def").unwrap().name = "Server".to_string();
        }

        let err = reg.find_by_name_unique("server").unwrap_err();
        assert!(err.contains("ambiguous"));
    }

    #[test]
    fn test_find_nonexistent() {
        let reg = PaneRegistry::new();
        assert_eq!(reg.find_by_name("nope"), None);
    }

    #[test]
    fn test_remove() {
        let reg = PaneRegistry::new();
        reg.register("abc", "cmd", ".");
        reg.remove("abc");
        assert!(reg.list().is_empty());
    }

    #[test]
    fn test_role_lookup_is_case_insensitive_and_allows_multiple_panes() {
        let reg = PaneRegistry::new();
        reg.register("build-1", "cmd", ".");
        reg.register("build-2", "powershell", ".");
        reg.register("review-1", "powershell", ".");
        reg.set_role("build-1", "build").unwrap();
        reg.set_role("build-2", "Build").unwrap();
        reg.set_role("review-1", "review").unwrap();

        let mut ids = reg.find_by_role("BUILD");
        ids.sort();
        assert_eq!(ids, vec!["build-1".to_string(), "build-2".to_string()]);
    }

    #[test]
    fn test_resolve_send_target_accepts_terminal_id_first() {
        let reg = PaneRegistry::new();
        reg.register("build", "cmd", ".");
        reg.register("other", "powershell", ".");
        reg.rename("other", "build").unwrap();
        reg.set_role("other", "build").unwrap();

        assert_eq!(
            reg.resolve_send_target("build").unwrap(),
            vec!["build".to_string()]
        );
    }

    #[test]
    fn test_resolve_send_target_rejects_bare_name_role_ambiguity() {
        let reg = PaneRegistry::new();
        reg.register("pane-1", "cmd", ".");
        reg.register("pane-2", "powershell", ".");
        reg.rename("pane-1", "build").unwrap();
        reg.set_role("pane-2", "build").unwrap();

        let err = reg.resolve_send_target("build").unwrap_err();
        assert!(err.contains("ambiguous"));
        assert!(err.contains("@role"));
    }

    #[test]
    fn test_resolve_send_target_allows_explicit_role_broadcast() {
        let reg = PaneRegistry::new();
        reg.register("pane-1", "cmd", ".");
        reg.register("pane-2", "powershell", ".");
        reg.rename("pane-1", "build").unwrap();
        reg.set_role("pane-2", "build").unwrap();

        assert_eq!(
            reg.resolve_send_target("@build").unwrap(),
            vec!["pane-2".to_string()]
        );
        assert_eq!(
            reg.resolve_send_target("role:BUILD").unwrap(),
            vec!["pane-2".to_string()]
        );
    }

    #[test]
    fn test_role_is_listed_with_pane_metadata() {
        let reg = PaneRegistry::new();
        reg.register("abc", "cmd", ".");
        reg.set_role("abc", "review").unwrap();

        let panes = reg.list();
        assert_eq!(panes[0].role, "review");
    }

    #[test]
    fn test_list_active_uses_terminal_truth() {
        let reg = PaneRegistry::new();
        reg.register("live", "powershell", "C:/repo");
        reg.rename("live", "Build").unwrap();
        reg.set_role("live", "build").unwrap();
        reg.register("stale", "cmd", "C:/old");

        let panes = reg.list_active(&[
            "live".to_string(),
            "missing-metadata".to_string(),
            "live".to_string(),
        ]);

        assert_eq!(panes.len(), 2);
        assert_eq!(panes[0].terminal_id, "live");
        assert_eq!(panes[0].name, "Build");
        assert_eq!(panes[0].role, "build");
        assert_eq!(panes[1].terminal_id, "missing-metadata");
        assert_eq!(panes[1].shell_type, "shell");
        assert!(!panes.iter().any(|pane| pane.terminal_id == "stale"));
    }
}
