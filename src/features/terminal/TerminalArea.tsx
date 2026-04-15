import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { CommandBlockTracker, detectPrompt } from "./commandBlock";
import { CommandHistory } from "./CommandHistory";
import { findSuggestion, GhostSuggestOverlay } from "./ghostSuggest";
import { decodeBase64ToBytes } from "../../shared/lib/decodeBase64";
import { detectError } from "../../shared/lib/errorDetector";
import { useToastStore } from "../../shared/store/toastStore";

interface TerminalWithCleanup extends Terminal {
  __ptyCleanup?: () => void;
  __ptyId?: string;
}
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import "@xterm/xterm/css/xterm.css";
import type { ShellType } from "../../App";
import { useAppStore } from "../../shared/store/appStore";
import { useXtermTheme } from "../../shared/hooks/useTheme";
import styles from "./TerminalArea.module.css";

interface TerminalAreaProps {
  shell?: ShellType;
  cwd?: string;
  syncMode?: boolean;
  onTerminalReady?: (terminalId: string) => void;
  onStartAgent?: (prompt: string) => void;
}

export function TerminalArea({ shell = "powershell", cwd, syncMode, onTerminalReady: _onTerminalReady, onStartAgent }: TerminalAreaProps) {
  const onTerminalReady = _onTerminalReady;
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const syncModeRef = useRef(syncMode);
  useEffect(() => { syncModeRef.current = syncMode; }, [syncMode]);
  const searchAddonRef = useRef<SearchAddon | null>(null);
  const [searchVisible, setSearchVisible] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const blockTrackerRef = useRef<CommandBlockTracker>(new CommandBlockTracker());
  const [commandHistory, setCommandHistory] = useState<string[]>([]);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const themeId = useAppStore((s) => s.themeId);
  const xtermTheme = useXtermTheme(themeId);

  useEffect(() => {
    if (termRef.current) {
      termRef.current.options.theme = xtermTheme;
    }
  }, [xtermTheme]);

  useEffect(() => {
    if (!containerRef.current || termRef.current) return;

    const term = new Terminal({
      theme: xtermTheme,
      fontFamily: "IBM Plex Mono, Cascadia Code, Cascadia Next JP, monospace",
      fontSize: 14,
      lineHeight: 1.4,
      cursorStyle: "bar",
      cursorBlink: true,
      allowTransparency: true,
      allowProposedApi: true,
      scrollback: 10000,
    });

    const fitAddon = new FitAddon();
    const searchAddon = new SearchAddon();

    const unicode11 = new Unicode11Addon();
    term.loadAddon(unicode11);
    term.loadAddon(fitAddon);
    term.loadAddon(searchAddon);
    term.loadAddon(new WebLinksAddon());
    term.open(containerRef.current);
    term.unicode.activeVersion = "11";

    fitAddon.fit();
    termRef.current = term;
    searchAddonRef.current = searchAddon;

    const cleanupIME = setupIMEOverlay(term, containerRef.current);
    const ghost = new GhostSuggestOverlay(containerRef.current);

    const blockTracker = blockTrackerRef.current;
    const updateHistory = () => {
      const blocks = blockTracker.getBlocks();
      const cmds = blocks.map((b) => b.command).filter((c) => c.length > 0);
      setCommandHistory(cmds);
    };

    // Ghost typing: track current input and show suggestions
    let currentInput = "";
    term.onData((data) => {
      if (data === "\r" || data === "\n") {
        currentInput = "";
        ghost.hide();
      } else if (data === "\x7f" || data === "\b") {
        currentInput = currentInput.slice(0, -1);
      } else if (data.length === 1 && data.charCodeAt(0) >= 32) {
        currentInput += data;
      } else if (data === "\t") {
        // Tab: accept ghost suggestion
        const suggestion = ghost.getSuggestion();
        if (suggestion) {
          const remaining = suggestion.slice(currentInput.length);
          const ptyId = (term as TerminalWithCleanup).__ptyId;
          if (ptyId && remaining) {
            import("@tauri-apps/api/core").then(({ invoke }) => {
              invoke("write_terminal", { id: ptyId, data: remaining });
            });
            currentInput = suggestion;
            ghost.hide();
            return; // Don't forward Tab to PTY
          }
        }
      }

      // Update ghost suggestion
      if (currentInput.length >= 2) {
        const history = blockTracker.getBlocks().map((b) => b.command).filter((c) => c.length > 0);
        const suggestion = findSuggestion(currentInput, history);
        if (suggestion) {
          const cursor = containerRef.current?.querySelector(".xterm-cursor-layer");
          if (cursor) {
            const style = window.getComputedStyle(cursor);
            ghost.show(suggestion, currentInput.length, parseInt(style.left || "0"), parseInt(style.top || "0"));
          }
        } else {
          ghost.hide();
        }
      } else {
        ghost.hide();
      }
    });

    connectPty(term, shell, cwd, onTerminalReady, syncModeRef, blockTracker, updateHistory, onStartAgent);

    const handleCtrlV = async (e: KeyboardEvent) => {
      if (!(e.ctrlKey && e.key === "v")) return;
      // Only handle if THIS terminal has focus (not all terminals)
      const active = document.activeElement;
      if (!containerRef.current?.contains(active)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      try {
        const clipItems = await navigator.clipboard.read();
        for (const item of clipItems) {
          const imageType = item.types.find((t: string) => t.startsWith("image/"));
          if (imageType) {
            const blob = await item.getType(imageType);
            const reader = new FileReader();
            reader.onload = async () => {
              try {
                const { invoke: inv } = await import("@tauri-apps/api/core");
                const { escapeShellPath } = await import("../../shared/lib/shellSafety");
                const path = await inv<string>("save_temp_image", { data: reader.result as string });
                const escaped = escapeShellPath(path);
                term.paste(`--image "${escaped}" `);
                term.writeln(`\x1b[90m[Image: ${escaped}]\x1b[0m`);
              } catch (err) {
                term.writeln(`\x1b[31m[Image paste failed: ${err}]\x1b[0m`);
              }
            };
            reader.readAsDataURL(blob);
            return;
          }
        }
        const text = await navigator.clipboard.readText();
        if (text) term.paste(text);
      } catch {
        try {
          const text = await navigator.clipboard.readText();
          if (text) term.paste(text);
        } catch { /* give up */ }
      }
    };
    document.addEventListener("keydown", handleCtrlV, { capture: true });

    // Use ResizeObserver on container instead of window resize
    // This correctly handles SplitPane drag, maximize, and window resize
    // Debounce fit() to avoid excessive calls during drag resize
    let resizeTimer: ReturnType<typeof setTimeout> | null = null;
    const resizeObserver = new ResizeObserver(() => {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => fitAddon.fit(), 50);
    });
    resizeObserver.observe(containerRef.current);

    const handleKeyDown = (e: KeyboardEvent) => {
      // Only handle if THIS terminal has focus
      if (!containerRef.current?.contains(document.activeElement)) return;
      if (e.ctrlKey && e.key === "f") {
        e.preventDefault();
        setSearchVisible(true);
        requestAnimationFrame(() => searchInputRef.current?.focus());
      }
    };
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      // Only detach event listeners — do NOT close PTY here.
      // PTY close is handled by usePaneTree when a pane is explicitly closed.
      // This component should never be unmounted during split/maximize.
      (term as TerminalWithCleanup).__ptyCleanup?.();
      cleanupIME();
      ghost.dispose();
      document.removeEventListener("keydown", handleCtrlV, { capture: true } as EventListenerOptions);
      resizeObserver.disconnect();
      if (resizeTimer) clearTimeout(resizeTimer);
      window.removeEventListener("keydown", handleKeyDown);
      term.dispose();
      termRef.current = null;
      searchAddonRef.current = null;
    };
  }, []);

  const handleSearch = (query: string) => {
    setSearchQuery(query);
    if (query) {
      searchAddonRef.current?.findNext(query);
    }
  };

  const handleSearchClose = () => {
    setSearchVisible(false);
    setSearchQuery("");
    searchAddonRef.current?.clearDecorations();
    termRef.current?.focus();
  };

  return (
    <div className={styles.terminalArea}>
      {searchVisible && (
        <div className={styles.searchBar}>
          <input
            ref={searchInputRef}
            className={styles.searchInput}
            value={searchQuery}
            onChange={(e) => handleSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") handleSearchClose();
              else if (e.key === "Enter" && e.shiftKey) searchAddonRef.current?.findPrevious(searchQuery);
              else if (e.key === "Enter") searchAddonRef.current?.findNext(searchQuery);
            }}
            placeholder="Search..."
          />
          <button className={styles.searchBtn} onClick={() => searchAddonRef.current?.findPrevious(searchQuery)}>↑</button>
          <button className={styles.searchBtn} onClick={() => searchAddonRef.current?.findNext(searchQuery)}>↓</button>
          <button className={styles.searchBtn} onClick={handleSearchClose}>×</button>
        </div>
      )}
      <div ref={containerRef} className={styles.terminalContainer} />
      {commandHistory.length > 0 && (
        <div className={styles.historyBar}>
          <CommandHistory
            commands={commandHistory}
            onRerun={(cmd) => {
              const ptyId = (termRef.current as TerminalWithCleanup)?.__ptyId;
              if (ptyId) {
                import("@tauri-apps/api/core").then(({ invoke }) => {
                  invoke("write_terminal", { id: ptyId, data: cmd + "\r" });
                });
              }
            }}
            onCopy={(cmd) => navigator.clipboard.writeText(cmd).catch(() => {})}
          />
        </div>
      )}
    </div>
  );
}

