//! Aether Terminal — Native Rust GPU renderer (no WebView2).
//!
//! Standalone terminal using winit + wgpu + existing Grid/VTE/Renderer.
//! This is the foundation for the full native Rust migration.
//!
//! Usage: cargo run --bin native_terminal

use std::sync::{Arc, Mutex};
use winit::application::ApplicationHandler;
use winit::event::WindowEvent;
use winit::event_loop::{ActiveEventLoop, EventLoop};
use winit::window::{Window, WindowId};
use winit::keyboard::{Key, NamedKey};

use aether_terminal_lib::gpu::font::FontManager;
use aether_terminal_lib::gpu::atlas::GlyphAtlas;
use aether_terminal_lib::gpu::grid::{Grid, GridPerformer};
use aether_terminal_lib::gpu::renderer::TerminalRenderer;
use aether_terminal_lib::pty::{PtyManager, ShellType};

/// Application state for the native terminal.
struct NativeTerminal {
    window: Option<Arc<Window>>,
    // wgpu state
    surface: Option<wgpu::Surface<'static>>,
    device: Option<Arc<wgpu::Device>>,
    queue: Option<Arc<wgpu::Queue>>,
    surface_config: Option<wgpu::SurfaceConfiguration>,
    renderer: Option<TerminalRenderer>,
    // Terminal state
    grid: Arc<Mutex<Grid>>,
    atlas: Mutex<GlyphAtlas>,
    font: FontManager,
    pty_id: Option<String>,
    pty_manager: PtyManager,
}

impl NativeTerminal {
    fn new() -> Self {
        let font = FontManager::new(16.0, 1.4);
        Self {
            window: None,
            surface: None,
            device: None,
            queue: None,
            surface_config: None,
            renderer: None,
            grid: Arc::new(Mutex::new(Grid::new(120, 30, 10_000))),
            atlas: Mutex::new(GlyphAtlas::new(2048, 2048)),
            font,
            pty_id: None,
            pty_manager: PtyManager::new(),
        }
    }

    fn init_wgpu(&mut self, window: Arc<Window>) {
        let size = window.inner_size();

        // Create wgpu instance
        let instance = wgpu::Instance::new(&wgpu::InstanceDescriptor {
            backends: wgpu::Backends::DX12,
            ..Default::default()
        });

        // Create surface from window
        let surface = instance.create_surface(window.clone()).expect("Failed to create surface");

        // Request adapter
        let adapter = pollster::block_on(instance.request_adapter(&wgpu::RequestAdapterOptions {
            power_preference: wgpu::PowerPreference::HighPerformance,
            compatible_surface: Some(&surface),
            force_fallback_adapter: false,
        }))
        .expect("No GPU adapter found");

        log::info!("GPU: {}", adapter.get_info().name);

        // Request device
        let (device, queue) = pollster::block_on(adapter.request_device(
            &wgpu::DeviceDescriptor {
                label: Some("aether_native"),
                ..Default::default()
            },
        ))
        .expect("Failed to create device");

        let device = Arc::new(device);
        let queue = Arc::new(queue);

        // Configure surface — force Bgra8Unorm to match renderer pipeline
        let mut config = surface
            .get_default_config(&adapter, size.width.max(1), size.height.max(1))
            .expect("Surface not supported");
        config.format = wgpu::TextureFormat::Bgra8Unorm;
        surface.configure(&device, &config);

        // Create renderer
        let renderer = TerminalRenderer::new(
            device.clone(),
            queue.clone(),
            size.width.max(1),
            size.height.max(1),
        );

        self.window = Some(window);
        self.surface = Some(surface);
        self.device = Some(device);
        self.queue = Some(queue);
        self.surface_config = Some(config);
        self.renderer = Some(renderer);
    }

    fn spawn_pty(&mut self) {
        let shell = ShellType::PowerShell;
        match self.pty_manager.spawn(&shell, 120, 30, None) {
            Ok(id) => {
                log::info!("PTY spawned: {}", id);
                // Start reader thread
                if let Ok(reader) = self.pty_manager.take_reader(&id) {
                    let grid = self.grid.clone();
                    std::thread::spawn(move || {
                        let mut reader = reader;
                        let mut parser = vte::Parser::new();
                        let mut buf = [0u8; 4096];
                        loop {
                            match std::io::Read::read(&mut reader, &mut buf) {
                                Ok(0) => break,
                                Ok(n) => {
                                    let mut g = grid.lock().unwrap();
                                    let mut performer = GridPerformer { grid: &mut g };
                                    for byte in &buf[..n] {
                                        parser.advance(&mut performer, *byte);
                                    }
                                    g.needs_redraw = true;
                                }
                                Err(_) => break,
                            }
                        }
                    });
                }
                self.pty_id = Some(id);
            }
            Err(e) => log::error!("Failed to spawn PTY: {}", e),
        }
    }

