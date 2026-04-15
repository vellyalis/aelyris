import { useEffect, useRef } from "react";
import type { Terminal } from "@xterm/xterm";
import type { CommandBlockTracker } from "../commandBlock";
import { findSuggestion, GhostSuggestOverlay } from "../ghostSuggest";

interface UseGhostSuggestOptions {
  term: Terminal | null;
  containerRef: React.RefObject<HTMLDivElement | null>;
  blockTracker: CommandBlockTracker;
  writeToPty: (data: string) => void;
}

/**
 * Ghost typing: shows predicted command completions as faded text.
 * Tab key accepts the suggestion and sends remaining text to PTY.
 */
export function useGhostSuggest({
  term, containerRef, blockTracker, writeToPty,
}: UseGhostSuggestOptions): void {
  const ghostRef = useRef<GhostSuggestOverlay | null>(null);

  useEffect(() => {
    if (!term || !containerRef.current) return;

    const ghost = new GhostSuggestOverlay(containerRef.current);
    ghostRef.current = ghost;

    let currentInput = "";

    const disposable = term.onData((data) => {
      if (data === "\r" || data === "\n") {
        currentInput = "";
        ghost.hide();
        return;
      }
      if (data === "\x7f" || data === "\b") {
        currentInput = currentInput.slice(0, -1);
      } else if (data.length === 1 && data.charCodeAt(0) >= 32) {
        currentInput += data;
      } else if (data === "\t") {
        const suggestion = ghost.getSuggestion();
        if (suggestion) {
          const remaining = suggestion.slice(currentInput.length);
          if (remaining) {
            writeToPty(remaining);
            currentInput = suggestion;
            ghost.hide();
            return;
          }
        }
      }

      // Update ghost suggestion
      if (currentInput.length >= 2) {
        const history = blockTracker.getBlocks().map((b) => b.command).filter((c) => c.length > 0);
        const suggestion = findSuggestion(currentInput, history);
        if (suggestion) {
          const cursor = containerRef.current?.querySelector(".xterm-cursor-layer");
          if (cursor) {
            const style = window.getComputedStyle(cursor);
            ghost.show(suggestion, currentInput.length, parseInt(style.left || "0"), parseInt(style.top || "0"));
          }
        } else {
          ghost.hide();
        }
      } else {
        ghost.hide();
      }
    });

    return () => {
      disposable.dispose();
      ghost.dispose();
      ghostRef.current = null;
    };
  }, [term, containerRef, blockTracker, writeToPty]);
}
