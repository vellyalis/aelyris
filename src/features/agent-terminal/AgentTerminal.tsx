import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import { TerminalCanvas } from "../terminal/TerminalCanvas";
import { IMEInputBar, type IMEInputBarHandle } from "../terminal/IMEInputBar";
import { getCliLabel, getCliColor, type AgentCliType } from "../../shared/types/interactiveAgent";
import { STATUS_COLORS, STATUS_LABELS, type AgentStatus } from "../../shared/types/agent";
import { StatusIcon } from "../../shared/ui/StatusIcon";
import styles from "./AgentTerminal.module.css";

interface AgentTerminalProps {
  /** PTY ID to connect to (already spawned by Rust backend) */
  ptyId: string;
  cli: AgentCliType;
  status: AgentStatus;
  model: string;
  cost: number;
  /** Session accent color */
  accentColor?: string;
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

/**
 * Terminal bound to an interactive agent PTY. Unlike NativeTerminalArea this
 * does NOT spawn — the PTY is already alive, created by
 * `spawn_interactive_agent` on the Rust side, which also registers the PTY
 * with the native terminal engine so TerminalCanvas can subscribe to its
 * grid diffs.
 *
 * Layout: status overlay bar (CLI / model / status / cost) on top, grid
 * canvas in the middle, IME input bar docked at the bottom. The bar is
 * always rendered — every agent session is an AI CLI that the bar exists to
 * serve — and Ctrl+Shift+J moves focus into it.
 */
export function AgentTerminal({ ptyId, cli, status, model, cost, accentColor }: AgentTerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const areaRef = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState<Dims | null>(null);
  const [exited, setExited] = useState(false);
  const imeBarRef = useRef<IMEInputBarHandle>(null);
  const canvasElRef = useRef<HTMLCanvasElement | null>(null);

  // Measure container → cols/rows, trailing-edge debounced so a continuous
  // resize drag doesn't thrash the backend with resize_terminal calls.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let pending: number | null = null;
    const compute = (): Dims | null => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (w <= 0 || h <= 0) return null;
      return {
        cols: Math.max(MIN_COLS, Math.floor(w / CELL_W)),
        rows: Math.max(MIN_ROWS, Math.floor(h / CELL_H)),
      };
    };
    const apply = () => {
      pending = null;
      const next = compute();
      if (!next) return;
      setDims((prev) =>
        prev && prev.cols === next.cols && prev.rows === next.rows ? prev : next,
      );
    };
    const schedule = () => {
      if (pending !== null) window.clearTimeout(pending);
      pending = window.setTimeout(apply, 120);
    };
    apply();
    const ro = new ResizeObserver(schedule);
    ro.observe(el);
    return () => {
      if (pending !== null) window.clearTimeout(pending);
      ro.disconnect();
    };
  }, []);

  // Forward every dims change to the backend PTY + native engine.
  useEffect(() => {
    if (!dims) return;
    void invoke("resize_terminal", { id: ptyId, cols: dims.cols, rows: dims.rows }).catch(() => {});
  }, [ptyId, dims]);

  // Watch the PTY for exit so we can display a subtle overlay when the
  // agent process is gone.
  useEffect(() => {
    let unlisten: UnlistenFn | null = null;
    let cancelled = false;
    (async () => {
      try {
        const fn = await listen(`pty-exit-${ptyId}`, () => setExited(true));
        if (cancelled) {
          fn();
          return;
        }
        unlisten = fn;
      } catch {
        // Backend unreachable (e.g. tests) — stay live.
      }
    })();
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [ptyId]);

  // Ctrl+Shift+J focuses the IME bar. Scope matches NativeTerminalArea:
  // only when the key comes from inside this component's subtree.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.ctrlKey && e.shiftKey && (e.key === "J" || e.key === "j"))) return;
      const root = areaRef.current;
      if (!root) return;
      const inside = root.contains(document.activeElement);
      if (!inside) return;
      e.preventDefault();
      imeBarRef.current?.focus();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const submitIme = useCallback(
    (text: string) => {
      void invoke("write_terminal", { id: ptyId, data: text }).catch(() => {});
    },
    [ptyId],
  );

  const focusCanvas = useCallback(() => {
    canvasElRef.current?.focus();
  }, []);

  const accent = accentColor ?? getCliColor(cli);

  return (
    <div
      ref={areaRef}
      className={styles.agentTerminal}
      style={{ "--agent-accent": accent } as React.CSSProperties}
    >
      <div className={styles.statusBar}>
        <span className={styles.cliBadge} style={{ color: accent }}>
          {getCliLabel(cli)}
        </span>
        <span className={styles.modelLabel}>{model}</span>
        <StatusIcon status={status} size={10} />
        <span className={styles.statusLabel} style={{ color: STATUS_COLORS[status] }}>
          {STATUS_LABELS[status]}
        </span>
        <span className={styles.cost}>${cost.toFixed(2)}</span>
      </div>
      <div ref={containerRef} className={styles.terminalContainer}>
        {dims && (
          <TerminalCanvas
            terminalId={ptyId}
            cols={dims.cols}
            rows={dims.rows}
            fontSize={FONT_SIZE}
            onCanvasRef={(el) => (canvasElRef.current = el)}
          />
        )}
        {exited && (
          <div className={styles.exitOverlay}>[Agent process exited]</div>
        )}
      </div>
      <IMEInputBar
        ref={imeBarRef}
        onSubmit={submitIme}
        onRequestCanvasFocus={focusCanvas}
      />
    </div>
  );
}
