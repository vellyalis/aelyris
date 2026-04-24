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

use super::prompt_marks::{ParseStep, PromptMark, PromptMarkLog, try_parse as try_parse_osc133};

#[derive(Debug, thiserror::Error)]
pub enum TermEngineError {
    #[error("invalid terminal dimensions: {cols}x{rows}")]
    InvalidDimensions { cols: usize, rows: usize },
    #[error("row {line} out of range (screen_lines={screen_lines})")]
    RowOutOfRange { line: i32, screen_lines: usize },
}

/// Capacity of the scrollback buffer (in lines) retained above the visible
/// screen. 10k lines is ~80 MiB at 120 cols × 80 B/cell — comfortable for
/// multi-hour shell sessions and still well under a reasonable memory
/// budget. Exposed publicly so the frontend can size scroll UI against
/// the same ceiling the engine enforces.
pub const SCROLLBACK_LINES: usize = 10_000;

/// Simple `Dimensions` impl so callers don't need to depend on
/// `alacritty_terminal::term::test::TermSize`.
///
/// `total_lines` must be `screen_lines + scrollback_capacity`. Setting the
/// two equal (as this file did before scrollback landed) disables history
/// entirely — every line pushed out of the visible screen is dropped. The
/// fix is to widen `total_lines`; alacritty then allocates a ring buffer
/// of capacity `total_lines - screen_lines` and retains that many lines
/// of history.
#[derive(Copy, Clone, Debug)]
struct Size {
    cols: usize,
    rows: usize,
}

