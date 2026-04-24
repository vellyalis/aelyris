use portable_pty::{native_pty_system, CommandBuilder, PtyPair, PtySize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Instant;
use tokio::sync::broadcast;
use uuid::Uuid;

use super::error::PtyError;
use super::shell::ShellType;

/// Broadcast channel capacity per PTY. Sized for burst safety: at 4 KiB per
/// chunk this is ~4 MiB of backlog before a slow subscriber starts lagging.
const OUTPUT_BROADCAST_CAPACITY: usize = 1024;

/// A single PTY instance with its reader/writer and metadata
struct PtyInstance {
    pair: PtyPair,
    writer: Box<dyn Write + Send>,
    shell_type: ShellType,
    cwd: String,
    spawned_at: Instant,
    /// Fan-out sender for master PTY output. A single OS-level reader thread
    /// owned by this instance feeds every subscriber through this channel,
    /// so Tauri UI and the external API can read the same byte stream
    /// without racing for bytes on the physical master.
    output_tx: broadcast::Sender<Vec<u8>>,
    /// Shutdown signal for the reader thread. Cleared in `Drop` so the
    /// thread exits on its next read boundary instead of running until the
    /// child process happens to close master. Belt-and-suspenders on top of
    /// the master-drop EOF path — matters when a child lingers (e.g. a
    /// Windows cmd.exe that never got `exit`) after the `PtyInstance` has
    /// already left the session map.
    reader_alive: Arc<AtomicBool>,
}

impl Drop for PtyInstance {
    fn drop(&mut self) {
        self.reader_alive.store(false, Ordering::Release);
    }
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

        // Clone the master reader once, before insertion, so a failure here
        // surfaces as a spawn error rather than a half-constructed session.
        let reader = pair
            .master
            .try_clone_reader()
            .map_err(|e| format!("Failed to clone PTY reader: {}", e))?;

        let (output_tx, _initial_rx) = broadcast::channel::<Vec<u8>>(OUTPUT_BROADCAST_CAPACITY);

        // Drop the initial receiver so the channel is empty-consumer until the
        // first subscribe_output call. Keeping the Sender alive in the
        // PtyInstance plus the Sender clone the reader thread holds is all
        // that's needed — Receivers are created lazily by subscribers.
        drop(_initial_rx);

        let reader_alive = Arc::new(AtomicBool::new(true));
        spawn_reader_thread(id.clone(), reader, output_tx.clone(), reader_alive.clone());

        let instance = PtyInstance {
            pair,
            writer,
            shell_type: ShellType::PowerShell, // placeholder for non-shell commands
            cwd: resolved_cwd,
            spawned_at: Instant::now(),
            output_tx,
            reader_alive,
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

    /// Subscribe to a PTY's output stream.
    ///
    /// Returns a fresh `broadcast::Receiver` on every call. A single
    /// OS-level reader thread, spawned when the PTY starts, fans out master
    /// bytes to every subscriber, so UI and API can read the same byte
    /// stream without racing each other on the physical master.
    ///
    /// Slow subscribers may observe `RecvError::Lagged(n)` when the
    /// capacity-[`OUTPUT_BROADCAST_CAPACITY`] ring overwrites unread chunks.
    /// Callers pick their own policy (e.g. the API surfaces a sentinel,
    /// the UI drops silently).
    pub fn subscribe_output(&self, id: &str) -> Result<broadcast::Receiver<Vec<u8>>, PtyError> {
        let instances = self.lock_instances()?;

        let instance = instances
            .get(id)
            .ok_or_else(|| PtyError::NotFound(id.to_string()))?;

        Ok(instance.output_tx.subscribe())
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

/// Spawn the single OS-level reader thread for a PTY.
///
/// Runs on a plain `std::thread` because `Read::read` on the portable-pty
/// master is blocking and must not park a tokio worker. The thread exits
/// when any of the following is true:
///   1. `reader.read` returns `Ok(0)` or an error (normal EOF path — the
///      owning `PtyInstance` dropped, which closed master, which signals
///      the child to exit).
///   2. `reader_alive` flips to `false`. `Drop for PtyInstance` sets this
///      after the instance leaves the session map, so a child that lingers
///      past teardown cannot keep the thread and its broadcast backlog
///      alive. The check happens after each chunk — in-flight reads still
///      need to complete, but no further chunks will be published once the
///      flag is down.
///
/// `send` failures are intentionally ignored: during the gap between
/// `spawn_command` returning and the first `subscribe_output`, there are
/// no receivers, so bytes would otherwise pile up in the OS pipe buffer
/// until the child process blocks on write. Draining the pipe into the
/// broadcast channel (and letting the channel drop bytes on the floor when
/// no one is listening) keeps the child unblocked.
fn spawn_reader_thread(
    id: String,
    mut reader: Box<dyn Read + Send>,
    tx: broadcast::Sender<Vec<u8>>,
    reader_alive: Arc<AtomicBool>,
) {
    std::thread::spawn(move || {
        let mut buf = [0u8; 4096];
        loop {
            if !reader_alive.load(Ordering::Acquire) {
                log::debug!("pty {} reader signalled to stop", id);
                break;
            }
            match reader.read(&mut buf) {
                Ok(0) => {
                    log::debug!("pty {} reader EOF", id);
                    break;
                }
                Ok(n) => {
                    // `send` returns Err when there are no active receivers;
                    // that's expected (see doc comment) and not an error.
                    let _ = tx.send(buf[..n].to_vec());
                }
                Err(e) => {
                    log::debug!("pty {} reader error: {}", id, e);
                    break;
                }
            }
        }
    });
}
