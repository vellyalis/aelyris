//! Send-keys and pane-control IPC commands, extracted from `commands.rs`.
//! Pure module move — no behavior change. Shared helpers remain in `commands`.
use tauri::{AppHandle, Manager};

use super::commands::{
    capture_if_enter, record_audit_event, sanitize_audit_error, save_submitted_command_history,
    sync_mux_pane_name, sync_mux_pane_role, terminal_ids_async, terminal_write_async,
    validate_keys_payload, OutputBufferRegistry,
};

/// Send keystrokes to a specific terminal pane. Mirrors `write_terminal`'s
/// snapshot hook so Orchestra agents that drive a pane through this IPC
/// also appear on the time-travel timeline.
#[tauri::command]
pub async fn send_keys(app: AppHandle, terminal_id: String, data: String) -> Result<(), String> {
    validate_keys_payload(&data)?;
    save_submitted_command_history(&app, &terminal_id, &data);
    let bytes = data.as_bytes();
    match terminal_write_async(&app, &terminal_id, bytes).await {
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
pub async fn broadcast_keys(app: AppHandle, data: String) -> Result<u32, String> {
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
    for id in &ids {
        match terminal_write_async(&app, id, data.as_bytes()).await {
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
    registry.rename(&terminal_id, &name)?;
    sync_mux_pane_name(&app, &terminal_id, &name);
    persist_pane_metadata(&app, &terminal_id);
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
    let registry = app.state::<crate::pty::PaneRegistry>();
    registry.set_role(&terminal_id, &role)?;
    sync_mux_pane_role(&app, &terminal_id, &role);
    persist_pane_metadata(&app, &terminal_id);
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
    let bytes = data.as_bytes();
    match terminal_write_async(&app, &terminal_id, bytes).await {
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
pub async fn send_keys_by_role(app: AppHandle, role: String, data: String) -> Result<u32, String> {
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
) -> Result<u32, String> {
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
    write_to_terminals(&app, terminal_ids, data.as_bytes()).await
}

async fn write_to_terminals(
    app: &AppHandle,
    terminal_ids: Vec<String>,
    data: &[u8],
) -> Result<u32, String> {
    let mut count: u32 = 0;
    let mut last_error: Option<String> = None;
    let target_count = terminal_ids.len();
    for terminal_id in terminal_ids {
        match terminal_write_async(app, &terminal_id, data).await {
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
pub async fn list_panes_info(app: AppHandle) -> Vec<crate::pty::registry::PaneEntry> {
    let registry = app.state::<crate::pty::PaneRegistry>();
    let active_terminal_ids = terminal_ids_async(&app).await;
    registry.list_active(&active_terminal_ids)
}
