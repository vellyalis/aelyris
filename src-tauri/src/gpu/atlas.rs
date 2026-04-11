//! Glyph texture atlas for GPU text rendering.
//!
//! Packs rasterized glyph bitmaps into a 2D texture atlas (2048x2048 R8).
//! Each glyph is cached by (char, CellFlags) key to avoid re-rasterization.

use std::collections::HashMap;

use crate::gpu::grid::CellFlags;

/// Key for atlas cache lookup.
#[derive(Clone, Hash, Eq, PartialEq)]
pub struct GlyphKey {
    pub c: char,
    pub flags: CellFlags,
}

/// UV coordinates and metrics for a cached glyph in the atlas.
#[derive(Clone)]
pub struct AtlasEntry {
    /// Texture coordinates: (u0, v0, u1, v1) in normalized [0,1] space.
    pub uv: [f32; 4],
    /// Glyph bearing for correct positioning.
    pub bearing_x: f32,
    pub bearing_y: f32,
    /// Glyph bitmap dimensions (pixels).
    pub width: u32,
    pub height: u32,
}

/// The glyph atlas — CPU-side bookkeeping for the GPU texture.
pub struct GlyphAtlas {
    cache: HashMap<GlyphKey, AtlasEntry>,
    /// Current packing cursor position.
    cursor_x: u32,
    cursor_y: u32,
    row_height: u32,
    pub atlas_width: u32,
    pub atlas_height: u32,
    // TODO: Phase 3 — wgpu::Texture handle
}

impl GlyphAtlas {
    pub fn new(width: u32, height: u32) -> Self {
        Self {
            cache: HashMap::new(),
            cursor_x: 0,
            cursor_y: 0,
            row_height: 0,
            atlas_width: width,
            atlas_height: height,
        }
    }

    /// Look up a glyph in the cache.
    pub fn get(&self, key: &GlyphKey) -> Option<&AtlasEntry> {
        self.cache.get(key)
    }

    /// Insert a rasterized glyph into the atlas.
    /// Returns the atlas entry with UV coordinates.
    pub fn insert(&mut self, key: GlyphKey, bitmap: &[u8], width: u32, height: u32, bearing_x: f32, bearing_y: f32) -> AtlasEntry {
        // Simple left-to-right, top-to-bottom bin packing
        if self.cursor_x + width > self.atlas_width {
            self.cursor_x = 0;
            self.cursor_y += self.row_height;
            self.row_height = 0;
        }

        let u0 = self.cursor_x as f32 / self.atlas_width as f32;
        let v0 = self.cursor_y as f32 / self.atlas_height as f32;
        let u1 = (self.cursor_x + width) as f32 / self.atlas_width as f32;
        let v1 = (self.cursor_y + height) as f32 / self.atlas_height as f32;

        let entry = AtlasEntry {
            uv: [u0, v0, u1, v1],
            bearing_x,
            bearing_y,
            width,
            height,
        };

        // TODO: Phase 3 — upload bitmap to GPU texture at (cursor_x, cursor_y)

        self.cursor_x += width + 1; // 1px padding
        self.row_height = self.row_height.max(height + 1);
        self.cache.insert(key, entry.clone());
        entry
    }
}
