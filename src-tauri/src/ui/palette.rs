//! Command palette — Ctrl+Shift+P overlay.
//!
//! Floating overlay with text input and filtered command list.
//! Supports sub-modes for worktree create / switch / delete.
//! Rendered as RectInstance + GlyphInstance on top of all content.

use crate::gpu::atlas::GlyphAtlas;
use crate::gpu::font::FontManager;
use crate::gpu::renderer::{GlyphInstance, RectInstance};

use super::animation::AnimatedValue;
use super::cat;

const PALETTE_WIDTH: f32 = 500.0;
const INPUT_HEIGHT: f32 = 32.0;
const ITEM_HEIGHT: f32 = 26.0;
const MAX_VISIBLE_ITEMS: usize = 10;
const PADDING: f32 = 8.0;

/// A command that can be executed from the palette.
#[derive(Clone)]
pub struct PaletteCommand {
    pub id: &'static str,
    pub label: &'static str,
    pub shortcut: &'static str,
}

/// A worktree entry for list selection.
#[derive(Debug, Clone)]
pub struct WorktreeEntry {
    pub name: String,
    pub path: String,
    pub branch: String,
    pub is_main: bool,
}

/// Step within the watchdog creation wizard.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WatchdogCreateStep {
    EnterName,
    EnterInstructions,
    SelectTarget,
}

/// Palette operating mode.
#[derive(Debug)]
pub enum PaletteMode {
    /// Normal: filter and select from static commands.
    Command,
    /// Text input: enter a branch name to create a worktree.
    WorktreeCreate,
    /// List selection: pick a worktree to switch to or delete.
    WorktreeSelect {
        entries: Vec<WorktreeEntry>,
        delete: bool,
    },
    /// Command history search (Ctrl+R style).
    CommandHistory {
        commands: Vec<String>,
    },
    /// Agent spawn: select model then launch (cli stored for context).
    AgentSpawn {
        cli: String,
    },
    /// Terminal text search.
    TerminalSearch,
    /// Quick open file (Ctrl+P).
    FileSearch {
        files: Vec<String>,
    },
    /// Settings selection list.
    Settings {
        items: Vec<String>,
        category: String,
    },
    /// Watchdog creation wizard (multi-step).
    WatchdogCreate {
        step: WatchdogCreateStep,
        name: String,
        instructions: String,
        target_pty_id: String,
    },
}

/// Actions produced by the command palette.
#[derive(Debug, Clone)]
pub enum PaletteAction {
    NewTab,
    CloseTab,
    ToggleSidebar,
    SaveFile,
    CloseEditor,
    // Worktree mode transitions (palette stays open)
    BeginWorktreeCreate,
    BeginWorktreeSwitch,
    BeginWorktreeDelete,
    // Worktree confirmations (palette closes)
    DoWorktreeCreate(String),
    DoWorktreeSwitch(String),
    DoWorktreeDelete(String),
    // Command history
    BeginCommandHistory,
    RunCommand(String),
    // Agent
    BeginAgentClaude,
    BeginAgentCodex,
    BeginAgentGemini,
    SpawnAgent { cli: String, model: String },
    SearchTerminal(String),
    OpenFile(String),
    ScmStageAll,
    ScmCommit,
    ScmPush,
    PrList,
    WorkflowList,
    WorkflowStatus,
    OpenKanban,
    ShowHelp,
    ShowAbout,
    ShowWatchdog,
    CreateWatchdog { name: String, instructions: String, target_pty_id: String },
    PauseWatchdog(usize),
    ResumeWatchdog(usize),
    RemoveWatchdog(usize),
    OpenSettings,
    ChangeSetting { category: String, value: String },
    SpawnShell(String),
    OpenFileSearch,
    OpenHelm,
    OpenAnalytics,
    TogglePaneSync,
    RunTool(usize),
    None,
}

