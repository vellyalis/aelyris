//! UI Chrome — title bar, tab bar, status bar, and sidebar.
//!
//! Uses the same RectInstance + GlyphInstance as the terminal grid.
//! No external UI framework dependency.

pub mod editor;
pub mod palette;
pub mod sidebar;
pub mod syntax;

use crate::gpu::atlas::GlyphAtlas;
use crate::gpu::font::FontManager;
use crate::gpu::grid::CellFlags;
use crate::gpu::renderer::{GlyphInstance, RectInstance};

// Layout constants (pixels)
pub const TITLE_BAR_HEIGHT: f32 = 32.0;
pub const TAB_BAR_HEIGHT: f32 = 34.0;
pub const STATUS_BAR_HEIGHT: f32 = 24.0;
pub const CHROME_TOP: f32 = TITLE_BAR_HEIGHT + TAB_BAR_HEIGHT;
pub const BTN_WIDTH: f32 = 46.0;

// Catppuccin Mocha palette (premultiplied where needed)
pub mod cat {
    /// Premultiplied RGBA from 0-255 components.
    pub const fn pm(r: u8, g: u8, b: u8, a: u8) -> [f32; 4] {
        let af = a as f32 / 255.0;
        [
            r as f32 / 255.0 * af,
            g as f32 / 255.0 * af,
            b as f32 / 255.0 * af,
            af,
        ]
    }
    pub const MANTLE_BG: [f32; 4] = pm(24, 24, 37, 240);
    pub const TAB_BAR_BG: [f32; 4] = pm(20, 20, 33, 235);
    pub const TAB_ACTIVE: [f32; 4] = pm(49, 50, 68, 245);
    pub const STATUS_BG: [f32; 4] = pm(24, 24, 37, 235);
    pub const CLOSE_HOVER: [f32; 4] = pm(200, 60, 60, 180);
    pub const BTN_HOVER: [f32; 4] = pm(69, 71, 90, 120);

    // Non-premultiplied text colors (shader handles premultiplication)
    pub const TEXT: [f32; 4] = [0.81, 0.83, 0.88, 1.0];
    pub const SUBTEXT1: [f32; 4] = [0.73, 0.76, 0.87, 1.0];
    pub const SUBTEXT0: [f32; 4] = [0.65, 0.68, 0.78, 1.0];
    pub const OVERLAY0: [f32; 4] = [0.42, 0.44, 0.53, 1.0];
    pub const BLUE: [f32; 4] = [0.54, 0.71, 0.98, 1.0];
    pub const GREEN: [f32; 4] = [0.65, 0.89, 0.63, 1.0];
}

pub struct Tab {
    pub id: String,
    pub title: String,
    pub shell: String,
}

/// Actions produced by chrome hit testing.
#[derive(Debug, Clone)]
pub enum ChromeAction {
    Close,
    Minimize,
    ToggleMaximize,
    DragWindow,
    NewTab,
    CloseTab(usize),
    SwitchTab(usize),
}

/// Clickable region in the chrome.
pub struct HitRegion {
    pub x: f32,
    pub y: f32,
    pub w: f32,
    pub h: f32,
    pub action: ChromeAction,
}

impl HitRegion {
    fn contains(&self, px: f32, py: f32) -> bool {
        px >= self.x && px < self.x + self.w && py >= self.y && py < self.y + self.h
    }
}

/// Output of chrome rendering.
pub struct ChromeOutput {
    pub rects: Vec<RectInstance>,
    pub glyphs: Vec<GlyphInstance>,
    pub hits: Vec<HitRegion>,
}

/// Optional status bar override (e.g., editor mode info).
pub struct StatusOverride {
    pub label: String,
    pub detail: String,
    pub indicator: String,
}

/// State for the UI chrome.
pub struct ChromeState {
    pub tabs: Vec<Tab>,
    pub active_tab: usize,
    pub is_maximized: bool,
    pub git_branch: Option<String>,
    pub mouse_pos: Option<(f32, f32)>,
    pub status_override: Option<StatusOverride>,
}

