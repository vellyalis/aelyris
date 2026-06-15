import { describe, expect, it } from "vitest";
import { type LinkSpan } from "../features/terminal/links";
import {
  buildMatchesKey,
  buildRowMask,
  hasPrintableAfterCursor,
  matchAnchor,
  rowsCoveredByLink,
} from "../features/terminal/terminalRowDirty";
import type { AnyMatch } from "../features/terminal/search";
import type { CellSnapshot, GridSnapshot } from "../shared/types/terminal";

function cell(ch: string): CellSnapshot {
  return { ch, fg: 0, bg: 0, attrs: 0 };
}

function grid(line: string, cursorCol: number, cursorRow = 0): GridSnapshot {
  return {
    cols: line.length,
    rows: 1,
    cells: [[...line].map(cell)],
    cursor: { row: cursorRow, col: cursorCol, shape: "block", blinking: false, visible: true },
  };
}

function link(startRow: number, endRow: number): LinkSpan {
  return { url: "https://x", startRow, startCol: 0, endRow, endCol: 1 };
}

describe("matchAnchor", () => {
  it("encodes live vs history matches distinctly", () => {
    expect(matchAnchor({ row: 3, startCol: 2, endCol: 5 })).toBe("l:3,2,5");
    expect(matchAnchor({ kind: "history", historyIndex: 4, startCol: 1, endCol: 2 })).toBe("h:4,1,2");
  });
});

describe("buildMatchesKey", () => {
  it("is just the scroll prefix when there are no matches", () => {
    expect(buildMatchesKey(undefined, null, 0)).toBe("s:0;");
  });

  it("includes the scroll offset so a scrolled viewport invalidates the key", () => {
    const matches: AnyMatch[] = [{ row: 1, startCol: 0, endCol: 1 }];
    expect(buildMatchesKey(matches, null, 0)).toBe("s:0;l:1,0,1;");
    expect(buildMatchesKey(matches, null, 2)).toBe("s:2;l:1,0,1;");
  });

  it("appends the active match anchor", () => {
    const matches: AnyMatch[] = [{ row: 1, startCol: 0, endCol: 1 }];
    const active: AnyMatch = { row: 1, startCol: 0, endCol: 1 };
    expect(buildMatchesKey(matches, active, 0)).toBe("s:0;l:1,0,1;@l:1,0,1");
  });
});

describe("buildRowMask", () => {
  it("maps matches to viewport rows and dedupes", () => {
    const matches: AnyMatch[] = [
      { row: 1, startCol: 0, endCol: 1 },
      { row: 3, startCol: 0, endCol: 1 },
      { row: 1, startCol: 4, endCol: 6 }, // same viewport row as the first -> deduped
    ];
    const mask = buildRowMask(matches, null, 10, 0);
    expect([...mask].sort((a, b) => a - b)).toEqual([1, 3]);
  });

  it("drops matches that fall outside the viewport", () => {
    const matches: AnyMatch[] = [{ row: 12, startCol: 0, endCol: 1 }]; // row >= rows -> null
    expect(buildRowMask(matches, null, 10, 0).size).toBe(0);
  });
});

describe("rowsCoveredByLink", () => {
  it("expands inclusive row ranges across links and ignores nullish", () => {
    const mask = rowsCoveredByLink(link(2, 4), null, link(4, 5), undefined);
    expect([...mask].sort((a, b) => a - b)).toEqual([2, 3, 4, 5]);
  });
});

describe("hasPrintableAfterCursor", () => {
  it("is true when a printable glyph sits at or after the cursor", () => {
    expect(hasPrintableAfterCursor(grid("ab", 0))).toBe(true);
    expect(hasPrintableAfterCursor(grid("a ", 1))).toBe(false); // only a space after the cursor
  });

  it("is false when the cursor row is missing", () => {
    expect(hasPrintableAfterCursor(grid("ab", 0, 5))).toBe(false);
  });
});