/// Built-in commands.
const COMMANDS: &[PaletteCommand] = &[
    PaletteCommand { id: "new_tab", label: "New Terminal Tab", shortcut: "" },
    PaletteCommand { id: "new_tab_shell", label: "New Terminal (Select Shell)", shortcut: "" },
    PaletteCommand { id: "close_tab", label: "Close Tab", shortcut: "" },
    PaletteCommand { id: "toggle_sidebar", label: "Toggle Sidebar", shortcut: "Ctrl+B" },
    PaletteCommand { id: "save_file", label: "Save File", shortcut: "Ctrl+S" },
    PaletteCommand { id: "close_editor", label: "Close Editor", shortcut: "Esc" },
    PaletteCommand { id: "wt_create", label: "Git: Create Worktree", shortcut: "" },
    PaletteCommand { id: "wt_switch", label: "Git: Switch Worktree", shortcut: "" },
    PaletteCommand { id: "wt_delete", label: "Git: Delete Worktree", shortcut: "" },
    PaletteCommand { id: "cmd_history", label: "Command History", shortcut: "Ctrl+R" },
    PaletteCommand { id: "settings", label: "Settings", shortcut: "Ctrl+," },
    PaletteCommand { id: "scm_stage_all", label: "Git: Stage All", shortcut: "" },
    PaletteCommand { id: "scm_commit", label: "Git: Commit", shortcut: "" },
    PaletteCommand { id: "scm_push", label: "Git: Push", shortcut: "" },
    PaletteCommand { id: "pr_list", label: "PR: List Pull Requests", shortcut: "" },
    PaletteCommand { id: "wf_list", label: "Workflow: List", shortcut: "" },
    PaletteCommand { id: "wf_status", label: "Workflow: Status", shortcut: "" },
    PaletteCommand { id: "kanban", label: "Kanban Board", shortcut: "" },
    PaletteCommand { id: "pane_sync", label: "Toggle Pane Sync", shortcut: "" },
    PaletteCommand { id: "help", label: "Help: Keyboard Shortcuts", shortcut: "Ctrl+?" },
    PaletteCommand { id: "about", label: "About Aether Terminal", shortcut: "" },
    PaletteCommand { id: "watchdog", label: "Watchdog: Edit Rules", shortcut: "" },
    PaletteCommand { id: "file_search", label: "Search in Files", shortcut: "Ctrl+Shift+G" },
    PaletteCommand { id: "helm", label: "Tasks (Helm)", shortcut: "" },
    PaletteCommand { id: "analytics", label: "View Analytics", shortcut: "" },
    PaletteCommand { id: "agent_claude", label: "Agent: Start Claude", shortcut: "" },
    PaletteCommand { id: "agent_codex", label: "Agent: Start Codex", shortcut: "" },
    PaletteCommand { id: "agent_gemini", label: "Agent: Start Gemini", shortcut: "" },
];

pub struct PaletteOutput {
    pub rects: Vec<RectInstance>,
    pub glyphs: Vec<GlyphInstance>,
}

/// Command palette state.
pub struct PaletteState {
    pub visible: bool,
    pub input: String,
    pub selected: usize,
    filtered: Vec<usize>,
    mode: PaletteMode,
    /// Opacity animation for smooth show/hide.
    opacity: AnimatedValue,
    /// Scale animation for subtle pop-in effect.
    scale: AnimatedValue,
}

impl PaletteState {
    pub fn new() -> Self {
        let filtered = (0..COMMANDS.len()).collect();
        Self {
            visible: false,
            input: String::new(),
            selected: 0,
            filtered,
            mode: PaletteMode::Command,
            opacity: AnimatedValue::ease_out(0.0, 9), // ~150ms at 60fps
            scale: AnimatedValue::ease_out(1.0, 9),
        }
    }

    pub fn toggle(&mut self) {
        if self.visible {
            self.close();
        } else {
            self.visible = true;
            self.input.clear();
            self.selected = 0;
            self.mode = PaletteMode::Command;
            self.update_filter();
            self.opacity.set_target(1.0);
            self.scale.set_target(1.0);
            // Start from slightly scaled down
            self.scale.current = 0.97;
            self.scale.easing = super::animation::EasingMode::EaseOutCubic {
                duration_frames: 9,
                elapsed: 0,
                origin: 0.97,
            };
        }
    }

    pub fn close(&mut self) {
        self.visible = false;
        self.mode = PaletteMode::Command;
        self.opacity.set_target(0.0);
        self.scale.snap(); // no exit animation for scale
    }

    /// Advance palette animation by one frame.
    pub fn tick(&mut self) {
        self.opacity.tick();
        self.scale.tick();
    }

    /// Current opacity for rendering (0.0 = invisible, 1.0 = fully visible).
    pub fn render_opacity(&self) -> f32 {
        self.opacity.current.clamp(0.0, 1.0)
    }

