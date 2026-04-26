import { openUrl as tauriOpenUrl } from "@tauri-apps/plugin-opener";
import { ChevronDown } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { findNextPromptMark, findPrevPromptMark, useScrollback } from "../../shared/hooks/useScrollback";
import { useTerminalSnapshot } from "../../shared/hooks/useTerminalSnapshot";
import { usePromptMarks } from "../../shared/hooks/usePromptMarks";
import { useTerminalImages } from "../../shared/hooks/useTerminalImages";
import {
  CURSOR_COLOR,
  DEFAULT_BG,
  DEFAULT_FG,
  isDefaultBg,
  LINK_HOVER_FG,
  resolveColor,
  SEARCH_ACTIVE_BG,
  SEARCH_MATCH_BG,
  SELECTION_BG,
} from "../../shared/lib/ansiPalette";
import {
  CellAttr,
  type CellSnapshot,
  type GridSnapshot,
  hasAttr,
  type ImageRef,
} from "../../shared/types/terminal";
import { useCanvasIME, useImePosition, type WriteBytesFn } from "./hooks/useCanvasIME";
import { type CopyTextFn, useTerminalSelection } from "./hooks/useTerminalSelection";
import { pixelToCell } from "./keymap";
import { type LinkSpan, linkAt, scanLinks } from "./links";
import type { AnyMatch } from "./search";
import { viewportRowOf } from "./search";
import { rowSelection, type SelectionRange } from "./selection";

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
 * Canvas 2D terminal renderer with full ANSI attr + color.
 *
 * Subscribes to `useTerminalSnapshot` and paints the grid cell-by-cell.
 * Only rows whose cell arrays are not reference-equal to the previous
 * render are repainted (`applyDiff` preserves refs for untouched rows).
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
  /** Search matches to highlight with a dim yellow band. Accepts
   *  both live-grid hits and history hits — `viewportRowOf` decides
   *  which row each one paints on inside the composite viewport. */
  searchMatches?: readonly AnyMatch[];
  /** Active match gets a brighter band on top of the dim highlight. */
  activeSearchMatch?: AnyMatch | null;
  /** Invoked on Ctrl+Click over a detected URL. */
  onOpenUrl?: OpenUrlFn;
  /** Fish-style suggestion to paint after the cursor (Phase 3A-2). */
  ghostSuggestion?: string | null;
  /** Exposes the underlying canvas element so parents can attach input
   *  mirrors (Phase 3A-2) without duplicating the ref forwarding. */
  onCanvasRef?: (el: HTMLCanvasElement | null) => void;
  /** Exposes the hidden IME textarea so parents can attach keystroke
   *  observers (ghost-text mirror, history trackers). The textarea is the
   *  true "keyboard input element" since Phase B of the native-IME work —
   *  the canvas itself no longer receives keydowns. */
  onInputRef?: (el: HTMLTextAreaElement | null) => void;
  /**
   * Hands the parent a bundle of scrollback navigation actions. Called
   * with the same bundle on every prompt-mark or scroll-state change —
   * the parent should stash the latest in a ref and invoke from its
   * global keybinding handler. Called with `null` on unmount so the
   * parent's ref clears cleanly.
   */
  onRegisterNav?: (nav: TerminalNav | null) => void;
}

