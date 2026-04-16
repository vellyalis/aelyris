import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebglAddon } from "@xterm/addon-webgl";
import "@xterm/xterm/css/xterm.css";
import { useAppStore } from "../../shared/store/appStore";
import { useXtermTheme } from "../../shared/hooks/useTheme";
import { useIMEOverlay } from "../terminal/hooks/useIMEOverlay";
import { getCliLabel, getCliColor, type AgentCliType } from "../../shared/types/interactiveAgent";
import { STATUS_COLORS, STATUS_LABELS, type AgentStatus } from "../../shared/types/agent";
import { StatusIcon } from "../../shared/ui/StatusIcon";
import styles from "./AgentTerminal.module.css";

interface AgentTerminalProps {
  /** PTY ID to connect to (already spawned by Rust backend) */
  ptyId: string;
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
export function AgentTerminal({ ptyId, cli, status, model, cost, accentColor }: AgentTerminalProps) {
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

  const themeRef = useRef(xtermTheme);
  themeRef.current = xtermTheme;

  // Mount terminal — keyed on ptyId to handle session switches
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let cancelled = false;

    const term = new Terminal({
      theme: themeRef.current,
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

    term.open(container);
    term.unicode.activeVersion = "11";

    try {
      const webgl = new WebglAddon();
      webgl.onContextLoss(() => webgl.dispose());
      term.loadAddon(webgl);
    } catch {
      // WebGL unavailable — Canvas fallback is automatic
    }

    fitAddon.fit();

    termRef.current = term;
    fitAddonRef.current = fitAddon;

    // Async connection — guarded by cancelled flag to prevent listener leaks
    const connectPty = async () => {
      try {
        const { listen } = await import("@tauri-apps/api/event");
        const { invoke } = await import("@tauri-apps/api/core");

        if (cancelled) return;

        const unlistenOutput = await listen<number[]>(`pty-output-${ptyId}`, (event) => {
          const bytes = new Uint8Array(event.payload);
          term.write(bytes);
        });

        const unlistenExit = await listen(`pty-exit-${ptyId}`, () => {
          term.writeln("\r\n\x1b[90m[Agent process exited]\x1b[0m");
        });

        if (cancelled) {
          // Component unmounted during await — immediately clean up
          unlistenOutput();
          unlistenExit();
          return;
        }

        // Forward user input to PTY
        term.onData((data) => {
          invoke("write_terminal", { id: ptyId, data }).catch(() => {});
        });

        term.onResize(({ cols, rows }) => {
          invoke("resize_terminal", { id: ptyId, cols, rows }).catch(() => {});
        });

        cleanupRef.current = () => {
          unlistenOutput();
          unlistenExit();
        };
      } catch (err) {
        if (!cancelled) {
          term.writeln(`\x1b[31mFailed to connect to agent PTY: ${err}\x1b[0m`);
        }
      }
    };

    connectPty();

    return () => {
      cancelled = true;
      cleanupRef.current?.();
      cleanupRef.current = null;
      term.dispose();
      termRef.current = null;
    };
  }, [ptyId]);

  // Fit on window resize (debounced)
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const handleResize = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => fitAddonRef.current?.fit(), 50);
    };
    window.addEventListener("resize", handleResize);
    return () => { window.removeEventListener("resize", handleResize); if (timer) clearTimeout(timer); };
  }, []);

  // IME overlay for CJK input — uses buffer API to track cursor in TUI apps
  useIMEOverlay(termRef.current, containerRef);

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
