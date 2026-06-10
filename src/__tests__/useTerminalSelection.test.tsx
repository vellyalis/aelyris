import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.hoisted(() => vi.fn(() => Promise.resolve()));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

import { writeClipboardText } from "../features/terminal/hooks/useTerminalSelection";
import { TerminalCanvas } from "../features/terminal/TerminalCanvas";
import { FALLBACK_TELEMETRY_EVENT, type FallbackTelemetryDetail } from "../shared/lib/fallbackTelemetry";
import { type CellSnapshot, ColorKind, type GridSnapshot } from "../shared/types/terminal";

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
  HTMLCanvasElement.prototype.getBoundingClientRect = () =>
    ({
      left: 0,
      top: 0,
      right: 80 * 14,
      bottom: 24 * 17,
      width: 80 * 14,
      height: 24 * 17,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }) as DOMRect;
}

function packNamed(n: number): number {
  return (ColorKind.NAMED << 24) | n;
}

function cell(ch: string): CellSnapshot {
  return { ch, fg: packNamed(256), bg: packNamed(257), attrs: 0 };
}

function gridFromRows(rows: string[]): GridSnapshot {
  const cols = Math.max(...rows.map((r) => r.length), 1);
  const cells: CellSnapshot[][] = rows.map((r) => Array.from(r.padEnd(cols, " ")).map((c) => cell(c)));
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

function downUpDrag(el: HTMLElement, from: { x: number; y: number }, to: { x: number; y: number }) {
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
  window.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button: 0 }));
}