    /// Whether the palette should be drawn at all.
    pub fn should_render(&self) -> bool {
        self.visible || self.opacity.current > 0.01
    }

    /// Insert a character into the input.
    pub fn insert_char(&mut self, ch: &str) {
        self.input.push_str(ch);
        self.selected = 0;
        self.update_filter();
    }

    /// Delete last character.
    pub fn backspace(&mut self) {
        self.input.pop();
        self.selected = 0;
        self.update_filter();
    }

    /// Move selection up.
    pub fn select_up(&mut self) {
        if self.selected > 0 {
            self.selected -= 1;
        }
    }

    /// Move selection down.
    pub fn select_down(&mut self) {
        let count = match &self.mode {
            PaletteMode::Command
            | PaletteMode::WorktreeSelect { .. }
            | PaletteMode::CommandHistory { .. }
            | PaletteMode::FileSearch { .. }
            | PaletteMode::Settings { .. } => self.filtered.len(),
            PaletteMode::WorktreeCreate
            | PaletteMode::AgentSpawn { .. }
            | PaletteMode::TerminalSearch
            | PaletteMode::WatchdogCreate { .. } => 0,
        };
        if self.selected + 1 < count {
            self.selected += 1;
        }
    }

    /// Enter worktree create mode (text input for branch name).
    pub fn enter_worktree_create(&mut self) {
        self.mode = PaletteMode::WorktreeCreate;
        self.input.clear();
        self.selected = 0;
        self.filtered.clear();
    }

    /// Enter worktree select mode (pick from list).
    pub fn enter_worktree_select(&mut self, entries: Vec<WorktreeEntry>, delete: bool) {
        self.filtered = (0..entries.len()).collect();
        self.mode = PaletteMode::WorktreeSelect { entries, delete };
        self.input.clear();
        self.selected = 0;
    }

    /// Enter agent spawn mode (type model name).
    pub fn enter_agent_spawn(&mut self, cli: String) {
        self.mode = PaletteMode::AgentSpawn { cli };
        self.input.clear();
        self.selected = 0;
        self.filtered.clear();
    }

    /// Enter settings list mode.
    pub fn enter_settings(&mut self, items: Vec<String>, category: String) {
        self.filtered = (0..items.len()).collect();
        self.mode = PaletteMode::Settings { items, category };
        self.input.clear();
        self.selected = 0;
    }

    /// Enter file search mode (Quick Open).
    pub fn enter_file_search(&mut self, files: Vec<String>) {
        self.filtered = (0..files.len()).collect();
        self.mode = PaletteMode::FileSearch { files };
        self.input.clear();
        self.selected = 0;
    }

    /// Enter terminal search mode.
    pub fn enter_terminal_search(&mut self) {
        self.mode = PaletteMode::TerminalSearch;
        self.input.clear();
        self.selected = 0;
        self.filtered.clear();
    }

    /// Enter command history search mode.
    pub fn enter_command_history(&mut self, commands: Vec<String>) {
        self.filtered = (0..commands.len()).collect();
        self.mode = PaletteMode::CommandHistory { commands };
        self.input.clear();
        self.selected = 0;
    }

    /// Enter watchdog creation wizard at the name entry step.
    pub fn enter_watchdog_create(&mut self) {
        self.mode = PaletteMode::WatchdogCreate {
            step: WatchdogCreateStep::EnterName,
            name: String::new(),
            instructions: String::new(),
            target_pty_id: String::new(),
        };
        self.input.clear();
        self.selected = 0;
        self.filtered.clear();
    }

