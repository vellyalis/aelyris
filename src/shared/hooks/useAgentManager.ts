import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useCallback, useEffect, useRef, useState } from "react";
import { parseFileChangeEvent } from "../lib/agentFileChanges";
import {
  createAgentTelemetryRecoverySession,
  loadAgentTelemetrySnapshot,
  parseAgentTelemetrySnapshotResult,
  saveAgentTelemetrySnapshot,
  serializeAgentTelemetrySnapshot,
} from "../lib/agentTelemetryPersistence";
import type { OrchestraRoleId } from "../lib/orchestrator";
import type { WorkforceGuardrailProfile } from "../lib/rightRailWorkforce";
import { isTauriRuntime } from "../lib/tauriRuntime";
import { parseWatchdogDecision, watchdogDecisionToLog } from "../lib/watchdogDecision";
import type { AgentLog, AgentSession, AgentStatus } from "../types/agent";

interface AgentSessionRaw {
  id: string;
  status: string;
  model: string;
  prompt: string;
  cwd: string;
  workspace_scope?: string;
  cost: number;
  tokens_used: number;
}

interface AgentTelemetrySnapshotRaw {
  id: number;
  snapshot_json: string;
  source: string;
  saved_at: string;
}

export interface StartAgentMeta {
  role?: OrchestraRoleId;
  handoffFrom?: string;
  guardrailProfile?: WorkforceGuardrailProfile;
  allowedTools?: string[];
}

const LIVE_AGENT_STATUSES = new Set<AgentStatus>(["idle", "thinking", "coding", "waiting", "generating"]);
const MAX_LIVE_LOGS_PER_SESSION = 240;
const MAX_LIVE_FILE_DETAILS_PER_SESSION = 320;
const TELEMETRY_SAVE_DEBOUNCE_MS = 750;

function appendBoundedLog(logs: AgentLog[], log: AgentLog): AgentLog[] {
  return [...logs, log].slice(-MAX_LIVE_LOGS_PER_SESSION);
}

function appendBoundedFileDetail(
  details: NonNullable<AgentSession["changedFileDetails"]>,
  detail: NonNullable<AgentSession["changedFileDetails"]>[number],
): NonNullable<AgentSession["changedFileDetails"]> {
  return [...details, detail].slice(-MAX_LIVE_FILE_DETAILS_PER_SESSION);
}

function sessionNameFromCwd(cwd: string): string {
  return cwd.split(/[\\/]/).filter(Boolean).pop() ?? "Agent";
}

function mergeAgentSessions(
  prev: AgentSession[],
  raw: AgentSessionRaw[],
  roleMeta: Map<string, { role?: OrchestraRoleId; handoffFrom?: string }>,
): AgentSession[] {
  const existingById = new Map(prev.map((s) => [s.id, s]));
  const liveIds = new Set(raw.map((r) => r.id));
  const liveSessions = raw.map((r) => {
    const existing = existingById.get(r.id);
    const meta = roleMeta.get(r.id);
    return {
      id: r.id,
      name: existing?.name ?? sessionNameFromCwd(r.cwd),
      status: r.status as AgentStatus,
      model: r.model,
      prompt: r.prompt,
      startedAt: existing?.startedAt ?? Date.now(),
      logs: existing?.logs ?? [],
      cost: r.cost,
      tokensUsed: r.tokens_used,
      role: existing?.role ?? meta?.role,
      handoffFrom: existing?.handoffFrom ?? meta?.handoffFrom,
      owner: existing?.owner,
      workspaceScope: r.workspace_scope ?? existing?.workspaceScope ?? r.cwd,
      filesChanged: existing?.filesChanged,
      changedFileDetails: existing?.changedFileDetails,
      writeSet: existing?.writeSet,
      finalReport: existing?.finalReport,
      closeState: existing?.closeState ?? (r.status === "done" ? "collectable" : "active"),
      blockedReason: existing?.blockedReason,
      nextActor: existing?.nextActor,
    };
  });
  const retainedTelemetry = prev
    .filter((session) => !liveIds.has(session.id))
    .map((session) => ({
      ...session,
      status: LIVE_AGENT_STATUSES.has(session.status) ? ("done" as AgentStatus) : session.status,
      closeState:
        session.closeState ??
        (LIVE_AGENT_STATUSES.has(session.status)
          ? "collectable"
          : session.status === "done"
            ? "collectable"
            : "active"),
    }));
  return [...liveSessions, ...retainedTelemetry];
}

