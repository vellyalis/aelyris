//! Mux (multiplexer) pane IPC commands, extracted from `commands.rs`.
//! Pure module move — no behavior change. Shared helpers remain in `commands`.
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager};

use crate::pty::{PtyError, PtyManager, ShellType};
use crate::snapshot::SnapshotStore;
use crate::term::NativeTerminalRegistry;

use super::commands::{
    normalize_cwd, parse_mux_axis, record_audit_event, terminal_audit_metadata, validate_path,
    wire_sidecar_terminal_streaming, wire_terminal_streaming, OutputBufferRegistry,
    SidecarWireOptions, TerminalGenerationRegistry,
};

#[tauri::command]
// Parameter list mirrors the frontend IPC payload; bundling into a struct
// would change the invoke contract for no behavioral gain.
#[allow(clippy::too_many_arguments)]
pub async fn mux_split_pane(
    app: AppHandle,
    workspace_id: String,
    target_pane_id: String,
    axis: String,
    shell: ShellType,
    cols: u16,
    rows: u16,
    cwd: Option<String>,
    title: Option<String>,
) -> Result<String, String> {
    if cols == 0 || rows == 0 {
        return Err("cols and rows must be > 0".to_string());
    }
    let split_axis = parse_mux_axis(&axis)?;
    let cwd = match normalize_cwd(cwd) {
        Ok(cwd) => cwd,
        Err(err) => return Err(err),
    };
    if let Some(ref dir) = cwd {
        validate_path(dir)?;
    }

    if let Some(sidecar) = app
        .try_state::<crate::pty_sidecar::PtySidecarState>()
        .and_then(|state| state.client())
    {
        let pane_id = sidecar
            .mux_split_pane(
                &workspace_id,
                &target_pane_id,
                &axis,
                &shell,
                cols,
                rows,
                cwd.as_deref(),
                title.as_deref(),
            )
            .await?;
        let shell_name = format!("{:?}", shell).to_lowercase();
        let cwd_for_graph = cwd.as_deref().unwrap_or(".");
        app.state::<crate::pty::PaneRegistry>()
            .register(&pane_id, &shell_name, cwd_for_graph);
        if let Err(err) = wire_sidecar_terminal_streaming(
            &app,
            sidecar.clone(),
            &pane_id,
            SidecarWireOptions {
                cols,
                rows,
                cwd: cwd.as_deref(),
                shell_name: &shell_name,
                backfill_scrollback: false,
            },
        )
        .await
        {
            cleanup_terminal_ui_registries(&app, &pane_id);
            let _ = sidecar.mux_close_pane(&workspace_id, &pane_id).await;
            return Err(err);
        }
        record_audit_event(
            &app,
            "terminal",
            "mux_split",
            "info",
            Some("terminal"),
            Some(&pane_id),
            "Mux pane split",
            terminal_audit_metadata(&shell, cols, rows, cwd.as_deref()),
        );
        return Ok(pane_id);
    }

    let pane_id = uuid::Uuid::new_v4().to_string();
    let pty_manager = app.state::<PtyManager>().inner().clone();
    let spawn_shell = shell.clone();
    let spawn_cwd = cwd.clone();
    let spawn_id = pane_id.clone();
    tauri::async_runtime::spawn_blocking(move || {
        pty_manager.spawn_with_id(&spawn_id, &spawn_shell, cols, rows, spawn_cwd.as_deref())
    })
    .await
    .map_err(|err| format!("Mux split spawn task failed: {err}"))?
    .map_err(|err| format!("Mux split spawn failed: {err}"))?;

    let shell_name = format!("{:?}", shell).to_lowercase();
    let cwd_for_graph = cwd.as_deref().unwrap_or(".");
    let pane_title = title
        .as_deref()
        .map(str::trim)
        .filter(|title| !title.is_empty())
        .unwrap_or(&shell_name);
    let mut pane =
        crate::mux::graph::PaneRecord::new(&pane_id, pane_title, &shell_name, cwd_for_graph);
    pane.lifecycle = crate::mux::graph::LifecycleState::Active;
    pane.pty = Some(crate::mux::graph::PtyBinding {
        terminal_id: pane_id.clone(),
        process_id: None,
        cols,
        rows,
    });

    let split_result = app
        .state::<Arc<Mutex<crate::mux::manager::MuxManager>>>()
        .inner()
        .lock()
        .map_err(|_| "MuxManager lock poisoned".to_string())
        .and_then(|mut mux| {
            mux.split_active_pane(&workspace_id, &target_pane_id, pane, split_axis)
                .map_err(|err| err.to_string())
        });
    if let Err(err) = split_result {
        let _ = app.state::<PtyManager>().close(&pane_id);
        return Err(err);
    }

    app.state::<crate::pty::PaneRegistry>()
        .register(&pane_id, &shell_name, cwd_for_graph);
    if let Err(err) =
        wire_terminal_streaming(&app, &pane_id, cols, rows, cwd.as_deref(), &shell_name)
    {
        let _ = app.state::<PtyManager>().close(&pane_id);
        if let Ok(mut mux) = app
            .state::<Arc<Mutex<crate::mux::manager::MuxManager>>>()
            .inner()
            .lock()
        {
            let _ = mux.close_active_pane(&workspace_id, &pane_id);
        }
        app.state::<crate::pty::PaneRegistry>().remove(&pane_id);
        return Err(err);
    }

    record_audit_event(
        &app,
        "terminal",
        "mux_split",
        "info",
        Some("terminal"),
        Some(&pane_id),
        "Mux pane split",
        terminal_audit_metadata(&shell, cols, rows, cwd.as_deref()),
    );
    Ok(pane_id)
}

