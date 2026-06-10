use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

/// Resolve a CLI command name to the Windows shim that CreateProcess can run.
///
/// npm-style packages often install both an extensionless Unix shim and a
/// `.cmd` shim on Windows. `CreateProcessW` can pick the extensionless file and
/// fail with ERROR_BAD_EXE_FORMAT, so prefer native launcher extensions when
/// they are present on PATH.
pub fn platform_cli_program(name: &str) -> String {
    #[cfg(windows)]
    {
        if has_windows_executable_extension(name) {
            return name.to_string();
        }

        if let Some(candidate) = resolve_windows_cli_program(name) {
            return candidate;
        }
    }

    name.to_string()
}

#[cfg(windows)]
fn has_windows_executable_extension(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    lower.ends_with(".cmd") || lower.ends_with(".exe") || lower.ends_with(".bat")
}

#[cfg(windows)]
fn resolve_windows_cli_program(name: &str) -> Option<String> {
    let command_path = std::path::Path::new(name);
    if command_path.components().count() > 1 {
        return command_path.is_file().then(|| name.to_string());
    }

    let path = std::env::var_os("PATH")?;
    resolve_windows_cli_program_on_path(name, &path)
}

#[cfg(windows)]
fn resolve_windows_cli_program_on_path(name: &str, path: &std::ffi::OsStr) -> Option<String> {
    for dir in std::env::split_paths(path) {
        // Respect PATH directory order first. Inside a directory, prefer a
        // native executable over npm's .cmd shim when both exist; broken npm
        // wrappers should not mask a healthy CLI binary earlier on PATH.
        for ext in ["exe", "cmd", "bat"] {
            let candidate = format!("{name}.{ext}");
            if dir.join(&candidate).is_file() {
                return Some(candidate);
            }
        }
        if dir.join(name).is_file() {
            return Some(name.to_string());
        }
    }
    None
}

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
                (platform_cli_program("claude"), args)
            }
            AgentCli::Gemini => {
                // Gemini CLI interactive mode
                (platform_cli_program("gemini"), Vec::new())
            }
            AgentCli::Codex => {
                // OpenAI Codex CLI
                (platform_cli_program("codex"), Vec::new())
            }
            AgentCli::Custom(bin) => (platform_cli_program(bin), Vec::new()),
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
                    Err(format!(
                        "Unknown CLI '{}'. Allowed: {:?}",
                        bin, ALLOWED_CUSTOM
                    ))
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
    pub backend: String,
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

impl Default for InteractiveSessionManager {
    fn default() -> Self {
        Self::new()
    }
}

impl InteractiveSessionManager {
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// Register a new interactive session
    pub fn register(&self, info: InteractiveSessionInfo) -> Result<(), String> {
        log::info!(
            "interactive session register id={} cli={:?} model={}",
            info.id,
            info.cli,
            info.model
        );
        self.lock_sessions()?.insert(info.id.clone(), info);
        Ok(())
    }

    /// Remove a session
    pub fn unregister(&self, id: &str) -> Result<Option<InteractiveSessionInfo>, String> {
        let removed = self.lock_sessions()?.remove(id);
        if let Some(ref info) = removed {
            log::info!(
                "interactive session unregister id={} cost=${:.2} tokens={}",
                info.id,
                info.cost,
                info.tokens_used,
            );
        }
        Ok(removed)
    }

    /// Get a single session's info
    pub fn get(&self, id: &str) -> Result<Option<InteractiveSessionInfo>, String> {
        Ok(self.lock_sessions()?.get(id).cloned())
    }

    /// Update session status (e.g. "thinking", "coding", "idle", "done")
    pub fn update_status(&self, id: &str, status: &str) -> Result<(), String> {
        let mut sessions = self.lock_sessions()?;
        let session = sessions
            .get_mut(id)
            .ok_or_else(|| format!("Interactive session not found for status update: {id}"))?;
        if session.status != status {
            log::debug!(
                "interactive session id={} status {} -> {}",
                id,
                session.status,
                status,
            );
        }
        session.status = status.to_string();
        Ok(())
    }

