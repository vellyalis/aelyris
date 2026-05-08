import { act, render, screen } from "@testing-library/react";
import { createElement, useState } from "react";
import { describe, expect, it, vi } from "vitest";

const invokeMock = vi.hoisted(() => vi.fn(() => Promise.resolve()));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

import {
  copyImeDiagnostics,
  disableImeDiagnostics,
  enableImeDiagnostics,
  IME_DIAGNOSTIC_STORAGE_KEY,
  imeCandidateAnchorX,
  imeCandidateAnchorY,
  imeDiagnosticsEnabled,
  imeTextareaCaretInset,
  imeTextareaAnchorWidth,
  installImeDiagnosticHelpers,
  isSpecialKeyEvent,
  useCanvasIME,
  useImePosition,
  type WriteBytesFn,
} from "../features/terminal/hooks/useCanvasIME";
import { FALLBACK_TELEMETRY_EVENT, type FallbackTelemetryDetail } from "../shared/lib/fallbackTelemetry";
import { TERMINAL_PASTE_GUARD_EVENT } from "../shared/lib/terminalInput";

function ev(overrides: Partial<Parameters<typeof isSpecialKeyEvent>[0]> = {}): Parameters<typeof isSpecialKeyEvent>[0] {
  return {
    key: "a",
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    isComposing: false,
    keyCode: 65,
    ...overrides,
  };
}

describe("isSpecialKeyEvent", () => {
  it("returns false for plain printable keys (they go through `input` event)", () => {
    expect(isSpecialKeyEvent(ev({ key: "a" }))).toBe(false);
    expect(isSpecialKeyEvent(ev({ key: "1" }))).toBe(false);
    expect(isSpecialKeyEvent(ev({ key: "あ" }))).toBe(false);
    expect(isSpecialKeyEvent(ev({ key: "!" }))).toBe(false);
  });

  it("returns true for modifier combos", () => {
    expect(isSpecialKeyEvent(ev({ key: "c", ctrlKey: true }))).toBe(true);
    expect(isSpecialKeyEvent(ev({ key: "a", altKey: true }))).toBe(true);
    expect(isSpecialKeyEvent(ev({ key: "a", metaKey: true }))).toBe(true);
  });

  it("returns true for named editing keys", () => {
    expect(isSpecialKeyEvent(ev({ key: "Enter" }))).toBe(true);
    expect(isSpecialKeyEvent(ev({ key: "ArrowUp" }))).toBe(true);
    expect(isSpecialKeyEvent(ev({ key: "Escape" }))).toBe(true);
    expect(isSpecialKeyEvent(ev({ key: "Backspace" }))).toBe(true);
    expect(isSpecialKeyEvent(ev({ key: "Tab" }))).toBe(true);
    expect(isSpecialKeyEvent(ev({ key: "F1" }))).toBe(true);
    expect(isSpecialKeyEvent(ev({ key: "Home" }))).toBe(true);
    expect(isSpecialKeyEvent(ev({ key: "PageDown" }))).toBe(true);
    expect(isSpecialKeyEvent(ev({ key: "Delete" }))).toBe(true);
  });

  it("returns false during IME composition so the IME keeps the key", () => {
    expect(isSpecialKeyEvent(ev({ key: "Enter", isComposing: true }))).toBe(false);
    expect(isSpecialKeyEvent(ev({ key: "a", keyCode: 229 }))).toBe(false);
  });

  it("Shift alone on a printable key stays printable", () => {
    // Shift-A is still a single-char event that flows through input event
    // (the browser emits `key: 'A'`).
    expect(isSpecialKeyEvent({ ...ev({ key: "A" }), ctrlKey: false })).toBe(false);
  });
});

describe("imeCandidateAnchorX", () => {
  it("keeps the anchor at the caret when there is room for the candidate popup", () => {
    expect(imeCandidateAnchorX(120, 900)).toBe(120);
  });

  it("pulls the anchor left near the terminal's right edge", () => {
    expect(imeCandidateAnchorX(880, 900)).toBe(460);
  });

  it("never returns a negative anchor for narrow panes", () => {
    expect(imeCandidateAnchorX(32, 120)).toBe(0);
  });
});

