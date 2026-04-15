//! Aether Terminal — Native Rust GPU renderer (no WebView2).
//!
//! Standalone terminal using winit + wgpu with custom UI chrome.
//! Phase 2: title bar, tab bar, status bar rendered via wgpu pipelines.
//!
//! Usage: cargo run --bin native-terminal

use std::sync::{Arc, Mutex};
use winit::application::ApplicationHandler;
use winit::event::WindowEvent;
use winit::event_loop::{ActiveEventLoop, EventLoop};
use winit::keyboard::{Key, NamedKey, ModifiersState};
use winit::window::{Window, WindowId};

use aether_terminal_lib::agent::interactive::AgentCli;
use aether_terminal_lib::agent::output_monitor::{self, DetectedStatus};
use aether_terminal_lib::config::{AppConfig, load_config, save_config};
use aether_terminal_lib::db::{Database, db_path};
use aether_terminal_lib::git;
use aether_terminal_lib::gpu::atlas::GlyphAtlas;
use aether_terminal_lib::gpu::font::FontManager;
use aether_terminal_lib::gpu::grid::{Grid, GridPerformer};
use aether_terminal_lib::gpu::ime::ImeState;
use aether_terminal_lib::gpu::renderer::{GlyphInstance, RectInstance, TerminalRenderer};
use aether_terminal_lib::lsp::{LspLanguage, LspManager, LspMessage};
use aether_terminal_lib::pty::{PtyManager, ShellType};
use aether_terminal_lib::ui::editor::{Diagnostic, DiagnosticSeverity, EditorState};
use aether_terminal_lib::ui::palette::{PaletteAction, PaletteState, WorktreeEntry};
use aether_terminal_lib::ui::scm::ScmState;
use aether_terminal_lib::ui::toast::ToastManager;
use aether_terminal_lib::ui::sidebar::SidebarState;
use aether_terminal_lib::ui::{self, ChromeAction, ChromeState, HitRegion};

/// What occupies the main content area.
enum ContentPane {
    Terminal,
    Editor(EditorState),
}

/// Agent status for display.
#[derive(Debug, Clone, PartialEq)]
enum AgentStatus {
    Idle,
    Thinking,
    Coding,
    Waiting,
    Done,
}

impl AgentStatus {
    fn label(&self) -> &'static str {
        match self {
            Self::Idle => "Idle",
            Self::Thinking => "Thinking...",
            Self::Coding => "Coding",
            Self::Waiting => "Needs Input",
            Self::Done => "Done",
        }
    }

    fn color(&self) -> [f32; 4] {
        match self {
            Self::Idle => [0.29, 0.87, 0.50, 1.0],      // Green
            Self::Thinking => [0.98, 0.75, 0.15, 1.0],   // Amber
            Self::Coding => [0.65, 0.89, 0.63, 1.0],     // Catppuccin green
            Self::Waiting => [0.95, 0.55, 0.66, 1.0],    // Pink
            Self::Done => [0.54, 0.71, 0.98, 1.0],       // Blue
        }
    }

    fn from_detected(d: &DetectedStatus) -> Self {
        match d {
            DetectedStatus::Thinking => Self::Thinking,
            DetectedStatus::Coding => Self::Coding,
            DetectedStatus::Idle => Self::Idle,
            DetectedStatus::Done => Self::Done,
            DetectedStatus::WaitingPermission => Self::Waiting,
            DetectedStatus::Unknown => Self::Idle,
        }
    }
}

/// Per-tab agent metadata (None for regular terminal tabs).
#[derive(Debug, Clone)]
struct AgentTabInfo {
    cli: AgentCli,
    status: AgentStatus,
    model: String,
    cost: f64,
    tokens_used: u64,
    started_at: std::time::Instant,
}

/// Status update from agent output monitor thread.
/// Uses PTY ID (not index) for stable identification across tab removals.
enum AgentUpdate {
    Status(String, AgentStatus),
    Usage(String, f64, u64),
}

/// Split direction for pane splitting.
#[derive(Clone, Copy, Debug)]
enum SplitDir {
    Horizontal, // left | right
    Vertical,   // top / bottom
}

/// A leaf pane — single terminal with its own PTY.
struct PaneLeaf {
    id: u32,
    pty_id: String,
    grid: Arc<Mutex<Grid>>,
    agent_info: Option<AgentTabInfo>,
}

/// Pane tree node — either a leaf or a split.
enum PaneNode {
    Leaf(PaneLeaf),
    Split {
        dir: SplitDir,
        ratio: f32,
        first: Box<PaneNode>,
        second: Box<PaneNode>,
    },
}

impl PaneNode {
    /// Find a leaf by pane ID.
    fn find_leaf(&self, id: u32) -> Option<&PaneLeaf> {
        match self {
            PaneNode::Leaf(leaf) => {
                if leaf.id == id { Some(leaf) } else { None }
            }
            PaneNode::Split { first, second, .. } => {
                first.find_leaf(id).or_else(|| second.find_leaf(id))
            }
        }
    }

    fn find_leaf_mut(&mut self, id: u32) -> Option<&mut PaneLeaf> {
        match self {
            PaneNode::Leaf(leaf) => {
                if leaf.id == id { Some(leaf) } else { None }
            }
            PaneNode::Split { first, second, .. } => {
                if let Some(l) = first.find_leaf_mut(id) {
                    Some(l)
                } else {
                    second.find_leaf_mut(id)
                }
            }
        }
    }

    /// Collect all leaf pane IDs (left-to-right / top-to-bottom order).
    fn leaf_ids(&self) -> Vec<u32> {
        match self {
            PaneNode::Leaf(leaf) => vec![leaf.id],
            PaneNode::Split { first, second, .. } => {
                let mut ids = first.leaf_ids();
                ids.extend(second.leaf_ids());
                ids
            }
        }
    }

    /// Collect all PTY IDs for cleanup.
    fn all_pty_ids(&self) -> Vec<String> {
        match self {
            PaneNode::Leaf(leaf) => vec![leaf.pty_id.clone()],
            PaneNode::Split { first, second, .. } => {
                let mut ids = first.all_pty_ids();
                ids.extend(second.all_pty_ids());
                ids
            }
        }
    }

    /// Apply a function to all leaves (for resize, etc.)
    fn for_each_leaf<F: FnMut(&PaneLeaf)>(&self, f: &mut F) {
        match self {
            PaneNode::Leaf(leaf) => f(leaf),
            PaneNode::Split { first, second, .. } => {
                first.for_each_leaf(f);
                second.for_each_leaf(f);
            }
        }
    }

    /// Split a leaf pane by ID, returning the new leaf's ID.
    fn split_leaf(
        &mut self,
        target_id: u32,
        dir: SplitDir,
        new_leaf: PaneLeaf,
    ) -> bool {
        match self {
            PaneNode::Leaf(leaf) if leaf.id == target_id => {
                // Replace this leaf with a split
                let old = std::mem::replace(
                    self,
                    PaneNode::Leaf(PaneLeaf {
                        id: 0,
                        pty_id: String::new(),
                        grid: Arc::new(Mutex::new(Grid::new(1, 1, 0))),
                        agent_info: None,
                    }),
                );
                *self = PaneNode::Split {
                    dir,
                    ratio: 0.5,
                    first: Box::new(old),
                    second: Box::new(PaneNode::Leaf(new_leaf)),
                };
                true
            }
            PaneNode::Split { first, second, .. } => {
                // Check which subtree contains the target before consuming new_leaf
                if first.find_leaf(target_id).is_some() {
                    first.split_leaf(target_id, dir, new_leaf)
                } else {
                    second.split_leaf(target_id, dir, new_leaf)
                }
            }
            _ => false,
        }
    }
}

/// Per-tab state: pane tree with focused pane tracking.
struct TabState {
    root: PaneNode,
    focused_pane_id: u32,
    next_pane_id: u32,
}

impl TabState {
    fn new_single(pty_id: String, grid: Arc<Mutex<Grid>>, agent_info: Option<AgentTabInfo>) -> Self {
        Self {
            root: PaneNode::Leaf(PaneLeaf { id: 0, pty_id, grid, agent_info }),
            focused_pane_id: 0,
            next_pane_id: 1,
        }
    }

    fn focused_leaf(&self) -> Option<&PaneLeaf> {
        self.root.find_leaf(self.focused_pane_id)
    }

    fn focused_leaf_mut(&mut self) -> Option<&mut PaneLeaf> {
        self.root.find_leaf_mut(self.focused_pane_id)
    }

    /// Cycle focus to the next pane.
    fn focus_next(&mut self) {
        let ids = self.root.leaf_ids();
        if let Some(pos) = ids.iter().position(|&id| id == self.focused_pane_id) {
            self.focused_pane_id = ids[(pos + 1) % ids.len()];
        }
    }

    /// Get the focused pane's grid.
    fn grid(&self) -> Option<&Arc<Mutex<Grid>>> {
        self.focused_leaf().map(|l| &l.grid)
    }

    /// Get the focused pane's PTY ID.
    fn pty_id(&self) -> Option<&str> {
        self.focused_leaf().map(|l| l.pty_id.as_str())
    }

    /// Get the focused pane's agent info.
    fn agent_info(&self) -> Option<&AgentTabInfo> {
        self.focused_leaf().and_then(|l| l.agent_info.as_ref())
    }
}

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
    tab_states: Vec<TabState>,
    atlas: Mutex<GlyphAtlas>,
    font: FontManager,
    pty_manager: PtyManager,
    ime_state: ImeState,
    modifiers: ModifiersState,
    mouse_pressed: bool,
    // UI Chrome
    chrome: ChromeState,
    sidebar: SidebarState,
    hit_regions: Vec<HitRegion>,
    palette: PaletteState,
    content_pane: ContentPane,
    // LSP
    lsp_manager: LspManager,
    lsp_receiver: std::sync::mpsc::Receiver<LspMessage>,
    lsp_request_id: u64,
    config: AppConfig,
    should_exit: bool,
    // Database
    db: Database,
    command_buffer: String,
    // Agent monitoring
    agent_tx: std::sync::mpsc::SyncSender<AgentUpdate>,
    agent_rx: std::sync::mpsc::Receiver<AgentUpdate>,
    // Context menu position (None = hidden)
    context_menu: Option<(f32, f32)>,
    // SCM panel
    scm: ScmState,
    // Toast notifications
    toasts: ToastManager,
}

