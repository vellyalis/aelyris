import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  mapBackendAgentFleetSessions,
  mergeAgentFleetSessions,
  type AgentFleetSession,
  type BackendAgentFleetSession,
} from "../lib/agentFleet";
import { reportInvokeFailure } from "../lib/fallbackTelemetry";
import { isTauriRuntime } from "../lib/tauriRuntime";
import { useAgentManager, type StartAgentMeta } from "./useAgentManager";
import { useInteractiveAgent } from "./useInteractiveAgent";

export type { StartAgentMeta };

export function useAgentFleet() {
  const headless = useAgentManager();
  const interactive = useInteractiveAgent();
  const [backendFleetSessions, setBackendFleetSessions] = useState<AgentFleetSession[]>([]);

  const fleetSessions = useMemo(
    () => mergeAgentFleetSessions(headless.sessions, interactive.sessions),
    [headless.sessions, interactive.sessions],
  );

  useEffect(() => {
    if (!isTauriRuntime()) return;
    let cancelled = false;
    let unlisten: UnlistenFn | null = null;

    const apply = (sessions: BackendAgentFleetSession[]) => {
      if (cancelled) return;
      setBackendFleetSessions(mapBackendAgentFleetSessions(sessions));
    };

    void listen<BackendAgentFleetSession[]>("agent-fleet-updated", (event) => {
      apply(event.payload);
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
          source: "agent-fleet",
          operation: "listen:agent-fleet-updated",
          err,
          userVisible: false,
        });
      });

    void invoke<BackendAgentFleetSession[]>("list_agent_fleet")
      .then(apply)
      .catch((err) => {
        reportInvokeFailure({
          source: "agent-fleet",
          operation: "list_agent_fleet",
          err,
          userVisible: false,
        });
      });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  const selectFleetSession = useCallback(
    (id: string) => {
      const session = fleetSessions.find((candidate) => candidate.id === id);
      if (!session) return;
      if (session.runtime === "interactive") {
        interactive.selectSession(id);
      } else {
        headless.setActiveSessionId(id);
      }
    },
    [fleetSessions, headless, interactive],
  );

  return {
    fleetSessions,
    backendFleetSessions,
    selectFleetSession,
    sessions: headless.sessions,
    activeSessionId: headless.activeSessionId,
    setActiveSessionId: headless.setActiveSessionId,
    startAgent: headless.startAgent,
    stopAgent: headless.stopAgent,
    renameSession: headless.renameSession,
    interactiveSessions: interactive.sessions,
    activeInteractiveSession: interactive.activeSession,
    interactiveSessionId: interactive.activeSessionId,
    selectInteractiveSession: interactive.selectSession,
    startInteractiveSession: interactive.startSession,
    stopInteractiveSession: interactive.stopSession,
    endSessionAndRemoveWorktree: interactive.endSessionAndRemoveWorktree,
  };
}
