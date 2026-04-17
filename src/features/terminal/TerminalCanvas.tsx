import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { openUrl as tauriOpenUrl } from "@tauri-apps/plugin-opener";

import { useTerminalSnapshot } from "../../shared/hooks/useTerminalSnapshot";
import {
  useTerminalCanvasInput,
  type WriteBytesFn,
} from "./hooks/useTerminalCanvasInput";
import {
  CURSOR_COLOR,
  DEFAULT_BG,
  LINK_HOVER_FG,
  SEARCH_ACTIVE_BG,
  SEARCH_MATCH_BG,
  SELECTION_BG,
  isDefaultBg,
  resolveColor,
} from "../../shared/lib/ansiPalette";
import {
  CellAttr,
  hasAttr,
  type CellSnapshot,
  type GridSnapshot,
} from "../../shared/types/terminal";
import { pixelToCell } from "./keymap";
import { linkAt, scanLinks, type LinkSpan } from "./links";
import type { SearchMatch } from "./search";
import { rowSelection, type SelectionRange } from "./selection";
import {
  useTerminalSelection,
  type CopyTextFn,
} from "./hooks/useTerminalSelection";

export type OpenUrlFn = (url: string) => Promise<void> | void;

const defaultOpenUrl: OpenUrlFn = async (url) => {
  try {
    await tauriOpenUrl(url);
  } catch {
    if (typeof window !== "undefined") {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  }
};

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
  /** Injectable PTY writer — defaults to `invoke("write_terminal", ...)`. */
  writeBytes?: WriteBytesFn;
  /** Injectable clipboard writer — defaults to `navigator.clipboard.writeText`. */
  copyText?: CopyTextFn;
  /** Search matches to highlight with a dim yellow band. */
  searchMatches?: readonly SearchMatch[];
  /** Active match gets a brighter band on top of the dim highlight. */
  activeSearchMatch?: SearchMatch | null;
  /** Invoked on Ctrl+Click over a detected URL. */
  onOpenUrl?: OpenUrlFn;
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
  writeBytes,
  copyText,
  searchMatches,
  activeSearchMatch,
  onOpenUrl = defaultOpenUrl,
}: TerminalCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [inputEl, setInputEl] = useState<HTMLCanvasElement | null>(null);
  const prevSnapshotRef = useRef<GridSnapshot | null>(null);
  const prevSelectionRef = useRef<SelectionRange | null>(null);
  const prevMatchesKeyRef = useRef<string>("");
  const prevHoveredLinkRef = useRef<LinkSpan | null>(null);
  const prevCursorRef = useRef<{ row: number; col: number } | null>(null);
  const prevCursorOnRef = useRef<boolean>(true);
  const [hoveredLink, setHoveredLink] = useState<LinkSpan | null>(null);

  useTerminalCanvasInput(terminalId, inputEl, writeBytes);
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

  const { selection, clear: clearSelection, copy } = useTerminalSelection({
    element: inputEl,
    snapshot,
    cellWidth: cellMetrics.width,
    cellHeight: cellMetrics.height,
    copyText,
  });

  const links = useMemo(() => scanLinks(snapshot), [snapshot]);

  useEffect(() => {
    const el = inputEl;
    if (!el) return;
    const onMove = (ev: MouseEvent) => {
      const snap = snapshot;
      if (!snap || links.length === 0) {
        setHoveredLink((prev) => (prev === null ? prev : null));
        return;
      }
      const rect = el.getBoundingClientRect();
      const point = pixelToCell(
        ev.clientX,
        ev.clientY,
        rect,
        cellMetrics.width,
        cellMetrics.height,
        snap.cols,
        snap.rows,
      );
      if (!point) {
        setHoveredLink((prev) => (prev === null ? prev : null));
        return;
      }
      const hit = linkAt(links, point.row, point.col);
      if (ev.ctrlKey && hit) {
        el.style.cursor = "pointer";
      } else {
        el.style.cursor = "";
      }
      setHoveredLink((prev) => (prev === hit ? prev : hit));
    };
    const onLeave = () => {
      setHoveredLink((prev) => (prev === null ? prev : null));
      el.style.cursor = "";
    };
    el.addEventListener("mousemove", onMove);
    el.addEventListener("mouseleave", onLeave);
    return () => {
      el.removeEventListener("mousemove", onMove);
      el.removeEventListener("mouseleave", onLeave);
      el.style.cursor = "";
    };
  }, [inputEl, snapshot, links, cellMetrics.width, cellMetrics.height]);

  const handleLinkClick = useCallback(
    (ev: MouseEvent) => {
      if (!ev.ctrlKey || ev.button !== 0) return;
      const snap = snapshot;
      if (!snap || links.length === 0 || !inputEl) return;
      const rect = inputEl.getBoundingClientRect();
      const point = pixelToCell(
        ev.clientX,
        ev.clientY,
        rect,
        cellMetrics.width,
        cellMetrics.height,
        snap.cols,
        snap.rows,
      );
      if (!point) return;
      const hit = linkAt(links, point.row, point.col);
      if (!hit) return;
      ev.preventDefault();
      ev.stopPropagation();
      if (onOpenUrl) {
        void onOpenUrl(hit.url);
      }
    },
    [snapshot, links, inputEl, cellMetrics.width, cellMetrics.height, onOpenUrl],
  );

  useEffect(() => {
    const el = inputEl;
    if (!el) return;
    el.addEventListener("mousedown", handleLinkClick, true);
    return () => el.removeEventListener("mousedown", handleLinkClick, true);
  }, [inputEl, handleLinkClick]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const clearOnType = (ev: KeyboardEvent) => {
      if (ev.ctrlKey && ev.shiftKey) return;
      if (!selection) return;
      clearSelection();
    };
    canvas.addEventListener("keydown", clearOnType);
    return () => canvas.removeEventListener("keydown", clearOnType);
  }, [selection, clearSelection]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const handler = (ev: KeyboardEvent) => {
      if (ev.ctrlKey && ev.shiftKey && (ev.key === "c" || ev.key === "C")) {
        if (!selection) return;
        ev.preventDefault();
        ev.stopPropagation();
        void copy();
      }
    };
    canvas.addEventListener("keydown", handler);
    return () => canvas.removeEventListener("keydown", handler);
  }, [selection, copy]);

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
    const prevSel = prevSelectionRef.current;
    const selectionChanged = prevSel !== selection;
    const matchesKey = buildMatchesKey(searchMatches, activeSearchMatch);
    const matchesChanged = matchesKey !== prevMatchesKeyRef.current;
    const prevHover = prevHoveredLinkRef.current;
    const hoverChanged = prevHover !== hoveredLink;
    const prevCursor = prevCursorRef.current;
    const cursor = snapshot.cursor;
    const cursorMoved =
      !prevCursor || prevCursor.row !== cursor.row || prevCursor.col !== cursor.col;
    const cursorBlinkToggled = prevCursorOnRef.current !== cursorOn;
    const cursorDirtyRows = new Set<number>();
    if (cursorMoved || cursorBlinkToggled) {
      if (prevCursor) cursorDirtyRows.add(prevCursor.row);
      cursorDirtyRows.add(cursor.row);
    }

    ctx.textBaseline = "top";

    if (dimsChanged) {
      ctx.fillStyle = DEFAULT_BG;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    const affectedBySearch = buildRowMask(
      searchMatches,
      activeSearchMatch,
      snapshot.rows,
    );
    const affectedByHover = rowsCoveredByLink(hoveredLink, prevHover);

    for (let row = 0; row < snapshot.rows; row++) {
      const rowCells = snapshot.cells[row];
      const inOld = prevSel ? rowSelection(row, prevSel, snapshot.cols) : null;
      const inNew = selection ? rowSelection(row, selection, snapshot.cols) : null;
      const selDirtyRow =
        selectionChanged && (inOld !== null || inNew !== null);
      const matchDirtyRow = matchesChanged && affectedBySearch.has(row);
      const hoverDirtyRow = hoverChanged && affectedByHover.has(row);
      const cursorDirtyRow = cursorDirtyRows.has(row);
      if (
        !dimsChanged &&
        !selDirtyRow &&
        !matchDirtyRow &&
        !hoverDirtyRow &&
        !cursorDirtyRow &&
        prev &&
        prev.cells[row] === rowCells
      ) {
        continue;
      }
      paintRow(ctx, rowCells, row, cellMetrics, fontSize, fontFamily);
      paintSearchBands(
        ctx,
        row,
        searchMatches,
        activeSearchMatch,
        cellMetrics,
      );
      if (inNew) {
        paintSelectionBand(ctx, row, inNew, cellMetrics);
      }
      paintLinkUnderline(ctx, row, hoveredLink, snapshot.cols, cellMetrics);
    }

    if (snapshot.cursor.visible && cursorOn) {
      paintCursor(ctx, snapshot, cellMetrics);
    }

    prevSnapshotRef.current = snapshot;
    prevSelectionRef.current = selection;
    prevMatchesKeyRef.current = matchesKey;
    prevHoveredLinkRef.current = hoveredLink;
    prevCursorRef.current = { row: cursor.row, col: cursor.col };
    prevCursorOnRef.current = cursorOn;
  }, [
    snapshot,
    cellMetrics,
    fontFamily,
    fontSize,
    cursorOn,
    selection,
    searchMatches,
    activeSearchMatch,
    hoveredLink,
  ]);

  useEffect(() => {
    if (!snapshot?.cursor.blinking) {
      setCursorOn(true);
      return;
    }
    const id = window.setInterval(() => setCursorOn((v) => !v), 500);
    return () => window.clearInterval(id);
  }, [snapshot?.cursor.blinking]);

  // Auto-focus the canvas the first time the terminal is mounted so the user
  // can type immediately without first clicking. Only fires once per mount —
  // subsequent renders do not steal focus from other widgets.
  const autoFocusedRef = useRef(false);
  useEffect(() => {
    if (autoFocusedRef.current) return;
    const el = inputEl;
    if (!el) return;
    autoFocusedRef.current = true;
    el.focus();
  }, [inputEl]);

  return (
    <canvas
      ref={(node) => {
        canvasRef.current = node;
        setInputEl(node);
      }}
      width={canvasWidth}
      height={canvasHeight}
      className={className}
      data-testid="terminal-canvas"
      data-terminal-id={terminalId}
      tabIndex={0}
      style={{
        width: `${canvasWidth}px`,
        height: `${canvasHeight}px`,
        background: DEFAULT_BG,
        imageRendering: "pixelated",
        outline: "none",
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

function buildMatchesKey(
  matches: readonly SearchMatch[] | undefined,
  active: SearchMatch | null | undefined,
): string {
  if (!matches || matches.length === 0) return active ? "@active" : "";
  let s = "";
  for (const m of matches) s += `${m.row},${m.startCol},${m.endCol};`;
  if (active) s += `@${active.row},${active.startCol},${active.endCol}`;
  return s;
}

function buildRowMask(
  matches: readonly SearchMatch[] | undefined,
  active: SearchMatch | null | undefined,
  totalRows: number,
): Set<number> {
  const rows = new Set<number>();
  if (matches) {
    for (const m of matches) {
      if (m.row >= 0 && m.row < totalRows) rows.add(m.row);
    }
  }
  if (active && active.row >= 0 && active.row < totalRows) rows.add(active.row);
  return rows;
}

function rowsCoveredByLink(
  ...links: Array<LinkSpan | null | undefined>
): Set<number> {
  const rows = new Set<number>();
  for (const link of links) {
    if (!link) continue;
    for (let r = link.startRow; r <= link.endRow; r++) rows.add(r);
  }
  return rows;
}

function paintSearchBands(
  ctx: CanvasRenderingContext2D,
  row: number,
  matches: readonly SearchMatch[] | undefined,
  active: SearchMatch | null | undefined,
  metrics: CellMetrics,
) {
  if (!matches || matches.length === 0) return;
  for (const m of matches) {
    if (m.row !== row) continue;
    const isActive =
      !!active &&
      active.row === m.row &&
      active.startCol === m.startCol &&
      active.endCol === m.endCol;
    const { width, height } = metrics;
    const x = m.startCol * width;
    const y = m.row * height;
    const w = (m.endCol - m.startCol + 1) * width;
    if (w <= 0) continue;
    ctx.save();
    ctx.globalAlpha = isActive ? 0.65 : 0.4;
    ctx.fillStyle = isActive ? SEARCH_ACTIVE_BG : SEARCH_MATCH_BG;
    ctx.fillRect(x, y, w, height);
    ctx.restore();
  }
}

function paintLinkUnderline(
  ctx: CanvasRenderingContext2D,
  row: number,
  link: LinkSpan | null,
  totalCols: number,
  metrics: CellMetrics,
) {
  if (!link) return;
  if (row < link.startRow || row > link.endRow) return;
  const startCol = row === link.startRow ? link.startCol : 0;
  const endColExclusive =
    row === link.endRow ? link.endCol + 1 : totalCols;
  const { width, height } = metrics;
  const x = startCol * width;
  const y = row * height;
  const w = (endColExclusive - startCol) * width;
  if (w <= 0) return;
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.fillStyle = LINK_HOVER_FG;
  ctx.fillRect(x, y + height - 1, w, 1);
  ctx.restore();
}

function paintSelectionBand(
  ctx: CanvasRenderingContext2D,
  row: number,
  band: { startCol: number; endColExclusive: number },
  { width, height }: CellMetrics,
) {
  const x = band.startCol * width;
  const y = row * height;
  const w = (band.endColExclusive - band.startCol) * width;
  if (w <= 0) return;
  ctx.save();
  ctx.globalAlpha = 0.45;
  ctx.fillStyle = SELECTION_BG;
  ctx.fillRect(x, y, w, height);
  ctx.restore();
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
