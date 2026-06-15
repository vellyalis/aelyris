import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useCallback, useEffect, useRef, useState } from "react";
import { reportInvokeFailure } from "../lib/fallbackTelemetry";
import { isTauriRuntime } from "../lib/tauriRuntime";
import { toast } from "../store/toastStore";
import type { InteractiveSession, SpawnResult } from "../types/interactiveAgent";

/**
 * Manages interactive agent sessions (PTY-based, works with any AI CLI).
 * Sessions are spawned in the Rust backend and rendered in the native TerminalCanvas.
 */
export function useInteractiveAgent() {
  const [sessions, setSessions] = useState<InteractiveSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const activeSessionIdRef = useRef(activeSessionId);
  activeSessionIdRef.current = activeSessionId;

  // Listen for session state updates from Rust backend
  useEffect(() => {
    if (!isTauriRuntime()) return;

    let unlisten: UnlistenFn | null = null;
    let cancelled = false;
    let receivedEventBeforeSeed = false;

    const applySessions = (next: InteractiveSession[]) => {
      setSessions(next);
      setActiveSessionId((current) => (current && next.some((s) => s.id === current) ? current : null));
    };

    (async () => {
      try {
        const unsub = await listen<InteractiveSession[]>("interactive-sessions-updated", (event) => {
          receivedEventBeforeSeed = true;
          applySessions(event.payload);
        });
        if (cancelled) {
          unsub();
          return;
        }
        unlisten = unsub;
      } catch (err) {
        reportInvokeFailure({
          source: "interactive-agent",
          operation: "listen:interactive-sessions-updated",
          err,
          userVisible: false,
        });
      }

      try {
        const initial = await invoke<InteractiveSession[]>("list_interactive_agents");
        if (cancelled) return;
        if (!receivedEventBeforeSeed) {
          applySessions(initial);
        }
      } catch (err) {
        reportInvokeFailure({
          source: "interactive-agent",
          operation: "list_interactive_agents",
          err,
          userVisible: false,
        });
      }
    })();

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  /** Start a new interactive agent session */
  const startSession = useCallback(
    async (opts: {
      cwd: string;
      model?: string;
      initialPrompt?: string;
      branchName?: string;
      cols?: number;
      rows?: number;
    }): Promise<SpawnResult | null> => {
      try {
        const result = await invoke<SpawnResult>("spawn_interactive_agent", {
          cwd: opts.cwd,
          model: opts.model ?? null,
          initialPrompt: opts.initialPrompt ?? null,
          branchName: opts.branchName ?? null,
          cols: opts.cols ?? 120,
          rows: opts.rows ?? 30,
        });
        setActiveSessionId(result.session_id);
        return result;
      } catch (e) {
        toast.error("Failed to start agent session", e instanceof Error ? e.message : String(e));
        return null;
      }
    },
    [],
  );

  /** Stop an interactive agent session (keeps worktree) */
  const stopSession = useCallback(async (id: string) => {
    try {
      await invoke("stop_interactive_agent", { id });
      if (activeSessionIdRef.current === id) {
        setActiveSessionId(null);
      }
    } catch (e) {
      toast.error("Failed to stop agent session", e instanceof Error ? e.message : String(e));
    }
  }, []);

  /** End session AND remove its worktree */
  const endSessionAndRemoveWorktree = useCallback(async (id: string) => {
    try {
      await invoke("end_session_and_remove_worktree", { id });
      if (activeSessionIdRef.current === id) {
        setActiveSessionId(null);
      }
    } catch (e) {
      toast.error("Failed to end agent session", e instanceof Error ? e.message : String(e));
    }
  }, []);

  /** Select an active session */
  const selectSession = useCallback((id: string) => {
    setActiveSessionId(id);
  }, []);

  const activeSession = sessions.find((s) => s.id === activeSessionId) ?? null;

  return {
    sessions,
    activeSession,
    activeSessionId,
    selectSession,
    startSession,
    stopSession,
    endSessionAndRemoveWorktree,
  };
}
