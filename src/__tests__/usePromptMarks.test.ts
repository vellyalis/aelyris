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
  return { kind, screenLine: 0, exitCode, sequence };
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

    act(() => capture!({ payload: mark(1, "commandEnd", 137) }));
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
    act(() => capture!({ payload: mark(1, "commandEnd", 0) }));
    expect(result.current).toHaveLength(2);
  });

  it("resets marks when terminalId changes", async () => {
    invokeMock
      .mockResolvedValueOnce([mark(0, "promptStart")])
      .mockResolvedValueOnce([]);
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
