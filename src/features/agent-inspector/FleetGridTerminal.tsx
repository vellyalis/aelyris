import { useEffect, useRef, useState } from "react";
import { useAppStore } from "../../shared/store/appStore";
import { TerminalCanvas } from "../terminal/TerminalCanvas";
import { useTerminalCellMetrics } from "../terminal/terminalMetrics";

const MIN_COLS = 40;
const MIN_ROWS = 6;

interface Dims {
  cols: number;
  rows: number;
}

interface FleetGridTerminalProps {
  /** Live PTY id to mirror. */
  ptyId: string;
}

/**
 * Read-only live mirror of an agent PTY for the fleet grid tile. It subscribes
 * to the same `term:diff-<ptyId>` stream as the primary surface (via
 * TerminalCanvas, which self-subscribes when no snapshot override is passed),
 * but deliberately does NOT call `resize_terminal`. The PTY's true grid size is
 * owned by its primary pane / AgentTerminal; a second writer would fight that
 * owner and thrash the process. The tile therefore measures its own container
 * only to size the canvas and clips to a viewport (the wrapper sets
 * overflow:hidden) — accepting clipping rather than reflowing the source PTY.
 */
export function FleetGridTerminal({ ptyId }: FleetGridTerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState<Dims | null>(null);
  const terminalFontFamily = useAppStore((s) => s.terminalFontFamily);
  const terminalFontSize = useAppStore((s) => s.terminalFontSize);
  const terminalTextClarity = useAppStore((s) => s.terminalTextClarity);
  const terminalLineHeight = useAppStore((s) => s.terminalLineHeight);
  const cursorStyle = useAppStore((s) => s.cursorStyle);
  const cursorBlink = useAppStore((s) => s.cursorBlink);
  const cellMetrics = useTerminalCellMetrics(terminalFontSize, terminalFontFamily, terminalLineHeight);

  // Measure container → cols/rows (debounced). Mirror of AgentTerminal's block
  // minus the resize_terminal forward — this surface never owns the PTY size.
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

  return (
    <div ref={containerRef} style={{ width: "100%", height: "100%", overflow: "hidden" }}>
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
        />
      )}
    </div>
  );
}