describe("imeCandidateAnchorY", () => {
  it("keeps the candidate below the caret when there is vertical room", () => {
    expect(imeCandidateAnchorY(320, 900)).toBe(320);
  });

  it("pulls the candidate upward near the viewport bottom", () => {
    expect(imeCandidateAnchorY(820, 900)).toBe(640);
  });

  it("never returns a negative anchor for tiny viewports", () => {
    expect(imeCandidateAnchorY(40, 120)).toBe(0);
  });
});

describe("imeTextareaAnchorWidth", () => {
  it("uses the remaining canvas runway so long Japanese composition remains editable", () => {
    expect(imeTextareaAnchorWidth(120, 900)).toBe(780);
  });

  it("keeps the textarea inside the canvas when the candidate anchor is guarded left", () => {
    const anchor = imeCandidateAnchorX(880, 900);
    expect(anchor).toBe(460);
    expect(anchor + imeTextareaAnchorWidth(anchor, 900)).toBe(900);
  });

  it("keeps a minimal focusable width for degenerate measurements", () => {
    expect(imeTextareaAnchorWidth(Number.NaN, 0)).toBe(2);
  });
});

describe("imeTextareaCaretInset", () => {
  it("keeps the DOM caret at the real terminal cursor when the textarea is clamped left", () => {
    expect(imeTextareaCaretInset(880, 460, 900)).toBe(420);
  });

  it("does not create a negative inset for normal left-edge carets", () => {
    expect(imeTextareaCaretInset(120, 120, 900)).toBe(0);
  });
});

describe("useImePosition", () => {
  it("updates textarea runway and candidate coordinates after resize near the right edge", () => {
    const { textarea, rerenderPosition } = renderImePositionHarness({
      cursor: { row: 2, col: 78 },
      cols: 80,
      rows: 24,
      cellWidth: 10,
      cellHeight: 18,
      canvasRect: { left: 40, top: 80, width: 800, height: 432 },
    });

    expect(textarea.style.left).toBe("360px");
    expect(textarea.style.top).toBe("36px");
    expect(textarea.style.width).toBe("440px");
    expect(textarea.style.paddingLeft).toBe("420px");
    expect(textarea.dataset.imeCandidateX).toBe("360");
    expect(textarea.dataset.imeCandidateY).toBe("54");

    rerenderPosition({
      cursor: { row: 2, col: 48 },
      cols: 50,
      rows: 24,
      cellWidth: 10,
      cellHeight: 18,
      canvasRect: { left: 40, top: 80, width: 500, height: 432 },
    });

    expect(textarea.style.left).toBe("60px");
    expect(textarea.style.width).toBe("440px");
    expect(textarea.style.paddingLeft).toBe("420px");
    expect(textarea.dataset.imeCandidateX).toBe("60");
    expect(textarea.dataset.imeCandidateY).toBe("54");
  });

  it("pushes window-relative candidate coordinates for separate pane offsets", () => {
    invokeMock.mockClear();
    const { textarea } = renderImePositionHarness({
      cursor: { row: 4, col: 48 },
      cols: 50,
      rows: 24,
      cellWidth: 10,
      cellHeight: 18,
      canvasRect: { left: 640, top: 180, width: 500, height: 432 },
    });

    act(() => {
      textarea.focus();
      textarea.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    });

    expect(invokeMock).toHaveBeenCalledWith(
      "set_ime_position",
      expect.objectContaining({
        x: 1120,
        y: 270,
        candidateX: 700,
        candidateY: 270,
      }),
    );
    expect(textarea.dataset.imeCandidateX).toBe("700");
    expect(textarea.dataset.imeCandidateY).toBe("270");
  });

  it("reports IME positioning failures through fallback telemetry", async () => {
    invokeMock.mockClear();
    invokeMock.mockRejectedValueOnce(new Error("IMM denied"));
    const events: FallbackTelemetryDetail[] = [];
    const listener = (event: Event) => events.push((event as CustomEvent<FallbackTelemetryDetail>).detail);
    window.addEventListener(FALLBACK_TELEMETRY_EVENT, listener);
    try {
      const { textarea } = renderImePositionHarness({
        cursor: { row: 1, col: 2 },
        cols: 80,
        rows: 24,
        cellWidth: 10,
        cellHeight: 18,
        canvasRect: { left: 20, top: 40, width: 800, height: 432 },
      });

      act(() => {
        textarea.focus();
        textarea.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
      });

      await expect.poll(() => events.some((entry) => entry.operation === "set_ime_position")).toBe(true);
      expect(events.at(-1)).toMatchObject({
        source: "terminal-ime",
        operation: "set_ime_position",
        severity: "warning",
        message: "IMM denied",
      });
    } finally {
      window.removeEventListener(FALLBACK_TELEMETRY_EVENT, listener);
      invokeMock.mockResolvedValue(undefined);
    }
  });
});

