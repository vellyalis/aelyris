import { describe, expect, it } from "vitest";

import {
  type AnyMatch,
  combineMatches,
  compareMatches,
  findMatches,
  type HistoryMatch,
  matchToRange,
  nextMatch,
  previousMatch,
  type SearchMatch,
  scrollOffsetForMatch,
  viewportRowOf,
} from "../features/terminal/search";
import { type CellSnapshot, ColorKind, type GridSnapshot } from "../shared/types/terminal";

function packNamed(n: number): number {
  return (ColorKind.NAMED << 24) | n;
}

function cell(ch: string): CellSnapshot {
  return { ch, fg: packNamed(256), bg: packNamed(257), attrs: 0 };
}

function gridFromRows(rows: string[]): GridSnapshot {
  const cols = Math.max(...rows.map((r) => r.length));
  const cells: CellSnapshot[][] = rows.map((r) => {
    const padded = r.padEnd(cols, " ");
    return Array.from(padded).map((c) => cell(c));
  });
  return {
    cols,
    rows: rows.length,
    cells,
    cursor: { row: 0, col: 0, shape: "block", blinking: false, visible: true },
  };
}

describe("findMatches", () => {
  it("returns an empty list for null snapshot", () => {
    expect(findMatches(null, "foo")).toEqual([]);
  });

  it("returns an empty list for an empty query", () => {
    const grid = gridFromRows(["hello"]);
    expect(findMatches(grid, "")).toEqual([]);
  });

  it("finds a single match", () => {
    const grid = gridFromRows(["the quick fox"]);
    const matches = findMatches(grid, "quick");
    expect(matches).toEqual([{ row: 0, startCol: 4, endCol: 8 }]);
  });

  it("finds multiple matches on the same row", () => {
    const grid = gridFromRows(["abcabcabc"]);
    const matches = findMatches(grid, "abc");
    expect(matches).toEqual([
      { row: 0, startCol: 0, endCol: 2 },
      { row: 0, startCol: 3, endCol: 5 },
      { row: 0, startCol: 6, endCol: 8 },
    ]);
  });

  it("finds matches across rows", () => {
    const grid = gridFromRows(["foo bar", "baz foo"]);
    const matches = findMatches(grid, "foo");
    expect(matches).toEqual([
      { row: 0, startCol: 0, endCol: 2 },
      { row: 1, startCol: 4, endCol: 6 },
    ]);
  });

  it("is case-insensitive by default", () => {
    const grid = gridFromRows(["Hello WORLD hello"]);
    const matches = findMatches(grid, "hello");
    expect(matches).toHaveLength(2);
    expect(matches[0].startCol).toBe(0);
    expect(matches[1].startCol).toBe(12);
  });

  it("respects case-sensitive option", () => {
    const grid = gridFromRows(["Hello hello HELLO"]);
    const matches = findMatches(grid, "hello", { caseSensitive: true });
    expect(matches).toHaveLength(1);
    expect(matches[0].startCol).toBe(6);
  });

  it("does not match across rows", () => {
    const grid = gridFromRows(["fo", "o"]);
    expect(findMatches(grid, "foo")).toEqual([]);
  });
});

describe("matchToRange", () => {
  it("converts a SearchMatch to a SelectionRange on a single row", () => {
    const match: SearchMatch = { row: 2, startCol: 4, endCol: 8 };
    expect(matchToRange(match)).toEqual({
      anchor: { row: 2, col: 4 },
      focus: { row: 2, col: 8 },
      mode: "char",
    });
  });
});

describe("nextMatch / previousMatch", () => {
  const matches: SearchMatch[] = [
    { row: 0, startCol: 0, endCol: 2 },
    { row: 1, startCol: 0, endCol: 2 },
    { row: 2, startCol: 0, endCol: 2 },
  ];

  it("starts at index 0 when no current match", () => {
    expect(nextMatch(matches, null)).toEqual(matches[0]);
  });

  it("wraps around", () => {
    expect(nextMatch(matches, matches[2])).toEqual(matches[0]);
    expect(previousMatch(matches, matches[0])).toEqual(matches[2]);
  });

  it("advances forward and backward", () => {
    expect(nextMatch(matches, matches[0])).toEqual(matches[1]);
    expect(previousMatch(matches, matches[2])).toEqual(matches[1]);
  });

  it("returns null for empty matches", () => {
    expect(nextMatch([], null)).toBeNull();
    expect(previousMatch([], null)).toBeNull();
  });

  it("falls back to first/last when current is not in the list", () => {
    const stray: SearchMatch = { row: 99, startCol: 0, endCol: 0 };
    expect(nextMatch(matches, stray)).toEqual(matches[0]);
    expect(previousMatch(matches, stray)).toEqual(matches[2]);
  });

  it("treats history and live anchors as distinct", () => {
    const live: SearchMatch = { row: 0, startCol: 0, endCol: 2 };
    const hist: HistoryMatch = { kind: "history", historyIndex: 5, startCol: 0, endCol: 2 };
    const list: AnyMatch[] = [hist, live];
    expect(nextMatch(list, hist)).toEqual(live);
    expect(previousMatch(list, live)).toEqual(hist);
    expect(nextMatch(list, live)).toEqual(hist);
  });
});

