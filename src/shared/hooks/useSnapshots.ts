import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useCallback, useEffect, useState } from "react";

import type { LayerSummary } from "../types/ghostdiff";
import type { SnapshotCapturedEvent, SnapshotSummary, TerminalSnapshot } from "../types/snapshot";

interface UseSnapshotsResult {
  snapshots: SnapshotSummary[];
  /** Fetch the full snapshot (including grid cells) by id. */
  fetchFullSnapshot: (snapshotId: string) => Promise<TerminalSnapshot | null>;
  /** Open a read-only overlay for `snapshotId` via `start_snapshot_overlay`. */
  startOverlay: (snapshotId: string) => Promise<LayerSummary | null>;
  /** Explicitly bookmark current grid without waiting for Enter. */
  markSnapshot: (label?: string) => Promise<SnapshotSummary | null>;
}

/**
 * Phase 3C-3a / 3C-3c — time-travel snapshot bindings for the TimelineBar.
 *
 * Subscribes to `snapshot:captured-{sessionId}` so the bar refreshes as the
 * user presses Enter. Returns `{snapshots: []}` when `sessionId` is null or
 * the backend is unreachable (vitest / jsdom path).
 */
export function useSnapshots(sessionId: string | null): UseSnapshotsResult {
  const [snapshots, setSnapshots] = useState<SnapshotSummary[]>([]);

  useEffect(() => {
    if (!sessionId) {
      setSnapshots([]);
      return;
    }

    let cancelled = false;
    let unlistenCaptured: UnlistenFn | null = null;

    const refresh = async () => {
      try {
        const list = await invoke<SnapshotSummary[]>("list_snapshots", {
          sessionId,
        });
        if (!cancelled) setSnapshots(list ?? []);
      } catch {
        /* backend unreachable */
      }
    };

    (async () => {
      await refresh();
      try {
        unlistenCaptured = await listen<SnapshotCapturedEvent>(`snapshot:captured-${sessionId}`, () => {
          void refresh();
        });
      } catch {
        /* listen unavailable */
      }
      if (cancelled) {
        unlistenCaptured?.();
        unlistenCaptured = null;
      }
    })();

    return () => {
      cancelled = true;
      unlistenCaptured?.();
    };
  }, [sessionId]);

  const fetchFullSnapshot = useCallback(async (snapshotId: string): Promise<TerminalSnapshot | null> => {
    try {
      const res = await invoke<TerminalSnapshot | null>("get_snapshot", {
        snapshotId,
      });
      return res ?? null;
    } catch {
      return null;
    }
  }, []);

  const startOverlay = useCallback(async (snapshotId: string): Promise<LayerSummary | null> => {
    try {
      return await invoke<LayerSummary>("start_snapshot_overlay", {
        snapshotId,
      });
    } catch {
      return null;
    }
  }, []);

  const markSnapshot = useCallback(
    async (label?: string): Promise<SnapshotSummary | null> => {
      if (!sessionId) return null;
      try {
        return await invoke<SnapshotSummary>("mark_snapshot", {
          args: { sessionId, label },
        });
      } catch {
        return null;
      }
    },
    [sessionId],
  );

  return { snapshots, fetchFullSnapshot, startOverlay, markSnapshot };
}
