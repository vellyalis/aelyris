//! Editor pane — file viewer and text editor with syntax highlighting.
//!
//! Phase 4a: read-only file viewing with line numbers and scrolling.
//! Phase 4b: text editing with ropey, cursor, undo/redo, save.
//! Phase 4c: syntax highlighting with tree-sitter.
//!
//! Triggered by clicking a file in the sidebar.
//! Escape returns to terminal view.

use std::path::{Path, PathBuf};

use ropey::Rope;

use crate::gpu::atlas::GlyphAtlas;
use crate::gpu::font::FontManager;
use crate::gpu::renderer::{GlyphInstance, RectInstance};

use super::syntax::SyntaxState;

use super::cat;

const LINE_NUM_PAD: f32 = 8.0;
const MAX_FILE_SIZE: u64 = 10 * 1024 * 1024; // 10 MB
const BINARY_CHECK_LEN: usize = 8192;
const TAB_WIDTH: usize = 4;

/// Output from the editor pane rendering.
pub struct EditorOutput {
    pub rects: Vec<RectInstance>,
    pub glyphs: Vec<GlyphInstance>,
}

/// Line ending style detected on file open.
#[derive(Clone, Copy, PartialEq)]
enum LineEnding {
    Lf,
    CrLf,
}

/// An edit operation for undo/redo (char-indexed).
#[derive(Clone)]
enum EditOp {
    Insert { pos: usize, char_count: usize, text: String },
    Delete { pos: usize, char_count: usize, text: String },
}

/// Diagnostic severity from a language server.
#[derive(Clone, Copy, PartialEq)]
pub enum DiagnosticSeverity {
    Error,
    Warning,
    Info,
    Hint,
}

/// A single diagnostic from the language server.
#[derive(Clone)]
pub struct Diagnostic {
    pub line: usize,
    pub col_start: usize,
    pub col_end: usize,
    pub severity: DiagnosticSeverity,
    pub message: String,
}

/// Editor state with ropey text buffer.
pub struct EditorState {
    pub file_path: PathBuf,
    pub file_name: String,
    pub rope: Rope,
    line_ending: LineEnding,
    // Cursor position
    pub cursor_line: usize,
    pub cursor_col: usize,
    pub desired_col: usize,
    // Scroll state
    pub scroll_offset: usize,
    pub scroll_col: usize,
    // Edit state
    pub modified: bool,
    undo_stack: Vec<EditOp>,
    redo_stack: Vec<EditOp>,
    saved_undo_depth: usize,
    // Syntax highlighting
    pub syntax: Option<SyntaxState>,
    syntax_dirty: bool,
    // LSP diagnostics
    pub diagnostics: Vec<Diagnostic>,
    // Cursor blink
    pub cursor_visible: bool,
    blink_counter: u32,
}

impl EditorState {
    /// Open a file for editing. Returns an error message on failure.
    pub fn open(path: &Path) -> Result<Self, String> {
        let meta = std::fs::metadata(path)
            .map_err(|e| format!("Cannot read file: {}", e))?;

        if meta.len() > MAX_FILE_SIZE {
            return Err(format!(
                "File too large ({:.1} MB, max {} MB)",
                meta.len() as f64 / 1_048_576.0,
                MAX_FILE_SIZE / 1_048_576
            ));
        }

        let raw = std::fs::read(path)
            .map_err(|e| format!("Cannot read file: {}", e))?;

        let check_len = raw.len().min(BINARY_CHECK_LEN);
        if raw[..check_len].contains(&0x00) {
            return Err("Binary file — cannot display".to_string());
        }

        let content = String::from_utf8_lossy(&raw);

        // Detect line ending style before normalizing
        let line_ending = if content.contains("\r\n") {
            LineEnding::CrLf
        } else {
            LineEnding::Lf
        };

        // Normalize to LF internally
        let normalized = content.replace("\r\n", "\n");

        // Syntax highlighting
        let syntax = SyntaxState::from_path(path, &normalized);
        if let Some(ref s) = syntax {
            log::info!("Syntax: {} detected", s.language_name);
        }

        let rope = Rope::from_str(&normalized);

        let file_name = path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| path.to_string_lossy().into_owned());

