/**
 * Phase 2 / Task 9 — Selection utilities for TerminalCanvas.
 *
 * Pure functions: no DOM, no React. The stateful drag-tracking hook in
 * `hooks/useTerminalSelection` composes these with the browser mouse API.
 *
 * A SelectionRange always stores the original anchor and focus cells — it is
 * NOT pre-normalized, so the hook can tell which end the user grabbed when a
 * later mouse-move crosses the anchor.
 */

import {
  CellAttr,
  hasAttr,
  type CellSnapshot,
  type GridSnapshot,
} from "../../shared/types/terminal";

export interface CellPoint {
  row: number;
  col: number;
}

export interface SelectionRange {
  anchor: CellPoint;
  focus: CellPoint;
  mode: "char" | "word" | "line";
}

export interface NormalizedRange {
  topRow: number;
  topCol: number;
  bottomRow: number;
  bottomCol: number;
}

/** Order the two endpoints so `top` is before `bottom` in reading order. */
export function normalizeRange(range: SelectionRange): NormalizedRange {
  const { anchor, focus } = range;
  const anchorBefore =
    anchor.row < focus.row ||
    (anchor.row === focus.row && anchor.col <= focus.col);
  const start = anchorBefore ? anchor : focus;
  const end = anchorBefore ? focus : anchor;
  return {
    topRow: start.row,
    topCol: start.col,
    bottomRow: end.row,
    bottomCol: end.col,
  };
}

/** True if a (row, col) cell falls inside the selection's inclusive range. */
export function isCellSelected(
  row: number,
  col: number,
  range: SelectionRange,
): boolean {
  const n = normalizeRange(range);
  if (row < n.topRow || row > n.bottomRow) return false;
  if (row === n.topRow && row === n.bottomRow) {
    return col >= n.topCol && col <= n.bottomCol;
  }
  if (row === n.topRow) return col >= n.topCol;
  if (row === n.bottomRow) return col <= n.bottomCol;
  return true;
}

/**
 * Column-range for a single row inside the selection. Returns `null` if the
 * row is outside the selection. `endColExclusive` is the column *after* the
 * last selected cell, so callers can iterate `[startCol, endColExclusive)`.
 */
export interface RowSelection {
  startCol: number;
  endColExclusive: number;
}

export function rowSelection(
  row: number,
  range: SelectionRange,
  cols: number,
): RowSelection | null {
  const n = normalizeRange(range);
  if (row < n.topRow || row > n.bottomRow) return null;
  const start = row === n.topRow ? n.topCol : 0;
  const end = row === n.bottomRow ? n.bottomCol + 1 : cols;
  return { startCol: start, endColExclusive: end };
}

/**
 * Extract the selected text from a snapshot.
 *
 * - Wide-char spacer cells (the second half of a 2-wide glyph) are skipped.
 * - Empty trailing cells on each row are trimmed so copying a full-width
 *   selection doesn't yield a sea of padding spaces.
 * - Rows are joined with `\n`. The bottom row never gets a trailing newline.
 */
export function extractSelection(
  snapshot: GridSnapshot,
  range: SelectionRange,
): string {
  const n = normalizeRange(range);
  const out: string[] = [];

  for (let row = n.topRow; row <= n.bottomRow; row++) {
    const cells = snapshot.cells[row];
    if (!cells) {
      out.push("");
      continue;
    }
    const sel = rowSelection(row, range, snapshot.cols);
    if (!sel) {
      out.push("");
      continue;
    }
    out.push(extractRow(cells, sel.startCol, sel.endColExclusive));
  }

  return out.join("\n");
}

function extractRow(
  cells: CellSnapshot[],
  startCol: number,
  endColExclusive: number,
): string {
  const end = Math.min(endColExclusive, cells.length);
  let buf = "";
  for (let col = startCol; col < end; col++) {
    const cell = cells[col];
    if (!cell) continue;
    if (hasAttr(cell, CellAttr.WIDE_CHAR_SPACER)) continue;
    // Treat \0 padding like an empty cell so it trims cleanly.
    buf += cell.ch === "\0" ? " " : cell.ch;
  }
  // Trim trailing whitespace introduced by empty padding cells.
  return buf.replace(/[ \t]+$/u, "");
}

/**
 * Expand a single cell click into a word-selection range. Words are runs of
 * `\w` (word characters) or symmetric runs of non-word, non-space punctuation.
 * Spaces select just themselves. Wide-char spacers cling to their owner.
 */
export function wordRangeAt(
  snapshot: GridSnapshot,
  row: number,
  col: number,
): SelectionRange | null {
  const cells = snapshot.cells[row];
  if (!cells) return null;
  const clamped = Math.min(Math.max(col, 0), cells.length - 1);
  const startCell = cells[clamped];
  if (!startCell) return null;

  const klass = charClass(startCell.ch);
  if (klass === "space") {
    return {
      anchor: { row, col: clamped },
      focus: { row, col: clamped },
      mode: "word",
    };
  }

  let left = clamped;
  while (left > 0 && charClass(cells[left - 1].ch) === klass) left--;
  let right = clamped;
  while (right < cells.length - 1 && charClass(cells[right + 1].ch) === klass) {
    right++;
  }
  return {
    anchor: { row, col: left },
    focus: { row, col: right },
    mode: "word",
  };
}

/** Expand to the full row. */
export function lineRangeAt(
  snapshot: GridSnapshot,
  row: number,
): SelectionRange | null {
  const cells = snapshot.cells[row];
  if (!cells || cells.length === 0) return null;
  return {
    anchor: { row, col: 0 },
    focus: { row, col: cells.length - 1 },
    mode: "line",
  };
}

type CharClass = "word" | "space" | "punct";

function charClass(ch: string): CharClass {
  if (!ch || ch === "\0" || ch === " " || ch === "\t") return "space";
  if (/\w/u.test(ch)) return "word";
  return "punct";
}
