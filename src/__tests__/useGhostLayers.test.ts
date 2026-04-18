import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useGhostLayers } from "../shared/hooks/useGhostLayers";
import type { LayerSummary } from "../shared/types/ghostdiff";

type InvokeFn = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
type ListenHandler<T> = (event: { payload: T }) => void;

const invokeMock = vi.fn() as unknown as InvokeFn & { mock: ReturnType<typeof vi.fn>["mock"] };
const listeners: Record<string, ListenHandler<unknown>> = {};
const unlistenMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: Record<string, unknown>) =>
    (invokeMock as unknown as InvokeFn)(cmd, args),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn((evt: string, handler: ListenHandler<unknown>) => {
    listeners[evt] = handler;
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

describe("useGhostLayers", () => {
  beforeEach(() => {
    (invokeMock as unknown as ReturnType<typeof vi.fn>).mockReset();
    unlistenMock.mockReset();
    for (const k of Object.keys(listeners)) delete listeners[k];
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("hydrates the initial layer list via IPC", async () => {
    (invokeMock as unknown as ReturnType<typeof vi.fn>).mockImplementation((cmd) => {
      if (cmd === "list_ghost_layers") {
        return Promise.resolve([
          makeLayer({ id: "j1", createdAt: 100 }),
          makeLayer({ id: "j2", createdAt: 200, isComplete: true }),
        ]);
      }
      return Promise.reject(new Error(`unexpected ${cmd}`));
    });

    const { result } = renderHook(() => useGhostLayers());
    await waitFor(() => expect(result.current.layers).toHaveLength(2));
    // Oldest first.
    expect(result.current.layers[0].id).toBe("j1");
    expect(result.current.layers[1].id).toBe("j2");
    expect(result.current.activeCount).toBe(1); // j2 is complete
  });

  it("merges ghost-diff:layer-updated events", async () => {
    (invokeMock as unknown as ReturnType<typeof vi.fn>).mockImplementation((cmd) => {
      if (cmd === "list_ghost_layers") return Promise.resolve([]);
      return Promise.reject(new Error(`unexpected ${cmd}`));
    });
    const { result } = renderHook(() => useGhostLayers());
    await waitFor(() => expect(result.current.layers).toHaveLength(0));

    await act(async () => {
      listeners["ghost-diff:layer-updated"]?.({
        payload: makeLayer({ id: "new", fileCount: 3, hunkCount: 7 }),
      });
    });
    expect(result.current.layers).toHaveLength(1);
    expect(result.current.layers[0].fileCount).toBe(3);
  });

  it("flips isComplete on ghost-diff:layer-completed", async () => {
    (invokeMock as unknown as ReturnType<typeof vi.fn>).mockImplementation((cmd) => {
      if (cmd === "list_ghost_layers")
        return Promise.resolve([makeLayer({ id: "j1" })]);
      return Promise.reject(new Error(`unexpected ${cmd}`));
    });
    const { result } = renderHook(() => useGhostLayers());
    await waitFor(() => expect(result.current.layers).toHaveLength(1));
    expect(result.current.layers[0].isComplete).toBe(false);

    await act(async () => {
      listeners["ghost-diff:layer-completed"]?.({ payload: "j1" });
    });
    expect(result.current.layers[0].isComplete).toBe(true);
    expect(result.current.activeCount).toBe(0);
  });

  it("drops layers on ghost-diff:layer-removed", async () => {
    (invokeMock as unknown as ReturnType<typeof vi.fn>).mockImplementation((cmd) => {
      if (cmd === "list_ghost_layers")
        return Promise.resolve([
          makeLayer({ id: "a" }),
          makeLayer({ id: "b" }),
        ]);
      return Promise.reject(new Error(`unexpected ${cmd}`));
    });
    const { result } = renderHook(() => useGhostLayers());
    await waitFor(() => expect(result.current.layers).toHaveLength(2));

    await act(async () => {
      listeners["ghost-diff:layer-removed"]?.({ payload: "a" });
    });
    expect(result.current.layers).toHaveLength(1);
    expect(result.current.layers[0].id).toBe("b");
  });

  it("invokes dismiss_ghost_layer via dismiss()", async () => {
    (invokeMock as unknown as ReturnType<typeof vi.fn>).mockImplementation((cmd) => {
      if (cmd === "list_ghost_layers") return Promise.resolve([]);
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
});
