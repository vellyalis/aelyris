import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useEffect, useState } from "react";

import type { GridDiff, GridSnapshot, ImageRef } from "../types/terminal";

/**
 * Subscribe to the native terminal engine's `term:diff-<id>` stream and
 * keep a materialised `GridSnapshot` in sync.
 *
 * Returns `null` until the first snapshot or diff arrives. The caller
 * (TerminalCanvas) displays nothing until that happens.
 *
 * Listener-arming race contract (paired with backend
 * `snapshot_and_reset_tracker`):
 *
 * 1. Register the diff listener BEFORE invoking `term_snapshot` so any
 *    event emitted during the IPC round-trip is captured.
 * 2. The IPC resets the backend `DiffTracker`, so the very next emitted
 *    diff is guaranteed to be `full=true`. A `full=true` diff fully
 *    re-seeds the grid regardless of prev state.
 * 3. A partial (`full=false`) diff that arrives before the initial seed
 *    is dropped — `applyDiff` would otherwise fabricate a half-empty
 *    grid. The next `full=true` re-emit (forced by step 2) recovers.
 * 4. The initial snapshot is applied with `prev ?? initial` so a
 *    `full=true` diff that already raced ahead during the IPC window
 *    is not stomped by an older `initial`. The diff stream now carries
 *    the image set on every `full=true` and on any `full=false` whose
 *    image set changed (`GridDiff::images: Option<Vec<ImageRef>>`),
 *    so the racing-diff seed already has correct images and no merge
 *    fallback is needed.
 */
export function useTerminalSnapshot(terminalId: string | null): GridSnapshot | null {
  const [snapshot, setSnapshot] = useState<GridSnapshot | null>(null);

  useEffect(() => {
    // Clear state on EVERY terminalId change (including A → B, not just
    // any → null). Without this, an A → B transition could let B's
    // initial diff stream patch A's leftover snapshot — both because
    // `!prev && !diff.full` is false for partials (so the drop guard is
    // bypassed) and because `prev ?? initial` then refuses to seed B.
    setSnapshot(null);
    if (!terminalId) {
      return;
    }

    let cancelled = false;
    let unlisten: UnlistenFn | null = null;

    (async () => {
      try {
        // Step 1: register listener first so we capture any diff
        // emitted while the term_snapshot IPC is in flight.
        unlisten = await listen<GridDiff>(`term:diff-${terminalId}`, (event) => {
          if (cancelled) return;
          const diff = event.payload;
          setSnapshot((prev) => {
            // Step 3: drop partial diffs that arrive before the first
            // full=true frame. They have no prev to apply against, and
            // applyDiff would zero-fill the unmentioned rows. The
            // tracker reset inside term_snapshot guarantees a
            // full=true frame will follow which re-seeds correctly.
            if (!prev && !diff.full) return prev;
            return applyDiff(prev, diff);
          });
        });
        if (cancelled) {
          unlisten();
          unlisten = null;
          return;
        }

        // Step 2: invoke after the listener is armed. Backend resets
        // the diff tracker so the next emit is full=true.
        const initial = await invoke<GridSnapshot | null>("term_snapshot", { id: terminalId });
        if (cancelled) return;

        // Step 4: seed when nothing newer has arrived. Without the
        // `??` guard, a full=true diff that beat the IPC return would
        // be overwritten by the (now stale) initial snapshot. With
        // `GridDiff::images` now carried on the wire, a racing diff
        // already seeded prev with correct images, so the simple
        // `prev ?? initial` is closed-loop — no image-merge fallback.
        if (initial) setSnapshot((prev) => prev ?? initial);
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
  // Image resolution: `diff.images` defined means the backend told us
  // the new image set wholesale (always set on `full=true`, set on
  // `full=false` whenever the set changed). `undefined` means the set
  // is unchanged from `prev` — carry it through, except across dim
  // mismatches where prev anchors are no longer valid for the new
  // layout. The dim-match guard only matters on full=true diffs, since
  // partial diffs never carry a different `cols`/`rows_total`.
  const dimsMatch = !!prev && prev.cols === diff.cols && prev.rows === diff.rows_total;
  const images: ImageRef[] | undefined =
    diff.images !== undefined ? diff.images : dimsMatch ? prev.images : undefined;

  if (diff.full || !prev || !dimsMatch) {
    const cells = Array.from({ length: diff.rows_total }, () =>
      Array.from({ length: diff.cols }, () => ({ ch: " ", fg: 0, bg: 0, attrs: 0 })),
    );
    for (const row of diff.rows) {
      cells[row.row] = row.cells;
    }
    return {
      cols: diff.cols,
      rows: diff.rows_total,
      cells,
      cursor: diff.cursor,
      ...(images === undefined ? {} : { images }),
    };
  }

  const next: GridSnapshot = {
    cols: prev.cols,
    rows: prev.rows,
    cells: prev.cells.slice(),
    cursor: diff.cursor,
    ...(images === undefined ? {} : { images }),
  };
  for (const row of diff.rows) {
    next.cells[row.row] = row.cells;
  }
  return next;
}
