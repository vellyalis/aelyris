import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  IME_DIAGNOSTIC_EVENT,
  IME_DIAGNOSTIC_OVERLAY_STORAGE_KEY,
  IME_DIAGNOSTIC_STORAGE_KEY,
  type ImeDiagnosticDetail,
} from "../features/terminal/hooks/useCanvasIME";
import {
  commandHistoryTextFromSubmittedInput,
  NativeTerminalArea,
  shouldMountTimelineBar,
  terminalRowsForDrawableHeight,
} from "../features/terminal/NativeTerminalArea";
import type { ActiveSnapshotOverlay } from "../features/timeline/TimelineBar";
import { useTerminalSnapshot } from "../shared/hooks/useTerminalSnapshot";
import type { SnapshotSummary } from "../shared/types/snapshot";

vi.mock("../shared/hooks/useTerminalSnapshot", () => ({
  useTerminalSnapshot: vi.fn(() => null),
}));

function rawSource(records: Record<string, string>): string {
  const [source] = Object.values(records);
  if (!source) throw new Error("expected raw source");
  return source;
}

const nativeTerminalAreaSource = rawSource(
  import.meta.glob("../features/terminal/NativeTerminalArea.tsx", {
    query: "?raw",
    import: "default",
    eager: true,
  }) as Record<string, string>,
);

