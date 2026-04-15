//! Terminal grid state machine.
//!
//! Stores the 2D cell grid, cursor position, scrollback buffer,
//! and terminal modes. Fed by the VTE parser with parsed ANSI sequences.

use std::collections::VecDeque;

use vte::{Params, Perform};

/// ANSI color representation.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Color {
    /// Default foreground/background (theme-dependent).
    Default,
    /// Standard 16 ANSI colors (0-15).
    Indexed(u8),
    /// 24-bit true color.
    Rgb(u8, u8, u8),
}

/// Per-cell style flags.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash)]
pub struct CellFlags {
    pub bold: bool,
    pub italic: bool,
    pub underline: bool,
    pub strikethrough: bool,
    pub inverse: bool,
    pub hidden: bool,
    pub dim: bool,
}

/// A single cell in the terminal grid.
#[derive(Clone, Debug)]
pub struct Cell {
    pub c: char,
    pub fg: Color,
    pub bg: Color,
    pub flags: CellFlags,
    /// Display width: 1 for half-width, 2 for full-width (CJK).
    pub width: u8,
}

impl Default for Cell {
    fn default() -> Self {
        Self {
            c: ' ',
            fg: Color::Default,
            bg: Color::Default,
            flags: CellFlags::default(),
            width: 1,
        }
    }
}

/// Mouse tracking mode.
#[derive(Clone, Debug, Default, PartialEq)]
pub enum MouseMode {
    #[default]
    None,
    /// Normal tracking (1000) — report button press/release.
    Press,
    /// Button-event tracking (1002) — report press/release/drag with button.
    ButtonMotion,
    /// Any-event tracking (1003) — report all motion.
    AnyMotion,
}

/// Terminal mode flags (DECCKM, DECAWM, etc.).
#[derive(Clone, Debug, Default)]
pub struct TerminalMode {
    /// Application cursor keys (DECCKM).
    pub app_cursor: bool,
    /// Auto-wrap mode (DECAWM).
    pub auto_wrap: bool,
    /// Origin mode (DECOM).
    pub origin: bool,
    /// Bracketed paste mode.
    pub bracketed_paste: bool,
    /// Alternate screen buffer active.
    pub alt_screen: bool,
    /// Mouse tracking mode.
    pub mouse_mode: MouseMode,
    /// SGR extended mouse encoding (1006).
    pub sgr_mouse: bool,
    /// Focus event reporting (1004).
    pub focus_events: bool,
}

/// Cursor state.
#[derive(Clone, Debug)]
pub struct CursorState {
    pub row: u16,
    pub col: u16,
    pub visible: bool,
    pub fg: Color,
    pub bg: Color,
    pub flags: CellFlags,
}

impl Default for CursorState {
    fn default() -> Self {
        Self {
            row: 0,
            col: 0,
            visible: true,
            fg: Color::Default,
            bg: Color::Default,
            flags: CellFlags::default(),
        }
    }
}

/// Text selection range (start and end positions in grid coordinates).
#[derive(Clone, Debug, Default)]
pub struct Selection {
    /// Selection anchor (where click started). None = no selection.
    pub anchor: Option<(u16, u16)>,
    /// Selection end (current mouse position during drag).
    pub end: Option<(u16, u16)>,
}

impl Selection {
    /// Returns normalized (start, end) with start <= end in reading order.
    pub fn normalized(&self) -> Option<((u16, u16), (u16, u16))> {
        let (a, b) = (self.anchor?, self.end?);
        if a.0 < b.0 || (a.0 == b.0 && a.1 <= b.1) {
            Some((a, b))
        } else {
            Some((b, a))
        }
    }

    /// Check if a cell (row, col) is within the selection.
    pub fn contains(&self, row: u16, col: u16) -> bool {
        let Some(((sr, sc), (er, ec))) = self.normalized() else { return false };
        if row < sr || row > er { return false; }
        if sr == er { return col >= sc && col <= ec; }
        if row == sr { return col >= sc; }
        if row == er { return col <= ec; }
        true
    }

    pub fn is_active(&self) -> bool {
        self.anchor.is_some() && self.end.is_some()
    }

    pub fn clear(&mut self) {
        self.anchor = None;
        self.end = None;
    }
}

