import { useEffect, useRef, useState } from "react";

import type { LogEntry } from "../types/logs";

/**
 * Adapter so tests can inject a fake invoke-style callable without
 * pulling in the real Tauri bridge. Production passes through to
 * `@tauri-apps/api/core`.
 */
export type Invoke = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

const defaultInvoke: Invoke = async (cmd, args) => {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke(cmd, args) as Promise<never>;
};

/**
 * Maximum entries kept on the client. Matches the Rust ring's cap so
 * the displayed window is the same regardless of which side dropped
 * the oldest events.
 */
export const CLIENT_RING_LIMIT = 1024;

export interface UseLogStreamOptions {
  /** Hydrate this many entries on first load. Defaults to 200. */
  initialLimit?: number;
  /** Polling cadence in ms. 1 000 ms is enough for human scanning
   *  while staying well clear of saturating the IPC channel. */
  pollMs?: number;
  /** Inject a fake invoke for testing. */
  invoke?: Invoke;
  /** When false the hook stays idle. Used so the panel polls only
   *  while it is expanded. */
  enabled?: boolean;
}

export interface LogStreamState {
  entries: LogEntry[];
  /** True after the initial hydrate resolves (success or failure). */
  ready: boolean;
  /** Last error from the IPC layer, if any. */
  error: string | null;
}

/**
 * Hydrate + poll the in-app log ring buffer.
 *
 * The hook keeps a bounded list of entries in component state and
 * fetches new ones via `logs_since(after_seq)` once a poll cadence,
 * stitching the result onto the local list. The bound is enforced
 * locally so a stale tab that has been idle for hours does not grow
 * the array beyond what the renderer can virtualise.
 */
export function useLogStream(options: UseLogStreamOptions = {}): LogStreamState {
  const {
    initialLimit = 200,
    pollMs = 1_000,
    invoke = defaultInvoke,
    enabled = true,
  } = options;

  const [state, setState] = useState<LogStreamState>({
    entries: [],
    ready: false,
    error: null,
  });
  const cursorRef = useRef<number>(0);
  const enabledRef = useRef<boolean>(enabled);
  enabledRef.current = enabled;

  useEffect(() => {
    if (!enabled) {
      // Reset cursor so re-enabling re-hydrates a fresh window
      // rather than appending to whatever the local list happened to
      // hold.
      cursorRef.current = 0;
      setState({ entries: [], ready: false, error: null });
      return;
    }

    let cancelled = false;

    const append = (incoming: LogEntry[]) => {
      if (!incoming.length) return;
      const lastSeq = incoming[incoming.length - 1]!.seq;
      cursorRef.current = Math.max(cursorRef.current, lastSeq);
      setState((prev) => {
        const merged = [...prev.entries, ...incoming];
        const trimmed = merged.length > CLIENT_RING_LIMIT
          ? merged.slice(merged.length - CLIENT_RING_LIMIT)
          : merged;
        return { entries: trimmed, ready: true, error: null };
      });
    };

    const hydrate = async () => {
      try {
        const recent = await invoke<LogEntry[]>("logs_recent", { limit: initialLimit });
        if (cancelled) return;
        if (recent.length > 0) {
          cursorRef.current = recent[recent.length - 1]!.seq;
        }
        setState({ entries: recent, ready: true, error: null });
      } catch (e) {
        if (cancelled) return;
        setState((prev) => ({
          ...prev,
          ready: true,
          error: e instanceof Error ? e.message : String(e),
        }));
      }
    };

    const tick = async () => {
      try {
        const delta = await invoke<LogEntry[]>("logs_since", {
          afterSeq: cursorRef.current,
        });
        if (cancelled) return;
        append(delta);
      } catch (e) {
        if (cancelled) return;
        setState((prev) => ({
          ...prev,
          error: e instanceof Error ? e.message : String(e),
        }));
      }
    };

    hydrate();
    const handle = setInterval(() => {
      if (!enabledRef.current) return;
      void tick();
    }, pollMs);
    return () => {
      cancelled = true;
      clearInterval(handle);
    };
  }, [enabled, initialLimit, pollMs, invoke]);

  return state;
}
