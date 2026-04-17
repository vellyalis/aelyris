import { render, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TerminalCanvas } from "../features/terminal/TerminalCanvas";
import type { GridSnapshot } from "../shared/types/terminal";

interface PaintOp {
  type: "text" | "rect";
  args: unknown[];
}

function installCanvasSpy() {
  const ops: PaintOp[] = [];
  const ctx: Partial<CanvasRenderingContext2D> = {
    globalAlpha: 1,
    fillStyle: "",
    font: "",
    textBaseline: "top",
    fillRect: vi.fn((...a: unknown[]) => {
      ops.push({ type: "rect", args: a });
    }) as unknown as CanvasRenderingContext2D["fillRect"],
    fillText: vi.fn((...a: unknown[]) => {
      ops.push({ type: "text", args: a });
    }) as unknown as CanvasRenderingContext2D["fillText"],
    save: vi.fn(),
    restore: vi.fn(),
    measureText: vi.fn(() => ({ width: 8 }) as TextMetrics),
  };
  HTMLCanvasElement.prototype.getContext = vi.fn(
    () => ctx as CanvasRenderingContext2D,
  ) as unknown as HTMLCanvasElement["getContext"];
  return ops;
}

function blankSnapshot(): GridSnapshot {
  return {
    cols: 40,
    rows: 3,
    cells: Array.from({ length: 3 }, () =>
      Array.from({ length: 40 }, () => ({ ch: " ", fg: 256, bg: 257, attrs: 0 })),
    ),
    cursor: { row: 0, col: 6, shape: "hidden", visible: true, blinking: false },
  };
}

describe("TerminalCanvas ghost suggestion", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("paints the suggestion text at the cursor position", () => {
    const ops = installCanvasSpy();
    render(
      <TerminalCanvas
        terminalId="t"
        cols={40}
        rows={3}
        fontSize={14}
        snapshotOverride={blankSnapshot()}
        ghostSuggestion="tatus"
      />,
    );
    const charCalls = ops
      .filter((o) => o.type === "text")
      .map((o) => String(o.args[0]));
    // Every glyph of the suggestion should have been drawn.
    for (const ch of "tatus") {
      expect(charCalls).toContain(ch);
    }
  });

  it("does not paint when ghost is null", () => {
    const ops = installCanvasSpy();
    render(
      <TerminalCanvas
        terminalId="t"
        cols={40}
        rows={3}
        fontSize={14}
        snapshotOverride={blankSnapshot()}
        ghostSuggestion={null}
      />,
    );
    const charCalls = ops
      .filter((o) => o.type === "text")
      .map((o) => String(o.args[0]));
    // No stray ghost glyphs — the default blank snapshot has only " ".
    expect(charCalls.filter((c) => /[a-z]/.test(c))).toHaveLength(0);
  });

  it("skips the paint when there is text to the right of the cursor", () => {
    const ops = installCanvasSpy();
    const snap = blankSnapshot();
    // Place a real char right after the cursor (col 6) on row 0.
    snap.cells[0][7] = { ch: "x", fg: 256, bg: 257, attrs: 0 };
    render(
      <TerminalCanvas
        terminalId="t"
        cols={40}
        rows={3}
        fontSize={14}
        snapshotOverride={snap}
        ghostSuggestion="tatus"
      />,
    );
    const charCalls = ops
      .filter((o) => o.type === "text")
      .map((o) => String(o.args[0]));
    expect(charCalls).toContain("x"); // real char was painted
    expect(charCalls.filter((c) => c === "t")).toHaveLength(0); // ghost suppressed
  });
});
