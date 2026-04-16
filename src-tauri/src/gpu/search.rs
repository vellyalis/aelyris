//! Terminal text search (Ctrl+F) with match highlighting.

use crate::gpu::grid::Grid;

/// A search match location.
#[derive(Clone, Debug)]
pub struct SearchMatch {
    pub row: usize,
    pub col_start: usize,
    pub col_end: usize,
}

/// Search state for a terminal.
pub struct SearchState {
    pub query: String,
    pub matches: Vec<SearchMatch>,
    pub current_index: Option<usize>,
    pub case_sensitive: bool,
}

impl SearchState {
    pub fn new() -> Self {
        Self {
            query: String::new(),
            matches: Vec::new(),
            current_index: None,
            case_sensitive: false,
        }
    }

    /// Execute a search across the grid and scrollback.
    pub fn search(&mut self, grid: &Grid, query: &str) {
        self.query = query.to_string();
        self.matches.clear();
        self.current_index = None;

        if query.is_empty() {
            return;
        }

        let query_lower = if self.case_sensitive {
            query.to_string()
        } else {
            query.to_lowercase()
        };

        // Search scrollback
        for (row_idx, row) in grid.scrollback.iter().enumerate() {
            let text: String = row.iter().map(|c| c.c).collect();
            let search_text = if self.case_sensitive { text.clone() } else { text.to_lowercase() };
            for (byte_offset, _) in search_text.match_indices(&query_lower) {
                // Convert byte offset to char offset
                let col_start = search_text[..byte_offset].chars().count();
                let col_end = col_start + query.chars().count();
                self.matches.push(SearchMatch { row: row_idx, col_start, col_end });
            }
        }

        // Search visible grid
        let scrollback_len = grid.scrollback.len();
        for (row_idx, row) in grid.cells.iter().enumerate() {
            let text: String = row.iter().map(|c| c.c).collect();
            let search_text = if self.case_sensitive { text.clone() } else { text.to_lowercase() };
            for (byte_offset, _) in search_text.match_indices(&query_lower) {
                let col_start = search_text[..byte_offset].chars().count();
                let col_end = col_start + query.chars().count();
                self.matches.push(SearchMatch {
                    row: scrollback_len + row_idx,
                    col_start,
                    col_end,
                });
            }
        }

        if !self.matches.is_empty() {
            self.current_index = Some(0);
        }
    }

    /// Move to the next match.
    pub fn next(&mut self) {
        if let Some(idx) = self.current_index {
            if !self.matches.is_empty() {
                self.current_index = Some((idx + 1) % self.matches.len());
            }
        }
    }

    /// Move to the previous match.
    pub fn prev(&mut self) {
        if let Some(idx) = self.current_index {
            if !self.matches.is_empty() {
                self.current_index = Some(if idx == 0 { self.matches.len() - 1 } else { idx - 1 });
            }
        }
    }

    /// Get the current match.
    pub fn current(&self) -> Option<&SearchMatch> {
        self.current_index.and_then(|idx| self.matches.get(idx))
    }

    /// Total number of matches.
    pub fn count(&self) -> usize {
        self.matches.len()
    }
}
