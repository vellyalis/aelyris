use portable_pty::{native_pty_system, Child, CommandBuilder, PtyPair, PtySize};
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
    /// First receiver kept alive across the spawn-to-subscribe gap. Without
    /// this, a fast shell prompt can be read before UI streaming subscribes,
    /// making the terminal look blank even though the child already started.
    initial_rx: Mutex<Option<broadcast::Receiver<Vec<u8>>>>,
    /// Shutdown signal for the reader thread. Cleared in `Drop` so the
    /// thread exits on its next read boundary instead of running until the
    /// child process happens to close master. Belt-and-suspenders on top of
    /// the master-drop EOF path — matters when a child lingers (e.g. a
    /// Windows cmd.exe that never got `exit`) after the `PtyInstance` has
    /// already left the session map.
    reader_alive: Arc<AtomicBool>,
    /// The child process handle. Wrapped in `Arc<Mutex<Option<>>>` so the
    /// IPC layer can `take_child` exactly once and move the boxed child
    /// onto a dedicated waiter thread that calls `wait()` to surface the
    /// exit code. Stored here (rather than on the IPC side) so `Drop` for
    /// `PtyInstance` is the single owner of teardown — if the waiter
    /// already took it, this is `None` and drop is a no-op for the child.
    child: Arc<Mutex<Option<Box<dyn Child + Send + Sync>>>>,
}

/// Best-effort exit information for a PTY child process.
///
/// `crashed` is a heuristic, not a guarantee:
///   - On Windows, the high two bits of `NTSTATUS` indicate severity; codes
///     `>= 0xC000_0000` correspond to NT_ERROR (segfault / access violation /
///     stack overflow / etc.).
///   - On other platforms we only have the raw exit code, so anything
///     non-zero is *probably* abnormal but we cannot distinguish a clean
///     `exit(1)` from a signal without portable-pty surfacing the signal
///     directly.
#[derive(Debug, Clone, serde::Serialize)]
pub struct ExitInfo {
    pub code: Option<u32>,
    pub crashed: bool,
}

impl ExitInfo {
    /// Classify a portable-pty `ExitStatus`. Returns `crashed = true` when
    /// the exit code looks abnormal (NT_ERROR on Windows, non-zero
    /// elsewhere) — used by the UI to decide between a quiet "shell
    /// exited" message and an attention-grabbing crash banner.
    pub fn from_status(status: &portable_pty::ExitStatus) -> Self {
        let code = status.exit_code();
        let crashed = if cfg!(target_os = "windows") {
            // NT_ERROR severity bits: 0b11 in the top two bits.
            code >= 0xC000_0000
        } else {
            !status.success()
        };
        Self {
            code: Some(code),
            crashed,
        }
    }
}

impl Drop for PtyInstance {
    fn drop(&mut self) {
        self.reader_alive.store(false, Ordering::Release);
    }
}

