use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::BufReader;
use std::process::{Child, Stdio};
use std::sync::{Arc, Mutex};
use uuid::Uuid;

use super::platform_cli_program;

/// What an agent is doing right now, for real-time fleet awareness (BR5): which
/// file/symbol it is touching and the action. Peers read this (via
/// `agent.activity` / `fleet_status`) to coordinate without screen-scraping.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentActivity {
    /// e.g. "editing", "reading", "running tests", "designing".
    pub action: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub file: Option<String>,
    /// Function/class/module currently in focus, if known.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub symbol: Option<String>,
    pub updated_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentSessionInfo {
    pub id: String,
    pub status: String,
    pub model: String,
    pub prompt: String,
    pub cwd: String,
    pub cost: f64,
    pub tokens_used: u64,
    pub started_at: u64,
    /// Task Graph node this agent implements, set when the autonomy loop
    /// dispatches it. Lets the loop's completion sensor map a finished process
    /// back to the task it should move into review (BR9).
    #[serde(default)]
    pub task_id: Option<String>,
    /// What this agent is doing right now (real-time fleet awareness, BR5).
    #[serde(default)]
    pub current_activity: Option<AgentActivity>,
}

struct AgentProcess {
    child: Child,
    info: AgentSessionInfo,
}

/// Split result of a completion poll (BR9 recovery): which dispatched tasks'
/// agents finished cleanly vs. crashed since the last poll. The loop advances
/// `succeeded` into review and routes `failed` back for reassignment so a dead
/// worker never silently drops its task.
#[derive(Debug, Default, Clone)]
pub struct ReapOutcome {
    pub succeeded: Vec<String>,
    pub failed: Vec<String>,
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
            started_at: now_secs(),
            task_id: None,
            current_activity: None,
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

    /// Tag a session with the Task Graph node it implements. Set by the autonomy
    /// loop's dispatcher right after spawning so the completion sensor can map a
    /// finished process back to its task.
    pub fn set_task(&self, id: &str, task_id: &str) -> Result<(), String> {
        let mut sessions = self.lock_sessions()?;
        if let Some(proc) = sessions.get_mut(id) {
            proc.info.task_id = Some(task_id.to_string());
        }
        Ok(())
    }

    /// Set what a session is doing right now (real-time fleet awareness, BR5).
    /// Reported by the orchestrator on the agent's behalf (or by an MCP-aware
    /// agent), read by peers via `agent.activity` / `fleet_status`.
    pub fn set_activity(
        &self,
        id: &str,
        action: String,
        file: Option<String>,
        symbol: Option<String>,
    ) -> Result<(), String> {
        let mut sessions = self.lock_sessions()?;
        if let Some(proc) = sessions.get_mut(id) {
            proc.info.current_activity = Some(AgentActivity {
                action,
                file,
                symbol,
                updated_at: now_secs(),
            });
        }
        Ok(())
    }

    /// Completion sensor (BR9): detect sessions whose child process has exited
    /// since the last poll, splitting them by exit status — a clean exit (code 0)
    /// is a `succeeded` task (-> review), a non-zero exit / crash is a `failed`
    /// task (-> recovery/reassign). Marks each session `done`/`failed` so it is
    /// reported at most once. This is what lets the loop both advance finished
    /// work and recover a dead worker rather than losing the task.
    pub fn reap(&self) -> ReapOutcome {
        let mut outcome = ReapOutcome::default();
        let Ok(mut sessions) = self.sessions.lock() else {
            return outcome;
        };
        for proc in sessions.values_mut() {
            if proc.info.status == "done" || proc.info.status == "failed" {
                continue;
            }
            if let Ok(Some(exit)) = proc.child.try_wait() {
                let succeeded = exit.success();
                proc.info.status = if succeeded { "done" } else { "failed" }.to_string();
                if let Some(task_id) = &proc.info.task_id {
                    if succeeded {
                        outcome.succeeded.push(task_id.clone());
                    } else {
                        outcome.failed.push(task_id.clone());
                    }
                }
            }
        }
        outcome
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
        // AgentManager is `Clone` and clones share the session map via `Arc`
        // (e.g. the API/MCP `ApiState` is cloned per request). Only tear the
        // sessions down when the LAST handle is dropped (app exit) — otherwise a
        // clone dropping at the end of a request would kill every live agent.
        if Arc::strong_count(&self.sessions) == 1 {
            self.stop_all();
        }
    }
}

fn now_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
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

#[cfg(test)]
#[cfg(windows)]
mod reap_tests {
    use super::*;
    use std::process::Stdio;
    use std::time::{Duration, Instant};

    fn spawn_exit(code: &str) -> Child {
        crate::process::hidden_command("cmd")
            .args(["/c", "exit", code])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("spawn cmd")
    }

    fn insert(mgr: &AgentManager, id: &str, task_id: &str, child: Child) {
        let info = AgentSessionInfo {
            id: id.to_string(),
            status: "running".to_string(),
            model: "test".to_string(),
            prompt: String::new(),
            cwd: String::new(),
            cost: 0.0,
            tokens_used: 0,
            started_at: 0,
            task_id: Some(task_id.to_string()),
            current_activity: None,
        };
        mgr.sessions
            .lock()
            .unwrap()
            .insert(id.to_string(), AgentProcess { child, info });
    }

    /// Behavioral proof of the crash-vs-success completion sensor the loop relies
    /// on for recovery (⑦): `reap()` must split exits by code — a clean exit (0)
    /// is `succeeded`, a non-zero exit is `failed`. The loop logic itself is
    /// tested with fakes that bypass `reap`, so without this test a broken split
    /// (e.g. always-succeeded) would ship with no failing cargo test.
    #[test]
    fn reap_splits_clean_and_crashed_exits_by_code() {
        let mgr = AgentManager::new();
        insert(&mgr, "s-ok", "task-ok", spawn_exit("0"));
        insert(&mgr, "s-bad", "task-bad", spawn_exit("1"));

        // The trivial children exit near-instantly; poll until reap observes both
        // (bounded so a hang can't wedge the suite).
        let deadline = Instant::now() + Duration::from_secs(10);
        let mut succeeded = Vec::new();
        let mut failed = Vec::new();
        while (succeeded.is_empty() || failed.is_empty()) && Instant::now() < deadline {
            let out = mgr.reap();
            succeeded.extend(out.succeeded);
            failed.extend(out.failed);
            std::thread::sleep(Duration::from_millis(5));
        }
        assert_eq!(succeeded, ["task-ok"], "clean exit (0) -> succeeded");
        assert_eq!(failed, ["task-bad"], "crash (non-zero) -> failed");

        // Idempotent: a reaped session is never reported twice.
        let again = mgr.reap();
        assert!(again.succeeded.is_empty() && again.failed.is_empty());

        // Sessions are marked terminally so the UI/fleet reflects the outcome.
        let statuses: HashMap<String, String> = mgr
            .list_sessions()
            .into_iter()
            .map(|s| (s.id, s.status))
            .collect();
        assert_eq!(statuses["s-ok"], "done");
        assert_eq!(statuses["s-bad"], "failed");
    }
}