impl Dimensions for Size {
    fn total_lines(&self) -> usize {
        self.rows + SCROLLBACK_LINES
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
    prompt_marks: PromptMarkLog,
    /// Bytes of a partial OSC 133 sequence that straddled the previous
    /// `advance()` call boundary. Rare but real — terminals routinely split
    /// OSC sequences across PTY read chunks.
    osc_pending: Vec<u8>,
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
            prompt_marks: PromptMarkLog::new(),
            osc_pending: Vec::new(),
        })
    }

    /// Feed raw PTY bytes into the parser, advancing terminal state.
    ///
    /// Returns every OSC 133 mark that was *newly* completed inside `bytes`.
    /// Callers that only need grid state can ignore the return value; the
    /// marks are also retained internally (bounded log) and queryable via
    /// [`TermEngine::prompt_marks`].
    pub fn advance(&mut self, bytes: &[u8]) -> Vec<PromptMark> {
        // Fast path: nothing pending and no ESC in the buffer — can't be
        // OSC 133. Forward straight to alacritty.
        if self.osc_pending.is_empty() && !bytes.contains(&0x1b) {
            self.parser.advance(&mut self.term, bytes);
            return Vec::new();
        }

        // Take ownership of any pending OSC tail so the borrow checker
        // lets us mutate `self.parser` / `self.prompt_marks` while walking
        // the combined buffer. The field is cleared and restored only at
        // the Incomplete branch where we stash a fresh tail.
        let mut combined = std::mem::take(&mut self.osc_pending);
        if combined.is_empty() {
            combined.reserve(bytes.len());
        }
        combined.extend_from_slice(bytes);

        let mut new_marks = Vec::new();
        let mut consumed = 0usize;
        let mut i = 0usize;
        while i < combined.len() {
            if combined[i] != 0x1b {
                i += 1;
                continue;
            }
            match try_parse_osc133(&combined[i..]) {
                ParseStep::Consumed { bytes: n, mark } => {
                    // Flush everything up to the OSC 133 start so the
                    // parser's cursor reflects the shell's prompt line.
                    self.parser.advance(&mut self.term, &combined[consumed..i]);
                    let (line, _col) = cursor_of(&self.term);
                    let history_at_record = self.term.grid().history_size();
                    let recorded = self.prompt_marks.record(
                        mark,
                        line.min(u16::MAX as usize) as u16,
                        history_at_record.min(u32::MAX as usize) as u32,
                    );
                    new_marks.push(recorded);
                    // Forward the OSC bytes to alacritty too. Alacritty
                    // ignores unknown OSCs, so this is a no-op for grid
                    // state but keeps its VTE state machine consistent.
                    self.parser
                        .advance(&mut self.term, &combined[i..i + n]);
                    i += n;
                    consumed = i;
                }
                ParseStep::Incomplete => {
                    // Flush up-to-but-not-including this ESC. Stash the
                    // tail for the next advance.
                    self.parser.advance(&mut self.term, &combined[consumed..i]);
                    self.osc_pending = combined[i..].to_vec();
                    return new_marks;
                }
                ParseStep::None => {
                    // Not an OSC 133 — let the parser handle this ESC
                    // sequence (CSI / SGR / title / …) on the next flush.
                    i += 1;
                }
            }
        }

        if consumed < combined.len() {
            self.parser.advance(&mut self.term, &combined[consumed..]);
        }
        new_marks
    }

    /// Convenience: feed a UTF-8 string and discard any emitted marks.
    ///
    /// Production callers almost always want [`TermEngine::advance`] so
    /// newly-parsed prompt marks can be emitted to the frontend; this
    /// helper exists for tests and parse-state assertions where marks
    /// are incidental.
    pub fn advance_str(&mut self, s: &str) {
        let _ = self.advance(s.as_bytes());
    }

    /// Read-only view of every retained OSC 133 mark. Oldest first.
    pub fn prompt_marks(&self) -> Vec<PromptMark> {
        self.prompt_marks.as_slice()
    }

    pub fn cols(&self) -> usize {
        self.size.cols
    }

    pub fn rows(&self) -> usize {
        self.size.rows
    }

    /// Borrow the inner `Term` so sibling modules (e.g. `snapshot`) can read grid state.
    pub(super) fn term(&self) -> &Term<VoidListener> {
        &self.term
    }

    /// Resize the underlying grid. No-op if dimensions are unchanged.
    pub fn resize(&mut self, cols: usize, rows: usize) -> Result<(), TermEngineError> {
        if cols == 0 || rows == 0 {
            return Err(TermEngineError::InvalidDimensions { cols, rows });
        }
        if cols == self.size.cols && rows == self.size.rows {
            return Ok(());
        }
        self.size = Size { cols, rows };
        self.term.resize(self.size);
        Ok(())
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
        cursor_of(&self.term)
    }

    /// Number of scrollback lines currently retained above the visible
    /// screen. Grows as the shell emits output, caps at
    /// [`SCROLLBACK_LINES`], then starts evicting oldest-first.
    pub fn history_size(&self) -> usize {
        self.term.grid().history_size()
    }

    /// Read a single history line (0 = line immediately above the visible
    /// screen, 1 = two lines above, …). Returns `None` when `n` exceeds
    /// the retained history.
    ///
    /// The returned string mirrors the grid semantics of `row_text`:
    /// trailing spaces are trimmed, wide-char spacers are included as
    /// literal characters so column indexing still works.
    pub fn history_row_text(&self, n: usize) -> Option<String> {
        if n >= self.history_size() {
            return None;
        }
        let grid = self.term.grid();
        // History is addressed by negative Line values: -1 is the line
        // immediately above the visible screen, -2 is two lines above,
        // etc. alacritty_terminal clamps out-of-range reads internally,
        // but we still bounds-check above so we can return None instead
        // of a silent blank row.
        let mut out = String::with_capacity(self.size.cols);
        let line_idx = -(n as i32) - 1;
        for col in 0..self.size.cols {
            let cell = &grid[Point::new(Line(line_idx), alacritty_terminal::index::Column(col))];
            out.push(cell.c);
        }
        Some(out.trim_end().to_string())
    }
}

