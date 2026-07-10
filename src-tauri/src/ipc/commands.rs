use std::collections::{HashMap, HashSet};
use std::io::BufRead;
use std::path::{Component, Path, PathBuf};

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::time::{Duration, Instant};

use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::broadcast;

use crate::pty::buffer::{strip_ansi, OutputBuffer};
use crate::pty::{ExitInfo, PtyError, PtyManager, ShellType};
use crate::snapshot::{SnapshotStore, SnapshotTrigger, TerminalSnapshot};
use crate::term::NativeTerminalRegistry;
use crate::watchdog::auto_repair::AutoRepairManager;
use crate::watchdog::{pane_watcher, AutoRepairConfig, ErrorContext};

use super::persistence_commands::{normalize_command_history_cwd, save_command_history};

const PTY_OUTPUT_BATCH_MAX_BYTES: usize = 64 * 1024;
const PTY_OUTPUT_BATCH_INTERVAL: Duration = Duration::from_millis(16);
const TERMINAL_JOURNAL_FLUSH_BYTES: usize = 32 * 1024;
const TERMINAL_JOURNAL_FLUSH_INTERVAL: Duration = Duration::from_millis(500);
const DB_WRITE_LATENCY_UNSET: u64 = u64::MAX;
const ASCII_BEL: u8 = 0x07;
const ASCII_ESC: u8 = 0x1b;
const SIDECAR_RECONNECT_DEFAULT_COLS: u16 = 120;
const SIDECAR_RECONNECT_DEFAULT_ROWS: u16 = 30;
/// Scrollback lines requested from the sidecar daemon when re-adopting a
/// session after an app restart. Bounded by the server's capture clamp.
const SIDECAR_ADOPT_BACKFILL_LINES: usize = 2000;

static LAST_TERMINAL_JOURNAL_DB_WRITE_LATENCY_MS: AtomicU64 =
    AtomicU64::new(DB_WRITE_LATENCY_UNSET);
static LAST_TERMINAL_SPAWN_MS: AtomicU64 = AtomicU64::new(DB_WRITE_LATENCY_UNSET);
static LAST_TERMINAL_STREAM_WIRE_MS: AtomicU64 = AtomicU64::new(DB_WRITE_LATENCY_UNSET);

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

fn contains_audible_bell(data: &[u8], in_osc: &mut bool) -> bool {
    let mut audible = false;
    let mut index = 0usize;
    while index < data.len() {
        let byte = data[index];
        if *in_osc {
            if byte == ASCII_BEL {
                *in_osc = false;
            } else if byte == ASCII_ESC && data.get(index + 1) == Some(&b'\\') {
                *in_osc = false;
                index += 1;
            }
            index += 1;
            continue;
        }

        if byte == ASCII_ESC && data.get(index + 1) == Some(&b']') {
            *in_osc = true;
            index += 2;
            continue;
        }

        if byte == ASCII_BEL {
            audible = true;
        }
        index += 1;
    }
    audible
}

fn persist_prompt_mark_exit_code(
    app: &AppHandle,
    terminal_id: &str,
    mark: &crate::term::PromptMark,
) {
    if let Some(journal) = app.try_state::<Arc<crate::term::CommandBlockJournal>>() {
        if let Some(record) = journal.record_prompt_mark(terminal_id, *mark) {
            persist_command_block(app, &record);
        }
    }
    if mark.kind != crate::term::PromptMarkKind::CommandEnd {
        return;
    }
    let Some(exit_code) = mark.exit_code else {
        return;
    };
    let Some(db) = app.try_state::<crate::db::ManagedDb>() else {
        return;
    };
    if let Err(err) = db.with(|d| {
        d.update_latest_command_exit_code(terminal_id, exit_code)
            .map(|_| ())
    }) {
        log::warn!("command history exit-code update failed terminal={terminal_id}: {err}");
    }
}

