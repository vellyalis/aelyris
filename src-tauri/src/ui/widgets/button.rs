//! Button widget — standardized interactive button rendering.
//!
//! Supports two style variants:
//! - **Ghost**: transparent at rest, visible on hover (for toolbars, tab actions)
//! - **Primary**: accent-colored, for main actions
//!
//! Each button tracks 4 visual states: Normal, Hover, Active (pressed), Disabled.
//!
//! Usage:
//! ```ignore
//! let out = button::build(
//!     font, atlas,
//!     "Save", Some('\u{f0c7}'),  // label + optional Nerd Font icon
//!     x, y, w, h,
//!     ButtonVariant::Ghost,
//!     ButtonInteraction { hovered: true, pressed: false, disabled: false },
//! );
//! rects.extend(out.rects);
//! glyphs.extend(out.glyphs);
//! ```

use crate::gpu::atlas::GlyphAtlas;
use crate::gpu::font::FontManager;
use crate::gpu::renderer::{GlyphInstance, RectInstance};
use crate::ui::tokens::*;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/// Visual style variant.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum ButtonVariant {
    Ghost,
    Primary,
}

/// Current interaction state (caller determines this from mouse/keyboard).
#[derive(Debug, Clone, Copy, Default)]
pub struct ButtonInteraction {
    pub hovered: bool,
    pub pressed: bool,
    pub disabled: bool,
}