/// Free-function cursor reader so the OSC 133 scan in `advance()` can read
/// the cursor without holding `&self` while also mutably borrowing
/// `self.parser` + `self.term` via `parser.advance(&mut term, ...)`.
fn cursor_of(term: &Term<VoidListener>) -> (usize, usize) {
    let point = term.grid().cursor.point;
    (point.line.0.max(0) as usize, point.column.0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::term::prompt_marks::PromptMarkKind;

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

    #[test]
    fn osc133_prompt_start_records_line_zero_on_empty_screen() {
        let mut engine = TermEngine::new(80, 24).expect("engine");
        let marks = engine.advance(b"\x1b]133;A\x07");
        assert_eq!(marks.len(), 1);
        assert_eq!(marks[0].kind, PromptMarkKind::PromptStart);
        assert_eq!(marks[0].screen_line, 0);
    }

    #[test]
    fn osc133_marks_attribute_to_current_cursor_line() {
        let mut engine = TermEngine::new(80, 24).expect("engine");
        // Two lines of output, then shell emits the prompt mark on line 2.
        engine.advance_str("line0\r\nline1\r\n");
        let marks = engine.advance(b"\x1b]133;A\x07$ ");
        assert_eq!(marks.len(), 1);
        assert_eq!(marks[0].screen_line, 2, "prompt mark must land on the cursor's line");
    }

    #[test]
    fn osc133_command_end_payload_is_captured() {
        let mut engine = TermEngine::new(80, 24).expect("engine");
        let marks = engine.advance(b"\x1b]133;D;137\x1b\\");
        assert_eq!(marks.len(), 1);
        assert_eq!(marks[0].kind, PromptMarkKind::CommandEnd);
        assert_eq!(marks[0].exit_code, Some(137));
    }

    #[test]
    fn osc133_sequence_split_across_two_advance_calls_still_parses() {
        let mut engine = TermEngine::new(80, 24).expect("engine");
        // First chunk ends in the middle of the OSC sequence — no complete
        // mark yet, and no partial mark leaked into the grid.
        let first = engine.advance(b"hello\r\n\x1b]133;");
        assert!(first.is_empty());
        // Second chunk completes the sequence; the mark attributes to the
        // line the cursor was sitting on after "hello\\r\\n".
        let second = engine.advance(b"A\x07$ ");
        assert_eq!(second.len(), 1);
        assert_eq!(second[0].kind, PromptMarkKind::PromptStart);
        assert_eq!(second[0].screen_line, 1);
        // And the grid is intact — no stray `\x1b]133;` garbage.
        // row_text trims trailing whitespace, so `"$ "` becomes `"$"`.
        assert_eq!(engine.row_text(0).unwrap(), "hello");
        assert_eq!(engine.row_text(1).unwrap(), "$");
    }

    #[test]
    fn non_osc133_escape_sequences_are_still_honoured() {
        let mut engine = TermEngine::new(20, 5).expect("engine");
        // Write "abc", move cursor to column 0, clear to EOL — CSI K — all
        // of these must still work now that advance() also scans for OSC 133.
        let marks = engine.advance(b"abc\r\x1b[K");
        assert!(marks.is_empty());
        assert_eq!(engine.row_text(0).unwrap(), "");
    }

    #[test]
    fn multiple_marks_in_one_advance_are_all_emitted_in_order() {
        let mut engine = TermEngine::new(80, 24).expect("engine");
        // A full prompt cycle in a single PTY read: prompt, user command,
        // output, exit code. This is realistic — shells often flush the
        // whole cycle together when the command is fast.
        let marks = engine.advance(
            b"\x1b]133;A\x07$ echo hi\r\n\x1b]133;B\x07\x1b]133;C\x07hi\r\n\x1b]133;D;0\x07",
        );
        let kinds: Vec<_> = marks.iter().map(|m| m.kind).collect();
        assert_eq!(
            kinds,
            vec![
                PromptMarkKind::PromptStart,
                PromptMarkKind::CommandStart,
                PromptMarkKind::OutputStart,
                PromptMarkKind::CommandEnd,
            ],
        );
        assert_eq!(marks[3].exit_code, Some(0));
        // And the sequence counters are monotonic starting at 0.
        assert_eq!(marks[0].sequence, 0);
        assert_eq!(marks[3].sequence, 3);
    }

    #[test]
    fn prompt_marks_accessor_returns_full_history() {
        let mut engine = TermEngine::new(80, 24).expect("engine");
        engine.advance_str("\x1b]133;A\x07");
        engine.advance_str("\x1b]133;B\x07");
        let log = engine.prompt_marks();
        assert_eq!(log.len(), 2);
        assert_eq!(log[0].kind, PromptMarkKind::PromptStart);
        assert_eq!(log[1].kind, PromptMarkKind::CommandStart);
    }

    #[test]
    fn blank_engine_has_no_scrollback_yet() {
        let engine = TermEngine::new(40, 5).expect("engine");
        assert_eq!(engine.history_size(), 0);
        assert_eq!(engine.history_row_text(0), None);
    }

    #[test]
    fn output_exceeding_screen_height_flows_into_scrollback() {
        let mut engine = TermEngine::new(40, 3).expect("engine");
        // Emit six lines into a three-row screen. Each `\r\n` after the
        // second line triggers a scroll-up, pushing the top row into
        // history. Final state: screen holds line-4 / line-5 / blank,
        // history holds [line-3 (top), line-2, line-1, line-0 (oldest)].
        for i in 0..6 {
            engine.advance_str(&format!("line-{i}\r\n"));
        }
        assert!(
            engine.history_size() >= 4,
            "expected >=4 retained history lines, got {}",
            engine.history_size()
        );
        assert_eq!(engine.history_row_text(0).as_deref(), Some("line-3"));
        assert_eq!(engine.history_row_text(1).as_deref(), Some("line-2"));
        assert_eq!(engine.history_row_text(2).as_deref(), Some("line-1"));
        assert_eq!(engine.history_row_text(3).as_deref(), Some("line-0"));
    }

    #[test]
    fn scrollback_caps_at_configured_ceiling() {
        use crate::term::engine::SCROLLBACK_LINES;

        // Use a tiny screen so the eviction path fires quickly. We only
        // check that the log caps at SCROLLBACK_LINES, not the exact
        // identity of evicted lines — alacritty reserves a few rows for
        // its own bookkeeping on the boundary.
        let mut engine = TermEngine::new(20, 2).expect("engine");
        for i in 0..(SCROLLBACK_LINES + 50) {
            engine.advance_str(&format!("row-{i}\r\n"));
        }
        assert_eq!(
            engine.history_size(),
            SCROLLBACK_LINES,
            "history must cap at SCROLLBACK_LINES"
        );
    }

    #[test]
    fn history_row_text_returns_none_beyond_retained_history() {
        let mut engine = TermEngine::new(10, 2).expect("engine");
        engine.advance_str("a\r\nb\r\nc\r\nd\r\n");
        let hs = engine.history_size();
        assert!(hs >= 2);
        assert!(engine.history_row_text(hs).is_none());
        assert!(engine.history_row_text(hs + 1000).is_none());
    }

    #[test]
    fn prompt_marks_capture_history_size_at_record_time() {
        // Mark recorded on an empty engine sees history_size=0. Push a few
        // lines through (which scrolls some into history), then record a
        // second mark — its history_size must reflect the growth. The
        // delta is what the frontend uses to locate the older mark in
        // scrollback after the view has moved on.
        let mut engine = TermEngine::new(20, 3).expect("engine");

        let first = engine.advance(b"\x1b]133;A\x07first\r\n");
        assert_eq!(first.len(), 1);
        assert_eq!(first[0].history_size, 0, "first mark should see empty history");

        // Drop five more lines to push content into scrollback.
        for i in 0..5 {
            engine.advance_str(&format!("line-{i}\r\n"));
        }
        let hs_before_second = engine.history_size();
        assert!(hs_before_second >= 3);

        let second = engine.advance(b"\x1b]133;A\x07second\r\n");
        assert_eq!(second.len(), 1);
        assert_eq!(
            second[0].history_size as usize, hs_before_second,
            "second mark should see grown history",
        );
        assert!(
            second[0].history_size > first[0].history_size,
            "history_size must be monotonic: {} > {}",
            second[0].history_size,
            first[0].history_size,
        );
    }
}
