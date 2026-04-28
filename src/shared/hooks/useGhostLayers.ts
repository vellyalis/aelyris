import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type {
  FileDelta,
  LayerIdPayload,
  LayerListSnapshot,
  LayerSummary,
  LayerUpdatedPayload,
} from "../types/ghostdiff";

interface UseGhostLayersResult {
  layers: LayerSummary[];
  activeCount: number;
  dismiss: (layerId: string) => Promise<void>;
  getFile: (layerId: string, filePath: string) => Promise<FileDelta | null>;
}

interface RegistryState {
  byId: Map<string, LayerSummary>;
  /**
   * Last contiguously applied event seq. Events with `seq <= state.seq`
   * are already reflected; events with `seq === state.seq + 1` advance
   * the state; events with `seq > state.seq + 1` are held in `pending`
   * until their predecessors arrive.
   */
  seq: number;
}

type BufferedEvent =
  | { kind: "updated"; payload: LayerUpdatedPayload }
  | { kind: "completed"; payload: LayerIdPayload }
  | { kind: "removed"; payload: LayerIdPayload };

function applyOne(state: RegistryState, ev: BufferedEvent): RegistryState {
  const next = new Map(state.byId);
  switch (ev.kind) {
    case "updated":
      next.set(ev.payload.summary.id, ev.payload.summary);
      break;
    case "completed": {
      const existing = next.get(ev.payload.layerId);
      if (existing && !existing.isComplete) {
        next.set(ev.payload.layerId, { ...existing, isComplete: true });
      }
      break;
    }
    case "removed":
      next.delete(ev.payload.layerId);
      break;
  }
  return { byId: next, seq: ev.payload.seq };
}

/**
 * Drain `pending` into `state` in contiguous seq order. Drops any events
 * whose seq is not greater than `state.seq` (already reflected). Stops
 * when `pending` has a gap, holding the rest until the missing predecessor
 * arrives.
 *
 * Mutates `pending` in place — the Map is the durable per-hook buffer.
 */
function drainContiguous(
  state: RegistryState,
  pending: Map<number, BufferedEvent>,
): RegistryState {
  // Phase 1: drop already-applied events. Iterating a snapshot of keys
  // because we delete during the walk.
  for (const seq of Array.from(pending.keys())) {
    if (seq <= state.seq) {
      pending.delete(seq);
    }
  }
  // Phase 2: apply the contiguous run starting at seq+1.
  let cur = state;
  while (pending.has(cur.seq + 1)) {
    const ev = pending.get(cur.seq + 1)!;
    pending.delete(cur.seq + 1);
    cur = applyOne(cur, ev);
  }
  return cur;
}

/**
 * Subscribe to `LayerRegistry` events emitted by the auto-repair poller
 * (Phase 3C-1a). Keeps an id-keyed map so out-of-order `updated` /
 * `completed` / `removed` events merge correctly.
 *
 * Listener-arming + reorder contract (paired with backend
 * `LayerRegistry`'s monotonic seq):
 *
 * 1. Register all three listeners BEFORE invoking `list_ghost_layers` so
 *    any event that fires during the IPC round-trip is captured (not
 *    dropped on the floor).
 * 2. Every event lands in `pendingRef` keyed by `seq`. The hook tracks
 *    `state.seq` = last contiguously applied event seq, and applies
 *    pending events only when their seq is `state.seq + 1` (contiguous).
 *    Out-of-order arrivals are held until the missing predecessor lands.
 * 3. When the bootstrap snapshot arrives, seed the map from
 *    `snapshot.layers` with `seq = snapshot.seq`, then run
 *    `drainContiguous` so any pre-seed events that are now <= snapshot.seq
 *    are dropped (already reflected) and any newer events are applied
 *    in seq order.
 *
 * This is a reorder buffer, NOT a high-watermark filter. A high-watermark
 * filter (drop on `seq <= state.seq` only) loses events that arrive in
 * the wrong order, because the backend allocates seq under one lock but
 * may release the lock and lose the CPU before the channel push — letting
 * a later thread land its event first. With a reorder buffer, both events
 * land in `pending` and replay in seq order regardless of arrival order.
 */
