//! IME (Input Method Editor) positioning command handler.
//!
//! `set_ime_position` drives the Win32 IMM API directly to place the IME
//! composition/candidate windows, bypassing WebView2 textarea positioning.
//! Helpers `ime_coord`/`ime_position_result` are unit-tested. Extracted
//! from `commands.rs` during the IPC god-file split.

use tauri::{AppHandle, Manager};

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
}