// ── IME overlay ──

function setupIMEOverlay(term: Terminal, container: HTMLElement): () => void {
  const textarea = term.textarea;
  if (!textarea) return () => {};

  const overlay = document.createElement("div");
  overlay.className = styles.imeOverlay;
  overlay.style.cssText = `
    position: absolute; display: none; pointer-events: none; z-index: 100;
    font-family: "IBM Plex Mono", "Cascadia Code", monospace;
    font-size: 14px; line-height: 1.4;
    color: var(--text-primary); background: var(--glass-dense);
    padding: 0 2px; border-radius: 2px;
  `;
  container.style.position = "relative";
  container.appendChild(overlay);

  const getCursorPos = () => {
    const cursor = container.querySelector(".xterm-cursor-layer");
    if (!cursor) return null;
    const style = window.getComputedStyle(cursor);
    return { left: parseInt(style.left || "0"), top: parseInt(style.top || "0") };
  };
  const applyPos = (pos: { left: number; top: number }) => {
    overlay.style.left = `${pos.left}px`;
    overlay.style.top = `${pos.top}px`;
  };
  const hideXtermComposition = () => {
    const comp = container.querySelector(".xterm-composition-view") as HTMLElement | null;
    if (comp) comp.style.display = "none";
  };
  const showXtermComposition = () => {
    const comp = container.querySelector(".xterm-composition-view") as HTMLElement | null;
    if (comp) comp.style.display = "";
  };

  const onStart = () => {
    overlay.style.display = "block";
    overlay.textContent = "";
    hideXtermComposition();
  };
  const onUpdate = (e: CompositionEvent) => {
    overlay.textContent = e.data;
    const pos = getCursorPos();
    if (pos) applyPos(pos);
    hideXtermComposition();
  };
  const onEnd = () => {
    overlay.style.display = "none";
    overlay.textContent = "";
    showXtermComposition();
  };

  textarea.addEventListener("compositionstart", onStart);
  textarea.addEventListener("compositionupdate", onUpdate);
  textarea.addEventListener("compositionend", onEnd);

  return () => {
    textarea.removeEventListener("compositionstart", onStart);
    textarea.removeEventListener("compositionupdate", onUpdate);
    textarea.removeEventListener("compositionend", onEnd);
    overlay.remove();
  };
}

