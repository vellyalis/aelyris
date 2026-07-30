//! IME (Input Method Editor) positioning command handler.
//!
//! `set_ime_position` drives the Win32 IMM API directly to place the IME
//! composition/candidate windows, bypassing WebView2 textarea positioning.
//! Helpers `ime_coord`/`ime_position_result` are unit-tested. Extracted
//! from `commands.rs` during the IPC god-file split.

use std::sync::{mpsc, Arc};
use std::time::Duration;

use tauri::{AppHandle, Manager, State};

use super::commands::commit_native_terminal_input;

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
/// IME preedit during the current migration, but committed text is routed here
/// so every surface retains the shared PTY authority and audit semantics.
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

fn ime_position_result(
    composition_ok: bool,
    candidate_successes: usize,
    release_ok: bool,
) -> Result<(), String> {
    let mut failures = Vec::new();
    if !composition_ok {
        failures.push("ImmSetCompositionWindow failed");
    }
    if candidate_successes == 0 {
        failures.push("ImmSetCandidateWindow failed for every candidate index");
    }
    if !release_ok {
        failures.push("ImmReleaseContext failed");
    }
    if failures.is_empty() {
        Ok(())
    } else {
        Err(failures.join("; "))
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
        use windows::Win32::Foundation::{HWND, POINT};
        use windows::Win32::UI::Input::Ime::*;
        use windows::Win32::UI::WindowsAndMessaging::{
            GetGUIThreadInfo, GetWindowThreadProcessId, IsChild, GUITHREADINFO,
        };

        let window = app.get_webview_window("main").ok_or("No main window")?;

        let hwnd_raw = window.hwnd().map_err(|e| e.to_string())?;
        let hwnd = HWND(hwnd_raw.0 as *mut _);
        // IMM positions are relative to the window that currently owns input
        // focus. WebView2 keeps the real text focus on a child HWND, so using
        // the top-level Tauri window can shift the candidate popup under DPI
        // scaling or custom chrome.
        let ime_hwnd = unsafe {
            let mut gui = GUITHREADINFO {
                cbSize: std::mem::size_of::<GUITHREADINFO>() as u32,
                ..Default::default()
            };
            let ui_thread_id = GetWindowThreadProcessId(hwnd, None);
            if GetGUIThreadInfo(ui_thread_id, &mut gui).is_ok() {
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

        let ime_result = unsafe {
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
            let composition_ok = ImmSetCompositionWindow(himc, &cf).as_bool();

            // Also set candidate window position. The candidate popup is
            // much wider than the caret; the frontend may clamp this point
            // leftward near the terminal's right edge so the OS popup does
            // not spill into the inspector rail.
            let mut candidate_successes = 0usize;
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
                if ImmSetCandidateWindow(himc, &cand).as_bool() {
                    candidate_successes += 1;
                }
            }

            let release_ok = ImmReleaseContext(ime_hwnd, himc).as_bool();
            ime_position_result(composition_ok, candidate_successes, release_ok)
        };
        ime_result?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

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
    fn ime_position_result_reports_win32_failures() {
        assert!(ime_position_result(true, 1, true).is_ok());

        let err = ime_position_result(false, 0, false).expect_err("failures should surface");
        assert!(err.contains("ImmSetCompositionWindow failed"));
        assert!(err.contains("ImmSetCandidateWindow failed"));
        assert!(err.contains("ImmReleaseContext failed"));
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
}