describe("IME diagnostic helpers", () => {
  it("enables and disables diagnostic capture through a stable helper API", () => {
    disableImeDiagnostics(window);
    expect(imeDiagnosticsEnabled(window)).toBe(false);

    enableImeDiagnostics(window);
    expect(imeDiagnosticsEnabled(window)).toBe(true);
    expect(window.localStorage.getItem(IME_DIAGNOSTIC_STORAGE_KEY)).toBe("1");

    disableImeDiagnostics(window);
    expect(imeDiagnosticsEnabled(window)).toBe(false);
    expect(window.localStorage.getItem(IME_DIAGNOSTIC_STORAGE_KEY)).toBeNull();
  });

  it("installs console-style helpers that reuse the exported functions", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window.navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    installImeDiagnosticHelpers(window);
    window.__AETHER_ENABLE_IME_DEBUG__?.();
    window.__AETHER_IME_EVENTS__ = [
      {
        phase: "compositionstart",
        terminalId: "term-1",
        timestamp: 1,
        composing: true,
        active: true,
        valueLength: 0,
        scrollLeft: 0,
        selectionStart: 0,
        selectionEnd: 0,
        anchorLeft: "10px",
        anchorTop: "20px",
        anchorWidth: "200px",
        anchorHeight: "18px",
        viewportWidth: 1280,
        viewportHeight: 720,
        devicePixelRatio: 1,
        candidateLeft: "10",
        candidateTop: "38",
      },
    ];

    await expect(copyImeDiagnostics(window)).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('"terminalId": "term-1"'));

    await expect(window.__AETHER_COPY_IME_EVENTS__?.()).resolves.toBe(true);
    window.__AETHER_DISABLE_IME_DEBUG__?.();
    expect(imeDiagnosticsEnabled(window)).toBe(false);
  });

  it("records candidate anchor and DPI context in the opt-in diagnostic ring", () => {
    const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
    const writeBytes = vi.fn() as WriteBytesFn;
    renderImeHarness({ writeBytes });
    const textarea = screen.getByTestId("ime-target") as HTMLTextAreaElement;
    textarea.style.left = "120px";
    textarea.style.top = "60px";
    textarea.style.width = "480px";
    textarea.style.height = "18px";
    textarea.dataset.imeCandidateX = "120";
    textarea.dataset.imeCandidateY = "78";

    enableImeDiagnostics(window);
    dispatchComposition(textarea, "compositionstart");

    const last = window.__AETHER_IME_EVENTS__?.at(-1);
    expect(last).toEqual(
      expect.objectContaining({
        phase: "compositionstart",
        terminalId: "term-1",
        anchorLeft: "120px",
        anchorTop: "60px",
        anchorWidth: "480px",
        anchorHeight: "18px",
        candidateLeft: "120",
        candidateTop: "78",
        devicePixelRatio: window.devicePixelRatio,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
      }),
    );
    expect(debugSpy).toHaveBeenCalled();
    disableImeDiagnostics(window);
  });
});

