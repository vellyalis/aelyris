//! Rendering orchestration for the native terminal.

use crate::agent::interactive::AgentCli;
use crate::gpu::atlas::GlyphAtlas;
use crate::gpu::font::FontManager;
use crate::gpu::renderer::{GlyphInstance, RectInstance};
use crate::ui;
use super::NativeTerminal;
use super::types::ContentPane;
use super::panes::{PaneNode, SplitDir};

impl NativeTerminal {
    pub(super) fn render(&mut self) {
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

        // Status bar override
        self.chrome.status_override = match &self.content_pane {
            ContentPane::Editor(editor) => {
                let modified_marker = if editor.modified { " [+]" } else { "" };
                Some(ui::StatusOverride {
                    label: format!("{}{}", editor.file_name, modified_marker),
                    detail: format!("Ln {}, Col {}", editor.cursor_line + 1, editor.cursor_col + 1),
                    indicator: "UTF-8".to_string(),
                })
            }
            ContentPane::Terminal => {
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
                        label: format!("{} ({}) — {}", cli_name, info.model, info.status.label()),
                        detail: format!("${:.4}  {}tok  {}:{:02}", info.cost, info.tokens_used, mins, secs),
                        indicator: info.status.label().to_string(),
                    }
                })
            }
            ContentPane::Kanban(_) => {
                Some(ui::StatusOverride {
                    label: "Kanban Board".to_string(),
                    detail: "Arrow keys to navigate, Enter to add, Delete to remove".to_string(),
                    indicator: "Tasks".to_string(),
                })
            }
        };

        let mut atlas = self.atlas.lock().unwrap();
        let chrome_out = self.chrome.build(&self.font, &mut atlas, window_w, window_h);
        self.hit_regions = chrome_out.hits;

        let sidebar_out = self.sidebar.build(
            &self.font, &mut atlas, ui::CHROME_TOP, window_h, self.chrome.mouse_pos,
        );

        let content_w = window_w - sidebar_w;
        let content_h = window_h - ui::CHROME_TOP - ui::STATUS_BAR_HEIGHT;
        let (content_rects, content_glyphs) = match &mut self.content_pane {
            ContentPane::Terminal => {
                let mut all_r = Vec::new();
                let mut all_g = Vec::new();
                if let Some(tab) = self.tab_states.get(self.chrome.active_tab) {
                    render_pane_tree(
                        &tab.root, tab.focused_pane_id, &self.font, &mut atlas,
                        sidebar_w, ui::CHROME_TOP, content_w, content_h,
                        &mut all_r, &mut all_g,
                    );
                }
                (all_r, all_g)
            }
            ContentPane::Editor(editor) => {
                editor.refresh_syntax();
                let out = editor.build(
                    &self.font, &mut atlas, sidebar_w, ui::CHROME_TOP, content_w, content_h,
                );
                (out.rects, out.glyphs)
            }
            ContentPane::Kanban(kanban) => {
                let out = kanban.build(
                    &self.font, &mut atlas, sidebar_w, ui::CHROME_TOP, content_w, content_h,
                );
                (out.rects, out.glyphs)
            }
        };

        let (agent_rects, agent_glyphs) =
            self.build_agent_panel(&self.font, &mut atlas, window_h);

        let (scm_rects, scm_glyphs) = if self.sidebar.visible {
            let scm_y = window_h - ui::STATUS_BAR_HEIGHT - 300.0;
            self.scm.build(&self.font, &mut atlas, 0.0, scm_y.max(ui::CHROME_TOP + 200.0), sidebar_w, 280.0)
        } else {
            (Vec::new(), Vec::new())
        };

        let (sb_menu_rects, sb_menu_glyphs) = self.build_sidebar_menu(&self.font, &mut atlas);
        let (ctx_rects, ctx_glyphs) = self.build_context_menu(&self.font, &mut atlas);
        let palette_out = self.palette.build(&self.font, &mut atlas, window_w);
        let (toast_rects, toast_glyphs) = self.toasts.build(&self.font, &mut atlas, window_w, window_h);

        if atlas.dirty {
            renderer.upload_atlas(&atlas);
            atlas.clear_dirty();
        }
        drop(atlas);

        let mut all_rects = chrome_out.rects;
        all_rects.extend(sidebar_out.rects);
        all_rects.extend(scm_rects);
        all_rects.extend(agent_rects);
        all_rects.extend(content_rects);
        all_rects.extend(ctx_rects);
        all_rects.extend(sb_menu_rects);
        all_rects.extend(palette_out.rects);
        all_rects.extend(toast_rects);
        let mut all_glyphs = chrome_out.glyphs;
        all_glyphs.extend(sidebar_out.glyphs);
        all_glyphs.extend(scm_glyphs);
        all_glyphs.extend(agent_glyphs);
        all_glyphs.extend(content_glyphs);
        all_glyphs.extend(ctx_glyphs);
        all_glyphs.extend(sb_menu_glyphs);
        all_glyphs.extend(palette_out.glyphs);
        all_glyphs.extend(toast_glyphs);

        match surface.get_current_texture() {
            Ok(texture) => {
                let view = texture.texture.create_view(&wgpu::TextureViewDescriptor::default());
                renderer.render_frame(
                    &view,
                    &all_glyphs,
                    &all_rects,
                    wgpu::Color {
                        r: 0.0, g: 0.0, b: 0.0,
                        a: self.config.appearance.opacity as f64,
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

    /// Build right-click context menu overlay.
    pub(super) fn build_context_menu(
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

        rects.push(RectInstance::rounded([mx, my], [menu_w, menu_h], ui::cat::pm(30, 30, 46, 245), 8.0));
        rects.push(RectInstance::new([mx, my], [menu_w, 1.0], ui::cat::pm(69, 71, 90, 200)));

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
                rects.push(RectInstance::rounded([mx + 2.0, iy], [menu_w - 4.0, item_h], ui::cat::pm(69, 71, 90, 150), 4.0));
            }
            let text_y = iy + (item_h - font.cell_height) / 2.0;
            ui::render_text(font, atlas, label, mx + 12.0, text_y, ui::cat::TEXT, &mut glyphs);
        }
        (rects, glyphs)
    }

    /// Build sidebar context menu overlay.
    pub(super) fn build_sidebar_menu(
        &self,
        font: &FontManager,
        atlas: &mut GlyphAtlas,
    ) -> (Vec<RectInstance>, Vec<GlyphInstance>) {
        let mut rects = Vec::new();
        let mut glyphs = Vec::new();
        let (mx, my, _, is_dir) = match &self.sidebar_menu {
            Some(m) => (m.0, m.1, &m.2, m.3),
            None => return (rects, glyphs),
        };
        let items: &[&str] = if is_dir {
            &["New File", "New Folder", "Delete"]
        } else {
            &["Rename", "Delete", "Open"]
        };
        let item_h = 26.0f32;
        let menu_w = 160.0f32;
        let menu_h = items.len() as f32 * item_h + 8.0;

        rects.push(RectInstance::rounded([mx, my], [menu_w, menu_h], ui::cat::pm(30, 30, 46, 245), 8.0));
        rects.push(RectInstance::new([mx, my], [menu_w, 1.0], ui::cat::pm(69, 71, 90, 200)));

        let hover_idx = self.chrome.mouse_pos.and_then(|(hx, hy)| {
            if hx >= mx && hx < mx + menu_w && hy >= my + 4.0 && hy < my + menu_h {
                Some(((hy - my - 4.0) / item_h) as usize)
            } else {
                None
            }
        });

        for (i, label) in items.iter().enumerate() {
            let iy = my + 4.0 + i as f32 * item_h;
            if hover_idx == Some(i) {
                rects.push(RectInstance::rounded([mx + 2.0, iy], [menu_w - 4.0, item_h], ui::cat::pm(69, 71, 90, 150), 4.0));
            }
            let text_y = iy + (item_h - font.cell_height) / 2.0;
            ui::render_text(font, atlas, label, mx + 12.0, text_y, ui::cat::TEXT, &mut glyphs);
        }
        (rects, glyphs)
    }

    /// Build agent session panel (inside sidebar, bottom area).
    pub(super) fn build_agent_panel(
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
        let agent_tabs: Vec<(usize, &super::types::AgentTabInfo)> = self
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

        rects.push(RectInstance::new([0.0, panel_y], [sidebar_w, panel_h], ui::cat::pm(24, 24, 37, 220)));
        rects.push(RectInstance::new([0.0, panel_y], [sidebar_w, 1.0], ui::cat::pm(69, 71, 90, 150)));

        let header_y = panel_y + (28.0 - font.cell_height) / 2.0;
        ui::render_text(font, atlas, "AGENTS", 8.0, header_y, ui::cat::OVERLAY0, &mut glyphs);

        let count_str = format!("{}", agent_tabs.len());
        let count_x = 8.0 + 7.0 * font.cell_width;
        ui::render_text(font, atlas, &count_str, count_x, header_y, ui::cat::pm(137, 180, 250, 255), &mut glyphs);

        let entry_top = panel_y + 28.0;
        for (i, (tab_idx, info)) in agent_tabs.iter().enumerate() {
            let y = entry_top + i as f32 * 36.0;
            let is_active = *tab_idx == self.chrome.active_tab;

            if is_active {
                rects.push(RectInstance::rounded([2.0, y], [sidebar_w - 4.0, 36.0], ui::cat::pm(69, 71, 90, 80), 6.0));
            }
            let dot_y = y + (36.0 - 4.0) / 2.0;
            rects.push(RectInstance::new([8.0, dot_y], [4.0, 4.0], info.status.color()));

            let text_y1 = y + 4.0;
            let cli_name = match &info.cli {
                AgentCli::Claude => "Claude",
                AgentCli::Codex => "Codex",
                AgentCli::Gemini => "Gemini",
                AgentCli::Custom(s) => s.as_str(),
            };
            let label = format!("{} ({})", cli_name, info.model);
            ui::render_text(font, atlas, &label, 18.0, text_y1, ui::cat::TEXT, &mut glyphs);

            let text_y2 = y + 4.0 + font.cell_height + 2.0;
            let detail = format!("{} ${:.3}", info.status.label(), info.cost);
            ui::render_text(font, atlas, &detail, 18.0, text_y2, ui::cat::OVERLAY0, &mut glyphs);
        }
        (rects, glyphs)
    }
}

/// Recursively render a pane tree at the given screen rect.
pub fn render_pane_tree(
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
            let mut term_glyphs = crate::gpu::build_glyph_instances(&grid, font, atlas);
            let mut term_rects = crate::gpu::build_bg_rects(&grid, font);
            let is_focused = leaf.id == focused_id;
            term_rects.extend(crate::gpu::build_cursor_rects(&grid, font, is_focused));
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
            if is_focused {
                rects.push(RectInstance::new([x, y], [w, 1.0], ui::cat::pm(137, 180, 250, 120)));
            }
        }
        PaneNode::Split { dir, ratio, first, second } => {
            match dir {
                SplitDir::Horizontal => {
                    let first_w = (w * ratio).floor();
                    let divider = 2.0;
                    let second_w = w - first_w - divider;
                    render_pane_tree(first, focused_id, font, atlas, x, y, first_w, h, rects, glyphs);
                    rects.push(RectInstance::new([x + first_w, y], [divider, h], ui::cat::pm(69, 71, 90, 200)));
                    render_pane_tree(second, focused_id, font, atlas, x + first_w + divider, y, second_w, h, rects, glyphs);
                }
                SplitDir::Vertical => {
                    let first_h = (h * ratio).floor();
                    let divider = 2.0;
                    let second_h = h - first_h - divider;
                    render_pane_tree(first, focused_id, font, atlas, x, y, w, first_h, rects, glyphs);
                    rects.push(RectInstance::new([x, y + first_h], [w, divider], ui::cat::pm(69, 71, 90, 200)));
                    render_pane_tree(second, focused_id, font, atlas, x, y + first_h + divider, w, second_h, rects, glyphs);
                }
            }
        }
    }
}
