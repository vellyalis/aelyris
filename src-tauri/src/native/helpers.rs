//! Utility methods for NativeTerminal.

use std::sync::{Arc, Mutex};
use crate::gpu::grid::{Grid, GridPerformer, MouseMode};
use crate::lsp::LspLanguage;
use crate::ui;
use crate::ui::editor::{Diagnostic, DiagnosticSeverity};
use crate::ui::palette::WorktreeEntry;
use crate::config::save_config;
use crate::git;
use super::NativeTerminal;
use crate::ui::activity::ActivityType;
use super::types::{AgentStatus, AgentTabInfo, AgentUpdate, ContentPane};
use super::panes::PaneNode;

impl NativeTerminal {
    /// Get the active tab's grid (if any).
    pub(super) fn active_grid(&self) -> Option<&Arc<Mutex<Grid>>> {
        self.tab_states.get(self.chrome.active_tab).and_then(|t| t.grid())
    }

    /// Get the active tab's focused PTY ID (if any).
    pub(super) fn active_pty_id(&self) -> Option<&str> {
        self.tab_states.get(self.chrome.active_tab).and_then(|t| t.pty_id())
    }

    pub(super) fn write_to_pty(&self, data: &[u8]) {
        if let Some(id) = self.active_pty_id() {
            let _ = self.pty_manager.write(id, data);
        }
    }

