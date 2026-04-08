import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import styles from "./TerminalArea.module.css";

export function TerminalArea() {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);

  useEffect(() => {
    if (!containerRef.current || termRef.current) return;

    const term = new Terminal({
      theme: {
        background: "rgba(30, 30, 46, 0.01)",
        foreground: "#cdd6f4",
        cursor: "#f5e0dc",
        selectionBackground: "#585b70",
        black: "#45475a",
        red: "#f38ba8",
        green: "#a6e3a1",
        yellow: "#f9e2af",
        blue: "#89b4fa",
        magenta: "#f5c2e7",
        cyan: "#94e2d5",
        white: "#bac2de",
      },
      fontFamily: "Cascadia Code, Cascadia Next JP, monospace",
      fontSize: 14,
      lineHeight: 1.4,
      cursorStyle: "bar",
      cursorBlink: true,
      allowTransparency: true,
      scrollback: 10000,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(containerRef.current);
    fitAddon.fit();
    termRef.current = term;

    // Test: write directly without PTY
    term.writeln("\x1b[36mAether Terminal v0.1.0\x1b[0m");
    term.writeln("xterm.js rendering OK. Connecting to PTY...");
    term.writeln("");

    // Now connect to PTY
    connectPty(term);

    const handleResize = () => fitAddon.fit();
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      term.dispose();
      termRef.current = null;
    };
  }, []);

  return <div className={styles.terminalArea} ref={containerRef} style={{ padding: 8 }} />;
}

async function connectPty(term: Terminal) {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const { listen } = await import("@tauri-apps/api/event");

    const id = await invoke<string>("spawn_terminal", {
      shell: "powershell",
      cols: term.cols,
      rows: term.rows,
      cwd: null,
    });

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
      invoke("write_terminal", { id, data });
    });

    term.onResize(({ cols, rows }) => {
      invoke("resize_terminal", { id, cols, rows });
    });
  } catch (err) {
    term.writeln(`\x1b[31mPTY connection failed: ${err}\x1b[0m`);
    term.writeln("\x1b[33mTerminal rendering works, PTY backend needs debugging.\x1b[0m");
  }
}