impl ChromeState {
    pub fn new() -> Self {
        Self {
            tabs: Vec::new(),
            active_tab: 0,
            is_maximized: false,
            git_branch: None,
            mouse_pos: None,
            status_override: None,
        }
    }

    pub fn add_tab(&mut self, id: String, title: String, shell: String) {
        self.tabs.push(Tab { id, title, shell });
    }

    /// Hit-test a mouse click against chrome regions.
    pub fn hit_test(&self, hits: &[HitRegion], x: f32, y: f32) -> Option<ChromeAction> {
        // Check in reverse order so overlapping regions prefer later (more specific) ones
        for region in hits.iter().rev() {
            if region.contains(x, y) {
                return Some(region.action.clone());
            }
        }
        None
    }

    /// Build all chrome visual instances for one frame.
    pub fn build(
        &self,
        font: &FontManager,
        atlas: &mut GlyphAtlas,
        window_w: f32,
        window_h: f32,
    ) -> ChromeOutput {
        let mut rects = Vec::new();
        let mut glyphs = Vec::new();
        let mut hits = Vec::new();

        self.build_title_bar(font, atlas, window_w, &mut rects, &mut glyphs, &mut hits);
        self.build_tab_bar(font, atlas, window_w, &mut rects, &mut glyphs, &mut hits);
        self.build_status_bar(font, atlas, window_w, window_h, &mut rects, &mut glyphs, &mut hits);

        ChromeOutput { rects, glyphs, hits }
    }

    fn build_title_bar(
        &self,
        font: &FontManager,
        atlas: &mut GlyphAtlas,
        w: f32,
        rects: &mut Vec<RectInstance>,
        glyphs: &mut Vec<GlyphInstance>,
        hits: &mut Vec<HitRegion>,
    ) {
        // Background
        rects.push(RectInstance {
            pos: [0.0, 0.0],
            size: [w, TITLE_BAR_HEIGHT],
            color: cat::MANTLE_BG,
        });

        // Title text
        let title_y = (TITLE_BAR_HEIGHT - font.cell_height) / 2.0;
        render_text(font, atlas, "Aether Terminal", 12.0, title_y, cat::SUBTEXT1, glyphs);

        // Window control buttons (right-aligned)
        let btn_x_close = w - BTN_WIDTH;
        let btn_x_max = w - BTN_WIDTH * 2.0;
        let btn_x_min = w - BTN_WIDTH * 3.0;

        // Hover highlights
        if let Some((mx, my)) = self.mouse_pos {
            if my < TITLE_BAR_HEIGHT {
                if mx >= btn_x_close {
                    rects.push(RectInstance {
                        pos: [btn_x_close, 0.0],
                        size: [BTN_WIDTH, TITLE_BAR_HEIGHT],
                        color: cat::CLOSE_HOVER,
                    });
                } else if mx >= btn_x_max {
                    rects.push(RectInstance {
                        pos: [btn_x_max, 0.0],
                        size: [BTN_WIDTH, TITLE_BAR_HEIGHT],
                        color: cat::BTN_HOVER,
                    });
                } else if mx >= btn_x_min {
                    rects.push(RectInstance {
                        pos: [btn_x_min, 0.0],
                        size: [BTN_WIDTH, TITLE_BAR_HEIGHT],
                        color: cat::BTN_HOVER,
                    });
                }
            }
        }

        // Button icons (centered in each button area)
        let icon_y = title_y;
        let icon_offset = (BTN_WIDTH - font.cell_width) / 2.0;
        render_text(font, atlas, "\u{2715}", btn_x_close + icon_offset, icon_y, cat::SUBTEXT1, glyphs);
        let max_icon = if self.is_maximized { "\u{2752}" } else { "\u{25A1}" };
        render_text(font, atlas, max_icon, btn_x_max + icon_offset, icon_y, cat::SUBTEXT1, glyphs);
        render_text(font, atlas, "\u{2500}", btn_x_min + icon_offset, icon_y, cat::SUBTEXT1, glyphs);

        // Hit regions: buttons first (higher priority), then drag area
        hits.push(HitRegion {
            x: btn_x_close, y: 0.0, w: BTN_WIDTH, h: TITLE_BAR_HEIGHT,
            action: ChromeAction::Close,
        });
        hits.push(HitRegion {
            x: btn_x_max, y: 0.0, w: BTN_WIDTH, h: TITLE_BAR_HEIGHT,
            action: ChromeAction::ToggleMaximize,
        });
        hits.push(HitRegion {
            x: btn_x_min, y: 0.0, w: BTN_WIDTH, h: TITLE_BAR_HEIGHT,
            action: ChromeAction::Minimize,
        });
        // Drag region = title bar minus buttons
        hits.push(HitRegion {
            x: 0.0, y: 0.0, w: btn_x_min, h: TITLE_BAR_HEIGHT,
            action: ChromeAction::DragWindow,
        });
    }

