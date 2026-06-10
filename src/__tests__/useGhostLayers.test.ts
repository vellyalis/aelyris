import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useGhostLayers } from "../shared/hooks/useGhostLayers";
import { FALLBACK_TELEMETRY_EVENT, type FallbackTelemetryDetail } from "../shared/lib/fallbackTelemetry";
import type { LayerIdPayload, LayerListSnapshot, LayerSummary, LayerUpdatedPayload } from "../shared/types/ghostdiff";

type InvokeFn = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
type ListenHandler<T> = (event: { payload: T }) => void;

const invokeMock = vi.fn() as unknown as InvokeFn & { mock: ReturnType<typeof vi.fn>["mock"] };
const listeners: Record<string, ListenHandler<unknown>> = {};
const listenCalls: string[] = [];
const invokeCalls: string[] = [];
const unlistenMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: Record<string, unknown>) => {
    invokeCalls.push(cmd);
    return (invokeMock as unknown as InvokeFn)(cmd, args);
  },
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn((evt: string, handler: ListenHandler<unknown>) => {
    listeners[evt] = handler;
    listenCalls.push(evt);
    return Promise.resolve(unlistenMock);
  }),
}));

function makeLayer(partial: Partial<LayerSummary> & { id: string }): LayerSummary {
  return {
    source: {
      kind: "worktree",
      path: `/tmp/wt/${partial.id}`,
      branch: `b/${partial.id}`,
      repoPath: "/tmp/repo",
    },
    tint: { roleColor: "#fab387", roleLabel: "repair" },
    isComplete: false,
    createdAt: 0,
    fileCount: 0,
    hunkCount: 0,
    filePaths: [],
    ...partial,
  };
}

function snap(layers: LayerSummary[], seq: number): LayerListSnapshot {
  return { layers, seq };
}

function updated(summary: LayerSummary, seq: number): LayerUpdatedPayload {
  return { seq, summary };
}

function idPayload(layerId: string, seq: number): LayerIdPayload {
  return { seq, layerId };
}