impl NativeTerminal {
    fn new() -> Self {
        let config = load_config();
        let font_size = config.appearance.font_size as f32;
        let line_height = config.appearance.line_height;
        let font = FontManager::new(font_size, line_height);
        let (lsp_tx, lsp_rx) = std::sync::mpsc::channel();
        let (agent_tx, agent_rx) = std::sync::mpsc::sync_channel(512);
        let db = Database::open(&db_path()).unwrap_or_else(|e| {
            log::warn!("Failed to open DB, using in-memory: {}", e);
            Database::open_memory().expect("in-memory DB should always succeed")
        });
        Self {
            window: None,
            surface: None,
            device: None,
            queue: None,
            surface_config: None,
            renderer: None,
            tab_states: Vec::new(),
            atlas: Mutex::new(GlyphAtlas::new(2048, 2048)),
            font,
            pty_manager: PtyManager::new(),
            ime_state: ImeState::new(),
            modifiers: ModifiersState::empty(),
            mouse_pressed: false,
            chrome: ChromeState::new(),
            sidebar: SidebarState::new(),
            hit_regions: Vec::new(),
            palette: PaletteState::new(),
            content_pane: ContentPane::Terminal,
            lsp_manager: LspManager::new(lsp_tx),
            lsp_receiver: lsp_rx,
            lsp_request_id: 1,
            config,
            should_exit: false,
            db,
            command_buffer: String::new(),
            agent_tx,
            agent_rx,
            context_menu: None,
            scm: ScmState::new(),
            toasts: ToastManager::new(),
        }
    }

