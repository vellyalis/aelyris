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
use cursor::CursorRender;
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
    pub cursor_render: Mutex<CursorRender>,
}

/// Manages all GPU terminal instances and the shared wgpu rendering context.
pub struct GpuTerminalManager {
    terminals: Mutex<HashMap<TerminalId, GpuTerminal>>,
    /// Shared wgpu device/queue — initialized lazily on first terminal creation
    wgpu_context: Mutex<Option<WgpuContext>>,
}

/// Shared wgpu state (one per application).
struct WgpuContext {
    instance: wgpu::Instance,
    adapter: wgpu::Adapter,
    device: Arc<wgpu::Device>,
    queue: Arc<wgpu::Queue>,
}

impl GpuTerminalManager {
    pub fn new() -> Self {
        Self {
            terminals: Mutex::new(HashMap::new()),
            wgpu_context: Mutex::new(None),
        }
    }

    /// Initialize the wgpu context if not already done.
    pub async fn ensure_wgpu(&self) -> Result<(), String> {
        let mut ctx = self.wgpu_context.lock().unwrap();
        if ctx.is_some() { return Ok(()); }

        let instance = wgpu::Instance::new(&wgpu::InstanceDescriptor {
            backends: wgpu::Backends::DX12 | wgpu::Backends::VULKAN,
            ..Default::default()
        });

        let adapter = instance
            .request_adapter(&wgpu::RequestAdapterOptions {
                power_preference: wgpu::PowerPreference::HighPerformance,
                compatible_surface: None,
                force_fallback_adapter: false,
            })
            .await
            .map_err(|e| format!("No GPU adapter: {}", e))?;

        let (device, queue) = adapter
            .request_device(&wgpu::DeviceDescriptor {
                label: Some("aether_gpu"),
                ..Default::default()
            })
            .await
            .map_err(|e| format!("Failed to create device: {}", e))?;
        let device: wgpu::Device = device;
        let queue: wgpu::Queue = queue;

        log::info!("wgpu initialized: {:?}", adapter.get_info().name);

        *ctx = Some(WgpuContext {
            instance,
            adapter,
            device: Arc::new(device),
            queue: Arc::new(queue),
        });

        Ok(())
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

    /// Run one render tick for all terminals that need redraw.
    /// Called from the render loop thread.
    pub fn render_tick(&self) {
        let ctx = self.wgpu_context.lock().unwrap();
        let ctx = match ctx.as_ref() {
            Some(c) => c,
            None => return,
        };

        let terminals = self.terminals.lock().unwrap();
        for (_id, terminal) in terminals.iter() {
            let mut grid = match terminal.grid.lock() {
                Ok(g) => g,
                Err(_) => continue,
            };

            if !grid.needs_redraw { continue; }

            // Build instances
            let mut atlas = terminal.atlas.lock().unwrap();
            let glyph_instances = build_glyph_instances(&grid, &terminal.font, &mut atlas);

            // Cursor
            let cursor_rects = {
                let mut cr = terminal.cursor_render.lock().unwrap();
                cr.tick();
                build_cursor_rects(&grid, &terminal.font, cr.blink_visible)
            };

            // Upload atlas if dirty
            // (requires renderer — deferred until surface is attached)

            // Get surface texture
            match terminal.surface.get_current_texture() {
                Ok(frame) => {
                    let view = frame.texture.create_view(&wgpu::TextureViewDescriptor::default());
                    // render_frame would go here with the actual renderer
                    // For now, mark grid as clean
                    frame.present();
                }
                Err(wgpu::SurfaceError::Lost | wgpu::SurfaceError::Outdated) => {
                    // Surface needs reconfiguration
                }
                Err(_) => {}
            }

            grid.clear_dirty();
        }
    }
}

/// Build glyph instances from grid (extracted for reuse)
fn build_glyph_instances(
    grid: &Grid,
    font: &FontManager,
    atlas: &mut GlyphAtlas,
) -> Vec<renderer::GlyphInstance> {
    let cw = font.cell_width;
    let ch = font.cell_height;
    let mut instances = Vec::with_capacity((grid.cols * grid.rows) as usize);

    for row in 0..grid.rows as usize {
        for col in 0..grid.cols as usize {
            let cell = &grid.cells[row][col];
            if cell.c == ' ' && cell.bg == grid::Color::Default { continue; }

            let (fg, bg) = renderer::resolve_cell_colors(cell);
            let entry = atlas.get_or_insert(cell.c, cell.flags, font);

            instances.push(renderer::GlyphInstance {
                pos: [col as f32 * cw, row as f32 * ch],
                uv_rect: entry.uv,
                fg_color: fg,
                bg_color: bg,
                size: [entry.width as f32, entry.height as f32],
            });
        }
    }

    instances
}

fn build_cursor_rects(
    grid: &Grid,
    font: &FontManager,
    visible: bool,
) -> Vec<renderer::RectInstance> {
    let mut rects = Vec::new();
    if visible && grid.cursor.visible {
        rects.push(renderer::RectInstance {
            pos: [grid.cursor.col as f32 * font.cell_width, grid.cursor.row as f32 * font.cell_height],
            size: [2.0, font.cell_height],
            color: [0.81, 0.83, 0.88, 0.8],
        });
    }
    rects
}
