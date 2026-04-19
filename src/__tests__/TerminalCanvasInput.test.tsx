import { render, cleanup, fireEvent } from "@testing-library/react";
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

function renderCanvas(writeBytes?: (id: string, data: string) => void) {
  const utils = render(
    <TerminalCanvas
      terminalId="t1"
      cols={4}
      rows={2}
      snapshotOverride={null}
      writeBytes={writeBytes}
    />,
  );
  const canvas = utils.getByTestId("terminal-canvas") as HTMLCanvasElement;
  const textarea = utils.getByTestId(
    "terminal-ime-textarea",
  ) as HTMLTextAreaElement;
  return { ...utils, canvas, textarea };
}

describe("TerminalCanvas — input wiring (Phase B: textarea owns keyboard)", () => {
  beforeEach(() => {
    installCanvasMock();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("forwards a printable keystroke via the textarea's input event", () => {
    const writeBytes = vi.fn();
    const { textarea } = renderCanvas(writeBytes);
    // Simulate a plain keystroke: keydown (no consume) then input event.
    dispatchKey(textarea, { key: "a" });
    fireEvent.input(textarea, { data: "a" });
    expect(writeBytes).toHaveBeenCalledWith("t1", "a");
  });

  it("emits the expected CSI sequence for ArrowUp via keydown", () => {
    const writeBytes = vi.fn();
    const { textarea } = renderCanvas(writeBytes);
    const e = dispatchKey(textarea, { key: "ArrowUp" });
    expect(writeBytes).toHaveBeenCalledWith("t1", "\x1b[A");
    expect(e.defaultPrevented).toBe(true);
  });

  it("Enter submits \\r and preventDefaults", () => {
    const writeBytes = vi.fn();
    const { textarea } = renderCanvas(writeBytes);
    const e = dispatchKey(textarea, { key: "Enter" });
    expect(writeBytes).toHaveBeenLastCalledWith("t1", "\r");
    expect(e.defaultPrevented).toBe(true);
  });

  it("ignores IME composition keydowns so the PTY doesn't see the raw key", () => {
    const writeBytes = vi.fn();
    const { textarea } = renderCanvas(writeBytes);
    const e = dispatchKey(textarea, { key: "a", isComposing: true });
    expect(writeBytes).not.toHaveBeenCalled();
    expect(e.defaultPrevented).toBe(false);
  });

  it("sends Ctrl+C as 0x03 via keydown (modifier combos bypass input event)", () => {
    const writeBytes = vi.fn();
    const { textarea } = renderCanvas(writeBytes);
    dispatchKey(textarea, { key: "c", ctrlKey: true });
    expect(writeBytes).toHaveBeenCalledWith("t1", "\x03");
  });

  it("does not consume Ctrl+Shift combos (app shortcuts bubble to window)", () => {
    const writeBytes = vi.fn();
    const { textarea } = renderCanvas(writeBytes);
    const e = dispatchKey(textarea, { key: "J", ctrlKey: true, shiftKey: true });
    expect(writeBytes).not.toHaveBeenCalled();
    expect(e.defaultPrevented).toBe(false);
  });

  it("sends composed IME text via the input event after compositionend", () => {
    const writeBytes = vi.fn();
    const { textarea } = renderCanvas(writeBytes);
    fireEvent.compositionStart(textarea);
    // Interim composition input — isComposing=true, ignored.
    fireEvent.input(textarea, { data: "き", isComposing: true });
    expect(writeBytes).not.toHaveBeenCalled();
    // compositionend flips the flag, then the final input fires with the
    // committed text.
    fireEvent.compositionEnd(textarea);
    fireEvent.input(textarea, { data: "今日" });
    expect(writeBytes).toHaveBeenCalledWith("t1", "今日");
  });

  it("paste events go directly to the PTY as a single write", () => {
    const writeBytes = vi.fn();
    const { textarea } = renderCanvas(writeBytes);
    // jsdom doesn't implement DataTransfer; hand-roll a minimal shim that
    // matches the clipboardData.getData("text") contract we rely on.
    const clipboardData = {
      getData: (type: string) =>
        type === "text" || type === "text/plain" ? "git status\n" : "",
    } as unknown as DataTransfer;
    const pasteEvent = new Event("paste", {
      bubbles: true,
      cancelable: true,
    }) as ClipboardEvent;
    Object.defineProperty(pasteEvent, "clipboardData", {
      value: clipboardData,
    });
    textarea.dispatchEvent(pasteEvent);
    expect(writeBytes).toHaveBeenCalledWith("t1", "git status\n");
    expect(pasteEvent.defaultPrevented).toBe(true);
  });

  it("container owns tabIndex=0; canvas stays at -1 to avoid focus-loop with the container", () => {
    const { canvas } = renderCanvas();
    const container = canvas.parentElement!;
    expect(container.tabIndex).toBe(0);
    expect(canvas.tabIndex).toBe(-1);
  });

  it("programmatic canvas.focus() still redirects to the IME textarea", () => {
    const { canvas, textarea } = renderCanvas();
    canvas.focus();
    expect(document.activeElement).toBe(textarea);
  });

  it("tabbing into the container also forwards focus into the textarea", () => {
    const { canvas, textarea } = renderCanvas();
    const container = canvas.parentElement!;
    container.focus();
    expect(document.activeElement).toBe(textarea);
  });

  it("sends a composed IME commit from compositionend when the `input` event fired while isComposing=true (Windows TSF order)", () => {
    const writeBytes = vi.fn();
    const { textarea } = renderCanvas(writeBytes);
    fireEvent.compositionStart(textarea);
    // Windows TSF path: final text arrives as an interim input while
    // isComposing is still true.
    fireEvent.input(textarea, { data: "今日", isComposing: true });
    expect(writeBytes).not.toHaveBeenCalled();
    // Then compositionend fires with empty data (some TSF IMEs do this).
    fireEvent.compositionEnd(textarea, { data: "" });
    expect(writeBytes).toHaveBeenCalledWith("t1", "今日");
  });

  it("does not double-send the Chromium trailing `input` event after a compositionend commit", () => {
    const writeBytes = vi.fn();
    const { textarea } = renderCanvas(writeBytes);
    fireEvent.compositionStart(textarea);
    // Chromium path: compositionend carries the final text.
    fireEvent.compositionEnd(textarea, { data: "こんにちは" });
    // Trailing input echo that Chromium fires with the same text.
    fireEvent.input(textarea, { data: "こんにちは" });
    expect(writeBytes).toHaveBeenCalledTimes(1);
    expect(writeBytes).toHaveBeenCalledWith("t1", "こんにちは");
  });

  it("mousedown on the container focuses the textarea (click-to-type)", () => {
    const writeBytes = vi.fn();
    const { canvas, textarea } = renderCanvas(writeBytes);
    // Blur first so we can measure the change.
    (document.activeElement as HTMLElement | null)?.blur();
    const container = canvas.parentElement!;
    fireEvent.mouseDown(container);
    expect(document.activeElement).toBe(textarea);
  });
});