/// The terminal grid: cells + scrollback + cursor + modes.
pub struct Grid {
    pub cols: u16,
    pub rows: u16,
    /// Primary screen buffer: cells[row][col].
    pub cells: Vec<Vec<Cell>>,
    /// Alternate screen buffer (used by vim, less, etc.).
    alt_cells: Vec<Vec<Cell>>,
    /// Scrollback buffer (ring buffer).
    pub scrollback: VecDeque<Vec<Cell>>,
    pub max_scrollback: usize,
    pub cursor: CursorState,
    saved_cursor: Option<CursorState>,
    /// Scroll region (top, bottom) — inclusive, 0-indexed.
    scroll_top: u16,
    scroll_bottom: u16,
    pub mode: TerminalMode,
    /// Bitset of rows that changed since last render.
    pub dirty_rows: Vec<bool>,
    /// True if any row is dirty and a frame should be rendered.
    pub needs_redraw: bool,
    /// Viewport offset into scrollback (0 = live view, >0 = scrolled back).
    pub viewport_offset: usize,
    /// Current text selection.
    pub selection: Selection,
    /// Window title set by OSC 0/2.
    pub title: Option<String>,
    /// Active search query for highlighting matches.
    pub search_query: Option<String>,
}

impl Grid {
    pub fn new(cols: u16, rows: u16, max_scrollback: usize) -> Self {
        let cells = Self::make_blank(cols, rows);
        let alt_cells = Self::make_blank(cols, rows);
        Self {
            cols,
            rows,
            cells,
            alt_cells,
            scrollback: VecDeque::new(),
            max_scrollback,
            cursor: CursorState::default(),
            saved_cursor: None,
            scroll_top: 0,
            scroll_bottom: rows.saturating_sub(1),
            mode: TerminalMode { auto_wrap: true, ..Default::default() },
            dirty_rows: vec![true; rows as usize],
            needs_redraw: true,
            viewport_offset: 0,
            selection: Selection::default(),
            title: None,
            search_query: None,
        }
    }

    fn make_blank(cols: u16, rows: u16) -> Vec<Vec<Cell>> {
        (0..rows)
            .map(|_| (0..cols).map(|_| Cell::default()).collect())
            .collect()
    }

    /// Mark all rows dirty (e.g. after resize or screen clear).
    pub fn mark_all_dirty(&mut self) {
        for d in &mut self.dirty_rows {
            *d = true;
        }
        self.needs_redraw = true;
    }

    /// Mark a specific row dirty.
    fn mark_dirty(&mut self, row: u16) {
        if (row as usize) < self.dirty_rows.len() {
            self.dirty_rows[row as usize] = true;
            self.needs_redraw = true;
        }
    }

    /// Clear all dirty flags after rendering a frame.
    pub fn clear_dirty(&mut self) {
        for d in &mut self.dirty_rows {
            *d = false;
        }
        self.needs_redraw = false;
    }

    /// Scroll viewport into scrollback history. Returns true if offset changed.
    pub fn scroll_viewport(&mut self, delta: i32) -> bool {
        let max = self.scrollback.len();
        let old = self.viewport_offset;
        self.viewport_offset = if delta < 0 {
            self.viewport_offset.saturating_add((-delta) as usize).min(max)
        } else {
            self.viewport_offset.saturating_sub(delta as usize)
        };
        if self.viewport_offset != old {
            self.needs_redraw = true;
            true
        } else {
            false
        }
    }

    /// Reset viewport to live view (latest output).
    pub fn reset_viewport(&mut self) {
        if self.viewport_offset > 0 {
            self.viewport_offset = 0;
            self.needs_redraw = true;
        }
    }

    /// Get a visible row, accounting for viewport_offset.
    /// When offset > 0, top rows come from scrollback.
    pub fn visible_row(&self, screen_row: usize) -> &[Cell] {
        if self.viewport_offset == 0 || screen_row >= self.rows as usize {
            return &self.cells[screen_row.min(self.rows as usize - 1)];
        }
        let sb_len = self.scrollback.len();
        let sb_start = sb_len.saturating_sub(self.viewport_offset);
        let sb_idx = sb_start + screen_row;
        if sb_idx < sb_len {
            &self.scrollback[sb_idx]
        } else {
            let cell_row = sb_idx - sb_len;
            &self.cells[cell_row.min(self.rows as usize - 1)]
        }
    }

    /// Extract selected text as a string.
    pub fn selected_text(&self) -> String {
        let Some(((sr, sc), (er, ec))) = self.selection.normalized() else {
            return String::new();
        };
        let mut result = String::new();
        for row in sr..=er {
            let cols_start = if row == sr { sc } else { 0 };
            let cols_end = if row == er { ec } else { self.cols - 1 };
            let cells = if (row as usize) < self.rows as usize {
                &self.cells[row as usize]
            } else {
                continue;
            };
            for col in cols_start..=cols_end {
                if (col as usize) < cells.len() {
                    let c = cells[col as usize].c;
                    result.push(if c == '\0' { ' ' } else { c });
                }
            }
            // Trim trailing spaces on each line
            let trimmed = result.trim_end_matches(' ');
            result.truncate(trimmed.len());
            if row < er { result.push('\n'); }
        }
        result
    }

