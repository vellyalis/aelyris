import { openUrl as tauriOpenUrl } from "@tauri-apps/plugin-opener";
import { ChevronDown } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePromptMarks } from "../../shared/hooks/usePromptMarks";
import { findNextPromptMark, findPrevPromptMark, useScrollback } from "../../shared/hooks/useScrollback";
import { useTerminalImages } from "../../shared/hooks/useTerminalImages";
import { useTerminalSnapshot } from "../../shared/hooks/useTerminalSnapshot";
import {
  CURSOR_COLOR,
  CURSOR_TEXT_BG,
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
  type CursorSnapshot,
  type GridSnapshot,
  hasAttr,
  type ImageRef,
} from "../../shared/types/terminal";
import { estimateScrollbackMemoryBytes, publishTerminalPerformanceSample } from "../analytics/performanceObservatory";
import {
  clampTerminalCursor,
  IME_DIAGNOSTIC_EVENT,
  IME_DIAGNOSTIC_STORAGE_KEY,
  IME_DIAGNOSTIC_TOGGLE_EVENT,
  type ImeDiagnosticDetail,
  imeCandidateAnchorX,
  imeDiagnosticsEnabled,
  imeTextareaCaretInset,
  imeTextareaAnchorWidth,
  useCanvasIME,
  useImePosition,
  type WriteBytesFn,
} from "./hooks/useCanvasIME";
import { type CopyTextFn, useTerminalSelection } from "./hooks/useTerminalSelection";
import { pixelToCell } from "./keymap";
import { type LinkSpan, linkAt, scanLinks } from "./links";
import type { AnyMatch } from "./search";
import { viewportRowOf } from "./search";
import { rowSelection, type SelectionRange } from "./selection";
import styles from "./TerminalArea.module.css";
import { TERMINAL_FONT_FAMILY, type TerminalCellMetrics, useTerminalCellMetrics } from "./terminalMetrics";

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
 * Uses the parent-owned live snapshot when provided; otherwise subscribes
 * to `useTerminalSnapshot` and paints the grid cell-by-cell.
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
  /**
   * Live snapshot owned by the parent terminal surface. Supplying this keeps
   * one `term:diff-*` subscription per pane while preserving backend extras
   * such as scrollback, prompt marks, and inline image fetching.
   */
  liveSnapshot?: GridSnapshot | null;
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
  /** NativeTerminalArea owns the full P0-15 overlay; standalone canvases keep their local overlay. */
  showInputDiagnosticsOverlay?: boolean;
  /** Fish-style suggestion to paint after the cursor (Phase 3A-2). */
  ghostSuggestion?: string | null;
  /**
   * AI CLIs often draw a full-screen input box and leave the real terminal
   * cursor on a status/footer row. When true, IME composition is anchored to
   * the visible AI input line when we can identify one.
   */
  preferAiInputAnchor?: boolean;
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

type CursorPoint = { row: number; col: number };
type RowTextMap = { text: string; startCols: number[]; endCols: number[] };

const AI_INPUT_PLACEHOLDERS = [
  "Type your message",
  "Ask me anything",
  "Message Codex",
  "Send a message",
  "Enter your prompt",
  "What can I help",
] as const;

const AI_SHORTCUT_HINTS = ["? for shortcuts"] as const;
const AI_PROMPT_MARKERS = new Set([">", "❯", "›", "»", "λ", "→"]);
const AI_INPUT_RIGHT_FRAME_CHARS = new Set(["│", "┃", "║", "▌", "▐", "╎", "┆", "┊", "┋", "╏", "┤", "╮", "╯"]);
const AI_INPUT_MIN_ROW_RATIO = 0.35;
const IME_COMPOSITION_OVERLAY_MAX_CELLS = 34;

function rowToTextMap(row: readonly CellSnapshot[]): RowTextMap {
  const startCols: number[] = [];
  const endCols: number[] = [];
  let text = "";

  for (let col = 0; col < row.length; col++) {
    const cell = row[col];
    if (!cell || hasAttr(cell, CellAttr.WIDE_CHAR_SPACER)) continue;
    const ch = cell.ch && cell.ch !== "\0" ? cell.ch : " ";
    const startIndex = text.length;
    text += ch;
    const endCol = col + (hasAttr(cell, CellAttr.WIDE_CHAR) ? 2 : 1);
    for (let i = startIndex; i < text.length; i++) {
      startCols[i] = col;
      endCols[i] = endCol;
    }
  }

  return { text, startCols, endCols };
}

