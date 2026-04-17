import { useCallback, useEffect, useRef, useState } from "react";
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
// import { useIMEOverlay } from "./hooks/useIMEOverlay";
import { useTerminalOutput } from "./hooks/useTerminalOutput";
import { usePtyConnection } from "./hooks/usePtyConnection";
import { useAICliDetection } from "./hooks/useAICliDetection";
// import { useGhostSuggest } from "./hooks/useGhostSuggest";
import { IMEInputBar } from "./IMEInputBar";
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
  const [imeInputVisible, setImeInputVisible] = useState(false);

  // AI CLI detection: when the user runs `claude`, `codex`, `gemini`, …
  // the xterm IME helper textarea sits at the PTY cursor, which rarely
  // matches where the AI CLI is drawing its prompt — so we pop up the
  // dedicated IME bar automatically.  Tracks dismissal to avoid
  // re-opening the bar the user just closed during the same session.
  const aiCli = useAICliDetection();
  const aiDismissedRef = useRef(false);
  // Ref wrapper so the one-shot keydown listener (registered in the init
  // effect with empty deps) always calls the latest toggleImeBar closure.
  const toggleImeBarRef = useRef<() => void>(() => {});
  // Ref to the stable `feedInput` function so the init effect's onData
  // listener can reach it without re-registering on aiCli identity churn.
  const feedInputRef = useRef(aiCli.feedInput);
  feedInputRef.current = aiCli.feedInput;

  const themeId = useAppStore((s) => s.themeId);
  const xtermTheme = useXtermTheme(themeId);

  // Update theme on change
  useEffect(() => {
    if (termRef.current) termRef.current.options.theme = xtermTheme;
  }, [xtermTheme]);

  // Clean up orphaned overlay divs from old ghost suggest / IME overlay code
  useEffect(() => {
    const c = containerRef.current;
    if (!c) return;
    c.querySelectorAll<HTMLElement>("[data-ime-input]").forEach((el) => el.remove());
    c.querySelectorAll<HTMLElement>("div[style*='pointer-events: none'][style*='z-index']").forEach((el) => el.remove());
  }, []);

  // ── Terminal initialization ──
  useEffect(() => {
    if (!containerRef.current || termRef.current) return;

    const term = new Terminal({
      theme: xtermTheme,
      fontFamily: "IBM Plex Mono, Cascadia Code, Cascadia Next JP, monospace",
      fontSize: 14, lineHeight: 1.4,
      cursorStyle: "bar", cursorBlink: true,
      allowTransparency: true, allowProposedApi: true,
      scrollback: 10000, convertEol: true,
      windowsPty: { backend: "conpty", buildNumber: 21376 },
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

    // WebGL renderer with transparency (supported since addon-webgl 0.18+).
    try {
      const webgl = new WebglAddon();
      webgl.onContextLoss(() => webgl.dispose());
      term.loadAddon(webgl);
    } catch {
      // WebGL unavailable — DOM renderer fallback is automatic
    }

    fitAddon.fit();

    termRef.current = term;
    searchAddonRef.current = searchAddon;

    // Watch user keystrokes for AI CLI invocations.  Output-based detection
    // can miss narrow panes where PSReadLine wraps the prompt across lines
    // with embedded newlines; watching the input line directly is immune
    // to that.  We only need the buffer while NOT in a session, and the
    // hook guards internally, so this is cheap per keystroke.
    const aiInputDisposable = term.onData((data) => {
      feedInputRef.current(data);
    });

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

    // Resize observer — coalesce notifications into a single fit() per
    // animation frame.  setTimeout(…, 50) would lag a full 50 ms behind the
    // paint during a split-pane drag; rAF keeps xterm's cell grid in step
    // with the container size for the duration of the gesture.
    let rafId = 0;
    const resizeObserver = new ResizeObserver(() => {
      if (rafId !== 0) return;
      rafId = requestAnimationFrame(() => {
        rafId = 0;
        // `fit()` can throw if the terminal has been disposed between
        // schedule and invoke — swallow that to avoid unmount warnings.
        try { fitAddon.fit(); } catch { /* terminal gone */ }
      });
    });
    resizeObserver.observe(containerRef.current);

    // Search shortcut (Ctrl+F) + IME input bar toggle (Ctrl+Shift+J)
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl+Shift+J toggles IME input — accept from anywhere inside this TerminalArea,
      // including from within the IME bar itself (so user can close it with the shortcut).
      const areaRoot = containerRef.current?.closest<HTMLElement>(`.${styles.terminalArea}`);
      const insideArea = areaRoot?.contains(document.activeElement) ?? false;
      if (e.ctrlKey && e.shiftKey && (e.key === "J" || e.key === "j")) {
        if (!insideArea && !containerRef.current?.contains(document.activeElement)) return;
        e.preventDefault();
        toggleImeBarRef.current();
        return;
      }
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
      if (rafId !== 0) cancelAnimationFrame(rafId);
      window.removeEventListener("keydown", handleKeyDown);
      aiInputDisposable.dispose();
      term.dispose();
      termRef.current = null;
      searchAddonRef.current = null;
    };
  }, []);

  // ── Extracted hooks ──
  const term = termRef.current;

  // IME: let xterm.js handle natively — no custom overlay
  // useIMEOverlay(term, containerRef);

  const { blocks, processOutput } = useTerminalOutput({
    term, cwd, onStartAgent,
  });

  // Fan out PTY output to both the command-block tracker and the AI CLI
  // detector.  Stable identity so `usePtyConnection` doesn't re-subscribe.
  const handlePtyOutput = useCallback((text: string, ptyId: string) => {
    processOutput(text, ptyId);
    aiCli.feed(text);
  }, [processOutput, aiCli]);

  const { writeToPty } = usePtyConnection({
    term, shell, cwd, syncModeRef,
    onReady: onTerminalReady,
    onOutput: handlePtyOutput,
  });

  // AI session start → open IME bar unless user dismissed it in this session.
  // AI session end     → hide IME bar and clear the dismissal flag so the
  //                      next AI invocation pops the bar again.
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
    termRef.current?.focus();
  }, [aiCli.active]);

  const toggleImeBar = useCallback(() => {
    setImeInputVisible((v) => {
      if (v) {
        if (aiCli.active) aiDismissedRef.current = true;
        return false;
      }
      // Opening explicitly — clear dismissal so the auto-close/open logic
      // works normally afterwards.
      aiDismissedRef.current = false;
      return true;
    });
  }, [aiCli.active]);

  // Keep the ref used by the static keydown handler in sync.
  useEffect(() => {
    toggleImeBarRef.current = toggleImeBar;
  }, [toggleImeBar]);

  // Ghost suggest disabled — causes burn-in with TUI apps (gemini/claude)
  // TODO: re-enable when properly scoped to shell prompt only
  // useGhostSuggest({ term, containerRef, blockTracker, writeToPty });

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
      {imeInputVisible && (
        <IMEInputBar
          onSubmit={(text) => writeToPty(text)}
          onClose={closeImeBar}
        />
      )}
      {blocks.length > 0 && (
        <div className={styles.historyBar}>
          <CommandHistory
            blocks={blocks}
            onRerun={(cmd) => writeToPty(cmd + "\r")}
            onCopy={(text) => navigator.clipboard.writeText(text).catch(() => {})}
          />
        </div>
      )}
    </div>
  );
}
