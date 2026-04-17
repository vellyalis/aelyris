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
}

impl CellSnapshot {
    fn from_cell(cell: &Cell) -> Self {
        Self {
            ch: cell.c,
            fg: encode_color(cell.fg),
            bg: encode_color(cell.bg),
            attrs: encode_flags(cell.flags),
        }
    }

    pub fn blank() -> Self {
        Self {
            ch: ' ',
            fg: encode_color(Color::Named(NamedColor::Foreground)),
            bg: encode_color(Color::Named(NamedColor::Background)),
            attrs: 0,
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

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GridSnapshot {
    pub cols: u16,
    pub rows: u16,
    pub cells: Vec<Vec<CellSnapshot>>,
    pub cursor: CursorSnapshot,
}

impl TermEngine {
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

        GridSnapshot { cols: cols as u16, rows: rows as u16, cells, cursor }
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
}
