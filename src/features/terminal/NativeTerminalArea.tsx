import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

import type { ShellType } from "../../App";
import { TerminalCanvas } from "./TerminalCanvas";
import styles from "./TerminalArea.module.css";

interface NativeTerminalAreaProps {
  shell?: ShellType;
  cwd?: string;
  onTerminalReady?: (terminalId: string) => void;
  /** Override for tests — defaults to `invoke("spawn_terminal", ...)`. */
  spawnPty?: (args: {
    shell: string;
    cols: number;
    rows: number;
    cwd?: string;
  }) => Promise<string>;
  /** Override for tests — defaults to `invoke("resize_terminal", ...)`. */
  resizePty?: (id: string, cols: number, rows: number) => Promise<void> | void;
}

const FONT_SIZE = 14;
const CELL_W = Math.round(FONT_SIZE * 0.6);
const CELL_H = Math.round(FONT_SIZE * 1.25);
const MIN_COLS = 20;
const MIN_ROWS = 5;

interface Dims {
  cols: number;
  rows: number;
}

function defaultSpawn(args: {
  shell: string;
  cols: number;
  rows: number;
  cwd?: string;
}): Promise<string> {
  return invoke<string>("spawn_terminal", {
    shell: args.shell,
    cols: args.cols,
    rows: args.rows,
    cwd: args.cwd ?? null,
  });
}

function defaultResize(id: string, cols: number, rows: number): Promise<void> {
  return invoke<void>("resize_terminal", { id, cols, rows }).catch(() => {});
}

/**
 * Phase 2 / Task 10 — feature-flagged host for the native Rust terminal
 * engine. Spawns the PTY via the existing `spawn_terminal` command and
 * mounts `<TerminalCanvas>` against the returned terminal id. The canvas
 * subscribes to `term:diff-<id>` internally, so when the backend enables
 * the native engine (`AETHER_TERM_NATIVE=1`) this path renders the
 * alacritty_terminal grid; otherwise the canvas stays blank and the user
 * can flip back to xterm.js in settings.
 */
export function NativeTerminalArea({
  shell = "powershell",
  cwd,
  onTerminalReady,
  spawnPty = defaultSpawn,
  resizePty = defaultResize,
}: NativeTerminalAreaProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [terminalId, setTerminalId] = useState<string | null>(null);
  const [dims, setDims] = useState<Dims | null>(null);
  const spawnStartedRef = useRef(false);
  const shellRef = useRef(shell);
  const cwdRef = useRef(cwd);
  const onReadyRef = useRef(onTerminalReady);
  const spawnFnRef = useRef(spawnPty);
  shellRef.current = shell;
  cwdRef.current = cwd;
  onReadyRef.current = onTerminalReady;
  spawnFnRef.current = spawnPty;

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (w <= 0 || h <= 0) return;
      const cols = Math.max(MIN_COLS, Math.floor(w / CELL_W));
      const rows = Math.max(MIN_ROWS, Math.floor(h / CELL_H));
      setDims((prev) =>
        prev && prev.cols === cols && prev.rows === rows ? prev : { cols, rows },
      );
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!dims || spawnStartedRef.current) return;
    spawnStartedRef.current = true;
    let cancelled = false;
    (async () => {
      try {
        const id = await spawnFnRef.current({
          shell: shellRef.current,
          cols: dims.cols,
          rows: dims.rows,
          cwd: cwdRef.current,
        });
        if (cancelled) return;
        setTerminalId(id);
        onReadyRef.current?.(id);
      } catch {
        spawnStartedRef.current = false;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [dims]);

  useEffect(() => {
    if (!terminalId || !dims) return;
    void resizePty(terminalId, dims.cols, dims.rows);
  }, [terminalId, dims, resizePty]);

  const canvasKey = useMemo(
    () => (terminalId && dims ? `${terminalId}:${dims.cols}x${dims.rows}` : null),
    [terminalId, dims],
  );

  return (
    <div className={styles.terminalArea}>
      <div ref={containerRef} className={styles.terminalContainer}>
        {terminalId && dims && (
          <TerminalCanvas
            key={canvasKey ?? undefined}
            terminalId={terminalId}
            cols={dims.cols}
            rows={dims.rows}
            fontSize={FONT_SIZE}
          />
        )}
      </div>
    </div>
  );
}