pub(crate) fn persist_command_block(app: &AppHandle, record: &crate::term::CommandBlockRecord) {
    let Some(db) = app.try_state::<crate::db::ManagedDb>() else {
        return;
    };
    if let Err(err) = db.with(|d| d.save_command_block(record)) {
        log::warn!(
            "command block evidence persist failed terminal={} history_id={}: {}",
            record.terminal_id,
            record.command_history_id,
            err
        );
    }
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn record_audit_event(
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

pub(crate) fn sanitize_audit_error(err: &str) -> String {
    err.replace(['\r', '\n', '\t'], " ")
        .chars()
        .take(240)
        .collect()
}

pub(crate) fn terminal_audit_metadata(
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

pub(crate) fn parse_mux_axis(axis: &str) -> Result<crate::mux::layout::SplitAxis, String> {
    match axis {
        "horizontal" => Ok(crate::mux::layout::SplitAxis::Horizontal),
        "vertical" => Ok(crate::mux::layout::SplitAxis::Vertical),
        other => Err(format!("unknown split axis: {other}")),
    }
}

fn normalized_mux_key(
    key: &str,
    ctrl_key: bool,
    alt_key: bool,
    shift_key: bool,
    meta_key: bool,
) -> Result<crate::mux::keymap::Key, String> {
    use crate::mux::keymap::{Key, KeyCode, Modifiers};

    let mods = Modifiers {
        ctrl: ctrl_key,
        alt: alt_key,
        shift: shift_key,
        super_key: meta_key,
    };
    let key = match key {
        "Enter" => Key {
            code: KeyCode::Enter,
            mods,
        },
        "Escape" => Key {
            code: KeyCode::Escape,
            mods,
        },
        "Backspace" => Key {
            code: KeyCode::Backspace,
            mods,
        },
        "Tab" => Key {
            code: KeyCode::Tab,
            mods,
        },
        " " | "Space" | "Spacebar" => Key {
            code: KeyCode::Space,
            mods,
        },
        "ArrowUp" => Key {
            code: KeyCode::Up,
            mods,
        },
        "ArrowDown" => Key {
            code: KeyCode::Down,
            mods,
        },
        "ArrowLeft" => Key {
            code: KeyCode::Left,
            mods,
        },
        "ArrowRight" => Key {
            code: KeyCode::Right,
            mods,
        },
        "Home" => Key {
            code: KeyCode::Home,
            mods,
        },
        "End" => Key {
            code: KeyCode::End,
            mods,
        },
        "PageUp" => Key {
            code: KeyCode::PageUp,
            mods,
        },
        "PageDown" => Key {
            code: KeyCode::PageDown,
            mods,
        },
        "Insert" => Key {
            code: KeyCode::Insert,
            mods,
        },
        "Delete" => Key {
            code: KeyCode::Delete,
            mods,
        },
        value if value.starts_with('F') && value.len() <= 3 => {
            let number = value[1..]
                .parse::<u8>()
                .map_err(|_| format!("unsupported function key: {value}"))?;
            Key {
                code: KeyCode::Function(number),
                mods,
            }
        }
        value => {
            let mut chars = value.chars();
            let Some(mut ch) = chars.next() else {
                return Err("empty key".to_string());
            };
            if chars.next().is_some() {
                return Err(format!("unsupported key: {value}"));
            }
            if ctrl_key && !alt_key && !meta_key {
                ch = ch.to_ascii_lowercase();
            }
            let printable_mods = if !ctrl_key && !alt_key && !meta_key {
                Modifiers {
                    shift: false,
                    ..mods
                }
            } else {
                mods
            };
            Key {
                code: KeyCode::Char(ch),
                mods: printable_mods,
            }
        }
    };
    Ok(key)
}

fn sync_mux_terminal_spawn(
    app: &AppHandle,
    terminal_id: &str,
    shell_name: &str,
    cwd: &str,
    cols: u16,
    rows: u16,
    process_id: Option<u32>,
) {
    let Some(mux) = app.try_state::<Arc<Mutex<crate::mux::manager::MuxManager>>>() else {
        return;
    };
    let result = mux
        .inner()
        .lock()
        .map_err(|_| "MuxManager lock poisoned".to_string())
        .and_then(|mut mux| {
            mux.upsert_standalone_terminal_with_process_id(
                terminal_id,
                shell_name,
                cwd,
                cols,
                rows,
                process_id,
            )
            .map_err(|err| err.to_string())
        });
    if let Err(err) = result {
        log::warn!("mux sync spawn failed terminal={terminal_id}: {err}");
    }
}

fn local_pty_process_id(app: &AppHandle, terminal_id: &str) -> Option<u32> {
    app.try_state::<PtyManager>()
        .and_then(|pty| pty.runtime_identity(terminal_id).ok())
        .and_then(|identity| identity.process_id)
}

fn sync_mux_terminal_remove(app: &AppHandle, terminal_id: &str) {
    if let Some(keymap) = app.try_state::<MuxKeymapRegistry>() {
        keymap.remove(terminal_id);
    }
    let Some(mux) = app.try_state::<Arc<Mutex<crate::mux::manager::MuxManager>>>() else {
        return;
    };
    match mux.inner().lock() {
        Ok(mut mux) => {
            mux.remove_graph(terminal_id);
        }
        Err(_) => log::warn!("mux sync remove failed terminal={terminal_id}: lock poisoned"),
    }
}

pub(crate) fn sync_mux_pane_name(app: &AppHandle, terminal_id: &str, name: &str) {
    let Some(mux) = app.try_state::<Arc<Mutex<crate::mux::manager::MuxManager>>>() else {
        return;
    };
    let result = mux
        .inner()
        .lock()
        .map_err(|_| "MuxManager lock poisoned".to_string())
        .and_then(|mut mux| {
            mux.update_pane_name(terminal_id, name)
                .map_err(|err| err.to_string())
        });
    if let Err(err) = result {
        log::debug!("mux sync rename skipped terminal={terminal_id}: {err}");
    }
}

pub(crate) fn sync_mux_pane_role(app: &AppHandle, terminal_id: &str, role: &str) {
    let Some(mux) = app.try_state::<Arc<Mutex<crate::mux::manager::MuxManager>>>() else {
        return;
    };
    let result = mux
        .inner()
        .lock()
        .map_err(|_| "MuxManager lock poisoned".to_string())
        .and_then(|mut mux| {
            mux.update_pane_role(terminal_id, role)
                .map_err(|err| err.to_string())
        });
    if let Err(err) = result {
        log::debug!("mux sync role skipped terminal={terminal_id}: {err}");
    }
}

fn sync_mux_pane_size(app: &AppHandle, terminal_id: &str, cols: u16, rows: u16) {
    let Some(mux) = app.try_state::<Arc<Mutex<crate::mux::manager::MuxManager>>>() else {
        return;
    };
    let result = mux
        .inner()
        .lock()
        .map_err(|_| "MuxManager lock poisoned".to_string())
        .and_then(|mut mux| {
            mux.update_pane_size(terminal_id, cols, rows)
                .map_err(|err| err.to_string())
        });
    if let Err(err) = result {
        log::debug!("mux sync resize skipped terminal={terminal_id}: {err}");
    }
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

    /// Whether a terminal id is already wired into the UI registries. Used
    /// as an idempotency guard so re-adoption never double-streams a session.
    pub fn contains(&self, id: &str) -> bool {
        self.buffers
            .lock()
            .map(|buffers| buffers.contains_key(id))
            .unwrap_or(false)
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

/// Per-terminal Rust mux keymap state. The frontend may keep a tiny
/// synchronous gate so browser keydown can be prevented in time, but command
/// lookup, prefix tables, remapping, and dispatch semantics live here.
#[derive(Clone)]
pub struct MuxKeymapRegistry {
    engines: Arc<Mutex<HashMap<String, crate::mux::keymap::KeymapEngine>>>,
}

impl MuxKeymapRegistry {
    pub fn new() -> Self {
        Self {
            engines: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    fn process_key(
        &self,
        terminal_id: &str,
        key: crate::mux::keymap::Key,
    ) -> Result<crate::mux::keymap::KeymapEvent, String> {
        let mut engines = self
            .engines
            .lock()
            .map_err(|_| "MuxKeymapRegistry lock poisoned".to_string())?;
        let engine = engines.entry(terminal_id.to_string()).or_insert_with(|| {
            crate::mux::keymap::KeymapEngine::aelyris_default()
                .unwrap_or_else(|_| crate::mux::keymap::KeymapEngine::default())
        });
        Ok(engine.process_key(key))
    }

    pub fn remove(&self, terminal_id: &str) {
        if let Ok(mut engines) = self.engines.lock() {
            engines.remove(terminal_id);
        }
    }
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MuxKeymapResponse {
    kind: String,
    table: Option<String>,
    command: Option<String>,
}

/// Validate path is not dangerous (no traversal, no system dirs)
pub(crate) fn validate_path(path: &str) -> Result<(), String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Ok(());
    }
    if trimmed.contains('\0') {
        return Err("NUL bytes not allowed in paths".to_string());
    }
    // Block path traversal by component, not substring, so names like
    // "project..bak" remain valid while real parent traversal is rejected.
    if Path::new(trimmed)
        .components()
        .any(|component| matches!(component, Component::ParentDir))
    {
        return Err("Path traversal not allowed".to_string());
    }
    // Block network UNC paths while allowing Windows extended-length local
    // paths (`\\?\C:\...`) returned by `canonicalize()`.
    let slash_path = trimmed.replace('\\', "/");
    let lower_slash_path = slash_path.to_lowercase();
    if lower_slash_path.starts_with("//?/unc/")
        || ((slash_path.starts_with("//") || slash_path.starts_with("\\\\"))
            && !lower_slash_path.starts_with("//?/"))
    {
        return Err("UNC paths not allowed".to_string());
    }
    if is_dangerous_path(Path::new(trimmed)) {
        return Err("Access to system directory not allowed".to_string());
    }
    if let Ok(canonical) = std::fs::canonicalize(trimmed) {
        if is_dangerous_path(&canonical) {
            return Err("Access to system directory not allowed".to_string());
        }
    }
    Ok(())
}

fn validate_existing_directory_path(path: &str) -> Result<String, String> {
    let expanded = expand_cwd_path(path)?;
    validate_path(&expanded)?;
    let canonical = std::fs::canonicalize(&expanded)
        .map_err(|_| "Path must exist and be accessible".to_string())?;
    if !canonical.is_dir() {
        return Err("Path must be a directory".to_string());
    }
    let canonical = strip_local_verbatim_prefix(&canonical.to_string_lossy());
    validate_path(&canonical)?;
    Ok(canonical)
}

pub(crate) fn normalize_cwd(cwd: Option<String>) -> Result<Option<String>, String> {
    cwd.map(|dir| validate_existing_directory_path(&dir))
        .transpose()
}

fn home_dir_for_cwd() -> Option<PathBuf> {
    std::env::var_os("USERPROFILE")
        .filter(|value| !value.is_empty())
        .or_else(|| std::env::var_os("HOME").filter(|value| !value.is_empty()))
        .map(PathBuf::from)
}

fn expand_cwd_path(path: &str) -> Result<String, String> {
    let trimmed = path.trim();
    if trimmed == "~" {
        return home_dir_for_cwd()
            .map(|home| home.to_string_lossy().to_string())
            .ok_or_else(|| "Home directory is unavailable".to_string());
    }
    if let Some(rest) = trimmed
        .strip_prefix("~/")
        .or_else(|| trimmed.strip_prefix("~\\"))
    {
        let home = home_dir_for_cwd().ok_or_else(|| "Home directory is unavailable".to_string())?;
        return Ok(home.join(rest).to_string_lossy().to_string());
    }
    Ok(trimmed.to_string())
}

fn strip_local_verbatim_prefix(path: &str) -> String {
    if let Some(rest) = path.strip_prefix(r"\\?\") {
        if rest.to_lowercase().starts_with(r"unc\") {
            return path.to_string();
        }
        return rest.to_string();
    }
    if let Some(rest) = path.strip_prefix("//?/") {
        if rest.to_lowercase().starts_with("unc/") {
            return path.to_string();
        }
        return rest.to_string();
    }
    path.to_string()
}

fn is_dangerous_path(path: &Path) -> bool {
    // Normalize and compare case-insensitively (Windows is case-insensitive)
    let mut normalized = path.to_string_lossy().replace('\\', "/").to_lowercase();
    if let Some(stripped) = normalized.strip_prefix("//?/") {
        normalized = stripped.to_string();
    }
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
    dangerous
        .iter()
        .any(|d| normalized == *d || normalized.starts_with(&format!("{d}/")))
}

/// Spawn a new terminal session
#[tauri::command]
pub async fn spawn_terminal(
    app: AppHandle,
    shell: ShellType,
    cols: u16,
    rows: u16,
    cwd: Option<String>,
) -> Result<String, String> {
    let cwd = match normalize_cwd(cwd) {
        Ok(cwd) => cwd,
        Err(err) => {
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
    };
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
    if let Some(sidecar) = app
        .try_state::<crate::pty_sidecar::PtySidecarState>()
        .and_then(|state| state.client())
    {
        let spawn_started_at = Instant::now();
        let id = sidecar
            .spawn(&shell, cols, rows, cwd.as_deref())
            .await
            .inspect_err(|err| {
                record_audit_event(
                    &app,
                    "terminal",
                    "spawn_failed",
                    "error",
                    Some("terminal"),
                    None,
                    "Terminal sidecar spawn failed",
                    {
                        let mut metadata =
                            terminal_audit_metadata(&shell, cols, rows, cwd.as_deref());
                        if let Some(obj) = metadata.as_object_mut() {
                            obj.insert(
                                "backend".to_string(),
                                serde_json::Value::String("sidecar".to_string()),
                            );
                            obj.insert(
                                "error".to_string(),
                                serde_json::Value::String(sanitize_audit_error(err)),
                            );
                        }
                        metadata
                    },
                );
            })?;
        let spawn_ms = duration_ms_u64(spawn_started_at.elapsed());
        LAST_TERMINAL_SPAWN_MS.store(spawn_ms, Ordering::Relaxed);
        let shell_name = format!("{:?}", shell).to_lowercase();
        app.state::<crate::pty::PaneRegistry>().register(
            &id,
            &shell_name,
            cwd.as_deref().unwrap_or("."),
        );
        let process_id = sidecar.list_info().await.ok().and_then(|infos| {
            infos
                .into_iter()
                .find(|info| info.id == id)
                .and_then(|info| info.process_id)
        });
        sync_mux_terminal_spawn(
            &app,
            &id,
            &shell_name,
            cwd.as_deref().unwrap_or("."),
            cols,
            rows,
            process_id,
        );
        wire_sidecar_terminal_streaming(
            &app,
            sidecar,
            &id,
            SidecarWireOptions {
                cols,
                rows,
                cwd: cwd.as_deref(),
                shell_name: &shell_name,
                backfill_scrollback: false,
            },
        )
        .await?;
        record_audit_event(
            &app,
            "terminal",
            "spawn",
            "info",
            Some("terminal"),
            Some(&id),
            "Terminal spawned",
            {
                let mut metadata = terminal_audit_metadata(&shell, cols, rows, cwd.as_deref());
                if let Some(obj) = metadata.as_object_mut() {
                    obj.insert(
                        "backend".to_string(),
                        serde_json::Value::String("sidecar".to_string()),
                    );
                    obj.insert("spawnMs".to_string(), serde_json::json!(spawn_ms));
                }
                metadata
            },
        );
        return Ok(id);
    }
    if let Some(sidecar_state) = app.try_state::<crate::pty_sidecar::PtySidecarState>() {
        sidecar_state.lock_native_backend();
    }
    let pty_manager = app.state::<PtyManager>().inner().clone();
    let spawn_shell = shell.clone();
    let spawn_cwd = cwd.clone();
    let spawn_started_at = Instant::now();
    let spawn_result = tauri::async_runtime::spawn_blocking(move || {
        pty_manager.spawn(&spawn_shell, cols, rows, spawn_cwd.as_deref())
    })
    .await
    .map_err(|err| format!("Terminal spawn task failed: {}", err))?;
    let spawn_ms = duration_ms_u64(spawn_started_at.elapsed());
    LAST_TERMINAL_SPAWN_MS.store(spawn_ms, Ordering::Relaxed);
    let id = match spawn_result {
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
    sync_mux_terminal_spawn(
        &app,
        &id,
        &shell_name,
        cwd.as_deref().unwrap_or("."),
        cols,
        rows,
        local_pty_process_id(&app, &id),
    );

    let stream_wire_started_at = Instant::now();
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
    let stream_wire_ms = duration_ms_u64(stream_wire_started_at.elapsed());
    LAST_TERMINAL_STREAM_WIRE_MS.store(stream_wire_ms, Ordering::Relaxed);
    record_audit_event(
        &app,
        "terminal",
        "spawn",
        "info",
        Some("terminal"),
        Some(&id),
        "Terminal spawned",
        {
            let mut metadata = terminal_audit_metadata(&shell, cols, rows, cwd.as_deref());
            if let Some(obj) = metadata.as_object_mut() {
                obj.insert("spawnMs".to_string(), serde_json::json!(spawn_ms));
                obj.insert(
                    "streamWireMs".to_string(),
                    serde_json::json!(stream_wire_ms),
                );
            }
            metadata
        },
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
pub async fn respawn_terminal(
    app: AppHandle,
    id: String,
    shell: ShellType,
    cols: u16,
    rows: u16,
    cwd: Option<String>,
) -> Result<(), String> {
    let cwd = match normalize_cwd(cwd) {
        Ok(cwd) => cwd,
        Err(err) => {
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
    };
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
    if let Some(sidecar) = app
        .try_state::<crate::pty_sidecar::PtySidecarState>()
        .and_then(|state| state.client())
    {
        let live_ids = sidecar.list().await.map_err(|err| {
            format!("respawn rejected: unable to verify sidecar session state: {err}")
        })?;
        if live_ids.iter().any(|live_id| live_id == &id) {
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
                    "backend": "sidecar",
                    "reason": "still_alive",
                    "redacted": true,
                }),
            );
            return Err(err);
        }
        sidecar
            .spawn_with_id(&id, &shell, cols, rows, cwd.as_deref())
            .await?;
        let shell_name = format!("{:?}", shell).to_lowercase();
        app.state::<crate::pty::PaneRegistry>().ensure_registered(
            &id,
            &shell_name,
            cwd.as_deref().unwrap_or("."),
        );
        wire_sidecar_terminal_streaming(
            &app,
            sidecar,
            &id,
            SidecarWireOptions {
                cols,
                rows,
                cwd: cwd.as_deref(),
                shell_name: &shell_name,
                backfill_scrollback: false,
            },
        )
        .await?;
        record_audit_event(
            &app,
            "terminal",
            "respawn",
            "info",
            Some("terminal"),
            Some(&id),
            "Terminal respawned",
            {
                let mut metadata = terminal_audit_metadata(&shell, cols, rows, cwd.as_deref());
                if let Some(obj) = metadata.as_object_mut() {
                    obj.insert("backend".to_string(), serde_json::json!("sidecar"));
                }
                metadata
            },
        );
        return Ok(());
    }
    let pty_manager = app.state::<PtyManager>().inner().clone();
    let contains_id = id.clone();
    let is_alive = tauri::async_runtime::spawn_blocking(move || pty_manager.contains(&contains_id))
        .await
        .map_err(|err| format!("Terminal respawn state check task failed: {}", err))?;
    if is_alive {
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

    let pty_manager = app.state::<PtyManager>().inner().clone();
    let spawn_id = id.clone();
    let spawn_shell = shell.clone();
    let spawn_cwd = cwd.clone();
    let spawn_result = tauri::async_runtime::spawn_blocking(move || {
        let program = spawn_shell.program().to_string();
        let args: Vec<String> = spawn_shell
            .args()
            .into_iter()
            .map(|s| s.to_string())
            .collect();
        let mut env = std::collections::HashMap::new();
        env.insert("AELYRIS_SHELL".to_string(), program.clone());
        pty_manager.spawn_command_with_id(
            &spawn_id,
            &program,
            &args,
            cols,
            rows,
            spawn_cwd.as_deref(),
            Some(env),
        )
    })
    .await
    .map_err(|err| format!("Terminal respawn task failed: {}", err))?;

    if let Err(err) = spawn_result {
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
pub async fn force_restart_terminal(
    app: AppHandle,
    id: String,
    shell: ShellType,
    cols: u16,
    rows: u16,
    cwd: Option<String>,
) -> Result<(), String> {
    let cwd = match normalize_cwd(cwd) {
        Ok(cwd) => cwd,
        Err(err) => {
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
    };
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

    let generations = app.state::<TerminalGenerationRegistry>();
    generations.next_generation(&id);
    if let Some(sidecar) = app
        .try_state::<crate::pty_sidecar::PtySidecarState>()
        .and_then(|state| state.client())
    {
        let close_result = sidecar.close(&id).await;
        sidecar
            .spawn_with_id(&id, &shell, cols, rows, cwd.as_deref())
            .await?;
        let shell_name = format!("{:?}", shell).to_lowercase();
        app.state::<crate::pty::PaneRegistry>().ensure_registered(
            &id,
            &shell_name,
            cwd.as_deref().unwrap_or("."),
        );
        wire_sidecar_terminal_streaming(
            &app,
            sidecar,
            &id,
            SidecarWireOptions {
                cols,
                rows,
                cwd: cwd.as_deref(),
                shell_name: &shell_name,
                backfill_scrollback: false,
            },
        )
        .await?;
        record_audit_event(
            &app,
            "terminal",
            "force_restart",
            "info",
            Some("terminal"),
            Some(&id),
            "Terminal force restarted",
            {
                let mut metadata = terminal_audit_metadata(&shell, cols, rows, cwd.as_deref());
                if let Some(obj) = metadata.as_object_mut() {
                    obj.insert("backend".to_string(), serde_json::json!("sidecar"));
                    obj.insert("closeResult".to_string(), serde_json::json!("requested"));
                    obj.insert(
                        "oldCloseOk".to_string(),
                        serde_json::Value::Bool(close_result.is_ok()),
                    );
                }
                metadata
            },
        );
        return Ok(());
    }

    let pty_manager = app.state::<PtyManager>().inner().clone();
    let spawn_id = id.clone();
    let spawn_shell = shell.clone();
    let spawn_cwd = cwd.clone();
    let (close_result, spawn_result) = tauri::async_runtime::spawn_blocking(move || {
        let close_result = pty_manager.close(&spawn_id);
        let program = spawn_shell.program().to_string();
        let args: Vec<String> = spawn_shell
            .args()
            .into_iter()
            .map(|s| s.to_string())
            .collect();
        let mut env = std::collections::HashMap::new();
        env.insert("AELYRIS_SHELL".to_string(), program.clone());
        let spawn_result = pty_manager.spawn_command_with_id(
            &spawn_id,
            &program,
            &args,
            cols,
            rows,
            spawn_cwd.as_deref(),
            Some(env),
        );
        (close_result, spawn_result)
    })
    .await
    .map_err(|err| format!("Terminal force restart task failed: {}", err))?;

    if let Err(err) = spawn_result {
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
pub(crate) fn wire_terminal_streaming(
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
        let mut bell_filter_in_osc = false;
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
                        persist_prompt_mark_exit_code(&app_handle, &terminal_id, &mark);
                        let _ = app_handle.emit(&prompt_mark_event_name, mark);
                    }

                    if contains_audible_bell(data, &mut bell_filter_in_osc) {
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
                let _ = pty_state.remove_exited(&waiter_id);
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

/// Normalize a daemon capture (`lines.join("\n")`, lines may keep a trailing
/// `\r`) into text safe to replay through the terminal engine: every line
/// break becomes `\r\n` so replayed lines start at column 0, and the final
/// line (usually the live prompt) is left open without a trailing break.
/// Only the line-ending `\r` is deduplicated; mid-line `\r` (progress-bar
/// style cursor returns) is preserved verbatim and replays correctly.
fn sidecar_backfill_text(captured: &str) -> String {
    let mut out = String::with_capacity(captured.len() + 64);
    for (index, line) in captured.split('\n').enumerate() {
        if index > 0 {
            out.push_str("\r\n");
        }
        out.push_str(line.strip_suffix('\r').unwrap_or(line));
    }
    out
}

pub(crate) struct SidecarWireOptions<'a> {
    pub(crate) cols: u16,
    pub(crate) rows: u16,
    pub(crate) cwd: Option<&'a str>,
    pub(crate) shell_name: &'a str,
    /// Replay daemon-side scrollback into the renderer before live output.
    /// Set only when adopting sessions that survived an app restart.
    pub(crate) backfill_scrollback: bool,
}

pub(crate) async fn wire_sidecar_terminal_streaming(
    app: &AppHandle,
    sidecar: crate::pty_sidecar::PtySidecarClient,
    terminal_id: &str,
    options: SidecarWireOptions<'_>,
) -> Result<(), String> {
    let SidecarWireOptions {
        cols,
        rows,
        cwd,
        shell_name,
        backfill_scrollback,
    } = options;
    let mut rx = sidecar.subscribe_output(terminal_id).await?;
    let terminal_generation = app
        .state::<TerminalGenerationRegistry>()
        .next_generation(terminal_id);

    let buffer_registry = app.state::<OutputBufferRegistry>().inner().clone();
    buffer_registry.create(terminal_id);

    let native_registry = app.state::<Arc<NativeTerminalRegistry>>().inner().clone();
    if let Err(e) = native_registry.create(terminal_id, cols, rows) {
        log::warn!("native engine create failed for {}: {}", terminal_id, e);
    }

    if backfill_scrollback {
        // The session outlived an app restart inside the sidecar daemon;
        // without replaying its scrollback the renderer starts blank. The
        // live stream is already subscribed above, so bytes arriving during
        // the capture round-trip are queued, not lost. The capture snapshot
        // may overlap the queued live tail by a few bytes when output is
        // actively streaming at adopt time; terminal state converges on the
        // next prompt redraw, so the brief duplication is accepted instead
        // of paying for a sequenced replay protocol. Replay feeds only the
        // renderer and capture buffer — the AdvanceResult diff and marks are
        // deliberately discarded so stale output cannot re-trigger
        // analysis/auto-repair or re-persist prompt marks.
        match sidecar
            .capture(terminal_id, SIDECAR_ADOPT_BACKFILL_LINES)
            .await
        {
            Ok(captured) if !captured.is_empty() => {
                let text = sidecar_backfill_text(&captured);
                buffer_registry.feed(terminal_id, &text);
                let _ = native_registry.advance(terminal_id, text.as_bytes());
            }
            Ok(_) => {}
            Err(err) => {
                log::warn!("sidecar scrollback backfill failed for {terminal_id}: {err}");
            }
        }
    }

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
        let mut bell_filter_in_osc = false;
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
                            persist_prompt_mark_exit_code(&app_handle, &terminal_id, &mark);
                            let _ = app_handle.emit(&prompt_mark_event_name, mark);
                        }

                        if contains_audible_bell(data, &mut bell_filter_in_osc) {
                            let _ = app_handle.emit(
                                "terminal:bell",
                                serde_json::json!({
                                    "terminal_id": terminal_id,
                                }),
                            );
                        }
                    }
                    Err(broadcast::error::RecvError::Lagged(n)) => {
                        log::warn!("ui: sidecar terminal {} lagged, dropped {} chunks", terminal_id, n);
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
        reader_alive.store(false, std::sync::atomic::Ordering::Release);

        let is_current_generation = app_handle
            .try_state::<TerminalGenerationRegistry>()
            .is_some_and(|generations| {
                generations.is_current_generation(&terminal_id, terminal_generation)
            });
        if is_current_generation {
            record_audit_event(
                &app_handle,
                "terminal",
                "exit",
                "info",
                Some("terminal"),
                Some(&terminal_id),
                "Sidecar terminal stream closed",
                serde_json::json!({
                    "backend": "sidecar",
                    "generation": terminal_generation,
                    "redacted": true,
                }),
            );
            let _ = app_handle.emit(
                &format!("pty-exit-{}", terminal_id),
                ExitInfo {
                    code: None,
                    crashed: false,
                },
            );
        }
    });

    Ok(())
}

/// Reattach long-lived sidecar PTYs that survived a Tauri/WebView process
/// restart. Without this bridge, `list_terminals` can see daemon sessions but
/// the native renderer, prompt-mark parser, output buffer, and command
/// evidence surfaces stay detached until a brand-new shell is spawned.
pub(crate) async fn adopt_sidecar_terminals(
    app: &AppHandle,
    sidecar: crate::pty_sidecar::PtySidecarClient,
) -> Result<usize, String> {
    let infos = sidecar.list_info().await?;
    let mut adopted = 0usize;
    for info in infos {
        // Idempotency guard: a session already wired (earlier adoption pass,
        // or a spawn that raced this one) must not get a second stream pump
        // and flush thread — that doubles every output byte in the UI.
        if app.state::<OutputBufferRegistry>().contains(&info.id) {
            log::info!(
                "sidecar terminal {} already wired; skipping adoption",
                info.id
            );
            continue;
        }
        let shell_name = format!("{:?}", info.shell_type).to_lowercase();
        let cwd = if info.cwd.trim().is_empty() {
            ".".to_string()
        } else {
            info.cwd.clone()
        };
        app.state::<crate::pty::PaneRegistry>()
            .ensure_registered(&info.id, &shell_name, &cwd);
        sync_mux_terminal_spawn(
            app,
            &info.id,
            &shell_name,
            &cwd,
            SIDECAR_RECONNECT_DEFAULT_COLS,
            SIDECAR_RECONNECT_DEFAULT_ROWS,
            info.process_id,
        );
        // Restore the pane's persisted identity (user/agent-assigned name and
        // role) so a restart doesn't reduce every adopted pane to its shell
        // name — in multi-agent use, which pane belonged to which agent is
        // exactly the information the operator needs back.
        if let Some(db) = app.try_state::<crate::db::ManagedDb>() {
            if let Ok(Some((name, role))) = db.with(|d| d.get_pane_metadata(&info.id)) {
                let registry = app.state::<crate::pty::PaneRegistry>();
                if !name.is_empty() && registry.rename(&info.id, &name).is_ok() {
                    sync_mux_pane_name(app, &info.id, &name);
                }
                if !role.is_empty() && registry.set_role(&info.id, &role).is_ok() {
                    sync_mux_pane_role(app, &info.id, &role);
                }
            }
        }
        wire_sidecar_terminal_streaming(
            app,
            sidecar.clone(),
            &info.id,
            SidecarWireOptions {
                cols: SIDECAR_RECONNECT_DEFAULT_COLS,
                rows: SIDECAR_RECONNECT_DEFAULT_ROWS,
                cwd: Some(&cwd),
                shell_name: &shell_name,
                backfill_scrollback: true,
            },
        )
        .await?;
        adopted = adopted.saturating_add(1);
    }
    if adopted > 0 {
        record_audit_event(
            app,
            "terminal",
            "sidecar_adopt",
            "info",
            Some("terminal"),
            None,
            "Sidecar terminals adopted after reconnect",
            serde_json::json!({
                "count": adopted,
                "cols": SIDECAR_RECONNECT_DEFAULT_COLS,
                "rows": SIDECAR_RECONNECT_DEFAULT_ROWS,
                "backend": "sidecar",
            }),
        );
    }
    Ok(adopted)
}

/// Write input to a terminal. On Enter (`\r` in the input payload) we also
/// capture a `TerminalSnapshot` into the session-scoped ring buffer — this is
/// the time-travel capture point (Phase 3C-3a). The snapshot reflects the
/// grid *as it was when the user submitted the command*, before the shell
/// produces output for it.
#[tauri::command]
pub async fn write_terminal(app: AppHandle, id: String, data: String) -> Result<(), String> {
    validate_keys_payload(&data)?;
    let raw = data.into_bytes();
    // P0-4: `write_terminal` is an INTERACTIVE agent-TUI path (a live claude/codex TUI that
    // echoes char-by-char), so gate in echo-preserving mode: keystrokes pass through, but a
    // catastrophic submission's Enter is replaced with Ctrl-C so the command never runs. The
    // GATED bytes flow downstream, so a neutralized line is neither saved as submitted history
    // nor snapshotted.
    // Hold the per-terminal write-order lock across the gate-check AND the PTY write so the
    // echoed keystrokes and the (possibly neutralizing) terminator cannot reorder on the PTY.
    let write_order = terminal_write_order_lock(&id);
    let _write_guard = write_order.lock().await;
    let ack = terminal_write_authorized_async(
        &app,
        &id,
        &id,
        &raw,
        "ipc-write-terminal",
        crate::command_risk::authority::WriteActorKind::Human,
        crate::command_risk::authority::WritePayloadMode::EchoPreserving,
        None,
        None,
    )
    .await?;
    if ack.status == crate::command_risk::authority::TerminalWriteAckStatus::Held {
        return Ok(());
    }
    if ack.contains_enter {
        save_submitted_command_history(&app, &id, &String::from_utf8_lossy(&raw));
    }
    let metadata = serde_json::json!({
        "bytes": ack.bytes_written_per_target,
        "containsEnter": ack.contains_enter,
        "requestId": ack.request_id,
        "redacted": true,
    });
    if ack.contains_enter || ack.bytes_written_per_target >= 128 {
        record_audit_event(
            &app,
            "terminal",
            if ack.contains_enter {
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
    if ack.contains_enter {
        capture_if_enter(&app, &id, b"\r");
    }
    Ok(())
}

#[tauri::command]
pub fn native_terminal_input_status(
    host: State<'_, Arc<crate::term::NativeTerminalInputHost>>,
) -> crate::term::NativeTerminalInputStatus {
    host.status()
}

#[tauri::command]
pub fn native_terminal_input_preedit(
    host: State<'_, Arc<crate::term::NativeTerminalInputHost>>,
) -> crate::term::NativeTerminalPreedit {
    host.preedit()
}

fn native_input_coord(value: f64) -> i32 {
    if !value.is_finite() {
        return 0;
    }
    value.round().clamp(0.0, i32::MAX as f64) as i32
}

#[tauri::command]
pub async fn native_terminal_input_focus(
    app: AppHandle,
    terminal_id: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    caret_inset: Option<f64>,
) -> Result<crate::term::NativeTerminalInputStatus, String> {
    let host = app
        .state::<Arc<crate::term::NativeTerminalInputHost>>()
        .inner()
        .clone();
    let app_for_main = app.clone();
    let (tx, rx) = mpsc::channel();
    let rect = crate::term::NativeInputSurfaceRect {
        x: native_input_coord(x),
        y: native_input_coord(y),
        width: native_input_coord(width).max(1),
        height: native_input_coord(height).max(1),
        caret_inset: native_input_coord(caret_inset.unwrap_or(0.0)),
    };
    app.run_on_main_thread(move || {
        let result = (|| {
            let window = app_for_main
                .get_webview_window("main")
                .ok_or_else(|| "No main window".to_string())?;
            let hwnd = window.hwnd().map_err(|err| err.to_string())?;
            host.focus_native_surface(hwnd.0 as isize, terminal_id, rect)
        })();
        let _ = tx.send(result);
    })
    .map_err(|err| format!("native input focus dispatch failed: {err}"))?;
    rx.recv_timeout(Duration::from_secs(2))
        .map_err(|err| format!("native input focus timed out: {err}"))?
}

#[tauri::command]
pub async fn native_terminal_input_drain(
    app: AppHandle,
) -> Result<crate::term::NativeTerminalInputStatus, String> {
    let host = app
        .state::<Arc<crate::term::NativeTerminalInputHost>>()
        .inner()
        .clone();
    let host_for_main = host.clone();
    let (tx, rx) = mpsc::channel();
    app.run_on_main_thread(move || {
        let _ = tx.send(host_for_main.drain_native_surface_text());
    })
    .map_err(|err| format!("native input drain dispatch failed: {err}"))?;
    let drained = rx
        .recv_timeout(Duration::from_secs(2))
        .map_err(|err| format!("native input drain timed out: {err}"))??;
    let Some((terminal_id, text, source)) = drained else {
        return Ok(host.status());
    };
    commit_native_terminal_input(&app, host, terminal_id, text, source).await
}

#[tauri::command]
pub async fn native_terminal_input_paste(
    app: AppHandle,
    terminal_id: String,
) -> Result<crate::term::NativeTerminalInputStatus, String> {
    let host = app
        .state::<Arc<crate::term::NativeTerminalInputHost>>()
        .inner()
        .clone();
    let staged = host.stage_native_clipboard_paste(terminal_id)?;
    let Some((terminal_id, text)) = staged else {
        return Ok(host.status());
    };
    commit_native_terminal_input(
        &app,
        host,
        terminal_id,
        text,
        "native-clipboard-paste".to_string(),
    )
    .await
}

/// Rust-owned terminal input commit path. The WebView can still own temporary
/// IME preedit during the current migration, but the committed text is routed
/// through this command so the native composition host can take over without
/// changing PTY write, synchronized-input, audit, or snapshot semantics again.
#[tauri::command]
pub async fn native_terminal_input_commit(
    app: AppHandle,
    terminal_id: String,
    data: String,
    source: Option<String>,
) -> Result<crate::term::NativeTerminalInputStatus, String> {
    let host = app
        .state::<Arc<crate::term::NativeTerminalInputHost>>()
        .inner()
        .clone();
    if data.is_empty() {
        return Ok(host.activate_terminal(terminal_id));
    }

    let source = sanitize_native_input_source(source);
    commit_native_terminal_input(&app, host, terminal_id, data, source).await
}

fn sanitize_native_input_source(source: Option<String>) -> String {
    let source = source.unwrap_or_else(|| "terminal-input".to_string());
    let source = source
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | ':'))
        .take(48)
        .collect::<String>();
    if source.is_empty() {
        "terminal-input".to_string()
    } else {
        source
    }
}

async fn commit_native_terminal_input(
    app: &AppHandle,
    host: Arc<crate::term::NativeTerminalInputHost>,
    terminal_id: String,
    data: String,
    source: String,
) -> Result<crate::term::NativeTerminalInputStatus, String> {
    if let Err(err) = validate_keys_payload(&data) {
        host.record_error(&terminal_id, sanitize_audit_error(&err));
        record_audit_event(
            app,
            "terminal",
            "native_input_rejected",
            "warn",
            Some("terminal"),
            Some(&terminal_id),
            "Native terminal input rejected",
            serde_json::json!({
                "source": source,
                "error": sanitize_audit_error(&err),
                "redacted": true,
            }),
        );
        return Err(err);
    }
    // P0-4: gate native input by its kind. The app's command-center is a full submit and
    // classifies atomically. Clipboard paste is a programmatic complete-line stream, so it
    // uses hold-until-approved semantics like send_keys: nothing reaches the PTY until the
    // pasted line terminator is allowed. Raw keystroke sources need char echo ->
    // echo-preserving mode (a catastrophic submission's Enter becomes Ctrl-C). The source_kind
    // is stable per kind so one terminal's pending line shares one mirror.
    let (gate_source, gate_mode) = match source.as_str() {
        "command-center" => (
            "ipc-native-command-center",
            crate::command_risk::authority::WritePayloadMode::Atomic,
        ),
        "native-clipboard-paste" => (
            "ipc-native-paste",
            crate::command_risk::authority::WritePayloadMode::HoldUntilApproved,
        ),
        _ => (
            "ipc-native-keystroke",
            crate::command_risk::authority::WritePayloadMode::EchoPreserving,
        ),
    };
    let raw = data.into_bytes();
    // Serialize the gate-check + PTY write per terminal so echoed keystrokes and the
    // (possibly neutralizing) terminator cannot reorder on the PTY (see TERMINAL_WRITE_ORDER).
    let write_order = terminal_write_order_lock(&terminal_id);
    let _write_guard = write_order.lock().await;
    let ack = match terminal_write_authorized_async(
        app,
        &terminal_id,
        &terminal_id,
        &raw,
        gate_source,
        crate::command_risk::authority::WriteActorKind::Human,
        gate_mode,
        None,
        None,
    )
    .await
    {
        Ok(ack) => ack,
        Err(err) => {
            host.record_error(&terminal_id, sanitize_audit_error(&err));
            record_audit_event(
                app,
                "terminal",
                "native_input_rejected",
                "warn",
                Some("terminal"),
                Some(&terminal_id),
                "Native terminal input rejected",
                serde_json::json!({
                    "source": source,
                    "error": sanitize_audit_error(&err),
                    "redacted": true,
                }),
            );
            return Err(err);
        }
    };
    if ack.status == crate::command_risk::authority::TerminalWriteAckStatus::Held {
        return Ok(host.record_commit(terminal_id, source, 0));
    }
    if ack.contains_enter {
        save_submitted_command_history(app, &terminal_id, &String::from_utf8_lossy(&raw));
    }
    let metadata = serde_json::json!({
        "bytes": ack.bytes_written_per_target,
        "containsEnter": ack.contains_enter,
        "requestId": ack.request_id,
        "source": source.clone(),
        "redacted": true,
    });
    if ack.contains_enter || ack.bytes_written_per_target >= 128 {
        record_audit_event(
            app,
            "terminal",
            if ack.contains_enter {
                "native_input_submit"
            } else {
                "native_input_paste"
            },
            "info",
            Some("terminal"),
            Some(&terminal_id),
            "Native terminal input sent",
            metadata,
        );
    }
    if ack.contains_enter {
        capture_if_enter(app, &terminal_id, b"\r");
    }
    Ok(host.record_commit(terminal_id, source, ack.bytes_written_per_target))
}

/// Trigger a `UserSubmitted` snapshot when the bytes just written to a PTY
/// contained an Enter (`\r`). Shared by every write-side IPC so Orchestra /
/// Helm / `send_keys` / broadcast paths all feed the timeline, not just
/// `write_terminal`.
pub(crate) fn capture_if_enter(app: &AppHandle, terminal_id: &str, data: &[u8]) {
    if data.contains(&b'\r') {
        capture_user_submit_snapshot(app, terminal_id);
    }
}

#[allow(clippy::too_many_arguments)]
pub(crate) async fn terminal_write_authorized_async(
    app: &AppHandle,
    terminal_id: &str,
    session_id: &str,
    data: &[u8],
    source: &str,
    actor_kind: crate::command_risk::authority::WriteActorKind,
    payload_mode: crate::command_risk::authority::WritePayloadMode,
    command_approval_id: Option<&str>,
    interactive_prompt_key: Option<&str>,
) -> Result<crate::command_risk::authority::TerminalWriteAck, String> {
    let targets = synchronized_input_targets(app, terminal_id);
    let envelope = crate::command_risk::authority::TerminalWriteEnvelope::for_payload(
        format!("write:{}", uuid::Uuid::new_v4()),
        crate::command_risk::authority::WriteActor {
            principal: "local-operator".to_string(),
            kind: actor_kind,
        },
        source,
        terminal_id,
        session_id,
        targets,
        payload_mode,
        data,
        crate::command_risk::authority::WriteApprovalBinding {
            command_approval_id: command_approval_id.map(str::to_string),
            interactive_prompt_key: interactive_prompt_key.map(str::to_string),
        },
    );
    if let Some(sidecar) = app
        .try_state::<crate::pty_sidecar::PtySidecarState>()
        .and_then(|state| state.client())
    {
        return sidecar.write_authorized(&envelope, data).await;
    }
    let authority = app
        .try_state::<Arc<crate::command_risk::authority::TerminalInputAuthority>>()
        .ok_or_else(|| "terminal input authority unavailable".to_string())?
        .inner()
        .clone();
    let pty_manager = app.state::<PtyManager>().inner().clone();
    let payload = data.to_vec();
    tauri::async_runtime::spawn_blocking(move || {
        authority.execute(&envelope, &payload, |target, writable| {
            pty_manager.write(target, writable)
        })
    })
    .await
    .map_err(|err| format!("Terminal authority task failed: {err}"))?
    .map_err(|nack| format!("{}: {}", nack.code, nack.message))
}

pub(crate) async fn sync_terminal_interactive_approval_authority(
    app: &AppHandle,
    session_id: &str,
) -> Result<(), String> {
    let manager = app.state::<crate::agent::InteractiveSessionManager>();
    let session = manager
        .get(session_id)?
        .or_else(|| {
            manager.list().ok().and_then(|sessions| {
                sessions
                    .into_iter()
                    .find(|session| session.pty_id == session_id)
            })
        })
        .ok_or_else(|| format!("interactive session not found: {session_id}"))?;
    let prompt_key = if session.status == "waiting_approval" {
        session
            .approval_prompt
            .as_deref()
            .map(super::send_keys_commands::stable_interactive_prompt_key)
    } else {
        None
    };

    if let Some(authority) =
        app.try_state::<Arc<crate::command_risk::authority::TerminalInputAuthority>>()
    {
        match prompt_key.as_deref() {
            Some(key) => authority.set_interactive_approval(
                session.pty_id.clone(),
                session.id.clone(),
                key.to_string(),
            ),
            None => authority.clear_interactive_approval(&session.pty_id),
        }
    }
    if let Some(sidecar) = app
        .try_state::<crate::pty_sidecar::PtySidecarState>()
        .and_then(|state| state.client())
    {
        sidecar
            .sync_interactive_approval_state(&session.pty_id, &session.id, prompt_key.as_deref())
            .await?;
    }
    Ok(())
}

/// The effective fan-out target set for a write to `terminal_id`: the synchronized-input
/// pane group it belongs to (sorted/deduped), or just itself. Shared by `terminal_write_async`
/// (which writes them) and the P0-4 gate (which binds the approval scope to the SAME set), so
/// the gated scope and the actual writes never diverge.
pub(crate) fn synchronized_input_targets(app: &AppHandle, terminal_id: &str) -> Vec<String> {
    app.try_state::<Arc<Mutex<crate::mux::manager::MuxManager>>>()
        .and_then(|mux| {
            mux.inner()
                .lock()
                .ok()
                .and_then(|mux| mux.synchronized_input_targets_for_pane(terminal_id))
        })
        .filter(|targets| !targets.is_empty())
        .unwrap_or_else(|| vec![terminal_id.to_string()])
}

/// P0-4: gate a command-carrying LOCAL IPC write through the shared `CommandRiskGate` BEFORE
/// it reaches a PTY (hard boundary #1, covering both the in-process and sidecar write paths).
/// Returns the EXACT bytes that may be forwarded — the gate HOLDS unterminated programmatic
/// input and emits only complete approved lines, or (echo-preserving) passes keystrokes
/// through while replacing a catastrophic submission's Enter with Ctrl-C so it never runs.
///
/// The local IPC face uses the "Balanced" policy: a `review` command is allowed (the FE
/// shell-safety dialog is the review UX); only a catastrophic `deny` is hard-blocked. So no
/// approval id is carried here. Hold/atomic modes return `Err` on a denied submission;
/// echo-preserving never errors (it neutralizes in-band). When no gate is managed (some test
/// harnesses) the input passes through unchanged.
/// Per-terminal write-order locks (P0-4). In echo-preserving mode the gate WRITES echoed
/// keystrokes to the PTY *before* they are classified, so the gate's per-terminal mirror is
/// only consistent with the PTY's pending shell line if the gate-check and the resulting write
/// happen atomically and in order per terminal. Without this, two racing IPC writes (the
/// keystrokes, then the Enter) could be reordered on the PTY so the neutralizing Ctrl-C lands
/// before the echoed characters, stranding a destructive line that a later bare Enter would
/// execute. Holding this lock across `gate_ipc_input` + `terminal_write_async` serializes
/// (classify + write) per terminal so writes never reorder and the mirror never desyncs.
static TERMINAL_WRITE_ORDER: std::sync::LazyLock<
    Mutex<HashMap<String, Arc<tokio::sync::Mutex<()>>>>,
> = std::sync::LazyLock::new(|| Mutex::new(HashMap::new()));

/// Get (or create) the write-order lock for a terminal. Hold its guard across the gate-check
/// and the PTY write so command-carrying writes to one terminal cannot interleave or reorder.
pub(crate) fn terminal_write_order_lock(terminal_id: &str) -> Arc<tokio::sync::Mutex<()>> {
    let mut map = TERMINAL_WRITE_ORDER
        .lock()
        .unwrap_or_else(|p| p.into_inner());
    map.entry(terminal_id.to_string())
        .or_insert_with(|| Arc::new(tokio::sync::Mutex::new(())))
        .clone()
}

/// Drop a terminal's write-order lock when the terminal closes, so the registry does not grow
/// unboundedly across a long session with many ephemeral panes.
pub(crate) fn forget_terminal_write_order(terminal_id: &str) {
    if let Ok(mut map) = TERMINAL_WRITE_ORDER.lock() {
        map.remove(terminal_id);
    }
}

pub(crate) async fn terminal_ids_async(app: &AppHandle) -> Vec<String> {
    if let Some(sidecar) = app
        .try_state::<crate::pty_sidecar::PtySidecarState>()
        .and_then(|state| state.client())
    {
        return sidecar.list().await.unwrap_or_default();
    }
    let pty_manager = app.state::<PtyManager>().inner().clone();
    tauri::async_runtime::spawn_blocking(move || pty_manager.list())
        .await
        .unwrap_or_default()
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
pub async fn resize_terminal(
    app: AppHandle,
    id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let resize_result = if let Some(sidecar) = app
        .try_state::<crate::pty_sidecar::PtySidecarState>()
        .and_then(|state| state.client())
    {
        match sidecar.resize(&id, cols, rows).await {
            Ok(()) => Ok(()),
            Err(sidecar_err) => {
                // The id may be an in-process PtyManager terminal the sidecar
                // does not own (e.g. an autonomy fleet pane, always spawned
                // in-process) — fall back to resizing it directly before
                // reporting the original failure.
                let pty_manager = app.state::<PtyManager>().inner().clone();
                let resize_id = id.clone();
                let fallback = tauri::async_runtime::spawn_blocking(move || {
                    pty_manager
                        .resize(&resize_id, cols, rows)
                        .map_err(|err| err.to_string())
                })
                .await
                .map_err(|err| format!("Terminal resize task failed: {}", err))?;
                fallback.map_err(|_| sidecar_err)
            }
        }
    } else {
        let pty_manager = app.state::<PtyManager>().inner().clone();
        let resize_id = id.clone();
        tauri::async_runtime::spawn_blocking(move || {
            pty_manager
                .resize(&resize_id, cols, rows)
                .map_err(|err| err.to_string())
        })
        .await
        .map_err(|err| format!("Terminal resize task failed: {}", err))?
    };
    if let Err(err) = resize_result {
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
    sync_mux_pane_size(&app, &id, cols, rows);
    Ok(())
}

/// Close a terminal
#[tauri::command]
pub async fn close_terminal(app: AppHandle, id: String) -> Result<(), String> {
    // Mark the currently wired waiter as stale before dropping the PTY. The
    // child will exit as a side effect of the close, but that should not emit
    // a user-facing crash/exit banner for intentional process-manager ends.
    app.state::<TerminalGenerationRegistry>()
        .next_generation(&id);
    let close_result: Result<(), PtyError> = if let Some(sidecar) = app
        .try_state::<crate::pty_sidecar::PtySidecarState>()
        .and_then(|state| state.client())
    {
        sidecar
            .close(&id)
            .await
            .map_err(|err| PtyError::Other(err.to_string()))
    } else {
        let pty_manager = app.state::<PtyManager>().inner().clone();
        let close_id = id.clone();
        tauri::async_runtime::spawn_blocking(move || pty_manager.close(&close_id))
            .await
            .map_err(|err| PtyError::Other(format!("Terminal close task failed: {}", err)))?
    };
    let already_closed = match close_result {
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
    forget_terminal_write_order(&id); // drop the P0-4 per-terminal write-order lock
    sync_mux_terminal_remove(&app, &id);
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

#[tauri::command]
pub fn mux_process_keymap_event(
    registry: State<'_, MuxKeymapRegistry>,
    terminal_id: String,
    key: String,
    ctrl_key: bool,
    alt_key: bool,
    shift_key: bool,
    meta_key: bool,
) -> Result<MuxKeymapResponse, String> {
    use crate::mux::keymap::{KeyAction, KeymapEvent};

    let normalized = normalized_mux_key(&key, ctrl_key, alt_key, shift_key, meta_key)?;
    let event = registry.process_key(&terminal_id, normalized)?;
    let response = match event {
        KeymapEvent::PrefixStarted => MuxKeymapResponse {
            kind: "prefixStarted".to_string(),
            table: Some(crate::mux::keymap::PREFIX_TABLE.to_string()),
            command: None,
        },
        KeymapEvent::SequencePending { table, .. } => MuxKeymapResponse {
            kind: "sequencePending".to_string(),
            table: Some(table),
            command: None,
        },
        KeymapEvent::TableChanged { table } => MuxKeymapResponse {
            kind: "tableChanged".to_string(),
            table: Some(table),
            command: None,
        },
        KeymapEvent::Dispatch { table, action, .. } => {
            let command = match action {
                KeyAction::Command(command) => Some(command.name),
                _ => None,
            };
            MuxKeymapResponse {
                kind: "dispatch".to_string(),
                table: Some(table),
                command,
            }
        }
        KeymapEvent::PassThrough(_) => MuxKeymapResponse {
            kind: "passThrough".to_string(),
            table: None,
            command: None,
        },
        KeymapEvent::Cancelled { table, .. } => MuxKeymapResponse {
            kind: "cancelled".to_string(),
            table: Some(table),
            command: None,
        },
        KeymapEvent::Timeout { table } => MuxKeymapResponse {
            kind: "timeout".to_string(),
            table: Some(table),
            command: None,
        },
    };
    Ok(response)
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

/// Recent native command block journal records for a terminal.
/// These link saved command history rows to OSC 133 prompt marks and
/// scrollback anchors so review surfaces can jump to terminal evidence.
#[tauri::command]
pub fn term_command_blocks(
    app: AppHandle,
    id: String,
    limit: usize,
) -> Vec<crate::term::CommandBlockRecord> {
    let live = app
        .state::<Arc<crate::term::CommandBlockJournal>>()
        .recent(&id, limit);
    if !live.is_empty() {
        return live;
    }
    app.try_state::<crate::db::ManagedDb>()
        .and_then(|db| db.with(|d| d.recent_command_blocks(&id, limit)).ok())
        .unwrap_or_default()
}

/// Durable command-block evidence for diagnostics and reconnect validation.
/// Unlike `term_command_blocks`, this deliberately bypasses the live in-memory
/// journal so smoke tests can prove the recovery copy exists before a process
/// restart forces the fallback path.
#[tauri::command]
pub fn term_persisted_command_blocks(
    app: AppHandle,
    id: String,
    limit: usize,
) -> Vec<crate::term::CommandBlockRecord> {
    app.try_state::<crate::db::ManagedDb>()
        .and_then(|db| db.with(|d| d.recent_command_blocks(&id, limit)).ok())
        .unwrap_or_default()
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

#[tauri::command]
pub fn terminal_output_journal(
    app: AppHandle,
    terminal_id: String,
    limit: Option<usize>,
) -> Result<Vec<crate::db::TerminalOutputJournalRow>, String> {
    let db = app.state::<crate::db::ManagedDb>();
    db.with(|d| d.list_terminal_output_journal(&terminal_id, limit.unwrap_or(200)))
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
    pub last_terminal_spawn_ms: Option<u64>,
    pub last_terminal_stream_wire_ms: Option<u64>,
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
pub async fn performance_observatory_metrics(
    app: AppHandle,
    terminalId: Option<String>,
) -> PerformanceObservatoryMetrics {
    let active_terminals = terminal_ids_async(&app).await;
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
        last_terminal_spawn_ms: match LAST_TERMINAL_SPAWN_MS.load(Ordering::Relaxed) {
            DB_WRITE_LATENCY_UNSET => None,
            ms => Some(ms),
        },
        last_terminal_stream_wire_ms: match LAST_TERMINAL_STREAM_WIRE_MS.load(Ordering::Relaxed) {
            DB_WRITE_LATENCY_UNSET => None,
            ms => Some(ms),
        },
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
pub async fn list_terminals(app: AppHandle) -> Vec<String> {
    terminal_ids_async(&app).await
}

/// Detect available shells
#[tauri::command]
pub fn detect_shells() -> Vec<ShellType> {
    ShellType::detect_available()
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
    allowed_tools: Option<Vec<String>>,
    guardrail_profile: Option<String>,
) -> Result<String, String> {
    let agent_manager = app.state::<crate::agent::AgentManager>();
    // Cost gate (BR7): refuse a new agent when the live fleet is at the cap.
    let interactive_count = app
        .state::<crate::agent::InteractiveSessionManager>()
        .list()
        .map(|sessions| sessions.len())
        .unwrap_or(0);
    let active_agents = agent_manager.list_sessions().len() + interactive_count;
    app.state::<std::sync::Arc<crate::cost::CostManager>>()
        .guard_spawn(active_agents)?;
    let id = agent_manager.start_session(&prompt, &cwd, model.as_deref(), allowed_tools, None)?;
    if let Some(profile) = guardrail_profile.as_deref() {
        log::debug!("started agent with guardrail profile: {}", profile);
    }

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
                    "aelyris_lib::agent::stderr",
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
            emit_agent_fleet(handle);
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
                                "aelyris_lib::ipc::commands",
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
    emit_agent_fleet(&app);
    Ok(())
}

/// List agent sessions
#[tauri::command]
pub fn list_agents(app: AppHandle) -> Vec<crate::agent::AgentSessionInfo> {
    let agent_manager = app.state::<crate::agent::AgentManager>();
    agent_manager.list_sessions()
}

pub(crate) fn agent_fleet_snapshot(app: &AppHandle) -> Vec<crate::agent::AgentSession> {
    let agent_manager = app.state::<crate::agent::AgentManager>();
    let interactive_manager = app.state::<crate::agent::InteractiveSessionManager>();
    let interactive = interactive_manager.list().unwrap_or_default();
    let pane_registry = app.try_state::<crate::pty::PaneRegistry>();
    let visibility = session_visibility_index(
        app,
        interactive
            .iter()
            .map(|session| session.logical_session_id.clone()),
    );
    let mut sessions: Vec<crate::agent::AgentSession> = agent_manager
        .list_sessions()
        .into_iter()
        .map(crate::agent::AgentSession::from)
        .collect();

    sessions.extend(interactive.into_iter().map(|info| {
        let logical_session_id = info.logical_session_id.clone();
        let short_id = pane_registry
            .as_ref()
            .and_then(|registry| registry.get(&info.pty_id))
            .map(|entry| entry.short_id);
        let session = crate::agent::AgentSession::from(info).with_short_id(short_id);
        match visibility.get(&logical_session_id) {
            Some(visibility) => session.with_visibility(
                visibility.predecessor_session_id.clone(),
                visibility.lineage.clone(),
                visibility.recycle_status.clone(),
            ),
            None => session,
        }
    }));

    sessions.sort_by(|a, b| {
        b.started_at
            .unwrap_or_default()
            .cmp(&a.started_at.unwrap_or_default())
    });
    sessions
}

pub(crate) fn emit_agent_fleet(app: &AppHandle) {
    let sessions = agent_fleet_snapshot(app);
    let _ = app.emit("agent-fleet-updated", &sessions);
}

/// List headless and interactive agents through the unified AgentSession contract.
#[tauri::command]
pub fn list_agent_fleet(app: AppHandle) -> Vec<crate::agent::AgentSession> {
    agent_fleet_snapshot(&app)
}

#[derive(Clone, Default)]
struct SessionVisibility {
    predecessor_session_id: Option<String>,
    lineage: Vec<crate::agent::SessionLineageEntry>,
    recycle_status: Option<crate::agent::SessionRecycleStatus>,
}

fn session_visibility_index<I>(
    app: &AppHandle,
    logical_session_ids: I,
) -> HashMap<String, SessionVisibility>
where
    I: IntoIterator<Item = String>,
{
    let Some(db) = app.try_state::<crate::db::ManagedDb>() else {
        return HashMap::new();
    };
    let checkpoints = match db.with(crate::persistence::SessionCheckpointRepo::load_latest_all) {
        Ok(checkpoints) => checkpoints,
        Err(err) => {
            log::warn!("agent fleet lineage checkpoint load failed: {err}");
            return HashMap::new();
        }
    };
    let checkpoint_by_logical: HashMap<String, crate::persistence::SessionCheckpointRecord> =
        checkpoints
            .into_iter()
            .map(|checkpoint| (checkpoint.logical_session_id.clone(), checkpoint))
            .collect();
    let mut index = HashMap::new();

    for logical_session_id in logical_session_ids {
        let latest_checkpoint = checkpoint_by_logical.get(&logical_session_id);
        let lineage = build_session_lineage(&logical_session_id, &checkpoint_by_logical);
        let recycle_status = match db.with(|database| {
            crate::persistence::SessionCheckpointRepo::load_latest_handoff_for_session(
                database,
                &logical_session_id,
            )
        }) {
            Ok(Some(handoff)) => Some(crate::agent::SessionRecycleStatus::from(&handoff)),
            Ok(None) => None,
            Err(err) => {
                log::warn!(
                    "agent fleet recycle state load failed for {}: {}",
                    logical_session_id,
                    err
                );
                None
            }
        };
        let predecessor_session_id =
            latest_checkpoint.and_then(|checkpoint| checkpoint.predecessor_session_id.clone());
        let visible_lineage = if lineage.len() > 1 {
            lineage
        } else {
            Vec::new()
        };

        if predecessor_session_id.is_some()
            || !visible_lineage.is_empty()
            || recycle_status.is_some()
        {
            index.insert(
                logical_session_id,
                SessionVisibility {
                    predecessor_session_id,
                    lineage: visible_lineage,
                    recycle_status,
                },
            );
        }
    }

    index
}

fn build_session_lineage(
    logical_session_id: &str,
    checkpoint_by_logical: &HashMap<String, crate::persistence::SessionCheckpointRecord>,
) -> Vec<crate::agent::SessionLineageEntry> {
    let mut current = Some(logical_session_id.to_string());
    let mut seen = HashSet::new();
    let mut lineage = Vec::new();

    while let Some(id) = current {
        if !seen.insert(id.clone()) {
            break;
        }
        match checkpoint_by_logical.get(&id) {
            Some(checkpoint) => {
                current = checkpoint.predecessor_session_id.clone();
                lineage.push(crate::agent::SessionLineageEntry::from_checkpoint(
                    checkpoint,
                ));
            }
            None => {
                lineage.push(crate::agent::SessionLineageEntry::unresolved(id));
                break;
            }
        }
    }

    lineage.reverse();
    lineage
}

/// Route a prompt to the best model
#[tauri::command]
pub fn route_agent(prompt: String, budget: Option<f64>) -> crate::agent::router::RoutingDecision {
    crate::agent::router::AgentRouter::route(&prompt, budget)
}

/// Inspect whether an agent branch is ready to merge into a target branch.
/// This is read-only; it never checks out, fast-forwards, or writes to main.
#[tauri::command]
pub fn inspect_merge_worktree_branch(
    repo_path: String,
    source_branch: String,
    target_branch: String,
) -> Result<crate::git::MergeReadiness, String> {
    crate::control::merge::inspect(&repo_path, &source_branch, &target_branch)
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
        let tmp_dir = std::env::temp_dir().join("aelyris-chat-images");
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
    let tmp_dir = std::env::temp_dir().join("aelyris-chat-images");
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

/// Save a bitmap image directly from the OS clipboard without routing image
/// bytes through WebView's async Clipboard API.
#[tauri::command]
pub fn save_clipboard_image() -> Result<Option<String>, String> {
    save_clipboard_image_impl()
}

#[tauri::command]
pub fn read_clipboard_text() -> Result<String, String> {
    read_clipboard_text_impl()
}

#[tauri::command]
pub fn write_clipboard_text(text: String) -> Result<(), String> {
    write_clipboard_text_impl(&text)
}

#[cfg(not(windows))]
fn save_clipboard_image_impl() -> Result<Option<String>, String> {
    Ok(None)
}

#[cfg(not(windows))]
fn read_clipboard_text_impl() -> Result<String, String> {
    Ok(String::new())
}

#[cfg(not(windows))]
fn write_clipboard_text_impl(_text: &str) -> Result<(), String> {
    Ok(())
}

#[cfg(windows)]
fn read_clipboard_text_impl() -> Result<String, String> {
    use windows::Win32::Foundation::HGLOBAL;
    use windows::Win32::System::DataExchange::{
        CloseClipboard, GetClipboardData, IsClipboardFormatAvailable, OpenClipboard,
    };
    use windows::Win32::System::Memory::{GlobalLock, GlobalSize, GlobalUnlock};

    const CF_UNICODETEXT: u32 = 13;

    struct ClipboardGuard;
    impl Drop for ClipboardGuard {
        fn drop(&mut self) {
            unsafe {
                let _ = CloseClipboard();
            }
        }
    }

    unsafe {
        OpenClipboard(None).map_err(|e| format!("OpenClipboard failed: {e}"))?;
        let _guard = ClipboardGuard;
        if IsClipboardFormatAvailable(CF_UNICODETEXT).is_err() {
            return Ok(String::new());
        }
        let handle = GetClipboardData(CF_UNICODETEXT)
            .map_err(|e| format!("GetClipboardData(CF_UNICODETEXT) failed: {e}"))?;
        let global = HGLOBAL(handle.0);
        let size = GlobalSize(global);
        if size < 2 {
            return Ok(String::new());
        }
        let ptr = GlobalLock(global);
        if ptr.is_null() {
            return Err("GlobalLock failed for clipboard text".into());
        }
        let words = std::slice::from_raw_parts(ptr.cast::<u16>(), size / 2);
        let end = words
            .iter()
            .position(|word| *word == 0)
            .unwrap_or(words.len());
        let text = String::from_utf16_lossy(&words[..end]);
        let _ = GlobalUnlock(global);
        Ok(text)
    }
}

#[cfg(windows)]
fn write_clipboard_text_impl(text: &str) -> Result<(), String> {
    use windows::Win32::Foundation::{GlobalFree, HANDLE};
    use windows::Win32::System::DataExchange::{
        CloseClipboard, EmptyClipboard, OpenClipboard, SetClipboardData,
    };
    use windows::Win32::System::Memory::{GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE};

    const CF_UNICODETEXT: u32 = 13;

    struct ClipboardGuard;
    impl Drop for ClipboardGuard {
        fn drop(&mut self) {
            unsafe {
                let _ = CloseClipboard();
            }
        }
    }

    let mut wide: Vec<u16> = text.encode_utf16().collect();
    wide.push(0);
    let byte_len = wide
        .len()
        .checked_mul(std::mem::size_of::<u16>())
        .ok_or("clipboard text is too large")?;

    unsafe {
        OpenClipboard(None).map_err(|e| format!("OpenClipboard failed: {e}"))?;
        let _guard = ClipboardGuard;
        EmptyClipboard().map_err(|e| format!("EmptyClipboard failed: {e}"))?;
        let global = GlobalAlloc(GMEM_MOVEABLE, byte_len)
            .map_err(|e| format!("GlobalAlloc failed for clipboard text: {e}"))?;
        let ptr = GlobalLock(global);
        if ptr.is_null() {
            let _ = GlobalFree(Some(global));
            return Err("GlobalLock failed for clipboard text".into());
        }
        std::ptr::copy_nonoverlapping(wide.as_ptr().cast::<u8>(), ptr.cast::<u8>(), byte_len);
        let _ = GlobalUnlock(global);
        if let Err(err) = SetClipboardData(CF_UNICODETEXT, Some(HANDLE(global.0))) {
            let _ = GlobalFree(Some(global));
            return Err(format!("SetClipboardData(CF_UNICODETEXT) failed: {err}"));
        }
        Ok(())
    }
}

#[cfg(windows)]
fn save_clipboard_image_impl() -> Result<Option<String>, String> {
    use windows::Win32::Foundation::HGLOBAL;
    use windows::Win32::System::DataExchange::{
        CloseClipboard, GetClipboardData, IsClipboardFormatAvailable, OpenClipboard,
    };
    use windows::Win32::System::Memory::{GlobalLock, GlobalSize, GlobalUnlock};

    const CF_DIB: u32 = 8;
    const CF_DIBV5: u32 = 17;

    struct ClipboardGuard;
    impl Drop for ClipboardGuard {
        fn drop(&mut self) {
            unsafe {
                let _ = CloseClipboard();
            }
        }
    }

    unsafe {
        OpenClipboard(None).map_err(|e| format!("OpenClipboard failed: {e}"))?;
        let _guard = ClipboardGuard;

        let format = if IsClipboardFormatAvailable(CF_DIBV5).is_ok() {
            CF_DIBV5
        } else if IsClipboardFormatAvailable(CF_DIB).is_ok() {
            CF_DIB
        } else {
            return Ok(None);
        };

        let handle = GetClipboardData(format)
            .map_err(|e| format!("GetClipboardData({format}) failed: {e}"))?;
        let global = HGLOBAL(handle.0);
        let size = GlobalSize(global);
        if size == 0 {
            return Err("clipboard image has no readable bytes".into());
        }
        let ptr = GlobalLock(global);
        if ptr.is_null() {
            return Err("GlobalLock failed for clipboard image".into());
        }

        let dib = std::slice::from_raw_parts(ptr.cast::<u8>(), size).to_vec();
        let _ = GlobalUnlock(global);
        let bmp = bmp_bytes_from_dib(&dib)?;

        let tmp_dir = std::env::temp_dir().join("aelyris-chat-images");
        std::fs::create_dir_all(&tmp_dir).map_err(|e| e.to_string())?;
        let path = tmp_dir.join(format!("clipboard_{}.bmp", uuid::Uuid::new_v4()));
        std::fs::write(&path, bmp).map_err(|e| e.to_string())?;
        Ok(Some(path.to_string_lossy().to_string()))
    }
}

fn bmp_bytes_from_dib(dib: &[u8]) -> Result<Vec<u8>, String> {
    if dib.len() < 40 {
        return Err("clipboard DIB is too small".into());
    }
    let pixel_offset = bmp_pixel_offset_from_dib(dib)?;
    let file_size = 14usize
        .checked_add(dib.len())
        .ok_or("clipboard DIB is too large")?;
    if file_size > u32::MAX as usize {
        return Err("clipboard DIB is too large".into());
    }

    let mut out = Vec::with_capacity(file_size);
    out.extend_from_slice(b"BM");
    out.extend_from_slice(&(file_size as u32).to_le_bytes());
    out.extend_from_slice(&[0, 0, 0, 0]);
    out.extend_from_slice(&pixel_offset.to_le_bytes());
    out.extend_from_slice(dib);
    Ok(out)
}

fn bmp_pixel_offset_from_dib(dib: &[u8]) -> Result<u32, String> {
    if dib.len() < 40 {
        return Err("clipboard DIB is too small".into());
    }
    let header_size = u32::from_le_bytes([dib[0], dib[1], dib[2], dib[3]]) as usize;
    if header_size < 40 || header_size > dib.len() {
        return Err("clipboard DIB has an invalid header".into());
    }

    let bit_count = u16::from_le_bytes([dib[14], dib[15]]);
    let compression = u32::from_le_bytes([dib[16], dib[17], dib[18], dib[19]]);
    let colors_used = u32::from_le_bytes([dib[32], dib[33], dib[34], dib[35]]);
    let palette_entries = if bit_count <= 8 {
        if colors_used > 0 {
            colors_used as usize
        } else {
            1usize << bit_count
        }
    } else {
        0
    };
    let bitfield_mask_bytes = if header_size == 40 {
        match compression {
            3 => 12,
            6 => 16,
            _ => 0,
        }
    } else {
        0
    };
    let offset = 14usize
        .checked_add(header_size)
        .and_then(|value| value.checked_add(palette_entries.saturating_mul(4)))
        .and_then(|value| value.checked_add(bitfield_mask_bytes))
        .ok_or("clipboard DIB offset overflow")?;
    if offset > u32::MAX as usize {
        return Err("clipboard DIB offset overflow".into());
    }
    Ok(offset as u32)
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

// --- Workspace pane commands ---

const MAX_KEYS_BYTES: usize = 1024 * 1024; // 1 MB

pub(crate) fn validate_keys_payload(data: &str) -> Result<(), String> {
    if data.is_empty() {
        return Err("Input data is required".to_string());
    }
    if data.len() > MAX_KEYS_BYTES {
        return Err("Input data exceeds maximum allowed size (1 MB)".to_string());
    }
    Ok(())
}

fn command_history_text_from_submitted_input(data: &str) -> Option<String> {
    if !data.contains('\r') && !data.contains('\n') {
        return None;
    }
    let normalized = data.replace("\r\n", "\n").replace('\r', "\n");
    let command = normalized.trim_end_matches('\n');
    if command.trim().is_empty() {
        return None;
    }
    Some(command.to_string())
}

fn terminal_registry_cwd(app: &AppHandle, terminal_id: &str) -> String {
    app.try_state::<crate::pty::PaneRegistry>()
        .and_then(|registry| registry.get(terminal_id))
        .map(|entry| entry.cwd)
        .filter(|cwd| !cwd.trim().is_empty())
        .map(|cwd| normalize_command_history_cwd(&cwd))
        .unwrap_or_else(|| ".".to_string())
}

pub(crate) fn save_submitted_command_history(app: &AppHandle, terminal_id: &str, data: &str) {
    let Some(command) = command_history_text_from_submitted_input(data) else {
        return;
    };
    let cwd = terminal_registry_cwd(app, terminal_id);
    if let Err(err) = save_command_history(app.clone(), terminal_id.to_string(), command, cwd) {
        log::warn!("submitted command history save failed terminal={terminal_id}: {err}");
    }
}

/// List all files in a project (gitignore-aware for fuzzy finder)
#[tauri::command]
pub fn list_all_files(
    root_path: String,
    max_files: usize,
) -> Result<Vec<crate::git::FileListEntry>, String> {
    crate::git::list_all_files(&root_path, max_files)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ipc::fs_commands::{safe_temp_diff_name, vscode_diff_args, vscode_open_args};
    use crate::watchdog::{AutoApproveRule, WatchdogRules};

    #[test]
    fn sidecar_backfill_text_joins_lines_with_crlf() {
        assert_eq!(
            sidecar_backfill_text("first\nsecond\nprompt>"),
            "first\r\nsecond\r\nprompt>"
        );
    }

    #[test]
    fn sidecar_backfill_text_does_not_double_line_ending_carriage_returns() {
        // Daemon buffer lines split on `\n` keep a trailing `\r`; replay must
        // not double it into `\r\r\n`.
        assert_eq!(
            sidecar_backfill_text("first\r\nsecond\r\nprompt>"),
            "first\r\nsecond\r\nprompt>"
        );
    }

    #[test]
    fn sidecar_backfill_text_preserves_mid_line_carriage_returns() {
        // Progress-bar style cursor returns inside a line must replay
        // verbatim so the final overwrite wins, exactly as it rendered live.
        assert_eq!(
            sidecar_backfill_text("[##  ] 40%\r[####] 80%\ndone"),
            "[##  ] 40%\r[####] 80%\r\ndone"
        );
    }

    #[test]
    fn sidecar_backfill_text_keeps_ansi_sequences() {
        assert_eq!(
            sidecar_backfill_text("\x1b[32mok\x1b[0m\ndone"),
            "\x1b[32mok\x1b[0m\r\ndone"
        );
    }

    #[test]
    fn sidecar_backfill_text_handles_empty_and_open_prompt_line() {
        assert!(sidecar_backfill_text("").is_empty());
        // The final line is the live prompt: no trailing line break so the
        // cursor stays on it after replay.
        assert_eq!(sidecar_backfill_text("prompt>"), "prompt>");
    }

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
        assert!(validate_path("C:/repo/project").is_ok());
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
    fn vscode_open_args_rejects_empty_paths() {
        assert!(vscode_open_args("   ", None, None).is_err());
    }

    #[test]
    fn vscode_open_args_blocks_unsafe_paths() {
        assert!(vscode_open_args("../../etc/passwd", None, None).is_err());
        assert!(vscode_open_args("\\\\server\\share\\file.rs", None, None).is_err());
    }

    #[test]
    fn vscode_open_args_plain_path_uses_no_goto_flag() {
        assert_eq!(
            vscode_open_args("C:/repo/project/src/main.rs", None, None).unwrap(),
            vec!["C:/repo/project/src/main.rs".to_string()]
        );
    }

    #[test]
    fn vscode_open_args_line_and_column_use_goto_syntax() {
        assert_eq!(
            vscode_open_args("C:/repo/project/src/main.rs", Some(12), Some(4)).unwrap(),
            vec![
                "-g".to_string(),
                "C:/repo/project/src/main.rs:12:4".to_string()
            ]
        );
        assert_eq!(
            vscode_open_args("C:/repo/project/src/main.rs", Some(12), None).unwrap(),
            vec![
                "-g".to_string(),
                "C:/repo/project/src/main.rs:12".to_string()
            ]
        );
    }

    #[test]
    fn vscode_open_args_ignores_zero_line_and_column() {
        assert_eq!(
            vscode_open_args("C:/repo/project/src/main.rs", Some(0), Some(0)).unwrap(),
            vec!["C:/repo/project/src/main.rs".to_string()]
        );
    }

    #[test]
    fn vscode_diff_args_uses_native_diff_flag() {
        assert_eq!(
            vscode_diff_args(
                "C:/Users/example/AppData/Local/Temp/aelyris-vscode-diff/HEAD-main.rs",
                "C:/repo/project/src/main.rs"
            )
            .unwrap(),
            vec![
                "--diff".to_string(),
                "C:/Users/example/AppData/Local/Temp/aelyris-vscode-diff/HEAD-main.rs".to_string(),
                "C:/repo/project/src/main.rs".to_string()
            ]
        );
    }

    #[test]
    fn vscode_diff_args_rejects_empty_paths() {
        assert!(vscode_diff_args("", "C:/repo/project/src/main.rs").is_err());
        assert!(vscode_diff_args("C:/repo/project/src/main.rs", " ").is_err());
    }

    #[test]
    fn native_input_source_is_sanitized_for_audit_metadata() {
        assert_eq!(
            sanitize_native_input_source(Some("native edit/surface!@# with spaces".to_string())),
            "nativeeditsurfacewithspaces"
        );
        assert_eq!(
            sanitize_native_input_source(Some("native-edit:surface_01".to_string())),
            "native-edit:surface_01"
        );
        assert_eq!(
            sanitize_native_input_source(Some("!!!".to_string())),
            "terminal-input"
        );
    }

    #[test]
    fn safe_temp_diff_name_removes_path_separators_and_preserves_extension() {
        assert_eq!(safe_temp_diff_name("src/main.rs"), "src_main.rs");
        assert_eq!(safe_temp_diff_name("馬/設定.toml"), "____.toml");
        assert_eq!(safe_temp_diff_name("..\\evil.ps1"), ".._evil.ps1");
    }

    #[test]
    fn normalize_cwd_allows_home_relative_and_unicode_dirs() {
        if let Some(home) = home_dir_for_cwd() {
            let canonical_home = std::fs::canonicalize(home).unwrap();
            let normalized = normalize_cwd(Some("~".into())).unwrap();
            assert_eq!(
                normalized,
                Some(strip_local_verbatim_prefix(
                    &canonical_home.to_string_lossy()
                ))
            );
        }

        let unicode_dir =
            std::env::temp_dir().join(format!("aelyris-ipc-cwd-馬-{}", std::process::id()));
        std::fs::create_dir_all(&unicode_dir).unwrap();
        let normalized = normalize_cwd(Some(unicode_dir.to_string_lossy().to_string())).unwrap();
        let canonical = std::fs::canonicalize(&unicode_dir).unwrap();
        assert_eq!(
            normalized,
            Some(strip_local_verbatim_prefix(&canonical.to_string_lossy()))
        );
        let _ = std::fs::remove_dir_all(unicode_dir);
    }

    #[test]
    fn normalize_cwd_accepts_local_verbatim_paths_but_rejects_unc_verbatim() {
        let cwd = std::env::current_dir().unwrap();
        let verbatim = format!(r"\\?\{}", cwd.to_string_lossy());
        assert_eq!(
            normalize_cwd(Some(verbatim)).unwrap(),
            Some(cwd.to_string_lossy().to_string())
        );
        assert!(normalize_cwd(Some(r"\\?\UNC\server\share".into())).is_err());
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
    fn submitted_input_command_history_text_requires_enter() {
        assert_eq!(
            command_history_text_from_submitted_input("echo hi\r"),
            Some("echo hi".to_string())
        );
        assert_eq!(
            command_history_text_from_submitted_input("echo hi\r\n"),
            Some("echo hi".to_string())
        );
        assert_eq!(
            command_history_text_from_submitted_input("echo one\n echo two\n"),
            Some("echo one\n echo two".to_string())
        );
        assert_eq!(command_history_text_from_submitted_input("echo hi"), None);
        assert_eq!(command_history_text_from_submitted_input("\r"), None);
    }

    #[test]
    fn command_history_cwd_normalizes_windows_and_url_separators() {
        assert_eq!(
            normalize_command_history_cwd(r"C:\repo\aelyris\"),
            "C:/repo/aelyris"
        );
        assert_eq!(
            normalize_command_history_cwd("C:/repo/aelyris"),
            "C:/repo/aelyris"
        );
        assert_eq!(normalize_command_history_cwd("C:/"), "C:/");
        assert_eq!(normalize_command_history_cwd("   "), ".");
    }

    #[test]
    fn bell_filter_ignores_osc_terminators() {
        let mut in_osc = false;
        assert!(!contains_audible_bell(b"\x1b]133;A\x07", &mut in_osc));
        assert!(!in_osc);

        assert!(contains_audible_bell(b"ready\x07", &mut in_osc));
        assert!(!in_osc);
    }

    #[test]
    fn bell_filter_tracks_split_osc_chunks() {
        let mut in_osc = false;
        assert!(!contains_audible_bell(b"\x1b]133;D;0", &mut in_osc));
        assert!(in_osc);
        assert!(!contains_audible_bell(b"\x07prompt", &mut in_osc));
        assert!(!in_osc);
        assert!(contains_audible_bell(b"\x07", &mut in_osc));
    }

    #[test]
    fn clipboard_dib_is_wrapped_as_bmp() {
        let mut dib = Vec::new();
        dib.extend_from_slice(&40u32.to_le_bytes());
        dib.extend_from_slice(&1i32.to_le_bytes());
        dib.extend_from_slice(&1i32.to_le_bytes());
        dib.extend_from_slice(&1u16.to_le_bytes());
        dib.extend_from_slice(&32u16.to_le_bytes());
        dib.extend_from_slice(&0u32.to_le_bytes());
        dib.extend_from_slice(&4u32.to_le_bytes());
        dib.extend_from_slice(&0i32.to_le_bytes());
        dib.extend_from_slice(&0i32.to_le_bytes());
        dib.extend_from_slice(&0u32.to_le_bytes());
        dib.extend_from_slice(&0u32.to_le_bytes());
        dib.extend_from_slice(&[0, 0, 0, 255]);

        let bmp = bmp_bytes_from_dib(&dib).expect("valid DIB");
        assert_eq!(&bmp[0..2], b"BM");
        assert_eq!(u32::from_le_bytes([bmp[2], bmp[3], bmp[4], bmp[5]]), 58);
        assert_eq!(u32::from_le_bytes([bmp[10], bmp[11], bmp[12], bmp[13]]), 54);
        assert_eq!(&bmp[14..], dib.as_slice());
    }

    #[test]
    fn clipboard_dib_offset_accounts_for_palettes_and_bitfields() {
        let mut indexed = vec![0; 40 + 8];
        indexed[0..4].copy_from_slice(&40u32.to_le_bytes());
        indexed[14..16].copy_from_slice(&8u16.to_le_bytes());
        indexed[32..36].copy_from_slice(&2u32.to_le_bytes());
        assert_eq!(bmp_pixel_offset_from_dib(&indexed).unwrap(), 62);

        let mut bitfields = vec![0; 40 + 12 + 4];
        bitfields[0..4].copy_from_slice(&40u32.to_le_bytes());
        bitfields[14..16].copy_from_slice(&16u16.to_le_bytes());
        bitfields[16..20].copy_from_slice(&3u32.to_le_bytes());
        assert_eq!(bmp_pixel_offset_from_dib(&bitfields).unwrap(), 66);
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