    /// Resize the grid, reflowing content where possible.
    pub fn resize(&mut self, new_cols: u16, new_rows: u16) {
        let mut new_cells = Self::make_blank(new_cols, new_rows);
        let copy_rows = std::cmp::min(self.rows, new_rows) as usize;
        let copy_cols = std::cmp::min(self.cols, new_cols) as usize;
        for r in 0..copy_rows {
            for c in 0..copy_cols {
                new_cells[r][c] = self.cells[r][c].clone();
            }
        }
        self.cells = new_cells;
        self.alt_cells = Self::make_blank(new_cols, new_rows);
        self.cols = new_cols;
        self.rows = new_rows;
        self.scroll_top = 0;
        self.scroll_bottom = new_rows.saturating_sub(1);
        self.cursor.row = std::cmp::min(self.cursor.row, new_rows.saturating_sub(1));
        self.cursor.col = std::cmp::min(self.cursor.col, new_cols.saturating_sub(1));
        self.dirty_rows = vec![true; new_rows as usize];
        self.needs_redraw = true;
    }

    // --- Cell operations ---

    /// Write a character at the cursor position and advance.
    pub fn put_char(&mut self, c: char) {
        let w = unicode_width::UnicodeWidthChar::width(c).unwrap_or(1) as u8;

        // Auto-wrap: if at end of line, move to next line
        if self.cursor.col + (w as u16) > self.cols && self.mode.auto_wrap {
            self.carriage_return();
            self.line_feed();
        }

        let row = self.cursor.row as usize;
        let col = self.cursor.col as usize;
        if row < self.cells.len() && col < self.cells[row].len() {
            self.cells[row][col] = Cell {
                c,
                fg: self.cursor.fg,
                bg: self.cursor.bg,
                flags: self.cursor.flags,
                width: w,
            };
            // For full-width chars, blank the next cell
            if w == 2 && col + 1 < self.cells[row].len() {
                self.cells[row][col + 1] = Cell::default();
            }
            self.mark_dirty(self.cursor.row);
        }
        self.cursor.col = std::cmp::min(self.cursor.col + w as u16, self.cols.saturating_sub(1));
    }

    pub fn line_feed(&mut self) {
        if self.cursor.row == self.scroll_bottom {
            self.scroll_up(1);
        } else if self.cursor.row < self.rows - 1 {
            self.cursor.row += 1;
        }
    }

    pub fn carriage_return(&mut self) {
        self.cursor.col = 0;
    }

    pub fn backspace(&mut self) {
        if self.cursor.col > 0 {
            self.cursor.col -= 1;
        }
    }

    pub fn tab(&mut self) {
        // Advance to next tab stop (every 8 columns)
        let next = (self.cursor.col / 8 + 1) * 8;
        self.cursor.col = std::cmp::min(next, self.cols.saturating_sub(1));
    }

    /// Scroll the scroll region up by n lines.
    fn scroll_up(&mut self, n: u16) {
        let top = self.scroll_top as usize;
        let bottom = self.scroll_bottom as usize;
        for _ in 0..n {
            if top < self.cells.len() {
                let row = self.cells.remove(top);
                // Push to scrollback if scrolling the whole screen
                if self.scroll_top == 0 {
                    self.scrollback.push_back(row);
                    if self.scrollback.len() > self.max_scrollback {
                        self.scrollback.pop_front();
                    }
                }
                // Insert blank row at bottom of scroll region
                let blank = (0..self.cols).map(|_| Cell::default()).collect();
                let insert_at = std::cmp::min(bottom, self.cells.len());
                self.cells.insert(insert_at, blank);
            }
        }
        // Mark all rows in scroll region dirty
        for r in top..=bottom {
            if r < self.dirty_rows.len() {
                self.dirty_rows[r] = true;
            }
        }
        self.needs_redraw = true;
    }

    /// Scroll the scroll region down by n lines.
    fn scroll_down(&mut self, n: u16) {
        let top = self.scroll_top as usize;
        let bottom = self.scroll_bottom as usize;
        for _ in 0..n {
            if bottom < self.cells.len() {
                self.cells.remove(bottom);
                let blank = (0..self.cols).map(|_| Cell::default()).collect();
                self.cells.insert(top, blank);
            }
        }
        for r in top..=bottom {
            if r < self.dirty_rows.len() {
                self.dirty_rows[r] = true;
            }
        }
        self.needs_redraw = true;
    }

    // --- CSI dispatch helpers ---

    /// CUP — Cursor Position (CSI H).
    pub fn cursor_position(&mut self, params: &Params) {
        let mut iter = params.iter();
        let row = iter.next().and_then(|p| p.first().copied()).unwrap_or(1);
        let col = iter.next().and_then(|p| p.first().copied()).unwrap_or(1);
        self.cursor.row = (row as u16).saturating_sub(1).min(self.rows.saturating_sub(1));
        self.cursor.col = (col as u16).saturating_sub(1).min(self.cols.saturating_sub(1));
    }