/// Rendering output.
pub struct ButtonOutput {
    pub rects: Vec<RectInstance>,
    pub glyphs: Vec<GlyphInstance>,
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

/// Render a button.
///
/// - `label`: button text.
/// - `icon`: optional leading icon character (Nerd Font).
/// - `x, y, w, h`: button bounds.
pub fn build(
    font: &FontManager,
    atlas: &mut GlyphAtlas,
    label: &str,
    icon: Option<char>,
    x: f32,
    y: f32,
    w: f32,
    h: f32,
    variant: ButtonVariant,
    interaction: ButtonInteraction,
) -> ButtonOutput {
    let mut rects = Vec::new();
    let mut glyphs = Vec::new();

    // Resolve colors
    let (bg, fg) = resolve_colors(variant, interaction);

    // Background rect (only if not fully transparent)
    if bg[3] > 0.001 {
        rects.push(RectInstance::rounded([x, y], [w, h], bg, RADIUS_MD));
    }

    // Text positioning
    let text_y = y + (h - font.cell_height) / 2.0;
    let mut text_x = x + SPACE_MD;

    // Optional icon
    if let Some(icon_ch) = icon {
        let icon_str = icon_ch.to_string();
        crate::ui::render_text(font, atlas, &icon_str, text_x, text_y, fg, &mut glyphs);
        text_x += font.cell_width + SPACE_SM;
    }

    // Label
    if !label.is_empty() {
        let max_chars = ((w - (text_x - x) - SPACE_MD) / font.cell_width).max(0.0) as usize;
        let display: String = label.chars().take(max_chars).collect();
        crate::ui::render_text(font, atlas, &display, text_x, text_y, fg, &mut glyphs);
    }

    ButtonOutput { rects, glyphs }
}

/// Build an icon-only button (square, no label).
pub fn build_icon(
    font: &FontManager,
    atlas: &mut GlyphAtlas,
    icon: char,
    x: f32,
    y: f32,
    size: f32,
    variant: ButtonVariant,
    interaction: ButtonInteraction,
) -> ButtonOutput {
    let mut rects = Vec::new();
    let mut glyphs = Vec::new();

    let (bg, fg) = resolve_colors(variant, interaction);

    if bg[3] > 0.001 {
        rects.push(RectInstance::rounded([x, y], [size, size], bg, RADIUS_MD));
    }

    let icon_x = x + (size - font.cell_width) / 2.0;
    let icon_y = y + (size - font.cell_height) / 2.0;
    let icon_str = icon.to_string();
    crate::ui::render_text(font, atlas, &icon_str, icon_x, icon_y, fg, &mut glyphs);

    ButtonOutput { rects, glyphs }
}

/// Simple hit test for a rectangular button.
pub fn hit_test(x: f32, y: f32, w: f32, h: f32, mx: f32, my: f32) -> bool {
    mx >= x && mx <= x + w && my >= y && my <= y + h
}

// ---------------------------------------------------------------------------
// Color resolution
// ---------------------------------------------------------------------------

fn resolve_colors(variant: ButtonVariant, interaction: ButtonInteraction) -> ([f32; 4], [f32; 4]) {
    if interaction.disabled {
        let (bg, fg) = base_colors(variant);
        return (apply_opacity(bg, BTN_DISABLED_OPACITY), apply_opacity(fg, BTN_DISABLED_OPACITY));
    }

    let bg = match variant {
        ButtonVariant::Ghost => {
            if interaction.pressed {
                BTN_GHOST_ACTIVE
            } else if interaction.hovered {
                BTN_GHOST_HOVER
            } else {
                BTN_GHOST_BG
            }
        }
        ButtonVariant::Primary => {
            if interaction.pressed {
                BTN_PRIMARY_ACTIVE
            } else if interaction.hovered {
                BTN_PRIMARY_HOVER
            } else {
                BTN_PRIMARY_BG
            }
        }
    };

    let fg = match variant {
        ButtonVariant::Ghost => crate::ui::cat::text(),
        ButtonVariant::Primary => BTN_PRIMARY_TEXT,
    };

    (bg, fg)
}

fn base_colors(variant: ButtonVariant) -> ([f32; 4], [f32; 4]) {
    match variant {
        ButtonVariant::Ghost => (BTN_GHOST_BG, crate::ui::cat::text()),
        ButtonVariant::Primary => (BTN_PRIMARY_BG, BTN_PRIMARY_TEXT),
    }
}

fn apply_opacity(color: [f32; 4], opacity: f32) -> [f32; 4] {
    [
        color[0] * opacity,
        color[1] * opacity,
        color[2] * opacity,
        color[3] * opacity,
    ]
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_ghost_normal_transparent() {
        let (bg, _) = resolve_colors(
            ButtonVariant::Ghost,
            ButtonInteraction::default(),
        );
        assert!(bg[3] < 0.001); // fully transparent at rest
    }

    #[test]
    fn test_ghost_hover_visible() {
        let (bg, _) = resolve_colors(
            ButtonVariant::Ghost,
            ButtonInteraction { hovered: true, ..Default::default() },
        );
        assert!(bg[3] > 0.1);
    }

    #[test]
    fn test_primary_always_visible() {
        let (bg, _) = resolve_colors(
            ButtonVariant::Primary,
            ButtonInteraction::default(),
        );
        assert!(bg[3] > 0.5);
    }

    #[test]
    fn test_disabled_reduces_opacity() {
        let (bg_normal, _) = resolve_colors(
            ButtonVariant::Primary,
            ButtonInteraction::default(),
        );
        let (bg_disabled, _) = resolve_colors(
            ButtonVariant::Primary,
            ButtonInteraction { disabled: true, ..Default::default() },
        );
        assert!(bg_disabled[3] < bg_normal[3]);
    }

    #[test]
    fn test_hit_test_inside() {
        assert!(hit_test(10.0, 20.0, 100.0, 30.0, 50.0, 35.0));
    }

    #[test]
    fn test_hit_test_outside() {
        assert!(!hit_test(10.0, 20.0, 100.0, 30.0, 5.0, 35.0));
        assert!(!hit_test(10.0, 20.0, 100.0, 30.0, 50.0, 55.0));
    }

    #[test]
    fn test_hit_test_edge() {
        assert!(hit_test(10.0, 20.0, 100.0, 30.0, 10.0, 20.0)); // top-left
        assert!(hit_test(10.0, 20.0, 100.0, 30.0, 110.0, 50.0)); // bottom-right
    }

    #[test]
    fn test_apply_opacity() {
        let c = apply_opacity([1.0, 0.5, 0.25, 1.0], 0.5);
        assert!((c[0] - 0.5).abs() < 0.001);
        assert!((c[1] - 0.25).abs() < 0.001);
        assert!((c[3] - 0.5).abs() < 0.001);
    }
}
