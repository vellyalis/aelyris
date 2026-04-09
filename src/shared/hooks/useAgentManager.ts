import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { AgentSession, AgentLog, AgentStatus } from "../types/agent";

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

  // Poll for session list
  useEffect(() => {
    const poll = async () => {
      try {
        const raw = await invoke<AgentSessionRaw[]>("list_agents");
        setSessions((prev) => {
          // Merge: keep existing logs, update status/cost/tokens
          const map = new Map(prev.map((s) => [s.id, s]));
          return raw.map((r) => {
            const existing = map.get(r.id);
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
            };
          });
        });
      } catch { /* ignore when no agents */ }
    };

    poll();
    const interval = setInterval(poll, 2000);
    return () => clearInterval(interval);
  }, []);

  // Subscribe to output events for a session
  const subscribeToSession = useCallback(async (id: string) => {
    const unlistens: UnlistenFn[] = [];

    const unlisten1 = await listen<string>(`agent-output-${id}`, (event) => {
      const line = event.payload;
      let logType: AgentLog["type"] = "text";
      let content = line;

      try {
        const parsed = JSON.parse(line);
        if (parsed.type === "assistant") {
          logType = "text";
          content = parsed.message?.content?.[0]?.text ?? line;
        } else if (parsed.type === "tool_use" || parsed.message?.content?.some?.((c: { type: string }) => c.type === "tool_use")) {
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
      setSessions((prev) =>
        prev.map((s) => s.id === id ? { ...s, logs: [...s.logs, log] } : s)
      );
    });
    unlistens.push(unlisten1);

    const unlisten2 = await listen(`agent-exit-${id}`, () => {
      setSessions((prev) =>
        prev.map((s) => s.id === id ? { ...s, status: "done" as AgentStatus } : s)
      );
    });
    unlistens.push(unlisten2);

    unlistenRefs.current.set(id, unlistens);
  }, []);

  const startAgent = useCallback(async (prompt: string, cwd: string, model?: string) => {
    try {
      const id = await invoke<string>("start_agent", { prompt, cwd, model: model ?? null });
      setActiveSessionId(id);
      await subscribeToSession(id);
      return id;
    } catch (err) {
      throw new Error(String(err));
    }
  }, [subscribeToSession]);

  const stopAgent = useCallback(async (id: string) => {
    try {
      await invoke("stop_agent", { id });
      // Cleanup listeners
      const unlistens = unlistenRefs.current.get(id);
      unlistens?.forEach((fn) => fn());
      unlistenRefs.current.delete(id);
    } catch { /* ignore */ }
  }, []);

  // Cleanup all listeners on unmount
  useEffect(() => {
    return () => {
      unlistenRefs.current.forEach((fns) => fns.forEach((fn) => fn()));
      unlistenRefs.current.clear();
    };
  }, []);

  return {
    sessions,
    activeSessionId,
    setActiveSessionId,
    startAgent,
    stopAgent,
  };
}
