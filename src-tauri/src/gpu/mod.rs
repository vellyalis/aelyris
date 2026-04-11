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

use atlas::GlyphAtlas;
use font::FontManager;
use grid::Grid;
use renderer::TerminalRenderer;
use surface::TerminalSurface;

pub type TerminalId = String;

/// A single GPU-rendered terminal instance.
pub struct GpuTerminal {
    pub grid: Arc<Mutex<Grid>>,
    pub atlas: Mutex<GlyphAtlas>,
    pub font: FontManager,
    pub surface: TerminalSurface,
    // Renderer is shared (single device) — owned by GpuTerminalManager
}

/// Manages all GPU terminal instances and the shared wgpu device.
pub struct GpuTerminalManager {
    terminals: Mutex<HashMap<TerminalId, GpuTerminal>>,
    renderer: Option<TerminalRenderer>,
}

impl GpuTerminalManager {
    pub fn new() -> Self {
        Self {
            terminals: Mutex::new(HashMap::new()),
            renderer: None,
        }
    }
}