async function connectPty(
  term: Terminal,
  shell: string,
  cwd?: string,
  onReady?: (terminalId: string) => void,
  syncModeRef?: React.RefObject<boolean | undefined>,
  blockTracker?: CommandBlockTracker,
  onHistoryUpdate?: () => void,
  onStartAgent?: (prompt: string) => void,
) {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const { listen } = await import("@tauri-apps/api/event");

    const id = await invoke<string>("spawn_terminal", {
      shell,
      cols: term.cols,
      rows: term.rows,
      cwd: cwd ?? null,
    });

    (term as TerminalWithCleanup).__ptyId = id;
    onReady?.(id);

    // Track last prompt line for block decoration
    let lastPromptMarkerLine = -1;
    // Debounce error notifications (max 1 per 5 seconds)
    let lastErrorTime = 0;

    const unlistenOutput = await listen<string>(`pty-output-${id}`, (event) => {
      const bytes = decodeBase64ToBytes(event.payload);
      term.write(bytes);

      // Track command blocks from decoded text
      if (blockTracker) {
        const text = new TextDecoder().decode(bytes);
        // Strip ANSI escape codes for prompt detection
        const clean = text.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "");
        const lines = clean.split(/\r?\n/);
        for (const line of lines) {
          if (line.trim().length === 0) continue;
          blockTracker.addLine(line);

          // Error detection — throttled (max 1 per 5s)
          const now = Date.now();
          if (now - lastErrorTime > 5000) {
            const error = detectError(line);
            if (error) {
              lastErrorTime = now;
              const addToast = useToastStore.getState().add;
              addToast({
                type: "error",
                title: `${error.type}: ${error.message.slice(0, 80)}`,
                description: error.suggestedPrompt.slice(0, 120),
                action: onStartAgent ? {
                  label: "Ask AI to fix",
                  onClick: () => onStartAgent(error.suggestedPrompt),
                } : undefined,
              });
            }
          }

          const detected = detectPrompt(line);
          if (detected) {
            onHistoryUpdate?.();
          }
          if (detected && blockTracker.blockCount > 0) {
            // Add a subtle separator decoration at the prompt line
            const cursorRow = term.buffer.active.cursorY;
            if (cursorRow !== lastPromptMarkerLine) {
              lastPromptMarkerLine = cursorRow;
              try {
                const marker = term.registerMarker(0);
                if (marker) {
                  const deco = term.registerDecoration({
                    marker,
                    width: term.cols,
                    overviewRulerOptions: { color: "rgba(166, 173, 200, 0.3)" },
                  });
                  deco?.onRender((el) => {
                    el.style.borderTop = "1px solid rgba(166, 173, 200, 0.25)";
                    el.style.marginTop = "-1px";
                    el.style.height = "0px";
                    el.style.pointerEvents = "none";
                  });
                }
              } catch { /* decoration API may not be available */ }
            }
          }
        }
      }
    });

    const unlistenExit = await listen(`pty-exit-${id}`, () => {
      term.writeln("\r\n\x1b[90m[Process exited]\x1b[0m");
    });

    (term as TerminalWithCleanup).__ptyCleanup = () => {
      unlistenOutput();
      unlistenExit();
    };

    term.onData((data) => {
      if (syncModeRef?.current) {
        invoke("broadcast_keys", { data });
      } else {
        invoke("write_terminal", { id, data });
      }
    });

    term.onResize(({ cols, rows }) => {
      invoke("resize_terminal", { id, cols, rows });
    });
  } catch (err) {
    term.writeln(`\x1b[31mPTY connection failed: ${err}\x1b[0m`);
    term.writeln("\x1b[33mTerminal rendering works, PTY backend needs debugging.\x1b[0m");
  }
}