    /// Execute the selected command or confirm the current sub-mode.
    pub fn execute(&mut self) -> PaletteAction {
        match &self.mode {
            PaletteMode::Command => {
                let action = if let Some(&cmd_idx) = self.filtered.get(self.selected) {
                    match COMMANDS[cmd_idx].id {
                        "new_tab" => PaletteAction::NewTab,
                        "new_tab_shell" => {
                            // Enter settings mode with shell options
                            let shells: Vec<String> = crate::pty::ShellType::detect_available()
                                .iter()
                                .map(|s| match s {
                                    crate::pty::ShellType::PowerShell => "PowerShell".to_string(),
                                    crate::pty::ShellType::Cmd => "CMD".to_string(),
                                    crate::pty::ShellType::GitBash => "Git Bash".to_string(),
                                    crate::pty::ShellType::Wsl => "WSL".to_string(),
                                })
                                .collect();
                            self.enter_settings(shells, "shell_select".to_string());
                            return PaletteAction::None;
                        }
                        "close_tab" => PaletteAction::CloseTab,
                        "toggle_sidebar" => PaletteAction::ToggleSidebar,
                        "save_file" => PaletteAction::SaveFile,
                        "close_editor" => PaletteAction::CloseEditor,
                        "wt_create" => PaletteAction::BeginWorktreeCreate,
                        "wt_switch" => PaletteAction::BeginWorktreeSwitch,
                        "wt_delete" => PaletteAction::BeginWorktreeDelete,
                        "cmd_history" => PaletteAction::BeginCommandHistory,
                        "settings" => PaletteAction::OpenSettings,
                        "scm_stage_all" => PaletteAction::ScmStageAll,
                        "scm_commit" => PaletteAction::ScmCommit,
                        "scm_push" => PaletteAction::ScmPush,
                        "pr_list" => PaletteAction::PrList,
                        "wf_list" => PaletteAction::WorkflowList,
                        "wf_status" => PaletteAction::WorkflowStatus,
                        "kanban" => PaletteAction::OpenKanban,
                        "pane_sync" => PaletteAction::TogglePaneSync,
                        "file_search" => PaletteAction::OpenFileSearch,
                        "helm" => PaletteAction::OpenHelm,
                        "analytics" => PaletteAction::OpenAnalytics,
                        "help" => PaletteAction::ShowHelp,
                        "about" => PaletteAction::ShowAbout,
                        "watchdog" => PaletteAction::ShowWatchdog,
                        "agent_claude" => PaletteAction::BeginAgentClaude,
                        "agent_codex" => PaletteAction::BeginAgentCodex,
                        "agent_gemini" => PaletteAction::BeginAgentGemini,
                        _ => PaletteAction::None,
                    }
                } else {
                    PaletteAction::None
                };
                // Only close for final actions, not mode transitions
                match &action {
                    PaletteAction::BeginWorktreeCreate
                    | PaletteAction::BeginWorktreeSwitch
                    | PaletteAction::BeginWorktreeDelete
                    | PaletteAction::BeginCommandHistory
                    | PaletteAction::BeginAgentClaude
                    | PaletteAction::BeginAgentCodex
                    | PaletteAction::BeginAgentGemini
                    | PaletteAction::OpenSettings
                    | PaletteAction::ShowWatchdog => {}
                    _ => self.close(),
                }
                action
            }
            PaletteMode::WorktreeCreate => {
                let name = self.input.trim().to_string();
                if name.is_empty() {
                    return PaletteAction::None;
                }
                self.close();
                PaletteAction::DoWorktreeCreate(name)
            }
            PaletteMode::WorktreeSelect { entries, delete } => {
                if let Some(&idx) = self.filtered.get(self.selected) {
                    if let Some(entry) = entries.get(idx) {
                        let action = if *delete {
                            if entry.is_main {
                                return PaletteAction::None; // cannot delete main worktree
                            }
                            PaletteAction::DoWorktreeDelete(entry.name.clone())
                        } else {
                            PaletteAction::DoWorktreeSwitch(entry.path.clone())
                        };
                        self.close();
                        return action;
                    }
                }
                PaletteAction::None
            }
            PaletteMode::CommandHistory { commands } => {
                if let Some(&idx) = self.filtered.get(self.selected) {
                    if let Some(cmd) = commands.get(idx) {
                        let action = PaletteAction::RunCommand(cmd.clone());
                        self.close();
                        return action;
                    }
                }
                PaletteAction::None
            }
            PaletteMode::AgentSpawn { cli } => {
                let model = self.input.trim().to_string();
                let cli = cli.clone();
                self.close();
                PaletteAction::SpawnAgent { cli, model }
            }
            PaletteMode::TerminalSearch => {
                let query = self.input.clone();
                self.close();
                PaletteAction::SearchTerminal(query)
            }
            PaletteMode::FileSearch { files } => {
                if let Some(&idx) = self.filtered.get(self.selected) {
                    if let Some(path) = files.get(idx) {
                        let action = PaletteAction::OpenFile(path.clone());
                        self.close();
                        return action;
                    }
                }
                PaletteAction::None
            }
            PaletteMode::Settings { items, category } => {
                if let Some(&idx) = self.filtered.get(self.selected) {
                    if let Some(value) = items.get(idx) {
                        if category == "shell_select" {
                            let shell = value.clone();
                            self.close();
                            return PaletteAction::SpawnShell(shell);
                        }
                        let action = PaletteAction::ChangeSetting {
                            category: category.clone(),
                            value: value.clone(),
                        };
                        self.close();
                        return action;
                    }
                }
                PaletteAction::None
            }
            PaletteMode::WatchdogCreate { step, name, instructions, target_pty_id } => {
                let input_val = self.input.trim().to_string();
                match step {
                    WatchdogCreateStep::EnterName => {
                        if input_val.is_empty() {
                            return PaletteAction::None;
                        }
                        // Advance to instructions step
                        self.mode = PaletteMode::WatchdogCreate {
                            step: WatchdogCreateStep::EnterInstructions,
                            name: input_val,
                            instructions: String::new(),
                            target_pty_id: target_pty_id.clone(),
                        };
                        self.input.clear();
                        PaletteAction::None
                    }
                    WatchdogCreateStep::EnterInstructions => {
                        // Advance to target selection step
                        self.mode = PaletteMode::WatchdogCreate {
                            step: WatchdogCreateStep::SelectTarget,
                            name: name.clone(),
                            instructions: input_val,
                            target_pty_id: String::new(),
                        };
                        self.input.clear();
                        PaletteAction::None
                    }
                    WatchdogCreateStep::SelectTarget => {
                        if input_val.is_empty() {
                            return PaletteAction::None;
                        }
                        let action = PaletteAction::CreateWatchdog {
                            name: name.clone(),
                            instructions: instructions.clone(),
                            target_pty_id: input_val,
                        };
                        self.close();
                        action
                    }
                }
            }
        }
    }

