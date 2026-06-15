import { describe, expect, it } from "vitest";
import { type RowRepaintFlags, shouldRepaintRow } from "../features/terminal/repaintDecision";

const ALL_CLEAN: RowRepaintFlags = {
  dimsChanged: false,
  canvasGeometryChanged: false,
  viewModeChanged: false,
  selDirtyRow: false,
  matchDirtyRow: false,
  hoverDirtyRow: false,
  cursorDirtyRow: false,
  rowContentChanged: false,
};

describe("shouldRepaintRow", () => {
  it("skips a row only when nothing changed", () => {
    expect(shouldRepaintRow(ALL_CLEAN)).toBe(false);
  });

  it("repaints when the row content changed by reference", () => {
    expect(shouldRepaintRow({ ...ALL_CLEAN, rowContentChanged: true })).toBe(true);
  });

  // Regression: scrolling back to the live view on an unchanged snapshot must
  // still repaint every row, otherwise composite scrollback pixels painted
  // while scrolled up are left on the canvas (the "表示がずれる" bug).
  it("forces a repaint on a live<->composite view switch even when content is unchanged", () => {
    expect(shouldRepaintRow({ ...ALL_CLEAN, viewModeChanged: true })).toBe(true);
  });

  it.each([
    ["dimsChanged"],
    ["canvasGeometryChanged"],
    ["selDirtyRow"],
    ["matchDirtyRow"],
    ["hoverDirtyRow"],
    ["cursorDirtyRow"],
  ] as const)("repaints when %s is set", (flag) => {
    expect(shouldRepaintRow({ ...ALL_CLEAN, [flag]: true })).toBe(true);
  });
});
