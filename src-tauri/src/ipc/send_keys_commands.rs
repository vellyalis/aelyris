//! Send-keys and pane-control IPC commands, extracted from `commands.rs`.
//! Pure module move — no behavior change. Shared helpers remain in `commands`.
use tauri::{AppHandle, Manager};

use crate::agent::{InteractiveSessionInfo, InteractiveSessionManager};

use super::commands::{
    capture_if_enter, record_audit_event, sanitize_audit_error, save_submitted_command_history,
    sync_mux_pane_name, sync_mux_pane_role, terminal_ids_async, terminal_write_authorized_async,
    terminal_write_order_lock, validate_keys_payload, OutputBufferRegistry,
};

/// The P0-4 gate mode for the send-keys family: these are the PROGRAMMATIC injection verbs
/// (automation / agents / scripts), so HOLD unterminated input and emit only complete,
/// approved lines — they do not need interactive char echo.
const SEND_KEYS_SOURCE: &str = "ipc-send-keys";

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkippedTerminalWrite {
    terminal_id: String,
    reason: String,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalWriteBatchResult {
    accepted: u32,
    skipped: Vec<SkippedTerminalWrite>,
}

impl TerminalWriteBatchResult {
    fn new(accepted: u32, skipped: Vec<SkippedTerminalWrite>) -> Self {
        Self { accepted, skipped }
    }
}

#[cfg(test)]
fn waiting_approval_write_skip(
    session_mgr: &InteractiveSessionManager,
    terminal_id: &str,
) -> Result<Option<SkippedTerminalWrite>, String> {
    let session = session_mgr
        .list()?
        .into_iter()
        .find(|session| session.pty_id == terminal_id && session.status == "waiting_approval");
    Ok(session.map(|_| SkippedTerminalWrite {
        terminal_id: terminal_id.to_string(),
        reason: "waiting_approval".to_string(),
    }))
}

#[cfg(test)]
fn reject_targeted_waiting_approval(
    session_mgr: &InteractiveSessionManager,
    terminal_id: &str,
) -> Result<(), String> {
    if waiting_approval_write_skip(session_mgr, terminal_id)?.is_some() {
        return Err(format!(
            "blocked_waiting_approval: terminal {terminal_id} is at an approval gate; use the Decision Inbox or aelyris.approval.resolve"
        ));
    }
    Ok(())
}

/// FR-1 guard for the REST/MCP faces: same typed rejection as the IPC write
/// paths, resolved from the AppHandle so the api layer shares ONE rule.
/// One audit row per pane per approval EPISODE (keyed by the prompt
/// fingerprint), not per attempted write — a retry loop against a gated pane
/// must not flood the audit trail (spec §3.2 throttle).
static WAITING_SKIP_AUDIT_KEYS: std::sync::LazyLock<
    std::sync::Mutex<std::collections::HashMap<String, String>>,
> = std::sync::LazyLock::new(|| std::sync::Mutex::new(std::collections::HashMap::new()));

fn record_waiting_approval_skip(app: &AppHandle, terminal_id: &str, action: &str) {
    let episode_key = app
        .state::<InteractiveSessionManager>()
        .list()
        .ok()
        .and_then(|sessions| sessions.into_iter().find(|s| s.pty_id == terminal_id))
        .and_then(|s| s.approval_prompt)
        .map(|prompt| stable_interactive_prompt_key(&prompt))
        .unwrap_or_default();
    if let Ok(mut seen) = WAITING_SKIP_AUDIT_KEYS.lock() {
        if seen.get(terminal_id).map(String::as_str) == Some(episode_key.as_str()) {
            return;
        }
        seen.insert(terminal_id.to_string(), episode_key);
    }
    record_audit_event(
        app,
        "agent",
        action,
        "warn",
        Some("terminal"),
        Some(terminal_id),
        "Pane input skipped because the terminal is waiting at an approval gate",
        serde_json::json!({
            "reason": "waiting_approval",
            "redacted": true,
        }),
    );
}

/// Send keystrokes to a specific terminal pane. Mirrors `write_terminal`'s
/// snapshot hook so Orchestra agents that drive a pane through this IPC
/// also appear on the time-travel timeline.
#[tauri::command]
pub async fn send_keys(app: AppHandle, terminal_id: String, data: String) -> Result<(), String> {
    validate_keys_payload(&data)?;
    let raw = data.into_bytes();
    let write_order = terminal_write_order_lock(&terminal_id);
    let _write_guard = write_order.lock().await;
    let ack = terminal_write_authorized_async(
        &app,
        &terminal_id,
        &terminal_id,
        &raw,
        SEND_KEYS_SOURCE,
        crate::command_risk::authority::WriteActorKind::Programmatic,
        crate::command_risk::authority::WritePayloadMode::HoldUntilApproved,
        None,
        None,
    )
    .await?;
    if ack.status == crate::command_risk::authority::TerminalWriteAckStatus::Held {
        return Ok(()); // input held pending a complete line (nothing reaches the PTY)
    }
    if ack.contains_enter {
        save_submitted_command_history(&app, &terminal_id, &String::from_utf8_lossy(&raw));
        capture_if_enter(&app, &terminal_id, b"\r");
    }
    record_audit_event(
        &app,
        "terminal",
        "send_keys",
        "info",
        Some("terminal"),
        Some(&terminal_id),
        "Pane input sent",
        serde_json::json!({
            "bytes": ack.bytes_written_per_target,
            "containsEnter": ack.contains_enter,
            "requestId": ack.request_id,
            "redacted": true,
        }),
    );
    Ok(())
}

/// The P0-4 source kind for cockpit Decision Inbox resolution. Distinct from the
/// send-keys / write-terminal sources so its gate accounting never mixes with
/// human typing on the same pane.
const DECISION_APPROVAL_SOURCE: &str = "ipc-decision-approval";
fn approval_resolution_keystroke(approve: bool) -> &'static [u8] {
    if approve {
        b"1"
    } else {
        b"\x1b"
    }
}

