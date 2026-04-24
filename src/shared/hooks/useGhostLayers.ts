import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useCallback, useEffect, useMemo, useState } from "react";

import type { FileDelta, LayerSummary } from "../types/ghostdiff";

interface UseGhostLayersResult {
  layers: LayerSummary[];
  activeCount: number;
  dismiss: (layerId: string) => Promise<void>;
  getFile: (layerId: string, filePath: string) => Promise<FileDelta | null>;
}

/**
 * Subscribe to `LayerRegistry` events emitted by the auto-repair poller
 * (Phase 3C-1a). Keeps an id-keyed map so out-of-order `updated` /
 * `completed` / `removed` events merge correctly.
 */
export function useGhostLayers(): UseGhostLayersResult {
  const [byId, setById] = useState<Map<string, LayerSummary>>(new Map());

  useEffect(() => {
    let cancelled = false;
    const unlistens: UnlistenFn[] = [];

    (async () => {
      try {
        const initial = await invoke<LayerSummary[]>("list_ghost_layers");
        if (cancelled) return;
        const m = new Map<string, LayerSummary>();
        for (const l of initial) m.set(l.id, l);
        setById(m);
      } catch {
        /* backend not ready */
      }

      try {
        unlistens.push(
          await listen<LayerSummary>("ghost-diff:layer-updated", (event) => {
            setById((prev) => {
              const next = new Map(prev);
              next.set(event.payload.id, event.payload);
              return next;
            });
          }),
        );
      } catch {
        /* listen unavailable */
      }

      try {
        unlistens.push(
          await listen<string>("ghost-diff:layer-completed", (event) => {
            const id = event.payload;
            setById((prev) => {
              const existing = prev.get(id);
              if (!existing || existing.isComplete) return prev;
              const next = new Map(prev);
              next.set(id, { ...existing, isComplete: true });
              return next;
            });
          }),
        );
      } catch {
        /* ignore */
      }

      try {
        unlistens.push(
          await listen<string>("ghost-diff:layer-removed", (event) => {
            setById((prev) => {
              if (!prev.has(event.payload)) return prev;
              const next = new Map(prev);
              next.delete(event.payload);
              return next;
            });
          }),
        );
      } catch {
        /* ignore */
      }

      if (cancelled) {
        unlistens.forEach((fn) => fn());
      }
    })();

    return () => {
      cancelled = true;
      unlistens.forEach((fn) => fn());
    };
  }, []);

  const layers = useMemo(() => {
    const arr = Array.from(byId.values());
    arr.sort((a, b) => a.createdAt - b.createdAt);
    return arr;
  }, [byId]);

  const activeCount = useMemo(() => layers.filter((l) => !l.isComplete).length, [layers]);

  const dismiss = useCallback(async (layerId: string) => {
    try {
      await invoke("dismiss_ghost_layer", { layerId });
    } catch {
      /* backend may have already removed it */
    }
  }, []);

  const getFile = useCallback(async (layerId: string, filePath: string): Promise<FileDelta | null> => {
    try {
      const res = await invoke<FileDelta | null>("get_ghost_layer_file", {
        layerId,
        filePath,
      });
      return res ?? null;
    } catch {
      return null;
    }
  }, []);

  return { layers, activeCount, dismiss, getFile };
}
