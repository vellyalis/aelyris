import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useTerminalSnapshot } from "../shared/hooks/useTerminalSnapshot";
import type { CellSnapshot, CursorSnapshot, GridDiff, GridSnapshot, ImageRef } from "../shared/types/terminal";

type InvokeFn = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
type ListenHandler<T> = (event: { payload: T }) => void;

const invokeMock = vi.fn() as unknown as InvokeFn & { mock: ReturnType<typeof vi.fn>["mock"] };
const listenCalls: Array<{ event: string; armedAt: number }> = [];
const invokeCalls: Array<{ cmd: string; calledAt: number }> = [];
const listeners: Record<string, ListenHandler<unknown>> = {};
const unlistenMock = vi.fn();
let opCounter = 0;

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: Record<string, unknown>) => {
    invokeCalls.push({ cmd, calledAt: ++opCounter });
    return (invokeMock as unknown as InvokeFn)(cmd, args);
  },
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn((evt: string, handler: ListenHandler<unknown>) => {
    listeners[evt] = handler;
    listenCalls.push({ event: evt, armedAt: ++opCounter });
    return Promise.resolve(unlistenMock);
  }),
}));

const cursor: CursorSnapshot = {
  row: 0,
  col: 0,
  shape: "block",
  blinking: false,
  visible: true,
};

function cell(ch: string): CellSnapshot {
  return { ch, fg: 0, bg: 0, attrs: 0 };
}

function makeSnapshot(text: string): GridSnapshot {
  return {
    cols: text.length,
    rows: 1,
    cells: [text.split("").map(cell)],
    cursor,
  };
}

function makeFullDiff(text: string): GridDiff {
  return {
    cols: text.length,
    rows_total: 1,
    full: true,
    cursor,
    cursor_changed: true,
    rows: [{ row: 0, cells: text.split("").map(cell) }],
  };
}

function makePartialDiff(row: number, text: string, cols: number): GridDiff {
  return {
    cols,
    rows_total: 2,
    full: false,
    cursor,
    cursor_changed: false,
    rows: [{ row, cells: text.split("").map(cell) }],
  };
}

