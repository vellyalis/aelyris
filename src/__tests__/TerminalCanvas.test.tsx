import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TerminalCanvas } from "../features/terminal/TerminalCanvas";
import type { CellSnapshot, CursorSnapshot, GridSnapshot } from "../shared/types/terminal";
import { CellAttr } from "../shared/types/terminal";

const terminalCanvasSource = Object.values(
  import.meta.glob("../features/terminal/TerminalCanvas.tsx", {
    query: "?raw",
    import: "default",
    eager: true,
  }) as Record<string, string>,
)[0]!;

// jsdom's HTMLCanvasElement.getContext returns null by default — stub a
// minimal 2D context so the component can exercise its paint logic.
type CallLog = Array<{ op: string; args: unknown[] }>;

function installCanvasMock(): CallLog {
  const calls: CallLog = [];
  const ctx: Partial<CanvasRenderingContext2D> = {
    fillRect: vi.fn((...args) => {
      calls.push({ op: "fillRect", args });
    }),
    clearRect: vi.fn((...args) => {
      calls.push({ op: "clearRect", args });
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
    set globalAlpha(value: number) {
      calls.push({ op: "globalAlpha", args: [value] });
    },
  };
  HTMLCanvasElement.prototype.getContext = vi.fn(
    () => ctx as CanvasRenderingContext2D,
  ) as unknown as HTMLCanvasElement["getContext"];
  return calls;
}

// Encoded color payloads matching src-tauri/src/term/snapshot.rs.
const NAMED_BG = (0 << 24) | 257; // kind=Named, NamedColor::Background
const NAMED_FG = (0 << 24) | 256; // kind=Named, NamedColor::Foreground
const NAMED_RED = (0 << 24) | 1; // kind=Named, NamedColor::Red
function rgb(r: number, g: number, b: number): number {
  return (1 << 24) | (r << 16) | (g << 8) | b;
}

const cursor: CursorSnapshot = {
  row: 0,
  col: 0,
  shape: "block",
  blinking: false,
  visible: true,
};

function cell(ch: string, extra: Partial<CellSnapshot> = {}): CellSnapshot {
  return { ch, fg: NAMED_FG, bg: NAMED_BG, attrs: 0, ...extra };
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
      <TerminalCanvas terminalId="t1" cols={10} rows={3} fontSize={14} snapshotOverride={null} />,
    );
    const canvas = getByTestId("terminal-canvas") as HTMLCanvasElement;
    expect(canvas.width).toBe(10 * Math.round(14 * 0.6));
    expect(canvas.height).toBe(3 * Math.round(14 * 1.25));
    expect(canvas.getAttribute("data-terminal-id")).toBe("t1");
  });

  it("keeps the jump-to-live affordance tokenized instead of inline-styled", () => {
    expect(terminalCanvasSource).toContain("className={styles.livePill}");
    expect(terminalCanvasSource).not.toContain("rgba(200, 160, 80");
    expect(terminalCanvasSource).not.toContain('borderRadius: 999');
    expect(terminalCanvasSource).not.toContain('color: "#c8a050"');
  });

  it("clears rows before repainting the translucent terminal background", () => {
    const first = snapshot([[cell("a"), cell(" ")]], { shape: "hidden" });
    const { rerender } = render(
      <TerminalCanvas terminalId="t1" cols={2} rows={1} fontSize={10} snapshotOverride={first} />,
    );
    const baseline = calls.length;

    const second = snapshot([[cell("b"), cell(" ")]], { shape: "hidden" });
    rerender(<TerminalCanvas terminalId="t1" cols={2} rows={1} fontSize={10} snapshotOverride={second} />);
    const repaintCalls = calls.slice(baseline);

    const rowClearIndex = repaintCalls.findIndex(
      (c) =>
        c.op === "clearRect" &&
        (c.args[0] as number) === 0 &&
        (c.args[1] as number) === 0 &&
        (c.args[2] as number) === 16 &&
        (c.args[3] as number) === Math.round(10 * 1.25),
    );
    const backgroundFillIndex = repaintCalls.findIndex(
      (c, index) =>
        index > rowClearIndex &&
        c.op === "fillStyle" &&
        (c.args[0] as string) === "rgba(3, 10, 22, 0.46)",
    );

    expect(rowClearIndex).toBeGreaterThanOrEqual(0);
    expect(backgroundFillIndex).toBeGreaterThan(rowClearIndex);
  });

  it("paints cell characters via fillText when a snapshot is provided", () => {
    const snap = snapshot([[cell("h"), cell("i"), cell(" ")]]);
    render(<TerminalCanvas terminalId="t1" cols={3} rows={1} snapshotOverride={snap} />);
    const drawnChars = calls.filter((c) => c.op === "fillText").map((c) => c.args[0] as string);
    expect(drawnChars).toContain("h");
    expect(drawnChars).toContain("i");
    // Space cells must not trigger fillText — they're cleared by the row wipe.
    expect(drawnChars).not.toContain(" ");
  });

  it("skips redraw for rows whose reference is unchanged", () => {
    const row0 = [cell("a"), cell("b")];
    const row1 = [cell("c"), cell("d")];
    const first = snapshot([row0, row1]);
    const { rerender } = render(<TerminalCanvas terminalId="t1" cols={2} rows={2} snapshotOverride={first} />);
    const baselineFillText = calls.filter((c) => c.op === "fillText").length;

    const row0New = [cell("A"), cell("B")];
    const second: GridSnapshot = {
      ...first,
      cells: [row0New, row1],
    };
    rerender(<TerminalCanvas terminalId="t1" cols={2} rows={2} snapshotOverride={second} />);

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
    render(<TerminalCanvas terminalId="t1" cols={2} rows={1} fontSize={10} snapshotOverride={snap} />);
    // `cellMetrics.width` now comes from `ctx.measureText("M").width`.
    // The jsdom mock returns 8 regardless of fontSize, so cellW is 8.
    const cellW = 8;
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
    render(<TerminalCanvas terminalId="t1" cols={1} rows={1} fontSize={10} snapshotOverride={snap} />);
    const cellH = Math.round(10 * 1.25);
    const beam = calls.find(
      (c) => c.op === "fillRect" && (c.args[2] as number) === 2 && (c.args[3] as number) === cellH,
    );
    expect(beam).toBeDefined();
  });

  it("hides the cursor when shape is 'hidden'", () => {
    const snap = snapshot([[cell("x")]], { shape: "hidden", visible: true });
    render(<TerminalCanvas terminalId="t1" cols={1} rows={1} snapshotOverride={snap} />);
    const cursorFills = calls.filter((c) => c.op === "fillStyle" && (c.args[0] as string) === "#cba6f7");
    expect(cursorFills).toHaveLength(0);
  });

  it("resolves truecolor fg and uses it for fillText", () => {
    const magenta = rgb(0xab, 0xcd, 0xef);
    const snap = snapshot([[cell("M", { fg: magenta })]], { shape: "hidden" });
    render(<TerminalCanvas terminalId="t1" cols={1} rows={1} snapshotOverride={snap} />);
    const styles = calls.filter((c) => c.op === "fillStyle").map((c) => c.args[0] as string);
    expect(styles).toContain("#abcdef");
  });

  it("builds a bold italic font string for BOLD+ITALIC cells", () => {
    const snap = snapshot([[cell("B", { attrs: CellAttr.BOLD | CellAttr.ITALIC })]], { shape: "hidden" });
    render(<TerminalCanvas terminalId="t1" cols={1} rows={1} fontSize={14} snapshotOverride={snap} />);
    const fonts = calls.filter((c) => c.op === "font").map((c) => c.args[0] as string);
    expect(fonts.some((f) => f.includes("italic") && f.includes("bold"))).toBe(true);
  });

  it("swaps fg and bg when INVERSE is set", () => {
    const red = NAMED_RED; // NamedColor::Red → Catppuccin #f38ba8
    const snap = snapshot([[cell(" ", { fg: red, attrs: CellAttr.INVERSE })]], { shape: "hidden" });
    render(<TerminalCanvas terminalId="t1" cols={1} rows={1} snapshotOverride={snap} />);
    // Bg fill for the inverted cell should be the original fg (red).
    const fillStyles = calls.filter((c) => c.op === "fillStyle").map((c) => c.args[0] as string);
    expect(fillStyles).toContain("#f38ba8");
  });

  it("skips WIDE_CHAR_SPACER cells entirely", () => {
    const snap = snapshot(
      [[cell("漢", { attrs: CellAttr.WIDE_CHAR }), cell(" ", { attrs: CellAttr.WIDE_CHAR_SPACER })]],
      { shape: "hidden" },
    );
    render(<TerminalCanvas terminalId="t1" cols={2} rows={1} fontSize={10} snapshotOverride={snap} />);
    const chars = calls.filter((c) => c.op === "fillText").map((c) => c.args[0] as string);
    expect(chars).toContain("漢");
    expect(chars).not.toContain(" ");
  });

  it("draws an underline for UNDERLINE cells", () => {
    const snap = snapshot([[cell("U", { attrs: CellAttr.UNDERLINE })]], { shape: "hidden" });
    render(<TerminalCanvas terminalId="t1" cols={1} rows={1} fontSize={10} snapshotOverride={snap} />);
    // jsdom measureText mock → width 8 regardless of fontSize.
    const cellW = 8;
    const cellH = Math.round(10 * 1.25);
    // 1px tall bar near the baseline.
    const under = calls.find(
      (c) =>
        c.op === "fillRect" &&
        (c.args[0] as number) === 0 &&
        (c.args[1] as number) === cellH - 2 &&
        (c.args[2] as number) === cellW &&
        (c.args[3] as number) === 1,
    );
    expect(under).toBeDefined();
  });

  it("applies DIM via globalAlpha=0.6", () => {
    const snap = snapshot([[cell("d", { attrs: CellAttr.DIM })]], { shape: "hidden" });
    render(<TerminalCanvas terminalId="t1" cols={1} rows={1} snapshotOverride={snap} />);
    const alphas = calls.filter((c) => c.op === "globalAlpha").map((c) => c.args[0] as number);
    expect(alphas).toContain(0.6);
  });

  it("skips fillText when HIDDEN is set", () => {
    const snap = snapshot([[cell("S", { attrs: CellAttr.HIDDEN })]], { shape: "hidden" });
    render(<TerminalCanvas terminalId="t1" cols={1} rows={1} snapshotOverride={snap} />);
    const chars = calls.filter((c) => c.op === "fillText").map((c) => c.args[0] as string);
    expect(chars).not.toContain("S");
  });
});
