import { invoke } from "@tauri-apps/api/core";
import { openUrl as tauriOpenUrl } from "@tauri-apps/plugin-opener";
import { ChevronDown } from "lucide-react";
import { type ClipboardEvent as ReactClipboardEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePromptMarks } from "../../shared/hooks/usePromptMarks";
import { findNextPromptMark, findPrevPromptMark, useScrollback } from "../../shared/hooks/useScrollback";
import { useTerminalImages } from "../../shared/hooks/useTerminalImages";
import { useTerminalSnapshot } from "../../shared/hooks/useTerminalSnapshot";
import { formatFallbackError, reportFallback } from "../../shared/lib/fallbackTelemetry";
import { TERMINAL_COMMAND_EVIDENCE_EVENT, type TerminalCommandEvidenceDetail } from "../../shared/lib/terminalEvidence";
import {
  type TerminalCursorStyle,
  type TerminalRendererMode,
  type TerminalTextClarity,
  useAppStore,
} from "../../shared/store/appStore";
import type { CursorShape, GridSnapshot } from "../../shared/types/terminal";
import { estimateScrollbackMemoryBytes, publishTerminalPerformanceSample } from "../analytics/performanceObservatory";
import {
  findAiCliInputAnchor,
  hasAiCliScreenSignature,
  isParkedAiCliCursor,
  isVisibleCursor,
  terminalCellSpan,
} from "./aiInputAnchor";
import * as gpuPaint from "./gpu/terminalPaintGpu";
import {
  clampTerminalCursor,
  IME_DIAGNOSTIC_EVENT,
  IME_DIAGNOSTIC_OVERLAY_STORAGE_KEY,
  IME_DIAGNOSTIC_STORAGE_KEY,
  IME_DIAGNOSTIC_TOGGLE_EVENT,
  type ImeDiagnosticDetail,
  imeCandidateAnchorX,
  imeCandidateAnchorXForViewport,
  imeDiagnosticsEnabled,
  imeDiagnosticsOverlayEnabled,
  imeTextareaAnchorWidth,
  imeTextareaCaretInset,
  nativeTerminalInputSurfaceEnabled,
  TERMINAL_CLIPBOARD_PASTE_EVENT,
  useCanvasIME,
  useImePosition,
  type WriteBytesFn,
} from "./hooks/useCanvasIME";
import { type CopyTextFn, useTerminalSelection } from "./hooks/useTerminalSelection";
import { pixelToCell } from "./keymap";
import { type LinkSpan, linkAt, scanLinks } from "./links";
import { shouldRepaintRow } from "./repaintDecision";
import type { AnyMatch } from "./search";
import { rowSelection, type SelectionRange } from "./selection";
import styles from "./TerminalArea.module.css";
import { canvasBitmapSize, canvasCssSize, currentCanvasDevicePixelRatio } from "./terminalCanvasGeometry";
import { TERMINAL_FONT_FAMILY, useTerminalCellMetrics } from "./terminalMetrics";
import {
  paintCursor,
  paintGhostSuggestion,
  paintImages,
  paintLinkUnderline,
  paintRow,
  paintSearchBands,
  paintSelectionBand,
} from "./terminalPaint";
import { buildMatchesKey, buildRowMask, hasPrintableAfterCursor, rowsCoveredByLink } from "./terminalRowDirty";

export type OpenUrlFn = (url: string) => Promise<void> | void;
const WEBVIEW_IME_FALLBACK_TEST_ID = ["terminal", "ime", "textarea"].join("-");

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
  /** Cell line-height multiplier; threads through cell metrics. Defaults to 1.25. */
  lineHeight?: number;
  textClarity?: TerminalTextClarity;
  /**
   * User-preferred cursor style. Seeds the rendered cursor shape when the PTY
   * program has not explicitly chosen one (the snapshot still wins when the
   * program sets a shape). Omitted: the snapshot shape is used as-is.
   */
  cursorStyle?: TerminalCursorStyle;
  /**
   * Whether the cursor blinks. When true, the cursor toggles on a timer; when
   * false it stays solid. Defaults to false (solid) to preserve prior behavior.
   */
  cursorBlink?: boolean;
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
  /** Injectable clipboard writer — defaults to native clipboard IPC with browser fallback. */
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

const IME_COMPOSITION_OVERLAY_MAX_CELLS = 34;
const TERMINAL_RASTER_BG_CSS_VAR = "--terminal-raster-bg";

