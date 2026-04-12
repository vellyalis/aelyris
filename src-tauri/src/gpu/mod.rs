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
    pub renderer: Option<TerminalRenderer>,
}

/// Shared wgpu state (one per application).
struct WgpuContext {
    instance: wgpu::Instance,
    adapter: wgpu::Adapter,
    device: Arc<wgpu::Device>,
    queue: Arc<wgpu::Queue>,
}

/// Manages all GPU terminal instances and the shared wgpu rendering context.
pub struct GpuTerminalManager {
    terminals: Mutex<HashMap<TerminalId, GpuTerminal>>,
    wgpu_context: Mutex<Option<WgpuContext>>,
    render_active: Mutex<bool>,
}

impl GpuTerminalManager {
    pub fn new() -> Self {
        Self {
            terminals: Mutex::new(HashMap::new()),
            wgpu_context: Mutex::new(None),
            render_active: Mutex::new(false),
        }
    }

    /// Initialize wgpu (DX12/Vulkan). Idempotent.
    pub async fn ensure_wgpu(&self) -> Result<(), String> {
        {
            let ctx = self.wgpu_context.lock().unwrap();
            if ctx.is_some() { return Ok(()); }
        }

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
            .map_err(|e| format!("Device creation failed: {}", e))?;

        log::info!("wgpu initialized: {:?}", adapter.get_info().name);

        let mut ctx = self.wgpu_context.lock().unwrap();
        *ctx = Some(WgpuContext {
            instance,
            adapter,
            device: Arc::new(device),
            queue: Arc::new(queue),
        });

        Ok(())
    }

    /// Get cloned device/queue for creating renderers and surfaces.
    pub fn device_and_queue(&self) -> Result<(Arc<wgpu::Device>, Arc<wgpu::Queue>), String> {
        let ctx = self.wgpu_context.lock().unwrap();
        let c = ctx.as_ref().ok_or("wgpu not initialized")?;
        Ok((c.device.clone(), c.queue.clone()))
    }

    /// Borrow wgpu instance and adapter (needed for surface creation).
    /// Caller must hold the returned guard for the duration of use.
    pub fn with_wgpu<F, R>(&self, f: F) -> Result<R, String>
    where
        F: FnOnce(&wgpu::Instance, &wgpu::Adapter, &wgpu::Device) -> R,
    {
        let ctx = self.wgpu_context.lock().unwrap();
        let c = ctx.as_ref().ok_or("wgpu not initialized")?;
        Ok(f(&c.instance, &c.adapter, &c.device))
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

    /// Start the render loop background thread.
    /// Safe to call multiple times (idempotent).
    pub fn start_render_loop(manager: Arc<Self>) {
        {
            let mut active = manager.render_active.lock().unwrap();
            if *active { return; }
            *active = true;
        }

        std::thread::Builder::new()
            .name("gpu-render-loop".into())
            .spawn(move || {
                log::info!("GPU render loop started");
                loop {
                    std::thread::sleep(std::time::Duration::from_millis(16)); // ~60fps
                    manager.render_tick();
                }
            })
            .expect("Failed to spawn render loop thread");
    }

    /// Render one frame for all terminals that need redraw.
    fn render_tick(&self) {
        let has_ctx = self.wgpu_context.lock().unwrap().is_some();
        if !has_ctx { return; }

        let mut terminals = match self.terminals.lock() {
            Ok(t) => t,
            Err(_) => return,
        };

        for (_id, terminal) in terminals.iter_mut() {
            let mut grid = match terminal.grid.lock() {
                Ok(g) => g,
                Err(_) => continue,
            };

            if !grid.needs_redraw { continue; }

            let renderer = match terminal.renderer.as_ref() {
                Some(r) => r,
                None => { grid.clear_dirty(); continue; }
            };

            // Build glyph instances from dirty grid
            let mut atlas = match terminal.atlas.lock() {
                Ok(a) => a,
                Err(_) => continue,
            };
            let glyph_instances = build_glyph_instances(&grid, &terminal.font, &mut atlas);

            // Cursor blink
            let cursor_rects = {
                let mut cr = match terminal.cursor_render.lock() {
                    Ok(c) => c,
                    Err(_) => continue,
                };
                cr.tick();
                build_cursor_rects(&grid, &terminal.font, cr.blink_visible)
            };

            // Upload atlas texture if glyphs were added
            if atlas.dirty {
                renderer.upload_atlas(&atlas);
                atlas.clear_dirty();
            }

            // Acquire surface frame and render
            match terminal.surface.get_current_texture() {
                Ok(frame) => {
                    let view = frame.texture.create_view(&wgpu::TextureViewDescriptor::default());
                    renderer.render_frame(
                        &view,
                        &glyph_instances,
                        &cursor_rects,
                        wgpu::Color { r: 0.0, g: 0.0, b: 0.0, a: 0.85 },
                    );
                    frame.present();
                }
                Err(wgpu::SurfaceError::Lost | wgpu::SurfaceError::Outdated) => {
                    log::warn!("GPU surface lost/outdated for terminal {}", _id);
                }
                Err(e) => {
                    log::trace!("GPU surface error: {:?}", e);
                }
            }

            grid.clear_dirty();
        }
    }
}

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
