import { describe, expect, it } from "vitest";
import {
  findAiCliInputAnchor,
  hasAiCliScreenSignature,
  isParkedAiCliCursor,
  isVisibleCursor,
  shouldClampGlyphToCell,
  terminalCellSpan,
} from "../features/terminal/aiInputAnchor";
import { CellAttr, type CellSnapshot, type CursorSnapshot, type GridSnapshot } from "../shared/types/terminal";

function cell(ch: string, attrs = 0): CellSnapshot {
  return { ch, fg: 0, bg: 0, attrs };
}

function row(text: string, cols: number): CellSnapshot[] {
  const cells = [...text].map((ch) => cell(ch));
  while (cells.length < cols) cells.push(cell(" "));
  return cells;
}

function grid(lines: string[], cols = 40): GridSnapshot {
  return {
    cols,
    rows: lines.length,
    cells: lines.map((line) => row(line, cols)),
    cursor: { row: 0, col: 0, shape: "block", blinking: false, visible: true },
  };
}

function cursor(overrides: Partial<CursorSnapshot> = {}): CursorSnapshot {
  return { row: 0, col: 0, shape: "block", blinking: false, visible: true, ...overrides };
}

describe("terminalCellSpan", () => {
  it("counts ASCII as one cell and wide CJK as two", () => {
    expect(terminalCellSpan("abc")).toBe(3);
    expect(terminalCellSpan("あ")).toBe(2);
    expect(terminalCellSpan("aあb")).toBe(4);
    expect(terminalCellSpan("")).toBe(0);
  });
});

describe("shouldClampGlyphToCell", () => {
  it("clamps wide-char cells and non-ASCII glyphs", () => {
    expect(shouldClampGlyphToCell(cell("あ", CellAttr.WIDE_CHAR), "あ")).toBe(true);
    expect(shouldClampGlyphToCell(cell("e"), "あ")).toBe(true);
    expect(shouldClampGlyphToCell(cell("e"), "e")).toBe(false);
  });
});

describe("isVisibleCursor", () => {
  it("narrows to a visible, non-hidden cursor", () => {
    expect(isVisibleCursor(cursor())).toBe(true);
    expect(isVisibleCursor(null)).toBe(false);
    expect(isVisibleCursor(cursor({ visible: false }))).toBe(false);
    expect(isVisibleCursor(cursor({ shape: "hidden" }))).toBe(false);
  });
});

describe("isParkedAiCliCursor", () => {
  const anchor = { row: 5, col: 3 };

  it("is not parked without an anchor", () => {
    expect(isParkedAiCliCursor(grid(["> "]), cursor(), null)).toBe(false);
  });

  it("treats an invisible cursor as parked", () => {
    expect(isParkedAiCliCursor(grid(["> "]), cursor({ visible: false }), anchor)).toBe(true);
  });

  it("treats a cursor pinned to the right edge as parked", () => {
    const snapshot = grid(["status line"], 40);
    expect(isParkedAiCliCursor(snapshot, cursor({ row: 0, col: 39 }), anchor)).toBe(true);
  });

  it("does not consider an actively-typed input cursor parked", () => {
    const lines = Array.from({ length: 6 }, () => "");
    lines[5] = "> hello";
    const snapshot = grid(lines, 40);
    // Cursor sits just past the prompt text on the anchor row — actively typing.
    expect(isParkedAiCliCursor(snapshot, cursor({ row: 5, col: 7 }), anchor)).toBe(false);
  });
});

describe("findAiCliInputAnchor", () => {
  it("returns null without a snapshot", () => {
    expect(findAiCliInputAnchor(null)).toBeNull();
  });

  it("anchors on a recognised input placeholder near the bottom", () => {
    const lines = ["Claude Code", "", "", "", "", "> Type your message"];
    const found = findAiCliInputAnchor(grid(lines, 40));
    expect(found?.row).toBe(5);
    expect(found?.col).toBeGreaterThanOrEqual(0);
  });
});

describe("hasAiCliScreenSignature", () => {
  it("detects an AI CLI screen by its signature text", () => {
    const lines = ["", "", "Claude Code — ? for shortcuts", "", "tokens: 1.2k"];
    expect(hasAiCliScreenSignature(grid(lines, 40))).toBe(true);
  });

  it("returns false for an ordinary shell screen", () => {
    expect(hasAiCliScreenSignature(grid(["user@host:~$ ls", "file.txt"], 40))).toBe(false);
  });
});
