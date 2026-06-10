import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";

import type { HistoryMatch } from "../../features/terminal/search";

/**
 * Adapter so tests can inject a fake invoke-style callable without
 * pulling in the real Tauri bridge. Production passes through to
 * `@tauri-apps/api/core`.
 */
export type Invoke = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

const defaultInvoke: Invoke = async (cmd, args) => {
  const { invoke } = await Promise.resolve({ invoke: tauriInvoke });
  return invoke(cmd, args) as Promise<never>;
};

export interface UseHistorySearchOptions {
  caseSensitive?: boolean;
  /** Debounce window in ms before re-issuing a search on query change.
   *  Keeps the IPC channel quiet while the user is still typing. */
  debounceMs?: number;
  /** Inject a fake invoke for testing. */
  invoke?: Invoke;
}

interface RawHistoryMatch {
  historyIndex: number;
  startCol: number;
  endCol: number;
}

/**
 * Search the terminal's retained scrollback for `query` via the Rust
 * `term_search_history` IPC. The hook returns the latest result list,
 * an empty array while pending, and a stable identity when the inputs
 * have not changed.
 *
 * Pairing this with `findMatches(snapshot, query)` yields a single
 * navigable list across both the live grid and history — see
 * `combineMatches` in `features/terminal/search`.
 */
export function useHistorySearch(
  terminalId: string | null,
  query: string,
  options: UseHistorySearchOptions = {},
): HistoryMatch[] {
  const { caseSensitive = false, debounceMs = 120, invoke = defaultInvoke } = options;
  const [matches, setMatches] = useState<HistoryMatch[]>([]);

  useEffect(() => {
    if (!terminalId || !query) {
      setMatches([]);
      return;
    }

    let cancelled = false;
    const runSearch = () => {
      void invoke<RawHistoryMatch[]>("term_search_history", {
        id: terminalId,
        query,
        caseSensitive,
      })
        .then((raw) => {
          if (cancelled) return;
          // Tag with the discriminator so downstream code can route.
          setMatches(
            raw.map((m) => ({
              kind: "history" as const,
              historyIndex: m.historyIndex,
              startCol: m.startCol,
              endCol: m.endCol,
            })),
          );
        })
        .catch(() => {
          if (cancelled) return;
          // Backend unavailable (jsdom unit tests) — treat as no matches.
          setMatches([]);
        });
    };

    const handle = debounceMs <= 0 ? null : window.setTimeout(runSearch, debounceMs);
    if (handle === null) {
      runSearch();
    }

    return () => {
      cancelled = true;
      if (handle !== null) {
        window.clearTimeout(handle);
      }
    };
  }, [terminalId, query, caseSensitive, debounceMs, invoke]);

  return matches;
}
