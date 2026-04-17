import { useEffect, useMemo, useRef, useState } from "react";

import { useTerminalSnapshot } from "../../shared/hooks/useTerminalSnapshot";
import type { CellSnapshot, GridSnapshot } from "../../shared/types/terminal";

/**
 * Phase 2 / Task 6 — basic Canvas 2D terminal renderer.
 *
 * Subscribes to `useTerminalSnapshot` and paints the grid into a canvas.
 * Only rows whose cell arrays are not reference-equal to the previous
 * render are repainted; `applyDiff` already re-uses old row references
 * for untouched rows so this is effectively a row-level dirty check.
 *
 * Scope: monochrome rendering + cursor. ANSI colors / attrs (bold, italic,
 * etc.) arrive in Task 7; input / selection in Task 8-9; feature-flagged
 * mount next to xterm.js in Task 10.
 */

const DEFAULT_FG = "#cdd6f4"; // Catppuccin Mocha text
const DEFAULT_BG = "#1e1e2e"; // Catppuccin Mocha base
const CURSOR_COLOR = "#cba6f7"; // Catppuccin Mocha mauve

export interface TerminalCanvasProps {
  terminalId: string;
  cols: number;
  rows: number;
  fontSize?: number;
  fontFamily?: string;
  className?: string;
  /** Overrides the live snapshot hook — used by tests to inject fixtures. */
  snapshotOverride?: GridSnapshot | null;
}

export function TerminalCanvas({
  terminalId,
  cols,
  rows,
  fontSize = 14,
  fontFamily = "'IBM Plex Mono', 'Cascadia Code', monospace",
  className,
  snapshotOverride,
}: TerminalCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const prevSnapshotRef = useRef<GridSnapshot | null>(null);
  const liveSnapshot = useTerminalSnapshot(snapshotOverride === undefined ? terminalId : null);
  const snapshot = snapshotOverride !== undefined ? snapshotOverride : liveSnapshot;

  const [cursorOn, setCursorOn] = useState(true);

  const cellMetrics = useMemo(() => {
    // 0.6 approximates an IBM Plex Mono advance at the common weights used
    // in the UI. Task 7 refines this via ctx.measureText when the canvas is
    // mounted — for now the dev mode integration target is a 14px / 80x24
    // shell window so the rounding error is sub-pixel.
    const width = Math.round(fontSize * 0.6);
    const height = Math.round(fontSize * 1.25);
    return { width, height };
  }, [fontSize]);

  const canvasWidth = cols * cellMetrics.width;
  const canvasHeight = rows * cellMetrics.height;

  // Paint dirty rows + cursor.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    if (!snapshot) {
      ctx.fillStyle = DEFAULT_BG;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      prevSnapshotRef.current = null;
      return;
    }

    const prev = prevSnapshotRef.current;
    const dimsChanged =
      !prev || prev.cols !== snapshot.cols || prev.rows !== snapshot.rows;

    ctx.font = `${fontSize}px ${fontFamily}`;
    ctx.textBaseline = "top";

    if (dimsChanged) {
      ctx.fillStyle = DEFAULT_BG;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    for (let row = 0; row < snapshot.rows; row++) {
      const rowCells = snapshot.cells[row];
      if (!dimsChanged && prev && prev.cells[row] === rowCells) {
        continue; // unchanged row — applyDiff preserved the reference
      }
      paintRow(ctx, rowCells, row, cellMetrics);
    }

    if (snapshot.cursor.visible && cursorOn) {
      paintCursor(ctx, snapshot, cellMetrics);
    }

    prevSnapshotRef.current = snapshot;
  }, [snapshot, cellMetrics, fontFamily, fontSize, cursorOn]);

  // Cursor blink. Skipped when blinking is off so the cursor stays solid.
  useEffect(() => {
    if (!snapshot?.cursor.blinking) {
      setCursorOn(true);
      return;
    }
    const id = window.setInterval(() => setCursorOn((v) => !v), 500);
    return () => window.clearInterval(id);
  }, [snapshot?.cursor.blinking]);

  return (
    <canvas
      ref={canvasRef}
      width={canvasWidth}
      height={canvasHeight}
      className={className}
      data-testid="terminal-canvas"
      data-terminal-id={terminalId}
      style={{
        width: `${canvasWidth}px`,
        height: `${canvasHeight}px`,
        background: DEFAULT_BG,
        imageRendering: "pixelated",
      }}
    />
  );
}

function paintRow(
  ctx: CanvasRenderingContext2D,
  cells: CellSnapshot[],
  row: number,
  { width, height }: { width: number; height: number },
) {
  const y = row * height;
  // Full-row clear in the default bg (ANSI bg comes in Task 7).
  ctx.fillStyle = DEFAULT_BG;
  ctx.fillRect(0, y, cells.length * width, height);

  ctx.fillStyle = DEFAULT_FG;
  for (let col = 0; col < cells.length; col++) {
    const ch = cells[col].ch;
    if (ch === " " || ch === "\0") continue;
    ctx.fillText(ch, col * width, y + 1);
  }
}

function paintCursor(
  ctx: CanvasRenderingContext2D,
  snapshot: GridSnapshot,
  { width, height }: { width: number; height: number },
) {
  const { row, col, shape } = snapshot.cursor;
  if (shape === "hidden") return;
  const x = col * width;
  const y = row * height;
  ctx.fillStyle = CURSOR_COLOR;
  switch (shape) {
    case "block":
    case "hollowBlock": {
      ctx.fillRect(x, y, width, height);
      const cell = snapshot.cells[row]?.[col];
      if (cell && cell.ch !== " ") {
        ctx.fillStyle = DEFAULT_BG;
        ctx.fillText(cell.ch, x, y + 1);
      }
      return;
    }
    case "underline":
      ctx.fillRect(x, y + height - 2, width, 2);
      return;
    case "beam":
      ctx.fillRect(x, y, 2, height);
      return;
  }
}