/**
 * The terminal emulator reports `block` as its default cursor shape until a
 * program issues a DECSCUSR escape to choose another. We treat `block` as
 * "program has not set a specific shape" and seed it with the user's preferred
 * cursor style; any non-default shape (the program explicitly chose underline /
 * beam / hollow-block) is left untouched so program-set styles keep working.
 */
function cursorStyleToShape(style: TerminalCursorStyle): CursorShape {
  switch (style) {
    case "bar":
      return "beam";
    case "underline":
      return "underline";
    default:
      return "block";
  }
}

function applyPreferredCursorShape(cursor: CursorShape, preferred: TerminalCursorStyle | undefined): CursorShape {
  if (!preferred) return cursor;
  // Only seed when the program left the cursor at the emulator default (block).
  if (cursor !== "block") return cursor;
  return cursorStyleToShape(preferred);
}
const TERMINAL_CANVAS_BG_CSS_VAR = "--terminal-canvas-bg";
const TERMINAL_RASTER_BG_FALLBACK = "rgba(3, 10, 22, 0.92)";

function configureTerminalCanvasText(ctx: CanvasRenderingContext2D) {
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  const textCtx = ctx as CanvasRenderingContext2D & {
    fontKerning?: string;
    letterSpacing?: string;
    textRendering?: string;
    wordSpacing?: string;
  };
  textCtx.fontKerning = "none";
  textCtx.letterSpacing = "0px";
  textCtx.wordSpacing = "0px";
  // `geometricPrecision` makes canvas text mathematically consistent, but
  // on Windows WebView2 it often trades away glyph hinting and makes small
  // terminal text look grey/fuzzy. Let the engine pick the native text path.
  textCtx.textRendering = "auto";
}

function readTerminalRasterBackground(element: Element | null, textClarity: TerminalTextClarity): string {
  if (typeof window === "undefined" || typeof document === "undefined") return TERMINAL_RASTER_BG_FALLBACK;
  const source = element ?? document.documentElement;
  const style = window.getComputedStyle(source);
  const rasterBg = style.getPropertyValue(TERMINAL_RASTER_BG_CSS_VAR).trim();
  const canvasBg = style.getPropertyValue(TERMINAL_CANVAS_BG_CSS_VAR).trim();
  if (textClarity === "glass") return canvasBg || rasterBg || TERMINAL_RASTER_BG_FALLBACK;
  // Solid clarity now means solid glyph paint and contrast correction only.
  // The raster backing must remain translucent so native glass can show through.
  return rasterBg || canvasBg || TERMINAL_RASTER_BG_FALLBACK;
}

function useTerminalRasterBackground(element: Element | null, textClarity: TerminalTextClarity): string {
  const [rasterBackground, setRasterBackground] = useState(() => readTerminalRasterBackground(element, textClarity));

  useEffect(() => {
    if (typeof window === "undefined" || typeof document === "undefined") return;
    const refresh = () => setRasterBackground(readTerminalRasterBackground(element, textClarity));
    refresh();

    const observer = typeof MutationObserver !== "undefined" ? new MutationObserver(refresh) : null;
    observer?.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["style", "data-mood", "data-theme", "class"],
    });
    window.addEventListener("storage", refresh);
    return () => {
      observer?.disconnect();
      window.removeEventListener("storage", refresh);
    };
  }, [element, textClarity]);

  return rasterBackground;
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

