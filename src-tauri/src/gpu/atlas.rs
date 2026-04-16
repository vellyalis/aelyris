use std::collections::HashMap;
use crate::gpu::grid::CellFlags;
use crate::gpu::font::{FontManager, RasterizedGlyph};

#[derive(Clone, Hash, Eq, PartialEq)]
pub struct GlyphKey {
    pub c: char,
    pub flags: CellFlags,
}

#[derive(Clone)]
pub struct AtlasEntry {
    pub uv: [f32; 4],
    pub bearing_x: f32,
    pub bearing_y: f32,
    pub width: u32,
    pub height: u32,
}

/// CPU-side glyph atlas with bin-packing and pixel buffer.
///
/// Uses RGBA8 format for subpixel anti-aliasing (ClearType-style).
/// Each pixel stores per-subpixel coverage in R, G, B channels.
pub struct GlyphAtlas {
    cache: HashMap<GlyphKey, AtlasEntry>,
    /// Raw pixel data (RGBA8 format) for GPU upload.
    pub pixels: Vec<u8>,
    cursor_x: u32,
    cursor_y: u32,
    row_height: u32,
    pub atlas_width: u32,
    pub atlas_height: u32,
    pub dirty: bool,
}

impl GlyphAtlas {
    pub fn new(width: u32, height: u32) -> Self {
        Self {
            cache: HashMap::new(),
            pixels: vec![0u8; (width * height * 4) as usize],
            cursor_x: 0,
            cursor_y: 0,
            row_height: 0,
            atlas_width: width,
            atlas_height: height,
            dirty: false,
        }
    }

    pub fn get(&self, key: &GlyphKey) -> Option<&AtlasEntry> {
        self.cache.get(key)
    }

    pub fn len(&self) -> usize {
        self.cache.len()
    }

    pub fn clear_dirty(&mut self) {
        self.dirty = false;
    }

    /// Get a cached entry or rasterize and insert (with subpixel AA).
    pub fn get_or_insert(&mut self, c: char, flags: CellFlags, font: &FontManager) -> AtlasEntry {
        let key = GlyphKey { c, flags };
        if let Some(entry) = self.cache.get(&key) {
            return entry.clone();
        }
        let glyph = font.rasterize_subpixel(c, flags);
        self.insert(key, &glyph)
    }