fn cleanup_terminal_ui_registries(app: &AppHandle, terminal_id: &str) {
    app.state::<TerminalGenerationRegistry>()
        .next_generation(terminal_id);
    app.state::<TerminalGenerationRegistry>()
        .remove(terminal_id);
    app.state::<OutputBufferRegistry>().remove(terminal_id);
    app.state::<crate::pty::PaneRegistry>().remove(terminal_id);
    if let Some(db) = app.try_state::<crate::db::ManagedDb>() {
        let _ = db.with(|d| d.delete_pane_metadata(terminal_id));
    }
    app.state::<Arc<NativeTerminalRegistry>>()
        .remove(terminal_id);
    if let Some(store) = app.try_state::<Arc<SnapshotStore>>() {
        store.inner().remove_session(terminal_id);
    }
}

#[tauri::command]
pub async fn mux_close_pane(
    app: AppHandle,
    workspace_id: String,
    pane_id: String,
) -> Result<(), String> {
    if let Some(sidecar) = app
        .try_state::<crate::pty_sidecar::PtySidecarState>()
        .and_then(|state| state.client())
    {
        sidecar.mux_close_pane(&workspace_id, &pane_id).await?;
        cleanup_terminal_ui_registries(&app, &pane_id);
    } else {
        let removed = app
            .state::<Arc<Mutex<crate::mux::manager::MuxManager>>>()
            .inner()
            .lock()
            .map_err(|_| "MuxManager lock poisoned".to_string())
            .and_then(|mut mux| {
                mux.close_active_pane(&workspace_id, &pane_id)
                    .map_err(|err| err.to_string())
            })?;
        if let Some(pty) = removed.pty {
            let pty_id = pty.terminal_id;
            app.state::<TerminalGenerationRegistry>()
                .next_generation(&pty_id);
            let pty_manager = app.state::<PtyManager>().inner().clone();
            let close_id = pty_id.clone();
            let close_result =
                tauri::async_runtime::spawn_blocking(move || pty_manager.close(&close_id))
                    .await
                    .map_err(|err| format!("Mux pane close task failed: {err}"))?;
            match close_result {
                Ok(()) | Err(PtyError::NotFound(_)) => {}
                Err(err) => return Err(err.to_string()),
            }
            cleanup_terminal_ui_registries(&app, &pty_id);
        }
    }

    record_audit_event(
        &app,
        "terminal",
        "mux_close_pane",
        "info",
        Some("terminal"),
        Some(&pane_id),
        "Mux pane closed",
        serde_json::json!({ "workspaceId": workspace_id, "redacted": true }),
    );
    Ok(())
}

#[tauri::command]
pub async fn mux_get_workspace(
    app: AppHandle,
    workspace_id: String,
) -> Result<Option<crate::mux::graph::MuxGraph>, String> {
    if let Some(sidecar) = app
        .try_state::<crate::pty_sidecar::PtySidecarState>()
        .and_then(|state| state.client())
    {
        return sidecar.mux_get_workspace(&workspace_id).await;
    }
    let graph = app
        .state::<Arc<Mutex<crate::mux::manager::MuxManager>>>()
        .inner()
        .lock()
        .map_err(|_| "MuxManager lock poisoned".to_string())?
        .graph(&workspace_id)
        .cloned();
    Ok(graph)
}

