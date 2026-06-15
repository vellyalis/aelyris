import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useCallback, useEffect, useState } from "react";
import { reportInvokeFailure } from "../lib/fallbackTelemetry";
import { isTauriRuntime } from "../lib/tauriRuntime";
import type { AgentEvent, AgentEventKind, EventChannel } from "../types/eventBus";

const MAX_FEED = 256;

/**
 * Consumes the fleet Event Bus (BR5): hydrates the recent feed via
 * `event_recent`, appends live events from the `agent-event` stream, and
 * exposes `publish`. Mirrors the bounded backend log on the frontend.
 */
export function useEventBus() {
  const [events, setEvents] = useState<AgentEvent[]>([]);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    let cancelled = false;
    let unlisten: UnlistenFn | null = null;

    void listen<AgentEvent>("agent-event", (event) => {
      if (cancelled) return;
      setEvents((prev) => [...prev, event.payload].slice(-MAX_FEED));
    })
      .then((unsubscribe) => {
        if (cancelled) {
          unsubscribe();
          return;
        }
        unlisten = unsubscribe;
      })
      .catch((err) => {
        reportInvokeFailure({ source: "event-bus", operation: "listen:agent-event", err, userVisible: false });
      });

    void invoke<AgentEvent[]>("event_recent")
      .then((recent) => {
        if (!cancelled) setEvents(recent);
      })
      .catch((err) => {
        reportInvokeFailure({ source: "event-bus", operation: "event_recent", err, userVisible: false });
      });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  const publish = useCallback(
    async (kind: AgentEventKind, payload: unknown, channel?: EventChannel): Promise<AgentEvent | null> => {
      try {
        return await invoke<AgentEvent>("event_publish", { kind, channel: channel ?? null, payload });
      } catch (err) {
        reportInvokeFailure({ source: "event-bus", operation: "event_publish", err, userVisible: false });
        return null;
      }
    },
    [],
  );

  return { events, publish };
}
