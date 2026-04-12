import { useState, useCallback, useEffect, useRef } from "react";
import type { InteractiveSession, SpawnResult } from "../types/interactiveAgent";
import { toast } from "../store/toastStore";

/**
 * Manages interactive agent sessions (PTY-based, works with any AI CLI).
 * Sessions are spawned in the Rust backend and output is streamed to xterm.js terminals.
 */
export function useInteractiveAgent() {
  const [sessions, setSessions] = useState<InteractiveSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const activeSessionIdRef = useRef(activeSessionId);
  activeSessionIdRef.current = activeSessionId;

  // Listen for session state updates from Rust backend
  useEffect(() => {
    let unlisten: (() => void) | null = null;

    const setup = async () => {
      try {
        const { listen } = await import("@tauri-apps/api/event");
        unlisten = await listen<InteractiveSession[]>("interactive-sessions-updated", (event) => {
          setSessions(event.payload);
        });
      } catch { /* not in Tauri */ }
    };
    setup();

    return () => { unlisten?.(); };
  }, []);

  /** Start a new interactive agent session */
  const startSession = useCallback(async (opts: {
    cwd: string;
    model?: string;
    initialPrompt?: string;
    branchName?: string;
    cols?: number;
    rows?: number;
  }): Promise<SpawnResult | null> => {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
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
  }, []);

  /** Stop an interactive agent session (keeps worktree) */
  const stopSession = useCallback(async (id: string) => {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
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
      const { invoke } = await import("@tauri-apps/api/core");
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
