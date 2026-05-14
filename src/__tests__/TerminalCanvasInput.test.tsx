import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  disableImeDiagnostics,
  enableImeDiagnostics,
  IME_DIAGNOSTIC_EVENT,
  TERMINAL_PREFIX_COMMAND_EVENT,
} from "../features/terminal/hooks/useCanvasIME";
import { findAiCliInputAnchor, TerminalCanvas } from "../features/terminal/TerminalCanvas";
import { CellAttr, type CellSnapshot, type GridSnapshot } from "../shared/types/terminal";

const invokeMock = vi.fn((_cmd: string, _args?: Record<string, unknown>): Promise<unknown> => Promise.resolve());

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: Record<string, unknown>) => invokeMock(cmd, args),
}));

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

function dispatchKey(el: HTMLElement, init: KeyboardEventInit & { key: string }) {
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
    <TerminalCanvas terminalId="t1" cols={4} rows={2} snapshotOverride={null} writeBytes={writeBytes} />,
  );
  const canvas = utils.getByTestId("terminal-canvas") as HTMLCanvasElement;
  const textarea = utils.getByTestId("terminal-ime-textarea") as HTMLTextAreaElement;
  return { ...utils, canvas, textarea };
}

function canvasContainer(canvas: HTMLCanvasElement): HTMLElement {
  const container = canvas.parentElement;
  if (!container) throw new Error("expected terminal canvas container");
  return container;
}

function cell(ch = " "): CellSnapshot {
  return {
    ch,
    fg: 0,
    bg: 0,
    attrs: 0,
  };
}

function snapshotWithCursor(row: number, col: number): GridSnapshot {
  return {
    cols: 4,
    rows: 2,
    cells: Array.from({ length: 2 }, () => Array.from({ length: 4 }, () => cell())),
    cursor: {
      row,
      col,
      shape: "block",
      blinking: false,
      visible: true,
    },
  };
}

function rowFromText(text: string, cols: number): CellSnapshot[] {
  return Array.from({ length: cols }, (_, i) => cell(text[i] ?? " "));
}

function isWideFixtureChar(ch: string): boolean {
  return /[\u3040-\u30ff\u3400-\u9fff]/u.test(ch);
}

function rowFromTerminalText(text: string, cols: number): CellSnapshot[] {
  const row = Array.from({ length: cols }, () => cell());
  let col = 0;
  for (const ch of text) {
    if (col >= cols) break;
    row[col] = cell(ch);
    if (isWideFixtureChar(ch) && col + 1 < cols) {
      row[col].attrs = CellAttr.WIDE_CHAR;
      row[col + 1] = { ...cell(" "), attrs: CellAttr.WIDE_CHAR_SPACER };
      col += 2;
    } else {
      col += 1;
    }
  }
  return row;
}

function snapshotFromRows(rows: string[], cursor: { row: number; col: number }, cols = 80): GridSnapshot {
  return {
    cols,
    rows: rows.length,
    cells: rows.map((row) => rowFromText(row, cols)),
    cursor: {
      ...cursor,
      shape: "block",
      blinking: false,
      visible: true,
    },
  };
}

