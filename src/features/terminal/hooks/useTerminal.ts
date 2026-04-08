import { useEffect, useRef, useCallback } from "react";
import { Terminal } from "@xterm/xterm";
import { WebglAddon } from "@xterm/addon-webgl";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { SearchAddon } from "@xterm/addon-search";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import "@xterm/xterm/css/xterm.css";

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
      scrollback: 10000,
      convertEol: true,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(new WebLinksAddon());
    term.loadAddon(new SearchAddon());

    term.open(container);

    // Try WebGL, fallback to canvas
    try {
      const webglAddon = new WebglAddon();
      webglAddon.onContextLoss(() => {
        webglAddon.dispose();
      });
      term.loadAddon(webglAddon);
    } catch {
      console.warn("WebGL addon failed, using canvas renderer");
    }

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

      // Listen for PTY output
      unlistenOutputRef.current = await listen<string>(
        `pty-output-${id}`,
        (event) => {
          const decoded = atob(event.payload);
          const bytes = new Uint8Array(decoded.length);
          for (let i = 0; i < decoded.length; i++) {
            bytes[i] = decoded.charCodeAt(i);
          }
          term.write(bytes);
        },
      );

      // Listen for PTY exit
      unlistenExitRef.current = await listen(`pty-exit-${id}`, () => {
        term.writeln("\r\n\x1b[90m[Process exited]\x1b[0m");
      });

      // Forward input to PTY
      term.onData((data) => {
        invoke("write_terminal", { id, data }).catch(console.error);
      });

      // Handle resize
      term.onResize(({ cols, rows }) => {
        invoke("resize_terminal", { id, cols, rows }).catch(console.error);
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