#[tauri::command]
pub async fn mux_swap_panes(
    app: AppHandle,
    workspace_id: String,
    first_pane_id: String,
    second_pane_id: String,
) -> Result<(), String> {
    if first_pane_id == second_pane_id {
        return Ok(());
    }
    if let Some(sidecar) = app
        .try_state::<crate::pty_sidecar::PtySidecarState>()
        .and_then(|state| state.client())
    {
        sidecar
            .mux_swap_panes(&workspace_id, &first_pane_id, &second_pane_id)
            .await?;
    } else {
        app.state::<Arc<Mutex<crate::mux::manager::MuxManager>>>()
            .inner()
            .lock()
            .map_err(|_| "MuxManager lock poisoned".to_string())
            .and_then(|mut mux| {
                mux.swap_active_panes(&workspace_id, &first_pane_id, &second_pane_id)
                    .map_err(|err| err.to_string())
            })?;
    }
    record_audit_event(
        &app,
        "terminal",
        "mux_swap_panes",
        "info",
        Some("terminal"),
        Some(&workspace_id),
        "Mux panes swapped",
        serde_json::json!({ "redacted": true }),
    );
    Ok(())
}

#[tauri::command]
pub async fn mux_break_pane(
    app: AppHandle,
    workspace_id: String,
    pane_id: String,
) -> Result<(), String> {
    if let Some(sidecar) = app
        .try_state::<crate::pty_sidecar::PtySidecarState>()
        .and_then(|state| state.client())
    {
        sidecar.mux_break_pane(&workspace_id, &pane_id).await?;
    } else {
        app.state::<Arc<Mutex<crate::mux::manager::MuxManager>>>()
            .inner()
            .lock()
            .map_err(|_| "MuxManager lock poisoned".to_string())
            .and_then(|mut mux| {
                mux.break_active_pane_to_new_tab(&workspace_id, &pane_id)
                    .map(|_| ())
                    .map_err(|err| err.to_string())
            })?;
    }
    record_audit_event(
        &app,
        "terminal",
        "mux_break_pane",
        "info",
        Some("terminal"),
        Some(&pane_id),
        "Mux pane broken into a new tab",
        serde_json::json!({ "workspaceId": workspace_id, "redacted": true }),
    );
    Ok(())
}

#[tauri::command]
pub async fn mux_join_pane(
    app: AppHandle,
    workspace_id: String,
    source_pane_id: String,
    target_pane_id: String,
    axis: String,
) -> Result<(), String> {
    let axis_enum = match axis.as_str() {
        "horizontal" => crate::mux::layout::SplitAxis::Horizontal,
        "vertical" => crate::mux::layout::SplitAxis::Vertical,
        other => return Err(format!("unknown mux join axis: {other}")),
    };
    if let Some(sidecar) = app
        .try_state::<crate::pty_sidecar::PtySidecarState>()
        .and_then(|state| state.client())
    {
        sidecar
            .mux_join_pane(&workspace_id, &source_pane_id, &target_pane_id, &axis)
            .await?;
    } else {
        app.state::<Arc<Mutex<crate::mux::manager::MuxManager>>>()
            .inner()
            .lock()
            .map_err(|_| "MuxManager lock poisoned".to_string())
            .and_then(|mut mux| {
                mux.join_pane_into_active_tab(
                    &workspace_id,
                    &source_pane_id,
                    &target_pane_id,
                    axis_enum,
                )
                .map_err(|err| err.to_string())
            })?;
    }
    record_audit_event(
        &app,
        "terminal",
        "mux_join_pane",
        "info",
        Some("terminal"),
        Some(&workspace_id),
        "Mux pane joined into the active tab",
        serde_json::json!({ "sourcePaneId": source_pane_id, "targetPaneId": target_pane_id, "redacted": true }),
    );
    Ok(())
}

#[tauri::command]
pub async fn mux_set_panes_synchronized(
    app: AppHandle,
    workspace_id: String,
    enabled: bool,
) -> Result<(), String> {
    if let Some(sidecar) = app
        .try_state::<crate::pty_sidecar::PtySidecarState>()
        .and_then(|state| state.client())
    {
        sidecar
            .mux_set_panes_synchronized(&workspace_id, enabled)
            .await?;
    } else {
        app.state::<Arc<Mutex<crate::mux::manager::MuxManager>>>()
            .inner()
            .lock()
            .map_err(|_| "MuxManager lock poisoned".to_string())
            .and_then(|mut mux| {
                mux.set_active_tab_synchronized_panes(&workspace_id, enabled)
                    .map_err(|err| err.to_string())
            })?;
    }
    record_audit_event(
        &app,
        "terminal",
        if enabled {
            "mux_synchronize_panes_on"
        } else {
            "mux_synchronize_panes_off"
        },
        "info",
        Some("terminal"),
        Some(&workspace_id),
        if enabled {
            "Mux synchronized panes enabled"
        } else {
            "Mux synchronized panes disabled"
        },
        serde_json::json!({ "enabled": enabled, "redacted": true }),
    );
    Ok(())
}

