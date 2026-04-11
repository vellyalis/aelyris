//! Font rasterization and glyph management via fontdue.
//!
//! Loads font files, rasterizes individual glyphs to bitmaps,
//! and provides metrics (advance width, bearing, etc.) for layout.

use crate::gpu::grid::CellFlags;

/// A rasterized glyph bitmap ready for GPU upload.
pub struct RasterizedGlyph {
    pub bitmap: Vec<u8>,
    pub width: u32,
    pub height: u32,
    pub bearing_x: f32,
    pub bearing_y: f32,
}

/// Manages font loading and rasterization.
///
/// Holds regular, bold, italic, bold-italic, and CJK fallback fonts.
/// All fonts are monospace; cell dimensions are derived from the regular font.
pub struct FontManager {
    // TODO: Phase 2 — fontdue::Font instances
    pub cell_width: f32,
    pub cell_height: f32,
    pub font_size: f32,
    pub baseline: f32,
}

impl FontManager {
    /// Create a placeholder FontManager (Phase 2 will populate with real fonts).
    pub fn new_placeholder(font_size: f32, line_height: f32) -> Self {
        // Approximate monospace cell dimensions
        let cell_width = font_size * 0.6;
        let cell_height = font_size * line_height;
        let baseline = font_size * 0.8;
        Self {
            cell_width,
            cell_height,
            font_size,
            baseline,
        }
    }

    /// Rasterize a character with the given style flags.
    pub fn rasterize(&self, _c: char, _flags: CellFlags) -> RasterizedGlyph {
        // TODO: Phase 2 — actual fontdue rasterization with fallback chain
        RasterizedGlyph {
            bitmap: vec![],
            width: 0,
            height: 0,
            bearing_x: 0.0,
            bearing_y: 0.0,
        }
    }
}