    /// CUU — Cursor Up (CSI A).
    pub fn cursor_up(&mut self, params: &Params) {
        let n = first_param(params, 1) as u16;
        self.cursor.row = self.cursor.row.saturating_sub(n).max(self.scroll_top);
    }

    /// CUD — Cursor Down (CSI B).
    pub fn cursor_down(&mut self, params: &Params) {
        let n = first_param(params, 1) as u16;
        self.cursor.row = (self.cursor.row + n).min(self.scroll_bottom);
    }

    /// CUF — Cursor Forward (CSI C).
    pub fn cursor_forward(&mut self, params: &Params) {
        let n = first_param(params, 1) as u16;
        self.cursor.col = (self.cursor.col + n).min(self.cols.saturating_sub(1));
    }

    /// CUB — Cursor Backward (CSI D).
    pub fn cursor_backward(&mut self, params: &Params) {
        let n = first_param(params, 1) as u16;
        self.cursor.col = self.cursor.col.saturating_sub(n);
    }

    /// ED — Erase in Display (CSI J).
    pub fn erase_display(&mut self, params: &Params) {
        let mode = first_param(params, 0);
        match mode {
            0 => {
                // Clear from cursor to end of screen
                self.erase_line_from_cursor();
                for r in (self.cursor.row + 1) as usize..self.rows as usize {
                    self.clear_row(r);
                }
            }
            1 => {
                // Clear from start of screen to cursor
                for r in 0..self.cursor.row as usize {
                    self.clear_row(r);
                }
                self.erase_line_to_cursor();
            }
            2 | 3 => {
                // Clear entire screen
                for r in 0..self.rows as usize {
                    self.clear_row(r);
                }
                if mode == 3 {
                    self.scrollback.clear();
                }
            }
            _ => {}
        }
    }

    /// EL — Erase in Line (CSI K).
    pub fn erase_line(&mut self, params: &Params) {
        let mode = first_param(params, 0);
        match mode {
            0 => self.erase_line_from_cursor(),
            1 => self.erase_line_to_cursor(),
            2 => self.clear_row(self.cursor.row as usize),
            _ => {}
        }
    }

    fn erase_line_from_cursor(&mut self) {
        let row = self.cursor.row as usize;
        if row < self.cells.len() {
            for c in self.cursor.col as usize..self.cols as usize {
                if c < self.cells[row].len() {
                    self.cells[row][c] = Cell::default();
                }
            }
            self.mark_dirty(self.cursor.row);
        }
    }

    fn erase_line_to_cursor(&mut self) {
        let row = self.cursor.row as usize;
        if row < self.cells.len() {
            for c in 0..=self.cursor.col as usize {
                if c < self.cells[row].len() {
                    self.cells[row][c] = Cell::default();
                }
            }
            self.mark_dirty(self.cursor.row);
        }
    }

    fn clear_row(&mut self, row: usize) {
        if row < self.cells.len() {
            for cell in &mut self.cells[row] {
                *cell = Cell::default();
            }
            if row < self.dirty_rows.len() {
                self.dirty_rows[row] = true;
            }
            self.needs_redraw = true;
        }
    }

