import { useEffect, useRef, useState, useCallback } from "react";
import type { Terminal } from "@xterm/xterm";

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

    // Single streaming decoder for this PTY connection.  Without
    // `{stream: true}`, a multi-byte UTF-8 codepoint that happens to
    // straddle two Tauri event chunks (e.g. a Japanese character split
    // across 2 bytes + 1 byte) would be decoded as two replacement
    // characters, corrupting the output stream and breaking prompt /
    // AI-CLI detection downstream.
    const decoder = new TextDecoder("utf-8");

    (async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const { listen } = await import("@tauri-apps/api/event");

        // Capture the dimensions we ask the PTY to spawn with — the user
        // or ResizeObserver may change `term.cols/rows` while this async
        // spawn is in flight, so we need to know the before/after to
        // detect and repair a drift.
        const spawnCols = term.cols;
        const spawnRows = term.rows;

        const id = await invoke<string>("spawn_terminal", {
          shell,
          cols: spawnCols,
          rows: spawnRows,
          cwd: cwd ?? null,
        });

        if (cancelled) return;
        setPtyId(id);
        onReady?.(id);

        const unlistenOutput = await listen<number[]>(`pty-output-${id}`, (event) => {
          const bytes = new Uint8Array(event.payload);
          term.write(bytes);
          onOutput?.(decoder.decode(bytes, { stream: true }), id);
        });

        const unlistenExit = await listen(`pty-exit-${id}`, () => {
          term.writeln("\r\n\x1b[90m[Process exited]\x1b[0m");
        });

        if (cancelled) {
          unlistenOutput();
          unlistenExit();
          return;
        }

        // Input forwarding — keep the disposable so we can detach the
        // listener on unmount.  Without this, a TerminalArea whose xterm
        // is re-created (e.g. via a shell/cwd prop change) would have a
        // dangling onData firing against a stale PTY id.
        const dataDisposable = term.onData((data) => {
          if (syncModeRef.current) {
            invoke("broadcast_keys", { data }).catch(() => {});
          } else {
            invoke("write_terminal", { id, data }).catch(() => {});
          }
        });

        // Resize forwarding
        const resizeDisposable = term.onResize(({ cols, rows }) => {
          invoke("resize_terminal", { id, cols, rows }).catch(() => {});
        });

        // Repair drift: if xterm resized while `spawn_terminal` was in
        // flight, its onResize callback was not yet attached, so the new
        // dimensions never reached the PTY.  This is how the third pane
        // ended up rendering `PS C:\Usgemininer\…` garbage — PTY cols
        // and xterm cols disagreed, so PSReadLine's absolute cursor
        // positioning landed in the wrong columns.  One post-spawn push
        // closes the gap.
        if (term.cols !== spawnCols || term.rows !== spawnRows) {
          invoke("resize_terminal", { id, cols: term.cols, rows: term.rows })
            .catch(() => {});
        }

        // Final race window: if unmount fired between the two listen()
        // awaits above and the onData/onResize registrations below,
        // `cancelled` is true but `cleanupRef` is still null, so the
        // effect's teardown ran as a no-op.  Dispose inline instead of
        // relying on the ref, otherwise these listeners would leak and
        // continue to invoke into a dead PTY id.
        if (cancelled) {
          unlistenOutput();
          unlistenExit();
          dataDisposable.dispose();
          resizeDisposable.dispose();
          return;
        }

        cleanupRef.current = () => {
          unlistenOutput();
          unlistenExit();
          dataDisposable.dispose();
          resizeDisposable.dispose();
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
