use std::collections::HashMap;
use std::io::BufRead;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::broadcast;

use crate::pty::buffer::{strip_ansi, OutputBuffer};
use crate::pty::{ExitInfo, PtyError, PtyManager, ShellType};
use crate::snapshot::{SnapshotStore, SnapshotTrigger, TerminalSnapshot};
use crate::term::NativeTerminalRegistry;
use crate::watchdog::auto_repair::AutoRepairManager;
use crate::watchdog::{pane_watcher, AutoRepairConfig, ErrorContext};

const PTY_OUTPUT_BATCH_MAX_BYTES: usize = 64 * 1024;
const PTY_OUTPUT_BATCH_INTERVAL: Duration = Duration::from_millis(16);
const TERMINAL_JOURNAL_FLUSH_BYTES: usize = 32 * 1024;
const TERMINAL_JOURNAL_FLUSH_INTERVAL: Duration = Duration::from_millis(500);
const DB_WRITE_LATENCY_UNSET: u64 = u64::MAX;

static LAST_TERMINAL_JOURNAL_DB_WRITE_LATENCY_MS: AtomicU64 =
    AtomicU64::new(DB_WRITE_LATENCY_UNSET);

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct PtyOutputBatchPayload {
    data_base64: String,
    byte_count: usize,
    chunk_count: usize,
}

enum TerminalAnalysisWork {
    Text(String),
    Stop,
}

fn record_audit_event(
    app: &AppHandle,
    category: &str,
    action: &str,
    severity: &str,
    entity_type: Option<&str>,
    entity_id: Option<&str>,
    summary: &str,
    metadata: serde_json::Value,
) {
    let Some(db) = app.try_state::<crate::db::ManagedDb>() else {
        return;
    };
    if let Err(err) = db.with(|d| {
        d.save_audit_event(
            category,
            action,
            severity,
            entity_type,
            entity_id,
            summary,
            &metadata,
        )
    }) {
        log::warn!("audit event dropped category={category} action={action}: {err}");
    }
}

fn sanitize_audit_error(err: &str) -> String {
    err.replace(['\r', '\n', '\t'], " ")
        .chars()
        .take(240)
        .collect()
}

fn terminal_audit_metadata(
    shell: &ShellType,
    cols: u16,
    rows: u16,
    cwd: Option<&str>,
) -> serde_json::Value {
    serde_json::json!({
        "shell": format!("{:?}", shell).to_lowercase(),
        "cols": cols,
        "rows": rows,
        "hasCwd": cwd.is_some(),
        "redacted": true,
    })
}

fn emit_pty_output_batch(
    app: &AppHandle,
    event_name: &str,
    buffer: &mut Vec<u8>,
    chunk_count: &mut usize,
) {
    if buffer.is_empty() {
        return;
    }
    use base64::engine::general_purpose::STANDARD as B64;
    use base64::Engine;
    let payload = PtyOutputBatchPayload {
        data_base64: B64.encode(buffer.as_slice()),
        byte_count: buffer.len(),
        chunk_count: *chunk_count,
    };
    let _ = app.emit(event_name, payload);
    buffer.clear();
    *chunk_count = 0;
}

/// Global registry of output buffers for capture-pane
#[derive(Clone)]
pub struct OutputBufferRegistry {
    buffers: Arc<Mutex<HashMap<String, OutputBuffer>>>,
}

