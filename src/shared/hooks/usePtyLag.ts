import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useEffect, useRef, useState } from "react";

/**
 * Subset of the `term:lag-<id>` payload Tauri emits when the broadcast
 * channel feeding the UI hits `RecvError::Lagged(n)`.
 */
export interface LagEventPayload {
  dropped: number;
}

export interface PtyLagState {
  /**
   * Total chunks the broadcast channel dropped within the active
   * window. Reset to zero when the decay timer fires.
   */
  dropped: number;
  /** True iff at least one lag event was observed within the window. */
  active: boolean;
}

const INITIAL: PtyLagState = { dropped: 0, active: false };

/**
 * How long after the last `term:lag-<id>` event the badge stays lit.
 * 5s is intentionally short — backpressure that has stopped is no
 * longer worth flagging, and a longer window would make a single
 * cargo-build burst look like a permanent terminal problem.
 */
export const LAG_DECAY_MS = 5_000;

export type Subscriber = (terminalId: string, onEvent: (payload: LagEventPayload) => void) => Promise<UnlistenFn>;

const defaultSubscribe: Subscriber = (terminalId, onEvent) =>
  listen<LagEventPayload>(`term:lag-${terminalId}`, (ev) => onEvent(ev.payload));

/**
 * Subscribe to broadcast-lag events for a single terminal and decay
 * the indicator after [`LAG_DECAY_MS`] of silence.
 *
 * Counts accumulate across rapid-fire events within the window, so a
 * `cargo build --verbose` flood reports a meaningful "dropped 12,345
 * chunks" number rather than just the last burst. The decay timer
 * resets on every event, so a sustained flood keeps the badge lit.
 *
 * Pass `terminalId === null` (or the test-time `subscribe` override)
 * to keep the hook quiescent — the indicator stays at the initial
 * value and no listener is registered.
 *
 * `decayMs` is injectable so tests can use a small real timeout
 * (~30ms) instead of `vi.useFakeTimers`, which interferes with
 * `@testing-library`'s `waitFor` retries.
 */
export function usePtyLag(
  terminalId: string | null,
  subscribe: Subscriber = defaultSubscribe,
  decayMs: number = LAG_DECAY_MS,
): PtyLagState {
  const [state, setState] = useState<PtyLagState>(INITIAL);
  const decayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!terminalId) {
      setState(INITIAL);
      return;
    }
    setState(INITIAL);
    let cancelled = false;
    let unlisten: UnlistenFn | null = null;
    (async () => {
      try {
        unlisten = await subscribe(terminalId, (payload) => {
          if (decayTimerRef.current !== null) clearTimeout(decayTimerRef.current);
          decayTimerRef.current = setTimeout(() => {
            decayTimerRef.current = null;
            setState(INITIAL);
          }, decayMs);
          setState((prev) => ({
            dropped: prev.dropped + Math.max(0, Math.floor(payload.dropped ?? 0)),
            active: true,
          }));
        });
        if (cancelled) {
          unlisten?.();
          unlisten = null;
        }
      } catch {
        /* listener unavailable in tests */
      }
    })();
    return () => {
      cancelled = true;
      unlisten?.();
      if (decayTimerRef.current !== null) {
        clearTimeout(decayTimerRef.current);
        decayTimerRef.current = null;
      }
    };
  }, [terminalId, subscribe, decayMs]);

  return state;
}
