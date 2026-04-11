use crate::gpu::grid::CellFlags;

pub struct RasterizedGlyph {
    pub bitmap: Vec<u8>,
    pub width: u32,
    pub height: u32,
    pub bearing_x: f32,
    pub bearing_y: f32,
}

/// Font loading and rasterization via fontdue.
///
/// Font fallback chain:
///   1. Primary: CascadiaCode.ttf (regular monospace)
///   2. Bold: consolab.ttf (Consolas Bold)
///   3. Italic: consolai.ttf (Consolas Italic)
///   4. Bold+Italic: consolaz.ttf (Consolas Bold Italic)
///   5. CJK: NotoSansJP-VF.ttf (Japanese fallback)
///   6. Fallback: consola.ttf (Consolas Regular)
pub struct FontManager {
    regular: fontdue::Font,
    bold: Option<fontdue::Font>,
    italic: Option<fontdue::Font>,
    bold_italic: Option<fontdue::Font>,
    cjk: Option<fontdue::Font>,
    pub cell_width: f32,
    pub cell_height: f32,
    pub font_size: f32,
    pub baseline: f32,
}

fn load_font(path: &str) -> Option<fontdue::Font> {
    let data = std::fs::read(path).ok()?;
    let settings = fontdue::FontSettings {
        collection_index: 0,
        scale: 40.0,
        ..fontdue::FontSettings::default()
    };
    fontdue::Font::from_bytes(data, settings).ok()
}

impl FontManager {
    /// Load fonts from the system and compute cell dimensions.
    pub fn new(font_size: f32, line_height: f32) -> Self {
        let regular = load_font("C:/Windows/Fonts/CascadiaCode.ttf")
            .or_else(|| load_font("C:/Windows/Fonts/consola.ttf"))
            .expect("No monospace font found on system");

        let bold = load_font("C:/Windows/Fonts/consolab.ttf");
        let italic = load_font("C:/Windows/Fonts/consolai.ttf");
        let bold_italic = load_font("C:/Windows/Fonts/consolaz.ttf");
        let cjk = load_font("C:/Windows/Fonts/NotoSansJP-VF.ttf");

        // Compute cell dimensions from the regular font
        // Rasterize 'M' to get the advance width (monospace = all chars same width)
        let metrics = regular.metrics('M', font_size);
        let cell_width = metrics.advance_width;
        let cell_height = font_size * line_height;
        let baseline = font_size * 0.8; // approximate

        log::info!(
            "FontManager: size={}, cell={}x{}, regular=CascadiaCode, cjk={}",
            font_size, cell_width, cell_height,
            if cjk.is_some() { "NotoSansJP" } else { "none" }
        );

        Self { regular, bold, italic, bold_italic, cjk, cell_width, cell_height, font_size, baseline }
    }

    /// Select the appropriate font for the given style flags.
    fn select_font(&self, flags: CellFlags) -> &fontdue::Font {
        match (flags.bold, flags.italic) {
            (true, true) => self.bold_italic.as_ref().unwrap_or(&self.regular),
            (true, false) => self.bold.as_ref().unwrap_or(&self.regular),
            (false, true) => self.italic.as_ref().unwrap_or(&self.regular),
            _ => &self.regular,
        }
    }

    /// Check if a character needs the CJK fallback font.
    fn needs_cjk(c: char) -> bool {
        let cp = c as u32;
        // CJK Unified Ideographs, Hiragana, Katakana, Hangul, fullwidth forms
        matches!(cp,
            0x3000..=0x303F |   // CJK symbols & punctuation
            0x3040..=0x309F |   // Hiragana
            0x30A0..=0x30FF |   // Katakana
            0x4E00..=0x9FFF |   // CJK Unified Ideographs
            0xAC00..=0xD7AF |   // Hangul Syllables
            0xF900..=0xFAFF |   // CJK Compatibility Ideographs
            0xFF00..=0xFFEF |   // Halfwidth & Fullwidth Forms
            0x20000..=0x2A6DF | // CJK Extension B
            0x2A700..=0x2B73F   // CJK Extension C
        )
    }

    /// Rasterize a character with the given style flags.
    pub fn rasterize(&self, c: char, flags: CellFlags) -> RasterizedGlyph {
        // Select font: CJK fallback for CJK characters, style-based for others
        let font = if Self::needs_cjk(c) {
            self.cjk.as_ref().unwrap_or(self.select_font(flags))
        } else {
            let primary = self.select_font(flags);
            // Check if primary font has the glyph, otherwise try CJK
            if primary.lookup_glyph_index(c) != 0 {
                primary
            } else {
                self.cjk.as_ref().unwrap_or(primary)
            }
        };

        let (metrics, bitmap) = font.rasterize(c, self.font_size);

        RasterizedGlyph {
            bitmap,
            width: metrics.width as u32,
            height: metrics.height as u32,
            bearing_x: metrics.xmin as f32,
            bearing_y: metrics.ymin as f32,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_load_and_rasterize_ascii() {
        let fm = FontManager::new(14.0, 1.4);
        assert!(fm.cell_width > 0.0);
        assert!(fm.cell_height > 0.0);

        let glyph = fm.rasterize('A', CellFlags::default());
        assert!(glyph.width > 0);
        assert!(glyph.height > 0);
        assert!(!glyph.bitmap.is_empty());
    }

    #[test]
    fn test_rasterize_cjk() {
        let fm = FontManager::new(14.0, 1.4);
        let glyph = fm.rasterize('日', CellFlags::default());
        // CJK glyphs should be roughly 2x the width of ASCII
        assert!(glyph.width > 0);
        assert!(!glyph.bitmap.is_empty());
    }

    #[test]
    fn test_rasterize_bold() {
        let fm = FontManager::new(14.0, 1.4);
        let flags = CellFlags { bold: true, ..Default::default() };
        let glyph = fm.rasterize('B', flags);
        assert!(glyph.width > 0);
    }

    #[test]
    fn test_needs_cjk_detection() {
        assert!(FontManager::needs_cjk('日'));
        assert!(FontManager::needs_cjk('あ'));
        assert!(FontManager::needs_cjk('ア'));
        assert!(!FontManager::needs_cjk('A'));
        assert!(!FontManager::needs_cjk('1'));
    }

    #[test]
    fn test_cell_dimensions() {
        let fm = FontManager::new(14.0, 1.4);
        // Cell width should be reasonable for monospace (roughly 7-10px at 14pt)
        assert!(fm.cell_width > 5.0 && fm.cell_width < 15.0, "cell_width={}", fm.cell_width);
        // Cell height = font_size * line_height = 14 * 1.4 = 19.6
        assert!((fm.cell_height - 19.6).abs() < 0.01);
    }
}
