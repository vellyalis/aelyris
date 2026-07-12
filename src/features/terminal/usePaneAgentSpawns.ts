import { listen as tauriListen, type UnlistenFn } from "@tauri-apps/api/event";
import { useCallback, useEffect, useRef, useState } from "react";

import { isTauriRuntime } from "../../shared/lib/tauriRuntime";
import type { PaneAgentSpawnRequest } from "./pane-tree/PaneTreeContainer";

type PaneAgent = PaneAgentSpawnRequest["agents"][number];
type PaneAgentSpawnBatch = PaneAgentSpawnRequest & { tabId: string };

interface AgentSpawnedEvent {
  kind?: string;
  payload?: {
    terminalId?: unknown;
    model?: unknown;
    taskId?: unknown;
    roleId?: unknown;
    backend?: unknown;
    durability?: unknown;
    branchName?: unknown;
  };
}

export function usePaneAgentSpawns(activeTabId: string) {
  const [paneAgentSpawns, setPaneAgentSpawns] = useState<PaneAgentSpawnBatch | null>(null);
  const activeTabIdRef = useRef(activeTabId);
  const sequenceRef = useRef(0);
  activeTabIdRef.current = activeTabId;

  const mountAgentPtyInPane = useCallback((agents: PaneAgent | PaneAgent[], tabId = activeTabIdRef.current) => {
    const incoming = Array.isArray(agents) ? agents : [agents];
    if (incoming.length === 0) return;
    sequenceRef.current += 1;
    const sequence = sequenceRef.current;
    setPaneAgentSpawns((previous) => {
      const existing = previous?.tabId === tabId ? previous.agents : [];
      const merged = [...existing];
      for (const agent of incoming) {
        if (!merged.some((mounted) => mounted.terminalId === agent.terminalId)) merged.push(agent);
      }
      return merged.length === existing.length ? previous : { tabId, agents: merged, sequence };
    });
  }, []);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    let unlisten: UnlistenFn | null = null;
    let cancelled = false;
    void tauriListen<AgentSpawnedEvent>("agent-event", (event) => {
      if (cancelled || event.payload?.kind !== "agent_spawned") return;
      const payload = event.payload.payload;
      if (typeof payload?.terminalId !== "string") return;
      const backend = payload.backend === "sidecar" || payload.backend === "native" ? payload.backend : "native";
      const agent: PaneAgent = {
        terminalId: payload.terminalId,
        model: typeof payload.model === "string" ? payload.model : "sonnet",
        backend,
        durability:
          payload.durability === "tmux-durable" || payload.durability === "degraded"
            ? payload.durability
            : backend === "sidecar"
              ? "tmux-durable"
              : "degraded",
        spawnedAt: new Date().toISOString(),
        ...(typeof payload.taskId === "string" ? { taskId: payload.taskId } : {}),
        ...(typeof payload.roleId === "string" ? { roleId: payload.roleId } : {}),
        ...(typeof payload.branchName === "string" ? { branchName: payload.branchName } : {}),
      };
      mountAgentPtyInPane(agent);
    })
      .then((listener) => {
        if (cancelled) listener();
        else unlisten = listener;
      })
      .catch(() => {
        /* backend unreachable in browser/tests; fleet panes remain best-effort */
      });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [mountAgentPtyInPane]);

  return { mountAgentPtyInPane, paneAgentSpawns };
}