    /// SGR — Select Graphic Rendition (CSI m).
    pub fn sgr(&mut self, params: &Params) {
        let mut iter = params.iter();
        // If no params, treat as reset (SGR 0)
        let mut got_param = false;

        while let Some(param) = iter.next() {
            got_param = true;
            let p = param.first().copied().unwrap_or(0);
            match p {
                0 => {
                    self.cursor.fg = Color::Default;
                    self.cursor.bg = Color::Default;
                    self.cursor.flags = CellFlags::default();
                }
                1 => self.cursor.flags.bold = true,
                2 => self.cursor.flags.dim = true,
                3 => self.cursor.flags.italic = true,
                4 => self.cursor.flags.underline = true,
                7 => self.cursor.flags.inverse = true,
                8 => self.cursor.flags.hidden = true,
                9 => self.cursor.flags.strikethrough = true,
                22 => { self.cursor.flags.bold = false; self.cursor.flags.dim = false; }
                23 => self.cursor.flags.italic = false,
                24 => self.cursor.flags.underline = false,
                27 => self.cursor.flags.inverse = false,
                28 => self.cursor.flags.hidden = false,
                29 => self.cursor.flags.strikethrough = false,
                // Standard foreground colors (30-37)
                30..=37 => self.cursor.fg = Color::Indexed((p - 30) as u8),
                // Extended foreground (38;5;n or 38;2;r;g;b)
                38 => {
                    if let Some(sub) = iter.next() {
                        match sub.first().copied().unwrap_or(0) {
                            5 => {
                                if let Some(idx) = iter.next() {
                                    self.cursor.fg = Color::Indexed(idx.first().copied().unwrap_or(0) as u8);
                                }
                            }
                            2 => {
                                let r = iter.next().and_then(|p| p.first().copied()).unwrap_or(0) as u8;
                                let g = iter.next().and_then(|p| p.first().copied()).unwrap_or(0) as u8;
                                let b = iter.next().and_then(|p| p.first().copied()).unwrap_or(0) as u8;
                                self.cursor.fg = Color::Rgb(r, g, b);
                            }
                            _ => {}
                        }
                    }
                }
                39 => self.cursor.fg = Color::Default,
                // Standard background colors (40-47)
                40..=47 => self.cursor.bg = Color::Indexed((p - 40) as u8),
                // Extended background (48;5;n or 48;2;r;g;b)
                48 => {
                    if let Some(sub) = iter.next() {
                        match sub.first().copied().unwrap_or(0) {
                            5 => {
                                if let Some(idx) = iter.next() {
                                    self.cursor.bg = Color::Indexed(idx.first().copied().unwrap_or(0) as u8);
                                }
                            }
                            2 => {
                                let r = iter.next().and_then(|p| p.first().copied()).unwrap_or(0) as u8;
                                let g = iter.next().and_then(|p| p.first().copied()).unwrap_or(0) as u8;
                                let b = iter.next().and_then(|p| p.first().copied()).unwrap_or(0) as u8;
                                self.cursor.bg = Color::Rgb(r, g, b);
                            }
                            _ => {}
                        }
                    }
                }
                49 => self.cursor.bg = Color::Default,
                // Bright foreground (90-97)
                90..=97 => self.cursor.fg = Color::Indexed((p - 90 + 8) as u8),
                // Bright background (100-107)
                100..=107 => self.cursor.bg = Color::Indexed((p - 100 + 8) as u8),
                _ => {}
            }
        }

        if !got_param {
            // No params = SGR 0 (reset)
            self.cursor.fg = Color::Default;
            self.cursor.bg = Color::Default;
            self.cursor.flags = CellFlags::default();
        }
    }

    /// DECSTBM — Set Scrolling Region (CSI r).
    pub fn set_scroll_region(&mut self, params: &Params) {
        let mut iter = params.iter();
        let top = iter.next().and_then(|p| p.first().copied()).unwrap_or(1);
        let bottom = iter.next().and_then(|p| p.first().copied()).unwrap_or(self.rows as u16);
        self.scroll_top = (top as u16).saturating_sub(1).min(self.rows.saturating_sub(1));
        self.scroll_bottom = (bottom as u16).saturating_sub(1).min(self.rows.saturating_sub(1));
        // Move cursor to home position
        self.cursor.row = if self.mode.origin { self.scroll_top } else { 0 };
        self.cursor.col = 0;
    }

    /// IL — Insert Lines (CSI L).
    pub fn insert_lines(&mut self, params: &Params) {
        let n = first_param(params, 1) as u16;
        if self.cursor.row >= self.scroll_top && self.cursor.row <= self.scroll_bottom {
            let saved_top = self.scroll_top;
            self.scroll_top = self.cursor.row;
            self.scroll_down(n);
            self.scroll_top = saved_top;
        }
    }

    /// DL — Delete Lines (CSI M).
    pub fn delete_lines(&mut self, params: &Params) {
        let n = first_param(params, 1) as u16;
        if self.cursor.row >= self.scroll_top && self.cursor.row <= self.scroll_bottom {
            let saved_top = self.scroll_top;
            self.scroll_top = self.cursor.row;
            self.scroll_up(n);
            self.scroll_top = saved_top;
        }
    }

    /// ICH — Insert Characters (CSI @).
    pub fn insert_chars(&mut self, params: &Params) {
        let n = first_param(params, 1) as usize;
        let row = self.cursor.row as usize;
        let col = self.cursor.col as usize;
        if row < self.cells.len() {
            for _ in 0..n {
                if self.cells[row].len() > col {
                    self.cells[row].pop();
                    self.cells[row].insert(col, Cell::default());
                }
            }
            self.mark_dirty(self.cursor.row);
        }
    }

    /// DCH — Delete Characters (CSI P).
    pub fn delete_chars(&mut self, params: &Params) {
        let n = first_param(params, 1) as usize;
        let row = self.cursor.row as usize;
        let col = self.cursor.col as usize;
        if row < self.cells.len() {
            for _ in 0..n {
                if col < self.cells[row].len() {
                    self.cells[row].remove(col);
                    self.cells[row].push(Cell::default());
                }
            }
            self.mark_dirty(self.cursor.row);
        }
    }

    /// ECH — Erase Characters (CSI X).
    pub fn erase_chars(&mut self, params: &Params) {
        let n = first_param(params, 1) as usize;
        let row = self.cursor.row as usize;
        let col = self.cursor.col as usize;
        if row < self.cells.len() {
            for i in 0..n {
                let c = col + i;
                if c < self.cells[row].len() {
                    self.cells[row][c] = Cell::default();
                }
            }
            self.mark_dirty(self.cursor.row);
        }
    }