pub(crate) fn stable_interactive_prompt_key(value: &str) -> String {
    let mut hash = 2166136261_u32;
    for unit in value.encode_utf16() {
        hash ^= u32::from(unit);
        hash = hash.wrapping_mul(16777619);
    }
    format!("{hash:x}")
}

fn find_interactive_session_by_pty(
    session_mgr: &InteractiveSessionManager,
    terminal_id: &str,
) -> Result<InteractiveSessionInfo, String> {
    session_mgr
        .list()?
        .into_iter()
        .find(|session| session.pty_id == terminal_id)
        .ok_or_else(|| {
            format!("stale_approval: no interactive session owns terminal {terminal_id}")
        })
}

#[cfg(test)]
fn verify_current_interactive_approval(
    session_mgr: &InteractiveSessionManager,
    terminal_id: &str,
    expected_prompt_key: Option<&str>,
) -> Result<(), String> {
    let expected_prompt_key = expected_prompt_key
        .filter(|key| !key.is_empty())
        .ok_or_else(|| "stale_approval: expected prompt fingerprint is required".to_string())?;
    let session = find_interactive_session_by_pty(session_mgr, terminal_id)?;
    if session.status != "waiting_approval" {
        return Err(format!(
            "stale_approval: session {} is not waiting_approval (status={})",
            session.id, session.status
        ));
    }
    let prompt = session.approval_prompt.as_deref().ok_or_else(|| {
        format!(
            "stale_approval: session {} is waiting_approval without an approval prompt",
            session.id
        )
    })?;
    let actual_prompt_key = stable_interactive_prompt_key(prompt);
    if actual_prompt_key != expected_prompt_key {
        return Err(format!(
            "stale_approval: prompt fingerprint changed for session {}",
            session.id
        ));
    }
    Ok(())
}

/// Resolve a waiting interactive agent gate from the cockpit Decision Inbox.
/// This is scoped to Claude's selectable permission menu (the inbox only marks
/// rows with highlighted Yes keystroke-resolvable), so the answer is explicit:
/// `1` selects Yes, Esc rejects. Atomic gate mode is used because the payload is
/// one complete, known keystroke — there is no held/mirrored state a
/// later resolution could inherit. A dedicated audit event records the decision
/// (a bare Esc deny would otherwise leave NO trace, and a bare numeric approve is
/// indistinguishable from a human keypress). This only DELIVERS the human
/// choice; the inbox item clears when the agent re-emits its run status.
#[tauri::command]
pub async fn resolve_interactive_approval(
    app: AppHandle,
    terminal_id: String,
    decision: String,
    expected_prompt_key: Option<String>,
) -> Result<(), String> {
    resolve_interactive_approval_core(app, terminal_id, decision, expected_prompt_key).await
}

