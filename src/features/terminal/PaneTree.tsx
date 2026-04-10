import { useState, useCallback } from "react";
import { TerminalArea } from "./TerminalArea";
import { TerminalInfoBar } from "./TerminalInfoBar";
import { SplitPane } from "../../shared/ui/SplitPane";
import type { ShellType } from "../../App";

// --- Types ---

interface TerminalLeaf {
  type: "terminal";
  id: string;
  shell: ShellType;
  cwd?: string;
}

interface SplitNode {
  type: "split";
  id: string;
  direction: "horizontal" | "vertical";
  ratio: number;
  first: PaneNode;
  second: PaneNode;
}

export type PaneNode = TerminalLeaf | SplitNode;

// --- Helpers ---

let nextPaneId = 0;

export function createTerminalLeaf(shell: ShellType, cwd?: string): TerminalLeaf {
  return { type: "terminal", id: `ptree-${nextPaneId++}`, shell, cwd };
}

/** Split a leaf node into two, replacing it with a split containing the original + a new terminal */
export function splitNode(
  tree: PaneNode,
  targetId: string,
  direction: "horizontal" | "vertical",
  shell: ShellType,
  cwd?: string,
): PaneNode {
  if (tree.type === "terminal") {
    if (tree.id === targetId) {
      return {
        type: "split",
        id: `split-${nextPaneId++}`,
        direction,
        ratio: 0.5,
        first: tree,
        second: createTerminalLeaf(shell, cwd),
      };
    }
    return tree;
  }

  // Recurse into split children
  return {
    ...tree,
    first: splitNode(tree.first, targetId, direction, shell, cwd),
    second: splitNode(tree.second, targetId, direction, shell, cwd),
  };
}

/** Remove a terminal leaf, collapsing its parent split */
export function removeNode(tree: PaneNode, targetId: string): PaneNode | null {
  if (tree.type === "terminal") {
    return tree.id === targetId ? null : tree;
  }

  const first = removeNode(tree.first, targetId);
  const second = removeNode(tree.second, targetId);

  if (first === null) return second;
  if (second === null) return first;

  return { ...tree, first, second };
}

// --- Component ---

const SHELL_LABELS: Record<ShellType, string> = {
  powershell: "PowerShell",
  cmd: "CMD",
  gitbash: "Git Bash",
  wsl: "WSL",
};

interface PaneTreeProps {
  initialShell: ShellType;
  initialCwd?: string;
  syncMode: boolean;
}

export function PaneTree({ initialShell, initialCwd, syncMode }: PaneTreeProps) {
  const [tree, setTree] = useState<PaneNode>(() => createTerminalLeaf(initialShell, initialCwd));
  const [_terminalIds, setTerminalIds] = useState<Map<string, string>>(new Map());
  void _terminalIds; // reserved for future send-keys/capture-pane

  const handleSplit = useCallback(
    (targetId: string, direction: "horizontal" | "vertical") => {
      setTree((prev) => splitNode(prev, targetId, direction, initialShell, initialCwd));
    },
    [initialShell, initialCwd],
  );

  const handleClose = useCallback((targetId: string) => {
    setTree((prev) => removeNode(prev, targetId) ?? prev);
  }, []);

  const handleTerminalReady = useCallback((paneId: string, terminalId: string) => {
    setTerminalIds((prev) => new Map(prev).set(paneId, terminalId));
  }, []);

  return renderNode(tree, syncMode, handleSplit, handleClose, handleTerminalReady);
}

function renderNode(
  node: PaneNode,
  syncMode: boolean,
  onSplit: (id: string, dir: "horizontal" | "vertical") => void,
  onClose: (id: string) => void,
  onTerminalReady: (paneId: string, terminalId: string) => void,
): React.ReactElement {
  if (node.type === "terminal") {
    return (
      <div key={node.id} style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, overflow: "hidden" }}>
        <TerminalInfoBar
          shell={SHELL_LABELS[node.shell]}
          cwd={node.cwd}
        />
        <TerminalArea
          shell={node.shell}
          cwd={node.cwd}
          syncMode={syncMode}
          onTerminalReady={(tid) => onTerminalReady(node.id, tid)}
        />
      </div>
    );
  }

  return (
    <SplitPane
      key={node.id}
      direction={node.direction}
      defaultRatio={node.ratio}
      first={renderNode(node.first, syncMode, onSplit, onClose, onTerminalReady)}
      second={renderNode(node.second, syncMode, onSplit, onClose, onTerminalReady)}
    />
  );
}
