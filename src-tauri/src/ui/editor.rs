//! Editor pane — read-only file viewer (Phase 4a).
//!
//! Displays file contents with line numbers and scrolling.
//! Triggered by clicking a file in the sidebar.
//! Escape returns to terminal view.

use std::path::{Path, PathBuf};

use crate::gpu::atlas::GlyphAtlas;
use crate::gpu::font::FontManager;
use crate::gpu::renderer::{GlyphInstance, RectInstance};

use super::cat;

const LINE_NUM_PAD: f32 = 8.0;
const MAX_FILE_SIZE: u64 = 10 * 1024 * 1024; // 10 MB
const BINARY_CHECK_LEN: usize = 8192;

/// Output from the editor pane rendering.
pub struct EditorOutput {
    pub rects: Vec<RectInstance>,
    pub glyphs: Vec<GlyphInstance>,
}

/// Read-only file viewer state.
pub struct FileViewerState {
    pub file_path: PathBuf,
    pub file_name: String,
    pub lines: Vec<String>,
    pub scroll_offset: usize,
    pub cursor_line: usize,
    pub total_lines: usize,
}

impl FileViewerState {
    /// Open a file for viewing. Returns an error message on failure.
    pub fn open(path: &Path) -> Result<Self, String> {
        // Check file size
        let meta = std::fs::metadata(path)
            .map_err(|e| format!("Cannot read file: {}", e))?;

        if meta.len() > MAX_FILE_SIZE {
            return Err(format!(
                "File too large ({:.1} MB, max {} MB)",
                meta.len() as f64 / 1_048_576.0,
                MAX_FILE_SIZE / 1_048_576
            ));
        }

        // Read raw bytes for binary detection
        let raw = std::fs::read(path)
            .map_err(|e| format!("Cannot read file: {}", e))?;

        // Check for binary content (null bytes in first 8K)
        let check_len = raw.len().min(BINARY_CHECK_LEN);
        if raw[..check_len].contains(&0x00) {
            return Err("Binary file — cannot display".to_string());
        }

        let content = String::from_utf8_lossy(&raw);
        let lines: Vec<String> = content
            .lines()
            .map(|l| l.replace('\t', "    ")) // expand tabs
            .collect();
        let total_lines = lines.len();

        let file_name = path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| path.to_string_lossy().into_owned());

