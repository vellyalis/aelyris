import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PromptMark } from "../shared/hooks/usePromptMarks";
import { findNextPromptMark, findPrevPromptMark, useScrollback } from "../shared/hooks/useScrollback";
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

function requireCompositeCells(cells: CellSnapshot[][] | null | undefined): CellSnapshot[][] {
  expect(cells).toBeDefined();
  if (cells == null) throw new Error("Expected composite terminal cells");
  return cells;
}

describe("useScrollback", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
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
      const cells = requireCompositeCells(result.current.compositeCells);
      // Top row is the OLDER history row (n=1), then the NEWER (n=0),
      // then the first live row; the third live row falls off the bottom.
      expect(
        cells[0]
          .map((c) => c.ch)
          .join("")
          .trim(),
      ).toBe("his-1");
      expect(
        cells[1]
          .map((c) => c.ch)
          .join("")
          .trim(),
      ).toBe("his-0");
      expect(
        cells[2]
          .map((c) => c.ch)
          .join("")
          .trim()
          .startsWith("live-a"),
      ).toBe(true);
    });
  });

  it("fetches only the visible history window at deep scroll offsets", async () => {
    const historyRows = [
      [cell("n"), cell("7")],
      [cell("n"), cell("8")],
      [cell("n"), cell("9")],
    ];
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "term_history_size") return Promise.resolve(10);
      if (cmd === "term_history_rows") return Promise.resolve(historyRows);
      return Promise.reject(new Error(`unexpected cmd ${cmd}`));
    });
    const snap = makeSnapshot(["aa", "bb", "cc"]);
    const { result } = renderHook(() => useScrollback("t-1", snap));
    await waitFor(() => expect(result.current.historySize).toBe(10));

    act(() => result.current.scrollToOffset(10));
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("term_history_rows", {
        id: "t-1",
        fromN: 7,
        count: 3,
      }),
    );

    await waitFor(() => {
      const cells = requireCompositeCells(result.current.compositeCells);
      expect(
        cells[0]
          .map((c) => c.ch)
          .join("")
          .trim(),
      ).toBe("n9");
      expect(
        cells[1]
          .map((c) => c.ch)
          .join("")
          .trim(),
      ).toBe("n8");
      expect(
        cells[2]
          .map((c) => c.ch)
          .join("")
          .trim(),
      ).toBe("n7");
    });
  });

  it("throttles history-size refreshes during snapshot churn", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "term_history_size") return Promise.resolve(3);
      return Promise.resolve([]);
    });
    const { rerender, result, unmount } = renderHook(({ snap }) => useScrollback("t-1", snap), {
      initialProps: { snap: makeSnapshot(["a", "b"]) },
    });
    await waitFor(() => expect(result.current.historySize).toBe(3));
    const initialRefreshes = invokeMock.mock.calls.filter((call) => call[0] === "term_history_size").length;

    rerender({ snap: makeSnapshot(["c", "d"]) });
    rerender({ snap: makeSnapshot(["e", "f"]) });
    rerender({ snap: makeSnapshot(["g", "h"]) });

    expect(invokeMock.mock.calls.filter((call) => call[0] === "term_history_size")).toHaveLength(initialRefreshes);
    unmount();
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

  it("scrollToMark stays on live view when the mark has not scrolled into history yet", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "term_history_size") return Promise.resolve(2);
      return Promise.resolve([]);
    });
    const snap = makeSnapshot(["a", "b", "c"]);
    const { result } = renderHook(() => useScrollback("t-1", snap));
    await waitFor(() => expect(result.current.historySize).toBe(2));
    // Mark recorded when history was at 2 and the cursor was on screen
    // line 1 — only two lines have scrolled since (matching the delta),
    // but that's less than screenLine=1 ... wait, delta = 0 here, so the
    // mark is exactly on the live view. scrollOffset stays at 0.
    const mark: PromptMark = { kind: "promptStart", screenLine: 1, exitCode: null, sequence: 7, historySize: 2 };
    act(() => {
      expect(result.current.scrollToMark(mark)).toBe(false);
    });
    expect(result.current.scrollOffset).toBe(0);
  });

  it("scrollToMark jumps into history when the mark has been pushed off the live screen", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "term_history_size") return Promise.resolve(10);
      return Promise.resolve([]);
    });
    const snap = makeSnapshot(["a", "b", "c"]);
    const { result } = renderHook(() => useScrollback("t-1", snap));
    await waitFor(() => expect(result.current.historySize).toBe(10));
    // Mark recorded when history was 3 and cursor was on screen line 0.
    // Delta is 10-3=7. The mark now sits at history index 7-1-0 = 6, so
    // scrollOffset=7 puts it at the top of the viewport.
    const mark: PromptMark = { kind: "promptStart", screenLine: 0, exitCode: null, sequence: 1, historySize: 3 };
    act(() => {
      expect(result.current.scrollToMark(mark)).toBe(true);
    });
    expect(result.current.scrollOffset).toBe(7);
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
      const cells = requireCompositeCells(result.current.compositeCells);
      // Top two rows must be blanks (history not yet arrived), bottom one
      // is live row 0.
      expect(cells[0].every((c) => c.ch === " ")).toBe(true);
      expect(cells[1].every((c) => c.ch === " ")).toBe(true);
      expect(cells[2][0].ch).toBe("a");
    });
  });
});

