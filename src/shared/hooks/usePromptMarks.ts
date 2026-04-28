import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useEffect, useState } from "react";

export type PromptMarkKind = "promptStart" | "commandStart" | "outputStart" | "commandEnd";

export interface PromptMark {
  kind: PromptMarkKind;
  screenLine: number;
  exitCode: number | null;
  sequence: number;
  /**
   * `history_size()` at the moment the mark was recorded. Combined with
   * the engine's *current* history size this lets the UI compute how far
   * the mark has scrolled into history since recording — essential for
   * jump-to-prompt navigation (see `useScrollback.scrollToMark`).
   */
  historySize: number;
}

/**
 * Subscribe to OSC 133 prompt marks for a terminal session.
 *
 * Marks are seeded from `term_prompt_marks` on mount (so a freshly-mounted
 * TerminalCanvas inherits the shell's history) and extended in real time
 * by `term:prompt-mark-<id>` events. The hook returns the full chronological
 * list; consumers that only need the most recent mark can read
 * `marks[marks.length - 1]`.
 *
 * When `terminalId` is null (no session yet), returns an empty list and
 * holds no subscription.
 *
 * Listener-arming race contract (mirrors useTerminalSnapshot):
 *
 * 1. Register the `term:prompt-mark-<id>` listener BEFORE invoking
 *    `term_prompt_marks` so any mark emitted while the seed query is in
 *    flight is captured. Without this, a mark arriving between the seed
 *    query and the listen registration is silently dropped — the seed
 *    snapshot does not include it, and there is no listener to receive it.
 * 2. Apply the seed with the `prev`-aware dedup logic below so that
 *    listener-arrival marks that beat the seed reply are not stomped, and
 *    seed marks that already arrived via the listener are not duplicated.
 * 3. Reorder + dedup by monotonic `sequence`: a mark with a sequence
 *    already present is dropped; a mark with a sequence smaller than the
 *    current tail is *inserted at the correct position*, never appended,
 *    so consumers (`useScrollback.scrollToMark`, `lastCommandEnd`, …) see
 *    a strictly chronological list regardless of delivery order.
 */
export function usePromptMarks(terminalId: string | null): PromptMark[] {
  const [marks, setMarks] = useState<PromptMark[]>([]);

  useEffect(() => {
    setMarks([]);
    if (!terminalId) {
      return;
    }

    let cancelled = false;
    let unlisten: UnlistenFn | null = null;

    (async () => {
      try {
        // Step 1: register listener first so any mark emitted while the
        // seed query is in flight is captured into state.
        unlisten = await listen<PromptMark>(`term:prompt-mark-${terminalId}`, (event) => {
          if (cancelled) return;
          setMarks((prev) => mergeMark(prev, event.payload));
        });
        if (cancelled) {
          unlisten();
          unlisten = null;
          return;
        }

        // Step 2: invoke after the listener is armed. The seed may already
        // overlap with marks the listener has just delivered; mergeMark
        // dedups by sequence so a doubled-up mark collapses to one entry.
        const seed = await invoke<PromptMark[]>("term_prompt_marks", { id: terminalId });
        if (cancelled) return;
        if (Array.isArray(seed) && seed.length > 0) {
          setMarks((prev) => seed.reduce(mergeMark, prev));
        }
      } catch {
        // Backend unreachable (e.g. vitest jsdom) — stay empty.
      }
    })();

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [terminalId]);

  return marks;
}

/**
 * Merge an incoming mark into the chronological list, deduping on
 * `sequence` and inserting at the position the sequence dictates.
 *
 * The previous implementation appended out-of-order arrivals at the
 * tail, which corrupted the chronological invariant relied on by
 * `lastCommandEnd` (linear scan from the end) and by
 * `useScrollback.scrollToMark` (binary search by `historySize`).
 */
function mergeMark(prev: PromptMark[], incoming: PromptMark): PromptMark[] {
  // Fast path: strictly newer than the tail — append.
  if (prev.length === 0 || prev[prev.length - 1].sequence < incoming.sequence) {
    return [...prev, incoming];
  }
  // Slow path: dedup or in-order insert.
  for (let i = prev.length - 1; i >= 0; i--) {
    const seq = prev[i].sequence;
    if (seq === incoming.sequence) {
      // Already known — drop duplicate. The seed and the listener can
      // both deliver the same mark when they race; one wins, the other
      // is a no-op.
      return prev;
    }
    if (seq < incoming.sequence) {
      // Insert just after position i so the list stays sorted.
      const next = prev.slice();
      next.splice(i + 1, 0, incoming);
      return next;
    }
  }
  // Smaller than everything — head of list.
  return [incoming, ...prev];
}

/**
 * Convenience selector: the most recent CommandEnd mark, if any. Useful
 * for surfaces that render last-command status (exit code colouring,
 * failure badges, etc.).
 */
export function lastCommandEnd(marks: PromptMark[]): PromptMark | null {
  for (let i = marks.length - 1; i >= 0; i--) {
    if (marks[i].kind === "commandEnd") return marks[i];
  }
  return null;
}
