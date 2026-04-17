import {
  act,
  render,
  cleanup,
  fireEvent,
  waitFor,
} from "@testing-library/react";
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
    await waitFor(() =>
      expect(container.querySelector("[data-testid='terminal-canvas']")).not.toBeNull(),
    );

    const canvas = container.querySelector(
      "[data-testid='terminal-canvas']",
    ) as HTMLCanvasElement;
    expect(canvas.getAttribute("data-terminal-id")).toBe("term-42");

    await waitFor(() =>
      expect(resizePty).toHaveBeenCalledWith("term-42", args.cols, args.rows),
    );
  });

  it("opens IMEInputBar when AI CLI session is detected via PTY output", async () => {
    const spawnPty = vi.fn().mockResolvedValue("term-ai");
    const resizePty = vi.fn();
    let pushBytes: ((bytes: Uint8Array) => void) | null = null;
    const subscribeOutput = vi.fn(async (_id, onBytes) => {
      pushBytes = onBytes;
      return () => {};
    });

    const { container } = render(
      <NativeTerminalArea
        shell="powershell"
        spawnPty={spawnPty}
        resizePty={resizePty}
        subscribeOutput={subscribeOutput}
      />,
    );

    await waitFor(() => expect(subscribeOutput).toHaveBeenCalled());
    // Simulate ConPTY echoing the user's "claude" invocation on the prompt line.
    const enc = new TextEncoder();
    await act(async () => {
      pushBytes?.(enc.encode("PS C:\\Users\\dev> claude\r\n"));
    });
    await waitFor(() =>
      expect(container.querySelector("[role='dialog']")).not.toBeNull(),
    );
  });

  it("toggles IMEInputBar on Ctrl+Shift+J", async () => {
    const spawnPty = vi.fn().mockResolvedValue("term-j");
    const { container } = render(
      <NativeTerminalArea
        spawnPty={spawnPty}
        subscribeOutput={async () => () => {}}
      />,
    );
    await waitFor(() =>
      expect(container.querySelector("[data-testid='terminal-canvas']")).not.toBeNull(),
    );
    const area = container.querySelector("div")!;
    (area.querySelector("[data-testid='terminal-canvas']") as HTMLCanvasElement)?.focus();
    await act(async () => {
      fireEvent.keyDown(window, { key: "j", ctrlKey: true, shiftKey: true });
    });
    await waitFor(() =>
      expect(container.querySelector("[role='dialog']")).not.toBeNull(),
    );
    await act(async () => {
      fireEvent.keyDown(window, { key: "j", ctrlKey: true, shiftKey: true });
    });
    await waitFor(() =>
      expect(container.querySelector("[role='dialog']")).toBeNull(),
    );
  });

  it("opens the search bar on Ctrl+F and focuses the input", async () => {
    const spawnPty = vi.fn().mockResolvedValue("term-f");
    const { container } = render(
      <NativeTerminalArea
        spawnPty={spawnPty}
        subscribeOutput={async () => () => {}}
      />,
    );
    await waitFor(() =>
      expect(container.querySelector("[data-testid='terminal-canvas']")).not.toBeNull(),
    );
    (container.querySelector("[data-testid='terminal-canvas']") as HTMLCanvasElement)?.focus();
    await act(async () => {
      fireEvent.keyDown(window, { key: "f", ctrlKey: true });
    });
    await waitFor(() =>
      expect(container.querySelector("input[placeholder='Search...']")).not.toBeNull(),
    );
    const input = container.querySelector("input[placeholder='Search...']") as HTMLInputElement;
    // Esc closes the search bar.
    await act(async () => {
      fireEvent.keyDown(input, { key: "Escape" });
    });
    await waitFor(() =>
      expect(container.querySelector("input[placeholder='Search...']")).toBeNull(),
    );
  });

  it("leaves the canvas unmounted when PTY spawn fails", async () => {
    const spawnPty = vi.fn().mockRejectedValue(new Error("boom"));
    const onReady = vi.fn();

    const { container } = render(
      <NativeTerminalArea
        spawnPty={spawnPty}
        onTerminalReady={onReady}
        subscribeOutput={async () => () => {}}
      />,
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