function mergeRestoredTelemetry(prev: AgentSession[], restored: AgentSession[]): AgentSession[] {
  const mergedById = new Map(restored.map((session) => [session.id, session]));
  for (const existing of prev) {
    const durable = mergedById.get(existing.id);
    mergedById.set(existing.id, {
      ...durable,
      ...existing,
      logs: existing.logs.length > 0 ? existing.logs : (durable?.logs ?? []),
      role: existing.role ?? durable?.role,
      handoffFrom: existing.handoffFrom ?? durable?.handoffFrom,
      filesChanged: existing.filesChanged ?? durable?.filesChanged,
      changedFileDetails: existing.changedFileDetails ?? durable?.changedFileDetails,
      owner: existing.owner ?? durable?.owner,
      workspaceScope: existing.workspaceScope ?? durable?.workspaceScope,
      writeSet: existing.writeSet ?? durable?.writeSet,
      finalReport: existing.finalReport ?? durable?.finalReport,
      closeState: existing.closeState ?? durable?.closeState,
      blockedReason: existing.blockedReason ?? durable?.blockedReason,
      nextActor: existing.nextActor ?? durable?.nextActor,
      watchdog: existing.watchdog ?? durable?.watchdog,
      permissionMode: existing.permissionMode ?? durable?.permissionMode,
      detectedPort: existing.detectedPort ?? durable?.detectedPort,
    });
  }
  return [...mergedById.values()].sort((a, b) => b.startedAt - a.startedAt);
}

function completeRestoredLiveTelemetry(sessions: AgentSession[]): AgentSession[] {
  return sessions.map((session) => {
    if (!LIVE_AGENT_STATUSES.has(session.status)) return session;
    return {
      ...session,
      status: "done",
      closeState: session.closeState ?? "collectable",
    };
  });
}

