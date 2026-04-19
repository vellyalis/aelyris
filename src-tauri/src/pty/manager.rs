use portable_pty::{native_pty_system, CommandBuilder, PtyPair, PtySize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};
use std::time::Instant;
use uuid::Uuid;

use super::error::PtyError;
use super::shell::ShellType;

/// A single PTY instance with its reader/writer and metadata
struct PtyInstance {
    pair: PtyPair,
    writer: Box<dyn Write + Send>,
    shell_type: ShellType,
    cwd: String,
    spawned_at: Instant,
}

/// Info about an active terminal, safe to serialize and send to frontend
#[derive(Debug, Clone, serde::Serialize)]
pub struct TerminalInfo {
    pub id: String,
    pub shell_type: ShellType,
    pub cwd: String,
    pub uptime_secs: u64,
}

/// Manages multiple PTY sessions.
///
/// Cloning is cheap — internal state is `Arc<Mutex<...>>` so all clones share
/// the same session map. Used by `api::serve` to share ownership with the
/// external HTTP/WS server without going through Tauri's managed state.
#[derive(Clone)]
pub struct PtyManager {
    instances: Arc<Mutex<HashMap<String, PtyInstance>>>,
}

impl PtyManager {
    pub fn new() -> Self {
        Self {
            instances: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// Spawn a new PTY session for a shell, returns the terminal ID
    pub fn spawn(
        &self,
        shell: &ShellType,
        cols: u16,
        rows: u16,
        cwd: Option<&str>,
    ) -> Result<String, String> {
        let program = shell.program().to_string();
        let args: Vec<String> = shell.args().into_iter().map(|s| s.to_string()).collect();
        let mut env = std::collections::HashMap::new();
        env.insert("AETHER_SHELL".to_string(), program.clone());

        let id = self.spawn_command(&program, &args, cols, rows, cwd, Some(env))?;
        log::info!("Spawned terminal {} ({:?})", id, shell);
        Ok(id)
    }

    /// Spawn a PTY running an arbitrary command (shell, AI CLI, or any program).
    /// Returns the terminal ID. Used by both shell spawning and interactive agent sessions.
    pub fn spawn_command(
        &self,
        program: &str,
        args: &[String],
        cols: u16,
        rows: u16,
        cwd: Option<&str>,
        extra_env: Option<std::collections::HashMap<String, String>>,
    ) -> Result<String, String> {
        let id = Uuid::new_v4().to_string();
        let pty_system = native_pty_system();
        let size = PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        };

        let pair = pty_system
            .openpty(size)
            .map_err(|e| format!("Failed to open PTY: {}", e))?;

        let mut cmd = CommandBuilder::new(program);
        for arg in args {
            cmd.arg(arg);
        }

        let resolved_cwd = cwd.unwrap_or(".").to_string();
        cmd.cwd(&resolved_cwd);

        // Inject Aether metadata
        cmd.env("AETHER_TERMINAL_ID", &id);
        cmd.env("AETHER_PROJECT", &resolved_cwd);

        // Extra environment variables (e.g. AETHER_SHELL for shells, model info for agents)
        if let Some(envs) = &extra_env {
            for (k, v) in envs {
                cmd.env(k, v);
            }
        }

        pair.slave
            .spawn_command(cmd)
            .map_err(|e| format!("Failed to spawn command '{}': {}", program, e))?;

        let writer = pair
            .master
            .take_writer()
            .map_err(|e| format!("Failed to get PTY writer: {}", e))?;

        let instance = PtyInstance {
            pair,
            writer,
            shell_type: ShellType::PowerShell, // placeholder for non-shell commands
            cwd: resolved_cwd,
            spawned_at: Instant::now(),
        };

        self.lock_instances()?
            .insert(id.clone(), instance);

        Ok(id)
    }

    /// Write input data to a PTY
    pub fn write(&self, id: &str, data: &[u8]) -> Result<(), String> {
        let mut instances = self.lock_instances()?;

        let instance = instances
            .get_mut(id)
            .ok_or_else(|| PtyError::NotFound(id.to_string()).to_string())?;

        instance
            .writer
            .write_all(data)
            .map_err(|e| format!("Write error: {}", e))?;

        Ok(())
    }

    /// Get a reader for a PTY (for streaming output via events).
    ///
    /// Despite the name, this **clones** the master PTY's reader — it does
    /// not consume or remove it — so multiple callers (Tauri UI + external
    /// API) can read the same session concurrently. The lock is held for
    /// the duration of the clone syscall; on Windows this is cheap.
    pub fn take_reader(&self, id: &str) -> Result<Box<dyn Read + Send>, PtyError> {
        let instances = self.lock_instances()?;

        let instance = instances
            .get(id)
            .ok_or_else(|| PtyError::NotFound(id.to_string()))?;

        instance
            .pair
            .master
            .try_clone_reader()
            .map_err(|e| PtyError::Other(format!("clone reader: {}", e)))
    }

    /// Resize a PTY. Typed errors so callers can distinguish NotFound from
    /// a real failure without string-matching.
    pub fn resize(&self, id: &str, cols: u16, rows: u16) -> Result<(), PtyError> {
        let instances = self.lock_instances()?;

        let instance = instances
            .get(id)
            .ok_or_else(|| PtyError::NotFound(id.to_string()))?;

        instance
            .pair
            .master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| PtyError::Other(format!("resize: {}", e)))
    }

    /// Close and remove a PTY session.
    pub fn close(&self, id: &str) -> Result<(), PtyError> {
        self.lock_instances()?
            .remove(id)
            .ok_or_else(|| PtyError::NotFound(id.to_string()))?;

        log::info!("Closed terminal {}", id);
        Ok(())
    }

    /// List active terminal IDs (sorted by spawn time, newest first)
    pub fn list(&self) -> Vec<String> {
        self.instances
            .lock()
            .map(|i| {
                let mut entries: Vec<_> = i.iter().map(|(id, inst)| (id.clone(), inst.spawned_at)).collect();
                entries.sort_by(|a, b| b.1.cmp(&a.1)); // newest first
                entries.into_iter().map(|(id, _)| id).collect()
            })
            .unwrap_or_default()
    }

    /// List active terminals with metadata
    pub fn list_info(&self) -> Vec<TerminalInfo> {
        self.instances
            .lock()
            .map(|instances| {
                instances
                    .iter()
                    .map(|(id, inst)| TerminalInfo {
                        id: id.clone(),
                        shell_type: inst.shell_type.clone(),
                        cwd: inst.cwd.clone(),
                        uptime_secs: inst.spawned_at.elapsed().as_secs(),
                    })
                    .collect()
            })
            .unwrap_or_default()
    }

    /// Close all PTY sessions. Called explicitly from the app-exit hook.
    ///
    /// We deliberately do **not** hook this into `Drop`: `PtyManager` is
    /// `Clone`, and every clone goes through `Drop` when it leaves scope —
    /// so a drop-driven `close_all` would wipe the shared session map every
    /// time a handler's `State<_>` extraction was released.
    pub fn close_all(&self) {
        if let Ok(mut instances) = self.instances.lock() {
            let count = instances.len();
            instances.clear();
            log::info!("Closed {} PTY sessions", count);
        }
    }

    fn lock_instances(&self) -> Result<std::sync::MutexGuard<'_, HashMap<String, PtyInstance>>, PtyError> {
        self.instances.lock().map_err(|_| PtyError::LockPoisoned)
    }
}
