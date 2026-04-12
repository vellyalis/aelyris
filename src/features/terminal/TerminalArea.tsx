import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";

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
}

export function TerminalArea({ shell = "powershell", cwd, syncMode, onTerminalReady: _onTerminalReady }: TerminalAreaProps) {
  const onTerminalReady = _onTerminalReady;
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const syncModeRef = useRef(syncMode);
  useEffect(() => { syncModeRef.current = syncMode; }, [syncMode]);
  const searchAddonRef = useRef<SearchAddon | null>(null);
  const [searchVisible, setSearchVisible] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
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

    connectPty(term, shell, cwd, onTerminalReady, syncModeRef);

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

    const handleResize = () => fitAddon.fit();
    window.addEventListener("resize", handleResize);

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
      document.removeEventListener("keydown", handleCtrlV, { capture: true } as EventListenerOptions);
      window.removeEventListener("resize", handleResize);
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

    const unlistenOutput = await listen<string>(`pty-output-${id}`, (event) => {
      const decoded = atob(event.payload);
      const bytes = new Uint8Array(decoded.length);
      for (let i = 0; i < decoded.length; i++) {
        bytes[i] = decoded.charCodeAt(i);
      }
      term.write(bytes);
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
