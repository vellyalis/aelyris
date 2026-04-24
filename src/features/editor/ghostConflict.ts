/**
 * Phase 3C-1b — hunk / dirty-range conflict detection.
 *
 * Pure helpers used by EditorPanel to decide which ghost hunks should be
 * painted inline vs. retreated to a file-level badge. Kept free of Monaco
 * imports so the logic stays cheaply unit-testable.
 */

import type { DiffHunk } from "../../shared/types/ghostdiff";

/** 1-based inclusive line range. */
export interface LineRange {
  start: number;
  end: number;
}

/** `true` when two inclusive 1-based line ranges share at least one line. */
export function rangesIntersect(a: LineRange, b: LineRange): boolean {
  return a.start <= b.end && b.start <= a.end;
}

/**
 * Normalize and merge overlapping/adjacent ranges so downstream checks stay
 * O(hunks × ranges) with the minimum distinct range count.
 */
export function mergeRanges(ranges: LineRange[]): LineRange[] {
  if (ranges.length === 0) return [];
  const sorted = [...ranges]
    .map((r) => ({
      start: Math.min(r.start, r.end),
      end: Math.max(r.start, r.end),
    }))
    .sort((a, b) => a.start - b.start);
  const out: LineRange[] = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    const last = out[out.length - 1];
    const cur = sorted[i];
    if (cur.start <= last.end + 1) {
      last.end = Math.max(last.end, cur.end);
    } else {
      out.push(cur);
    }
  }
  return out;
}

/**
 * Convert a hunk's base-side footprint to a 1-based inclusive range.
 *
 * Pure-add hunks have `baseLen === 0`; we still return a 1-line window at
 * `baseStart` so conflict detection treats the insertion point as occupied.
 */
export function hunkBaseRange(hunk: DiffHunk): LineRange {
  if (hunk.baseLen === 0) {
    // Insertion point sits *between* baseStart and baseStart+1; treat the
    // anchor line (baseStart, clamped to 1) as the occupied row.
    const anchor = Math.max(1, hunk.baseStart);
    return { start: anchor, end: anchor };
  }
  return {
    start: hunk.baseStart,
    end: hunk.baseStart + hunk.baseLen - 1,
  };
}

/**
 * Return the set of hunk indices that conflict with the user's dirty line
 * ranges. Callers paint only the non-conflicting hunks inline and report the
 * conflict count to the breadcrumb badge.
 */
export function detectHunkConflicts(dirtyRanges: LineRange[], hunks: DiffHunk[]): Set<number> {
  const merged = mergeRanges(dirtyRanges);
  const conflicts = new Set<number>();
  if (merged.length === 0) return conflicts;
  for (let i = 0; i < hunks.length; i++) {
    const hr = hunkBaseRange(hunks[i]);
    if (merged.some((r) => rangesIntersect(r, hr))) {
      conflicts.add(i);
    }
  }
  return conflicts;
}