describe("useTerminalSnapshot listener-arming race contract", () => {
  beforeEach(() => {
    (invokeMock as unknown as ReturnType<typeof vi.fn>).mockReset();
    unlistenMock.mockReset();
    listenCalls.length = 0;
    invokeCalls.length = 0;
    opCounter = 0;
    for (const k of Object.keys(listeners)) delete listeners[k];
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns null when terminalId is null", () => {
    const { result } = renderHook(() => useTerminalSnapshot(null));
    expect(result.current).toBeNull();
    expect(invokeCalls).toHaveLength(0);
  });

  it("registers the diff listener before invoking term_snapshot", async () => {
    (invokeMock as unknown as ReturnType<typeof vi.fn>).mockImplementation((cmd) => {
      if (cmd === "term_snapshot") return Promise.resolve(makeSnapshot("hi"));
      return Promise.reject(new Error(`unexpected ${cmd}`));
    });

    renderHook(() => useTerminalSnapshot("term-1"));

    await waitFor(() => {
      expect(listenCalls).toHaveLength(1);
      expect(invokeCalls.length).toBeGreaterThan(0);
    });
    expect(listenCalls[0].event).toBe("term:diff-term-1");
    // listener must be armed BEFORE the invoke is dispatched so any
    // event emitted during the IPC round-trip is captured.
    expect(listenCalls[0].armedAt).toBeLessThan(invokeCalls[0].calledAt);
  });

  it("seeds from the initial snapshot when no diff event has raced ahead", async () => {
    (invokeMock as unknown as ReturnType<typeof vi.fn>).mockImplementation((cmd) => {
      if (cmd === "term_snapshot") return Promise.resolve(makeSnapshot("hi"));
      return Promise.reject(new Error(`unexpected ${cmd}`));
    });

    const { result } = renderHook(() => useTerminalSnapshot("term-1"));
    await waitFor(() => expect(result.current).not.toBeNull());
    expect(result.current?.cells[0][0].ch).toBe("h");
    expect(result.current?.cells[0][1].ch).toBe("i");
  });

  it("drops a partial diff that arrives before the initial seed", async () => {
    let resolveSnapshot: ((value: GridSnapshot | null) => void) | null = null;
    (invokeMock as unknown as ReturnType<typeof vi.fn>).mockImplementation((cmd) => {
      if (cmd === "term_snapshot") {
        return new Promise<GridSnapshot | null>((resolve) => {
          resolveSnapshot = resolve;
        });
      }
      return Promise.reject(new Error(`unexpected ${cmd}`));
    });

    const { result } = renderHook(() => useTerminalSnapshot("term-1"));
    await waitFor(() => expect(listeners["term:diff-term-1"]).toBeDefined());

    // Fire a partial diff while the IPC is still in flight. Without
    // the drop guard, applyDiff(null, partial) would fabricate a
    // half-empty grid keyed off `diff.cols/rows_total` — corrupt.
    await act(async () => {
      listeners["term:diff-term-1"]({
        payload: makePartialDiff(1, "xy", 2) as unknown as GridDiff,
      });
    });
    expect(result.current).toBeNull();

    // Now the IPC returns a fresh snapshot which should seed the grid.
    await act(async () => {
      resolveSnapshot?.(makeSnapshot("ok"));
    });
    await waitFor(() => expect(result.current).not.toBeNull());
    expect(result.current?.cells[0][0].ch).toBe("o");
    expect(result.current?.cells[0][1].ch).toBe("k");
  });

  it("seeds from a full=true diff that arrives before the initial seed", async () => {
    let resolveSnapshot: ((value: GridSnapshot | null) => void) | null = null;
    (invokeMock as unknown as ReturnType<typeof vi.fn>).mockImplementation((cmd) => {
      if (cmd === "term_snapshot") {
        return new Promise<GridSnapshot | null>((resolve) => {
          resolveSnapshot = resolve;
        });
      }
      return Promise.reject(new Error(`unexpected ${cmd}`));
    });

    const { result } = renderHook(() => useTerminalSnapshot("term-1"));
    await waitFor(() => expect(listeners["term:diff-term-1"]).toBeDefined());

    await act(async () => {
      listeners["term:diff-term-1"]({ payload: makeFullDiff("Y!") as unknown as GridDiff });
    });
    await waitFor(() => expect(result.current).not.toBeNull());
    expect(result.current?.cells[0][0].ch).toBe("Y");
    expect(result.current?.cells[0][1].ch).toBe("!");

    // Now the IPC returns a stale snapshot — must NOT overwrite the
    // newer state already seeded by the racing full=true diff.
    await act(async () => {
      resolveSnapshot?.(makeSnapshot("XX"));
    });
    expect(result.current?.cells[0][0].ch).toBe("Y");
    expect(result.current?.cells[0][1].ch).toBe("!");
  });

  it("applies subsequent partial diffs once the grid is seeded", async () => {
    (invokeMock as unknown as ReturnType<typeof vi.fn>).mockImplementation((cmd) => {
      if (cmd === "term_snapshot") {
        return Promise.resolve({
          cols: 2,
          rows: 2,
          cells: [
            [cell("a"), cell("b")],
            [cell("c"), cell("d")],
          ],
          cursor,
        } satisfies GridSnapshot);
      }
      return Promise.reject(new Error(`unexpected ${cmd}`));
    });

    const { result } = renderHook(() => useTerminalSnapshot("term-1"));
    await waitFor(() => expect(result.current).not.toBeNull());
    expect(result.current?.cells[1][0].ch).toBe("c");

    await act(async () => {
      listeners["term:diff-term-1"]({
        payload: makePartialDiff(1, "EF", 2) as unknown as GridDiff,
      });
    });
    expect(result.current?.cells[0][0].ch).toBe("a"); // untouched
    expect(result.current?.cells[1][0].ch).toBe("E"); // patched
  });

  it("calls unlisten when the terminalId changes", async () => {
    (invokeMock as unknown as ReturnType<typeof vi.fn>).mockImplementation((cmd) => {
      if (cmd === "term_snapshot") return Promise.resolve(makeSnapshot("hi"));
      return Promise.reject(new Error(`unexpected ${cmd}`));
    });

    const { rerender } = renderHook(({ id }) => useTerminalSnapshot(id), {
      initialProps: { id: "term-1" as string | null },
    });
    await waitFor(() => expect(listeners["term:diff-term-1"]).toBeDefined());

    rerender({ id: "term-2" });
    await waitFor(() => {
      expect(unlistenMock).toHaveBeenCalled();
      expect(listeners["term:diff-term-2"]).toBeDefined();
    });
  });

  it("clears state on terminalId change so B's partial does not patch A's grid", async () => {
    // P2 #2 from codex round-6 r1: A → B transition must reset the
    // snapshot before B's diff stream arrives. Otherwise:
    //   1. listener for A receives a partial → applies to A's grid (OK)
    //   2. cleanup, re-mount for B
    //   3. listener for B receives a partial → `!prev && !diff.full`
    //      is false because prev=A's snapshot → applyDiff(A, B-partial)
    //      corrupts the grid. Then `prev ?? initial` refuses B's seed.
    //
    // The fix is `setSnapshot(null)` at the top of the effect on every
    // terminalId change, so B starts from a clean slate just like a
    // fresh first mount.
    let resolveB: ((value: GridSnapshot | null) => void) | null = null;
    (invokeMock as unknown as ReturnType<typeof vi.fn>).mockImplementation((cmd, args) => {
      if (cmd !== "term_snapshot") return Promise.reject(new Error(`unexpected ${cmd}`));
      const id = (args as { id: string } | undefined)?.id;
      if (id === "term-A") return Promise.resolve(makeSnapshot("AA"));
      if (id === "term-B") {
        return new Promise<GridSnapshot | null>((resolve) => {
          resolveB = resolve;
        });
      }
      return Promise.reject(new Error(`unexpected id ${id}`));
    });

    const { result, rerender } = renderHook(({ id }) => useTerminalSnapshot(id), {
      initialProps: { id: "term-A" as string | null },
    });
    await waitFor(() => expect(result.current?.cells[0][0].ch).toBe("A"));

    rerender({ id: "term-B" });
    // The setSnapshot(null) at effect top must have wiped A's state.
    await waitFor(() => expect(result.current).toBeNull());
    await waitFor(() => expect(listeners["term:diff-term-B"]).toBeDefined());

    // B emits a partial before its initial seed completes — it must be
    // dropped (prev=null + full=false guard fires). Without the
    // setSnapshot(null) at effect top, prev would still be A's grid
    // and the partial would incorrectly patch A's cells.
    await act(async () => {
      listeners["term:diff-term-B"]({
        payload: makePartialDiff(1, "BB", 2) as unknown as GridDiff,
      });
    });
    expect(result.current).toBeNull();

    // B's initial finally arrives — it must seed (prev was null).
    await act(async () => {
      resolveB?.(makeSnapshot("OK"));
    });
    await waitFor(() => expect(result.current).not.toBeNull());
    expect(result.current?.cells[0][0].ch).toBe("O");
    expect(result.current?.cells[0][1].ch).toBe("K");
  });

  it("seeds images from a racing full=true diff that carries the wire-format images field", async () => {
    // r3 contract: `GridDiff::images` now travels on the wire. A racing
    // full=true diff arriving before `term_snapshot` returns seeds the
    // grid with correct images directly — no merge fallback needed.
    const image: ImageRef = { id: 42, cellRow: 0, cellCol: 0, widthPx: 100, heightPx: 50 };
    let resolveSnapshot: ((value: GridSnapshot | null) => void) | null = null;
    (invokeMock as unknown as ReturnType<typeof vi.fn>).mockImplementation((cmd) => {
      if (cmd === "term_snapshot") {
        return new Promise<GridSnapshot | null>((resolve) => {
          resolveSnapshot = resolve;
        });
      }
      return Promise.reject(new Error(`unexpected ${cmd}`));
    });

    const { result } = renderHook(() => useTerminalSnapshot("term-1"));
    await waitFor(() => expect(listeners["term:diff-term-1"]).toBeDefined());

    // Racing full=true diff with images on the wire (Some([image])).
    await act(async () => {
      listeners["term:diff-term-1"]({
        payload: {
          cols: 2,
          rows_total: 1,
          full: true,
          cursor,
          cursor_changed: true,
          rows: [{ row: 0, cells: [cell("Y"), cell("!")] }],
          images: [image],
        } as GridDiff,
      });
    });
    await waitFor(() => expect(result.current).not.toBeNull());
    expect(result.current?.cells[0][0].ch).toBe("Y");
    expect(result.current?.images).toEqual([image]);

    // Initial returns AFTER the racing diff. `prev ?? initial` keeps
    // prev — and prev already has correct images from the diff, so a
    // stale `initial.images` cannot leak in.
    const staleImage: ImageRef = { id: 99, cellRow: 5, cellCol: 5, widthPx: 1, heightPx: 1 };
    await act(async () => {
      resolveSnapshot?.({
        cols: 2,
        rows: 1,
        cells: [[cell("X"), cell("X")]],
        cursor,
        images: [staleImage],
      });
    });
    expect(result.current?.cells[0][0].ch).toBe("Y"); // newer cells preserved
    expect(result.current?.images).toEqual([image]); // diff's images preserved, stale initial NOT used
  });

  it("clears images on a partial diff that explicitly carries an empty image set", async () => {
    // The diff stream surfaces eviction (anchor scrolled out) by
    // emitting `images: []`. The hook must treat that as "clear", not
    // "unchanged from prev".
    const image: ImageRef = { id: 1, cellRow: 0, cellCol: 0, widthPx: 10, heightPx: 10 };
    (invokeMock as unknown as ReturnType<typeof vi.fn>).mockImplementation((cmd) => {
      if (cmd === "term_snapshot") {
        return Promise.resolve({
          cols: 2,
          rows: 1,
          cells: [[cell("a"), cell("b")]],
          cursor,
          images: [image],
        } satisfies GridSnapshot);
      }
      return Promise.reject(new Error(`unexpected ${cmd}`));
    });

    const { result } = renderHook(() => useTerminalSnapshot("term-1"));
    await waitFor(() => expect(result.current?.images).toEqual([image]));

    await act(async () => {
      listeners["term:diff-term-1"]({
        payload: {
          cols: 2,
          rows_total: 1,
          full: false,
          cursor,
          cursor_changed: false,
          rows: [],
          images: [],
        } as GridDiff,
      });
    });
    expect(result.current?.images).toEqual([]);
  });

  it("stays null when the backend rejects (e.g. vitest jsdom)", async () => {
    (invokeMock as unknown as ReturnType<typeof vi.fn>).mockImplementation(() =>
      Promise.reject(new Error("backend unreachable")),
    );

    const { result } = renderHook(() => useTerminalSnapshot("term-1"));
    // Give the effect a turn to run and reject silently.
    await new Promise((r) => setTimeout(r, 0));
    expect(result.current).toBeNull();
  });
});
