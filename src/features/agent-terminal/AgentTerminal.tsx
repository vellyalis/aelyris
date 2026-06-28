import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useCallback, useEffect, useRef, useState } from "react";
import { formatFallbackError, reportInvokeFailure } from "../../shared/lib/fallbackTelemetry";
import { useAppStore } from "../../shared/store/appStore";
import { type AgentStatus, STATUS_COLORS, STATUS_LABELS } from "../../shared/types/agent";
import { type AgentCliType, getCliColor, getCliLabel } from "../../shared/types/interactiveAgent";
import { StatusIcon } from "../../shared/ui/StatusIcon";
import { IMEInputBar, type IMEInputBarHandle } from "../terminal/IMEInputBar";
import { TerminalCanvas } from "../terminal/TerminalCanvas";
import { useTerminalCellMetrics } from "../terminal/terminalMetrics";
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
  const [terminalError, setTerminalError] = useState<string | null>(null);
  const imeBarRef = useRef<IMEInputBarHandle>(null);
  const canvasElRef = useRef<HTMLCanvasElement | null>(null);
  const canvasInputElRef = useRef<HTMLTextAreaElement | null>(null);
  const terminalFontFamily = useAppStore((s) => s.terminalFontFamily);
  const terminalFontSize = useAppStore((s) => s.terminalFontSize);
  const terminalTextClarity = useAppStore((s) => s.terminalTextClarity);
  const terminalLineHeight = useAppStore((s) => s.terminalLineHeight);
  const cursorStyle = useAppStore((s) => s.cursorStyle);
  const cursorBlink = useAppStore((s) => s.cursorBlink);
  const cellMetrics = useTerminalCellMetrics(terminalFontSize, terminalFontFamily, terminalLineHeight);

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
        cols: Math.max(MIN_COLS, Math.floor(w / cellMetrics.width)),
        rows: Math.max(MIN_ROWS, Math.floor(h / cellMetrics.height)),
      };
    };
    const apply = () => {
      pending = null;
      const next = compute();
      if (!next) return;
      setDims((prev) => (prev && prev.cols === next.cols && prev.rows === next.rows ? prev : next));
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
  }, [cellMetrics.height, cellMetrics.width]);

  // Forward every dims change to the backend PTY + native engine.
  useEffect(() => {
    if (!dims) return;
    let cancelled = false;
    void invoke("resize_terminal", { id: ptyId, cols: dims.cols, rows: dims.rows })
      .then(() => {
        if (!cancelled) {
          setTerminalError((prev) => (prev?.startsWith("Resize failed:") ? null : prev));
        }
      })
      .catch((err) => {
        if (cancelled) return;
        const message = formatFallbackError(err);
        reportInvokeFailure({
          source: "agent-terminal",
          operation: "resize_terminal",
          err,
          severity: "warning",
          userVisible: true,
        });
        setTerminalError(`Resize failed: ${message}`);
      });
    return () => {
      cancelled = true;
    };
  }, [ptyId, dims]);

  // Watch the PTY for exit so we can display a subtle overlay when the
  // agent process is gone.
  useEffect(() => {
    setExited(false);
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
      if (exited) return;
      const root = areaRef.current;
      if (!root) return;
      const inside = root.contains(document.activeElement);
      if (!inside) return;
      e.preventDefault();
      imeBarRef.current?.focus();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [exited]);

  const submitIme = useCallback(
    (text: string) => {
      if (exited) return;
      void invoke("write_terminal", { id: ptyId, data: text })
        .then(() => {
          setTerminalError((prev) => (prev?.startsWith("Input write failed:") ? null : prev));
        })
        .catch((err) => {
          const message = formatFallbackError(err);
          reportInvokeFailure({
            source: "agent-terminal",
            operation: "write_terminal",
            err,
            severity: "error",
            userVisible: true,
          });
          setTerminalError(`Input write failed: ${message}`);
        });
    },
    [exited, ptyId],
  );

  const focusCanvas = useCallback(() => {
    // Prefer the IME textarea — the canvas has tabIndex=-1 after Phase B
    // and focusing it only works by bouncing through its React onFocus
    // handler, which can miss during Strict Mode unmount/remount cycles.
    (canvasInputElRef.current ?? canvasElRef.current)?.focus();
  }, []);

  const accent = accentColor ?? getCliColor(cli);

  return (
    <div ref={areaRef} className={styles.agentTerminal} style={{ "--agent-accent": accent } as React.CSSProperties}>
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
            fontSize={terminalFontSize}
            fontFamily={terminalFontFamily}
            lineHeight={terminalLineHeight}
            textClarity={terminalTextClarity}
            cursorStyle={cursorStyle}
            cursorBlink={cursorBlink}
            preferAiInputAnchor
            onCanvasRef={(el) => (canvasElRef.current = el)}
            onInputRef={(el) => (canvasInputElRef.current = el)}
          />
        )}
        {exited && <div className={styles.exitOverlay}>[Agent process exited]</div>}
        {terminalError && <div className={styles.errorOverlay}>{terminalError}</div>}
      </div>
      <IMEInputBar ref={imeBarRef} onSubmit={submitIme} onRequestCanvasFocus={focusCanvas} disabled={exited} />
    </div>
  );
}
