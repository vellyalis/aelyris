//! Native terminal input control plane.
//!
//! This is the Rust-owned entry point for terminal input commits. The current
//! frontend may still use a WebView composition bridge for IME preedit text,
//! but committed bytes should flow through this host so the next milestone can
//! replace the WebView text bridge with a native composition surface without
//! changing PTY write/audit semantics again.

use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NativeTerminalInputStatus {
    pub platform: &'static str,
    pub active_terminal_id: Option<String>,
    pub direct_pty_commit_count: u64,
    pub webview_composition_bridge_required: bool,
    pub native_composition_surface_ready: bool,
    pub native_surface_active: bool,
    pub native_surface_hwnd: Option<String>,
    pub composition_active: bool,
    pub last_commit_source: Option<String>,
    pub last_commit_bytes: usize,
    pub last_error: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct NativeInputSurfaceRect {
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
}

#[derive(Debug, Clone, Copy)]
struct NativeInputSurfaceHandle {
    hwnd: isize,
    parent_hwnd: isize,
}

#[derive(Debug, Default)]
struct NativeSurfaceRuntime {
    composition_active: bool,
    pending_bytes: Vec<String>,
}

#[derive(Debug, Default)]
struct NativeTerminalInputState {
    active_terminal_id: Option<String>,
    direct_pty_commit_count: u64,
    webview_composition_bridge_required: bool,
    native_composition_surface_ready: bool,
    native_surface: Option<NativeInputSurfaceHandle>,
    native_surface_runtime: Option<Arc<Mutex<NativeSurfaceRuntime>>>,
    last_commit_source: Option<String>,
    last_commit_bytes: usize,
    last_error: Option<String>,
}

#[derive(Debug, Default)]
pub struct NativeTerminalInputHost {
    state: Mutex<NativeTerminalInputState>,
}

impl NativeTerminalInputHost {
    pub fn new() -> Self {
        Self {
            state: Mutex::new(NativeTerminalInputState {
                // Honest default: until a native HWND/TSF surface owns
                // composition, IME preedit still requires the WebView bridge.
                webview_composition_bridge_required: true,
                ..Default::default()
            }),
        }
    }

    pub fn activate_terminal(&self, terminal_id: impl Into<String>) -> NativeTerminalInputStatus {
        let mut state = self.lock_state();
        state.active_terminal_id = Some(terminal_id.into());
        state.last_error = None;
        Self::snapshot(&state)
    }

    pub fn record_commit(
        &self,
        terminal_id: impl Into<String>,
        source: impl Into<String>,
        byte_count: usize,
    ) -> NativeTerminalInputStatus {
        let mut state = self.lock_state();
        state.active_terminal_id = Some(terminal_id.into());
        state.direct_pty_commit_count = state.direct_pty_commit_count.saturating_add(1);
        state.last_commit_source = Some(source.into());
        state.last_commit_bytes = byte_count;
        state.last_error = None;
        Self::snapshot(&state)
    }

    pub fn record_error(&self, terminal_id: impl Into<String>, error: impl Into<String>) {
        let mut state = self.lock_state();
        state.active_terminal_id = Some(terminal_id.into());
        state.last_error = Some(error.into());
    }

    pub fn focus_native_surface(
        &self,
        parent_hwnd: isize,
        terminal_id: impl Into<String>,
        rect: NativeInputSurfaceRect,
    ) -> Result<NativeTerminalInputStatus, String> {
        self.focus_native_surface_impl(parent_hwnd, terminal_id.into(), rect)
    }

    pub fn drain_native_surface_text(&self) -> Result<Option<(String, String)>, String> {
        self.drain_native_surface_text_impl()
    }

    pub fn status(&self) -> NativeTerminalInputStatus {
        let state = self.lock_state();
        Self::snapshot(&state)
    }

    fn lock_state(&self) -> std::sync::MutexGuard<'_, NativeTerminalInputState> {
        self.state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn snapshot(state: &NativeTerminalInputState) -> NativeTerminalInputStatus {
        let composition_active = state
            .native_surface_runtime
            .as_ref()
            .and_then(|runtime| runtime.lock().ok().map(|runtime| runtime.composition_active))
            .unwrap_or(false);
        NativeTerminalInputStatus {
            platform: std::env::consts::OS,
            active_terminal_id: state.active_terminal_id.clone(),
            direct_pty_commit_count: state.direct_pty_commit_count,
            webview_composition_bridge_required: state.webview_composition_bridge_required,
            native_composition_surface_ready: state.native_composition_surface_ready,
            native_surface_active: state.native_surface.is_some(),
            native_surface_hwnd: state.native_surface.map(|surface| format!("0x{:x}", surface.hwnd)),
            composition_active,
            last_commit_source: state.last_commit_source.clone(),
            last_commit_bytes: state.last_commit_bytes,
            last_error: state.last_error.clone(),
        }
    }
}

#[cfg(not(target_os = "windows"))]
impl NativeTerminalInputHost {
    fn focus_native_surface_impl(
        &self,
        _parent_hwnd: isize,
        terminal_id: String,
        _rect: NativeInputSurfaceRect,
    ) -> Result<NativeTerminalInputStatus, String> {
        let mut state = self.lock_state();
        state.active_terminal_id = Some(terminal_id);
        state.last_error = Some("native terminal input surface is Windows-only".to_string());
        Ok(Self::snapshot(&state))
    }

    fn drain_native_surface_text_impl(&self) -> Result<Option<(String, String)>, String> {
        Ok(None)
    }
}

#[cfg(target_os = "windows")]
impl NativeTerminalInputHost {
    fn focus_native_surface_impl(
        &self,
        parent_hwnd: isize,
        terminal_id: String,
        rect: NativeInputSurfaceRect,
    ) -> Result<NativeTerminalInputStatus, String> {
        let rect = NativeInputSurfaceRect {
            x: rect.x.max(0),
            y: rect.y.max(0),
            width: rect.width.max(1),
            height: rect.height.max(1),
        };

        let mut state = self.lock_state();
        let runtime = state
            .native_surface_runtime
            .get_or_insert_with(|| Arc::new(Mutex::new(NativeSurfaceRuntime::default())))
            .clone();
        let surface = match state.native_surface {
            Some(surface) if surface.parent_hwnd == parent_hwnd && unsafe { native_surface_is_alive(surface.hwnd) } => {
                surface
            }
            _ => unsafe { create_native_edit_surface(parent_hwnd, runtime.clone())? },
        };

        unsafe { position_native_edit_surface(surface.hwnd, rect)? };
        state.native_surface = Some(surface);
        state.active_terminal_id = Some(terminal_id);
        state.native_composition_surface_ready = true;
        state.webview_composition_bridge_required = false;
        state.last_error = None;
        Ok(Self::snapshot(&state))
    }

    fn drain_native_surface_text_impl(&self) -> Result<Option<(String, String)>, String> {
        let mut state = self.lock_state();
        let Some(surface) = state.native_surface else {
            return Ok(None);
        };
        let Some(terminal_id) = state.active_terminal_id.clone() else {
            return Ok(None);
        };
        let pending = state
            .native_surface_runtime
            .as_ref()
            .and_then(|runtime| {
                runtime.lock().ok().map(|mut runtime| {
                    let pending = runtime.pending_bytes.join("");
                    runtime.pending_bytes.clear();
                    (runtime.composition_active, pending)
                })
            })
            .unwrap_or((false, String::new()));
        if pending.0 && pending.1.is_empty() {
            return Ok(None);
        }
        let text = unsafe { drain_native_edit_text(surface.hwnd)? };
        let text = format!("{}{}", pending.1, text);
        if text.is_empty() {
            return Ok(None);
        }
        state.last_commit_source = Some("native-edit-surface".to_string());
        state.last_commit_bytes = text.len();
        Ok(Some((terminal_id, text)))
    }
}

#[cfg(target_os = "windows")]
struct NativeInputSurfaceContext {
    runtime: Arc<Mutex<NativeSurfaceRuntime>>,
    original_proc: windows::Win32::UI::WindowsAndMessaging::WNDPROC,
}

#[cfg(target_os = "windows")]
unsafe extern "system" fn native_input_surface_wnd_proc(
    hwnd: windows::Win32::Foundation::HWND,
    msg: u32,
    wparam: windows::Win32::Foundation::WPARAM,
    lparam: windows::Win32::Foundation::LPARAM,
) -> windows::Win32::Foundation::LRESULT {
    use windows::Win32::UI::WindowsAndMessaging::{
        CallWindowProcW, DefWindowProcW, GetWindowLongPtrW, SetWindowLongPtrW, GWLP_USERDATA,
        WM_IME_ENDCOMPOSITION, WM_IME_STARTCOMPOSITION, WM_KEYDOWN, WM_NCDESTROY,
    };

    let ptr = unsafe { GetWindowLongPtrW(hwnd, GWLP_USERDATA) as *mut NativeInputSurfaceContext };
    let original_proc = if ptr.is_null() {
        None
    } else {
        let context = unsafe { &mut *ptr };
        match msg {
            WM_IME_STARTCOMPOSITION => {
                if let Ok(mut runtime) = context.runtime.lock() {
                    runtime.composition_active = true;
                }
            }
            WM_IME_ENDCOMPOSITION => {
                if let Ok(mut runtime) = context.runtime.lock() {
                    runtime.composition_active = false;
                }
            }
            WM_KEYDOWN => {
                if let Some(bytes) = terminal_bytes_for_native_key(wparam.0 as u16) {
                    if let Ok(mut runtime) = context.runtime.lock() {
                        if !runtime.composition_active {
                            runtime.pending_bytes.push(bytes.to_string());
                            return windows::Win32::Foundation::LRESULT(0);
                        }
                    }
                }
            }
            WM_NCDESTROY => {
                if let Ok(mut runtime) = context.runtime.lock() {
                    runtime.composition_active = false;
                }
                let original = context.original_proc;
                unsafe {
                    SetWindowLongPtrW(hwnd, GWLP_USERDATA, 0);
                    drop(Box::from_raw(ptr));
                }
                return if original.is_some() {
                    unsafe { CallWindowProcW(original, hwnd, msg, wparam, lparam) }
                } else {
                    unsafe { DefWindowProcW(hwnd, msg, wparam, lparam) }
                };
            }
            _ => {}
        }
        context.original_proc
    };

    if original_proc.is_some() {
        unsafe { CallWindowProcW(original_proc, hwnd, msg, wparam, lparam) }
    } else {
        unsafe { DefWindowProcW(hwnd, msg, wparam, lparam) }
    }
}

#[cfg(target_os = "windows")]
fn terminal_bytes_for_native_key(key: u16) -> Option<&'static str> {
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        VK_BACK, VK_DELETE, VK_DOWN, VK_END, VK_ESCAPE, VK_HOME, VK_LEFT, VK_RETURN, VK_RIGHT,
        VK_TAB, VK_UP,
    };
    match key {
        key if key == VK_RETURN.0 => Some("\r"),
        key if key == VK_BACK.0 => Some("\x7f"),
        key if key == VK_TAB.0 => Some("\t"),
        key if key == VK_ESCAPE.0 => Some("\x1b"),
        key if key == VK_UP.0 => Some("\x1b[A"),
        key if key == VK_DOWN.0 => Some("\x1b[B"),
        key if key == VK_RIGHT.0 => Some("\x1b[C"),
        key if key == VK_LEFT.0 => Some("\x1b[D"),
        key if key == VK_DELETE.0 => Some("\x1b[3~"),
        key if key == VK_HOME.0 => Some("\x1b[H"),
        key if key == VK_END.0 => Some("\x1b[F"),
        _ => None,
    }
}

