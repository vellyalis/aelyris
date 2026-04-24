/**
 * Grid snapshot types — mirror of `src-tauri/src/term/snapshot.rs`.
 *
 * Shipped verbatim over Tauri IPC (serde JSON). Colors are packed into a
 * single u32:
 *   bits 24..32 — kind tag (0 = Named, 1 = Rgb, 2 = Indexed)
 *   bits 0..24  — payload per the kind
 */

export const CellAttr = {
  BOLD: 1 << 0,
  ITALIC: 1 << 1,
  UNDERLINE: 1 << 2,
  INVERSE: 1 << 3,
  DIM: 1 << 4,
  STRIKEOUT: 1 << 5,
  HIDDEN: 1 << 6,
  WIDE_CHAR: 1 << 7,
  WIDE_CHAR_SPACER: 1 << 8,
  WRAPLINE: 1 << 9,
} as const;

export type CellAttrFlag = (typeof CellAttr)[keyof typeof CellAttr];

export const ColorKind = {
  NAMED: 0,
  RGB: 1,
  INDEXED: 2,
} as const;

export type ColorKind = (typeof ColorKind)[keyof typeof ColorKind];

export type TerminalColor =
  | { kind: typeof ColorKind.NAMED; named: number }
  | { kind: typeof ColorKind.RGB; r: number; g: number; b: number }
  | { kind: typeof ColorKind.INDEXED; index: number };

export function decodeColor(packed: number): TerminalColor {
  const kind = (packed >>> 24) & 0xff;
  const payload = packed & 0x00ff_ffff;
  switch (kind) {
    case ColorKind.NAMED:
      return { kind: ColorKind.NAMED, named: payload };
    case ColorKind.RGB:
      return {
        kind: ColorKind.RGB,
        r: (payload >>> 16) & 0xff,
        g: (payload >>> 8) & 0xff,
        b: payload & 0xff,
      };
    case ColorKind.INDEXED:
      return { kind: ColorKind.INDEXED, index: payload & 0xff };
    default:
      throw new Error(`unknown color kind: ${kind}`);
  }
}

export type CursorShape = "block" | "underline" | "beam" | "hollowBlock" | "hidden";

export interface CellSnapshot {
  ch: string;
  fg: number;
  bg: number;
  attrs: number;
  /**
   * OSC 8 explicit hyperlink URI for this cell. Absent on cells without
   * an attached hyperlink (most of them). Shells emit these when they
   * want *a specific URL* to be clickable regardless of the rendered
   * text — e.g. `ls --hyperlink`, `git log --color=always` with
   * hyperlinked hashes, or build tools that link error locations.
   */
  hyperlink?: string;
}

export interface CursorSnapshot {
  row: number;
  col: number;
  shape: CursorShape;
  blinking: boolean;
  visible: boolean;
}

export interface GridSnapshot {
  cols: number;
  rows: number;
  cells: CellSnapshot[][];
  cursor: CursorSnapshot;
}

export function hasAttr(cell: CellSnapshot, flag: CellAttrFlag): boolean {
  return (cell.attrs & flag) !== 0;
}

export interface RowDiff {
  row: number;
  cells: CellSnapshot[];
}

export interface GridDiff {
  cols: number;
  rows_total: number;
  full: boolean;
  rows: RowDiff[];
  cursor: CursorSnapshot;
  cursor_changed: boolean;
}
