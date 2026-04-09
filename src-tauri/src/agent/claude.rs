use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentSessionInfo {
    pub id: String,
    pub status: String,
    pub model: String,
    pub prompt: String,
    pub cwd: String,
    pub cost: f64,
    pub tokens_used: u64,
}

struct AgentProcess {
    child: Child,
    info: AgentSessionInfo,
}

#[derive(Clone)]
pub struct AgentManager {
    sessions: Arc<Mutex<HashMap<String, AgentProcess>>>,
}

impl AgentManager {
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// Start a Claude Code headless session
    pub fn start_session(
        &self,
        prompt: &str,
        cwd: &str,
        model: Option<&str>,
        allowed_tools: Option<Vec<String>>,
    ) -> Result<String, String> {
        let id = Uuid::new_v4().to_string();
        let model_str = model.unwrap_or("sonnet");

        // Route to different CLI based on model provider
        let (cli_cmd, cli_args) = if model_str.starts_with("codex") {
            ("codex", vec!["-p".to_string(), prompt.to_string()])
        } else if model_str.starts_with("gemini") {
            ("gemini", vec!["-p".to_string(), prompt.to_string()])
        } else {
            ("claude", vec![
                "-p".to_string(), prompt.to_string(),
                "--output-format".to_string(), "stream-json".to_string(),
                "--verbose".to_string(),
                "--model".to_string(), model_str.to_string(),
            ])
        };

        let mut cmd = Command::new(cli_cmd);
        for arg in &cli_args {
            cmd.arg(arg);
        }
        cmd.current_dir(cwd)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        if let Some(tools) = &allowed_tools {
            if cli_cmd == "claude" {
                cmd.arg("--allowedTools").arg(tools.join(","));
            }
        }

        let child = cmd
            .spawn()
            .map_err(|e| format!("Failed to start {}: {}", cli_cmd, e))?;

        let info = AgentSessionInfo {
            id: id.clone(),
            status: "thinking".to_string(),
            model: model_str.to_string(),
            prompt: prompt.to_string(),
            cwd: cwd.to_string(),
            cost: 0.0,
            tokens_used: 0,
        };

        self.sessions
            .lock()
            .map_err(|e| format!("Lock error: {}", e))?
            .insert(id.clone(), AgentProcess { child, info });

        Ok(id)
    }

    /// Read streaming output from a session (call in a loop from a thread)
    pub fn take_stdout(&self, id: &str) -> Result<BufReader<std::process::ChildStdout>, String> {
        let mut sessions = self
            .sessions
            .lock()
            .map_err(|e| format!("Lock error: {}", e))?;

        let process = sessions
            .get_mut(id)
            .ok_or_else(|| format!("Session {} not found", id))?;

        process
            .child
            .stdout
            .take()
            .map(BufReader::new)
            .ok_or_else(|| "Stdout already taken".to_string())
    }

    /// Update session status
    pub fn update_status(&self, id: &str, status: &str) -> Result<(), String> {
        let mut sessions = self
            .sessions
            .lock()
            .map_err(|e| format!("Lock error: {}", e))?;
        if let Some(proc) = sessions.get_mut(id) {
            proc.info.status = status.to_string();
        }
        Ok(())
    }

    /// Update session cost/tokens
    pub fn update_usage(&self, id: &str, cost: f64, tokens: u64) -> Result<(), String> {
        let mut sessions = self
            .sessions
            .lock()
            .map_err(|e| format!("Lock error: {}", e))?;
        if let Some(proc) = sessions.get_mut(id) {
            proc.info.cost = cost;
            proc.info.tokens_used = tokens;
        }
        Ok(())
    }

    /// Stop a session
    pub fn stop_session(&self, id: &str) -> Result<(), String> {
        let mut sessions = self
            .sessions
            .lock()
            .map_err(|e| format!("Lock error: {}", e))?;
        if let Some(mut proc) = sessions.remove(id) {
            let _ = proc.child.kill();
        }
        Ok(())
    }

    /// List all sessions
    pub fn list_sessions(&self) -> Vec<AgentSessionInfo> {
        self.sessions
            .lock()
            .map(|s| s.values().map(|p| p.info.clone()).collect())
            .unwrap_or_default()
    }

    /// Kill all agent sessions (called on app exit)
    pub fn stop_all(&self) {
        if let Ok(mut sessions) = self.sessions.lock() {
            for (_, mut proc) in sessions.drain() {
                let _ = proc.child.kill();
            }
            log::info!("Stopped all agent sessions");
        }
    }
}

impl Drop for AgentManager {
    fn drop(&mut self) {
        self.stop_all();
    }
}
