import { describe, expect, it } from "vitest";

import { applyDiff } from "../shared/hooks/useTerminalSnapshot";
import type { CellSnapshot, CursorSnapshot, GridDiff, GridSnapshot } from "../shared/types/terminal";

const cursor: CursorSnapshot = {
  row: 0,
  col: 0,
  shape: "block",
  blinking: false,
  visible: true,
};

function cell(ch: string): CellSnapshot {
  return { ch, fg: 0, bg: 0, attrs: 0 };
}

function blankRow(cols: number): CellSnapshot[] {
  return Array.from({ length: cols }, () => cell(" "));
}

describe("applyDiff", () => {
  it("builds from scratch on a full frame", () => {
    const diff: GridDiff = {
      cols: 3,
      rows_total: 2,
      full: true,
      cursor,
      cursor_changed: true,
      rows: [
        { row: 0, cells: [cell("a"), cell("b"), cell("c")] },
        { row: 1, cells: [cell("x"), cell("y"), cell("z")] },
      ],
    };
    const snap = applyDiff(null, diff);
    expect(snap.cols).toBe(3);
    expect(snap.rows).toBe(2);
    expect(snap.cells[0][0].ch).toBe("a");
    expect(snap.cells[1][2].ch).toBe("z");
  });

  it("treats missing rows in a full frame as blanks", () => {
    const diff: GridDiff = {
      cols: 2,
      rows_total: 3,
      full: true,
      cursor,
      cursor_changed: true,
      rows: [{ row: 1, cells: [cell("h"), cell("i")] }],
    };
    const snap = applyDiff(null, diff);
    expect(snap.cells[0]).toEqual(blankRow(2));
    expect(snap.cells[1][0].ch).toBe("h");
    expect(snap.cells[2]).toEqual(blankRow(2));
  });

  it("forces a full frame when dimensions change", () => {
    const prev: GridSnapshot = {
      cols: 2,
      rows: 2,
      cells: [
        [cell("a"), cell("b")],
        [cell("c"), cell("d")],
      ],
      cursor,
    };
    const diff: GridDiff = {
      cols: 3,
      rows_total: 2,
      full: false,
      cursor,
      cursor_changed: false,
      rows: [{ row: 0, cells: [cell("x"), cell("y"), cell("z")] }],
    };
    const snap = applyDiff(prev, diff);
    expect(snap.cols).toBe(3);
    expect(snap.cells[0][2].ch).toBe("z");
    expect(snap.cells[1]).toEqual(blankRow(3));
  });

  it("patches only the rows listed in a partial diff", () => {
    const prev: GridSnapshot = {
      cols: 2,
      rows: 3,
      cells: [
        [cell("a"), cell("b")],
        [cell("c"), cell("d")],
        [cell("e"), cell("f")],
      ],
      cursor,
    };
    const nextCursor = { ...cursor, col: 1 };
    const diff: GridDiff = {
      cols: 2,
      rows_total: 3,
      full: false,
      cursor: nextCursor,
      cursor_changed: true,
      rows: [{ row: 1, cells: [cell("C"), cell("D")] }],
    };
    const snap = applyDiff(prev, diff);
    expect(snap.cells[0][0].ch).toBe("a");
    expect(snap.cells[1][0].ch).toBe("C");
    expect(snap.cells[2][0].ch).toBe("e");
    expect(snap.cursor.col).toBe(1);
  });

  it("updates cursor even when no rows are sent", () => {
    const prev: GridSnapshot = {
      cols: 2,
      rows: 1,
      cells: [[cell("a"), cell("b")]],
      cursor,
    };
    const nextCursor = { ...cursor, col: 2 };
    const diff: GridDiff = {
      cols: 2,
      rows_total: 1,
      full: false,
      cursor: nextCursor,
      cursor_changed: true,
      rows: [],
    };
    const snap = applyDiff(prev, diff);
    expect(snap.cursor.col).toBe(2);
    expect(snap.cells).toEqual(prev.cells);
  });
});