    fn update_filter(&mut self) {
        let query = self.input.to_lowercase();
        match &self.mode {
            PaletteMode::Command => {
                self.filtered = (0..COMMANDS.len())
                    .filter(|&i| {
                        if query.is_empty() {
                            return true;
                        }
                        COMMANDS[i].label.to_lowercase().contains(&query)
                    })
                    .collect();
            }
            PaletteMode::WorktreeSelect { entries, .. } => {
                self.filtered = (0..entries.len())
                    .filter(|&i| {
                        if query.is_empty() {
                            return true;
                        }
                        entries[i].name.to_lowercase().contains(&query)
                            || entries[i].branch.to_lowercase().contains(&query)
                    })
                    .collect();
            }
            PaletteMode::WorktreeCreate
            | PaletteMode::AgentSpawn { .. }
            | PaletteMode::TerminalSearch
            | PaletteMode::WatchdogCreate { .. } => {
                // No filtering in input mode
            }
            PaletteMode::CommandHistory { commands } => {
                self.filtered = (0..commands.len())
                    .filter(|&i| {
                        if query.is_empty() {
                            return true;
                        }
                        commands[i].to_lowercase().contains(&query)
                    })
                    .collect();
            }
            PaletteMode::FileSearch { files } => {
                self.filtered = (0..files.len())
                    .filter(|&i| {
                        if query.is_empty() {
                            return true;
                        }
                        files[i].to_lowercase().contains(&query)
                    })
                    .collect();
            }
            PaletteMode::Settings { items, .. } => {
                self.filtered = (0..items.len())
                    .filter(|&i| {
                        if query.is_empty() {
                            return true;
                        }
                        items[i].to_lowercase().contains(&query)
                    })
                    .collect();
            }
        }
    }

