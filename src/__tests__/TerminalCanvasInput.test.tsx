import { render, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TerminalCanvas } from "../features/terminal/TerminalCanvas";

// Minimal 2D context stub so TerminalCanvas's paint effect doesn't crash.
function installCanvasMock() {
  const noop = vi.fn();
  const ctx: Partial<CanvasRenderingContext2D> = {
    fillRect: noop,
    fillText: noop,
    measureText: vi.fn(() => ({ width: 8 }) as TextMetrics),
  };
  HTMLCanvasElement.prototype.getContext = vi.fn(
    () => ctx as CanvasRenderingContext2D,
  ) as unknown as HTMLCanvasElement["getContext"];
}

function dispatchKey(
  el: HTMLElement,
  init: KeyboardEventInit & { key: string },
) {
  const event = new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    ...init,
  });
  el.dispatchEvent(event);
  return event;
}

describe("TerminalCanvas — input wiring (Task 8)", () => {
  beforeEach(() => {
    installCanvasMock();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("forwards a printable keystroke to writeBytes", () => {
    const writeBytes = vi.fn();
    const { getByTestId } = render(
      <TerminalCanvas
        terminalId="t1"
        cols={4}
        rows={2}
        snapshotOverride={null}
        writeBytes={writeBytes}
      />,
    );
    const canvas = getByTestId("terminal-canvas") as HTMLCanvasElement;
    dispatchKey(canvas, { key: "a" });
    expect(writeBytes).toHaveBeenCalledWith("t1", "a");
  });

  it("emits the expected CSI sequence for ArrowUp", () => {
    const writeBytes = vi.fn();
    const { getByTestId } = render(
      <TerminalCanvas
        terminalId="t42"
        cols={2}
        rows={2}
        snapshotOverride={null}
        writeBytes={writeBytes}
      />,
    );
    const canvas = getByTestId("terminal-canvas") as HTMLCanvasElement;
    dispatchKey(canvas, { key: "ArrowUp" });
    expect(writeBytes).toHaveBeenCalledWith("t42", "\x1b[A");
  });

  it("preventDefaults consumed keys and ignores IME composition", () => {
    const writeBytes = vi.fn();
    const { getByTestId } = render(
      <TerminalCanvas
        terminalId="t1"
        cols={2}
        rows={2}
        snapshotOverride={null}
        writeBytes={writeBytes}
      />,
    );
    const canvas = getByTestId("terminal-canvas") as HTMLCanvasElement;

    const consumed = dispatchKey(canvas, { key: "Enter" });
    expect(consumed.defaultPrevented).toBe(true);
    expect(writeBytes).toHaveBeenLastCalledWith("t1", "\r");

    // IME composition: key should bubble, writeBytes must not be called.
    writeBytes.mockClear();
    const composing = dispatchKey(canvas, { key: "a", isComposing: true });
    expect(composing.defaultPrevented).toBe(false);
    expect(writeBytes).not.toHaveBeenCalled();
  });

  it("does not consume Ctrl+Shift combos (let app shortcuts bubble)", () => {
    const writeBytes = vi.fn();
    const { getByTestId } = render(
      <TerminalCanvas
        terminalId="t1"
        cols={2}
        rows={2}
        snapshotOverride={null}
        writeBytes={writeBytes}
      />,
    );
    const canvas = getByTestId("terminal-canvas") as HTMLCanvasElement;
    const e = dispatchKey(canvas, { key: "J", ctrlKey: true, shiftKey: true });
    expect(writeBytes).not.toHaveBeenCalled();
    expect(e.defaultPrevented).toBe(false);
  });

  it("sends Ctrl+C as 0x03", () => {
    const writeBytes = vi.fn();
    const { getByTestId } = render(
      <TerminalCanvas
        terminalId="t1"
        cols={2}
        rows={2}
        snapshotOverride={null}
        writeBytes={writeBytes}
      />,
    );
    const canvas = getByTestId("terminal-canvas") as HTMLCanvasElement;
    dispatchKey(canvas, { key: "c", ctrlKey: true });
    expect(writeBytes).toHaveBeenCalledWith("t1", "\x03");
  });

  it("marks the canvas focusable (tabIndex=0)", () => {
    const { getByTestId } = render(
      <TerminalCanvas
        terminalId="t1"
        cols={2}
        rows={2}
        snapshotOverride={null}
      />,
    );
    const canvas = getByTestId("terminal-canvas") as HTMLCanvasElement;
    expect(canvas.tabIndex).toBe(0);
  });
});