impl OutputBufferRegistry {
    pub fn new() -> Self {
        Self {
            buffers: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub fn create(&self, id: &str) {
        if let Ok(mut buffers) = self.buffers.lock() {
            buffers
                .entry(id.to_string())
                .or_insert_with(|| OutputBuffer::new(1000));
        }
    }

    pub fn feed(&self, id: &str, data: &str) {
        if let Ok(mut buffers) = self.buffers.lock() {
            if let Some(buf) = buffers.get_mut(id) {
                buf.feed(data);
            }
        }
    }

    pub fn command_blocks(
        &self,
        id: &str,
    ) -> Result<Vec<crate::pty::buffer::CommandBlock>, String> {
        let buffers = self
            .buffers
            .lock()
            .map_err(|_| "Lock poisoned".to_string())?;
        let buf = buffers
            .get(id)
            .ok_or_else(|| format!("No buffer for terminal {}", id))?;
        let lines = buf.tail(500);
        Ok(crate::pty::buffer::extract_command_blocks(&lines))
    }

    pub fn capture(&self, id: &str, lines: usize, clean: bool) -> Result<String, String> {
        let buffers = self
            .buffers
            .lock()
            .map_err(|_| "Lock poisoned".to_string())?;
        let buf = buffers
            .get(id)
            .ok_or_else(|| format!("No buffer for terminal {}", id))?;
        let output = buf.tail(lines).join("\n");
        if clean {
            Ok(strip_ansi(&output))
        } else {
            Ok(output)
        }
    }

    pub fn remove(&self, id: &str) {
        if let Ok(mut buffers) = self.buffers.lock() {
            buffers.remove(id);
        }
    }
}

/// Monotonic per-terminal generation counter used to reject stale child
/// waiter events after a force restart reuses the same terminal id.
#[derive(Clone)]
pub struct TerminalGenerationRegistry {
    generations: Arc<Mutex<HashMap<String, u64>>>,
}

impl TerminalGenerationRegistry {
    pub fn new() -> Self {
        Self {
            generations: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub fn next_generation(&self, id: &str) -> u64 {
        let Ok(mut generations) = self.generations.lock() else {
            return 0;
        };
        let next = generations.get(id).copied().unwrap_or(0).saturating_add(1);
        generations.insert(id.to_string(), next);
        next
    }

    pub fn current_generation(&self, id: &str) -> Option<u64> {
        self.generations
            .lock()
            .ok()
            .and_then(|generations| generations.get(id).copied())
    }

    pub fn is_current_generation(&self, id: &str, generation: u64) -> bool {
        self.current_generation(id) == Some(generation)
    }

    pub fn remove(&self, id: &str) {
        if let Ok(mut generations) = self.generations.lock() {
            generations.remove(id);
        }
    }
}

/// Validate path is not dangerous (no traversal, no system dirs)
fn validate_path(path: &str) -> Result<(), String> {
    // Block path traversal
    if path.contains("..") {
        return Err("Path traversal not allowed".to_string());
    }
    // Block UNC paths
    if path.starts_with("\\\\") || path.starts_with("//") {
        return Err("UNC paths not allowed".to_string());
    }
    // Normalize and compare case-insensitively (Windows is case-insensitive)
    let normalized = path.replace('\\', "/").to_lowercase();
    let dangerous = [
        "c:/windows",
        "c:/program files",
        "c:/program files (x86)",
        "d:/windows",
        "/etc",
        "/usr",
        "/bin",
        "/sbin",
    ];
    for d in &dangerous {
        if normalized.starts_with(d) {
            return Err("Access to system directory not allowed".to_string());
        }
    }
    Ok(())
}

/// Spawn a new terminal session
#[tauri::command]
pub fn spawn_terminal(
    app: AppHandle,
    shell: ShellType,
    cols: u16,
    rows: u16,
    cwd: Option<String>,
) -> Result<String, String> {
    if let Some(ref dir) = cwd {
        if let Err(err) = validate_path(dir) {
            record_audit_event(
                &app,
                "terminal",
                "spawn_rejected",
                "warn",
                Some("terminal"),
                None,
                "Terminal spawn rejected",
                serde_json::json!({
                    "error": sanitize_audit_error(&err),
                    "redacted": true,
                }),
            );
            return Err(err);
        }
    }
    let pty_manager = app.state::<PtyManager>();
    let id = match pty_manager.spawn(&shell, cols, rows, cwd.as_deref()) {
        Ok(id) => id,
        Err(err) => {
            record_audit_event(
                &app,
                "terminal",
                "spawn_failed",
                "error",
                Some("terminal"),
                None,
                "Terminal spawn failed",
                {
                    let mut metadata = terminal_audit_metadata(&shell, cols, rows, cwd.as_deref());
                    if let Some(obj) = metadata.as_object_mut() {
                        obj.insert(
                            "error".to_string(),
                            serde_json::Value::String(sanitize_audit_error(&err)),
                        );
                    }
                    metadata
                },
            );
            return Err(err);
        }
    };
    let shell_name = format!("{:?}", shell).to_lowercase();

    // Register in pane registry for name-based operations. Done here (not
    // inside the helper) because pane registration is one-shot and must not
    // happen on respawn — we keep the same pane-name binding across the
    // crash/restart boundary.
    app.state::<crate::pty::PaneRegistry>().register(
        &id,
        &shell_name,
        cwd.as_deref().unwrap_or("."),
    );

    if let Err(err) = wire_terminal_streaming(&app, &id, cols, rows, cwd.as_deref(), &shell_name) {
        record_audit_event(
            &app,
            "terminal",
            "spawn_failed",
            "error",
            Some("terminal"),
            Some(&id),
            "Terminal stream wiring failed",
            {
                let mut metadata = terminal_audit_metadata(&shell, cols, rows, cwd.as_deref());
                if let Some(obj) = metadata.as_object_mut() {
                    obj.insert(
                        "error".to_string(),
                        serde_json::Value::String(sanitize_audit_error(&err)),
                    );
                }
                metadata
            },
        );
        return Err(err);
    }
    record_audit_event(
        &app,
        "terminal",
        "spawn",
        "info",
        Some("terminal"),
        Some(&id),
        "Terminal spawned",
        terminal_audit_metadata(&shell, cols, rows, cwd.as_deref()),
    );
    Ok(id)
}

/// Restart the shell for an existing terminal id after the previous child
/// process exited (clean or crash). Called by the frontend's "Press Enter
/// to restart" banner.
///
/// Preserves the [`NativeTerminalRegistry`] engine session for `id` so
/// prompt-mark history and scrollback are not discarded. The new shell's
/// initial prompt streams into the same engine and the canvas continues
/// rendering without a remount.
///
/// Errors with a clear message if the previous child is still alive — that
/// case is a UI bug (banner shown while the PTY is healthy) and silently
/// double-spawning would orphan the live session.
#[tauri::command]
pub fn respawn_terminal(
    app: AppHandle,
    id: String,
    shell: ShellType,
    cols: u16,
    rows: u16,
    cwd: Option<String>,
) -> Result<(), String> {
    if let Some(ref dir) = cwd {
        if let Err(err) = validate_path(dir) {
            record_audit_event(
                &app,
                "terminal",
                "respawn_rejected",
                "warn",
                Some("terminal"),
                Some(&id),
                "Terminal respawn rejected",
                serde_json::json!({
                    "error": sanitize_audit_error(&err),
                    "redacted": true,
                }),
            );
            return Err(err);
        }
    }
    let pty_manager = app.state::<PtyManager>();
    if pty_manager.contains(&id) {
        let err = format!("respawn rejected: terminal {} is still alive", id);
        record_audit_event(
            &app,
            "terminal",
            "respawn_rejected",
            "warn",
            Some("terminal"),
            Some(&id),
            "Terminal respawn rejected",
            serde_json::json!({
                "reason": "still_alive",
                "redacted": true,
            }),
        );
        return Err(err);
    }

    let program = shell.program().to_string();
    let args: Vec<String> = shell.args().into_iter().map(|s| s.to_string()).collect();
    let mut env = std::collections::HashMap::new();
    env.insert("AETHER_SHELL".to_string(), program.clone());

    if let Err(err) = pty_manager.spawn_command_with_id(
        &id,
        &program,
        &args,
        cols,
        rows,
        cwd.as_deref(),
        Some(env),
    ) {
        record_audit_event(
            &app,
            "terminal",
            "respawn_failed",
            "error",
            Some("terminal"),
            Some(&id),
            "Terminal respawn failed",
            {
                let mut metadata = terminal_audit_metadata(&shell, cols, rows, cwd.as_deref());
                if let Some(obj) = metadata.as_object_mut() {
                    obj.insert(
                        "error".to_string(),
                        serde_json::Value::String(sanitize_audit_error(&err)),
                    );
                }
                metadata
            },
        );
        return Err(err);
    }
    log::info!("respawned terminal {} ({:?})", id, shell);

    let shell_name = format!("{:?}", shell).to_lowercase();
    app.state::<crate::pty::PaneRegistry>().ensure_registered(
        &id,
        &shell_name,
        cwd.as_deref().unwrap_or("."),
    );
    if let Err(err) = wire_terminal_streaming(&app, &id, cols, rows, cwd.as_deref(), &shell_name) {
        record_audit_event(
            &app,
            "terminal",
            "respawn_failed",
            "error",
            Some("terminal"),
            Some(&id),
            "Terminal stream wiring failed",
            {
                let mut metadata = terminal_audit_metadata(&shell, cols, rows, cwd.as_deref());
                if let Some(obj) = metadata.as_object_mut() {
                    obj.insert(
                        "error".to_string(),
                        serde_json::Value::String(sanitize_audit_error(&err)),
                    );
                }
                metadata
            },
        );
        return Err(err);
    }
    record_audit_event(
        &app,
        "terminal",
        "respawn",
        "info",
        Some("terminal"),
        Some(&id),
        "Terminal respawned",
        terminal_audit_metadata(&shell, cols, rows, cwd.as_deref()),
    );
    Ok(())
}

/// Force-restart a live terminal id. Unlike `respawn_terminal`, this path is
/// intentionally allowed while the old child is still tracked. It preserves
/// the native terminal engine/buffer/session id, but bumps a generation token
/// before teardown so the old waiter cannot later emit a stale exit event or
/// close the freshly spawned replacement.
#[tauri::command]
pub fn force_restart_terminal(
    app: AppHandle,
    id: String,
    shell: ShellType,
    cols: u16,
    rows: u16,
    cwd: Option<String>,
) -> Result<(), String> {
    if let Some(ref dir) = cwd {
        if let Err(err) = validate_path(dir) {
            record_audit_event(
                &app,
                "terminal",
                "force_restart_rejected",
                "warn",
                Some("terminal"),
                Some(&id),
                "Terminal force restart rejected",
                serde_json::json!({
                    "error": sanitize_audit_error(&err),
                    "redacted": true,
                }),
            );
            return Err(err);
        }
    }

    let pty_manager = app.state::<PtyManager>();
    let generations = app.state::<TerminalGenerationRegistry>();
    generations.next_generation(&id);
    let close_result = pty_manager.close(&id);

    let program = shell.program().to_string();
    let args: Vec<String> = shell.args().into_iter().map(|s| s.to_string()).collect();
    let mut env = std::collections::HashMap::new();
    env.insert("AETHER_SHELL".to_string(), program.clone());

    if let Err(err) = pty_manager.spawn_command_with_id(
        &id,
        &program,
        &args,
        cols,
        rows,
        cwd.as_deref(),
        Some(env),
    ) {
        record_audit_event(
            &app,
            "terminal",
            "force_restart_failed",
            "error",
            Some("terminal"),
            Some(&id),
            "Terminal force restart failed",
            {
                let mut metadata = terminal_audit_metadata(&shell, cols, rows, cwd.as_deref());
                if let Some(obj) = metadata.as_object_mut() {
                    obj.insert(
                        "oldCloseOk".to_string(),
                        serde_json::Value::Bool(close_result.is_ok()),
                    );
                    obj.insert(
                        "error".to_string(),
                        serde_json::Value::String(sanitize_audit_error(&err)),
                    );
                }
                metadata
            },
        );
        return Err(err);
    }
    log::info!("force-restarted terminal {} ({:?})", id, shell);

    let shell_name = format!("{:?}", shell).to_lowercase();
    if let Err(err) = wire_terminal_streaming(&app, &id, cols, rows, cwd.as_deref(), &shell_name) {
        record_audit_event(
            &app,
            "terminal",
            "force_restart_failed",
            "error",
            Some("terminal"),
            Some(&id),
            "Terminal stream wiring failed",
            {
                let mut metadata = terminal_audit_metadata(&shell, cols, rows, cwd.as_deref());
                if let Some(obj) = metadata.as_object_mut() {
                    obj.insert(
                        "oldCloseOk".to_string(),
                        serde_json::Value::Bool(close_result.is_ok()),
                    );
                    obj.insert(
                        "error".to_string(),
                        serde_json::Value::String(sanitize_audit_error(&err)),
                    );
                }
                metadata
            },
        );
        return Err(err);
    }
    record_audit_event(
        &app,
        "terminal",
        "force_restart",
        "warn",
        Some("terminal"),
        Some(&id),
        "Terminal force restarted",
        {
            let mut metadata = terminal_audit_metadata(&shell, cols, rows, cwd.as_deref());
            if let Some(obj) = metadata.as_object_mut() {
                obj.insert(
                    "oldCloseOk".to_string(),
                    serde_json::Value::Bool(close_result.is_ok()),
                );
            }
            metadata
        },
    );
    Ok(())
}

/// Stand up everything that consumes a freshly-spawned PTY: output buffer,
/// native engine session, flush ticker, output streaming task, and the
/// child-waiter that emits `pty-exit-<id>` with an [`ExitInfo`] payload.
///
/// Called by both `spawn_terminal` and `respawn_terminal` so the two paths
/// stay structurally identical — the only thing respawn skips is one-shot
/// pane-registry registration.
fn wire_terminal_streaming(
    app: &AppHandle,
    terminal_id: &str,
    cols: u16,
    rows: u16,
    cwd: Option<&str>,
    shell_name: &str,
) -> Result<(), String> {
    let pty_manager = app.state::<PtyManager>();
    let mut rx = pty_manager.subscribe_output(terminal_id)?;
    let terminal_generation = app
        .state::<TerminalGenerationRegistry>()
        .next_generation(terminal_id);

    let buffer_registry = app.state::<OutputBufferRegistry>().inner().clone();
    buffer_registry.create(terminal_id);

    // Native engine session is created idempotently — first spawn opens it,
    // respawn no-ops to preserve scrollback + prompt marks.
    let native_registry = app.state::<Arc<NativeTerminalRegistry>>().inner().clone();
    if let Err(e) = native_registry.create(terminal_id, cols, rows) {
        log::warn!("native engine create failed for {}: {}", terminal_id, e);
    }

    // Take the child handle so the waiter thread (below) can call wait()
    // and surface the exit code. If the manager has already handed the
    // child out (impossible right after spawn but cheap to defend), we log
    // and skip the waiter — the streaming task still terminates on EOF via
    // the broadcast Closed signal.
    let child = pty_manager.take_child(terminal_id);

    // Per-terminal flush ticker: the 16ms coalesce in `advance()` swallows
    // the very last edit if no follow-up bytes arrive (e.g., user types one
    // char and stops). The ticker bypasses the window and ships any pending
    // diff so the canvas never lags behind alacritty's grid.
    let flush_alive = Arc::new(std::sync::atomic::AtomicBool::new(true));
    {
        let alive = flush_alive.clone();
        let flush_registry = native_registry.clone();
        let flush_handle = app.clone();
        let flush_id = terminal_id.to_string();
        let flush_event = format!("term:diff-{terminal_id}");
        std::thread::spawn(move || {
            use std::sync::atomic::Ordering;
            while alive.load(Ordering::Acquire) {
                std::thread::sleep(std::time::Duration::from_millis(33));
                if let Some(diff) = flush_registry.flush(&flush_id) {
                    let _ = flush_handle.emit(&flush_event, diff);
                }
            }
        });
    }
    let reader_alive = flush_alive.clone();

    let app_handle = app.clone();
    let terminal_id_owned = terminal_id.to_string();
    let repair_cwd = cwd.map(str::to_string);
    let repair_pane = shell_name.to_string();
    let analysis_tx = spawn_terminal_analysis_worker(
        app.clone(),
        terminal_id.to_string(),
        repair_pane,
        repair_cwd,
    );

    tauri::async_runtime::spawn(async move {
        let terminal_id = terminal_id_owned;
        let event_name = format!("pty-output-{}", terminal_id);
        let diff_event_name = format!("term:diff-{}", terminal_id);
        let prompt_mark_event_name = format!("term:prompt-mark-{}", terminal_id);
        let lag_event_name = format!("term:lag-{}", terminal_id);
        let mut output_batch = Vec::<u8>::with_capacity(PTY_OUTPUT_BATCH_MAX_BYTES);
        let mut output_batch_chunks = 0usize;
        let mut flush_tick = tokio::time::interval(PTY_OUTPUT_BATCH_INTERVAL);
        flush_tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        loop {
            tokio::select! {
                _ = flush_tick.tick() => {
                    emit_pty_output_batch(
                        &app_handle,
                        &event_name,
                        &mut output_batch,
                        &mut output_batch_chunks,
                    );
                    continue;
                }
                recv = rx.recv() => match recv {
                Ok(chunk) => {
                    let data: &[u8] = &chunk;
                    output_batch.extend_from_slice(data);
                    output_batch_chunks = output_batch_chunks.saturating_add(1);
                    if output_batch.len() >= PTY_OUTPUT_BATCH_MAX_BYTES {
                        emit_pty_output_batch(
                            &app_handle,
                            &event_name,
                            &mut output_batch,
                            &mut output_batch_chunks,
                        );
                    }

                    let text = String::from_utf8_lossy(data).into_owned();
                    buffer_registry.feed(&terminal_id, &text);
                    let _ = analysis_tx.send(TerminalAnalysisWork::Text(text));

                    let advance_result = native_registry.advance(&terminal_id, data);
                    if let Some(diff) = advance_result.diff {
                        let _ = app_handle.emit(&diff_event_name, diff);
                    }
                    for mark in advance_result.new_marks {
                        let _ = app_handle.emit(&prompt_mark_event_name, mark);
                    }

                    if data.contains(&0x07) {
                        let _ = app_handle.emit(
                            "terminal:bell",
                            serde_json::json!({
                                "terminal_id": terminal_id,
                            }),
                        );
                    }
                }
                Err(broadcast::error::RecvError::Lagged(n)) => {
                    log::warn!("ui: terminal {} lagged, dropped {} chunks", terminal_id, n);
                    record_audit_event(
                        &app_handle,
                        "terminal",
                        "stream_lagged",
                        "warn",
                        Some("terminal"),
                        Some(&terminal_id),
                        "Terminal stream lagged",
                        serde_json::json!({
                            "droppedChunks": n,
                            "redacted": true,
                        }),
                    );
                    // Surface backpressure to the UI so TerminalInfoBar can
                    // render a "throttled" badge during a flood. Payload is
                    // the dropped-chunk count; the badge decays after 5s
                    // of no further events on the React side.
                    let _ = app_handle.emit(
                        &lag_event_name,
                        serde_json::json!({ "dropped": n }),
                    );
                    continue;
                }
                Err(broadcast::error::RecvError::Closed) => break,
                },
            }
        }
        emit_pty_output_batch(
            &app_handle,
            &event_name,
            &mut output_batch,
            &mut output_batch_chunks,
        );
        let _ = analysis_tx.send(TerminalAnalysisWork::Stop);
        // Streaming loop ended — the broadcast channel was closed because
        // the PtyInstance was dropped. Stop the native flush ticker so the
        // background thread joins.
        reader_alive.store(false, std::sync::atomic::Ordering::Release);
    });

    // Child-waiter thread: blocks on child.wait(), then emits the typed
    // pty-exit event and removes the dead instance from PtyManager so the
    // streaming task above sees a closed broadcast and exits. Removal also
    // drops the per-PTY OS reader thread via PtyInstance::Drop.
    if let Some(mut child) = child {
        let waiter_app = app.clone();
        let waiter_id = terminal_id.to_string();
        std::thread::spawn(move || {
            let exit_info = match child.wait() {
                Ok(status) => {
                    log::info!(
                        "terminal {} child exited code={} success={}",
                        waiter_id,
                        status.exit_code(),
                        status.success(),
                    );
                    ExitInfo::from_status(&status)
                }
                Err(e) => {
                    log::warn!("terminal {} wait() failed: {}", waiter_id, e);
                    ExitInfo {
                        code: None,
                        crashed: true,
                    }
                }
            };
            let is_current_generation = waiter_app
                .try_state::<TerminalGenerationRegistry>()
                .is_some_and(|generations| {
                    generations.is_current_generation(&waiter_id, terminal_generation)
                });
            if !is_current_generation {
                log::info!(
                    "suppressing stale terminal exit for {} generation {}",
                    waiter_id,
                    terminal_generation
                );
                record_audit_event(
                    &waiter_app,
                    "terminal",
                    "stale_exit_suppressed",
                    "info",
                    Some("terminal"),
                    Some(&waiter_id),
                    "Stale terminal exit suppressed",
                    serde_json::json!({
                        "generation": terminal_generation,
                        "redacted": true,
                    }),
                );
                return;
            }
            if let Some(pty_state) = waiter_app.try_state::<PtyManager>() {
                let _ = pty_state.close(&waiter_id);
            }
            record_audit_event(
                &waiter_app,
                "terminal",
                "exit",
                if exit_info.crashed { "warn" } else { "info" },
                Some("terminal"),
                Some(&waiter_id),
                "Terminal process exited",
                serde_json::json!({
                    "code": exit_info.code,
                    "crashed": exit_info.crashed,
                    "generation": terminal_generation,
                    "redacted": true,
                }),
            );
            let _ = waiter_app.emit(&format!("pty-exit-{}", waiter_id), exit_info);
        });
    }

    Ok(())
}

/// Write input to a terminal. On Enter (`\r` in the input payload) we also
/// capture a `TerminalSnapshot` into the session-scoped ring buffer — this is
/// the time-travel capture point (Phase 3C-3a). The snapshot reflects the
/// grid *as it was when the user submitted the command*, before the shell
/// produces output for it.
#[tauri::command]
pub fn write_terminal(app: AppHandle, id: String, data: String) -> Result<(), String> {
    validate_keys_payload(&data)?;
    let pty_manager = app.state::<PtyManager>();
    let bytes = data.as_bytes();
    let metadata = serde_json::json!({
        "bytes": bytes.len(),
        "containsEnter": bytes.contains(&b'\r'),
        "redacted": true,
    });
    match pty_manager.write(&id, bytes) {
        Ok(()) => {
            if bytes.contains(&b'\r') || bytes.len() >= 128 {
                record_audit_event(
                    &app,
                    "terminal",
                    if bytes.contains(&b'\r') {
                        "submit"
                    } else {
                        "paste"
                    },
                    "info",
                    Some("terminal"),
                    Some(&id),
                    "Terminal input sent",
                    metadata,
                );
            }
            capture_if_enter(&app, &id, bytes);
            Ok(())
        }
        Err(err) => {
            record_audit_event(
                &app,
                "terminal",
                "write_failed",
                "warn",
                Some("terminal"),
                Some(&id),
                "Terminal input failed",
                serde_json::json!({
                    "bytes": bytes.len(),
                    "containsEnter": bytes.contains(&b'\r'),
                    "error": sanitize_audit_error(&err),
                    "redacted": true,
                }),
            );
            Err(err)
        }
    }
}

/// Trigger a `UserSubmitted` snapshot when the bytes just written to a PTY
/// contained an Enter (`\r`). Shared by every write-side IPC so Orchestra /
/// Helm / `send_keys` / broadcast paths all feed the timeline, not just
/// `write_terminal`.
fn capture_if_enter(app: &AppHandle, terminal_id: &str, data: &[u8]) {
    if data.contains(&b'\r') {
        capture_user_submit_snapshot(app, terminal_id);
    }
}

/// Grab the current grid from the native engine and push it into the snapshot
/// store, tagged as `UserSubmitted`. Silently no-ops when managed state is
/// missing (tests / early boot) or the engine has no session for `id` — the
/// PTY write itself has already succeeded at this point.
fn capture_user_submit_snapshot(app: &AppHandle, terminal_id: &str) {
    let Some(native_state) = app.try_state::<Arc<NativeTerminalRegistry>>() else {
        return;
    };
    let Some(store_state) = app.try_state::<Arc<SnapshotStore>>() else {
        return;
    };
    let Some(grid) = native_state.inner().snapshot(terminal_id) else {
        return;
    };
    let captured_at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let snap = TerminalSnapshot {
        id: crate::snapshot::SnapshotId::new(),
        session_id: terminal_id.to_string(),
        captured_at,
        trigger: SnapshotTrigger::UserSubmitted,
        grid,
    };
    let id = store_state.inner().push(snap);
    let _ = app.emit(
        &format!("snapshot:captured-{}", terminal_id),
        serde_json::json!({ "snapshotId": id, "sessionId": terminal_id }),
    );
}

/// Resize a terminal
#[tauri::command]
pub fn resize_terminal(app: AppHandle, id: String, cols: u16, rows: u16) -> Result<(), String> {
    let pty_manager = app.state::<PtyManager>();
    if let Err(err) = pty_manager.resize(&id, cols, rows) {
        let err = err.to_string();
        record_audit_event(
            &app,
            "terminal",
            "resize_failed",
            "warn",
            Some("terminal"),
            Some(&id),
            "Terminal resize failed",
            serde_json::json!({
                "cols": cols,
                "rows": rows,
                "error": sanitize_audit_error(&err),
                "redacted": true,
            }),
        );
        return Err(err);
    }

    // Native engine resize — emits a full frame so the frontend can reflow.
    let native_registry = app.state::<Arc<NativeTerminalRegistry>>();
    let native_diff = match native_registry.resize(&id, cols, rows) {
        Ok(diff) => diff,
        Err(err) => {
            let err = err.to_string();
            record_audit_event(
                &app,
                "terminal",
                "resize_failed",
                "warn",
                Some("terminal"),
                Some(&id),
                "Native terminal resize failed",
                serde_json::json!({
                    "cols": cols,
                    "rows": rows,
                    "error": sanitize_audit_error(&err),
                    "redacted": true,
                }),
            );
            return Err(err);
        }
    };
    if let Some(diff) = native_diff {
        let _ = app.emit(&format!("term:diff-{}", id), diff);
    }
    Ok(())
}

/// Close a terminal
#[tauri::command]
pub fn close_terminal(app: AppHandle, id: String) -> Result<(), String> {
    let pty_manager = app.state::<PtyManager>();
    // Mark the currently wired waiter as stale before dropping the PTY. The
    // child will exit as a side effect of the close, but that should not emit
    // a user-facing crash/exit banner for intentional process-manager ends.
    app.state::<TerminalGenerationRegistry>()
        .next_generation(&id);
    let already_closed = match pty_manager.close(&id) {
        Ok(()) => false,
        Err(PtyError::NotFound(_)) => true,
        Err(err) => {
            let err = err.to_string();
            record_audit_event(
                &app,
                "terminal",
                "close_failed",
                "warn",
                Some("terminal"),
                Some(&id),
                "Terminal close failed",
                serde_json::json!({
                    "error": sanitize_audit_error(&err),
                    "redacted": true,
                }),
            );
            return Err(err);
        }
    };
    app.state::<TerminalGenerationRegistry>().remove(&id);
    // Clean up associated registries
    app.state::<OutputBufferRegistry>().remove(&id);
    app.state::<crate::pty::PaneRegistry>().remove(&id);
    app.state::<Arc<NativeTerminalRegistry>>().remove(&id);
    if let Some(store) = app.try_state::<Arc<SnapshotStore>>() {
        store.inner().remove_session(&id);
    }
    record_audit_event(
        &app,
        "terminal",
        if already_closed {
            "close_already_cleaned"
        } else {
            "close"
        },
        if already_closed { "warn" } else { "info" },
        Some("terminal"),
        Some(&id),
        if already_closed {
            "Terminal close cleanup completed"
        } else {
            "Terminal closed"
        },
        serde_json::json!({ "redacted": true }),
    );
    Ok(())
}

/// Scan a fresh chunk of PTY text for the auto-repair pattern and, on a
/// hit, hand it to `AutoRepairManager`. Silently no-ops when the feature is
/// disabled, the managed state is missing, or the cwd is absent (without a
/// git root the worker can't create a worktree).
fn maybe_trigger_auto_repair(app: &AppHandle, source_pane: &str, cwd: Option<&str>, text: &str) {
    let Some(cfg_state) = app.try_state::<Arc<Mutex<AutoRepairConfig>>>() else {
        return;
    };
    let (enabled, pattern) = match cfg_state.inner().lock() {
        Ok(guard) => (guard.enabled, guard.pattern.clone()),
        Err(_) => return,
    };
    if !enabled || pattern.trim().is_empty() {
        return;
    }
    let Some(repo_path) = cwd else { return };
    let clean = strip_ansi(text);
    let Some(matched) = clean
        .lines()
        .find(|line| pane_watcher::matches_trigger(&pattern, line))
    else {
        return;
    };
    let Some(mgr_state) = app.try_state::<Arc<Mutex<AutoRepairManager>>>() else {
        return;
    };
    let Ok(mut mgr) = mgr_state.inner().lock() else {
        return;
    };
    let ctx = ErrorContext {
        matched_line: matched.trim().to_string(),
        source_pane: source_pane.to_string(),
    };
    let _ = mgr.trigger(ctx, std::path::Path::new(repo_path));
}

fn spawn_terminal_analysis_worker(
    app: AppHandle,
    terminal_id: String,
    source_pane: String,
    cwd: Option<String>,
) -> mpsc::Sender<TerminalAnalysisWork> {
    let (tx, rx) = mpsc::channel::<TerminalAnalysisWork>();
    std::thread::Builder::new()
        .name(format!("terminal-analysis-{terminal_id}"))
        .spawn(move || {
            let mut detected_ports = std::collections::HashSet::new();
            let mut journal_text = String::new();
            let mut journal_bytes = 0usize;
            let mut journal_chunks = 0usize;
            let mut last_journal_flush = Instant::now();
            loop {
                match rx.recv_timeout(TERMINAL_JOURNAL_FLUSH_INTERVAL) {
                    Ok(work) => match work {
                        TerminalAnalysisWork::Text(text) => {
                            maybe_trigger_auto_repair(&app, &source_pane, cwd.as_deref(), &text);
                            scan_and_emit_ports(&app, &terminal_id, &text, &mut detected_ports);
                            journal_bytes = journal_bytes.saturating_add(text.len());
                            journal_chunks = journal_chunks.saturating_add(1);
                            journal_text.push_str(&text);
                            if journal_text.len() >= TERMINAL_JOURNAL_FLUSH_BYTES
                                || last_journal_flush.elapsed() >= TERMINAL_JOURNAL_FLUSH_INTERVAL
                            {
                                flush_terminal_output_journal(
                                    &app,
                                    &terminal_id,
                                    &mut journal_text,
                                    &mut journal_bytes,
                                    &mut journal_chunks,
                                );
                                last_journal_flush = Instant::now();
                            }
                        }
                        TerminalAnalysisWork::Stop => {
                            flush_terminal_output_journal(
                                &app,
                                &terminal_id,
                                &mut journal_text,
                                &mut journal_bytes,
                                &mut journal_chunks,
                            );
                            break;
                        }
                    },
                    Err(mpsc::RecvTimeoutError::Timeout) => {
                        flush_terminal_output_journal(
                            &app,
                            &terminal_id,
                            &mut journal_text,
                            &mut journal_bytes,
                            &mut journal_chunks,
                        );
                        last_journal_flush = Instant::now();
                    }
                    Err(mpsc::RecvTimeoutError::Disconnected) => {
                        flush_terminal_output_journal(
                            &app,
                            &terminal_id,
                            &mut journal_text,
                            &mut journal_bytes,
                            &mut journal_chunks,
                        );
                        break;
                    }
                }
            }
        })
        .ok();
    tx
}

fn flush_terminal_output_journal(
    app: &AppHandle,
    terminal_id: &str,
    text: &mut String,
    byte_count: &mut usize,
    chunk_count: &mut usize,
) {
    if text.is_empty() {
        return;
    }
    if let Some(db) = app.try_state::<crate::db::ManagedDb>() {
        let started_at = Instant::now();
        if let Err(err) =
            db.with(|d| d.save_terminal_output_chunk(terminal_id, text, *byte_count, *chunk_count))
        {
            log::debug!("terminal output journal dropped terminal={terminal_id}: {err}");
        }
        LAST_TERMINAL_JOURNAL_DB_WRITE_LATENCY_MS
            .store(duration_ms_u64(started_at.elapsed()), Ordering::Relaxed);
    }
    text.clear();
    *byte_count = 0;
    *chunk_count = 0;
}

fn scan_and_emit_ports(
    app: &AppHandle,
    terminal_id: &str,
    text: &str,
    detected_ports: &mut std::collections::HashSet<u16>,
) {
    if !(text.contains("localhost:") || text.contains("127.0.0.1:")) {
        return;
    }
    for segment in text.split_whitespace() {
        let segment =
            segment.trim_matches(|c: char| !c.is_ascii_alphanumeric() && c != ':' && c != '.');
        if let Some(port_str) = segment
            .strip_prefix("localhost:")
            .or_else(|| segment.strip_prefix("127.0.0.1:"))
            .or_else(|| segment.strip_prefix("http://localhost:"))
            .or_else(|| segment.strip_prefix("http://127.0.0.1:"))
            .or_else(|| segment.strip_prefix("https://localhost:"))
        {
            let port_digits: String = port_str
                .chars()
                .take_while(|c| c.is_ascii_digit())
                .collect();
            if let Ok(port) = port_digits.parse::<u16>() {
                if port >= 1024 && !detected_ports.contains(&port) {
                    detected_ports.insert(port);
                    let _ = app.emit(
                        "port-detected",
                        serde_json::json!({
                            "terminal_id": terminal_id,
                            "port": port,
                        }),
                    );
                }
            }
        }
    }
}

/// Bootstrap the frontend with a full grid snapshot — used when React
/// (re)mounts the TerminalCanvas and needs the starting state.
///
/// In addition to returning the snapshot, this resets the per-session
/// `DiffTracker` so the very next emitted diff is forced to be a full
/// frame. That closes a listener-arming race in `useTerminalSnapshot`:
/// any partial diff that fires between the React listener being attached
/// and this IPC returning is dropped on the frontend (no prev to apply
/// against), and the subsequent advance is guaranteed to emit a full
/// frame which fully re-seeds whatever the listener missed.
#[tauri::command]
pub fn term_snapshot(app: AppHandle, id: String) -> Option<crate::term::GridSnapshot> {
    app.state::<Arc<NativeTerminalRegistry>>()
        .snapshot_and_reset_tracker(&id)
}

/// Full OSC 133 prompt mark history for the given terminal. The frontend
/// calls this on (re)mount to seed its jump-to-prompt index; live updates
/// arrive thereafter via the `term:prompt-mark-<id>` event.
#[tauri::command]
pub fn term_prompt_marks(app: AppHandle, id: String) -> Vec<crate::term::PromptMark> {
    app.state::<Arc<NativeTerminalRegistry>>().prompt_marks(&id)
}

/// Number of scrollback rows currently retained above the visible screen.
/// The frontend uses this to size a scroll thumb or decide whether
/// scrolling up is meaningful. Returns `0` when the terminal is unknown
/// or hasn't yet emitted enough output to fill the visible screen.
#[tauri::command]
pub fn term_history_size(app: AppHandle, id: String) -> usize {
    app.state::<Arc<NativeTerminalRegistry>>().history_size(&id)
}

/// Fetch a contiguous window of scrollback rows for the given terminal.
///
/// - `fromN = 0` returns the row immediately above the visible screen.
/// - `count` is the requested window size; the result may be shorter if
///   retained history is smaller than the window.
/// - Each row is a vec of `CellSnapshot` in the same shape as
///   `GridSnapshot::cells[row]`, so the frontend can reuse the existing
///   grid renderer for history rows without a separate code path.
#[tauri::command]
#[allow(non_snake_case)]
pub fn term_history_rows(
    app: AppHandle,
    id: String,
    fromN: usize,
    count: usize,
) -> Vec<Vec<crate::term::CellSnapshot>> {
    app.state::<Arc<NativeTerminalRegistry>>()
        .history_rows(&id, fromN, count)
}

/// Search retained scrollback for `query`. The frontend pairs the
/// returned matches with the existing live-grid match list to drive
/// Ctrl+F across the entire 10 000-line history without round-tripping
/// every row over IPC.
///
/// - `caseSensitive=false` (the default) lowercases per-cell to match
///   the live-grid `findMatches(snapshot, query)` behaviour.
/// - Returns an empty vec when the terminal id is unknown or the
///   needle is empty — the caller treats both as "no matches".
#[tauri::command]
#[allow(non_snake_case)]
pub fn term_search_history(
    app: AppHandle,
    id: String,
    query: String,
    caseSensitive: bool,
) -> Vec<crate::term::HistorySearchMatch> {
    app.state::<Arc<NativeTerminalRegistry>>()
        .search_history(&id, &query, caseSensitive)
}

/// Fetch the decoded payload for an inline image surfaced via
/// `GridSnapshot::images`. Returns `None` when the terminal id, image
/// id, or decoded buffer is missing — the frontend treats all three as
/// the same "skip this image" signal and leaves the cell rectangle
/// unrendered, mirroring the graceful degradation already used for
/// scrollback eviction.
///
/// The payload rides as a base64 string (see `image_data` in
/// `term::native` for the rationale around Tauri's `Vec<u8>`
/// serialisation cost). Frontends decode once and cache the
/// `ImageBitmap` keyed by `id`.
#[tauri::command]
#[allow(non_snake_case)]
pub fn term_image_data(
    app: AppHandle,
    id: String,
    imageId: u64,
) -> Option<crate::term::native::ImageDataResponse> {
    app.state::<Arc<NativeTerminalRegistry>>()
        .image_data(&id, imageId)
}

/// Inline-image budget snapshot for a terminal: bytesUsed / cap / count.
/// The status bar polls this so power users can see how close their
/// session is to the per-pane FIFO eviction threshold. Returns `None`
/// when the terminal id is unknown.
#[tauri::command]
pub fn term_image_metrics(
    app: AppHandle,
    id: String,
) -> Option<crate::term::native::ImageMetricsResponse> {
    app.state::<Arc<NativeTerminalRegistry>>()
        .image_metrics(&id)
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PerformanceObservatoryMetrics {
    pub terminal_id: Option<String>,
    pub active_terminal_count: usize,
    pub pane_count: usize,
    pub visible_cols: Option<usize>,
    pub visible_rows: Option<usize>,
    pub scrollback_rows: usize,
    pub scrollback_estimated_bytes: u64,
    pub inline_image_bytes: u64,
    pub inline_image_cap: u64,
    pub inline_image_count: u64,
    pub ipc_batch_max_bytes: usize,
    pub ipc_batch_interval_ms: u64,
    pub terminal_journal_flush_bytes: usize,
    pub terminal_journal_flush_interval_ms: u64,
    pub ipc_latency_ms: Option<u64>,
    pub db_write_latency_ms: Option<u64>,
    pub event_queue_lag_ms: Option<u64>,
}

fn duration_ms_u64(duration: Duration) -> u64 {
    duration.as_millis().min(u64::MAX as u128) as u64
}

fn estimate_scrollback_memory_bytes(rows: usize, cols: usize) -> u64 {
    rows.saturating_mul(cols).saturating_mul(16) as u64
}

/// Read-only backend half of the Performance Observatory.
///
/// Frontend render FPS/frame timing is sampled in the browser, while this IPC
/// supplies backend-visible terminal/pane/scrollback/image and batching
/// budgets. DB write latency and process CPU are not probed here because this
/// command must not mutate the audit journal just to observe it.
#[tauri::command]
#[allow(non_snake_case)]
pub fn performance_observatory_metrics(
    app: AppHandle,
    terminalId: Option<String>,
) -> PerformanceObservatoryMetrics {
    let pty_manager = app.state::<PtyManager>();
    let active_terminals = pty_manager.list();
    let active_terminal_count = active_terminals.len();
    let pane_count = app
        .state::<crate::pty::PaneRegistry>()
        .list_active(&active_terminals)
        .len();
    let selected_terminal = terminalId
        .filter(|id| active_terminals.iter().any(|active| active == id))
        .or_else(|| active_terminals.first().cloned());

    let native = app.state::<Arc<NativeTerminalRegistry>>();
    let (
        visible_cols,
        visible_rows,
        scrollback_rows,
        inline_image_bytes,
        inline_image_cap,
        inline_image_count,
    ) = if let Some(id) = selected_terminal.as_deref() {
        let snapshot = native.snapshot(id);
        let image_metrics = native.image_metrics(id);
        (
            snapshot.as_ref().map(|snap| snap.cols as usize),
            snapshot.as_ref().map(|snap| snap.rows as usize),
            native.history_size(id),
            image_metrics.map(|m| m.bytes_used).unwrap_or(0),
            image_metrics.map(|m| m.cap).unwrap_or(0),
            image_metrics.map(|m| m.count).unwrap_or(0),
        )
    } else {
        (None, None, 0, 0, 0, 0)
    };

    PerformanceObservatoryMetrics {
        terminal_id: selected_terminal,
        active_terminal_count,
        pane_count,
        visible_cols,
        visible_rows,
        scrollback_rows,
        scrollback_estimated_bytes: estimate_scrollback_memory_bytes(
            scrollback_rows,
            visible_cols.unwrap_or(0),
        ),
        inline_image_bytes,
        inline_image_cap,
        inline_image_count,
        ipc_batch_max_bytes: PTY_OUTPUT_BATCH_MAX_BYTES,
        ipc_batch_interval_ms: duration_ms_u64(PTY_OUTPUT_BATCH_INTERVAL),
        terminal_journal_flush_bytes: TERMINAL_JOURNAL_FLUSH_BYTES,
        terminal_journal_flush_interval_ms: duration_ms_u64(TERMINAL_JOURNAL_FLUSH_INTERVAL),
        ipc_latency_ms: None,
        db_write_latency_ms: match LAST_TERMINAL_JOURNAL_DB_WRITE_LATENCY_MS.load(Ordering::Relaxed)
        {
            DB_WRITE_LATENCY_UNSET => None,
            ms => Some(ms),
        },
        event_queue_lag_ms: None,
    }
}

/// List active terminals
#[tauri::command]
pub fn list_terminals(app: AppHandle) -> Vec<String> {
    let pty_manager = app.state::<PtyManager>();
    pty_manager.list()
}

/// Detect available shells
#[tauri::command]
pub fn detect_shells() -> Vec<ShellType> {
    ShellType::detect_available()
}

/// Discover Git projects in scan directories
#[tauri::command]
pub fn discover_projects(scan_dirs: Vec<String>) -> Vec<crate::git::ProjectInfo> {
    crate::git::discover_projects(&scan_dirs)
}

/// Default project scan directories for the current user — Documents,
/// Desktop, and the user's home. Returned as platform-absolute paths so the
/// frontend can hand them straight to `discover_projects` without pulling
/// in `~` expansion or environment-variable logic in JS.
///
/// Returns an empty vec if the user profile can't be resolved (extremely
/// rare on Windows; the frontend should have its own fallback).
#[tauri::command]
pub fn default_project_scan_dirs() -> Vec<String> {
    let mut dirs: Vec<String> = Vec::new();
    // `home_dir` is deprecated in the std crate but the Tauri v2 ecosystem
    // still relies on it. The frontend will dedupe any duplicate paths.
    #[allow(deprecated)]
    if let Some(home) = std::env::home_dir() {
        let home_str = home.to_string_lossy().replace('\\', "/");
        dirs.push(format!("{}/Documents", home_str));
        dirs.push(format!("{}/Desktop", home_str));
        dirs.push(home_str);
    }
    dirs
}

/// List branches for a project
#[tauri::command]
pub fn list_branches(repo_path: String) -> Result<Vec<crate::git::BranchInfo>, String> {
    crate::git::list_branches(&repo_path)
}

/// List worktrees for a project
#[tauri::command]
pub fn list_worktrees(repo_path: String) -> Result<Vec<crate::git::WorktreeInfo>, String> {
    crate::git::list_worktrees(&repo_path)
}

/// List directory contents for file tree
#[tauri::command]
pub fn list_directory(path: String) -> Result<Vec<crate::git::FileEntry>, String> {
    crate::git::list_directory(&path)
}

/// Create a git worktree
#[tauri::command]
pub fn create_worktree(
    repo_path: String,
    branch_name: String,
) -> Result<crate::git::WorktreeInfo, String> {
    crate::git::create_worktree(&repo_path, &branch_name)
}

/// Remove a git worktree (and optionally its branch)
#[tauri::command]
pub fn remove_worktree(
    repo_path: String,
    worktree_name: String,
    delete_branch: bool,
) -> Result<(), String> {
    crate::git::remove_worktree(&repo_path, &worktree_name, delete_branch)
}

/// Get git status for a repository
#[tauri::command]
pub fn git_status(repo_path: String) -> Result<crate::git::GitStatusInfo, String> {
    crate::git::git_status(&repo_path)
}

/// Stage files for commit
#[tauri::command]
pub fn git_stage(repo_path: String, paths: Vec<String>) -> Result<(), String> {
    let mut args = vec!["add".to_string(), "--".to_string()];
    args.extend(paths);
    run_git_cmd(&repo_path, &args)
}

/// Unstage files (reset HEAD)
#[tauri::command]
pub fn git_unstage(repo_path: String, paths: Vec<String>) -> Result<(), String> {
    let mut args = vec!["reset".to_string(), "HEAD".to_string(), "--".to_string()];
    args.extend(paths);
    run_git_cmd(&repo_path, &args)
}

/// Stage all changes
#[tauri::command]
pub fn git_stage_all(repo_path: String) -> Result<(), String> {
    run_git_cmd(&repo_path, &["add", "-A"])
}

/// Discard changes in working tree
#[tauri::command]
pub fn git_discard(repo_path: String, paths: Vec<String>) -> Result<(), String> {
    let mut args = vec!["checkout".to_string(), "--".to_string()];
    args.extend(paths);
    run_git_cmd(&repo_path, &args)
}

/// Create a commit
#[tauri::command]
pub fn git_commit(repo_path: String, message: String) -> Result<String, String> {
    run_git_cmd_with_output(&repo_path, &["commit", "-m", &message])
}

/// Push to remote
#[tauri::command]
pub fn git_push(repo_path: String) -> Result<String, String> {
    run_git_cmd_with_output(&repo_path, &["push"])
}

fn run_git_cmd(repo_path: &str, args: &[impl AsRef<std::ffi::OsStr>]) -> Result<(), String> {
    run_git_cmd_with_output(repo_path, args).map(|_| ())
}

fn run_git_cmd_with_output(
    repo_path: &str,
    args: &[impl AsRef<std::ffi::OsStr>],
) -> Result<String, String> {
    let output = std::process::Command::new("git")
        .args(args)
        .current_dir(repo_path)
        .output()
        .map_err(|e| format!("Git command failed: {}", e))?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

/// Search files by name in a directory tree
#[tauri::command]
pub fn search_files(
    root_path: String,
    query: String,
    max_results: u32,
) -> Result<Vec<crate::git::FileEntry>, String> {
    let mut results = Vec::new();
    let query_lower = query.to_lowercase();
    search_recursive(
        std::path::Path::new(&root_path),
        &query_lower,
        max_results,
        &mut results,
    );
    Ok(results)
}

fn search_recursive(
    dir: &std::path::Path,
    query: &str,
    max: u32,
    results: &mut Vec<crate::git::FileEntry>,
) {
    if results.len() >= max as usize {
        return;
    }
    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };
    for entry in entries.flatten() {
        if results.len() >= max as usize {
            return;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        let path = entry.path();
        let is_dir = path.is_dir();
        if is_dir
            && [
                ".git",
                "node_modules",
                "target",
                "__pycache__",
                ".venv",
                "dist",
                ".next",
                ".turbo",
            ]
            .contains(&name.as_str())
        {
            continue;
        }
        if name.to_lowercase().contains(query) {
            let full = path.to_string_lossy().to_string().replace('\\', "/");
            let file_type = if is_dir {
                "folder".to_string()
            } else {
                crate::git::ext_to_type(&name)
            };
            results.push(crate::git::FileEntry {
                name: name.clone(),
                path: full,
                is_dir,
                file_type,
                children_count: 0,
            });
        }
        if is_dir {
            search_recursive(&path, query, max, results);
        }
    }
}

/// Search file contents (grep-like)
#[tauri::command]
pub fn grep_files(
    root_path: String,
    pattern: String,
    max_results: u32,
) -> Result<Vec<GrepResult>, String> {
    let mut results = Vec::new();
    let pattern_lower = pattern.to_lowercase();
    grep_recursive(
        std::path::Path::new(&root_path),
        &pattern_lower,
        max_results,
        &mut results,
    );
    Ok(results)
}

#[derive(serde::Serialize)]
pub struct GrepResult {
    pub file: String,
    pub line: u32,
    pub content: String,
}

fn grep_recursive(dir: &std::path::Path, pattern: &str, max: u32, results: &mut Vec<GrepResult>) {
    if results.len() >= max as usize {
        return;
    }
    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };
    for entry in entries.flatten() {
        if results.len() >= max as usize {
            return;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        let path = entry.path();
        if path.is_dir() {
            if [
                ".git",
                "node_modules",
                "target",
                "__pycache__",
                ".venv",
                "dist",
                ".next",
                ".turbo",
                "coverage",
            ]
            .contains(&name.as_str())
            {
                continue;
            }
            grep_recursive(&path, pattern, max, results);
        } else {
            // Skip binary/large files
            let ext = name.rsplit('.').next().unwrap_or("").to_lowercase();
            if [
                "png", "jpg", "jpeg", "gif", "ico", "woff", "woff2", "ttf", "otf", "eot", "lock",
                "db",
            ]
            .contains(&ext.as_str())
            {
                continue;
            }
            if let Ok(meta) = std::fs::metadata(&path) {
                if meta.len() > 1024 * 1024 {
                    continue;
                } // Skip >1MB
            }
            if let Ok(content) = std::fs::read_to_string(&path) {
                for (i, line) in content.lines().enumerate() {
                    if results.len() >= max as usize {
                        break;
                    }
                    if line.to_lowercase().contains(pattern) {
                        results.push(GrepResult {
                            file: path.to_string_lossy().to_string().replace('\\', "/"),
                            line: (i + 1) as u32,
                            content: line.chars().take(200).collect(),
                        });
                    }
                }
            }
        }
    }
}

/// Get original file content from git HEAD (for diff)
#[tauri::command]
pub fn git_file_original(repo_path: String, file_path: String) -> Result<String, String> {
    // Normalize separators then compute relative path via strip_prefix
    let repo_norm = repo_path.replace('\\', "/");
    let file_norm = file_path.replace('\\', "/");
    let relative = file_norm
        .strip_prefix(&repo_norm)
        .unwrap_or(&file_norm)
        .trim_start_matches('/')
        .to_string();

    let output = std::process::Command::new("git")
        .args(["show", &format!("HEAD:{}", relative)])
        .current_dir(&repo_path)
        .output()
        .map_err(|e| format!("git show failed: {}", e))?;

    if output.status.success() {
        String::from_utf8(output.stdout).map_err(|e| format!("UTF-8 error: {}", e))
    } else {
        Err("File not in git HEAD".to_string())
    }
}

/// Get unified diff for a specific file against HEAD.
#[tauri::command]
pub fn git_diff_file(repo_path: String, file_path: String) -> Result<String, String> {
    let repo_norm = repo_path.replace('\\', "/");
    let file_norm = file_path.replace('\\', "/");
    let relative = file_norm
        .strip_prefix(&repo_norm)
        .unwrap_or(&file_norm)
        .trim_start_matches('/')
        .to_string();

    let output = std::process::Command::new("git")
        .args(["diff", "HEAD", "--", &relative])
        .current_dir(&repo_path)
        .output()
        .map_err(|e| format!("git diff failed: {}", e))?;

    if output.status.success() {
        String::from_utf8(output.stdout).map_err(|e| format!("UTF-8 error: {}", e))
    } else {
        // File might be untracked — show full content as "new file"
        let stderr = String::from_utf8_lossy(&output.stderr);
        Err(format!("git diff failed: {}", stderr))
    }
}

/// Get unified diffs for multiple files against HEAD (batch operation).
#[tauri::command]
pub fn git_diff_files(
    repo_path: String,
    file_paths: Vec<String>,
) -> Result<Vec<(String, String)>, String> {
    let repo_norm = repo_path.replace('\\', "/");
    let mut results = Vec::new();

    for file_path in file_paths {
        let file_norm = file_path.replace('\\', "/");
        let relative = file_norm
            .strip_prefix(&repo_norm)
            .unwrap_or(&file_norm)
            .trim_start_matches('/')
            .to_string();

        let output = std::process::Command::new("git")
            .args(["diff", "HEAD", "--", &relative])
            .current_dir(&repo_path)
            .output();

        let diff = match output {
            Ok(o) if o.status.success() => String::from_utf8_lossy(&o.stdout).to_string(),
            _ => String::new(),
        };
        results.push((relative, diff));
    }

    Ok(results)
}

/// List GitHub PRs for a repo
#[tauri::command]
pub fn list_pull_requests(cwd: String) -> Result<Vec<PullRequestInfo>, String> {
    let output = std::process::Command::new("gh")
        .args([
            "pr",
            "list",
            "--json",
            "number,title,state,author,headRefName,url,isDraft,updatedAt,reviewDecision,statusCheckRollup",
            "--limit",
            "10",
        ])
        .current_dir(&cwd)
        .output()
        .map_err(|e| format!("gh CLI not found: {}", e))?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }
    serde_json::from_slice(&output.stdout).map_err(|e| format!("Parse error: {}", e))
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct PullRequestInfo {
    pub number: u32,
    pub title: String,
    pub state: String,
    pub author: serde_json::Value,
    #[serde(rename = "headRefName")]
    pub head_ref_name: String,
    pub url: String,
    #[serde(rename = "isDraft", default)]
    pub is_draft: bool,
    #[serde(rename = "updatedAt", default)]
    pub updated_at: String,
    /// `APPROVED` / `CHANGES_REQUESTED` / `REVIEW_REQUIRED` / `COMMENTED` / ``.
    #[serde(rename = "reviewDecision", default)]
    pub review_decision: String,
    /// Each check entry has at minimum a `conclusion` ("SUCCESS" / "FAILURE" /
    /// "NEUTRAL" / "CANCELLED" / "SKIPPED" / "TIMED_OUT" / "ACTION_REQUIRED")
    /// and a `status` ("QUEUED" / "IN_PROGRESS" / "COMPLETED"). We keep it as
    /// a JSON value and let the frontend aggregate.
    #[serde(rename = "statusCheckRollup", default)]
    pub status_check_rollup: serde_json::Value,
}

/// View a specific PR's diff
#[tauri::command]
pub fn get_pr_diff(cwd: String, pr_number: u32) -> Result<String, String> {
    let output = std::process::Command::new("gh")
        .args(["pr", "diff", &pr_number.to_string()])
        .current_dir(&cwd)
        .output()
        .map_err(|e| format!("gh diff failed: {}", e))?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }
    String::from_utf8(output.stdout).map_err(|e| format!("UTF-8: {}", e))
}

/// Load app config
#[tauri::command]
pub fn load_app_config() -> crate::config::AppConfig {
    crate::config::load_config()
}

/// Save app config
#[tauri::command]
pub fn save_app_config(config: crate::config::AppConfig) -> Result<(), String> {
    crate::config::save_config(&config)
}

/// Get watchdog rules
#[tauri::command]
pub fn get_watchdog_rules() -> crate::watchdog::WatchdogRules {
    crate::watchdog::load_watchdog_rules()
}

/// Save watchdog rules
#[tauri::command]
pub fn save_watchdog_rules(rules: crate::watchdog::WatchdogRules) -> Result<(), String> {
    crate::watchdog::save_watchdog_rules(&rules)
}

/// Create a named watchdog
#[tauri::command]
pub fn create_watchdog(name: String, instructions: String) -> Result<(), String> {
    crate::watchdog::create_watchdog(&name, &instructions)
}

/// Read a file's contents
#[tauri::command]
pub fn read_file(path: String) -> Result<String, String> {
    validate_path(&path)?;
    let p = std::path::Path::new(&path);
    if !p.is_file() {
        return Err(format!("Not a file: {}", path));
    }
    let meta = std::fs::metadata(p).map_err(|e| format!("Metadata error: {}", e))?;
    if meta.len() > 5 * 1024 * 1024 {
        return Err("File too large (>5MB)".to_string());
    }
    std::fs::read_to_string(p).map_err(|e| format!("Read error: {}", e))
}

/// Write content to a file
#[tauri::command]
pub fn write_file(path: String, content: String) -> Result<(), String> {
    validate_path(&path)?;
    std::fs::write(&path, &content).map_err(|e| format!("Write error: {}", e))
}

/// Create a new file
#[tauri::command]
pub fn create_file(path: String, content: Option<String>) -> Result<(), String> {
    validate_path(&path)?;
    if std::path::Path::new(&path).exists() {
        return Err(format!("File already exists: {}", path));
    }
    if let Some(parent) = std::path::Path::new(&path).parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("mkdir: {}", e))?;
    }
    std::fs::write(&path, content.unwrap_or_default()).map_err(|e| format!("Create: {}", e))
}

/// Rename a file or directory
#[tauri::command]
pub fn rename_path(old_path: String, new_path: String) -> Result<(), String> {
    validate_path(&old_path)?;
    validate_path(&new_path)?;
    std::fs::rename(&old_path, &new_path).map_err(|e| format!("Rename: {}", e))
}

/// Delete a file or directory (protects .git and other critical dirs)
#[tauri::command]
pub fn delete_path(path: String) -> Result<(), String> {
    validate_path(&path)?;
    let p = std::path::Path::new(&path);
    // Protect critical directories from accidental deletion
    let name = p.file_name().and_then(|n| n.to_str()).unwrap_or("");
    let protected = [".git", ".hg", "node_modules", ".env"];
    if p.is_dir() && protected.contains(&name) {
        return Err(format!("Cannot delete protected directory: {}", name));
    }
    if p.is_dir() {
        std::fs::remove_dir_all(p).map_err(|e| format!("Delete dir: {}", e))
    } else {
        std::fs::remove_file(p).map_err(|e| format!("Delete file: {}", e))
    }
}

/// Create a new directory
#[tauri::command]
pub fn create_directory(path: String) -> Result<(), String> {
    validate_path(&path)?;
    std::fs::create_dir_all(&path).map_err(|e| format!("mkdir: {}", e))
}

/// Start a Claude Code agent session
fn extract_agent_tool_name(value: &serde_json::Value) -> Option<&str> {
    value
        .get("name")
        .and_then(|v| v.as_str())
        .or_else(|| value.get("tool_name").and_then(|v| v.as_str()))
        .or_else(|| {
            value
                .get("message")
                .and_then(|m| m.get("content"))
                .and_then(|c| c.as_array())
                .and_then(|items| {
                    items
                        .iter()
                        .find(|item| item.get("type").and_then(|v| v.as_str()) == Some("tool_use"))
                })
                .and_then(|item| {
                    item.get("name")
                        .or_else(|| item.get("tool_name"))
                        .and_then(|v| v.as_str())
                })
        })
}

fn agent_sessions_updated_event() -> &'static str {
    "agent-sessions-updated"
}

fn agent_output_event(session_id: &str) -> String {
    format!("agent-output-{session_id}")
}

fn watchdog_decision_event(session_id: &str) -> String {
    format!("watchdog-decision-{session_id}")
}

fn agent_exit_event(session_id: &str) -> String {
    format!("agent-exit-{session_id}")
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct AgentWatchdogEventPayload {
    decision: String,
    tool: String,
    rule: String,
}

impl AgentWatchdogEventPayload {
    fn to_event_json(&self) -> String {
        serde_json::json!({
            "decision": self.decision,
            "tool": self.tool,
            "rule": self.rule,
        })
        .to_string()
    }
}

#[derive(Debug, Clone, PartialEq)]
struct AgentStreamLineEffect {
    status: Option<&'static str>,
    usage: Option<(f64, u64)>,
    watchdog: Option<AgentWatchdogEventPayload>,
    log_level: Option<&'static str>,
    emit_sessions: bool,
}

fn analyze_agent_stream_line(
    line: &str,
    watchdog: &crate::watchdog::engine::WatchdogEngine,
) -> Option<AgentStreamLineEffect> {
    let val = serde_json::from_str::<serde_json::Value>(line).ok()?;
    let msg_type = val.get("type").and_then(|v| v.as_str())?;
    let tool_name = extract_agent_tool_name(&val);
    let is_tool_use = tool_name.is_some()
        && (msg_type == "tool_use"
            || val.get("subtype").and_then(|v| v.as_str()) == Some("tool_use")
            || val
                .get("message")
                .and_then(|m| m.get("content"))
                .and_then(|c| c.as_array())
                .map(|items| {
                    items
                        .iter()
                        .any(|item| item.get("type").and_then(|v| v.as_str()) == Some("tool_use"))
                })
                .unwrap_or(false));

    if is_tool_use {
        let tool_name = tool_name?;
        let decision = watchdog.evaluate(tool_name);
        let (decision_name, rule, level, status) = match &decision {
            crate::watchdog::engine::WatchdogDecision::AutoApprove { rule } => {
                ("approved", rule.as_str(), "INFO", "coding")
            }
            crate::watchdog::engine::WatchdogDecision::AutoDeny { rule } => {
                ("denied", rule.as_str(), "WARN", "error")
            }
            crate::watchdog::engine::WatchdogDecision::AskUser => ("manual", "", "WARN", "waiting"),
        };

        return Some(AgentStreamLineEffect {
            status: Some(status),
            usage: None,
            watchdog: Some(AgentWatchdogEventPayload {
                decision: decision_name.to_string(),
                tool: tool_name.to_string(),
                rule: rule.to_string(),
            }),
            log_level: Some(level),
            emit_sessions: !matches!(
                decision,
                crate::watchdog::engine::WatchdogDecision::AutoApprove { .. }
            ),
        });
    }

    match msg_type {
        "assistant" => Some(AgentStreamLineEffect {
            status: Some("coding"),
            usage: None,
            watchdog: None,
            log_level: None,
            emit_sessions: true,
        }),
        "result" => Some(AgentStreamLineEffect {
            status: Some("done"),
            usage: val.get("cost_usd").and_then(|v| v.as_f64()).map(|cost| {
                (
                    cost,
                    val.get("total_tokens")
                        .and_then(|v| v.as_u64())
                        .unwrap_or(0),
                )
            }),
            watchdog: None,
            log_level: None,
            emit_sessions: true,
        }),
        _ => Some(AgentStreamLineEffect {
            status: None,
            usage: None,
            watchdog: None,
            log_level: None,
            emit_sessions: false,
        }),
    }
}

#[tauri::command]
pub fn start_agent(
    app: AppHandle,
    prompt: String,
    cwd: String,
    model: Option<String>,
) -> Result<String, String> {
    let agent_manager = app.state::<crate::agent::AgentManager>();
    let id = agent_manager.start_session(&prompt, &cwd, model.as_deref(), None, None)?;

    // Stream stdout to frontend via events
    let reader = agent_manager.take_stdout(&id)?;
    let stderr_reader = agent_manager.take_stderr(&id).ok();
    let session_id = id.clone();
    let app_handle = app.clone();
    let agent_mgr = app.state::<crate::agent::AgentManager>().inner().clone();
    let log_ring = app.state::<crate::logging::LogRing>().inner().clone();

    // Initialize watchdog engine for this session
    let watchdog_rules = crate::watchdog::load_watchdog_rules();
    let watchdog = crate::watchdog::engine::WatchdogEngine::new(watchdog_rules);

    if let Some(stderr_reader) = stderr_reader {
        let stderr_session_id = session_id.clone();
        let stderr_app = app_handle.clone();
        let stderr_log_ring = log_ring.clone();
        std::thread::spawn(move || {
            for line in stderr_reader.lines() {
                let Ok(line) = line else {
                    break;
                };
                if line.is_empty() {
                    continue;
                }
                let mut fields = HashMap::new();
                fields.insert("event".into(), "agent_stderr".into());
                fields.insert("session_id".into(), stderr_session_id.clone());
                stderr_log_ring.push_entry(
                    "WARN",
                    "aether_terminal_lib::agent::stderr",
                    line.chars().take(500).collect::<String>(),
                    fields,
                );
                let _ = stderr_app.emit(
                    &agent_output_event(&stderr_session_id),
                    format!("[stderr] {}", line.chars().take(500).collect::<String>()),
                );
            }
        });
    }

    std::thread::spawn(move || {
        // Helper: emit full session list to frontend (push updates)
        let emit_sessions = |mgr: &crate::agent::AgentManager, handle: &AppHandle| {
            let sessions = mgr.list_sessions();
            let _ = handle.emit(agent_sessions_updated_event(), &sessions);
        };

        // Notify frontend of initial session
        emit_sessions(&agent_mgr, &app_handle);

        for line in reader.lines() {
            match line {
                Ok(line) if !line.is_empty() => {
                    let event = agent_output_event(&session_id);
                    let _ = app_handle.emit(&event, &line);

                    // Parse status from stream-json and push updates
                    if let Some(effect) = analyze_agent_stream_line(&line, &watchdog) {
                        if let Some(status) = effect.status {
                            let _ = agent_mgr.update_status(&session_id, status);
                        }
                        if let Some((cost, tokens)) = effect.usage {
                            let _ = agent_mgr.update_usage(&session_id, cost, tokens);
                        }
                        if let Some(payload) = effect.watchdog {
                            let mut fields = HashMap::new();
                            fields.insert("event".into(), "watchdog_decision".into());
                            fields.insert("session_id".into(), session_id.clone());
                            fields.insert("tool".into(), payload.tool.clone());
                            fields.insert("decision".into(), payload.decision.clone());
                            if !payload.rule.is_empty() {
                                fields.insert("rule".into(), payload.rule.clone());
                            }
                            log_ring.push_entry(
                                effect.log_level.unwrap_or("INFO"),
                                "aether_terminal_lib::agent::watchdog",
                                format!("watchdog {}: {}", payload.decision, payload.tool),
                                fields,
                            );
                            let _ = app_handle.emit(
                                &watchdog_decision_event(&session_id),
                                &payload.to_event_json(),
                            );
                        }
                        if effect.emit_sessions {
                            emit_sessions(&agent_mgr, &app_handle);
                        }
                    }
                }
                Ok(_) => {}
                Err(_) => break,
            }
        }
        // Process ended — update status to done, emit exit event + session list
        let _ = agent_mgr.update_status(&session_id, "done");
        let _ = agent_mgr.reap_session(&session_id);
        let _ = app_handle.emit(&agent_exit_event(&session_id), ());
        emit_sessions(&agent_mgr, &app_handle);
    });

    Ok(id)
}

/// Stop an agent session
#[tauri::command]
pub fn stop_agent(app: AppHandle, id: String) -> Result<(), String> {
    let agent_manager = app.state::<crate::agent::AgentManager>();
    agent_manager.stop_session(&id)?;
    // Push updated session list
    let sessions = agent_manager.list_sessions();
    let _ = app.emit(agent_sessions_updated_event(), &sessions);
    Ok(())
}

/// List agent sessions
#[tauri::command]
pub fn list_agents(app: AppHandle) -> Vec<crate::agent::AgentSessionInfo> {
    let agent_manager = app.state::<crate::agent::AgentManager>();
    agent_manager.list_sessions()
}

/// Route a prompt to the best model
#[tauri::command]
pub fn route_agent(prompt: String, budget: Option<f64>) -> crate::agent::router::RoutingDecision {
    crate::agent::router::AgentRouter::route(&prompt, budget)
}

/// Start a chat agent session (supports --resume for multi-turn)
#[tauri::command]
pub fn start_chat_agent(
    app: AppHandle,
    conversation_id: String,
    prompt: String,
    cwd: String,
    model: Option<String>,
    resume_id: Option<String>,
    images: Option<Vec<String>>,
) -> Result<String, String> {
    let agent_manager = app.state::<crate::agent::AgentManager>();

    // Build image args: save base64 to temp files
    let image_paths: Vec<String> = if let Some(imgs) = &images {
        let tmp_dir = std::env::temp_dir().join("aether-chat-images");
        std::fs::create_dir_all(&tmp_dir).ok();
        imgs.iter()
            .enumerate()
            .filter_map(|(i, data)| {
                // Strip data URI prefix if present
                let raw = if let Some(pos) = data.find(",") {
                    &data[pos + 1..]
                } else {
                    data.as_str()
                };
                // Simple base64 decode
                let bytes = base64_decode(raw).ok()?;
                let path = tmp_dir.join(format!(
                    "img_{}_{}.png",
                    conversation_id.replace('-', ""),
                    i
                ));
                std::fs::write(&path, &bytes).ok()?;
                Some(path.to_string_lossy().to_string())
            })
            .collect()
    } else {
        vec![]
    };

    let id =
        agent_manager.start_session(&prompt, &cwd, model.as_deref(), None, resume_id.as_deref())?;

    // Inject --image flags into the CLI process
    // Note: images are passed via start_session's command builder
    // For now, we handle it by modifying the prompt to include image references
    // TODO: Extend start_session to accept image paths

    let reader = agent_manager.take_stdout(&id)?;
    let session_id = id.clone();
    let conv_id = conversation_id.clone();
    let app_handle = app.clone();
    let agent_mgr = app.state::<crate::agent::AgentManager>().inner().clone();

    std::thread::spawn(move || {
        for line in reader.lines() {
            match line {
                Ok(line) if !line.is_empty() => {
                    let event = format!("chat-stream-{}", conv_id);
                    let _ = app_handle.emit(&event, &line);

                    // Update session status from stream
                    if let Ok(val) = serde_json::from_str::<serde_json::Value>(&line) {
                        if let Some(msg_type) = val.get("type").and_then(|v| v.as_str()) {
                            match msg_type {
                                "assistant" => {
                                    let _ = agent_mgr.update_status(&session_id, "coding");
                                }
                                "result" => {
                                    let _ = agent_mgr.update_status(&session_id, "done");
                                    if let Some(cost) = val.get("cost_usd").and_then(|v| v.as_f64())
                                    {
                                        let tokens = val
                                            .get("total_tokens")
                                            .and_then(|v| v.as_u64())
                                            .unwrap_or(0);
                                        let _ = agent_mgr.update_usage(&session_id, cost, tokens);
                                    }
                                    // Send session_id from result for --resume
                                    if let Some(sid) =
                                        val.get("session_id").and_then(|v| v.as_str())
                                    {
                                        let _ = app_handle
                                            .emit(&format!("chat-session-id-{}", conv_id), sid);
                                    }
                                }
                                _ => {}
                            }
                        }
                    }
                }
                Ok(_) => {}
                Err(_) => break,
            }
        }
        let _ = app_handle.emit(&format!("chat-complete-{}", conv_id), &session_id);

        // Clean up temp images
        for p in &image_paths {
            std::fs::remove_file(p).ok();
        }
    });

    Ok(id)
}

/// Save a base64-encoded image to a temp file, return the file path
#[tauri::command]
pub fn save_temp_image(data: String) -> Result<String, String> {
    let tmp_dir = std::env::temp_dir().join("aether-chat-images");
    std::fs::create_dir_all(&tmp_dir).map_err(|e| e.to_string())?;
    // Strip data URI prefix if present
    let raw = if let Some(pos) = data.find(',') {
        &data[pos + 1..]
    } else {
        data.as_str()
    };
    let bytes = base64_decode(raw)?;
    let name = format!("img_{}.png", uuid::Uuid::new_v4());
    let path = tmp_dir.join(&name);
    std::fs::write(&path, &bytes).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().to_string())
}

/// Stop a chat agent session
#[tauri::command]
pub fn stop_chat_agent(app: AppHandle, id: String) -> Result<(), String> {
    let agent_manager = app.state::<crate::agent::AgentManager>();
    agent_manager.stop_session(&id)
}

fn base64_decode(input: &str) -> Result<Vec<u8>, String> {
    const CHARS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut buf = Vec::with_capacity(input.len() * 3 / 4);
    let mut acc: u32 = 0;
    let mut bits: u32 = 0;
    for &b in input.as_bytes() {
        if b == b'=' || b == b'\n' || b == b'\r' {
            continue;
        }
        let val = CHARS.iter().position(|&c| c == b).ok_or("invalid base64")? as u32;
        acc = (acc << 6) | val;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            buf.push((acc >> bits) as u8);
            acc &= (1 << bits) - 1;
        }
    }
    Ok(buf)
}

// --- Session management commands ---

use crate::db::queries::{Pane, RestoredSession, Session};
use crate::db::{self, Database};

#[tauri::command]
pub fn create_session(name: &str) -> Result<Session, String> {
    let db = Database::open(&db::db_path())?;
    db.create_session(name)
}

#[tauri::command]
pub fn list_db_sessions() -> Result<Vec<Session>, String> {
    let db = Database::open(&db::db_path())?;
    db.list_sessions()
}

#[tauri::command]
pub fn delete_session(id: &str) -> Result<(), String> {
    let db = Database::open(&db::db_path())?;
    db.delete_session(id)
}

#[tauri::command]
pub fn restore_last_session() -> Result<Option<RestoredSession>, String> {
    let db = Database::open(&db::db_path())?;
    db.restore_last_session()
}

#[tauri::command]
pub fn create_window(session_id: &str, title: &str) -> Result<crate::db::queries::Window, String> {
    let db = Database::open(&db::db_path())?;
    db.create_window(session_id, title)
}

#[tauri::command]
pub fn create_pane(
    window_id: &str,
    shell_type: &str,
    cwd: &str,
    cols: u16,
    rows: u16,
) -> Result<Pane, String> {
    let db = Database::open(&db::db_path())?;
    db.create_pane(window_id, shell_type, cwd, cols, rows)
}

#[tauri::command]
pub fn save_session_state(session_id: &str) -> Result<(), String> {
    let db = Database::open(&db::db_path())?;
    db.touch_session(session_id)
}

#[tauri::command]
pub fn save_pane_tree_layout(
    app: AppHandle,
    storage_key: String,
    project_path: String,
    layout_json: String,
) -> Result<(), String> {
    let db = app.state::<crate::db::ManagedDb>();
    db.with(|d| d.save_pane_tree_layout(&storage_key, &project_path, &layout_json))
}

#[tauri::command]
pub fn get_pane_tree_layout(
    app: AppHandle,
    storage_key: String,
) -> Result<Option<crate::db::PaneTreeLayoutRecord>, String> {
    let db = app.state::<crate::db::ManagedDb>();
    db.with(|d| d.get_pane_tree_layout(&storage_key))
}

#[tauri::command]
pub fn delete_pane_tree_layout(app: AppHandle, storage_key: String) -> Result<(), String> {
    let db = app.state::<crate::db::ManagedDb>();
    db.with(|d| d.delete_pane_tree_layout(&storage_key))
}

// --- Workspace pane commands ---

const MAX_KEYS_BYTES: usize = 1024 * 1024; // 1 MB

fn validate_keys_payload(data: &str) -> Result<(), String> {
    if data.is_empty() {
        return Err("Input data is required".to_string());
    }
    if data.len() > MAX_KEYS_BYTES {
        return Err("Input data exceeds maximum allowed size (1 MB)".to_string());
    }
    Ok(())
}

/// Send keystrokes to a specific terminal pane. Mirrors `write_terminal`'s
/// snapshot hook so Orchestra agents that drive a pane through this IPC
/// also appear on the time-travel timeline.
#[tauri::command]
pub fn send_keys(app: AppHandle, terminal_id: String, data: String) -> Result<(), String> {
    validate_keys_payload(&data)?;
    let pty_manager = app.state::<PtyManager>();
    let bytes = data.as_bytes();
    match pty_manager.write(&terminal_id, bytes) {
        Ok(()) => {
            record_audit_event(
                &app,
                "terminal",
                "send_keys",
                "info",
                Some("terminal"),
                Some(&terminal_id),
                "Pane input sent",
                serde_json::json!({
                    "bytes": bytes.len(),
                    "containsEnter": bytes.contains(&b'\r'),
                    "redacted": true,
                }),
            );
            capture_if_enter(&app, &terminal_id, bytes);
            Ok(())
        }
        Err(err) => {
            record_audit_event(
                &app,
                "terminal",
                "send_keys_failed",
                "warn",
                Some("terminal"),
                Some(&terminal_id),
                "Pane input failed",
                serde_json::json!({
                    "bytes": bytes.len(),
                    "containsEnter": bytes.contains(&b'\r'),
                    "error": sanitize_audit_error(&err),
                    "redacted": true,
                }),
            );
            Err(err)
        }
    }
}

/// Capture recent output from a terminal pane
#[tauri::command]
pub fn capture_pane(
    app: AppHandle,
    terminal_id: String,
    lines: Option<usize>,
    strip_ansi_codes: Option<bool>,
) -> Result<String, String> {
    let registry = app.state::<OutputBufferRegistry>();
    let n = lines.unwrap_or(50).min(1000);
    let clean = strip_ansi_codes.unwrap_or(false);
    registry.capture(&terminal_id, n, clean)
}

/// Extract command blocks from a terminal's output buffer
#[tauri::command]
pub fn command_blocks(
    app: AppHandle,
    terminal_id: String,
) -> Result<Vec<crate::pty::buffer::CommandBlock>, String> {
    let registry = app.state::<OutputBufferRegistry>();
    registry.command_blocks(&terminal_id)
}

/// Send keystrokes to all active terminal panes (synchronize-panes). Each
/// successfully written pane also gets its own snapshot captured when the
/// payload ends a command, so the timeline stays consistent across panes.
#[tauri::command]
pub fn broadcast_keys(app: AppHandle, data: String) -> Result<u32, String> {
    validate_keys_payload(&data)?;
    let pty_manager = app.state::<PtyManager>();
    let ids = pty_manager.list();
    if ids.is_empty() {
        let err = "No active terminal panes".to_string();
        record_audit_event(
            &app,
            "terminal",
            "broadcast_keys_failed",
            "warn",
            Some("terminal_group"),
            None,
            "Broadcast input failed",
            serde_json::json!({
                "targets": 0,
                "accepted": 0,
                "bytes": data.len(),
                "containsEnter": data.as_bytes().contains(&b'\r'),
                "error": err,
                "redacted": true,
            }),
        );
        return Err(err);
    }
    let mut count: u32 = 0;
    let mut last_error: Option<String> = None;
    for id in &ids {
        match pty_manager.write(id, data.as_bytes()) {
            Ok(()) => {
                count += 1;
                capture_if_enter(&app, id, data.as_bytes());
            }
            Err(err) => last_error = Some(err),
        }
    }
    record_audit_event(
        &app,
        "terminal",
        if count > 0 {
            "broadcast_keys"
        } else {
            "broadcast_keys_failed"
        },
        if count > 0 { "info" } else { "warn" },
        Some("terminal_group"),
        None,
        if count > 0 {
            "Broadcast input sent"
        } else {
            "Broadcast input failed"
        },
        serde_json::json!({
            "targets": ids.len(),
            "accepted": count,
            "bytes": data.len(),
            "containsEnter": data.as_bytes().contains(&b'\r'),
            "error": last_error.as_deref().map(sanitize_audit_error),
            "redacted": true,
        }),
    );
    if count == 0 {
        return Err(last_error.unwrap_or_else(|| "No pane accepted input".to_string()));
    }
    Ok(count)
}

/// Rename a terminal pane (for send-keys-by-name)
#[tauri::command]
pub fn rename_pane(app: AppHandle, terminal_id: String, name: String) -> Result<(), String> {
    let registry = app.state::<crate::pty::PaneRegistry>();
    registry.rename(&terminal_id, &name)
}

/// Assign a role to a terminal pane for workstation routing.
#[tauri::command]
pub fn set_pane_role(app: AppHandle, terminal_id: String, role: String) -> Result<(), String> {
    let registry = app.state::<crate::pty::PaneRegistry>();
    registry.set_role(&terminal_id, &role)
}

/// Send keystrokes to a pane by its user-assigned name. Same snapshot
/// hook as `send_keys` so name-addressed writes appear on the timeline.
#[tauri::command]
pub fn send_keys_by_name(app: AppHandle, name: String, data: String) -> Result<(), String> {
    validate_keys_payload(&data)?;
    let pane_registry = app.state::<crate::pty::PaneRegistry>();
    let terminal_id = pane_registry
        .find_by_name_unique(&name)?
        .ok_or_else(|| format!("No pane named '{}'", name))?;
    let pty_manager = app.state::<PtyManager>();
    let bytes = data.as_bytes();
    match pty_manager.write(&terminal_id, bytes) {
        Ok(()) => {
            record_audit_event(
                &app,
                "terminal",
                "send_keys_by_name",
                "info",
                Some("terminal"),
                Some(&terminal_id),
                "Named pane input sent",
                serde_json::json!({
                    "targetName": name,
                    "bytes": bytes.len(),
                    "containsEnter": bytes.contains(&b'\r'),
                    "redacted": true,
                }),
            );
            capture_if_enter(&app, &terminal_id, bytes);
            Ok(())
        }
        Err(err) => {
            record_audit_event(
                &app,
                "terminal",
                "send_keys_by_name_failed",
                "warn",
                Some("terminal"),
                Some(&terminal_id),
                "Named pane input failed",
                serde_json::json!({
                    "targetName": name,
                    "bytes": bytes.len(),
                    "containsEnter": bytes.contains(&b'\r'),
                    "error": sanitize_audit_error(&err),
                    "redacted": true,
                }),
            );
            Err(err)
        }
    }
}

/// Send keystrokes to every pane assigned a role. Role sends are intentionally
/// scoped broadcasts because several panes may share a workstation role.
#[tauri::command]
pub fn send_keys_by_role(app: AppHandle, role: String, data: String) -> Result<u32, String> {
    validate_keys_payload(&data)?;
    let pane_registry = app.state::<crate::pty::PaneRegistry>();
    let terminal_ids = pane_registry.find_by_role(&role);
    if terminal_ids.is_empty() {
        let err = format!("No pane with role '{}'", role);
        record_audit_event(
            &app,
            "terminal",
            "send_keys_failed",
            "warn",
            Some("terminal_group"),
            None,
            "Pane role input failed",
            serde_json::json!({
                "targetKind": "role",
                "bytes": data.len(),
                "containsEnter": data.as_bytes().contains(&b'\r'),
                "error": sanitize_audit_error(&err),
                "redacted": true,
            }),
        );
        return Err(err);
    }
    write_to_terminals(&app, terminal_ids, data.as_bytes())
}

/// Send keystrokes to a pane target. Targets prefixed with `@` or `role:`
/// resolve as roles; exact PTY ids resolve directly. Unprefixed labels may
/// resolve by pane name or role, but a name/role collision is rejected so
/// input is not silently sent to the wrong pane.
#[tauri::command]
pub fn send_keys_by_target(app: AppHandle, target: String, data: String) -> Result<u32, String> {
    validate_keys_payload(&data)?;
    let trimmed = target.trim();
    if trimmed.is_empty() {
        return Err("Pane target is required".to_string());
    }

    let pane_registry = app.state::<crate::pty::PaneRegistry>();
    let terminal_ids = match pane_registry.resolve_send_target(trimmed) {
        Ok(ids) => ids,
        Err(err) => {
            record_audit_event(
                &app,
                "terminal",
                "send_keys_failed",
                "warn",
                Some("terminal_group"),
                None,
                "Pane target input failed",
                serde_json::json!({
                    "targetKind": "target",
                    "bytes": data.len(),
                    "containsEnter": data.as_bytes().contains(&b'\r'),
                    "error": sanitize_audit_error(&err),
                    "redacted": true,
                }),
            );
            return Err(err);
        }
    };

    if terminal_ids.is_empty() {
        let err = format!("No pane target '{}'", target);
        record_audit_event(
            &app,
            "terminal",
            "send_keys_failed",
            "warn",
            Some("terminal_group"),
            None,
            "Pane target input failed",
            serde_json::json!({
                "targetKind": "target",
                "bytes": data.len(),
                "containsEnter": data.as_bytes().contains(&b'\r'),
                "error": sanitize_audit_error(&err),
                "redacted": true,
            }),
        );
        return Err(err);
    }
    write_to_terminals(&app, terminal_ids, data.as_bytes())
}

fn write_to_terminals(
    app: &AppHandle,
    terminal_ids: Vec<String>,
    data: &[u8],
) -> Result<u32, String> {
    let pty_manager = app.state::<PtyManager>();
    let mut count: u32 = 0;
    let mut last_error: Option<String> = None;
    let target_count = terminal_ids.len();
    for terminal_id in terminal_ids {
        match pty_manager.write(&terminal_id, data) {
            Ok(()) => {
                count += 1;
                capture_if_enter(app, &terminal_id, data);
            }
            Err(err) => last_error = Some(err),
        }
    }
    if count == 0 {
        let err = last_error.unwrap_or_else(|| "No pane accepted input".to_string());
        record_audit_event(
            app,
            "terminal",
            "send_keys_failed",
            "warn",
            Some("terminal_group"),
            None,
            "Pane group input failed",
            serde_json::json!({
                "targets": target_count,
                "bytes": data.len(),
                "containsEnter": data.contains(&b'\r'),
                "error": sanitize_audit_error(&err),
                "redacted": true,
            }),
        );
        return Err(err);
    }
    record_audit_event(
        app,
        "terminal",
        "send_keys",
        "info",
        Some("terminal_group"),
        None,
        "Pane group input sent",
        serde_json::json!({
            "targets": target_count,
            "accepted": count,
            "bytes": data.len(),
            "containsEnter": data.contains(&b'\r'),
            "redacted": true,
        }),
    );
    Ok(count)
}

/// List all registered panes with metadata
#[tauri::command]
pub fn list_panes_info(app: AppHandle) -> Vec<crate::pty::registry::PaneEntry> {
    let registry = app.state::<crate::pty::PaneRegistry>();
    let active_terminal_ids = app.state::<PtyManager>().list();
    registry.list_active(&active_terminal_ids)
}

/// Start watching a directory for file changes (100ms debounce → "fs:changed" event)
#[tauri::command]
pub fn start_fs_watcher(app: AppHandle, watch_path: String) -> Result<(), String> {
    let registry = app.state::<FsWatcherRegistry>();
    registry.start(app.clone(), watch_path)
}

/// Stop watching a directory
#[tauri::command]
pub fn stop_fs_watcher(watch_path: String, app: AppHandle) -> Result<(), String> {
    let registry = app.state::<FsWatcherRegistry>();
    registry.stop(&watch_path);
    Ok(())
}

/// Registry for active file watchers
#[derive(Default)]
pub struct FsWatcherRegistry {
    watchers: Mutex<HashMap<String, crate::watcher::WatcherHandle>>,
}

impl FsWatcherRegistry {
    pub fn new() -> Self {
        Self {
            watchers: Mutex::new(HashMap::new()),
        }
    }