    /// Build overlay rendering instances.
    pub fn build(
        &self,
        font: &FontManager,
        atlas: &mut GlyphAtlas,
        window_w: f32,
    ) -> PaletteOutput {
        let mut rects = Vec::new();
        let mut glyphs = Vec::new();

        if !self.should_render() {
            return PaletteOutput { rects, glyphs };
        }

        let palette_x = (window_w - PALETTE_WIDTH) / 2.0;
        let palette_y: f32 = 80.0;

        // Calculate height based on mode
        let item_count = match &self.mode {
            PaletteMode::Command
            | PaletteMode::WorktreeSelect { .. }
            | PaletteMode::CommandHistory { .. }
            | PaletteMode::FileSearch { .. }
            | PaletteMode::Settings { .. } => self.filtered.len().min(MAX_VISIBLE_ITEMS),
            PaletteMode::WorktreeCreate
            | PaletteMode::AgentSpawn { .. }
            | PaletteMode::TerminalSearch
            | PaletteMode::WatchdogCreate { .. } => 1,
        };
        let palette_h = INPUT_HEIGHT + item_count as f32 * ITEM_HEIGHT + PADDING * 2.0;

        // Dimmed backdrop
        rects.push(RectInstance::new([0.0, 0.0], [window_w, 2000.0], [0.0, 0.0, 0.0, 0.4]));

        // Palette background
        rects.push(RectInstance::rounded([palette_x, palette_y], [PALETTE_WIDTH, palette_h], cat::pm(30, 30, 46, 250), 12.0));

        // Border — color varies by mode
        let border_color = match &self.mode {
            PaletteMode::Command => cat::pm(137, 180, 250, 200),
            PaletteMode::WorktreeCreate => cat::pm(166, 227, 161, 200),
            PaletteMode::WorktreeSelect { delete: true, .. } => cat::pm(243, 139, 168, 200),
            PaletteMode::WorktreeSelect { delete: false, .. } => cat::pm(250, 179, 135, 200),
            PaletteMode::CommandHistory { .. } => cat::pm(203, 166, 247, 200), // Mauve
            PaletteMode::AgentSpawn { .. } => cat::pm(148, 226, 213, 200),   // Teal
            PaletteMode::TerminalSearch => cat::pm(249, 226, 175, 200),     // Yellow
            PaletteMode::FileSearch { .. } => cat::pm(166, 227, 161, 200), // Green
            PaletteMode::Settings { .. } => cat::pm(245, 194, 231, 200),  // Pink
            PaletteMode::WatchdogCreate { .. } => cat::pm(250, 179, 135, 200), // Peach
        };
        rects.push(RectInstance::new([palette_x, palette_y], [PALETTE_WIDTH, 1.0], border_color));

        // Input background
        let input_y = palette_y + PADDING;
        rects.push(RectInstance::rounded([palette_x + PADDING, input_y], [PALETTE_WIDTH - PADDING * 2.0, INPUT_HEIGHT], cat::pm(24, 24, 37, 250), 6.0));

        // Input text — placeholder depends on mode
        let text_y = input_y + (INPUT_HEIGHT - font.cell_height) / 2.0;
        let (display_input, input_color) = if self.input.is_empty() {
            let placeholder = match &self.mode {
                PaletteMode::Command => "> Type a command...",
                PaletteMode::WorktreeCreate => "Branch name (e.g. feat/my-feature)...",
                PaletteMode::WorktreeSelect { delete: true, .. } => "Filter worktrees to delete...",
                PaletteMode::WorktreeSelect { delete: false, .. } => "Filter worktrees...",
                PaletteMode::CommandHistory { .. } => "Search command history...",
                PaletteMode::AgentSpawn { .. } => "Model (e.g. opus, sonnet) — Enter for default...",
                PaletteMode::TerminalSearch => "Search terminal output...",
                PaletteMode::FileSearch { .. } => "Open file...",
                PaletteMode::Settings { .. } => "Select option...",
                PaletteMode::WatchdogCreate { step, .. } => match step {
                    WatchdogCreateStep::EnterName => "Watchdog name...",
                    WatchdogCreateStep::EnterInstructions => "Instructions (what to watch for)...",
                    WatchdogCreateStep::SelectTarget => "Target PTY ID...",
                },
            };
            (placeholder, cat::OVERLAY0)
        } else {
            (self.input.as_str(), cat::TEXT)
        };
        super::render_text(
            font,
            atlas,
            display_input,
            palette_x + PADDING + 4.0,
            text_y,
            input_color,
            &mut glyphs,
        );

        // Cursor in input (always visible in create mode, otherwise only when text present)
        if !self.input.is_empty()
            || matches!(self.mode, PaletteMode::WorktreeCreate | PaletteMode::AgentSpawn { .. } | PaletteMode::TerminalSearch | PaletteMode::WatchdogCreate { .. })
        {
            let cursor_x = palette_x + PADDING + 4.0
                + self.input.chars().count() as f32 * font.cell_width;
            rects.push(RectInstance::new([cursor_x, text_y], [2.0, font.cell_height], cat::TEXT));
        }

        // Item list — depends on mode
        let list_y = input_y + INPUT_HEIGHT + 4.0;
        match &self.mode {
            PaletteMode::Command => {
                self.build_command_list(font, atlas, palette_x, list_y, &mut rects, &mut glyphs);
            }
            PaletteMode::WorktreeCreate => {
                let hint_y = list_y + (ITEM_HEIGHT - font.cell_height) / 2.0;
                super::render_text(
                    font,
                    atlas,
                    "Press Enter to create, Esc to cancel",
                    palette_x + PADDING + 8.0,
                    hint_y,
                    cat::OVERLAY0,
                    &mut glyphs,
                );
            }
            PaletteMode::WorktreeSelect { entries, delete } => {
                self.build_worktree_list(
                    font, atlas, palette_x, list_y, entries, *delete, &mut rects, &mut glyphs,
                );
            }
            PaletteMode::CommandHistory { commands } => {
                self.build_history_list(
                    font, atlas, palette_x, list_y, commands, &mut rects, &mut glyphs,
                );
            }
            PaletteMode::FileSearch { files } => {
                self.build_history_list(
                    font, atlas, palette_x, list_y, files, &mut rects, &mut glyphs,
                );
            }
            PaletteMode::Settings { items, .. } => {
                self.build_history_list(
                    font, atlas, palette_x, list_y, items, &mut rects, &mut glyphs,
                );
            }
            PaletteMode::TerminalSearch => {
                let hint_y = list_y + (ITEM_HEIGHT - font.cell_height) / 2.0;
                super::render_text(
                    font,
                    atlas,
                    "Enter to search, Esc to clear",
                    palette_x + PADDING + 8.0,
                    hint_y,
                    cat::OVERLAY0,
                    &mut glyphs,
                );
            }
            PaletteMode::AgentSpawn { cli } => {
                let hint_y = list_y + (ITEM_HEIGHT - font.cell_height) / 2.0;
                let hint = format!("Enter to start {} (empty = default model)", cli);
                super::render_text(
                    font,
                    atlas,
                    &hint,
                    palette_x + PADDING + 8.0,
                    hint_y,
                    cat::OVERLAY0,
                    &mut glyphs,
                );
            }
            PaletteMode::WatchdogCreate { step, .. } => {
                let hint_y = list_y + (ITEM_HEIGHT - font.cell_height) / 2.0;
                let hint = match step {
                    WatchdogCreateStep::EnterName => "Step 1/3: Enter watchdog name, then press Enter",
                    WatchdogCreateStep::EnterInstructions => "Step 2/3: Enter instructions, then press Enter",
                    WatchdogCreateStep::SelectTarget => "Step 3/3: Enter target PTY ID, then press Enter",
                };
                super::render_text(
                    font,
                    atlas,
                    hint,
                    palette_x + PADDING + 8.0,
                    hint_y,
                    cat::OVERLAY0,
                    &mut glyphs,
                );
            }
        }

        PaletteOutput { rects, glyphs }
    }

