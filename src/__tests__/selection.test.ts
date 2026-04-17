import { describe, expect, it } from "vitest";

import {
  extractSelection,
  isCellSelected,
  lineRangeAt,
  normalizeRange,
  rowSelection,
  wordRangeAt,
  type SelectionRange,
} from "../features/terminal/selection";
import {
  CellAttr,
  ColorKind,
  type CellSnapshot,
  type GridSnapshot,
} from "../shared/types/terminal";

function packNamed(n: number): number {
  return (ColorKind.NAMED << 24) | n;
}

function cell(ch: string, attrs = 0): CellSnapshot {
  return { ch, fg: packNamed(256), bg: packNamed(257), attrs };
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

describe("normalizeRange", () => {
  it("keeps an already-ordered range intact", () => {
    const r: SelectionRange = {
      anchor: { row: 1, col: 2 },
      focus: { row: 3, col: 5 },
      mode: "char",
    };
    expect(normalizeRange(r)).toEqual({
      topRow: 1,
      topCol: 2,
      bottomRow: 3,
      bottomCol: 5,
    });
  });

  it("swaps when the user drags upward", () => {
    const r: SelectionRange = {
      anchor: { row: 5, col: 2 },
      focus: { row: 2, col: 8 },
      mode: "char",
    };
    expect(normalizeRange(r)).toEqual({
      topRow: 2,
      topCol: 8,
      bottomRow: 5,
      bottomCol: 2,
    });
  });

  it("handles same-row reverse drag", () => {
    const r: SelectionRange = {
      anchor: { row: 1, col: 10 },
      focus: { row: 1, col: 3 },
      mode: "char",
    };
    expect(normalizeRange(r)).toEqual({
      topRow: 1,
      topCol: 3,
      bottomRow: 1,
      bottomCol: 10,
    });
  });
});

describe("isCellSelected", () => {
  const r: SelectionRange = {
    anchor: { row: 1, col: 4 },
    focus: { row: 3, col: 2 },
    mode: "char",
  };

  it("includes the anchor cell", () => {
    expect(isCellSelected(1, 4, r)).toBe(true);
  });

  it("includes the focus cell", () => {
    expect(isCellSelected(3, 2, r)).toBe(true);
  });

  it("excludes cells before the top row's start column", () => {
    expect(isCellSelected(1, 3, r)).toBe(false);
  });

  it("includes cells on interior rows regardless of column", () => {
    expect(isCellSelected(2, 0, r)).toBe(true);
    expect(isCellSelected(2, 99, r)).toBe(true);
  });

  it("excludes rows outside the range", () => {
    expect(isCellSelected(0, 5, r)).toBe(false);
    expect(isCellSelected(4, 1, r)).toBe(false);
  });
});

describe("rowSelection", () => {
  const r: SelectionRange = {
    anchor: { row: 2, col: 3 },
    focus: { row: 4, col: 7 },
    mode: "char",
  };

  it("returns null for rows outside the range", () => {
    expect(rowSelection(0, r, 20)).toBeNull();
    expect(rowSelection(5, r, 20)).toBeNull();
  });

  it("slices the top row from startCol to cols", () => {
    expect(rowSelection(2, r, 20)).toEqual({ startCol: 3, endColExclusive: 20 });
  });

  it("slices the bottom row from 0 to focusCol+1", () => {
    expect(rowSelection(4, r, 20)).toEqual({ startCol: 0, endColExclusive: 8 });
  });

  it("spans the whole line for interior rows", () => {
    expect(rowSelection(3, r, 20)).toEqual({ startCol: 0, endColExclusive: 20 });
  });
});

describe("extractSelection", () => {
  it("pulls a single-row substring", () => {
    const grid = gridFromRows(["hello world"]);
    const range: SelectionRange = {
      anchor: { row: 0, col: 0 },
      focus: { row: 0, col: 4 },
      mode: "char",
    };
    expect(extractSelection(grid, range)).toBe("hello");
  });

  it("joins multiple rows with \\n and trims trailing padding spaces", () => {
    const grid = gridFromRows(["abc   ", "def", "ghi   "]);
    const range: SelectionRange = {
      anchor: { row: 0, col: 0 },
      focus: { row: 2, col: 5 },
      mode: "char",
    };
    expect(extractSelection(grid, range)).toBe("abc\ndef\nghi");
  });

  it("skips WIDE_CHAR_SPACER cells", () => {
    const grid = gridFromRows(["    "]);
    grid.cells[0][0] = { ...cell("漢", CellAttr.WIDE_CHAR) };
    grid.cells[0][1] = { ...cell(" ", CellAttr.WIDE_CHAR_SPACER) };
    grid.cells[0][2] = cell("x");
    const range: SelectionRange = {
      anchor: { row: 0, col: 0 },
      focus: { row: 0, col: 2 },
      mode: "char",
    };
    expect(extractSelection(grid, range)).toBe("漢x");
  });

  it("supports a reverse drag (focus before anchor)", () => {
    const grid = gridFromRows(["hello"]);
    const range: SelectionRange = {
      anchor: { row: 0, col: 4 },
      focus: { row: 0, col: 0 },
      mode: "char",
    };
    expect(extractSelection(grid, range)).toBe("hello");
  });

  it("returns an empty string when the range clips an empty row", () => {
    const grid = gridFromRows(["   ", "abc"]);
    const range: SelectionRange = {
      anchor: { row: 0, col: 0 },
      focus: { row: 0, col: 2 },
      mode: "char",
    };
    expect(extractSelection(grid, range)).toBe("");
  });
});

describe("wordRangeAt", () => {
  it("expands to the surrounding word", () => {
    const grid = gridFromRows(["hello world"]);
    const range = wordRangeAt(grid, 0, 2);
    expect(range).not.toBeNull();
    expect(normalizeRange(range!)).toEqual({
      topRow: 0,
      topCol: 0,
      bottomRow: 0,
      bottomCol: 4,
    });
  });

  it("returns just the space cell when clicking whitespace", () => {
    const grid = gridFromRows(["hi   there"]);
    const range = wordRangeAt(grid, 0, 3);
    expect(range).not.toBeNull();
    expect(normalizeRange(range!)).toEqual({
      topRow: 0,
      topCol: 3,
      bottomRow: 0,
      bottomCol: 3,
    });
  });

  it("treats punctuation as its own word class", () => {
    const grid = gridFromRows(["a==b"]);
    const range = wordRangeAt(grid, 0, 2);
    expect(range).not.toBeNull();
    expect(normalizeRange(range!)).toEqual({
      topRow: 0,
      topCol: 1,
      bottomRow: 0,
      bottomCol: 2,
    });
  });
});

describe("lineRangeAt", () => {
  it("selects the full row", () => {
    const grid = gridFromRows(["hello", "world"]);
    const range = lineRangeAt(grid, 1);
    expect(range).not.toBeNull();
    expect(normalizeRange(range!)).toEqual({
      topRow: 1,
      topCol: 0,
      bottomRow: 1,
      bottomCol: 4,
    });
  });
});