    pub fn start(&self, app: AppHandle, path: String) -> Result<(), String> {
        let mut watchers = self
            .watchers
            .lock()
            .map_err(|_| "Lock poisoned".to_string())?;
        if watchers.contains_key(&path) {
            return Ok(()); // Already watching
        }
        let handle = crate::watcher::start_watcher(app, path.clone())?;
        watchers.insert(path, handle);
        Ok(())
    }

    pub fn stop(&self, path: &str) {
        if let Ok(mut watchers) = self.watchers.lock() {
            watchers.remove(path); // WatcherHandle drop stops the watcher
        }
    }
}

// ── Workflow commands ──

/// List available workflow definitions for a project
#[tauri::command]
pub fn list_workflows(project_path: String) -> Vec<crate::workflow::WorkflowSummary> {
    crate::workflow::list_workflow_files(&project_path)
}

/// Start a workflow execution
#[tauri::command]
pub fn start_workflow(
    app: AppHandle,
    project_path: String,
    workflow_path: String,
    task_title: String,
) -> Result<crate::workflow::WorkflowStatus, String> {
    let workflow = crate::workflow::parse_workflow(&workflow_path)?;
    let workflow_name = workflow.name.clone();
    let phase_count = workflow.phases.len();
    let executor = app.state::<crate::workflow::WorkflowExecutor>();
    if let Err(err) = executor.restore_project(&project_path) {
        log::warn!(
            "failed to restore workflow runs before start for project={:?}: {}",
            project_path,
            err
        );
    }
    let id = executor.start(workflow, &task_title, &project_path)?;
    record_audit_event(
        &app,
        "workflow",
        "start",
        "info",
        Some("workflow"),
        Some(&id),
        "Workflow started",
        serde_json::json!({
            "name": workflow_name,
            "phases": phase_count,
            "projectPath": project_path,
            "workflowPath": workflow_path,
            "taskTitle": task_title,
        }),
    );
    executor.status(&id)
}

/// Get the current phase config for a workflow (so frontend can start the agent)
#[tauri::command]
pub fn workflow_current_phase(
    app: AppHandle,
    workflow_id: String,
) -> Result<WorkflowPhaseInfo, String> {
    let executor = app.state::<crate::workflow::WorkflowExecutor>();
    let (phase, prompt) = executor.current_phase_config(&workflow_id)?;
    Ok(WorkflowPhaseInfo {
        name: phase.name,
        model: phase.agent.model,
        prompt,
        max_cost: phase.agent.max_cost,
        target_pane: phase.target_pane,
        agent_role: phase.agent_role,
        has_gate: phase.quality_gate.is_some(),
        gate_type: phase.quality_gate.map(|g| format!("{:?}", g.gate_type)),
    })
}

#[derive(serde::Serialize)]
pub struct WorkflowPhaseInfo {
    pub name: String,
    pub model: String,
    pub prompt: String,
    pub max_cost: f64,
    pub target_pane: Option<String>,
    pub agent_role: Option<String>,
    pub has_gate: bool,
    pub gate_type: Option<String>,
}

/// Emit workflow status update event to frontend
fn emit_workflow_update(app: &AppHandle, executor: &crate::workflow::WorkflowExecutor) {
    let statuses = executor.list();
    let _ = app.emit("workflow-updated", statuses);
}

/// Record that an agent was started for the current phase
#[tauri::command]
pub fn workflow_set_agent(
    app: AppHandle,
    workflow_id: String,
    agent_session_id: String,
) -> Result<(), String> {
    let executor = app.state::<crate::workflow::WorkflowExecutor>();
    executor.set_phase_agent(&workflow_id, &agent_session_id)?;
    record_audit_event(
        &app,
        "workflow",
        "set_agent",
        "info",
        Some("workflow"),
        Some(&workflow_id),
        "Workflow phase agent assigned",
        serde_json::json!({
            "agentSessionId": agent_session_id,
        }),
    );
    emit_workflow_update(&app, &executor);
    Ok(())
}

/// Mark current phase's agent as complete. Ungated phases auto-advance.
#[tauri::command]
pub fn workflow_phase_done(
    app: AppHandle,
    workflow_id: String,
    cost: f64,
) -> Result<WorkflowPhaseDoneResult, String> {
    let executor = app.state::<crate::workflow::WorkflowExecutor>();
    let outcome = executor.phase_agent_done(&workflow_id, cost)?;
    record_audit_event(
        &app,
        "workflow",
        "phase_done",
        "info",
        Some("workflow"),
        Some(&workflow_id),
        "Workflow phase completed",
        serde_json::json!({
            "cost": cost,
            "done": outcome.done,
            "waitingGate": outcome.waiting_gate,
        }),
    );
    emit_workflow_update(&app, &executor);
    Ok(WorkflowPhaseDoneResult {
        done: outcome.done,
        waiting_gate: outcome.waiting_gate,
    })
}

#[derive(serde::Serialize)]
pub struct WorkflowPhaseDoneResult {
    pub done: bool,
    pub waiting_gate: bool,
}

/// Approve the current quality gate → advance to next phase
#[tauri::command]
pub fn workflow_approve_gate(app: AppHandle, workflow_id: String) -> Result<bool, String> {
    let executor = app.state::<crate::workflow::WorkflowExecutor>();
    let done = executor.approve_gate(&workflow_id)?;
    record_audit_event(
        &app,
        "workflow",
        "approve_gate",
        "info",
        Some("workflow"),
        Some(&workflow_id),
        "Workflow gate approved",
        serde_json::json!({
            "done": done,
        }),
    );
    emit_workflow_update(&app, &executor);
    Ok(done)
}

/// Approve the current quality gate with comment/conditional metadata.
#[tauri::command]
pub fn workflow_approve_gate_decision(
    app: AppHandle,
    workflow_id: String,
    comment: Option<String>,
    conditional: Option<bool>,
) -> Result<bool, String> {
    let executor = app.state::<crate::workflow::WorkflowExecutor>();
    let conditional = conditional.unwrap_or(false);
    let comment = comment.unwrap_or_default();
    let done = executor.approve_gate_with_decision(&workflow_id, &comment, conditional)?;
    record_audit_event(
        &app,
        "workflow",
        "approve_gate_decision",
        "info",
        Some("workflow"),
        Some(&workflow_id),
        "Workflow gate approved with decision metadata",
        serde_json::json!({
            "done": done,
            "conditional": conditional,
            "comment": comment,
        }),
    );
    emit_workflow_update(&app, &executor);
    Ok(done)
}

/// Reject the current quality gate → retry the phase
#[tauri::command]
pub fn workflow_reject_gate(app: AppHandle, workflow_id: String) -> Result<(), String> {
    let executor = app.state::<crate::workflow::WorkflowExecutor>();
    executor.reject_gate(&workflow_id)?;
    record_audit_event(
        &app,
        "workflow",
        "reject_gate",
        "warn",
        Some("workflow"),
        Some(&workflow_id),
        "Workflow gate rejected",
        serde_json::json!({}),
    );
    emit_workflow_update(&app, &executor);
    Ok(())
}

/// Reject the current quality gate with a preserved reviewer comment.
#[tauri::command]
pub fn workflow_reject_gate_decision(
    app: AppHandle,
    workflow_id: String,
    comment: Option<String>,
) -> Result<(), String> {
    let executor = app.state::<crate::workflow::WorkflowExecutor>();
    let comment = comment.unwrap_or_default();
    executor.reject_gate_with_comment(&workflow_id, &comment)?;
    record_audit_event(
        &app,
        "workflow",
        "reject_gate_decision",
        "warn",
        Some("workflow"),
        Some(&workflow_id),
        "Workflow gate rejected with decision metadata",
        serde_json::json!({
            "comment": comment,
        }),
    );
    emit_workflow_update(&app, &executor);
    Ok(())
}

/// Resume a workflow from a named phase and preserve the reason.
#[tauri::command]
pub fn workflow_resume_from_phase(
    app: AppHandle,
    workflow_id: String,
    phase_name: String,
    reason: String,
) -> Result<crate::workflow::WorkflowStatus, String> {
    let executor = app.state::<crate::workflow::WorkflowExecutor>();
    let status = executor.resume_from_phase(&workflow_id, &phase_name, &reason)?;
    record_audit_event(
        &app,
        "workflow",
        "resume_phase",
        "info",
        Some("workflow"),
        Some(&workflow_id),
        "Workflow resumed from phase",
        serde_json::json!({
            "phaseName": phase_name,
            "reason": reason,
        }),
    );
    emit_workflow_update(&app, &executor);
    Ok(status)
}

/// Split the current oversized phase into narrower child phases.
#[tauri::command]
pub fn workflow_split_current_phase(
    app: AppHandle,
    workflow_id: String,
    child_phase_names: Vec<String>,
    reason: String,
) -> Result<crate::workflow::WorkflowStatus, String> {
    let executor = app.state::<crate::workflow::WorkflowExecutor>();
    let status = executor.split_current_phase(&workflow_id, child_phase_names.clone(), &reason)?;
    record_audit_event(
        &app,
        "workflow",
        "split_phase",
        "warn",
        Some("workflow"),
        Some(&workflow_id),
        "Workflow phase split",
        serde_json::json!({
            "childPhaseNames": child_phase_names,
            "reason": reason,
        }),
    );
    emit_workflow_update(&app, &executor);
    Ok(status)
}

/// Convert a blocker into an explicit decision request/gate.
#[tauri::command]
pub fn workflow_request_decision(
    app: AppHandle,
    workflow_id: String,
    kind: String,
    reason: String,
    options: Vec<String>,
    default_option: Option<String>,
) -> Result<crate::workflow::WorkflowStatus, String> {
    let executor = app.state::<crate::workflow::WorkflowExecutor>();
    let status = executor.request_decision_for_current_phase(
        &workflow_id,
        &kind,
        &reason,
        options.clone(),
        default_option.clone(),
    )?;
    record_audit_event(
        &app,
        "workflow",
        "decision_requested",
        "warn",
        Some("workflow"),
        Some(&workflow_id),
        "Workflow blocker converted to decision request",
        serde_json::json!({
            "kind": kind,
            "reason": reason,
            "options": options,
            "defaultOption": default_option,
        }),
    );
    emit_workflow_update(&app, &executor);
    Ok(status)
}

/// Append phase artifacts, commands, validation evidence, and final report.
#[tauri::command]
pub fn workflow_record_phase_evidence(
    app: AppHandle,
    workflow_id: String,
    phase_name: Option<String>,
    artifacts: Vec<crate::workflow::WorkflowArtifact>,
    commands: Vec<crate::workflow::WorkflowCommandRecord>,
    validation: Vec<crate::workflow::WorkflowValidationRecord>,
    final_report: Option<String>,
) -> Result<crate::workflow::WorkflowStatus, String> {
    let executor = app.state::<crate::workflow::WorkflowExecutor>();
    let status = executor.record_phase_evidence(
        &workflow_id,
        phase_name.as_deref(),
        artifacts,
        commands,
        validation,
        final_report,
    )?;
    record_audit_event(
        &app,
        "workflow",
        "phase_evidence",
        "info",
        Some("workflow"),
        Some(&workflow_id),
        "Workflow phase evidence recorded",
        serde_json::json!({
            "phaseName": phase_name,
        }),
    );
    emit_workflow_update(&app, &executor);
    Ok(status)
}

/// Get workflow execution status
#[tauri::command]
pub fn workflow_status(
    app: AppHandle,
    workflow_id: String,
) -> Result<crate::workflow::WorkflowStatus, String> {
    let executor = app.state::<crate::workflow::WorkflowExecutor>();
    executor.status(&workflow_id)
}

/// List all running workflows
#[tauri::command]
pub fn list_running_workflows(
    app: AppHandle,
    project_path: Option<String>,
) -> Vec<crate::workflow::WorkflowStatus> {
    let executor = app.state::<crate::workflow::WorkflowExecutor>();
    if let Some(project_path) = project_path.as_deref() {
        if let Err(err) = executor.restore_project(project_path) {
            log::warn!(
                "failed to restore workflow runs for project={:?}: {}",
                project_path,
                err
            );
        }
    }
    executor.list()
}

/// Remove a completed/cancelled workflow from the executor
#[tauri::command]
pub fn workflow_remove(app: AppHandle, workflow_id: String) {
    let executor = app.state::<crate::workflow::WorkflowExecutor>();
    executor.remove(&workflow_id);
    record_audit_event(
        &app,
        "workflow",
        "remove",
        "info",
        Some("workflow"),
        Some(&workflow_id),
        "Workflow removed",
        serde_json::json!({}),
    );
}

// ── Agent session persistence ──

/// Save agent session to database for persistence across restarts
#[tauri::command]
pub fn save_agent_to_db(
    app: AppHandle,
    id: String,
    model: String,
    prompt: String,
    status: String,
    cost: f64,
    tokens_used: u64,
) -> Result<(), String> {
    let db = app.state::<crate::db::ManagedDb>();
    db.with(|d| d.save_agent_session(&id, &model, &prompt, &status, cost, tokens_used))
}

/// Update agent session in database
#[tauri::command]
pub fn update_agent_in_db(
    app: AppHandle,
    id: String,
    status: String,
    cost: f64,
    tokens_used: u64,
) -> Result<(), String> {
    let db = app.state::<crate::db::ManagedDb>();
    db.with(|d| d.update_agent_session(&id, &status, cost, tokens_used))
}

/// List recent agent sessions from database
#[tauri::command]
pub fn list_agent_history(
    app: AppHandle,
    limit: usize,
) -> Result<Vec<crate::db::AgentSessionRecord>, String> {
    let db = app.state::<crate::db::ManagedDb>();
    db.with(|d| d.list_agent_sessions(limit))
}

#[tauri::command]
pub fn save_agent_telemetry_snapshot(app: AppHandle, snapshot_json: String) -> Result<(), String> {
    let db = app.state::<crate::db::ManagedDb>();
    db.with(|d| d.save_agent_telemetry_snapshot(&snapshot_json))
}

#[tauri::command]
pub fn list_agent_telemetry_snapshots(
    app: AppHandle,
    limit: usize,
) -> Result<Vec<crate::db::AgentTelemetrySnapshotRecord>, String> {
    let db = app.state::<crate::db::ManagedDb>();
    db.with(|d| d.list_agent_telemetry_snapshots(limit))
}

// ── Command History ──

/// Save a command to history (DB) and feed the in-memory SuggestEngine
/// so fish-style autosuggest picks up the new command on the very next
/// keystroke without waiting for a DB reseed.
///
/// Also kicks off a best-effort semantic-index insert on a detached thread
/// (Phase 3B-2) — we deliberately avoid blocking the PTY reader on the
/// embedding round-trip even though the default embedder is fast.
#[tauri::command]
pub fn save_command_history(
    app: AppHandle,
    terminal_id: String,
    command: String,
    cwd: String,
) -> Result<(), String> {
    let db = app.state::<crate::db::ManagedDb>();
    db.with(|d| d.save_command(&terminal_id, &command, &cwd))?;
    if let Some(engine) = app.try_state::<Arc<Mutex<crate::suggest::SuggestEngine>>>() {
        if let Ok(mut guard) = engine.inner().lock() {
            guard.record(&command);
        }
    }
    // Semantic index. We need the new row id — re-read the latest row for
    // this (terminal_id, command) pair. `save_command` does not return it.
    if let Some(store) = app.try_state::<crate::ManagedHistoryStore>() {
        let last_id = db.with(|d| d.last_command_id_for(&terminal_id, &command))?;
        if let Some(id) = last_id {
            let store = store.inner().clone();
            let cmd = command.clone();
            std::thread::Builder::new()
                .name("history-index".into())
                .spawn(move || {
                    if let Err(e) = store.index_command(id, &cmd) {
                        log::warn!("history index failed (id {id}): {e}");
                    }
                })
                .ok();
        }
    }
    Ok(())
}

/// Search command history
#[tauri::command]
pub fn search_command_history(
    app: AppHandle,
    query: String,
    limit: usize,
) -> Result<Vec<crate::db::CommandRecord>, String> {
    let db = app.state::<crate::db::ManagedDb>();
    db.with(|d| d.search_commands(&query, limit))
}

/// Get recent unique commands
#[tauri::command]
pub fn recent_commands(app: AppHandle, limit: usize) -> Result<Vec<String>, String> {
    let db = app.state::<crate::db::ManagedDb>();
    db.with(|d| d.recent_commands(limit))
}

/// Read the latest operational audit events. This intentionally exposes
/// metadata only after the write-side callers have redacted raw terminal
/// input, so UI panels can inspect failures without leaking prompts.
#[tauri::command]
pub fn recent_audit_events(
    app: AppHandle,
    limit: usize,
    category: Option<String>,
    severity: Option<String>,
    entity_id: Option<String>,
) -> Result<Vec<crate::db::AuditEventRecord>, String> {
    let db = app.state::<crate::db::ManagedDb>();
    db.with(|d| {
        d.query_audit_events(
            limit,
            category.as_deref(),
            severity.as_deref(),
            entity_id.as_deref(),
        )
    })
}

#[tauri::command]
pub fn append_audit_event(
    app: AppHandle,
    event: crate::db::AuditJournalAppend,
) -> Result<crate::db::AuditJournalEventRecord, String> {
    crate::audit::append_audit_event_and_emit(&app, event)
}

#[tauri::command]
pub fn append_audit_events(
    app: AppHandle,
    events: Vec<crate::db::AuditJournalAppend>,
) -> Result<Vec<crate::db::AuditJournalEventRecord>, String> {
    crate::audit::append_audit_events_and_emit(&app, events)
}

#[tauri::command]
pub fn list_audit_events(
    app: AppHandle,
    filter: crate::db::AuditJournalFilter,
) -> Result<Vec<crate::db::AuditJournalEventRecord>, String> {
    let db = app.state::<crate::db::ManagedDb>();
    db.with(|d| d.list_audit_journal_events(&filter))
}

#[tauri::command]
pub fn get_audit_trace(
    app: AppHandle,
    correlation_id: String,
    workspace_id: Option<String>,
) -> Result<Vec<crate::db::AuditJournalEventRecord>, String> {
    let db = app.state::<crate::db::ManagedDb>();
    db.with(|d| d.get_audit_trace(&correlation_id, workspace_id.as_deref()))
}

#[tauri::command]
pub fn get_latest_snapshot(
    app: AppHandle,
    workspace_id: String,
) -> Result<crate::db::AuditJournalSnapshotRecord, String> {
    let db = app.state::<crate::db::ManagedDb>();
    db.with(|d| d.get_latest_audit_snapshot(&workspace_id))
}

#[tauri::command]
pub fn rebuild_snapshot_from_events(
    app: AppHandle,
    workspace_id: String,
) -> Result<crate::db::AuditJournalSnapshotRecord, String> {
    let db = app.state::<crate::db::ManagedDb>();
    db.with(|d| d.rebuild_audit_snapshot_from_events(&workspace_id))
}

#[tauri::command]
pub fn compact_event_journal(
    app: AppHandle,
    workspace_id: String,
    before_sequence: i64,
) -> Result<crate::db::AuditJournalCompactResult, String> {
    let db = app.state::<crate::db::ManagedDb>();
    db.with(|d| d.compact_audit_event_journal(&workspace_id, before_sequence))
}

// ── LSP commands ──

/// Start a language server for a file's language
#[tauri::command]
pub fn lsp_start(
    app: AppHandle,
    language: crate::lsp::LspLanguage,
    root_path: String,
) -> Result<crate::lsp::LspServerInfo, String> {
    let manager = app.state::<crate::lsp::LspManager>();
    manager.start(language, &root_path)
}

/// Send a JSON-RPC request to a running language server
#[tauri::command]
pub fn lsp_request(
    app: AppHandle,
    language: crate::lsp::LspLanguage,
    root_path: String,
    json_rpc: String,
) -> Result<(), String> {
    let manager = app.state::<crate::lsp::LspManager>();
    manager.send(&language, &root_path, &json_rpc)
}

/// Stop a language server
#[tauri::command]
pub fn lsp_stop(
    app: AppHandle,
    language: crate::lsp::LspLanguage,
    root_path: String,
) -> Result<(), String> {
    let manager = app.state::<crate::lsp::LspManager>();
    manager.stop(&language, &root_path)
}

/// List running language servers
#[tauri::command]
pub fn lsp_list(app: AppHandle) -> Vec<crate::lsp::LspServerInfo> {
    let manager = app.state::<crate::lsp::LspManager>();
    manager.list()
}

/// List all files in a project (gitignore-aware for fuzzy finder)
#[tauri::command]
pub fn list_all_files(
    root_path: String,
    max_files: usize,
) -> Result<Vec<crate::git::FileListEntry>, String> {
    crate::git::list_all_files(&root_path, max_files)
}

/// Set the IME composition window position via Win32 API.
/// This directly tells Windows where to place the IME candidate popup,
/// bypassing WebView2's broken textarea-based positioning.
fn ime_coord(value: f64) -> i32 {
    if !value.is_finite() {
        return 0;
    }
    let rounded = value.round();
    if rounded < i32::MIN as f64 {
        i32::MIN
    } else if rounded > i32::MAX as f64 {
        i32::MAX
    } else {
        rounded as i32
    }
}

#[tauri::command]
pub fn set_ime_position(
    app: AppHandle,
    x: f64,
    y: f64,
    candidate_x: Option<f64>,
    candidate_y: Option<f64>,
) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use windows::Win32::Foundation::POINT;
        use windows::Win32::UI::Input::Ime::*;
        use windows::Win32::UI::WindowsAndMessaging::{GetGUIThreadInfo, IsChild, GUITHREADINFO};

