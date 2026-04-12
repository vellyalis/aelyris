use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

/// Which AI CLI is backing this session
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum AgentCli {
    Claude,
    Gemini,
    Codex,
    Custom(String),
}

impl AgentCli {
    /// Resolve CLI binary name and base arguments for interactive mode
    pub fn program_and_args(&self, model: Option<&str>) -> (String, Vec<String>) {
        match self {
            AgentCli::Claude => {
                let mut args = Vec::new();
                if let Some(m) = model {
                    args.push("--model".to_string());
                    args.push(m.to_string());
                }
                ("claude".to_string(), args)
            }
            AgentCli::Gemini => {
                // Gemini CLI interactive mode
                ("gemini".to_string(), Vec::new())
            }
            AgentCli::Codex => {
                // OpenAI Codex CLI
                ("codex".to_string(), Vec::new())
            }
            AgentCli::Custom(bin) => {
                (bin.clone(), Vec::new())
            }
        }
    }

    /// Detect CLI type from model name string.
    /// Only known CLI types are returned — no user-controlled binary execution.
    pub fn from_model(model: &str) -> Self {
        if model.starts_with("codex") {
            AgentCli::Codex
        } else if model.starts_with("gemini") {
            AgentCli::Gemini
        } else {
            AgentCli::Claude
        }
    }

    /// Validate that this CLI is safe to execute (known binary only).
    /// Custom CLIs must be in the allowlist.
    pub fn validate(&self) -> Result<(), String> {
        match self {
            AgentCli::Claude | AgentCli::Gemini | AgentCli::Codex => Ok(()),
            AgentCli::Custom(bin) => {
                // Reject path traversal, absolute paths, shell metacharacters
                if bin.contains('/') || bin.contains('\\') || bin.contains("..") || bin.is_empty() {
                    return Err(format!("Unsafe CLI binary name: {}", bin));
                }
                // Only allow explicitly known custom CLIs
                const ALLOWED_CUSTOM: &[&str] = &["aider", "cursor", "continue"];
                if ALLOWED_CUSTOM.contains(&bin.as_str()) {
                    Ok(())
                } else {
                    Err(format!("Unknown CLI '{}'. Allowed: {:?}", bin, ALLOWED_CUSTOM))
                }
            }
        }
    }
}

/// Metadata for a live interactive agent session (PTY-based)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InteractiveSessionInfo {
    pub id: String,
    pub pty_id: String,
    pub cli: AgentCli,
    pub status: String,
    pub model: String,
    pub initial_prompt: Option<String>,
    pub cwd: String,
    pub worktree_branch: Option<String>,
    pub worktree_path: Option<String>,
    pub repo_path: Option<String>,
    pub cost: f64,
    pub tokens_used: u64,
    pub started_at: u64,
}

/// Manages interactive agent sessions (agent-agnostic, works with any CLI)
#[derive(Clone)]
pub struct InteractiveSessionManager {
    sessions: Arc<Mutex<HashMap<String, InteractiveSessionInfo>>>,
}

impl InteractiveSessionManager {
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// Register a new interactive session
    pub fn register(&self, info: InteractiveSessionInfo) -> Result<(), String> {
        self.lock_sessions()?
            .insert(info.id.clone(), info);
        Ok(())
    }

    /// Remove a session
    pub fn unregister(&self, id: &str) -> Result<Option<InteractiveSessionInfo>, String> {
        Ok(self.lock_sessions()?.remove(id))
    }

    /// Get a single session's info
    pub fn get(&self, id: &str) -> Result<Option<InteractiveSessionInfo>, String> {
        Ok(self.lock_sessions()?.get(id).cloned())
    }

    /// Update session status (e.g. "thinking", "coding", "idle", "done")
    pub fn update_status(&self, id: &str, status: &str) -> Result<(), String> {
        if let Some(session) = self.lock_sessions()?.get_mut(id) {
            session.status = status.to_string();
        }
        Ok(())
    }

    /// Update cost and token usage
    pub fn update_usage(&self, id: &str, cost: f64, tokens: u64) -> Result<(), String> {
        if let Some(session) = self.lock_sessions()?.get_mut(id) {
            session.cost = cost;
            session.tokens_used = tokens;
        }
        Ok(())
    }

    /// List all sessions
    pub fn list(&self) -> Vec<InteractiveSessionInfo> {
        self.sessions
            .lock()
            .map(|s| s.values().cloned().collect())
            .unwrap_or_default()
    }

