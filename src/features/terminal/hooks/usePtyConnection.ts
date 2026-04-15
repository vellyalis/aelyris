import { useEffect, useRef, useState, useCallback } from "react";
import type { Terminal } from "@xterm/xterm";
import { decodeBase64ToBytes } from "../../../shared/lib/decodeBase64";

interface UsePtyConnectionOptions {
  term: Terminal | null;
  shell: string;
  cwd?: string;
  syncModeRef: React.RefObject<boolean | undefined>;
  onReady?: (terminalId: string) => void;
  /** Called with decoded text for each output chunk */
  onOutput?: (text: string, ptyId: string) => void;
}

/**
 * Manages PTY lifecycle: spawn, output listening, input forwarding, resize.
 *
 * Output processing (block tracking, error detection) is delegated
 * to the `onOutput` callback, keeping this hook focused on transport.
 */
export function usePtyConnection({
  term, shell, cwd, syncModeRef, onReady, onOutput,
}: UsePtyConnectionOptions) {
  const [ptyId, setPtyId] = useState<string | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  const writeToPty = useCallback((data: string) => {
    if (!ptyId) return;
    import("@tauri-apps/api/core").then(({ invoke }) => {
      invoke("write_terminal", { id: ptyId, data }).catch(() => {});
    });
  }, [ptyId]);

  useEffect(() => {
    if (!term) return;
    let cancelled = false;

    (async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const { listen } = await import("@tauri-apps/api/event");

        const id = await invoke<string>("spawn_terminal", {
          shell,
          cols: term.cols,
          rows: term.rows,
          cwd: cwd ?? null,
        });

        if (cancelled) return;
        setPtyId(id);
        onReady?.(id);

        const unlistenOutput = await listen<string>(`pty-output-${id}`, (event) => {
          const bytes = decodeBase64ToBytes(event.payload);
          term.write(bytes);
          onOutput?.(new TextDecoder().decode(bytes), id);
        });

        const unlistenExit = await listen(`pty-exit-${id}`, () => {
          term.writeln("\r\n\x1b[90m[Process exited]\x1b[0m");
        });

        if (cancelled) {
          unlistenOutput();
          unlistenExit();
          return;
        }

        // Input forwarding
        term.onData((data) => {
          if (syncModeRef.current) {
            invoke("broadcast_keys", { data }).catch(() => {});
          } else {
            invoke("write_terminal", { id, data }).catch(() => {});
          }
        });

        // Resize forwarding
        term.onResize(({ cols, rows }) => {
          invoke("resize_terminal", { id, cols, rows }).catch(() => {});
        });

        cleanupRef.current = () => {
          unlistenOutput();
          unlistenExit();
        };
      } catch (err) {
        if (!cancelled) {
          term.writeln(`\x1b[31mPTY connection failed: ${err}\x1b[0m`);
        }
      }
    })();

    return () => {
      cancelled = true;
      cleanupRef.current?.();
      cleanupRef.current = null;
    };
  }, [term, shell, cwd]);

  return { ptyId, writeToPty };
}