const terminalCanvasSource = rawSource(
  import.meta.glob("../features/terminal/TerminalCanvas.tsx", {
    query: "?raw",
    import: "default",
    eager: true,
  }) as Record<string, string>,
);

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

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("NativeTerminalArea", () => {
  it("rounds terminal rows up only when the extra row fits the decorative gutter", () => {
    expect(terminalRowsForDrawableHeight(718, 20)).toBe(36);
    expect(terminalRowsForDrawableHeight(714, 20)).toBe(35);
    expect(terminalRowsForDrawableHeight(10, 20)).toBe(5);
  });

  it("normalizes submitted input-bar commands for native command evidence", () => {
    expect(commandHistoryTextFromSubmittedInput("echo hi\r")).toBe("echo hi");
    expect(commandHistoryTextFromSubmittedInput("echo hi\n")).toBe("echo hi");
    expect(commandHistoryTextFromSubmittedInput("echo one\necho two\r")).toBe("echo one\necho two");
    expect(commandHistoryTextFromSubmittedInput("\r")).toBeNull();
    expect(nativeTerminalAreaSource).toContain('operation: "save_command_history"');
    expect(nativeTerminalAreaSource).toContain('source: "input-bar"');
    expect(nativeTerminalAreaSource).toContain('source: "input-mirror"');
    expect(nativeTerminalAreaSource).toContain("reportInvokeFailure");
  });

  it("reports stale overlay dismiss failures instead of swallowing ghost-layer leaks", () => {
    expect(nativeTerminalAreaSource).toContain('source: "terminal.snapshot-overlay"');
    expect(nativeTerminalAreaSource).toContain('operation: "dismiss_ghost_layer"');
    expect(nativeTerminalAreaSource).toContain('operation: "ghost_diff_layer_removed_listener"');
    expect(nativeTerminalAreaSource).toContain("userVisible: true");
    expect(nativeTerminalAreaSource).not.toContain('invoke<void>("dismiss_ghost_layer", { layerId }).catch(() => {})');
    expect(nativeTerminalAreaSource).not.toContain("/* listen unavailable */");
  });

  it("reports ghost suggestion backend failures instead of silently disabling suggestions", () => {
    expect(nativeTerminalAreaSource).toContain('source: "terminal.input-mirror"');
    expect(nativeTerminalAreaSource).toContain('operation: "suggest_next"');
    expect(nativeTerminalAreaSource).not.toContain(".catch(() => {\n        if (!cancelled) setSuggestion(null);");
  });

  beforeEach(() => {
    installCanvasMock();
    vi.mocked(useTerminalSnapshot).mockClear();
    vi.mocked(useTerminalSnapshot).mockReturnValue(null);
    stubClientSize(672, 408); // 80 cols * 8px, 24 rows * 17px
    (globalThis as unknown as { ResizeObserver: typeof ResizeObserver }).ResizeObserver =
      MockResizeObserver as unknown as typeof ResizeObserver;
  });
  afterEach(() => {
    cleanup();
    localStorage.removeItem(IME_DIAGNOSTIC_STORAGE_KEY);
    localStorage.removeItem(IME_DIAGNOSTIC_OVERLAY_STORAGE_KEY);
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

  it("keeps the live terminal snapshot subscription owned by NativeTerminalArea", () => {
    expect(nativeTerminalAreaSource).toContain("const snapshot = useTerminalSnapshot(terminalId)");
    expect(nativeTerminalAreaSource).toContain("liveSnapshot={snapshot}");
    expect(terminalCanvasSource).toContain("liveSnapshot?: GridSnapshot | null");
    expect(terminalCanvasSource).toContain(
      "const shouldSubscribeToLiveSnapshot = snapshotOverride === undefined && liveSnapshotOverride === undefined",
    );
    expect(terminalCanvasSource).toContain("useTerminalSnapshot(shouldSubscribeToLiveSnapshot ? terminalId : null)");
  });

  it("uses the production canvas renderer for browser visual preview", () => {
    expect(nativeTerminalAreaSource).toContain("buildPreviewTerminalSnapshot");
    expect(nativeTerminalAreaSource).toContain('data-renderer="canvas"');
    expect(nativeTerminalAreaSource).toContain("snapshotOverride={previewSnapshot}");
    expect(nativeTerminalAreaSource).toContain("terminalId={PREVIEW_TERMINAL_ID}");
    expect(nativeTerminalAreaSource).not.toContain("styles.previewPrompt");
  });

  it("mounts the timeline bar only when snapshots or an overlay exist", () => {
    const summary: SnapshotSummary = {
      id: "snap-1",
      sessionId: "term-1",
      capturedAt: 1,
      trigger: { kind: "userMarked" },
      cols: 80,
      rows: 24,
    };
    const overlay: ActiveSnapshotOverlay = {
      layerId: "layer-1",
      snapshotId: "snap-1",
      grid: {
        cols: 1,
        rows: 1,
        cells: [[{ ch: " ", fg: 0, bg: 0, attrs: 0 }]],
        cursor: { row: 0, col: 0, shape: "block", blinking: false, visible: true },
      },
    };
    expect(shouldMountTimelineBar([], null)).toBe(false);
    expect(shouldMountTimelineBar([summary], null)).toBe(true);
    expect(shouldMountTimelineBar([], overlay)).toBe(true);
    expect(nativeTerminalAreaSource).toContain(
      "const shouldRenderTimelineBar = shouldMountTimelineBar(timelineSnapshots, snapshotOverlay)",
    );
    expect(nativeTerminalAreaSource).toContain("{shouldRenderTimelineBar && (");
  });

  it("shows a startup state instead of a blank pane while the PTY starts", async () => {
    const spawn = deferred<string>();
    const spawnPty = vi.fn(() => spawn.promise);

    const { container } = render(
      <NativeTerminalArea shell="powershell" spawnPty={spawnPty} subscribeOutput={async () => () => {}} />,
    );

    await waitFor(() => expect(spawnPty).toHaveBeenCalledTimes(1));
    expect(container.querySelector("[data-testid='terminal-canvas']")).toBeNull();
    expect(container.textContent).toContain("Starting PowerShell...");

    await act(async () => {
      spawn.resolve("term-slow");
      await spawn.promise;
    });

    await waitFor(() => expect(container.querySelector("[data-testid='terminal-canvas']")).not.toBeNull());
  });

  it("does not mount the timeline bar for an empty live terminal", async () => {
    const spawnPty = vi.fn().mockResolvedValue("term-empty-timeline");

    const { container } = render(
      <NativeTerminalArea shell="powershell" spawnPty={spawnPty} subscribeOutput={async () => () => {}} />,
    );

    await waitFor(() => expect(container.querySelector("[data-testid='terminal-canvas']")).not.toBeNull());
    expect(container.querySelector("[data-testid='timeline-bar']")).toBeNull();
  });

  it("attaches an existing PTY without spawning a replacement", async () => {
    const spawnPty = vi.fn().mockResolvedValue("term-new");
    const resizePty = vi.fn();
    const onReady = vi.fn();

    const { container } = render(
      <NativeTerminalArea
        attachedTerminalId="term-attached"
        onTerminalReady={onReady}
        spawnPty={spawnPty}
        resizePty={resizePty}
        subscribeOutput={async () => () => {}}
      />,
    );

    await waitFor(() => expect(onReady).toHaveBeenCalledWith("term-attached"));
    expect(spawnPty).not.toHaveBeenCalled();
    await waitFor(() => expect(container.querySelector("[data-testid='terminal-canvas']")).not.toBeNull());
    const canvas = container.querySelector("[data-testid='terminal-canvas']") as HTMLCanvasElement;
    expect(canvas.getAttribute("data-terminal-id")).toBe("term-attached");
    await waitFor(() =>
      expect(resizePty).toHaveBeenCalledWith("term-attached", expect.any(Number), expect.any(Number)),
    );
  });

  it("surfaces backend resize failures instead of resolving them silently", async () => {
    const spawnPty = vi.fn().mockResolvedValue("term-resize-fails");
    const resizePty = vi.fn().mockRejectedValue(new Error("backend resize failed"));

    const { container } = render(
      <NativeTerminalArea spawnPty={spawnPty} resizePty={resizePty} subscribeOutput={async () => () => {}} />,
    );

    await waitFor(() => expect(container.textContent).toContain("Terminal degraded"));
    expect(container.textContent).toContain("Resize failed: backend resize failed");
  });

  it("keeps the IME input bar mounted and visible for attachment controls", async () => {
    const spawnPty = vi.fn().mockResolvedValue("term-perm");
    const { container } = render(<NativeTerminalArea spawnPty={spawnPty} subscribeOutput={async () => () => {}} />);
    await waitFor(() => expect(container.querySelector("[data-testid='terminal-canvas']")).not.toBeNull());
    expect(container.querySelector("[aria-label='ターミナル入力バー']")?.getAttribute("data-collapsed")).toBe("false");
    expect(container.querySelector("[aria-label='写真とファイルを追加']")).not.toBeNull();
  });

  it("activates AI CLI anchoring from live PTY output before Japanese IME input", async () => {
    const spawnPty = vi.fn().mockResolvedValue("term-ai-cli");
    let emitOutput: ((bytes: Uint8Array) => void) | null = null;
    const subscribeOutput = vi.fn(async (_terminalId: string, onBytes: (bytes: Uint8Array) => void) => {
      emitOutput = onBytes;
      return () => {};
    });

    const { container } = render(<NativeTerminalArea spawnPty={spawnPty} subscribeOutput={subscribeOutput} />);

    await waitFor(() => expect(container.querySelector("[data-testid='terminal-canvas']")).not.toBeNull());
    await waitFor(() => expect(subscribeOutput).toHaveBeenCalledWith("term-ai-cli", expect.any(Function)));

    act(() => {
      emitOutput?.(new TextEncoder().encode("PS C:\\repo> claude\r\nClaude Code\r\nType your message\r\n"));
    });

    await waitFor(() => {
      const imeTextarea = container.querySelector("[data-testid='terminal-ime-textarea']");
      expect(imeTextarea?.getAttribute("data-ime-anchor-mode")).toBe("ai-cli-real-cursor");
    });
    expect(nativeTerminalAreaSource).toContain("preferAiInputAnchor={aiCli.active}");
  });

  it("routes direct canvas input through the pane writer", async () => {
    const spawnPty = vi.fn().mockResolvedValue("term-write");
    const writePty = vi.fn();
    const { container } = render(
      <NativeTerminalArea spawnPty={spawnPty} writePty={writePty} subscribeOutput={async () => () => {}} />,
    );

    await waitFor(() => expect(container.querySelector("[data-testid='terminal-canvas']")).not.toBeNull());
    const textarea = container.querySelector("[data-testid='terminal-ime-textarea']") as HTMLTextAreaElement;

    fireEvent.input(textarea, { data: "a" });

    expect(writePty).toHaveBeenCalledWith("term-write", "a");
  });

  it("keeps PowerShell direct textarea input on the browser input path through Enter", async () => {
    const spawnPty = vi.fn().mockResolvedValue("term-powershell-direct");
    const writePty = vi.fn();
    const { container } = render(
      <NativeTerminalArea
        shell="powershell"
        spawnPty={spawnPty}
        writePty={writePty}
        subscribeOutput={async () => () => {}}
      />,
    );

    await waitFor(() => expect(container.querySelector("[data-testid='terminal-canvas']")).not.toBeNull());
    const textarea = container.querySelector("[data-testid='terminal-ime-textarea']") as HTMLTextAreaElement;
    textarea.focus();

    for (const ch of "Get-Location") {
      fireEvent.keyDown(textarea, { key: ch });
      fireEvent.input(textarea, { data: ch });
    }
    fireEvent.keyDown(textarea, { key: "Enter" });

    const payloads = writePty.mock.calls.map(([, data]) => data);
    expect(payloads.join("")).toBe("Get-Location\r");
    expect(payloads.at(-1)).toBe("\r");
  });

  it("normalizes LF paste to CR for PowerShell direct input", async () => {
    const spawnPty = vi.fn().mockResolvedValue("term-powershell-paste");
    const writePty = vi.fn();
    const { container } = render(
      <NativeTerminalArea
        shell="powershell"
        spawnPty={spawnPty}
        writePty={writePty}
        subscribeOutput={async () => () => {}}
      />,
    );

    await waitFor(() => expect(container.querySelector("[data-testid='terminal-canvas']")).not.toBeNull());
    const textarea = container.querySelector("[data-testid='terminal-ime-textarea']") as HTMLTextAreaElement;
    const pasteEvent = new Event("paste", {
      bubbles: true,
      cancelable: true,
    }) as ClipboardEvent;
    Object.defineProperty(pasteEvent, "clipboardData", {
      value: {
        getData: (type: string) => (type === "text" || type === "text/plain" ? "Get-Location\n" : ""),
      },
    });

    act(() => {
      textarea.dispatchEvent(pasteEvent);
    });

    expect(writePty).toHaveBeenCalledWith("term-powershell-paste", "Get-Location\r");
    expect(pasteEvent.defaultPrevented).toBe(true);
  });

  it("surfaces direct input write failures instead of swallowing them", async () => {
    const spawnPty = vi.fn().mockResolvedValue("term-write-fail");
    const writePty = vi.fn().mockRejectedValue(new Error("PTY writer closed"));
    const { container } = render(
      <NativeTerminalArea spawnPty={spawnPty} writePty={writePty} subscribeOutput={async () => () => {}} />,
    );

    await waitFor(() => expect(container.querySelector("[data-testid='terminal-canvas']")).not.toBeNull());
    const textarea = container.querySelector("[data-testid='terminal-ime-textarea']") as HTMLTextAreaElement;

    fireEvent.input(textarea, { data: "a" });

    await waitFor(() => expect(container.querySelector("[role='alert']")?.textContent).toContain("PTY writer closed"));
  });

  it("shows an opt-in terminal input diagnostics overlay without raw text", async () => {
    localStorage.setItem(IME_DIAGNOSTIC_STORAGE_KEY, "1");
    localStorage.setItem(IME_DIAGNOSTIC_OVERLAY_STORAGE_KEY, "1");
    vi.spyOn(console, "debug").mockImplementation(() => {});
    const spawnPty = vi.fn().mockResolvedValue("term-diag");
    const writePty = vi.fn();
    const { container } = render(
      <NativeTerminalArea
        shell="powershell"
        spawnPty={spawnPty}
        writePty={writePty}
        subscribeOutput={async () => () => {}}
      />,
    );

    await waitFor(() => expect(container.querySelector("[data-testid='terminal-canvas']")).not.toBeNull());
    const overlay = await waitFor(() => {
      const el = container.querySelector("[data-testid='terminal-input-diagnostics']");
      if (!el) throw new Error("diagnostics overlay not mounted");
      return el as HTMLElement;
    });
    const textarea = container.querySelector("[data-testid='terminal-ime-textarea']") as HTMLTextAreaElement;

    fireEvent.input(textarea, { data: "機密" });
    await waitFor(() => expect(overlay.textContent).toContain("canvas"));
    expect(overlay.textContent).toContain("term-diag");
    expect(overlay.textContent).toContain("2 chars");
    expect(overlay.textContent).toContain("Write pathcanvas");
    expect(overlay.textContent).toContain("Eventcommit");
    expect(overlay.textContent).not.toContain("機密");

    const detail: ImeDiagnosticDetail = {
      phase: "keydown",
      terminalId: "term-diag",
      timestamp: 1,
      composing: true,
      active: true,
      valueLength: 0,
      scrollLeft: 0,
      selectionStart: 0,
      selectionEnd: 0,
      anchorLeft: "12px",
      anchorTop: "18px",
      anchorWidth: "88px",
      anchorHeight: "18px",
      viewportWidth: 800,
      viewportHeight: 600,
      devicePixelRatio: 1.25,
      candidateLeft: "120",
      candidateTop: "44",
      anchorMode: "ai-cli-input",
      key: "F13",
      keyCode: 124,
      ignored: true,
      dropped: true,
      writePath: "ignored",
      reason: "unmapped-key",
    };
    act(() => {
      window.dispatchEvent(new CustomEvent<ImeDiagnosticDetail>(IME_DIAGNOSTIC_EVENT, { detail }));
    });

    await waitFor(() => expect(overlay.textContent).toContain("focused"));
    expect(overlay.textContent).toContain("composing");
    expect(overlay.textContent).toContain("Dropped keys1");
    expect(overlay.textContent).toContain("Write pathignored");
    expect(overlay.textContent).toContain("120, 44");
    expect(overlay.textContent).toContain("keydown");

    fireEvent.click(container.querySelector("[aria-label='Hide input diagnostics']") as HTMLButtonElement);
    await waitFor(() => expect(container.querySelector("[data-testid='terminal-input-diagnostics']")).toBeNull());
    expect(localStorage.getItem(IME_DIAGNOSTIC_OVERLAY_STORAGE_KEY)).toBeNull();
  });

  it("does not mount the diagnostics overlay when only trace recording is enabled", async () => {
    localStorage.setItem(IME_DIAGNOSTIC_STORAGE_KEY, "1");
    const spawnPty = vi.fn().mockResolvedValue("term-trace-only");
    const { container } = render(
      <NativeTerminalArea
        shell="powershell"
        spawnPty={spawnPty}
        writePty={vi.fn()}
        subscribeOutput={async () => () => {}}
      />,
    );

    await waitFor(() => expect(container.querySelector("[data-testid='terminal-canvas']")).not.toBeNull());
    expect(container.querySelector("[data-testid='terminal-input-diagnostics']")).toBeNull();
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

  it("opens the search bar on Ctrl+Shift+F and focuses the input", async () => {
    const spawnPty = vi.fn().mockResolvedValue("term-f");
    const { container } = render(<NativeTerminalArea spawnPty={spawnPty} subscribeOutput={async () => () => {}} />);
    await waitFor(() => expect(container.querySelector("[data-testid='terminal-canvas']")).not.toBeNull());
    (container.querySelector("[data-testid='terminal-canvas']") as HTMLCanvasElement)?.focus();
    await act(async () => {
      fireEvent.keyDown(window, { key: "f", ctrlKey: true, shiftKey: true });
    });
    await waitFor(() => expect(container.querySelector("input[placeholder='Search...']")).not.toBeNull());
    const input = container.querySelector("input[placeholder='Search...']") as HTMLInputElement;
    const terminalInput = container.querySelector("[data-testid='terminal-ime-textarea']") as HTMLTextAreaElement;

    // Esc closes the search bar and returns keyboard focus to the terminal.
    await act(async () => {
      fireEvent.keyDown(input, { key: "Escape" });
    });
    await waitFor(() => expect(container.querySelector("input[placeholder='Search...']")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(terminalInput));
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

  it("shows a crash banner when pty-exit fires and respawns on Restart click", async () => {
    const spawnPty = vi.fn().mockResolvedValue("term-crash");
    const respawn = deferred();
    const respawnPty = vi.fn(
      (_args: { id: string; shell: string; cols: number; rows: number; cwd?: string }) => respawn.promise,
    );
    let emitExit: ((info: { code: number | null; crashed: boolean }) => void) | null = null;
    const subscribeExit = vi.fn(
      async (_id: string, onExit: (info: { code: number | null; crashed: boolean }) => void) => {
        emitExit = onExit;
        return () => {
          emitExit = null;
        };
      },
    );

    const { container } = render(
      <NativeTerminalArea
        shell="powershell"
        cwd="C:/tmp"
        spawnPty={spawnPty}
        subscribeOutput={async () => () => {}}
        subscribeExit={subscribeExit}
        respawnPty={respawnPty}
      />,
    );

    await waitFor(() => expect(spawnPty).toHaveBeenCalled());
    await waitFor(() => expect(subscribeExit).toHaveBeenCalledWith("term-crash", expect.any(Function)));

    // Banner is hidden while the shell is alive.
    expect(container.querySelector("[role='alert']")).toBeNull();

    // Backend reports a crash via NTSTATUS access violation (0xC0000005).
    await act(async () => {
      emitExit?.({ code: 0xc000_0005, crashed: true });
    });

    const banner = await waitFor(() => {
      const el = container.querySelector("[role='alert']");
      if (!el) throw new Error("banner not yet rendered");
      return el as HTMLElement;
    });
    expect(banner.textContent).toContain("crashed");

    const restartBtn = banner.querySelector("button") as HTMLButtonElement;
    expect(restartBtn).not.toBeNull();
    expect(restartBtn.disabled).toBe(false);

    await act(async () => {
      fireEvent.click(restartBtn);
    });

    await waitFor(() => expect(respawnPty).toHaveBeenCalledTimes(1));
    expect(restartBtn.textContent).toBe("Restarting...");
    expect(restartBtn.disabled).toBe(true);
    const respawnArgs = respawnPty.mock.calls[0][0];
    expect(respawnArgs.id).toBe("term-crash");
    expect(respawnArgs.shell).toBe("powershell");
    expect(respawnArgs.cwd).toBe("C:/tmp");
    expect(respawnArgs.cols).toBeGreaterThanOrEqual(20);

    await act(async () => {
      respawn.resolve();
      await respawn.promise;
    });

    // Banner clears after a successful respawn.
    await waitFor(() => expect(container.querySelector("[role='alert']")).toBeNull());
  });

  it("respawns from an external restart request", async () => {
    const spawnPty = vi.fn().mockResolvedValue("term-external-restart");
    const respawnPty = vi.fn().mockResolvedValue(undefined);
    const forceRestartPty = vi.fn().mockResolvedValue(undefined);
    const onComplete = vi.fn();

    const { rerender } = render(
      <NativeTerminalArea
        shell="powershell"
        cwd="C:/tmp"
        spawnPty={spawnPty}
        subscribeOutput={async () => () => {}}
        respawnPty={respawnPty}
        forceRestartPty={forceRestartPty}
      />,
    );

    await waitFor(() => expect(spawnPty).toHaveBeenCalled());

    rerender(
      <NativeTerminalArea
        shell="powershell"
        cwd="C:/tmp"
        spawnPty={spawnPty}
        subscribeOutput={async () => () => {}}
        respawnPty={respawnPty}
        forceRestartPty={forceRestartPty}
        restartRequest={{ sequence: 1, onComplete }}
      />,
    );

    await waitFor(() => expect(forceRestartPty).toHaveBeenCalledTimes(1));
    expect(forceRestartPty.mock.calls[0][0]).toMatchObject({
      id: "term-external-restart",
      shell: "powershell",
      cwd: "C:/tmp",
    });
    expect(respawnPty).not.toHaveBeenCalled();
    await waitFor(() => expect(onComplete).toHaveBeenCalledWith(null));

    rerender(
      <NativeTerminalArea
        shell="powershell"
        cwd="C:/tmp"
        spawnPty={spawnPty}
        subscribeOutput={async () => () => {}}
        respawnPty={respawnPty}
        forceRestartPty={forceRestartPty}
        restartRequest={{ sequence: 1, onComplete }}
      />,
    );
    expect(forceRestartPty).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("reports external restart failures to the request owner", async () => {
    const spawnPty = vi.fn().mockResolvedValue("term-external-restart-failed");
    const forceRestartPty = vi.fn().mockRejectedValue(new Error("restart rejected"));
    const onComplete = vi.fn();

    const { rerender } = render(
      <NativeTerminalArea
        shell="powershell"
        cwd="C:/tmp"
        spawnPty={spawnPty}
        subscribeOutput={async () => () => {}}
        forceRestartPty={forceRestartPty}
      />,
    );

    await waitFor(() => expect(spawnPty).toHaveBeenCalled());

    rerender(
      <NativeTerminalArea
        shell="powershell"
        cwd="C:/tmp"
        spawnPty={spawnPty}
        subscribeOutput={async () => () => {}}
        forceRestartPty={forceRestartPty}
        restartRequest={{ sequence: 1, onComplete }}
      />,
    );

    await waitFor(() => expect(onComplete).toHaveBeenCalledWith("restart rejected"));
  });

  it("uses a softer message when the shell exited cleanly (code 0)", async () => {
    const spawnPty = vi.fn().mockResolvedValue("term-clean");
    let emitExit: ((info: { code: number | null; crashed: boolean }) => void) | null = null;
    const subscribeExit = vi.fn(
      async (_id: string, onExit: (info: { code: number | null; crashed: boolean }) => void) => {
        emitExit = onExit;
        return () => {};
      },
    );

    const { container } = render(
      <NativeTerminalArea spawnPty={spawnPty} subscribeOutput={async () => () => {}} subscribeExit={subscribeExit} />,
    );

    await waitFor(() => expect(subscribeExit).toHaveBeenCalled());

    await act(async () => {
      emitExit?.({ code: 0, crashed: false });
    });

    const banner = await waitFor(() => {
      const el = container.querySelector("[role='alert']");
      if (!el) throw new Error("banner not rendered");
      return el as HTMLElement;
    });
    expect(banner.textContent).toContain("exited (code 0)");
    expect(banner.textContent).not.toContain("crashed");
  });
});
