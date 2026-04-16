//! Native terminal — winit + wgpu standalone binary module.
//!
//! Split into focused sub-modules for maintainability:
//! - types.rs     — ContentPane, AgentStatus, AgentTabInfo, AgentUpdate, DividerDrag
//! - panes.rs     — PaneNode, PaneLeaf, TabState, SplitDir
//! - helpers.rs   — utility methods (grid helpers, LSP, worktree, file search)
//! - input.rs     — keyboard input dispatch
//! - actions.rs   — palette/chrome/context action handling, PTY spawn
//! - render.rs    — frame rendering orchestration
//! - app_handler.rs — ApplicationHandler impl (winit event loop)
//! - mica.rs      — Windows Mica/DWM backdrop

pub mod types;
pub mod panes;
mod helpers;
mod input;
mod actions;
mod render;
mod app_handler;
pub mod mica;
mod watcher;

use std::sync::{Arc, Mutex};
use winit::keyboard::ModifiersState;
use winit::window::Window;

use crate::config::{AppConfig, KeybindingsConfig, load_config};
use crate::db::{Database, db_path};
use crate::gpu::atlas::GlyphAtlas;
use crate::gpu::font::FontManager;
use crate::gpu::ime::ImeState;
use crate::gpu::renderer::TerminalRenderer;
use crate::lsp::{LspManager, LspMessage};
use crate::pty::PtyManager;
use crate::ui::{ChromeState, HitRegion};
use crate::ui::activity::ActivityFeed;
use crate::ui::analytics::AnalyticsState;
use crate::ui::palette::PaletteState;
use crate::ui::scm::ScmState;
use crate::ui::sidebar::SidebarState;
use crate::ui::toast::ToastManager;
use crate::ui::toolkit::ToolkitState;
use crate::agent::watchdog::WatchdogManager;
use crate::suggest::SuggestEngine;
use crate::watchdog::auto_repair::AutoRepairManager;

use self::types::{AgentUpdate, ContentPane, DividerDrag};
use self::panes::TabState;

/// Application state for the native terminal.
pub struct NativeTerminal {
    pub(crate) window: Option<Arc<Window>>,
    // wgpu state
    pub(crate) surface: Option<wgpu::Surface<'static>>,
    pub(crate) device: Option<Arc<wgpu::Device>>,
    pub(crate) queue: Option<Arc<wgpu::Queue>>,
    pub(crate) surface_config: Option<wgpu::SurfaceConfiguration>,
    pub(crate) renderer: Option<TerminalRenderer>,
    // Terminal state
    pub(crate) tab_states: Vec<TabState>,
    pub(crate) atlas: Mutex<GlyphAtlas>,
    pub(crate) font: FontManager,
    pub(crate) pty_manager: PtyManager,
    pub(crate) ime_state: ImeState,
    pub(crate) modifiers: ModifiersState,
    pub(crate) mouse_pressed: bool,
    // UI Chrome
    pub(crate) chrome: ChromeState,
    pub(crate) sidebar: SidebarState,
    pub(crate) hit_regions: Vec<HitRegion>,
    pub(crate) palette: PaletteState,
    pub(crate) content_pane: ContentPane,
    // LSP
    pub(crate) lsp_manager: LspManager,
    pub(crate) lsp_receiver: std::sync::mpsc::Receiver<LspMessage>,
    pub(crate) lsp_request_id: u64,
    pub(crate) config: AppConfig,
    pub(crate) should_exit: bool,
    // Database
    pub(crate) db: Database,
    pub(crate) command_buffer: String,
    // Agent monitoring
    pub(crate) agent_tx: std::sync::mpsc::SyncSender<AgentUpdate>,
    pub(crate) agent_rx: std::sync::mpsc::Receiver<AgentUpdate>,
    // Menus
    pub(crate) context_menu: Option<(f32, f32)>,
    pub(crate) sidebar_menu: Option<(f32, f32, std::path::PathBuf, bool)>,
    // Drag state
    pub(crate) divider_drag: Option<DividerDrag>,
    pub(crate) tab_drag: Option<usize>,
    // SCM + Toasts
    pub(crate) scm: ScmState,
    pub(crate) toasts: ToastManager,
    // Toolkit
    pub(crate) toolkit: ToolkitState,
    // Watchdog
    pub(crate) watchdog_manager: WatchdogManager,
    // Activity feed
    pub(crate) activity: ActivityFeed,
    // Analytics
    pub(crate) analytics: AnalyticsState,
    // Auto-repair pipeline
    pub(crate) auto_repair: AutoRepairManager,
    // Ghost typing suggestion
    pub(crate) suggest_engine: SuggestEngine,
    pub(crate) ghost_text: Option<String>,
    // Customizable keybindings
    pub(crate) keybindings: KeybindingsConfig,
    // Pane sync: broadcast keystrokes to all panes in active tab
    pub(crate) pane_sync: bool,
    // File system watcher
    pub(crate) fs_watcher_rx: Option<std::sync::mpsc::Receiver<watcher::FsEvent>>,
}

impl NativeTerminal {
    pub fn new() -> Self {
        let config = load_config();
        crate::ui::theme::set_theme(&config.appearance.theme);
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
            divider_drag: None,
            tab_drag: None,
            sidebar_menu: None,
            scm: ScmState::new(),
            toasts: ToastManager::new(),
            toolkit: {
                let mut tk = ToolkitState::new();
                if let Ok(cwd) = std::env::current_dir() {
                    let toolkit_path = cwd.join(".aether").join("toolkit.toml");
                    tk.load_from_file(&toolkit_path);
                }
                tk
            },
            watchdog_manager: WatchdogManager::new(),
            activity: ActivityFeed::new(),
            analytics: AnalyticsState::new(),
            auto_repair: AutoRepairManager::new(),
            suggest_engine: SuggestEngine::new(),
            ghost_text: None,
            keybindings: KeybindingsConfig::load(),
            pane_sync: false,
            fs_watcher_rx: None,
        }
    }

    pub fn init_wgpu(&mut self, window: Arc<Window>) {
        let size = window.inner_size();

        let instance = wgpu::Instance::new(&wgpu::InstanceDescriptor {
            backends: wgpu::Backends::DX12 | wgpu::Backends::VULKAN,
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

        let mut config = surface
            .get_default_config(&adapter, size.width.max(1), size.height.max(1))
            .expect("Surface not supported");
        config.format = wgpu::TextureFormat::Bgra8Unorm;

        let caps = surface.get_capabilities(&adapter);
        let alpha_priority = [
            wgpu::CompositeAlphaMode::PreMultiplied,
            wgpu::CompositeAlphaMode::PostMultiplied,
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
}
