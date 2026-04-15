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
use winit::keyboard::{Key, NamedKey, ModifiersState};

use aether_terminal_lib::gpu::font::FontManager;
use aether_terminal_lib::gpu::atlas::GlyphAtlas;
use aether_terminal_lib::gpu::grid::{Grid, GridPerformer};
use aether_terminal_lib::gpu::ime::ImeState;
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
    ime_state: ImeState,
    modifiers: ModifiersState,
    mouse_pressed: bool,
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
            ime_state: ImeState::new(),
            modifiers: ModifiersState::empty(),
            mouse_pressed: false,
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

        // Alpha mode fallback chain for transparency support.
        // PreMultiplied is ideal (matches our premultiplied shaders).
        // Inherit may work under DWM compositing.
        // Auto lets wgpu pick the best available.
        // Opaque as last resort — DWM Mica still works at window level.
        let caps = surface.get_capabilities(&adapter);
        let alpha_priority = [
            wgpu::CompositeAlphaMode::PreMultiplied,
            wgpu::CompositeAlphaMode::Inherit,
            wgpu::CompositeAlphaMode::Auto,
            wgpu::CompositeAlphaMode::Opaque,
        ];
        config.alpha_mode = alpha_priority
            .iter()
            .find(|mode| caps.alpha_modes.contains(mode))
            .copied()
            .unwrap_or(wgpu::CompositeAlphaMode::Auto);
        log::info!(
            "Alpha mode: {:?} (available: {:?})",
            config.alpha_mode, caps.alpha_modes
        );
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

        // Build glyph instances and background rects
        let mut atlas = self.atlas.lock().unwrap();
        let instances = aether_terminal_lib::gpu::build_glyph_instances(&grid, &self.font, &mut atlas);
        let mut cursor_rects = aether_terminal_lib::gpu::build_bg_rects(&grid, &self.font);
        cursor_rects.extend(aether_terminal_lib::gpu::build_cursor_rects(&grid, &self.font, true));

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
                    wgpu::Color { r: 0.0, g: 0.0, b: 0.0, a: 0.75 }, // Semi-transparent for Mica bleed-through
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

    /// Position the IME candidate window at the terminal cursor location.
    fn update_ime_cursor_area(&self) {
        let window = match &self.window { Some(w) => w, None => return };
        let grid = self.grid.lock().unwrap();
        let x = grid.cursor.col as f64 * self.font.cell_width as f64;
        let y = grid.cursor.row as f64 * self.font.cell_height as f64;
        let size = winit::dpi::LogicalSize::new(
            self.font.cell_width as f64,
            self.font.cell_height as f64,
        );
        window.set_ime_cursor_area(
            winit::dpi::LogicalPosition::new(x, y),
            size,
        );
    }

    /// Write text to the PTY (used for both keyboard input and IME commit).
    fn write_to_pty(&self, data: &[u8]) {
        if let Some(id) = &self.pty_id {
            let _ = self.pty_manager.write(id, data);
        }
    }

    fn handle_key_input(&mut self, key: Key) {
        let ctrl = self.modifiers.contains(ModifiersState::CONTROL);
        let shift = self.modifiers.contains(ModifiersState::SHIFT);

        // Ctrl+Shift+C: Copy selection to clipboard
        if ctrl && shift {
            if let Key::Character(ref c) = key {
                if c.eq_ignore_ascii_case("c") {
                    let text = self.grid.lock().unwrap().selected_text();
                    if !text.is_empty() {
                        if let Ok(mut clip) = arboard::Clipboard::new() {
                            let _ = clip.set_text(&text);
                        }
                    }
                    return;
                }
            }
        }

        // Ctrl+V: Paste from clipboard
        if ctrl {
            if let Key::Character(ref c) = key {
                if c.eq_ignore_ascii_case("v") {
                    if let Ok(mut clip) = arboard::Clipboard::new() {
                        if let Ok(text) = clip.get_text() {
                            // Bracketed paste if terminal supports it
                            let grid = self.grid.lock().unwrap();
                            let bracketed = grid.mode.bracketed_paste;
                            drop(grid);
                            if bracketed {
                                self.write_to_pty(b"\x1b[200~");
                                self.write_to_pty(text.as_bytes());
                                self.write_to_pty(b"\x1b[201~");
                            } else {
                                self.write_to_pty(text.as_bytes());
                            }
                        }
                    }
                    return;
                }
                // Ctrl+C: send SIGINT (^C)
                if c.eq_ignore_ascii_case("c") {
                    self.write_to_pty(&[0x03]);
                    return;
                }
            }
        }

        // Any keyboard input resets viewport to live view
        self.grid.lock().unwrap().reset_viewport();

        let data = match key {
            Key::Character(ref c) if !ctrl => c.to_string().into_bytes(),
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
        self.write_to_pty(&data);
    }

    /// Convert mouse pixel position to grid (row, col).
    fn pixel_to_cell(&self, x: f64, y: f64) -> (u16, u16) {
        let col = (x / self.font.cell_width as f64).max(0.0) as u16;
        let row = (y / self.font.cell_height as f64).max(0.0) as u16;
        let grid = self.grid.lock().unwrap();
        (row.min(grid.rows.saturating_sub(1)), col.min(grid.cols.saturating_sub(1)))
    }
}

