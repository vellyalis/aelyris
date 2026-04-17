import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

import {
  useInputMirror,
  type UseInputMirrorResult,
} from "../features/terminal/hooks/useInputMirror";

interface HarnessProps {
  element: HTMLElement | null;
  enabled: boolean;
  suggestion: string | null;
  onAccept: (s: string) => void;
  onCommit?: (c: string) => void;
  exposeRef: (res: UseInputMirrorResult) => void;
}

function Harness({
  element,
  enabled,
  suggestion,
  onAccept,
  onCommit,
  exposeRef,
}: HarnessProps): ReactNode {
  const res = useInputMirror({ element, enabled, suggestion, onAccept, onCommit });
  exposeRef(res);
  return null;
}

function fireKey(el: HTMLElement, init: KeyboardEventInit) {
  const ev = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
  el.dispatchEvent(ev);
  return ev;
}

describe("useInputMirror", () => {
  afterEach(() => cleanup());

  function setup(overrides: Partial<HarnessProps> = {}) {
    const el = document.createElement("div");
    document.body.appendChild(el);
    let latest: UseInputMirrorResult = { buffer: "", reset: () => {} };
    const onAccept = vi.fn();
    const onCommit = vi.fn();
    const { rerender } = render(
      <Harness
        element={el}
        enabled
        suggestion={null}
        onAccept={onAccept}
        onCommit={onCommit}
        exposeRef={(r) => {
          latest = r;
        }}
        {...overrides}
      />,
    );
    return {
      el,
      onAccept,
      onCommit,
      get buffer() {
        return latest.buffer;
      },
      reset: () => latest.reset(),
      rerenderWith: (o: Partial<HarnessProps>) =>
        rerender(
          <Harness
            element={el}
            enabled
            suggestion={null}
            onAccept={onAccept}
            onCommit={onCommit}
            exposeRef={(r) => {
              latest = r;
            }}
            {...overrides}
            {...o}
          />,
        ),
    };
  }

  it("appends printable keys to the buffer", () => {
    const ctx = setup();
    act(() => {
      fireKey(ctx.el, { key: "g" });
      fireKey(ctx.el, { key: "i" });
      fireKey(ctx.el, { key: "t" });
    });
    expect(ctx.buffer).toBe("git");
  });

  it("drops the last char on Backspace", () => {
    const ctx = setup();
    act(() => {
      fireKey(ctx.el, { key: "g" });
      fireKey(ctx.el, { key: "i" });
      fireKey(ctx.el, { key: "Backspace" });
    });
    expect(ctx.buffer).toBe("g");
  });

  it("commits and clears on Enter", () => {
    const ctx = setup();
    act(() => {
      fireKey(ctx.el, { key: "l" });
      fireKey(ctx.el, { key: "s" });
      fireKey(ctx.el, { key: "Enter" });
    });
    expect(ctx.onCommit).toHaveBeenCalledWith("ls");
    expect(ctx.buffer).toBe("");
  });

  it("clears on arrow keys", () => {
    const ctx = setup();
    act(() => {
      fireKey(ctx.el, { key: "g" });
      fireKey(ctx.el, { key: "i" });
      fireKey(ctx.el, { key: "ArrowUp" });
    });
    expect(ctx.buffer).toBe("");
  });

  it("clears on Ctrl+C", () => {
    const ctx = setup();
    act(() => {
      fireKey(ctx.el, { key: "a" });
      fireKey(ctx.el, { key: "b" });
      fireKey(ctx.el, { key: "c", ctrlKey: true });
    });
    expect(ctx.buffer).toBe("");
  });

  it("accepts suggestion on Tab when suggestion is present", () => {
    const ctx = setup({ suggestion: "tatus" });
    act(() => {
      fireKey(ctx.el, { key: "g" });
      fireKey(ctx.el, { key: "i" });
      fireKey(ctx.el, { key: "t" });
      fireKey(ctx.el, { key: " " });
      fireKey(ctx.el, { key: "s" });
    });
    const tabEv = new KeyboardEvent("keydown", {
      key: "Tab",
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      ctx.el.dispatchEvent(tabEv);
    });
    expect(ctx.onAccept).toHaveBeenCalledWith("tatus");
    expect(ctx.buffer).toBe("git status");
    expect(tabEv.defaultPrevented).toBe(true);
  });

  it("lets Tab pass through when no suggestion", () => {
    const ctx = setup({ suggestion: null });
    act(() => {
      fireKey(ctx.el, { key: "g" });
    });
    const tabEv = new KeyboardEvent("keydown", {
      key: "Tab",
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      ctx.el.dispatchEvent(tabEv);
    });
    expect(ctx.onAccept).not.toHaveBeenCalled();
    expect(tabEv.defaultPrevented).toBe(false);
  });

  it("ignores IME composing keystrokes", () => {
    const ctx = setup();
    act(() => {
      fireKey(ctx.el, { key: "あ", isComposing: true });
    });
    expect(ctx.buffer).toBe("");
  });

  it("clears buffer when disabled flips off", () => {
    const ctx = setup();
    act(() => {
      fireKey(ctx.el, { key: "h" });
      fireKey(ctx.el, { key: "i" });
    });
    expect(ctx.buffer).toBe("hi");
    act(() => {
      ctx.rerenderWith({ enabled: false });
    });
    expect(ctx.buffer).toBe("");
  });

  it("ignores Ctrl+Shift+* app shortcuts", () => {
    const ctx = setup();
    act(() => {
      fireKey(ctx.el, { key: "P", ctrlKey: true, shiftKey: true });
    });
    expect(ctx.buffer).toBe("");
  });
});
