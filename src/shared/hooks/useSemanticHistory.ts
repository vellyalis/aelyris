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
        const { invoke } = await import("@tauri-apps/api/core");
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
    [limit],
  );

  useEffect(() => {
    const handle = setTimeout(() => {
      void runSearch(query);
    }, debounceMs);
    return () => clearTimeout(handle);
    // filtersKey is included so a filter mutation re-fires the query.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, debounceMs, filtersKey, runSearch]);

  const refresh = useCallback(() => {
    void runSearch(query);
  }, [query, runSearch]);

  return { query, setQuery, hits, loading, error, refresh };
}
