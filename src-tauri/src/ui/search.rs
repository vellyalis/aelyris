//! File content search panel — grep across project files.
//!
//! Rendered as a ContentPane showing search results grouped by file.

use crate::gpu::atlas::GlyphAtlas;
use crate::gpu::font::FontManager;
use crate::gpu::renderer::{GlyphInstance, RectInstance};

use super::cat;

const RESULT_HEIGHT: f32 = 22.0;
const FILE_HEADER_HEIGHT: f32 = 26.0;
const PAD: f32 = 12.0;
const INPUT_HEIGHT: f32 = 36.0;

/// A single search match.
#[derive(Clone)]
pub struct SearchMatch {
    pub line_num: usize,
    pub line_text: String,
    pub col_start: usize,
    pub col_end: usize,
}

/// Results grouped by file.
#[derive(Clone)]
pub struct FileResults {
    pub path: String,
    pub matches: Vec<SearchMatch>,
}

/// Search panel output.
pub struct SearchOutput {
    pub rects: Vec<RectInstance>,
    pub glyphs: Vec<GlyphInstance>,
}

/// Search panel state.
pub struct SearchState {
    pub query: String,
    pub results: Vec<FileResults>,
    pub scroll_offset: f32,
    pub selected_result: Option<(usize, usize)>, // (file_idx, match_idx)
    pub total_matches: usize,
    pub searching: bool,
}

impl SearchState {
    pub fn new() -> Self {
        Self {
            query: String::new(),
            results: Vec::new(),
            scroll_offset: 0.0,
            selected_result: None,
            total_matches: 0,
            searching: false,
        }
    }

    /// Execute a search across files in the given root directory.
    pub fn search(&mut self, root: &std::path::Path) {
        if self.query.is_empty() {
            self.results.clear();
            self.total_matches = 0;
            return;
        }
        self.searching = true;
        let query_lower = self.query.to_lowercase();
        let mut all_results = Vec::new();
        let mut total = 0usize;

        search_dir(root, root, &query_lower, &mut all_results, &mut total, 100);

        self.results = all_results;
        self.total_matches = total;
        self.searching = false;
        self.selected_result = if total > 0 { Some((0, 0)) } else { None };
    }

    /// Get the selected file path and line number for jumping.
    pub fn selected_location(&self) -> Option<(String, usize)> {
        let (fi, mi) = self.selected_result?;
        let file = self.results.get(fi)?;
        let m = file.matches.get(mi)?;
        Some((file.path.clone(), m.line_num))
    }

    pub fn select_next(&mut self) {
        if self.results.is_empty() { return; }
        let (fi, mi) = self.selected_result.unwrap_or((0, 0));
        let file = &self.results[fi];
        if mi + 1 < file.matches.len() {
            self.selected_result = Some((fi, mi + 1));
        } else if fi + 1 < self.results.len() {
            self.selected_result = Some((fi + 1, 0));
        }
    }

    pub fn select_prev(&mut self) {
        if self.results.is_empty() { return; }
        let (fi, mi) = self.selected_result.unwrap_or((0, 0));
        if mi > 0 {
            self.selected_result = Some((fi, mi - 1));
        } else if fi > 0 {
            let prev_len = self.results[fi - 1].matches.len();
            self.selected_result = Some((fi - 1, prev_len.saturating_sub(1)));
        }
    }