    fn render(&mut self) {
        let surface = match &self.surface { Some(s) => s, None => return };
        let renderer = match &self.renderer { Some(r) => r, None => return };

        let mut grid = self.grid.lock().unwrap();
        if !grid.needs_redraw { return; }

        // Build glyph instances
        let mut atlas = self.atlas.lock().unwrap();
        let instances = aether_terminal_lib::gpu::build_glyph_instances(&grid, &self.font, &mut atlas);
        let cursor_rects = aether_terminal_lib::gpu::build_cursor_rects(&grid, &self.font, true);

        // Upload atlas if dirty
        if atlas.dirty {
            renderer.upload_atlas(&atlas);
            atlas.clear_dirty();
        }
        grid.clear_dirty();
        drop(grid);

        // Render frame
        match surface.get_current_texture() {
            Ok(texture) => {
                let view = texture.texture.create_view(&wgpu::TextureViewDescriptor::default());
                renderer.render_frame(
                    &view,
                    &instances,
                    &cursor_rects,
                    wgpu::Color { r: 0.118, g: 0.118, b: 0.180, a: 1.0 }, // Catppuccin base
                );
                texture.present();
            }
            Err(wgpu::SurfaceError::Lost | wgpu::SurfaceError::Outdated) => {
                if let (Some(config), Some(device)) = (&self.surface_config, &self.device) {
                    surface.configure(device, config);
                }
            }
            Err(e) => log::trace!("Surface error: {:?}", e),
        }
    }

    fn handle_key_input(&mut self, key: Key) {
        let pty_id = match &self.pty_id { Some(id) => id.clone(), None => return };
        let data = match key {
            Key::Character(ref c) => c.to_string().into_bytes(),
            Key::Named(NamedKey::Enter) => vec![b'\r'],
            Key::Named(NamedKey::Backspace) => vec![0x7f],
            Key::Named(NamedKey::Tab) => vec![b'\t'],
            Key::Named(NamedKey::Escape) => vec![0x1b],
            Key::Named(NamedKey::ArrowUp) => b"\x1b[A".to_vec(),
            Key::Named(NamedKey::ArrowDown) => b"\x1b[B".to_vec(),
            Key::Named(NamedKey::ArrowRight) => b"\x1b[C".to_vec(),
            Key::Named(NamedKey::ArrowLeft) => b"\x1b[D".to_vec(),
            Key::Named(NamedKey::Home) => b"\x1b[H".to_vec(),
            Key::Named(NamedKey::End) => b"\x1b[F".to_vec(),
            Key::Named(NamedKey::Delete) => b"\x1b[3~".to_vec(),
            _ => return,
        };
        let _ = self.pty_manager.write(&pty_id, &data);
    }
}

impl ApplicationHandler for NativeTerminal {
    fn resumed(&mut self, event_loop: &ActiveEventLoop) {
        if self.window.is_some() { return; }

        let attrs = Window::default_attributes()
            .with_title("Aether Terminal (Native)")
            .with_inner_size(winit::dpi::LogicalSize::new(1200, 700));

        let window = Arc::new(event_loop.create_window(attrs).expect("Failed to create window"));
        self.init_wgpu(window);
        self.spawn_pty();
    }

    fn window_event(&mut self, event_loop: &ActiveEventLoop, _id: WindowId, event: WindowEvent) {
        match event {
            WindowEvent::CloseRequested => {
                if let Some(id) = &self.pty_id {
                    let _ = self.pty_manager.close(id);
                }
                event_loop.exit();
            }
            WindowEvent::Resized(size) => {
                if let (Some(surface), Some(device), Some(config)) =
                    (&self.surface, &self.device, &mut self.surface_config)
                {
                    config.width = size.width.max(1);
                    config.height = size.height.max(1);
                    surface.configure(device, config);
                    if let Some(renderer) = &mut self.renderer {
                        renderer.resize(config.width, config.height);
                    }
                    // Resize PTY
                    let cols = (size.width as f32 / self.font.cell_width) as u16;
                    let rows = (size.height as f32 / self.font.cell_height) as u16;
                    if let Some(id) = &self.pty_id {
                        let _ = self.pty_manager.resize(id, cols.max(1), rows.max(1));
                    }
                    self.grid.lock().unwrap().resize(cols.max(1), rows.max(1));
                }
            }
            WindowEvent::KeyboardInput { event, .. } => {
                if event.state.is_pressed() {
                    self.handle_key_input(event.logical_key);
                }
            }
            WindowEvent::RedrawRequested => {
                self.render();
            }
            _ => {}
        }
    }

    fn about_to_wait(&mut self, _event_loop: &ActiveEventLoop) {
        // Request redraw every frame (~60fps via vsync)
        if let Some(window) = &self.window {
            window.request_redraw();
        }
    }
}

fn main() {
    env_logger::init();
    let event_loop = EventLoop::new().expect("Failed to create event loop");
    let mut app = NativeTerminal::new();
    event_loop.run_app(&mut app).expect("Event loop error");
}