pub(crate) async fn resolve_interactive_approval_core(
    app: AppHandle,
    terminal_id: String,
    decision: String,
    expected_prompt_key: Option<String>,
) -> Result<(), String> {
    let approve = match decision.as_str() {
        "approve" => true,
        "deny" => false,
        other => {
            return Err(format!(
                "invalid decision '{other}' (expected approve|deny)"
            ));
        }
    };

    // Menu keystrokes: select option 1 for Yes explicitly; Esc rejects.
    let keystroke: &[u8] = approval_resolution_keystroke(approve);

    // Serialize the gate-check + PTY write per terminal (same contract as the
    // other input verbs) so a concurrent write cannot reorder on the PTY.
    // The stale-approval fingerprint check MUST run while holding this lock:
    // verifying before acquiring it leaves a window where a concurrent write
    // changes the prompt between the check and the keystroke landing.
    let write_order = terminal_write_order_lock(&terminal_id);
    let _write_guard = write_order.lock().await;
    super::commands::sync_terminal_interactive_approval_authority(&app, &terminal_id).await?;
    let approval_session_id =
        find_interactive_session_by_pty(&app.state::<InteractiveSessionManager>(), &terminal_id)?
            .id;

    // Audit the INTENT before the write so a crash mid-delivery still leaves a trace.
    record_audit_event(
        &app,
        "agent",
        "approval_resolved",
        "info",
        Some("terminal"),
        Some(&terminal_id),
        "Interactive approval resolved from Decision Inbox",
        serde_json::json!({
            "decision": if approve { "approve" } else { "deny" },
            "bytes": keystroke.len(),
            "redacted": true,
        }),
    );
    let ack = terminal_write_authorized_async(
        &app,
        &terminal_id,
        &approval_session_id,
        keystroke,
        DECISION_APPROVAL_SOURCE,
        crate::command_risk::authority::WriteActorKind::Human,
        crate::command_risk::authority::WritePayloadMode::Atomic,
        None,
        expected_prompt_key.as_deref(),
    )
    .await?;
    if ack.status == crate::command_risk::authority::TerminalWriteAckStatus::Held {
        return Ok(()); // gate held/neutralized the payload (nothing reaches the PTY)
    }
    if ack.contains_enter {
        capture_if_enter(&app, &terminal_id, b"\r");
    }
    Ok(())
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
pub async fn broadcast_keys(
    app: AppHandle,
    data: String,
) -> Result<TerminalWriteBatchResult, String> {
    validate_keys_payload(&data)?;
    let ids = terminal_ids_async(&app).await;
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
    let mut skipped: Vec<SkippedTerminalWrite> = Vec::new();
    for id in &ids {
        // P0-4: gate each pane's write independently (its own synchronized scope); a denied
        // submission is refused for that pane while benign panes still receive input. The
        // per-terminal lock keeps each pane's gate + write atomic so writes never reorder.
        let write_order = terminal_write_order_lock(id);
        let _write_guard = write_order.lock().await;
        let ack = match terminal_write_authorized_async(
            &app,
            id,
            id,
            data.as_bytes(),
            "ipc-broadcast-keys",
            crate::command_risk::authority::WriteActorKind::Programmatic,
            crate::command_risk::authority::WritePayloadMode::HoldUntilApproved,
            None,
            None,
        )
        .await
        {
            Ok(ack) => ack,
            Err(err) => {
                if err.contains("blocked_waiting_approval") {
                    record_waiting_approval_skip(
                        &app,
                        id,
                        "broadcast_keys_skipped_waiting_approval",
                    );
                    skipped.push(SkippedTerminalWrite {
                        terminal_id: id.clone(),
                        reason: "waiting_approval".to_string(),
                    });
                }
                last_error = Some(err);
                continue;
            }
        };
        if ack.status == crate::command_risk::authority::TerminalWriteAckStatus::Held {
            continue; // held pending a complete line
        }
        count += 1;
        if ack.contains_enter {
            capture_if_enter(&app, id, b"\r");
        }
    }
    record_audit_event(
        &app,
        "terminal",
        if count > 0 {
            "broadcast_keys"
        } else if !skipped.is_empty() {
            "broadcast_keys_skipped_waiting_approval"
        } else {
            "broadcast_keys_failed"
        },
        if count > 0 { "info" } else { "warn" },
        Some("terminal_group"),
        None,
        if count > 0 {
            "Broadcast input sent"
        } else if !skipped.is_empty() {
            "Broadcast input skipped for panes at approval gates"
        } else {
            "Broadcast input failed"
        },
        serde_json::json!({
            "targets": ids.len(),
            "accepted": count,
            "skipped": &skipped,
            "bytes": data.len(),
            "containsEnter": data.as_bytes().contains(&b'\r'),
            "error": last_error.as_deref().map(sanitize_audit_error),
            "redacted": true,
        }),
    );
    if count == 0 && skipped.is_empty() {
        return Err(last_error.unwrap_or_else(|| "No pane accepted input".to_string()));
    }
    Ok(TerminalWriteBatchResult::new(count, skipped))
}

/// Rename a terminal pane (for send-keys-by-name)
#[tauri::command]
pub fn rename_pane(app: AppHandle, terminal_id: String, name: String) -> Result<(), String> {
    rename_pane_core(&app, &terminal_id, &name)
}

pub(crate) fn rename_pane_core(
    app: &AppHandle,
    terminal_id: &str,
    name: &str,
) -> Result<(), String> {
    let registry = app.state::<crate::pty::PaneRegistry>();
    registry.rename(terminal_id, name)?;
    sync_mux_pane_name(app, terminal_id, name);
    persist_pane_metadata(app, terminal_id);
    Ok(())
}

/// Mirror the in-memory pane name/role into SQLite so sidecar sessions that
/// outlive an app restart re-adopt with their identity intact.
fn persist_pane_metadata(app: &AppHandle, terminal_id: &str) {
    let Some(entry) = app.state::<crate::pty::PaneRegistry>().get(terminal_id) else {
        return;
    };
    if let Some(db) = app.try_state::<crate::db::ManagedDb>() {
        if let Err(err) = db.with(|d| d.upsert_pane_metadata(terminal_id, &entry.name, &entry.role))
        {
            log::warn!("pane metadata persistence failed for {terminal_id}: {err}");
        }
    }
}

/// Assign a role to a terminal pane for workstation routing.
#[tauri::command]
pub fn set_pane_role(app: AppHandle, terminal_id: String, role: String) -> Result<(), String> {
    set_pane_role_core(&app, &terminal_id, &role)
}

pub(crate) fn set_pane_role_core(
    app: &AppHandle,
    terminal_id: &str,
    role: &str,
) -> Result<(), String> {
    let registry = app.state::<crate::pty::PaneRegistry>();
    registry.set_role(terminal_id, role)?;
    sync_mux_pane_role(app, terminal_id, role);
    persist_pane_metadata(app, terminal_id);
    Ok(())
}

/// Send keystrokes to a pane by its user-assigned name. Same snapshot
/// hook as `send_keys` so name-addressed writes appear on the timeline.
#[tauri::command]
pub async fn send_keys_by_name(app: AppHandle, name: String, data: String) -> Result<(), String> {
    validate_keys_payload(&data)?;
    let pane_registry = app.state::<crate::pty::PaneRegistry>();
    let terminal_id = pane_registry
        .find_by_name_unique(&name)?
        .ok_or_else(|| format!("No pane named '{}'", name))?;
    // P0-4: gate the named-pane injection BEFORE the PTY; write only the returned bytes. The
    // per-terminal write-order lock keeps the gate + write atomic so writes never reorder.
    let raw = data.into_bytes();
    let write_order = terminal_write_order_lock(&terminal_id);
    let _write_guard = write_order.lock().await;
    let ack = terminal_write_authorized_async(
        &app,
        &terminal_id,
        &terminal_id,
        &raw,
        SEND_KEYS_SOURCE,
        crate::command_risk::authority::WriteActorKind::Programmatic,
        crate::command_risk::authority::WritePayloadMode::HoldUntilApproved,
        None,
        None,
    )
    .await?;
    if ack.status == crate::command_risk::authority::TerminalWriteAckStatus::Held {
        return Ok(()); // held pending a complete line
    }
    if ack.contains_enter {
        capture_if_enter(&app, &terminal_id, b"\r");
    }
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
            "bytes": ack.bytes_written_per_target,
            "containsEnter": ack.contains_enter,
            "requestId": ack.request_id,
            "redacted": true,
        }),
    );
    Ok(())
}

