import { useState, useCallback, useRef } from "react";
import type { Terminal } from "@xterm/xterm";
import type { CommandBlock } from "../commandBlock";
import { CommandBlockTracker, detectPrompt } from "../commandBlock";
import { detectError } from "../../../shared/lib/errorDetector";
import { useToastStore } from "../../../shared/store/toastStore";

/** Cap the in-memory block list so long sessions don't balloon memory. */
const MAX_BLOCKS_IN_MEMORY = 500;

interface UseTerminalOutputOptions {
  term: Terminal | null;
  cwd?: string;
  onStartAgent?: (prompt: string) => void;
}

/**
 * Processes PTY output: command block tracking, error detection, history persistence.
 *
 * Returns a stable `processOutput` callback for usePtyConnection to call,
 * and the accumulated `blocks` for the CommandHistory UI.
 */
export function useTerminalOutput({ term, cwd, onStartAgent }: UseTerminalOutputOptions) {
  const blockTrackerRef = useRef(new CommandBlockTracker());
  const [blocks, setBlocks] = useState<readonly CommandBlock[]>([]);
  const lastErrorTimeRef = useRef(0);
  const lastPromptLineRef = useRef(-1);

  const processOutput = useCallback((text: string, ptyId: string) => {
    if (!term) return;
    const blockTracker = blockTrackerRef.current;

    const clean = text.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "");
    const lines = clean.split(/\r?\n/);

    for (const line of lines) {
      if (line.trim().length === 0) continue;
      blockTracker.addLine(line);

      // Error detection — throttled (max 1 per 5s)
      const now = Date.now();
      if (now - lastErrorTimeRef.current > 5000) {
        const error = detectError(line);
        if (error) {
          lastErrorTimeRef.current = now;
          useToastStore.getState().add({
            type: "error",
            title: `${error.type}: ${error.message.slice(0, 80)}`,
            description: error.suggestedPrompt.slice(0, 120),
            action: onStartAgent ? {
              label: "Ask AI to fix",
              onClick: () => onStartAgent(error.suggestedPrompt),
            } : undefined,
          });
        }
      }

      // Prompt detection → block list update + decoration + SQLite persist
      const detected = detectPrompt(line);
      if (detected) {
        // Keep the block list bounded so long sessions don't grow memory
        // linearly — the BlockHistory dropdown only shows the tail anyway.
        blockTracker.prune(MAX_BLOCKS_IN_MEMORY);
        // Snapshot to a mutable array React can treat as a new reference.
        setBlocks(blockTracker.getBlocks().slice());

        // Persist last completed command to SQLite
        const all = blockTracker.getBlocks();
        const lastBlock = all.length > 0 ? all[all.length - 1] : null;
        if (lastBlock && lastBlock.command.trim()) {
          import("@tauri-apps/api/core").then(({ invoke }) => {
            invoke("save_command_history", {
              terminalId: ptyId,
              command: lastBlock.command,
              cwd: cwd ?? ".",
            }).catch(() => {});
          });
        }
      }

      // Block separator decoration
      if (detected && blockTracker.blockCount > 0) {
        const cursorRow = term.buffer.active.cursorY;
        if (cursorRow !== lastPromptLineRef.current) {
          lastPromptLineRef.current = cursorRow;
          try {
            const marker = term.registerMarker(0);
            if (marker) {
              const deco = term.registerDecoration({
                marker,
                width: term.cols,
                overviewRulerOptions: { color: "rgba(166, 173, 200, 0.3)" },
              });
              deco?.onRender((el) => {
                el.style.borderTop = "1px solid rgba(166, 173, 200, 0.25)";
                el.style.marginTop = "-1px";
                el.style.height = "0px";
                el.style.pointerEvents = "none";
              });
            }
          } catch { /* decoration API may not be available */ }
        }
      }
    }
  }, [term, cwd, onStartAgent]);

  return { blockTracker: blockTrackerRef.current, blocks, processOutput };
}
