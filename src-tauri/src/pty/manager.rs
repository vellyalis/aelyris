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

/// Manages multiple PTY sessions
pub struct PtyManager {
    instances: Arc<Mutex<HashMap<String, PtyInstance>>>,
}

impl PtyManager {
    pub fn new() -> Self {
        Self {
            instances: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// Spawn a new PTY session, returns the terminal ID
    pub fn spawn(
        &self,
        shell: &ShellType,
        cols: u16,
        rows: u16,
        cwd: Option<&str>,
    ) -> Result<String, String> {
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

        let mut cmd = CommandBuilder::new(shell.program());
        for arg in shell.args() {
            cmd.arg(arg);
        }

        let resolved_cwd = cwd.unwrap_or(".").to_string();
        cmd.cwd(&resolved_cwd);

        pair.slave
            .spawn_command(cmd)
            .map_err(|e| format!("Failed to spawn shell: {}", e))?;

        let writer = pair
            .master
            .take_writer()
            .map_err(|e| format!("Failed to get PTY writer: {}", e))?;

        let id = Uuid::new_v4().to_string();
        let instance = PtyInstance {
            pair,
            writer,
            shell_type: shell.clone(),
            cwd: resolved_cwd,
            spawned_at: Instant::now(),
        };

        self.lock_instances()?
            .insert(id.clone(), instance);

        log::info!("Spawned terminal {} ({:?})", id, shell);
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

    /// Get a reader for a PTY (for streaming output via events)
    pub fn take_reader(&self, id: &str) -> Result<Box<dyn Read + Send>, String> {
        let instances = self.lock_instances()?;

        let instance = instances
            .get(id)
            .ok_or_else(|| PtyError::NotFound(id.to_string()).to_string())?;

        instance
            .pair
            .master
            .try_clone_reader()
            .map_err(|e| format!("Failed to clone reader: {}", e))
    }

    /// Resize a PTY
    pub fn resize(&self, id: &str, cols: u16, rows: u16) -> Result<(), String> {
        let instances = self.lock_instances()?;

        let instance = instances
            .get(id)
            .ok_or_else(|| PtyError::NotFound(id.to_string()).to_string())?;

        instance
            .pair
            .master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("Resize error: {}", e))
    }

    /// Close and remove a PTY session
    pub fn close(&self, id: &str) -> Result<(), String> {
        self.lock_instances()?
            .remove(id)
            .ok_or_else(|| PtyError::NotFound(id.to_string()).to_string())?;

        log::info!("Closed terminal {}", id);
        Ok(())
    }

    /// List active terminal IDs
    pub fn list(&self) -> Vec<String> {
        self.instances
            .lock()
            .map(|i| i.keys().cloned().collect())
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

    /// Close all PTY sessions (called on app exit)
    pub fn close_all(&self) {
        if let Ok(mut instances) = self.instances.lock() {
            let count = instances.len();
            instances.clear();
            log::info!("Closed {} PTY sessions", count);
        }
    }

    fn lock_instances(&self) -> Result<std::sync::MutexGuard<'_, HashMap<String, PtyInstance>>, String> {
        self.instances
            .lock()
            .map_err(|_| PtyError::LockPoisoned.to_string())
    }
}

impl Drop for PtyManager {
    fn drop(&mut self) {
        self.close_all();
    }
}