/// Send keystrokes to every pane assigned a role. Role sends are intentionally
/// scoped broadcasts because several panes may share a workstation role.
#[tauri::command]
pub async fn send_keys_by_role(
    app: AppHandle,
    role: String,
    data: String,
) -> Result<TerminalWriteBatchResult, String> {
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
    write_to_terminals(&app, terminal_ids, data.as_bytes()).await
}

/// Send keystrokes to a pane target. Targets prefixed with `@` or `role:`
/// resolve as roles; exact PTY ids resolve directly. Unprefixed labels may
/// resolve by pane name or role, but a name/role collision is rejected so
/// input is not silently sent to the wrong pane.
#[tauri::command]
pub async fn send_keys_by_target(
    app: AppHandle,
    target: String,
    data: String,
) -> Result<TerminalWriteBatchResult, String> {
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
    // Spec §3.2: a target that resolves to exactly ONE pane is a targeted
    // send — it must surface the typed blocked_waiting_approval error, not the
    // fan-out's silent skip+report (same semantics as send_keys_by_name).
    write_to_terminals(&app, terminal_ids, data.as_bytes()).await
}

async fn write_to_terminals(
    app: &AppHandle,
    terminal_ids: Vec<String>,
    data: &[u8],
) -> Result<TerminalWriteBatchResult, String> {
    let mut count: u32 = 0;
    let mut last_error: Option<String> = None;
    let mut skipped: Vec<SkippedTerminalWrite> = Vec::new();
    let target_count = terminal_ids.len();
    for terminal_id in terminal_ids {
        // P0-4: gate each target independently; a denied submission is refused for that pane.
        // The per-terminal lock keeps each target's gate + write atomic so writes never reorder.
        let write_order = terminal_write_order_lock(&terminal_id);
        let _write_guard = write_order.lock().await;
        let ack = match terminal_write_authorized_async(
            app,
            &terminal_id,
            &terminal_id,
            data,
            SEND_KEYS_SOURCE,
            crate::command_risk::authority::WriteActorKind::Programmatic,
            crate::command_risk::authority::WritePayloadMode::HoldUntilApproved,
            None,
            None,
        )
        .await
        {
            Ok(ack) => ack,
            Err(err) => {
                if err.contains("blocked_waiting_approval") {
                    record_waiting_approval_skip(
                        app,
                        &terminal_id,
                        "send_keys_skipped_waiting_approval",
                    );
                    skipped.push(SkippedTerminalWrite {
                        terminal_id: terminal_id.clone(),
                        reason: "waiting_approval".to_string(),
                    });
                }
                last_error = Some(err);
                continue;
            }
        };
        if ack.status == crate::command_risk::authority::TerminalWriteAckStatus::Held {
            continue; // held pending a complete line
        }
        count += 1;
        if ack.contains_enter {
            capture_if_enter(app, &terminal_id, b"\r");
        }
    }
    if count == 0 && skipped.is_empty() {
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
            "skipped": &skipped,
            "bytes": data.len(),
            "containsEnter": data.contains(&b'\r'),
            "redacted": true,
        }),
    );
    Ok(TerminalWriteBatchResult::new(count, skipped))
}

