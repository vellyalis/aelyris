import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useSemanticHistory } from "../shared/hooks/useSemanticHistory";
import type { SearchHit } from "../shared/types/history";

type InvokeFn = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
const invokeMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: Record<string, unknown>) => (invokeMock as unknown as InvokeFn)(cmd, args),
}));

const hit = (command: string, score: number): SearchHit => ({
  entry: {
    command_id: Math.floor(Math.random() * 10_000),
    command,
    cwd: "/repo",
    exit_code: 0,
    executed_at: "2026-04-18 10:00:00",
  },
  score,
});

describe("useSemanticHistory", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("is idle with empty query", async () => {
    const { result } = renderHook(() => useSemanticHistory({}, 10, 0));
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.hits).toEqual([]);
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("invokes semantic_search_history after the debounce fires", async () => {
    invokeMock.mockResolvedValue([hit("cargo test", 0.9)]);
    const { result } = renderHook(() => useSemanticHistory({}, 10, 0));
    act(() => result.current.setQuery("cargo"));

    await waitFor(() => expect(result.current.hits).toHaveLength(1));
    expect(invokeMock).toHaveBeenCalledWith(
      "semantic_search_history",
      expect.objectContaining({ query: "cargo", limit: 10 }),
    );
  });

  it("discards stale responses", async () => {
    let resolveFirst: ((v: SearchHit[]) => void) | null = null;
    invokeMock
      .mockImplementationOnce(
        () => new Promise<SearchHit[]>((r) => {
          resolveFirst = r;
        }),
      )
      .mockResolvedValueOnce([hit("second", 0.95)]);

    const { result } = renderHook(() => useSemanticHistory({}, 10, 0));

    // Kick off the first request and wait for the mock to actually be called.
    act(() => result.current.setQuery("one"));
    await waitFor(() => expect(invokeMock).toHaveBeenCalledTimes(1));
    expect(resolveFirst).not.toBeNull();

    // Issue a second query; it should resolve synchronously because the mock
    // returns a resolved promise.
    act(() => result.current.setQuery("two"));
    await waitFor(() => expect(result.current.hits[0]?.entry.command).toBe("second"));

    // Late-arriving first response must not clobber the new results.
    await act(async () => {
      resolveFirst?.([hit("first", 0.5)]);
      await Promise.resolve();
    });
    expect(result.current.hits[0]?.entry.command).toBe("second");
  });

  it("surfaces errors", async () => {
    invokeMock.mockRejectedValue(new Error("store offline"));
    const { result } = renderHook(() => useSemanticHistory({}, 10, 0));
    act(() => result.current.setQuery("cargo"));
    await waitFor(() => expect(result.current.error).toBe("store offline"));
    expect(result.current.hits).toEqual([]);
  });

  it("passes filters through to the IPC call", async () => {
    invokeMock.mockResolvedValue([]);
    const filters = { only_failed: true, cwd_prefix: "/repo" };
    const { result } = renderHook(() => useSemanticHistory(filters, 5, 0));
    act(() => result.current.setQuery("build"));
    await waitFor(() => expect(invokeMock).toHaveBeenCalled());
    expect(invokeMock).toHaveBeenCalledWith(
      "semantic_search_history",
      expect.objectContaining({ filters, limit: 5 }),
    );
  });
});