    fn build_tab_bar(
        &self,
        font: &FontManager,
        atlas: &mut GlyphAtlas,
        w: f32,
        rects: &mut Vec<RectInstance>,
        glyphs: &mut Vec<GlyphInstance>,
        hits: &mut Vec<HitRegion>,
    ) {
        let bar_y = TITLE_BAR_HEIGHT;

        // Background
        rects.push(RectInstance {
            pos: [0.0, bar_y],
            size: [w, TAB_BAR_HEIGHT],
            color: cat::TAB_BAR_BG,
        });

        let tab_h = TAB_BAR_HEIGHT - 4.0;
        let tab_y = bar_y + 2.0;
        let text_y = tab_y + (tab_h - font.cell_height) / 2.0;
        let mut x = 6.0;

        for (i, tab) in self.tabs.iter().enumerate() {
            let is_active = i == self.active_tab;
            let title = &tab.title;
            let tab_text_w = title.chars().count() as f32 * font.cell_width;
            let close_w = font.cell_width + 8.0; // close button space
            let tab_w = 16.0 + tab_text_w + close_w; // padding + text + close

            // Tab background (active tab is highlighted)
            if is_active {
                rects.push(RectInstance {
                    pos: [x, tab_y],
                    size: [tab_w, tab_h],
                    color: cat::TAB_ACTIVE,
                });
            } else if let Some((mx, my)) = self.mouse_pos {
                if mx >= x && mx < x + tab_w && my >= tab_y && my < tab_y + tab_h {
                    rects.push(RectInstance {
                        pos: [x, tab_y],
                        size: [tab_w, tab_h],
                        color: cat::BTN_HOVER,
                    });
                }
            }

            // Tab title
            let text_color = if is_active { cat::TEXT } else { cat::SUBTEXT0 };
            render_text(font, atlas, title, x + 8.0, text_y, text_color, glyphs);

            // Close button on tab
            let close_x = x + 8.0 + tab_text_w + 4.0;
            render_text(font, atlas, "\u{2715}", close_x, text_y, cat::OVERLAY0, glyphs);

            // Tab click region (switch) — push first so CloseTab wins in reverse iteration
            hits.push(HitRegion {
                x, y: tab_y, w: tab_w, h: tab_h,
                action: ChromeAction::SwitchTab(i),
            });
            hits.push(HitRegion {
                x: close_x, y: tab_y, w: close_w, h: tab_h,
                action: ChromeAction::CloseTab(i),
            });

            x += tab_w + 2.0;
        }

        // New tab button
        let add_w = font.cell_width + 16.0;
        render_text(font, atlas, "+", x + 8.0, text_y, cat::OVERLAY0, glyphs);
        if let Some((mx, my)) = self.mouse_pos {
            if mx >= x && mx < x + add_w && my >= tab_y && my < tab_y + tab_h {
                rects.push(RectInstance {
                    pos: [x, tab_y],
                    size: [add_w, tab_h],
                    color: cat::BTN_HOVER,
                });
            }
        }
        hits.push(HitRegion {
            x, y: tab_y, w: add_w, h: tab_h,
            action: ChromeAction::NewTab,
        });
    }

