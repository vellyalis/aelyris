//! Thin wrapper around `alacritty_terminal::Term` + VTE parser.
//!
//! Responsibilities:
//! - Own a `Term<VoidListener>` and an ANSI `Processor`.
//! - Feed PTY bytes into the parser to advance terminal state.
//! - Expose minimal read helpers so downstream (diff engine / IPC) can
//!   snapshot the grid without leaking alacritty_terminal types upward.
//!
//! Events (title change, bell, clipboard) are discarded for now via
//! `VoidListener`; we'll wire a real listener when those surfaces land in UI.

use alacritty_terminal::event::VoidListener;
use alacritty_terminal::grid::Dimensions;
use alacritty_terminal::index::{Line, Point};
use alacritty_terminal::term::{Config, cell::Cell};
use alacritty_terminal::vte::ansi::Processor;
use alacritty_terminal::Term;

#[derive(Debug, thiserror::Error)]
pub enum TermEngineError {
    #[error("invalid terminal dimensions: {cols}x{rows}")]
    InvalidDimensions { cols: usize, rows: usize },
    #[error("row {line} out of range (screen_lines={screen_lines})")]
    RowOutOfRange { line: i32, screen_lines: usize },
}

/// Simple `Dimensions` impl so callers don't need to depend on
/// `alacritty_terminal::term::test::TermSize`.
#[derive(Copy, Clone, Debug)]
struct Size {
    cols: usize,
    rows: usize,
}

impl Dimensions for Size {
    fn total_lines(&self) -> usize {
        self.rows
    }

    fn screen_lines(&self) -> usize {
        self.rows
    }

    fn columns(&self) -> usize {
        self.cols
    }
}

/// Terminal state engine wrapping alacritty_terminal.
pub struct TermEngine {
    term: Term<VoidListener>,
    parser: Processor,
    size: Size,
}

impl TermEngine {
    /// Create a new engine with the given grid dimensions.
    pub fn new(cols: usize, rows: usize) -> Result<Self, TermEngineError> {
        if cols == 0 || rows == 0 {
            return Err(TermEngineError::InvalidDimensions { cols, rows });
        }
        let size = Size { cols, rows };
        let term = Term::new(Config::default(), &size, VoidListener);
        Ok(Self {
            term,
            parser: Processor::new(),
            size,
        })
    }

    /// Feed raw PTY bytes into the parser, advancing terminal state.
    pub fn advance(&mut self, bytes: &[u8]) {
        self.parser.advance(&mut self.term, bytes);
    }

    /// Convenience: feed a UTF-8 string.
    pub fn advance_str(&mut self, s: &str) {
        self.advance(s.as_bytes());
    }

    pub fn cols(&self) -> usize {
        self.size.cols
    }

    pub fn rows(&self) -> usize {
        self.size.rows
    }

    /// Read a screen row as a plain `String`, trimming trailing spaces.
    /// `line` is 0-indexed from the top of the visible screen.
    pub fn row_text(&self, line: usize) -> Result<String, TermEngineError> {
        if line >= self.size.rows {
            return Err(TermEngineError::RowOutOfRange {
                line: line as i32,
                screen_lines: self.size.rows,
            });
        }
        let mut out = String::with_capacity(self.size.cols);
        for col in 0..self.size.cols {
            let cell: &Cell = &self.term.grid()[Point::new(
                Line(line as i32),
                alacritty_terminal::index::Column(col),
            )];
            out.push(cell.c);
        }
        Ok(out.trim_end().to_string())
    }

    /// Cursor position as (row, col), 0-indexed from the visible screen top-left.
    pub fn cursor(&self) -> (usize, usize) {
        let point = self.term.grid().cursor.point;
        (point.line.0.max(0) as usize, point.column.0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_zero_dimensions() {
        assert!(matches!(
            TermEngine::new(0, 24),
            Err(TermEngineError::InvalidDimensions { .. })
        ));
        assert!(matches!(
            TermEngine::new(80, 0),
            Err(TermEngineError::InvalidDimensions { .. })
        ));
    }

    #[test]
    fn advance_hello_populates_row_zero() {
        let mut engine = TermEngine::new(80, 24).expect("engine");
        engine.advance_str("hello");
        assert_eq!(engine.row_text(0).unwrap(), "hello");
        assert_eq!(engine.cursor(), (0, 5));
    }

    #[test]
    fn newline_moves_cursor_to_next_line() {
        let mut engine = TermEngine::new(40, 10).expect("engine");
        engine.advance_str("first\r\nsecond");
        assert_eq!(engine.row_text(0).unwrap(), "first");
        assert_eq!(engine.row_text(1).unwrap(), "second");
        assert_eq!(engine.cursor(), (1, 6));
    }

    #[test]
    fn csi_clear_line_erases_content() {
        let mut engine = TermEngine::new(20, 5).expect("engine");
        // Write "abc", move cursor to column 0, erase from cursor to EOL.
        engine.advance_str("abc\r\x1b[K");
        assert_eq!(engine.row_text(0).unwrap(), "");
    }

    #[test]
    fn row_out_of_range_errors() {
        let engine = TermEngine::new(10, 5).expect("engine");
        assert!(matches!(
            engine.row_text(5),
            Err(TermEngineError::RowOutOfRange { .. })
        ));
    }

    #[test]
    fn utf8_multibyte_is_parsed_correctly() {
        let mut engine = TermEngine::new(20, 5).expect("engine");
        engine.advance_str("こん");
        // Each CJK char is 2 columns wide; first col holds the char, second is a spacer.
        let row = engine.row_text(0).unwrap();
        assert!(row.starts_with('こ'), "got: {:?}", row);
        assert!(row.contains('ん'), "got: {:?}", row);
    }
}