#[cfg(target_os = "windows")]
unsafe fn native_surface_is_alive(hwnd: isize) -> bool {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::IsWindow;
    unsafe { IsWindow(Some(HWND(hwnd as *mut _))).as_bool() }
}

#[cfg(target_os = "windows")]
unsafe fn create_native_edit_surface(
    parent_hwnd: isize,
    runtime: Arc<Mutex<NativeSurfaceRuntime>>,
) -> Result<NativeInputSurfaceHandle, String> {
    use windows::core::w;
    use windows::Win32::Foundation::{HINSTANCE, HWND};
    use windows::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows::Win32::UI::WindowsAndMessaging::{
        CreateWindowExW, SetWindowLongPtrW, ES_AUTOHSCROLL, ES_LEFT, GWLP_USERDATA, GWLP_WNDPROC,
        HMENU, WINDOW_EX_STYLE, WINDOW_STYLE, WS_CHILD, WS_CLIPSIBLINGS, WS_VISIBLE,
    };

    let parent = HWND(parent_hwnd as *mut _);
    let instance =
        HINSTANCE(unsafe { GetModuleHandleW(None) }.map_err(|err| format!("GetModuleHandleW failed: {err}"))?.0);
    let style = WINDOW_STYLE(WS_CHILD.0 | WS_VISIBLE.0 | WS_CLIPSIBLINGS.0 | ES_LEFT as u32 | ES_AUTOHSCROLL as u32);
    let hwnd = unsafe {
        CreateWindowExW(
            WINDOW_EX_STYLE(0),
            w!("EDIT"),
            w!(""),
            style,
            0,
            0,
            1,
            1,
            Some(parent),
            Some(HMENU(std::ptr::null_mut())),
            Some(instance),
            None,
        )
    }
    .map_err(|err| format!("CreateWindowExW EDIT failed: {err}"))?;

    let context = Box::new(NativeInputSurfaceContext {
        runtime,
        original_proc: None,
    });
    let context_ptr = Box::into_raw(context);
    unsafe {
        SetWindowLongPtrW(hwnd, GWLP_USERDATA, context_ptr as isize);
        let original = SetWindowLongPtrW(
            hwnd,
            GWLP_WNDPROC,
            native_input_surface_wnd_proc as *const () as isize,
        );
        (*context_ptr).original_proc = if original == 0 {
            None
        } else {
            std::mem::transmute(original)
        };
    }

    Ok(NativeInputSurfaceHandle {
        hwnd: hwnd.0 as isize,
        parent_hwnd,
    })
}

