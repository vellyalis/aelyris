import { useState, useCallback } from "react";
import { TerminalArea } from "./TerminalArea";
import { TerminalInfoBar } from "./TerminalInfoBar";
import type { ShellType } from "../../App";

interface TerminalNode {
  id: string;
  shell: ShellType;
  cwd?: string;
}

let nextPaneId = 0;

interface TerminalPaneProps {
  shell: ShellType;
  cwd?: string;
}

const SHELL_LABELS: Record<ShellType, string> = {
  powershell: "PowerShell",
  cmd: "CMD",
  gitbash: "Git Bash",
  wsl: "WSL",
};

/**
 * Terminal pane with vertical split.
 *
 * KEY DESIGN: All TerminalArea instances are ALWAYS mounted in the DOM.
 * Maximize/restore only toggles CSS display:none — never unmounts.
 * This preserves PTY sessions across maximize/restore.
 */
export function TerminalPane({ shell, cwd }: TerminalPaneProps) {
  const [terminals] = useState<TerminalNode[]>(() => [
    { id: `pane-${nextPaneId++}`, shell, cwd },
    { id: `pane-${nextPaneId++}`, shell, cwd },
  ]);
  const [maximizedId, setMaximizedId] = useState<string | null>(null);
  // Map pane IDs to PTY terminal IDs (for send-keys/capture-pane)
  const [_terminalIds, setTerminalIds] = useState<Map<string, string>>(new Map());
  void _terminalIds; // reserved for future send-keys/capture-pane

  const toggleMaximize = useCallback((id: string) => {
    setMaximizedId((prev) => prev === id ? null : id);
  }, []);

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {terminals.map((t, i) => {
        // When nothing is maximized: show all with flex ratios
        // When something is maximized: show only that one, hide others
        const isVisible = maximizedId === null || maximizedId === t.id;
        const flexBasis = maximizedId === null
          ? (i === 0 ? "60%" : "40%")  // default 60/40 split
          : "100%";

        return (
          <div
            key={t.id}
            style={{
              display: isVisible ? "flex" : "none",
              flexDirection: "column",
              flex: isVisible ? `0 0 ${flexBasis}` : "none",
              minHeight: 0,
              overflow: "hidden",
              // Separator between panes
              borderTop: i > 0 && maximizedId === null ? "1px solid var(--border)" : undefined,
            }}
          >
            <TerminalInfoBar
              shell={SHELL_LABELS[t.shell]}
              cwd={t.cwd}
              isMaximized={maximizedId === t.id}
              onToggleMaximize={() => toggleMaximize(t.id)}
            />
            <TerminalArea
              shell={t.shell}
              cwd={t.cwd}
              onTerminalReady={(tid) => setTerminalIds((prev) => new Map(prev).set(t.id, tid))}
            />
          </div>
        );
      })}
    </div>
  );
}