/// Info about an active terminal, safe to serialize and send to frontend
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
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
        if let Ok(mut instances) = self.instances.lock() {
            if let Some(instance) = instances.get_mut(&id) {
                instance.shell_type = shell.clone();
            }
        }
        log::info!("Spawned terminal {} ({:?})", id, shell);
        Ok(id)
    }

    /// Spawn a shell PTY with a caller-provided id.
    pub fn spawn_with_id(
        &self,
        id: &str,
        shell: &ShellType,
        cols: u16,
        rows: u16,
        cwd: Option<&str>,
    ) -> Result<(), String> {
        let program = shell.program().to_string();
        let args: Vec<String> = shell.args().into_iter().map(|s| s.to_string()).collect();
        let mut env = std::collections::HashMap::new();
        env.insert("AETHER_SHELL".to_string(), program.clone());

        self.spawn_command_with_id(id, &program, &args, cols, rows, cwd, Some(env))?;
        if let Ok(mut instances) = self.instances.lock() {
            if let Some(instance) = instances.get_mut(id) {
                instance.shell_type = shell.clone();
            }
        }
        log::info!("Spawned terminal {} ({:?}) with fixed id", id, shell);
        Ok(())
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
        self.spawn_command_with_id(&id, program, args, cols, rows, cwd, extra_env)?;
        Ok(id)
    }

    /// Same as [`spawn_command`] but uses a caller-provided terminal id. Used
    /// by [`respawn`] so the post-crash PTY keeps the original id and the
    /// `NativeTerminalRegistry` engine session (with its prompt-mark
    /// history) is reused untouched. Returns an error if `id` is already
    /// occupied to keep the spawn path race-free.
    #[allow(clippy::too_many_arguments)]
    pub fn spawn_command_with_id(
        &self,
        id: &str,
        program: &str,
        args: &[String],
        cols: u16,
        rows: u16,
        cwd: Option<&str>,
        extra_env: Option<std::collections::HashMap<String, String>>,
    ) -> Result<(), String> {
        // Reject collisions before doing any work so callers can't accidentally
        // overwrite a live session and leak its reader thread.
        if self.contains(id) {
            return Err(format!("terminal id {} already exists", id));
        }
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
        cmd.env("AETHER_TERMINAL_ID", id);
        cmd.env("AETHER_PROJECT", &resolved_cwd);

        // Extra environment variables (e.g. AETHER_SHELL for shells, model info for agents)
        if let Some(envs) = &extra_env {
            for (k, v) in envs {
                cmd.env(k, v);
            }
        }

        let child = pair
            .slave
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

        let (output_tx, initial_rx) = broadcast::channel::<Vec<u8>>(OUTPUT_BROADCAST_CAPACITY);

        let reader_alive = Arc::new(AtomicBool::new(true));
        spawn_reader_thread(
            id.to_string(),
            reader,
            output_tx.clone(),
            reader_alive.clone(),
        );

        let instance = PtyInstance {
            pair,
            writer,
            shell_type: ShellType::PowerShell, // placeholder for non-shell commands
            cwd: resolved_cwd,
            spawned_at: Instant::now(),
            output_tx,
            initial_rx: Mutex::new(Some(initial_rx)),
            reader_alive,
            child: Arc::new(Mutex::new(Some(child))),
        };

        self.lock_instances()?.insert(id.to_string(), instance);

        Ok(())
    }

    /// Write input data to a PTY
    pub fn write(&self, id: &str, data: &[u8]) -> Result<(), String> {
        let mut instances = self.lock_instances()?;

        let instance = instances.get_mut(id).ok_or_else(|| {
            log::warn!("pty write: unknown terminal id={id}");
            PtyError::NotFound(id.to_string()).to_string()
        })?;

        instance.writer.write_all(data).map_err(|e| {
            log::error!("pty write error id={id}: {e}");
            format!("Write error: {}", e)
        })?;
        instance.writer.flush().map_err(|e| {
            log::error!("pty flush error id={id}: {e}");
            format!("Write flush error: {}", e)
        })?;

        Ok(())
    }

    /// Check whether a session with the given id is currently tracked.
    ///
    /// Cheaper than `list()` when the caller only needs existence: `list`
    /// clones every id plus its `Instant` and sorts them, while `contains`
    /// is one `HashMap::contains_key`. Used by the API's
    /// `issue_stream_ticket` to validate the session exists before minting
    /// a ticket.
    pub fn contains(&self, id: &str) -> bool {
        self.instances
            .lock()
            .map(|i| i.contains_key(id))
            .unwrap_or(false)
    }

    /// Take ownership of the child-process handle for `id`. Returns the
    /// boxed `Child` exactly once — subsequent calls return `None`.
    ///
    /// The IPC layer uses this immediately after spawn to move the child
    /// onto a dedicated waiter thread that calls `wait()` and surfaces the
    /// exit code via `pty-exit-<id>`. Keeping the take strictly one-shot
    /// (rather than letting both the IPC waiter and `Drop` hold it) avoids
    /// the "drop after wait" double-free that portable-pty's `Child` does
    /// not guard against on Windows.
    pub fn take_child(&self, id: &str) -> Option<Box<dyn Child + Send + Sync>> {
        let instances = self.instances.lock().ok()?;
        let instance = instances.get(id)?;
        let mut slot = instance.child.lock().ok()?;
        slot.take()
    }

    /// Start a background waiter for a manager-owned child process.
    ///
    /// UI-spawned terminals call [`take_child`] directly so the IPC layer can
    /// emit `pty-exit-*` with an exit code. API/sidecar-spawned terminals do
    /// not have that UI waiter, so this method takes the child handle and
    /// removes the session from the manager once the process exits. Dropping
    /// the `PtyInstance` closes the broadcast sender, which in turn lets API
    /// and sidecar stream clients observe the session end instead of hanging
    /// forever on a dead PTY.
    pub fn reap_child_on_exit(&self, id: &str) -> bool {
        let Some(mut child) = self.take_child(id) else {
            return false;
        };
        let manager = self.clone();
        let id = id.to_string();
        std::thread::Builder::new()
            .name(format!("pty-reaper-{id}"))
            .spawn(move || {
                let status = child.wait();
                match status {
                    Ok(status) => {
                        let exit = ExitInfo::from_status(&status);
                        log::info!(
                            "pty {} exited via manager reaper: code={:?} crashed={}",
                            id,
                            exit.code,
                            exit.crashed
                        );
                    }
                    Err(err) => {
                        log::warn!("pty {} manager reaper wait failed: {}", id, err);
                    }
                }
                if let Err(err) = manager.close(&id) {
                    log::debug!("pty {} manager reaper close skipped: {}", id, err);
                }
            })
            .is_ok()
    }

    /// Subscribe to a PTY's output stream.
    ///
    /// Returns the spawn-time receiver for the first subscriber, then a fresh
    /// `broadcast::Receiver` on later calls. A single OS-level reader thread,
    /// spawned when the PTY starts, fans out master bytes to every subscriber,
    /// so UI and API can read the same byte stream without racing each other
    /// on the physical master.
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

        let mut initial_rx = instance
            .initial_rx
            .lock()
            .map_err(|_| PtyError::LockPoisoned)?;
        if let Some(rx) = initial_rx.take() {
            return Ok(rx);
        }

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
        self.lock_instances()?.remove(id).ok_or_else(|| {
            log::debug!("pty close: unknown terminal id={id}");
            PtyError::NotFound(id.to_string())
        })?;

        log::info!("Closed terminal {}", id);
        Ok(())
    }

    /// List active terminal IDs (sorted by spawn time, newest first)
    pub fn list(&self) -> Vec<String> {
        self.instances
            .lock()
            .map(|i| {
                let mut entries: Vec<_> = i
                    .iter()
                    .map(|(id, inst)| (id.clone(), inst.spawned_at))
                    .collect();
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

    fn lock_instances(
        &self,
    ) -> Result<std::sync::MutexGuard<'_, HashMap<String, PtyInstance>>, PtyError> {
        self.instances.lock().map_err(|_| PtyError::LockPoisoned)
    }
}

impl Default for PtyManager {
    fn default() -> Self {
        Self::new()
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
/// `send` failures are intentionally ignored: once the initial receiver is
/// consumed and later subscribers disconnect, there may be no receivers.
/// Draining the pipe into the broadcast channel keeps the child unblocked.
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
