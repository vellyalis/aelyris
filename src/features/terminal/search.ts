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
 *
 * Post-0.2.2 Tier 3 #9 — search now also covers retained scrollback. The
 * backend `term_search_history` IPC returns `HistoryMatch` entries; the
 * helpers below combine live and history hits into a single ordered list,
 * and `viewportRowOf` maps either flavour to the row at which it should
 * paint inside the current scrollback-composite viewport.
 */

import { CellAttr, type CellSnapshot, type GridSnapshot, hasAttr } from "../../shared/types/terminal";
import type { SelectionRange } from "./selection";

export interface SearchMatch {
  /** Tag distinguishing live-grid matches from history matches.
   *  Defaulted to `"live"` so existing callers (and tests) keep
   *  working without rewrites. */
  kind?: "live";
  row: number;
  startCol: number;
  /** Inclusive end column. */
  endCol: number;
}

/** Backend-discovered match inside a single retained scrollback row. */
export interface HistoryMatch {
  kind: "history";
  /** History index — `0` is the row immediately above the live screen,
   *  growing into the past. Mirrors `term_history_rows.fromN`. */
  historyIndex: number;
  startCol: number;
  /** Inclusive end column. */
  endCol: number;
}

export type AnyMatch = SearchMatch | HistoryMatch;

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

function isHistoryMatch(m: AnyMatch): m is HistoryMatch {
  return m.kind === "history";
}

function matchKey(m: AnyMatch): string {
  return isHistoryMatch(m) ? `h:${m.historyIndex},${m.startCol},${m.endCol}` : `l:${m.row},${m.startCol},${m.endCol}`;
}

function sameMatch(a: AnyMatch, b: AnyMatch): boolean {
  return matchKey(a) === matchKey(b);
}

/**
 * Reading order across the combined list: oldest first. History rows
 * with the largest `historyIndex` sit furthest in the past, so they
 * come first; live rows follow in row order.
 */
export function compareMatches(a: AnyMatch, b: AnyMatch): number {
  const aHist = isHistoryMatch(a);
  const bHist = isHistoryMatch(b);
  if (aHist && bHist) {
    if (a.historyIndex !== b.historyIndex) return b.historyIndex - a.historyIndex;
    return a.startCol - b.startCol;
  }
  if (aHist) return -1;
  if (bHist) return 1;
  if (a.row !== b.row) return a.row - b.row;
  return a.startCol - b.startCol;
}

/** Combine live + history matches into a single oldest-first list. */
export function combineMatches(
  live: readonly SearchMatch[] | undefined,
  history: readonly HistoryMatch[] | undefined,
): AnyMatch[] {
  const out: AnyMatch[] = [];
  if (history) out.push(...history);
  if (live) out.push(...live);
  out.sort(compareMatches);
  return out;
}

/**
 * Map a match to the row inside the current scrollback-composite
 * viewport, or `null` when the match is not currently visible.
 *
 * Mirrors the layout produced by `useScrollback.compositeCells`:
 *   • `scrollOffset === 0` → entirely live.
 *   • `0 < scrollOffset < rows` → top `scrollOffset` rows are history
 *     (newest at the bottom of that band), the rest are live (top live
 *     row first).
 *   • `scrollOffset >= rows` → entirely history.
 */
export function viewportRowOf(match: AnyMatch, rows: number, scrollOffset: number): number | null {
  if (rows <= 0) return null;
  if (isHistoryMatch(match)) {
    if (scrollOffset === 0) return null;
    const vr = scrollOffset - 1 - match.historyIndex;
    if (vr < 0 || vr >= rows) return null;
    return vr;
  }
  // Live: when fully scrolled into history (offset >= rows) the live
  // grid is offscreen entirely.
  if (scrollOffset >= rows) return null;
  const vr = match.row + scrollOffset;
  if (vr < scrollOffset || vr >= rows) return null;
  return vr;
}

/**
 * Pick a `scrollOffset` that places `match` inside the viewport. Live
 * matches always reset to live view (`0`). For history matches the
 * target lands roughly a third of the way down the visible viewport,
 * matching the iTerm2 / Warp convention so the row above provides
 * context.
 */
export function scrollOffsetForMatch(match: AnyMatch, rows: number): number {
  if (rows <= 0 || !isHistoryMatch(match)) return 0;
  const ideal = match.historyIndex + Math.floor(rows / 3) + 1;
  const minVisible = match.historyIndex + 1;
  return Math.max(minVisible, ideal);
}

/** Walk `matches` in reading order and pick the next one after `current`. */
export function nextMatch(matches: readonly AnyMatch[], current: AnyMatch | null): AnyMatch | null {
  if (matches.length === 0) return null;
  if (!current) return matches[0];
  const idx = matches.findIndex((m) => sameMatch(m, current));
  if (idx < 0) return matches[0];
  return matches[(idx + 1) % matches.length];
}

export function previousMatch(matches: readonly AnyMatch[], current: AnyMatch | null): AnyMatch | null {
  if (matches.length === 0) return null;
  if (!current) return matches[matches.length - 1];
  const idx = matches.findIndex((m) => sameMatch(m, current));
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
