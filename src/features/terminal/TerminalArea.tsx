import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebglAddon } from "@xterm/addon-webgl";
import "@xterm/xterm/css/xterm.css";

import type { ShellType } from "../../App";
import { useAppStore } from "../../shared/store/appStore";
import { useXtermTheme } from "../../shared/hooks/useTheme";
import { CommandHistory } from "./CommandHistory";
import { useIMEOverlay } from "./hooks/useIMEOverlay";
import { useTerminalOutput } from "./hooks/useTerminalOutput";
import { usePtyConnection } from "./hooks/usePtyConnection";
import { useGhostSuggest } from "./hooks/useGhostSuggest";
import styles from "./TerminalArea.module.css";

interface TerminalAreaProps {
  shell?: ShellType;
  cwd?: string;
  syncMode?: boolean;
  onTerminalReady?: (terminalId: string) => void;
  onStartAgent?: (prompt: string) => void;
}

export function TerminalArea({ shell = "powershell", cwd, syncMode, onTerminalReady, onStartAgent }: TerminalAreaProps) {
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

  // Update theme on change
  useEffect(() => {
    if (termRef.current) termRef.current.options.theme = xtermTheme;
  }, [xtermTheme]);

  // ── Terminal initialization ──
  useEffect(() => {
    if (!containerRef.current || termRef.current) return;

    const term = new Terminal({
      theme: xtermTheme,
      fontFamily: "IBM Plex Mono, Cascadia Code, Cascadia Next JP, monospace",
      fontSize: 14, lineHeight: 1.4,
      cursorStyle: "bar", cursorBlink: true,
      allowTransparency: true, allowProposedApi: true,
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

    // WebGL renderer with transparency (supported since addon-webgl 0.18+)
    try {
      const webgl = new WebglAddon();
      webgl.onContextLoss(() => webgl.dispose());
      term.loadAddon(webgl);
    } catch {
      // WebGL unavailable — Canvas fallback is automatic
    }

    fitAddon.fit();

    termRef.current = term;
    searchAddonRef.current = searchAddon;

    // Clipboard paste (Ctrl+V with image support)
    const handleCtrlV = async (e: KeyboardEvent) => {
      if (!(e.ctrlKey && e.key === "v")) return;
      if (!containerRef.current?.contains(document.activeElement)) return;
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

    // Resize observer (debounced)
    let resizeTimer: ReturnType<typeof setTimeout> | null = null;
    const resizeObserver = new ResizeObserver(() => {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => fitAddon.fit(), 50);
    });
    resizeObserver.observe(containerRef.current);

    // Search shortcut (Ctrl+F)
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!containerRef.current?.contains(document.activeElement)) return;
      if (e.ctrlKey && e.key === "f") {
        e.preventDefault();
        setSearchVisible(true);
        requestAnimationFrame(() => searchInputRef.current?.focus());
      }
    };
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("keydown", handleCtrlV, { capture: true } as EventListenerOptions);
      resizeObserver.disconnect();
      if (resizeTimer) clearTimeout(resizeTimer);
      window.removeEventListener("keydown", handleKeyDown);
      term.dispose();
      termRef.current = null;
      searchAddonRef.current = null;
    };
  }, []);

  // ── Extracted hooks ──
  const term = termRef.current;

  useIMEOverlay(term, containerRef);

  const { blockTracker, commandHistory, processOutput } = useTerminalOutput({
    term, cwd, onStartAgent,
  });

  const { writeToPty } = usePtyConnection({
    term, shell, cwd, syncModeRef,
    onReady: onTerminalReady,
    onOutput: processOutput,
  });

  useGhostSuggest({ term, containerRef, blockTracker, writeToPty });

  // ── Search handlers ──
  const handleSearch = (query: string) => {
    setSearchQuery(query);
    if (query) searchAddonRef.current?.findNext(query);
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
            onRerun={(cmd) => writeToPty(cmd + "\r")}
            onCopy={(cmd) => navigator.clipboard.writeText(cmd).catch(() => {})}
          />
        </div>
      )}
    </div>
  );
}
