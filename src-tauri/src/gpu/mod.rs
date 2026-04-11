pub mod atlas;
pub mod commands;
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
use surface::TerminalSurface;

pub type TerminalId = String;

/// A single GPU-rendered terminal instance.
pub struct GpuTerminal {
    pub grid: Arc<Mutex<Grid>>,
    pub atlas: Mutex<GlyphAtlas>,
    pub font: FontManager,
    pub surface: TerminalSurface,
}

/// Manages all GPU terminal instances.
pub struct GpuTerminalManager {
    terminals: Mutex<HashMap<TerminalId, GpuTerminal>>,
}

impl GpuTerminalManager {
    pub fn new() -> Self {
        Self {
            terminals: Mutex::new(HashMap::new()),
        }
    }

    pub fn insert(&self, id: TerminalId, terminal: GpuTerminal) {
        self.terminals.lock().unwrap().insert(id, terminal);
    }

    pub fn remove(&self, id: &str) {
        self.terminals.lock().unwrap().remove(id);
    }

    pub fn with_terminal<F, R>(&self, id: &str, f: F) -> Result<R, String>
    where
        F: FnOnce(&GpuTerminal) -> R,
    {
        let terminals = self.terminals.lock().unwrap();
        let terminal = terminals.get(id).ok_or_else(|| format!("GPU terminal not found: {}", id))?;
        Ok(f(terminal))
    }

    pub fn with_terminal_mut<F, R>(&self, id: &str, f: F) -> Result<R, String>
    where
        F: FnOnce(&mut GpuTerminal) -> R,
    {
        let mut terminals = self.terminals.lock().unwrap();
        let terminal = terminals.get_mut(id).ok_or_else(|| format!("GPU terminal not found: {}", id))?;
        Ok(f(terminal))
    }
}
