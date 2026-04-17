import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TerminalCanvas } from "../features/terminal/TerminalCanvas";
import type {
  CellSnapshot,
  GridSnapshot,
} from "../shared/types/terminal";

function installCanvasMock() {
  const ctx: Partial<CanvasRenderingContext2D> = {
    fillRect: vi.fn(),
    fillText: vi.fn(),
    measureText: vi.fn(() => ({ width: 8 }) as TextMetrics),
    save: vi.fn(),
    restore: vi.fn(),
  };
  HTMLCanvasElement.prototype.getContext = vi.fn(
    () => ctx as CanvasRenderingContext2D,
  ) as unknown as HTMLCanvasElement["getContext"];
}

const NAMED_BG = (0 << 24) | 257;
const NAMED_FG = (0 << 24) | 256;

function cell(ch: string): CellSnapshot {
  return { ch, fg: NAMED_FG, bg: NAMED_BG, attrs: 0 };
}

function snapshotFromRows(rows: string[]): GridSnapshot {
  const cols = Math.max(...rows.map((r) => r.length));
  const cells = rows.map((r) =>
    Array.from(r.padEnd(cols, " ")).map((c) => cell(c)),
  );
  return {
    cols,
    rows: rows.length,
    cells,
    cursor: { row: 0, col: 0, shape: "hidden", blinking: false, visible: false },
  };
}

const CELL_W = Math.round(14 * 0.6);
const CELL_H = Math.round(14 * 1.25);

describe("TerminalCanvas link interaction", () => {
  beforeEach(() => {
    installCanvasMock();
    // getBoundingClientRect defaults to {0,0,0,0} in jsdom — override so
    // pixelToCell receives a real-looking rect.
    Element.prototype.getBoundingClientRect = function () {
      return {
        x: 0,
        y: 0,
        left: 0,
        top: 0,
        right: this.clientWidth || 1000,
        bottom: this.clientHeight || 1000,
        width: this.clientWidth || 1000,
        height: this.clientHeight || 1000,
        toJSON() {
          return {};
        },
      } as DOMRect;
    };
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("fires onOpenUrl on Ctrl+Click over a detected URL", async () => {
    const snap = snapshotFromRows(["visit https://example.com for info"]);
    const onOpenUrl = vi.fn();
    const { getByTestId } = render(
      <TerminalCanvas
        terminalId="t1"
        cols={snap.cols}
        rows={snap.rows}
        snapshotOverride={snap}
        onOpenUrl={onOpenUrl}
      />,
    );
    const canvas = getByTestId("terminal-canvas") as HTMLCanvasElement;
    // "https://example.com" starts at col 6 → click at col 10 → hit.
    const x = 10 * CELL_W + 2;
    const y = 0 * CELL_H + 2;
    await act(async () => {
      fireEvent.mouseDown(canvas, {
        clientX: x,
        clientY: y,
        button: 0,
        ctrlKey: true,
      });
    });
    expect(onOpenUrl).toHaveBeenCalledWith("https://example.com");
  });

  it("does not fire onOpenUrl on plain click (no Ctrl)", async () => {
    const snap = snapshotFromRows(["https://example.com"]);
    const onOpenUrl = vi.fn();
    const { getByTestId } = render(
      <TerminalCanvas
        terminalId="t1"
        cols={snap.cols}
        rows={snap.rows}
        snapshotOverride={snap}
        onOpenUrl={onOpenUrl}
      />,
    );
    const canvas = getByTestId("terminal-canvas") as HTMLCanvasElement;
    await act(async () => {
      fireEvent.mouseDown(canvas, {
        clientX: 3 * CELL_W + 2,
        clientY: 2,
        button: 0,
        ctrlKey: false,
      });
    });
    expect(onOpenUrl).not.toHaveBeenCalled();
  });

  it("does not fire onOpenUrl on Ctrl+Click outside the URL", async () => {
    const snap = snapshotFromRows(["plain text no url here"]);
    const onOpenUrl = vi.fn();
    const { getByTestId } = render(
      <TerminalCanvas
        terminalId="t1"
        cols={snap.cols}
        rows={snap.rows}
        snapshotOverride={snap}
        onOpenUrl={onOpenUrl}
      />,
    );
    const canvas = getByTestId("terminal-canvas") as HTMLCanvasElement;
    await act(async () => {
      fireEvent.mouseDown(canvas, {
        clientX: 3 * CELL_W + 2,
        clientY: 2,
        button: 0,
        ctrlKey: true,
      });
    });
    expect(onOpenUrl).not.toHaveBeenCalled();
  });

  it("sets cursor=pointer while hovering a URL with Ctrl held", async () => {
    const snap = snapshotFromRows(["go https://a.test now"]);
    const { getByTestId } = render(
      <TerminalCanvas
        terminalId="t1"
        cols={snap.cols}
        rows={snap.rows}
        snapshotOverride={snap}
      />,
    );
    const canvas = getByTestId("terminal-canvas") as HTMLCanvasElement;
    await act(async () => {
      fireEvent.mouseMove(canvas, {
        clientX: 7 * CELL_W + 2, // inside "https://a.test"
        clientY: 2,
        ctrlKey: true,
      });
    });
    expect(canvas.style.cursor).toBe("pointer");

    await act(async () => {
      fireEvent.mouseMove(canvas, {
        clientX: 0,
        clientY: 2,
        ctrlKey: true,
      });
    });
    expect(canvas.style.cursor).toBe("");
  });
});

describe("TerminalCanvas search highlights", () => {
  beforeEach(() => {
    installCanvasMock();
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders without errors when searchMatches + activeSearchMatch are provided", () => {
    const snap = snapshotFromRows(["the quick brown fox"]);
    const matches = [{ row: 0, startCol: 4, endCol: 8 }];
    const { getByTestId } = render(
      <TerminalCanvas
        terminalId="t1"
        cols={snap.cols}
        rows={snap.rows}
        snapshotOverride={snap}
        searchMatches={matches}
        activeSearchMatch={matches[0]}
      />,
    );
    const canvas = getByTestId("terminal-canvas") as HTMLCanvasElement;
    expect(canvas).toBeTruthy();
  });
});
