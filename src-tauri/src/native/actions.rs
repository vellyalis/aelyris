//! Palette action dispatch and chrome action handling.

use std::sync::{Arc, Mutex};
use crate::agent::interactive::AgentCli;
use crate::agent::output_monitor;
use crate::config::save_config;
use crate::gpu::atlas::GlyphAtlas;
use crate::gpu::font::FontManager;
use crate::gpu::grid::{Grid, GridPerformer};
use crate::ui;
use crate::ui::editor::EditorState;
use crate::ui::kanban::KanbanState;
use crate::ui::palette::PaletteAction;
use crate::ui::{ChromeAction};
use super::NativeTerminal;
use super::types::{AgentStatus, AgentTabInfo, AgentUpdate, ContentPane};
use super::panes::{PaneLeaf, SplitDir, TabState};
use crate::pty::ShellType;

impl NativeTerminal {
    pub(super) fn handle_chrome_action(&mut self, action: ChromeAction) {
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
                    for tab in &self.tab_states {
                        for pty_id in tab.root.all_pty_ids() {
                            let _ = self.pty_manager.close(&pty_id);
                        }
                    }
                    self.should_exit = true;
                } else if idx < self.tab_states.len() {
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
                if let Some(src) = self.tab_drag.take() {
                    if src != idx && src < self.tab_states.len() && idx < self.tab_states.len() {
                        self.tab_states.swap(src, idx);
                        self.chrome.tabs.swap(src, idx);
                        self.chrome.active_tab = idx;
                        self.content_pane = ContentPane::Terminal;
                        return;
                    }
                }
                self.tab_drag = Some(idx);
                if idx < self.chrome.tabs.len() {
                    self.chrome.active_tab = idx;
                    self.content_pane = ContentPane::Terminal;
                }
            }
        }
    }

    pub(super) fn handle_context_click(&mut self, idx: usize) {
        self.context_menu = None;
        match idx {
            0 => {
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
                if let Ok(mut clip) = arboard::Clipboard::new() {
                    if let Ok(text) = clip.get_text() {
                        self.write_to_pty(text.as_bytes());
                    }
                }
            }
            2 => {
                if let Some(g) = self.active_grid() {
                    let mut grid = g.lock().unwrap();
                    grid.selection.anchor = Some((0, 0));
                    grid.selection.end = Some((grid.rows.saturating_sub(1), grid.cols.saturating_sub(1)));
                    grid.needs_redraw = true;
                }
            }
            3 => {
                self.palette.enter_terminal_search();
            }
            4 => {
                self.write_to_pty(b"clear\r");
            }
            _ => {}
        }
    }

    pub(super) fn handle_sidebar_menu_click(&mut self, idx: usize, path: &std::path::Path, is_dir: bool) {
        if is_dir {
            match idx {
                0 => {
                    let dir = path.to_string_lossy().to_string();
                    self.palette.enter_agent_spawn(format!("__newfile__{}", dir));
                }
                1 => {
                    let dir = path.to_string_lossy().to_string();
                    self.palette.enter_agent_spawn(format!("__newfolder__{}", dir));
                }
                2 => {
                    if let Err(e) = std::fs::remove_dir_all(path) {
                        self.toasts.error(format!("Delete failed: {}", e));
                    } else {
                        self.toasts.success("Directory deleted");
                        if let Some(tree) = &mut self.sidebar.file_tree { tree.rebuild(); }
                    }
                }
                _ => {}
            }
        } else {
            match idx {
                0 => {
                    let file = path.to_string_lossy().to_string();
                    self.palette.enter_agent_spawn(format!("__rename__{}", file));
                }
                1 => {
                    if let Err(e) = std::fs::remove_file(path) {
                        self.toasts.error(format!("Delete failed: {}", e));
                    } else {
                        self.toasts.success("File deleted");
                        if let Some(tree) = &mut self.sidebar.file_tree { tree.rebuild(); }
                    }
                }
                2 => {
                    match EditorState::open(path) {
                        Ok(editor) => {
                            self.try_start_lsp(path);
                            self.content_pane = ContentPane::Editor(editor);
                        }
                        Err(e) => self.toasts.error(format!("Cannot open: {}", e)),
                    }
                }
                _ => {}
            }
        }
    }

    /// Execute a palette action.
    pub(super) fn execute_palette_action(&mut self, action: PaletteAction) {
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
                    log::warn!("No worktrees found");
                    self.palette.close();
                    return;
                }
                self.palette.enter_worktree_select(entries, false);
            }
            PaletteAction::BeginWorktreeDelete => {
                let entries = self.list_worktree_entries();
                if entries.is_empty() {
                    log::warn!("No worktrees found");
                    self.palette.close();
                    return;
                }
                self.palette.enter_worktree_select(entries, true);
            }
            PaletteAction::DoWorktreeCreate(branch) => self.do_create_worktree(&branch),
            PaletteAction::DoWorktreeSwitch(path) => self.do_switch_worktree(&path),
            PaletteAction::DoWorktreeDelete(name) => self.do_delete_worktree(&name),
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
                    let workflows = crate::workflow::list_workflow_files(&path);
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
            PaletteAction::OpenKanban => {
                self.content_pane = ContentPane::Kanban(KanbanState::load());
            }
            PaletteAction::ShowHelp => {
                let items = vec![
                    "Ctrl+Shift+P  Command Palette".into(),
                    "Ctrl+P        Quick Open File".into(),
                    "Ctrl+R        Command History".into(),
                    "Ctrl+Shift+F  Terminal Search".into(),
                    "Ctrl+F/H      Editor Find/Replace".into(),
                    "Ctrl+B        Toggle Sidebar".into(),
                    "Ctrl+Shift+H  Split Horizontal".into(),
                    "Ctrl+Shift+V  Split Vertical".into(),
                    "Ctrl+Shift+W  Close Pane".into(),
                    "Alt+Tab       Focus Next Pane".into(),
                    "Ctrl+Shift+C  Copy Selection".into(),
                    "Ctrl+V        Paste".into(),
                    "Ctrl+S        Save File".into(),
                    "Ctrl+Z        Undo".into(),
                    "Ctrl+Click    Open Hyperlink".into(),
                    "Escape        Close Editor/Find".into(),
                ];
                self.palette.enter_command_history(items);
            }
            PaletteAction::ShowAbout => {
                let items = vec![
                    "Aether Terminal (Native)".into(),
                    "wgpu 25 + winit 0.30 + DX12".into(),
                    format!("Build: {}", env!("CARGO_PKG_VERSION")),
                    "License: MIT".into(),
                ];
                self.palette.enter_command_history(items);
            }
            PaletteAction::ShowWatchdog => {
                if let Some(path) = self.repo_path() {
                    let rules_path = std::path::Path::new(&path).join(".aether").join("watchdog.json");
                    if rules_path.exists() {
                        match EditorState::open(&rules_path) {
                            Ok(editor) => self.content_pane = ContentPane::Editor(editor),
                            Err(e) => self.toasts.error(format!("Cannot open watchdog: {}", e)),
                        }
                    } else {
                        self.toasts.info("No watchdog rules found. Create .aether/watchdog.json");
                    }
                }
            }
            PaletteAction::OpenSettings => {
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
                self.handle_spawn_agent(cli, model);
            }
            PaletteAction::SpawnShell(name) => {
                let shell = match name.as_str() {
                    "PowerShell" => ShellType::PowerShell,
                    "CMD" => ShellType::Cmd,
                    "Git Bash" => ShellType::GitBash,
                    "WSL" => ShellType::Wsl,
                    _ => ShellType::PowerShell,
                };
                self.spawn_pty_with_shell(shell);
                self.content_pane = ContentPane::Terminal;
            }
            PaletteAction::None => {}
        }
    }

    fn handle_spawn_agent(&mut self, cli: String, model: String) {
        // Special cases: file operations and commit
        if let Some(dir) = cli.strip_prefix("__newfile__") {
            if !model.is_empty() {
                let path = std::path::Path::new(dir).join(&model);
                if let Err(e) = std::fs::write(&path, "") {
                    self.toasts.error(format!("Create file: {}", e));
                } else {
                    self.toasts.success(format!("Created {}", model));
                    if let Some(tree) = &mut self.sidebar.file_tree { tree.rebuild(); }
                }
            }
            return;
        }
        if let Some(dir) = cli.strip_prefix("__newfolder__") {
            if !model.is_empty() {
                let path = std::path::Path::new(dir).join(&model);
                if let Err(e) = std::fs::create_dir_all(&path) {
                    self.toasts.error(format!("Create folder: {}", e));
                } else {
                    self.toasts.success(format!("Created {}/", model));
                    if let Some(tree) = &mut self.sidebar.file_tree { tree.rebuild(); }
                }
            }
            return;
        }
        if let Some(old_path) = cli.strip_prefix("__rename__") {
            if !model.is_empty() {
                let old = std::path::Path::new(old_path);
                let new = old.parent().unwrap_or(old).join(&model);
                if let Err(e) = std::fs::rename(old, &new) {
                    self.toasts.error(format!("Rename: {}", e));
                } else {
                    self.toasts.success(format!("Renamed to {}", model));
                    if let Some(tree) = &mut self.sidebar.file_tree { tree.rebuild(); }
                }
            }
            return;
        }
        if let Some(col_str) = cli.strip_prefix("__kanban__") {
            if let Ok(col) = col_str.parse::<usize>() {
                if !model.is_empty() {
                    if let ContentPane::Kanban(kanban) = &mut self.content_pane {
                        kanban.add_card(col, model);
                        self.toasts.success("Card added");
                    }
                }
            }
            return;
        }
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

    /// Apply a setting change from the settings palette.
    pub(super) fn apply_setting(&mut self, category: &str, value: &str) {
        match category {
            "root" => {
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
                crate::ui::theme::set_theme(value);
                let _ = save_config(&self.config);
                log::info!("Theme changed to: {}", value);
            }
            "Font Size" => {
                if let Ok(size) = value.parse::<u32>() {
                    self.config.appearance.font_size = size;
                    self.font = FontManager::new(size as f32, self.config.appearance.line_height);
                    let _ = save_config(&self.config);
                    self.recalc_grid_size();
                    self.atlas = std::sync::Mutex::new(GlyphAtlas::new(2048, 2048));
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

    /// Spawn a new PTY tab.
    pub(super) fn spawn_pty(&mut self) {
        self.spawn_pty_with_shell(ShellType::PowerShell);
    }

    pub(super) fn spawn_pty_with_shell(&mut self, shell: ShellType) {
        let shell_name = match &shell {
            ShellType::PowerShell => "PowerShell".to_string(),
            ShellType::Cmd => "CMD".to_string(),
            ShellType::GitBash => "Git Bash".to_string(),
            ShellType::Wsl => "WSL".to_string(),
        };

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
                self.spawn_pty_reader(&id, grid.clone());
                self.chrome.add_tab(id.clone(), shell_name.clone(), shell_name.clone());
                self.tab_states.push(TabState::new_single(id, grid, None));
                self.chrome.active_tab = self.tab_states.len() - 1;
            }
            Err(e) => log::error!("Failed to spawn PTY: {}", e),
        }
    }

    /// Spawn an agent CLI in a new PTY tab with output monitoring.
    pub(super) fn spawn_agent_pty(&mut self, cli: AgentCli, model: Option<&str>) {
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
                                    let mut g = match grid_clone.lock() {
                                        Ok(g) => g,
                                        Err(_) => break,
                                    };
                                    let mut performer = GridPerformer { grid: &mut g };
                                    for byte in &buf[..n] {
                                        vte_parser.advance(&mut performer, *byte);
                                    }
                                    g.needs_redraw = true;
                                    drop(g);

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
                                    if result.usage.cost.is_some() || result.usage.tokens.is_some() {
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
                        let _ = agent_tx.send(AgentUpdate::Status(pty_id_clone, AgentStatus::Done));
                    });
                }
                let model_display = model.unwrap_or("default").to_string();
                let tab_name = format!("{} ({})", cli_label, model_display);
                self.chrome.add_tab(id.clone(), tab_name, cli_label.clone());
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

    /// Split the focused pane in the active tab.
    pub(super) fn split_focused_pane(&mut self, dir: SplitDir) {
        let size = self
            .window
            .as_ref()
            .map(|w| w.inner_size())
            .unwrap_or(winit::dpi::PhysicalSize::new(1200, 700));
        let content_w = size.width as f32 - self.sidebar.width();
        let content_h = (size.height as f32 - ui::CHROME_TOP - ui::STATUS_BAR_HEIGHT).max(1.0);
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
                self.spawn_pty_reader(&id, grid.clone());
                if let Some(tab) = self.tab_states.get_mut(self.chrome.active_tab) {
                    let new_id = tab.next_pane_id;
                    tab.next_pane_id += 1;
                    let new_leaf = PaneLeaf {
                        id: new_id,
                        pty_id: id,
                        grid,
                        agent_info: None,
                        block_tracker: crate::ui::block::BlockTracker::new(),
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

    /// Close the focused pane in the active tab.
    pub(super) fn close_focused_pane(&mut self) {
        let tab = match self.tab_states.get_mut(self.chrome.active_tab) {
            Some(t) => t,
            None => return,
        };
        let leaf_count = tab.root.leaf_ids().len();
        if leaf_count <= 1 {
            let idx = self.chrome.active_tab;
            self.handle_chrome_action(ChromeAction::CloseTab(idx));
            return;
        }
        let target = tab.focused_pane_id;
        if let Some(pty_id) = tab.root.close_leaf(target) {
            let _ = self.pty_manager.close(&pty_id);
            let ids = tab.root.leaf_ids();
            tab.focused_pane_id = ids.first().copied().unwrap_or(0);
            self.toasts.info("Pane closed");
        }
    }
}
