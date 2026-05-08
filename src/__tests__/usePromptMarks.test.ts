import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { lastCommandEnd, type PromptMark, usePromptMarks } from "../shared/hooks/usePromptMarks";

// Tauri core/event API mocks. Each test configures what `invoke` returns
// and what `listen` does with its handler; we capture the handler so we
// can drive synthetic event payloads into the hook.
const invokeMock = vi.fn();
const listenMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: (...args: unknown[]) => listenMock(...args),
}));

function mark(sequence: number, kind: PromptMark["kind"], exitCode: number | null = null): PromptMark {
  return { kind, screenLine: 0, exitCode, sequence, historySize: 0 };
}

describe("usePromptMarks", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    listenMock.mockReset();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns an empty list when terminalId is null", async () => {
    const { result } = renderHook(() => usePromptMarks(null));
    expect(result.current).toEqual([]);
    // No backend calls when there is nothing to listen to.
    expect(invokeMock).not.toHaveBeenCalled();
    expect(listenMock).not.toHaveBeenCalled();
  });

  it("seeds marks from term_prompt_marks on mount", async () => {
    const seed: PromptMark[] = [mark(0, "promptStart"), mark(1, "commandEnd", 0)];
    invokeMock.mockResolvedValueOnce(seed);
    listenMock.mockResolvedValueOnce(() => {});

    const { result } = renderHook(() => usePromptMarks("t-1"));
    await waitFor(() => expect(result.current).toHaveLength(2));
    expect(result.current).toEqual(seed);
    expect(invokeMock).toHaveBeenCalledWith("term_prompt_marks", { id: "t-1" });
  });

  it("appends marks as term:prompt-mark-<id> events arrive", async () => {
    invokeMock.mockResolvedValueOnce([mark(0, "promptStart")]);
    let capture: ((ev: { payload: PromptMark }) => void) | null = null;
    listenMock.mockImplementationOnce(async (_event: string, handler: unknown) => {
      capture = handler as (ev: { payload: PromptMark }) => void;
      return () => {};
    });

    const { result } = renderHook(() => usePromptMarks("t-1"));
    await waitFor(() => expect(result.current).toHaveLength(1));
    expect(capture).not.toBeNull();

    act(() => capture?.({ payload: mark(1, "commandEnd", 137) }));
    expect(result.current).toHaveLength(2);
    expect(result.current[1]).toEqual(mark(1, "commandEnd", 137));
  });

  it("dedups marks that are already present by monotonic sequence", async () => {
    invokeMock.mockResolvedValueOnce([mark(0, "promptStart"), mark(1, "commandEnd", 0)]);
    let capture: ((ev: { payload: PromptMark }) => void) | null = null;
    listenMock.mockImplementationOnce(async (_event: string, handler: unknown) => {
      capture = handler as (ev: { payload: PromptMark }) => void;
      return () => {};
    });

    const { result } = renderHook(() => usePromptMarks("t-1"));
    await waitFor(() => expect(result.current).toHaveLength(2));

    // The backend may replay the same mark between the seed query and the
    // event subscription — hook must not double-append.
    act(() => capture?.({ payload: mark(1, "commandEnd", 0) }));
    expect(result.current).toHaveLength(2);
  });

  it("resets marks when terminalId changes", async () => {
    invokeMock.mockResolvedValueOnce([mark(0, "promptStart")]).mockResolvedValueOnce([]);
    listenMock.mockResolvedValue(() => {});

    const { result, rerender } = renderHook(({ id }) => usePromptMarks(id), {
      initialProps: { id: "t-1" as string | null },
    });
    await waitFor(() => expect(result.current).toHaveLength(1));

    rerender({ id: "t-2" });
    // Effect cleanup flips state back to empty while the new seed is
    // awaited; waitFor accepts either interim state.
    await waitFor(() => {
      expect(result.current).toEqual([]);
    });
  });

  it("returns empty when terminalId becomes null after being set", async () => {
    invokeMock.mockResolvedValueOnce([mark(0, "promptStart")]);
    listenMock.mockResolvedValue(() => {});

    const { result, rerender } = renderHook(({ id }) => usePromptMarks(id), {
      initialProps: { id: "t-1" as string | null },
    });
    await waitFor(() => expect(result.current).toHaveLength(1));

    rerender({ id: null });
    expect(result.current).toEqual([]);
  });

  it("tolerates a backend error gracefully (returns empty, no crash)", async () => {
    invokeMock.mockRejectedValueOnce(new Error("no such terminal"));
    listenMock.mockResolvedValue(() => {});

    const { result } = renderHook(() => usePromptMarks("t-1"));
    // Effect settles without throwing.
    await waitFor(() => expect(invokeMock).toHaveBeenCalled());
    expect(result.current).toEqual([]);
  });

  it("captures marks emitted during the seed window (listener-before-seed)", async () => {
    // Race contract: the listener MUST be armed before invoke() runs so a
    // mark emitted by the backend between the IPC dispatch and the seed
    // reply is captured in state. Without the new ordering, the mark
    // would arrive when no listener was registered and be lost.
    let capture: ((ev: { payload: PromptMark }) => void) | null = null;
    listenMock.mockImplementationOnce(async (_event: string, handler: unknown) => {
      capture = handler as (ev: { payload: PromptMark }) => void;
      return () => {};
    });
    // Resolve the seed *after* the listener is in place AND after a mark
    // has fired through it, simulating a slow IPC reply.
    let resolveSeed: (v: PromptMark[]) => void = () => {};
    const seedPromise = new Promise<PromptMark[]>((r) => {
      resolveSeed = r;
    });
    invokeMock.mockImplementationOnce(() => seedPromise);

    const { result } = renderHook(() => usePromptMarks("t-1"));
    // Wait for the listener to be armed.
    await waitFor(() => expect(capture).not.toBeNull());
    // Mark arrives during the seed window.
    act(() => capture?.({ payload: mark(7, "commandEnd", 0) }));
    expect(result.current).toEqual([mark(7, "commandEnd", 0)]);
    // Seed resolves with two earlier marks; mergeMark must order them
    // BEFORE the already-buffered mark(7), not after.
    act(() => resolveSeed([mark(0, "promptStart"), mark(1, "commandStart")]));
    await waitFor(() => expect(result.current).toHaveLength(3));
    expect(result.current.map((m) => m.sequence)).toEqual([0, 1, 7]);
  });

  it("inserts an out-of-order arrival at the position dictated by sequence", async () => {
    invokeMock.mockResolvedValueOnce([mark(0, "promptStart"), mark(2, "commandEnd", 0)]);
    let capture: ((ev: { payload: PromptMark }) => void) | null = null;
    listenMock.mockImplementationOnce(async (_event: string, handler: unknown) => {
      capture = handler as (ev: { payload: PromptMark }) => void;
      return () => {};
    });
    const { result } = renderHook(() => usePromptMarks("t-1"));
    await waitFor(() => expect(result.current).toHaveLength(2));
    // The backend emits a mark with sequence=1 *after* sequence=2 has
    // already been seeded — happens when the listener queue and the seed
    // query interleave in unexpected order. The correct list must keep
    // sequence ascending so binary search by historySize is valid.
    act(() => capture?.({ payload: mark(1, "commandStart") }));
    expect(result.current.map((m) => m.sequence)).toEqual([0, 1, 2]);
  });

  it("inserts a sequence-zero arrival at the head when older than tail", async () => {
    invokeMock.mockResolvedValueOnce([mark(5, "commandEnd", 0)]);
    let capture: ((ev: { payload: PromptMark }) => void) | null = null;
    listenMock.mockImplementationOnce(async (_event: string, handler: unknown) => {
      capture = handler as (ev: { payload: PromptMark }) => void;
      return () => {};
    });
    const { result } = renderHook(() => usePromptMarks("t-1"));
    await waitFor(() => expect(result.current).toHaveLength(1));
    act(() => capture?.({ payload: mark(0, "promptStart") }));
    expect(result.current.map((m) => m.sequence)).toEqual([0, 5]);
  });
});

describe("lastCommandEnd", () => {
  it("returns null for an empty list", () => {
    expect(lastCommandEnd([])).toBeNull();
  });

  it("returns null when no CommandEnd mark is present", () => {
    expect(lastCommandEnd([mark(0, "promptStart"), mark(1, "commandStart")])).toBeNull();
  });

  it("returns the most recent CommandEnd, not the first", () => {
    const marks = [
      mark(0, "commandEnd", 0),
      mark(1, "promptStart"),
      mark(2, "commandEnd", 137),
      mark(3, "promptStart"),
    ];
    expect(lastCommandEnd(marks)?.exitCode).toBe(137);
  });
});