        Ok(Self {
            file_path: path.to_path_buf(),
            file_name,
            rope,
            line_ending,
            cursor_line: 0,
            cursor_col: 0,
            desired_col: 0,
            scroll_offset: 0,
            scroll_col: 0,
            modified: false,
            undo_stack: Vec::new(),
            redo_stack: Vec::new(),
            saved_undo_depth: 0,
            syntax,
            syntax_dirty: false,
            diagnostics: Vec::new(),
            cursor_visible: true,
            blink_counter: 0,
        })
    }

    /// Total line count.
    pub fn total_lines(&self) -> usize {
        self.rope.len_lines()
    }

    /// Number of visible lines given the content area height (always >= 1).
    pub fn visible_count(&self, content_h: f32, cell_h: f32) -> usize {
        if cell_h <= 0.0 {
            return 1;
        }
        ((content_h / cell_h).floor() as usize).max(1)
    }

    /// Get the text of a specific line with tabs expanded (no line endings).
    fn line_text(&self, line_idx: usize) -> String {
        if line_idx >= self.rope.len_lines() {
            return String::new();
        }
        let line = self.rope.line(line_idx);
        let mut result = String::new();
        for ch in line.chars() {
            if ch == '\t' {
                let spaces = TAB_WIDTH - (result.len() % TAB_WIDTH);
                for _ in 0..spaces {
                    result.push(' ');
                }
            } else if ch == '\n' {
                // skip line ending (CRLF already normalized)
            } else {
                result.push(ch);
            }
        }
        result
    }

    /// Length of a line in characters (excluding trailing newline).
    fn line_len(&self, line_idx: usize) -> usize {
        if line_idx >= self.rope.len_lines() {
            return 0;
        }
        let line = self.rope.line(line_idx);
        let len = line.len_chars();
        // Subtract trailing LF (CRLF already normalized to LF in open())
        if len > 0 && line.char(len - 1) == '\n' {
            len - 1
        } else {
            len
        }
    }

    /// Clamp cursor column to valid range for current line.
    fn clamp_cursor_col(&mut self) {
        let max_col = self.line_len(self.cursor_line);
        self.cursor_col = self.cursor_col.min(max_col);
    }

    /// Ensure cursor is visible by adjusting scroll offsets.
    fn ensure_cursor_visible(&mut self, visible: usize) {
        if self.cursor_line < self.scroll_offset {
            self.scroll_offset = self.cursor_line;
        } else if self.cursor_line >= self.scroll_offset.saturating_add(visible) {
            self.scroll_offset = self.cursor_line.saturating_sub(visible) + 1;
        }
    }

    // --- Cursor movement ---

    pub fn move_up(&mut self, visible: usize) {
        if self.cursor_line > 0 {
            self.cursor_line -= 1;
            self.cursor_col = self.desired_col;
            self.clamp_cursor_col();
        }
        self.ensure_cursor_visible(visible);
    }

    pub fn move_down(&mut self, visible: usize) {
        if self.cursor_line + 1 < self.total_lines() {
            self.cursor_line += 1;
            self.cursor_col = self.desired_col;
            self.clamp_cursor_col();
        }
        self.ensure_cursor_visible(visible);
    }

    pub fn move_left(&mut self, visible: usize) {
        if self.cursor_col > 0 {
            self.cursor_col -= 1;
        } else if self.cursor_line > 0 {
            self.cursor_line -= 1;
            self.cursor_col = self.line_len(self.cursor_line);
        }
        self.desired_col = self.cursor_col;
        self.ensure_cursor_visible(visible);
    }

    pub fn move_right(&mut self, visible: usize) {
        let len = self.line_len(self.cursor_line);
        if self.cursor_col < len {
            self.cursor_col += 1;
        } else if self.cursor_line + 1 < self.total_lines() {
            self.cursor_line += 1;
            self.cursor_col = 0;
        }
        self.desired_col = self.cursor_col;
        self.ensure_cursor_visible(visible);
    }

    pub fn move_home(&mut self) {
        self.cursor_col = 0;
        self.desired_col = 0;
    }

    pub fn move_end(&mut self) {
        self.cursor_col = self.line_len(self.cursor_line);
        self.desired_col = self.cursor_col;
    }

    pub fn page_up(&mut self, visible: usize) {
        self.cursor_line = self.cursor_line.saturating_sub(visible);
        self.scroll_offset = self.scroll_offset.saturating_sub(visible);
        self.cursor_col = self.desired_col;
        self.clamp_cursor_col();
    }

    pub fn page_down(&mut self, visible: usize) {
        let max_line = self.total_lines().saturating_sub(1);
        let max_scroll = self.total_lines().saturating_sub(visible);
        self.cursor_line = self.cursor_line.saturating_add(visible).min(max_line);
        self.scroll_offset = self.scroll_offset.saturating_add(visible).min(max_scroll);
        self.cursor_col = self.desired_col;
        self.clamp_cursor_col();
    }

    pub fn go_top(&mut self) {
        self.cursor_line = 0;
        self.cursor_col = 0;
        self.desired_col = 0;
        self.scroll_offset = 0;
    }

    pub fn go_bottom(&mut self, visible: usize) {
        self.cursor_line = self.total_lines().saturating_sub(1);
        self.scroll_offset = self.total_lines().saturating_sub(visible);
        self.cursor_col = self.desired_col;
        self.clamp_cursor_col();
    }

    pub fn scroll_up(&mut self, n: usize) {
        self.scroll_offset = self.scroll_offset.saturating_sub(n);
    }

    pub fn scroll_down(&mut self, n: usize, visible: usize) {
        let max = self.total_lines().saturating_sub(visible);
        self.scroll_offset = self.scroll_offset.saturating_add(n).min(max);
    }

    // --- Text editing ---

    /// Convert cursor (line, col) to a rope char index.
    fn cursor_char_idx(&self) -> usize {
        let line_start = self.rope.line_to_char(self.cursor_line);
        let col = self.cursor_col.min(self.line_len(self.cursor_line));
        line_start + col
    }

    /// Insert text at cursor position.
    pub fn insert_text(&mut self, text: &str) {
        let idx = self.cursor_char_idx();
        let char_count = text.chars().count();
        let op = EditOp::Insert {
            pos: idx,
            char_count,
            text: text.to_string(),
        };
        self.rope.insert(idx, text);
        self.undo_stack.push(op);
        self.redo_stack.clear();
        self.modified = self.undo_stack.len() != self.saved_undo_depth;
        self.syntax_dirty = true;

        // Advance cursor
        for ch in text.chars() {
            if ch == '\n' {
                self.cursor_line += 1;
                self.cursor_col = 0;
            } else {
                self.cursor_col += 1;
            }
        }
        self.desired_col = self.cursor_col;
    }

    /// Insert a newline (Enter key).
    pub fn insert_newline(&mut self) {
        self.insert_text("\n");
    }

    /// Delete character before cursor (Backspace).
    pub fn delete_backward(&mut self) {
        let idx = self.cursor_char_idx();
        if idx == 0 {
            return;
        }

        let del_char = self.rope.char(idx - 1);
        let del_str = del_char.to_string();
        let op = EditOp::Delete {
            pos: idx - 1,
            char_count: 1,
            text: del_str,
        };
        self.rope.remove(idx - 1..idx);
        self.undo_stack.push(op);
        self.redo_stack.clear();
        self.modified = self.undo_stack.len() != self.saved_undo_depth;
        self.syntax_dirty = true;

        if del_char == '\n' {
            self.cursor_line = self.cursor_line.saturating_sub(1);
            self.cursor_col = self.line_len(self.cursor_line);
        } else {
            self.cursor_col = self.cursor_col.saturating_sub(1);
        }
        self.desired_col = self.cursor_col;
    }

    /// Delete character at cursor (Delete key).
    pub fn delete_forward(&mut self) {
        let idx = self.cursor_char_idx();
        if idx >= self.rope.len_chars() {
            return;
        }

        let del_char = self.rope.char(idx);
        let del_str = del_char.to_string();
        let op = EditOp::Delete {
            pos: idx,
            char_count: 1,
            text: del_str,
        };
        self.rope.remove(idx..idx + 1);
        self.undo_stack.push(op);
        self.redo_stack.clear();
        self.modified = self.undo_stack.len() != self.saved_undo_depth;
        self.syntax_dirty = true;
    }

    /// Insert a tab as spaces.
    pub fn insert_tab(&mut self) {
        let spaces = TAB_WIDTH - (self.cursor_col % TAB_WIDTH);
        let tab_str: String = std::iter::repeat(' ').take(spaces).collect();
        self.insert_text(&tab_str);
    }

    /// Undo the last edit operation.
    pub fn undo(&mut self) {
        let op = match self.undo_stack.pop() {
            Some(op) => op,
            None => return,
        };

        match &op {
            EditOp::Insert { pos, char_count, .. } => {
                let end = (*pos).saturating_add(*char_count).min(self.rope.len_chars());
                self.rope.remove(*pos..end);
                let (line, col) = self.char_idx_to_pos(*pos);
                self.cursor_line = line;
                self.cursor_col = col;
            }
            EditOp::Delete { pos, text, .. } => {
                self.rope.insert(*pos, text);
                let restore_idx = (*pos).saturating_add(text.chars().count());
                let (line, col) = self.char_idx_to_pos(restore_idx);
                self.cursor_line = line;
                self.cursor_col = col;
            }
        }
        self.redo_stack.push(op);
        self.desired_col = self.cursor_col;
        self.modified = self.undo_stack.len() != self.saved_undo_depth;
        self.syntax_dirty = true;
    }

    /// Redo the last undone operation.
    pub fn redo(&mut self) {
        let op = match self.redo_stack.pop() {
            Some(op) => op,
            None => return,
        };

        match &op {
            EditOp::Insert { pos, text, char_count } => {
                self.rope.insert(*pos, text);
                let end_idx = (*pos).saturating_add(*char_count);
                let (line, col) = self.char_idx_to_pos(end_idx);
                self.cursor_line = line;
                self.cursor_col = col;
            }
            EditOp::Delete { pos, char_count, .. } => {
                let end = (*pos).saturating_add(*char_count).min(self.rope.len_chars());
                self.rope.remove(*pos..end);
                let (line, col) = self.char_idx_to_pos(*pos);
                self.cursor_line = line;
                self.cursor_col = col;
            }
        }
        self.undo_stack.push(op);
        self.desired_col = self.cursor_col;
        self.modified = self.undo_stack.len() != self.saved_undo_depth;
        self.syntax_dirty = true;
    }

    /// Convert a char index to (line, col), clamped to valid range.
    fn char_idx_to_pos(&self, idx: usize) -> (usize, usize) {
        let idx = idx.min(self.rope.len_chars());
        let line = self.rope.char_to_line(idx);
        let line_start = self.rope.line_to_char(line);
        let col = (idx - line_start).min(self.line_len(line));
        (line, col)
    }

    /// Save file to disk (restoring original line ending style).
    pub fn save(&mut self) -> Result<(), String> {
        let mut content = self.rope.to_string();
        if self.line_ending == LineEnding::CrLf {
            content = content.replace('\n', "\r\n");
        }
        std::fs::write(&self.file_path, &content)
            .map_err(|e| format!("Cannot save: {}", e))?;
        self.saved_undo_depth = self.undo_stack.len();
        self.modified = false;
        log::info!("Saved: {}", self.file_path.display());
        Ok(())
    }

    /// Tick cursor blink (call each frame).
    pub fn tick_blink(&mut self) {
        self.blink_counter += 1;
        if self.blink_counter >= 30 {
            self.blink_counter = 0;
            self.cursor_visible = !self.cursor_visible;
        }
    }

    /// Reset blink to visible (call on cursor movement/edit).
    pub fn reset_blink(&mut self) {
        self.cursor_visible = true;
        self.blink_counter = 0;
    }

    /// Gutter width in pixels.
    fn gutter_width(&self, cell_w: f32) -> f32 {
        let digits = digit_count(self.total_lines());
        (digits as f32 + 1.0) * cell_w + LINE_NUM_PAD
    }

    /// Refresh syntax highlighting if dirty.
    pub fn refresh_syntax(&mut self) {
        if !self.syntax_dirty {
            return;
        }
        self.syntax_dirty = false;
        if let Some(ref mut syntax) = self.syntax {
            let source = self.rope.to_string();
            syntax.rehighlight(&self.file_path, &source);
        }
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

        // Editor background (Catppuccin Base)
        rects.push(RectInstance {
            pos: [x_offset, y_offset],
            size: [content_w, content_h],
            color: cat::pm(30, 30, 46, 250),
        });

        // Gutter background (Catppuccin Mantle)
        rects.push(RectInstance {
            pos: [x_offset, y_offset],
            size: [gutter_w, content_h],
            color: cat::pm(24, 24, 37, 250),
        });

        // Gutter divider
        rects.push(RectInstance {
            pos: [x_offset + gutter_w - 1.0, y_offset],
            size: [1.0, content_h],
            color: cat::pm(49, 50, 68, 180),
        });

        let total = self.total_lines();
        let end_line = self.scroll_offset
            .saturating_add(visible)
            .saturating_add(1)
            .min(total);
        let line_digits = digit_count(total);

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

            // Line number
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

            // File content with syntax highlighting
            let text_x = x_offset + gutter_w + 4.0;

            if let Some(ref syntax) = self.syntax {
                // Per-character color from syntax highlighting
                let line_start_byte = self.rope.line_to_byte(i);
                let line_rope = self.rope.line(i);
                let mut byte_offset = 0;
                let mut col_idx: usize = 0;

                for ch in line_rope.chars() {
                    if ch == '\n' {
                        break;
                    }
                    let char_byte_len = ch.len_utf8();
                    let is_tab = ch == '\t';

                    if is_tab {
                        let tab_spaces = TAB_WIDTH - (col_idx % TAB_WIDTH);
                        col_idx += tab_spaces;
                    } else {
                        // Render if within visible range
                        if col_idx >= self.scroll_col && col_idx < self.scroll_col + max_cols {
                            let display_col = col_idx - self.scroll_col;
                            let color = syntax.color_at_byte(line_start_byte + byte_offset);
                            let ch_str = ch.to_string();
                            super::render_text(
                                font,
                                atlas,
                                &ch_str,
                                text_x + display_col as f32 * font.cell_width,
                                line_y,
                                color,
                                &mut glyphs,
                            );
                        }
                        col_idx += 1;
                    }
                    byte_offset += char_byte_len;
                }
            } else {
                // No syntax — uniform color
                let line_text = self.line_text(i);
                let chars: Vec<char> = line_text.chars().collect();
                let start = self.scroll_col.min(chars.len());
                let end = (start + max_cols).min(chars.len());
                let display: String = chars[start..end].iter().collect();

                super::render_text(
                    font,
                    atlas,
                    &display,
                    text_x,
                    line_y,
                    cat::TEXT,
                    &mut glyphs,
                );
            }

            // Cursor rendering (thin line cursor)
            if i == self.cursor_line && self.cursor_visible {
                let cursor_display_col = self.cursor_col.saturating_sub(self.scroll_col);
                if self.cursor_col >= self.scroll_col && cursor_display_col < max_cols {
                    let cursor_x = x_offset + gutter_w + 4.0
                        + cursor_display_col as f32 * font.cell_width;
                    rects.push(RectInstance {
                        pos: [cursor_x, line_y],
                        size: [2.0, font.cell_height],
                        color: cat::TEXT,
                    });
                }
            }

            // Diagnostic underlines
            for diag in &self.diagnostics {
                if diag.line != i {
                    continue;
                }
                let underline_color = match diag.severity {
                    DiagnosticSeverity::Error => [0.95, 0.30, 0.30, 0.9],   // Red
                    DiagnosticSeverity::Warning => [0.98, 0.89, 0.40, 0.9], // Yellow
                    DiagnosticSeverity::Info => [0.54, 0.71, 0.98, 0.7],    // Blue
                    DiagnosticSeverity::Hint => [0.42, 0.44, 0.53, 0.5],    // Overlay0
                };
                let ds = diag.col_start.max(self.scroll_col);
                let de = diag.col_end.min(self.scroll_col + max_cols);
                if ds < de {
                    let ux = text_x + (ds - self.scroll_col) as f32 * font.cell_width;
                    let uw = (de - ds) as f32 * font.cell_width;
                    let uy = line_y + font.cell_height - 2.0;
                    rects.push(RectInstance {
                        pos: [ux, uy],
                        size: [uw, 2.0],
                        color: underline_color,
                    });
                }
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
