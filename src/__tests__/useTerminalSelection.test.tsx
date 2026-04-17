import { act, render, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TerminalCanvas } from "../features/terminal/TerminalCanvas";
import {
  ColorKind,
  type CellSnapshot,
  type GridSnapshot,
} from "../shared/types/terminal";

function installCanvasMock() {
  const noop = vi.fn();
  const ctx: Partial<CanvasRenderingContext2D> = {
    fillRect: noop,
    fillText: noop,
    save: noop,
    restore: noop,
    measureText: vi.fn(() => ({ width: 8 }) as TextMetrics),
  };
  HTMLCanvasElement.prototype.getContext = vi.fn(
    () => ctx as CanvasRenderingContext2D,
  ) as unknown as HTMLCanvasElement["getContext"];
  // jsdom returns 0-size rects by default — fake a 80*14 × 24*17 canvas.
  HTMLCanvasElement.prototype.getBoundingClientRect = function () {
    return {
      left: 0,
      top: 0,
      right: 80 * 14,
      bottom: 24 * 17,
      width: 80 * 14,
      height: 24 * 17,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect;
  };
}

function packNamed(n: number): number {
  return (ColorKind.NAMED << 24) | n;
}

function cell(ch: string): CellSnapshot {
  return { ch, fg: packNamed(256), bg: packNamed(257), attrs: 0 };
}

function gridFromRows(rows: string[]): GridSnapshot {
  const cols = Math.max(...rows.map((r) => r.length), 1);
  const cells: CellSnapshot[][] = rows.map((r) =>
    Array.from(r.padEnd(cols, " ")).map((c) => cell(c)),
  );
  return {
    cols,
    rows: rows.length,
    cells,
    cursor: {
      row: 0,
      col: 0,
      shape: "hidden",
      blinking: false,
      visible: false,
    },
  };
}

function downUpDrag(
  el: HTMLElement,
  from: { x: number; y: number },
  to: { x: number; y: number },
) {
  el.dispatchEvent(
    new MouseEvent("mousedown", {
      bubbles: true,
      button: 0,
      clientX: from.x,
      clientY: from.y,
    }),
  );
  window.dispatchEvent(
    new MouseEvent("mousemove", {
      bubbles: true,
      clientX: to.x,
      clientY: to.y,
    }),
  );
  window.dispatchEvent(
    new MouseEvent("mouseup", { bubbles: true, button: 0 }),
  );
}

describe("TerminalCanvas — selection + copy (Task 9)", () => {
  beforeEach(installCanvasMock);
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("extracts and copies a single-line drag", async () => {
    // Metrics: fontSize 14 → cellWidth round(14*0.6)=8, cellHeight round(14*1.25)=18.
    const grid = gridFromRows(["hello world"]);
    const copyText = vi.fn().mockResolvedValue(undefined);

    const { getByTestId } = render(
      <TerminalCanvas
        terminalId="t1"
        cols={11}
        rows={1}
        fontSize={14}
        snapshotOverride={grid}
        copyText={copyText}
      />,
    );
    const canvas = getByTestId("terminal-canvas") as HTMLCanvasElement;

    // Drag from cell (0,0) to (0,4) → should select "hello".
    await act(async () => {
      downUpDrag(canvas, { x: 0, y: 0 }, { x: 4 * 8 + 1, y: 0 });
    });

    // Ctrl+Shift+C.
    await act(async () => {
      canvas.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          key: "C",
          ctrlKey: true,
          shiftKey: true,
        }),
      );
    });
    // Microtask for copy()'s await chain.
    await Promise.resolve();

    expect(copyText).toHaveBeenCalledWith("hello");
  });

  it("clears the selection when the user types a printable key", async () => {
    const grid = gridFromRows(["hello"]);
    const copyText = vi.fn();
    const writeBytes = vi.fn();
    const { getByTestId } = render(
      <TerminalCanvas
        terminalId="t1"
        cols={5}
        rows={1}
        fontSize={14}
        snapshotOverride={grid}
        copyText={copyText}
        writeBytes={writeBytes}
      />,
    );
    const canvas = getByTestId("terminal-canvas") as HTMLCanvasElement;

    await act(async () => {
      downUpDrag(canvas, { x: 0, y: 0 }, { x: 4 * 8 + 1, y: 0 });
    });

    await act(async () => {
      canvas.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "a" }),
      );
    });
    // Copy should now do nothing because selection is cleared.
    await act(async () => {
      canvas.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          key: "c",
          ctrlKey: true,
          shiftKey: true,
        }),
      );
    });
    await Promise.resolve();
    expect(copyText).not.toHaveBeenCalled();
    expect(writeBytes).toHaveBeenCalledWith("t1", "a");
  });

  it("does not copy when nothing is selected", async () => {
    const grid = gridFromRows(["hello"]);
    const copyText = vi.fn();
    const { getByTestId } = render(
      <TerminalCanvas
        terminalId="t1"
        cols={5}
        rows={1}
        fontSize={14}
        snapshotOverride={grid}
        copyText={copyText}
      />,
    );
    const canvas = getByTestId("terminal-canvas") as HTMLCanvasElement;
    await act(async () => {
      canvas.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          key: "C",
          ctrlKey: true,
          shiftKey: true,
        }),
      );
    });
    expect(copyText).not.toHaveBeenCalled();
  });
});