#[tauri::command]
pub async fn mux_apply_layout(
    app: AppHandle,
    workspace_id: String,
    command: String,
) -> Result<(), String> {
    let even_axis = match command.as_str() {
        "equalize" | "tiled" | "rotate-next" | "rotate-previous" => None,
        "even-horizontal" => Some((
            "even",
            "horizontal",
            crate::mux::layout::SplitAxis::Horizontal,
        )),
        "even-vertical" => Some(("even", "vertical", crate::mux::layout::SplitAxis::Vertical)),
        other => return Err(format!("unknown mux layout command: {other}")),
    };

    if let Some(sidecar) = app
        .try_state::<crate::pty_sidecar::PtySidecarState>()
        .and_then(|state| state.client())
    {
        match command.as_str() {
            "equalize" => {
                sidecar
                    .mux_apply_layout(&workspace_id, "equalize", None)
                    .await?
            }
            "tiled" => {
                sidecar
                    .mux_apply_layout(&workspace_id, "tiled", None)
                    .await?
            }
            "rotate-next" | "rotate-previous" => {
                sidecar
                    .mux_apply_layout(&workspace_id, &command, None)
                    .await?
            }
            _ => {
                let (_, axis, _) = even_axis.expect("even axis checked above");
                sidecar
                    .mux_apply_layout(&workspace_id, "even", Some(axis))
                    .await?;
            }
        }
    } else {
        app.state::<Arc<Mutex<crate::mux::manager::MuxManager>>>()
            .inner()
            .lock()
            .map_err(|_| "MuxManager lock poisoned".to_string())
            .and_then(|mut mux| match command.as_str() {
                "equalize" => mux
                    .equalize_active_tab(&workspace_id)
                    .map_err(|err| err.to_string()),
                "tiled" => mux
                    .apply_tiled_to_active_tab(&workspace_id)
                    .map_err(|err| err.to_string()),
                "rotate-next" => mux
                    .rotate_active_tab(&workspace_id, false)
                    .map_err(|err| err.to_string()),
                "rotate-previous" => mux
                    .rotate_active_tab(&workspace_id, true)
                    .map_err(|err| err.to_string()),
                _ => {
                    let (_, _, axis) = even_axis.expect("even axis checked above");
                    mux.apply_even_to_active_tab(&workspace_id, axis)
                        .map_err(|err| err.to_string())
                }
            })?;
    }
    record_audit_event(
        &app,
        "terminal",
        "mux_apply_layout",
        "info",
        Some("terminal"),
        Some(&workspace_id),
        "Mux layout applied",
        serde_json::json!({ "layoutCommand": command, "redacted": true }),
    );
    Ok(())
}

#[tauri::command]
pub async fn mux_set_pane_zoom(
    app: AppHandle,
    workspace_id: String,
    pane_id: String,
    zoomed: bool,
) -> Result<(), String> {
    if let Some(sidecar) = app
        .try_state::<crate::pty_sidecar::PtySidecarState>()
        .and_then(|state| state.client())
    {
        sidecar
            .mux_set_pane_zoom(&workspace_id, &pane_id, zoomed)
            .await?;
    } else {
        app.state::<Arc<Mutex<crate::mux::manager::MuxManager>>>()
            .inner()
            .lock()
            .map_err(|_| "MuxManager lock poisoned".to_string())
            .and_then(|mut mux| {
                let target = if zoomed { Some(pane_id.clone()) } else { None };
                mux.set_active_tab_zoom(&workspace_id, target)
                    .map_err(|err| err.to_string())
            })?;
    }
    record_audit_event(
        &app,
        "terminal",
        if zoomed {
            "mux_zoom_pane"
        } else {
            "mux_unzoom_pane"
        },
        "info",
        Some("terminal"),
        Some(&pane_id),
        if zoomed {
            "Mux pane zoomed"
        } else {
            "Mux pane restored"
        },
        serde_json::json!({ "workspaceId": workspace_id, "zoomed": zoomed, "redacted": true }),
    );
    Ok(())
}
