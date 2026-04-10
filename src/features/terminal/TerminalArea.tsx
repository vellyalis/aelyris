import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { SearchAddon } from "@xterm/addon-search";
import { WebLinksAddon } from "@xterm/addon-web-links";
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
  const searchAddonRef = useRef<SearchAddon | null>(null);
  const [searchVisible, setSearchVisible] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);
  const themeId = useAppStore((s) => s.themeId);
  const xtermTheme = useXtermTheme(themeId);

  // Update theme when it changes
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
      scrollback: 10000,
    });

    const fitAddon = new FitAddon();
    const searchAddon = new SearchAddon();

    term.loadAddon(fitAddon);
    term.loadAddon(searchAddon);
    term.loadAddon(new WebLinksAddon());
    term.open(containerRef.current);

    // Try WebGL renderer
    try {
      const webgl = new WebglAddon();
      webgl.onContextLoss(() => webgl.dispose());
      term.loadAddon(webgl);
    } catch {
      // Falls back to canvas renderer
    }

    fitAddon.fit();
    termRef.current = term;
    searchAddonRef.current = searchAddon;

    connectPty(term, shell, cwd, onTerminalReady, syncMode);

    const handleResize = () => fitAddon.fit();
    window.addEventListener("resize", handleResize);

    // Ctrl+F for search
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === "f") {
        e.preventDefault();
        setSearchVisible(true);
        requestAnimationFrame(() => searchInputRef.current?.focus());
      }
    };
    window.addEventListener("keydown", handleKeyDown);

    return () => {
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
              if (e.key === "Enter") searchAddonRef.current?.findNext(searchQuery);
              if (e.key === "Enter" && e.shiftKey) searchAddonRef.current?.findPrevious(searchQuery);
            }}
            placeholder="Search..."
          />
          <button className={styles.searchBtn} onClick={() => searchAddonRef.current?.findPrevious(searchQuery)}>↑</button>
          <button className={styles.searchBtn} onClick={() => searchAddonRef.current?.findNext(searchQuery)}>↓</button>
          <button className={styles.searchBtn} onClick={handleSearchClose}>×</button>
        </div>
      )}
      <div className={styles.terminalContainer} ref={containerRef} />
    </div>
  );
}

async function connectPty(
  term: Terminal,
  shell: string,
  cwd?: string,
  onReady?: (terminalId: string) => void,
  syncMode?: boolean,
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

    onReady?.(id);

    await listen<string>(`pty-output-${id}`, (event) => {
      const decoded = atob(event.payload);
      const bytes = new Uint8Array(decoded.length);
      for (let i = 0; i < decoded.length; i++) {
        bytes[i] = decoded.charCodeAt(i);
      }
      term.write(bytes);
    });

    await listen(`pty-exit-${id}`, () => {
      term.writeln("\r\n\x1b[90m[Process exited]\x1b[0m");
    });

    term.onData((data) => {
      if (syncMode) {
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
