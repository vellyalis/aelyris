import { invoke } from "@tauri-apps/api/core";
import { openUrl as tauriOpenUrl } from "@tauri-apps/plugin-opener";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { ShellType } from "../../App";
import { useSnapshots } from "../../shared/hooks/useSnapshots";
import { useTerminalSnapshot } from "../../shared/hooks/useTerminalSnapshot";
import { useAppStore } from "../../shared/store/appStore";
import type { SnapshotSummary } from "../../shared/types/snapshot";
import { type ActiveSnapshotOverlay, TimelineBar } from "../timeline/TimelineBar";
import { useAICliDetection } from "./hooks/useAICliDetection";
import { useInputMirror } from "./hooks/useInputMirror";
import { IMEInputBar, type IMEInputBarHandle } from "./IMEInputBar";
import { openTerminalUrlWith } from "./openTerminalUrl";
import {
  type AnyMatch,
  combineMatches,
  findMatches,
  nextMatch,
  previousMatch,
  scrollOffsetForMatch,
  type SearchMatch,
} from "./search";
import { useHistorySearch } from "../../shared/hooks/useHistorySearch";
import styles from "./TerminalArea.module.css";
import { TerminalCanvas, type TerminalNav } from "./TerminalCanvas";

interface NativeTerminalAreaProps {
  shell?: ShellType;
  cwd?: string;
  onTerminalReady?: (terminalId: string) => void;
  /** Override for tests — defaults to `invoke("spawn_terminal", ...)`. */
  spawnPty?: (args: { shell: string; cols: number; rows: number; cwd?: string }) => Promise<string>;
  /** Override for tests — defaults to `invoke("resize_terminal", ...)`. */
  resizePty?: (id: string, cols: number, rows: number) => Promise<void> | void;
  /** Override for tests — defaults to `invoke("write_terminal", ...)`. */
  writePty?: (id: string, data: string) => Promise<void> | void;
  /** Override for tests — defaults to Tauri `listen("pty-output-<id>")`. */
  subscribeOutput?: (terminalId: string, onBytes: (bytes: Uint8Array) => void) => Promise<UnlistenFn>;
  /** Override for tests — defaults to Tauri `listen("pty-exit-<id>")`. */
  subscribeExit?: (terminalId: string, onExit: (info: PtyExitInfo) => void) => Promise<UnlistenFn>;
  /** Override for tests — defaults to `invoke("respawn_terminal", ...)`. */
  respawnPty?: (args: {
    id: string;
    shell: string;
    cols: number;
    rows: number;
    cwd?: string;
  }) => Promise<void>;
  /** Override for tests — opens an in-cwd file:// URL in the editor.
   *  Defaults to `useAppStore.getState().openFile`. */
  openInEditor?: (absolutePath: string) => void;
  /** Override for tests — opens any other URL via the OS handler.
   *  Defaults to `tauri-plugin-opener.openUrl`. */
  openExternal?: (url: string) => Promise<void> | void;
}

/**
 * Exit information surfaced from the backend `pty-exit-<id>` event.
 *
 * `crashed` is a heuristic computed in the Rust waiter: NTSTATUS error
 * range on Windows, non-zero exit code elsewhere. The banner branches on
 * it for visual severity but treats both cases the same way functionally
 * (Enter restarts, Esc dismisses).
 */