describe("combineMatches / compareMatches", () => {
  it("places history before live and orders history oldest-first", () => {
    const live: SearchMatch[] = [
      { row: 1, startCol: 0, endCol: 1 },
      { row: 0, startCol: 0, endCol: 1 },
    ];
    const history: HistoryMatch[] = [
      { kind: "history", historyIndex: 0, startCol: 0, endCol: 1 },
      { kind: "history", historyIndex: 5, startCol: 0, endCol: 1 },
      { kind: "history", historyIndex: 5, startCol: 4, endCol: 5 },
    ];
    const out = combineMatches(live, history);
    // Oldest history first (index 5 then index 0), then live row 0
    // before row 1.
    expect(out.map((m) => (m.kind === "history" ? `h${m.historyIndex}c${m.startCol}` : `l${m.row}`))).toEqual([
      "h5c0",
      "h5c4",
      "h0c0",
      "l0",
      "l1",
    ]);
  });

  it("returns an empty list when both inputs are empty", () => {
    expect(combineMatches([], [])).toEqual([]);
    expect(combineMatches(undefined, undefined)).toEqual([]);
  });

  it("compareMatches is consistent with combine ordering", () => {
    const a: HistoryMatch = { kind: "history", historyIndex: 5, startCol: 0, endCol: 1 };
    const b: HistoryMatch = { kind: "history", historyIndex: 1, startCol: 0, endCol: 1 };
    const c: SearchMatch = { row: 0, startCol: 0, endCol: 1 };
    expect(compareMatches(a, b)).toBeLessThan(0);
    expect(compareMatches(a, c)).toBeLessThan(0);
    expect(compareMatches(c, b)).toBeGreaterThan(0);
  });
});

describe("viewportRowOf", () => {
  const ROWS = 10;

  it("paints live matches at their row when not scrolled", () => {
    const m: SearchMatch = { row: 3, startCol: 0, endCol: 0 };
    expect(viewportRowOf(m, ROWS, 0)).toBe(3);
  });

  it("does not paint history matches in live view", () => {
    const m: HistoryMatch = { kind: "history", historyIndex: 0, startCol: 0, endCol: 0 };
    expect(viewportRowOf(m, ROWS, 0)).toBeNull();
  });

  it("places history match at the top of the viewport when scroll matches", () => {
    const m: HistoryMatch = { kind: "history", historyIndex: 4, startCol: 0, endCol: 0 };
    // scrollOffset = 5 means top row of viewport is history index 4.
    expect(viewportRowOf(m, ROWS, 5)).toBe(0);
    // scrollOffset = 8 → top three rows are 7,6,5; index 4 sits at row 3.
    expect(viewportRowOf(m, ROWS, 8)).toBe(3);
  });

  it("hides history matches outside the visible window", () => {
    const m: HistoryMatch = { kind: "history", historyIndex: 50, startCol: 0, endCol: 0 };
    expect(viewportRowOf(m, ROWS, 5)).toBeNull();
    expect(viewportRowOf(m, ROWS, 60)).toBe(9);
  });

  it("hides live matches when fully scrolled into history", () => {
    const m: SearchMatch = { row: 0, startCol: 0, endCol: 0 };
    expect(viewportRowOf(m, ROWS, ROWS)).toBeNull();
    expect(viewportRowOf(m, ROWS, ROWS + 5)).toBeNull();
  });

  it("places live matches in the live half during a partial scroll", () => {
    const m: SearchMatch = { row: 0, startCol: 0, endCol: 0 };
    // scrollOffset = 3 → top 3 rows are history, live row 0 lands at vr 3.
    expect(viewportRowOf(m, ROWS, 3)).toBe(3);
  });
});

describe("scrollOffsetForMatch", () => {
  it("returns 0 for live matches (drop back to live view)", () => {
    expect(scrollOffsetForMatch({ row: 0, startCol: 0, endCol: 0 }, 24)).toBe(0);
  });

  it("places history match roughly a third of the way down the viewport", () => {
    const m: HistoryMatch = { kind: "history", historyIndex: 100, startCol: 0, endCol: 0 };
    const offset = scrollOffsetForMatch(m, 24);
    // viewport row = scrollOffset - 1 - historyIndex
    const vr = offset - 1 - 100;
    expect(vr).toBeGreaterThan(0);
    expect(vr).toBeLessThan(24);
    // Should sit roughly between rows 6 and 10 (24/3 ≈ 8 ± slack).
    expect(vr).toBeGreaterThanOrEqual(8);
  });

  it("never undershoots the minimum visible offset", () => {
    const m: HistoryMatch = { kind: "history", historyIndex: 0, startCol: 0, endCol: 0 };
    const offset = scrollOffsetForMatch(m, 24);
    // index 0 must be visible, so offset must be at least 1.
    expect(offset).toBeGreaterThanOrEqual(1);
  });
});