impl ApplicationHandler for NativeTerminal {
    fn resumed(&mut self, event_loop: &ActiveEventLoop) {
        if self.window.is_some() { return; }

        let attrs = Window::default_attributes()
            .with_title("Aether Terminal (Native)")
            .with_inner_size(winit::dpi::LogicalSize::new(1200, 700))
            .with_transparent(true)
            .with_decorations(false);

        let window = Arc::new(event_loop.create_window(attrs).expect("Failed to create window"));
        window.set_ime_allowed(true);

        // Enable Mica/Acrylic via DWM on Windows 11
        #[cfg(windows)]
        enable_mica_effect(&window);

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
            WindowEvent::Ime(ime_event) => {
                match ime_event {
                    winit::event::Ime::Enabled => {
                        self.update_ime_cursor_area();
                    }
                    winit::event::Ime::Preedit(text, _cursor_pos) => {
                        self.ime_state.set_composing(text);
                        self.update_ime_cursor_area();
                        // Mark grid for redraw to show composition indicator
                        self.grid.lock().unwrap().needs_redraw = true;
                    }
                    winit::event::Ime::Commit(text) => {
                        self.ime_state.commit();
                        self.write_to_pty(text.as_bytes());
                    }
                    winit::event::Ime::Disabled => {
                        self.ime_state.cancel();
                    }
                }
            }
            WindowEvent::ModifiersChanged(mods) => {
                self.modifiers = mods.state();
            }
            WindowEvent::MouseWheel { delta, .. } => {
                let lines = match delta {
                    winit::event::MouseScrollDelta::LineDelta(_, y) => y as i32,
                    winit::event::MouseScrollDelta::PixelDelta(pos) => (pos.y / self.font.cell_height as f64) as i32,
                };
                if lines != 0 {
                    let mut grid = self.grid.lock().unwrap();
                    // In alt screen (vim, less), send arrow keys instead of scrolling viewport
                    if grid.mode.alt_screen {
                        drop(grid);
                        let count = lines.unsigned_abs().max(1).min(10);
                        let seq = if lines > 0 { b"\x1b[A" } else { b"\x1b[B" };
                        for _ in 0..count { self.write_to_pty(seq); }
                    } else {
                        grid.scroll_viewport(-lines);
                    }
                }
            }
            WindowEvent::MouseInput { state, button: winit::event::MouseButton::Left, .. } => {
                if state.is_pressed() {
                    self.mouse_pressed = true;
                    // Start selection at current cursor position
                    // (actual position updated by CursorMoved)
                } else {
                    self.mouse_pressed = false;
                }
            }
            WindowEvent::CursorMoved { position, .. } => {
                let (row, col) = self.pixel_to_cell(position.x, position.y);
                if self.mouse_pressed {
                    let mut grid = self.grid.lock().unwrap();
                    if grid.selection.anchor.is_none() {
                        grid.selection.anchor = Some((row, col));
                    }
                    grid.selection.end = Some((row, col));
                    grid.needs_redraw = true;
                }
            }
            WindowEvent::KeyboardInput { event, .. } => {
                // Don't process key events during IME composition
                if self.ime_state.active { return; }
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

/// Enable Mica backdrop + extend frame for transparency on Windows 11.
#[cfg(windows)]
fn enable_mica_effect(window: &Window) {
    use raw_window_handle::HasWindowHandle;
    use windows::Win32::Foundation::HWND;
    use windows::Win32::Graphics::Dwm::{
        DwmSetWindowAttribute, DwmExtendFrameIntoClientArea,
        DWMWA_SYSTEMBACKDROP_TYPE, DWMWA_USE_IMMERSIVE_DARK_MODE, DWM_SYSTEMBACKDROP_TYPE,
    };
    use windows::Win32::UI::Controls::MARGINS;

    let handle = match window.window_handle() {
        Ok(h) => h,
        Err(_) => return,
    };
    let raw = handle.as_raw();
    let hwnd = match raw {
        raw_window_handle::RawWindowHandle::Win32(h) => HWND(h.hwnd.get() as *mut _),
        _ => return,
    };

    unsafe {
        // Dark mode
        let dark_mode: i32 = 1;
        let _ = DwmSetWindowAttribute(
            hwnd, DWMWA_USE_IMMERSIVE_DARK_MODE,
            &dark_mode as *const _ as *const _, 4,
        );

        // Extend frame into entire client area (required for Mica to show through)
        let margins = MARGINS { cxLeftWidth: -1, cxRightWidth: -1, cyTopHeight: -1, cyBottomHeight: -1 };
        let _ = DwmExtendFrameIntoClientArea(hwnd, &margins);

        // Enable Mica backdrop (2 = Mica, 3 = Acrylic, 4 = Mica Alt)
        let backdrop_type = DWM_SYSTEMBACKDROP_TYPE(2);
        let _ = DwmSetWindowAttribute(
            hwnd, DWMWA_SYSTEMBACKDROP_TYPE,
            &backdrop_type as *const _ as *const _,
            std::mem::size_of::<DWM_SYSTEMBACKDROP_TYPE>() as u32,
        );
    }
    log::info!("Mica backdrop + dark mode enabled");
}

fn main() {
    env_logger::init();
    let event_loop = EventLoop::new().expect("Failed to create event loop");
    let mut app = NativeTerminal::new();
    event_loop.run_app(&mut app).expect("Event loop error");
}