    fn lock_sessions(&self) -> Result<std::sync::MutexGuard<'_, HashMap<String, InteractiveSessionInfo>>, String> {
        self.sessions
            .lock()
            .map_err(|_| "Interactive session lock poisoned".to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_session(id: &str, cli: AgentCli) -> InteractiveSessionInfo {
        InteractiveSessionInfo {
            id: id.to_string(),
            pty_id: format!("pty-{}", id),
            cli,
            status: "idle".to_string(),
            model: "sonnet".to_string(),
            initial_prompt: None,
            cwd: "/tmp".to_string(),
            worktree_branch: None,
            worktree_path: None,
            repo_path: None,
            cost: 0.0,
            tokens_used: 0,
            started_at: 0,
        }
    }

    #[test]
    fn register_and_list() {
        let mgr = InteractiveSessionManager::new();
        mgr.register(make_session("s1", AgentCli::Claude)).unwrap();
        mgr.register(make_session("s2", AgentCli::Gemini)).unwrap();
        assert_eq!(mgr.list().len(), 2);
    }

    #[test]
    fn update_status_and_usage() {
        let mgr = InteractiveSessionManager::new();
        mgr.register(make_session("s1", AgentCli::Claude)).unwrap();

        mgr.update_status("s1", "coding").unwrap();
        mgr.update_usage("s1", 0.42, 5000).unwrap();

        let s = mgr.get("s1").unwrap().unwrap();
        assert_eq!(s.status, "coding");
        assert_eq!(s.cost, 0.42);
        assert_eq!(s.tokens_used, 5000);
    }

    #[test]
    fn unregister_returns_session() {
        let mgr = InteractiveSessionManager::new();
        mgr.register(make_session("s1", AgentCli::Codex)).unwrap();

        let removed = mgr.unregister("s1").unwrap();
        assert!(removed.is_some());
        assert_eq!(mgr.list().len(), 0);
    }

    #[test]
    fn cli_from_model() {
        assert_eq!(AgentCli::from_model("codex-mini"), AgentCli::Codex);
        assert_eq!(AgentCli::from_model("gemini-2.5-pro"), AgentCli::Gemini);
        assert_eq!(AgentCli::from_model("opus"), AgentCli::Claude);
        assert_eq!(AgentCli::from_model("sonnet"), AgentCli::Claude);
    }

    #[test]
    fn program_and_args_claude_with_model() {
        let cli = AgentCli::Claude;
        let (prog, args) = cli.program_and_args(Some("opus"));
        assert_eq!(prog, "claude");
        assert_eq!(args, vec!["--model", "opus"]);
    }

    #[test]
    fn program_and_args_claude_no_model() {
        let cli = AgentCli::Claude;
        let (prog, args) = cli.program_and_args(None);
        assert_eq!(prog, "claude");
        assert!(args.is_empty());
    }

    #[test]
    fn program_and_args_custom() {
        let cli = AgentCli::Custom("my-agent".to_string());
        let (prog, args) = cli.program_and_args(None);
        assert_eq!(prog, "my-agent");
        assert!(args.is_empty());
    }

    #[test]
    fn update_nonexistent_session_is_noop() {
        let mgr = InteractiveSessionManager::new();
        // Should not error, just no-op
        mgr.update_status("nonexistent", "coding").unwrap();
        mgr.update_usage("nonexistent", 1.0, 100).unwrap();
        assert!(mgr.get("nonexistent").unwrap().is_none());
    }

    #[test]
    fn unregister_nonexistent_returns_none() {
        let mgr = InteractiveSessionManager::new();
        let removed = mgr.unregister("nope").unwrap();
        assert!(removed.is_none());
    }

    #[test]
    fn concurrent_access() {
        use std::sync::Arc;
        use std::thread;

        let mgr = Arc::new(InteractiveSessionManager::new());
        let mut handles = vec![];

        for i in 0..10 {
            let mgr = mgr.clone();
            handles.push(thread::spawn(move || {
                let id = format!("s{}", i);
                mgr.register(make_session(&id, AgentCli::Claude)).unwrap();
                mgr.update_status(&id, "coding").unwrap();
                mgr.update_usage(&id, 0.1 * i as f64, i * 100).unwrap();
            }));
        }

        for h in handles {
            h.join().unwrap();
        }

        assert_eq!(mgr.list().len(), 10);
    }
}
