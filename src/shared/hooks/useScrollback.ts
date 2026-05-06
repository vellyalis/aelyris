import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { type CellSnapshot, ColorKind, type GridSnapshot } from "../types/terminal";
import type { PromptMark } from "./usePromptMarks";

const BLANK_CELL: CellSnapshot = {
  ch: " ",
  fg: (ColorKind.NAMED << 24) | 256,
  bg: (ColorKind.NAMED << 24) | 257,
  attrs: 0,
};

const HISTORY_SIZE_REFRESH_INTERVAL_MS = 250;

function blankRow(cols: number): CellSnapshot[] {
  return Array.from({ length: cols }, () => BLANK_CELL);
}

export interface ScrollbackState {
  /** Lines scrolled above the live screen. 0 = live view. */
  scrollOffset: number;
  /** Total retained scrollback in the engine (cap: 10k). */
  historySize: number;
  canScrollUp: boolean;
  canScrollDown: boolean;
  /** Positive delta = scroll up into history; negative = toward live. */
  scrollBy: (delta: number) => void;
  /** Set the offset directly. Clamped to `[0, historySize]`. */
  scrollToOffset: (offset: number) => void;
  /** Jump straight to the live screen (equivalent to `End` key behaviour). */
  scrollToLive: () => void;
  /**
   * Scroll so the given prompt mark lands at the top of the viewport.
   * Returns `true` on success, `false` when the mark is still in live view
   * and no scroll was needed, or when the snapshot is missing.
   */
  scrollToMark: (mark: PromptMark) => boolean;
  /**
   * The viewport's current cell grid. Equal to `snapshot.cells` when
   * `scrollOffset === 0` (reference-equal so downstream memoisation stays
   * warm); otherwise a freshly-composed grid mixing history rows at the
   * top with live rows at the bottom.
   */
  compositeCells: CellSnapshot[][] | null;
}

/**
 * Manages scrollback state for a single terminal pane.
 *
 * Semantics:
 * - `scrollOffset` is clamped to `[0, historySize]`.
 * - The viewport is `snapshot.rows` rows tall regardless of scrolling.
 * - When `scrollOffset === 0`, the live screen fills the viewport.
 * - When `0 < scrollOffset < rows`, the top `scrollOffset` rows show
 *   history (oldest at the top) and the bottom `rows - scrollOffset`
 *   rows show the first live lines.
 * - When `scrollOffset >= rows`, the viewport is entirely scrollback.
 *
 * History rows are fetched via `invoke("term_history_rows", ...)` on each
 * offset change. The fetch is cheap (serialises one screen-height window
 * of cells, typically 80×24 or 200×50), and a new fetch is issued only
 * when `(terminalId, scrollOffset, historySize)` changes — so ordinary
 * typing at the live prompt (which leaves `scrollOffset` at 0) makes
 * zero extra IPC calls.
 */