function lastNonSpaceTextIndex(text: string): number {
  return Math.max(0, text.trimEnd().length);
}

function trimRightFrameIndex(text: string): number {
  let end = text.trimEnd().length;
  while (end > 0 && AI_INPUT_RIGHT_FRAME_CHARS.has(text[end - 1])) {
    end = text.slice(0, end - 1).trimEnd().length;
  }
  return end;
}

function columnAtTextIndex(rowText: RowTextMap, index: number): number {
  if (rowText.text.length === 0) return 0;
  const clamped = Math.min(Math.max(0, index), rowText.text.length - 1);
  return rowText.startCols[clamped] ?? 0;
}

function columnAfterTextIndex(rowText: RowTextMap, index: number): number {
  if (index <= 0 || rowText.text.length === 0) return 0;
  const clamped = Math.min(index - 1, rowText.text.length - 1);
  return rowText.endCols[clamped] ?? 0;
}

function aiPromptInputColumn(rowText: RowTextMap, promptCol: number): number {
  return Math.max(promptCol, columnAfterTextIndex(rowText, trimRightFrameIndex(rowText.text)));
}

function clampColumn(col: number, cols: number): number {
  return Math.min(Math.max(0, col), Math.max(0, cols - 1));
}

function terminalCellSpan(text: string): number {
  let cells = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    cells += code > 0x7f ? 2 : 1;
  }
  return cells;
}

function diagnosticCompositionState(detail: ImeDiagnosticDetail | null): string {
  if (!detail) return "idle";
  if (detail.composing) return "composing";
  if (detail.phase === "blur") return detail.reason === "preserve-composition" ? "blurred-preserved" : "blurred";
  if (detail.phase === "commit") return "committed";
  if (detail.phase === "paste") return "pasted";
  return "idle";
}

function diagnosticWritePath(detail: ImeDiagnosticDetail | null): string {
  if (!detail) return "waiting";
  return detail.writePath ?? detail.phase;
}

function diagnosticLastCommit(detail: ImeDiagnosticDetail | null): string {
  if (!detail?.sentLength) return "none";
  return `${detail.sentLength} char${detail.sentLength === 1 ? "" : "s"}`;
}

function diagnosticCandidateRect(detail: ImeDiagnosticDetail | null, textarea: HTMLTextAreaElement | null): string {
  const x = detail?.candidateLeft ?? textarea?.dataset.imeCandidateX ?? null;
  const y = detail?.candidateTop ?? textarea?.dataset.imeCandidateY ?? null;
  if (!x || !y) return "unset";
  return `${x}, ${y}`;
}

function isVisibleCursor(cursor: CursorSnapshot | null | undefined): cursor is CursorSnapshot {
  return !!cursor && cursor.visible && cursor.shape !== "hidden";
}

function isPromptBoundary(ch: string | undefined): boolean {
  return ch === undefined || ch === " " || ch === "\t" || ch === "│" || ch === "┃" || ch === "╎" || ch === "┆";
}

function findPromptInputColumn(rowText: RowTextMap, beforeIndex = rowText.text.length): number | null {
  const { text } = rowText;
  const limit = Math.min(Math.max(0, beforeIndex), text.length);
  for (let i = 0; i < limit; i++) {
    if (!AI_PROMPT_MARKERS.has(text[i])) continue;
    if (!isPromptBoundary(text[i - 1]) || !isPromptBoundary(text[i + 1])) continue;
    const markerEndCol = columnAfterTextIndex(rowText, i + 1);
    if (text[i + 1] === undefined) return markerEndCol + 1;
    return columnAfterTextIndex(rowText, i + 2);
  }
  return null;
}