    /// DECSC — Save Cursor.
    pub fn save_cursor(&mut self) {
        self.saved_cursor = Some(self.cursor.clone());
    }

    /// DECRC — Restore Cursor.
    pub fn restore_cursor(&mut self) {
        if let Some(saved) = self.saved_cursor.take() {
            self.cursor = saved;
        }
    }

    /// Switch to alternate screen buffer.
    pub fn enter_alt_screen(&mut self) {
        if !self.mode.alt_screen {
            std::mem::swap(&mut self.cells, &mut self.alt_cells);
            self.mode.alt_screen = true;
            self.mark_all_dirty();
        }
    }

    /// Switch back to primary screen buffer.
    pub fn exit_alt_screen(&mut self) {
        if self.mode.alt_screen {
            std::mem::swap(&mut self.cells, &mut self.alt_cells);
            self.mode.alt_screen = false;
            self.mark_all_dirty();
        }
    }
}

/// VTE Perform implementation — bridges the VTE parser to the Grid.
pub struct GridPerformer<'a> {
    pub grid: &'a mut Grid,
}

impl<'a> Perform for GridPerformer<'a> {
    fn print(&mut self, c: char) {
        self.grid.put_char(c);
    }

    fn execute(&mut self, byte: u8) {
        match byte {
            0x0a | 0x0b | 0x0c => self.grid.line_feed(),       // LF, VT, FF
            0x0d => self.grid.carriage_return(),                 // CR
            0x09 => self.grid.tab(),                             // HT
            0x08 => self.grid.backspace(),                       // BS
            0x07 => {}                                           // BEL (ignore)
            _ => {}
        }
    }

    fn csi_dispatch(&mut self, params: &Params, intermediates: &[u8], _ignore: bool, action: char) {
        let is_private = intermediates.first() == Some(&b'?');

        match (action, is_private) {
            ('A', false) => self.grid.cursor_up(params),
            ('B', false) => self.grid.cursor_down(params),
            ('C', false) => self.grid.cursor_forward(params),
            ('D', false) => self.grid.cursor_backward(params),
            ('H', false) | ('f', false) => self.grid.cursor_position(params),
            ('J', false) => self.grid.erase_display(params),
            ('K', false) => self.grid.erase_line(params),
            ('L', false) => self.grid.insert_lines(params),
            ('M', false) => self.grid.delete_lines(params),
            ('P', false) => self.grid.delete_chars(params),
            ('X', false) => self.grid.erase_chars(params),
            ('@', false) => self.grid.insert_chars(params),
            ('m', false) => self.grid.sgr(params),
            ('r', false) => self.grid.set_scroll_region(params),
            ('d', false) => {
                // VPA — Line Position Absolute
                let row = first_param(params, 1) as u16;
                self.grid.cursor.row = row.saturating_sub(1).min(self.grid.rows.saturating_sub(1));
            }
            ('G', false) | ('`', false) => {
                // CHA — Cursor Character Absolute
                let col = first_param(params, 1) as u16;
                self.grid.cursor.col = col.saturating_sub(1).min(self.grid.cols.saturating_sub(1));
            }
            ('S', false) => {
                // SU — Scroll Up
                let n = first_param(params, 1) as u16;
                self.grid.scroll_up(n);
            }
            ('T', false) => {
                // SD — Scroll Down
                let n = first_param(params, 1) as u16;
                self.grid.scroll_down(n);
            }
            // DECSET / DECRST (CSI ? ... h/l)
            ('h', true) => self.handle_decset(params, true),
            ('l', true) => self.handle_decset(params, false),
            // SGR mouse, focus events, etc. — TODO in Phase 6
            _ => {
                log::trace!("Unhandled CSI: {:?} {} (private={})", params, action, is_private);
            }
        }
    }

    fn esc_dispatch(&mut self, intermediates: &[u8], _ignore: bool, byte: u8) {
        match (byte, intermediates) {
            (b'7', []) => self.grid.save_cursor(),      // DECSC
            (b'8', []) => self.grid.restore_cursor(),    // DECRC
            (b'D', []) => self.grid.line_feed(),         // IND
            (b'M', []) => {                              // RI — Reverse Index
                if self.grid.cursor.row == self.grid.scroll_top {
                    self.grid.scroll_down(1);
                } else if self.grid.cursor.row > 0 {
                    self.grid.cursor.row -= 1;
                }
            }
            (b'E', []) => {                              // NEL — Next Line
                self.grid.carriage_return();
                self.grid.line_feed();
            }
            (b'c', []) => {                              // RIS — Full Reset
                *self.grid = Grid::new(self.grid.cols, self.grid.rows, self.grid.max_scrollback);
            }
            _ => {
                log::trace!("Unhandled ESC: {} intermediates={:?}", byte as char, intermediates);
            }
        }
    }

