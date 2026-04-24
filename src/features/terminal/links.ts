/**
 * Phase 2 / Task 11 — Pure link-detection utilities for TerminalCanvas.
 *
 * Flatten the grid into per-row text, scan for URLs, and report each hit as a
 * LinkSpan anchored in cell coordinates. Wrapped URLs (rows ending with the
 * WRAPLINE attr) stitch into a single logical string so a URL that spans two
 * rows is detected and reported with its two-row span.
 */

import { CellAttr, type CellSnapshot, type GridSnapshot, hasAttr } from "../../shared/types/terminal";

export interface LinkSpan {
  url: string;
  startRow: number;
  startCol: number;
  endRow: number;
  endCol: number;
}

const URL_REGEX = /\b(?:https?|ftp|file):\/\/[^\s<>"`\u0000-\u001f]+/g;

const TRAILING_PUNCT = /[.,;:!?)\]}>'"]+$/u;

export function scanLinks(snapshot: GridSnapshot | null): LinkSpan[] {
  if (!snapshot) return [];

  const out: LinkSpan[] = [];

  // OSC 8 explicit hyperlinks win over regex detection because they
  // carry the shell's intended URI — that might differ from what the
  // visible text looks like (e.g. `ls --hyperlink` renders filenames
  // but the link points at file://). Emit them first so the click
  // handler picks them up before the regex fallback would.
  const osc8Spans = scanOsc8Hyperlinks(snapshot);
  out.push(...osc8Spans);

  const lines = buildLogicalLines(snapshot);
  for (const line of lines) {
    URL_REGEX.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = URL_REGEX.exec(line.text))) {
      const rawStart = match.index;
      let url = match[0];
      const trimmed = url.replace(TRAILING_PUNCT, "");
      if (!trimmed) continue;
      url = trimmed;
      const rawEndExclusive = rawStart + url.length;
      const startCell = line.positions[rawStart];
      const endCell = line.positions[rawEndExclusive - 1];
      if (!startCell || !endCell) continue;
      // Skip this regex match if it lands on a cell that is already
      // covered by an OSC 8 span — otherwise the same coordinates
      // would carry two stacked LinkSpans with ambiguous click targets.
      if (spanOverlapsOsc8(osc8Spans, startCell, endCell)) continue;
      out.push({
        url,
        startRow: startCell.row,
        startCol: startCell.col,
        endRow: endCell.row,
        endCol: endCell.col,
      });
    }
  }

  return out;
}

function scanOsc8Hyperlinks(snapshot: GridSnapshot): LinkSpan[] {
  const out: LinkSpan[] = [];
  let open: LinkSpan | null = null;

  for (let row = 0; row < snapshot.rows; row++) {
    const cells = snapshot.cells[row];
    if (!cells) continue;
    for (let col = 0; col < cells.length; col++) {
      const uri = cells[col].hyperlink;
      if (!uri) {
        if (open) {
          out.push(open);
          open = null;
        }
        continue;
      }
      if (open && open.url === uri) {
        open.endRow = row;
        open.endCol = col;
      } else {
        if (open) out.push(open);
        open = { url: uri, startRow: row, startCol: col, endRow: row, endCol: col };
      }
    }
    // Only close the run at row boundary when the row is NOT a wraparound
    // continuation — otherwise a hyperlink that wraps to the next row
    // stays merged as a single span.
    const tail = cells[cells.length - 1];
    if (!tail || !hasAttr(tail, CellAttr.WRAPLINE)) {
      if (open) {
        out.push(open);
        open = null;
      }
    }
  }
  if (open) out.push(open);
  return out;
}

function spanOverlapsOsc8(
  osc8: readonly LinkSpan[],
  start: { row: number; col: number },
  end: { row: number; col: number },
): boolean {
  for (const s of osc8) {
    const rowOverlap = !(end.row < s.startRow || start.row > s.endRow);
    if (rowOverlap) return true;
  }
  return false;
}

export function linkAt(links: readonly LinkSpan[], row: number, col: number): LinkSpan | null {
  for (const link of links) {
    if (isCellInLink(link, row, col)) return link;
  }
  return null;
}

function isCellInLink(link: LinkSpan, row: number, col: number): boolean {
  if (row < link.startRow || row > link.endRow) return false;
  if (row === link.startRow && row === link.endRow) {
    return col >= link.startCol && col <= link.endCol;
  }
  if (row === link.startRow) return col >= link.startCol;
  if (row === link.endRow) return col <= link.endCol;
  return true;
}

interface LogicalLine {
  text: string;
  positions: Array<{ row: number; col: number }>;
}

function buildLogicalLines(snapshot: GridSnapshot): LogicalLine[] {
  const lines: LogicalLine[] = [];
  let current: LogicalLine | null = null;

  for (let row = 0; row < snapshot.rows; row++) {
    const cells = snapshot.cells[row];
    if (!cells) continue;
    if (!current) current = { text: "", positions: [] };
    appendRow(current, cells, row);
    const isWrapped = cells.length > 0 && hasAttr(cells[cells.length - 1], CellAttr.WRAPLINE);
    if (!isWrapped) {
      lines.push(current);
      current = null;
    }
  }
  if (current) lines.push(current);

  return lines;
}

function appendRow(line: LogicalLine, cells: CellSnapshot[], row: number) {
  for (let col = 0; col < cells.length; col++) {
    const cell = cells[col];
    if (hasAttr(cell, CellAttr.WIDE_CHAR_SPACER)) continue;
    const ch = cell.ch === "\0" ? " " : cell.ch;
    line.text += ch;
    line.positions.push({ row, col });
  }
}
