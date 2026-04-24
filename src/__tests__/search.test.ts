import { describe, expect, it } from "vitest";

import { findMatches, matchToRange, nextMatch, previousMatch, type SearchMatch } from "../features/terminal/search";
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
});