export function useAgentManager() {
  const [sessions, setSessions] = useState<AgentSession[]>(() => {
    if (typeof window === "undefined") return [];
    return completeRestoredLiveTelemetry(loadAgentTelemetrySnapshot());
  });
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const unlistenRefs = useRef<Map<string, UnlistenFn[]>>(new Map());
  const pendingSubscriptionIds = useRef<Set<string>>(new Set());
  // Role / handoff metadata is frontend-only (the backend doesn't track it)
  // so we stash it keyed by session id and apply it on every merge pass.
  const roleMetaRef = useRef<Map<string, { role?: OrchestraRoleId; handoffFrom?: string }>>(new Map());

  useEffect(() => {
    if (typeof window === "undefined") return;
    const timer = window.setTimeout(() => {
      saveAgentTelemetrySnapshot(sessions);
      if (!isTauriRuntime() || sessions.length === 0) return;
      const snapshotJson = serializeAgentTelemetrySnapshot(sessions);
      void invoke("save_agent_telemetry_snapshot", { snapshotJson }).catch(() => {
        /* best-effort backend durability */
      });
    }, TELEMETRY_SAVE_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [sessions]);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    let cancelled = false;

    void invoke<AgentTelemetrySnapshotRaw[]>("list_agent_telemetry_snapshots", { limit: 1 })
      .then((snapshots) => {
        if (cancelled || !Array.isArray(snapshots) || snapshots.length === 0) return;
        const restoredResult = parseAgentTelemetrySnapshotResult(snapshots[0]?.snapshot_json ?? null);
        const restored = restoredResult.error
          ? [createAgentTelemetryRecoverySession(restoredResult.error, "backend")]
          : restoredResult.sessions;
        if (restored.length === 0) return;
        setSessions((prev) => mergeRestoredTelemetry(prev, restored));
      })
      .catch(() => {
        /* no backend telemetry yet */
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // Push-based session updates from Rust via Tauri events
  useEffect(() => {
    if (!isTauriRuntime()) return;

    let unlisten: UnlistenFn | null = null;
    let cancelled = false;
    let receivedPushUpdate = false;

    const setup = async () => {
      const unsub = await listen<AgentSessionRaw[]>("agent-sessions-updated", (event) => {
        receivedPushUpdate = true;
        const raw = event.payload;
        setSessions((prev) => {
          // Backend rows are authoritative for live status/cost/tokens, but
          // frontend telemetry is the only source for lineage, logs, and file
          // details. Keep missing rows as historical telemetry and mark stale
          // live-looking snapshots complete instead of deleting them.
          return mergeAgentSessions(prev, raw, roleMetaRef.current);
        });
      });
      if (cancelled) {
        unsub();
        return;
      }
      unlisten = unsub;

      // Initial fetch to hydrate existing sessions on mount. If the
      // listener fires before this resolves and adds entries with
      // accumulated file-change tracking, this fetch must not clobber
      // them — carry through the same frontend-only fields as the
      // listener merge does.
      try {
        const raw = await invoke<AgentSessionRaw[]>("list_agents");
        if (!cancelled && !receivedPushUpdate) {
          setSessions((prev) => mergeAgentSessions(prev, raw, roleMetaRef.current));
        }
      } catch {
        /* no agents running */
      }
    };

    setup();
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  // Subscribe to output events for a session
  const subscribeToSession = useCallback(async (id: string) => {
    if (unlistenRefs.current.has(id) || pendingSubscriptionIds.current.has(id)) return;
    pendingSubscriptionIds.current.add(id);
    const unlistens: UnlistenFn[] = [];

    try {
      const unlisten1 = await listen<string>(`agent-output-${id}`, (event) => {
        const line = event.payload;
        let logType: AgentLog["type"] = "text";
        let content = line;

        try {
          const parsed = JSON.parse(line);
          if (parsed.type === "assistant") {
            logType = "text";
            content = parsed.message?.content?.[0]?.text ?? line;
          } else if (
            parsed.type === "tool_use" ||
            parsed.message?.content?.some?.((c: { type: string }) => c.type === "tool_use")
          ) {
            logType = "tool_use";
            const toolUse = parsed.message?.content?.find?.((c: { type: string }) => c.type === "tool_use");
            content = toolUse ? `${toolUse.name}(${JSON.stringify(toolUse.input).slice(0, 100)})` : line;
          } else if (parsed.type === "tool_result") {
            logType = "tool_result";
            content = parsed.content?.slice?.(0, 200) ?? line;
          } else if (parsed.type === "result") {
            logType = "system";
            content = `Session complete. Cost: $${parsed.cost_usd ?? 0}`;
          }
        } catch {
          // Not JSON, raw text
          content = line.slice(0, 300);
        }

        // Track file changes with detail
        const fileChangeEvent = parseFileChangeEvent(line);
        if (fileChangeEvent.kind === "parser_error") {
          logType = "error";
          content = `Malformed agent structured output: ${fileChangeEvent.error.error}`;
        }

        const log: AgentLog = { timestamp: Date.now(), type: logType, content };

        setSessions((prev) =>
          prev.map((s) => {
            if (s.id !== id) return s;
            const updated = { ...s, logs: appendBoundedLog(s.logs, log) };
            if (fileChangeEvent.kind === "change") {
              const fileChange = fileChangeEvent.change;
              updated.filesChanged = (s.filesChanged ?? 0) + 1;
              updated.changedFileDetails = appendBoundedFileDetail(s.changedFileDetails ?? [], {
                path: fileChange.path,
                action: fileChange.action,
                toolName: fileChange.toolName,
                timestamp: fileChange.timestamp,
              });
            }
            return updated;
          }),
        );
      });
      unlistens.push(unlisten1);

      const unlisten2 = await listen(`agent-exit-${id}`, () => {
        setSessions((prev) =>
          prev.map((s) => (s.id === id ? { ...s, status: "done" as AgentStatus, closeState: "collectable" } : s)),
        );
      });
      unlistens.push(unlisten2);

      const unlisten3 = await listen<string>(`watchdog-decision-${id}`, (event) => {
        const decision = parseWatchdogDecision(event.payload);
        if (!decision) return;
        const log = watchdogDecisionToLog(decision);
        const status: AgentStatus =
          decision.decision === "approved" ? "coding" : decision.decision === "denied" ? "error" : "waiting";
        setSessions((prev) =>
          prev.map((s) =>
            s.id === id
              ? {
                  ...s,
                  status,
                  watchdog: decision.decision,
                  logs: appendBoundedLog(s.logs, log),
                }
              : s,
          ),
        );
      });
      unlistens.push(unlisten3);

      unlistenRefs.current.set(id, unlistens);
    } catch {
      // Cleanup any partially registered listeners
      unlistens.forEach((fn) => {
        fn();
      });
    } finally {
      pendingSubscriptionIds.current.delete(id);
    }
  }, []);

  useEffect(() => {
    if (!isTauriRuntime()) return;

    const liveSessionIds = new Set(
      sessions.filter((session) => LIVE_AGENT_STATUSES.has(session.status)).map((s) => s.id),
    );

    liveSessionIds.forEach((id) => {
      void subscribeToSession(id);
    });

    unlistenRefs.current.forEach((unlistens, id) => {
      if (liveSessionIds.has(id)) return;
      unlistens.forEach((fn) => {
        fn();
      });
      unlistenRefs.current.delete(id);
    });
  }, [sessions, subscribeToSession]);

  const startAgent = useCallback(
    async (prompt: string, cwd: string, model?: string, meta?: StartAgentMeta) => {
      try {
        const allowedTools = meta?.allowedTools && meta.allowedTools.length > 0 ? meta.allowedTools : null;
        const id = await invoke<string>("start_agent", {
          prompt,
          cwd,
          model: model ?? null,
          allowedTools,
          guardrailProfile: meta?.guardrailProfile ?? null,
        });
        if (meta && (meta.role || meta.handoffFrom)) {
          roleMetaRef.current.set(id, meta);
        }
        setActiveSessionId(id);
        await subscribeToSession(id);
        // Add initial log entry and stamp metadata so the UI paints the
        // role badge as soon as the card renders (before the first
        // agent-sessions-updated merge arrives).
        setSessions((prev) =>
          prev.map((s) =>
            s.id === id
              ? {
                  ...s,
                  logs: [
                    {
                      timestamp: Date.now(),
                      type: "system" as const,
                      content: `Starting agent: ${prompt.slice(0, 100)}`,
                    },
                  ],
                  role: meta?.role ?? s.role,
                  handoffFrom: meta?.handoffFrom ?? s.handoffFrom,
                }
              : s,
          ),
        );
        return id;
      } catch (err) {
        // Create a failed session entry for UI feedback
        const errorId = `error-${Date.now()}`;
        const errorSession: AgentSession = {
          id: errorId,
          name: "Failed",
          status: "error",
          model: model ?? "sonnet",
          prompt,
          startedAt: Date.now(),
          logs: [
            {
              timestamp: Date.now(),
              type: "error",
              content: `Failed to start: ${String(err)}. Is 'claude' CLI installed?`,
            },
          ],
          cost: 0,
          tokensUsed: 0,
          role: meta?.role,
          handoffFrom: meta?.handoffFrom,
        };
        setSessions((prev) => [...prev, errorSession]);
        setActiveSessionId(errorId);
        return errorId;
      }
    },
    [subscribeToSession],
  );

  const stopAgent = useCallback(async (id: string) => {
    try {
      await invoke("stop_agent", { id });
    } catch {
      /* ignore */
    }
    // Cleanup listeners regardless of invoke result
    const unlistens = unlistenRefs.current.get(id);
    unlistens?.forEach((fn) => {
      fn();
    });
    unlistenRefs.current.delete(id);
    pendingSubscriptionIds.current.delete(id);
    roleMetaRef.current.delete(id);
    // Mark session as done immediately (don't wait for event)
    setSessions((prev) =>
      prev.map((s) => (s.id === id ? { ...s, status: "done" as AgentStatus, closeState: "collectable" } : s)),
    );
    // Reset active session if this was the active one
    setActiveSessionId((prev) => (prev === id ? null : prev));
  }, []);

  // Cleanup all listeners on unmount
  useEffect(() => {
    return () => {
      unlistenRefs.current.forEach((fns) => {
        fns.forEach((fn) => {
          fn();
        });
      });
      unlistenRefs.current.clear();
    };
  }, []);

  const renameSession = useCallback((id: string, newName: string) => {
    setSessions((prev) => prev.map((s) => (s.id === id ? { ...s, name: newName } : s)));
  }, []);

  return {
    sessions,
    activeSessionId,
    setActiveSessionId,
    startAgent,
    stopAgent,
    renameSession,
  };
}