    /// Build the search panel rendering.
    pub fn build(
        &self,
        font: &FontManager,
        atlas: &mut GlyphAtlas,
        x: f32,
        y: f32,
        w: f32,
        h: f32,
    ) -> SearchOutput {
        let mut rects = Vec::new();
        let mut glyphs = Vec::new();

        // Background
        rects.push(RectInstance::new([x, y], [w, h], cat::pm(24, 24, 37, 240)));

        // Search header with query
        rects.push(RectInstance::rounded(
            [x + PAD, y + 6.0],
            [w - PAD * 2.0, INPUT_HEIGHT],
            cat::pm(30, 30, 46, 220),
            6.0,
        ));
        let query_y = y + 6.0 + (INPUT_HEIGHT - font.cell_height) / 2.0;
        let query_display = if self.query.is_empty() {
            "Type to search files...".to_string()
        } else {
            format!("\"{}\" — {} matches in {} files",
                self.query, self.total_matches, self.results.len())
        };
        let query_color = if self.query.is_empty() { cat::OVERLAY0 } else { cat::TEXT };
        super::render_text(font, atlas, &query_display, x + PAD + 8.0, query_y, query_color, &mut glyphs);

        // Results
        let content_top = y + INPUT_HEIGHT + 12.0;
        let content_h = h - INPUT_HEIGHT - 12.0;
        let mut cy = content_top - self.scroll_offset;

        for (fi, file) in self.results.iter().enumerate() {
            if cy > y + h { break; }

            // File header
            if cy + FILE_HEADER_HEIGHT > content_top {
                rects.push(RectInstance::new(
                    [x, cy],
                    [w, FILE_HEADER_HEIGHT],
                    cat::pm(30, 30, 46, 150),
                ));
                let file_y = cy + (FILE_HEADER_HEIGHT - font.cell_height) / 2.0;
                let icon = super::icons::file_icon(&file.path, false);
                let icon_str = icon.to_string();
                super::render_text(font, atlas, &icon_str, x + PAD, file_y, cat::BLUE, &mut glyphs);

                let max_chars = ((w - PAD * 2.0 - font.cell_width * 3.0) / font.cell_width) as usize;
                let display_path = if file.path.len() > max_chars {
                    format!("...{}", &file.path[file.path.len().saturating_sub(max_chars - 3)..])
                } else {
                    file.path.clone()
                };
                super::render_text(font, atlas, &display_path, x + PAD + font.cell_width * 2.0, file_y, cat::TEXT, &mut glyphs);

                let count = format!("({})", file.matches.len());
                let count_x = x + w - PAD - count.len() as f32 * font.cell_width;
                super::render_text(font, atlas, &count, count_x, file_y, cat::OVERLAY0, &mut glyphs);
            }
            cy += FILE_HEADER_HEIGHT;

            // Matches under this file
            for (mi, m) in file.matches.iter().enumerate() {
                if cy > y + h { break; }
                if cy + RESULT_HEIGHT > content_top {
                    let is_selected = self.selected_result == Some((fi, mi));
                    if is_selected {
                        rects.push(RectInstance::rounded(
                            [x + 4.0, cy],
                            [w - 8.0, RESULT_HEIGHT],
                            cat::pm(69, 71, 90, 150),
                            4.0,
                        ));
                    }

                    let line_y = cy + (RESULT_HEIGHT - font.cell_height) / 2.0;
                    // Line number
                    let line_num = format!("{:>4}", m.line_num + 1);
                    super::render_text(font, atlas, &line_num, x + PAD, line_y, cat::OVERLAY0, &mut glyphs);

                    // Line text (truncated)
                    let text_x = x + PAD + font.cell_width * 5.0;
                    let max_text = ((w - PAD * 2.0 - font.cell_width * 6.0) / font.cell_width) as usize;
                    let display_text = if m.line_text.len() > max_text {
                        format!("{}...", &m.line_text[..max_text.saturating_sub(3)])
                    } else {
                        m.line_text.clone()
                    };
                    super::render_text(font, atlas, &display_text, text_x, line_y, cat::SUBTEXT1, &mut glyphs);
                }
                cy += RESULT_HEIGHT;
            }
        }

        SearchOutput { rects, glyphs }
    }
}

/// Recursively search files in a directory for a query string (case-insensitive).
fn search_dir(
    dir: &std::path::Path,
    root: &std::path::Path,
    query: &str,
    results: &mut Vec<FileResults>,
    total: &mut usize,
    max_matches: usize,
) {
    if *total >= max_matches { return; }
    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };
    for entry in entries.flatten() {
        if *total >= max_matches { break; }
        let path = entry.path();
        let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
        if name.starts_with('.') || name == "node_modules" || name == "target" || name == "__pycache__" {
            continue;
        }
        if path.is_dir() {
            search_dir(&path, root, query, results, total, max_matches);
        } else {
            // Only search text files (skip binary)
            let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
            if is_binary_ext(ext) { continue; }

            if let Ok(content) = std::fs::read_to_string(&path) {
                let mut file_matches = Vec::new();
                for (line_num, line) in content.lines().enumerate() {
                    if *total >= max_matches { break; }
                    let line_lower = line.to_lowercase();
                    if let Some(col) = line_lower.find(query) {
                        file_matches.push(SearchMatch {
                            line_num,
                            line_text: line.trim().to_string(),
                            col_start: col,
                            col_end: col + query.len(),
                        });
                        *total += 1;
                    }
                }
                if !file_matches.is_empty() {
                    let relative = path.strip_prefix(root).unwrap_or(&path)
                        .to_string_lossy().to_string();
                    results.push(FileResults {
                        path: relative,
                        matches: file_matches,
                    });
                }
            }
        }
    }
}

fn is_binary_ext(ext: &str) -> bool {
    matches!(ext.to_lowercase().as_str(),
        "png" | "jpg" | "jpeg" | "gif" | "bmp" | "ico" | "webp" |
        "exe" | "dll" | "so" | "dylib" | "o" | "obj" |
        "zip" | "tar" | "gz" | "7z" | "rar" |
        "woff" | "woff2" | "ttf" | "otf" | "eot" |
        "pdf" | "doc" | "docx" | "xls" | "xlsx" |
        "mp3" | "mp4" | "avi" | "mov" | "wav" |
        "db" | "sqlite" | "sqlite3"
    )
}
