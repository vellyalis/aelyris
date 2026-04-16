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
    let ghostCursorY = -1;
    let ghostCursorX = -1;

    // Hide ghost when terminal renders and cursor has moved (PTY output, TUI apps, etc.)
    const onRender = term.onRender(() => {
      if (!ghost.getSuggestion()) return;
      const buf = term.buffer.active;
      // Any cursor movement means the ghost is stale
      if (buf.cursorY !== ghostCursorY || buf.cursorX !== ghostCursorX) {
        ghost.hide();
        currentInput = "";
      }
      // Alternate screen = TUI app
      if (buf.type !== "normal") {
        ghost.hide();
        currentInput = "";
      }
    });

    const onData = term.onData((data) => {
      if (term.buffer.active.type !== "normal") {
        ghost.hide();
        currentInput = "";
        return;
      }

      // Escape sequences, control chars, or multi-byte IME input → clear ghost
      if (data.length > 1 && data.charCodeAt(0) < 32) {
        ghost.hide();
        currentInput = "";
        return;
      }

      if (data === "\r" || data === "\n") {
        currentInput = "";
        ghost.hide();
        return;
      }
      if (data === "\x7f" || data === "\b") {
        currentInput = currentInput.slice(0, -1);
      } else if (data.length === 1 && data.charCodeAt(0) >= 32) {
        currentInput += data;
      } else if (data.length > 1 && data.charCodeAt(0) >= 32) {
        // Multi-byte input (e.g., Japanese IME confirmed text) — reset ghost
        currentInput = "";
        ghost.hide();
        return;
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
      } else {
        ghost.hide();
        currentInput = "";
        return;
      }

      if (currentInput.length >= 2) {
        const history = blockTracker.getBlocks().map((b) => b.command).filter((c) => c.length > 0);
        const suggestion = findSuggestion(currentInput, history);
        if (suggestion) {
          // Use xterm buffer coordinates to compute pixel position
          const buf = term.buffer.active;
          const cellDims = (term as unknown as { _core: { _renderService: { dimensions: { css: { cell: { width: number; height: number } } } } } })._core?._renderService?.dimensions?.css?.cell;
          if (cellDims) {
            ghostCursorX = buf.cursorX;
            ghostCursorY = buf.cursorY;
            ghost.show(suggestion, currentInput.length, buf.cursorX * cellDims.width, buf.cursorY * cellDims.height);
          }
        } else {
          ghost.hide();
        }
      } else {
        ghost.hide();
      }
    });

    return () => {
      onData.dispose();
      onRender.dispose();
      ghost.dispose();
      ghostRef.current = null;
    };
  }, [term, containerRef, blockTracker, writeToPty]);
}
