//! Side-by-side diff viewer for git changes.
//!
//! Shows original (HEAD) on left and current on right.

use crate::gpu::atlas::GlyphAtlas;
use crate::gpu::font::FontManager;
use crate::gpu::renderer::{GlyphInstance, RectInstance};

use super::cat;

const LINE_HEIGHT: f32 = 20.0;
const GUTTER_WIDTH: f32 = 50.0;

/// Diff line kind.
#[derive(Clone, Copy, PartialEq)]
pub enum DiffKind {
    Context,
    Added,
    Removed,
    Header,
}

/// A single line in the diff view.
#[derive(Clone)]
pub struct DiffLine {
    pub kind: DiffKind,
    pub left_num: Option<usize>,
    pub right_num: Option<usize>,
    pub text: String,
}

pub struct DiffOutput {
    pub rects: Vec<RectInstance>,
    pub glyphs: Vec<GlyphInstance>,
}

/// Diff viewer state.
pub struct DiffState {
    pub file_path: String,
    pub lines: Vec<DiffLine>,
    pub scroll_offset: f32,
}

impl DiffState {
    /// Create from a unified diff string and file path.
    pub fn from_unified_diff(file_path: String, diff_text: &str) -> Self {
        let mut lines = Vec::new();
        let mut left_num = 0usize;
        let mut right_num = 0usize;

        for line in diff_text.lines() {
            if line.starts_with("@@") {
                // Parse hunk header: @@ -l,c +l,c @@
                if let Some(rest) = line.strip_prefix("@@ ") {
                    if let Some(plus) = rest.find('+') {
                        let nums: Vec<&str> = rest[plus + 1..].split(|c| c == ',' || c == ' ').collect();
                        if let Some(Ok(n)) = nums.first().map(|s| s.parse::<usize>()) {
                            right_num = n.saturating_sub(1);
                        }
                    }
                    if let Some(minus_part) = rest.strip_prefix("-") {
                        let nums: Vec<&str> = minus_part.split(|c| c == ',' || c == ' ').collect();
                        if let Some(Ok(n)) = nums.first().map(|s| s.parse::<usize>()) {
                            left_num = n.saturating_sub(1);
                        }
                    }
                }
                lines.push(DiffLine {
                    kind: DiffKind::Header,
                    left_num: None,
                    right_num: None,
                    text: line.to_string(),
                });
            } else if line.starts_with('+') && !line.starts_with("+++") {
                right_num += 1;
                lines.push(DiffLine {
                    kind: DiffKind::Added,
                    left_num: None,
                    right_num: Some(right_num),
                    text: line[1..].to_string(),
                });
            } else if line.starts_with('-') && !line.starts_with("---") {
                left_num += 1;
                lines.push(DiffLine {
                    kind: DiffKind::Removed,
                    left_num: Some(left_num),
                    right_num: None,
                    text: line[1..].to_string(),
                });
            } else if line.starts_with("diff ") || line.starts_with("index ") || line.starts_with("---") || line.starts_with("+++") {
                // Skip diff metadata
            } else {
                left_num += 1;
                right_num += 1;
                let text = if line.starts_with(' ') { &line[1..] } else { line };
                lines.push(DiffLine {
                    kind: DiffKind::Context,
                    left_num: Some(left_num),
                    right_num: Some(right_num),
                    text: text.to_string(),
                });
            }
        }

        Self {
            file_path,
            lines,
            scroll_offset: 0.0,
        }
    }

    pub fn scroll(&mut self, delta: f32) {
        self.scroll_offset = (self.scroll_offset + delta).max(0.0);
        let max = (self.lines.len() as f32 * LINE_HEIGHT).max(0.0);
        self.scroll_offset = self.scroll_offset.min(max);
    }

    pub fn build(
        &self,
        font: &FontManager,
        atlas: &mut GlyphAtlas,
        x: f32,
        y: f32,
        w: f32,
        h: f32,
    ) -> DiffOutput {
        let mut rects = Vec::new();
        let mut glyphs = Vec::new();

        // Background
        rects.push(RectInstance::new([x, y], [w, h], cat::GLASS_SOLID));

        // File header
        let header_h = 28.0;
        rects.push(RectInstance::new([x, y], [w, header_h], cat::GLASS_STANDARD));
        let header_y = y + (header_h - font.cell_height) / 2.0;
        let icon = super::icons::file_icon(&self.file_path, false);
        super::render_text(font, atlas, &icon.to_string(), x + 8.0, header_y, cat::blue(), &mut glyphs);
        super::render_text(font, atlas, &self.file_path, x + 8.0 + font.cell_width * 2.0, header_y, cat::text(), &mut glyphs);

        // Diff lines
        let content_top = y + header_h;
        let first_visible = (self.scroll_offset / LINE_HEIGHT).floor() as usize;
        let visible_count = (h / LINE_HEIGHT).ceil() as usize + 2;

        for i in first_visible..self.lines.len().min(first_visible + visible_count) {
            let line = &self.lines[i];
            let ly = content_top + i as f32 * LINE_HEIGHT - self.scroll_offset;
            if ly + LINE_HEIGHT < content_top || ly > y + h { continue; }

            // Background color per kind
            let bg = match line.kind {
                DiffKind::Added => cat::pm(166, 227, 161, 30),
                DiffKind::Removed => cat::pm(243, 139, 168, 30),
                DiffKind::Header => cat::pm(137, 180, 250, 25),
                DiffKind::Context => [0.0, 0.0, 0.0, 0.0],
            };
            if bg[3] > 0.0 {
                rects.push(RectInstance::new([x, ly], [w, LINE_HEIGHT], bg));
            }

            // Left gutter (line number)
            let text_y = ly + (LINE_HEIGHT - font.cell_height) / 2.0;
            let gutter_text = match line.kind {
                DiffKind::Added => format!("{:>4}", line.right_num.unwrap_or(0)),
                DiffKind::Removed => format!("{:>4}", line.left_num.unwrap_or(0)),
                DiffKind::Context => {
                    format!("{:>4}", line.left_num.unwrap_or(0))
                }
                DiffKind::Header => "    ".to_string(),
            };
            super::render_text(font, atlas, &gutter_text, x + 4.0, text_y, cat::overlay0(), &mut glyphs);

            // Kind indicator
            let indicator = match line.kind {
                DiffKind::Added => "+",
                DiffKind::Removed => "-",
                DiffKind::Header => "@",
                DiffKind::Context => " ",
            };
            let ind_color = match line.kind {
                DiffKind::Added => cat::green(),
                DiffKind::Removed => [0.95, 0.55, 0.66, 1.0],
                DiffKind::Header => cat::blue(),
                DiffKind::Context => cat::overlay0(),
            };
            super::render_text(font, atlas, indicator, x + GUTTER_WIDTH, text_y, ind_color, &mut glyphs);

            // Line text
            let text_x = x + GUTTER_WIDTH + font.cell_width * 2.0;
            let max_chars = ((w - GUTTER_WIDTH - font.cell_width * 3.0) / font.cell_width) as usize;
            let display = if line.text.len() > max_chars {
                format!("{}...", &line.text[..max_chars.saturating_sub(3)])
            } else {
                line.text.clone()
            };
            let text_color = match line.kind {
                DiffKind::Header => cat::blue(),
                _ => cat::text(),
            };
            super::render_text(font, atlas, &display, text_x, text_y, text_color, &mut glyphs);
        }

        DiffOutput { rects, glyphs }
    }
}
