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
    pub native_paste_guard_event_count: u64,
    pub native_paste_guard_last_action: Option<String>,
    pub native_paste_guard_last_reason: Option<String>,
    pub native_paste_guard_last_line_endings: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NativeTerminalPreedit {
    pub terminal_id: Option<String>,
    pub active: bool,
    pub text: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct NativeInputSurfaceRect {
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
    pub caret_inset: i32,
}

#[derive(Debug, Clone, Copy)]
struct NativeInputSurfaceHandle {
    hwnd: isize,
    parent_hwnd: isize,
}

#[derive(Debug, Default)]
struct NativeSurfaceRuntime {
    active_terminal_id: Option<String>,
    composition_active: bool,
    composition_text: String,
    pending_bytes: Vec<(String, String)>,
    paste_guard_event_count: u64,
    last_paste_guard_action: Option<String>,
    last_paste_guard_reason: Option<String>,
    last_paste_guard_line_endings: usize,
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

    pub fn stage_native_clipboard_paste(
        &self,
        terminal_id: impl Into<String>,
    ) -> Result<Option<(String, String)>, String> {
        self.stage_native_clipboard_paste_impl(terminal_id.into())
    }

    pub fn status(&self) -> NativeTerminalInputStatus {
        let state = self.lock_state();
        Self::snapshot(&state)
    }

    pub fn preedit(&self) -> NativeTerminalPreedit {
        let state = self.lock_state();
        let (active, text) = state
            .native_surface_runtime
            .as_ref()
            .and_then(|runtime| {
                runtime
                    .lock()
                    .ok()
                    .map(|runtime| (runtime.composition_active, runtime.composition_text.clone()))
            })
            .unwrap_or((false, String::new()));
        NativeTerminalPreedit {
            terminal_id: state.active_terminal_id.clone(),
            active,
            text,
        }
    }

    fn lock_state(&self) -> std::sync::MutexGuard<'_, NativeTerminalInputState> {
        self.state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn snapshot(state: &NativeTerminalInputState) -> NativeTerminalInputStatus {
        let runtime_snapshot = state
            .native_surface_runtime
            .as_ref()
            .and_then(|runtime| {
                runtime.lock().ok().map(|runtime| {
                    (
                        runtime.composition_active,
                        runtime.paste_guard_event_count,
                        runtime.last_paste_guard_action.clone(),
                        runtime.last_paste_guard_reason.clone(),
                        runtime.last_paste_guard_line_endings,
                    )
                })
            })
            .unwrap_or((false, 0, None, None, 0));
        NativeTerminalInputStatus {
            platform: std::env::consts::OS,
            active_terminal_id: state.active_terminal_id.clone(),
            direct_pty_commit_count: state.direct_pty_commit_count,
            webview_composition_bridge_required: state.webview_composition_bridge_required,
            native_composition_surface_ready: state.native_composition_surface_ready,
            native_surface_active: state.native_surface.is_some(),
            native_surface_hwnd: state
                .native_surface
                .map(|surface| format!("0x{:x}", surface.hwnd)),
            composition_active: runtime_snapshot.0,
            last_commit_source: state.last_commit_source.clone(),
            last_commit_bytes: state.last_commit_bytes,
            last_error: state.last_error.clone(),
            native_paste_guard_event_count: runtime_snapshot.1,
            native_paste_guard_last_action: runtime_snapshot.2,
            native_paste_guard_last_reason: runtime_snapshot.3,
            native_paste_guard_last_line_endings: runtime_snapshot.4,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct NativePasteGuard {
    action: &'static str,
    reason: &'static str,
    normalized_text: String,
    line_ending_count: usize,
}

fn normalize_native_terminal_paste_input(text: &str) -> String {
    text.replace("\r\n", "\r").replace(['\n', '\r'], "\r")
}

fn count_native_paste_line_endings(text: &str) -> usize {
    let mut count = 0usize;
    let mut chars = text.chars().peekable();
    while let Some(ch) = chars.next() {
        match ch {
            '\r' => {
                count += 1;
                if chars.peek() == Some(&'\n') {
                    let _ = chars.next();
                }
            }
            '\n' => count += 1,
            _ => {}
        }
    }
    count
}

/// Whether a clipboard paste contains a CATASTROPHIC (`deny`) command. Single source of
/// truth: defer to the shared `command_risk` classifier — the SAME policy the P0-4
/// `CommandRiskGate` enforces authoritatively at the commit path — instead of a divergent
/// substring list. This early native-surface check blocks only catastrophic pastes; a
/// `review`-level paste falls through to the multi-line confirmation and the authoritative
/// gate (local "Balanced" policy), so the early guard and the gate never diverge.
fn native_paste_contains_destructive_command(text: &str) -> bool {
    matches!(
        crate::command_risk::classify_command(
            text,
            &crate::command_risk::CommandRiskOptions::default()
        )
        .severity,
        crate::command_risk::CommandRiskSeverity::Deny
    )
}

fn classify_native_terminal_paste_input(text: &str) -> NativePasteGuard {
    let normalized_text = normalize_native_terminal_paste_input(text);
    let line_ending_count = count_native_paste_line_endings(text);
    if text.trim().is_empty() {
        return NativePasteGuard {
            action: "ignored",
            reason: "empty clipboard text",
            normalized_text,
            line_ending_count,
        };
    }
    if native_paste_contains_destructive_command(text) {
        return NativePasteGuard {
            action: "blocked",
            reason: "destructive command paste blocked by native input guard",
            normalized_text: String::new(),
            line_ending_count,
        };
    }
    if line_ending_count > 1 {
        return NativePasteGuard {
            action: "blocked",
            reason: "multi-line paste requires explicit UI confirmation",
            normalized_text: String::new(),
            line_ending_count,
        };
    }
    NativePasteGuard {
        action: "allowed",
        reason: "single-line paste normalized by native input guard",
        normalized_text,
        line_ending_count,
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

    fn stage_native_clipboard_paste_impl(
        &self,
        terminal_id: String,
    ) -> Result<Option<(String, String)>, String> {
        let mut state = self.lock_state();
        state.active_terminal_id = Some(terminal_id);
        state.last_error = Some("native clipboard paste is Windows-only".to_string());
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
        let rect = sanitize_native_input_rect(rect);

        let mut state = self.lock_state();
        let runtime = state
            .native_surface_runtime
            .get_or_insert_with(|| Arc::new(Mutex::new(NativeSurfaceRuntime::default())))
            .clone();
        // Route the runtime to the new terminal before the surface can receive
        // any window message; pending bytes pushed without an active terminal
        // id would otherwise be dropped silently.
        if let Ok(mut runtime) = runtime.lock() {
            runtime.active_terminal_id = Some(terminal_id.clone());
        }
        let surface = match state.native_surface {
            Some(surface)
                if surface.parent_hwnd == parent_hwnd
                    && unsafe { native_surface_is_alive(surface.hwnd) } =>
            {
                surface
            }
            _ => unsafe { create_native_input_surface(parent_hwnd, runtime.clone())? },
        };

        unsafe { position_native_input_surface(surface.hwnd, rect)? };
        state.native_surface = Some(surface);
        state.active_terminal_id = Some(terminal_id);
        state.native_composition_surface_ready = true;
        state.webview_composition_bridge_required = false;
        state.last_error = None;
        Ok(Self::snapshot(&state))
    }

    fn drain_native_surface_text_impl(&self) -> Result<Option<(String, String)>, String> {
        let state = self.lock_state();
        let Some(surface) = state.native_surface else {
            return Ok(None);
        };
        let pending = state
            .native_surface_runtime
            .as_ref()
            .and_then(|runtime| {
                runtime.lock().ok().map(|mut runtime| {
                    let pending_terminal_id = runtime
                        .pending_bytes
                        .first()
                        .map(|(terminal_id, _)| terminal_id.clone())
                        .or_else(|| runtime.active_terminal_id.clone());
                    let mut pending = String::new();
                    if let Some(target_terminal_id) = pending_terminal_id.as_ref() {
                        let mut retained = Vec::new();
                        for (terminal_id, bytes) in runtime.pending_bytes.drain(..) {
                            if &terminal_id == target_terminal_id {
                                pending.push_str(&bytes);
                            } else {
                                retained.push((terminal_id, bytes));
                            }
                        }
                        runtime.pending_bytes = retained;
                    }
                    (runtime.composition_active, pending_terminal_id, pending)
                })
            })
            .unwrap_or((false, state.active_terminal_id.clone(), String::new()));
        let Some(terminal_id) = pending.1.or_else(|| state.active_terminal_id.clone()) else {
            return Ok(None);
        };
        if pending.0 && pending.2.is_empty() {
            return Ok(None);
        }
        let text = unsafe { drain_native_input_text(surface.hwnd)? };
        let text = format!("{}{}", pending.2, text);
        if text.is_empty() {
            return Ok(None);
        }
        // The drain only extracts native HWND text. Commit counters and last
        // commit metadata are updated after validation and PTY write succeeds
        // in the shared IPC commit path.
        Ok(Some((terminal_id, text)))
    }

    fn stage_native_clipboard_paste_impl(
        &self,
        terminal_id: String,
    ) -> Result<Option<(String, String)>, String> {
        let guard = unsafe { read_native_clipboard_text_for_paste() }
            .map(|text| classify_native_terminal_paste_input(&text))
            .unwrap_or_else(|_| NativePasteGuard {
                action: "blocked",
                reason: "clipboard text unavailable to native input guard",
                normalized_text: String::new(),
                line_ending_count: 0,
            });
        let mut state = self.lock_state();
        let runtime = state
            .native_surface_runtime
            .get_or_insert_with(|| Arc::new(Mutex::new(NativeSurfaceRuntime::default())))
            .clone();
        state.active_terminal_id = Some(terminal_id.clone());
        state.last_error = if guard.action == "blocked" {
            Some(guard.reason.to_string())
        } else {
            None
        };
        if let Ok(mut runtime) = runtime.lock() {
            runtime.active_terminal_id = Some(terminal_id.clone());
            runtime.paste_guard_event_count = runtime.paste_guard_event_count.saturating_add(1);
            runtime.last_paste_guard_action = Some(guard.action.to_string());
            runtime.last_paste_guard_reason = Some(guard.reason.to_string());
            runtime.last_paste_guard_line_endings = guard.line_ending_count;
        }
        if guard.action == "allowed" {
            Ok(Some((terminal_id, guard.normalized_text)))
        } else {
            Ok(None)
        }
    }
}

#[cfg(target_os = "windows")]
struct NativeInputSurfaceContext {
    runtime: Arc<Mutex<NativeSurfaceRuntime>>,
}

#[cfg(target_os = "windows")]
unsafe extern "system" fn native_input_surface_window_proc(
    hwnd: windows::Win32::Foundation::HWND,
    msg: u32,
    wparam: windows::Win32::Foundation::WPARAM,
    lparam: windows::Win32::Foundation::LPARAM,
) -> windows::Win32::Foundation::LRESULT {
    use windows::Win32::Graphics::Gdi::ValidateRect;
    use windows::Win32::UI::Input::Ime::{
        GCS_COMPSTR, GCS_RESULTSTR, ISC_SHOWUICOMPOSITIONWINDOW, ISC_SHOWUIGUIDELINE,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        DefWindowProcW, GetWindowLongPtrW, SetWindowLongPtrW, CREATESTRUCTW, GWLP_USERDATA,
        WM_CHAR, WM_ERASEBKGND, WM_IME_COMPOSITION, WM_IME_ENDCOMPOSITION, WM_IME_SETCONTEXT,
        WM_IME_STARTCOMPOSITION, WM_KEYDOWN, WM_NCCREATE, WM_NCDESTROY, WM_PAINT, WM_PASTE,
        WM_SYSKEYDOWN,
    };

    if msg == WM_NCCREATE {
        let create = lparam.0 as *const CREATESTRUCTW;
        if create.is_null() {
            return windows::Win32::Foundation::LRESULT(0);
        }
        let ptr = unsafe { (*create).lpCreateParams } as *mut NativeInputSurfaceContext;
        if ptr.is_null() {
            return windows::Win32::Foundation::LRESULT(0);
        }
        unsafe {
            SetWindowLongPtrW(hwnd, GWLP_USERDATA, ptr as isize);
        }
        return windows::Win32::Foundation::LRESULT(1);
    }

    let ptr = unsafe { GetWindowLongPtrW(hwnd, GWLP_USERDATA) } as *mut NativeInputSurfaceContext;
    if ptr.is_null() {
        return unsafe { DefWindowProcW(hwnd, msg, wparam, lparam) };
    }

    let context = unsafe { &mut *ptr };
    match msg {
        WM_IME_STARTCOMPOSITION => {
            if let Ok(mut runtime) = context.runtime.lock() {
                runtime.composition_active = true;
                runtime.composition_text.clear();
            }
        }
        WM_IME_SETCONTEXT => {
            let lparam = windows::Win32::Foundation::LPARAM(
                ((lparam.0 as u32) & !(ISC_SHOWUICOMPOSITIONWINDOW | ISC_SHOWUIGUIDELINE)) as isize,
            );
            return unsafe { DefWindowProcW(hwnd, msg, wparam, lparam) };
        }
        WM_IME_COMPOSITION => {
            let flags = lparam.0 as u32;
            if flags & GCS_RESULTSTR.0 != 0 {
                let result = unsafe { read_native_ime_composition_text(hwnd, GCS_RESULTSTR) }
                    .unwrap_or(None);
                // Some IMEs report the committed result and the next preedit
                // in a single message; the follow-up preedit must survive the
                // commit instead of being dropped with the early return.
                let next_composition = if flags & GCS_COMPSTR.0 != 0 {
                    unsafe { read_native_ime_composition_text(hwnd, GCS_COMPSTR) }.unwrap_or(None)
                } else {
                    None
                };
                if let Ok(mut runtime) = context.runtime.lock() {
                    if let Some(result) = result {
                        push_native_surface_pending_bytes(&mut runtime, result);
                    }
                    match next_composition {
                        Some(text) if !text.is_empty() => {
                            runtime.composition_active = true;
                            runtime.composition_text = text;
                        }
                        _ => {
                            runtime.composition_active = false;
                            runtime.composition_text.clear();
                        }
                    }
                }
                return windows::Win32::Foundation::LRESULT(0);
            }
            if flags & GCS_COMPSTR.0 != 0 {
                let composition_text =
                    unsafe { read_native_ime_composition_text(hwnd, GCS_COMPSTR) }.unwrap_or(None);
                // The native input HWND is an IME owner, not a renderer.
                // Returning here keeps Japanese preedit text out of the OS paint path,
                // while the frontend mirrors composition_text in
                // the terminal canvas at the cursor.
                if let Ok(mut runtime) = context.runtime.lock() {
                    runtime.composition_active = true;
                    runtime.composition_text = composition_text.unwrap_or_default();
                }
                return windows::Win32::Foundation::LRESULT(0);
            }
        }
        WM_IME_ENDCOMPOSITION => {
            if let Ok(mut runtime) = context.runtime.lock() {
                runtime.composition_active = false;
                runtime.composition_text.clear();
            }
        }
        key_msg if key_msg == WM_KEYDOWN || key_msg == WM_SYSKEYDOWN => {
            let modifiers = native_key_modifiers();
            if let Some(bytes) = terminal_bytes_for_native_key(
                wparam.0 as u16,
                modifiers.ctrl,
                modifiers.shift,
                modifiers.alt,
            ) {
                if let Ok(mut runtime) = context.runtime.lock() {
                    if !runtime.composition_active {
                        push_native_surface_pending_bytes(&mut runtime, bytes);
                        return windows::Win32::Foundation::LRESULT(0);
                    }
                }
            }
        }
        WM_CHAR => {
            if let Some(bytes) = terminal_text_for_native_char(wparam.0 as u32) {
                if let Ok(mut runtime) = context.runtime.lock() {
                    if !runtime.composition_active {
                        push_native_surface_pending_bytes(&mut runtime, bytes);
                        return windows::Win32::Foundation::LRESULT(0);
                    }
                }
            }
        }
        WM_PASTE => {
            let guard = unsafe { read_native_clipboard_text_nonblocking() }
                .map(|text| classify_native_terminal_paste_input(&text))
                .unwrap_or_else(|_| NativePasteGuard {
                    action: "blocked",
                    reason: "clipboard busy or unavailable to native input guard",
                    normalized_text: String::new(),
                    line_ending_count: 0,
                });
            if let Ok(mut runtime) = context.runtime.lock() {
                runtime.paste_guard_event_count = runtime.paste_guard_event_count.saturating_add(1);
                runtime.last_paste_guard_action = Some(guard.action.to_string());
                runtime.last_paste_guard_reason = Some(guard.reason.to_string());
                runtime.last_paste_guard_line_endings = guard.line_ending_count;
                if guard.action == "allowed" {
                    push_native_surface_pending_bytes(&mut runtime, guard.normalized_text);
                }
            }
            return windows::Win32::Foundation::LRESULT(0);
        }
        WM_PAINT => {
            let _ = unsafe { ValidateRect(Some(hwnd), None) };
            return windows::Win32::Foundation::LRESULT(0);
        }
        WM_ERASEBKGND => {
            // This HWND only exists to give Windows IME/TSF a real focus
            // owner. It must never erase or paint a default white EDIT
            // surface; visible text is owned by the terminal renderer.
            return windows::Win32::Foundation::LRESULT(1);
        }
        WM_NCDESTROY => {
            if let Ok(mut runtime) = context.runtime.lock() {
                runtime.composition_active = false;
                runtime.composition_text.clear();
            }
            unsafe {
                SetWindowLongPtrW(hwnd, GWLP_USERDATA, 0);
            }
            let result = unsafe { DefWindowProcW(hwnd, msg, wparam, lparam) };
            unsafe { drop(Box::from_raw(ptr)) };
            return result;
        }
        _ => {}
    }

    unsafe { DefWindowProcW(hwnd, msg, wparam, lparam) }
}

#[cfg(target_os = "windows")]
const CLIPBOARD_OPEN_RETRY_COUNT: usize = 12;
#[cfg(target_os = "windows")]
const CLIPBOARD_OPEN_RETRY_DELAY_MS: u64 = 8;

/// Clipboard read for worker-thread callers (IPC commands). Retries with a
/// short sleep while another process holds the clipboard open.
#[cfg(target_os = "windows")]
unsafe fn read_native_clipboard_text_for_paste() -> Result<String, String> {
    unsafe {
        read_native_clipboard_text_with_attempts(
            CLIPBOARD_OPEN_RETRY_COUNT,
            CLIPBOARD_OPEN_RETRY_DELAY_MS,
        )
    }
}

/// Clipboard read for the window procedure. Runs on the surface's message
/// thread, so it must never sleep: a blocked message pump stalls keyboard
/// and IME input for the whole surface.
#[cfg(target_os = "windows")]
unsafe fn read_native_clipboard_text_nonblocking() -> Result<String, String> {
    unsafe { read_native_clipboard_text_with_attempts(1, 0) }
}

#[cfg(target_os = "windows")]
unsafe fn read_native_clipboard_text_with_attempts(
    attempts: usize,
    delay_ms: u64,
) -> Result<String, String> {
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
        let mut last_open_error = String::new();
        let mut opened = false;
        let attempts = attempts.max(1);
        for attempt in 0..attempts {
            match OpenClipboard(None) {
                Ok(()) => {
                    opened = true;
                    break;
                }
                Err(err) => {
                    last_open_error = format!("OpenClipboard failed: {err}");
                    if delay_ms > 0 && attempt + 1 < attempts {
                        std::thread::sleep(std::time::Duration::from_millis(delay_ms));
                    }
                }
            }
        }
        if !opened {
            return Err(if last_open_error.is_empty() {
                "OpenClipboard failed".to_string()
            } else {
                last_open_error
            });
        }
        let _guard = ClipboardGuard;
        if IsClipboardFormatAvailable(CF_UNICODETEXT).is_err() {
            return Ok(String::new());
        }
        let handle = GetClipboardData(CF_UNICODETEXT)
            .map_err(|err| format!("GetClipboardData(CF_UNICODETEXT) failed: {err}"))?;
        let global = HGLOBAL(handle.0);
        let size = GlobalSize(global);
        if size < 2 {
            return Ok(String::new());
        }
        let ptr = GlobalLock(global);
        if ptr.is_null() {
            return Err("GlobalLock failed for clipboard text".to_string());
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

#[cfg(target_os = "windows")]
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
struct NativeKeyModifiers {
    ctrl: bool,
    shift: bool,
    alt: bool,
}

#[cfg(target_os = "windows")]
fn native_key_modifiers() -> NativeKeyModifiers {
    use windows::Win32::UI::Input::KeyboardAndMouse::{GetKeyState, VK_CONTROL, VK_MENU, VK_SHIFT};
    fn pressed(state: i16) -> bool {
        (state as u16 & 0x8000) != 0
    }
    NativeKeyModifiers {
        ctrl: pressed(unsafe { GetKeyState(i32::from(VK_CONTROL.0)) }),
        shift: pressed(unsafe { GetKeyState(i32::from(VK_SHIFT.0)) }),
        alt: pressed(unsafe { GetKeyState(i32::from(VK_MENU.0)) }),
    }
}

#[cfg(target_os = "windows")]
fn terminal_bytes_for_native_key(key: u16, ctrl: bool, shift: bool, alt: bool) -> Option<String> {
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        VK_BACK, VK_DELETE, VK_DOWN, VK_END, VK_ESCAPE, VK_F1, VK_F10, VK_F11, VK_F12, VK_F2,
        VK_F3, VK_F4, VK_F5, VK_F6, VK_F7, VK_F8, VK_F9, VK_HOME, VK_INSERT, VK_LEFT, VK_NEXT,
        VK_PRIOR, VK_RETURN, VK_RIGHT, VK_SPACE, VK_TAB, VK_UP,
    };
    if ctrl && shift && key != VK_TAB.0 {
        return None;
    }
    let modifier = native_csi_modifier(shift, alt, ctrl);
    match key {
        key if key == VK_RETURN.0 => Some("\r".to_string()),
        key if key == VK_BACK.0 => Some(if ctrl { "\x08" } else { "\x7f" }.to_string()),
        key if key == VK_TAB.0 => Some(if !shift {
            "\t".to_string()
        } else if modifier == 2 {
            "\x1b[Z".to_string()
        } else {
            // Shift+Tab with extra modifiers (e.g. Ctrl+Shift+Tab) keeps the
            // back-tab letter but must not silently drop the CSI modifier.
            native_csi_letter("Z", modifier)
        }),
        key if key == VK_ESCAPE.0 => Some("\x1b".to_string()),
        key if key == VK_UP.0 => Some(native_csi_letter("A", modifier)),
        key if key == VK_DOWN.0 => Some(native_csi_letter("B", modifier)),
        key if key == VK_RIGHT.0 => Some(native_csi_letter("C", modifier)),
        key if key == VK_LEFT.0 => Some(native_csi_letter("D", modifier)),
        key if key == VK_HOME.0 => Some(native_csi_letter("H", modifier)),
        key if key == VK_END.0 => Some(native_csi_letter("F", modifier)),
        key if key == VK_PRIOR.0 => Some(native_csi_tilde(5, modifier)),
        key if key == VK_NEXT.0 => Some(native_csi_tilde(6, modifier)),
        key if key == VK_INSERT.0 => Some(native_csi_tilde(2, modifier)),
        key if key == VK_DELETE.0 => Some(native_csi_tilde(3, modifier)),
        key if key == VK_F1.0 => Some(native_ss_fn("P", modifier)),
        key if key == VK_F2.0 => Some(native_ss_fn("Q", modifier)),
        key if key == VK_F3.0 => Some(native_ss_fn("R", modifier)),
        key if key == VK_F4.0 => Some(native_ss_fn("S", modifier)),
        key if key == VK_F5.0 => Some(native_csi_tilde(15, modifier)),
        key if key == VK_F6.0 => Some(native_csi_tilde(17, modifier)),
        key if key == VK_F7.0 => Some(native_csi_tilde(18, modifier)),
        key if key == VK_F8.0 => Some(native_csi_tilde(19, modifier)),
        key if key == VK_F9.0 => Some(native_csi_tilde(20, modifier)),
        key if key == VK_F10.0 => Some(native_csi_tilde(21, modifier)),
        key if key == VK_F11.0 => Some(native_csi_tilde(23, modifier)),
        key if key == VK_F12.0 => Some(native_csi_tilde(24, modifier)),
        key if ctrl && alt && native_printable_char_for_virtual_key(key, shift).is_some() => None,
        key if ctrl => native_ctrl_char_for_virtual_key(key),
        key if alt => {
            native_printable_char_for_virtual_key(key, shift).map(|ch| format!("\x1b{ch}"))
        }
        key if key == VK_SPACE.0 => Some(" ".to_string()),
        _ => None,
    }
}

#[cfg(target_os = "windows")]
fn native_csi_modifier(shift: bool, alt: bool, ctrl: bool) -> u8 {
    1 + u8::from(shift) + (u8::from(alt) * 2) + (u8::from(ctrl) * 4)
}

#[cfg(target_os = "windows")]
fn native_csi_letter(letter: &str, modifier: u8) -> String {
    if modifier == 1 {
        format!("\x1b[{letter}")
    } else {
        format!("\x1b[1;{modifier}{letter}")
    }
}

#[cfg(target_os = "windows")]
fn native_csi_tilde(n: u8, modifier: u8) -> String {
    if modifier == 1 {
        format!("\x1b[{n}~")
    } else {
        format!("\x1b[{n};{modifier}~")
    }
}

#[cfg(target_os = "windows")]
fn native_ss_fn(letter: &str, modifier: u8) -> String {
    if modifier == 1 {
        format!("\x1bO{letter}")
    } else {
        format!("\x1b[1;{modifier}{letter}")
    }
}

#[cfg(target_os = "windows")]
fn native_ctrl_char_for_virtual_key(key: u16) -> Option<String> {
    const VK_OEM_4_U16: u16 = 0xdb;
    const VK_OEM_5_U16: u16 = 0xdc;
    const VK_OEM_6_U16: u16 = 0xdd;
    const VK_OEM_MINUS_U16: u16 = 0xbd;
    use windows::Win32::UI::Input::KeyboardAndMouse::VK_SPACE;
    match key {
        key if key == VK_SPACE.0 => Some("\x00".to_string()),
        key if (u16::from(b'A')..=u16::from(b'Z')).contains(&key) => {
            Some(char::from_u32(u32::from(key - u16::from(b'A') + 1))?.to_string())
        }
        VK_OEM_4_U16 => Some("\x1b".to_string()),
        VK_OEM_5_U16 => Some("\x1c".to_string()),
        VK_OEM_6_U16 => Some("\x1d".to_string()),
        VK_OEM_MINUS_U16 => Some("\x1f".to_string()),
        _ => None,
    }
}

#[cfg(target_os = "windows")]
fn native_printable_char_for_virtual_key(key: u16, shift: bool) -> Option<char> {
    use windows::Win32::UI::Input::KeyboardAndMouse::VK_SPACE;
    if key == VK_SPACE.0 {
        return Some(' ');
    }
    if (u16::from(b'A')..=u16::from(b'Z')).contains(&key) {
        let base = if shift { b'A' } else { b'a' };
        return char::from_u32(u32::from(base + (key - u16::from(b'A')) as u8));
    }
    if !shift && (u16::from(b'0')..=u16::from(b'9')).contains(&key) {
        return char::from_u32(u32::from(b'0' + (key - u16::from(b'0')) as u8));
    }
    None
}

#[cfg(target_os = "windows")]
fn terminal_text_for_native_char(code: u32) -> Option<String> {
    // Control bytes are owned by WM_KEYDOWN so TranslateMessage-generated
    // WM_CHAR messages do not duplicate Enter/Tab/Backspace writes.
    if code < 0x20 || code == 0x7f {
        return None;
    }
    char::from_u32(code).map(|ch| ch.to_string())
}

#[cfg(target_os = "windows")]
unsafe fn native_surface_is_alive(hwnd: isize) -> bool {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::IsWindow;
    unsafe { IsWindow(Some(HWND(hwnd as *mut _))).as_bool() }
}

#[cfg(target_os = "windows")]
fn push_native_surface_pending_bytes(runtime: &mut NativeSurfaceRuntime, bytes: String) {
    if bytes.is_empty() {
        return;
    }
    if let Some(terminal_id) = runtime.active_terminal_id.clone() {
        runtime.pending_bytes.push((terminal_id, bytes));
    }
}

#[cfg(target_os = "windows")]
unsafe fn create_native_input_surface(
    parent_hwnd: isize,
    runtime: Arc<Mutex<NativeSurfaceRuntime>>,
) -> Result<NativeInputSurfaceHandle, String> {
    use windows::core::w;
    use windows::Win32::Foundation::{HINSTANCE, HWND};
    use windows::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows::Win32::UI::WindowsAndMessaging::{
        CreateWindowExW, RegisterClassW, CS_HREDRAW, CS_VREDRAW, HMENU, WINDOW_EX_STYLE,
        WINDOW_STYLE, WNDCLASSW, WS_CHILD, WS_CLIPSIBLINGS, WS_VISIBLE,
    };

    let parent = HWND(parent_hwnd as *mut _);
    let instance = HINSTANCE(
        unsafe { GetModuleHandleW(None) }
            .map_err(|err| format!("GetModuleHandleW failed: {err}"))?
            .0,
    );
    let class_name = w!("AetherNativeTerminalInputSurface");
    let class = WNDCLASSW {
        style: CS_HREDRAW | CS_VREDRAW,
        lpfnWndProc: Some(native_input_surface_window_proc),
        hInstance: instance,
        lpszClassName: class_name,
        ..Default::default()
    };
    // RegisterClassW returns 0 if the class is already registered in this
    // process. We let CreateWindowExW provide the authoritative failure if
    // registration truly did not succeed.
    unsafe {
        let _ = RegisterClassW(&class);
    }
    let style = WINDOW_STYLE(WS_CHILD.0 | WS_VISIBLE.0 | WS_CLIPSIBLINGS.0);
    let context = Box::new(NativeInputSurfaceContext { runtime });
    let context_ptr = Box::into_raw(context);
    let hwnd = unsafe {
        CreateWindowExW(
            WINDOW_EX_STYLE(0),
            class_name,
            w!(""),
            style,
            0,
            0,
            1,
            1,
            Some(parent),
            Some(HMENU(std::ptr::null_mut())),
            Some(instance),
            Some(context_ptr.cast()),
        )
    }
    .map_err(|err| {
        unsafe { drop(Box::from_raw(context_ptr)) };
        format!("CreateWindowExW native input surface failed: {err}")
    })?;

    Ok(NativeInputSurfaceHandle {
        hwnd: hwnd.0 as isize,
        parent_hwnd,
    })
}

#[cfg(target_os = "windows")]
unsafe fn position_native_input_surface(
    hwnd: isize,
    rect: NativeInputSurfaceRect,
) -> Result<(), String> {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::Input::KeyboardAndMouse::SetFocus;
    use windows::Win32::UI::WindowsAndMessaging::{
        SetWindowPos, ShowWindow, SWP_NOZORDER, SW_SHOW,
    };

    let hwnd = HWND(hwnd as *mut _);
    unsafe {
        // Keep a real focusable HWND for TSF/IME/candidate positioning, but
        // use an Aether-owned no-paint window instead of EDIT. The full cell
        // height and wide runway give IME a stable geometry while terminal
        // rendering stays entirely in the canvas.
        let paint_rect = native_input_surface_paint_rect(rect);
        SetWindowPos(
            hwnd,
            None,
            paint_rect.x,
            paint_rect.y,
            paint_rect.width,
            paint_rect.height,
            SWP_NOZORDER,
        )
        .map_err(|err| format!("SetWindowPos native input surface failed: {err}"))?;
        let _ = ShowWindow(hwnd, SW_SHOW);
        SetFocus(Some(hwnd))
            .map_err(|err| format!("SetFocus native input surface failed: {err}"))?;
        apply_native_surface_ime_position(hwnd, paint_rect)?;
    }
    Ok(())
}

#[cfg(target_os = "windows")]
unsafe fn apply_native_surface_ime_position(
    hwnd: windows::Win32::Foundation::HWND,
    rect: NativeInputSurfaceRect,
) -> Result<(), String> {
    use windows::Win32::Foundation::{POINT, RECT};
    use windows::Win32::UI::Input::Ime::{
        ImmGetContext, ImmReleaseContext, ImmSetCandidateWindow, ImmSetCompositionWindow,
        CANDIDATEFORM, CFS_CANDIDATEPOS, CFS_RECT, COMPOSITIONFORM,
    };

    let himc = unsafe { ImmGetContext(hwnd) };
    if himc.is_invalid() {
        return Ok(());
    }

    let caret_x = rect.caret_inset.max(0).min(rect.width.saturating_sub(1));
    let line_height = rect.height.max(1);
    let runway_right = rect.width.max(caret_x + 1);
    let composition = COMPOSITIONFORM {
        // Give IMM a real horizontal editing runway. Some Japanese IMEs
        // ignore WM_IME_SETCONTEXT's composition-window suppression during
        // long preedit editing; a RECT prevents the one-cell vertical strip.
        dwStyle: CFS_RECT,
        ptCurrentPos: POINT {
            x: caret_x,
            y: line_height,
        },
        rcArea: RECT {
            left: caret_x,
            top: 0,
            right: runway_right,
            bottom: line_height,
        },
    };
    let _ = unsafe { ImmSetCompositionWindow(himc, &composition) };

    let candidate = CANDIDATEFORM {
        dwIndex: 0,
        dwStyle: CFS_CANDIDATEPOS,
        // The native child HWND is already clamped left by the frontend when
        // the terminal is near the right rail, so candidate x=0 keeps the OS
        // popup inside that safe runway while the caret remains at caret_x.
        ptCurrentPos: POINT {
            x: 0,
            y: line_height,
        },
        ..Default::default()
    };
    let _ = unsafe { ImmSetCandidateWindow(himc, &candidate) };
    let release_ok = unsafe { ImmReleaseContext(hwnd, himc).as_bool() };
    if release_ok {
        Ok(())
    } else {
        Err("ImmReleaseContext failed while positioning native input surface".to_string())
    }
}

fn native_input_surface_paint_rect(rect: NativeInputSurfaceRect) -> NativeInputSurfaceRect {
    NativeInputSurfaceRect {
        ..sanitize_native_input_rect(rect)
    }
}

fn sanitize_native_input_rect(rect: NativeInputSurfaceRect) -> NativeInputSurfaceRect {
    let width = rect.width.max(1);
    NativeInputSurfaceRect {
        x: rect.x.max(0),
        y: rect.y.max(0),
        width,
        height: rect.height.max(1),
        caret_inset: rect.caret_inset.max(0).min(width.saturating_sub(1)),
    }
}

#[cfg(target_os = "windows")]
unsafe fn read_native_ime_composition_text(
    hwnd: windows::Win32::Foundation::HWND,
    kind: windows::Win32::UI::Input::Ime::IME_COMPOSITION_STRING,
) -> Result<Option<String>, String> {
    use windows::Win32::UI::Input::Ime::{
        ImmGetCompositionStringW, ImmGetContext, ImmReleaseContext,
    };

    let himc = unsafe { ImmGetContext(hwnd) };
    if himc.is_invalid() {
        return Ok(None);
    }
    let byte_len = unsafe { ImmGetCompositionStringW(himc, kind, None, 0) };
    if byte_len < 0 {
        let _ = unsafe { ImmReleaseContext(hwnd, himc) };
        return Err("ImmGetCompositionStringW failed while reading native IME text".to_string());
    }
    if byte_len == 0 {
        let release_ok = unsafe { ImmReleaseContext(hwnd, himc).as_bool() };
        if !release_ok {
            return Err("ImmReleaseContext failed while reading empty native IME text".to_string());
        }
        return Ok(Some(String::new()));
    }

    let mut buf = vec![0u16; (byte_len as usize).div_ceil(2)];
    let read_len = unsafe {
        ImmGetCompositionStringW(himc, kind, Some(buf.as_mut_ptr().cast()), byte_len as u32)
    };
    let release_ok = unsafe { ImmReleaseContext(hwnd, himc).as_bool() };
    if !release_ok {
        return Err("ImmReleaseContext failed after native IME read".to_string());
    }
    if read_len < 0 {
        return Err("ImmGetCompositionStringW read failed for native IME text".to_string());
    }
    let word_len = read_len as usize / 2;
    Ok(Some(String::from_utf16_lossy(&buf[..word_len])))
}

#[cfg(target_os = "windows")]
unsafe fn drain_native_input_text(hwnd: isize) -> Result<String, String> {
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
    unsafe {
        SetWindowTextW(hwnd, w!(""))
            .map_err(|err| format!("SetWindowTextW native input clear failed: {err}"))?
    };
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

    #[test]
    fn native_surface_rect_keeps_wide_runway_and_clamps_caret_inset() {
        let rect = sanitize_native_input_rect(NativeInputSurfaceRect {
            x: -20,
            y: -4,
            width: 440,
            height: 18,
            caret_inset: 420,
        });
        assert_eq!(rect.x, 0);
        assert_eq!(rect.y, 0);
        assert_eq!(rect.width, 440);
        assert_eq!(rect.height, 18);
        assert_eq!(rect.caret_inset, 420);

        let too_narrow = sanitize_native_input_rect(NativeInputSurfaceRect {
            x: 4,
            y: 8,
            width: 1,
            height: 0,
            caret_inset: 999,
        });
        assert_eq!(too_narrow.width, 1);
        assert_eq!(too_narrow.height, 1);
        assert_eq!(too_narrow.caret_inset, 0);
    }

    #[test]
    fn native_surface_paint_rect_keeps_full_ime_runway_without_edit_painting() {
        let paint_rect = native_input_surface_paint_rect(NativeInputSurfaceRect {
            x: 40,
            y: 18,
            width: 440,
            height: 22,
            caret_inset: 420,
        });
        assert_eq!(paint_rect.x, 40);
        assert_eq!(paint_rect.y, 18);
        assert_eq!(paint_rect.width, 440);
        assert_eq!(paint_rect.height, 22);
        assert_eq!(paint_rect.caret_inset, 420);
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn native_surface_char_input_ignores_control_duplicates() {
        assert_eq!(
            terminal_text_for_native_char('a' as u32),
            Some("a".to_string())
        );
        assert_eq!(
            terminal_text_for_native_char('あ' as u32),
            Some("あ".to_string())
        );
        assert_eq!(terminal_text_for_native_char('\r' as u32), None);
        assert_eq!(terminal_text_for_native_char('\t' as u32), None);
        assert_eq!(terminal_text_for_native_char(0x7f), None);
    }

    #[test]
    fn native_paste_guard_normalizes_single_line_lf_to_carriage_return() {
        let guard = classify_native_terminal_paste_input("git status\n");
        assert_eq!(guard.action, "allowed");
        assert_eq!(guard.normalized_text, "git status\r");
        assert_eq!(guard.line_ending_count, 1);
    }

    #[test]
    fn native_paste_guard_blocks_multiline_without_ui_confirmation() {
        let guard = classify_native_terminal_paste_input("echo one\necho two\n");
        assert_eq!(guard.action, "blocked");
        assert_eq!(
            guard.reason,
            "multi-line paste requires explicit UI confirmation"
        );
        assert_eq!(guard.normalized_text, "");
    }

    #[test]
    fn native_paste_guard_blocks_destructive_commands_before_drain() {
        let guard = classify_native_terminal_paste_input("git reset --hard HEAD\n");
        assert_eq!(guard.action, "blocked");
        assert_eq!(
            guard.reason,
            "destructive command paste blocked by native input guard"
        );
        assert_eq!(guard.normalized_text, "");
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn native_surface_keydown_maps_terminal_control_bytes() {
        use windows::Win32::UI::Input::KeyboardAndMouse::{
            VK_BACK, VK_DELETE, VK_F12, VK_LEFT, VK_NEXT, VK_PRIOR, VK_RETURN, VK_TAB,
        };

        assert_eq!(
            terminal_bytes_for_native_key(VK_RETURN.0, false, false, false).as_deref(),
            Some("\r")
        );
        assert_eq!(
            terminal_bytes_for_native_key(VK_BACK.0, false, false, false).as_deref(),
            Some("\x7f")
        );
        assert_eq!(
            terminal_bytes_for_native_key(VK_BACK.0, true, false, false).as_deref(),
            Some("\x08")
        );
        assert_eq!(
            terminal_bytes_for_native_key(VK_LEFT.0, false, false, false).as_deref(),
            Some("\x1b[D")
        );
        assert_eq!(
            terminal_bytes_for_native_key(VK_LEFT.0, true, false, false).as_deref(),
            Some("\x1b[1;5D")
        );
        assert_eq!(
            terminal_bytes_for_native_key(VK_DELETE.0, false, false, false).as_deref(),
            Some("\x1b[3~")
        );
        assert_eq!(
            terminal_bytes_for_native_key(VK_PRIOR.0, false, false, false).as_deref(),
            Some("\x1b[5~")
        );
        assert_eq!(
            terminal_bytes_for_native_key(VK_NEXT.0, false, false, true).as_deref(),
            Some("\x1b[6;3~")
        );
        assert_eq!(
            terminal_bytes_for_native_key(VK_TAB.0, false, true, false).as_deref(),
            Some("\x1b[Z")
        );
        assert_eq!(
            terminal_bytes_for_native_key(VK_TAB.0, true, true, false).as_deref(),
            Some("\x1b[1;6Z")
        );
        assert_eq!(
            terminal_bytes_for_native_key(VK_TAB.0, true, false, false).as_deref(),
            Some("\t")
        );
        assert_eq!(
            terminal_bytes_for_native_key(VK_F12.0, false, false, false).as_deref(),
            Some("\x1b[24~")
        );
        assert_eq!(
            terminal_bytes_for_native_key(u16::from(b'C'), true, false, false).as_deref(),
            Some("\x03")
        );
        assert_eq!(
            terminal_bytes_for_native_key(u16::from(b'X'), false, false, true).as_deref(),
            Some("\x1bx")
        );
        assert_eq!(
            terminal_bytes_for_native_key(u16::from(b'A'), false, false, false),
            None
        );
        assert_eq!(
            terminal_bytes_for_native_key(u16::from(b'H'), true, true, false),
            None
        );
    }
}