export function useGhostLayers(): UseGhostLayersResult {
  const [state, setState] = useState<RegistryState | null>(null);

  // Persistent reorder buffer keyed by seq. Lives across renders without
  // triggering re-renders itself. Cleared on hook teardown.
  const pendingRef = useRef<Map<number, BufferedEvent>>(new Map());

  useEffect(() => {
    let cancelled = false;
    const unlistens: UnlistenFn[] = [];
    pendingRef.current = new Map();

    const dispatch = (ev: BufferedEvent): void => {
      if (cancelled) return;
      pendingRef.current.set(ev.payload.seq, ev);
      setState((prev) => {
        if (!prev) {
          // Pre-seed: events stay in pendingRef until the snapshot
          // arrives and seeds state. No state change yet.
          return prev;
        }
        return drainContiguous(prev, pendingRef.current);
      });
    };

    (async () => {
      // Step 1: register listeners FIRST so events that fire during the
      // bootstrap IPC round-trip land in pendingRef, not on the floor.
      try {
        unlistens.push(
          await listen<LayerUpdatedPayload>("ghost-diff:layer-updated", (event) =>
            dispatch({ kind: "updated", payload: event.payload }),
          ),
        );
      } catch {
        /* listen unavailable */
      }
      try {
        unlistens.push(
          await listen<LayerIdPayload>("ghost-diff:layer-completed", (event) =>
            dispatch({ kind: "completed", payload: event.payload }),
          ),
        );
      } catch {
        /* listen unavailable */
      }
      try {
        unlistens.push(
          await listen<LayerIdPayload>("ghost-diff:layer-removed", (event) =>
            dispatch({ kind: "removed", payload: event.payload }),
          ),
        );
      } catch {
        /* listen unavailable */
      }

      if (cancelled) {
        unlistens.forEach((fn) => fn());
        unlistens.length = 0;
        return;
      }

      // Step 2-3: bootstrap snapshot + drain pending through reorder buffer.
      try {
        const snap = await invoke<LayerListSnapshot>("list_ghost_layers");
        if (cancelled) return;
        setState((prev) => {
          if (prev) return prev;
          const seeded: RegistryState = {
            byId: new Map(snap.layers.map((l) => [l.id, l])),
            seq: snap.seq,
          };
          return drainContiguous(seeded, pendingRef.current);
        });
      } catch {
        // Backend not ready / invoke failed (e.g. vitest jsdom). The
        // pending buffer keeps growing harmlessly — bounded by the
        // lifetime of this hook instance. The component still renders
        // the empty layer set until/unless the backend comes online.
      }
    })();

    return () => {
      cancelled = true;
      unlistens.forEach((fn) => fn());
      pendingRef.current.clear();
    };
  }, []);

  const layers = useMemo(() => {
    if (!state) return [] as LayerSummary[];
    const arr = Array.from(state.byId.values());
    arr.sort((a, b) => a.createdAt - b.createdAt);
    return arr;
  }, [state]);

  const activeCount = useMemo(() => layers.filter((l) => !l.isComplete).length, [layers]);

  const dismiss = useCallback(async (layerId: string) => {
    try {
      await invoke("dismiss_ghost_layer", { layerId });
    } catch {
      /* backend may have already removed it */
    }
  }, []);

  const getFile = useCallback(
    async (layerId: string, filePath: string): Promise<FileDelta | null> => {
      try {
        const res = await invoke<FileDelta | null>("get_ghost_layer_file", {
          layerId,
          filePath,
        });
        return res ?? null;
      } catch {
        return null;
      }
    },
    [],
  );

  return { layers, activeCount, dismiss, getFile };
}
