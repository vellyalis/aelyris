import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useCallback, useEffect, useState } from "react";
import { reportInvokeFailure } from "../lib/fallbackTelemetry";
import { isTauriRuntime } from "../lib/tauriRuntime";
import type { DecisionChange } from "../types/contextStore";

/**
 * Consumes the shared Context Store (BR6): the project ADR every agent aligns
 * to. Hydrates via `context_all`, stays in sync via `context-store-updated`,
 * and exposes set/remove that broadcast `DECISION_CHANGED` backend-side.
 */
export function useContextStore() {
  const [decisions, setDecisions] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!isTauriRuntime()) return;
    let cancelled = false;
    let unlisten: UnlistenFn | null = null;

    void listen<Record<string, string>>("context-store-updated", (event) => {
      if (!cancelled) setDecisions(event.payload);
    })
      .then((unsubscribe) => {
        if (cancelled) {
          unsubscribe();
          return;
        }
        unlisten = unsubscribe;
      })
      .catch((err) => {
        reportInvokeFailure({
          source: "context-store",
          operation: "listen:context-store-updated",
          err,
          userVisible: false,
        });
      });

    void invoke<Record<string, string>>("context_all")
      .then((all) => {
        if (!cancelled) setDecisions(all);
      })
      .catch((err) => {
        reportInvokeFailure({ source: "context-store", operation: "context_all", err, userVisible: false });
      });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  const setDecision = useCallback(async (key: string, value: string): Promise<DecisionChange | null> => {
    try {
      return await invoke<DecisionChange | null>("context_set", { key, value });
    } catch (err) {
      reportInvokeFailure({ source: "context-store", operation: "context_set", err, userVisible: true });
      return null;
    }
  }, []);

  const removeDecision = useCallback(async (key: string): Promise<DecisionChange | null> => {
    try {
      return await invoke<DecisionChange | null>("context_remove", { key });
    } catch (err) {
      reportInvokeFailure({ source: "context-store", operation: "context_remove", err, userVisible: true });
      return null;
    }
  }, []);

  return { decisions, setDecision, removeDecision };
}
