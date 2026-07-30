import { act, renderHook } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PaneRequestCancelledError, usePaneRequestController } from "../features/terminal/usePaneRequestController";

const ownerSources = import.meta.glob("../features/terminal/usePaneRequestController.ts", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

function getOwnerSource(): string {
  const entries = Object.entries(ownerSources);
  expect(entries).toHaveLength(1);
  return entries[0][1].replace(/\r\n/g, "\n");
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function options(overrides: Partial<Parameters<typeof usePaneRequestController>[0]> = {}) {
  return {
    activeTabId: "tab-a",
    handleTabSwitch: vi.fn(async () => true),
    interactiveSessionId: null,
    liveTabIds: ["tab-a", "tab-b"],
    requestTimeoutMs: 1_000,
    selectInteractiveSession: vi.fn(),
    ...overrides,
  };
}

async function flushRequestPublication() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

afterEach(() => {
  vi.useRealTimers();
});

describe("usePaneRequestController", () => {
  it("owns routed focus, serialized requests, cancellation, liveness, completion, and selection reset", () => {
    const owner = getOwnerSource();

    expect(owner).toContain("const [paneFocusRequest");
    expect(owner).toContain("useSerializedPaneRequest");
    expect(owner).toContain("PaneRequestCancelledError");
    expect(owner).toContain("liveTabIds");
    expect(owner).toContain("onComplete");
    expect(owner).toContain('selectInteractiveSession("")');
  });

  it("continues dispatching after the StrictMode effect rehearsal", async () => {
    const { result } = renderHook(() => usePaneRequestController(options()), {
      wrapper: StrictMode,
    });

    let request!: Promise<void>;
    act(() => {
      request = result.current.handlePaneRestart("tab-a", "pane-strict");
    });
    void request.catch(() => undefined);
    await flushRequestPublication();

    expect(result.current.paneRestartRequest?.paneId).toBe("pane-strict");
    act(() => result.current.paneRestartRequest?.onComplete(null));
    await expect(request).resolves.toBeUndefined();
  });

  it("serializes concurrent restart requests FIFO and settles each callback exactly once", async () => {
    const { result } = renderHook(() => usePaneRequestController(options()));

    let first!: Promise<void>;
    let second!: Promise<void>;
    act(() => {
      first = result.current.handlePaneRestart("tab-a", "pane-1");
      second = result.current.handlePaneRestart("tab-a", "pane-2");
    });
    void first.catch(() => undefined);
    void second.catch(() => undefined);
    await flushRequestPublication();

    expect(result.current.paneRestartRequest?.paneId).toBe("pane-1");
    const firstCompletion = result.current.paneRestartRequest?.onComplete;
    expect(firstCompletion).toBeTypeOf("function");
    act(() => {
      firstCompletion?.(null);
      firstCompletion?.("late duplicate");
    });
    await flushRequestPublication();
    await expect(first).resolves.toBeUndefined();

    expect(result.current.paneRestartRequest?.paneId).toBe("pane-2");
    act(() => result.current.paneRestartRequest?.onComplete(null));
    await expect(second).resolves.toBeUndefined();
  });

  it("advances after failure and preserves acceptance order across asynchronous tab routing", async () => {
    const routeFirst = deferred<boolean>();
    const routeSecond = deferred<boolean>();
    const handleTabSwitch = vi.fn((tabId: string) => (tabId === "tab-a" ? routeFirst.promise : routeSecond.promise));
    const { result } = renderHook(() =>
      usePaneRequestController(options({ activeTabId: "tab-current", handleTabSwitch })),
    );

    let first!: Promise<void>;
    let second!: Promise<void>;
    act(() => {
      first = result.current.handlePaneAttach("tab-a", "pane-1", "pty-1");
      second = result.current.handlePaneAttach("tab-b", "pane-2", "pty-2");
    });
    void first.catch(() => undefined);
    void second.catch(() => undefined);
    expect(handleTabSwitch).toHaveBeenCalledTimes(1);

    act(() => routeSecond.resolve(true));
    await flushRequestPublication();
    expect(result.current.paneAttachRequest).toBeNull();

    act(() => routeFirst.resolve(true));
    await flushRequestPublication();
    expect(result.current.paneAttachRequest?.paneId).toBe("pane-1");
    act(() => result.current.paneAttachRequest?.onComplete("attach failed"));
    await flushRequestPublication();
    await expect(first).rejects.toThrow("attach failed");
    expect(handleTabSwitch).toHaveBeenCalledTimes(2);
    act(() => routeSecond.resolve(true));
    await flushRequestPublication();
    expect(result.current.paneAttachRequest?.paneId).toBe("pane-2");
    act(() => result.current.paneAttachRequest?.onComplete(null));
    await expect(second).resolves.toBeUndefined();
  });

  it("waits for real completion before publishing the next synchronous loss-intolerant request", async () => {
    const { result } = renderHook(() => usePaneRequestController(options()));

    act(() => {
      result.current.handlePaneClose("tab-a", "pane-1");
      result.current.handlePaneClose("tab-a", "pane-2");
    });
    await flushRequestPublication();
    expect(result.current.paneCloseRequest?.paneId).toBe("pane-1");

    act(() => result.current.paneCloseRequest?.onComplete(null));
    await flushRequestPublication();
    expect(result.current.paneCloseRequest?.paneId).toBe("pane-2");
  });

  it("rejects timed-out accepted work with a typed cancellation", async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => usePaneRequestController(options({ requestTimeoutMs: 25 })));

    let request!: Promise<void>;
    act(() => {
      request = result.current.handlePaneRestart("tab-a", "pane-timeout");
    });
    const rejection = request.catch((error) => error);
    await flushRequestPublication();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(25);
    });
    await expect(rejection).resolves.toMatchObject({
      code: "PANE_REQUEST_CANCELLED",
      reason: "timeout",
    });
  });

  it("holds the FIFO lane until timed-out backend work actually completes", async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => usePaneRequestController(options({ requestTimeoutMs: 25 })));

    let first!: Promise<void>;
    act(() => {
      first = result.current.handlePaneRestart("tab-a", "pane-slow");
    });
    const firstRejection = first.catch((error) => error);
    await flushRequestPublication();
    const lateCompletion = result.current.paneRestartRequest?.onComplete;

    await act(async () => {
      await vi.advanceTimersByTimeAsync(25);
    });
    await expect(firstRejection).resolves.toMatchObject({ reason: "timeout" });

    let second!: Promise<void>;
    act(() => {
      second = result.current.handlePaneRestart("tab-a", "pane-next");
    });
    void second.catch(() => undefined);
    await flushRequestPublication();
    expect(result.current.paneRestartRequest?.paneId).toBe("pane-slow");

    act(() => lateCompletion?.(null));
    await flushRequestPublication();
    expect(result.current.paneRestartRequest?.paneId).toBe("pane-next");
    act(() => result.current.paneRestartRequest?.onComplete(null));
    await expect(second).resolves.toBeUndefined();
  });

  it("settles later accepted work while a hung backend lane remains quarantined", async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => usePaneRequestController(options({ requestTimeoutMs: 25 })));

    let hung!: Promise<void>;
    act(() => {
      hung = result.current.handlePaneRestart("tab-a", "pane-hung");
    });
    const hungRejection = hung.catch((error) => error);
    await flushRequestPublication();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(25);
    });
    await expect(hungRejection).resolves.toMatchObject({ reason: "timeout" });

    let later!: Promise<void>;
    act(() => {
      later = result.current.handlePaneRestart("tab-a", "pane-later");
    });
    const laterRejection = later.catch((error) => error);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(25);
    });
    await expect(laterRejection).resolves.toMatchObject({ reason: "timeout" });
    expect(result.current.paneRestartRequest?.paneId).toBe("pane-hung");
  });

  it("settles accepted work when its tab is removed", async () => {
    const initial = options();
    const { result, rerender } = renderHook(({ liveTabIds }) => usePaneRequestController({ ...initial, liveTabIds }), {
      initialProps: { liveTabIds: ["tab-a", "tab-b"] as string[] },
    });

    let request!: Promise<void>;
    act(() => {
      request = result.current.handlePaneAttach("tab-b", "pane-b", "pty-b");
    });
    const rejection = request.catch((error) => error);
    await flushRequestPublication();
    rerender({ liveTabIds: ["tab-a"] });

    await expect(rejection).resolves.toBeInstanceOf(PaneRequestCancelledError);
    await expect(rejection).resolves.toMatchObject({ reason: "tab-removed" });
  });

  it("settles accepted work on unmount and ignores a later consumer completion", async () => {
    const { result, unmount } = renderHook(() => usePaneRequestController(options()));

    let request!: Promise<void>;
    act(() => {
      request = result.current.handlePaneRestart("tab-a", "pane-unmount");
    });
    const rejection = request.catch((error) => error);
    await flushRequestPublication();
    const lateCompletion = result.current.paneRestartRequest?.onComplete;

    unmount();
    lateCompletion?.(null);
    await expect(rejection).resolves.toMatchObject({ reason: "unmounted" });
  });

  it("keeps focus latest-wins when tab transitions complete out of order", async () => {
    const first = deferred<boolean>();
    const second = deferred<boolean>();
    const handleTabSwitch = vi.fn((tabId: string) => (tabId === "tab-a" ? first.promise : second.promise));
    const { result } = renderHook(() =>
      usePaneRequestController(options({ activeTabId: "tab-current", handleTabSwitch })),
    );

    let oldFocus!: Promise<unknown>;
    let newFocus!: Promise<unknown>;
    act(() => {
      oldFocus = result.current.handlePaneSwitch("tab-a", "pane-old");
      newFocus = result.current.handlePaneSwitch("tab-b", "pane-new");
    });
    await expect(oldFocus).resolves.toMatchObject({ status: "cancelled", error: { reason: "superseded" } });
    act(() => second.resolve(true));
    await flushRequestPublication();
    expect(result.current.paneFocusRequest).toMatchObject({ tabId: "tab-b", paneId: "pane-new" });
    act(() => result.current.paneFocusRequest?.onComplete?.(null));
    await expect(newFocus).resolves.toEqual({ status: "focused" });

    act(() => first.resolve(true));
    await flushRequestPublication();
    expect(result.current.paneFocusRequest).toBeNull();
  });

  it("settles pending focus on timeout, tab removal, and unmount", async () => {
    vi.useFakeTimers();
    const timedRoute = deferred<boolean>();
    const never = new Promise<boolean>(() => undefined);
    const handleTabSwitch = vi
      .fn()
      .mockImplementationOnce(() => timedRoute.promise)
      .mockImplementation(() => never);
    const initial = options({ activeTabId: "tab-current", handleTabSwitch, requestTimeoutMs: 25 });
    const { result, rerender, unmount } = renderHook(
      ({ liveTabIds }) => usePaneRequestController({ ...initial, liveTabIds }),
      { initialProps: { liveTabIds: ["tab-a"] as string[] } },
    );

    let timedOut!: Promise<unknown>;
    act(() => {
      timedOut = result.current.handlePaneSwitch("tab-a", "pane-timeout");
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(25);
    });
    await expect(timedOut).resolves.toMatchObject({ status: "cancelled", error: { reason: "timeout" } });
    act(() => timedRoute.resolve(true));
    await flushRequestPublication();
    expect(result.current.paneFocusRequest).toBeNull();

    let removed!: Promise<unknown>;
    act(() => {
      removed = result.current.handlePaneSwitch("tab-a", "pane-removed");
    });
    rerender({ liveTabIds: [] });
    await expect(removed).resolves.toMatchObject({ status: "cancelled", error: { reason: "tab-removed" } });

    rerender({ liveTabIds: ["tab-a"] });
    let unmounted!: Promise<unknown>;
    act(() => {
      unmounted = result.current.handlePaneSwitch("tab-a", "pane-unmounted");
    });
    unmount();
    await expect(unmounted).resolves.toMatchObject({ status: "cancelled", error: { reason: "unmounted" } });
  });

  it("reports focus failure only after the pane consumer rejects the target", async () => {
    const { result } = renderHook(() => usePaneRequestController(options()));

    let focus!: Promise<unknown>;
    act(() => {
      focus = result.current.handlePaneSwitch("tab-a", "pane-missing");
    });
    await flushRequestPublication();
    expect(result.current.paneFocusRequest?.paneId).toBe("pane-missing");
    act(() => result.current.paneFocusRequest?.onComplete?.("Focus target was removed."));

    await expect(focus).resolves.toMatchObject({
      status: "failed",
      error: { message: "Focus target was removed." },
    });
  });
});
