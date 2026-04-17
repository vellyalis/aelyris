import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import type { GridDiff, GridSnapshot } from "../types/terminal";

/**
 * Subscribe to the native terminal engine's `term:diff-<id>` stream and
 * keep a materialised `GridSnapshot` in sync.
 *
 * The hook is a no-op when the native engine is disabled (env flag
 * `AETHER_TERM_NATIVE=1` not set on the backend) — `snapshot` stays null
 * and the legacy xterm.js path continues to drive rendering.
 *
 * Task 5 scope: plumbing only. TerminalCanvas (Task 6) will consume the
 * returned snapshot and paint from it.
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
        const enabled = await invoke<boolean>("term_native_enabled");
        if (cancelled || !enabled) return;

        const initial = await invoke<GridSnapshot | null>("term_snapshot", { id: terminalId });
        if (cancelled) return;
        if (initial) setSnapshot(initial);

        unlisten = await listen<GridDiff>(`term:diff-${terminalId}`, (event) => {
          setSnapshot((prev) => applyDiff(prev, event.payload));
        });
      } catch {
        // Native engine is optional — silently fall back.
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