    fn init_wgpu(&mut self, window: Arc<Window>) {
        let size = window.inner_size();

        let instance = wgpu::Instance::new(&wgpu::InstanceDescriptor {
            backends: wgpu::Backends::DX12,
            ..Default::default()
        });

        let surface = instance
            .create_surface(window.clone())
            .expect("Failed to create surface");

        let adapter = pollster::block_on(instance.request_adapter(&wgpu::RequestAdapterOptions {
            power_preference: wgpu::PowerPreference::HighPerformance,
            compatible_surface: Some(&surface),
            force_fallback_adapter: false,
        }))
        .expect("No GPU adapter found");

        log::info!("GPU: {}", adapter.get_info().name);

        let (device, queue) = pollster::block_on(adapter.request_device(
            &wgpu::DeviceDescriptor {
                label: Some("aether_native"),
                ..Default::default()
            },
        ))
        .expect("Failed to create device");

        let device = Arc::new(device);
        let queue = Arc::new(queue);

        // Configure surface
        let mut config = surface
            .get_default_config(&adapter, size.width.max(1), size.height.max(1))
            .expect("Surface not supported");
        config.format = wgpu::TextureFormat::Bgra8Unorm;

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

        // Create terminal renderer
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

    /// Get the active tab's grid (if any).
    fn active_grid(&self) -> Option<&Arc<Mutex<Grid>>> {
        self.tab_states.get(self.chrome.active_tab).and_then(|t| t.grid())
    }

    /// Get the active tab's focused PTY ID (if any).
    fn active_pty_id(&self) -> Option<&str> {
        self.tab_states.get(self.chrome.active_tab).and_then(|t| t.pty_id())
    }

    /// Spawn a new PTY tab.
    fn spawn_pty(&mut self) {
        let shell = ShellType::PowerShell;
        let shell_name = "PowerShell".to_string();

        let size = self
            .window
            .as_ref()
            .map(|w| w.inner_size())
            .unwrap_or(winit::dpi::PhysicalSize::new(1200, 700));
        let content_w = size.width as f32 - self.sidebar.width();
        let content_h = (size.height as f32 - ui::CHROME_TOP - ui::STATUS_BAR_HEIGHT).max(1.0);
        let cols = (content_w / self.font.cell_width).max(1.0) as u16;
        let rows = (content_h / self.font.cell_height).max(1.0) as u16;

        let grid = Arc::new(Mutex::new(Grid::new(cols, rows, 10_000)));

        match self.pty_manager.spawn(&shell, cols, rows, None) {
            Ok(id) => {
                log::info!("PTY spawned: {} ({}x{})", id, cols, rows);
                if let Ok(reader) = self.pty_manager.take_reader(&id) {
                    let grid_clone = grid.clone();
                    std::thread::spawn(move || {
                        let mut reader = reader;
                        let mut parser = vte::Parser::new();
                        let mut buf = [0u8; 4096];
                        loop {
                            match std::io::Read::read(&mut reader, &mut buf) {
                                Ok(0) => break,
                                Ok(n) => {
                                    let mut g = match grid_clone.lock() {
                                        Ok(g) => g,
                                        Err(e) => e.into_inner(),
                                    };
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
                self.chrome.add_tab(id.clone(), shell_name, "PowerShell".into());
                self.tab_states.push(TabState::new_single(id, grid, None));
                // Switch to new tab
                self.chrome.active_tab = self.tab_states.len() - 1;
            }
            Err(e) => log::error!("Failed to spawn PTY: {}", e),
        }
    }

    /// Spawn an agent CLI in a new PTY tab with output monitoring.
    fn spawn_agent_pty(&mut self, cli: AgentCli, model: Option<&str>) {
        let (program, args) = cli.program_and_args(model);
        let cli_label = match &cli {
                AgentCli::Claude => "Claude",
                AgentCli::Codex => "Codex",
                AgentCli::Gemini => "Gemini",
                AgentCli::Custom(s) => s.as_str(),
            }.to_string();

        let size = self
            .window
            .as_ref()
            .map(|w| w.inner_size())
            .unwrap_or(winit::dpi::PhysicalSize::new(1200, 700));
        let content_w = size.width as f32 - self.sidebar.width();
        let content_h = (size.height as f32 - ui::CHROME_TOP - ui::STATUS_BAR_HEIGHT).max(1.0);
        let cols = (content_w / self.font.cell_width).max(1.0) as u16;
        let rows = (content_h / self.font.cell_height).max(1.0) as u16;

        let grid = Arc::new(Mutex::new(Grid::new(cols, rows, 10_000)));

        match self.pty_manager.spawn_command(&program, &args, cols, rows, None, None) {
            Ok(id) => {
                log::info!("Agent PTY spawned: {} ({}) {}x{}", id, cli_label, cols, rows);
                if let Ok(reader) = self.pty_manager.take_reader(&id) {
                    let grid_clone = grid.clone();
                    let agent_tx = self.agent_tx.clone();
                    let pty_id_clone = id.clone();
                    let parser = output_monitor::create_parser(&cli);
                    std::thread::spawn(move || {
                        let mut reader = reader;
                        let mut vte_parser = vte::Parser::new();
                        let mut buf = [0u8; 4096];
                        loop {
                            match std::io::Read::read(&mut reader, &mut buf) {
                                Ok(0) => break,
                                Ok(n) => {
                                    // Feed VTE parser for grid rendering
                                    let mut g = match grid_clone.lock() {
                                        Ok(g) => g,
                                        Err(_) => break, // mutex poisoned — exit cleanly
                                    };
                                    let mut performer = GridPerformer { grid: &mut g };
                                    for byte in &buf[..n] {
                                        vte_parser.advance(&mut performer, *byte);
                                    }
                                    g.needs_redraw = true;
                                    drop(g);

                                    // Feed agent output parser
                                    let text = String::from_utf8_lossy(&buf[..n]);
                                    let stripped = output_monitor::strip_ansi(&text);
                                    let result = parser.parse_chunk(&stripped);
                                    if let Some(status) = result.status {
                                        if agent_tx.send(AgentUpdate::Status(
                                            pty_id_clone.clone(),
                                            AgentStatus::from_detected(&status),
                                        )).is_err() {
                                            break;
                                        }
                                    }
                                    if result.usage.cost.is_some() || result.usage.tokens.is_some()
                                    {
                                        if agent_tx.send(AgentUpdate::Usage(
                                            pty_id_clone.clone(),
                                            result.usage.cost.unwrap_or(0.0),
                                            result.usage.tokens.unwrap_or(0),
                                        )).is_err() {
                                            break;
                                        }
                                    }
                                }
                                Err(_) => break,
                            }
                        }
                        // Agent exited
                        let _ = agent_tx.send(AgentUpdate::Status(pty_id_clone, AgentStatus::Done));
                    });
                }
                let model_display = model.unwrap_or("default").to_string();
                let tab_name = format!("{} ({})", cli_label, model_display);
                self.chrome
                    .add_tab(id.clone(), tab_name, cli_label.clone());
                self.tab_states.push(TabState::new_single(
                    id,
                    grid,
                    Some(AgentTabInfo {
                        cli,
                        status: AgentStatus::Idle,
                        model: model_display,
                        cost: 0.0,
                        tokens_used: 0,
                        started_at: std::time::Instant::now(),
                    }),
                ));
                self.chrome.active_tab = self.tab_states.len() - 1;
                self.content_pane = ContentPane::Terminal;
            }
            Err(e) => log::error!("Failed to spawn agent PTY: {}", e),
        }
    }

    fn render(&mut self) {
        let surface = match &self.surface {
            Some(s) => s,
            None => return,
        };
        let renderer = match &self.renderer {
            Some(r) => r,
            None => return,
        };
        let config = match &self.surface_config {
            Some(c) => c,
            None => return,
        };
        let window_w = config.width as f32;
        let window_h = config.height as f32;

        let sidebar_w = self.sidebar.width();

        // --- Set status bar override for editor mode ---
        self.chrome.status_override = match &self.content_pane {
            ContentPane::Editor(editor) => {
                let modified_marker = if editor.modified { " [+]" } else { "" };
                Some(ui::StatusOverride {
                    label: format!("{}{}", editor.file_name, modified_marker),
                    detail: format!(
                        "Ln {}, Col {}",
                        editor.cursor_line + 1,
                        editor.cursor_col + 1
                    ),
                    indicator: "UTF-8".to_string(),
                })
            }
            ContentPane::Terminal => {
                // Show agent info in status bar when on an agent tab
                self.active_agent_info().map(|info| {
                    let elapsed = info.started_at.elapsed();
                    let mins = elapsed.as_secs() / 60;
                    let secs = elapsed.as_secs() % 60;
                    let cli_name = match &info.cli {
                        AgentCli::Claude => "Claude",
                        AgentCli::Codex => "Codex",
                        AgentCli::Gemini => "Gemini",
                        AgentCli::Custom(s) => s.as_str(),
                    };
                    ui::StatusOverride {
                        label: format!(
                            "{} ({}) — {}",
                            cli_name,
                            info.model,
                            info.status.label()
                        ),
                        detail: format!("${:.4}  {}tok  {}:{:02}", info.cost, info.tokens_used, mins, secs),
                        indicator: info.status.label().to_string(),
                    }
                })
            }
        };

        // --- Build chrome instances ---
        let mut atlas = self.atlas.lock().unwrap();
        let chrome_out = self.chrome.build(&self.font, &mut atlas, window_w, window_h);
        self.hit_regions = chrome_out.hits;

        // --- Build sidebar instances ---
        let sidebar_out = self.sidebar.build(
            &self.font,
            &mut atlas,
            ui::CHROME_TOP,
            window_h,
            self.chrome.mouse_pos,
        );

        // --- Build content instances (terminal or editor) ---
        let content_w = window_w - sidebar_w;
        let content_h = window_h - ui::CHROME_TOP - ui::STATUS_BAR_HEIGHT;
        let (content_rects, content_glyphs) = match &mut self.content_pane {
            ContentPane::Terminal => {
                let mut all_r = Vec::new();
                let mut all_g = Vec::new();
                if let Some(tab) = self.tab_states.get(self.chrome.active_tab) {
                    Self::render_pane_tree(
                        &tab.root,
                        tab.focused_pane_id,
                        &self.font,
                        &mut atlas,
                        sidebar_w,
                        ui::CHROME_TOP,
                        content_w,
                        content_h,
                        &mut all_r,
                        &mut all_g,
                    );
                }
                (all_r, all_g)
            }
            ContentPane::Editor(editor) => {
                editor.refresh_syntax();
                let out = editor.build(
                    &self.font,
                    &mut atlas,
                    sidebar_w,
                    ui::CHROME_TOP,
                    content_w,
                    content_h,
                );
                (out.rects, out.glyphs)
            }
        };

        // --- Build agent panel (inside sidebar, bottom section) ---
        let (agent_rects, agent_glyphs) =
            self.build_agent_panel(&self.font, &mut atlas, window_h);

        // --- Build SCM panel (if sidebar visible) ---
        let (scm_rects, scm_glyphs) = if self.sidebar.visible {
            let scm_y = window_h - ui::STATUS_BAR_HEIGHT - 300.0;
            self.scm.build(&self.font, &mut atlas, 0.0, scm_y.max(ui::CHROME_TOP + 200.0), sidebar_w, 280.0)
        } else {
            (Vec::new(), Vec::new())
        };

        // --- Build context menu ---
        let (ctx_rects, ctx_glyphs) = self.build_context_menu(&self.font, &mut atlas);

        // --- Build palette overlay ---
        let palette_out = self.palette.build(&self.font, &mut atlas, window_w);

        // --- Build toast notifications ---
        let (toast_rects, toast_glyphs) = self.toasts.build(&self.font, &mut atlas, window_w, window_h);

        // Upload atlas if dirty
        if atlas.dirty {
            renderer.upload_atlas(&atlas);
            atlas.clear_dirty();
        }
        drop(atlas);

        // --- Combine all layers ---
        let mut all_rects = chrome_out.rects;
        all_rects.extend(sidebar_out.rects);
        all_rects.extend(scm_rects);
        all_rects.extend(agent_rects);
        all_rects.extend(content_rects);
        all_rects.extend(ctx_rects);
        all_rects.extend(palette_out.rects);
        all_rects.extend(toast_rects);
        let mut all_glyphs = chrome_out.glyphs;
        all_glyphs.extend(sidebar_out.glyphs);
        all_glyphs.extend(scm_glyphs);
        all_glyphs.extend(agent_glyphs);
        all_glyphs.extend(content_glyphs);
        all_glyphs.extend(ctx_glyphs);
        all_glyphs.extend(palette_out.glyphs);
        all_glyphs.extend(toast_glyphs);

        // --- GPU render ---
        match surface.get_current_texture() {
            Ok(texture) => {
                let view = texture
                    .texture
                    .create_view(&wgpu::TextureViewDescriptor::default());
                renderer.render_frame(
                    &view,
                    &all_glyphs,
                    &all_rects,
                    wgpu::Color {
                        r: 0.0,
                        g: 0.0,
                        b: 0.0,
                        a: 0.75,
                    },
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

    fn handle_chrome_action(&mut self, action: ChromeAction) {
        match action {
            ChromeAction::Close => {
                self.save_session();
                for tab in &self.tab_states {
                    for pty_id in tab.root.all_pty_ids() {
                        let _ = self.pty_manager.close(&pty_id);
                    }
                }
                self.should_exit = true;
            }
            ChromeAction::Minimize => {
                if let Some(window) = &self.window {
                    window.set_minimized(true);
                }
            }
            ChromeAction::ToggleMaximize => {
                if let Some(window) = &self.window {
                    let is_max = window.is_maximized();
                    window.set_maximized(!is_max);
                    self.chrome.is_maximized = !is_max;
                }
            }
            ChromeAction::DragWindow => {
                if let Some(window) = &self.window {
                    let _ = window.drag_window();
                }
            }
            ChromeAction::NewTab => {
                self.spawn_pty();
                self.content_pane = ContentPane::Terminal;
            }
            ChromeAction::CloseTab(idx) => {
                if self.chrome.tabs.len() <= 1 {
                    // Last tab — close window
                    for tab in &self.tab_states {
                        for pty_id in tab.root.all_pty_ids() {
                            let _ = self.pty_manager.close(&pty_id);
                        }
                    }
                    self.should_exit = true;
                } else if idx < self.tab_states.len() {
                    // Close this tab's all PTYs and remove state
                    for pty_id in self.tab_states[idx].root.all_pty_ids() {
                        let _ = self.pty_manager.close(&pty_id);
                    }
                    self.tab_states.remove(idx);
                    self.chrome.tabs.remove(idx);
                    if self.chrome.active_tab >= self.chrome.tabs.len() {
                        self.chrome.active_tab = self.chrome.tabs.len().saturating_sub(1);
                    }
                }
            }
            ChromeAction::SwitchTab(idx) => {
                if idx < self.chrome.tabs.len() {
                    self.chrome.active_tab = idx;
                    self.content_pane = ContentPane::Terminal;
                }
            }
        }
    }

    fn update_ime_cursor_area(&self) {
        let window = match &self.window {
            Some(w) => w,
            None => return,
        };
        let grid_arc = match self.active_grid() {
            Some(g) => g.clone(),
            None => return,
        };
        let grid = grid_arc.lock().unwrap();
        let x = grid.cursor.col as f64 * self.font.cell_width as f64;
        let y = grid.cursor.row as f64 * self.font.cell_height as f64 + ui::CHROME_TOP as f64;
        let size = winit::dpi::LogicalSize::new(
            self.font.cell_width as f64,
            self.font.cell_height as f64,
        );
        window.set_ime_cursor_area(winit::dpi::LogicalPosition::new(x, y), size);
    }

    fn write_to_pty(&self, data: &[u8]) {
        if let Some(id) = self.active_pty_id() {
            let _ = self.pty_manager.write(id, data);
        }
    }

    fn handle_key_input(&mut self, key: Key) {
        let ctrl = self.modifiers.contains(ModifiersState::CONTROL);
        let shift = self.modifiers.contains(ModifiersState::SHIFT);

        // Ctrl+Shift+P: Toggle command palette (works in all modes)
        if ctrl && shift {
            if let Key::Character(ref c) = key {
                match c.to_lowercase().as_str() {
                    "p" => { self.palette.toggle(); return; }
                    "h" => { self.split_focused_pane(SplitDir::Horizontal); return; }
                    "v" => { self.split_focused_pane(SplitDir::Vertical); return; }
                    _ => {}
                }
            }
        }

        // Alt+Arrow: Switch focus between panes
        if self.modifiers.contains(ModifiersState::ALT) {
            if matches!(key, Key::Named(NamedKey::Tab)) {
                if let Some(tab) = self.tab_states.get_mut(self.chrome.active_tab) {
                    tab.focus_next();
                }
                return;
            }
        }

        // Handle palette input when open
        if self.palette.visible {
            self.handle_palette_key(key);
            return;
        }

        // Ctrl+B: Toggle sidebar (works in all modes)
        if ctrl {
            if let Key::Character(ref c) = key {
                if c.eq_ignore_ascii_case("b") {
                    self.sidebar.toggle();
                    if self.sidebar.visible {
                        if let Some(path) = self.repo_path() {
                            self.scm.set_repo(path);
                        }
                    }
                    self.recalc_grid_size();
                    return;
                }
            }
        }

        // Dispatch by content pane
        if matches!(self.content_pane, ContentPane::Editor(_)) {
            self.handle_editor_key(key, ctrl, shift);
            return;
        }

        // --- Terminal mode ---

        // Ctrl+P: Quick open file
        if ctrl {
            if let Key::Character(ref c) = key {
                if c.eq_ignore_ascii_case("p") && !shift {
                    self.open_quick_file_search();
                    return;
                }
            }
        }

        // Ctrl+R: Open command history search
        if ctrl {
            if let Key::Character(ref c) = key {
                if c.eq_ignore_ascii_case("r") {
                    self.execute_palette_action(PaletteAction::BeginCommandHistory);
                    return;
                }
            }
        }

        // Ctrl+Shift+F: Terminal text search
        if ctrl && shift {
            if let Key::Character(ref c) = key {
                if c.eq_ignore_ascii_case("f") {
                    self.palette.enter_terminal_search();
                    return;
                }
            }
        }

        // Ctrl+Shift+C: Copy selection
        if ctrl && shift {
            if let Key::Character(ref c) = key {
                if c.eq_ignore_ascii_case("c") {
                    let text = self.active_grid().map(|g| g.lock().unwrap().selected_text()).unwrap_or_default();
                    if !text.is_empty() {
                        if let Ok(mut clip) = arboard::Clipboard::new() {
                            let _ = clip.set_text(&text);
                        }
                    }
                    return;
                }
            }
        }

        // Ctrl+V: Paste
        if ctrl {
            if let Key::Character(ref c) = key {
                if c.eq_ignore_ascii_case("v") {
                    if let Ok(mut clip) = arboard::Clipboard::new() {
                        if let Ok(text) = clip.get_text() {
                            let bracketed = self.active_grid()
                                .map(|g| g.lock().unwrap().mode.bracketed_paste)
                                .unwrap_or(false);
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
                // Ctrl+C: SIGINT — also clear command buffer
                if c.eq_ignore_ascii_case("c") {
                    self.command_buffer.clear();
                    self.write_to_pty(&[0x03]);
                    return;
                }
            }
        }

        // Reset viewport on keyboard input
        if let Some(g) = self.active_grid() { g.lock().unwrap().reset_viewport(); }

        let data = match key {
            Key::Character(ref c) if !ctrl => {
                self.command_buffer.push_str(c);
                c.to_string().into_bytes()
            }
            Key::Named(NamedKey::Enter) => {
                let cmd = self.command_buffer.trim().to_string();
                if !cmd.is_empty() {
                    let pty_id = self.active_pty_id().unwrap_or("?").to_string();
                    let cwd = std::env::current_dir()
                        .map(|p| p.to_string_lossy().into_owned())
                        .unwrap_or_default();
                    if let Err(e) = self.db.save_command(&pty_id, &cmd, &cwd) {
                        log::trace!("Command history save: {}", e);
                    }
                }
                self.command_buffer.clear();
                vec![b'\r']
            }
            Key::Named(NamedKey::Backspace) => {
                self.command_buffer.pop();
                vec![0x7f]
            }
            Key::Named(NamedKey::Tab) => {
                // Tab completion invalidates our command buffer
                self.command_buffer.clear();
                vec![b'\t']
            }
            Key::Named(NamedKey::Escape) => vec![0x1b],
            Key::Named(NamedKey::ArrowUp) | Key::Named(NamedKey::ArrowDown) => {
                // Shell history navigation replaces the command
                self.command_buffer.clear();
                match key {
                    Key::Named(NamedKey::ArrowUp) => b"\x1b[A".to_vec(),
                    _ => b"\x1b[B".to_vec(),
                }
            }
            Key::Named(NamedKey::ArrowRight) => b"\x1b[C".to_vec(),
            Key::Named(NamedKey::ArrowLeft) => b"\x1b[D".to_vec(),
            Key::Named(NamedKey::Home) => b"\x1b[H".to_vec(),
            Key::Named(NamedKey::End) => b"\x1b[F".to_vec(),
            Key::Named(NamedKey::Delete) => b"\x1b[3~".to_vec(),
            _ => return,
        };
        self.write_to_pty(&data);
    }

    /// Handle key input when in editor mode.
    fn handle_editor_key(&mut self, key: Key, ctrl: bool, shift: bool) {
        // Escape: close find bar first, then back to terminal
        if matches!(key, Key::Named(NamedKey::Escape)) {
            if let ContentPane::Editor(editor) = &mut self.content_pane {
                if editor.find.active {
                    editor.find.active = false;
                    return;
                }
            }
            self.content_pane = ContentPane::Terminal;
            log::info!("Back to terminal");
            return;
        }

        let content_h = self
            .surface_config
            .as_ref()
            .map(|c| c.height as f32 - ui::CHROME_TOP - ui::STATUS_BAR_HEIGHT)
            .unwrap_or(400.0);

        if let ContentPane::Editor(editor) = &mut self.content_pane {
            let visible = editor.visible_count(content_h, self.font.cell_height);

            // Ctrl+F / Ctrl+H: toggle find/replace
            if ctrl {
                if let Key::Character(ref c) = key {
                    if c.eq_ignore_ascii_case("f") {
                        editor.toggle_find();
                        return;
                    }
                    if c.eq_ignore_ascii_case("h") {
                        editor.toggle_replace();
                        return;
                    }
                }
            }

            // Handle find bar input when active
            if editor.find.active {
                match key {
                    Key::Named(NamedKey::Enter) => {
                        if editor.find.focus == 0 {
                            if shift {
                                editor.find_prev(visible);
                            } else {
                                editor.find_next(visible);
                            }
                        } else {
                            editor.replace_current();
                        }
                    }
                    Key::Named(NamedKey::Tab) => {
                        // Toggle between find and replace fields
                        if editor.find.show_replace {
                            editor.find.focus = if editor.find.focus == 0 { 1 } else { 0 };
                        }
                    }
                    Key::Named(NamedKey::Backspace) => editor.find_backspace(),
                    Key::Character(ref c) if !ctrl => editor.find_insert_char(c),
                    _ => {}
                }
                return;
            }

            // Ctrl shortcuts
            if ctrl {
                if let Key::Character(ref c) = key {
                    match c.as_str() {
                        "s" | "S" => {
                            match editor.save() {
                                Ok(()) => log::info!("File saved"),
                                Err(e) => log::error!("Save failed: {}", e),
                            }
                            return;
                        }
                        "z" | "Z" => {
                            if shift {
                                editor.redo();
                            } else {
                                editor.undo();
                            }
                            editor.reset_blink();
                            return;
                        }
                        _ => {}
                    }
                }
            }

            // Navigation and editing keys
            match key {
                Key::Named(NamedKey::ArrowUp) => editor.move_up(visible),
                Key::Named(NamedKey::ArrowDown) => editor.move_down(visible),
                Key::Named(NamedKey::ArrowLeft) => editor.move_left(visible),
                Key::Named(NamedKey::ArrowRight) => editor.move_right(visible),
                Key::Named(NamedKey::PageUp) => editor.page_up(visible),
                Key::Named(NamedKey::PageDown) => editor.page_down(visible),
                Key::Named(NamedKey::Home) => editor.move_home(),
                Key::Named(NamedKey::End) => editor.move_end(),
                Key::Named(NamedKey::Enter) => editor.insert_newline(),
                Key::Named(NamedKey::Backspace) => editor.delete_backward(),
                Key::Named(NamedKey::Delete) => editor.delete_forward(),
                Key::Named(NamedKey::Tab) => editor.insert_tab(),
                Key::Character(ref c) if !ctrl => {
                    editor.insert_text(c);
                }
                _ => return, // skip blink reset for unhandled keys
            }
            editor.reset_blink();
        }
    }

    /// Handle key input when command palette is open.
    fn handle_palette_key(&mut self, key: Key) {
        match key {
            Key::Named(NamedKey::Escape) => {
                // Clear terminal search on close
                if let Some(g) = self.active_grid() {
                    if let Ok(mut grid) = g.lock() {
                        if grid.search_query.is_some() {
                            grid.search_query = None;
                            grid.needs_redraw = true;
                        }
                    }
                }
                self.palette.close();
            }
            Key::Named(NamedKey::Enter) => {
                let action = self.palette.execute();
                self.execute_palette_action(action);
            }
            Key::Named(NamedKey::ArrowUp) => self.palette.select_up(),
            Key::Named(NamedKey::ArrowDown) => self.palette.select_down(),
            Key::Named(NamedKey::Backspace) => self.palette.backspace(),
            Key::Character(ref c) => self.palette.insert_char(c),
            _ => {}
        }
    }

    /// Execute a palette action.
    fn execute_palette_action(&mut self, action: PaletteAction) {
        match action {
            PaletteAction::NewTab => self.spawn_pty(),
            PaletteAction::CloseTab => {
                let idx = self.chrome.active_tab;
                self.handle_chrome_action(ChromeAction::CloseTab(idx));
            }
            PaletteAction::ToggleSidebar => {
                self.sidebar.toggle();
                self.recalc_grid_size();
            }
            PaletteAction::SaveFile => {
                if let ContentPane::Editor(editor) = &mut self.content_pane {
                    let _ = editor.save();
                }
            }
            PaletteAction::CloseEditor => {
                self.content_pane = ContentPane::Terminal;
            }
            PaletteAction::BeginWorktreeCreate => {
                self.palette.enter_worktree_create();
            }
            PaletteAction::BeginWorktreeSwitch => {
                let entries = self.list_worktree_entries();
                if entries.is_empty() {
                    log::warn!("No worktrees found (not a git repo?)");
                    self.palette.close();
                    return;
                }
                self.palette.enter_worktree_select(entries, false);
            }
            PaletteAction::BeginWorktreeDelete => {
                let entries = self.list_worktree_entries();
                if entries.is_empty() {
                    log::warn!("No worktrees found (not a git repo?)");
                    self.palette.close();
                    return;
                }
                self.palette.enter_worktree_select(entries, true);
            }
            PaletteAction::DoWorktreeCreate(branch) => {
                self.do_create_worktree(&branch);
            }
            PaletteAction::DoWorktreeSwitch(path) => {
                self.do_switch_worktree(&path);
            }
            PaletteAction::DoWorktreeDelete(name) => {
                self.do_delete_worktree(&name);
            }
            PaletteAction::BeginCommandHistory => {
                match self.db.recent_commands(100) {
                    Ok(commands) if !commands.is_empty() => {
                        self.palette.enter_command_history(commands);
                    }
                    _ => {
                        log::info!("No command history yet");
                        self.palette.close();
                    }
                }
            }
            PaletteAction::RunCommand(cmd) => {
                self.content_pane = ContentPane::Terminal;
                self.write_to_pty(cmd.as_bytes());
                self.write_to_pty(b"\r");
            }
            PaletteAction::ScmStageAll => {
                if let Some(path) = self.repo_path() {
                    let _ = std::process::Command::new("git").args(["add", "-A"]).current_dir(&path).output();
                    self.scm.refresh();
                    self.toasts.success("All files staged");
                }
            }
            PaletteAction::ScmCommit => {
                // Reuse WorktreeCreate mode for commit message input
                // The input text will be used as commit message
                self.palette.enter_agent_spawn("__commit__".to_string());
            }
            PaletteAction::ScmPush => {
                if let Some(path) = self.repo_path() {
                    match std::process::Command::new("git").args(["push"]).current_dir(&path).output() {
                        Ok(out) if out.status.success() => self.toasts.success("Pushed to remote"),
                        Ok(out) => self.toasts.error(format!("Push failed: {}", String::from_utf8_lossy(&out.stderr))),
                        Err(e) => self.toasts.error(format!("Push error: {}", e)),
                    }
                }
            }
            PaletteAction::PrList => {
                if let Some(path) = self.repo_path() {
                    match std::process::Command::new("gh")
                        .args(["pr", "list", "--json", "number,title", "--limit", "10"])
                        .current_dir(&path)
                        .output()
                    {
                        Ok(out) if out.status.success() => {
                            if let Ok(prs) = serde_json::from_slice::<Vec<serde_json::Value>>(&out.stdout) {
                                let items: Vec<String> = prs.iter().map(|pr| {
                                    format!("#{} {}",
                                        pr.get("number").and_then(|n| n.as_u64()).unwrap_or(0),
                                        pr.get("title").and_then(|t| t.as_str()).unwrap_or("")
                                    )
                                }).collect();
                                if items.is_empty() {
                                    self.toasts.info("No pull requests found");
                                } else {
                                    self.palette.enter_settings(items, "pr_select".to_string());
                                }
                            }
                        }
                        _ => self.toasts.info("gh CLI not available or no PRs"),
                    }
                }
            }
            PaletteAction::WorkflowList => {
                if let Some(path) = self.repo_path() {
                    let workflows = aether_terminal_lib::workflow::list_workflow_files(&path);
                    if workflows.is_empty() {
                        self.toasts.info("No workflows found in .aether/workflows/");
                    } else {
                        let items: Vec<String> = workflows
                            .iter()
                            .map(|w| format!("{} ({} phases)", w.name, w.phase_count))
                            .collect();
                        self.palette.enter_settings(items, "wf_start".to_string());
                    }
                }
            }
            PaletteAction::WorkflowStatus => {
                self.toasts.info("Use 'Workflow: List' to start a workflow");
            }
            PaletteAction::OpenSettings => {
                // Show settings categories
                let items = vec![
                    "Theme".to_string(),
                    "Font Size".to_string(),
                    "Opacity".to_string(),
                ];
                self.palette.enter_settings(items, "root".to_string());
            }
            PaletteAction::ChangeSetting { category, value } => {
                self.apply_setting(&category, &value);
            }
            PaletteAction::BeginAgentClaude => {
                self.palette.enter_agent_spawn("claude".to_string());
            }
            PaletteAction::BeginAgentCodex => {
                self.palette.enter_agent_spawn("codex".to_string());
            }
            PaletteAction::BeginAgentGemini => {
                self.palette.enter_agent_spawn("gemini".to_string());
            }
            PaletteAction::OpenFile(path) => {
                // Resolve relative paths against sidebar root or cwd
                let base = self
                    .sidebar
                    .file_tree
                    .as_ref()
                    .map(|ft| ft.root.clone())
                    .or_else(|| std::env::current_dir().ok())
                    .unwrap_or_default();
                let path_buf = base.join(&path);
                match EditorState::open(&path_buf) {
                    Ok(editor) => {
                        log::info!("Quick open: {}", editor.file_name);
                        self.try_start_lsp(&path_buf);
                        self.content_pane = ContentPane::Editor(editor);
                    }
                    Err(e) => log::warn!("Cannot open file: {}", e),
                }
            }
            PaletteAction::SearchTerminal(query) => {
                if let Some(g) = self.active_grid() {
                    let mut grid = g.lock().unwrap();
                    grid.search_query = if query.is_empty() { None } else { Some(query) };
                    grid.needs_redraw = true;
                }
            }
            PaletteAction::SpawnAgent { cli, model } => {
                // Special case: commit message input
                if cli == "__commit__" {
                    if !model.is_empty() {
                        if let Some(path) = self.repo_path() {
                            match std::process::Command::new("git")
                                .args(["commit", "-m", &model])
                                .current_dir(&path)
                                .output()
                            {
                                Ok(out) if out.status.success() => {
                                    self.toasts.success("Committed");
                                    self.scm.refresh();
                                }
                                Ok(out) => self.toasts.error(String::from_utf8_lossy(&out.stderr).to_string()),
                                Err(e) => self.toasts.error(format!("Commit: {}", e)),
                            }
                        }
                    }
                    return;
                }
                let agent_cli = AgentCli::from_model(&cli);
                if let Err(e) = agent_cli.validate() {
                    log::error!("Agent CLI validation failed: {}", e);
                    return;
                }
                // Validate model name: alphanumeric, hyphens, dots, underscores only
                let model_opt = if model.is_empty() {
                    None
                } else if model.len() > 64
                    || !model.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '.' || c == '_')
                {
                    log::error!("Invalid model name: {}", model);
                    return;
                } else {
                    Some(model.as_str())
                };
                self.spawn_agent_pty(agent_cli, model_opt);
            }
            PaletteAction::None => {}
        }
    }

    /// Get the repo path from sidebar root or current directory.
    fn repo_path(&self) -> Option<String> {
        self.sidebar
            .file_tree
            .as_ref()
            .map(|ft| ft.root.to_string_lossy().into_owned())
            .or_else(|| {
                std::env::current_dir()
                    .ok()
                    .map(|p| p.to_string_lossy().into_owned())
            })
    }

    /// List worktree entries for palette selection.
    fn list_worktree_entries(&self) -> Vec<WorktreeEntry> {
        let repo_path = match self.repo_path() {
            Some(p) => p,
            None => return Vec::new(),
        };
        match git::list_worktrees(&repo_path) {
            Ok(worktrees) => worktrees
                .into_iter()
                .map(|wt| WorktreeEntry {
                    name: wt.name,
                    path: wt.path,
                    branch: wt.branch,
                    is_main: wt.is_main,
                })
                .collect(),
            Err(e) => {
                log::warn!("Failed to list worktrees: {}", e);
                Vec::new()
            }
        }
    }

    /// Create a worktree and switch to it.
    fn do_create_worktree(&mut self, branch: &str) {
        let repo_path = match self.repo_path() {
            Some(p) => p,
            None => {
                log::warn!("No repo path for worktree creation");
                return;
            }
        };
        match git::create_worktree(&repo_path, branch) {
            Ok(info) => {
                log::info!("Worktree created: {} at {}", info.name, info.path);
                self.do_switch_worktree(&info.path);
            }
            Err(e) => {
                log::error!("Failed to create worktree: {}", e);
            }
        }
    }

    /// Switch sidebar root to a worktree path.
    fn do_switch_worktree(&mut self, path: &str) {
        let path_buf = std::path::Path::new(path).to_path_buf();
        if path_buf.exists() {
            self.sidebar.set_root(path_buf);
            self.content_pane = ContentPane::Terminal;
            self.recalc_grid_size();
            log::info!("Switched to worktree: {}", path);
        } else {
            log::warn!("Worktree path does not exist: {}", path);
        }
    }

    /// Delete a worktree by name.
    fn do_delete_worktree(&mut self, name: &str) {
        let repo_path = match self.repo_path() {
            Some(p) => p,
            None => return,
        };
        match git::remove_worktree(&repo_path, name, false) {
            Ok(()) => log::info!("Worktree deleted: {}", name),
            Err(e) => log::error!("Failed to delete worktree: {}", e),
        }
    }

    /// Recursively render a pane tree at the given screen rect.
    fn render_pane_tree(
        node: &PaneNode,
        focused_id: u32,
        font: &FontManager,
        atlas: &mut GlyphAtlas,
        x: f32,
        y: f32,
        w: f32,
        h: f32,
        rects: &mut Vec<RectInstance>,
        glyphs: &mut Vec<GlyphInstance>,
    ) {
        match node {
            PaneNode::Leaf(leaf) => {
                let mut grid = leaf.grid.lock().unwrap();
                let mut term_glyphs =
                    aether_terminal_lib::gpu::build_glyph_instances(&grid, font, atlas);
                let mut term_rects = aether_terminal_lib::gpu::build_bg_rects(&grid, font);
                let is_focused = leaf.id == focused_id;
                term_rects.extend(aether_terminal_lib::gpu::build_cursor_rects(
                    &grid, font, is_focused,
                ));
                for g in &mut term_glyphs {
                    g.pos[0] += x;
                    g.pos[1] += y;
                }
                for r in &mut term_rects {
                    r.pos[0] += x;
                    r.pos[1] += y;
                }
                grid.clear_dirty();
                rects.extend(term_rects);
                glyphs.extend(term_glyphs);

                // Draw focus border for non-single panes
                if is_focused {
                    // Thin border at top
                    rects.push(RectInstance {
                        pos: [x, y],
                        size: [w, 1.0],
                        color: ui::cat::pm(137, 180, 250, 120),
                    });
                }
            }
            PaneNode::Split { dir, ratio, first, second } => {
                match dir {
                    SplitDir::Horizontal => {
                        let first_w = (w * ratio).floor();
                        let divider = 2.0;
                        let second_w = w - first_w - divider;
                        Self::render_pane_tree(first, focused_id, font, atlas, x, y, first_w, h, rects, glyphs);
                        // Divider
                        rects.push(RectInstance {
                            pos: [x + first_w, y],
                            size: [divider, h],
                            color: ui::cat::pm(69, 71, 90, 200),
                        });
                        Self::render_pane_tree(second, focused_id, font, atlas, x + first_w + divider, y, second_w, h, rects, glyphs);
                    }
                    SplitDir::Vertical => {
                        let first_h = (h * ratio).floor();
                        let divider = 2.0;
                        let second_h = h - first_h - divider;
                        Self::render_pane_tree(first, focused_id, font, atlas, x, y, w, first_h, rects, glyphs);
                        // Divider
                        rects.push(RectInstance {
                            pos: [x, y + first_h],
                            size: [w, divider],
                            color: ui::cat::pm(69, 71, 90, 200),
                        });
                        Self::render_pane_tree(second, focused_id, font, atlas, x, y + first_h + divider, w, second_h, rects, glyphs);
                    }
                }
            }
        }
    }

    /// Build right-click context menu overlay.
    fn build_context_menu(
        &self,
        font: &FontManager,
        atlas: &mut GlyphAtlas,
    ) -> (Vec<RectInstance>, Vec<GlyphInstance>) {
        let mut rects = Vec::new();
        let mut glyphs = Vec::new();
        let (mx, my) = match self.context_menu {
            Some(pos) => pos,
            None => return (rects, glyphs),
        };

        const ITEMS: &[&str] = &["Copy", "Paste", "Select All", "Search", "Clear"];
        let item_h = 26.0f32;
        let menu_w = 140.0f32;
        let menu_h = ITEMS.len() as f32 * item_h + 8.0;

        // Background
        rects.push(RectInstance {
            pos: [mx, my],
            size: [menu_w, menu_h],
            color: ui::cat::pm(30, 30, 46, 245),
        });
        // Border
        rects.push(RectInstance {
            pos: [mx, my],
            size: [menu_w, 1.0],
            color: ui::cat::pm(69, 71, 90, 200),
        });

        // Hover highlight
        let hover_idx = self.chrome.mouse_pos.and_then(|(hx, hy)| {
            if hx >= mx && hx < mx + menu_w && hy >= my + 4.0 && hy < my + menu_h {
                Some(((hy - my - 4.0) / item_h) as usize)
            } else {
                None
            }
        });

        for (i, label) in ITEMS.iter().enumerate() {
            let iy = my + 4.0 + i as f32 * item_h;
            if hover_idx == Some(i) {
                rects.push(RectInstance {
                    pos: [mx + 2.0, iy],
                    size: [menu_w - 4.0, item_h],
                    color: ui::cat::pm(69, 71, 90, 150),
                });
            }
            let text_y = iy + (item_h - font.cell_height) / 2.0;
            ui::render_text(font, atlas, label, mx + 12.0, text_y, ui::cat::TEXT, &mut glyphs);
        }

        (rects, glyphs)
    }

    /// Handle a context menu item click.
    fn handle_context_click(&mut self, idx: usize) {
        self.context_menu = None;
        match idx {
            0 => {
                // Copy
                let text = self.active_grid()
                    .map(|g| g.lock().unwrap().selected_text())
                    .unwrap_or_default();
                if !text.is_empty() {
                    if let Ok(mut clip) = arboard::Clipboard::new() {
                        let _ = clip.set_text(&text);
                    }
                }
            }
            1 => {
                // Paste
                if let Ok(mut clip) = arboard::Clipboard::new() {
                    if let Ok(text) = clip.get_text() {
                        self.write_to_pty(text.as_bytes());
                    }
                }
            }
            2 => {
                // Select All — select entire visible area
                if let Some(g) = self.active_grid() {
                    let mut grid = g.lock().unwrap();
                    grid.selection.anchor = Some((0, 0));
                    grid.selection.end = Some((grid.rows.saturating_sub(1), grid.cols.saturating_sub(1)));
                    grid.needs_redraw = true;
                }
            }
            3 => {
                // Search
                self.palette.enter_terminal_search();
            }
            4 => {
                // Clear
                self.write_to_pty(b"clear\r");
            }
            _ => {}
        }
    }

    /// Build agent session panel (rendered inside sidebar, bottom area).
    fn build_agent_panel(
        &self,
        font: &FontManager,
        atlas: &mut GlyphAtlas,
        window_h: f32,
    ) -> (Vec<RectInstance>, Vec<GlyphInstance>) {
        let mut rects = Vec::new();
        let mut glyphs = Vec::new();

        if !self.sidebar.visible {
            return (rects, glyphs);
        }

        let agent_tabs: Vec<(usize, &AgentTabInfo)> = self
            .tab_states
            .iter()
            .enumerate()
            .filter_map(|(i, t)| t.agent_info().map(|a| (i, a)))
            .collect();

        if agent_tabs.is_empty() {
            return (rects, glyphs);
        }

        let sidebar_w = self.sidebar.width();
        let panel_h = 28.0 + agent_tabs.len() as f32 * 36.0;
        let panel_y = window_h - ui::STATUS_BAR_HEIGHT - panel_h;

        // Panel background
        rects.push(RectInstance {
            pos: [0.0, panel_y],
            size: [sidebar_w, panel_h],
            color: ui::cat::pm(24, 24, 37, 220),
        });

        // Header separator
        rects.push(RectInstance {
            pos: [0.0, panel_y],
            size: [sidebar_w, 1.0],
            color: ui::cat::pm(69, 71, 90, 150),
        });

        // Header text
        let header_y = panel_y + (28.0 - font.cell_height) / 2.0;
        ui::render_text(
            font,
            atlas,
            "AGENTS",
            8.0,
            header_y,
            ui::cat::OVERLAY0,
            &mut glyphs,
        );

        // Agent count badge
        let count_str = format!("{}", agent_tabs.len());
        let count_x = 8.0 + 7.0 * font.cell_width;
        ui::render_text(
            font,
            atlas,
            &count_str,
            count_x,
            header_y,
            ui::cat::pm(137, 180, 250, 255),
            &mut glyphs,
        );

        // Each agent entry
        let entry_top = panel_y + 28.0;
        for (i, (tab_idx, info)) in agent_tabs.iter().enumerate() {
            let y = entry_top + i as f32 * 36.0;
            let is_active = *tab_idx == self.chrome.active_tab;

            // Active highlight
            if is_active {
                rects.push(RectInstance {
                    pos: [0.0, y],
                    size: [sidebar_w, 36.0],
                    color: ui::cat::pm(69, 71, 90, 80),
                });
            }

            // Status indicator dot (4px circle approximated as square)
            let dot_y = y + (36.0 - 4.0) / 2.0;
            rects.push(RectInstance {
                pos: [8.0, dot_y],
                size: [4.0, 4.0],
                color: info.status.color(),
            });

            // CLI name + model
            let text_y1 = y + 4.0;
            let cli_name = match &info.cli {
                AgentCli::Claude => "Claude",
                AgentCli::Codex => "Codex",
                AgentCli::Gemini => "Gemini",
                AgentCli::Custom(s) => s.as_str(),
            };
            let label = format!("{} ({})", cli_name, info.model);
            ui::render_text(font, atlas, &label, 18.0, text_y1, ui::cat::TEXT, &mut glyphs);

            // Status + cost on second line
            let text_y2 = y + 4.0 + font.cell_height + 2.0;
            let detail = format!("{} ${:.3}", info.status.label(), info.cost);
            ui::render_text(font, atlas, &detail, 18.0, text_y2, ui::cat::OVERLAY0, &mut glyphs);
        }

        (rects, glyphs)
    }

    /// Split the focused pane in the active tab.
    fn split_focused_pane(&mut self, dir: SplitDir) {
        let size = self
            .window
            .as_ref()
            .map(|w| w.inner_size())
            .unwrap_or(winit::dpi::PhysicalSize::new(1200, 700));
        let content_w = size.width as f32 - self.sidebar.width();
        let content_h = (size.height as f32 - ui::CHROME_TOP - ui::STATUS_BAR_HEIGHT).max(1.0);
        // For split panes, each pane gets half the space
        let (pane_w, pane_h) = match dir {
            SplitDir::Horizontal => (content_w / 2.0, content_h),
            SplitDir::Vertical => (content_w, content_h / 2.0),
        };
        let cols = (pane_w / self.font.cell_width).max(1.0) as u16;
        let rows = (pane_h / self.font.cell_height).max(1.0) as u16;

        let grid = Arc::new(Mutex::new(Grid::new(cols, rows, 10_000)));
        let shell = ShellType::PowerShell;

        match self.pty_manager.spawn(&shell, cols, rows, None) {
            Ok(id) => {
                if let Ok(reader) = self.pty_manager.take_reader(&id) {
                    let grid_clone = grid.clone();
                    std::thread::spawn(move || {
                        let mut reader = reader;
                        let mut parser = vte::Parser::new();
                        let mut buf = [0u8; 4096];
                        loop {
                            match std::io::Read::read(&mut reader, &mut buf) {
                                Ok(0) => break,
                                Ok(n) => {
                                    let mut g = match grid_clone.lock() {
                                        Ok(g) => g,
                                        Err(_) => break,
                                    };
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

                if let Some(tab) = self.tab_states.get_mut(self.chrome.active_tab) {
                    let new_id = tab.next_pane_id;
                    tab.next_pane_id += 1;
                    let new_leaf = PaneLeaf {
                        id: new_id,
                        pty_id: id,
                        grid,
                        agent_info: None,
                    };
                    let target_id = tab.focused_pane_id;
                    if tab.root.split_leaf(target_id, dir, new_leaf) {
                        tab.focused_pane_id = new_id;
                        log::info!("Pane split {:?}, new pane {}", dir, new_id);
                    }
                }
            }
            Err(e) => log::error!("Failed to spawn PTY for split: {}", e),
        }
    }

    /// Apply a setting change from the settings palette.
    fn apply_setting(&mut self, category: &str, value: &str) {
        match category {
            "root" => {
                // Second level: show options for the selected category
                let items = match value {
                    "Theme" => vec![
                        "catppuccin-mocha".to_string(),
                        "catppuccin-latte".to_string(),
                        "dracula".to_string(),
                        "nord".to_string(),
                        "tokyo-night".to_string(),
                        "gruvbox".to_string(),
                        "one-dark".to_string(),
                    ],
                    "Font Size" => (10..=24).map(|s| format!("{}", s)).collect(),
                    "Opacity" => vec![
                        "1.0".to_string(),
                        "0.95".to_string(),
                        "0.9".to_string(),
                        "0.85".to_string(),
                        "0.8".to_string(),
                        "0.75".to_string(),
                    ],
                    _ => return,
                };
                self.palette.enter_settings(items, value.to_string());
            }
            "Theme" => {
                self.config.appearance.theme = value.to_string();
                let _ = save_config(&self.config);
                log::info!("Theme changed to: {}", value);
            }
            "Font Size" => {
                if let Ok(size) = value.parse::<u32>() {
                    self.config.appearance.font_size = size;
                    self.font = FontManager::new(size as f32, self.config.appearance.line_height);
                    let _ = save_config(&self.config);
                    self.recalc_grid_size();
                    // Re-create atlas for new font
                    self.atlas = Mutex::new(GlyphAtlas::new(2048, 2048));
                    log::info!("Font size changed to: {}", size);
                }
            }
            "Opacity" => {
                if let Ok(opacity) = value.parse::<f32>() {
                    self.config.appearance.opacity = opacity;
                    let _ = save_config(&self.config);
                    log::info!("Opacity changed to: {}", opacity);
                }
            }
            _ => {}
        }
    }

    /// Open quick file search (Ctrl+P).
    fn open_quick_file_search(&mut self) {
        let root = self
            .sidebar
            .file_tree
            .as_ref()
            .map(|ft| ft.root.clone())
            .or_else(|| std::env::current_dir().ok());
        let root = match root {
            Some(r) => r,
            None => return,
        };
        // Collect files recursively (max 2000)
        let mut files = Vec::new();
        Self::collect_files(&root, &root, &mut files, 2000);
        if files.is_empty() {
            return;
        }
        self.palette.enter_file_search(files);
    }

    fn collect_files(
        dir: &std::path::Path,
        root: &std::path::Path,
        files: &mut Vec<String>,
        max: usize,
    ) {
        if files.len() >= max {
            return;
        }
        let entries = match std::fs::read_dir(dir) {
            Ok(e) => e,
            Err(_) => return,
        };
        for entry in entries.flatten() {
            if files.len() >= max {
                break;
            }
            let path = entry.path();
            let name = path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("");
            // Skip hidden and common large dirs
            if name.starts_with('.') || name == "node_modules" || name == "target" || name == "__pycache__" {
                continue;
            }
            if path.is_dir() {
                Self::collect_files(&path, root, files, max);
            } else {
                let relative = path
                    .strip_prefix(root)
                    .unwrap_or(&path)
                    .to_string_lossy()
                    .to_string();
                files.push(relative);
            }
        }
    }

    /// Process pending agent status updates from monitor threads.
    fn process_agent_updates(&mut self) {
        while let Ok(update) = self.agent_rx.try_recv() {
            match update {
                AgentUpdate::Status(ref pty_id, ref status) => {
                    self.apply_agent_update_to_tree(pty_id, |info| info.status = status.clone());
                }
                AgentUpdate::Usage(ref pty_id, cost, tokens) => {
                    self.apply_agent_update_to_tree(pty_id, |info| {
                        if cost > info.cost { info.cost = cost; }
                        if tokens > info.tokens_used { info.tokens_used = tokens; }
                    });
                }
            }
        }
    }

    fn apply_agent_update_to_tree(&mut self, pty_id: &str, f: impl FnOnce(&mut AgentTabInfo)) {
        fn find_and_apply<'a>(
            node: &'a mut PaneNode,
            pty_id: &str,
        ) -> Option<&'a mut AgentTabInfo> {
            match node {
                PaneNode::Leaf(leaf) if leaf.pty_id == pty_id => leaf.agent_info.as_mut(),
                PaneNode::Split { first, second, .. } => {
                    find_and_apply(first, pty_id).or_else(|| find_and_apply(second, pty_id))
                }
                _ => None,
            }
        }
        for tab in &mut self.tab_states {
            if let Some(info) = find_and_apply(&mut tab.root, pty_id) {
                f(info);
                return;
            }
        }
    }

    /// Get active agent info for status bar display.
    fn active_agent_info(&self) -> Option<&AgentTabInfo> {
        self.tab_states
            .get(self.chrome.active_tab)
            .and_then(|t| t.agent_info())
    }

    /// Try to start an LSP server for the opened file.
    fn try_start_lsp(&mut self, path: &std::path::Path) {
        let ext = match path.extension().and_then(|e| e.to_str()) {
            Some(e) => e,
            None => return,
        };
        let language = match LspLanguage::from_extension(ext) {
            Some(l) => l,
            None => return,
        };
        // Use parent directory as project root
        let root = path
            .parent()
            .unwrap_or(path)
            .to_string_lossy()
            .into_owned();

        if let Err(e) = self.lsp_manager.start(language.clone(), &root) {
            // Already running is OK, not a real error
            if !e.contains("already running") {
                log::warn!("LSP start failed: {}", e);
                return;
            }
        }

        // Send initialize request
        let init_request = serde_json::json!({
            "jsonrpc": "2.0",
            "id": self.next_request_id(),
            "method": "initialize",
            "params": {
                "processId": std::process::id(),
                "rootUri": format!("file:///{}", root.replace('\\', "/")),
                "capabilities": {
                    "textDocument": {
                        "publishDiagnostics": {
                            "relatedInformation": false
                        }
                    }
                }
            }
        });
        let _ = self.lsp_manager.send(&language, &root, &init_request.to_string());

        // Send initialized notification
        let initialized = serde_json::json!({
            "jsonrpc": "2.0",
            "method": "initialized",
            "params": {}
        });
        let _ = self.lsp_manager.send(&language, &root, &initialized.to_string());

        // Send textDocument/didOpen
        let file_uri = format!("file:///{}", path.to_string_lossy().replace('\\', "/"));
        let lang_id = match ext {
            "rs" => "rust",
            "py" => "python",
            "ts" | "tsx" => "typescript",
            "js" | "jsx" => "javascript",
            "go" => "go",
            _ => "plaintext",
        };
        // Read file content for didOpen
        let content = std::fs::read_to_string(path).unwrap_or_default();
        let did_open = serde_json::json!({
            "jsonrpc": "2.0",
            "method": "textDocument/didOpen",
            "params": {
                "textDocument": {
                    "uri": file_uri,
                    "languageId": lang_id,
                    "version": 1,
                    "text": content
                }
            }
        });
        let _ = self.lsp_manager.send(&language, &root, &did_open.to_string());
        log::info!("LSP didOpen sent for {}", path.display());
    }

    fn next_request_id(&mut self) -> u64 {
        let id = self.lsp_request_id;
        self.lsp_request_id += 1;
        id
    }

    /// Process pending LSP messages and update editor diagnostics.
    fn process_lsp_messages(&mut self) {
        while let Ok(msg) = self.lsp_receiver.try_recv() {
            if let Ok(json) = serde_json::from_str::<serde_json::Value>(&msg.json) {
                if json.get("method").and_then(|m| m.as_str()) == Some("textDocument/publishDiagnostics") {
                    if let Some(params) = json.get("params") {
                        self.handle_diagnostics(params);
                    }
                }
            }
        }
    }

    fn handle_diagnostics(&mut self, params: &serde_json::Value) {
        let diagnostics_json = match params.get("diagnostics").and_then(|d| d.as_array()) {
            Some(d) => d,
            None => return,
        };

        let mut diags = Vec::new();
        for d in diagnostics_json {
            let range = match d.get("range") {
                Some(r) => r,
                None => continue,
            };
            let start = match range.get("start") {
                Some(s) => s,
                None => continue,
            };
            let end = match range.get("end") {
                Some(e) => e,
                None => continue,
            };
            let line = start.get("line").and_then(|l| l.as_u64()).unwrap_or(0) as usize;
            let col_start = start.get("character").and_then(|c| c.as_u64()).unwrap_or(0) as usize;
            let col_end = end.get("character").and_then(|c| c.as_u64()).unwrap_or((col_start + 1) as u64) as usize;
            let severity_num = d.get("severity").and_then(|s| s.as_u64()).unwrap_or(1);
            let severity = match severity_num {
                1 => DiagnosticSeverity::Error,
                2 => DiagnosticSeverity::Warning,
                3 => DiagnosticSeverity::Info,
                _ => DiagnosticSeverity::Hint,
            };
            let message = d.get("message").and_then(|m| m.as_str()).unwrap_or("").to_string();

            diags.push(Diagnostic {
                line,
                col_start,
                col_end,
                severity,
                message,
            });
        }

        if let ContentPane::Editor(editor) = &mut self.content_pane {
            editor.diagnostics = diags;
        }
    }

    /// Convert pixel position to grid cell, accounting for chrome and sidebar offset.
    fn pixel_to_cell(&self, x: f64, y: f64) -> (u16, u16) {
        let content_y = (y - ui::CHROME_TOP as f64).max(0.0);
        let content_x = (x - self.sidebar.width() as f64).max(0.0);
        let col = (content_x / self.font.cell_width as f64).max(0.0) as u16;
        let row = (content_y / self.font.cell_height as f64).max(0.0) as u16;
        if let Some(g) = self.active_grid() {
            let grid = g.lock().unwrap();
            (
                row.min(grid.rows.saturating_sub(1)),
                col.min(grid.cols.saturating_sub(1)),
            )
        } else {
            (row, col)
        }
    }

    /// Send SGR mouse event to PTY if mouse tracking is enabled.
    /// button: 0=left, 1=middle, 2=right, 64=scroll_up, 65=scroll_down
    /// pressed: true for press, false for release
    fn send_mouse_event(&self, button: u8, col: u16, row: u16, pressed: bool) {
        use aether_terminal_lib::gpu::grid::MouseMode;
        let grid_arc = match self.active_grid() {
            Some(g) => g.clone(),
            None => return,
        };
        let grid = grid_arc.lock().unwrap();
        if grid.mode.mouse_mode == MouseMode::None {
            return;
        }
        // SGR encoding (1006): CSI < button ; col ; row M/m
        if grid.mode.sgr_mouse {
            let ch = if pressed { 'M' } else { 'm' };
            let seq = format!("\x1b[<{};{};{}{}", button, col + 1, row + 1, ch);
            drop(grid);
            self.write_to_pty(seq.as_bytes());
        } else {
            // Legacy X10 encoding: CSI M button+32 col+33 row+33
            if pressed {
                let buf = [
                    0x1b, b'[', b'M',
                    button + 32,
                    (col as u8).saturating_add(33),
                    (row as u8).saturating_add(33),
                ];
                drop(grid);
                self.write_to_pty(&buf);
            }
        }
    }

    /// Check if mouse tracking is active for the current tab.
    fn is_mouse_tracking(&self) -> bool {
        use aether_terminal_lib::gpu::grid::MouseMode;
        self.active_grid()
            .and_then(|g| g.lock().ok())
            .map(|g| g.mode.mouse_mode != MouseMode::None)
            .unwrap_or(false)
    }

    /// Check if mouse position is in the terminal content area.
    fn is_in_content(&self, x: f64, y: f64) -> bool {
        let config = match &self.surface_config {
            Some(c) => c,
            None => return false,
        };
        let bottom = config.height as f64 - ui::STATUS_BAR_HEIGHT as f64;
        x >= self.sidebar.width() as f64
            && y >= ui::CHROME_TOP as f64
            && y < bottom
    }

    /// Save window state to config before exit.
    fn save_session(&mut self) {
        if let Some(window) = &self.window {
            let size = window.inner_size();
            self.config.window.width = size.width;
            self.config.window.height = size.height;
            if let Ok(pos) = window.outer_position() {
                self.config.window.x = Some(pos.x);
                self.config.window.y = Some(pos.y);
            }
            self.config.window.maximized = window.is_maximized();
        }
        self.config.window.sidebar_visible = self.sidebar.visible;
        self.config.window.last_directory = std::env::current_dir()
            .ok()
            .map(|p| p.to_string_lossy().into_owned());
        if let Err(e) = save_config(&self.config) {
            log::warn!("Failed to save config: {}", e);
        }
    }

    /// Recalculate terminal grid dimensions based on available content area.
    fn recalc_grid_size(&mut self) {
        let config = match &self.surface_config {
            Some(c) => c,
            None => return,
        };
        let content_w = config.width as f32 - self.sidebar.width();
        let content_h = config.height as f32 - ui::CHROME_TOP - ui::STATUS_BAR_HEIGHT;
        let cols = (content_w / self.font.cell_width).max(1.0) as u16;
        let rows = (content_h / self.font.cell_height).max(1.0) as u16;
        // Resize all PTY panes in all tabs
        for tab in &self.tab_states {
            tab.root.for_each_leaf(&mut |leaf| {
                let _ = self.pty_manager.resize(&leaf.pty_id, cols, rows);
                leaf.grid.lock().unwrap().resize(cols, rows);
            });
        }
    }
}

impl ApplicationHandler for NativeTerminal {
    fn resumed(&mut self, event_loop: &ActiveEventLoop) {
        if self.window.is_some() {
            return;
        }

        let wc = &self.config.window;
        let mut attrs = Window::default_attributes()
            .with_title("Aether Terminal (Native)")
            .with_inner_size(winit::dpi::LogicalSize::new(wc.width, wc.height))
            .with_transparent(true)
            .with_decorations(false);

        if let (Some(x), Some(y)) = (wc.x, wc.y) {
            attrs = attrs.with_position(winit::dpi::LogicalPosition::new(x, y));
        }

        let window = Arc::new(
            event_loop
                .create_window(attrs)
                .expect("Failed to create window"),
        );
        window.set_ime_allowed(true);

        if wc.maximized {
            window.set_maximized(true);
            self.chrome.is_maximized = true;
        }
        if wc.sidebar_visible {
            self.sidebar.toggle();
        }

        #[cfg(windows)]
        enable_mica_effect(&window);

        self.init_wgpu(window);
        self.spawn_pty();
    }

    fn window_event(
        &mut self,
        event_loop: &ActiveEventLoop,
        _id: WindowId,
        event: WindowEvent,
    ) {
        match event {
            WindowEvent::CloseRequested => {
                self.save_session();
                for tab in &self.tab_states {
                    for pty_id in tab.root.all_pty_ids() {
                        let _ = self.pty_manager.close(&pty_id);
                    }
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
                    // Resize grid for content area (accounting for sidebar)
                    self.recalc_grid_size();
                }
                if let Some(window) = &self.window {
                    self.chrome.is_maximized = window.is_maximized();
                }
            }
            WindowEvent::Ime(ime_event) => match ime_event {
                winit::event::Ime::Enabled => {
                    self.update_ime_cursor_area();
                }
                winit::event::Ime::Preedit(text, _cursor_pos) => {
                    self.ime_state.set_composing(text);
                    self.update_ime_cursor_area();
                    if let Some(g) = self.active_grid() { g.lock().unwrap().needs_redraw = true; }
                }
                winit::event::Ime::Commit(text) => {
                    self.ime_state.commit();
                    self.write_to_pty(text.as_bytes());
                }
                winit::event::Ime::Disabled => {
                    self.ime_state.cancel();
                }
            },
            WindowEvent::ModifiersChanged(mods) => {
                self.modifiers = mods.state();
            }
            WindowEvent::CursorMoved { position, .. } => {
                // Update mouse position for hover effects
                self.chrome.mouse_pos = Some((position.x as f32, position.y as f32));

                // Mouse motion reporting (button-event or any-event tracking)
                if self.is_in_content(position.x, position.y) {
                    use aether_terminal_lib::gpu::grid::MouseMode;
                    let should_report = self.active_grid()
                        .and_then(|g| g.lock().ok())
                        .map(|g| match g.mode.mouse_mode {
                            MouseMode::AnyMotion => true,
                            MouseMode::ButtonMotion => self.mouse_pressed,
                            _ => false,
                        })
                        .unwrap_or(false);
                    if should_report {
                        let (row, col) = self.pixel_to_cell(position.x, position.y);
                        // Button 32 = motion with no button (or +0 for left drag)
                        let button = if self.mouse_pressed { 32 } else { 35 };
                        self.send_mouse_event(button, col, row, true);
                    }
                }

                // Handle selection drag in content area (only when not mouse tracking)
                if self.mouse_pressed && !self.is_mouse_tracking() && self.is_in_content(position.x, position.y) {
                    if let Some(g) = self.active_grid() {
                        let (row, col) = self.pixel_to_cell(position.x, position.y);
                        let mut grid = g.lock().unwrap();
                        if grid.selection.anchor.is_none() {
                            grid.selection.anchor = Some((row, col));
                        }
                        grid.selection.end = Some((row, col));
                        grid.needs_redraw = true;
                    }
                }
            }
            WindowEvent::MouseInput {
                state,
                button: winit::event::MouseButton::Left,
                ..
            } => {
                if state.is_pressed() {
                    // Check context menu click first
                    if let Some((cmx, cmy)) = self.context_menu {
                        if let Some((hx, hy)) = self.chrome.mouse_pos {
                            let menu_w = 140.0f32;
                            let item_h = 26.0f32;
                            let menu_h = 5.0 * item_h + 8.0;
                            if hx >= cmx && hx < cmx + menu_w && hy >= cmy + 4.0 && hy < cmy + menu_h {
                                let idx = ((hy - cmy - 4.0) / item_h) as usize;
                                self.handle_context_click(idx);
                                return;
                            }
                        }
                        // Click outside context menu = close
                        self.context_menu = None;
                        return;
                    }
                    // Check chrome hit regions first
                    if let Some((mx, my)) = self.chrome.mouse_pos {
                        if let Some(action) = self.chrome.hit_test(&self.hit_regions, mx, my) {
                            self.handle_chrome_action(action);
                            return;
                        }
                    }
                    // Check sidebar click
                    if let Some((mx, my)) = self.chrome.mouse_pos {
                        if self.sidebar.visible
                            && (mx as f64) < self.sidebar.width() as f64
                            && my > ui::CHROME_TOP
                        {
                            let mut open_path: Option<std::path::PathBuf> = None;
                            if let Some(tree) = &mut self.sidebar.file_tree {
                                let content_top = ui::CHROME_TOP + 28.0; // HEADER_HEIGHT
                                if let Some(idx) = tree.entry_at_y(my, content_top) {
                                    tree.selected = Some(idx);
                                    if tree.entries[idx].is_dir {
                                        tree.toggle(idx);
                                    } else {
                                        open_path = Some(tree.entries[idx].path.clone());
                                    }
                                }
                            }
                            if let Some(path) = open_path {
                                match EditorState::open(&path) {
                                    Ok(editor) => {
                                        log::info!("Opened file: {}", editor.file_name);
                                        self.try_start_lsp(&path);
                                        self.content_pane = ContentPane::Editor(editor);
                                    }
                                    Err(e) => {
                                        log::warn!("Cannot open file: {}", e);
                                    }
                                }
                            }
                            return;
                        }
                    }
                    // Content area: hyperlink click, mouse reporting, or selection
                    if let Some((mx, my)) = self.chrome.mouse_pos {
                        if self.is_in_content(mx as f64, my as f64) {
                            // Ctrl+Click: open hyperlink
                            if self.modifiers.contains(ModifiersState::CONTROL) {
                                let (row, col) = self.pixel_to_cell(mx as f64, my as f64);
                                if let Some(g) = self.active_grid() {
                                    let grid = g.lock().unwrap();
                                    let cells = grid.visible_row(row as usize);
                                    if let Some(cell) = cells.get(col as usize) {
                                        if let Some(url) = &cell.hyperlink {
                                            let _ = std::process::Command::new("cmd")
                                                .args(["/C", "start", "", url.as_str()])
                                                .spawn();
                                            return;
                                        }
                                    }
                                }
                            }
                            if self.is_mouse_tracking() {
                                let (row, col) = self.pixel_to_cell(mx as f64, my as f64);
                                self.send_mouse_event(0, col, row, true);
                            } else {
                                self.mouse_pressed = true;
                                if let Some(g) = self.active_grid() {
                                    g.lock().unwrap().selection.clear();
                                }
                            }
                        }
                    }
                } else {
                    if self.is_mouse_tracking() {
                        if let Some((mx, my)) = self.chrome.mouse_pos {
                            if self.is_in_content(mx as f64, my as f64) {
                                let (row, col) = self.pixel_to_cell(mx as f64, my as f64);
                                self.send_mouse_event(0, col, row, false);
                            }
                        }
                    }
                    self.mouse_pressed = false;
                }
            }
            WindowEvent::MouseInput {
                state,
                button: winit::event::MouseButton::Right,
                ..
            } => {
                if state.is_pressed() {
                    if let Some((mx, my)) = self.chrome.mouse_pos {
                        if self.is_in_content(mx as f64, my as f64) {
                            self.context_menu = Some((mx, my));
                        }
                    }
                }
            }
            WindowEvent::MouseWheel { delta, .. } => {
                // Check if scrolling in sidebar
                if let Some((mx, my)) = self.chrome.mouse_pos {
                    if self.sidebar.visible
                        && (mx as f64) < self.sidebar.width() as f64
                        && my > ui::CHROME_TOP
                    {
                        let lines = match delta {
                            winit::event::MouseScrollDelta::LineDelta(_, y) => y,
                            winit::event::MouseScrollDelta::PixelDelta(pos) => {
                                pos.y as f32 / self.font.cell_height
                            }
                        };
                        if let Some(tree) = &mut self.sidebar.file_tree {
                            tree.scroll(-lines * 22.0); // ROW_HEIGHT
                        }
                        return;
                    }
                }
                // Scroll content area (terminal or editor)
                if let Some((mx, my)) = self.chrome.mouse_pos {
                    if !self.is_in_content(mx as f64, my as f64) {
                        return;
                    }
                }
                let lines = match delta {
                    winit::event::MouseScrollDelta::LineDelta(_, y) => y as i32,
                    winit::event::MouseScrollDelta::PixelDelta(pos) => {
                        (pos.y / self.font.cell_height as f64) as i32
                    }
                };
                if lines != 0 {
                    // Mouse wheel reporting when tracking is active
                    if self.is_mouse_tracking() && matches!(self.content_pane, ContentPane::Terminal) {
                        if let Some((mx, my)) = self.chrome.mouse_pos {
                            let (row, col) = self.pixel_to_cell(mx as f64, my as f64);
                            let button = if lines > 0 { 64u8 } else { 65u8 }; // scroll up/down
                            let count = lines.unsigned_abs().max(1).min(5);
                            for _ in 0..count {
                                self.send_mouse_event(button, col, row, true);
                            }
                        }
                        return;
                    }
                    if let ContentPane::Editor(viewer) = &mut self.content_pane {
                        let config = self.surface_config.as_ref();
                        let content_h = config
                            .map(|c| c.height as f32 - ui::CHROME_TOP - ui::STATUS_BAR_HEIGHT)
                            .unwrap_or(400.0);
                        let visible = viewer.visible_count(content_h, self.font.cell_height);
                        let scroll_lines = lines.unsigned_abs() as usize;
                        if lines > 0 {
                            viewer.scroll_up(scroll_lines);
                        } else {
                            viewer.scroll_down(scroll_lines, visible);
                        }
                    } else if let Some(g) = self.active_grid() {
                        let mut grid = g.lock().unwrap();
                        if grid.mode.alt_screen {
                            drop(grid);
                            let count = lines.unsigned_abs().max(1).min(10);
                            let seq = if lines > 0 { b"\x1b[A" } else { b"\x1b[B" };
                            for _ in 0..count {
                                self.write_to_pty(seq);
                            }
                        } else {
                            grid.scroll_viewport(-lines);
                        }
                    }
                }
            }
            WindowEvent::KeyboardInput { event, .. } => {
                if self.ime_state.active {
                    return;
                }
                if event.state.is_pressed() {
                    self.handle_key_input(event.logical_key);
                }
            }
            WindowEvent::RedrawRequested => {
                self.render();
                if self.should_exit {
                    event_loop.exit();
                }
            }
            _ => {}
        }
    }

    fn about_to_wait(&mut self, _event_loop: &ActiveEventLoop) {
        // Sync tab titles from OSC 0/2
        for (i, tab) in self.tab_states.iter().enumerate() {
            if let Some(leaf) = tab.focused_leaf() {
                if let Ok(grid) = leaf.grid.lock() {
                    if let Some(title) = &grid.title {
                        if i < self.chrome.tabs.len() && self.chrome.tabs[i].title != *title {
                            self.chrome.tabs[i].title = title.clone();
                        }
                    }
                }
            }
        }
        // Process LSP messages
        self.process_lsp_messages();
        // Process agent updates
        self.process_agent_updates();
        // Tick toast notifications
        self.toasts.tick();
        // Tick editor cursor blink
        if let ContentPane::Editor(editor) = &mut self.content_pane {
            editor.tick_blink();
        }
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
        DwmExtendFrameIntoClientArea, DwmSetWindowAttribute, DWMWA_SYSTEMBACKDROP_TYPE,
        DWMWA_USE_IMMERSIVE_DARK_MODE, DWM_SYSTEMBACKDROP_TYPE,
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

    // SAFETY: hwnd is a valid Win32 window handle obtained from winit's
    // HasWindowHandle. DWM APIs are thread-safe. Pointer arguments point
    // to stack variables that outlive the call, with correct size parameters.
    unsafe {
        let dark_mode: i32 = 1;
        let _ = DwmSetWindowAttribute(
            hwnd,
            DWMWA_USE_IMMERSIVE_DARK_MODE,
            &dark_mode as *const _ as *const _,
            4,
        );

        let margins = MARGINS {
            cxLeftWidth: -1,
            cxRightWidth: -1,
            cyTopHeight: -1,
            cyBottomHeight: -1,
        };
        let _ = DwmExtendFrameIntoClientArea(hwnd, &margins);

        let backdrop_type = DWM_SYSTEMBACKDROP_TYPE(2);
        let _ = DwmSetWindowAttribute(
            hwnd,
            DWMWA_SYSTEMBACKDROP_TYPE,
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
