//! Ghost text rendering — semi-transparent suggestion overlay.
//!
//! Generates `GlyphInstance`s for ghost (autocomplete) text that appears
//! after the cursor position. These are identical to normal glyphs except
//! for a reduced alpha value.

use crate::gpu::atlas::GlyphAtlas;
use crate::gpu::font::FontManager;
use crate::gpu::grid::CellFlags;
use crate::gpu::renderer::GlyphInstance;

/// Alpha value for ghost text (0.0 = invisible, 1.0 = opaque).
const GHOST_ALPHA: f32 = 0.35;

/// Ghost text color: Catppuccin Mocha Overlay0 at reduced opacity.
const GHOST_COLOR: [f32; 4] = [0.44, 0.45, 0.55, GHOST_ALPHA];

/// Render ghost suggestion text at a pixel position.
///
/// Returns glyph instances ready to be appended to the render batch.
/// The `start_x` / `start_y` are pixel coordinates for the first ghost char.
pub fn render_ghost_text(
    font: &FontManager,
    atlas: &mut GlyphAtlas,
    suggestion: &str,
    start_x: f32,
    start_y: f32,
) -> Vec<GlyphInstance> {
    let mut glyphs = Vec::with_capacity(suggestion.len());
    let flags = CellFlags::default();
    let mut offset_x = 0.0;

    for ch in suggestion.chars() {
        if ch == ' ' {
            offset_x += font.cell_width;
            continue;
        }

        let entry = atlas.get_or_insert(ch, flags, font);
        if entry.width == 0 || entry.height == 0 {
            offset_x += font.cell_width;
            continue;
        }

        glyphs.push(GlyphInstance {
            pos: [start_x + offset_x, start_y],
            uv_rect: entry.uv,
            fg_color: GHOST_COLOR,
            bg_color: [0.0, 0.0, 0.0, 0.0], // transparent background
            size: [entry.width as f32, entry.height as f32],
        });

        let char_w = if unicode_width::UnicodeWidthChar::width(ch).unwrap_or(1) > 1 {
            font.cell_width * 2.0
        } else {
            font.cell_width
        };
        offset_x += char_w;
    }

    glyphs
}

/// Calculate the pixel position for ghost text based on grid cursor state.
///
/// Returns `(x, y)` in window coordinates, accounting for sidebar offset
/// and chrome height.
pub fn ghost_position(
    font: &FontManager,
    cursor_col: usize,
    cursor_row: usize,
    sidebar_w: f32,
    chrome_top: f32,
) -> (f32, f32) {
    let x = sidebar_w + cursor_col as f32 * font.cell_width;
    let y = chrome_top + cursor_row as f32 * font.cell_height;
    (x, y)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_ghost_color_alpha() {
        assert!((GHOST_COLOR[3] - GHOST_ALPHA).abs() < f32::EPSILON);
    }

    #[test]
    fn test_ghost_position_no_sidebar() {
        let font = FontManager::new(14.0, 1.2);
        let (x, y) = ghost_position(&font, 5, 3, 0.0, 30.0);
        assert!((x - 5.0 * font.cell_width).abs() < 0.01);
        assert!((y - (30.0 + 3.0 * font.cell_height)).abs() < 0.01);
    }

    #[test]
    fn test_ghost_position_with_sidebar() {
        let font = FontManager::new(14.0, 1.2);
        let (x, _) = ghost_position(&font, 0, 0, 200.0, 30.0);
        assert!((x - 200.0).abs() < 0.01);
    }
}
