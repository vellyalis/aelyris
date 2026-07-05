import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { isEditableTarget } from "../shared/hooks/useEditableTargetGuard";
import { useKeyboardShortcuts } from "../shared/hooks/useKeyboardShortcuts";
import { FALLBACK_TELEMETRY_EVENT, type FallbackTelemetryDetail } from "../shared/lib/fallbackTelemetry";

function baseOptions() {
  return {
    projectPath: "C:/repo",
    tabs: [{ id: "tab-1" }],
    addTab: vi.fn(),
    closeTab: vi.fn(),
    activeTabId: "tab-1",
    setActiveTabId: vi.fn(),
    activeFile: null,
    sessions: [],
    activeSessionId: null,
    setActiveSessionId: vi.fn(),
    setPaletteVisible: vi.fn(),
    setSettingsVisible: vi.fn(),
    setSearchVisible: vi.fn(),
    handleOpenFolder: vi.fn(),
    handleCloseFile: vi.fn(),
    handleFileSelect: vi.fn(),
    handleStartAgent: vi.fn(),
  };
}

function listenForFallbackTelemetry() {
  const events: FallbackTelemetryDetail[] = [];
  const listener = (event: Event) => {
    events.push((event as CustomEvent<FallbackTelemetryDetail>).detail);
  };
  window.addEventListener(FALLBACK_TELEMETRY_EVENT, listener);
  return {
    events,
    cleanup: () => window.removeEventListener(FALLBACK_TELEMETRY_EVENT, listener),
  };
}

describe("useKeyboardShortcuts terminal focus", () => {
  it("treats the native terminal input surface as editable so app shortcuts cannot steal terminal input", () => {
    const native = document.createElement("div");
    native.setAttribute("role", "textbox");
    native.setAttribute("data-native-input-surface", "true");
    const canvas = document.createElement("canvas");
    native.appendChild(canvas);
    document.body.appendChild(native);

    try {
      expect(isEditableTarget(native)).toBe(true);
      expect(isEditableTarget(canvas)).toBe(true);
    } finally {
      native.remove();
    }
  });

  it("emits fallback telemetry when Ctrl+` focuses the WebView IME fallback", async () => {
    const textarea = document.createElement("textarea");
    textarea.setAttribute("data-testid", "terminal-ime-textarea");
    document.body.appendChild(textarea);
    const focus = vi.spyOn(textarea, "focus");
    const telemetry = listenForFallbackTelemetry();
    const { unmount } = renderHook(() => useKeyboardShortcuts(baseOptions()));

    try {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "`", ctrlKey: true, bubbles: true }));

      expect(focus).toHaveBeenCalled();
      await waitFor(() => expect(telemetry.events.length).toBeGreaterThan(0));
      expect(telemetry.events[0]).toEqual(
        expect.objectContaining({
          source: "terminal.input",
          operation: "focus_webview_ime_fallback",
          severity: "warning",
          userVisible: true,
        }),
      );
    } finally {
      unmount();
      telemetry.cleanup();
      textarea.remove();
    }
  });

  it("does not emit fallback telemetry when Ctrl+` focuses a native input surface", async () => {
    const native = document.createElement("div");
    native.setAttribute("data-native-input-surface", "true");
    document.body.appendChild(native);
    const focus = vi.spyOn(native, "focus");
    const telemetry = listenForFallbackTelemetry();
    const { unmount } = renderHook(() => useKeyboardShortcuts(baseOptions()));

    try {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "`", ctrlKey: true, bubbles: true }));

      expect(focus).toHaveBeenCalled();
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(telemetry.events).toEqual([]);
    } finally {
      unmount();
      telemetry.cleanup();
      native.remove();
    }
  });

  it("toggles Zen mode with Ctrl+Shift+M", () => {
    const setZenMode = vi.fn();
    const { unmount } = renderHook(() => useKeyboardShortcuts({ ...baseOptions(), setZenMode }));

    try {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "M", ctrlKey: true, shiftKey: true, bubbles: true }));

      expect(setZenMode).toHaveBeenCalledWith(expect.any(Function));
      const toggle = setZenMode.mock.calls[0][0] as (prev: boolean) => boolean;
      expect(toggle(false)).toBe(true);
      expect(toggle(true)).toBe(false);
    } finally {
      unmount();
    }
  });
});
