import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NativeTerminalArea } from "../features/terminal/NativeTerminalArea";

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
}

type DivWithClient = HTMLDivElement & {
  _cw?: number;
  _ch?: number;
};

function stubClientSize(width: number, height: number) {
  Object.defineProperty(HTMLDivElement.prototype, "clientWidth", {
    configurable: true,
    get() {
      return (this as DivWithClient)._cw ?? width;
    },
  });
  Object.defineProperty(HTMLDivElement.prototype, "clientHeight", {
    configurable: true,
    get() {
      return (this as DivWithClient)._ch ?? height;
    },
  });
}

class MockResizeObserver {
  private cb: ResizeObserverCallback;
  constructor(cb: ResizeObserverCallback) {
    this.cb = cb;
  }
  observe() {
    /* no-op for tests; measurement is forced via dispatch */
    void this.cb;
  }
  unobserve() {}
  disconnect() {}
}

describe("NativeTerminalArea", () => {
  beforeEach(() => {
    installCanvasMock();
    stubClientSize(672, 408); // 80 cols * 8px, 24 rows * 17px
    (globalThis as unknown as { ResizeObserver: typeof ResizeObserver }).ResizeObserver =
      MockResizeObserver as unknown as typeof ResizeObserver;
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("spawns a PTY with measured dimensions and mounts TerminalCanvas", async () => {
    const spawnPty = vi.fn().mockResolvedValue("term-42");
    const resizePty = vi.fn();
    const onReady = vi.fn();

    const { container } = render(
      <NativeTerminalArea
        shell="powershell"
        cwd="C:/tmp"
        onTerminalReady={onReady}
        spawnPty={spawnPty}
        resizePty={resizePty}
        subscribeOutput={async () => () => {}}
      />,
    );

    await waitFor(() => expect(spawnPty).toHaveBeenCalledTimes(1));
    const args = spawnPty.mock.calls[0][0];
    expect(args.shell).toBe("powershell");
    expect(args.cwd).toBe("C:/tmp");
    // 672 / round(14*0.6)=8 → 84 cols, 408 / round(14*1.25)=18 → 22 rows.
    expect(args.cols).toBeGreaterThanOrEqual(20);
    expect(args.rows).toBeGreaterThanOrEqual(5);

    await waitFor(() => expect(onReady).toHaveBeenCalledWith("term-42"));
    await waitFor(() => expect(container.querySelector("[data-testid='terminal-canvas']")).not.toBeNull());

    const canvas = container.querySelector("[data-testid='terminal-canvas']") as HTMLCanvasElement;
    expect(canvas.getAttribute("data-terminal-id")).toBe("term-42");

    await waitFor(() => expect(resizePty).toHaveBeenCalledWith("term-42", args.cols, args.rows));
  });

  it("renders the IME input bar on mount (always visible)", async () => {
    const spawnPty = vi.fn().mockResolvedValue("term-perm");
    const { container } = render(<NativeTerminalArea spawnPty={spawnPty} subscribeOutput={async () => () => {}} />);
    await waitFor(() => expect(container.querySelector("[data-testid='terminal-canvas']")).not.toBeNull());
    // The bar sits at the bottom and is always mounted; we don't conditionally
    // render it based on AI-CLI detection.
    expect(container.querySelector("[aria-label='ターミナル入力バー']")).not.toBeNull();
  });

  it("Ctrl+Shift+J moves focus into the IME input bar", async () => {
    const spawnPty = vi.fn().mockResolvedValue("term-j");
    const { container } = render(<NativeTerminalArea spawnPty={spawnPty} subscribeOutput={async () => () => {}} />);
    await waitFor(() => expect(container.querySelector("[data-testid='terminal-canvas']")).not.toBeNull());
    const canvas = container.querySelector("[data-testid='terminal-canvas']") as HTMLCanvasElement;
    canvas.focus();
    await act(async () => {
      fireEvent.keyDown(window, { key: "j", ctrlKey: true, shiftKey: true });
    });
    const bar = container.querySelector("[aria-label='ターミナル入力バー']") as HTMLElement;
    const textarea = bar.querySelector("textarea") as HTMLTextAreaElement;
    expect(document.activeElement).toBe(textarea);
  });

  it("opens the search bar on Ctrl+F and focuses the input", async () => {
    const spawnPty = vi.fn().mockResolvedValue("term-f");
    const { container } = render(<NativeTerminalArea spawnPty={spawnPty} subscribeOutput={async () => () => {}} />);
    await waitFor(() => expect(container.querySelector("[data-testid='terminal-canvas']")).not.toBeNull());
    (container.querySelector("[data-testid='terminal-canvas']") as HTMLCanvasElement)?.focus();
    await act(async () => {
      fireEvent.keyDown(window, { key: "f", ctrlKey: true });
    });
    await waitFor(() => expect(container.querySelector("input[placeholder='Search...']")).not.toBeNull());
    const input = container.querySelector("input[placeholder='Search...']") as HTMLInputElement;
    // Esc closes the search bar.
    await act(async () => {
      fireEvent.keyDown(input, { key: "Escape" });
    });
    await waitFor(() => expect(container.querySelector("input[placeholder='Search...']")).toBeNull());
  });

  it("leaves the canvas unmounted when PTY spawn fails", async () => {
    const spawnPty = vi.fn().mockRejectedValue(new Error("boom"));
    const onReady = vi.fn();

    const { container } = render(
      <NativeTerminalArea spawnPty={spawnPty} onTerminalReady={onReady} subscribeOutput={async () => () => {}} />,
    );

    await waitFor(() => expect(spawnPty).toHaveBeenCalled());
    // Give the promise-rejection microtask a tick.
    await act(async () => {
      await Promise.resolve();
    });
    expect(onReady).not.toHaveBeenCalled();
    expect(container.querySelector("[data-testid='terminal-canvas']")).toBeNull();
  });
});