    fn osc_dispatch(&mut self, params: &[&[u8]], _bell_terminated: bool) {
        // OSC 0/2: Set window title — emit event to React UI
        // OSC 8: Hyperlinks — handled in Phase 6
        if let Some(cmd) = params.first() {
            match *cmd {
                b"0" | b"2" => {
                    if let Some(title_bytes) = params.get(1) {
                        if let Ok(title) = std::str::from_utf8(title_bytes) {
                            self.grid.title = Some(title.to_string());
                            self.grid.needs_redraw = true;
                        }
                    }
                }
                _ => {}
            }
        }
    }

    fn hook(&mut self, _params: &Params, _intermediates: &[u8], _ignore: bool, _action: char) {}
    fn put(&mut self, _byte: u8) {}
    fn unhook(&mut self) {}
}

impl<'a> GridPerformer<'a> {
    fn handle_decset(&mut self, params: &Params, enable: bool) {
        for param in params.iter() {
            match param.first().copied().unwrap_or(0) {
                1 => self.grid.mode.app_cursor = enable,       // DECCKM
                7 => self.grid.mode.auto_wrap = enable,         // DECAWM
                6 => self.grid.mode.origin = enable,            // DECOM
                25 => self.grid.cursor.visible = enable,        // DECTCEM
                1049 => {                                        // Alt screen + save cursor
                    if enable {
                        self.grid.save_cursor();
                        self.grid.enter_alt_screen();
                    } else {
                        self.grid.exit_alt_screen();
                        self.grid.restore_cursor();
                    }
                }
                47 | 1047 => {                                   // Alt screen (no save cursor)
                    if enable {
                        self.grid.enter_alt_screen();
                    } else {
                        self.grid.exit_alt_screen();
                    }
                }
                2004 => self.grid.mode.bracketed_paste = enable, // Bracketed paste
                // Mouse tracking modes
                1000 => {
                    self.grid.mode.mouse_mode = if enable { MouseMode::Press } else { MouseMode::None };
                }
                1002 => {
                    self.grid.mode.mouse_mode = if enable { MouseMode::ButtonMotion } else { MouseMode::None };
                }
                1003 => {
                    self.grid.mode.mouse_mode = if enable { MouseMode::AnyMotion } else { MouseMode::None };
                }
                1006 => self.grid.mode.sgr_mouse = enable, // SGR extended encoding
                1004 => self.grid.mode.focus_events = enable, // Focus events
                _ => {}
            }
        }
    }
}

