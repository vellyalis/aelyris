import { useState, useCallback } from "react";
import { TerminalArea } from "./TerminalArea";
import { TerminalInfoBar } from "./TerminalInfoBar";
import { SplitPane } from "../../shared/ui/SplitPane";
import type { ShellType } from "../../App";

interface PaneNode {
  type: "terminal" | "split";
  shell?: ShellType;
  cwd?: string;
  direction?: "horizontal" | "vertical";
  first?: PaneNode;
  second?: PaneNode;
  id: string;
}

let paneId = 0;
function makeTerminalNode(shell: ShellType, cwd?: string): PaneNode {
  return { type: "terminal", shell, cwd, id: `pane-${paneId++}` };
}

interface TerminalPaneProps {
  shell: ShellType;
  cwd?: string;
  onSplit?: (direction: "horizontal" | "vertical") => void;
}

export function TerminalPane({ shell, cwd }: TerminalPaneProps) {
  const [maximizedPaneId, setMaximizedPaneId] = useState<string | null>(null);
  // Default: vertical split (main shell top + sub shell bottom)
  const [root, setRoot] = useState<PaneNode>(() => ({
    type: "split",
    direction: "vertical",
    first: makeTerminalNode(shell, cwd),
    second: makeTerminalNode(shell, cwd),
    id: `pane-${paneId++}`,
  }));

  const splitPane = useCallback(
    (targetId: string, direction: "horizontal" | "vertical") => {
      setRoot((prev) => splitNode(prev, targetId, direction, shell, cwd));
    },
    [shell, cwd],
  );

  // Listen for split shortcuts
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key === "H") {
        e.preventDefault();
        // Split the first terminal pane found
        const firstTerminal = findFirstTerminal(root);
        if (firstTerminal) splitPane(firstTerminal, "horizontal");
      } else if (e.ctrlKey && e.shiftKey && e.key === "V") {
        e.preventDefault();
        const firstTerminal = findFirstTerminal(root);
        if (firstTerminal) splitPane(firstTerminal, "vertical");
      }
    },
    [root, splitPane],
  );

  return (
    <div style={{ flex: 1, display: "flex" }} onKeyDown={handleKeyDown}>
      <PaneRenderer node={root} onSplit={splitPane} maximizedId={maximizedPaneId} onToggleMaximize={(id) => setMaximizedPaneId((prev) => prev === id ? null : id)} />
    </div>
  );
}

function PaneRenderer({
  node,
  onSplit,
  maximizedId,
  onToggleMaximize,
}: {
  node: PaneNode;
  onSplit: (id: string, dir: "horizontal" | "vertical") => void;
  maximizedId: string | null;
  onToggleMaximize: (id: string) => void;
}) {
  if (node.type === "terminal") {
    const shellLabel = node.shell === "powershell" ? "PowerShell" : node.shell === "cmd" ? "CMD" : node.shell === "gitbash" ? "Git Bash" : "WSL";
    // Use key={node.id} to prevent remount on parent state changes
    return (
      <div key={node.id} style={{ display: "flex", flexDirection: "column", flex: 1 }}>
        <TerminalInfoBar
          shell={shellLabel}
          cwd={node.cwd}
          isMaximized={maximizedId === node.id}
          onToggleMaximize={() => onToggleMaximize(node.id)}
        />
        <TerminalArea key={node.id} shell={node.shell} cwd={node.cwd} />
      </div>
    );
  }

  // If a pane is maximized, use CSS visibility instead of conditional rendering
  // This prevents terminal remount/PTY loss
  if (node.type === "split" && maximizedId) {
    const isFirstMaximized = containsNode(node.first!, maximizedId);
    const isSecondMaximized = containsNode(node.second!, maximizedId);
    if (isFirstMaximized || isSecondMaximized) {
      return (
        <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
          <div style={{ display: isFirstMaximized || !maximizedId ? "flex" : "none", flex: 1 }}>
            <PaneRenderer node={node.first!} onSplit={onSplit} maximizedId={maximizedId} onToggleMaximize={onToggleMaximize} />
          </div>
          <div style={{ display: isSecondMaximized || !maximizedId ? "flex" : "none", flex: 1 }}>
            <PaneRenderer node={node.second!} onSplit={onSplit} maximizedId={maximizedId} onToggleMaximize={onToggleMaximize} />
          </div>
        </div>
      );
    }
  }

  return (
    <SplitPane
      direction={node.direction!}
      first={<PaneRenderer node={node.first!} onSplit={onSplit} maximizedId={maximizedId} onToggleMaximize={onToggleMaximize} />}
      second={<PaneRenderer node={node.second!} onSplit={onSplit} maximizedId={maximizedId} onToggleMaximize={onToggleMaximize} />}
    />
  );
}

function splitNode(
  node: PaneNode,
  targetId: string,
  direction: "horizontal" | "vertical",
  shell: ShellType,
  cwd?: string,
): PaneNode {
  if (node.id === targetId && node.type === "terminal") {
    return {
      type: "split",
      direction,
      first: { ...node, id: `pane-${paneId++}` },
      second: makeTerminalNode(shell, cwd),
      id: `pane-${paneId++}`,
    };
  }
  if (node.type === "split") {
    return {
      ...node,
      first: node.first ? splitNode(node.first, targetId, direction, shell, cwd) : node.first,
      second: node.second ? splitNode(node.second, targetId, direction, shell, cwd) : node.second,
    };
  }
  return node;
}

function findFirstTerminal(node: PaneNode): string | null {
  if (node.type === "terminal") return node.id;
  if (node.first) {
    const found = findFirstTerminal(node.first);
    if (found) return found;
  }
  if (node.second) return findFirstTerminal(node.second);
  return null;
}

function containsNode(node: PaneNode, id: string): boolean {
  if (node.id === id) return true;
  if (node.first && containsNode(node.first, id)) return true;
  if (node.second && containsNode(node.second, id)) return true;
  return false;
}