        let window = app.get_webview_window("main").ok_or("No main window")?;

        let hwnd = window.hwnd().map_err(|e| e.to_string())?;
        // IMM positions are relative to the window that currently owns input
        // focus. WebView2 keeps the real text focus on a child HWND, so using
        // the top-level Tauri window can shift the candidate popup under DPI
        // scaling or custom chrome.
        let ime_hwnd = unsafe {
            let mut gui = GUITHREADINFO {
                cbSize: std::mem::size_of::<GUITHREADINFO>() as u32,
                ..Default::default()
            };
            if GetGUIThreadInfo(0, &mut gui).is_ok() {
                let focus = gui.hwndFocus;
                if !focus.is_invalid() && (focus == hwnd || IsChild(hwnd, focus).as_bool()) {
                    focus
                } else {
                    hwnd
                }
            } else {
                hwnd
            }
        };

        unsafe {
            let himc = ImmGetContext(ime_hwnd);
            if himc.is_invalid() {
                return Err("Failed to get IME context".into());
            }

            let cf = COMPOSITIONFORM {
                dwStyle: CFS_POINT,
                ptCurrentPos: POINT {
                    x: ime_coord(x),
                    y: ime_coord(y),
                },
                ..Default::default()
            };
            let _ = ImmSetCompositionWindow(himc, &cf);

            // Also set candidate window position. The candidate popup is
            // much wider than the caret; the frontend may clamp this point
            // leftward near the terminal's right edge so the OS popup does
            // not spill into the inspector rail.
            for dw_index in 0..4 {
                let cand = CANDIDATEFORM {
                    dwIndex: dw_index,
                    dwStyle: CFS_CANDIDATEPOS,
                    ptCurrentPos: POINT {
                        x: ime_coord(candidate_x.unwrap_or(x)),
                        y: ime_coord(candidate_y.unwrap_or(y)),
                    },
                    ..Default::default()
                };
                let _ = ImmSetCandidateWindow(himc, &cand);
            }

            let _ = ImmReleaseContext(ime_hwnd, himc);
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::watchdog::{AutoApproveRule, WatchdogRules};

    fn watchdog_with_rules(rules: Vec<(&str, bool)>) -> crate::watchdog::engine::WatchdogEngine {
        crate::watchdog::engine::WatchdogEngine::new(WatchdogRules {
            enabled: true,
            auto_approve: rules
                .into_iter()
                .map(|(pattern, approve)| AutoApproveRule {
                    pattern: pattern.to_string(),
                    approve,
                    description: String::new(),
                })
                .collect(),
            auto_repair: Default::default(),
        })
    }

    #[test]
    fn validate_path_allows_normal_paths() {
        assert!(validate_path("C:/Users/owner/project").is_ok());
        assert!(validate_path("/home/user/project").is_ok());
        assert!(validate_path("D:/work/code").is_ok());
    }

    #[test]
    fn validate_path_blocks_traversal() {
        assert!(validate_path("C:/Users/../etc").is_err());
        assert!(validate_path("../../etc/passwd").is_err());
    }

    #[test]
    fn validate_path_blocks_unc() {
        assert!(validate_path("\\\\server\\share").is_err());
        assert!(validate_path("//server/share").is_err());
    }

    #[test]
    fn validate_path_blocks_system_dirs() {
        assert!(validate_path("C:/Windows/System32").is_err());
        assert!(validate_path("c:\\windows\\system32").is_err());
        assert!(validate_path("C:/Program Files/app").is_err());
        assert!(validate_path("/etc/passwd").is_err());
        assert!(validate_path("/usr/bin/sh").is_err());
    }

    #[test]
    fn validate_path_case_insensitive_on_windows() {
        assert!(validate_path("C:/WINDOWS/temp").is_err());
        assert!(validate_path("c:/Program Files (x86)/app").is_err());
    }

    #[test]
    fn ime_coord_rounds_and_sanitizes_frontend_values() {
        assert_eq!(ime_coord(12.49), 12);
        assert_eq!(ime_coord(12.5), 13);
        assert_eq!(ime_coord(f64::NAN), 0);
        assert_eq!(ime_coord(f64::INFINITY), 0);
        assert_eq!(ime_coord((i32::MAX as f64) + 10_000.0), i32::MAX);
        assert_eq!(ime_coord((i32::MIN as f64) - 10_000.0), i32::MIN);
    }

    #[test]
    fn strip_ansi_removes_codes() {
        let input = "\x1b[31mError\x1b[0m: failed";
        let result = strip_ansi(input);
        assert_eq!(result, "Error: failed");
    }

    #[test]
    fn strip_ansi_preserves_plain_text() {
        assert_eq!(strip_ansi("hello world"), "hello world");
    }

    #[test]
    fn performance_observatory_estimates_scrollback_memory() {
        assert_eq!(estimate_scrollback_memory_bytes(0, 120), 0);
        assert_eq!(estimate_scrollback_memory_bytes(100, 80), 128_000);
        assert_eq!(duration_ms_u64(Duration::from_millis(16)), 16);
    }

    #[test]
    fn output_buffer_create_is_idempotent_for_restart_paths() {
        let registry = OutputBufferRegistry::new();
        registry.create("term-1");
        registry.feed("term-1", "before restart\n");

        registry.create("term-1");

        let captured = registry.capture("term-1", 10, true).unwrap();
        assert!(captured.contains("before restart"));
    }

    #[test]
    fn terminal_generation_registry_rejects_stale_waiters() {
        let registry = TerminalGenerationRegistry::new();
        let first = registry.next_generation("term-1");
        let second = registry.next_generation("term-1");

        assert_ne!(first, second);
        assert!(!registry.is_current_generation("term-1", first));
        assert!(registry.is_current_generation("term-1", second));

        registry.remove("term-1");
        assert!(!registry.is_current_generation("term-1", second));
    }

    #[test]
    fn extract_agent_tool_name_reads_direct_tool_use() {
        let value = serde_json::json!({
            "type": "tool_use",
            "name": "Bash",
            "input": { "command": "pnpm test" }
        });
        assert_eq!(extract_agent_tool_name(&value), Some("Bash"));
    }

    #[test]
    fn extract_agent_tool_name_reads_claude_assistant_content() {
        let value = serde_json::json!({
            "type": "assistant",
            "message": {
                "content": [
                    { "type": "text", "text": "checking" },
                    { "type": "tool_use", "name": "Read", "input": { "path": "src/App.tsx" } }
                ]
            }
        });
        assert_eq!(extract_agent_tool_name(&value), Some("Read"));
    }

    #[test]
    fn extract_agent_tool_name_reads_legacy_tool_name_field() {
        let value = serde_json::json!({
            "type": "assistant",
            "subtype": "tool_use",
            "tool_name": "Edit"
        });
        assert_eq!(extract_agent_tool_name(&value), Some("Edit"));
    }

    #[test]
    fn agent_event_names_match_frontend_subscription_contract() {
        assert_eq!(agent_sessions_updated_event(), "agent-sessions-updated");
        assert_eq!(agent_output_event("agent-1"), "agent-output-agent-1");
        assert_eq!(
            watchdog_decision_event("agent-1"),
            "watchdog-decision-agent-1"
        );
        assert_eq!(agent_exit_event("agent-1"), "agent-exit-agent-1");
    }

    #[test]
    fn agent_stream_line_effect_serializes_watchdog_contract() {
        let watchdog = watchdog_with_rules(vec![("Bash*", false)]);
        let effect = analyze_agent_stream_line(
            r#"{"type":"tool_use","name":"Bash(git status)","input":{}}"#,
            &watchdog,
        )
        .expect("watchdog effect");

        assert_eq!(effect.status, Some("error"));
        assert_eq!(effect.log_level, Some("WARN"));
        assert!(effect.emit_sessions);
        let payload = effect.watchdog.expect("watchdog payload");
        assert_eq!(
            payload.to_event_json(),
            r#"{"decision":"denied","rule":"Bash*","tool":"Bash(git status)"}"#
        );
    }

    #[test]
    fn agent_stream_line_effect_keeps_auto_approved_tool_quiet() {
        let watchdog = watchdog_with_rules(vec![("Read", true)]);
        let effect = analyze_agent_stream_line(
            r#"{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Read"}]}}"#,
            &watchdog,
        )
        .expect("watchdog effect");

        assert_eq!(effect.status, Some("coding"));
        assert_eq!(effect.log_level, Some("INFO"));
        assert!(!effect.emit_sessions);
        assert_eq!(
            effect.watchdog.expect("watchdog payload").to_event_json(),
            r#"{"decision":"approved","rule":"Read","tool":"Read"}"#
        );
    }

    #[test]
    fn agent_stream_line_effect_extracts_result_usage_contract() {
        let watchdog = watchdog_with_rules(vec![]);
        let effect = analyze_agent_stream_line(
            r#"{"type":"result","cost_usd":0.42,"total_tokens":1234}"#,
            &watchdog,
        )
        .expect("result effect");

        assert_eq!(effect.status, Some("done"));
        assert_eq!(effect.usage, Some((0.42, 1234)));
        assert!(effect.watchdog.is_none());
        assert!(effect.emit_sessions);
    }

    #[test]
    fn agent_stream_line_effect_ignores_invalid_stream_lines() {
        let watchdog = watchdog_with_rules(vec![]);

        assert!(analyze_agent_stream_line("not-json", &watchdog).is_none());
        assert!(analyze_agent_stream_line(r#"{"subtype":"noise"}"#, &watchdog).is_none());
    }
}