export interface TerminalNav {
  jumpToPrevPrompt(): void;
  jumpToNextPrompt(): void;
  scrollToLive(): void;
  hasHistory(): boolean;
  /** Set the scrollback offset directly. Used by Ctrl+F navigation
   *  so the parent can land on a history match without owning the
   *  scrollback hook. */
  scrollToOffset(offset: number): void;
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
  /* IBM Plex Mono carries no CJK glyphs, so without an explicit
   * Japanese / Chinese / Korean monospace fallback the browser
   * substitutes a system proportional font (Yu Gothic / Meiryo on
   * Windows, Hiragino Kaku Gothic on macOS) whose advance is wider
   * than our 2-cell `WIDE_CHAR` slot — neighbour cells overpaint
   * each other and produce the garbled "あなたCycle Master" rendering
   * the dogfood screenshot caught (2026-05-03). The fallback chain
   * preferences fonts that are genuinely monospace at full-width:
   * Cascadia Code (limited CJK), then Windows-installed BIZ UDGothic
   * / Yu Gothic UI / Meiryo (monospace at common sizes), then Linux
   * Noto Sans Mono CJK, finally generic monospace. */
  fontFamily = "'IBM Plex Mono', 'Cascadia Code', 'BIZ UDGothic', 'Yu Gothic UI', 'Meiryo', 'Noto Sans Mono CJK JP', monospace",
  className,
  snapshotOverride,
  writeBytes,
  copyText,
  searchMatches,
  activeSearchMatch,
  onOpenUrl = defaultOpenUrl,
  ghostSuggestion,
  onCanvasRef,
  onInputRef,
  onRegisterNav,
}: TerminalCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [canvasEl, setCanvasEl] = useState<HTMLCanvasElement | null>(null);
  const [textareaEl, setTextareaEl] = useState<HTMLTextAreaElement | null>(null);
  // Alias kept so existing mouse-related effects (selection, link hover)
  // read the canvas element under their original name.
  const inputEl = canvasEl;
  const prevSnapshotRef = useRef<GridSnapshot | null>(null);
  const prevSelectionRef = useRef<SelectionRange | null>(null);
  const prevMatchesKeyRef = useRef<string>("");
  const prevHoveredLinkRef = useRef<LinkSpan | null>(null);
  const prevCursorRef = useRef<{ row: number; col: number } | null>(null);
  const prevCursorOnRef = useRef<boolean>(true);
  const prevGhostRef = useRef<string>("");
  const [hoveredLink, setHoveredLink] = useState<LinkSpan | null>(null);

  useCanvasIME({ terminalId, textarea: textareaEl, writeBytes });
  const liveSnapshot = useTerminalSnapshot(snapshotOverride === undefined ? terminalId : null);
  const snapshot = snapshotOverride !== undefined ? snapshotOverride : liveSnapshot;
  // Inline image overlays — fetched + cached as ImageBitmap by id. The
  // hook silently no-ops when `terminalId` is null (test fixtures inject
  // snapshots directly without a real backend).
  const imageBitmaps = useTerminalImages(
    snapshotOverride !== undefined ? null : terminalId,
    snapshot?.images,
  );
  // Scrollback: feed it the *live-source* terminal id so the test path
  // (snapshotOverride) never reaches out to IPC.
  const scrollbackTerminalId = snapshotOverride !== undefined ? null : terminalId;
  const scrollback = useScrollback(scrollbackTerminalId, snapshot);
  const scrolledUp = scrollback.scrollOffset > 0;
  const promptMarks = usePromptMarks(scrollbackTerminalId);

  // Re-export a stable-identity nav bundle so the parent can drive
  // scrollback navigation from global keybindings without entangling its
  // state with this component's lifecycle.
  useEffect(() => {
    if (!onRegisterNav) return;
    const nav: TerminalNav = {
      jumpToPrevPrompt: () => {
        const mark = findPrevPromptMark(
          promptMarks,
          scrollback.scrollOffset,
          scrollback.historySize,
        );
        if (mark) scrollback.scrollToMark(mark);
      },
      jumpToNextPrompt: () => {
        const mark = findNextPromptMark(
          promptMarks,
          scrollback.scrollOffset,
          scrollback.historySize,
        );
        if (mark) {
          scrollback.scrollToMark(mark);
        } else {
          // No more marks below — returning to the live screen matches
          // the Warp / iTerm2 convention.
          scrollback.scrollToLive();
        }
      },
      scrollToLive: () => scrollback.scrollToLive(),
      hasHistory: () => scrollback.historySize > 0,
      scrollToOffset: (offset: number) => scrollback.scrollToOffset(offset),
    };
    onRegisterNav(nav);
    return () => onRegisterNav(null);
  }, [onRegisterNav, promptMarks, scrollback]);

  useEffect(() => {
    onInputRef?.(textareaEl);
    return () => onInputRef?.(null);
  }, [textareaEl, onInputRef]);

  const [cursorOn, setCursorOn] = useState(true);

  const cellMetrics: CellMetrics = useMemo(() => {
    /* The previous heuristic — `Math.round(fontSize * 0.6)` — produced
     * 8 px at fontSize 14. The real IBM Plex Mono advance at 14 px is
     * **8.4 px**, so every `ctx.fillText(ch, col * 8, …)` call drew
     * ASCII glyphs that visually rendered 8.4 px wide; after ~30 cells
     * the cumulative 0.4-px drift compounded into ~12 px of overlap,
     * which dogfood (2026-05-03) caught as "ターミナルの品質が悪い"
     * with mangled CJK text. Measuring the font via `ctx.measureText`
     * uses the exact advance instead — sub-pixel positioning is
     * fine, browsers rasterise glyphs at fractional X without
     * blurring monospace columns. */
    let width = fontSize * 0.6;
    if (typeof document !== "undefined") {
      const probe = document.createElement("canvas").getContext("2d");
      if (probe) {
        probe.font = `${fontSize}px ${fontFamily}`;
        const measured = probe.measureText("M").width;
        if (measured > 0) width = measured;
      }
    }
    const height = Math.round(fontSize * 1.25);
    return { width, height };
  }, [fontSize, fontFamily]);

  const canvasWidth = cols * cellMetrics.width;
  const canvasHeight = rows * cellMetrics.height;
  /* `<canvas width=…>` is the bitmap backing-store size and must be
   * an integer; CSS layout can stay fractional. With `cellMetrics.
   * width` now being the measured `Mw`-advance (e.g. 8.4 at
   * fontSize=14), `canvasWidth` is fractional, so we ceil to make
   * sure the rightmost column doesn't get clipped a fraction of a
   * pixel short. */
  const canvasBitmapWidth = Math.ceil(canvasWidth);
  const canvasBitmapHeight = Math.ceil(canvasHeight);

  const {
    selection,
    clear: clearSelection,
    copy,
  } = useTerminalSelection({
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

  // Mouse-wheel scrollback. Positive deltaY (wheel-down) pulls the
  // viewport toward the live screen; negative deltaY (wheel-up) reveals
  // older history. We call `preventDefault` unconditionally so the app
  // window never scrolls as a side effect of scrolling a terminal pane.
  useEffect(() => {
    const el = inputEl;
    if (!el) return;
    const onWheel = (ev: WheelEvent) => {
      // Normalise to cell rows. deltaMode 1 (line) and 0 (pixel) are the
      // only modes browsers emit in practice on mouse wheels / trackpads.
      const pixelsPerRow = cellMetrics.height || 18;
      const rowsPerLine = 3;
      const deltaRows =
        ev.deltaMode === 1
          ? Math.round(ev.deltaY) * rowsPerLine
          : Math.round(ev.deltaY / pixelsPerRow);
      if (deltaRows === 0) return;
      ev.preventDefault();
      scrollback.scrollBy(-deltaRows);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [inputEl, cellMetrics.height, scrollback]);

  // Selection clears the moment the user types a character. After Phase B
  // the textarea owns keydown (the canvas is focus-forwarded), so these
  // listeners must attach to the textarea — binding to the canvas would
  // silently break.
  useEffect(() => {
    if (!textareaEl) return;
    const clearOnType = (ev: KeyboardEvent) => {
      if (ev.ctrlKey && ev.shiftKey) return;
      if (!selection) return;
      clearSelection();
    };
    textareaEl.addEventListener("keydown", clearOnType);
    return () => textareaEl.removeEventListener("keydown", clearOnType);
  }, [textareaEl, selection, clearSelection]);

  useEffect(() => {
    if (!textareaEl) return;
    const handler = (ev: KeyboardEvent) => {
      if (ev.ctrlKey && ev.shiftKey && (ev.key === "c" || ev.key === "C")) {
        if (!selection) return;
        ev.preventDefault();
        ev.stopPropagation();
        void copy();
      }
    };
    textareaEl.addEventListener("keydown", handler);
    return () => textareaEl.removeEventListener("keydown", handler);
  }, [textareaEl, selection, copy]);

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
    const dimsChanged = !prev || prev.cols !== snapshot.cols || prev.rows !== snapshot.rows;
    const prevSel = prevSelectionRef.current;
    const selectionChanged = prevSel !== selection;
    const matchesKey = buildMatchesKey(searchMatches, activeSearchMatch, scrollback.scrollOffset);
    const matchesChanged = matchesKey !== prevMatchesKeyRef.current;
    const prevHover = prevHoveredLinkRef.current;
    const hoverChanged = prevHover !== hoveredLink;
    const prevCursor = prevCursorRef.current;
    const cursor = snapshot.cursor;
    const cursorMoved = !prevCursor || prevCursor.row !== cursor.row || prevCursor.col !== cursor.col;
    const cursorBlinkToggled = prevCursorOnRef.current !== cursorOn;
    const cursorDirtyRows = new Set<number>();
    if (cursorMoved || cursorBlinkToggled) {
      if (prevCursor) cursorDirtyRows.add(prevCursor.row);
      cursorDirtyRows.add(cursor.row);
    }
    // The ghost suggestion lives on the cursor row; any change to its
    // string flips that row dirty so the trailing glyph count is correct.
    const ghost = ghostSuggestion ?? "";
    const ghostChanged = ghost !== prevGhostRef.current;
    if (ghostChanged) cursorDirtyRows.add(cursor.row);

    ctx.textBaseline = "top";

    if (dimsChanged) {
      ctx.fillStyle = DEFAULT_BG;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    const affectedBySearch = buildRowMask(
      searchMatches,
      activeSearchMatch,
      snapshot.rows,
      scrollback.scrollOffset,
    );
    const affectedByHover = rowsCoveredByLink(hoveredLink, prevHover);

    // When the viewport is in scrollback, use the composed grid (history
    // rows on top, live rows below). Overlays (selection / search /
    // hover / cursor / ghost) are anchored to the live coordinate system,
    // so we suppress them here; returning to `scrollToLive()` reinstates
    // every overlay at once.
    const viewCells = scrolledUp && scrollback.compositeCells
      ? scrollback.compositeCells
      : snapshot.cells;

    for (let row = 0; row < snapshot.rows; row++) {
      const rowCells = viewCells[row];
      const inOld = prevSel ? rowSelection(row, prevSel, snapshot.cols) : null;
      const inNew = !scrolledUp && selection ? rowSelection(row, selection, snapshot.cols) : null;
      const selDirtyRow = selectionChanged && (inOld !== null || inNew !== null);
      const matchDirtyRow = matchesChanged && affectedBySearch.has(row);
      const hoverDirtyRow = hoverChanged && affectedByHover.has(row);
      const cursorDirtyRow = cursorDirtyRows.has(row);
      // Composite rows are freshly allocated each scroll tick, so
      // ref-equality never short-circuits while scrolled up — which is
      // exactly what we want (the whole viewport must repaint).
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
      // Search bands paint over both live and history rows — viewportRowOf
      // does the routing so a history match becomes visible the moment the
      // user scrolls its row into view.
      paintSearchBands(
        ctx,
        row,
        searchMatches,
        activeSearchMatch,
        cellMetrics,
        snapshot.rows,
        scrollback.scrollOffset,
      );
      if (!scrolledUp) {
        if (inNew) {
          paintSelectionBand(ctx, row, inNew, cellMetrics);
        }
        paintLinkUnderline(ctx, row, hoveredLink, snapshot.cols, cellMetrics);
      }
    }

    // Ghost suggestion band — paint BEFORE the cursor so the cursor block
    // (if block-shape) covers its first glyph just like on a real shell.
    if (!scrolledUp && ghost && !hasPrintableAfterCursor(snapshot)) {
      paintGhostSuggestion(ctx, snapshot, ghost, cellMetrics, fontSize, fontFamily);
    }

    // Cursor only makes sense on the live view — suppress it when
    // scrolled up so users don't mistake scrollback content for the
    // active prompt line.
    if (!scrolledUp && snapshot.cursor.visible && cursorOn) {
      paintCursor(ctx, snapshot, cellMetrics);
    }

    // Inline image overlays last so they sit on top of cell glyphs
    // and the cursor — Kitty's protocol contract is that the image
    // owns the cell rectangle it occupies. Suppressed during scrollback
    // for the same reason as other live overlays: the snapshot's image
    // anchors are live-grid coordinates and would mis-render on the
    // composite scrollback view.
    if (!scrolledUp && snapshot.images && snapshot.images.length > 0) {
      paintImages(ctx, snapshot.images, imageBitmaps, cellMetrics);
    }

    prevSnapshotRef.current = snapshot;
    prevSelectionRef.current = selection;
    prevMatchesKeyRef.current = matchesKey;
    prevHoveredLinkRef.current = hoveredLink;
    prevCursorRef.current = { row: cursor.row, col: cursor.col };
    prevCursorOnRef.current = cursorOn;
    prevGhostRef.current = ghost;
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
    ghostSuggestion,
    imageBitmaps,
  ]);

  useEffect(() => {
    if (!snapshot?.cursor.blinking) {
      setCursorOn(true);
      return;
    }
    /* `prefers-reduced-motion: reduce` users opt out of blink — a
     * solid cursor is more comfortable for vestibular / attention
     * sensitivity, and matches what every accessible-mode terminal
     * (macOS Terminal, iTerm2, Windows Terminal) does. */
    const reduce = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      setCursorOn(true);
      return;
    }
    /* Apple-style asymmetric duty cycle — the cursor is visible far
     * longer than it is hidden so the user's eye treats it as
     * "always there, just briefly winking", rather than the jarring
     * 50/50 strobe the previous 500/500 ms cycle produced. The
     * pattern toggles ON for 600 ms, OFF for 250 ms, repeat. */
    const ON_MS = 600;
    const OFF_MS = 250;
    let visible = true;
    setCursorOn(true);
    let timer = window.setTimeout(function tick() {
      visible = !visible;
      setCursorOn(visible);
      timer = window.setTimeout(tick, visible ? ON_MS : OFF_MS);
    }, ON_MS);
    return () => window.clearTimeout(timer);
  }, [snapshot?.cursor.blinking]);

  // Auto-focus the invisible textarea the first time the terminal is mounted
  // so the user can type immediately without first clicking. Only fires once
  // per mount — subsequent renders do not steal focus from other widgets.
  const autoFocusedRef = useRef(false);
  useEffect(() => {
    if (autoFocusedRef.current) return;
    if (!textareaEl) return;
    autoFocusedRef.current = true;
    textareaEl.focus();
  }, [textareaEl]);

  // Keep the hidden textarea parked at the cursor position and tell Windows
  // where to anchor the IME candidate window.
  useImePosition({
    textarea: textareaEl,
    cursor: snapshot?.cursor ? { row: snapshot.cursor.row, col: snapshot.cursor.col } : null,
    cellWidth: cellMetrics.width,
    cellHeight: cellMetrics.height,
    canvas: canvasEl,
  });

  const focusTextarea = useCallback(() => {
    textareaEl?.focus();
  }, [textareaEl]);

  return (
    <div
      className={className}
      style={{
        position: "relative",
        width: `${canvasWidth}px`,
        height: `${canvasHeight}px`,
        outline: "none",
      }}
      // Keep the pane reachable via Tab by making the container the
      // focus-target: its `onFocus` forwards into the hidden textarea so
      // the keyboard-input element gets focus in one hop. `mousedown`
      // covers click-to-type since the canvas itself is no longer natively
      // focusable (see canvas `tabIndex={-1}` below).
      tabIndex={0}
      onFocus={focusTextarea}
      onMouseDown={focusTextarea}
    >
      <canvas
        ref={(node) => {
          canvasRef.current = node;
          setCanvasEl(node);
          onCanvasRef?.(node);
        }}
        width={canvasBitmapWidth}
        height={canvasBitmapHeight}
        data-testid="terminal-canvas"
        data-terminal-id={terminalId}
        // `-1` keeps the canvas programmatically focus-able (tests /
        // external `canvas.focus()` callers still work and flow through
        // `onFocus` to the textarea) without giving it native click-to-
        // focus behaviour that would fight the container's focus-forward.
        tabIndex={-1}
        onFocus={focusTextarea}
        style={{
          display: "block",
          width: `${canvasWidth}px`,
          height: `${canvasHeight}px`,
          background: DEFAULT_BG,
          imageRendering: "pixelated",
          outline: "none",
        }}
      />
      {/*
        Hidden IME textarea. `aria-hidden` + explicit offscreen placement
        hides it from screen readers and the visible layout; `opacity: 0`
        + `pointer-events: none` keeps it invisible and non-blocking to
        mouse selection on the canvas. Its `left`/`top` style is updated
        by `useImePosition` so IME candidate windows anchor at the caret.
      */}
      <textarea
        ref={setTextareaEl}
        data-testid="terminal-ime-textarea"
        aria-hidden="true"
        tabIndex={-1}
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: `${cellMetrics.width}px`,
          height: `${cellMetrics.height}px`,
          opacity: 0,
          pointerEvents: "none",
          border: "none",
          outline: "none",
          resize: "none",
          background: "transparent",
          color: "transparent",
          // Match the rendered font so the IME candidate sizing matches.
          fontFamily,
          fontSize: `${fontSize}px`,
          lineHeight: `${cellMetrics.height}px`,
          padding: 0,
          margin: 0,
          overflow: "hidden",
          // Caret would flash in the wrong position; hide it.
          caretColor: "transparent",
        }}
      />
      {/* "Jump to live" pill — only renders while the user is in
       * scrollback (scrollOffset > 0). Without this the only way back
       * to the live tail was the Ctrl+Shift+End keybinding the
       * NativeTerminalArea registers, which is invisible to anyone
       * who hasn't read the docs. The pill duplicates the same
       * action with a discoverable affordance, anchored bottom-right
       * inside the canvas's relative wrapper. */}
      {scrolledUp && (
        <button
          type="button"
          onClick={() => scrollback.scrollToLive()}
          aria-label="Jump to live tail"
          title="Jump to live tail (Ctrl+Shift+End)"
          style={{
            position: "absolute",
            right: 12,
            bottom: 12,
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            padding: "4px 10px",
            background: "rgba(200, 160, 80, 0.18)",
            border: "1px solid rgba(200, 160, 80, 0.4)",
            borderRadius: 999,
            color: "#c8a050",
            fontSize: 11,
            fontFamily: "inherit",
            cursor: "pointer",
            backdropFilter: "blur(8px)",
            WebkitBackdropFilter: "blur(8px)",
            zIndex: 2,
          }}
        >
          <ChevronDown size={12} aria-hidden="true" />
          Live
        </button>
      )}
    </div>
  );
}

