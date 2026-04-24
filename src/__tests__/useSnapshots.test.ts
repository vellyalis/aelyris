import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useSnapshots } from "../shared/hooks/useSnapshots";
import type { SnapshotCapturedEvent, SnapshotSummary } from "../shared/types/snapshot";

type InvokeFn = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
type ListenHandler<T> = (event: { payload: T }) => void;

const invokeMock = vi.fn() as unknown as InvokeFn & {
  mock: ReturnType<typeof vi.fn>["mock"];
};
const listeners: Record<string, ListenHandler<unknown>> = {};
const unlistenMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: Record<string, unknown>) => (invokeMock as unknown as InvokeFn)(cmd, args),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn((evt: string, handler: ListenHandler<unknown>) => {
    listeners[evt] = handler;
    return Promise.resolve(unlistenMock);
  }),
}));

function makeSummary(partial: Partial<SnapshotSummary> & { id: string }): SnapshotSummary {
  return {
    sessionId: "sess-1",
    capturedAt: 1_700_000_000,
    trigger: { kind: "userSubmitted" },
    cols: 80,
    rows: 24,
    ...partial,
  };
}

describe("useSnapshots", () => {
  beforeEach(() => {
    (invokeMock as unknown as ReturnType<typeof vi.fn>).mockReset();
    unlistenMock.mockReset();
    for (const k of Object.keys(listeners)) delete listeners[k];
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns empty list and makes no IPC call when sessionId is null", async () => {
    const { result } = renderHook(() => useSnapshots(null));
    expect(result.current.snapshots).toEqual([]);
    // Wait a tick to ensure no effects fire.
    await Promise.resolve();
    const calls = (invokeMock as unknown as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.filter((c) => c[0] === "list_snapshots")).toHaveLength(0);
  });

  it("hydrates snapshots via list_snapshots IPC on mount", async () => {
    (invokeMock as unknown as ReturnType<typeof vi.fn>).mockImplementation((cmd) => {
      if (cmd === "list_snapshots")
        return Promise.resolve([makeSummary({ id: "a", capturedAt: 100 }), makeSummary({ id: "b", capturedAt: 200 })]);
      return Promise.reject(new Error(`unexpected ${cmd}`));
    });

    const { result } = renderHook(() => useSnapshots("sess-1"));
    await waitFor(() => expect(result.current.snapshots).toHaveLength(2));
    expect(result.current.snapshots[0].id).toBe("a");
    expect(result.current.snapshots[1].id).toBe("b");
  });

  it("refreshes list when snapshot:captured event fires", async () => {
    let count = 0;
    (invokeMock as unknown as ReturnType<typeof vi.fn>).mockImplementation((cmd) => {
      if (cmd === "list_snapshots") {
        count += 1;
        return Promise.resolve(Array.from({ length: count }, (_, i) => makeSummary({ id: `s${i}` })));
      }
      return Promise.reject(new Error(`unexpected ${cmd}`));
    });

    const { result } = renderHook(() => useSnapshots("sess-1"));
    await waitFor(() => expect(result.current.snapshots).toHaveLength(1));

    await act(async () => {
      const payload: SnapshotCapturedEvent = {
        snapshotId: "new",
        sessionId: "sess-1",
      };
      listeners["snapshot:captured-sess-1"]?.({ payload });
      await Promise.resolve();
    });
    await waitFor(() => expect(result.current.snapshots).toHaveLength(2));
  });

  it("fetchFullSnapshot forwards to get_snapshot IPC", async () => {
    (invokeMock as unknown as ReturnType<typeof vi.fn>).mockImplementation((cmd, args) => {
      if (cmd === "list_snapshots") return Promise.resolve([]);
      if (cmd === "get_snapshot")
        return Promise.resolve({
          id: (args as { snapshotId: string }).snapshotId,
          sessionId: "sess-1",
          capturedAt: 0,
          trigger: { kind: "userSubmitted" },
          grid: {
            cols: 2,
            rows: 1,
            cells: [[]],
            cursor: {
              row: 0,
              col: 0,
              shape: "block",
              blinking: false,
              visible: true,
            },
          },
        });
      return Promise.reject(new Error(`unexpected ${cmd}`));
    });
    const { result } = renderHook(() => useSnapshots("sess-1"));
    await waitFor(() => expect(result.current.snapshots).toEqual([]));

    const full = await result.current.fetchFullSnapshot("abc");
    expect(full?.id).toBe("abc");
  });

  it("startOverlay returns null on backend error", async () => {
    (invokeMock as unknown as ReturnType<typeof vi.fn>).mockImplementation((cmd) => {
      if (cmd === "list_snapshots") return Promise.resolve([]);
      if (cmd === "start_snapshot_overlay") return Promise.reject(new Error("boom"));
      return Promise.reject(new Error(`unexpected ${cmd}`));
    });
    const { result } = renderHook(() => useSnapshots("sess-1"));
    const out = await result.current.startOverlay("abc");
    expect(out).toBeNull();
  });

  it("markSnapshot sends args:{sessionId,label} to IPC", async () => {
    const capturedArgs: Record<string, unknown>[] = [];
    (invokeMock as unknown as ReturnType<typeof vi.fn>).mockImplementation((cmd, args) => {
      if (cmd === "list_snapshots") return Promise.resolve([]);
      if (cmd === "mark_snapshot") {
        capturedArgs.push(args as Record<string, unknown>);
        return Promise.resolve(makeSummary({ id: "marked-1" }));
      }
      return Promise.reject(new Error(`unexpected ${cmd}`));
    });
    const { result } = renderHook(() => useSnapshots("sess-1"));
    await waitFor(() => expect(result.current.snapshots).toEqual([]));
    const out = await result.current.markSnapshot("pre-risky");
    expect(out?.id).toBe("marked-1");
    expect(capturedArgs).toHaveLength(1);
    expect(capturedArgs[0]).toEqual({
      args: { sessionId: "sess-1", label: "pre-risky" },
    });
  });

  it("markSnapshot returns null when sessionId is null", async () => {
    const { result } = renderHook(() => useSnapshots(null));
    const out = await result.current.markSnapshot();
    expect(out).toBeNull();
  });
});