/// Extract the first parameter from a CSI Params, defaulting to `default`.
fn first_param(params: &Params, default: u16) -> u16 {
    params
        .iter()
        .next()
        .and_then(|p| p.first().copied())
        .map(|v| if v == 0 { default } else { v })
        .unwrap_or(default)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_put_char_ascii() {
        let mut grid = Grid::new(80, 24, 100);
        grid.put_char('A');
        assert_eq!(grid.cells[0][0].c, 'A');
        assert_eq!(grid.cursor.col, 1);
    }

    #[test]
    fn test_put_char_cjk() {
        let mut grid = Grid::new(80, 24, 100);
        grid.put_char('日');
        assert_eq!(grid.cells[0][0].c, '日');
        assert_eq!(grid.cells[0][0].width, 2);
        assert_eq!(grid.cursor.col, 2);
    }

    #[test]
    fn test_line_feed_scroll() {
        let mut grid = Grid::new(80, 3, 100);
        grid.cursor.row = 2; // bottom row
        grid.put_char('X');
        grid.line_feed();
        // Should have scrolled — row 0 pushed to scrollback
        assert_eq!(grid.scrollback.len(), 1);
    }

    #[test]
    fn test_erase_display() {
        let mut grid = Grid::new(80, 24, 100);
        grid.put_char('A');
        grid.put_char('B');
        let mut params_data = [0u16; 1];
        // ED 2 (clear entire screen) — use VTE parser to test
        let mut parser = vte::Parser::new();
        let mut performer = GridPerformer { grid: &mut grid };
        for byte in b"\x1b[2J" {
            parser.advance(&mut performer, *byte);
        }
        assert_eq!(grid.cells[0][0].c, ' ');
        assert_eq!(grid.cells[0][1].c, ' ');
    }

    #[test]
    fn test_sgr_colors() {
        let mut grid = Grid::new(80, 24, 100);
        let mut parser = vte::Parser::new();
        let mut performer = GridPerformer { grid: &mut grid };
        // Set red foreground: ESC[31m
        for byte in b"\x1b[31m" {
            parser.advance(&mut performer, *byte);
        }
        assert_eq!(grid.cursor.fg, Color::Indexed(1));
    }

    #[test]
    fn test_sgr_truecolor() {
        let mut grid = Grid::new(80, 24, 100);
        let mut parser = vte::Parser::new();
        let mut performer = GridPerformer { grid: &mut grid };
        // Set RGB foreground: ESC[38;2;255;128;0m
        for byte in b"\x1b[38;2;255;128;0m" {
            parser.advance(&mut performer, *byte);
        }
        assert_eq!(grid.cursor.fg, Color::Rgb(255, 128, 0));
    }

    #[test]
    fn test_cursor_movement() {
        let mut grid = Grid::new(80, 24, 100);
        let mut parser = vte::Parser::new();
        let mut performer = GridPerformer { grid: &mut grid };
        // Move cursor to row 5, col 10: ESC[5;10H
        for byte in b"\x1b[5;10H" {
            parser.advance(&mut performer, *byte);
        }
        assert_eq!(grid.cursor.row, 4); // 0-indexed
        assert_eq!(grid.cursor.col, 9);
    }

    #[test]
    fn test_alt_screen() {
        let mut grid = Grid::new(80, 24, 100);
        grid.put_char('A');
        let mut parser = vte::Parser::new();
        let mut performer = GridPerformer { grid: &mut grid };
        // Enter alt screen: ESC[?1049h
        for byte in b"\x1b[?1049h" {
            parser.advance(&mut performer, *byte);
        }
        assert!(grid.mode.alt_screen);
        assert_eq!(grid.cells[0][0].c, ' '); // alt screen is blank

        // Exit alt screen: ESC[?1049l
        let mut performer = GridPerformer { grid: &mut grid };
        for byte in b"\x1b[?1049l" {
            parser.advance(&mut performer, *byte);
        }
        assert!(!grid.mode.alt_screen);
        assert_eq!(grid.cells[0][0].c, 'A'); // original content restored
    }

    #[test]
    fn test_selection_contains() {
        let sel = Selection {
            anchor: Some((1, 5)),
            end: Some((3, 10)),
        };
        assert!(!sel.contains(0, 5));  // above selection
        assert!(sel.contains(1, 5));   // start
        assert!(sel.contains(1, 79));  // first row, right edge
        assert!(sel.contains(2, 0));   // middle row
        assert!(sel.contains(3, 0));   // last row, left edge
        assert!(sel.contains(3, 10));  // end
        assert!(!sel.contains(3, 11)); // past end
        assert!(!sel.contains(4, 0));  // below selection
    }

    #[test]
    fn test_selection_single_line() {
        let sel = Selection {
            anchor: Some((2, 3)),
            end: Some((2, 8)),
        };
        assert!(!sel.contains(2, 2));
        assert!(sel.contains(2, 3));
        assert!(sel.contains(2, 5));
        assert!(sel.contains(2, 8));
        assert!(!sel.contains(2, 9));
    }

    #[test]
    fn test_selection_reversed() {
        // Drag upward: end is before anchor
        let sel = Selection {
            anchor: Some((5, 10)),
            end: Some((3, 2)),
        };
        let ((sr, sc), (er, ec)) = sel.normalized().unwrap();
        assert_eq!((sr, sc), (3, 2));
        assert_eq!((er, ec), (5, 10));
        assert!(sel.contains(4, 0));
    }

    #[test]
    fn test_selected_text() {
        let mut grid = Grid::new(10, 5, 100);
        for (i, c) in "Hello".chars().enumerate() {
            grid.cells[0][i].c = c;
        }
        for (i, c) in "World".chars().enumerate() {
            grid.cells[1][i].c = c;
        }
        grid.selection.anchor = Some((0, 0));
        grid.selection.end = Some((1, 4));
        let text = grid.selected_text();
        assert_eq!(text, "Hello\nWorld");
    }

    #[test]
    fn test_scroll_viewport() {
        let mut grid = Grid::new(80, 3, 100);
        // Push some lines into scrollback
        for _ in 0..5 {
            grid.cursor.row = 2;
            grid.put_char('X');
            grid.line_feed();
        }
        assert!(grid.scrollback.len() >= 3);

        // Scroll up into history
        assert!(grid.scroll_viewport(-3));
        assert_eq!(grid.viewport_offset, 3);

        // Scroll down back
        assert!(grid.scroll_viewport(2));
        assert_eq!(grid.viewport_offset, 1);

        // Reset to live
        grid.reset_viewport();
        assert_eq!(grid.viewport_offset, 0);
    }

    #[test]
    fn test_viewport_clamp() {
        let mut grid = Grid::new(80, 3, 100);
        // No scrollback — can't scroll up
        assert!(!grid.scroll_viewport(-5));
        assert_eq!(grid.viewport_offset, 0);
    }
}
