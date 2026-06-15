/**
 * Pure row-dirty / search-key helpers for the terminal canvas diff loop.
 *
 * Extracted from TerminalCanvas so this logic is unit-testable without a
 * canvas context: the search-match cache key, the per-row dirty masks for
 * search bands and hovered links, and the cursor-row printable check. None of
 * these touch the canvas, the DOM, or React — they map snapshots/matches to
 * strings and row sets.
 */
import type { GridSnapshot } from "../../shared/types/terminal";
import type { LinkSpan } from "./links";
import { type AnyMatch, viewportRowOf } from "./search";

export function matchAnchor(m: AnyMatch): string {
  return m.kind === "history"
    ? `h:${m.historyIndex},${m.startCol},${m.endCol}`
    : `l:${m.row},${m.startCol},${m.endCol}`;
}

export function buildMatchesKey(
  matches: readonly AnyMatch[] | undefined,
  active: AnyMatch | null | undefined,
  scrollOffset: number,
): string {
  // The scroll offset is part of the cache key because viewport rows
  // shift as the user scrolls — a match that was painted on row 5 at
  // offset 0 paints on row 6 once the offset advances by 1.
  let s = `s:${scrollOffset};`;
  if (matches) {
    for (const m of matches) s += `${matchAnchor(m)};`;
  }
  if (active) s += `@${matchAnchor(active)}`;
  return s;
}

export function buildRowMask(
  matches: readonly AnyMatch[] | undefined,
  active: AnyMatch | null | undefined,
  totalRows: number,
  scrollOffset: number,
): Set<number> {
  const rows = new Set<number>();
  if (matches) {
    for (const m of matches) {
      const vr = viewportRowOf(m, totalRows, scrollOffset);
      if (vr !== null) rows.add(vr);
    }
  }
  if (active) {
    const vr = viewportRowOf(active, totalRows, scrollOffset);
    if (vr !== null) rows.add(vr);
  }
  return rows;
}

export function rowsCoveredByLink(...links: Array<LinkSpan | null | undefined>): Set<number> {
  const rows = new Set<number>();
  for (const link of links) {
    if (!link) continue;
    for (let r = link.startRow; r <= link.endRow; r++) rows.add(r);
  }
  return rows;
}

/** Any printable glyph to the right of the cursor on its row? */
export function hasPrintableAfterCursor(snapshot: GridSnapshot): boolean {
  const row = snapshot.cells[snapshot.cursor.row];
  if (!row) return false;
  for (let col = snapshot.cursor.col; col < row.length; col++) {
    const cell = row[col];
    if (!cell) continue;
    if (cell.ch && cell.ch !== " " && cell.ch !== "\0") return true;
  }
  return false;
}