export function useScrollback(terminalId: string | null, snapshot: GridSnapshot | null): ScrollbackState {
  const [scrollOffset, setScrollOffset] = useState(0);
  const [historySize, setHistorySize] = useState(0);
  const [historyRows, setHistoryRows] = useState<CellSnapshot[][]>([]);
  const [historyWindowFrom, setHistoryWindowFrom] = useState(0);
  const historySizeRefreshRef = useRef<{
    terminalId: string | null;
    lastStartedAt: number;
    timer: ReturnType<typeof setTimeout> | null;
    inFlight: boolean;
  }>({
    terminalId: null,
    lastStartedAt: 0,
    timer: null,
    inFlight: false,
  });

  const requestHistorySize = useCallback((id: string) => {
    const state = historySizeRefreshRef.current;
    if (state.terminalId !== id) {
      if (state.timer) clearTimeout(state.timer);
      state.terminalId = id;
      state.lastStartedAt = 0;
      state.timer = null;
      state.inFlight = false;
    }

    const refresh = () => {
      const current = historySizeRefreshRef.current;
      current.timer = null;
      current.lastStartedAt = Date.now();
      current.inFlight = true;
      invoke<number>("term_history_size", { id })
        .then((n) => {
          if (historySizeRefreshRef.current.terminalId === id) setHistorySize(n);
        })
        .catch(() => {
          // Backend unavailable (e.g. jsdom unit tests) — keep the last value.
        })
        .finally(() => {
          if (historySizeRefreshRef.current.terminalId === id) {
            historySizeRefreshRef.current.inFlight = false;
          }
        });
    };

    if (state.inFlight) return;
    const elapsed = Date.now() - state.lastStartedAt;
    if (state.lastStartedAt === 0 || elapsed >= HISTORY_SIZE_REFRESH_INTERVAL_MS) {
      refresh();
      return;
    }
    if (!state.timer) {
      state.timer = setTimeout(refresh, HISTORY_SIZE_REFRESH_INTERVAL_MS - elapsed);
    }
  }, []);

  useEffect(() => {
    return () => {
      const state = historySizeRefreshRef.current;
      if (state.timer) clearTimeout(state.timer);
      state.terminalId = null;
      state.timer = null;
      state.inFlight = false;
    };
  }, []);

  // Pull the latest history size on terminal change or whenever the live
  // snapshot mutates (live output extends history over time). A noisy PTY can
  // publish many snapshots per second, so this is throttled.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the snapshot object is the live-output clock; requestHistorySize applies the throttle.
  useEffect(() => {
    if (!terminalId) {
      const state = historySizeRefreshRef.current;
      if (state.timer) clearTimeout(state.timer);
      state.terminalId = null;
      state.timer = null;
      state.inFlight = false;
      setHistorySize(0);
      setScrollOffset(0);
      setHistoryRows([]);
      setHistoryWindowFrom(0);
      return;
    }
    requestHistorySize(terminalId);
  }, [terminalId, snapshot, requestHistorySize]);

  // Clamp offset whenever the retained history shrinks (rare — usually
  // only on terminal reset or scrollback eviction at the 10k cap).
  useEffect(() => {
    if (scrollOffset > historySize) setScrollOffset(historySize);
  }, [historySize, scrollOffset]);

  // Fetch the rows needed to render the current viewport.
  useEffect(() => {
    if (!terminalId || scrollOffset === 0) {
      // Live-view: no history rows needed for the composite path.
      setHistoryRows([]);
      setHistoryWindowFrom(0);
      return;
    }
    const viewportRows = snapshot?.rows ?? 0;
    if (viewportRows <= 0) {
      setHistoryRows([]);
      setHistoryWindowFrom(0);
      return;
    }
    const visibleHistoryRows = Math.min(scrollOffset, viewportRows);
    const fromN = Math.max(0, scrollOffset - visibleHistoryRows);
    let cancelled = false;
    invoke<CellSnapshot[][]>("term_history_rows", {
      id: terminalId,
      fromN,
      count: visibleHistoryRows,
    })
      .then((rows) => {
        if (!cancelled) {
          setHistoryWindowFrom(fromN);
          setHistoryRows(rows);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setHistoryRows([]);
          setHistoryWindowFrom(fromN);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [terminalId, scrollOffset, snapshot?.rows]);

  const canScrollUp = historySize > scrollOffset;
  const canScrollDown = scrollOffset > 0;

  const scrollBy = useCallback(
    (delta: number) => {
      setScrollOffset((prev) => {
        const next = prev + delta;
        if (next <= 0) return 0;
        if (next >= historySize) return historySize;
        return next;
      });
    },
    [historySize],
  );

  const scrollToOffset = useCallback(
    (offset: number) => {
      if (offset <= 0) {
        setScrollOffset(0);
        return;
      }
      setScrollOffset(Math.min(offset, historySize));
    },
    [historySize],
  );

  const scrollToLive = useCallback(() => setScrollOffset(0), []);

  const scrollToMark = useCallback(
    (mark: PromptMark): boolean => {
      if (!snapshot) return false;
      // Lines added to history since the mark was recorded. Equal to the
      // number of rows that scrolled off the top of the live screen.
      const delta = historySize - mark.historySize;
      if (delta <= mark.screenLine) {
        // Mark is still on the live screen — no scroll needed. Reset to
        // live so a stale scrollback view doesn't hide the answer.
        setScrollOffset(0);
        return false;
      }
      // `n` = history index where the mark row now lives (0 = row
      // immediately above the live screen, growing downward into
      // scrollback). `offset = n + 1` puts that row at viewport top.
      const n = delta - 1 - mark.screenLine;
      const target = Math.min(historySize, n + 1);
      setScrollOffset(target);
      return true;
    },
    [snapshot, historySize],
  );

  const compositeCells = useMemo<CellSnapshot[][] | null>(() => {
    if (!snapshot) return null;
    if (scrollOffset === 0) return snapshot.cells;

    const rows = snapshot.rows;
    const cols = snapshot.cols;
    const out: CellSnapshot[][] = [];
    const historyRow = (n: number): CellSnapshot[] | undefined => {
      const idx = n - historyWindowFrom;
      return idx >= 0 ? historyRows[idx] : undefined;
    };

    if (scrollOffset >= rows) {
      // Viewport entirely in history. Render the oldest visible history
      // row at the top so the reading order matches the live display.
      for (let i = 0; i < rows; i++) {
        const n = scrollOffset - 1 - i;
        out.push(historyRow(n) ?? blankRow(cols));
      }
    } else {
      for (let i = 0; i < scrollOffset; i++) {
        const n = scrollOffset - 1 - i;
        out.push(historyRow(n) ?? blankRow(cols));
      }
      for (let i = 0; i < rows - scrollOffset; i++) {
        out.push(snapshot.cells[i] ?? blankRow(cols));
      }
    }
    return out;
  }, [snapshot, scrollOffset, historyRows, historyWindowFrom]);

  return {
    scrollOffset,
    historySize,
    canScrollUp,
    canScrollDown,
    scrollBy,
    scrollToOffset,
    scrollToLive,
    scrollToMark,
    compositeCells,
  };
}

/**
 * Find the `PromptStart` mark that should become the target of a
 * jump-to-prev-prompt action, given the current scrollback state.
 *
 * Strategy: walk the marks newest-first and return the first whose
 * current history index is *strictly greater* than the current viewport
 * top. That is the most-recent prompt that sits above what the user is
 * currently looking at.
 */
export function findPrevPromptMark(
  marks: readonly PromptMark[],
  scrollOffset: number,
  historySize: number,
): PromptMark | null {
  // Viewport top measured in history-index space. At offset 0 the top
  // sits *just below* history row 0, so we treat it as `-1` for the
  // comparison below.
  const topN = scrollOffset === 0 ? -1 : scrollOffset - 1;
  for (let i = marks.length - 1; i >= 0; i--) {
    const mark = marks[i];
    if (mark.kind !== "promptStart") continue;
    const n = historySize - mark.historySize - 1 - mark.screenLine;
    if (n > topN) return mark;
  }
  return null;
}

/**
 * Counterpart to `findPrevPromptMark`: the oldest `PromptStart` mark
 * strictly below the current viewport top.
 */
export function findNextPromptMark(
  marks: readonly PromptMark[],
  scrollOffset: number,
  historySize: number,
): PromptMark | null {
  const topN = scrollOffset === 0 ? -1 : scrollOffset - 1;
  for (const mark of marks) {
    if (mark.kind !== "promptStart") continue;
    const n = historySize - mark.historySize - 1 - mark.screenLine;
    if (n < topN) return mark;
  }
  return null;
}