/// List all registered panes with metadata
#[tauri::command]
pub async fn list_panes_info(app: AppHandle) -> Vec<crate::pty::registry::PaneEntry> {
    let registry = app.state::<crate::pty::PaneRegistry>();
    let active_terminal_ids = terminal_ids_async(&app).await;
    registry.list_active(&active_terminal_ids)
}

#[cfg(test)]
mod tests {
    use super::{
        approval_resolution_keystroke, reject_targeted_waiting_approval,
        stable_interactive_prompt_key, verify_current_interactive_approval,
        waiting_approval_write_skip,
    };
    use crate::agent::{
        context_lifecycle::ContextRemaining, AgentCli, InteractiveSessionInfo,
        InteractiveSessionManager,
    };

    fn make_interactive_session(
        id: &str,
        pty_id: &str,
        status: &str,
        approval_prompt: Option<&str>,
    ) -> InteractiveSessionInfo {
        InteractiveSessionInfo {
            id: id.to_string(),
            logical_session_id: id.to_string(),
            pty_id: pty_id.to_string(),
            backend: "sidecar".to_string(),
            cli: AgentCli::Claude,
            status: status.to_string(),
            model: "sonnet".to_string(),
            initial_prompt: None,
            approval_prompt: approval_prompt.map(str::to_string),
            cwd: "/tmp".to_string(),
            worktree_branch: None,
            worktree_path: None,
            repo_path: None,
            cost: 0.0,
            tokens_used: 0,
            started_at: 0,
            last_activity: 0,
            turn_count: 0,
            context_remaining: Some(ContextRemaining::unknown_proxy(&AgentCli::Claude, 0)),
        }
    }