    fn insert(&mut self, key: GlyphKey, glyph: &RasterizedGlyph) -> AtlasEntry {
        let w = glyph.width;
        let h = glyph.height;

        // Zero-size glyphs (space, control chars)
        if w == 0 || h == 0 {
            let entry = AtlasEntry {
                uv: [0.0, 0.0, 0.0, 0.0],
                bearing_x: glyph.bearing_x, bearing_y: glyph.bearing_y,
                width: 0, height: 0,
            };
            self.cache.insert(key, entry.clone());
            return entry;
        }

        // Row-based bin packing
        if self.cursor_x + w > self.atlas_width {
            self.cursor_x = 0;
            self.cursor_y += self.row_height + 1;
            self.row_height = 0;
        }

        if self.cursor_y + h > self.atlas_height {
            log::warn!("Glyph atlas full ({} glyphs cached)", self.cache.len());
            let entry = AtlasEntry {
                uv: [0.0; 4], bearing_x: glyph.bearing_x, bearing_y: glyph.bearing_y,
                width: 0, height: 0,
            };
            self.cache.insert(key, entry.clone());
            return entry;
        }

        // Copy bitmap into RGBA pixel buffer
        if glyph.subpixel {
            // Subpixel: bitmap is RGB (3 bytes per logical pixel) → pack into RGBA
            for row in 0..h {
                for col in 0..w {
                    let src = (row * w * 3 + col * 3) as usize;
                    let dst = ((self.cursor_y + row) * self.atlas_width + self.cursor_x + col) as usize * 4;
                    if src + 2 < glyph.bitmap.len() && dst + 3 < self.pixels.len() {
                        let r = glyph.bitmap[src];
                        let g = glyph.bitmap[src + 1];
                        let b = glyph.bitmap[src + 2];
                        self.pixels[dst] = r;
                        self.pixels[dst + 1] = g;
                        self.pixels[dst + 2] = b;
                        self.pixels[dst + 3] = r.max(g).max(b);
                    }
                }
            }
        } else {
            // Grayscale: 1 byte per pixel → replicate to all RGBA channels
            for row in 0..h {
                for col in 0..w {
                    let src = (row * w + col) as usize;
                    let dst = ((self.cursor_y + row) * self.atlas_width + self.cursor_x + col) as usize * 4;
                    if src < glyph.bitmap.len() && dst + 3 < self.pixels.len() {
                        let v = glyph.bitmap[src];
                        self.pixels[dst] = v;
                        self.pixels[dst + 1] = v;
                        self.pixels[dst + 2] = v;
                        self.pixels[dst + 3] = v;
                    }
                }
            }
        }

        let u0 = self.cursor_x as f32 / self.atlas_width as f32;
        let v0 = self.cursor_y as f32 / self.atlas_height as f32;
        let u1 = (self.cursor_x + w) as f32 / self.atlas_width as f32;
        let v1 = (self.cursor_y + h) as f32 / self.atlas_height as f32;

        let entry = AtlasEntry {
            uv: [u0, v0, u1, v1],
            bearing_x: glyph.bearing_x, bearing_y: glyph.bearing_y,
            width: w, height: h,
        };

        self.cursor_x += w + 1;
        self.row_height = self.row_height.max(h + 1);
        self.dirty = true;
        self.cache.insert(key, entry.clone());
        entry
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_atlas_insert_and_lookup() {
        let font = FontManager::new(14.0, 1.4);
        let mut atlas = GlyphAtlas::new(512, 512);
        let entry = atlas.get_or_insert('A', CellFlags::default(), &font);
        assert!(entry.width > 0);
        assert!(atlas.dirty);

        // Cache hit
        let entry2 = atlas.get_or_insert('A', CellFlags::default(), &font);
        assert_eq!(entry.uv, entry2.uv);
    }

    #[test]
    fn test_atlas_a_to_z() {
        let font = FontManager::new(14.0, 1.4);
        let mut atlas = GlyphAtlas::new(512, 512);
        for c in 'A'..='Z' {
            atlas.get_or_insert(c, CellFlags::default(), &font);
        }
        assert_eq!(atlas.len(), 26);

        let a = atlas.get(&GlyphKey { c: 'A', flags: CellFlags::default() }).unwrap();
        let z = atlas.get(&GlyphKey { c: 'Z', flags: CellFlags::default() }).unwrap();
        assert_ne!(a.uv, z.uv);
    }

    #[test]
    fn test_atlas_cjk() {
        let font = FontManager::new(14.0, 1.4);
        let mut atlas = GlyphAtlas::new(2048, 2048);
        let entry = atlas.get_or_insert('日', CellFlags::default(), &font);
        assert!(entry.width > 0);
    }

    #[test]
    fn test_atlas_pixels_written() {
        let font = FontManager::new(14.0, 1.4);
        let mut atlas = GlyphAtlas::new(512, 512);
        atlas.get_or_insert('W', CellFlags::default(), &font);
        let nonzero = atlas.pixels.iter().filter(|&&p| p > 0).count();
        assert!(nonzero > 0, "No pixels written for 'W'");
    }

    #[test]
    fn test_atlas_bold_separate() {
        let font = FontManager::new(14.0, 1.4);
        let mut atlas = GlyphAtlas::new(512, 512);
        let regular = atlas.get_or_insert('A', CellFlags::default(), &font);
        let bold = atlas.get_or_insert('A', CellFlags { bold: true, ..Default::default() }, &font);
        assert_ne!(regular.uv, bold.uv);
        assert_eq!(atlas.len(), 2);
    }
}
