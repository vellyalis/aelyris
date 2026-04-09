import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import type { ShellType } from "../../App";
import styles from "./TerminalArea.module.css";

interface TerminalAreaProps {
  shell?: ShellType;
  cwd?: string;
}

export function TerminalArea({ shell = "powershell", cwd }: TerminalAreaProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);

  useEffect(() => {
    if (!containerRef.current || termRef.current) return;

    const term = new Terminal({
      theme: {
        background: "rgba(26, 26, 26, 0.01)",
        foreground: "rgba(255, 255, 255, 0.88)",
        cursor: "#4fc1ff",
        selectionBackground: "rgba(79, 193, 255, 0.25)",
        black: "#3a3a3a",
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
    connectPty(term, shell, cwd);

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

async function connectPty(term: Terminal, shell: string, cwd?: string) {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const { listen } = await import("@tauri-apps/api/event");

    const id = await invoke<string>("spawn_terminal", {
      shell,
      cols: term.cols,
      rows: term.rows,
      cwd: cwd ?? null,
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
