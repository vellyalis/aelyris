import { useState, useCallback } from "react";
import { TerminalArea } from "./TerminalArea";
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
  const [root, setRoot] = useState<PaneNode>(() => makeTerminalNode(shell, cwd));

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
      <PaneRenderer node={root} onSplit={splitPane} />
    </div>
  );
}

function PaneRenderer({
  node,
  onSplit,
}: {
  node: PaneNode;
  onSplit: (id: string, dir: "horizontal" | "vertical") => void;
}) {
  if (node.type === "terminal") {
    return <TerminalArea shell={node.shell} cwd={node.cwd} />;
  }

  return (
    <SplitPane
      direction={node.direction!}
      first={<PaneRenderer node={node.first!} onSplit={onSplit} />}
      second={<PaneRenderer node={node.second!} onSplit={onSplit} />}
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
