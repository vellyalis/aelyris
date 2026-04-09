use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

/// Represents the state of a Claude Code session as seen by Aether
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionState {
    pub pid: u32,
    pub status: String,           // idle, thinking, coding, waiting
    pub git_branch: String,
    pub cwd: String,
    pub timestamp: String,
    pub is_worktree: bool,
    pub cost: f64,
}

/// Monitors Claude Code session state files (Scape bridge.sh compatible)
pub struct SessionMonitor {
    state_dir: PathBuf,
    sessions: Arc<Mutex<HashMap<u32, SessionState>>>,
}

impl SessionMonitor {
    pub fn new() -> Self {
        let home = dirs_home().unwrap_or_else(|| PathBuf::from("."));
        let state_dir = home.join(".claude").join("aether").join("sessions");
        let _ = std::fs::create_dir_all(&state_dir);

        Self {
            state_dir,
            sessions: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// Scan session state directory for JSON files
    pub fn scan(&self) -> Vec<SessionState> {
        let mut results = Vec::new();

        if let Ok(entries) = std::fs::read_dir(&self.state_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.extension().map(|e| e == "json").unwrap_or(false) {
                    if let Ok(content) = std::fs::read_to_string(&path) {
                        if let Ok(state) = serde_json::from_str::<SessionState>(&content) {
                            results.push(state);
                        }
                    }
                }
            }
        }

        // Update cache
        if let Ok(mut sessions) = self.sessions.lock() {
            sessions.clear();
            for s in &results {
                sessions.insert(s.pid, s.clone());
            }
        }

        results
    }

    /// Write a session state file (for sessions we manage)
    pub fn write_state(&self, state: &SessionState) -> Result<(), String> {
        let path = self.state_dir.join(format!("{}.json", state.pid));
        let json = serde_json::to_string_pretty(state)
            .map_err(|e| format!("Serialize error: {}", e))?;
        std::fs::write(&path, json)
            .map_err(|e| format!("Write error: {}", e))?;
        Ok(())
    }

    /// Remove a session state file
    pub fn remove_state(&self, pid: u32) -> Result<(), String> {
        let path = self.state_dir.join(format!("{}.json", pid));
        if path.exists() {
            std::fs::remove_file(&path)
                .map_err(|e| format!("Remove error: {}", e))?;
        }
        Ok(())
    }
}

fn dirs_home() -> Option<PathBuf> {
    std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .ok()
        .map(PathBuf::from)
}