function buildFont(cell: CellSnapshot, fontSize: number, fontFamily: string): string {
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
    /* `maxWidth` clamps glyph advance to the cell's logical width,
     * so even when the browser substitutes a non-monospace CJK font
     * the glyph compresses into 2 columns instead of bleeding into
     * the neighbour cell. Without this the dogfood screenshot
     * (2026-05-03) showed Japanese characters overlapping each other
     * across an otherwise correctly-sized grid. */
    ctx.fillText(ch, x, y + 1, cellW);

    drawDecorations(ctx, cell, x, y, cellW, height, fgCss, dim);
  }
  ctx.globalAlpha = 1;
}

/* Single source of truth for the "underline" baseline (character
 * underline, link-hover underline, cursor's underline-shape). All
 * three previously rendered at slightly different y offsets — the
 * link rule was 1 px lower than the character rule, and the cursor
 * shape was 2 px tall instead of 1 — so a hovered link sitting on
 * an SGR-underlined word produced a visible double-bar. */
const UNDERLINE_INSET_FROM_BOTTOM = 2;

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
  if (underline) ctx.fillRect(x, y + cellH - UNDERLINE_INSET_FROM_BOTTOM, cellW, 1);
  if (strike) ctx.fillRect(x, y + Math.round(cellH / 2), cellW, 1);
}

