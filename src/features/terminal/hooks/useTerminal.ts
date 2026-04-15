import { useEffect, useRef, useCallback } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { SearchAddon } from "@xterm/addon-search";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import "@xterm/xterm/css/xterm.css";

// Track the most recently focused terminal's PTY ID via window (survives chunk boundaries)
export function getActivePtyId(): string | null {
  return (window as unknown as Record<string, string | null>).__aether_active_pty_id ?? null;
}
export function setActivePtyId(id: string | null) {
  (window as unknown as Record<string, string | null>).__aether_active_pty_id = id;
}

// Catppuccin Mocha terminal colors
const CATPPUCCIN_THEME = {
  background: "rgba(30, 30, 46, 0.0)", // transparent for Mica
  foreground: "#cdd6f4",
  cursor: "#f5e0dc",
  cursorAccent: "#1e1e2e",
  selectionBackground: "#585b70",
  selectionForeground: "#cdd6f4",
  black: "#45475a",
  red: "#f38ba8",
  green: "#a6e3a1",
  yellow: "#f9e2af",
  blue: "#89b4fa",
  magenta: "#f5c2e7",
  cyan: "#94e2d5",
  white: "#bac2de",
  brightBlack: "#585b70",
  brightRed: "#f38ba8",
  brightGreen: "#a6e3a1",
  brightYellow: "#f9e2af",
  brightBlue: "#89b4fa",
  brightMagenta: "#f5c2e7",
  brightCyan: "#94e2d5",
  brightWhite: "#a6adc8",
};

interface UseTerminalOptions {
  shell?: string;
  cwd?: string;
  fontSize?: number;
  fontFamily?: string;
}

export function useTerminal(options: UseTerminalOptions = {}) {
  const terminalRef = useRef<HTMLDivElement | null>(null);
  const xtermRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const terminalIdRef = useRef<string | null>(null);
  const unlistenOutputRef = useRef<UnlistenFn | null>(null);
  const unlistenExitRef = useRef<UnlistenFn | null>(null);

  const {
    fontSize = 14,
    fontFamily = "Cascadia Code, Cascadia Next JP, monospace",
  } = options;

  const attach = useCallback(async (container: HTMLDivElement) => {
    // Create xterm instance
    const term = new Terminal({
      theme: CATPPUCCIN_THEME,
      fontFamily,
      fontSize,
      lineHeight: 1.4,
      cursorStyle: "bar",
      cursorBlink: true,
      allowTransparency: true,
      allowProposedApi: true,
      scrollback: 10000,
      convertEol: true,
    });

    const unicode11 = new Unicode11Addon();
    term.loadAddon(unicode11);

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(new WebLinksAddon());
    term.loadAddon(new SearchAddon());

    term.open(container);

    // Activate Unicode 11 for proper CJK full-width character handling
    term.unicode.activeVersion = "11";

    // Skip WebGL renderer — it doesn't support transparent backgrounds.
    // Canvas renderer handles transparency correctly with allowTransparency: true.

    fitAddon.fit();
    xtermRef.current = term;
    fitAddonRef.current = fitAddon;

    // Spawn PTY on Rust side
    const cols = term.cols;
    const rows = term.rows;

    try {
      const id = await invoke<string>("spawn_terminal", {
        shell: options.shell ?? "powershell",
        cols,
        rows,
        cwd: options.cwd ?? null,
      });
      terminalIdRef.current = id;
      setActivePtyId(id);

      // Listen for PTY output
      unlistenOutputRef.current = await listen<number[]>(
        `pty-output-${id}`,
        (event) => {
          const bytes = new Uint8Array(event.payload);
          term.write(bytes);
        },
      );

      // Listen for PTY exit
      unlistenExitRef.current = await listen(`pty-exit-${id}`, () => {
        term.writeln("\r\n\x1b[90m[Process exited]\x1b[0m");
      });

      // Track which terminal is active on focus/click
      const el = container;
      const handleFocus = () => setActivePtyId(id);
      el.addEventListener("mousedown", handleFocus);
      el.addEventListener("focusin", handleFocus);

      // Forward input to PTY
      term.onData((data) => {
        invoke("write_terminal", { id, data }).catch(() => {});
      });

      // Handle resize
      term.onResize(({ cols, rows }) => {
        invoke("resize_terminal", { id, cols, rows }).catch(() => {});
      });
    } catch (err) {
      term.writeln(`\x1b[31mFailed to spawn terminal: ${err}\x1b[0m`);
    }
  }, [fontSize, fontFamily, options.shell, options.cwd]);

  // Fit on window resize
  useEffect(() => {
    const handleResize = () => {
      fitAddonRef.current?.fit();
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      unlistenOutputRef.current?.();
      unlistenExitRef.current?.();
      if (terminalIdRef.current) {
        invoke("close_terminal", { id: terminalIdRef.current }).catch(() => {});
      }
      xtermRef.current?.dispose();
    };
  }, []);

  const setRef = useCallback(
    (node: HTMLDivElement | null) => {
      if (node && !xtermRef.current) {
        terminalRef.current = node;
        attach(node);
      }
    },
    [attach],
  );

  return {
    ref: setRef,
    terminal: xtermRef,
    fit: () => fitAddonRef.current?.fit(),
    terminalId: terminalIdRef,
  };
}
