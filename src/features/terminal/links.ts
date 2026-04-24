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

  const lines = buildLogicalLines(snapshot);
  const out: LinkSpan[] = [];

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
