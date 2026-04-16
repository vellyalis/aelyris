//! ApplicationHandler implementation — winit event loop dispatch.

use std::sync::Arc;
use winit::application::ApplicationHandler;
use winit::event::WindowEvent;
use winit::event_loop::ActiveEventLoop;
use winit::keyboard::ModifiersState;
use winit::window::{Window, WindowId};
use crate::gpu::grid::MouseMode;
use crate::ui;
use crate::ui::editor::EditorState;
use super::NativeTerminal;
use super::types::{ContentPane, DividerDrag};
use super::panes::{PaneNode, SplitDir};

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
        super::mica::enable_mica_effect(&window);

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
                self.handle_cursor_moved(position);
            }
            WindowEvent::MouseInput { state, button: winit::event::MouseButton::Left, .. } => {
                self.handle_left_mouse(state);
            }
            WindowEvent::MouseInput { state, button: winit::event::MouseButton::Right, .. } => {
                if state.is_pressed() {
                    self.handle_right_click();
                }
            }
            WindowEvent::MouseWheel { delta, .. } => {
                self.handle_mouse_wheel(delta);
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
        self.process_lsp_messages();
        self.process_agent_updates();
        self.toasts.tick();
        self.sidebar.tick();
        self.palette.tick();
        if let ContentPane::Editor(editor) = &mut self.content_pane {
            editor.tick_blink();
        }
        if let Some(window) = &self.window {
            window.request_redraw();
        }
    }
}

// Mouse event handlers extracted from window_event to keep it readable.
impl NativeTerminal {
    fn handle_cursor_moved(&mut self, position: winit::dpi::PhysicalPosition<f64>) {
        self.chrome.mouse_pos = Some((position.x as f32, position.y as f32));

        // Divider drag
        if let Some(drag) = &self.divider_drag {
            let pos = match drag.dir {
                SplitDir::Horizontal => position.x as f32 - self.sidebar.width(),
                SplitDir::Vertical => position.y as f32 - ui::CHROME_TOP,
            };
            let new_ratio = (pos / drag.content_size).clamp(0.15, 0.85);
            if let Some(tab) = self.tab_states.get_mut(self.chrome.active_tab) {
                if let PaneNode::Split { ratio, .. } = &mut tab.root {
                    *ratio = new_ratio;
                }
            }
            return;
        }

        // Mouse motion reporting
        if self.is_in_content(position.x, position.y) {
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
                let button = if self.mouse_pressed { 32 } else { 35 };
                self.send_mouse_event(button, col, row, true);
            }
        }

        // Selection drag
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

    fn handle_left_mouse(&mut self, state: winit::event::ElementState) {
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
                self.context_menu = None;
                return;
            }
            // Check sidebar context menu
            if let Some((smx, smy, ref path, is_dir)) = self.sidebar_menu.clone() {
                if let Some((hx, hy)) = self.chrome.mouse_pos {
                    let menu_w = 160.0f32;
                    let item_h = 26.0f32;
                    let item_count = 3.0f32;
                    let menu_h = item_count * item_h + 8.0;
                    if hx >= smx && hx < smx + menu_w && hy >= smy + 4.0 && hy < smy + menu_h {
                        let idx = ((hy - smy - 4.0) / item_h) as usize;
                        self.handle_sidebar_menu_click(idx, &path, is_dir);
                        self.sidebar_menu = None;
                        return;
                    }
                }
                self.sidebar_menu = None;
                return;
            }
            // Chrome hit test
            if let Some((mx, my)) = self.chrome.mouse_pos {
                if let Some(action) = self.chrome.hit_test(&self.hit_regions, mx, my) {
                    self.handle_chrome_action(action);
                    return;
                }
            }
            // Sidebar click
            if let Some((mx, my)) = self.chrome.mouse_pos {
                if self.sidebar.visible
                    && (mx as f64) < self.sidebar.width() as f64
                    && my > ui::CHROME_TOP
                {
                    let mut open_path: Option<std::path::PathBuf> = None;
                    if let Some(tree) = &mut self.sidebar.file_tree {
                        let content_top = ui::CHROME_TOP + 28.0;
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
                            Err(e) => log::warn!("Cannot open file: {}", e),
                        }
                    }
                    return;
                }
            }
            // Divider click
            if let Some((mx, my)) = self.chrome.mouse_pos {
                if self.is_in_content(mx as f64, my as f64) {
                    if let Some(tab) = self.tab_states.get(self.chrome.active_tab) {
                        if let PaneNode::Split { dir, ratio, .. } = &tab.root {
                            let config = self.surface_config.as_ref();
                            let content_w = config.map(|c| c.width as f32 - self.sidebar.width()).unwrap_or(800.0);
                            let content_h = config.map(|c| c.height as f32 - ui::CHROME_TOP - ui::STATUS_BAR_HEIGHT).unwrap_or(500.0);
                            let hit = match dir {
                                SplitDir::Horizontal => {
                                    let divider_x = self.sidebar.width() + content_w * ratio;
                                    (mx - divider_x).abs() < 6.0
                                }
                                SplitDir::Vertical => {
                                    let divider_y = ui::CHROME_TOP + content_h * ratio;
                                    (my - divider_y).abs() < 6.0
                                }
                            };
                            if hit {
                                let content_size = match dir {
                                    SplitDir::Horizontal => content_w,
                                    SplitDir::Vertical => content_h,
                                };
                                self.divider_drag = Some(DividerDrag {
                                    dir: *dir,
                                    start_pos: match dir {
                                        SplitDir::Horizontal => mx,
                                        SplitDir::Vertical => my,
                                    },
                                    content_size,
                                });
                                return;
                            }
                        }
                    }
                }
            }

            // Content area: hyperlink, mouse reporting, or selection
            if let Some((mx, my)) = self.chrome.mouse_pos {
                if self.is_in_content(mx as f64, my as f64) {
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
            self.divider_drag = None;
            self.tab_drag = None;
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

    fn handle_right_click(&mut self) {
        if let Some((mx, my)) = self.chrome.mouse_pos {
            if self.sidebar.visible
                && (mx as f64) < self.sidebar.width() as f64
                && my > ui::CHROME_TOP
            {
                if let Some(tree) = &self.sidebar.file_tree {
                    let content_top = ui::CHROME_TOP + 28.0;
                    if let Some(idx) = tree.entry_at_y(my, content_top) {
                        let entry = &tree.entries[idx];
                        self.sidebar_menu = Some((mx, my, entry.path.clone(), entry.is_dir));
                    }
                }
            } else if self.is_in_content(mx as f64, my as f64) {
                self.context_menu = Some((mx, my));
            }
        }
    }

    fn handle_mouse_wheel(&mut self, delta: winit::event::MouseScrollDelta) {
        // Check sidebar scroll
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
                    tree.scroll(-lines * 22.0);
                }
                return;
            }
        }
        // Check content area
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
            if self.is_mouse_tracking() && matches!(self.content_pane, ContentPane::Terminal) {
                if let Some((mx, my)) = self.chrome.mouse_pos {
                    let (row, col) = self.pixel_to_cell(mx as f64, my as f64);
                    let button = if lines > 0 { 64u8 } else { 65u8 };
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
}