#[cfg(target_os = "windows")]
unsafe fn position_native_edit_surface(hwnd: isize, rect: NativeInputSurfaceRect) -> Result<(), String> {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::Input::KeyboardAndMouse::SetFocus;
    use windows::Win32::UI::WindowsAndMessaging::{SetWindowPos, ShowWindow, SW_SHOW, SWP_NOZORDER};

    let hwnd = HWND(hwnd as *mut _);
    unsafe {
        SetWindowPos(hwnd, None, rect.x, rect.y, rect.width, rect.height, SWP_NOZORDER)
            .map_err(|err| format!("SetWindowPos native input surface failed: {err}"))?;
        let _ = ShowWindow(hwnd, SW_SHOW);
        SetFocus(Some(hwnd)).map_err(|err| format!("SetFocus native input surface failed: {err}"))?;
    }
    Ok(())
}

#[cfg(target_os = "windows")]
unsafe fn drain_native_edit_text(hwnd: isize) -> Result<String, String> {
    use windows::core::w;
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::{GetWindowTextW, SetWindowTextW};

    let hwnd = HWND(hwnd as *mut _);
    let mut buf = vec![0u16; 4096];
    let len = unsafe { GetWindowTextW(hwnd, &mut buf) };
    if len <= 0 {
        return Ok(String::new());
    }
    let text = String::from_utf16_lossy(&buf[..len as usize]);
    unsafe { SetWindowTextW(hwnd, w!("")).map_err(|err| format!("SetWindowTextW native input clear failed: {err}"))? };
    Ok(text)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_status_is_honest_about_remaining_webview_bridge() {
        let host = NativeTerminalInputHost::new();
        let status = host.status();
        assert!(status.webview_composition_bridge_required);
        assert!(!status.native_composition_surface_ready);
        assert_eq!(status.direct_pty_commit_count, 0);
    }

    #[test]
    fn record_commit_updates_active_terminal_and_count() {
        let host = NativeTerminalInputHost::new();
        host.activate_terminal("term-a");
        let status = host.record_commit("term-b", "ime-commit", 6);
        assert_eq!(status.active_terminal_id.as_deref(), Some("term-b"));
        assert_eq!(status.direct_pty_commit_count, 1);
        assert_eq!(status.last_commit_source.as_deref(), Some("ime-commit"));
        assert_eq!(status.last_commit_bytes, 6);
        assert!(status.last_error.is_none());
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn native_surface_keydown_maps_terminal_control_bytes() {
        use windows::Win32::UI::Input::KeyboardAndMouse::{VK_BACK, VK_DELETE, VK_LEFT, VK_RETURN};

        assert_eq!(terminal_bytes_for_native_key(VK_RETURN.0), Some("\r"));
        assert_eq!(terminal_bytes_for_native_key(VK_BACK.0), Some("\x7f"));
        assert_eq!(terminal_bytes_for_native_key(VK_LEFT.0), Some("\x1b[D"));
        assert_eq!(terminal_bytes_for_native_key(VK_DELETE.0), Some("\x1b[3~"));
        assert_eq!(terminal_bytes_for_native_key(u16::from(b'A')), None);
    }
}