    pub(super) fn update_ime_cursor_area(&self) {
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

    /// Get the repo path from sidebar root or current directory.
    pub(super) fn repo_path(&self) -> Option<String> {
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

    pub(super) fn list_worktree_entries(&self) -> Vec<WorktreeEntry> {
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

    pub(super) fn do_create_worktree(&mut self, branch: &str) {
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

    pub(super) fn do_switch_worktree(&mut self, path: &str) {
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

    pub(super) fn do_delete_worktree(&mut self, name: &str) {
        let repo_path = match self.repo_path() {
            Some(p) => p,
            None => return,
        };
        match git::remove_worktree(&repo_path, name, false) {
            Ok(()) => log::info!("Worktree deleted: {}", name),
            Err(e) => log::error!("Failed to delete worktree: {}", e),
        }
    }

    /// Open quick file search (Ctrl+P).
    pub(super) fn open_quick_file_search(&mut self) {
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
        let mut files = Vec::new();
        collect_files(&root, &root, &mut files, 2000);
        if files.is_empty() {
            return;
        }
        self.palette.enter_file_search(files);
    }

    /// Process pending agent status updates from monitor threads.
    pub(super) fn process_agent_updates(&mut self) {
        while let Ok(update) = self.agent_rx.try_recv() {
            match update {
                AgentUpdate::Status(ref pty_id, ref status) => {
                    // Find the tab name for activity logging
                    let tab_name = self.chrome.tabs.iter()
                        .find(|t| t.id == *pty_id)
                        .map(|t| t.title.clone())
                        .unwrap_or_else(|| "Agent".to_string());

                    let activity_event = match status {
                        AgentStatus::Thinking => Some((ActivityType::AgentThinking, "Agent thinking...")),
                        AgentStatus::Coding => Some((ActivityType::AgentCoding, "Agent writing code")),
                        AgentStatus::Done => Some((ActivityType::AgentDone, "Agent finished")),
                        _ => None,
                    };
                    if let Some((event_type, summary)) = activity_event {
                        self.activity.push(tab_name, event_type, summary.to_string());
                    }

                    apply_agent_update_to_tree(&mut self.tab_states, pty_id, |info| {
                        info.status = status.clone();
                    });
                }
                AgentUpdate::Usage(ref pty_id, cost, tokens) => {
                    // Determine CLI name for analytics recording
                    let cli_name = find_agent_cli_name(&self.tab_states, pty_id);
                    self.analytics.record(cli_name, cost, tokens);

                    apply_agent_update_to_tree(&mut self.tab_states, pty_id, |info| {
                        if cost > info.cost { info.cost = cost; }
                        if tokens > info.tokens_used { info.tokens_used = tokens; }
                    });
                }
            }
        }
    }

    /// Get active agent info for status bar display.
    pub(super) fn active_agent_info(&self) -> Option<&AgentTabInfo> {
        self.tab_states
            .get(self.chrome.active_tab)
            .and_then(|t| t.agent_info())
    }

    /// Try to start an LSP server for the opened file.
    pub(super) fn try_start_lsp(&mut self, path: &std::path::Path) {
        let ext = match path.extension().and_then(|e| e.to_str()) {
            Some(e) => e,
            None => return,
        };
        let language = match LspLanguage::from_extension(ext) {
            Some(l) => l,
            None => return,
        };
        let root = path
            .parent()
            .unwrap_or(path)
            .to_string_lossy()
            .into_owned();

        if let Err(e) = self.lsp_manager.start(language.clone(), &root) {
            if !e.contains("already running") {
                log::warn!("LSP start failed: {}", e);
                return;
            }
        }

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

        let initialized = serde_json::json!({
            "jsonrpc": "2.0",
            "method": "initialized",
            "params": {}
        });
        let _ = self.lsp_manager.send(&language, &root, &initialized.to_string());

        let file_uri = format!("file:///{}", path.to_string_lossy().replace('\\', "/"));
        let lang_id = match ext {
            "rs" => "rust",
            "py" => "python",
            "ts" | "tsx" => "typescript",
            "js" | "jsx" => "javascript",
            "go" => "go",
            _ => "plaintext",
        };
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

    pub(super) fn next_request_id(&mut self) -> u64 {
        let id = self.lsp_request_id;
        self.lsp_request_id += 1;
        id
    }

    /// Process pending LSP messages and update editor diagnostics/completions/hover.
    pub(super) fn process_lsp_messages(&mut self) {
        use crate::ui::editor::{CompletionItem, CompletionKind};
        while let Ok(msg) = self.lsp_receiver.try_recv() {
            if let Ok(json) = serde_json::from_str::<serde_json::Value>(&msg.json) {
                // Notification: diagnostics
                if json.get("method").and_then(|m| m.as_str()) == Some("textDocument/publishDiagnostics") {
                    if let Some(params) = json.get("params") {
                        self.handle_diagnostics(params);
                    }
                    continue;
                }
                // Response: check for result with id
                if let Some(result) = json.get("result") {
                    if let ContentPane::Editor(editor) = &mut self.content_pane {
                        // Completion response
                        if let Some(items) = result.get("items").and_then(|i| i.as_array())
                            .or_else(|| result.as_array())
                        {
                            let completions: Vec<CompletionItem> = items.iter().filter_map(|item| {
                                let label = item.get("label")?.as_str()?.to_string();
                                let kind_num = item.get("kind").and_then(|k| k.as_u64()).unwrap_or(1);
                                let detail = item.get("detail").and_then(|d| d.as_str()).map(|s| s.to_string());
                                let insert_text = item.get("insertText").and_then(|t| t.as_str()).map(|s| s.to_string());
                                Some(CompletionItem {
                                    label,
                                    kind: CompletionKind::from_lsp(kind_num),
                                    detail,
                                    insert_text,
                                })
                            }).take(20).collect();
                            if !completions.is_empty() {
                                editor.completions = completions;
                                editor.completion_selected = 0;
                                editor.completion_visible = true;
                            }
                            continue;
                        }
                        // Hover response
                        if let Some(contents) = result.get("contents") {
                            let hover_text = if let Some(s) = contents.as_str() {
                                Some(s.to_string())
                            } else if let Some(obj) = contents.as_object() {
                                obj.get("value").and_then(|v| v.as_str()).map(|s| s.to_string())
                            } else if let Some(arr) = contents.as_array() {
                                arr.first().and_then(|v| {
                                    v.as_str().map(|s| s.to_string())
                                        .or_else(|| v.get("value").and_then(|v| v.as_str()).map(|s| s.to_string()))
                                })
                            } else {
                                None
                            };
                            editor.hover_text = hover_text;
                            continue;
                        }
                        // Go-to-definition response
                        if let Some(uri) = result.get("uri").and_then(|u| u.as_str())
                            .or_else(|| result.as_array().and_then(|a| a.first()).and_then(|v| v.get("uri")).and_then(|u| u.as_str()))
                        {
                            let line = result.get("range")
                                .or_else(|| result.as_array().and_then(|a| a.first()).and_then(|v| v.get("range")))
                                .and_then(|r| r.get("start"))
                                .and_then(|s| s.get("line"))
                                .and_then(|l| l.as_u64())
                                .unwrap_or(0) as usize;
                            // Convert file URI to path
                            let path_str = uri.strip_prefix("file:///").unwrap_or(uri);
                            let path = std::path::Path::new(path_str);
                            if path.exists() {
                                if let Ok(mut new_editor) = crate::ui::editor::EditorState::open(path) {
                                    let visible = new_editor.visible_count(400.0, self.font.cell_height);
                                    new_editor.cursor_line = line;
                                    new_editor.ensure_cursor_visible(visible);
                                    self.content_pane = ContentPane::Editor(new_editor);
                                }
                            }
                            continue;
                        }
                    }
                }
            }
        }
    }

    /// Request LSP completion at current cursor position.
    pub(super) fn request_lsp_completion(&mut self) {
        let (file_path, line, col) = match &self.content_pane {
            ContentPane::Editor(editor) => {
                (editor.file_path.clone(), editor.cursor_line, editor.cursor_col)
            }
            _ => return,
        };
        let ext = file_path.extension().and_then(|e| e.to_str()).unwrap_or("");
        let language = match crate::lsp::LspLanguage::from_extension(ext) {
            Some(l) => l,
            None => return,
        };
        let root = file_path.parent().unwrap_or(&file_path).to_string_lossy().into_owned();
        let file_uri = format!("file:///{}", file_path.to_string_lossy().replace('\\', "/"));
        let id = self.next_request_id();
        let request = serde_json::json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": "textDocument/completion",
            "params": {
                "textDocument": { "uri": file_uri },
                "position": { "line": line, "character": col }
            }
        });
        let _ = self.lsp_manager.send(&language, &root, &request.to_string());
    }

    /// Request LSP hover at current cursor position.
    pub(super) fn request_lsp_hover(&mut self) {
        let (file_path, line, col) = match &self.content_pane {
            ContentPane::Editor(editor) => {
                (editor.file_path.clone(), editor.cursor_line, editor.cursor_col)
            }
            _ => return,
        };
        let ext = file_path.extension().and_then(|e| e.to_str()).unwrap_or("");
        let language = match crate::lsp::LspLanguage::from_extension(ext) {
            Some(l) => l,
            None => return,
        };
        let root = file_path.parent().unwrap_or(&file_path).to_string_lossy().into_owned();
        let file_uri = format!("file:///{}", file_path.to_string_lossy().replace('\\', "/"));
        let id = self.next_request_id();
        let request = serde_json::json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": "textDocument/hover",
            "params": {
                "textDocument": { "uri": file_uri },
                "position": { "line": line, "character": col }
            }
        });
        let _ = self.lsp_manager.send(&language, &root, &request.to_string());
    }

    /// Request LSP go-to-definition at current cursor position.
    pub(super) fn request_lsp_definition(&mut self) {
        let (file_path, line, col) = match &self.content_pane {
            ContentPane::Editor(editor) => {
                (editor.file_path.clone(), editor.cursor_line, editor.cursor_col)
            }
            _ => return,
        };
        let ext = file_path.extension().and_then(|e| e.to_str()).unwrap_or("");
        let language = match crate::lsp::LspLanguage::from_extension(ext) {
            Some(l) => l,
            None => return,
        };
        let root = file_path.parent().unwrap_or(&file_path).to_string_lossy().into_owned();
        let file_uri = format!("file:///{}", file_path.to_string_lossy().replace('\\', "/"));
        let id = self.next_request_id();
        let request = serde_json::json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": "textDocument/definition",
            "params": {
                "textDocument": { "uri": file_uri },
                "position": { "line": line, "character": col }
            }
        });
        let _ = self.lsp_manager.send(&language, &root, &request.to_string());
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
    pub(super) fn pixel_to_cell(&self, x: f64, y: f64) -> (u16, u16) {
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
    pub(super) fn send_mouse_event(&self, button: u8, col: u16, row: u16, pressed: bool) {
        let grid_arc = match self.active_grid() {
            Some(g) => g.clone(),
            None => return,
        };
        let grid = grid_arc.lock().unwrap();
        if grid.mode.mouse_mode == MouseMode::None {
            return;
        }
        if grid.mode.sgr_mouse {
            let ch = if pressed { 'M' } else { 'm' };
            let seq = format!("\x1b[<{};{};{}{}", button, col + 1, row + 1, ch);
            drop(grid);
            self.write_to_pty(seq.as_bytes());
        } else {
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
    pub(super) fn is_mouse_tracking(&self) -> bool {
        self.active_grid()
            .and_then(|g| g.lock().ok())
            .map(|g| g.mode.mouse_mode != MouseMode::None)
            .unwrap_or(false)
    }

    /// Check if mouse position is in the terminal content area.
    pub(super) fn is_in_content(&self, x: f64, y: f64) -> bool {
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
    pub(super) fn save_session(&mut self) {
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
    pub(super) fn recalc_grid_size(&mut self) {
        let config = match &self.surface_config {
            Some(c) => c,
            None => return,
        };
        let content_w = config.width as f32 - self.sidebar.width();
        let content_h = config.height as f32 - ui::CHROME_TOP - ui::STATUS_BAR_HEIGHT;
        let cols = (content_w / self.font.cell_width).max(1.0) as u16;
        let rows = (content_h / self.font.cell_height).max(1.0) as u16;
        for tab in &self.tab_states {
            tab.root.for_each_leaf(&mut |leaf| {
                let _ = self.pty_manager.resize(&leaf.pty_id, cols, rows);
                leaf.grid.lock().unwrap().resize(cols, rows);
            });
        }
    }

    /// Spawn a new PTY reader thread for a grid.
    pub(super) fn spawn_pty_reader(&self, pty_id: &str, grid: Arc<Mutex<Grid>>) {
        if let Ok(reader) = self.pty_manager.take_reader(pty_id) {
            let grid_clone = grid;
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
    }
}

/// Collect files recursively for quick open.
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
        if name.starts_with('.') || name == "node_modules" || name == "target" || name == "__pycache__" {
            continue;
        }
        if path.is_dir() {
            collect_files(&path, root, files, max);
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

/// Apply an agent update to the pane tree, finding the leaf by PTY ID.
fn apply_agent_update_to_tree(
    tab_states: &mut [super::panes::TabState],
    pty_id: &str,
    f: impl FnOnce(&mut AgentTabInfo),
) {
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
    for tab in tab_states {
        if let Some(info) = find_and_apply(&mut tab.root, pty_id) {
            f(info);
            return;
        }
    }
}

/// Find the CLI name for an agent by PTY ID (used for analytics recording).
fn find_agent_cli_name(
    tab_states: &[super::panes::TabState],
    pty_id: &str,
) -> String {
    fn find_in_tree(node: &PaneNode, pty_id: &str) -> Option<String> {
        match node {
            PaneNode::Leaf(leaf) if leaf.pty_id == pty_id => {
                leaf.agent_info.as_ref().map(|info| {
                    match &info.cli {
                        crate::agent::interactive::AgentCli::Claude => "claude".to_string(),
                        crate::agent::interactive::AgentCli::Codex => "codex".to_string(),
                        crate::agent::interactive::AgentCli::Gemini => "gemini".to_string(),
                        crate::agent::interactive::AgentCli::Custom(s) => s.clone(),
                    }
                })
            }
            PaneNode::Split { first, second, .. } => {
                find_in_tree(first, pty_id).or_else(|| find_in_tree(second, pty_id))
            }
            _ => None,
        }
    }
    for tab in tab_states {
        if let Some(name) = find_in_tree(&tab.root, pty_id) {
            return name;
        }
    }
    "unknown".to_string()
}