    fn build_command_list(
        &self,
        font: &FontManager,
        atlas: &mut GlyphAtlas,
        palette_x: f32,
        list_y: f32,
        rects: &mut Vec<RectInstance>,
        glyphs: &mut Vec<GlyphInstance>,
    ) {
        for (i, &cmd_idx) in self.filtered.iter().enumerate().take(MAX_VISIBLE_ITEMS) {
            let item_y = list_y + i as f32 * ITEM_HEIGHT;
            let cmd = &COMMANDS[cmd_idx];

            // Selected highlight
            if i == self.selected {
                rects.push(RectInstance::rounded([palette_x + PADDING, item_y], [PALETTE_WIDTH - PADDING * 2.0, ITEM_HEIGHT], cat::pm(69, 71, 90, 150), 4.0));
            }

            // Command label
            let label_y = item_y + (ITEM_HEIGHT - font.cell_height) / 2.0;
            super::render_text(
                font,
                atlas,
                cmd.label,
                palette_x + PADDING + 8.0,
                label_y,
                cat::TEXT,
                glyphs,
            );

            // Shortcut (right-aligned)
            if !cmd.shortcut.is_empty() {
                let shortcut_w = cmd.shortcut.chars().count() as f32 * font.cell_width;
                super::render_text(
                    font,
                    atlas,
                    cmd.shortcut,
                    palette_x + PALETTE_WIDTH - PADDING - 8.0 - shortcut_w,
                    label_y,
                    cat::OVERLAY0,
                    glyphs,
                );
            }
        }
    }