function matchAnchor(m: AnyMatch): string {
  return m.kind === "history"
    ? `h:${m.historyIndex},${m.startCol},${m.endCol}`
    : `l:${m.row},${m.startCol},${m.endCol}`;
}

function buildMatchesKey(
  matches: readonly AnyMatch[] | undefined,
  active: AnyMatch | null | undefined,
  scrollOffset: number,
): string {
  // The scroll offset is part of the cache key because viewport rows
  // shift as the user scrolls — a match that was painted on row 5 at
  // offset 0 paints on row 6 once the offset advances by 1.
  let s = `s:${scrollOffset};`;
  if (matches) {
    for (const m of matches) s += `${matchAnchor(m)};`;
  }
  if (active) s += `@${matchAnchor(active)}`;
  return s;
}

function buildRowMask(
  matches: readonly AnyMatch[] | undefined,
  active: AnyMatch | null | undefined,
  totalRows: number,
  scrollOffset: number,
): Set<number> {
  const rows = new Set<number>();
  if (matches) {
    for (const m of matches) {
      const vr = viewportRowOf(m, totalRows, scrollOffset);
      if (vr !== null) rows.add(vr);
    }
  }
  if (active) {
    const vr = viewportRowOf(active, totalRows, scrollOffset);
    if (vr !== null) rows.add(vr);
  }
  return rows;
}

