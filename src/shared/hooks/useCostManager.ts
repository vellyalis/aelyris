import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useCallback, useEffect, useState } from "react";
import { reportInvokeFailure } from "../lib/fallbackTelemetry";
import { isTauriRuntime } from "../lib/tauriRuntime";
import type { CostCaps, CostUsage, SpawnDecision } from "../types/cost";

/**
 * Consumes the Cost Manager (BR7): the configurable runaway-prevention caps.
 * Hydrates via `cost_caps`, stays in sync via `cost-caps-updated`, and exposes
 * `setCaps` plus `canSpawn(usage)` for the controller/cockpit to gate a launch.
 */
export function useCostManager() {
  const [caps, setCaps] = useState<CostCaps | null>(null);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    let cancelled = false;
    let unlisten: UnlistenFn | null = null;

    void listen<CostCaps>("cost-caps-updated", (event) => {
      if (!cancelled) setCaps(event.payload);
    })
      .then((unsubscribe) => {
        if (cancelled) {
          unsubscribe();
          return;
        }
        unlisten = unsubscribe;
      })
      .catch((err) => {
        reportInvokeFailure({ source: "cost-manager", operation: "listen:cost-caps-updated", err, userVisible: false });
      });

    void invoke<CostCaps>("cost_caps")
      .then((next) => {
        if (!cancelled) setCaps(next);
      })
      .catch((err) => {
        reportInvokeFailure({ source: "cost-manager", operation: "cost_caps", err, userVisible: false });
      });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  const updateCaps = useCallback(async (next: CostCaps): Promise<CostCaps | null> => {
    try {
      return await invoke<CostCaps>("cost_set_caps", { caps: next });
    } catch (err) {
      reportInvokeFailure({ source: "cost-manager", operation: "cost_set_caps", err, userVisible: true });
      return null;
    }
  }, []);

  const canSpawn = useCallback(async (usage: CostUsage): Promise<SpawnDecision | null> => {
    try {
      return await invoke<SpawnDecision>("cost_can_spawn", { usage });
    } catch (err) {
      reportInvokeFailure({ source: "cost-manager", operation: "cost_can_spawn", err, userVisible: false });
      return null;
    }
  }, []);

  return { caps, updateCaps, canSpawn };
}