    fn build_worktree_list(
        &self,
        font: &FontManager,
        atlas: &mut GlyphAtlas,
        palette_x: f32,
        list_y: f32,
        entries: &[WorktreeEntry],
        delete: bool,
        rects: &mut Vec<RectInstance>,
        glyphs: &mut Vec<GlyphInstance>,
    ) {
        for (i, &entry_idx) in self.filtered.iter().enumerate().take(MAX_VISIBLE_ITEMS) {
            let item_y = list_y + i as f32 * ITEM_HEIGHT;
            let entry = match entries.get(entry_idx) {
                Some(e) => e,
                None => continue,
            };

            // Selected highlight
            if i == self.selected {
                let color = if delete {
                    cat::pm(243, 139, 168, 40)
                } else {
                    cat::pm(69, 71, 90, 150)
                };
                rects.push(RectInstance::rounded([palette_x + PADDING, item_y], [PALETTE_WIDTH - PADDING * 2.0, ITEM_HEIGHT], color, 4.0));
            }

            let label_y = item_y + (ITEM_HEIGHT - font.cell_height) / 2.0;

            // Branch name (with main marker)
            let label = if entry.is_main {
                format!("{} (main)", entry.branch)
            } else {
                entry.branch.clone()
            };
            let label_color = if delete && entry.is_main {
                cat::OVERLAY0 // dimmed — cannot delete main
            } else {
                cat::TEXT
            };
            super::render_text(
                font,
                atlas,
                &label,
                palette_x + PADDING + 8.0,
                label_y,
                label_color,
                glyphs,
            );

            // Path (right-aligned, truncated)
            let path_display = truncate_path(&entry.path, 30);
            let path_w = path_display.chars().count() as f32 * font.cell_width;
            super::render_text(
                font,
                atlas,
                &path_display,
                palette_x + PALETTE_WIDTH - PADDING - 8.0 - path_w,
                label_y,
                cat::OVERLAY0,
                glyphs,
            );
        }
    }

    fn build_history_list(
        &self,
        font: &FontManager,
        atlas: &mut GlyphAtlas,
        palette_x: f32,
        list_y: f32,
        commands: &[String],
        rects: &mut Vec<RectInstance>,
        glyphs: &mut Vec<GlyphInstance>,
    ) {
        for (i, &cmd_idx) in self.filtered.iter().enumerate().take(MAX_VISIBLE_ITEMS) {
            let item_y = list_y + i as f32 * ITEM_HEIGHT;
            let cmd = match commands.get(cmd_idx) {
                Some(c) => c,
                None => continue,
            };

            if i == self.selected {
                rects.push(RectInstance::rounded([palette_x + PADDING, item_y], [PALETTE_WIDTH - PADDING * 2.0, ITEM_HEIGHT], cat::pm(69, 71, 90, 150), 4.0));
            }

            let label_y = item_y + (ITEM_HEIGHT - font.cell_height) / 2.0;
            // Truncate long commands for display
            let max_chars = ((PALETTE_WIDTH - PADDING * 2.0 - 16.0) / font.cell_width) as usize;
            let display = if cmd.chars().count() > max_chars {
                let truncated: String = cmd.chars().take(max_chars.saturating_sub(3)).collect();
                format!("{}...", truncated)
            } else {
                cmd.clone()
            };
            super::render_text(
                font,
                atlas,
                &display,
                palette_x + PADDING + 8.0,
                label_y,
                cat::TEXT,
                glyphs,
            );
        }
    }
}

/// Truncate a path string to max_chars, keeping the tail.
fn truncate_path(path: &str, max_chars: usize) -> String {
    if path.chars().count() <= max_chars {
        path.to_string()
    } else {
        let tail: String = path
            .chars()
            .rev()
            .take(max_chars.saturating_sub(3))
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect();
        format!("...{}", tail)
    }
}

impl Default for PaletteState {
    fn default() -> Self {
        Self::new()
    }
}