function rowsCoveredByLink(...links: Array<LinkSpan | null | undefined>): Set<number> {
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
  matches: readonly AnyMatch[] | undefined,
  active: AnyMatch | null | undefined,
  metrics: CellMetrics,
  totalRows: number,
  scrollOffset: number,
) {
  if (!matches || matches.length === 0) return;
  const activeKey = active ? matchAnchor(active) : null;
  for (const m of matches) {
    const vr = viewportRowOf(m, totalRows, scrollOffset);
    if (vr !== row) continue;
    const isActive = activeKey !== null && matchAnchor(m) === activeKey;
    const { width, height } = metrics;
    const x = m.startCol * width;
    const y = vr * height;
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
  const endColExclusive = row === link.endRow ? link.endCol + 1 : totalCols;
  const { width, height } = metrics;
  const x = startCol * width;
  const y = row * height;
  const w = (endColExclusive - startCol) * width;
  if (w <= 0) return;
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.fillStyle = LINK_HOVER_FG;
  /* Match `drawDecorations`'s SGR-underline baseline so a hovered
   * link on an already-underlined word doesn't render a visible
   * second bar 1 px lower than the first. */
  ctx.fillRect(x, y + height - UNDERLINE_INSET_FROM_BOTTOM, w, 1);
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

/** Any printable glyph to the right of the cursor on its row? */
function hasPrintableAfterCursor(snapshot: GridSnapshot): boolean {
  const row = snapshot.cells[snapshot.cursor.row];
  if (!row) return false;
  for (let col = snapshot.cursor.col; col < row.length; col++) {
    const cell = row[col];
    if (!cell) continue;
    if (cell.ch && cell.ch !== " " && cell.ch !== "\0") return true;
  }
  return false;
}

function paintGhostSuggestion(
  ctx: CanvasRenderingContext2D,
  snapshot: GridSnapshot,
  text: string,
  { width, height }: CellMetrics,
  fontSize: number,
  fontFamily: string,
) {
  const { row, col } = snapshot.cursor;
  const y = row * height;
  ctx.save();
  ctx.globalAlpha = 0.45;
  /* Use the palette's named foreground constant so a future theme
   * swap (or an unbundled-build hex audit) doesn't have to chase
   * a stray hex literal here. Same value, named source. */
  ctx.fillStyle = DEFAULT_FG;
  ctx.font = `${fontSize}px ${fontFamily}`;
  ctx.textBaseline = "top";
  let x = col * width;
  for (const ch of text) {
    // Stop drawing if we would overflow the row — shells wrap the echoed
    // acceptance on their own; we only hint inline.
    if (x >= snapshot.cols * width) break;
    /* `maxWidth` clamps a glyph to one cell so CJK fallback fonts
     * don't bleed into the neighbour ghost-text cell. */
    ctx.fillText(ch, x, y + 1, width);
    x += width;
  }
  ctx.restore();
}

/**
 * Paint inline image overlays. Each entry is anchored at its
 * `(cellRow, cellCol)` and stretched to `(cellW × cellH)` cells when
 * the source declared an explicit cell rectangle (Kitty `c=` / `r=`),
 * otherwise the rectangle is computed from `widthPx / heightPx` divided
 * by the live cell metrics.
 *
 * Entries whose `id` has not yet resolved in `bitmaps` are silently
 * skipped — the bitmap cache fills lazily as IPC fetches complete and
 * the next paint pass picks them up.
 *
 * v1 keeps the rendering deliberately minimal: integer cell rectangles,
 * `drawImage` scaled to the rectangle, no sub-pixel placement, no alpha
 * compositing tweaks, no clipping at the live screen edge (the snapshot
 * already filtered by anchor-row, but a wide image at row N could
 * extend past row N+rows; that's a future polish item).
 */
function paintImages(
  ctx: CanvasRenderingContext2D,
  images: readonly ImageRef[],
  bitmaps: ReadonlyMap<number, ImageBitmap>,
  { width, height }: CellMetrics,
) {
  for (const ref of images) {
    const bmp = bitmaps.get(ref.id);
    if (!bmp) continue;
    const cellW = ref.cellW ?? Math.max(1, Math.ceil(ref.widthPx / width));
    const cellH = ref.cellH ?? Math.max(1, Math.ceil(ref.heightPx / height));
    const x = ref.cellCol * width;
    const y = ref.cellRow * height;
    ctx.drawImage(bmp, x, y, cellW * width, cellH * height);
  }
}

function paintCursor(ctx: CanvasRenderingContext2D, snapshot: GridSnapshot, { width, height }: CellMetrics) {
  const { row, col, shape } = snapshot.cursor;
  if (shape === "hidden") return;
  const x = col * width;
  const y = row * height;
  ctx.globalAlpha = 1;
  ctx.fillStyle = CURSOR_COLOR;
  switch (shape) {
    case "block": {
      ctx.fillRect(x, y, width, height);
      const cell = snapshot.cells[row]?.[col];
      if (cell && cell.ch !== " ") {
        ctx.fillStyle = DEFAULT_BG;
        /* Cursor-cell glyph respects the cell's wide-char status so a
         * CJK char under the cursor still occupies its 2-column slot
         * without spilling. */
        const wide = hasAttr(cell, CellAttr.WIDE_CHAR);
        ctx.fillText(cell.ch, x, y + 1, wide ? width * 2 : width);
      }
      return;
    }
    case "hollowBlock": {
      /* Alacritty emits HollowBlock when the OS focus leaves our
       * terminal — `block` and `hollowBlock` previously rendered
       * identically, which silently dropped the focus signal. A 1-px
       * outline matches the convention every modern terminal
       * (iTerm2, Terminal.app, Windows Terminal, Wezterm) uses for
       * "I'm not the keyboard target right now". The 0.5-px inset is
       * needed because canvas strokeRect centres the line on the
       * coordinate, so a 1-px stroke at integer coords would split
       * across two pixels and look fuzzy. */
      ctx.lineWidth = 1;
      ctx.strokeStyle = CURSOR_COLOR;
      ctx.strokeRect(x + 0.5, y + 0.5, width - 1, height - 1);
      return;
    }
    case "underline":
      /* Cursor's underline shape uses the same y baseline as the
       * SGR-underline + link-hover underline so a cursor parked
       * on an underlined word reads as one continuous bar instead
       * of a stacked pair. Height stays 2 px (vs the 1-px decoration
       * underline) so the cursor remains distinguishable. */
      ctx.fillRect(x, y + height - UNDERLINE_INSET_FROM_BOTTOM, width, UNDERLINE_INSET_FROM_BOTTOM);
      return;
    case "beam":
      ctx.fillRect(x, y, 2, height);
      return;
  }
}
