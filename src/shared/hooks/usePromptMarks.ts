import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useEffect, useState } from "react";

export type PromptMarkKind = "promptStart" | "commandStart" | "outputStart" | "commandEnd";

export interface PromptMark {
  kind: PromptMarkKind;
  screenLine: number;
  exitCode: number | null;
  sequence: number;
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
 */
export function usePromptMarks(terminalId: string | null): PromptMark[] {
  const [marks, setMarks] = useState<PromptMark[]>([]);

  useEffect(() => {
    if (!terminalId) {
      setMarks([]);
      return;
    }

    let cancelled = false;
    let unlisten: UnlistenFn | null = null;

    (async () => {
      try {
        const seed = await invoke<PromptMark[]>("term_prompt_marks", { id: terminalId });
        if (cancelled) return;
        // Seed atomically — the event listener below appends to this state,
        // so we start from the authoritative history rather than doubling
        // up marks that might arrive between the seed query and the listen
        // call.
        setMarks(Array.isArray(seed) ? seed : []);

        unlisten = await listen<PromptMark>(`term:prompt-mark-${terminalId}`, (event) => {
          const incoming = event.payload;
          setMarks((prev) => {
            // Dedup on the monotonic `sequence` counter — Tauri events can
            // race with the seed query on rapid successive mounts, and the
            // backend seed already includes in-flight marks.
            if (prev.length > 0 && prev[prev.length - 1].sequence >= incoming.sequence) {
              if (prev.some((m) => m.sequence === incoming.sequence)) return prev;
            }
            return [...prev, incoming];
          });
        });
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