describe("useCanvasIME composition lifecycle", () => {
  it("keeps long Japanese preedit editable and commits it once", () => {
    const writeBytes = vi.fn() as WriteBytesFn;
    const onCompositionTextChange = vi.fn();
    renderImeHarness({ writeBytes, onCompositionTextChange });
    const textarea = screen.getByTestId("ime-target") as HTMLTextAreaElement;
    const longText = "あ".repeat(32);

    dispatchComposition(textarea, "compositionstart");
    textarea.value = longText;
    dispatchInput(textarea, { data: longText, inputType: "insertCompositionText", isComposing: true });

    expect(onCompositionTextChange).toHaveBeenLastCalledWith(longText);
    expect(writeBytes).not.toHaveBeenCalled();

    textarea.value = longText.slice(0, -1);
    dispatchInput(textarea, { data: null, inputType: "deleteCompositionText", isComposing: true });
    expect(onCompositionTextChange).toHaveBeenLastCalledWith(longText.slice(0, -1));

    dispatchComposition(textarea, "compositionend", { data: longText.slice(0, -1) });

    expect(writeBytes).toHaveBeenCalledTimes(1);
    expect(writeBytes).toHaveBeenCalledWith("term-1", longText.slice(0, -1));
    expect(textarea.value).toBe("");
  });

  it("waits for the final non-composing input when compositionend data is empty", () => {
    vi.useFakeTimers();
    try {
      const writeBytes = vi.fn() as WriteBytesFn;
      renderImeHarness({ writeBytes });
      const textarea = screen.getByTestId("ime-target") as HTMLTextAreaElement;

      dispatchComposition(textarea, "compositionstart");
      textarea.value = "かな";
      dispatchInput(textarea, { data: "かな", inputType: "insertCompositionText", isComposing: true });
      textarea.value = "";
      dispatchComposition(textarea, "compositionend", { data: "" });

      textarea.value = "仮名";
      dispatchInput(textarea, { data: "仮名", inputType: "insertText", isComposing: false });

      act(() => {
        vi.runAllTimers();
      });

      expect(writeBytes).toHaveBeenCalledTimes(1);
      expect(writeBytes).toHaveBeenCalledWith("term-1", "仮名");
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not commit stale textarea preedit when empty compositionend is followed by final input", () => {
    vi.useFakeTimers();
    try {
      const writeBytes = vi.fn() as WriteBytesFn;
      renderImeHarness({ writeBytes });
      const textarea = screen.getByTestId("ime-target") as HTMLTextAreaElement;

      dispatchComposition(textarea, "compositionstart");
      textarea.value = "あ".repeat(24);
      dispatchInput(textarea, { data: textarea.value, inputType: "insertCompositionText", isComposing: true });
      textarea.value = "あ".repeat(24);
      dispatchComposition(textarea, "compositionend", { data: "" });

      textarea.value = "今日";
      dispatchInput(textarea, { data: "今日", inputType: "insertText", isComposing: false });

      act(() => {
        vi.runAllTimers();
      });

      expect(writeBytes).toHaveBeenCalledTimes(1);
      expect(writeBytes).toHaveBeenCalledWith("term-1", "今日");
    } finally {
      vi.useRealTimers();
    }
  });

  it("falls back to the last preedit if empty compositionend is not followed by input", () => {
    vi.useFakeTimers();
    try {
      const writeBytes = vi.fn() as WriteBytesFn;
      renderImeHarness({ writeBytes });
      const textarea = screen.getByTestId("ime-target") as HTMLTextAreaElement;

      dispatchComposition(textarea, "compositionstart");
      textarea.value = "かな";
      dispatchInput(textarea, { data: "かな", inputType: "insertCompositionText", isComposing: true });
      dispatchComposition(textarea, "compositionend", { data: "" });

      expect(writeBytes).not.toHaveBeenCalled();
      act(() => {
        vi.advanceTimersByTime(32);
      });

      expect(writeBytes).toHaveBeenCalledTimes(1);
      expect(writeBytes).toHaveBeenCalledWith("term-1", "かな");
    } finally {
      vi.useRealTimers();
    }
  });

  it("survives a late composing input after an empty compositionend", () => {
    vi.useFakeTimers();
    try {
      const writeBytes = vi.fn() as WriteBytesFn;
      const onCompositionTextChange = vi.fn();
      renderImeHarness({ writeBytes, onCompositionTextChange });
      const textarea = screen.getByTestId("ime-target") as HTMLTextAreaElement;

      dispatchComposition(textarea, "compositionstart");
      textarea.value = "とうきょう";
      dispatchInput(textarea, { data: "とうきょう", inputType: "insertCompositionText", isComposing: true });
      textarea.value = "";
      dispatchComposition(textarea, "compositionend", { data: "" });

      textarea.value = "東京";
      dispatchInput(textarea, { data: "東京", inputType: "insertCompositionText", isComposing: true });
      dispatchComposition(textarea, "compositionend", { data: "" });

      act(() => {
        vi.advanceTimersByTime(32);
      });

      expect(writeBytes).toHaveBeenCalledTimes(1);
      expect(writeBytes).toHaveBeenCalledWith("term-1", "東京");
      expect(onCompositionTextChange).toHaveBeenLastCalledWith("");
    } finally {
      vi.useRealTimers();
    }
  });

  it("commits final input after a late composing input even without a second compositionend", () => {
    vi.useFakeTimers();
    try {
      const writeBytes = vi.fn() as WriteBytesFn;
      renderImeHarness({ writeBytes });
      const textarea = screen.getByTestId("ime-target") as HTMLTextAreaElement;

      dispatchComposition(textarea, "compositionstart");
      textarea.value = "にほん";
      dispatchInput(textarea, { data: "にほん", inputType: "insertCompositionText", isComposing: true });
      textarea.value = "";
      dispatchComposition(textarea, "compositionend", { data: "" });

      textarea.value = "日本";
      dispatchInput(textarea, { data: "日本", inputType: "insertCompositionText", isComposing: true });
      textarea.value = "日本語";
      dispatchInput(textarea, { data: "日本語", inputType: "insertText", isComposing: false });

      act(() => {
        vi.runAllTimers();
      });

      expect(writeBytes).toHaveBeenCalledTimes(1);
      expect(writeBytes).toHaveBeenCalledWith("term-1", "日本語");
      expect(textarea.value).toBe("");
    } finally {
      vi.useRealTimers();
    }
  });

  it("cancels stale empty-compositionend fallback when Backspace arrives first", () => {
    vi.useFakeTimers();
    try {
      const writeBytes = vi.fn() as WriteBytesFn;
      renderImeHarness({ writeBytes });
      const textarea = screen.getByTestId("ime-target") as HTMLTextAreaElement;
      const longPreedit = "あ".repeat(36);

      dispatchComposition(textarea, "compositionstart");
      textarea.value = longPreedit;
      dispatchInput(textarea, { data: longPreedit, inputType: "insertCompositionText", isComposing: true });
      textarea.value = longPreedit;
      dispatchComposition(textarea, "compositionend", { data: "" });

      dispatchKeyDown(textarea, { key: "Backspace", keyCode: 8 });
      act(() => {
        vi.runAllTimers();
      });

      expect(writeBytes).toHaveBeenCalledTimes(1);
      expect(writeBytes).toHaveBeenCalledWith("term-1", "\x7f");
      expect(JSON.stringify(window.__AETHER_IME_EVENTS__ ?? [])).not.toContain(longPreedit);
    } finally {
      vi.useRealTimers();
    }
  });

  it("cancels stale empty-compositionend fallback when Delete arrives first", () => {
    vi.useFakeTimers();
    try {
      const writeBytes = vi.fn() as WriteBytesFn;
      renderImeHarness({ writeBytes });
      const textarea = screen.getByTestId("ime-target") as HTMLTextAreaElement;
      const longPreedit = "かな".repeat(18);

      dispatchComposition(textarea, "compositionstart");
      textarea.value = longPreedit;
      dispatchInput(textarea, { data: longPreedit, inputType: "insertCompositionText", isComposing: true });
      textarea.value = longPreedit;
      dispatchComposition(textarea, "compositionend", { data: "" });

      dispatchKeyDown(textarea, { key: "Delete", keyCode: 46 });
      act(() => {
        vi.runAllTimers();
      });

      expect(writeBytes).toHaveBeenCalledTimes(1);
      expect(writeBytes).toHaveBeenCalledWith("term-1", "\x1b[3~");
      expect(JSON.stringify(window.__AETHER_IME_EVENTS__ ?? [])).not.toContain(longPreedit);
    } finally {
      vi.useRealTimers();
    }
  });

  it("clears interrupted composition state when paste writes directly to the PTY", () => {
    vi.useFakeTimers();
    try {
      const writeBytes = vi.fn() as WriteBytesFn;
      const onCompositionTextChange = vi.fn();
      renderImeHarness({ writeBytes, onCompositionTextChange });
      const textarea = screen.getByTestId("ime-target") as HTMLTextAreaElement;
      const pasteEvent = new Event("paste", { bubbles: true, cancelable: true }) as ClipboardEvent;
      Object.defineProperty(pasteEvent, "clipboardData", {
        value: {
          getData: (type: string) => (type === "text" || type === "text/plain" ? "echo pasted\n" : ""),
        },
      });

      dispatchComposition(textarea, "compositionstart");
      textarea.value = "かな入力";
      dispatchInput(textarea, { data: "かな入力", inputType: "insertCompositionText", isComposing: true });

      act(() => {
        textarea.dispatchEvent(pasteEvent);
      });
      dispatchComposition(textarea, "compositionend", { data: "かな入力" });
      act(() => {
        vi.runAllTimers();
      });

      expect(writeBytes).toHaveBeenCalledTimes(1);
      expect(writeBytes).toHaveBeenCalledWith("term-1", "echo pasted\r");
      expect(textarea.value).toBe("");
      expect(onCompositionTextChange).toHaveBeenLastCalledWith("");
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not let a previous long composition reduce the next committed input to one character", () => {
    vi.useFakeTimers();
    try {
      const writeBytes = vi.fn() as WriteBytesFn;
      renderImeHarness({ writeBytes });
      const textarea = screen.getByTestId("ime-target") as HTMLTextAreaElement;
      const longPreedit = "あ".repeat(40);

      dispatchComposition(textarea, "compositionstart");
      textarea.value = longPreedit;
      dispatchInput(textarea, { data: longPreedit, inputType: "insertCompositionText", isComposing: true });
      dispatchComposition(textarea, "compositionend", { data: longPreedit });

      act(() => {
        vi.advanceTimersByTime(180);
      });

      textarea.value = "日本語入力";
      dispatchInput(textarea, { data: "日本語入力", inputType: "insertText", isComposing: false });

      expect(writeBytes).toHaveBeenCalledTimes(2);
      expect(writeBytes).toHaveBeenNthCalledWith(1, "term-1", longPreedit);
      expect(writeBytes).toHaveBeenNthCalledWith(2, "term-1", "日本語入力");
      expect(textarea.value).toBe("");
    } finally {
      vi.useRealTimers();
    }
  });

  it("drops Chromium's trailing duplicate input after compositionend committed text", () => {
    const writeBytes = vi.fn() as WriteBytesFn;
    renderImeHarness({ writeBytes });
    const textarea = screen.getByTestId("ime-target") as HTMLTextAreaElement;

    dispatchComposition(textarea, "compositionstart");
    textarea.value = "日本語";
    dispatchComposition(textarea, "compositionend", { data: "日本語" });
    textarea.value = "日本語";
    dispatchInput(textarea, { data: "日本語", inputType: "insertText", isComposing: false });

    expect(writeBytes).toHaveBeenCalledTimes(1);
    expect(writeBytes).toHaveBeenCalledWith("term-1", "日本語");
  });

  it("expires the duplicate-input guard so a later identical plain input is not lost", () => {
    vi.useFakeTimers();
    try {
      const writeBytes = vi.fn() as WriteBytesFn;
      renderImeHarness({ writeBytes });
      const textarea = screen.getByTestId("ime-target") as HTMLTextAreaElement;

      dispatchComposition(textarea, "compositionstart");
      dispatchComposition(textarea, "compositionend", { data: "あ" });

      act(() => {
        vi.advanceTimersByTime(161);
      });

      textarea.value = "あ";
      dispatchInput(textarea, { data: "あ", inputType: "insertText", isComposing: false });

      expect(writeBytes).toHaveBeenCalledTimes(2);
      expect(writeBytes).toHaveBeenNthCalledWith(1, "term-1", "あ");
      expect(writeBytes).toHaveBeenNthCalledWith(2, "term-1", "あ");
    } finally {
      vi.useRealTimers();
    }
  });

  it("clears a stale duplicate guard when a new composition starts", () => {
    vi.useFakeTimers();
    try {
      const writeBytes = vi.fn() as WriteBytesFn;
      renderImeHarness({ writeBytes });
      const textarea = screen.getByTestId("ime-target") as HTMLTextAreaElement;

      dispatchComposition(textarea, "compositionstart");
      dispatchComposition(textarea, "compositionend", { data: "同じ" });
      dispatchComposition(textarea, "compositionstart");
      textarea.value = "同じ";
      dispatchInput(textarea, { data: "同じ", inputType: "insertCompositionText", isComposing: true });
      dispatchComposition(textarea, "compositionend", { data: "同じ" });

      expect(writeBytes).toHaveBeenCalledTimes(2);
      expect(writeBytes).toHaveBeenNthCalledWith(1, "term-1", "同じ");
      expect(writeBytes).toHaveBeenNthCalledWith(2, "term-1", "同じ");
    } finally {
      vi.useRealTimers();
    }
  });

  it("preserves preedit when the textarea blurs mid-composition", () => {
    vi.useFakeTimers();
    try {
      const writeBytes = vi.fn() as WriteBytesFn;
      const onCompositionTextChange = vi.fn();
      renderImeHarness({ writeBytes, onCompositionTextChange });
      const textarea = screen.getByTestId("ime-target") as HTMLTextAreaElement;

      dispatchComposition(textarea, "compositionstart");
      textarea.value = "かな";
      dispatchInput(textarea, { data: "かな", inputType: "insertCompositionText", isComposing: true });

      act(() => {
        textarea.dispatchEvent(new FocusEvent("blur", { bubbles: false }));
        vi.runAllTimers();
      });

      expect(writeBytes).not.toHaveBeenCalled();
      expect(textarea.value).toBe("かな");
      expect(onCompositionTextChange).toHaveBeenLastCalledWith("かな");
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps empty-compositionend fallback alive across blur", () => {
    vi.useFakeTimers();
    try {
      const writeBytes = vi.fn() as WriteBytesFn;
      renderImeHarness({ writeBytes });
      const textarea = screen.getByTestId("ime-target") as HTMLTextAreaElement;

      dispatchComposition(textarea, "compositionstart");
      textarea.value = "かな";
      dispatchInput(textarea, { data: "かな", inputType: "insertCompositionText", isComposing: true });
      dispatchComposition(textarea, "compositionend", { data: "" });

      act(() => {
        textarea.dispatchEvent(new FocusEvent("blur", { bubbles: false }));
        vi.advanceTimersByTime(32);
      });

      expect(writeBytes).toHaveBeenCalledTimes(1);
      expect(writeBytes).toHaveBeenCalledWith("term-1", "かな");
    } finally {
      vi.useRealTimers();
    }
  });

  it("cancels in-flight preedit when text is pasted while composing", () => {
    vi.useFakeTimers();
    try {
      const writeBytes = vi.fn() as WriteBytesFn;
      const onCompositionTextChange = vi.fn();
      renderImeHarness({ writeBytes, onCompositionTextChange });
      const textarea = screen.getByTestId("ime-target") as HTMLTextAreaElement;

      dispatchComposition(textarea, "compositionstart");
      textarea.value = "かな";
      dispatchInput(textarea, { data: "かな", inputType: "insertCompositionText", isComposing: true });
      dispatchPaste(textarea, "echo PASTED");
      dispatchComposition(textarea, "compositionend", { data: "かな" });

      act(() => {
        vi.runAllTimers();
      });

      expect(writeBytes).toHaveBeenCalledTimes(1);
      expect(writeBytes).toHaveBeenCalledWith("term-1", "echo PASTED");
      expect(textarea.value).toBe("");
      expect(onCompositionTextChange).toHaveBeenLastCalledWith("");
    } finally {
      vi.useRealTimers();
    }
  });

  it("blocks destructive terminal paste before writing to the PTY", () => {
    const writeBytes = vi.fn() as WriteBytesFn;
    renderImeHarness({ writeBytes });
    const textarea = screen.getByTestId("ime-target") as HTMLTextAreaElement;
    const events: Array<Record<string, unknown>> = [];
    const onGuard = (event: Event) => {
      events.push((event as CustomEvent).detail as Record<string, unknown>);
    };
    window.addEventListener(TERMINAL_PASTE_GUARD_EVENT, onGuard);

    try {
      dispatchPaste(textarea, "rm -rf / --token=secret-value\n");

      expect(writeBytes).not.toHaveBeenCalled();
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        terminalId: "term-1",
        action: "blocked",
        shouldBlock: true,
        risk: expect.objectContaining({
          severity: "deny",
          redacted: true,
        }),
      });
      expect(JSON.stringify(events[0])).not.toContain("secret-value");
    } finally {
      window.removeEventListener(TERMINAL_PASTE_GUARD_EVENT, onGuard);
    }
  });

  it("requires confirmation before sending multi-line terminal paste", () => {
    const writeBytes = vi.fn() as WriteBytesFn;
    renderImeHarness({ writeBytes });
    const textarea = screen.getByTestId("ime-target") as HTMLTextAreaElement;
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValueOnce(true);
    const events: Array<Record<string, unknown>> = [];
    const onGuard = (event: Event) => {
      events.push((event as CustomEvent).detail as Record<string, unknown>);
    };
    window.addEventListener(TERMINAL_PASTE_GUARD_EVENT, onGuard);

    try {
      dispatchPaste(textarea, "echo one\necho two\n");

      expect(confirmSpy).toHaveBeenCalled();
      expect(writeBytes).toHaveBeenCalledWith("term-1", "echo one\recho two\r");
      expect(events.at(-1)).toMatchObject({
        action: "confirmed",
        shouldConfirm: true,
      });
    } finally {
      confirmSpy.mockRestore();
      window.removeEventListener(TERMINAL_PASTE_GUARD_EVENT, onGuard);
    }
  });
});

interface ImePositionHarnessProps {
  cursor: { row: number; col: number };
  cols: number;
  rows: number;
  cellWidth: number;
  cellHeight: number;
  canvasRect: { left: number; top: number; width: number; height: number };
}

function ImePositionHarness({ cursor, cols, rows, cellWidth, cellHeight, canvasRect }: ImePositionHarnessProps) {
  const [textarea, setTextarea] = useState<HTMLTextAreaElement | null>(null);
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);

  useImePosition({
    textarea,
    cursor,
    cols,
    rows,
    cellWidth,
    cellHeight,
    canvas,
  });

  return createElement(
    "div",
    null,
    createElement("canvas", {
      "data-testid": "ime-position-canvas",
      ref: (node: HTMLCanvasElement | null) => {
        if (!node) return;
        node.getBoundingClientRect = () =>
          ({
            x: canvasRect.left,
            y: canvasRect.top,
            left: canvasRect.left,
            top: canvasRect.top,
            right: canvasRect.left + canvasRect.width,
            bottom: canvasRect.top + canvasRect.height,
            width: canvasRect.width,
            height: canvasRect.height,
            toJSON: () => ({}),
          }) as DOMRect;
        setCanvas((current) => (current === node ? current : node));
      },
    }),
    createElement("textarea", {
      "data-testid": "ime-position-target",
      ref: setTextarea,
    }),
  );
}

