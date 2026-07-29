import { listen as tauriListen, type UnlistenFn } from "@tauri-apps/api/event";
import { useCallback, useEffect, useRef, useState } from "react";

import { isTauriRuntime } from "../../shared/lib/tauriRuntime";
import type { PaneAgentSpawnRequest } from "./pane-tree/PaneTreeContainer";

type PaneAgent = PaneAgentSpawnRequest["agents"][number];

export interface PaneAgentSpawnOwner {
  projectPath?: string;
  tabId: string;
}

interface AgentSpawnedEvent {
  kind?: string;
  payload?: {
    terminalId?: unknown;
    model?: unknown;
    repoPath?: unknown;
    taskId?: unknown;
    roleId?: unknown;
    backend?: unknown;
    durability?: unknown;
    branchName?: unknown;
    tabId?: unknown;
  };
}

function normalizeProjectPath(value: string): string {
  return value.trim().replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

function resolveEventOwnerTabId(
  payload: NonNullable<AgentSpawnedEvent["payload"]>,
  owners: readonly PaneAgentSpawnOwner[],
): string | null {
  if (typeof payload.tabId === "string" && payload.tabId.length > 0) {
    return owners.length === 0 || owners.some((owner) => owner.tabId === payload.tabId) ? payload.tabId : null;
  }
  if (typeof payload.repoPath !== "string" || payload.repoPath.length === 0) return null;
  const repoPath = normalizeProjectPath(payload.repoPath);
  const matches = owners.filter(
    (owner) => typeof owner.projectPath === "string" && normalizeProjectPath(owner.projectPath) === repoPath,
  );
  return matches.length === 1 ? (matches[0]?.tabId ?? null) : null;
}

export function usePaneAgentSpawns(owners: readonly PaneAgentSpawnOwner[]) {
  const [paneAgentSpawnsByTab, setPaneAgentSpawnsByTab] = useState<Record<string, PaneAgentSpawnRequest>>({});
  const ownersRef = useRef(owners);
  const sequenceRef = useRef(0);
  ownersRef.current = owners;

  const mountAgentPtyInPane = useCallback((agents: PaneAgent | PaneAgent[], tabId: string) => {
    const incoming = Array.isArray(agents) ? agents : [agents];
    if (incoming.length === 0) return;
    if (ownersRef.current.length > 0 && !ownersRef.current.some((owner) => owner.tabId === tabId)) return;
    sequenceRef.current += 1;
    const sequence = sequenceRef.current;
    setPaneAgentSpawnsByTab((previous) => {
      const existing = previous[tabId]?.agents ?? [];
      const merged = [...existing];
      for (const agent of incoming) {
        if (!merged.some((mounted) => mounted.terminalId === agent.terminalId)) merged.push(agent);
      }
      return merged.length === existing.length ? previous : { ...previous, [tabId]: { agents: merged, sequence } };
    });
  }, []);

  useEffect(() => {
    if (owners.length === 0) return;
    const liveTabIds = new Set(owners.map((owner) => owner.tabId));
    setPaneAgentSpawnsByTab((previous) => {
      const next = Object.fromEntries(Object.entries(previous).filter(([tabId]) => liveTabIds.has(tabId)));
      return Object.keys(next).length === Object.keys(previous).length ? previous : next;
    });
  }, [owners]);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    let unlisten: UnlistenFn | null = null;
    let cancelled = false;
    void tauriListen<AgentSpawnedEvent>("agent-event", (event) => {
      if (cancelled || event.payload?.kind !== "agent_spawned") return;
      const payload = event.payload.payload;
      if (typeof payload?.terminalId !== "string") return;
      // Event receipt/current/initial tab are all guesses, not ownership. The
      // publisher must carry an explicit tab or an unambiguous repo owner key.
      const ownerTabId = resolveEventOwnerTabId(payload, ownersRef.current);
      if (!ownerTabId) return;
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
      mountAgentPtyInPane(agent, ownerTabId);
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

  return { mountAgentPtyInPane, paneAgentSpawnsByTab };
}