    #[test]
    fn approve_keystroke_explicitly_selects_yes() {
        assert_eq!(approval_resolution_keystroke(true), b"1");
    }

    #[test]
    fn deny_keystroke_rejects_with_escape() {
        assert_eq!(approval_resolution_keystroke(false), b"\x1b");
    }

    #[test]
    fn stable_text_key_matches_decision_inbox_vectors() {
        assert_eq!(
            stable_interactive_prompt_key("Bash(rm -rf dist) · Do you want to proceed?"),
            "ac2f40f5"
        );
        assert_eq!(stable_interactive_prompt_key("承認🔒"), "b8c5e33a");
    }

    #[test]
    fn current_approval_rejects_missing_expected_prompt_key() {
        let mgr = InteractiveSessionManager::new();
        mgr.register(make_interactive_session(
            "s1",
            "pty-1",
            "waiting_approval",
            Some("Bash(npm test) · Do you want to proceed?"),
        ))
        .unwrap();

        let err = verify_current_interactive_approval(&mgr, "pty-1", None).unwrap_err();
        assert!(err.contains("stale_approval"));
        assert!(err.contains("expected prompt fingerprint is required"));
    }

    #[test]
    fn current_approval_rejects_session_no_longer_waiting() {
        let mgr = InteractiveSessionManager::new();
        let prompt = "Bash(npm test) · Do you want to proceed?";
        mgr.register(make_interactive_session(
            "s1",
            "pty-1",
            "idle",
            Some(prompt),
        ))
        .unwrap();

        let err = verify_current_interactive_approval(
            &mgr,
            "pty-1",
            Some(&stable_interactive_prompt_key(prompt)),
        )
        .unwrap_err();
        assert!(err.contains("stale_approval"));
        assert!(err.contains("not waiting_approval"));
    }

    #[test]
    fn current_approval_rejects_prompt_fingerprint_mismatch() {
        let mgr = InteractiveSessionManager::new();
        mgr.register(make_interactive_session(
            "s1",
            "pty-1",
            "waiting_approval",
            Some("Bash(rm -rf dist) · Do you want to proceed?"),
        ))
        .unwrap();

        let err = verify_current_interactive_approval(&mgr, "pty-1", Some("deadbeef")).unwrap_err();
        assert!(err.contains("stale_approval"));
        assert!(err.contains("prompt fingerprint changed"));
    }

    #[test]
    fn current_approval_accepts_matching_prompt_fingerprint() {
        let mgr = InteractiveSessionManager::new();
        let prompt = "Bash(npm test) · Do you want to proceed?";
        mgr.register(make_interactive_session(
            "s1",
            "pty-1",
            "waiting_approval",
            Some(prompt),
        ))
        .unwrap();

        verify_current_interactive_approval(
            &mgr,
            "pty-1",
            Some(&stable_interactive_prompt_key(prompt)),
        )
        .unwrap();
    }

    #[test]
    fn broadcast_guard_skips_waiting_approval_panes_and_reports_reason() {
        let mgr = InteractiveSessionManager::new();
        mgr.register(make_interactive_session(
            "s1",
            "pty-approval",
            "waiting_approval",
            Some("Bash(npm test) · Do you want to proceed?"),
        ))
        .unwrap();

        let skip = waiting_approval_write_skip(&mgr, "pty-approval")
            .unwrap()
            .expect("waiting approval pane should be skipped");
        assert_eq!(skip.terminal_id, "pty-approval");
        assert_eq!(skip.reason, "waiting_approval");
    }

    #[test]
    fn targeted_send_rejects_waiting_approval_panes_with_typed_error() {
        let mgr = InteractiveSessionManager::new();
        mgr.register(make_interactive_session(
            "s1",
            "pty-approval",
            "waiting_approval",
            Some("Bash(npm test) · Do you want to proceed?"),
        ))
        .unwrap();

        let err = reject_targeted_waiting_approval(&mgr, "pty-approval").unwrap_err();
        assert!(err.contains("blocked_waiting_approval"));
        assert!(err.contains("aelyris.approval.resolve"));
    }

    #[test]
    fn waiting_approval_guard_leaves_plain_shell_panes_unaffected() {
        let mgr = InteractiveSessionManager::new();

        assert!(waiting_approval_write_skip(&mgr, "plain-shell")
            .unwrap()
            .is_none());
        reject_targeted_waiting_approval(&mgr, "plain-shell").unwrap();
    }
}