function renderImePositionHarness(props: ImePositionHarnessProps) {
  const utils = render(createElement(ImePositionHarness, props));
  const textarea = screen.getByTestId("ime-position-target") as HTMLTextAreaElement;
  return {
    ...utils,
    textarea,
    rerenderPosition: (nextProps: ImePositionHarnessProps) => {
      utils.rerender(createElement(ImePositionHarness, nextProps));
    },
  };
}

function ImeHarness({
  writeBytes,
  onCompositionTextChange,
}: {
  writeBytes: WriteBytesFn;
  onCompositionTextChange?: (text: string) => void;
}) {
  const [textarea, setTextarea] = useState<HTMLTextAreaElement | null>(null);
  useCanvasIME({
    terminalId: "term-1",
    textarea,
    writeBytes,
    onCompositionTextChange,
  });

  return createElement("textarea", {
    ref: setTextarea,
    "data-testid": "ime-target",
  });
}

function renderImeHarness(props: { writeBytes: WriteBytesFn; onCompositionTextChange?: (text: string) => void }) {
  return render(createElement(ImeHarness, props));
}

function dispatchComposition(
  target: HTMLTextAreaElement,
  type: "compositionstart" | "compositionupdate" | "compositionend",
  init: CompositionEventInit = {},
) {
  act(() => {
    target.dispatchEvent(new CompositionEvent(type, { bubbles: true, cancelable: true, ...init }));
  });
}

function dispatchInput(
  target: HTMLTextAreaElement,
  init: { data: string | null; inputType: string; isComposing: boolean },
) {
  act(() => {
    target.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        cancelable: true,
        data: init.data,
        inputType: init.inputType,
        isComposing: init.isComposing,
      } as InputEventInit),
    );
  });
}

function dispatchKeyDown(
  target: HTMLTextAreaElement,
  init: { key: string; keyCode?: number; ctrlKey?: boolean; altKey?: boolean; metaKey?: boolean },
) {
  act(() => {
    target.dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: init.key,
        keyCode: init.keyCode,
        ctrlKey: init.ctrlKey ?? false,
        altKey: init.altKey ?? false,
        metaKey: init.metaKey ?? false,
      }),
    );
  });
}

function dispatchPaste(target: HTMLTextAreaElement, text: string) {
  act(() => {
    const event = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", {
      configurable: true,
      value: {
        getData: (type: string) => (type === "text" || type === "text/plain" ? text : ""),
      },
    });
    target.dispatchEvent(event);
  });
}
