//! Keyboard input handling for the native terminal.

use winit::keyboard::{Key, NamedKey};
use crate::ui;
use crate::ui::palette::PaletteAction;
use super::NativeTerminal;
use super::types::ContentPane;
use super::panes::SplitDir;

impl NativeTerminal {
    pub(super) fn handle_key_input(&mut self, key: Key) {
        let ctrl = self.modifiers.contains(winit::keyboard::ModifiersState::CONTROL);
        let shift = self.modifiers.contains(winit::keyboard::ModifiersState::SHIFT);

        // Ctrl+Shift shortcuts (works in all modes)
        if ctrl && shift {
            if let Key::Character(ref c) = key {
                match c.to_lowercase().as_str() {
                    "p" => { self.palette.toggle(); return; }
                    "h" => { self.split_focused_pane(SplitDir::Horizontal); return; }
                    "v" => { self.split_focused_pane(SplitDir::Vertical); return; }
                    "w" => { self.close_focused_pane(); return; }
                    _ => {}
                }
            }
        }

        // Alt+Tab: Switch pane focus
        if self.modifiers.contains(winit::keyboard::ModifiersState::ALT) {
            if matches!(key, Key::Named(NamedKey::Tab)) {
                if let Some(tab) = self.tab_states.get_mut(self.chrome.active_tab) {
                    tab.focus_next();
                }
                return;
            }
        }

        // Palette has priority when open
        if self.palette.visible {
            self.handle_palette_key(key);
            return;
        }

        // Ctrl+B: Toggle sidebar
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
        if matches!(self.content_pane, ContentPane::Kanban(_)) {
            self.handle_kanban_key(key);
            return;
        }
        if matches!(self.content_pane, ContentPane::Search(_)) {
            self.handle_search_key(key, ctrl);
            return;
        }
        if matches!(self.content_pane, ContentPane::Welcome(_)) {
            self.handle_welcome_key(key);
            return;
        }
        if matches!(self.content_pane, ContentPane::Helm(_)) {
            self.handle_helm_key(key);
            return;
        }
        if matches!(self.content_pane, ContentPane::Diff(_)) {
            if matches!(key, Key::Named(NamedKey::Escape)) {
                self.content_pane = ContentPane::Terminal;
                return;
            }
            if let ContentPane::Diff(diff) = &mut self.content_pane {
                match key {
                    Key::Named(NamedKey::ArrowUp) | Key::Named(NamedKey::PageUp) => {
                        diff.scroll(-60.0);
                    }
                    Key::Named(NamedKey::ArrowDown) | Key::Named(NamedKey::PageDown) => {
                        diff.scroll(60.0);
                    }
                    _ => {}
                }
            }
            return;
        }
        if matches!(self.content_pane, ContentPane::Analytics) {
            if matches!(key, Key::Named(NamedKey::Escape)) {
                self.content_pane = ContentPane::Terminal;
            }
            return;
        }

        // --- Terminal mode ---

        if ctrl {
            if let Key::Character(ref c) = key {
                match c.to_lowercase().as_str() {
                    "p" if !shift => {
                        self.open_quick_file_search();
                        return;
                    }
                    "r" => {
                        self.execute_palette_action(PaletteAction::BeginCommandHistory);
                        return;
                    }
                    _ => {}
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
                    let text = self.active_grid()
                        .map(|g| g.lock().unwrap().selected_text())
                        .unwrap_or_default();
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
                // Ctrl+C: SIGINT
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
                    self.suggest_engine.record(&cmd);
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
                if let Some(ghost) = self.ghost_text.take() {
                    // Accept ghost suggestion: send the suffix to PTY
                    self.command_buffer.push_str(&ghost);
                    ghost.into_bytes()
                } else {
                    self.command_buffer.clear();
                    vec![b'\t']
                }
            }
            Key::Named(NamedKey::Escape) => vec![0x1b],
            Key::Named(NamedKey::ArrowUp) | Key::Named(NamedKey::ArrowDown) => {
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
        // Update ghost suggestion based on current command buffer
        self.ghost_text = self.suggest_engine.suggest(&self.command_buffer);
        self.write_to_pty(&data);
    }

    /// Handle key input when in editor mode.
    pub(super) fn handle_editor_key(&mut self, key: Key, ctrl: bool, shift: bool) {
        // Escape: dismiss completion/hover first, then find bar, then exit editor
        if matches!(key, Key::Named(NamedKey::Escape)) {
            if let ContentPane::Editor(editor) = &mut self.content_pane {
                if editor.completion_visible {
                    editor.completion_visible = false;
                    return;
                }
                if editor.hover_text.is_some() {
                    editor.hover_text = None;
                    return;
                }
                if editor.find.active {
                    editor.find.active = false;
                    return;
                }
            }
            self.content_pane = ContentPane::Terminal;
            log::info!("Back to terminal");
            return;
        }

        // Completion popup navigation
        if let ContentPane::Editor(editor) = &mut self.content_pane {
            if editor.completion_visible {
                match key {
                    Key::Named(NamedKey::ArrowUp) => {
                        if editor.completion_selected > 0 {
                            editor.completion_selected -= 1;
                        }
                        return;
                    }
                    Key::Named(NamedKey::ArrowDown) => {
                        if editor.completion_selected + 1 < editor.completions.len() {
                            editor.completion_selected += 1;
                        }
                        return;
                    }
                    Key::Named(NamedKey::Enter) | Key::Named(NamedKey::Tab) => {
                        // Accept selected completion
                        if let Some(item) = editor.completions.get(editor.completion_selected).cloned() {
                            let text = item.insert_text.as_deref().unwrap_or(&item.label);
                            editor.insert_text(text);
                        }
                        editor.completion_visible = false;
                        editor.completions.clear();
                        return;
                    }
                    _ => {
                        editor.completion_visible = false;
                    }
                }
            }
        }

        // F12: Go to definition
        if matches!(key, Key::Named(NamedKey::F12)) {
            self.request_lsp_definition();
            return;
        }

        // Ctrl+Space: Trigger completion
        if ctrl && matches!(key, Key::Named(NamedKey::Space)) {
            self.request_lsp_completion();
            return;
        }

        let content_h = self
            .surface_config
            .as_ref()
            .map(|c| c.height as f32 - ui::CHROME_TOP - ui::STATUS_BAR_HEIGHT)
            .unwrap_or(400.0);

        if let ContentPane::Editor(editor) = &mut self.content_pane {
            let visible = editor.visible_count(content_h, self.font.cell_height);

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

            if editor.find.active {
                match key {
                    Key::Named(NamedKey::Enter) => {
                        if editor.find.focus == 0 {
                            if shift { editor.find_prev(visible); } else { editor.find_next(visible); }
                        } else {
                            editor.replace_current();
                        }
                    }
                    Key::Named(NamedKey::Tab) => {
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
                            if shift { editor.redo(); } else { editor.undo(); }
                            editor.reset_blink();
                            return;
                        }
                        _ => {}
                    }
                }
            }

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
                Key::Character(ref c) if !ctrl => editor.insert_text(c),
                _ => return,
            }
            editor.reset_blink();
        }
    }

    /// Handle key input in kanban mode.
    pub(super) fn handle_kanban_key(&mut self, key: Key) {
        if matches!(key, Key::Named(NamedKey::Escape)) {
            self.content_pane = ContentPane::Terminal;
            return;
        }
        if let ContentPane::Kanban(kanban) = &mut self.content_pane {
            match key {
                Key::Named(NamedKey::ArrowUp) => kanban.select_up(),
                Key::Named(NamedKey::ArrowDown) => kanban.select_down(),
                Key::Named(NamedKey::ArrowLeft) => kanban.focus_col(-1),
                Key::Named(NamedKey::ArrowRight) => kanban.focus_col(1),
                Key::Named(NamedKey::Delete) | Key::Named(NamedKey::Backspace) => {
                    kanban.delete_selected();
                }
                Key::Named(NamedKey::Enter) => {
                    let col = kanban.selected_col;
                    self.palette.enter_agent_spawn(format!("__kanban__{}", col));
                }
                Key::Named(NamedKey::Tab) => {
                    kanban.move_right();
                }
                _ => {}
            }
        }
    }

    /// Handle key input when command palette is open.
    pub(super) fn handle_palette_key(&mut self, key: Key) {
        match key {
            Key::Named(NamedKey::Escape) => {
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

    /// Handle key input in search mode.
    pub(super) fn handle_search_key(&mut self, key: Key, ctrl: bool) {
        if matches!(key, Key::Named(NamedKey::Escape)) {
            self.content_pane = ContentPane::Terminal;
            return;
        }
        if let ContentPane::Search(search) = &mut self.content_pane {
            match key {
                Key::Named(NamedKey::ArrowUp) => search.select_prev(),
                Key::Named(NamedKey::ArrowDown) => search.select_next(),
                Key::Named(NamedKey::Enter) => {
                    if search.query.is_empty() {
                        // Execute search with current input
                        if let Some(root) = self.sidebar.file_tree.as_ref().map(|ft| ft.root.clone())
                            .or_else(|| std::env::current_dir().ok())
                        {
                            search.search(&root);
                        }
                    } else if let Some((path, _line)) = search.selected_location() {
                        // Open selected file in editor
                        let base = self.sidebar.file_tree.as_ref()
                            .map(|ft| ft.root.clone())
                            .or_else(|| std::env::current_dir().ok())
                            .unwrap_or_default();
                        let full_path = base.join(&path);
                        if let Ok(editor) = crate::ui::editor::EditorState::open(&full_path) {
                            self.content_pane = ContentPane::Editor(editor);
                        }
                        return;
                    }
                }
                Key::Named(NamedKey::Backspace) => {
                    search.query.pop();
                }
                Key::Character(ref c) if !ctrl => {
                    search.query.push_str(c);
                }
                _ => {}
            }
        }
    }

    /// Handle key input in welcome screen.
    pub(super) fn handle_welcome_key(&mut self, key: Key) {
        if matches!(key, Key::Named(NamedKey::Escape)) {
            self.content_pane = ContentPane::Terminal;
            return;
        }
        if let ContentPane::Welcome(welcome) = &mut self.content_pane {
            match key {
                Key::Named(NamedKey::ArrowUp) => welcome.select_up(),
                Key::Named(NamedKey::ArrowDown) => welcome.select_down(),
                Key::Named(NamedKey::Enter) => {
                    if let Some(path) = welcome.selected_path().map(|s| s.to_string()) {
                        let path_buf = std::path::PathBuf::from(&path);
                        self.sidebar.set_root(path_buf.clone());
                        self.content_pane = ContentPane::Terminal;
                        self.recalc_grid_size();
                        self.fs_watcher_rx = super::watcher::start_watcher(path_buf);
                        if let Some(repo) = self.repo_path() {
                            self.scm.set_repo(repo);
                        }
                    }
                }
                _ => {}
            }
        }
    }

    /// Handle key input in helm (tasks) mode.
    pub(super) fn handle_helm_key(&mut self, key: Key) {
        if matches!(key, Key::Named(NamedKey::Escape)) {
            self.content_pane = ContentPane::Terminal;
            return;
        }
        if let ContentPane::Helm(helm) = &mut self.content_pane {
            match key {
                Key::Named(NamedKey::ArrowUp) => helm.select_up(),
                Key::Named(NamedKey::ArrowDown) => helm.select_down(),
                Key::Named(NamedKey::Space) => helm.toggle_selected(),
                Key::Named(NamedKey::Delete) | Key::Named(NamedKey::Backspace) => {
                    helm.delete_selected();
                }
                Key::Named(NamedKey::Enter) => {
                    // Add task via palette input
                    self.palette.enter_agent_spawn("__helm__".to_string());
                }
                _ => {}
            }
        }
    }
}