describe("findPrevPromptMark / findNextPromptMark", () => {
  // History-index formula: n = historySize - mark.historySize - 1 - mark.screenLine
  // A mark with historySize=0, screenLine=0 recorded while historySize is now 10
  // sits at n = 10 - 0 - 1 - 0 = 9 (nine rows above the live screen).
  function pm(sequence: number, historySize: number, screenLine: number): PromptMark {
    return { kind: "promptStart", screenLine, exitCode: null, sequence, historySize };
  }

  const marks = [
    pm(0, 0, 0), // n = 9
    pm(1, 3, 0), // n = 6
    pm(2, 7, 0), // n = 2
    pm(3, 10, 0), // n = -1 (live view)
  ];
  const historyNow = 10;

  it("finds the most-recent prompt above the live view when scrollOffset is 0", () => {
    // topN == -1 at offset 0. Walking newest-first, the first mark with
    // n > -1 is sequence 2 (n=2).
    const prev = findPrevPromptMark(marks, 0, historyNow);
    expect(prev?.sequence).toBe(2);
  });

  it("skips marks at or below the current viewport when scrolling up", () => {
    // scrollOffset = 3 → topN = 2. Marks with n > 2 are sequence 0 (n=9)
    // and sequence 1 (n=6). Newest-first: sequence 1.
    const prev = findPrevPromptMark(marks, 3, historyNow);
    expect(prev?.sequence).toBe(1);
  });

  it("returns null when no prompt mark sits above the current viewport", () => {
    // scrollOffset = 10 → topN = 9. No mark has n > 9.
    const prev = findPrevPromptMark(marks, 10, historyNow);
    expect(prev).toBeNull();
  });

  it("findNextPromptMark returns the oldest mark strictly below the viewport", () => {
    // scrollOffset = 7 → topN = 6. Marks with n < 6 are sequence 2 (n=2)
    // and sequence 3 (live, n=-1). Oldest-first (smallest sequence): 2.
    const next = findNextPromptMark(marks, 7, historyNow);
    expect(next?.sequence).toBe(2);
  });

  it("findNextPromptMark returns null when every mark is at or above the viewport", () => {
    // scrollOffset = 0 → topN = -1. No mark has n < -1 (sequence 3 is
    // exactly at n=-1, strict inequality excludes it).
    const next = findNextPromptMark(marks, 0, historyNow);
    expect(next).toBeNull();
  });

  it("ignores non-PromptStart marks", () => {
    const mixed: PromptMark[] = [
      { kind: "commandEnd", screenLine: 0, exitCode: 0, sequence: 0, historySize: 0 },
      pm(1, 3, 0), // n = 6
      { kind: "commandStart", screenLine: 0, exitCode: null, sequence: 2, historySize: 5 },
    ];
    const prev = findPrevPromptMark(mixed, 0, historyNow);
    expect(prev?.sequence).toBe(1);
  });
});
