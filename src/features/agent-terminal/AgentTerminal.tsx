import { useEffect, useRef, useCallback } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import "@xterm/xterm/css/xterm.css";
import { useAppStore } from "../../shared/store/appStore";
import { useXtermTheme } from "../../shared/hooks/useTheme";
import { getCliLabel, getCliColor, type AgentCliType } from "../../shared/types/interactiveAgent";
import { STATUS_COLORS, STATUS_LABELS, type AgentStatus } from "../../shared/types/agent";
import { StatusIcon } from "../../shared/ui/StatusIcon";
import styles from "./AgentTerminal.module.css";

interface AgentTerminalProps {
  /** PTY ID to connect to (already spawned by Rust backend) */
  ptyId: string;
  /** Session metadata */
  sessionId: string;
  cli: AgentCliType;
  status: AgentStatus;
  model: string;
  cost: number;
  /** Session accent color */
  accentColor?: string;
}

/**
 * Terminal connected to an interactive agent PTY.
 * Unlike TerminalArea, this does NOT spawn a new PTY — it connects to an existing one.
 * The PTY was already spawned by spawn_interactive_agent on the Rust side.
 */
export function AgentTerminal({ ptyId, sessionId: _sessionId, cli, status, model, cost, accentColor }: AgentTerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const themeId = useAppStore((s) => s.themeId);
  const xtermTheme = useXtermTheme(themeId);

  // Update theme when it changes
  useEffect(() => {
    if (termRef.current) {
      termRef.current.options.theme = xtermTheme;
    }
  }, [xtermTheme]);

  const attach = useCallback(async (container: HTMLDivElement) => {
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

    const unicode11 = new Unicode11Addon();
    term.loadAddon(unicode11);

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(new WebLinksAddon());
    term.loadAddon(new SearchAddon());

    term.open(container);
    term.unicode.activeVersion = "11";
    fitAddon.fit();

    termRef.current = term;
    fitAddonRef.current = fitAddon;

    // Connect to the existing PTY output stream
    try {
      const { listen } = await import("@tauri-apps/api/event");
      const { invoke } = await import("@tauri-apps/api/core");

      // Listen for PTY output (base64 encoded, same format as regular terminals)
      const unlistenOutput = await listen<string>(`pty-output-${ptyId}`, (event) => {
        const decoded = atob(event.payload);
        const bytes = new Uint8Array(decoded.length);
        for (let i = 0; i < decoded.length; i++) {
          bytes[i] = decoded.charCodeAt(i);
        }
        term.write(bytes);
      });

      const unlistenExit = await listen(`pty-exit-${ptyId}`, () => {
        term.writeln("\r\n\x1b[90m[Agent process exited]\x1b[0m");
      });

      // Forward user input to PTY
      term.onData((data) => {
        invoke("write_terminal", { id: ptyId, data }).catch(() => {});
      });

      // Handle resize
      term.onResize(({ cols, rows }) => {
        invoke("resize_terminal", { id: ptyId, cols, rows }).catch(() => {});
      });

      cleanupRef.current = () => {
        unlistenOutput();
        unlistenExit();
      };
    } catch (err) {
      term.writeln(`\x1b[31mFailed to connect to agent PTY: ${err}\x1b[0m`);
    }
  }, [ptyId, xtermTheme]);

  // Mount terminal
  useEffect(() => {
    if (containerRef.current && !termRef.current) {
      attach(containerRef.current);
    }
    return () => {
      cleanupRef.current?.();
      termRef.current?.dispose();
      termRef.current = null;
    };
  }, [attach]);

  // Fit on window resize
  useEffect(() => {
    const handleResize = () => fitAddonRef.current?.fit();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const accent = accentColor ?? getCliColor(cli);

  return (
    <div className={styles.agentTerminal} style={{ "--agent-accent": accent } as React.CSSProperties}>
      {/* Status overlay bar */}
      <div className={styles.statusBar}>
        <span className={styles.cliBadge} style={{ color: accent }}>
          {getCliLabel(cli)}
        </span>
        <span className={styles.modelLabel}>{model}</span>
        <StatusIcon status={status} size={10} />
        <span className={styles.statusLabel} style={{ color: STATUS_COLORS[status] }}>
          {STATUS_LABELS[status]}
        </span>
        <span className={styles.cost}>${cost.toFixed(2)}</span>
      </div>
      {/* Terminal container */}
      <div className={styles.terminalContainer} ref={containerRef} />
    </div>
  );
}
