import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { openUrl as tauriOpenUrl } from "@tauri-apps/plugin-opener";
import { ChevronDown, ChevronUp, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { ShellType } from "../../App";
import { useHistorySearch } from "../../shared/hooks/useHistorySearch";
import { useSnapshots } from "../../shared/hooks/useSnapshots";
import { useTerminalSnapshot } from "../../shared/hooks/useTerminalSnapshot";
import { decodeBase64ToBytes } from "../../shared/lib/decodeBase64";
import { formatFallbackError, reportInvokeFailure } from "../../shared/lib/fallbackTelemetry";
import { isTauriRuntime } from "../../shared/lib/tauriRuntime";
import { useAppStore } from "../../shared/store/appStore";
import type { LayerIdPayload } from "../../shared/types/ghostdiff";
import type { SnapshotSummary } from "../../shared/types/snapshot";
import { type ActiveSnapshotOverlay, TimelineBar } from "../timeline/TimelineBar";
import { useAICliDetection } from "./hooks/useAICliDetection";
import {
  IME_DIAGNOSTIC_EVENT,
  IME_DIAGNOSTIC_STORAGE_KEY,
  IME_DIAGNOSTIC_TOGGLE_EVENT,
  type ImeDiagnosticDetail,
  type ImeDiagnosticWritePath,
  imeDiagnosticsEnabled,
} from "./hooks/useCanvasIME";
import { useInputMirror } from "./hooks/useInputMirror";
import { IMEInputBar, type IMEInputBarHandle } from "./IMEInputBar";
import { openTerminalUrlWith } from "./openTerminalUrl";
import type { PaneLifecycleState } from "./pane-tree";
import {
  type AnyMatch,
  combineMatches,
  findMatches,
  nextMatch,
  previousMatch,
  type SearchMatch,
  scrollOffsetForMatch,
} from "./search";
import styles from "./TerminalArea.module.css";
import { TerminalCanvas, type TerminalNav } from "./TerminalCanvas";
import { TERMINAL_FONT_FAMILY, TERMINAL_FONT_SIZE, useTerminalCellMetrics } from "./terminalMetrics";

interface NativeTerminalAreaProps {
  shell?: ShellType;
  cwd?: string;
  /** Existing backend PTY id to bind instead of spawning a new shell. */
  attachedTerminalId?: string | null;
  onTerminalReady?: (terminalId: string) => void;
  onLifecycleChange?: (lifecycle: PaneLifecycleState) => void;
  /** Imperative restart bridge for workstation/process-manager surfaces. */
  restartRequest?: { sequence: number; onComplete?: (error: string | null) => void } | null;
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
  respawnPty?: (args: { id: string; shell: string; cols: number; rows: number; cwd?: string }) => Promise<void>;
  /** Override for tests — defaults to `invoke("force_restart_terminal", ...)`. */
  forceRestartPty?: (args: { id: string; shell: string; cols: number; rows: number; cwd?: string }) => Promise<void>;
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

const MIN_COLS = 20;
const MIN_ROWS = 5;
// Must match `.terminalViewport` padding so PTY cols/rows describe the
// drawable canvas well, not the decorative glass gutter around it.
const CANVAS_GUTTER = 10;

interface Dims {
  cols: number;
  rows: number;
}

type InputWritePath = "idle" | "input-bar" | "ghost-suggestion" | ImeDiagnosticWritePath;
type SpawnStatus = "idle" | "starting" | "failed";

function inputWritePathLabel(path: InputWritePath): string {
  switch (path) {
    case "canvas":
      return "canvas";
    case "canvas-keymap":
      return "canvas keymap";
    case "ime-composition":
      return "IME composition";
    case "ime-commit":
      return "IME commit";
    case "input-bar":
      return "input bar";
    case "ghost-suggestion":
      return "ghost suggestion";
    case "paste":
      return "paste";
    case "focus":
      return "focus";
    case "terminal-prefix":
      return "terminal prefix";
    case "ignored":
      return "ignored";
    case "idle":
      return "idle";
  }
}

function shellDisplayName(shell: ShellType): string {
  switch (shell) {
    case "powershell":
      return "PowerShell";
    case "cmd":
      return "CMD";
    case "gitbash":
      return "Git Bash";
    case "wsl":
      return "WSL";
  }
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
  return invoke<void>("resize_terminal", { id, cols, rows });
}

function defaultWrite(id: string, data: string): Promise<void> {
  return invoke<void>("write_terminal", { id, data });
}

async function defaultSubscribeOutput(terminalId: string, onBytes: (bytes: Uint8Array) => void): Promise<UnlistenFn> {
  return listen<number[] | { dataBase64: string }>(`pty-output-${terminalId}`, (event) => {
    const payload = event.payload;
    if (Array.isArray(payload)) {
      onBytes(new Uint8Array(payload));
      return;
    }
    onBytes(decodeBase64ToBytes(payload.dataBase64));
  });
}

async function defaultSubscribeExit(terminalId: string, onExit: (info: PtyExitInfo) => void): Promise<UnlistenFn> {
  return listen<PtyExitInfo>(`pty-exit-${terminalId}`, (event) => {
    onExit(event.payload);
  });
}

function defaultRespawn(args: { id: string; shell: string; cols: number; rows: number; cwd?: string }): Promise<void> {
  return invoke<void>("respawn_terminal", {
    id: args.id,
    shell: args.shell,
    cols: args.cols,
    rows: args.rows,
    cwd: args.cwd ?? null,
  });
}

function defaultForceRestart(args: {
  id: string;
  shell: string;
  cols: number;
  rows: number;
  cwd?: string;
}): Promise<void> {
  return invoke<void>("force_restart_terminal", {
    id: args.id,
    shell: args.shell,
    cols: args.cols,
    rows: args.rows,
    cwd: args.cwd ?? null,
  });
}

function exitBannerMessage(info: PtyExitInfo): string {
  if (info.crashed) {
    return info.code === null ? "Shell crashed (no exit code)." : `Shell crashed (code ${info.code}).`;
  }
  return info.code === null ? "Shell exited." : `Shell exited (code ${info.code}).`;
}

function formatErrorMessage(err: unknown): string {
  return formatFallbackError(err);
}

function formatInputPayloadSummary(data: string): string {
  if (data.length === 0) return "0 chars";
  const lineBreaks = data.match(/\r\n|\n|\r/g)?.length ?? 0;
  const suffix = lineBreaks > 0 ? `, ${lineBreaks} enter${lineBreaks === 1 ? "" : "s"}` : "";
  return `${data.length} char${data.length === 1 ? "" : "s"}${suffix}`;
}

function formatImeEventSummary(event: ImeDiagnosticDetail | null): string {
  if (!event) return "none";
  if (event.sentLength !== undefined) {
    return `${event.phase} ${event.sentLength} char${event.sentLength === 1 ? "" : "s"}`;
  }
  if (event.dataLength !== null && event.dataLength !== undefined) {
    return `${event.phase} data=${event.dataLength}`;
  }
  return event.phase;
}

function formatCandidateRect(event: ImeDiagnosticDetail | null): string {
  if (!event?.candidateLeft || !event.candidateTop) return "n/a";
  return `${event.candidateLeft}, ${event.candidateTop}`;
}

function shouldCountDroppedKey(event: ImeDiagnosticDetail): boolean {
  return event.dropped === true;
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
  attachedTerminalId = null,
  onTerminalReady,
  onLifecycleChange,
  restartRequest,
  spawnPty = defaultSpawn,
  resizePty = defaultResize,
  writePty = defaultWrite,
  subscribeOutput = defaultSubscribeOutput,
  subscribeExit = defaultSubscribeExit,
  respawnPty = defaultRespawn,
  forceRestartPty = defaultForceRestart,
  openInEditor,
  openExternal,
}: NativeTerminalAreaProps) {
  const previewMode = !isTauriRuntime();
  const cellMetrics = useTerminalCellMetrics(TERMINAL_FONT_SIZE, TERMINAL_FONT_FAMILY);
  const containerRef = useRef<HTMLDivElement>(null);
  const [canvasEl, setCanvasEl] = useState<HTMLCanvasElement | null>(null);
  // Phase B: the hidden IME textarea on the canvas is the real keyboard-
  // input element. `useInputMirror` (ghost-text buffer) and focus-restore
  // shortcuts both target this element.
  const [canvasInputEl, setCanvasInputEl] = useState<HTMLTextAreaElement | null>(null);
  const [terminalId, setTerminalId] = useState<string | null>(null);
  const [dims, setDims] = useState<Dims | null>(null);
  const [spawnStatus, setSpawnStatus] = useState<SpawnStatus>("idle");
  const [spawnRetryNonce, setSpawnRetryNonce] = useState(0);
  const [spawnError, setSpawnError] = useState<string | null>(null);
  const spawnStartedRef = useRef(false);
  const spawnAttemptRef = useRef(0);
  const shellRef = useRef(shell);
  const cwdRef = useRef(cwd);
  const onReadyRef = useRef(onTerminalReady);
  const onLifecycleChangeRef = useRef(onLifecycleChange);
  const spawnFnRef = useRef(spawnPty);
  shellRef.current = shell;
  cwdRef.current = cwd;
  onReadyRef.current = onTerminalReady;
  onLifecycleChangeRef.current = onLifecycleChange;
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
    void terminalId;
    if (previewMode) return;
    setSnapshotOverlay(null);
    return () => {
      const stale = snapshotOverlayRef.current;
      if (stale) {
        dismissBackendLayer(stale.layerId);
      }
    };
  }, [terminalId, dismissBackendLayer, previewMode]);

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
    if (previewMode) return;
    let unlisten: UnlistenFn | null = null;
    let cancelled = false;
    (async () => {
      try {
        unlisten = await listen<LayerIdPayload>("ghost-diff:layer-removed", (ev) => {
          const cur = snapshotOverlayRef.current;
          if (cur && ev.payload.layerId === cur.layerId) {
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
  }, [previewMode]);

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
  const onOpenUrl = useCallback(async (url: string) => {
    const editor = openInEditorRef.current ?? ((p: string) => useAppStore.getState().openFile(p));
    const external = openExternalRef.current ?? ((u: string) => tauriOpenUrl(u));
    await openTerminalUrlWith(url, { cwd: cwdRef.current ?? null }, { openInEditor: editor, openExternal: external });
  }, []);

  // ── AI CLI detection ──
  // Still used to disable ghost-text autosuggest while an AI CLI owns the
  // prompt. The bar itself is always visible, so we no longer derive its
  // visibility from this state.
  const aiCli = useAICliDetection();
  const imeBarRef = useRef<IMEInputBarHandle>(null);
  const [inputDiagnosticsEnabled, setInputDiagnosticsEnabled] = useState(() =>
    typeof window !== "undefined" ? imeDiagnosticsEnabled(window) : false,
  );
  const [lastImeDiagnostic, setLastImeDiagnostic] = useState<ImeDiagnosticDetail | null>(null);
  const [inputWritePath, setInputWritePath] = useState<InputWritePath>("idle");
  const [lastInputCommit, setLastInputCommit] = useState("none");
  const [droppedKeyCount, setDroppedKeyCount] = useState(0);
  // Latest nav bundle from <TerminalCanvas>. Stored in a ref so the
  // keybinding effect below depends only on the ref identity, not on
  // state that changes every prompt-mark event.
  const navRef = useRef<TerminalNav | null>(null);
  const setNav = useCallback((nav: TerminalNav | null) => {
    navRef.current = nav;
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const refreshEnabled = () => setInputDiagnosticsEnabled(imeDiagnosticsEnabled(window));
    const onImeDiagnostic = (event: Event) => {
      const detail = (event as CustomEvent<ImeDiagnosticDetail>).detail;
      if (!detail) return;
      setInputDiagnosticsEnabled(true);
      setLastImeDiagnostic(detail);
      if (detail.writePath) {
        setInputWritePath(detail.writePath);
      }
      if (detail.sentLength !== undefined) {
        setLastInputCommit(formatImeEventSummary(detail));
      }
      if (shouldCountDroppedKey(detail)) {
        setDroppedKeyCount((count) => count + 1);
      }
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === IME_DIAGNOSTIC_STORAGE_KEY) refreshEnabled();
    };

    refreshEnabled();
    window.addEventListener(IME_DIAGNOSTIC_EVENT, onImeDiagnostic);
    window.addEventListener(IME_DIAGNOSTIC_TOGGLE_EVENT, refreshEnabled);
    window.addEventListener("storage", onStorage);
    const timer = window.setInterval(refreshEnabled, 1000);
    return () => {
      window.removeEventListener(IME_DIAGNOSTIC_EVENT, onImeDiagnostic);
      window.removeEventListener(IME_DIAGNOSTIC_TOGGLE_EVENT, refreshEnabled);
      window.removeEventListener("storage", onStorage);
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (previewMode) return;
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
          return;
        }
        const replay = await invoke<string>("capture_pane", {
          terminalId,
          lines: 80,
          stripAnsiCodes: false,
        }).catch((err) => {
          reportInvokeFailure({
            source: "terminal",
            operation: "capture_pane",
            err,
            severity: "warning",
          });
          return "";
        });
        if (!cancelled && replay) {
          aiCli.feed(replay);
        }
      } catch (err) {
        if (!cancelled) {
          const message = formatErrorMessage(err);
          reportInvokeFailure({
            source: "terminal",
            operation: "subscribe_pty_output",
            err,
            severity: "error",
            userVisible: true,
          });
          setTerminalWarning(`Output listener unavailable: ${message}`);
        }
      }
    })();
    return () => {
      cancelled = true;
      const tail = decoder.decode();
      if (tail) buffer += tail;
      if (flushTimer !== null) {
        window.clearTimeout(flushTimer);
        flushTimer = null;
      }
      flush();
      unlisten?.();
    };
  }, [terminalId, subscribeOutput, aiCli, previewMode]);

  // ── Crash / clean-exit banner ──
  // Set when the backend's `pty-exit-<id>` event fires; cleared when the
  // user dismisses or successfully respawns. dimsRef so the respawn IPC
  // can read the current cell grid without re-registering the listener
  // on every resize tick.
  const [exitInfo, setExitInfo] = useState<PtyExitInfo | null>(null);
  const [respawning, setRespawning] = useState(false);
  const [writeError, setWriteError] = useState<string | null>(null);
  const [terminalWarning, setTerminalWarning] = useState<string | null>(null);
  const dimsRef = useRef<Dims | null>(null);
  const handledRestartRequestRef = useRef<number | null>(null);
  dimsRef.current = dims;
  const exitBannerBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const lifecycle: PaneLifecycleState = respawning
      ? "restarting"
      : exitInfo
        ? exitInfo.crashed
          ? "crashed"
          : "exited"
        : terminalId
          ? "live"
          : spawnStatus === "starting"
            ? "starting"
            : "layout-only";
    onLifecycleChangeRef.current?.(lifecycle);
  }, [exitInfo, respawning, spawnStatus, terminalId]);

  useEffect(() => {
    if (previewMode) return;
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
      } catch (err) {
        if (!cancelled && isTauriRuntime()) {
          reportInvokeFailure({
            source: "terminal",
            operation: "subscribe_pty_exit",
            err,
            severity: "warning",
          });
        }
      }
    })();
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [terminalId, subscribeExit, previewMode]);

  // Reset banner state when a brand-new terminal id mounts (project switch).
  useEffect(() => {
    void terminalId;
    setSpawnStatus("idle");
    setSpawnError(null);
    spawnAttemptRef.current = 0;
    setExitInfo(null);
    setRespawning(false);
    setWriteError(null);
    setTerminalWarning(null);
  }, [terminalId]);

  // Move keyboard focus into the banner's restart button when it appears
  // so Enter/Space activates it immediately. Without this the user has to
  // click the canvas first, defeating the "press Enter" affordance.
  useEffect(() => {
    if (exitInfo) exitBannerBtnRef.current?.focus();
  }, [exitInfo]);

  const writeToPty = useCallback(
    (id: string, data: string) => {
      void Promise.resolve(writePty(id, data))
        .then(() => {
          setWriteError((prev) => (prev === null ? prev : null));
        })
        .catch((err) => {
          setWriteError(formatErrorMessage(err));
        });
    },
    [writePty],
  );

  const dismissExitBanner = useCallback(() => {
    setExitInfo(null);
  }, []);

  // Honour the banner's "Esc to dismiss" hint at the area scope rather
  // than only on the button's onKeyDown. If the user clicks the canvas
  // (which steals focus) and *then* presses Esc, the previous wiring
  // failed because the button no longer had focus. Now the banner
  // listens at the area-root level while it's mounted.
  useEffect(() => {
    if (!exitInfo) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const areaRoot = containerRef.current?.closest<HTMLElement>(`.${styles.terminalArea}`);
      const insideArea = areaRoot?.contains(document.activeElement) ?? false;
      if (!insideArea) return;
      e.preventDefault();
      e.stopPropagation();
      dismissExitBanner();
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [exitInfo, dismissExitBanner]);

  const restartShell = useCallback(async (): Promise<string | null> => {
    if (!terminalId) return "Terminal is not ready to restart.";
    if (respawning) return "Restart is already in progress.";
    const dimsSnap = dimsRef.current;
    if (!dimsSnap) return "Terminal size is not ready.";
    setRespawning(true);
    try {
      const restartPty = exitInfo ? respawnPty : forceRestartPty;
      await restartPty({
        id: terminalId,
        shell: shellRef.current,
        cols: dimsSnap.cols,
        rows: dimsSnap.rows,
        cwd: cwdRef.current,
      });
      setExitInfo(null);
      return null;
    } catch (err) {
      // Backend rejected (e.g. id is still alive after a stale event).
      // Leave the banner up so the user can retry; release the lock so
      // the button is clickable again.
      return formatErrorMessage(err);
    } finally {
      setRespawning(false);
    }
  }, [exitInfo, forceRestartPty, terminalId, respawning, respawnPty]);

  useEffect(() => {
    if (!restartRequest) return;
    if (handledRestartRequestRef.current === restartRequest.sequence) return;
    handledRestartRequestRef.current = restartRequest.sequence;
    void restartShell().then((error) => restartRequest.onComplete?.(error));
  }, [restartRequest, restartShell]);

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

  const liveMatches: SearchMatch[] = useMemo(() => findMatches(snapshot, searchQuery), [snapshot, searchQuery]);
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

  // Scroll the canvas into view whenever the active match moves from a
  // live row into history or vice versa.
  useEffect(() => {
    if (!activeSearchMatch) return;
    const nav = navRef.current;
    if (!nav) return;
    if (activeSearchMatch.kind === "history") {
      nav.scrollToOffset(scrollOffsetForMatch(activeSearchMatch, dims?.rows ?? 24));
    } else {
      nav.scrollToLive();
    }
  }, [activeSearchMatch, dims?.rows]);

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
    if (typeof window.requestAnimationFrame === "function") {
      window.requestAnimationFrame(focusCanvas);
    } else {
      focusCanvas();
    }
  }, [focusCanvas]);

  // ── Measurement + spawn ──
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let frame: number | null = null;
    let settleTimer: number | null = null;
    const computeDims = (): Dims | null => {
      const w = el.clientWidth - CANVAS_GUTTER * 2;
      const h = el.clientHeight - CANVAS_GUTTER * 2;
      if (w <= 0 || h <= 0) return null;
      return {
        cols: Math.max(MIN_COLS, Math.floor(w / cellMetrics.width)),
        rows: Math.max(MIN_ROWS, Math.floor(h / cellMetrics.height)),
      };
    };
    const apply = () => {
      const next = computeDims();
      if (!next) return;
      setDims((prev) => (prev && prev.cols === next.cols && prev.rows === next.rows ? prev : next));
    };
    const requestFrame =
      typeof window.requestAnimationFrame === "function"
        ? window.requestAnimationFrame.bind(window)
        : (callback: FrameRequestCallback) => window.setTimeout(() => callback(Date.now()), 16);
    const cancelFrame =
      typeof window.cancelAnimationFrame === "function"
        ? window.cancelAnimationFrame.bind(window)
        : window.clearTimeout.bind(window);
    const schedule = () => {
      if (frame === null) {
        frame = requestFrame(() => {
          frame = null;
          apply();
        });
      }
      if (settleTimer !== null) window.clearTimeout(settleTimer);
      settleTimer = window.setTimeout(() => {
        settleTimer = null;
        if (frame !== null) {
          cancelFrame(frame);
          frame = null;
        }
        apply();
      }, 48);
    };
    // First mount: apply immediately so PTY spawns without waiting.
    apply();
    const ro = new ResizeObserver(schedule);
    ro.observe(el);
    return () => {
      if (frame !== null) cancelFrame(frame);
      if (settleTimer !== null) window.clearTimeout(settleTimer);
      ro.disconnect();
    };
  }, [cellMetrics.height, cellMetrics.width]);

  useEffect(() => {
    if (previewMode) return;
    if (!attachedTerminalId || terminalId === attachedTerminalId || spawnStartedRef.current) return;
    spawnStartedRef.current = true;
    setSpawnStatus("starting");
    setTerminalId(attachedTerminalId);
    onReadyRef.current?.(attachedTerminalId);
  }, [attachedTerminalId, previewMode, terminalId]);

  useEffect(() => {
    if (previewMode) return;
    if (!dims || spawnStartedRef.current) return;
    spawnStartedRef.current = true;
    spawnAttemptRef.current = Math.max(spawnAttemptRef.current + 1, spawnRetryNonce + 1);
    const attempt = spawnAttemptRef.current;
    let cancelled = false;
    let retryTimer: number | null = null;
    setSpawnStatus("starting");
    setSpawnError(null);
    (async () => {
      try {
        const id = await spawnFnRef.current({
          shell: shellRef.current,
          cols: dims.cols,
          rows: dims.rows,
          cwd: cwdRef.current,
        });
        if (cancelled) return;
        setSpawnError(null);
        setTerminalId(id);
        onReadyRef.current?.(id);
      } catch (err) {
        spawnStartedRef.current = false;
        if (!cancelled) {
          setSpawnError(formatErrorMessage(err));
          setSpawnStatus("failed");
          if (attempt < 3) {
            retryTimer = window.setTimeout(() => {
              if (!cancelled) setSpawnRetryNonce((value) => value + 1);
            }, 400 * attempt);
          }
        }
      }
    })();
    return () => {
      cancelled = true;
      if (retryTimer !== null) window.clearTimeout(retryTimer);
    };
  }, [dims, previewMode, spawnRetryNonce]);

  useEffect(() => {
    if (previewMode) return;
    if (!terminalId || !dims) return;
    let cancelled = false;
    void Promise.resolve(resizePty(terminalId, dims.cols, dims.rows))
      .then(() => {
        if (!cancelled) {
          setTerminalWarning((prev) => (prev?.startsWith("Resize failed:") ? null : prev));
        }
      })
      .catch((err) => {
        if (cancelled) return;
        const message = formatErrorMessage(err);
        reportInvokeFailure({
          source: "terminal",
          operation: "resize_terminal",
          err,
          severity: "warning",
          userVisible: true,
        });
        setTerminalWarning(`Resize failed: ${message}`);
      });
    return () => {
      cancelled = true;
    };
  }, [terminalId, dims, resizePty, previewMode]);

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
      if (e.ctrlKey && e.shiftKey && (e.key === "F" || e.key === "f")) {
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
        if (!nav?.hasHistory()) return;
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
      if (!terminalId) {
        setDroppedKeyCount((count) => count + 1);
        return;
      }
      setInputWritePath("input-bar");
      setLastInputCommit(formatInputPayloadSummary(text));
      aiCli.feedInput(text);
      writeToPty(terminalId, text);
    },
    [aiCli.feedInput, terminalId, writeToPty],
  );

  const writeTerminalBytes = useCallback(
    (id: string, data: string) => {
      setInputWritePath("canvas");
      setLastInputCommit(formatInputPayloadSummary(data));
      aiCli.feedInput(data);
      writeToPty(id, data);
    },
    [aiCli.feedInput, writeToPty],
  );

  // ── Ghost-text suggestion (Phase 3A-2) ──
  // Only active when a real shell is typing at us — AI CLIs own their own
  // prompt framing and predictions would race with their live UI.
  const mirrorEnabled = !!terminalId && !aiCli.active;
  const [suggestion, setSuggestion] = useState<string | null>(null);

  const acceptSuggestion = useCallback(
    (suffix: string) => {
      if (!terminalId) {
        setDroppedKeyCount((count) => count + 1);
        return;
      }
      setInputWritePath("ghost-suggestion");
      setLastInputCommit(formatInputPayloadSummary(suffix));
      writeToPty(terminalId, suffix);
      setSuggestion(null);
    },
    [terminalId, writeToPty],
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
  const diagnosticTerminal = terminalId ?? "not ready";
  const diagnosticFocus = lastImeDiagnostic?.active ? "focused" : "not focused";
  const diagnosticComposition = lastImeDiagnostic?.composing ? "composing" : "idle";
  const diagnosticCandidate = formatCandidateRect(lastImeDiagnostic);
  const diagnosticLastEvent = formatImeEventSummary(lastImeDiagnostic);
  const startupMessage =
    spawnStatus === "failed"
      ? `Failed to start ${shellDisplayName(shell)}${spawnError ? `: ${spawnError}` : ""}`
      : `${dims ? "Starting" : "Preparing"} ${shellDisplayName(shell)}...`;

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
          <span
            className={styles.searchCount}
            data-empty={searchQuery.length > 0 && searchMatches.length === 0 ? "true" : undefined}
          >
            {searchMatches.length > 0 ? `${(activeMatchIdx ?? 0) + 1}/${searchMatches.length}` : "0/0"}
          </span>
          <button
            type="button"
            className={styles.searchBtn}
            onClick={gotoPrev}
            aria-label="Previous match"
            title="Previous match (Shift+Enter)"
          >
            <ChevronUp size={14} aria-hidden="true" />
          </button>
          <button
            type="button"
            className={styles.searchBtn}
            onClick={gotoNext}
            aria-label="Next match"
            title="Next match (Enter)"
          >
            <ChevronDown size={14} aria-hidden="true" />
          </button>
          <button
            type="button"
            className={styles.searchBtn}
            onClick={closeSearch}
            aria-label="Close search"
            title="Close search (Esc)"
          >
            <X size={14} aria-hidden="true" />
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
            {respawning ? "Restarting..." : "Restart"}
          </button>
        </div>
      )}
      <div ref={containerRef} className={styles.terminalContainer}>
        {previewMode ? (
          <div className={styles.terminalViewport} data-preview="true">
            <div className={styles.previewPrompt}>
              <span className={styles.previewUser}>aether</span>
              <span className={styles.previewPath}>~/work/aether-terminal</span>
              <span className={styles.previewGit}>on main</span>
              <span className={styles.previewCommand}>git diff --stat</span>
              <span className={styles.previewCursor} />
            </div>
          </div>
        ) : terminalId && dims ? (
          <div className={styles.terminalViewport}>
            {inputDiagnosticsEnabled && (
              <div
                className={styles.inputDiagnosticsOverlay}
                data-testid="terminal-input-diagnostics"
                aria-live="polite"
              >
                <div className={styles.inputDiagnosticsHeader}>
                  <span>Input diagnostics</span>
                  <span>{aiCli.active ? "AI CLI" : shell}</span>
                </div>
                <dl className={styles.inputDiagnosticsGrid}>
                  <dt>Active pane</dt>
                  <dd>{diagnosticFocus}</dd>
                  <dt>Terminal</dt>
                  <dd>{diagnosticTerminal}</dd>
                  <dt>Composition</dt>
                  <dd>{diagnosticComposition}</dd>
                  <dt>Write path</dt>
                  <dd>{inputWritePathLabel(inputWritePath)}</dd>
                  <dt>Last commit</dt>
                  <dd>{lastInputCommit}</dd>
                  <dt>Dropped keys</dt>
                  <dd>{droppedKeyCount}</dd>
                  <dt>Candidate</dt>
                  <dd>{diagnosticCandidate}</dd>
                  <dt>Event</dt>
                  <dd>{diagnosticLastEvent}</dd>
                </dl>
              </div>
            )}
            {writeError && (
              <div className={styles.writeErrorBadge} role="alert">
                <span>Input write failed</span>
                <span className={styles.writeErrorDetail}>{writeError}</span>
                <button
                  type="button"
                  className={styles.writeErrorDismiss}
                  onClick={() => setWriteError(null)}
                  aria-label="Dismiss input write error"
                  title="Dismiss"
                >
                  <X size={12} aria-hidden="true" />
                </button>
              </div>
            )}
            {terminalWarning && (
              <div
                className={`${styles.writeErrorBadge} ${writeError ? styles.terminalWarningBadgeStacked : styles.terminalWarningBadge}`}
                role="status"
              >
                <span>Terminal degraded</span>
                <span className={styles.writeErrorDetail}>{terminalWarning}</span>
                <button
                  type="button"
                  className={styles.writeErrorDismiss}
                  onClick={() => setTerminalWarning(null)}
                  aria-label="Dismiss terminal warning"
                  title="Dismiss"
                >
                  <X size={12} aria-hidden="true" />
                </button>
              </div>
            )}
            <TerminalCanvas
              key={canvasKey ?? undefined}
              terminalId={terminalId}
              cols={dims.cols}
              rows={dims.rows}
              fontSize={TERMINAL_FONT_SIZE}
              fontFamily={TERMINAL_FONT_FAMILY}
              searchMatches={searchMatches}
              activeSearchMatch={activeSearchMatch}
              ghostSuggestion={snapshotOverlay ? null : mirrorEnabled ? suggestion : null}
              preferAiInputAnchor={aiCli.active}
              showInputDiagnosticsOverlay={false}
              snapshotOverride={snapshotOverlay?.grid}
              liveSnapshot={snapshot}
              writeBytes={writeTerminalBytes}
              onCanvasRef={setCanvasEl}
              onInputRef={setCanvasInputEl}
              onRegisterNav={setNav}
              onOpenUrl={onOpenUrl}
            />
          </div>
        ) : (
          <div className={styles.terminalViewport} data-state={spawnStatus === "failed" ? "failed" : "starting"}>
            <div className={styles.terminalStarting} role="status" aria-live="polite">
              <span className={styles.terminalStartingDot} aria-hidden="true" />
              <span>{startupMessage}</span>
            </div>
          </div>
        )}
      </div>
      <IMEInputBar ref={imeBarRef} onSubmit={sendIMEBytes} onRequestCanvasFocus={focusCanvas} />
    </div>
  );
}