    fn build_status_bar(
        &self,
        font: &FontManager,
        atlas: &mut GlyphAtlas,
        w: f32,
        h: f32,
        rects: &mut Vec<RectInstance>,
        glyphs: &mut Vec<GlyphInstance>,
        _hits: &mut Vec<HitRegion>,
    ) {
        let bar_y = h - STATUS_BAR_HEIGHT;

        // Background
        rects.push(RectInstance {
            pos: [0.0, bar_y],
            size: [w, STATUS_BAR_HEIGHT],
            color: cat::STATUS_BG,
        });

        let text_y = bar_y + (STATUS_BAR_HEIGHT - font.cell_height) / 2.0;
        let mut x = 10.0;

        if let Some(so) = &self.status_override {
            // Editor mode status bar
            render_text(font, atlas, &so.label, x, text_y, cat::BLUE, glyphs);
            x += so.label.chars().count() as f32 * font.cell_width + 8.0;

            render_text(font, atlas, "|", x, text_y, cat::OVERLAY0, glyphs);
            x += font.cell_width + 8.0;

            render_text(font, atlas, &so.detail, x, text_y, cat::SUBTEXT1, glyphs);
            x += so.detail.chars().count() as f32 * font.cell_width + 8.0;

            render_text(font, atlas, "|", x, text_y, cat::OVERLAY0, glyphs);
            x += font.cell_width + 8.0;

            render_text(font, atlas, &so.indicator, x, text_y, cat::GREEN, glyphs);
        } else if let Some(tab) = self.tabs.get(self.active_tab) {
            // Terminal mode status bar
            render_text(font, atlas, &tab.shell, x, text_y, cat::BLUE, glyphs);
            x += tab.shell.chars().count() as f32 * font.cell_width + 8.0;

            render_text(font, atlas, "|", x, text_y, cat::OVERLAY0, glyphs);
            x += font.cell_width + 8.0;

            let branch = self.git_branch.as_deref().unwrap_or("—");
            render_text(font, atlas, branch, x, text_y, cat::GREEN, glyphs);
            x += branch.chars().count() as f32 * font.cell_width + 8.0;

            render_text(font, atlas, "|", x, text_y, cat::OVERLAY0, glyphs);
            x += font.cell_width + 8.0;

            render_text(font, atlas, "UTF-8", x, text_y, cat::SUBTEXT0, glyphs);
        }
    }
}

impl Default for ChromeState {
    fn default() -> Self {
        Self::new()
    }
}

/// Render a text string as glyph instances using the terminal font.
pub fn render_text(
    font: &FontManager,
    atlas: &mut GlyphAtlas,
    text: &str,
    x: f32,
    y: f32,
    color: [f32; 4],
    glyphs: &mut Vec<GlyphInstance>,
) {
    let flags = CellFlags::default();
    let mut offset_x = 0.0;

    for ch in text.chars() {
        if ch == ' ' {
            offset_x += font.cell_width;
            continue;
        }

        let entry = atlas.get_or_insert(ch, flags, font);
        if entry.width == 0 || entry.height == 0 {
            offset_x += font.cell_width;
            continue;
        }

        let gx = x + offset_x + entry.bearing_x;
        let gy = y + font.baseline - entry.bearing_y - entry.height as f32;

        glyphs.push(GlyphInstance {
            pos: [gx, gy],
            uv_rect: entry.uv,
            fg_color: color,
            bg_color: [0.0, 0.0, 0.0, 0.0],
            size: [entry.width as f32, entry.height as f32],
        });

        offset_x += font.cell_width;
    }
}
