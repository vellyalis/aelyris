//! Rendering orchestration for the native terminal.

use crate::agent::interactive::AgentCli;
use crate::gpu::atlas::GlyphAtlas;
use crate::gpu::font::FontManager;
use crate::gpu::grid::Grid;
use crate::gpu::renderer::{GlyphInstance, GradientRectInstance, RectInstance};
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
            ContentPane::Diff(d) => {
                Some(ui::StatusOverride {
                    label: format!("Diff: {}", d.file_path),
                    detail: format!("{} lines", d.lines.len()),
                    indicator: "Diff".to_string(),
                })
            }
            ContentPane::Analytics => {
                Some(ui::StatusOverride {
                    label: "Analytics".to_string(),
                    detail: format!("${:.2} total", self.analytics.total_cost()),
                    indicator: "Usage".to_string(),
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
                // Terminal scrollbar
                if let Some(g) = self.active_grid() {
                    if let Ok(grid) = g.lock() {
                        let total_lines = grid.scrollback.len() + grid.rows as usize;
                        let viewport_lines = grid.rows as usize;
                        if total_lines > viewport_lines {
                            let sb_state = crate::ui::widgets::scrollbar::ScrollBarState {
                                content_height: total_lines as f32 * self.font.cell_height,
                                viewport_height: viewport_lines as f32 * self.font.cell_height,
                                scroll_offset: (grid.scrollback.len() - grid.viewport_offset) as f32
                                    * self.font.cell_height,
                            };
                            let sb_x = sidebar_w + content_w - crate::ui::tokens::SCROLLBAR_WIDTH;
                            let sb_out = crate::ui::widgets::scrollbar::build(
                                &sb_state,
                                sb_x,
                                ui::CHROME_TOP,
                                content_h,
                                self.chrome.mouse_pos,
                                &self.scrollbar_drag,
                            );
                            all_r.extend(sb_out.rects);
                        }
                    }
                }
                // Ghost typing overlay
                if let Some(ref suggestion) = self.ghost_text {
                    if let Some(g) = self.active_grid() {
                        if let Ok(grid) = g.lock() {
                            let (gx, gy) = crate::gpu::ghost::ghost_position(
                                &self.font, grid.cursor.col as usize, grid.cursor.row as usize,
                                sidebar_w, ui::CHROME_TOP,
                            );
                            let ghost_glyphs = crate::gpu::ghost::render_ghost_text(
                                &self.font, &mut atlas, suggestion, gx, gy,
                            );
                            all_g.extend(ghost_glyphs);
                        }
                    }
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
            ContentPane::Diff(diff) => {
                let out = diff.build(
                    &self.font, &mut atlas, sidebar_w, ui::CHROME_TOP, content_w, content_h,
                );
                (out.rects, out.glyphs)
            }
            ContentPane::Analytics => {
                let out = self.analytics.build(
                    &self.font, &mut atlas, sidebar_w, ui::CHROME_TOP, content_w, content_h,
                );
                (out.rects, out.glyphs)
            }
        };

        let (agent_rects, agent_glyphs, agent_grads) =
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

        let activity_out = if self.sidebar.visible {
            let act_h = 300.0_f32.min(content_h * 0.4);
            let act_y = (window_h - ui::STATUS_BAR_HEIGHT - act_h).max(ui::CHROME_TOP);
            self.activity.build(
                &self.font, &mut atlas,
                0.0, act_y, sidebar_w, act_h,
                self.chrome.mouse_pos,
            )
        } else {
            crate::ui::activity::ActivityOutput {
                rects: Vec::new(),
                glyphs: Vec::new(),
            }
        };

        let (sb_menu_rects, sb_menu_glyphs, sb_menu_grads) = self.build_sidebar_menu(&self.font, &mut atlas);
        let (ctx_rects, ctx_glyphs, ctx_grads) = self.build_context_menu(&self.font, &mut atlas);
        let palette_out = self.palette.build(&self.font, &mut atlas, window_w, window_h);
        let (toast_rects, toast_glyphs, toast_grads) = self.toasts.build(&self.font, &mut atlas, window_w, window_h);

        if atlas.dirty {
            renderer.upload_atlas(&atlas);
            atlas.clear_dirty();
        }
        drop(atlas);

        // --- Backdrop blur: any floating element triggers 2-pass rendering ---
        let needs_blur = self.palette.visible
            || self.context_menu.is_some()
            || self.sidebar_menu.is_some()
            || !self.toasts.is_empty();

        // --- Gradient rects (shadows, light leaks, component backgrounds) ---
        let mut all_gradient_rects = build_light_leaks(window_w, window_h);
        all_gradient_rects.extend(agent_grads);

        // --- Base scene rects (non-floating content) ---
        let mut all_rects: Vec<RectInstance> = Vec::new();
        all_rects.extend(chrome_out.rects);
        all_rects.extend(sidebar_out.rects);
        all_rects.extend(scm_rects);
        all_rects.extend(agent_rects);
        all_rects.extend(toolkit_out.rects);
        all_rects.extend(activity_out.rects);
        all_rects.extend(content_rects);

        let mut all_glyphs = chrome_out.glyphs;
        all_glyphs.extend(sidebar_out.glyphs);
        all_glyphs.extend(scm_glyphs);
        all_glyphs.extend(agent_glyphs);
        all_glyphs.extend(toolkit_out.glyphs);
        all_glyphs.extend(activity_out.glyphs);
        all_glyphs.extend(content_glyphs);

        // --- Split floating overlays from base scene ---
        let mut overlay_rects: Vec<RectInstance> = Vec::new();
        let mut overlay_glyphs: Vec<GlyphInstance> = Vec::new();
        let mut overlay_grads: Vec<GradientRectInstance> = Vec::new();

        if needs_blur {
            // Floating elements → overlay (rendered AFTER blur)
            overlay_grads.extend(ctx_grads);
            overlay_grads.extend(sb_menu_grads);
            overlay_grads.extend(palette_out.gradient_rects);
            overlay_grads.extend(toast_grads);
            overlay_rects.extend(ctx_rects);
            overlay_rects.extend(sb_menu_rects);
            overlay_rects.extend(palette_out.rects);
            overlay_rects.extend(toast_rects);
            overlay_glyphs.extend(ctx_glyphs);
            overlay_glyphs.extend(sb_menu_glyphs);
            overlay_glyphs.extend(palette_out.glyphs);
            overlay_glyphs.extend(toast_glyphs);
        } else {
            // No blur: merge floating elements into main batch
            all_gradient_rects.extend(ctx_grads);
            all_gradient_rects.extend(sb_menu_grads);
            all_gradient_rects.extend(palette_out.gradient_rects);
            all_gradient_rects.extend(toast_grads);
            all_rects.extend(ctx_rects);
            all_rects.extend(sb_menu_rects);
            all_rects.extend(palette_out.rects);
            all_rects.extend(toast_rects);
            all_glyphs.extend(ctx_glyphs);
            all_glyphs.extend(sb_menu_glyphs);
            all_glyphs.extend(palette_out.glyphs);
            all_glyphs.extend(toast_glyphs);
        }

        // Fluent Design "Reveal Highlight" — radial glow following the mouse cursor
        apply_reveal_highlight(&mut all_rects, self.chrome.mouse_pos, &self.hit_regions);

        let clear_color = wgpu::Color {
            r: 0.047, g: 0.047, b: 0.047,
            a: 0.02, // glass-clear — nearly transparent, Mica shows through
        };

        match surface.get_current_texture() {
            Ok(texture) => {
                let view = texture.texture.create_view(&wgpu::TextureViewDescriptor::default());

                if needs_blur {
                    // 3-phase rendering: scene → blur → floating overlays
                    let w = config.width;
                    let h = config.height;

                    // Ensure offscreen texture exists and matches size
                    let need_recreate = match &self.scene_texture {
                        Some((_, _, sw, sh)) => *sw != w || *sh != h,
                        None => true,
                    };
                    if need_recreate {
                        let device = self.device.as_ref().unwrap();
                        let tex = device.create_texture(&wgpu::TextureDescriptor {
                            label: Some("scene_offscreen"),
                            size: wgpu::Extent3d { width: w, height: h, depth_or_array_layers: 1 },
                            mip_level_count: 1, sample_count: 1,
                            dimension: wgpu::TextureDimension::D2,
                            format: config.format,
                            usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::TEXTURE_BINDING,
                            view_formats: &[],
                        });
                        let tv = tex.create_view(&wgpu::TextureViewDescriptor::default());
                        self.scene_texture = Some((tex, tv, w, h));
                    }

                    let scene_view = &self.scene_texture.as_ref().unwrap().1;

                    // Phase 1: render base scene (no floating overlays) to offscreen
                    renderer.render_frame_full(scene_view, &all_glyphs, &all_rects, &all_gradient_rects, clear_color);

                    // Phase 2: blur offscreen → surface
                    let device = self.device.as_ref().unwrap();
                    let queue = self.queue.as_ref().unwrap();
                    let mut encoder = device.create_command_encoder(&wgpu::CommandEncoderDescriptor {
                        label: Some("blur_encoder"),
                    });
                    if let Some(blur) = &mut self.blur_pipeline {
                        blur.blur(device, queue, &mut encoder, scene_view, &view, w, h, config.format, 2);
                    }
                    queue.submit(std::iter::once(encoder.finish()));

                    // Phase 3: render all floating overlays on top of blurred scene
                    if !overlay_rects.is_empty() || !overlay_glyphs.is_empty() || !overlay_grads.is_empty() {
                        renderer.render_overlay(&view, &overlay_glyphs, &overlay_rects, &overlay_grads);
                    }
                } else {
                    // Fast path: single-pass rendering (no blur needed)
                    renderer.render_frame_full(&view, &all_glyphs, &all_rects, &all_gradient_rects, clear_color);
                }

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
    ) -> (Vec<RectInstance>, Vec<GlyphInstance>, Vec<GradientRectInstance>) {
        let mut rects = Vec::new();
        let mut glyphs = Vec::new();
        let mut gradient_rects = Vec::new();
        let (mx, my) = match self.context_menu {
            Some(pos) => pos,
            None => return (rects, glyphs, gradient_rects),
        };

        const ITEMS: &[(&str, bool)] = &[
            ("Copy", false), ("Paste", false), ("Select All", true),
            ("Search", false), ("Clear", false),
        ];
        let item_h = 28.0f32;
        let menu_w = 180.0f32;
        let pad = 6.0f32; // space-3
        let divider_h = 1.0 + pad * 2.0; // divider takes space
        let content_h: f32 = ITEMS.iter().map(|(_, has_div)| {
            item_h + if *has_div { divider_h } else { 0.0 }
        }).sum();
        let menu_h = content_h + pad * 2.0;

        // GPU SDF shadow (16px blur) + glass-thick background
        gradient_rects.push(GradientRectInstance::shadowed(
            [mx, my], [menu_w, menu_h],
            ui::cat::GLASS_THICK, 8.0, 16.0, 0.4,
        ));
        // Border: 1px rgba(255,255,255,0.1)
        rects.push(RectInstance::bordered([mx, my], [menu_w, menu_h], [0.0, 0.0, 0.0, 0.0], 8.0, 1.0, 0.1));

        let hover_idx = self.chrome.mouse_pos.and_then(|(hx, hy)| {
            if hx >= mx && hx < mx + menu_w && hy >= my + pad && hy < my + menu_h - pad {
                // Calculate index accounting for dividers
                let mut y_acc = 0.0f32;
                for (i, (_, has_div)) in ITEMS.iter().enumerate() {
                    let this_h = item_h + if *has_div { divider_h } else { 0.0 };
                    if hy - my - pad < y_acc + this_h {
                        return Some(i);
                    }
                    y_acc += this_h;
                }
                None
            } else {
                None
            }
        });

        let mut cursor_y = my + pad;
        for (i, (label, has_divider)) in ITEMS.iter().enumerate() {
            if hover_idx == Some(i) {
                rects.push(RectInstance::rounded([mx + 4.0, cursor_y], [menu_w - 8.0, item_h], ui::cat::HOVER, 4.0));
            }
            let text_y = cursor_y + (item_h - font.cell_height) / 2.0;
            ui::render_text(font, atlas, label, mx + 12.0, text_y, ui::cat::text(), &mut glyphs);
            cursor_y += item_h;

            // Divider line after this item
            if *has_divider {
                cursor_y += pad;
                rects.push(RectInstance::new(
                    [mx + 8.0, cursor_y],
                    [menu_w - 16.0, 1.0],
                    ui::cat::BORDER,
                ));
                cursor_y += 1.0 + pad;
            }
        }
        (rects, glyphs, gradient_rects)
    }

    /// Build sidebar context menu overlay.
    pub(super) fn build_sidebar_menu(
        &self,
        font: &FontManager,
        atlas: &mut GlyphAtlas,
    ) -> (Vec<RectInstance>, Vec<GlyphInstance>, Vec<GradientRectInstance>) {
        let mut rects = Vec::new();
        let mut glyphs = Vec::new();
        let mut gradient_rects = Vec::new();
        let (mx, my, _, is_dir) = match &self.sidebar_menu {
            Some(m) => (m.0, m.1, &m.2, m.3),
            None => return (rects, glyphs, gradient_rects),
        };
        let items: &[&str] = if is_dir {
            &["New File", "New Folder", "Delete"]
        } else {
            &["Rename", "Delete", "Open", "Show Diff"]
        };
        let item_h = 28.0f32;
        let menu_w = 180.0f32;
        let pad = 6.0f32;
        let menu_h = items.len() as f32 * item_h + pad * 2.0;

        // GPU SDF shadow (16px blur) + glass-thick background
        gradient_rects.push(GradientRectInstance::shadowed(
            [mx, my], [menu_w, menu_h],
            ui::cat::GLASS_THICK, 8.0, 16.0, 0.4,
        ));
        // Border: 1px rgba(255,255,255,0.1)
        rects.push(RectInstance::bordered([mx, my], [menu_w, menu_h], [0.0, 0.0, 0.0, 0.0], 8.0, 1.0, 0.1));

        let hover_idx = self.chrome.mouse_pos.and_then(|(hx, hy)| {
            if hx >= mx && hx < mx + menu_w && hy >= my + pad && hy < my + menu_h - pad {
                Some(((hy - my - pad) / item_h) as usize)
            } else {
                None
            }
        });

        for (i, label) in items.iter().enumerate() {
            let iy = my + pad + i as f32 * item_h;
            if hover_idx == Some(i) {
                rects.push(RectInstance::rounded([mx + 4.0, iy], [menu_w - 8.0, item_h], ui::cat::HOVER, 4.0));
            }
            let text_y = iy + (item_h - font.cell_height) / 2.0;
            ui::render_text(font, atlas, label, mx + 12.0, text_y, ui::cat::text(), &mut glyphs);
        }
        (rects, glyphs, gradient_rects)
    }

    /// Build agent session panel (inside sidebar, bottom area).
    pub(super) fn build_agent_panel(
        &self,
        font: &FontManager,
        atlas: &mut GlyphAtlas,
        window_h: f32,
    ) -> (Vec<RectInstance>, Vec<GlyphInstance>, Vec<GradientRectInstance>) {
        let mut rects = Vec::new();
        let mut glyphs = Vec::new();
        let mut gradient_rects = Vec::new();
        if !self.sidebar.visible {
            return (rects, glyphs, gradient_rects);
        }
        let agent_tabs: Vec<(usize, &super::types::AgentTabInfo)> = self
            .tab_states
            .iter()
            .enumerate()
            .filter_map(|(i, t)| t.agent_info().map(|a| (i, a)))
            .collect();
        if agent_tabs.is_empty() {
            return (rects, glyphs, gradient_rects);
        }
        let sidebar_w = self.sidebar.width();
        let card_total_h = 40.0 + 4.0; // card_h + card_gap
        let panel_h = 28.0 + agent_tabs.len() as f32 * card_total_h;
        let panel_y = window_h - ui::STATUS_BAR_HEIGHT - panel_h;

        // Panel background: glass-thick + subtle gradient (top slightly lighter)
        gradient_rects.push(GradientRectInstance::gradient_v(
            [0.0, panel_y], [sidebar_w, panel_h],
            ui::cat::GLASS_DENSE, ui::cat::GLASS_THICK,
            0.0,
        ));
        rects.push(RectInstance::new([0.0, panel_y], [sidebar_w, 1.0], ui::cat::BORDER));

        let header_y = panel_y + (28.0 - font.cell_height) / 2.0;
        ui::render_text_bold(font, atlas, "AGENTS", 8.0, header_y, ui::cat::overlay0(), &mut glyphs);

        let count_str = format!("{}", agent_tabs.len());
        let count_x = 8.0 + 7.0 * font.cell_width;
        ui::render_text(font, atlas, &count_str, count_x, header_y, ui::cat::pm(137, 180, 250, 255), &mut glyphs);

        let card_h = 40.0f32;
        let card_gap = 4.0f32;
        let entry_top = panel_y + 28.0;
        for (i, (tab_idx, info)) in agent_tabs.iter().enumerate() {
            let y = entry_top + i as f32 * (card_h + card_gap);
            let is_active = *tab_idx == self.chrome.active_tab;
            let status_color = info.status.color();
            let card_x = 6.0f32;
            let card_w = sidebar_w - 12.0;

            // Card background: gradient(135deg, glass-thick → glass-dense) + shadow
            gradient_rects.push(GradientRectInstance::gradient_v_shadowed(
                [card_x, y], [card_w, card_h],
                ui::cat::GLASS_THICK,
                ui::cat::GLASS_DENSE,
                8.0, 8.0, 0.2,
            ));

            // Card border — status-colored when active, subtle otherwise
            let border_color = if is_active {
                [status_color[0] * 0.6, status_color[1] * 0.6, status_color[2] * 0.6, 0.6]
            } else {
                ui::cat::BORDER
            };
            rects.push(RectInstance::bordered([card_x, y], [card_w, card_h], [0.0; 4], 8.0, 1.0,
                border_color[3]));

            // 3px left accent stripe
            rects.push(RectInstance::rounded([card_x, y + 4.0], [3.0, card_h - 8.0], status_color, 4.0));

            // Stripe glow (6px spread)
            let stripe_glow = [
                status_color[0] * 0.3,
                status_color[1] * 0.3,
                status_color[2] * 0.3,
                0.3,
            ];
            rects.push(RectInstance::rounded([card_x, y + 2.0], [8.0, card_h - 4.0], stripe_glow, 4.0));

            // Active card: inner glow radial simulation
            if is_active {
                let inner_glow = [
                    status_color[0] * 0.08,
                    status_color[1] * 0.08,
                    status_color[2] * 0.08,
                    0.08,
                ];
                rects.push(RectInstance::rounded([card_x, y], [card_w, card_h], inner_glow, 8.0));
            }

            // Status dot: 7x7 circle with glow
            let dot_x = card_x + 12.0;
            let dot_y = y + 8.0;
            // Dot glow (behind)
            let dot_glow = [
                status_color[0] * 0.25,
                status_color[1] * 0.25,
                status_color[2] * 0.25,
                0.25,
            ];
            rects.push(RectInstance::rounded([dot_x - 3.0, dot_y - 3.0], [13.0, 13.0], dot_glow, 6.0));
            // Dot
            rects.push(RectInstance::rounded([dot_x, dot_y], [7.0, 7.0], status_color, 4.0));

            // CLI name: text-primary, bold
            let text_x = dot_x + 14.0;
            let text_y1 = y + 6.0;
            let cli_name = match &info.cli {
                AgentCli::Claude => "Claude",
                AgentCli::Codex => "Codex",
                AgentCli::Gemini => "Gemini",
                AgentCli::Custom(s) => s.as_str(),
            };
            ui::render_text(font, atlas, cli_name, text_x, text_y1, ui::cat::TEXT_PRIMARY, &mut glyphs);
            // Model text: #89b4fa (ctp-blue)
            let model_x = text_x + (cli_name.len() as f32 + 1.0) * font.cell_width;
            let model_label = format!("({})", info.model);
            ui::render_text(font, atlas, &model_label, model_x, text_y1, ui::cat::CTP_BLUE, &mut glyphs);

            // Status label + cost text
            let text_y2 = text_y1 + font.cell_height + 3.0;
            let status_label = info.status.label();
            ui::render_text(font, atlas, status_label, text_x, text_y2, ui::cat::overlay0(), &mut glyphs);
            let cost_str = format!(" ${:.3}", info.cost);
            let cost_x = text_x + status_label.len() as f32 * font.cell_width;
            ui::render_text(font, atlas, &cost_str, cost_x, text_y2, ui::cat::CTP_PEACH, &mut glyphs);
        }
        (rects, glyphs, gradient_rects)
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

    // Border color: rgba(255,255,255,0.06) — design system border
    let border_color = ui::cat::BORDER;
    // Header background: rgba(255,255,255,0.03)
    let header_bg = [0.03, 0.03, 0.03, 0.03];
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
        ui::render_text(font, atlas, indicator, indicator_x, text_y, ui::cat::overlay0(), &mut dec_glyphs);

        // Command text after indicator.
        let cmd_x = indicator_x + cell_w * 2.0;
        ui::render_text(font, atlas, &display_cmd, cmd_x, text_y, ui::cat::subtext1(), &mut dec_glyphs);

        // Exit code badge (if available).
        if let Some(code) = block.exit_code {
            let badge = if code == 0 {
                "\u{2713}".to_string() // checkmark
            } else {
                format!("E{}", code)
            };
            let badge_color = if code == 0 { ui::cat::STATUS_IDLE } else { ui::cat::STATUS_ERROR };
            let badge_x = bx + block_w - (badge.len() as f32 + 1.0) * cell_w;
            ui::render_text(font, atlas, &badge, badge_x, text_y, badge_color, &mut dec_glyphs);
        }
    }

    (dec_rects, dec_glyphs)
}

/// Build a list of collapsed row ranges as (first_screen_row, last_screen_row, line_count).
///
/// For each collapsed block, the output rows (output_start..=output_end) are hidden.
/// Returns screen-relative row ranges clamped to the visible viewport.
fn build_collapsed_ranges(
    tracker: &BlockTracker,
    viewport_start: usize,
    viewport_end: usize,
    visible_rows: usize,
) -> Vec<(usize, usize, usize)> {
    let mut ranges = Vec::new();
    for block in tracker.blocks() {
        if !block.collapsed {
            continue;
        }
        let output_end = match block.output_end {
            Some(end) => end,
            None => viewport_end, // still running — collapse up to viewport end
        };
        // Only collapse if there are output rows to hide
        if block.output_start > output_end {
            continue;
        }
        // Check overlap with viewport
        if block.output_start > viewport_end || output_end < viewport_start {
            continue;
        }
        let first_abs = block.output_start.max(viewport_start);
        let last_abs = output_end.min(viewport_end);
        let first_screen = first_abs.saturating_sub(viewport_start);
        let last_screen = last_abs.saturating_sub(viewport_start).min(visible_rows.saturating_sub(1));
        if first_screen <= last_screen {
            let line_count = output_end.saturating_sub(block.output_start) + 1;
            ranges.push((first_screen, last_screen, line_count));
        }
    }
    ranges
}

/// Check if a screen row falls within any collapsed range.
fn is_row_collapsed(screen_row: usize, ranges: &[(usize, usize, usize)]) -> bool {
    ranges.iter().any(|(first, last, _)| screen_row >= *first && screen_row <= *last)
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

            // Feed visible rows to block tracker and build decorations.
            feed_block_tracker(&grid, &mut leaf.block_tracker);

            // Compute collapsed row ranges (screen-relative) for output hiding.
            let cell_h = font.cell_height;
            let cell_w = font.cell_width;
            let sb_len = grid.scrollback.len();
            let visible_rows = grid.rows as usize;
            let viewport_start = if grid.viewport_offset == 0 {
                sb_len
            } else {
                sb_len.saturating_sub(grid.viewport_offset)
            };
            let viewport_end = viewport_start + visible_rows.saturating_sub(1);

            let collapsed_ranges = build_collapsed_ranges(
                &leaf.block_tracker, viewport_start, viewport_end, visible_rows,
            );

            // Filter out glyphs and rects that fall within collapsed output rows.
            if !collapsed_ranges.is_empty() {
                term_glyphs.retain(|g| {
                    let screen_row = (g.pos[1] / cell_h) as usize;
                    !is_row_collapsed(screen_row, &collapsed_ranges)
                });
                term_rects.retain(|r| {
                    let screen_row = (r.pos[1] / cell_h) as usize;
                    !is_row_collapsed(screen_row, &collapsed_ranges)
                });
            }

            // Offset all instances to pane position.
            for g in &mut term_glyphs {
                g.pos[0] += x;
                g.pos[1] += y;
            }
            for r in &mut term_rects {
                r.pos[0] += x;
                r.pos[1] += y;
            }

            // Draw "... N lines hidden ..." summary for each collapsed block.
            let mut summary_rects = Vec::new();
            let mut summary_glyphs = Vec::new();
            for (first_row, _last_row, line_count) in &collapsed_ranges {
                let summary_y = y + *first_row as f32 * cell_h;
                let inset = 4.0_f32;
                let block_w = w - inset * 2.0;
                // Background bar
                summary_rects.push(RectInstance::rounded(
                    [x + inset, summary_y],
                    [block_w, cell_h],
                    ui::cat::HOVER,
                    4.0,
                ));
                // Summary text
                let label = format!("  \u{2026} {} lines hidden \u{2026}", line_count);
                let text_y = summary_y + (cell_h - font.cell_height) / 2.0;
                let text_x = x + inset + cell_w * 2.0;
                ui::render_text(font, atlas, &label, text_x, text_y, ui::cat::overlay0(), &mut summary_glyphs);
            }

            let (blk_rects, blk_glyphs) = build_block_decorations(
                &grid, &leaf.block_tracker, font, atlas, x, y, w,
            );

            grid.clear_dirty();
            rects.extend(term_rects);
            glyphs.extend(term_glyphs);
            rects.extend(blk_rects);
            glyphs.extend(blk_glyphs);
            rects.extend(summary_rects);
            glyphs.extend(summary_glyphs);
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
                    rects.push(RectInstance::new([x + first_w, y], [divider, h], ui::cat::BORDER_STRONG));
                    render_pane_tree(second, focused_id, font, atlas, x + first_w + divider, y, second_w, h, rects, glyphs);
                }
                SplitDir::Vertical => {
                    let first_h = (h * *ratio).floor();
                    let divider = 2.0;
                    let second_h = h - first_h - divider;
                    render_pane_tree(first, focused_id, font, atlas, x, y, w, first_h, rects, glyphs);
                    rects.push(RectInstance::new([x, y + first_h], [w, divider], ui::cat::BORDER_STRONG));
                    render_pane_tree(second, focused_id, font, atlas, x, y + first_h + divider, w, second_h, rects, glyphs);
                }
            }
        }
    }
}

