use std::collections::HashMap;
use std::sync::{Arc, Mutex};

/// Metadata for a named pane, used for send-keys-by-name resolution
#[derive(Debug, Clone, serde::Serialize)]
pub struct PaneEntry {
    pub terminal_id: String,
    pub name: String,
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
                    shell_type: shell_type.to_string(),
                    cwd: cwd.to_string(),
                },
            );
        }
    }

    /// Rename a pane
    pub fn rename(&self, terminal_id: &str, name: &str) -> Result<(), String> {
        let mut entries = self.entries.lock().map_err(|_| "Lock poisoned".to_string())?;
        let entry = entries
            .get_mut(terminal_id)
            .ok_or_else(|| format!("Pane {} not found", terminal_id))?;
        entry.name = name.to_string();
        Ok(())
    }

    /// Find terminal_id by name (first match)
    pub fn find_by_name(&self, name: &str) -> Option<String> {
        let entries = self.entries.lock().ok()?;
        let name_lower = name.to_lowercase();
        entries
            .values()
            .find(|e| e.name.to_lowercase() == name_lower)
            .map(|e| e.terminal_id.clone())
    }

    /// List all registered panes
    pub fn list(&self) -> Vec<PaneEntry> {
        self.entries
            .lock()
            .map(|e| e.values().cloned().collect())
            .unwrap_or_default()
    }

    /// Remove a pane
    pub fn remove(&self, terminal_id: &str) {
        if let Ok(mut entries) = self.entries.lock() {
            entries.remove(terminal_id);
        }
    }
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
        reg.rename("abc", "server").unwrap();
        assert_eq!(reg.find_by_name("server"), Some("abc".to_string()));
        assert_eq!(reg.find_by_name("Server"), Some("abc".to_string())); // case-insensitive
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
}
