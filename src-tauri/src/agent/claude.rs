use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::BufReader;
use std::process::{Child, Stdio};
use std::sync::{Arc, Mutex};
use uuid::Uuid;

use super::platform_cli_program;

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
        resume_id: Option<&str>,
    ) -> Result<String, String> {
        let id = Uuid::new_v4().to_string();
        let model_str = model.unwrap_or("sonnet");

        // Route to different CLI based on model provider
        let (cli_name, mut cli_args) = if model_str.starts_with("codex") {
            ("codex", vec!["-p".to_string(), prompt.to_string()])
        } else if model_str.starts_with("gemini") {
            ("gemini", vec!["-p".to_string(), prompt.to_string()])
        } else {
            let mut args = vec![
                "-p".to_string(),
                prompt.to_string(),
                "--output-format".to_string(),
                "stream-json".to_string(),
                "--verbose".to_string(),
                "--model".to_string(),
                model_str.to_string(),
            ];

            // Resume existing session if requested
            if let Some(sid) = resume_id {
                args.push("--resume".to_string());
                args.push(sid.to_string());
            }

            ("claude", args)
        };
        let cli_cmd = platform_cli_program(cli_name);

        // Allowed tools
        if let Some(tools) = &allowed_tools {
            if cli_name == "claude" {
                cli_args.push("--allowedTools".to_string());
                cli_args.push(tools.join(","));
            }
        }

        let mut cmd = crate::process::hidden_command(&cli_cmd);
        for arg in &cli_args {
            cmd.arg(arg);
        }
        cmd.current_dir(cwd)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

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

        self.lock_sessions()?
            .insert(id.clone(), AgentProcess { child, info });

        log::info!("Started agent session {} (model: {})", id, model_str);
        Ok(id)
    }

    /// Read streaming output from a session
    pub fn take_stdout(&self, id: &str) -> Result<BufReader<std::process::ChildStdout>, String> {
        let mut sessions = self.lock_sessions()?;

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

    /// Read stderr from a session (for error logging)
    pub fn take_stderr(&self, id: &str) -> Result<BufReader<std::process::ChildStderr>, String> {
        let mut sessions = self.lock_sessions()?;

        let process = sessions
            .get_mut(id)
            .ok_or_else(|| format!("Session {} not found", id))?;

        process
            .child
            .stderr
            .take()
            .map(BufReader::new)
            .ok_or_else(|| "Stderr already taken".to_string())
    }

    /// Update session status
    pub fn update_status(&self, id: &str, status: &str) -> Result<(), String> {
        let mut sessions = self.lock_sessions()?;
        if let Some(proc) = sessions.get_mut(id) {
            proc.info.status = status.to_string();
        }
        Ok(())
    }

    /// Update session cost/tokens
    pub fn update_usage(&self, id: &str, cost: f64, tokens: u64) -> Result<(), String> {
        let mut sessions = self.lock_sessions()?;
        if let Some(proc) = sessions.get_mut(id) {
            proc.info.cost = cost;
            proc.info.tokens_used = tokens;
        }
        Ok(())
    }

    /// Reap a naturally exited child while keeping its session metadata visible.
    pub fn reap_session(&self, id: &str) -> Result<(), String> {
        let mut sessions = self.lock_sessions()?;
        if let Some(proc) = sessions.get_mut(id) {
            if proc
                .child
                .try_wait()
                .map_err(|e| format!("Failed to reap session {}: {}", id, e))?
                .is_some()
            {
                log::info!("Reaped completed agent session {}", id);
            }
        }
        Ok(())
    }

    /// Stop a session, killing the entire process tree on Windows
    pub fn stop_session(&self, id: &str) -> Result<(), String> {
        let mut sessions = self.lock_sessions()?;
        if let Some(mut proc) = sessions.remove(id) {
            let pid = proc.child.id();
            // Try process tree kill first (Windows)
            if let Err(e) = kill_process_tree(pid) {
                log::warn!(
                    "taskkill failed for PID {}: {}. Falling back to child.kill().",
                    pid,
                    e
                );
                let _ = proc.child.kill();
            }
            let _ = proc.child.wait();
            log::info!("Stopped agent session {}", id);
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
            for (id, mut proc) in sessions.drain() {
                let pid = proc.child.id();
                if kill_process_tree(pid).is_err() {
                    let _ = proc.child.kill();
                }
                let _ = proc.child.wait();
                log::info!("Stopped agent session {} (cleanup)", id);
            }
        }
    }

    fn lock_sessions(
        &self,
    ) -> Result<std::sync::MutexGuard<'_, HashMap<String, AgentProcess>>, String> {
        self.sessions
            .lock()
            .map_err(|_| "Agent session lock poisoned".to_string())
    }
}

impl Default for AgentManager {
    fn default() -> Self {
        Self::new()
    }
}

impl Drop for AgentManager {
    fn drop(&mut self) {
        self.stop_all();
    }
}

/// Kill an entire process tree on Windows using taskkill /T /F
fn kill_process_tree(pid: u32) -> Result<(), String> {
    let output = crate::process::hidden_command("taskkill")
        .args(["/T", "/F", "/PID", &pid.to_string()])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .output()
        .map_err(|e| format!("taskkill spawn failed: {}", e))?;

    if output.status.success() {
        Ok(())
    } else {
        Err(format!("taskkill exited with status {}", output.status))
    }
}
