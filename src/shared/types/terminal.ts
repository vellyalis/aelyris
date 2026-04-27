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

/**
 * Inline image overlay returned alongside the cell grid. Sprint 3 emits
 * one entry per visible image; entries whose anchor scrolls into history
 * (or whose decode failed) are silently dropped at the snapshot layer
 * so the frontend only ever paints what it can resolve.
 *
 * `cellW` / `cellH` carry the source-declared cell rectangle (Kitty
 * `c=` / `r=`); when absent the renderer computes the rect from
 * `widthPx` / `heightPx` divided by the live cell metrics.
 */
export interface ImageRef {
  id: number;
  cellRow: number;
  cellCol: number;
  widthPx: number;
  heightPx: number;
  cellW?: number;
  cellH?: number;
}

export interface GridSnapshot {
  cols: number;
  rows: number;
  cells: CellSnapshot[][];
  cursor: CursorSnapshot;
  /**
   * Inline image overlays whose anchor lands inside the visible grid.
   * Backend omits the field entirely when empty (`Vec::is_empty`
   * `skip_serializing_if`); the frontend defaults to `[]` so consumers
   * can iterate without a presence check.
   */
  images?: ImageRef[];
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
  /**
   * Inline image overlay state for this frame.
   * - Defined (`ImageRef[]`): replace the entire image set. Always
   *   present on `full=true` diffs (so a (re)mount seeds correctly)
   *   and on partial diffs whenever the image set changed since the
   *   last emit (anchor scrolled out, new image landed, etc).
   * - Absent (`undefined`): the image set is unchanged from the prev
   *   frame. The frontend carries `prev.images` through.
   *
   * The wire serializes `Option::None` as field-omitted, so on TS the
   * field is `undefined`. `[]` (empty array) is distinct: it means
   * "the engine has no images right now" (e.g. all anchors evicted).
   */
  images?: ImageRef[];
}

/**
 * Per-terminal inline-image budget snapshot. Returned by
 * `term_image_metrics(id)` and consumed by the status-bar widget so a
 * power user can see how close a session is to the FIFO eviction
 * threshold (50 MiB by default). The IPC returns `null` for an
 * unknown terminal id; the widget treats that as "hide the badge".
 */
export interface ImageMetrics {
  bytesUsed: number;
  cap: number;
  count: number;
}