describe("TerminalCanvas — input wiring (Phase B: textarea owns keyboard)", () => {
  beforeEach(() => {
    installCanvasMock();
    invokeMock.mockReset();
    invokeMock.mockImplementation((cmd: string, args?: Record<string, unknown>) => {
      if (cmd === "mux_process_keymap_event") {
        if (args?.key === "b" && args?.ctrlKey === true) {
          return Promise.resolve({ kind: "prefixStarted", table: "prefix", command: null });
        }
        const commandByKey: Record<string, string> = {
          c: "new-window",
          "%": "split-right",
          '"': "split-down",
          x: "close",
          z: "toggle-maximize",
          n: "focus-next",
          p: "focus-previous",
          "}": "move-next",
          "{": "move-previous",
          o: "rotate-next",
          O: "rotate-previous",
          "=": "equalize",
          " ": "tiled",
          s: "sync-panes",
        };
        return Promise.resolve({
          kind: commandByKey[String(args?.key)] ? "dispatch" : "cancelled",
          table: "prefix",
          command: commandByKey[String(args?.key)] ?? null,
        });
      }
      return Promise.resolve();
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanup();
    localStorage.removeItem("aether:debug:ime");
    delete window.__AETHER_IME_DEBUG__;
    delete window.__AETHER_IME_EVENTS__;
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

  it("uses Ctrl+B as a Rust mux terminal prefix without sending bytes to the PTY", async () => {
    const writeBytes = vi.fn();
    const { textarea } = renderCanvas(writeBytes);
    const commands: string[] = [];
    textarea.addEventListener(TERMINAL_PREFIX_COMMAND_EVENT, (event) => {
      commands.push((event as CustomEvent<{ command: string }>).detail.command);
    });

    const prefix = dispatchKey(textarea, { key: "b", ctrlKey: true });
    const split = dispatchKey(textarea, { key: "%" });

    expect(prefix.defaultPrevented).toBe(true);
    expect(split.defaultPrevented).toBe(true);
    expect(writeBytes).not.toHaveBeenCalled();
    await waitFor(() => expect(commands).toEqual(["split-right"]));
    expect(invokeMock).toHaveBeenCalledWith("mux_process_keymap_event", {
      terminalId: "t1",
      key: "b",
      ctrlKey: true,
      altKey: false,
      shiftKey: false,
      metaKey: false,
    });
    expect(invokeMock).toHaveBeenCalledWith("mux_process_keymap_event", {
      terminalId: "t1",
      key: "%",
      ctrlKey: false,
      altKey: false,
      shiftKey: false,
      metaKey: false,
    });
  });

  it("dispatches Ctrl+B c as the Rust mux new-window command", async () => {
    const writeBytes = vi.fn();
    const { textarea } = renderCanvas(writeBytes);
    const commands: string[] = [];
    textarea.addEventListener(TERMINAL_PREFIX_COMMAND_EVENT, (event) => {
      commands.push((event as CustomEvent<{ command: string }>).detail.command);
    });

    dispatchKey(textarea, { key: "b", ctrlKey: true });
    const create = dispatchKey(textarea, { key: "c" });

    expect(create.defaultPrevented).toBe(true);
    expect(writeBytes).not.toHaveBeenCalled();
    await waitFor(() => expect(commands).toEqual(["new-window"]));
  });

  it("lets Ctrl+Alt printable input use the browser input path for AltGr-style layouts", () => {
    const writeBytes = vi.fn();
    const { textarea } = renderCanvas(writeBytes);

    const e = dispatchKey(textarea, { key: "@", ctrlKey: true, altKey: true });
    expect(writeBytes).not.toHaveBeenCalled();
    expect(e.defaultPrevented).toBe(false);

    fireEvent.input(textarea, { data: "@" });
    expect(writeBytes).toHaveBeenCalledWith("t1", "@");
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
    const { queryByText, textarea } = renderCanvas(writeBytes);
    fireEvent.compositionStart(textarea);
    // Interim composition input — isComposing=true, ignored.
    fireEvent.input(textarea, { data: "き", isComposing: true });
    expect(queryByText("き")).not.toBeNull();
    expect(writeBytes).not.toHaveBeenCalled();
    // compositionend flips the flag, then the final input fires with the
    // committed text.
    fireEvent.compositionEnd(textarea);
    expect(queryByText("き")).toBeNull();
    expect(writeBytes).not.toHaveBeenCalled();
    fireEvent.input(textarea, { data: "今日" });
    expect(writeBytes).toHaveBeenCalledTimes(1);
    expect(writeBytes).toHaveBeenCalledWith("t1", "今日");
  });

  it("clears delayed Windows TSF fallback commits when the canvas unmounts", () => {
    vi.useFakeTimers();
    const writeBytes = vi.fn();
    const { textarea, unmount } = renderCanvas(writeBytes);

    fireEvent.compositionStart(textarea);
    fireEvent.input(textarea, { data: "今日", isComposing: true });
    fireEvent.compositionEnd(textarea, { data: "" });
    unmount();

    act(() => {
      vi.advanceTimersByTime(32);
    });
    expect(writeBytes).not.toHaveBeenCalled();
  });

  it("does not leak Backspace to the PTY while IME composition owns editing", () => {
    const writeBytes = vi.fn();
    const { textarea } = renderCanvas(writeBytes);

    fireEvent.compositionStart(textarea);
    const event = dispatchKey(textarea, { key: "Backspace" });

    expect(writeBytes).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it("clears stale Japanese preedit when the IME reports deletion during composition", () => {
    const writeBytes = vi.fn();
    const { queryByText, textarea } = renderCanvas(writeBytes);

    fireEvent.compositionStart(textarea);
    textarea.value = "ああ";
    fireEvent.input(textarea, { data: "ああ", isComposing: true });
    expect(queryByText("ああ")).not.toBeNull();

    textarea.value = "";
    fireEvent.input(textarea, {
      data: null,
      inputType: "deleteContentBackward",
      isComposing: true,
    });

    expect(queryByText("ああ")).toBeNull();
    expect(writeBytes).not.toHaveBeenCalled();
  });

  it("keeps the backing textarea value during long Japanese composition", () => {
    vi.useFakeTimers();
    const writeBytes = vi.fn();
    const { queryByText, textarea } = renderCanvas(writeBytes);
    const longText = "あ".repeat(28);

    fireEvent.compositionStart(textarea);
    textarea.value = longText;
    fireEvent.input(textarea, { data: longText, isComposing: true });

    expect(textarea.value).toBe(longText);
    expect(queryByText(longText)).not.toBeNull();
    expect(writeBytes).not.toHaveBeenCalled();

    fireEvent.compositionEnd(textarea, { data: "" });

    expect(textarea.value).toBe("");
    expect(queryByText(longText)).toBeNull();
    expect(writeBytes).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(32);
    });

    expect(writeBytes).toHaveBeenCalledWith("t1", longText);
  });

  it("caps the visible IME preedit overlay while keeping the backing textarea long", () => {
    const writeBytes = vi.fn();
    const { getByText, textarea } = renderCanvas(writeBytes);
    const longText = "あ".repeat(48);

    fireEvent.compositionStart(textarea);
    textarea.value = longText;
    fireEvent.input(textarea, { data: longText, isComposing: true });

    const overlay = getByText(longText) as HTMLDivElement;
    expect(textarea.value).toBe(longText);
    expect(overlay.style.maxWidth).toContain("34ch");
    expect(parseFloat(overlay.style.left)).toBeGreaterThanOrEqual(0);
    expect(writeBytes).not.toHaveBeenCalled();
  });

  it("shows IME preedit text from compositionupdate even when no composing input event fires", () => {
    const writeBytes = vi.fn();
    const { queryByText, textarea } = renderCanvas(writeBytes);

    fireEvent.compositionStart(textarea);
    fireEvent.compositionUpdate(textarea, { data: "あああ" });

    expect(queryByText("あああ")).not.toBeNull();
    expect(writeBytes).not.toHaveBeenCalled();

    fireEvent.compositionEnd(textarea, { data: "あああ" });
    expect(queryByText("あああ")).toBeNull();
    expect(writeBytes).toHaveBeenCalledWith("t1", "あああ");
  });

  it("keeps the hidden IME textarea wide enough for long composition state without leaving the canvas", () => {
    const utils = render(<TerminalCanvas terminalId="t1" cols={80} rows={2} snapshotOverride={null} />);
    const textarea = utils.getByTestId("terminal-ime-textarea") as HTMLTextAreaElement;
    const canvas = utils.getByTestId("terminal-canvas") as HTMLCanvasElement;
    expect(textarea.value).toBe("");
    expect(textarea.getAttribute("wrap")).toBe("off");
    expect(parseFloat(textarea.style.width)).toBeGreaterThan(2);
    expect(parseFloat(textarea.style.left) + parseFloat(textarea.style.width)).toBeLessThanOrEqual(
      parseFloat(canvas.style.width),
    );
  });

  it("recovers when a non-composing input arrives after a missed compositionend", () => {
    const writeBytes = vi.fn();
    const { queryByText, textarea } = renderCanvas(writeBytes);

    fireEvent.compositionStart(textarea);
    textarea.value = "ああ";
    fireEvent.input(textarea, { data: "ああ", isComposing: true });
    expect(queryByText("ああ")).not.toBeNull();

    textarea.value = "愛";
    fireEvent.input(textarea, { data: "愛", isComposing: false });

    expect(textarea.value).toBe("");
    expect(queryByText("ああ")).toBeNull();
    expect(writeBytes).toHaveBeenCalledWith("t1", "愛");
  });

  it("normalizes pasted LF to CR for direct terminal writes", () => {
    const writeBytes = vi.fn();
    const { textarea } = renderCanvas(writeBytes);
    // jsdom doesn't implement DataTransfer; hand-roll a minimal shim that
    // matches the clipboardData.getData("text") contract we rely on.
    const clipboardData = {
      getData: (type: string) => (type === "text" || type === "text/plain" ? "git status\n" : ""),
    } as unknown as DataTransfer;
    const pasteEvent = new Event("paste", {
      bubbles: true,
      cancelable: true,
    }) as ClipboardEvent;
    Object.defineProperty(pasteEvent, "clipboardData", {
      value: clipboardData,
    });
    act(() => {
      textarea.dispatchEvent(pasteEvent);
    });
    expect(writeBytes).toHaveBeenCalledWith("t1", "git status\r");
    expect(pasteEvent.defaultPrevented).toBe(true);
  });

  it("lets paste take over while Japanese composition is active and ignores trailing compositionend", async () => {
    const writeBytes = vi.fn();
    const { queryByText, textarea } = renderCanvas(writeBytes);
    const clipboardData = {
      getData: (type: string) => (type === "text" || type === "text/plain" ? "echo pasted\n" : ""),
    } as unknown as DataTransfer;
    const pasteEvent = new Event("paste", {
      bubbles: true,
      cancelable: true,
    }) as ClipboardEvent;
    Object.defineProperty(pasteEvent, "clipboardData", {
      value: clipboardData,
    });

    act(() => {
      fireEvent.compositionStart(textarea);
      textarea.value = "かな";
      fireEvent.input(textarea, { data: "かな", inputType: "insertCompositionText", isComposing: true });
    });
    expect(queryByText("かな")).not.toBeNull();

    act(() => {
      textarea.dispatchEvent(pasteEvent);
    });
    fireEvent.compositionEnd(textarea, { data: "かな" });
    const enterEvent = dispatchKey(textarea, { key: "Enter" });

    await waitFor(() => expect(queryByText("かな")).toBeNull());
    expect(textarea.value).toBe("");
    expect(writeBytes).toHaveBeenNthCalledWith(1, "t1", "echo pasted\r");
    expect(writeBytes).toHaveBeenNthCalledWith(2, "t1", "\r");
    expect(writeBytes).toHaveBeenCalledTimes(2);
    expect(enterEvent.defaultPrevented).toBe(true);
  });

  it("container owns tabIndex=0; canvas stays at -1 to avoid focus-loop with the container", () => {
    const { canvas } = renderCanvas();
    const container = canvasContainer(canvas);
    expect(container.tabIndex).toBe(0);
    expect(canvas.tabIndex).toBe(-1);
  });

  it("programmatic canvas.focus() still redirects to the IME textarea", () => {
    const { canvas, textarea } = renderCanvas();
    act(() => {
      canvas.focus();
    });
    expect(document.activeElement).toBe(textarea);
  });

  it("tabbing into the container also forwards focus into the textarea", () => {
    const { canvas, textarea } = renderCanvas();
    const container = canvasContainer(canvas);
    act(() => {
      container.focus();
    });
    expect(document.activeElement).toBe(textarea);
  });

  it("sends a composed IME commit from compositionend when the `input` event fired while isComposing=true (Windows TSF order)", () => {
    vi.useFakeTimers();
    const writeBytes = vi.fn();
    const { queryByText, textarea } = renderCanvas(writeBytes);
    fireEvent.compositionStart(textarea);
    // Windows TSF path: final text arrives as an interim input while
    // isComposing is still true.
    fireEvent.input(textarea, { data: "今日", isComposing: true });
    expect(queryByText("今日")).not.toBeNull();
    expect(writeBytes).not.toHaveBeenCalled();
    // Then compositionend fires with empty data (some TSF IMEs do this).
    fireEvent.compositionEnd(textarea, { data: "" });
    expect(queryByText("今日")).toBeNull();
    expect(writeBytes).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(32);
    });
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

  it("does not drop an in-flight composition when the parent re-renders with a new writeBytes identity", () => {
    // Guards against a latent HIGH regression: if `useCanvasIME` put
    // `writeBytes` in its effect dep array, a parent passing an inline
    // function literal would re-register listeners mid-composition and
    // silently reset the internal pendingComposition / skip refs.
    const initialWrite = vi.fn();
    const { container, rerender } = render(
      <TerminalCanvas terminalId="t1" cols={4} rows={2} snapshotOverride={null} writeBytes={initialWrite} />,
    );
    const textarea = container.querySelector("[data-testid='terminal-ime-textarea']") as HTMLTextAreaElement;

    fireEvent.compositionStart(textarea);
    fireEvent.input(textarea, { data: "きょ", isComposing: true });

    // Force a new writeBytes reference mid-composition.
    const swappedWrite = vi.fn();
    rerender(<TerminalCanvas terminalId="t1" cols={4} rows={2} snapshotOverride={null} writeBytes={swappedWrite} />);

    fireEvent.compositionEnd(textarea, { data: "今日" });
    // The new writeBytes wins (ref is swapped live); the old function must
    // NOT be called, and the commit must NOT be dropped.
    expect(initialWrite).not.toHaveBeenCalled();
    expect(swappedWrite).toHaveBeenCalledWith("t1", "今日");
  });

  it("mousedown on the container focuses the textarea (click-to-type)", async () => {
    const writeBytes = vi.fn();
    const { canvas, textarea } = renderCanvas(writeBytes);
    // Blur first so we can measure the change.
    act(() => {
      (document.activeElement as HTMLElement | null)?.blur();
    });
    const container = canvasContainer(canvas);
    await act(async () => {
      fireEvent.mouseDown(container);
      await Promise.resolve();
    });
    expect(document.activeElement).toBe(textarea);
  });

  it("clamps IME anchor and composition overlay to the visible grid", () => {
    const { container, queryByText } = render(
      <TerminalCanvas terminalId="t1" cols={4} rows={2} fontSize={14} snapshotOverride={snapshotWithCursor(99, 99)} />,
    );
    const textarea = container.querySelector("[data-testid='terminal-ime-textarea']") as HTMLTextAreaElement;

    fireEvent.compositionStart(textarea);
    fireEvent.input(textarea, { data: "き", isComposing: true });

    const overlay = queryByText("き") as HTMLElement;
    expect(overlay).not.toBeNull();
    expect(overlay.style.left).toBe("16px");
    expect(overlay.style.top).toBe("18px");
    expect(textarea.style.left).toBe("0px");
    expect(textarea.style.top).toBe("18px");
    expect(textarea.style.paddingLeft).toBe("24px");
    expect(textarea.style.width).toBe("32px");
  });

  it("does not anchor IME to a hidden terminal cursor", () => {
    const hiddenCursor = snapshotWithCursor(1, 3);
    hiddenCursor.cursor.visible = false;
    const { container, queryByText } = render(
      <TerminalCanvas terminalId="t1" cols={4} rows={2} fontSize={14} snapshotOverride={hiddenCursor} />,
    );
    const textarea = container.querySelector("[data-testid='terminal-ime-textarea']") as HTMLTextAreaElement;

    fireEvent.compositionStart(textarea);
    fireEvent.compositionUpdate(textarea, { data: "あ" });

    const overlay = queryByText("あ") as HTMLElement;
    expect(overlay).not.toBeNull();
    expect(overlay.style.left).toBe("0px");
    expect(overlay.style.top).toBe("0px");
    expect(textarea.style.left).toBe("0px");
    expect(textarea.style.top).toBe("0px");
    expect(invokeMock.mock.calls.some(([cmd]) => cmd === "set_ime_position")).toBe(false);
  });

  it("keeps long IME preedit text visible near the cursor without using the candidate-window guard", () => {
    const { container, queryByText } = render(
      <TerminalCanvas
        terminalId="t1"
        cols={120}
        rows={2}
        fontSize={14}
        snapshotOverride={{
          cols: 120,
          rows: 2,
          cells: Array.from({ length: 2 }, () => Array.from({ length: 120 }, () => cell())),
          cursor: {
            row: 1,
            col: 119,
            shape: "block",
            blinking: false,
            visible: true,
          },
        }}
      />,
    );
    const textarea = container.querySelector("[data-testid='terminal-ime-textarea']") as HTMLTextAreaElement;

    fireEvent.compositionStart(textarea);
    fireEvent.compositionUpdate(textarea, { data: "あ".repeat(24) });

    const overlay = queryByText("あ".repeat(24)) as HTMLElement;
    expect(overlay).not.toBeNull();
    expect(overlay.style.left).toBe("688px");
    expect(overlay.style.maxWidth).toContain("34ch");
    expect(textarea.style.left).toBe("520px");
  });

  it("keeps the hidden IME textarea inside the canvas instead of overflowing into side panels", () => {
    const { container } = render(
      <TerminalCanvas terminalId="t1" cols={4} rows={2} fontSize={14} snapshotOverride={snapshotWithCursor(1, 3)} />,
    );
    const canvas = container.querySelector("[data-testid='terminal-canvas']") as HTMLCanvasElement;
    const textarea = container.querySelector("[data-testid='terminal-ime-textarea']") as HTMLTextAreaElement;

    expect(textarea.style.left).toBe("0px");
    expect(parseFloat(textarea.style.left) + parseFloat(textarea.style.width)).toBeLessThanOrEqual(
      parseFloat(canvas.style.width),
    );
    expect(textarea.style.paddingLeft).toBe("24px");
  });

  it("does not reset the hidden textarea scroll position while Windows IME owns long composition editing", () => {
    const first = snapshotWithCursor(0, 1);
    const second = snapshotWithCursor(1, 2);
    const { container, rerender } = render(
      <TerminalCanvas terminalId="t1" cols={80} rows={2} fontSize={14} snapshotOverride={first} />,
    );
    const textarea = container.querySelector("[data-testid='terminal-ime-textarea']") as HTMLTextAreaElement;

    textarea.scrollLeft = 24;
    rerender(<TerminalCanvas terminalId="t1" cols={80} rows={2} fontSize={14} snapshotOverride={second} />);

    expect(textarea.scrollLeft).toBe(24);
  });

  it("keeps Japanese IME diagnostics silent unless explicitly enabled", () => {
    const events: unknown[] = [];
    const onDiagnostic = ((event: CustomEvent) => {
      events.push(event.detail);
    }) as EventListener;
    window.addEventListener(IME_DIAGNOSTIC_EVENT, onDiagnostic);
    const { textarea } = renderCanvas(vi.fn());

    fireEvent.compositionStart(textarea);
    textarea.value = "ああ";
    fireEvent.input(textarea, { data: "ああ", isComposing: true });
    fireEvent.compositionEnd(textarea, { data: "ああ" });
    window.removeEventListener(IME_DIAGNOSTIC_EVENT, onDiagnostic);

    expect(events).toEqual([]);
    expect(window.__AETHER_IME_EVENTS__).toBeUndefined();
    expect(screen.queryByTestId("terminal-input-diagnostics")).toBeNull();
  });

  it("records an opt-in Japanese IME event trace without storing raw typed text", () => {
    localStorage.setItem("aether:debug:ime", "1");
    const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
    const events: Array<Record<string, unknown>> = [];
    const onDiagnostic = ((event: CustomEvent) => {
      events.push(event.detail as Record<string, unknown>);
    }) as EventListener;
    window.addEventListener(IME_DIAGNOSTIC_EVENT, onDiagnostic);
    const writeBytes = vi.fn();
    const { textarea } = renderCanvas(writeBytes);

    fireEvent.compositionStart(textarea);
    textarea.value = "あ".repeat(18);
    textarea.scrollLeft = 12;
    fireEvent.input(textarea, { data: "あ".repeat(18), isComposing: true });
    fireEvent.compositionEnd(textarea, { data: "あ".repeat(18) });
    window.removeEventListener(IME_DIAGNOSTIC_EVENT, onDiagnostic);

    expect(writeBytes).toHaveBeenCalledWith("t1", "あ".repeat(18));
    expect(events.map((event) => event.phase)).toEqual(["compositionstart", "input", "compositionend", "commit"]);
    expect(events.at(-1)).toMatchObject({
      terminalId: "t1",
      phase: "commit",
      writePath: "ime-commit",
      sentLength: 18,
      valueLength: 0,
    });
    expect(events[1]).toMatchObject({
      phase: "input",
      writePath: "ime-composition",
      isComposing: true,
      dataLength: 18,
      valueLength: 18,
      scrollLeft: 12,
      anchorMode: "terminal-cursor",
    });
    expect(JSON.stringify(events)).not.toContain("あ");
    expect(window.__AETHER_IME_EVENTS__).toHaveLength(4);
    expect(debugSpy).toHaveBeenCalled();
  });

  it("shows the opt-in input diagnostics overlay without exposing raw typed text", () => {
    const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
    const writeBytes = vi.fn();
    enableImeDiagnostics(window);
    const { textarea } = renderCanvas(writeBytes);

    fireEvent.compositionStart(textarea);
    textarea.value = "かな";
    fireEvent.input(textarea, { data: "かな", isComposing: true });
    fireEvent.keyDown(textarea, { key: "Backspace", keyCode: 8 });
    fireEvent.compositionEnd(textarea, { data: "仮名" });

    const overlay = screen.getByTestId("terminal-input-diagnostics");
    expect(overlay.textContent).toContain("IME Diagnostics");
    expect(overlay.textContent).toContain("t1");
    expect(overlay.textContent).toContain("Write pathime-commit");
    expect(overlay.textContent).toContain("Eventcommit");
    expect(overlay.textContent).toContain("commit");
    expect(overlay.textContent).toContain("1");
    expect(overlay.textContent).toContain("terminal-cursor");
    expect(overlay.textContent).not.toContain("かな");
    expect(overlay.textContent).not.toContain("仮名");

    act(() => {
      disableImeDiagnostics(window);
    });
    expect(screen.queryByTestId("terminal-input-diagnostics")).toBeNull();
    expect(debugSpy).toHaveBeenCalled();
  });

  it("clamps the native IME candidate point away from the terminal's right rail", () => {
    const { container } = render(
      <TerminalCanvas
        terminalId="t1"
        cols={120}
        rows={2}
        fontSize={14}
        snapshotOverride={snapshotWithCursor(1, 119)}
      />,
    );
    const textarea = container.querySelector("[data-testid='terminal-ime-textarea']") as HTMLTextAreaElement;

    textarea.focus();
    fireEvent.compositionStart(textarea);

    const imeCall = invokeMock.mock.calls.find(([cmd]) => cmd === "set_ime_position");
    expect(imeCall).toBeDefined();
    const args = imeCall?.[1] as { x: number; candidateX: number };
    expect(args.candidateX).toBe(args.x);
    expect(parseFloat(textarea.style.left)).toBeLessThanOrEqual(args.x);
    expect(textarea.style.width).toBe("440px");
    expect(parseFloat(textarea.style.left) + parseFloat(textarea.style.paddingLeft)).toBeGreaterThan(args.x);
  });

  it("recomputes IME anchor after resize without devicePixelRatio scaling drift", () => {
    const originalDpr = Object.getOwnPropertyDescriptor(window, "devicePixelRatio");
    Object.defineProperty(window, "devicePixelRatio", {
      configurable: true,
      value: 1.5,
    });

    try {
      const wide = snapshotFromRows(["", ""], { row: 1, col: 79 }, 80);
      const narrow = snapshotFromRows(["", ""], { row: 1, col: 79 }, 80);
      const { container, rerender } = render(
        <TerminalCanvas terminalId="t1" cols={80} rows={2} fontSize={14} snapshotOverride={wide} />,
      );
      const textarea = container.querySelector("[data-testid='terminal-ime-textarea']") as HTMLTextAreaElement;
      const canvas = container.querySelector("[data-testid='terminal-canvas']") as HTMLCanvasElement;

      textarea.focus();
      fireEvent.compositionStart(textarea);
      const wideCall = [...invokeMock.mock.calls].reverse().find(([cmd]) => cmd === "set_ime_position") ?? null;
      expect(wideCall).not.toBeNull();

      rerender(<TerminalCanvas terminalId="t1" cols={10} rows={2} fontSize={14} snapshotOverride={narrow} />);
      fireEvent.compositionStart(textarea);

      const imeCall = [...invokeMock.mock.calls].reverse().find(([cmd]) => cmd === "set_ime_position") ?? null;
      expect(imeCall).not.toBeNull();
      const args = imeCall?.[1] as { x: number; candidateX: number };
      const canvasWidth = parseFloat(canvas.style.width);
      expect(window.devicePixelRatio).toBe(1.5);
      expect(args.x).toBeLessThanOrEqual(canvasWidth);
      expect(args.candidateX).toBeLessThanOrEqual(args.x);
      expect(parseFloat(textarea.style.left) + parseFloat(textarea.style.width)).toBeLessThanOrEqual(canvasWidth);
    } finally {
      if (originalDpr) {
        Object.defineProperty(window, "devicePixelRatio", originalDpr);
      }
    }
  });

  it("re-pushes native IME coordinates on window resize while the hidden textarea is focused", () => {
    const { container } = render(
      <TerminalCanvas terminalId="t1" cols={10} rows={4} fontSize={14} snapshotOverride={snapshotWithCursor(1, 2)} />,
    );
    const textarea = container.querySelector("[data-testid='terminal-ime-textarea']") as HTMLTextAreaElement;
    const canvas = container.querySelector("[data-testid='terminal-canvas']") as HTMLCanvasElement;
    let left = 10;
    let top = 20;
    vi.spyOn(canvas, "getBoundingClientRect").mockImplementation(
      () =>
        ({
          x: left,
          y: top,
          left,
          top,
          right: left + 80,
          bottom: top + 72,
          width: 80,
          height: 72,
          toJSON: () => ({}),
        }) as DOMRect,
    );

    textarea.focus();
    fireEvent.compositionStart(textarea);
    invokeMock.mockClear();
    left = 40;
    top = 60;
    act(() => {
      window.dispatchEvent(new Event("resize"));
    });

    const imeCall = invokeMock.mock.calls.find(([cmd]) => cmd === "set_ime_position");
    expect(imeCall?.[1]).toMatchObject({
      x: 40,
      y: 96,
      candidateX: 40,
      candidateY: 96,
    });
  });

  it("scopes IME composition to the focused terminal when multiple panes are mounted", () => {
    const writeBytes = vi.fn();
    const { getAllByTestId } = render(
      <>
        <TerminalCanvas
          terminalId="t1"
          cols={4}
          rows={2}
          snapshotOverride={snapshotWithCursor(0, 1)}
          writeBytes={writeBytes}
        />
        <TerminalCanvas
          terminalId="t2"
          cols={4}
          rows={2}
          snapshotOverride={snapshotWithCursor(1, 2)}
          writeBytes={writeBytes}
        />
      </>,
    );
    const [firstTextarea, secondTextarea] = getAllByTestId("terminal-ime-textarea") as HTMLTextAreaElement[];

    act(() => {
      secondTextarea.focus();
    });
    fireEvent.compositionStart(secondTextarea);
    fireEvent.compositionEnd(secondTextarea, { data: "二" });

    act(() => {
      firstTextarea.focus();
    });
    fireEvent.compositionStart(firstTextarea);
    fireEvent.compositionEnd(firstTextarea, { data: "一" });

    expect(writeBytes).toHaveBeenNthCalledWith(1, "t2", "二");
    expect(writeBytes).toHaveBeenNthCalledWith(2, "t1", "一");
  });

  it("anchors IME preedit to the visible AI CLI input row when the terminal cursor is parked elsewhere", () => {
    const snapshot = snapshotFromRows(
      [
        "Gemini CLI v0.40.0",
        "",
        "──────────────────────────────────────────── ? for shortcuts",
        "Shift+Tab to accept edits",
        "> Type your message or @path/to/file",
        "workspace (/directory)                         branch",
      ],
      { row: 5, col: 79 },
      80,
    );
    const { container, queryByText } = render(
      <TerminalCanvas
        terminalId="t1"
        cols={80}
        rows={6}
        fontSize={14}
        snapshotOverride={snapshot}
        preferAiInputAnchor
      />,
    );
    const textarea = container.querySelector("[data-testid='terminal-ime-textarea']") as HTMLTextAreaElement;

    textarea.focus();
    fireEvent.compositionStart(textarea);
    fireEvent.compositionUpdate(textarea, { data: "ああ" });

    const overlay = queryByText("ああ") as HTMLElement;
    expect(overlay).not.toBeNull();
    expect(overlay.style.left).toBe("16px");
    expect(overlay.style.top).toBe("72px");
    expect(textarea.style.left).toBe("16px");
    expect(textarea.style.top).toBe("72px");

    const imeCalls = invokeMock.mock.calls.filter(([cmd]) => cmd === "set_ime_position");
    expect(imeCalls.length).toBeGreaterThan(0);
    const args = imeCalls.at(-1)?.[1] as { x: number; y: number; candidateX: number; candidateY: number };
    expect(args.x).toBe(16);
    expect(args.y).toBe(90);
    expect(args.candidateX).toBe(16);
    expect(args.candidateY).toBe(90);
  });

  it("anchors an empty boxed AI CLI alternate-screen prompt to the prompt input column", () => {
    const snapshot = snapshotFromRows(
      [
        "╭─ Claude Code ──────────────────────────────╮",
        "│                                             │",
        "│ >                                           │",
        "│                                             │",
        "╰─────────────────────────────────────────────╯",
        "tokens: 12k                                  ",
      ],
      { row: 5, col: 45 },
      48,
    );

    expect(findAiCliInputAnchor(snapshot)).toEqual({ row: 2, col: 4 });
  });

  it("anchors a boxed AI CLI alternate-screen prompt after typed text, not on the right border", () => {
    const snapshot: GridSnapshot = {
      cols: 48,
      rows: 4,
      cells: [
        rowFromText("Codex", 48),
        rowFromText("╭─────────────────────────────────────────────╮", 48),
        rowFromTerminalText("│ ❯ 日本語入力                                │", 48),
        rowFromText("╰─────────────────────────────────────────────╯", 48),
      ],
      cursor: {
        row: 3,
        col: 47,
        shape: "block",
        blinking: false,
        visible: true,
      },
    };

    expect(findAiCliInputAnchor(snapshot)).toEqual({ row: 2, col: 14 });
  });

  it("positions the native IME candidate after wide Japanese text in AI CLI alternate-screen input", () => {
    const snapshot: GridSnapshot = {
      cols: 80,
      rows: 4,
      cells: [
        rowFromText("Codex", 80),
        rowFromText("╭─────────────────────────────────────────────────────────────────────────────╮", 80),
        rowFromTerminalText("│ ❯ 日本語入力                                                              │", 80),
        rowFromText("╰─────────────────────────────────────────────────────────────────────────────╯", 80),
      ],
      cursor: {
        row: 3,
        col: 79,
        shape: "block",
        blinking: false,
        visible: true,
      },
    };
    const { container } = render(
      <TerminalCanvas
        terminalId="t1"
        cols={80}
        rows={4}
        fontSize={14}
        snapshotOverride={snapshot}
        preferAiInputAnchor
      />,
    );
    const textarea = container.querySelector("[data-testid='terminal-ime-textarea']") as HTMLTextAreaElement;

    textarea.focus();
    fireEvent.compositionStart(textarea);

    expect(textarea.style.left).toBe("112px");
    expect(textarea.style.top).toBe("36px");
    expect(textarea.dataset.imeAnchorMode).toBe("ai-cli-input");

    const imeCall = invokeMock.mock.calls.filter(([cmd]) => cmd === "set_ime_position").at(-1);
    const args = imeCall?.[1] as { x: number; y: number; candidateX: number; candidateY: number };
    expect(args.x).toBe(112);
    expect(args.y).toBe(54);
    expect(args.candidateX).toBe(112);
    expect(args.candidateY).toBe(54);
  });

  it("uses the real AI CLI cursor when Codex or Claude keeps it on the input row", () => {
    const snapshot: GridSnapshot = {
      cols: 80,
      rows: 5,
      cells: [
        rowFromText("Claude Code", 80),
        rowFromText("╭─────────────────────────────────────────────────────────────────────────────╮", 80),
        rowFromTerminalText("│ ❯ あああああ                                                              │", 80),
        rowFromText("╰─────────────────────────────────────────────────────────────────────────────╯", 80),
        rowFromText("tokens: 12k                                  ", 80),
      ],
      cursor: {
        row: 2,
        col: 14,
        shape: "beam",
        blinking: false,
        visible: true,
      },
    };
    const { container } = render(
      <TerminalCanvas
        terminalId="t1"
        cols={80}
        rows={5}
        fontSize={14}
        snapshotOverride={snapshot}
        preferAiInputAnchor
      />,
    );
    const textarea = container.querySelector("[data-testid='terminal-ime-textarea']") as HTMLTextAreaElement;

    textarea.focus();
    fireEvent.compositionStart(textarea);

    expect(textarea.style.left).toBe("112px");
    expect(textarea.style.top).toBe("36px");
    expect(textarea.dataset.imeAnchorMode).toBe("ai-cli-real-cursor");
  });

  it("re-anchors Codex or Claude IME when the visible cursor is parked on the input row edge", () => {
    const snapshot: GridSnapshot = {
      cols: 80,
      rows: 5,
      cells: [
        rowFromText("Claude Code", 80),
        rowFromText("╭─────────────────────────────────────────────────────────────────────────────╮", 80),
        rowFromTerminalText("│ ❯ あああああ                                                              │", 80),
        rowFromText("╰─────────────────────────────────────────────────────────────────────────────╯", 80),
        rowFromText("tokens: 12k                                  ", 80),
      ],
      cursor: {
        row: 2,
        col: 79,
        shape: "beam",
        blinking: false,
        visible: true,
      },
    };
    const { container } = render(
      <TerminalCanvas
        terminalId="t1"
        cols={80}
        rows={5}
        fontSize={14}
        snapshotOverride={snapshot}
        preferAiInputAnchor
      />,
    );
    const textarea = container.querySelector("[data-testid='terminal-ime-textarea']") as HTMLTextAreaElement;

    textarea.focus();
    fireEvent.compositionStart(textarea);

    expect(textarea.style.left).toBe("112px");
    expect(textarea.style.top).toBe("36px");
    expect(textarea.dataset.imeAnchorMode).toBe("ai-cli-input");
  });

  it("does not mistake an AI CLI logo prompt glyph near the top for the input row", () => {
    const snapshot = snapshotFromRows(
      [
        "     >",
        "   >",
        " >",
        "",
        "Gemini CLI v0.40.0",
        "",
        "MCP issues detected. Run /mcp list for status.",
        "──────────────────────────────────────────── ? for shortcuts",
        "workspace (/directory)                         branch",
        "model Auto                                      quota",
      ],
      { row: 9, col: 0 },
      80,
    );

    expect(findAiCliInputAnchor(snapshot)).toBeNull();
  });

  it("uses shortcut rows only after the user has typed visible text there", () => {
    const snapshot = snapshotFromRows(
      ["Claude Code v2.1.121", "", "────────────────────────────────────────────", "? for shortcuts あああ", ""],
      { row: 4, col: 0 },
      80,
    );

    expect(findAiCliInputAnchor(snapshot)).toEqual({ row: 3, col: 19 });
  });
});