export interface PtyExitInfo {
  code: number | null;
  crashed: boolean;
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

function defaultSpawn(args: { shell: string; cols: number; rows: number; cwd?: string }): Promise<string> {
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

function defaultWrite(id: string, data: string): Promise<void> {
  return invoke<void>("write_terminal", { id, data }).catch(() => {});
}

async function defaultSubscribeOutput(terminalId: string, onBytes: (bytes: Uint8Array) => void): Promise<UnlistenFn> {
  return listen<number[]>(`pty-output-${terminalId}`, (event) => {
    onBytes(new Uint8Array(event.payload));
  });
}

async function defaultSubscribeExit(
  terminalId: string,
  onExit: (info: PtyExitInfo) => void,
): Promise<UnlistenFn> {
  return listen<PtyExitInfo>(`pty-exit-${terminalId}`, (event) => {
    onExit(event.payload);
  });
}

function defaultRespawn(args: {
  id: string;
  shell: string;
  cols: number;
  rows: number;
  cwd?: string;
}): Promise<void> {
  return invoke<void>("respawn_terminal", {
    id: args.id,
    shell: args.shell,
    cols: args.cols,
    rows: args.rows,
    cwd: args.cwd ?? null,
  });
}

function exitBannerMessage(info: PtyExitInfo): string {
  if (info.crashed) {
    return info.code === null
      ? "Shell crashed (no exit code)."
      : `Shell crashed (code ${info.code}).`;
  }
  return info.code === null
    ? "Shell exited."
    : `Shell exited (code ${info.code}).`;
}

/**
 * Phase 2 / Task 10+11 — feature-flagged host for the native Rust terminal
 * engine.
 *
 * Spawns the PTY, mounts `<TerminalCanvas>`, and layers the ergonomics that
 * sit outside the canvas:
 *   - `<IMEInputBar>` is docked at the bottom and always rendered. Japanese
 *     / Chinese / Korean input has nowhere to land on the native canvas
 *     (Phase 2 removed xterm.js and with it the composition helper), so a
 *     dedicated text field is the only way to type multi-byte input at all.
 *     Ctrl+Shift+J moves focus into the bar.
 *   - Ctrl+F opens an inline search bar that drives TerminalCanvas's
 *     `searchMatches` / `activeSearchMatch` highlights.
 *
 * `subscribeOutput` is injectable so tests can feed synthetic PTY bytes into
 * the AI-CLI detector without a running backend.
 */
export function NativeTerminalArea({
  shell = "powershell",
  cwd,
  onTerminalReady,
  spawnPty = defaultSpawn,
  resizePty = defaultResize,
  writePty = defaultWrite,
  subscribeOutput = defaultSubscribeOutput,
  subscribeExit = defaultSubscribeExit,
  respawnPty = defaultRespawn,
  openInEditor,
  openExternal,
}: NativeTerminalAreaProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [canvasEl, setCanvasEl] = useState<HTMLCanvasElement | null>(null);
  // Phase B: the hidden IME textarea on the canvas is the real keyboard-
  // input element. `useInputMirror` (ghost-text buffer) and focus-restore
  // shortcuts both target this element.
  const [canvasInputEl, setCanvasInputEl] = useState<HTMLTextAreaElement | null>(null);
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

  const snapshot = useTerminalSnapshot(terminalId);

  // ── Time-travel overlay (Phase 3C-3c) ──
  // A ref mirrors the state so async paths (dismiss IPC, listener) can
  // see the current overlay without the effect re-registering. This closes
  // the "rapid tick click leaks a layer" race flagged in code review:
  // every start path dismisses the previous overlay first, and a
  // terminalId change dismisses the pending backend layer via the cleanup
  // in the id-change effect instead of just clearing local state.
  const [snapshotOverlay, setSnapshotOverlay] = useState<ActiveSnapshotOverlay | null>(null);
  const snapshotOverlayRef = useRef<ActiveSnapshotOverlay | null>(null);
  useEffect(() => {
    snapshotOverlayRef.current = snapshotOverlay;
  }, [snapshotOverlay]);

  // Fire-and-forget dismiss — the registry dismiss is idempotent on the
  // backend, so losing the response is fine.
  const dismissBackendLayer = useCallback((layerId: string) => {
    void invoke<void>("dismiss_ghost_layer", { layerId }).catch(() => {});
  }, []);

  // Terminal id change: dismiss the outstanding backend layer, then let
  // the state effect below clear local state when the new id lands. The
  // cleanup fires before the next effect, so the order is
  //   previous cleanup (dismiss backend) → setSnapshotOverlay(null).
  useEffect(() => {
    setSnapshotOverlay(null);
    return () => {
      const stale = snapshotOverlayRef.current;
      if (stale) {
        dismissBackendLayer(stale.layerId);
      }
    };
  }, [terminalId, dismissBackendLayer]);

  const {
    snapshots: timelineSnapshots,
    fetchFullSnapshot,
    startOverlay: startSnapshotOverlay,
    markSnapshot,
  } = useSnapshots(terminalId);

  const selectSnapshot = useCallback(
    async (summary: SnapshotSummary) => {
      if (!terminalId) return;
      // Dismiss the previous overlay (if any) before starting the new
      // one — without this, rapid tick clicks pile up undismissed layers
      // in the backend registry.
      const prev = snapshotOverlayRef.current;
      if (prev) {
        dismissBackendLayer(prev.layerId);
      }
      const full = await fetchFullSnapshot(summary.id);
      if (!full) return;
      const layer = await startSnapshotOverlay(summary.id);
      if (!layer) {
        return;
      }
      setSnapshotOverlay({
        layerId: layer.id,
        snapshotId: summary.id,
        grid: full.grid,
      });
    },
    [terminalId, fetchFullSnapshot, startSnapshotOverlay, dismissBackendLayer],
  );

  const dismissSnapshotOverlay = useCallback(() => {
    const cur = snapshotOverlayRef.current;
    if (!cur) return;
    dismissBackendLayer(cur.layerId);
    setSnapshotOverlay((prev) => (prev && prev.layerId === cur.layerId ? null : prev));
  }, [dismissBackendLayer]);

  const handleMarkSnapshot = useCallback(() => {
    void markSnapshot();
  }, [markSnapshot]);

  // Backend-initiated removal (ghost-diff panel X, dismiss IPC from another
  // caller). Listener is registered once at mount and reads the overlay ref
  // so a `layer-removed` event that arrives *between* the IPC returning a
  // layer and the `setSnapshotOverlay` commit is still reflected (the ref
  // update commits in the same tick as setState).
  useEffect(() => {
    let unlisten: UnlistenFn | null = null;
    let cancelled = false;
    (async () => {
      try {
        unlisten = await listen<string>("ghost-diff:layer-removed", (ev) => {
          const cur = snapshotOverlayRef.current;
          if (cur && ev.payload === cur.layerId) {
            setSnapshotOverlay(null);
          }
        });
        if (cancelled) unlisten?.();
      } catch {
        /* listen unavailable */
      }
    })();
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  // Esc returns to live. Keeps other Escape handlers (search / IME) intact
  // by only firing when an overlay is active and the target is inside the
  // terminal area.
  useEffect(() => {
    if (!snapshotOverlay) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const areaRoot = containerRef.current?.closest<HTMLElement>(`.${styles.terminalArea}`);
      const insideArea = areaRoot?.contains(document.activeElement) ?? false;
      if (!insideArea) return;
      e.preventDefault();
      dismissSnapshotOverlay();
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [snapshotOverlay, dismissSnapshotOverlay]);

  // ── Hyperlink click routing (Tier 🟡 #4) ──
  // file:// URLs that resolve inside this pane's cwd open in the built-in
  // editor; everything else falls through to the OS opener. Adapters are
  // captured into refs so the resolved `onOpenUrl` keeps a stable
  // identity across re-renders — TerminalCanvas's mousedown listener
  // would otherwise re-bind on every paint.
  const openInEditorRef = useRef<((path: string) => void) | undefined>(openInEditor);
  openInEditorRef.current = openInEditor;
  const openExternalRef = useRef<((url: string) => Promise<void> | void) | undefined>(openExternal);
  openExternalRef.current = openExternal;
  const onOpenUrl = useCallback(
    async (url: string) => {
      const editor = openInEditorRef.current ?? ((p: string) => useAppStore.getState().openFile(p));
      const external = openExternalRef.current ?? ((u: string) => tauriOpenUrl(u));
      await openTerminalUrlWith(
        url,
        { cwd: cwdRef.current ?? null },
        { openInEditor: editor, openExternal: external },
      );
    },
    [],
  );

  // ── AI CLI detection ──
  // Still used to disable ghost-text autosuggest while an AI CLI owns the
  // prompt. The bar itself is always visible, so we no longer derive its
  // visibility from this state.
  const aiCli = useAICliDetection();
  const imeBarRef = useRef<IMEInputBarHandle>(null);
  // Latest nav bundle from <TerminalCanvas>. Stored in a ref so the
  // keybinding effect below depends only on the ref identity, not on
  // state that changes every prompt-mark event.
  const navRef = useRef<TerminalNav | null>(null);
  const setNav = useCallback((nav: TerminalNav | null) => {
    navRef.current = nav;
  }, []);

  useEffect(() => {
    if (!terminalId) return;
    const decoder = new TextDecoder("utf-8");
    let unlisten: UnlistenFn | null = null;
    let cancelled = false;
    // Accumulate decoded chunks and flush to the AI-CLI detector at most
    // once per 50ms. Under heavy streaming (AI CLI replies) raw pty-output
    // can fire ~25×/sec — batching keeps the detector regex off the hot
    // path without losing text (TextDecoder stream mode preserves partial
    // UTF-8 across chunks).
    let buffer = "";
    let flushTimer: number | null = null;
    const flush = () => {
      flushTimer = null;
      if (!buffer) return;
      const chunk = buffer;
      buffer = "";
      aiCli.feed(chunk);
    };
    (async () => {
      try {
        unlisten = await subscribeOutput(terminalId, (bytes) => {
          buffer += decoder.decode(bytes, { stream: true });
          if (flushTimer === null) {
            flushTimer = window.setTimeout(flush, 50);
          }
        });
        if (cancelled) {
          unlisten?.();
          unlisten = null;
        }
      } catch {
        /* listener unavailable (e.g. native engine off) */
      }
    })();
    return () => {
      cancelled = true;
      if (flushTimer !== null) window.clearTimeout(flushTimer);
      unlisten?.();
    };
  }, [terminalId, subscribeOutput, aiCli]);

  // ── Crash / clean-exit banner ──
  // Set when the backend's `pty-exit-<id>` event fires; cleared when the
  // user dismisses or successfully respawns. dimsRef so the respawn IPC
  // can read the current cell grid without re-registering the listener
  // on every resize tick.
  const [exitInfo, setExitInfo] = useState<PtyExitInfo | null>(null);
  const [respawning, setRespawning] = useState(false);
  const dimsRef = useRef<Dims | null>(null);
  dimsRef.current = dims;
  const exitBannerBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!terminalId) return;
    let unlisten: UnlistenFn | null = null;
    let cancelled = false;
    (async () => {
      try {
        unlisten = await subscribeExit(terminalId, (info) => {
          setExitInfo(info);
        });
        if (cancelled) {
          unlisten?.();
          unlisten = null;
        }
      } catch {
        /* listener unavailable in tests */
      }
    })();
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [terminalId, subscribeExit]);

  // Reset banner state when a brand-new terminal id mounts (project switch).
  useEffect(() => {
    setExitInfo(null);
    setRespawning(false);
  }, [terminalId]);

  // Move keyboard focus into the banner's restart button when it appears
  // so Enter/Space activates it immediately. Without this the user has to
  // click the canvas first, defeating the "press Enter" affordance.
  useEffect(() => {
    if (exitInfo) exitBannerBtnRef.current?.focus();
  }, [exitInfo]);

  const dismissExitBanner = useCallback(() => {
    setExitInfo(null);
  }, []);

  const restartShell = useCallback(async () => {
    if (!terminalId || respawning) return;
    const dimsSnap = dimsRef.current;
    if (!dimsSnap) return;
    setRespawning(true);
    try {
      await respawnPty({
        id: terminalId,
        shell: shellRef.current,
        cols: dimsSnap.cols,
        rows: dimsSnap.rows,
        cwd: cwdRef.current,
      });
      setExitInfo(null);
    } catch {
      // Backend rejected (e.g. id is still alive after a stale event).
      // Leave the banner up so the user can retry; release the lock so
      // the button is clickable again.
    } finally {
      setRespawning(false);
    }
  }, [terminalId, respawning, respawnPty]);

  const focusImeBar = useCallback(() => {
    imeBarRef.current?.focus();
  }, []);

  const focusCanvas = useCallback(() => {
    // Prefer the IME textarea; fall back to the canvas for the initial-mount
    // race where the textarea ref hasn't resolved yet (canvas's onFocus
    // forwards there anyway).
    (canvasInputEl ?? canvasEl)?.focus();
  }, [canvasInputEl, canvasEl]);

  // ── Search UI state ──
  const [searchVisible, setSearchVisible] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeMatchIdx, setActiveMatchIdx] = useState<number | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const liveMatches: SearchMatch[] = useMemo(
    () => findMatches(snapshot, searchQuery),
    [snapshot, searchQuery],
  );
  // Backend pass returns history matches once the user pauses typing
  // (default 120 ms debounce inside the hook). When the active terminal
  // changes mid-search the hook resets, so an empty array is the right
  // safe default.
  const historyMatches = useHistorySearch(terminalId, searchQuery);

  const searchMatches: AnyMatch[] = useMemo(
    () => combineMatches(liveMatches, historyMatches),
    [liveMatches, historyMatches],
  );

  useEffect(() => {
    if (searchMatches.length === 0) {
      setActiveMatchIdx(null);
      return;
    }
    setActiveMatchIdx((prev) => {
      if (prev === null) return 0;
      if (prev >= searchMatches.length) return 0;
      return prev;
    });
  }, [searchMatches]);

  const activeSearchMatch = activeMatchIdx !== null ? (searchMatches[activeMatchIdx] ?? null) : null;

  // Scroll the canvas into view whenever the active match's anchor moves
  // from a live row into history or vice versa. Watching the anchor key
  // rather than the index avoids repeated scrolls when the user just
  // re-types the same query and indices renumber.
  const activeAnchor = activeSearchMatch
    ? activeSearchMatch.kind === "history"
      ? `h:${activeSearchMatch.historyIndex}`
      : `l:${activeSearchMatch.row}`
    : null;
  useEffect(() => {
    if (!activeSearchMatch) return;
    const nav = navRef.current;
    if (!nav) return;
    if (activeSearchMatch.kind === "history") {
      nav.scrollToOffset(scrollOffsetForMatch(activeSearchMatch, dims?.rows ?? 24));
    } else {
      nav.scrollToLive();
    }
    // We intentionally key off the anchor string, not the match object,
    // so identical re-renders (e.g. snapshot polling) don't churn the
    // scroll offset.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeAnchor]);

  const gotoNext = useCallback(() => {
    if (searchMatches.length === 0) return;
    const cur = activeSearchMatch;
    const next = nextMatch(searchMatches, cur);
    if (!next) return;
    const idx = searchMatches.indexOf(next);
    setActiveMatchIdx(idx >= 0 ? idx : null);
  }, [searchMatches, activeSearchMatch]);

  const gotoPrev = useCallback(() => {
    if (searchMatches.length === 0) return;
    const cur = activeSearchMatch;
    const prev = previousMatch(searchMatches, cur);
    if (!prev) return;
    const idx = searchMatches.indexOf(prev);
    setActiveMatchIdx(idx >= 0 ? idx : null);
  }, [searchMatches, activeSearchMatch]);

  const closeSearch = useCallback(() => {
    setSearchVisible(false);
    setSearchQuery("");
    setActiveMatchIdx(null);
  }, []);

  // ── Measurement + spawn ──
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let pending: number | null = null;
    const computeDims = (): Dims | null => {
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
      const next = computeDims();
      if (!next) return;
      setDims((prev) => (prev && prev.cols === next.cols && prev.rows === next.rows ? prev : next));
    };
    const schedule = () => {
      // Trailing-edge debounce ~120ms — only fires after the window stops
      // resizing for the full window. Leading-edge would still snap every
      // 100ms during a continuous drag, repainting the whole canvas and
      // causing the visible text flicker.
      if (pending !== null) window.clearTimeout(pending);
      pending = window.setTimeout(apply, 120);
    };
    // First mount: apply immediately so PTY spawns without waiting.
    apply();
    const ro = new ResizeObserver(schedule);
    ro.observe(el);
    return () => {
      if (pending !== null) window.clearTimeout(pending);
      ro.disconnect();
    };
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

  // ── Global keybindings ──
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const areaRoot = containerRef.current?.closest<HTMLElement>(`.${styles.terminalArea}`);
      const insideArea = areaRoot?.contains(document.activeElement) ?? false;
      if (e.ctrlKey && e.shiftKey && (e.key === "J" || e.key === "j")) {
        if (!insideArea) return;
        e.preventDefault();
        focusImeBar();
        return;
      }
      if (!insideArea) return;
      if (e.ctrlKey && !e.shiftKey && e.key === "f") {
        e.preventDefault();
        setSearchVisible(true);
        requestAnimationFrame(() => searchInputRef.current?.focus());
        return;
      }
      // Scrollback navigation — use Ctrl+Shift to avoid colliding with
      // shell line-history bindings (Ctrl+P / Ctrl+N in zsh/bash, and
      // Ctrl+Up/Down in PSReadLine). The nav bundle is provided by
      // <TerminalCanvas> once a terminal has spawned.
      if (e.ctrlKey && e.shiftKey && e.key === "ArrowUp") {
        const nav = navRef.current;
        if (!nav || !nav.hasHistory()) return;
        e.preventDefault();
        nav.jumpToPrevPrompt();
        return;
      }
      if (e.ctrlKey && e.shiftKey && e.key === "ArrowDown") {
        const nav = navRef.current;
        if (!nav) return;
        e.preventDefault();
        nav.jumpToNextPrompt();
        return;
      }
      if (e.ctrlKey && e.shiftKey && e.key === "End") {
        const nav = navRef.current;
        if (!nav) return;
        e.preventDefault();
        nav.scrollToLive();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [focusImeBar]);

  const sendIMEBytes = useCallback(
    (text: string) => {
      if (!terminalId) return;
      void writePty(terminalId, text);
    },
    [terminalId, writePty],
  );

  // ── Ghost-text suggestion (Phase 3A-2) ──
  // Only active when a real shell is typing at us — AI CLIs own their own
  // prompt framing and predictions would race with their live UI.
  const mirrorEnabled = !!terminalId && !aiCli.active;
  const [suggestion, setSuggestion] = useState<string | null>(null);

  const acceptSuggestion = useCallback(
    (suffix: string) => {
      if (!terminalId) return;
      void writePty(terminalId, suffix);
      setSuggestion(null);
    },
    [terminalId, writePty],
  );

  const commitCommand = useCallback(
    (command: string) => {
      if (!terminalId) return;
      setSuggestion(null);
      void invoke<void>("save_command_history", {
        terminalId,
        command,
        cwd: cwdRef.current ?? ".",
      }).catch(() => {});
    },
    [terminalId],
  );

  const { buffer, reset: resetMirror } = useInputMirror({
    element: canvasInputEl,
    enabled: mirrorEnabled,
    suggestion,
    onAccept: acceptSuggestion,
    onCommit: commitCommand,
  });

  useEffect(() => {
    if (!mirrorEnabled) {
      setSuggestion(null);
      resetMirror();
    }
  }, [mirrorEnabled, resetMirror]);

  useEffect(() => {
    if (!mirrorEnabled) return;
    if (buffer.length < 2) {
      setSuggestion(null);
      return;
    }
    let cancelled = false;
    void invoke<string | null>("suggest_next", { prefix: buffer })
      .then((next) => {
        if (cancelled) return;
        setSuggestion(next ?? null);
      })
      .catch(() => {
        if (!cancelled) setSuggestion(null);
      });
    return () => {
      cancelled = true;
    };
  }, [buffer, mirrorEnabled]);

  // Keying on terminalId only — including dims causes a full
  // unmount/remount on every resize tick, producing visible flicker.
  // TerminalCanvas already handles cols/rows changes via its own
  // dimsChanged path inside the paint effect.
  const canvasKey = terminalId;

  return (
    <div className={styles.terminalArea}>
      {searchVisible && (
        <div className={styles.searchBar}>
          <input
            ref={searchInputRef}
            className={styles.searchInput}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                closeSearch();
              } else if (e.key === "Enter" && e.shiftKey) {
                e.preventDefault();
                gotoPrev();
              } else if (e.key === "Enter") {
                e.preventDefault();
                gotoNext();
              }
            }}
            placeholder="Search..."
          />
          <span className={styles.searchCount}>
            {searchMatches.length > 0 ? `${(activeMatchIdx ?? 0) + 1}/${searchMatches.length}` : "0/0"}
          </span>
          <button type="button" className={styles.searchBtn} onClick={gotoPrev} aria-label="前のマッチ">
            ↑
          </button>
          <button type="button" className={styles.searchBtn} onClick={gotoNext} aria-label="次のマッチ">
            ↓
          </button>
          <button type="button" className={styles.searchBtn} onClick={closeSearch} aria-label="閉じる">
            ×
          </button>
        </div>
      )}
      <TimelineBar
        terminalId={terminalId}
        snapshots={timelineSnapshots}
        activeOverlay={snapshotOverlay}
        onSelectSnapshot={selectSnapshot}
        onDismissOverlay={dismissSnapshotOverlay}
        onMarkSnapshot={handleMarkSnapshot}
      />
      {exitInfo && (
        <div
          className={`${styles.exitBanner} ${exitInfo.crashed ? styles.exitBannerCrashed : ""}`}
          role="alert"
          aria-live="polite"
        >
          <span>{exitBannerMessage(exitInfo)}</span>
          <span className={styles.exitBannerHint}>Press Enter to restart, Esc to dismiss.</span>
          <button
            ref={exitBannerBtnRef}
            type="button"
            className={styles.exitBannerBtn}
            onClick={() => void restartShell()}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                dismissExitBanner();
              }
            }}
            disabled={respawning}
          >
            {respawning ? "Restarting…" : "Restart"}
          </button>
        </div>
      )}
      <div ref={containerRef} className={styles.terminalContainer}>
        {terminalId && dims && (
          <TerminalCanvas
            key={canvasKey ?? undefined}
            terminalId={terminalId}
            cols={dims.cols}
            rows={dims.rows}
            fontSize={FONT_SIZE}
            searchMatches={searchMatches}
            activeSearchMatch={activeSearchMatch}
            ghostSuggestion={snapshotOverlay ? null : mirrorEnabled ? suggestion : null}
            snapshotOverride={snapshotOverlay?.grid}
            onCanvasRef={setCanvasEl}
            onInputRef={setCanvasInputEl}
            onRegisterNav={setNav}
            onOpenUrl={onOpenUrl}
          />
        )}
      </div>
      <IMEInputBar ref={imeBarRef} onSubmit={sendIMEBytes} onRequestCanvasFocus={focusCanvas} />
    </div>
  );
}
