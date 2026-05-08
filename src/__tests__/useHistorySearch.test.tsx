import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useHistorySearch } from "../shared/hooks/useHistorySearch";

interface RawHistoryMatch {
  historyIndex: number;
  startCol: number;
  endCol: number;
}

function makeInvoke(rows: RawHistoryMatch[]) {
  const fn = vi.fn(async (cmd: string) => {
    if (cmd === "term_search_history") return rows;
    throw new Error(`unexpected ${cmd}`);
  });
  return fn as unknown as <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
}

describe("useHistorySearch", () => {
  it("returns an empty list when terminal id is null", async () => {
    const invoke = makeInvoke([{ historyIndex: 0, startCol: 0, endCol: 1 }]);
    const { result } = renderHook(() => useHistorySearch(null, "needle", { invoke, debounceMs: 0 }));
    // Hook never calls the backend without a terminal id.
    await waitFor(() => expect(result.current).toEqual([]));
  });

  it("returns an empty list while query is empty", async () => {
    const invoke = makeInvoke([{ historyIndex: 0, startCol: 0, endCol: 1 }]);
    const { result } = renderHook(() => useHistorySearch("t-1", "", { invoke, debounceMs: 0 }));
    await waitFor(() => expect(result.current).toEqual([]));
  });

  it("tags backend rows with kind: 'history'", async () => {
    const invoke = makeInvoke([
      { historyIndex: 5, startCol: 2, endCol: 8 },
      { historyIndex: 2, startCol: 0, endCol: 3 },
    ]);
    const { result } = renderHook(() => useHistorySearch("t-1", "needle", { invoke, debounceMs: 0 }));
    await waitFor(() => expect(result.current.length).toBe(2));
    expect(result.current[0]).toEqual({
      kind: "history",
      historyIndex: 5,
      startCol: 2,
      endCol: 8,
    });
    expect(result.current[1].kind).toBe("history");
  });

  it("re-fetches when the query changes", async () => {
    const invoke = vi.fn(async (_cmd: string, args?: Record<string, unknown>) => {
      const q = String(args?.query ?? "");
      if (q === "first") return [{ historyIndex: 0, startCol: 0, endCol: 4 }];
      if (q === "second")
        return [
          { historyIndex: 1, startCol: 0, endCol: 5 },
          { historyIndex: 2, startCol: 4, endCol: 9 },
        ];
      return [];
    });
    const typed = invoke as unknown as <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
    const { result, rerender } = renderHook(
      ({ q }: { q: string }) => useHistorySearch("t-1", q, { invoke: typed, debounceMs: 0 }),
      { initialProps: { q: "first" } },
    );
    await waitFor(() => expect(result.current.length).toBe(1));
    rerender({ q: "second" });
    await waitFor(() => expect(result.current.length).toBe(2));
    expect(invoke).toHaveBeenCalledWith("term_search_history", expect.objectContaining({ query: "second", id: "t-1" }));
  });

  it("treats an IPC failure as an empty result rather than crashing", async () => {
    const invoke = vi.fn(async () => {
      throw new Error("backend unavailable");
    });
    const typed = invoke as unknown as <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
    const { result } = renderHook(() => useHistorySearch("t-1", "needle", { invoke: typed, debounceMs: 0 }));
    await waitFor(() => expect(invoke).toHaveBeenCalled());
    expect(result.current).toEqual([]);
  });

  it("forwards caseSensitive flag to the backend", async () => {
    const invoke = vi.fn(async () => []);
    const typed = invoke as unknown as <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
    renderHook(() => useHistorySearch("t-1", "needle", { invoke: typed, caseSensitive: true, debounceMs: 0 }));
    await waitFor(() => expect(invoke).toHaveBeenCalled());
    expect(invoke).toHaveBeenCalledWith("term_search_history", expect.objectContaining({ caseSensitive: true }));
  });
});