/// Build "Boucheron luxury" light leak gradient rects — SDF rounded rects with
/// gradient falloff placed at Z=0 before chrome for a subtle ambient glow.
fn build_light_leaks(window_w: f32, window_h: f32) -> Vec<GradientRectInstance> {
    vec![
        // Gold glow top-left
        GradientRectInstance::gradient_v(
            [-window_w * 0.12, -window_h * 0.12],
            [window_w * 0.4, window_h * 0.4],
            [0.784 * 0.08, 0.627 * 0.08, 0.314 * 0.08, 0.08], // gold 8%
            [0.0, 0.0, 0.0, 0.0], // fade to transparent
            window_w * 0.2,
        ),
        // Cyan glow bottom-right
        GradientRectInstance::gradient_v(
            [window_w * 0.65, window_h * 0.65],
            [window_w * 0.35, window_h * 0.35],
            [0.0, 0.0, 0.0, 0.0],
            [0.58 * 0.05, 0.886 * 0.05, 0.835 * 0.05, 0.05], // cyan 5%
            window_w * 0.17,
        ),
    ]
}

/// Fluent Design "Reveal Highlight" -- a subtle radial glow that follows the mouse
/// cursor over interactive chrome elements (buttons, tabs).
fn apply_reveal_highlight(
    rects: &mut Vec<RectInstance>,
    mouse_pos: Option<(f32, f32)>,
    hit_regions: &[ui::HitRegion],
) {
    let (mx, my) = match mouse_pos {
        Some(pos) => pos,
        None => return,
    };

    // For each hit region the mouse is near, add a subtle radial gradient overlay
    let proximity = 20.0_f32;
    for region in hit_regions {
        let in_x = mx >= region.x - proximity && mx <= region.x + region.w + proximity;
        let in_y = my >= region.y - proximity && my <= region.y + region.h + proximity;
        if !in_x || !in_y {
            continue;
        }

        // Add a small highlight rect at mouse position, clipped to region bounds
        let highlight_size = 60.0_f32;
        let hx = (mx - highlight_size / 2.0).max(region.x);
        let hy = (my - highlight_size / 2.0).max(region.y);
        let hw = highlight_size.min(region.x + region.w - hx);
        let hh = highlight_size.min(region.y + region.h - hy);

        if hw > 0.0 && hh > 0.0 {
            rects.push(RectInstance::rounded(
                [hx, hy],
                [hw, hh],
                [1.0, 1.0, 1.0, 0.03], // Very subtle white glow
                8.0,
            ));
        }
    }
}
