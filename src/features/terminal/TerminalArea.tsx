import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
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
  // Track syncMode in a ref so the onData closure always reads the current value
  const syncModeRef = useRef(syncMode);
  useEffect(() => { syncModeRef.current = syncMode; }, [syncMode]);
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
      allowProposedApi: true,
      scrollback: 10000,
    });

    const fitAddon = new FitAddon();
    const searchAddon = new SearchAddon();

    // Unicode11 addon for correct CJK character width calculation (must be loaded before open)
    const unicode11 = new Unicode11Addon();
    term.loadAddon(unicode11);

    term.loadAddon(fitAddon);
    term.loadAddon(searchAddon);
    term.loadAddon(new WebLinksAddon());
    term.open(containerRef.current);

    // Activate Unicode 11 for proper full-width character handling
    term.unicode.activeVersion = "11";

    // Canvas renderer only — WebGL uses a separate coordinate system that
    // breaks IME textarea positioning in WebView2 transparent windows.
    // Canvas handles transparency correctly with allowTransparency: true.

    fitAddon.fit();
    termRef.current = term;
    searchAddonRef.current = searchAddon;

    // Custom IME overlay — bypasses WebView2's broken coordinate reporting
    const cleanupIME = setupIMEOverlay(term, containerRef.current);

    connectPty(term, shell, cwd, onTerminalReady, syncModeRef);

    // Image paste: intercept Ctrl+V via keydown (capture phase)
    // paste events don't reliably fire with image data in WebView2 + xterm.js
    // Instead, catch Ctrl+V, use Clipboard API to check for images
    const handleCtrlV = async (e: KeyboardEvent) => {
      if (!(e.ctrlKey && e.key === "v")) return;
      // Only if this terminal has focus
      const active = document.activeElement;
      if (!containerRef.current?.contains(active) && active !== term.textarea) return;

      // Prevent xterm from handling it — we handle all paste ourselves
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
                const path = await inv<string>("save_temp_image", { data: reader.result as string });
                const escaped = path.replace(/\\/g, "/");
                term.paste(`--image "${escaped}" `);
                term.writeln(`\x1b[90m[Image: ${escaped}]\x1b[0m`);
              } catch (err) {
                term.writeln(`\x1b[31m[Image paste failed: ${err}]\x1b[0m`);
              }
            };
            reader.readAsDataURL(blob);
            return; // handled image
          }
        }
        // No image in clipboard — paste text normally
        const text = await navigator.clipboard.readText();
        if (text) term.paste(text);
      } catch {
        // Clipboard API failed — try text fallback
        try {
          const text = await navigator.clipboard.readText();
          if (text) term.paste(text);
        } catch { /* give up */ }
      }
    };
    document.addEventListener("keydown", handleCtrlV, { capture: true });

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

/**
 * Custom IME composition overlay.
 *
 * WebView2 in transparent frameless windows reports inconsistent screen
 * coordinates to the OS IME system, so the native IME candidate window
 * position is unreliable. Instead of fighting the textarea position, we
 * render the composition text ourselves in a DOM element placed at the
 * cursor location. DOM-internal coordinates are always consistent.
 */
function setupIMEOverlay(term: Terminal, container: HTMLDivElement): () => void {
  const textarea = term.textarea;
  if (!textarea) return () => {};

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const core = (term as any)._core;

  const screen = container.querySelector(".xterm-screen");
  if (!screen) return () => {};

  // All styles inline — CSS module scoping can't break this
  const overlay = document.createElement("div");
  overlay.style.cssText = [
    "position:absolute",
    "z-index:10",
    "display:none",
    "pointer-events:none",
    `font-family:${term.options.fontFamily || "monospace"}`,
    `font-size:${term.options.fontSize || 14}px`,
    "color:#cdd6f4",
    "background:rgba(49,50,68,0.95)",
    "border-bottom:2px solid #c8a050",
    "padding:0 2px",
    "white-space:pre",
  ].join(";");
  screen.appendChild(overlay);

  const getCursorPos = () => {
    const dims = core?._renderService?.dimensions;
    if (!dims?.css?.cell?.width) return null;
    return {
      left: Math.min(term.buffer.active.cursorX, term.cols - 1) * dims.css.cell.width,
      top: term.buffer.active.cursorY * dims.css.cell.height,
      cellHeight: dims.css.cell.height,
    };
  };

  const applyPos = (pos: { left: number; top: number; cellHeight: number }) => {
    overlay.style.left = pos.left + "px";
    overlay.style.top = pos.top + "px";
    overlay.style.height = pos.cellHeight + "px";
    overlay.style.lineHeight = pos.cellHeight + "px";
  };

  // Hide xterm.js's built-in composition view to avoid double rendering
  const hideXtermComposition = () => {
    const cv = container.querySelector(".xterm-composition-view") as HTMLElement | null;
    if (cv) cv.style.opacity = "0";
  };
  const showXtermComposition = () => {
    const cv = container.querySelector(".xterm-composition-view") as HTMLElement | null;
    if (cv) cv.style.opacity = "";
  };

  const onStart = () => {
    const pos = getCursorPos();
    if (!pos) return;
    applyPos(pos);
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
