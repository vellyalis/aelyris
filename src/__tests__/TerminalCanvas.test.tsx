import { render, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TerminalCanvas } from "../features/terminal/TerminalCanvas";
import type {
  CellSnapshot,
  CursorSnapshot,
  GridSnapshot,
} from "../shared/types/terminal";

// jsdom's HTMLCanvasElement.getContext returns null by default — stub a
// minimal 2D context so the component can exercise its paint logic.
type CallLog = Array<{ op: string; args: unknown[] }>;

function installCanvasMock(): CallLog {
  const calls: CallLog = [];
  const ctx: Partial<CanvasRenderingContext2D> = {
    fillRect: vi.fn((...args) => {
      calls.push({ op: "fillRect", args });
    }),
    fillText: vi.fn((...args) => {
      calls.push({ op: "fillText", args });
    }),
    measureText: vi.fn(() => ({ width: 8 }) as TextMetrics),
    set fillStyle(value: string) {
      calls.push({ op: "fillStyle", args: [value] });
    },
    set font(value: string) {
      calls.push({ op: "font", args: [value] });
    },
    set textBaseline(value: CanvasTextBaseline) {
      calls.push({ op: "textBaseline", args: [value] });
    },
  };
  HTMLCanvasElement.prototype.getContext = vi.fn(
    () => ctx as CanvasRenderingContext2D,
  ) as unknown as HTMLCanvasElement["getContext"];
  return calls;
}

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

function snapshot(rows: CellSnapshot[][], cur: Partial<CursorSnapshot> = {}): GridSnapshot {
  return {
    cols: rows[0]?.length ?? 0,
    rows: rows.length,
    cells: rows,
    cursor: { ...cursor, ...cur },
  };
}

describe("TerminalCanvas", () => {
  let calls: CallLog;

  beforeEach(() => {
    calls = installCanvasMock();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders a <canvas> sized from cols/rows/fontSize", () => {
    const { getByTestId } = render(
      <TerminalCanvas
        terminalId="t1"
        cols={10}
        rows={3}
        fontSize={14}
        snapshotOverride={null}
      />,
    );
    const canvas = getByTestId("terminal-canvas") as HTMLCanvasElement;
    expect(canvas.width).toBe(10 * Math.round(14 * 0.6));
    expect(canvas.height).toBe(3 * Math.round(14 * 1.25));
    expect(canvas.getAttribute("data-terminal-id")).toBe("t1");
  });

  it("paints cell characters via fillText when a snapshot is provided", () => {
    const snap = snapshot([[cell("h"), cell("i"), cell(" ")]]);
    render(
      <TerminalCanvas
        terminalId="t1"
        cols={3}
        rows={1}
        snapshotOverride={snap}
      />,
    );
    const drawnChars = calls
      .filter((c) => c.op === "fillText")
      .map((c) => c.args[0] as string);
    expect(drawnChars).toContain("h");
    expect(drawnChars).toContain("i");
    // Space cells must not trigger fillText — they're cleared by the row wipe.
    expect(drawnChars).not.toContain(" ");
  });

  it("skips redraw for rows whose reference is unchanged", () => {
    const row0 = [cell("a"), cell("b")];
    const row1 = [cell("c"), cell("d")];
    const first = snapshot([row0, row1]);
    const { rerender } = render(
      <TerminalCanvas
        terminalId="t1"
        cols={2}
        rows={2}
        snapshotOverride={first}
      />,
    );
    const baselineFillText = calls.filter((c) => c.op === "fillText").length;

    // Replace only row0 — row1 keeps its reference exactly as applyDiff would.
    const row0New = [cell("A"), cell("B")];
    const second: GridSnapshot = {
      ...first,
      cells: [row0New, row1],
    };
    rerender(
      <TerminalCanvas
        terminalId="t1"
        cols={2}
        rows={2}
        snapshotOverride={second}
      />,
    );

    const newFillText = calls
      .filter((c) => c.op === "fillText")
      .slice(baselineFillText)
      .map((c) => c.args[0] as string);
    expect(newFillText).toEqual(expect.arrayContaining(["A", "B"]));
    expect(newFillText).not.toContain("c");
    expect(newFillText).not.toContain("d");
  });

  it("draws a block cursor as a filled rect", () => {
    const snap = snapshot([[cell("x"), cell("y")]], { row: 0, col: 1, shape: "block" });
    render(
      <TerminalCanvas
        terminalId="t1"
        cols={2}
        rows={1}
        fontSize={10}
        snapshotOverride={snap}
      />,
    );
    const cellW = Math.round(10 * 0.6);
    const cellH = Math.round(10 * 1.25);
    const cursorRect = calls.find(
      (c) =>
        c.op === "fillRect" &&
        (c.args[0] as number) === 1 * cellW &&
        (c.args[1] as number) === 0 &&
        (c.args[2] as number) === cellW &&
        (c.args[3] as number) === cellH,
    );
    expect(cursorRect, "expected a fillRect matching the block cursor at (1,0)").toBeDefined();
  });

  it("draws a beam cursor as a 2px vertical bar", () => {
    const snap = snapshot([[cell(" ")]], { row: 0, col: 0, shape: "beam" });
    render(
      <TerminalCanvas
        terminalId="t1"
        cols={1}
        rows={1}
        fontSize={10}
        snapshotOverride={snap}
      />,
    );
    const cellH = Math.round(10 * 1.25);
    const beam = calls.find(
      (c) =>
        c.op === "fillRect" &&
        (c.args[2] as number) === 2 &&
        (c.args[3] as number) === cellH,
    );
    expect(beam).toBeDefined();
  });

  it("hides the cursor when shape is 'hidden'", () => {
    const snap = snapshot([[cell("x")]], { shape: "hidden", visible: true });
    render(
      <TerminalCanvas
        terminalId="t1"
        cols={1}
        rows={1}
        snapshotOverride={snap}
      />,
    );
    const cursorFills = calls.filter(
      (c) => c.op === "fillStyle" && (c.args[0] as string) === "#cba6f7",
    );
    expect(cursorFills).toHaveLength(0);
  });
});