describe("TerminalCanvas — selection + copy (Task 9)", () => {
  beforeEach(() => {
    installCanvasMock();
    invokeMock.mockReset();
    invokeMock.mockResolvedValue(undefined);
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("extracts and copies a single-line drag", async () => {
    // Metrics: fontSize 14 → cellWidth round(14*0.6)=8, cellHeight round(14*1.25)=18.
    const grid = gridFromRows(["hello world"]);
    const copyText = vi.fn().mockResolvedValue(undefined);

    const { getByTestId } = render(
      <TerminalCanvas terminalId="t1" cols={11} rows={1} fontSize={14} snapshotOverride={grid} copyText={copyText} />,
    );
    const canvas = getByTestId("terminal-canvas") as HTMLCanvasElement;
    const textarea = getByTestId("terminal-ime-textarea") as HTMLTextAreaElement;

    // Drag from cell (0,0) to (0,4) → should select "hello".
    await act(async () => {
      downUpDrag(canvas, { x: 0, y: 0 }, { x: 4 * 8 + 1, y: 0 });
    });

    // Ctrl+Shift+C — after Phase B the textarea owns keydown.
    await act(async () => {
      textarea.dispatchEvent(
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

  it("copies a selected range on Ctrl+C instead of sending an interrupt", async () => {
    const grid = gridFromRows(["hello world"]);
    const copyText = vi.fn().mockResolvedValue(undefined);
    const writeBytes = vi.fn();

    const { getByTestId } = render(
      <TerminalCanvas
        terminalId="t1"
        cols={11}
        rows={1}
        fontSize={14}
        snapshotOverride={grid}
        copyText={copyText}
        writeBytes={writeBytes}
      />,
    );
    const canvas = getByTestId("terminal-canvas") as HTMLCanvasElement;
    const textarea = getByTestId("terminal-ime-textarea") as HTMLTextAreaElement;

    await act(async () => {
      downUpDrag(canvas, { x: 0, y: 0 }, { x: 4 * 8 + 1, y: 0 });
    });
    await act(async () => {
      textarea.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          key: "c",
          ctrlKey: true,
        }),
      );
    });
    await Promise.resolve();

    expect(copyText).toHaveBeenCalledWith("hello");
    expect(writeBytes).not.toHaveBeenCalledWith("t1", "\x03");
  });

  it("copies a selected range from the terminal context menu", async () => {
    const grid = gridFromRows(["hello world"]);
    const copyText = vi.fn().mockResolvedValue(undefined);

    const { getByTestId } = render(
      <TerminalCanvas terminalId="t1" cols={11} rows={1} fontSize={14} snapshotOverride={grid} copyText={copyText} />,
    );
    const canvas = getByTestId("terminal-canvas") as HTMLCanvasElement;

    await act(async () => {
      downUpDrag(canvas, { x: 0, y: 0 }, { x: 4 * 8 + 1, y: 0 });
    });
    const event = new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      button: 2,
    });
    await act(async () => {
      canvas.dispatchEvent(event);
    });
    await Promise.resolve();

    expect(event.defaultPrevented).toBe(true);
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
    const textarea = getByTestId("terminal-ime-textarea") as HTMLTextAreaElement;

    await act(async () => {
      downUpDrag(canvas, { x: 0, y: 0 }, { x: 4 * 8 + 1, y: 0 });
    });

    // After Phase B the textarea owns both the write-bytes path and the
    // selection-clear listener. Fire keydown + input on the textarea so
    // both fire together.
    await act(async () => {
      textarea.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "a" }));
      textarea.dispatchEvent(new InputEvent("input", { bubbles: true, data: "a" }));
    });
    // Ctrl+Shift+C must also target the textarea.
    await act(async () => {
      textarea.dispatchEvent(
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
      <TerminalCanvas terminalId="t1" cols={5} rows={1} fontSize={14} snapshotOverride={grid} copyText={copyText} />,
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

describe("terminal selection clipboard writes", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    invokeMock.mockReset();
  });

  function collectFallbackEvents(): FallbackTelemetryDetail[] {
    const events: FallbackTelemetryDetail[] = [];
    window.addEventListener(FALLBACK_TELEMETRY_EVENT, (event) => {
      events.push((event as CustomEvent<FallbackTelemetryDetail>).detail);
    });
    return events;
  }

  it("uses native clipboard IPC first", async () => {
    invokeMock.mockResolvedValueOnce(undefined);

    await writeClipboardText("hello");

    expect(invokeMock).toHaveBeenCalledWith("write_clipboard_text", { text: "hello" });
  });

  it("uses a visible browser fallback when native clipboard write fails", async () => {
    const events = collectFallbackEvents();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window.navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    invokeMock.mockRejectedValueOnce(new Error("native clipboard denied"));

    await writeClipboardText("fallback copy");

    expect(writeText).toHaveBeenCalledWith("fallback copy");
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "terminal-selection",
          operation: "write_clipboard_text",
          severity: "warning",
          userVisible: true,
        }),
        expect.objectContaining({
          source: "terminal-selection",
          operation: "write_clipboard_text_browser_fallback",
          severity: "warning",
          userVisible: true,
          boundary: "webview-fallback",
          nativeBoundaryEscaped: true,
        }),
      ]),
    );
  });

  it("lets command-center copy surfaces share the native-first clipboard path with their own telemetry source", async () => {
    const events = collectFallbackEvents();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window.navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    invokeMock.mockRejectedValueOnce(new Error("native clipboard busy"));

    await writeClipboardText("handoff context", {
      source: "right-rail.clipboard",
      fallbackMessage: "Native clipboard write failed; using browser clipboard fallback for right rail copy.",
      userVisible: true,
    });

    expect(writeText).toHaveBeenCalledWith("handoff context");
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "right-rail.clipboard",
          operation: "write_clipboard_text",
          severity: "warning",
          userVisible: true,
        }),
        expect.objectContaining({
          source: "right-rail.clipboard",
          operation: "write_clipboard_text_browser_fallback",
          message: "Native clipboard write failed; using browser clipboard fallback for right rail copy.",
          severity: "warning",
          userVisible: true,
          boundary: "webview-fallback",
          nativeBoundaryEscaped: true,
        }),
      ]),
    );
  });

  it("surfaces browser clipboard fallback failure instead of swallowing copy loss", async () => {
    const events = collectFallbackEvents();
    const writeText = vi.fn().mockRejectedValue(new Error("browser clipboard denied"));
    Object.defineProperty(window.navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    invokeMock.mockRejectedValueOnce(new Error("native clipboard unavailable"));

    await expect(writeClipboardText("lost copy")).rejects.toThrow("browser clipboard denied");

    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "terminal-selection",
          operation: "browser_write_clipboard_text",
          severity: "error",
          userVisible: true,
          boundary: "webview-fallback",
          nativeBoundaryEscaped: true,
        }),
      ]),
    );
  });
});
