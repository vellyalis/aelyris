import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import type { GridDiff, GridSnapshot } from "../types/terminal";

/**
 * Subscribe to the native terminal engine's `term:diff-<id>` stream and
 * keep a materialised `GridSnapshot` in sync.
 *
 * Returns `null` until the first snapshot or diff arrives. The caller
 * (TerminalCanvas) displays nothing until that happens.
 */
export function useTerminalSnapshot(terminalId: string | null): GridSnapshot | null {
  const [snapshot, setSnapshot] = useState<GridSnapshot | null>(null);

  useEffect(() => {
    if (!terminalId) {
      setSnapshot(null);
      return;
    }

    let cancelled = false;
    let unlisten: UnlistenFn | null = null;

    (async () => {
      try {
        const initial = await invoke<GridSnapshot | null>("term_snapshot", { id: terminalId });
        if (cancelled) return;
        if (initial) setSnapshot(initial);

        unlisten = await listen<GridDiff>(`term:diff-${terminalId}`, (event) => {
          setSnapshot((prev) => applyDiff(prev, event.payload));
        });
      } catch {
        // Backend unreachable (e.g. vitest jsdom) — stay null.
      }
    })();

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [terminalId]);

  return snapshot;
}

export function applyDiff(prev: GridSnapshot | null, diff: GridDiff): GridSnapshot {
  if (diff.full || !prev || prev.cols !== diff.cols || prev.rows !== diff.rows_total) {
    const cells = Array.from({ length: diff.rows_total }, () =>
      Array.from({ length: diff.cols }, () => ({ ch: " ", fg: 0, bg: 0, attrs: 0 })),
    );
    for (const row of diff.rows) {
      cells[row.row] = row.cells;
    }
    return { cols: diff.cols, rows: diff.rows_total, cells, cursor: diff.cursor };
  }

  const next: GridSnapshot = {
    cols: prev.cols,
    rows: prev.rows,
    cells: prev.cells.slice(),
    cursor: diff.cursor,
  };
  for (const row of diff.rows) {
    next.cells[row.row] = row.cells;
  }
  return next;
}
