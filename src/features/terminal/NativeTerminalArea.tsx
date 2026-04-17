import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import type { ShellType } from "../../App";
import { IMEInputBar } from "./IMEInputBar";
import { TerminalCanvas } from "./TerminalCanvas";
import { useAICliDetection } from "./hooks/useAICliDetection";
import { useTerminalSnapshot } from "../../shared/hooks/useTerminalSnapshot";
import {
  findMatches,
  nextMatch,
  previousMatch,
  type SearchMatch,
} from "./search";
import styles from "./TerminalArea.module.css";

interface NativeTerminalAreaProps {
  shell?: ShellType;
  cwd?: string;
  onTerminalReady?: (terminalId: string) => void;
  /** Override for tests — defaults to `invoke("spawn_terminal", ...)`. */
  spawnPty?: (args: {
    shell: string;
    cols: number;
    rows: number;
    cwd?: string;
  }) => Promise<string>;
  /** Override for tests — defaults to `invoke("resize_terminal", ...)`. */
  resizePty?: (id: string, cols: number, rows: number) => Promise<void> | void;
  /** Override for tests — defaults to `invoke("write_terminal", ...)`. */
  writePty?: (id: string, data: string) => Promise<void> | void;
  /** Override for tests — defaults to Tauri `listen("pty-output-<id>")`. */
  subscribeOutput?: (
    terminalId: string,
    onBytes: (bytes: Uint8Array) => void,
  ) => Promise<UnlistenFn>;
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

function defaultSpawn(args: {
  shell: string;
  cols: number;
  rows: number;
  cwd?: string;
}): Promise<string> {
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

async function defaultSubscribeOutput(
  terminalId: string,
  onBytes: (bytes: Uint8Array) => void,
): Promise<UnlistenFn> {
  return listen<number[]>(`pty-output-${terminalId}`, (event) => {
    onBytes(new Uint8Array(event.payload));
  });
}

/**
 * Phase 2 / Task 10+11 — feature-flagged host for the native Rust terminal
 * engine.
 *
 * Spawns the PTY, mounts `<TerminalCanvas>`, and layers the ergonomics that
 * sit outside the canvas:
 *   - Ctrl+Shift+J toggles `<IMEInputBar>`; it also auto-opens while a known
 *     AI CLI (claude, codex, gemini, ...) is in the foreground and resets
 *     when the session ends.
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
}: NativeTerminalAreaProps) {
  const containerRef = useRef<HTMLDivElement>(null);
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

  // ── AI CLI / IME input bar ──
  const aiCli = useAICliDetection();
  const aiDismissedRef = useRef(false);
  const [imeInputVisible, setImeInputVisible] = useState(false);

  useEffect(() => {
    if (!terminalId) return;
    const decoder = new TextDecoder("utf-8");
    let unlisten: UnlistenFn | null = null;
    let cancelled = false;
    (async () => {
      try {
        unlisten = await subscribeOutput(terminalId, (bytes) => {
          aiCli.feed(decoder.decode(bytes, { stream: true }));
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
      unlisten?.();
    };
  }, [terminalId, subscribeOutput, aiCli]);

  useEffect(() => {
    if (aiCli.active) {
      if (!aiDismissedRef.current) setImeInputVisible(true);
    } else {
      aiDismissedRef.current = false;
      setImeInputVisible(false);
    }
  }, [aiCli.active]);

  const closeImeBar = useCallback(() => {
    if (aiCli.active) aiDismissedRef.current = true;
    setImeInputVisible(false);
  }, [aiCli.active]);

  const toggleImeBar = useCallback(() => {
    setImeInputVisible((v) => {
      if (v) {
        if (aiCli.active) aiDismissedRef.current = true;
        return false;
      }
      aiDismissedRef.current = false;
      return true;
    });
  }, [aiCli.active]);

  const toggleImeBarRef = useRef(toggleImeBar);
  toggleImeBarRef.current = toggleImeBar;

  // ── Search UI state ──
  const [searchVisible, setSearchVisible] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeMatchIdx, setActiveMatchIdx] = useState<number | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const searchMatches: SearchMatch[] = useMemo(
    () => findMatches(snapshot, searchQuery),
    [snapshot, searchQuery],
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

  const activeSearchMatch =
    activeMatchIdx !== null ? searchMatches[activeMatchIdx] ?? null : null;

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
      setDims((prev) =>
        prev && prev.cols === next.cols && prev.rows === next.rows
          ? prev
          : next,
      );
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
      const areaRoot = containerRef.current?.closest<HTMLElement>(
        `.${styles.terminalArea}`,
      );
      const insideArea = areaRoot?.contains(document.activeElement) ?? false;
      if (e.ctrlKey && e.shiftKey && (e.key === "J" || e.key === "j")) {
        if (!insideArea) return;
        e.preventDefault();
        toggleImeBarRef.current();
        return;
      }
      if (!insideArea) return;
      if (e.ctrlKey && !e.shiftKey && e.key === "f") {
        e.preventDefault();
        setSearchVisible(true);
        requestAnimationFrame(() => searchInputRef.current?.focus());
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const sendIMEBytes = useCallback(
    (text: string) => {
      if (!terminalId) return;
      void writePty(terminalId, text);
    },
    [terminalId, writePty],
  );

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
            {searchMatches.length > 0
              ? `${(activeMatchIdx ?? 0) + 1}/${searchMatches.length}`
              : "0/0"}
          </span>
          <button
            type="button"
            className={styles.searchBtn}
            onClick={gotoPrev}
            aria-label="前のマッチ"
          >
            ↑
          </button>
          <button
            type="button"
            className={styles.searchBtn}
            onClick={gotoNext}
            aria-label="次のマッチ"
          >
            ↓
          </button>
          <button
            type="button"
            className={styles.searchBtn}
            onClick={closeSearch}
            aria-label="閉じる"
          >
            ×
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
          />
        )}
      </div>
      {imeInputVisible && (
        <IMEInputBar onSubmit={sendIMEBytes} onClose={closeImeBar} />
      )}
    </div>
  );
}
