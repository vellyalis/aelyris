//! Grid snapshot types (Phase 2 — Task 3).
//!
//! Plain, serde-friendly mirror of the alacritty `Term` grid so the IPC layer
//! can ship state to the frontend without leaking alacritty types. Colors are
//! packed into a `u32` (1-byte kind + 24-bit payload) so wire size stays tight
//! and the TS side can decode with a single bitshift.
//!
//! Packing scheme for `fg` / `bg`:
//!   bits 24..32 — kind tag
//!     0 = Named   (payload = `NamedColor` discriminant, up to 16 bits)
//!     1 = Rgb     (payload = `r<<16 | g<<8 | b`)
//!     2 = Indexed (payload = 8-bit palette index)
//!   bits 0..24  — payload per the kind above

use alacritty_terminal::index::{Column, Line, Point};
use alacritty_terminal::term::TermMode;
use alacritty_terminal::term::cell::{Cell, Flags};
use alacritty_terminal::vte::ansi::{Color, CursorShape, NamedColor};
use serde::{Deserialize, Serialize};

use super::engine::TermEngine;

pub mod attr {
    pub const BOLD: u16 = 1 << 0;
    pub const ITALIC: u16 = 1 << 1;
    pub const UNDERLINE: u16 = 1 << 2;
    pub const INVERSE: u16 = 1 << 3;
    pub const DIM: u16 = 1 << 4;
    pub const STRIKEOUT: u16 = 1 << 5;
    pub const HIDDEN: u16 = 1 << 6;
    pub const WIDE_CHAR: u16 = 1 << 7;
    pub const WIDE_CHAR_SPACER: u16 = 1 << 8;
    pub const WRAPLINE: u16 = 1 << 9;
}

mod color_kind {
    pub const NAMED: u32 = 0;
    pub const RGB: u32 = 1;
    pub const INDEXED: u32 = 2;
}

fn encode_color(c: Color) -> u32 {
    match c {
        Color::Named(named) => (color_kind::NAMED << 24) | (named as u32 & 0x00FF_FFFF),
        Color::Spec(rgb) => {
            let payload = ((rgb.r as u32) << 16) | ((rgb.g as u32) << 8) | rgb.b as u32;
            (color_kind::RGB << 24) | payload
        }
        Color::Indexed(i) => (color_kind::INDEXED << 24) | i as u32,
    }
}

fn encode_flags(flags: Flags) -> u16 {
    let mut out = 0u16;
    if flags.contains(Flags::BOLD) {
        out |= attr::BOLD;
    }
    if flags.contains(Flags::ITALIC) {
        out |= attr::ITALIC;
    }
    if flags.intersects(Flags::ALL_UNDERLINES) {
        out |= attr::UNDERLINE;
    }
    if flags.contains(Flags::INVERSE) {
        out |= attr::INVERSE;
    }
    if flags.contains(Flags::DIM) {
        out |= attr::DIM;
    }
    if flags.contains(Flags::STRIKEOUT) {
        out |= attr::STRIKEOUT;
    }
    if flags.contains(Flags::HIDDEN) {
        out |= attr::HIDDEN;
    }
    if flags.contains(Flags::WIDE_CHAR) {
        out |= attr::WIDE_CHAR;
    }
    if flags.contains(Flags::WIDE_CHAR_SPACER) {
        out |= attr::WIDE_CHAR_SPACER;
    }
    if flags.contains(Flags::WRAPLINE) {
        out |= attr::WRAPLINE;
    }
    out
}

/// Cursor shape, mirrors `alacritty_terminal::vte::ansi::CursorShape`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CursorShapeSnapshot {
    Block,
    Underline,
    Beam,
    HollowBlock,
    Hidden,
}

