import { useEffect, useRef, useState } from "react";

import type { ImageMetrics } from "../types/terminal";

/**
 * Adapter so tests can inject a fake invoke without pulling in the real
 * Tauri bridge. Production passes through to `@tauri-apps/api/core`.
 */
export type Invoke = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

const defaultInvoke: Invoke = async (cmd, args) => {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke(cmd, args) as Promise<never>;
};

/**
 * 1 Hz default. The cap-eviction surface is a slowly-evolving budget,
 * not an animation-rate signal, so polling once a second keeps the IPC
 * cost negligible while still surfacing eviction within a frame for the
 * Sprint 3 wave 3 status-bar widget.
 */
export const DEFAULT_POLL_INTERVAL_MS = 1_000;

export interface UseImageMetricsOptions {
  invoke?: Invoke;
  /** Poll interval in milliseconds. Tests inject a small value. */
  pollIntervalMs?: number;
}

/**
 * Poll `term_image_metrics(id)` for the active terminal so the status
 * bar can render a "12.3 / 50 MiB · 3 imgs" badge with warning / danger
 * tints as the per-pane FIFO cap fills up.
 *
 * Returns `null` while:
 *   - `terminalId` is `null` (no active pane / shell still spawning),
 *   - the IPC reports `null` (terminal id unknown to the engine), OR
 *   - the IPC throws (transient — the next tick retries silently).
 *
 * The widget treats `null` as "hide the badge" — the same graceful
 * degradation as the snapshot's image-paint pass on a missing
 * `term_image_data`.
 *
 * Polling pauses while the document is hidden (tab in background) to
 * avoid waking the engine for an invisible UI; the next visibility
 * change immediately re-fetches so a returning user sees fresh state
 * without waiting a full interval.
 */
export function useImageMetrics(
  terminalId: string | null,
  options: UseImageMetricsOptions = {},
): ImageMetrics | null {
  const { invoke = defaultInvoke, pollIntervalMs = DEFAULT_POLL_INTERVAL_MS } = options;
  const [metrics, setMetrics] = useState<ImageMetrics | null>(null);
  // Keep a ref to the latest invoke so the polling loop's closure can
  // pick up replacements without re-running the whole effect — the
  // production invoke is a stable module import but tests rotate it.
  const invokeRef = useRef(invoke);
  invokeRef.current = invoke;

  useEffect(() => {
    if (!terminalId) {
      setMetrics(null);
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const fetchOnce = async () => {
      try {
        const result = await invokeRef.current<ImageMetrics | null>("term_image_metrics", {
          id: terminalId,
        });
        if (cancelled) return;
        setMetrics(result ?? null);
      } catch {
        if (!cancelled) setMetrics(null);
      }
    };

    const tick = async () => {
      await fetchOnce();
      if (cancelled) return;
      // Skip the next round-trip while the tab is hidden; the
      // visibility listener below will re-prime the loop on focus.
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        return;
      }
      timer = setTimeout(tick, pollIntervalMs);
    };

    void tick();

    const onVisibility = () => {
      if (cancelled) return;
      if (typeof document !== "undefined" && document.visibilityState === "visible") {
        if (timer !== null) {
          clearTimeout(timer);
          timer = null;
        }
        void tick();
      }
    };

    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVisibility);
    }

    return () => {
      cancelled = true;
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisibility);
      }
    };
  }, [terminalId, pollIntervalMs]);

  return metrics;
}