export function TerminalCanvas({
  terminalId,
  cols,
  rows,
  fontSize = 14,
  textClarity = "solid",
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
  lineHeight,
  cursorStyle,
  cursorBlink = false,
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
  const gpuContextRef = useRef<gpuPaint.TerminalGpuPaintContext | null>(null);
  const [canvasEl, setCanvasEl] = useState<HTMLCanvasElement | null>(null);
  const [inputSurfaceEl, setInputSurfaceEl] = useState<HTMLDivElement | null>(null);
  const [textareaEl, setTextareaEl] = useState<HTMLTextAreaElement | null>(null);
  const useNativeInputSurface = nativeTerminalInputSurfaceEnabled();
  const terminalRendererMode = useAppStore((s) => s.terminalRendererMode);
  const [webglFallback, setWebglFallback] = useState(false);
  const effectiveRendererMode: TerminalRendererMode =
    terminalRendererMode === "webgl2" && !webglFallback ? "webgl2" : "canvas2d";
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
  // Tracks whether the previous paint rendered the composite scrollback grid
  // (scrolledUp) vs the live grid. The diff loop stores the *live* snapshot in
  // prevSnapshotRef even when it painted composite cells, so without this flag
  // a scroll-to-live frame on an unchanged snapshot would ref-match every row
  // and skip repaint — leaving stale scrollback pixels on screen.
  const prevScrolledUpRef = useRef<boolean>(false);
  // Tracks the last raster background color painted into the canvas. A mood
  // switch only changes this CSS-derived color (cell content is unchanged), so
  // without it the per-row dirty check skips every row and the canvas keeps the
  // previous mood's backing color forever.
  const prevRasterBackgroundRef = useRef<string>("");
  const prevCanvasGeometryRef = useRef<{
    cellWidth: number;
    cellHeight: number;
    canvasWidth: number;
    canvasHeight: number;
    devicePixelRatio: number;
  } | null>(null);
  const renderPerfRef = useRef({ lastPaintAt: 0, droppedRenderFrames: 0 });
  const [hoveredLink, setHoveredLink] = useState<LinkSpan | null>(null);
  const [compositionText, setCompositionText] = useState("");
  const liveImeCursorRef = useRef<{ row: number; col: number } | null>(null);
  const [compositionAnchorCursor, setCompositionAnchorCursor] = useState<{ row: number; col: number } | null>(null);
  const [diagnosticsVisible, setDiagnosticsVisible] = useState(() =>
    typeof window !== "undefined" ? imeDiagnosticsEnabled(window) && imeDiagnosticsOverlayEnabled(window) : false,
  );
  const [canvasDevicePixelRatio, setCanvasDevicePixelRatio] = useState(currentCanvasDevicePixelRatio);
  const [latestImeDiagnostic, setLatestImeDiagnostic] = useState<ImeDiagnosticDetail | null>(null);
  const [droppedKeyCount, setDroppedKeyCount] = useState(0);
  const [diagnosticPaneActive, setDiagnosticPaneActive] = useState(false);
  const handleCompositionActiveChange = useCallback((active: boolean) => {
    if (!active) {
      setCompositionAnchorCursor(null);
      return;
    }
    setCompositionAnchorCursor((current) => current ?? liveImeCursorRef.current);
  }, []);

  useCanvasIME({
    terminalId,
    textarea: useNativeInputSurface ? null : textareaEl,
    writeBytes,
    onCompositionTextChange: setCompositionText,
    onCompositionActiveChange: handleCompositionActiveChange,
  });

  useEffect(() => {
    renderPerfRef.current = { lastPaintAt: 0, droppedRenderFrames: 0 };
  }, []);

  useEffect(() => {
    gpuContextRef.current = null;
    if (terminalRendererMode !== "webgl2") {
      setWebglFallback(false);
      return;
    }
    setWebglFallback(false);
  }, [terminalRendererMode]);

  useEffect(() => {
    if (!canvasEl || terminalRendererMode !== "webgl2") return;
    const handleContextLost = (event: Event) => {
      event.preventDefault();
      gpuContextRef.current = null;
      setWebglFallback(true);
      reportFallback(
        {
          source: "terminal.renderer",
          operation: "webglcontextlost",
          severity: "warning",
          message: "Terminal WebGL2 renderer context was lost; falling back to Canvas2D for this session.",
          userVisible: true,
        },
        { throttleMs: 30_000 },
      );
    };
    canvasEl.addEventListener("webglcontextlost", handleContextLost);
    return () => canvasEl.removeEventListener("webglcontextlost", handleContextLost);
  }, [canvasEl, terminalRendererMode]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const syncVisibility = () => {
      const enabled = imeDiagnosticsEnabled(window) && imeDiagnosticsOverlayEnabled(window);
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
      if (!imeDiagnosticsEnabled(window) || !imeDiagnosticsOverlayEnabled(window)) {
        setDiagnosticsVisible(false);
        return;
      }
      setDiagnosticsVisible(true);
      setLatestImeDiagnostic(detail);
      setDiagnosticPaneActive(detail.active);
      if (detail.dropped) {
        setDroppedKeyCount((count) => count + 1);
      }
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === IME_DIAGNOSTIC_STORAGE_KEY || event.key === IME_DIAGNOSTIC_OVERLAY_STORAGE_KEY) {
        syncVisibility();
      }
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

  // `scrollback` is a fresh object every render; route it through a ref so
  // this global listener is not torn down and re-added on every frame.
  const commandEvidenceContextRef = useRef({ promptMarks, scrollback });
  useEffect(() => {
    commandEvidenceContextRef.current = { promptMarks, scrollback };
  });

  useEffect(() => {
    const handleCommandEvidence = (event: Event) => {
      const detail = (event as CustomEvent<TerminalCommandEvidenceDetail>).detail;
      if (!detail || detail.terminalId !== terminalId) return;
      const ctx = commandEvidenceContextRef.current;
      const mark =
        detail.sequence == null
          ? null
          : (ctx.promptMarks.find((candidate) => candidate.sequence === detail.sequence) ?? null);
      if (mark) {
        ctx.scrollback.scrollToMark(mark);
        return;
      }
      if (detail.historySize != null) {
        ctx.scrollback.scrollToOffset(Math.max(0, ctx.scrollback.historySize - detail.historySize));
      }
    };
    window.addEventListener(TERMINAL_COMMAND_EVIDENCE_EVENT, handleCommandEvidence);
    return () => window.removeEventListener(TERMINAL_COMMAND_EVIDENCE_EVENT, handleCommandEvidence);
  }, [terminalId]);

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
    onInputRef?.(useNativeInputSurface ? null : textareaEl);
    return () => onInputRef?.(null);
  }, [useNativeInputSurface, textareaEl, onInputRef]);

  const [cursorOn, setCursorOn] = useState(true);

  const cellMetrics = useTerminalCellMetrics(fontSize, fontFamily, lineHeight);
  const rasterBackground = useTerminalRasterBackground(canvasEl, textClarity);

  const canvasWidth = cols * cellMetrics.width;
  const canvasHeight = rows * cellMetrics.height;
  /* Keep the canvas element's CSS size exactly equal to its integer
   * backing-store size divided by DPR. Otherwise WebView2 rescales the
   * whole bitmap after we paint it, which is the classic "terminal text
   * looks soft even though the font is fine" failure mode. */
  const canvasBitmapWidth = canvasBitmapSize(canvasWidth, canvasDevicePixelRatio);
  const canvasBitmapHeight = canvasBitmapSize(canvasHeight, canvasDevicePixelRatio);
  const canvasCssWidth = canvasCssSize(canvasBitmapWidth, canvasDevicePixelRatio);
  const canvasCssHeight = canvasCssSize(canvasBitmapHeight, canvasDevicePixelRatio);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const syncPixelRatio = () => {
      const next = currentCanvasDevicePixelRatio();
      setCanvasDevicePixelRatio((prev) => (Math.abs(prev - next) < 0.001 ? prev : next));
    };

    const mediaQuery = window.matchMedia?.(`(resolution: ${canvasDevicePixelRatio}dppx)`);
    window.addEventListener("resize", syncPixelRatio);
    window.visualViewport?.addEventListener("resize", syncPixelRatio);
    mediaQuery?.addEventListener?.("change", syncPixelRatio);
    syncPixelRatio();

    return () => {
      window.removeEventListener("resize", syncPixelRatio);
      window.visualViewport?.removeEventListener("resize", syncPixelRatio);
      mediaQuery?.removeEventListener?.("change", syncPixelRatio);
    };
  }, [canvasDevicePixelRatio]);

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
      const key = ev.key.toLowerCase();
      if ((ev.ctrlKey && key === "c") || (ev.ctrlKey && key === "v") || (ev.shiftKey && ev.key === "Insert")) return;
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
      const key = ev.key.toLowerCase();
      const copyShortcut =
        (ev.ctrlKey && ev.shiftKey && key === "c") ||
        (ev.ctrlKey && key === "c" && !!selection) ||
        (ev.ctrlKey && ev.key === "Insert");
      if (copyShortcut) {
        if (!selection) return;
        ev.preventDefault();
        ev.stopPropagation();
        void copy();
      }
    };
    textareaEl.addEventListener("keydown", handler, true);
    return () => textareaEl.removeEventListener("keydown", handler, true);
  }, [textareaEl, selection, copy]);

  useEffect(() => {
    const el = inputEl;
    if (!el || !textareaEl) return;
    const handler = (ev: MouseEvent) => {
      ev.preventDefault();
      ev.stopPropagation();
      textareaEl.focus();
      if (selection) {
        void copy();
        return;
      }
      textareaEl.dispatchEvent(new Event(TERMINAL_CLIPBOARD_PASTE_EVENT, { bubbles: true }));
    };
    el.addEventListener("contextmenu", handler);
    return () => el.removeEventListener("contextmenu", handler);
  }, [inputEl, textareaEl, selection, copy]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const isGpuRenderer = effectiveRendererMode === "webgl2";
    let gpuCtx: gpuPaint.TerminalGpuPaintContext | null = null;
    let ctx: CanvasRenderingContext2D | null = null;

    if (isGpuRenderer) {
      gpuCtx = gpuContextRef.current;
      if (!gpuCtx || gpuCtx.canvas !== canvas) {
        gpuCtx = gpuPaint.createTerminalGpuPaintContext(canvas, { devicePixelRatio: canvasDevicePixelRatio });
        if (!gpuCtx) {
          setWebglFallback(true);
          reportFallback(
            {
              source: "terminal.renderer",
              operation: "create_webgl2_context",
              severity: "warning",
              message: "Terminal WebGL2 renderer is unavailable; falling back to Canvas2D for this session.",
              userVisible: true,
            },
            { throttleMs: 30_000 },
          );
          return;
        }
        gpuContextRef.current = gpuCtx;
      }
      gpuCtx.devicePixelRatio = canvasDevicePixelRatio;
      gpuPaint.beginGpuFrame(gpuCtx);
    } else {
      ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform?.(canvasDevicePixelRatio, 0, 0, canvasDevicePixelRatio, 0, 0);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      configureTerminalCanvasText(ctx);
    }

    if (!snapshot) {
      if (isGpuRenderer && gpuCtx) {
        gpuPaint.flushGpuFrame(gpuCtx);
      } else {
        ctx?.clearRect?.(0, 0, canvasWidth, canvasHeight);
      }
      prevSnapshotRef.current = null;
      prevCanvasGeometryRef.current = {
        cellWidth: cellMetrics.width,
        cellHeight: cellMetrics.height,
        canvasWidth,
        canvasHeight,
        devicePixelRatio: canvasDevicePixelRatio,
      };
      return;
    }

    const paintStartedAt =
      typeof performance !== "undefined" && typeof performance.now === "function" ? performance.now() : Date.now();
    const prev = prevSnapshotRef.current;
    const dimsChanged = !prev || prev.cols !== snapshot.cols || prev.rows !== snapshot.rows;
    const prevGeometry = prevCanvasGeometryRef.current;
    const canvasGeometryChanged =
      !prevGeometry ||
      prevGeometry.cellWidth !== cellMetrics.width ||
      prevGeometry.cellHeight !== cellMetrics.height ||
      prevGeometry.canvasWidth !== canvasWidth ||
      prevGeometry.canvasHeight !== canvasHeight ||
      prevGeometry.devicePixelRatio !== canvasDevicePixelRatio;
    // Switching between the live grid and the composite scrollback grid must
    // force every row to repaint: the cells painted last frame came from a
    // different source than prevSnapshotRef records, so ref-equality skips
    // would otherwise leave the wrong grid on the canvas.
    const viewModeChanged = prevScrolledUpRef.current !== scrolledUp;
    // Mood/theme switches change only the raster background color; force a full
    // repaint so the new backing color reaches every row's pixels.
    const backgroundChanged = prevRasterBackgroundRef.current !== rasterBackground;
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

    if (ctx) ctx.textBaseline = "top";

    if (!isGpuRenderer && (dimsChanged || canvasGeometryChanged || backgroundChanged)) {
      ctx?.clearRect?.(0, 0, canvasWidth, canvasHeight);
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
      const rowContentChanged = !prev || prev.cells[row] !== rowCells;
      if (
        !isGpuRenderer &&
        !backgroundChanged &&
        !shouldRepaintRow({
          dimsChanged,
          canvasGeometryChanged,
          viewModeChanged,
          selDirtyRow,
          matchDirtyRow,
          hoverDirtyRow,
          cursorDirtyRow,
          rowContentChanged,
        })
      ) {
        continue;
      }
      if (isGpuRenderer && gpuCtx) {
        gpuPaint.paintRow(
          gpuCtx,
          rowCells,
          row,
          cellMetrics,
          fontSize,
          fontFamily,
          canvasDevicePixelRatio,
          rasterBackground,
          textClarity,
        );
      } else if (ctx) {
        paintRow(
          ctx,
          rowCells,
          row,
          cellMetrics,
          fontSize,
          fontFamily,
          canvasDevicePixelRatio,
          rasterBackground,
          textClarity,
        );
      }
      // Search bands paint over both live and history rows — viewportRowOf
      // does the routing so a history match becomes visible the moment the
      // user scrolls its row into view.
      if (isGpuRenderer && gpuCtx) {
        gpuPaint.paintSearchBands(
          gpuCtx,
          row,
          searchMatches,
          activeSearchMatch,
          cellMetrics,
          snapshot.rows,
          scrollback.scrollOffset,
        );
      } else if (ctx) {
        paintSearchBands(
          ctx,
          row,
          searchMatches,
          activeSearchMatch,
          cellMetrics,
          snapshot.rows,
          scrollback.scrollOffset,
        );
      }
      if (!scrolledUp) {
        if (inNew) {
          if (isGpuRenderer && gpuCtx) {
            gpuPaint.paintSelectionBand(gpuCtx, row, inNew, cellMetrics);
          } else if (ctx) {
            paintSelectionBand(ctx, row, inNew, cellMetrics);
          }
        }
        if (isGpuRenderer && gpuCtx) {
          gpuPaint.paintLinkUnderline(gpuCtx, row, hoveredLink, snapshot.cols, cellMetrics);
        } else if (ctx) {
          paintLinkUnderline(ctx, row, hoveredLink, snapshot.cols, cellMetrics);
        }
      }
    }

    // Ghost suggestion band — paint BEFORE the cursor so the cursor block
    // (if block-shape) covers its first glyph just like on a real shell.
    if (!scrolledUp && ghost && !hasPrintableAfterCursor(snapshot)) {
      if (isGpuRenderer && gpuCtx) {
        gpuPaint.paintGhostSuggestion(
          gpuCtx,
          snapshot,
          ghost,
          cellMetrics,
          fontSize,
          fontFamily,
          canvasDevicePixelRatio,
        );
      } else if (ctx) {
        paintGhostSuggestion(ctx, snapshot, ghost, cellMetrics, fontSize, fontFamily, canvasDevicePixelRatio);
      }
    }

    // Cursor only makes sense on the live view — suppress it when
    // scrolled up so users don't mistake scrollback content for the
    // active prompt line.
    if (!scrolledUp && snapshot.cursor.visible && cursorOn) {
      const preferredShape = applyPreferredCursorShape(snapshot.cursor.shape, cursorStyle);
      const cursorSnapshot =
        preferredShape === snapshot.cursor.shape
          ? snapshot
          : { ...snapshot, cursor: { ...snapshot.cursor, shape: preferredShape } };
      if (isGpuRenderer && gpuCtx) {
        gpuPaint.paintCursor(gpuCtx, cursorSnapshot, cellMetrics, canvasDevicePixelRatio);
      } else if (ctx) {
        paintCursor(ctx, cursorSnapshot, cellMetrics, canvasDevicePixelRatio);
      }
    }

    // Inline image overlays last so they sit on top of cell glyphs
    // and the cursor — Kitty's protocol contract is that the image
    // owns the cell rectangle it occupies. Suppressed during scrollback
    // for the same reason as other live overlays: the snapshot's image
    // anchors are live-grid coordinates and would mis-render on the
    // composite scrollback view.
    if (!scrolledUp && snapshot.images && snapshot.images.length > 0) {
      if (isGpuRenderer && gpuCtx) {
        gpuPaint.paintImages(gpuCtx, snapshot.images, imageBitmaps, cellMetrics);
      } else if (ctx) {
        paintImages(ctx, snapshot.images, imageBitmaps, cellMetrics);
      }
    }

    if (isGpuRenderer && gpuCtx) {
      gpuPaint.flushGpuFrame(gpuCtx);
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
    const performanceRenderer = effectiveRendererMode === "webgl2" ? "webgl" : "canvas2d";
    publishTerminalPerformanceSample({
      terminalId,
      sampledAt: Date.now(),
      fps: frameIntervalMs > 0 ? Math.min(240, 1_000 / frameIntervalMs) : null,
      frameMs: Math.max(0, paintFinishedAt - paintStartedAt),
      droppedRenderFrames: renderPerfRef.current.droppedRenderFrames,
      renderer: performanceRenderer,
      webglFallback: terminalRendererMode === "webgl2" && effectiveRendererMode === "canvas2d",
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
    prevScrolledUpRef.current = scrolledUp;
    prevRasterBackgroundRef.current = rasterBackground;
    prevCanvasGeometryRef.current = {
      cellWidth: cellMetrics.width,
      cellHeight: cellMetrics.height,
      canvasWidth,
      canvasHeight,
      devicePixelRatio: canvasDevicePixelRatio,
    };
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
    canvasDevicePixelRatio,
    rasterBackground,
    canvasWidth,
    canvasHeight,
    textClarity,
    cursorStyle,
    terminalRendererMode,
    effectiveRendererMode,
  ]);

  useEffect(() => {
    // Blink is opt-in (Settings → Cursor Blink). When disabled, keep the
    // cursor solid: in dogfood the previous always-on blink read as a bright
    // strobe on AI CLI prompt rows and forced a repaint loop while idle.
    if (!cursorBlink) {
      setCursorOn(true);
      return;
    }
    setCursorOn(true);
    // 530ms is the de-facto terminal blink period (xterm / VTE / Windows
    // Terminal all sit near it). Toggling cursorOn flips the cursor row dirty
    // through the paint effect's `cursorBlinkToggled` branch.
    const interval = window.setInterval(() => {
      setCursorOn((on) => !on);
    }, 530);
    return () => {
      window.clearInterval(interval);
    };
  }, [cursorBlink]);

  const focusInputSurface = useCallback(() => {
    if (useNativeInputSurface) {
      if (inputSurfaceEl) {
        inputSurfaceEl.focus();
      } else {
        reportFallback(
          {
            source: "terminal.input",
            operation: "focus_native_surface_unavailable",
            severity: "warning",
            message: "TerminalCanvas could not focus the native input surface because it was not mounted.",
            userVisible: true,
          },
          { throttleMs: 30_000 },
        );
      }
      return;
    }
    if (textareaEl) {
      textareaEl.focus();
      reportFallback(
        {
          source: "terminal.input",
          operation: "focus_webview_ime_fallback",
          severity: "warning",
          message: "TerminalCanvas focused the WebView IME fallback because native input surface is disabled.",
          userVisible: true,
        },
        { throttleMs: 30_000 },
      );
      return;
    }
    reportFallback(
      {
        source: "terminal.input",
        operation: "focus_terminal_unavailable",
        severity: "warning",
        message: "TerminalCanvas could not find any terminal input surface to focus.",
        userVisible: true,
      },
      { throttleMs: 30_000 },
    );
  }, [useNativeInputSurface, inputSurfaceEl, textareaEl]);

  // Auto-focus the active terminal input owner the first time the terminal is
  // mounted so the user can type immediately without first clicking. Only
  // fires once per mount; subsequent renders do not steal focus.
  const autoFocusedRef = useRef(false);
  useEffect(() => {
    if (autoFocusedRef.current) return;
    if (useNativeInputSurface ? !inputSurfaceEl : !textareaEl) return;
    autoFocusedRef.current = true;
    focusInputSurface();
  }, [useNativeInputSurface, inputSurfaceEl, textareaEl, focusInputSurface]);

  // Keep the hidden textarea parked at the cursor position and tell Windows
  // where to anchor the IME candidate window.
  const visibleSnapshotCursor = isVisibleCursor(snapshot?.cursor) ? snapshot.cursor : null;
  const autoPreferAiInputAnchor = hasAiCliScreenSignature(snapshot);
  const aiCliInputAnchor = preferAiInputAnchor || autoPreferAiInputAnchor ? findAiCliInputAnchor(snapshot) : null;
  const useAiCliInputAnchor =
    (preferAiInputAnchor || autoPreferAiInputAnchor) &&
    isParkedAiCliCursor(snapshot, visibleSnapshotCursor, aiCliInputAnchor);
  const effectiveImeCursor = useAiCliInputAnchor ? aiCliInputAnchor : visibleSnapshotCursor;
  liveImeCursorRef.current = effectiveImeCursor ? { row: effectiveImeCursor.row, col: effectiveImeCursor.col } : null;
  const compositionLockedImeCursor = compositionAnchorCursor ?? effectiveImeCursor;
  const imeAnchorMode = useAiCliInputAnchor
    ? "ai-cli-input"
    : preferAiInputAnchor
      ? "ai-cli-real-cursor"
      : "terminal-cursor";

  const handleNativeInputSurfacePaste = useCallback(
    (event: ReactClipboardEvent<HTMLDivElement>) => {
      if (!useNativeInputSurface) return;
      event.preventDefault();
      event.stopPropagation();
      focusInputSurface();
      void invoke("native_terminal_input_paste", { terminalId }).catch((err) => {
        reportFallback(
          {
            source: "terminal.native-input",
            operation: "native_terminal_input_paste",
            severity: "error",
            message: formatFallbackError(err),
            boundary: "native",
            userVisible: true,
          },
          { throttleMs: 5_000 },
        );
      });
    },
    [focusInputSurface, terminalId, useNativeInputSurface],
  );

  const compositionCursor = compositionLockedImeCursor
    ? clampTerminalCursor(compositionLockedImeCursor, cols, rows)
    : { row: 0, col: 0 };
  const compositionCursorX = compositionCursor.col * cellMetrics.width;
  const compositionCursorY = compositionCursor.row * cellMetrics.height;
  const compositionCellOffset =
    compositionText.length > 0 ? Math.min(IME_COMPOSITION_OVERLAY_MAX_CELLS, terminalCellSpan(compositionText)) : 0;
  const viewportLeft = typeof window !== "undefined" ? (window.visualViewport?.offsetLeft ?? 0) : 0;
  const viewportWidth =
    typeof window !== "undefined" ? (window.visualViewport?.width ?? window.innerWidth) : canvasWidth;
  const canvasLeft = canvasEl?.getBoundingClientRect().left ?? 0;
  const imeAnchorX = canvasEl
    ? imeCandidateAnchorXForViewport(compositionCursorX, canvasLeft, canvasWidth, viewportLeft, viewportWidth)
    : imeCandidateAnchorX(compositionCursorX, canvasWidth);
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
  const surfaceClassName = [styles.terminalCanvasSurface, className].filter(Boolean).join(" ");

  useImePosition({
    terminalId,
    textarea: useNativeInputSurface ? null : textareaEl,
    focusElement: inputSurfaceEl,
    nativeInputSurface: useNativeInputSurface,
    cursor: compositionLockedImeCursor,
    compositionCellOffset,
    cols,
    rows,
    cellWidth: cellMetrics.width,
    cellHeight: cellMetrics.height,
    canvas: canvasEl,
  });

  return (
    /* biome-ignore lint/a11y/useSemanticElements: The focus target is a canvas-backed terminal surface; Windows builds use a native HWND input owner and non-native/test builds keep a WebView fallback textarea. */
    <div
      ref={setInputSurfaceEl}
      className={surfaceClassName}
      role="textbox"
      aria-label="Terminal input surface"
      aria-multiline="true"
      data-native-input-surface={useNativeInputSurface ? "true" : "false"}
      data-terminal-text-clarity={textClarity}
      style={{
        position: "relative",
        width: `${canvasCssWidth}px`,
        height: `${canvasCssHeight}px`,
        flex: "0 0 auto",
        outline: "none",
      }}
      tabIndex={0}
      onFocus={(e) => {
        if (e.target === e.currentTarget) focusInputSurface();
      }}
      onMouseDown={focusInputSurface}
      onPaste={handleNativeInputSurfacePaste}
    >
      <canvas
        key={effectiveRendererMode}
        ref={(node) => {
          canvasRef.current = node;
          setCanvasEl(node);
          onCanvasRef?.(node);
        }}
        width={canvasBitmapWidth}
        height={canvasBitmapHeight}
        data-testid="terminal-canvas"
        data-terminal-id={terminalId}
        data-terminal-renderer={effectiveRendererMode}
        data-terminal-webgl-fallback={webglFallback ? "true" : "false"}
        // `-1` keeps the canvas programmatically focus-able (tests /
        // external `canvas.focus()` callers still work and flow through
        // `onFocus` to the textarea) without giving it native click-to-
        // focus behaviour that would fight the container's focus-forward.
        tabIndex={-1}
        onFocus={focusInputSurface}
        style={{
          display: "block",
          width: `${canvasCssWidth}px`,
          height: `${canvasCssHeight}px`,
          background:
            "color-mix(in srgb, var(--terminal-canvas-bg, transparent) calc(var(--terminal-surface-opacity, 0.82) * 100%), transparent)",
          outline: "none",
        }}
      />
      {!useNativeInputSurface && (
        <>
          {/*
            WebView IME fallback textarea. It is disabled by default in the
            Tauri runtime; jsdom/non-Tauri tests and emergency opt-out keep it
            available while the native HWND surface is rolled forward.
          */}
          <textarea
            ref={setTextareaEl}
            data-testid={WEBVIEW_IME_FALLBACK_TEST_ID}
            data-ime-anchor-mode={imeAnchorMode}
            aria-hidden="true"
            tabIndex={-1}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            rows={1}
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
              writingMode: "horizontal-tb",
              textOrientation: "mixed",
              wordBreak: "keep-all",
              overflowWrap: "normal",
              WebkitTextFillColor: "transparent",
              // Caret would flash in the wrong position; hide it.
              caretColor: "transparent",
            }}
          />
        </>
      )}
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

// Paint primitives moved to ./terminalPaint; pure row-dirty/search-key
// helpers moved to ./terminalRowDirty.
