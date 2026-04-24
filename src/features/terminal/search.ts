/**
 * Phase 2 / Task 11 — Pure text-search utilities for TerminalCanvas.
 *
 * Flatten each row into plain text (mirroring the logical-line build used by
 * links.ts) and find every occurrence of `query`. Each `Match` records its
 * (row, col) start/end anchors so callers can convert it into a SelectionRange
 * and hand it to the canvas for highlighting.
 *
 * The search is row-scoped (no cross-row matches) so wrapped output doesn't
 * produce surprising selections that span the terminal width.
 */

import { CellAttr, type CellSnapshot, type GridSnapshot, hasAttr } from "../../shared/types/terminal";
import type { SelectionRange } from "./selection";

export interface SearchMatch {
  row: number;
  startCol: number;
  /** Inclusive end column. */
  endCol: number;
}

export interface SearchOptions {
  caseSensitive?: boolean;
}

export function findMatches(snapshot: GridSnapshot | null, query: string, options: SearchOptions = {}): SearchMatch[] {
  if (!snapshot || !query) return [];

  const caseSensitive = options.caseSensitive ?? false;
  const needle = caseSensitive ? query : query.toLowerCase();
  const out: SearchMatch[] = [];

  for (let row = 0; row < snapshot.rows; row++) {
    const cells = snapshot.cells[row];
    if (!cells || cells.length === 0) continue;
    const rowText = buildRowText(cells, caseSensitive);
    let searchFrom = 0;
    while (searchFrom <= rowText.text.length - needle.length) {
      const hit = rowText.text.indexOf(needle, searchFrom);
      if (hit < 0) break;
      const startCell = rowText.positions[hit];
      const endCell = rowText.positions[hit + needle.length - 1];
      if (startCell !== undefined && endCell !== undefined) {
        out.push({ row, startCol: startCell, endCol: endCell });
      }
      searchFrom = hit + Math.max(1, needle.length);
    }
  }

  return out;
}

export function matchToRange(match: SearchMatch): SelectionRange {
  return {
    anchor: { row: match.row, col: match.startCol },
    focus: { row: match.row, col: match.endCol },
    mode: "char",
  };
}

/** Walk `matches` in reading order and pick the next one after `current`. */
export function nextMatch(matches: readonly SearchMatch[], current: SearchMatch | null): SearchMatch | null {
  if (matches.length === 0) return null;
  if (!current) return matches[0];
  const idx = matches.findIndex(
    (m) => m.row === current.row && m.startCol === current.startCol && m.endCol === current.endCol,
  );
  if (idx < 0) return matches[0];
  return matches[(idx + 1) % matches.length];
}

export function previousMatch(matches: readonly SearchMatch[], current: SearchMatch | null): SearchMatch | null {
  if (matches.length === 0) return null;
  if (!current) return matches[matches.length - 1];
  const idx = matches.findIndex(
    (m) => m.row === current.row && m.startCol === current.startCol && m.endCol === current.endCol,
  );
  if (idx < 0) return matches[matches.length - 1];
  return matches[(idx - 1 + matches.length) % matches.length];
}

interface RowText {
  text: string;
  /** `positions[i]` is the grid column the character at text[i] came from. */
  positions: number[];
}

function buildRowText(cells: CellSnapshot[], caseSensitive: boolean): RowText {
  let text = "";
  const positions: number[] = [];
  for (let col = 0; col < cells.length; col++) {
    const cell = cells[col];
    if (hasAttr(cell, CellAttr.WIDE_CHAR_SPACER)) continue;
    const raw = cell.ch === "\0" ? " " : cell.ch;
    text += caseSensitive ? raw : raw.toLowerCase();
    positions.push(col);
  }
  return { text, positions };
}
