import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useCallback, useEffect, useRef, useState } from "react";
import { parseFileChange } from "../lib/agentFileChanges";
import type { OrchestraRoleId } from "../lib/orchestrator";
import { isTauriRuntime } from "../lib/tauriRuntime";
import type { AgentLog, AgentSession, AgentStatus } from "../types/agent";

interface AgentSessionRaw {
  id: string;
  status: string;
  model: string;
  prompt: string;
  cwd: string;
  cost: number;
  tokens_used: number;
}

export function useAgentManager() {
  const [sessions, setSessions] = useState<AgentSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const unlistenRefs = useRef<Map<string, UnlistenFn[]>>(new Map());
  // Role / handoff metadata is frontend-only (the backend doesn't track it)
  // so we stash it keyed by session id and apply it on every merge pass.
  const roleMetaRef = useRef<Map<string, { role?: OrchestraRoleId; handoffFrom?: string }>>(new Map());

  // Push-based session updates from Rust via Tauri events
  useEffect(() => {
    if (!isTauriRuntime()) return;

    let unlisten: UnlistenFn | null = null;
    let cancelled = false;

    const setup = async () => {
      const unsub = await listen<AgentSessionRaw[]>("agent-sessions-updated", (event) => {
        const raw = event.payload;
        setSessions((prev) => {
          // Merge: keep existing frontend-only fields, update
          // status/cost/tokens from the backend payload.
          //
          // CRITICAL: the previous version dropped `filesChanged` and
          // `changedFileDetails`. Those are accumulated by the
          // per-session output listener (subscribeToSession) on the
          // frontend — the backend doesn't track them — so every
          // backend status/cost update silently wiped the running
          // tally. Carry them through explicitly the same way `logs`
          // and `name` are carried.
          const map = new Map(prev.map((s) => [s.id, s]));
          return raw.map((r) => {
            const existing = map.get(r.id);
            const meta = roleMetaRef.current.get(r.id);
            return {
              id: r.id,
              name: existing?.name ?? r.cwd.split("/").filter(Boolean).pop() ?? "Agent",
              status: r.status as AgentStatus,
              model: r.model,
              prompt: r.prompt,
              startedAt: existing?.startedAt ?? Date.now(),
              logs: existing?.logs ?? [],
              cost: r.cost,
              tokensUsed: r.tokens_used,
              role: existing?.role ?? meta?.role,
              handoffFrom: existing?.handoffFrom ?? meta?.handoffFrom,
              filesChanged: existing?.filesChanged,
              changedFileDetails: existing?.changedFileDetails,
            };
          });
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
        if (!cancelled && raw.length > 0) {
          setSessions((prev) => {
            const map = new Map(prev.map((s) => [s.id, s]));
            return raw.map((r) => {
              const existing = map.get(r.id);
              const meta = roleMetaRef.current.get(r.id);
              return {
                id: r.id,
                name: existing?.name ?? r.cwd.split("/").filter(Boolean).pop() ?? "Agent",
                status: r.status as AgentStatus,
                model: r.model,
                prompt: r.prompt,
                startedAt: existing?.startedAt ?? Date.now(),
                logs: existing?.logs ?? [],
                cost: r.cost,
                tokensUsed: r.tokens_used,
                role: existing?.role ?? meta?.role,
                handoffFrom: existing?.handoffFrom ?? meta?.handoffFrom,
                filesChanged: existing?.filesChanged,
                changedFileDetails: existing?.changedFileDetails,
              };
            });
          });
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

        const log: AgentLog = { timestamp: Date.now(), type: logType, content };

        // Track file changes with detail
        const fileChange = parseFileChange(line);

        setSessions((prev) =>
          prev.map((s) => {
            if (s.id !== id) return s;
            const updated = { ...s, logs: [...s.logs, log] };
            if (fileChange) {
              updated.filesChanged = (s.filesChanged ?? 0) + 1;
              updated.changedFileDetails = [
                ...(s.changedFileDetails ?? []),
                {
                  path: fileChange.path,
                  action: fileChange.action,
                  toolName: fileChange.toolName,
                  timestamp: fileChange.timestamp,
                },
              ];
            }
            return updated;
          }),
        );
      });
      unlistens.push(unlisten1);

      const unlisten2 = await listen(`agent-exit-${id}`, () => {
        setSessions((prev) => prev.map((s) => (s.id === id ? { ...s, status: "done" as AgentStatus } : s)));
      });
      unlistens.push(unlisten2);

      unlistenRefs.current.set(id, unlistens);
    } catch {
      // Cleanup any partially registered listeners
      unlistens.forEach((fn) => fn());
    }
  }, []);

  const startAgent = useCallback(
    async (prompt: string, cwd: string, model?: string, meta?: { role?: OrchestraRoleId; handoffFrom?: string }) => {
      try {
        const id = await invoke<string>("start_agent", { prompt, cwd, model: model ?? null });
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
    unlistens?.forEach((fn) => fn());
    unlistenRefs.current.delete(id);
    roleMetaRef.current.delete(id);
    // Mark session as done immediately (don't wait for event)
    setSessions((prev) => prev.map((s) => (s.id === id ? { ...s, status: "done" as AgentStatus } : s)));
    // Reset active session if this was the active one
    setActiveSessionId((prev) => (prev === id ? null : prev));
  }, []);

  // Cleanup all listeners on unmount
  useEffect(() => {
    return () => {
      unlistenRefs.current.forEach((fns) => fns.forEach((fn) => fn()));
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