    /// Update cost and token usage
    pub fn update_usage(&self, id: &str, cost: f64, tokens: u64) -> Result<(), String> {
        let mut sessions = self.lock_sessions()?;
        let session = sessions
            .get_mut(id)
            .ok_or_else(|| format!("Interactive session not found for usage update: {id}"))?;
        session.cost = cost;
        session.tokens_used = tokens;
        Ok(())
    }

    /// List all sessions
    pub fn list(&self) -> Result<Vec<InteractiveSessionInfo>, String> {
        Ok(self.lock_sessions()?.values().cloned().collect())
    }

    fn lock_sessions(
        &self,
    ) -> Result<std::sync::MutexGuard<'_, HashMap<String, InteractiveSessionInfo>>, String> {
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
            backend: "sidecar".to_string(),
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
        assert_eq!(mgr.list().unwrap().len(), 2);
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
        assert_eq!(mgr.list().unwrap().len(), 0);
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
        assert_eq!(prog, platform_cli_program("claude"));
        assert_eq!(args, vec!["--model", "opus"]);
    }

    #[test]
    fn program_and_args_claude_no_model() {
        let cli = AgentCli::Claude;
        let (prog, args) = cli.program_and_args(None);
        assert_eq!(prog, platform_cli_program("claude"));
        assert!(args.is_empty());
    }

    #[test]
    fn program_and_args_codex_uses_platform_program() {
        let cli = AgentCli::Codex;
        let (prog, args) = cli.program_and_args(None);
        assert_eq!(prog, platform_cli_program("codex"));
        assert!(args.is_empty());
    }

    #[cfg(windows)]
    #[test]
    fn windows_cli_resolution_respects_path_order_and_prefers_exe_within_directory() {
        // Inject the PATH value instead of mutating process env: set_var here
        // races with parallel tests that resolve programs via the real PATH.
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!("aether-cli-resolution-{stamp}"));
        let first = root.join("first");
        let second = root.join("second");
        let third = root.join("third");
        std::fs::create_dir_all(&first).unwrap();
        std::fs::create_dir_all(&second).unwrap();
        std::fs::create_dir_all(&third).unwrap();

        let name = format!("aether_cli_resolution_{stamp}");
        std::fs::write(first.join(format!("{name}.cmd")), "").unwrap();
        std::fs::write(second.join(format!("{name}.exe")), "").unwrap();
        std::fs::write(third.join(format!("{name}.cmd")), "").unwrap();
        std::fs::write(third.join(format!("{name}.exe")), "").unwrap();

        let first_then_second = std::env::join_paths([first.as_path(), second.as_path()]).unwrap();
        assert_eq!(
            resolve_windows_cli_program_on_path(&name, &first_then_second),
            Some(format!("{name}.cmd"))
        );

        let third_then_first = std::env::join_paths([third.as_path(), first.as_path()]).unwrap();
        assert_eq!(
            resolve_windows_cli_program_on_path(&name, &third_then_first),
            Some(format!("{name}.exe"))
        );

        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn program_and_args_custom() {
        let cli = AgentCli::Custom("my-agent".to_string());
        let (prog, args) = cli.program_and_args(None);
        assert_eq!(prog, "my-agent");
        assert!(args.is_empty());
    }

    #[test]
    fn update_nonexistent_session_is_visible_error() {
        let mgr = InteractiveSessionManager::new();
        let status_error = mgr.update_status("nonexistent", "coding").unwrap_err();
        let usage_error = mgr.update_usage("nonexistent", 1.0, 100).unwrap_err();
        assert!(status_error.contains("Interactive session not found for status update"));
        assert!(usage_error.contains("Interactive session not found for usage update"));
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

        assert_eq!(mgr.list().unwrap().len(), 10);
    }
}