impl From<CursorShape> for CursorShapeSnapshot {
    fn from(shape: CursorShape) -> Self {
        match shape {
            CursorShape::Block => Self::Block,
            CursorShape::Underline => Self::Underline,
            CursorShape::Beam => Self::Beam,
            CursorShape::HollowBlock => Self::HollowBlock,
            CursorShape::Hidden => Self::Hidden,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CellSnapshot {
    pub ch: char,
    pub fg: u32,
    pub bg: u32,
    pub attrs: u16,
    /// OSC 8 explicit hyperlink attached to this cell. The vast majority
    /// of cells have none, so `skip_serializing_if` keeps the wire payload
    /// unchanged for typical shell output — a snapshot full of plain text
    /// serialises byte-for-byte the same as before this field was added.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hyperlink: Option<String>,
}

impl CellSnapshot {
    fn from_cell(cell: &Cell) -> Self {
        Self {
            ch: cell.c,
            fg: encode_color(cell.fg),
            bg: encode_color(cell.bg),
            attrs: encode_flags(cell.flags),
            hyperlink: cell.hyperlink().map(|h| h.uri().to_string()),
        }
    }

    pub fn blank() -> Self {
        Self {
            ch: ' ',
            fg: encode_color(Color::Named(NamedColor::Foreground)),
            bg: encode_color(Color::Named(NamedColor::Background)),
            attrs: 0,
            hyperlink: None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct CursorSnapshot {
    pub row: u16,
    pub col: u16,
    pub shape: CursorShapeSnapshot,
    pub blinking: bool,
    pub visible: bool,
}

/// A live image overlay returned alongside the cell grid. Sprint 3 uses
/// this to anchor decoded inline images at the cell row / column the
/// engine recorded when consuming the escape, with `history_at_insert`
/// already translated into the *current* screen-relative row.
///
/// `cellW` / `cellH` are the source-declared cell rectangle (Kitty
/// `c=` / `r=`); when `None` the frontend computes an extent from the
/// pixel dims and live cell metrics. Snapshot omits the `images` field
/// entirely when no images are visible (`#[serde(skip_serializing_if =
/// "Vec::is_empty")]`) so existing frontend builds stay byte-compatible
/// with the previous wire shape.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageRef {
    /// `ImageStore` id; the frontend passes this back to
    /// `term_image_data` to fetch the decoded bytes.
    pub id: u64,
    /// Live screen row (0..rows) where the image is anchored. Already
    /// adjusted for scroll: snapshot only includes images whose anchor
    /// is inside the visible grid.
    pub cell_row: u16,
    pub cell_col: u16,
    /// Pixel dimensions of the decoded image. The frontend uses these
    /// to compute the cell rectangle when `cellW` / `cellH` are absent.
    pub width_px: u32,
    pub height_px: u32,
    /// Source-declared cell width (Kitty `c=`). Optional override.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cell_w: Option<u16>,
    /// Source-declared cell height (Kitty `r=`). Optional override.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cell_h: Option<u16>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GridSnapshot {
    pub cols: u16,
    pub rows: u16,
    pub cells: Vec<Vec<CellSnapshot>>,
    pub cursor: CursorSnapshot,
    /// Inline image overlays whose anchor lands inside the visible grid.
    /// Empty for the typical text-only frame, in which case the field
    /// serialises away to keep the wire shape unchanged.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub images: Vec<ImageRef>,
}

/// One occurrence of a needle inside a single scrollback row.
///
/// Anchors are *cell* columns: `start_col` is the leftmost cell of the
/// match, `end_col` is the rightmost cell (inclusive). Matches do not
/// span rows, so wrapped output cannot produce a single match across
/// the wrap boundary — same row-scoped semantics as the live-grid
/// search in `src/features/terminal/search.ts`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistorySearchMatch {
    /// History index of the row containing the match. `0` is the row
    /// immediately above the live screen, growing into older history.
    pub history_index: usize,
    pub start_col: u16,
    /// Inclusive end column.
    pub end_col: u16,
}

impl TermEngine {
    /// Read `count` rows of scrollback starting from `from_n` (0 = the
    /// row immediately above the visible screen). Returns fewer rows if
    /// the retained history is shorter than the requested window — no
    /// error, the caller deals with the shortfall.
    ///
    /// Rows are returned in "age" order: index 0 is the most recent
    /// history row (closest to the live screen), index N-1 is the oldest.
    pub fn history_rows(&self, from_n: usize, count: usize) -> Vec<Vec<CellSnapshot>> {
        let hs = self.history_size();
        if from_n >= hs {
            return Vec::new();
        }
        let cols = self.cols();
        let end = (from_n + count).min(hs);
        let grid = self.term().grid();
        let mut out = Vec::with_capacity(end - from_n);
        for n in from_n..end {
            let line_idx = -(n as i32) - 1;
            let mut row = Vec::with_capacity(cols);
            for col in 0..cols {
                let cell = &grid[Point::new(Line(line_idx), Column(col))];
                row.push(CellSnapshot::from_cell(cell));
            }
            out.push(row);
        }
        out
    }

    /// Find every occurrence of `needle` in retained scrollback. Each
    /// match is row-scoped (no cross-row matching). When `case_sensitive`
    /// is `false` the comparison is done after a per-cell lowercasing,
    /// mirroring the frontend's `findMatches(snapshot, query)` behaviour
    /// so live-grid and history matches share the same anchor semantics.
    ///
    /// `WIDE_CHAR_SPACER` cells are skipped when building the searchable
    /// row text (the spacer is metadata trailing a wide char, not a
    /// distinct visual glyph). Empty needles return an empty vec.
    ///
    /// History indexing matches `history_rows`: `0` is the row directly
    /// above the live screen, growing into older history.
    pub fn search_history(
        &self,
        needle: &str,
        case_sensitive: bool,
    ) -> Vec<HistorySearchMatch> {
        if needle.is_empty() {
            return Vec::new();
        }
        let hs = self.history_size();
        if hs == 0 {
            return Vec::new();
        }

        let needle_lc;
        let needle_ref: &str = if case_sensitive {
            needle
        } else {
            needle_lc = needle.to_lowercase();
            &needle_lc
        };
        let needle_chars: Vec<char> = needle_ref.chars().collect();
        if needle_chars.is_empty() {
            return Vec::new();
        }

        let cols = self.cols();
        let grid = self.term().grid();
        let mut out = Vec::new();

        for n in 0..hs {
            let line_idx = -(n as i32) - 1;
            // Build (text, position-per-cell) for the row. Wide-char
            // spacers are skipped. For case-insensitive search each
            // cell's char is lowercased, which can yield more than one
            // unicode char for special-cased letters (e.g. Turkish
            // dotted I). We still push exactly one position entry per
            // cell, matching the frontend buildRowText shape — when a
            // match endpoint lands inside an expanded lowercase the
            // `.get()` lookup below drops it silently.
            let mut row_chars: Vec<char> = Vec::with_capacity(cols);
            let mut positions: Vec<u16> = Vec::with_capacity(cols);
            for col in 0..cols {
                let cell = &grid[Point::new(Line(line_idx), Column(col))];
                if cell.flags.contains(Flags::WIDE_CHAR_SPACER) {
                    continue;
                }
                let ch = if cell.c == '\0' { ' ' } else { cell.c };
                if case_sensitive {
                    row_chars.push(ch);
                } else {
                    for c in ch.to_lowercase() {
                        row_chars.push(c);
                    }
                }
                positions.push(col as u16);
            }

            if row_chars.len() < needle_chars.len() {
                continue;
            }

            let mut i = 0usize;
            while i + needle_chars.len() <= row_chars.len() {
                let mut matched = true;
                for (k, &nc) in needle_chars.iter().enumerate() {
                    if row_chars[i + k] != nc {
                        matched = false;
                        break;
                    }
                }
                if matched {
                    if let (Some(&start_col), Some(&end_col)) =
                        (positions.get(i), positions.get(i + needle_chars.len() - 1))
                    {
                        out.push(HistorySearchMatch {
                            history_index: n,
                            start_col,
                            end_col,
                        });
                    }
                    // Advance past the match to avoid emitting overlapping
                    // hits — same stride as `search.ts::findMatches`.
                    i += needle_chars.len().max(1);
                } else {
                    i += 1;
                }
            }
        }

        out
    }

    /// Build a serde-friendly snapshot of the current grid + cursor state.
    pub fn snapshot(&self) -> GridSnapshot {
        let rows = self.rows();
        let cols = self.cols();
        let grid = self.term().grid();

        let mut cells = Vec::with_capacity(rows);
        for line in 0..rows {
            let mut row = Vec::with_capacity(cols);
            for col in 0..cols {
                let cell = &grid[Point::new(Line(line as i32), Column(col))];
                row.push(CellSnapshot::from_cell(cell));
            }
            cells.push(row);
        }

        let cursor_point = grid.cursor.point;
        let style = self.term().cursor_style();
        let visible = self.term().mode().contains(TermMode::SHOW_CURSOR);
        let cursor = CursorSnapshot {
            row: cursor_point.line.0.max(0) as u16,
            col: cursor_point.column.0 as u16,
            shape: style.shape.into(),
            blinking: style.blinking,
            visible,
        };

        let images = self.collect_visible_images();
        GridSnapshot {
            cols: cols as u16,
            rows: rows as u16,
            cells,
            cursor,
            images,
        }
    }

    /// Build the list of image overlays whose anchor row currently lands
    /// inside the visible grid. Each entry's recorded `history_at_insert`
    /// is subtracted from the live `history_size()` to translate the
    /// originally-recorded screen row forward through any scroll that
    /// has happened since.
    ///
    /// Entries whose decoded payload is missing (decode failed, or still
    /// chunked) and entries that have scrolled off the visible window
    /// are silently dropped — Sprint 3's paint pass works on what's
    /// renderable, not on what's retained.
    fn collect_visible_images(&self) -> Vec<ImageRef> {
        let rows = self.rows() as i64;
        let current_history = self.history_size() as i64;
        let mut out = Vec::new();
        for entry in self.images().iter() {
            let Some(decoded) = entry.decoded.as_ref() else {
                continue;
            };
            let lines_added = current_history - entry.placement.history_at_insert as i64;
            let screen_row = entry.placement.screen_row_at_insert as i64 - lines_added;
            if screen_row < 0 || screen_row >= rows {
                continue;
            }
            out.push(ImageRef {
                id: entry.id.0,
                cell_row: screen_row as u16,
                cell_col: entry.placement.col_at_insert,
                width_px: decoded.width_px,
                height_px: decoded.height_px,
                cell_w: decoded
                    .cell_cols
                    .map(|c| c.min(u16::MAX as u32) as u16),
                cell_h: decoded
                    .cell_rows
                    .map(|r| r.min(u16::MAX as u32) as u16),
            });
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn blank_grid_has_default_cells() {
        let engine = TermEngine::new(4, 2).expect("engine");
        let snap = engine.snapshot();
        assert_eq!(snap.cols, 4);
        assert_eq!(snap.rows, 2);
        assert_eq!(snap.cells.len(), 2);
        assert_eq!(snap.cells[0].len(), 4);
        assert_eq!(snap.cells[0][0].ch, ' ');
        assert_eq!(snap.cells[0][0].attrs, 0);
        assert_eq!(snap.cursor, CursorSnapshot {
            row: 0,
            col: 0,
            shape: CursorShapeSnapshot::Block,
            blinking: false,
            visible: true,
        });
    }

    #[test]
    fn bold_sgr_sets_bold_attr() {
        let mut engine = TermEngine::new(10, 2).expect("engine");
        engine.advance_str("\x1b[1mX\x1b[0m");
        let snap = engine.snapshot();
        assert_eq!(snap.cells[0][0].ch, 'X');
        assert_ne!(snap.cells[0][0].attrs & attr::BOLD, 0);
        assert_eq!(snap.cells[0][1].attrs & attr::BOLD, 0);
    }

    #[test]
    fn multiple_attrs_combine() {
        let mut engine = TermEngine::new(10, 2).expect("engine");
        engine.advance_str("\x1b[1;3;4mY");
        let snap = engine.snapshot();
        let a = snap.cells[0][0].attrs;
        assert_ne!(a & attr::BOLD, 0, "bold: {:#b}", a);
        assert_ne!(a & attr::ITALIC, 0, "italic: {:#b}", a);
        assert_ne!(a & attr::UNDERLINE, 0, "underline: {:#b}", a);
    }

    #[test]
    fn rgb_fg_round_trips_through_u32() {
        let mut engine = TermEngine::new(5, 1).expect("engine");
        // 38;2;R;G;B — truecolor foreground (0xAA, 0xBB, 0xCC)
        engine.advance_str("\x1b[38;2;170;187;204mZ");
        let snap = engine.snapshot();
        let fg = snap.cells[0][0].fg;
        assert_eq!(fg >> 24, 1, "expected Rgb kind, got {:#x}", fg);
        assert_eq!(fg & 0x00FF_FFFF, 0x00AA_BBCC);
    }

    #[test]
    fn indexed_fg_encoded_as_kind_2() {
        let mut engine = TermEngine::new(5, 1).expect("engine");
        // 38;5;N — 256-color indexed foreground (N = 42)
        engine.advance_str("\x1b[38;5;42mQ");
        let snap = engine.snapshot();
        let fg = snap.cells[0][0].fg;
        assert_eq!(fg >> 24, 2, "expected Indexed kind, got {:#x}", fg);
        assert_eq!(fg & 0xFF, 42);
    }

    #[test]
    fn cursor_moves_with_text() {
        let mut engine = TermEngine::new(10, 3).expect("engine");
        engine.advance_str("abc\r\nde");
        let snap = engine.snapshot();
        assert_eq!(snap.cursor.row, 1);
        assert_eq!(snap.cursor.col, 2);
    }

    #[test]
    fn snapshot_is_serde_round_trippable() {
        let mut engine = TermEngine::new(3, 1).expect("engine");
        engine.advance_str("hi");
        let snap = engine.snapshot();
        let json = serde_json::to_string(&snap).expect("serialize");
        let parsed: GridSnapshot = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(parsed, snap);
    }

    #[test]
    fn osc8_hyperlink_attaches_uri_to_cells_between_markers() {
        // OSC 8 format: `ESC ] 8 ; params ; uri ST text ESC ] 8 ; ; ST`.
        // Params are usually empty — the `id=` key exists but most shells
        // omit it. The closing marker has empty params AND empty URI.
        let mut engine = TermEngine::new(20, 2).expect("engine");
        engine.advance_str("\x1b]8;;https://example.com\x1b\\LINK\x1b]8;;\x1b\\ rest");
        let snap = engine.snapshot();

        // The four LINK characters must carry the URI; the space after and
        // "rest" must not.
        for col in 0..4 {
            let cell = &snap.cells[0][col];
            assert_eq!(
                cell.hyperlink.as_deref(),
                Some("https://example.com"),
                "cell {col} ({:?}) should carry hyperlink",
                cell.ch
            );
        }
        for col in 4..snap.cols as usize {
            let cell = &snap.cells[0][col];
            assert!(cell.hyperlink.is_none(), "cell {col} ({:?}) must not carry hyperlink", cell.ch);
        }
    }

    /// Helper: stuff `lines.len()` lines into the engine's history by
    /// printing each followed by a newline, with a screen tall enough
    /// that everything but the last line scrolls into history.
    fn push_into_history(engine: &mut TermEngine, lines: &[&str]) {
        for line in lines {
            engine.advance_str(line);
            engine.advance_str("\r\n");
        }
    }

    #[test]
    fn search_history_empty_needle_returns_empty() {
        let mut engine = TermEngine::new(20, 2).expect("engine");
        push_into_history(&mut engine, &["hello world", "second line", "third row"]);
        assert!(engine.search_history("", false).is_empty());
    }

    #[test]
    fn search_history_no_history_returns_empty() {
        let engine = TermEngine::new(20, 5).expect("engine");
        // Nothing scrolled off — history_size() is 0.
        assert_eq!(engine.history_size(), 0);
        assert!(engine.search_history("anything", false).is_empty());
    }

    #[test]
    fn search_history_finds_match_in_scrolled_off_row() {
        // 2-row screen so older lines spill into history.
        let mut engine = TermEngine::new(40, 2).expect("engine");
        push_into_history(&mut engine, &[
            "alpha needle beta",
            "gamma delta epsilon",
            "zeta eta theta",
        ]);
        let matches = engine.search_history("needle", false);
        assert_eq!(matches.len(), 1, "got {:?}", matches);
        let m = matches[0];
        // "alpha " is 6 chars before "needle" → start col 6, end col 6+6-1=11.
        assert_eq!(m.start_col, 6);
        assert_eq!(m.end_col, 11);
        // Most-recent rows live at low history indices; "alpha …" is the
        // oldest of the three, so its history index should be the
        // largest.
        assert!(m.history_index >= 1);
    }

    #[test]
    fn search_history_case_insensitive_by_default() {
        let mut engine = TermEngine::new(40, 2).expect("engine");
        push_into_history(&mut engine, &["MixedCase Token", "another", "filler"]);
        let cs = engine.search_history("mixedcase", false);
        assert_eq!(cs.len(), 1);
        let m = cs[0];
        assert_eq!(m.start_col, 0);
        assert_eq!(m.end_col, 8);
    }

    #[test]
    fn search_history_case_sensitive_skips_mismatched_case() {
        let mut engine = TermEngine::new(40, 2).expect("engine");
        push_into_history(&mut engine, &["MixedCase Token", "filler-a", "filler-b"]);
        assert!(engine.search_history("mixedcase", true).is_empty());
        assert_eq!(engine.search_history("MixedCase", true).len(), 1);
    }

    #[test]
    fn search_history_returns_multiple_per_row() {
        let mut engine = TermEngine::new(40, 2).expect("engine");
        push_into_history(&mut engine, &[
            "abcabcabc xyz",
            "filler one",
            "filler two",
        ]);
        let matches = engine.search_history("abc", false);
        assert_eq!(matches.len(), 3);
        // Same row, ascending start cols 0,3,6.
        assert_eq!(matches[0].start_col, 0);
        assert_eq!(matches[1].start_col, 3);
        assert_eq!(matches[2].start_col, 6);
        // All same row.
        let h = matches[0].history_index;
        assert!(matches.iter().all(|m| m.history_index == h));
    }

    #[test]
    fn search_history_no_cross_row_match() {
        let mut engine = TermEngine::new(8, 2).expect("engine");
        // "hello" wraps if we just print it, but two separate lines
        // ensures no cross-row matching either way. Print "abcXY" then
        // "Zdef" — searching "XYZ" must NOT match across the row break.
        push_into_history(&mut engine, &["abcXY", "Zdef", "filler"]);
        assert!(engine.search_history("XYZ", true).is_empty());
        // Sanity: each fragment is findable on its own row.
        assert_eq!(engine.search_history("XY", true).len(), 1);
        assert_eq!(engine.search_history("Z", true).len(), 1);
    }

    #[test]
    fn search_history_indices_run_newest_first() {
        let mut engine = TermEngine::new(20, 2).expect("engine");
        // Each row has a unique sentinel; only the oldest two (rows 0
        // and 1) end up in history because the screen is 2 rows tall.
        push_into_history(&mut engine, &["mark0", "mark1", "mark2"]);
        let m0 = engine.search_history("mark0", true);
        let m1 = engine.search_history("mark1", true);
        assert_eq!(m0.len(), 1);
        assert_eq!(m1.len(), 1);
        // mark1 is more recent than mark0 → smaller history index.
        assert!(
            m1[0].history_index < m0[0].history_index,
            "expected mark1 < mark0, got {:?} vs {:?}",
            m1,
            m0
        );
    }

    #[test]
    fn snapshot_json_omits_absent_hyperlink_field() {
        // Wire-format hygiene: adding the field must not inflate every
        // plain-text cell. Cells without a hyperlink serialise without
        // the key entirely thanks to skip_serializing_if.
        let mut engine = TermEngine::new(2, 1).expect("engine");
        engine.advance_str("ab");
        let snap = engine.snapshot();
        let json = serde_json::to_string(&snap).expect("serialize");
        assert!(!json.contains("hyperlink"), "expected absent field, got: {json}");
    }

    // ---------- Sprint 3: image overlays ----------

    #[test]
    fn snapshot_omits_images_field_when_no_images_consumed() {
        let mut engine = TermEngine::new(2, 1).expect("engine");
        engine.advance_str("ok");
        let snap = engine.snapshot();
        assert!(snap.images.is_empty());
        let json = serde_json::to_string(&snap).expect("serialize");
        assert!(
            !json.contains("\"images\""),
            "empty images list must not surface in the wire payload, got: {json}"
        );
    }

    #[test]
    fn snapshot_includes_image_anchored_at_cursor_after_consume() {
        // Walk the cursor to (row=2, col=4) before injecting the image
        // escape so the recorded placement is non-trivial. The test
        // body is a minimal Sixel that decodes to a 1x6 RGBA image.
        let mut engine = TermEngine::new(40, 8).expect("engine");
        engine.advance_str("\r\n\r\n    ");
        engine.advance(b"\x1bPq~\x1b\\");
        let snap = engine.snapshot();
        assert_eq!(snap.images.len(), 1);
        let img = &snap.images[0];
        assert_eq!(img.cell_row, 2);
        assert_eq!(img.cell_col, 4);
        assert_eq!(img.width_px, 1);
        assert_eq!(img.height_px, 6);
        assert!(img.cell_w.is_none());
        assert!(img.cell_h.is_none());
    }

    #[test]
    fn snapshot_image_screen_row_translates_after_scroll() {
        // Place an image on row 0, then push enough output to scroll
        // it into history. The visible-image set must drop it.
        let mut engine = TermEngine::new(20, 3).expect("engine");
        engine.advance(b"\x1bPq~\x1b\\");
        let snap = engine.snapshot();
        assert_eq!(snap.images.len(), 1, "image visible on row 0");
        // Push enough \r\n to scroll the image off-screen. Three rows
        // of screen, plus a couple extras to be safe.
        for _ in 0..6 {
            engine.advance_str("\r\nx");
        }
        let snap = engine.snapshot();
        assert!(
            snap.images.is_empty(),
            "image should have scrolled into history and dropped from snapshot"
        );
    }

    #[test]
    fn snapshot_image_carries_cell_overrides_from_kitty_header() {
        let mut engine = TermEngine::new(40, 4).expect("engine");
        // Synthesise a Kitty escape with an explicit c=10, r=4 cell
        // rectangle. The body is a stand-in PNG — png_dimensions()
        // returns None, so the decoder falls back to the header's s/v
        // (which we leave unset). The cell overrides survive the
        // snapshot path regardless.
        engine.advance(
            b"\x1b_Ga=T,f=100,c=10,r=4,s=80,v=24;aGVsbG8=\x1b\\",
        );
        let snap = engine.snapshot();
        assert_eq!(snap.images.len(), 1);
        let img = &snap.images[0];
        assert_eq!(img.cell_w, Some(10));
        assert_eq!(img.cell_h, Some(4));
    }

    #[test]
    fn snapshot_skips_images_with_failed_decode() {
        let mut engine = TermEngine::new(40, 2).expect("engine");
        // Invalid base64 — decode fails, raw stays in store, but the
        // snapshot must not surface an image with no decoded buffer.
        engine.advance(b"\x1b_Ga=T,f=100;!!!\x1b\\");
        let snap = engine.snapshot();
        assert!(snap.images.is_empty());
    }
}