export function findAiCliInputAnchor(snapshot: GridSnapshot | null): CursorPoint | null {
  if (!snapshot) return null;

  const minInputRow = Math.max(0, Math.floor(snapshot.cells.length * AI_INPUT_MIN_ROW_RATIO));
  for (let row = snapshot.cells.length - 1; row >= minInputRow; row--) {
    const rowText = rowToTextMap(snapshot.cells[row] ?? []);
    const { text } = rowText;
    for (const placeholder of AI_INPUT_PLACEHOLDERS) {
      const hintIndex = text.indexOf(placeholder);
      if (hintIndex < 0) continue;
      const promptCol = findPromptInputColumn(rowText, hintIndex);
      return { row, col: clampColumn(promptCol ?? columnAtTextIndex(rowText, hintIndex), snapshot.cols) };
    }

    for (const hint of AI_SHORTCUT_HINTS) {
      const hintIndex = text.indexOf(hint);
      if (hintIndex < 0) continue;
      const hintEnd = hintIndex + hint.length + 1;
      const typedEnd = lastNonSpaceTextIndex(text);
      if (typedEnd <= hintEnd) continue;
      return {
        row,
        col: clampColumn(
          Math.max(columnAfterTextIndex(rowText, hintEnd), columnAfterTextIndex(rowText, typedEnd)),
          snapshot.cols,
        ),
      };
    }

    const promptCol = findPromptInputColumn(rowText);
    if (promptCol !== null) {
      return { row, col: clampColumn(aiPromptInputColumn(rowText, promptCol), snapshot.cols) };
    }
  }

  return null;
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
  fontFamily = TERMINAL_FONT_FAMILY,
  className,
  snapshotOverride,
  liveSnapshot: liveSnapshotOverride,
  writeBytes,
  copyText,
  searchMatches,
  activeSearchMatch,
  onOpenUrl = defaultOpenUrl,
  showInputDiagnosticsOverlay = true,
  ghostSuggestion,
  preferAiInputAnchor = false,
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
  const renderPerfRef = useRef({ lastPaintAt: 0, droppedRenderFrames: 0 });
  const [hoveredLink, setHoveredLink] = useState<LinkSpan | null>(null);
  const [compositionText, setCompositionText] = useState("");
  const [diagnosticsVisible, setDiagnosticsVisible] = useState(() =>
    typeof window !== "undefined" ? imeDiagnosticsEnabled(window) : false,
  );
  const [latestImeDiagnostic, setLatestImeDiagnostic] = useState<ImeDiagnosticDetail | null>(null);
  const [droppedKeyCount, setDroppedKeyCount] = useState(0);
  const [diagnosticPaneActive, setDiagnosticPaneActive] = useState(false);

  useCanvasIME({
    terminalId,
    textarea: textareaEl,
    writeBytes,
    onCompositionTextChange: setCompositionText,
  });

  useEffect(() => {
    renderPerfRef.current = { lastPaintAt: 0, droppedRenderFrames: 0 };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const syncVisibility = () => {
      const enabled = imeDiagnosticsEnabled(window);
      setDiagnosticsVisible(enabled);
      if (!enabled) {
        setLatestImeDiagnostic(null);
        setDroppedKeyCount(0);
        setDiagnosticPaneActive(false);
      }
    };
    const onDiagnostic = (event: Event) => {
      const detail = (event as CustomEvent<ImeDiagnosticDetail>).detail;
      if (!detail || detail.terminalId !== terminalId) return;
      setDiagnosticsVisible(true);
      setLatestImeDiagnostic(detail);
      setDiagnosticPaneActive(detail.active);
      if (detail.dropped) {
        setDroppedKeyCount((count) => count + 1);
      }
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === IME_DIAGNOSTIC_STORAGE_KEY) syncVisibility();
    };
    syncVisibility();
    window.addEventListener(IME_DIAGNOSTIC_TOGGLE_EVENT, syncVisibility);
    window.addEventListener(IME_DIAGNOSTIC_EVENT, onDiagnostic as EventListener);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(IME_DIAGNOSTIC_TOGGLE_EVENT, syncVisibility);
      window.removeEventListener(IME_DIAGNOSTIC_EVENT, onDiagnostic as EventListener);
      window.removeEventListener("storage", onStorage);
    };
  }, [terminalId]);

  useEffect(() => {
    if (!textareaEl) {
      setDiagnosticPaneActive(false);
      return;
    }
    const updateFocus = () => setDiagnosticPaneActive(textareaEl.ownerDocument.activeElement === textareaEl);
    updateFocus();
    textareaEl.addEventListener("focus", updateFocus);
    textareaEl.addEventListener("blur", updateFocus);
    return () => {
      textareaEl.removeEventListener("focus", updateFocus);
      textareaEl.removeEventListener("blur", updateFocus);
    };
  }, [textareaEl]);

  const shouldSubscribeToLiveSnapshot = snapshotOverride === undefined && liveSnapshotOverride === undefined;
  const liveSnapshot = useTerminalSnapshot(shouldSubscribeToLiveSnapshot ? terminalId : null);
  const snapshot =
    snapshotOverride !== undefined
      ? snapshotOverride
      : liveSnapshotOverride !== undefined
        ? liveSnapshotOverride
        : liveSnapshot;
  const shouldUseTerminalBackends = snapshotOverride === undefined;
  // Inline image overlays — fetched + cached as ImageBitmap by id. The
  // hook silently no-ops when `terminalId` is null (test fixtures inject
  // snapshots directly without a real backend).
  const imageBitmaps = useTerminalImages(shouldUseTerminalBackends ? terminalId : null, snapshot?.images);
  // Scrollback: feed it the *live-source* terminal id so the test path
  // (snapshotOverride) never reaches out to IPC.
  const scrollbackTerminalId = shouldUseTerminalBackends ? terminalId : null;
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
        const mark = findPrevPromptMark(promptMarks, scrollback.scrollOffset, scrollback.historySize);
        if (mark) scrollback.scrollToMark(mark);
      },
      jumpToNextPrompt: () => {
        const mark = findNextPromptMark(promptMarks, scrollback.scrollOffset, scrollback.historySize);
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

  const cellMetrics = useTerminalCellMetrics(fontSize, fontFamily);

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
      const deltaRows = ev.deltaMode === 1 ? Math.round(ev.deltaY) * rowsPerLine : Math.round(ev.deltaY / pixelsPerRow);
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
      ctx.clearRect?.(0, 0, canvas.width, canvas.height);
      prevSnapshotRef.current = null;
      return;
    }

    const paintStartedAt =
      typeof performance !== "undefined" && typeof performance.now === "function" ? performance.now() : Date.now();
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
      ctx.clearRect?.(0, 0, canvas.width, canvas.height);
    }

    const affectedBySearch = buildRowMask(searchMatches, activeSearchMatch, snapshot.rows, scrollback.scrollOffset);
    const affectedByHover = rowsCoveredByLink(hoveredLink, prevHover);

    // When the viewport is in scrollback, use the composed grid (history
    // rows on top, live rows below). Overlays (selection / search /
    // hover / cursor / ghost) are anchored to the live coordinate system,
    // so we suppress them here; returning to `scrollToLive()` reinstates
    // every overlay at once.
    const viewCells = scrolledUp && scrollback.compositeCells ? scrollback.compositeCells : snapshot.cells;

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
      paintSearchBands(ctx, row, searchMatches, activeSearchMatch, cellMetrics, snapshot.rows, scrollback.scrollOffset);
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

    const paintFinishedAt =
      typeof performance !== "undefined" && typeof performance.now === "function" ? performance.now() : Date.now();
    const lastPaintAt = renderPerfRef.current.lastPaintAt;
    const frameIntervalMs = lastPaintAt > 0 ? paintFinishedAt - lastPaintAt : 0;
    if (frameIntervalMs > 0) {
      const targetFrameMs = 1_000 / 60;
      renderPerfRef.current.droppedRenderFrames += Math.max(0, Math.floor(frameIntervalMs / targetFrameMs) - 1);
    }
    renderPerfRef.current.lastPaintAt = paintFinishedAt;
    publishTerminalPerformanceSample({
      terminalId,
      sampledAt: Date.now(),
      fps: frameIntervalMs > 0 ? Math.min(240, 1_000 / frameIntervalMs) : null,
      frameMs: Math.max(0, paintFinishedAt - paintStartedAt),
      droppedRenderFrames: renderPerfRef.current.droppedRenderFrames,
      renderer: "canvas2d",
      webglFallback: true,
      cols: snapshot.cols,
      rows: snapshot.rows,
      scrollbackRows: scrollback.historySize,
      scrollbackMemoryBytes: estimateScrollbackMemoryBytes(scrollback.historySize, snapshot.cols),
    });

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
    scrolledUp,
    scrollback.scrollOffset,
    scrollback.compositeCells,
    terminalId,
    scrollback.historySize,
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
    const reduce =
      typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
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
  const visibleSnapshotCursor = isVisibleCursor(snapshot?.cursor) ? snapshot.cursor : null;
  const aiCliInputAnchor = preferAiInputAnchor ? findAiCliInputAnchor(snapshot) : null;
  const effectiveImeCursor = preferAiInputAnchor ? (aiCliInputAnchor ?? visibleSnapshotCursor) : visibleSnapshotCursor;
  const imeAnchorMode = preferAiInputAnchor
    ? aiCliInputAnchor
      ? "ai-cli-input"
      : "ai-cli-fallback-cursor"
    : "terminal-cursor";
  useImePosition({
    textarea: textareaEl,
    cursor: effectiveImeCursor,
    cols,
    rows,
    cellWidth: cellMetrics.width,
    cellHeight: cellMetrics.height,
    canvas: canvasEl,
  });

  const focusTextarea = useCallback(() => {
    textareaEl?.focus();
  }, [textareaEl]);

  const compositionCursor = effectiveImeCursor
    ? clampTerminalCursor(effectiveImeCursor, cols, rows)
    : { row: 0, col: 0 };
  const compositionCursorX = compositionCursor.col * cellMetrics.width;
  const compositionCursorY = compositionCursor.row * cellMetrics.height;
  const imeAnchorX = imeCandidateAnchorX(compositionCursorX, canvasWidth);
  const imeAnchorWidth = imeTextareaAnchorWidth(imeAnchorX, canvasWidth);
  const imeCaretInset = imeTextareaCaretInset(compositionCursorX, imeAnchorX, canvasWidth);
  const compositionOverlayCells =
    compositionText.length > 0 ? Math.min(IME_COMPOSITION_OVERLAY_MAX_CELLS, terminalCellSpan(compositionText)) : 1;
  const compositionOverlayWidth =
    compositionText.length > 0
      ? Math.min(canvasWidth, Math.max(cellMetrics.width, compositionOverlayCells * cellMetrics.width))
      : cellMetrics.width;
  const compositionOverlayX =
    compositionText.length > 0
      ? Math.min(compositionCursorX, Math.max(0, canvasWidth - compositionOverlayWidth))
      : compositionCursorX;
  const diagnosticState = diagnosticCompositionState(latestImeDiagnostic);
  const diagnosticPath = diagnosticWritePath(latestImeDiagnostic);
  const diagnosticCommit = diagnosticLastCommit(latestImeDiagnostic);
  const diagnosticCandidate = diagnosticCandidateRect(latestImeDiagnostic, textareaEl);
  const diagnosticAnchor = latestImeDiagnostic?.anchorMode ?? imeAnchorMode;

  return (
    /* biome-ignore lint/a11y/useSemanticElements: The focus target is a canvas-backed terminal surface; the hidden textarea below owns actual IME text entry. */
    <div
      className={className}
      role="textbox"
      aria-label="Terminal input surface"
      aria-multiline="true"
      style={{
        position: "relative",
        width: `${canvasWidth}px`,
        height: `${canvasHeight}px`,
        flex: "0 0 auto",
        outline: "none",
      }}
      tabIndex={0}
      onFocus={(e) => {
        if (e.target === e.currentTarget) focusTextarea();
      }}
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
          background: "var(--terminal-canvas-bg, transparent)",
          imageRendering: "pixelated",
          outline: "none",
        }}
      />
      {/*
        Hidden IME textarea. `aria-hidden` + explicit transparent placement
        hides it from screen readers and the visible layout; `opacity: 0`
        + `pointer-events: none` keeps it invisible and non-blocking to
        mouse selection on the canvas. The real input is parked at a
        candidate-window-safe x coordinate; the visible composition overlay
        below stays at the actual terminal cursor.
      */}
      <textarea
        ref={setTextareaEl}
        data-testid="terminal-ime-textarea"
        data-ime-anchor-mode={imeAnchorMode}
        aria-hidden="true"
        tabIndex={-1}
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        wrap="off"
        style={{
          position: "absolute",
          left: `${imeAnchorX}px`,
          top: `${compositionCursorY}px`,
          // Windows TSF keeps long Japanese composition state in the
          // backing textarea. Give it the remaining canvas runway so
          // long conversion / deletion stays editable. The box may be
          // clamped left near the right rail, but padding keeps the DOM
          // caret at the real terminal cursor so WebView2's native IME
          // path and our explicit set_ime_position path agree.
          width: `${imeAnchorWidth}px`,
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
          boxSizing: "border-box",
          paddingTop: 0,
          paddingRight: 0,
          paddingBottom: 0,
          paddingLeft: `${imeCaretInset}px`,
          margin: 0,
          overflow: "hidden",
          whiteSpace: "pre",
          overflowWrap: "normal",
          // Caret would flash in the wrong position; hide it.
          caretColor: "transparent",
        }}
      />
      {compositionText.length > 0 && (
        <div
          className={styles.imeCompositionOverlay}
          style={{
            left: `${compositionOverlayX}px`,
            top: `${compositionCursorY}px`,
            maxWidth: `min(${IME_COMPOSITION_OVERLAY_MAX_CELLS}ch, ${Math.max(
              cellMetrics.width,
              canvasWidth - compositionOverlayX,
            )}px)`,
            minHeight: `${cellMetrics.height}px`,
            fontFamily,
            fontSize: `${fontSize}px`,
            lineHeight: `${cellMetrics.height}px`,
          }}
          aria-hidden="true"
        >
          {compositionText}
        </div>
      )}
      {diagnosticsVisible && showInputDiagnosticsOverlay && (
        <div className={styles.inputDiagnosticsOverlay} data-testid="terminal-input-diagnostics" aria-live="polite">
          <div className={styles.inputDiagnosticsHeader}>
            <span>IME Diagnostics</span>
            <span>{terminalId}</span>
          </div>
          <dl className={styles.inputDiagnosticsGrid}>
            <div>
              <dt>Target</dt>
              <dd>{diagnosticPaneActive ? "focused" : "unfocused"}</dd>
            </div>
            <div>
              <dt>State</dt>
              <dd>{diagnosticState}</dd>
            </div>
            <div>
              <dt>Write path</dt>
              <dd>{diagnosticPath}</dd>
            </div>
            <div>
              <dt>Event</dt>
              <dd>{latestImeDiagnostic?.phase ?? "waiting"}</dd>
            </div>
            <div>
              <dt>Last commit</dt>
              <dd>{diagnosticCommit}</dd>
            </div>
            <div>
              <dt>Dropped keys</dt>
              <dd>{droppedKeyCount}</dd>
            </div>
            <div>
              <dt>Candidate</dt>
              <dd>{diagnosticCandidate}</dd>
            </div>
            <div>
              <dt>Anchor</dt>
              <dd>{diagnosticAnchor}</dd>
            </div>
          </dl>
        </div>
      )}
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
          className={styles.livePill}
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
  metrics: TerminalCellMetrics,
  fontSize: number,
  fontFamily: string,
) {
  const { width, height } = metrics;
  const y = row * height;

  // Clear to transparent so the terminal inherits the water-dark viewport.
  // Per-cell custom ANSI backgrounds are painted below.
  ctx.globalAlpha = 1;
  ctx.clearRect?.(0, y, cells.length * width, height);

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
  metrics: TerminalCellMetrics,
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
  metrics: TerminalCellMetrics,
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
  { width, height }: TerminalCellMetrics,
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
  { width, height }: TerminalCellMetrics,
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
  { width, height }: TerminalCellMetrics,
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

function paintCursor(ctx: CanvasRenderingContext2D, snapshot: GridSnapshot, { width, height }: TerminalCellMetrics) {
  if (!isVisibleCursor(snapshot.cursor)) return;
  const { row, col, shape } = snapshot.cursor;
  const x = col * width;
  const y = row * height;
  ctx.globalAlpha = 1;
  ctx.fillStyle = CURSOR_COLOR;
  switch (shape) {
    case "block": {
      ctx.fillRect(x, y, width, height);
      const cell = snapshot.cells[row]?.[col];
      if (cell && cell.ch !== " ") {
        ctx.fillStyle = CURSOR_TEXT_BG;
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
