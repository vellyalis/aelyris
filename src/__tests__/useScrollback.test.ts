import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useScrollback } from "../shared/hooks/useScrollback";
import { type CellSnapshot, ColorKind, type GridSnapshot } from "../shared/types/terminal";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

function cell(ch: string): CellSnapshot {
  return { ch, fg: (ColorKind.NAMED << 24) | 256, bg: (ColorKind.NAMED << 24) | 257, attrs: 0 };
}

function makeSnapshot(rows: string[]): GridSnapshot {
  const cols = Math.max(...rows.map((r) => r.length));
  return {
    cols,
    rows: rows.length,
    cells: rows.map((r) => Array.from(r.padEnd(cols, " ")).map((c) => cell(c))),
    cursor: { row: 0, col: 0, shape: "block", blinking: false, visible: true },
  };
}

describe("useScrollback", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns the live cells passthrough when terminalId is null", () => {
    const snap = makeSnapshot(["live-a", "live-b"]);
    const { result } = renderHook(() => useScrollback(null, snap));
    expect(result.current.scrollOffset).toBe(0);
    expect(result.current.compositeCells).toBe(snap.cells);
    expect(result.current.canScrollUp).toBe(false);
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("stays at offset 0 for a live terminal until the user scrolls", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "term_history_size") return Promise.resolve(42);
      return Promise.resolve([]);
    });
    const snap = makeSnapshot(["row-0", "row-1"]);
    const { result } = renderHook(() => useScrollback("t-1", snap));
    await waitFor(() => expect(result.current.historySize).toBe(42));
    expect(result.current.scrollOffset).toBe(0);
    // compositeCells is reference-equal to snapshot.cells so downstream
    // memoisation stays warm during normal typing.
    expect(result.current.compositeCells).toBe(snap.cells);
  });

  it("fetches history rows and composes them at the top of the viewport", async () => {
    const historyRows = [
      [cell("h"), cell("i"), cell("s"), cell("-"), cell("0")],
      [cell("h"), cell("i"), cell("s"), cell("-"), cell("1")],
    ];
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "term_history_size") return Promise.resolve(10);
      if (cmd === "term_history_rows") return Promise.resolve(historyRows);
      return Promise.reject(new Error(`unexpected cmd ${cmd}`));
    });
    const snap = makeSnapshot(["live-a", "live-b", "live-c"]);
    const { result } = renderHook(() => useScrollback("t-1", snap));
    await waitFor(() => expect(result.current.historySize).toBe(10));

    act(() => result.current.scrollBy(2));
    await waitFor(() => {
      const cells = result.current.compositeCells!;
      // Top row is the OLDER history row (n=1), then the NEWER (n=0),
      // then the first live row; the third live row falls off the bottom.
      expect(cells[0].map((c) => c.ch).join("").trim()).toBe("his-1");
      expect(cells[1].map((c) => c.ch).join("").trim()).toBe("his-0");
      expect(cells[2].map((c) => c.ch).join("").trim().startsWith("live-a")).toBe(true);
    });
  });

  it("clamps scrollOffset to [0, historySize]", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "term_history_size") return Promise.resolve(3);
      return Promise.resolve([]);
    });
    const snap = makeSnapshot(["a", "b"]);
    const { result } = renderHook(() => useScrollback("t-1", snap));
    await waitFor(() => expect(result.current.historySize).toBe(3));

    act(() => result.current.scrollBy(100));
    expect(result.current.scrollOffset).toBe(3);

    act(() => result.current.scrollBy(-999));
    expect(result.current.scrollOffset).toBe(0);
  });

  it("scrollToLive resets the offset in one call", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "term_history_size") return Promise.resolve(5);
      return Promise.resolve([]);
    });
    const snap = makeSnapshot(["a", "b"]);
    const { result } = renderHook(() => useScrollback("t-1", snap));
    await waitFor(() => expect(result.current.historySize).toBe(5));

    act(() => result.current.scrollBy(3));
    expect(result.current.scrollOffset).toBe(3);
    act(() => result.current.scrollToLive());
    expect(result.current.scrollOffset).toBe(0);
    expect(result.current.compositeCells).toBe(snap.cells);
  });

  it("reports canScrollUp / canScrollDown consistently with offset + history", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "term_history_size") return Promise.resolve(4);
      return Promise.resolve([]);
    });
    const snap = makeSnapshot(["a", "b"]);
    const { result } = renderHook(() => useScrollback("t-1", snap));
    await waitFor(() => expect(result.current.historySize).toBe(4));

    expect(result.current.canScrollUp).toBe(true);
    expect(result.current.canScrollDown).toBe(false);

    act(() => result.current.scrollBy(2));
    expect(result.current.canScrollUp).toBe(true);
    expect(result.current.canScrollDown).toBe(true);

    act(() => result.current.scrollBy(2));
    expect(result.current.canScrollUp).toBe(false); // at the top of history
    expect(result.current.canScrollDown).toBe(true);
  });

  it("renders blank rows when the backend returns fewer history rows than requested", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "term_history_size") return Promise.resolve(5);
      if (cmd === "term_history_rows") return Promise.resolve([]); // simulate a race
      return Promise.reject(new Error("unexpected"));
    });
    const snap = makeSnapshot(["a", "b", "c"]);
    const { result } = renderHook(() => useScrollback("t-1", snap));
    await waitFor(() => expect(result.current.historySize).toBe(5));

    act(() => result.current.scrollBy(2));
    await waitFor(() => {
      const cells = result.current.compositeCells!;
      // Top two rows must be blanks (history not yet arrived), bottom one
      // is live row 0.
      expect(cells[0].every((c) => c.ch === " ")).toBe(true);
      expect(cells[1].every((c) => c.ch === " ")).toBe(true);
      expect(cells[2][0].ch).toBe("a");
    });
  });
});
