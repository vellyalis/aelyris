//! Child HWND creation and management for wgpu rendering surface.
//!
//! Creates a Win32 child window inside the Tauri parent window,
//! then attaches a wgpu Surface to it for GPU-accelerated terminal rendering.

/// Manages the native window surface for a single terminal pane.
pub struct TerminalSurface {
    // TODO: Phase 4 — HWND handle, wgpu::Surface
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
}

impl TerminalSurface {
    /// Create a placeholder surface (Phase 4 will create actual HWND + wgpu Surface).
    pub fn new_placeholder(x: i32, y: i32, width: i32, height: i32) -> Self {
        Self { x, y, width, height }
    }

    /// Reposition and resize the child window.
    pub fn reposition(&mut self, x: i32, y: i32, width: i32, height: i32) {
        self.x = x;
        self.y = y;
        self.width = width;
        self.height = height;
        // TODO: Phase 4 — MoveWindow() call
    }
}
