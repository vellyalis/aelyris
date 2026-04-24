import { describe, expect, it } from "vitest";

import { detectHunkConflicts, hunkBaseRange, mergeRanges, rangesIntersect } from "../features/editor/ghostConflict";
import type { DiffHunk } from "../shared/types/ghostdiff";

function hunk(baseStart: number, baseLen: number, kinds: ("add" | "remove" | "context")[] = ["add"]): DiffHunk {
  return {
    baseStart,
    baseLen,
    headStart: baseStart,
    headLen: baseLen,
    lines: kinds.map((k) =>
      k === "add"
        ? { kind: "add", text: "+" }
        : k === "remove"
          ? { kind: "remove", text: "-" }
          : { kind: "context", text: " " },
    ),
  };
}

describe("rangesIntersect", () => {
  it("returns true when ranges overlap by one line", () => {
    expect(rangesIntersect({ start: 10, end: 20 }, { start: 20, end: 30 })).toBe(true);
  });

  it("returns false when ranges are strictly disjoint", () => {
    expect(rangesIntersect({ start: 10, end: 15 }, { start: 20, end: 30 })).toBe(false);
  });

  it("returns true when one range contains the other", () => {
    expect(rangesIntersect({ start: 10, end: 100 }, { start: 30, end: 40 })).toBe(true);
  });

  it("returns false for adjacent-but-not-touching ranges", () => {
    expect(rangesIntersect({ start: 10, end: 15 }, { start: 16, end: 20 })).toBe(false);
  });
});

describe("mergeRanges", () => {
  it("returns [] for empty input", () => {
    expect(mergeRanges([])).toEqual([]);
  });

  it("merges adjacent ranges (end + 1 touches next.start)", () => {
    const merged = mergeRanges([
      { start: 1, end: 5 },
      { start: 6, end: 10 },
    ]);
    expect(merged).toEqual([{ start: 1, end: 10 }]);
  });

  it("keeps non-adjacent ranges separate", () => {
    const merged = mergeRanges([
      { start: 1, end: 5 },
      { start: 8, end: 10 },
    ]);
    expect(merged).toEqual([
      { start: 1, end: 5 },
      { start: 8, end: 10 },
    ]);
  });

  it("normalizes inverted ranges (end < start)", () => {
    const merged = mergeRanges([{ start: 10, end: 5 }]);
    expect(merged).toEqual([{ start: 5, end: 10 }]);
  });

  it("sorts unordered input before merging", () => {
    const merged = mergeRanges([
      { start: 50, end: 60 },
      { start: 1, end: 5 },
      { start: 55, end: 70 },
    ]);
    expect(merged).toEqual([
      { start: 1, end: 5 },
      { start: 50, end: 70 },
    ]);
  });
});

describe("hunkBaseRange", () => {
  it("returns baseStart..baseStart+baseLen-1 for sized hunks", () => {
    expect(hunkBaseRange(hunk(10, 3))).toEqual({ start: 10, end: 12 });
  });

  it("treats pure-add hunks (baseLen=0) as a single anchor line", () => {
    expect(hunkBaseRange(hunk(10, 0, ["add"]))).toEqual({ start: 10, end: 10 });
  });

  it("clamps anchor line to >= 1 for baseLen=0 hunks at file top", () => {
    expect(hunkBaseRange(hunk(0, 0, ["add"]))).toEqual({ start: 1, end: 1 });
  });
});

describe("detectHunkConflicts", () => {
  it("returns an empty set when the user has not modified anything", () => {
    const conflicts = detectHunkConflicts([], [hunk(10, 3), hunk(20, 5)]);
    expect(conflicts.size).toBe(0);
  });

  it("flags only hunks that overlap dirty ranges", () => {
    const hunks = [hunk(10, 3), hunk(20, 3), hunk(40, 3)];
    const dirty = [{ start: 21, end: 22 }];
    const conflicts = detectHunkConflicts(dirty, hunks);
    expect(conflicts.has(0)).toBe(false);
    expect(conflicts.has(1)).toBe(true);
    expect(conflicts.has(2)).toBe(false);
  });

  it("flags edge overlap (dirty range just touches hunk end)", () => {
    const hunks = [hunk(10, 5)]; // covers 10..14
    const dirty = [{ start: 14, end: 20 }];
    expect(detectHunkConflicts(dirty, hunks).has(0)).toBe(true);
  });

  it("does not flag hunks when dirty range is strictly before", () => {
    const hunks = [hunk(10, 5)];
    const dirty = [{ start: 1, end: 9 }];
    expect(detectHunkConflicts(dirty, hunks).has(0)).toBe(false);
  });

  it("flags pure-add hunks whose anchor line is dirty", () => {
    const hunks = [hunk(42, 0, ["add"])];
    const dirty = [{ start: 42, end: 42 }];
    expect(detectHunkConflicts(dirty, hunks).has(0)).toBe(true);
  });

  it("merges overlapping dirty ranges before comparing", () => {
    const hunks = [hunk(50, 1)];
    const dirty = [
      { start: 10, end: 40 },
      { start: 41, end: 50 }, // becomes 10..50 after merge
    ];
    expect(detectHunkConflicts(dirty, hunks).has(0)).toBe(true);
  });

  it("handles multiple hunks independently", () => {
    const hunks = [hunk(10, 3), hunk(30, 3), hunk(60, 3)];
    const dirty = [
      { start: 10, end: 11 },
      { start: 60, end: 61 },
    ];
    const conflicts = detectHunkConflicts(dirty, hunks);
    expect(conflicts.has(0)).toBe(true);
    expect(conflicts.has(1)).toBe(false);
    expect(conflicts.has(2)).toBe(true);
  });
});
