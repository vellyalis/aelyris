//! Rendering orchestration for the native terminal.

use crate::agent::interactive::AgentCli;
use crate::gpu::atlas::GlyphAtlas;
use crate::gpu::font::FontManager;
use crate::gpu::grid::Grid;
use crate::gpu::renderer::{GlyphInstance, RectInstance};
use crate::ui;
use crate::ui::block::BlockTracker;
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
            ContentPane::Search(s) => {
                Some(ui::StatusOverride {
                    label: format!("Search: \"{}\"", s.query),
                    detail: format!("{} matches", s.total_matches),
                    indicator: "Search".to_string(),
                })
            }
            ContentPane::Welcome(_) => {
                Some(ui::StatusOverride {
                    label: "Welcome".to_string(),
                    detail: "Select a project to open".to_string(),
                    indicator: "Home".to_string(),
                })
            }
            ContentPane::Helm(h) => {
                Some(ui::StatusOverride {
                    label: "Tasks".to_string(),
                    detail: format!("{}/{} done", h.done_count(), h.tasks.len()),
                    indicator: "Helm".to_string(),
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
                if let Some(tab) = self.tab_states.get_mut(self.chrome.active_tab) {
                    render_pane_tree(
                        &mut tab.root, tab.focused_pane_id, &self.font, &mut atlas,
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
            ContentPane::Search(search) => {
                let out = search.build(
                    &self.font, &mut atlas, sidebar_w, ui::CHROME_TOP, content_w, content_h,
                );
                (out.rects, out.glyphs)
            }
            ContentPane::Welcome(welcome) => {
                let out = welcome.build(
                    &self.font, &mut atlas, sidebar_w, ui::CHROME_TOP, content_w, content_h,
                );
                (out.rects, out.glyphs)
            }
            ContentPane::Helm(helm) => {
                let out = helm.build(
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

        let toolkit_out = if self.sidebar.visible {
            let tk_h = self.toolkit.panel_height(&self.font);
            let tk_y = window_h - ui::STATUS_BAR_HEIGHT - tk_h;
            self.toolkit.build(
                &self.font, &mut atlas, 0.0, tk_y, sidebar_w, tk_h,
                self.chrome.mouse_pos,
            )
        } else {
            crate::ui::toolkit::ToolkitOutput {
                rects: Vec::new(),
                glyphs: Vec::new(),
            }
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
        all_rects.extend(toolkit_out.rects);
        all_rects.extend(content_rects);
        all_rects.extend(ctx_rects);
        all_rects.extend(sb_menu_rects);
        all_rects.extend(palette_out.rects);
        all_rects.extend(toast_rects);
        let mut all_glyphs = chrome_out.glyphs;
        all_glyphs.extend(sidebar_out.glyphs);
        all_glyphs.extend(scm_glyphs);
        all_glyphs.extend(agent_glyphs);
        all_glyphs.extend(toolkit_out.glyphs);
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

/// Extract the text content of a visible row from the grid.
fn row_text(grid: &Grid, screen_row: usize) -> String {
    let cells = grid.visible_row(screen_row);
    let text: String = cells.iter().map(|c| c.c).collect();
    text.trim_end().to_string()
}

/// Scan visible grid rows and feed new prompt lines to the BlockTracker.
///
/// The block tracker uses prompt regex detection, so we scan each visible row
/// and process it. To avoid re-processing, we use the scrollback length + row
/// index as an absolute row identifier.
fn feed_block_tracker(grid: &Grid, tracker: &mut BlockTracker) {
    let sb_len = grid.scrollback.len();
    let visible_rows = grid.rows as usize;
    for screen_row in 0..visible_rows {
        // Compute the absolute row index (scrollback offset + screen row).
        let abs_row = if grid.viewport_offset == 0 {
            sb_len + screen_row
        } else {
            let sb_start = sb_len.saturating_sub(grid.viewport_offset);
            sb_start + screen_row
        };
        let text = row_text(grid, screen_row);
        if !text.is_empty() {
            tracker.process_line(abs_row, &text);
        }
    }
}

/// Build block decoration rects and glyphs for visible command blocks.
///
/// Draws:
/// - A rounded rect border (radius=8, semi-transparent) around each block
/// - A small header showing the command text and exit code
/// - A collapse/expand indicator at the right edge of the header
fn build_block_decorations(
    grid: &Grid,
    block_tracker: &BlockTracker,
    font: &FontManager,
    atlas: &mut GlyphAtlas,
    offset_x: f32,
    offset_y: f32,
    content_w: f32,
) -> (Vec<RectInstance>, Vec<GlyphInstance>) {
    let mut dec_rects = Vec::new();
    let mut dec_glyphs = Vec::new();

    let sb_len = grid.scrollback.len();
    let visible_rows = grid.rows as usize;

    // Determine the absolute row range currently visible on screen.
    let viewport_start = if grid.viewport_offset == 0 {
        sb_len
    } else {
        sb_len.saturating_sub(grid.viewport_offset)
    };
    let viewport_end = viewport_start + visible_rows.saturating_sub(1);

    let visible = block_tracker.visible_blocks(viewport_start, viewport_end);
    if visible.is_empty() {
        return (dec_rects, dec_glyphs);
    }

    let cell_h = font.cell_height;
    let cell_w = font.cell_width;

    // Border color: semi-transparent surface overlay
    let border_color = ui::cat::pm(69, 71, 90, 100);
    // Header background: very subtle tint
    let header_bg = ui::cat::pm(49, 50, 68, 60);
    let radius = 8.0_f32;
    let border_thickness = 1.5_f32;
    let inset = 4.0_f32; // horizontal inset from pane edge
    let block_w = content_w - inset * 2.0;

    for (_idx, block) in &visible {
        // Convert absolute row to screen pixel position.
        let prompt_screen_row = block.prompt_row.saturating_sub(viewport_start);
        let block_end_abs = block.output_end.unwrap_or(viewport_end);
        let end_screen_row = block_end_abs.saturating_sub(viewport_start);

        // Clamp to visible range.
        let first_row = prompt_screen_row.min(visible_rows.saturating_sub(1));
        let last_row = end_screen_row.min(visible_rows.saturating_sub(1));

        // Skip blocks that are entirely offscreen.
        if first_row > visible_rows || last_row < first_row {
            continue;
        }

        // Pixel coordinates relative to the pane.
        let block_y = first_row as f32 * cell_h;
        let block_h = ((last_row - first_row + 1) as f32 * cell_h).max(cell_h);
        let bx = offset_x + inset;
        let by = offset_y + block_y;

        // Draw rounded border (four edges as thin rects for a border-only effect).
        // Top edge
        dec_rects.push(RectInstance::rounded(
            [bx, by],
            [block_w, border_thickness],
            border_color,
            radius,
        ));
        // Bottom edge
        dec_rects.push(RectInstance::rounded(
            [bx, by + block_h - border_thickness],
            [block_w, border_thickness],
            border_color,
            radius,
        ));
        // Left edge
        dec_rects.push(RectInstance::new(
            [bx, by + radius],
            [border_thickness, (block_h - radius * 2.0).max(0.0)],
            border_color,
        ));
        // Right edge
        dec_rects.push(RectInstance::new(
            [bx + block_w - border_thickness, by + radius],
            [border_thickness, (block_h - radius * 2.0).max(0.0)],
            border_color,
        ));

        // Header background (prompt row area).
        dec_rects.push(RectInstance::rounded(
            [bx, by],
            [block_w, cell_h],
            header_bg,
            radius,
        ));

        // Header text: command name (truncated to fit).
        let cmd = &block.command;
        let max_cmd_chars = ((block_w - 40.0) / cell_w).max(1.0) as usize;
        let display_cmd = if cmd.len() > max_cmd_chars {
            format!("{}...", &cmd[..max_cmd_chars.saturating_sub(3)])
        } else {
            cmd.clone()
        };

        // Collapse indicator at left edge.
        let indicator = if block.collapsed { "\u{25B8}" } else { "\u{25BE}" }; // triangle right / down
        let indicator_x = bx + 4.0;
        let text_y = by + (cell_h - font.cell_height) / 2.0;
        ui::render_text(font, atlas, indicator, indicator_x, text_y, ui::cat::OVERLAY0, &mut dec_glyphs);

        // Command text after indicator.
        let cmd_x = indicator_x + cell_w * 2.0;
        ui::render_text(font, atlas, &display_cmd, cmd_x, text_y, ui::cat::SUBTEXT1, &mut dec_glyphs);

        // Exit code badge (if available).
        if let Some(code) = block.exit_code {
            let badge = if code == 0 {
                "\u{2713}".to_string() // checkmark
            } else {
                format!("E{}", code)
            };
            let badge_color = if code == 0 { ui::cat::GREEN } else { [0.95, 0.55, 0.66, 1.0] };
            let badge_x = bx + block_w - (badge.len() as f32 + 1.0) * cell_w;
            ui::render_text(font, atlas, &badge, badge_x, text_y, badge_color, &mut dec_glyphs);
        }
    }

    (dec_rects, dec_glyphs)
}

/// Recursively render a pane tree at the given screen rect.
pub fn render_pane_tree(
    node: &mut PaneNode,
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

            // Feed visible rows to block tracker and build decorations.
            feed_block_tracker(&grid, &mut leaf.block_tracker);
            let (blk_rects, blk_glyphs) = build_block_decorations(
                &grid, &leaf.block_tracker, font, atlas, x, y, w,
            );

            grid.clear_dirty();
            rects.extend(term_rects);
            glyphs.extend(term_glyphs);
            rects.extend(blk_rects);
            glyphs.extend(blk_glyphs);
            if is_focused {
                rects.push(RectInstance::new([x, y], [w, 1.0], ui::cat::pm(137, 180, 250, 120)));
            }
        }
        PaneNode::Split { dir, ratio, first, second } => {
            match dir {
                SplitDir::Horizontal => {
                    let first_w = (w * *ratio).floor();
                    let divider = 2.0;
                    let second_w = w - first_w - divider;
                    render_pane_tree(first, focused_id, font, atlas, x, y, first_w, h, rects, glyphs);
                    rects.push(RectInstance::new([x + first_w, y], [divider, h], ui::cat::pm(69, 71, 90, 200)));
                    render_pane_tree(second, focused_id, font, atlas, x + first_w + divider, y, second_w, h, rects, glyphs);
                }
                SplitDir::Vertical => {
                    let first_h = (h * *ratio).floor();
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