function collectFallbackEvents() {
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

describe("useGhostLayers", () => {
  beforeEach(() => {
    (invokeMock as unknown as ReturnType<typeof vi.fn>).mockReset();
    unlistenMock.mockReset();
    listenCalls.length = 0;
    invokeCalls.length = 0;
    for (const k of Object.keys(listeners)) delete listeners[k];
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("hydrates the initial layer list via the snapshot IPC", async () => {
    (invokeMock as unknown as ReturnType<typeof vi.fn>).mockImplementation((cmd) => {
      if (cmd === "list_ghost_layers") {
        return Promise.resolve(
          snap([makeLayer({ id: "j1", createdAt: 100 }), makeLayer({ id: "j2", createdAt: 200, isComplete: true })], 5),
        );
      }
      return Promise.reject(new Error(`unexpected ${cmd}`));
    });

    const { result } = renderHook(() => useGhostLayers());
    await waitFor(() => expect(result.current.layers).toHaveLength(2));
    expect(result.current.layers[0].id).toBe("j1");
    expect(result.current.layers[1].id).toBe("j2");
    expect(result.current.activeCount).toBe(1);
  });

  it("registers all three listeners BEFORE invoking list_ghost_layers", async () => {
    (invokeMock as unknown as ReturnType<typeof vi.fn>).mockImplementation((cmd) => {
      if (cmd === "list_ghost_layers") return Promise.resolve(snap([], 0));
      return Promise.reject(new Error(`unexpected ${cmd}`));
    });

    renderHook(() => useGhostLayers());
    await waitFor(() => expect(invokeCalls).toContain("list_ghost_layers"));

    // All three listeners must already be armed at the moment invoke
    // is dispatched. Otherwise an event that fires during the IPC
    // round-trip would land on the floor.
    const invokeIdx = listenCalls.length; // listener calls happened before invoke
    expect(listenCalls).toContain("ghost-diff:layer-updated");
    expect(listenCalls).toContain("ghost-diff:layer-completed");
    expect(listenCalls).toContain("ghost-diff:layer-removed");
    expect(invokeIdx).toBeGreaterThanOrEqual(3);
  });

  it("merges ghost-diff:layer-updated events with monotonic seq", async () => {
    (invokeMock as unknown as ReturnType<typeof vi.fn>).mockImplementation((cmd) => {
      if (cmd === "list_ghost_layers") return Promise.resolve(snap([], 0));
      return Promise.reject(new Error(`unexpected ${cmd}`));
    });
    const { result } = renderHook(() => useGhostLayers());
    await waitFor(() => expect(result.current.layers).toHaveLength(0));

    await act(async () => {
      listeners["ghost-diff:layer-updated"]?.({
        payload: updated(makeLayer({ id: "new", fileCount: 3, hunkCount: 7 }), 1),
      });
    });
    expect(result.current.layers).toHaveLength(1);
    expect(result.current.layers[0].fileCount).toBe(3);
  });

  it("flips isComplete on ghost-diff:layer-completed", async () => {
    (invokeMock as unknown as ReturnType<typeof vi.fn>).mockImplementation((cmd) => {
      if (cmd === "list_ghost_layers") return Promise.resolve(snap([makeLayer({ id: "j1" })], 1));
      return Promise.reject(new Error(`unexpected ${cmd}`));
    });
    const { result } = renderHook(() => useGhostLayers());
    await waitFor(() => expect(result.current.layers).toHaveLength(1));
    expect(result.current.layers[0].isComplete).toBe(false);

    await act(async () => {
      listeners["ghost-diff:layer-completed"]?.({ payload: idPayload("j1", 2) });
    });
    expect(result.current.layers[0].isComplete).toBe(true);
    expect(result.current.activeCount).toBe(0);
  });

  it("drops layers on ghost-diff:layer-removed", async () => {
    (invokeMock as unknown as ReturnType<typeof vi.fn>).mockImplementation((cmd) => {
      if (cmd === "list_ghost_layers")
        return Promise.resolve(snap([makeLayer({ id: "a" }), makeLayer({ id: "b" })], 2));
      return Promise.reject(new Error(`unexpected ${cmd}`));
    });
    const { result } = renderHook(() => useGhostLayers());
    await waitFor(() => expect(result.current.layers).toHaveLength(2));

    await act(async () => {
      listeners["ghost-diff:layer-removed"]?.({ payload: idPayload("a", 3) });
    });
    expect(result.current.layers).toHaveLength(1);
    expect(result.current.layers[0].id).toBe("b");
  });

  it("invokes dismiss_ghost_layer via dismiss()", async () => {
    (invokeMock as unknown as ReturnType<typeof vi.fn>).mockImplementation((cmd) => {
      if (cmd === "list_ghost_layers") return Promise.resolve(snap([], 0));
      if (cmd === "dismiss_ghost_layer") return Promise.resolve();
      return Promise.reject(new Error(`unexpected ${cmd}`));
    });
    const { result } = renderHook(() => useGhostLayers());
    await waitFor(() => expect(result.current.layers).toHaveLength(0));

    await act(async () => {
      await result.current.dismiss("j1");
    });
    const calls = (invokeMock as unknown as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.some((c) => c[0] === "dismiss_ghost_layer")).toBe(true);
  });

  it("reports snapshot failures instead of silently hiding ghost layer truth", async () => {
    (invokeMock as unknown as ReturnType<typeof vi.fn>).mockImplementation((cmd) => {
      if (cmd === "list_ghost_layers") return Promise.reject(new Error("ghost registry unavailable"));
      return Promise.reject(new Error(`unexpected ${cmd}`));
    });
    const telemetry = collectFallbackEvents();

    try {
      const { result } = renderHook(() => useGhostLayers());

      await waitFor(() => {
        expect(telemetry.events).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              source: "ghost-layers",
              operation: "list_ghost_layers",
              userVisible: true,
            }),
          ]),
        );
      });
      expect(result.current.layers).toEqual([]);
    } finally {
      telemetry.cleanup();
    }
  });

  it("reports dismiss and file fetch failures while preserving a safe null result", async () => {
    (invokeMock as unknown as ReturnType<typeof vi.fn>).mockImplementation((cmd) => {
      if (cmd === "list_ghost_layers") return Promise.resolve(snap([], 0));
      if (cmd === "dismiss_ghost_layer") return Promise.reject(new Error("already removed"));
      if (cmd === "get_ghost_layer_file") return Promise.reject(new Error("file delta missing"));
      return Promise.reject(new Error(`unexpected ${cmd}`));
    });
    const telemetry = collectFallbackEvents();

    try {
      const { result } = renderHook(() => useGhostLayers());
      await waitFor(() => expect(result.current.layers).toHaveLength(0));

      await act(async () => {
        await result.current.dismiss("gone");
      });
      await expect(result.current.getFile("gone", "src/App.tsx")).resolves.toBeNull();

      expect(telemetry.events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            source: "ghost-layers",
            operation: "dismiss_ghost_layer",
            userVisible: true,
          }),
          expect.objectContaining({
            source: "ghost-layers",
            operation: "get_ghost_layer_file",
            userVisible: true,
          }),
        ]),
      );
    } finally {
      telemetry.cleanup();
    }
  });

  // ─── Race contract (round-7 listener-arming + seq filter) ──────────────

  it("buffers events that fire before the snapshot arrives, then drains with reorder buffer", async () => {
    let resolveSnap: ((value: LayerListSnapshot) => void) | null = null;
    (invokeMock as unknown as ReturnType<typeof vi.fn>).mockImplementation((cmd) => {
      if (cmd === "list_ghost_layers") {
        return new Promise<LayerListSnapshot>((resolve) => {
          resolveSnap = resolve;
        });
      }
      return Promise.reject(new Error(`unexpected ${cmd}`));
    });

    const { result } = renderHook(() => useGhostLayers());
    await waitFor(() => expect(listeners["ghost-diff:layer-updated"]).toBeDefined());

    // Pre-seed event at seq=4 — contiguous to snap.seq=3 below.
    // Must land in pendingRef, not on the still-empty state map.
    await act(async () => {
      listeners["ghost-diff:layer-updated"]({
        payload: updated(makeLayer({ id: "j1", fileCount: 1 }), 4),
      });
    });
    // No state yet — hook returns the empty default until seed.
    expect(result.current.layers).toHaveLength(0);

    // Snapshot arrives with seq=3 + j0. Seeded layers reflect the
    // snapshot, then the buffered event (seq=4 = 3+1, contiguous)
    // is drained from pending and applied.
    await act(async () => {
      resolveSnap?.(snap([makeLayer({ id: "j0", fileCount: 0 })], 3));
    });
    await waitFor(() => expect(result.current.layers).toHaveLength(2));
    const ids = result.current.layers.map((l) => l.id).sort();
    expect(ids).toEqual(["j0", "j1"]);
    const j1 = result.current.layers.find((l) => l.id === "j1");
    expect(j1?.fileCount).toBe(1);
  });

  it("drops buffered events that are already reflected in the snapshot (seq <= snap.seq)", async () => {
    let resolveSnap: ((value: LayerListSnapshot) => void) | null = null;
    (invokeMock as unknown as ReturnType<typeof vi.fn>).mockImplementation((cmd) => {
      if (cmd === "list_ghost_layers") {
        return new Promise<LayerListSnapshot>((resolve) => {
          resolveSnap = resolve;
        });
      }
      return Promise.reject(new Error(`unexpected ${cmd}`));
    });

    const { result } = renderHook(() => useGhostLayers());
    await waitFor(() => expect(listeners["ghost-diff:layer-updated"]).toBeDefined());

    // Stale event (seq=2) arrives during IPC round-trip.
    await act(async () => {
      listeners["ghost-diff:layer-updated"]({
        payload: updated(makeLayer({ id: "j1", fileCount: 99 }), 2),
      });
    });

    // Snapshot at seq=5 already reflects the state up to seq=5 — the
    // buffered event (seq=2) is older and must be dropped, not re-applied.
    await act(async () => {
      resolveSnap?.(snap([makeLayer({ id: "j1", fileCount: 7 })], 5));
    });
    await waitFor(() => expect(result.current.layers).toHaveLength(1));
    // Snapshot's fileCount=7 wins because the seq=2 event predates the
    // snapshot's seq=5; if it had leaked through, fileCount would be 99.
    expect(result.current.layers[0].fileCount).toBe(7);
  });

  it("does not resurrect a dismissed layer when a stale `updated` event lingers", async () => {
    // The exact bug pattern codex r2 of round 5 caught: a stale Updated
    // event for a since-removed layer must not bring the layer back.
    // With seq filtering, the stale event has seq < snap.seq → drop.
    let resolveSnap: ((value: LayerListSnapshot) => void) | null = null;
    (invokeMock as unknown as ReturnType<typeof vi.fn>).mockImplementation((cmd) => {
      if (cmd === "list_ghost_layers") {
        return new Promise<LayerListSnapshot>((resolve) => {
          resolveSnap = resolve;
        });
      }
      return Promise.reject(new Error(`unexpected ${cmd}`));
    });

    const { result } = renderHook(() => useGhostLayers());
    await waitFor(() => expect(listeners["ghost-diff:layer-updated"]).toBeDefined());

    // Stale Updated for j1 (seq=2), then snapshot at seq=10 with j1 GONE
    // (already removed by backend before snapshot was taken).
    await act(async () => {
      listeners["ghost-diff:layer-updated"]({
        payload: updated(makeLayer({ id: "j1" }), 2),
      });
    });
    await act(async () => {
      resolveSnap?.(snap([], 10));
    });
    await waitFor(() => expect(result.current.layers).toHaveLength(0));
    // j1 must NOT resurrect.
    expect(result.current.layers.find((l) => l.id === "j1")).toBeUndefined();
  });

  it("drops out-of-order events whose seq is not newer than the contiguous high-water mark", async () => {
    // Steady-state seq filter: after seq=5 applies contiguously, an
    // older event at seq=3 must be dropped (drainContiguous deletes
    // pending entries with seq <= state.seq).
    (invokeMock as unknown as ReturnType<typeof vi.fn>).mockImplementation((cmd) => {
      if (cmd === "list_ghost_layers") return Promise.resolve(snap([makeLayer({ id: "j1", fileCount: 0 })], 4));
      return Promise.reject(new Error(`unexpected ${cmd}`));
    });
    const { result } = renderHook(() => useGhostLayers());
    await waitFor(() => expect(result.current.layers).toHaveLength(1));

    // Snap.seq=4 → next contiguous is 5. Apply.
    await act(async () => {
      listeners["ghost-diff:layer-updated"]({
        payload: updated(makeLayer({ id: "j1", fileCount: 1 }), 5),
      });
    });
    expect(result.current.layers[0].fileCount).toBe(1);

    // Older seq=3 must be dropped (already reflected in snapshot).
    await act(async () => {
      listeners["ghost-diff:layer-updated"]({
        payload: updated(makeLayer({ id: "j1", fileCount: 99 }), 3),
      });
    });
    expect(result.current.layers[0].fileCount).toBe(1);

    // Next contiguous seq=6 must apply.
    await act(async () => {
      listeners["ghost-diff:layer-updated"]({
        payload: updated(makeLayer({ id: "j1", fileCount: 7 }), 6),
      });
    });
    expect(result.current.layers[0].fileCount).toBe(7);
  });

  // ─── Reorder buffer (round 7 r1: P1 fix) ───────────────────────────────

  it("holds out-of-order events in pending until the missing predecessor arrives", async () => {
    // The exact P1 race codex r0 of round 7 caught: backend allocates
    // seq=11 then seq=12 (under lock) but the channel push for 11 loses
    // the CPU after lock release; 12 lands first. A high-watermark filter
    // would drop 11. The reorder buffer holds 12 in pending and replays
    // when 11 arrives, restoring correct order.
    (invokeMock as unknown as ReturnType<typeof vi.fn>).mockImplementation((cmd) => {
      if (cmd === "list_ghost_layers") return Promise.resolve(snap([makeLayer({ id: "j1", fileCount: 0 })], 10));
      return Promise.reject(new Error(`unexpected ${cmd}`));
    });
    const { result } = renderHook(() => useGhostLayers());
    await waitFor(() => expect(result.current.layers[0].fileCount).toBe(0));

    // Out-of-order: seq=12 arrives first. state.seq stays at 10
    // because 12 != 10+1; 12 lands in pending.
    await act(async () => {
      listeners["ghost-diff:layer-updated"]({
        payload: updated(makeLayer({ id: "j1", fileCount: 12 }), 12),
      });
    });
    // No state change yet — gap waiting for seq=11.
    expect(result.current.layers[0].fileCount).toBe(0);

    // seq=11 arrives. drainContiguous applies 11, then drains pending
    // for 12. state.seq advances 10 → 11 → 12.
    await act(async () => {
      listeners["ghost-diff:layer-updated"]({
        payload: updated(makeLayer({ id: "j1", fileCount: 11 }), 11),
      });
    });
    // Final state reflects seq=12 (the newer write order won, even
    // though it arrived first on the wire).
    expect(result.current.layers[0].fileCount).toBe(12);
  });

  it("drains a multi-event contiguous run from pending after the predecessor lands", async () => {
    // 13 → 14 → 15 arrive out-of-order (e.g., 14, 15, 13). The reorder
    // buffer holds 14 and 15 in pending, then 13 arriving applies all
    // three contiguously: 13 advances state, then 14 and 15 drain.
    (invokeMock as unknown as ReturnType<typeof vi.fn>).mockImplementation((cmd) => {
      if (cmd === "list_ghost_layers") return Promise.resolve(snap([], 12));
      return Promise.reject(new Error(`unexpected ${cmd}`));
    });
    const { result } = renderHook(() => useGhostLayers());
    await waitFor(() => expect(result.current.layers).toHaveLength(0));

    // seq=14 arrives first → pending.
    await act(async () => {
      listeners["ghost-diff:layer-updated"]({
        payload: updated(makeLayer({ id: "j14" }), 14),
      });
    });
    expect(result.current.layers).toHaveLength(0);

    // seq=15 arrives (still no predecessor 13).
    await act(async () => {
      listeners["ghost-diff:layer-updated"]({
        payload: updated(makeLayer({ id: "j15" }), 15),
      });
    });
    expect(result.current.layers).toHaveLength(0);

    // seq=13 finally arrives → drains 13, 14, 15 in order.
    await act(async () => {
      listeners["ghost-diff:layer-updated"]({
        payload: updated(makeLayer({ id: "j13" }), 13),
      });
    });
    const ids = result.current.layers.map((l) => l.id).sort();
    expect(ids).toEqual(["j13", "j14", "j15"]);
  });

  it("drains pending across event-name boundaries (updated then removed in seq order)", async () => {
    // Different event names may arrive in arbitrary order across the
    // Tauri runtime. The reorder buffer is global by seq, not per name,
    // so a `removed` (seq=11) followed by a missing `updated` (seq=10)
    // still applies in seq order once 10 lands.
    (invokeMock as unknown as ReturnType<typeof vi.fn>).mockImplementation((cmd) => {
      if (cmd === "list_ghost_layers") return Promise.resolve(snap([makeLayer({ id: "j1" })], 9));
      return Promise.reject(new Error(`unexpected ${cmd}`));
    });
    const { result } = renderHook(() => useGhostLayers());
    await waitFor(() => expect(result.current.layers).toHaveLength(1));

    // `removed` for j1 at seq=11 arrives first (across-name reordering).
    await act(async () => {
      listeners["ghost-diff:layer-removed"]({ payload: idPayload("j1", 11) });
    });
    // No change yet — gap at 10.
    expect(result.current.layers).toHaveLength(1);

    // `updated` for j2 at seq=10 lands. Drains 10 then 11.
    await act(async () => {
      listeners["ghost-diff:layer-updated"]({
        payload: updated(makeLayer({ id: "j2" }), 10),
      });
    });
    // After both apply: j1 removed, j2 added.
    const ids = result.current.layers.map((l) => l.id);
    expect(ids).toEqual(["j2"]);
  });
});