        Ok(Self {
            file_path: path.to_path_buf(),
            file_name,
            lines,
            scroll_offset: 0,
            cursor_line: 0,
            total_lines,
        })
    }

    /// Number of visible lines given the content area height (always >= 1).
    pub fn visible_count(&self, content_h: f32, cell_h: f32) -> usize {
        if cell_h <= 0.0 {
            return 1;
        }
        ((content_h / cell_h).floor() as usize).max(1)
    }

    /// Scroll up by n lines.
    pub fn scroll_up(&mut self, n: usize) {
        self.scroll_offset = self.scroll_offset.saturating_sub(n);
    }

    /// Scroll down by n lines.
    pub fn scroll_down(&mut self, n: usize, visible: usize) {
        let max = self.total_lines.saturating_sub(visible);
        self.scroll_offset = self.scroll_offset.saturating_add(n).min(max);
    }

    /// Move cursor up, scrolling if needed.
    pub fn cursor_up(&mut self, visible: usize) {
        if self.cursor_line > 0 {
            self.cursor_line -= 1;
            if self.cursor_line < self.scroll_offset {
                self.scroll_offset = self.cursor_line;
            }
        }
        let _ = visible;
    }

    /// Move cursor down, scrolling if needed.
    pub fn cursor_down(&mut self, visible: usize) {
        if self.cursor_line + 1 < self.total_lines {
            self.cursor_line += 1;
            if self.cursor_line >= self.scroll_offset + visible {
                self.scroll_offset = self.cursor_line - visible + 1;
            }
        }
    }

    /// Jump to top.
    pub fn go_top(&mut self) {
        self.cursor_line = 0;
        self.scroll_offset = 0;
    }

    /// Jump to bottom.
    pub fn go_bottom(&mut self, visible: usize) {
        self.cursor_line = self.total_lines.saturating_sub(1);
        self.scroll_offset = self.total_lines.saturating_sub(visible);
    }

    /// Page up.
    pub fn page_up(&mut self, visible: usize) {
        self.cursor_line = self.cursor_line.saturating_sub(visible);
        self.scroll_offset = self.scroll_offset.saturating_sub(visible);
    }

    /// Page down.
    pub fn page_down(&mut self, visible: usize) {
        let max_line = self.total_lines.saturating_sub(1);
        let max_scroll = self.total_lines.saturating_sub(visible);
        self.cursor_line = self.cursor_line.saturating_add(visible).min(max_line);
        self.scroll_offset = self.scroll_offset.saturating_add(visible).min(max_scroll);
    }

    /// Gutter width in pixels (line number column).
    fn gutter_width(&self, cell_w: f32) -> f32 {
        let digits = digit_count(self.total_lines);
        (digits as f32 + 1.0) * cell_w + LINE_NUM_PAD
    }

    /// Build rendering instances for the visible portion of the file.
    pub fn build(
        &self,
        font: &FontManager,
        atlas: &mut GlyphAtlas,
        x_offset: f32,
        y_offset: f32,
        content_w: f32,
        content_h: f32,
    ) -> EditorOutput {
        let mut rects = Vec::new();
        let mut glyphs = Vec::new();

        let gutter_w = self.gutter_width(font.cell_width);
        let text_area_w = content_w - gutter_w;
        let visible = self.visible_count(content_h, font.cell_height);
        let max_cols = (text_area_w / font.cell_width).floor() as usize;

        // Editor background
        rects.push(RectInstance {
            pos: [x_offset, y_offset],
            size: [content_w, content_h],
            color: cat::pm(30, 30, 46, 250), // Catppuccin Base
        });

        // Gutter background
        rects.push(RectInstance {
            pos: [x_offset, y_offset],
            size: [gutter_w, content_h],
            color: cat::pm(24, 24, 37, 250), // Catppuccin Mantle
        });

        // Gutter divider
        rects.push(RectInstance {
            pos: [x_offset + gutter_w - 1.0, y_offset],
            size: [1.0, content_h],
            color: cat::pm(49, 50, 68, 180),
        });

        let end_line = self.scroll_offset
            .saturating_add(visible)
            .saturating_add(1)
            .min(self.total_lines);
        let line_digits = digit_count(self.total_lines);

        for i in self.scroll_offset..end_line {
            let row_idx = i - self.scroll_offset;
            let line_y = y_offset + row_idx as f32 * font.cell_height;

            if line_y + font.cell_height < y_offset || line_y > y_offset + content_h {
                continue;
            }

            // Current line highlight
            if i == self.cursor_line {
                rects.push(RectInstance {
                    pos: [x_offset + gutter_w, line_y],
                    size: [content_w - gutter_w, font.cell_height],
                    color: cat::pm(49, 50, 68, 100),
                });
            }

            // Line number (right-aligned in gutter)
            let num_str = format!("{:>width$}", i + 1, width = line_digits);
            let num_color = if i == self.cursor_line {
                cat::SUBTEXT1
            } else {
                cat::OVERLAY0
            };
            super::render_text(
                font,
                atlas,
                &num_str,
                x_offset + LINE_NUM_PAD / 2.0,
                line_y,
                num_color,
                &mut glyphs,
            );

            // File content (truncated to visible width)
            if let Some(line) = self.lines.get(i) {
                let display: String = line.chars().take(max_cols).collect();
                let text_color = cat::TEXT;
                super::render_text(
                    font,
                    atlas,
                    &display,
                    x_offset + gutter_w + 4.0,
                    line_y,
                    text_color,
                    &mut glyphs,
                );
            }
        }

        EditorOutput { rects, glyphs }
    }
}

/// Count decimal digits needed to display a number.
fn digit_count(n: usize) -> usize {
    if n < 10 {
        return 1;
    }
    let mut count = 0;
    let mut v = n;
    while v > 0 {
        v /= 10;
        count += 1;
    }
    count
}
