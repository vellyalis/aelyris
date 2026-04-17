import { useEffect, useMemo, useRef, useState } from "react";

import { useTerminalSnapshot } from "../../shared/hooks/useTerminalSnapshot";
import {
  CURSOR_COLOR,
  DEFAULT_BG,
  isDefaultBg,
  resolveColor,
} from "../../shared/lib/ansiPalette";
import {
  CellAttr,
  hasAttr,
  type CellSnapshot,
  type GridSnapshot,
} from "../../shared/types/terminal";

/**
 * Phase 2 / Task 7 — Canvas 2D terminal renderer with full ANSI attr + color.
 *
 * Subscribes to `useTerminalSnapshot` and paints the grid cell-by-cell.
 * Only rows whose cell arrays are not reference-equal to the previous
 * render are repainted (`applyDiff` preserves refs for untouched rows).
 *
 * Feature-flagged mount next to xterm.js comes in Task 10.
 */

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

interface CellMetrics {
  width: number;
  height: number;
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
  const liveSnapshot = useTerminalSnapshot(
    snapshotOverride === undefined ? terminalId : null,
  );
  const snapshot =
    snapshotOverride !== undefined ? snapshotOverride : liveSnapshot;

  const [cursorOn, setCursorOn] = useState(true);

  const cellMetrics: CellMetrics = useMemo(() => {
    // 0.6 approximates an IBM Plex Mono advance at the common weights used
    // in the UI. ctx.measureText-based calibration is deferred — the dev
    // integration target is 14px / 80×24 so sub-pixel error is fine.
    const width = Math.round(fontSize * 0.6);
    const height = Math.round(fontSize * 1.25);
    return { width, height };
  }, [fontSize]);

  const canvasWidth = cols * cellMetrics.width;
  const canvasHeight = rows * cellMetrics.height;

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

    ctx.textBaseline = "top";

    if (dimsChanged) {
      ctx.fillStyle = DEFAULT_BG;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    for (let row = 0; row < snapshot.rows; row++) {
      const rowCells = snapshot.cells[row];
      if (!dimsChanged && prev && prev.cells[row] === rowCells) continue;
      paintRow(ctx, rowCells, row, cellMetrics, fontSize, fontFamily);
    }

    if (snapshot.cursor.visible && cursorOn) {
      paintCursor(ctx, snapshot, cellMetrics);
    }

    prevSnapshotRef.current = snapshot;
  }, [snapshot, cellMetrics, fontFamily, fontSize, cursorOn]);

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

function buildFont(
  cell: CellSnapshot,
  fontSize: number,
  fontFamily: string,
): string {
  const bold = hasAttr(cell, CellAttr.BOLD);
  const italic = hasAttr(cell, CellAttr.ITALIC);
  const weight = bold ? "bold " : "";
  const style = italic ? "italic " : "";
  return `${style}${weight}${fontSize}px ${fontFamily}`;
}

function paintRow(
  ctx: CanvasRenderingContext2D,
  cells: CellSnapshot[],
  row: number,
  metrics: CellMetrics,
  fontSize: number,
  fontFamily: string,
) {
  const { width, height } = metrics;
  const y = row * height;

  // Clear the row in default bg. Per-cell custom bg is painted below.
  ctx.globalAlpha = 1;
  ctx.fillStyle = DEFAULT_BG;
  ctx.fillRect(0, y, cells.length * width, height);

  for (let col = 0; col < cells.length; col++) {
    const cell = cells[col];

    // Wide-char spacer occupies the second column of a 2-wide glyph —
    // paint nothing so the wide glyph from the previous cell isn't covered.
    if (hasAttr(cell, CellAttr.WIDE_CHAR_SPACER)) continue;

    const inverse = hasAttr(cell, CellAttr.INVERSE);
    const hidden = hasAttr(cell, CellAttr.HIDDEN);
    const dim = hasAttr(cell, CellAttr.DIM);

    let fgCss = resolveColor(cell.fg, true);
    let bgCss = resolveColor(cell.bg, false);
    if (inverse) {
      const tmp = fgCss;
      fgCss = bgCss;
      bgCss = tmp;
    }

    const wide = hasAttr(cell, CellAttr.WIDE_CHAR);
    const cellW = wide ? width * 2 : width;

    const hasCustomBg = inverse || !isDefaultBg(cell.bg);
    if (hasCustomBg) {
      ctx.globalAlpha = 1;
      ctx.fillStyle = bgCss;
      ctx.fillRect(col * width, y, cellW, height);
    }

    if (hidden) continue;
    const ch = cell.ch;
    const x = col * width;
    if (ch === " " || ch === "\0") {
      drawDecorations(ctx, cell, x, y, cellW, height, fgCss, dim);
      continue;
    }

    ctx.globalAlpha = dim ? 0.6 : 1;
    ctx.font = buildFont(cell, fontSize, fontFamily);
    ctx.fillStyle = fgCss;
    ctx.fillText(ch, x, y + 1);

    drawDecorations(ctx, cell, x, y, cellW, height, fgCss, dim);
  }
  ctx.globalAlpha = 1;
}

function drawDecorations(
  ctx: CanvasRenderingContext2D,
  cell: CellSnapshot,
  x: number,
  y: number,
  cellW: number,
  cellH: number,
  fgCss: string,
  dim: boolean,
) {
  const underline = hasAttr(cell, CellAttr.UNDERLINE);
  const strike = hasAttr(cell, CellAttr.STRIKEOUT);
  if (!underline && !strike) return;
  ctx.globalAlpha = dim ? 0.6 : 1;
  ctx.fillStyle = fgCss;
  if (underline) ctx.fillRect(x, y + cellH - 2, cellW, 1);
  if (strike) ctx.fillRect(x, y + Math.round(cellH / 2), cellW, 1);
}

function paintCursor(
  ctx: CanvasRenderingContext2D,
  snapshot: GridSnapshot,
  { width, height }: CellMetrics,
) {
  const { row, col, shape } = snapshot.cursor;
  if (shape === "hidden") return;
  const x = col * width;
  const y = row * height;
  ctx.globalAlpha = 1;
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
