import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import type { SearchFilters, SearchHit } from "../types/history";

interface UseSemanticHistoryReturn {
  query: string;
  setQuery: (q: string) => void;
  hits: SearchHit[];
  loading: boolean;
  error: string | null;
  /** Force a re-search with the current query + filters. */
  refresh: () => void;
}

/**
 * Debounced semantic search driver. Calls `semantic_search_history` when
 * `query` changes, throttled to at most one in-flight request.
 *
 * Filter equality is by JSON value (not reference) so callers can pass a
 * fresh object each render without triggering an extra round-trip.
 */
export function useSemanticHistory(
  filters: SearchFilters = {},
  limit = 30,
  debounceMs = 120,
): UseSemanticHistoryReturn {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const latestRequestId = useRef(0);
  const filtersRef = useRef<SearchFilters>(filters);
  filtersRef.current = filters;
  const filtersKey = JSON.stringify(filters);

  const runSearch = useCallback(
    async (q: string) => {
      // The request reads filters through a ref to avoid stale closures;
      // the serialized key keeps this callback reactive to value changes.
      void filtersKey;
      const trimmed = q.trim();
      const requestId = ++latestRequestId.current;
      if (!trimmed) {
        setHits([]);
        setLoading(false);
        setError(null);
        return;
      }

      setLoading(true);
      setError(null);
      try {
        const { invoke } = await Promise.resolve({ invoke: tauriInvoke });
        const result = await invoke<SearchHit[]>("semantic_search_history", {
          query: trimmed,
          limit,
          filters: filtersRef.current,
        });
        if (latestRequestId.current !== requestId) return;
        setHits(result);
      } catch (err) {
        if (latestRequestId.current !== requestId) return;
        setError(err instanceof Error ? err.message : String(err));
        setHits([]);
      } finally {
        if (latestRequestId.current === requestId) setLoading(false);
      }
    },
    [limit, filtersKey],
  );

  useEffect(() => {
    const handle = setTimeout(() => {
      void runSearch(query);
    }, debounceMs);
    return () => clearTimeout(handle);
  }, [query, debounceMs, runSearch]);

  const refresh = useCallback(() => {
    void runSearch(query);
  }, [query, runSearch]);

  return { query, setQuery, hits, loading, error, refresh };
}
