//! GPU-accelerated terminal renderer using wgpu.
//!
//! Architecture:
//!   PTY reader → VTE parser → Grid (terminal state) → Renderer (wgpu) → Child HWND
//!
//! This module replaces xterm.js for terminal rendering while coexisting
//! with the Tauri WebView2 window that hosts the React UI panels.

pub mod atlas;
pub mod cursor;
pub mod font;
pub mod grid;
pub mod ime;
pub mod input;
pub mod link;
pub mod renderer;
pub mod search;
pub mod selection;
pub mod surface;

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use grid::Grid;
use renderer::TerminalRenderer;
use surface::TerminalSurface;

/// Unique identifier for a GPU terminal instance.
pub type TerminalId = String;

/// Manages all GPU terminal instances.
///
/// Each terminal has its own Grid (state), Renderer (GPU pipeline),
/// and Surface (Child HWND). The manager owns them all and provides
/// thread-safe access.
pub struct GpuTerminalManager {
    terminals: Mutex<HashMap<TerminalId, GpuTerminal>>,
}

/// A single GPU-rendered terminal instance.
struct GpuTerminal {
    grid: Arc<Mutex<Grid>>,
    surface: TerminalSurface,
    renderer: TerminalRenderer,
}

impl GpuTerminalManager {
    pub fn new() -> Self {
        Self {
            terminals: Mutex::new(HashMap::new()),
        }
    }
}
