import type { PaneNode, SplitDirection } from "./types";
import { TerminalArea } from "../TerminalArea";
import { GpuTerminalArea } from "../GpuTerminalArea";
import { TerminalInfoBar } from "../TerminalInfoBar";
import { SplitPane } from "../../../shared/ui/SplitPane";
import { useGpuRenderer } from "../../../shared/hooks/useGpuRenderer";
import styles from "./PaneTreeRenderer.module.css";

interface PaneTreeRendererProps {
  tree: PaneNode;
  activePaneId: string | null;
  maximizedPaneId: string | null;
  syncMode: boolean;
  onFocusPane: (id: string) => void;
  onSplit: (id: string, direction: SplitDirection) => void;
  onClose: (id: string) => void;
  onResize: (splitId: string, ratio: number) => void;
  onToggleMaximize: (id: string) => void;
  onTerminalReady: (paneId: string, terminalId: string) => void;
  canClose: boolean;
}

const SHELL_LABELS: Record<string, string> = {
  powershell: "PowerShell",
  cmd: "CMD",
  gitbash: "Git Bash",
  wsl: "WSL",
};

export function PaneTreeRenderer({
  tree, activePaneId, maximizedPaneId, syncMode,
  onFocusPane, onSplit, onClose, onResize, onToggleMaximize, onTerminalReady, canClose,
}: PaneTreeRendererProps) {
  const rendererMode = useGpuRenderer();

  // If a pane is maximized, render only that pane
  if (maximizedPaneId) {
    const leaf = findLeaf(tree, maximizedPaneId);
    if (leaf && leaf.type === "terminal") {
      return renderLeaf(leaf, true, true, syncMode, onFocusPane, onSplit, onClose, onToggleMaximize, onTerminalReady, canClose, rendererMode);
    }
  }

  return renderNode(tree, activePaneId, syncMode, onFocusPane, onSplit, onClose, onResize, onToggleMaximize, onTerminalReady, canClose, rendererMode);
}

function renderNode(
  node: PaneNode,
  activePaneId: string | null,
  syncMode: boolean,
  onFocusPane: (id: string) => void,
  onSplit: (id: string, direction: SplitDirection) => void,
  onClose: (id: string) => void,
  onResize: (splitId: string, ratio: number) => void,
  onToggleMaximize: (id: string) => void,
  onTerminalReady: (paneId: string, terminalId: string) => void,
  canClose: boolean,
  rendererMode: "wgpu" | "xterm",
): React.ReactElement {
  if (node.type === "terminal") {
    const isActive = node.id === activePaneId;
    return renderLeaf(node, isActive, false, syncMode, onFocusPane, onSplit, onClose, onToggleMaximize, onTerminalReady, canClose, rendererMode);
  }

  return (
    <SplitPane
      key={node.id}
      direction={node.direction}
      defaultRatio={node.ratio}
      onRatioChange={(r) => onResize(node.id, r)}
      first={renderNode(node.first, activePaneId, syncMode, onFocusPane, onSplit, onClose, onResize, onToggleMaximize, onTerminalReady, canClose, rendererMode)}
      second={renderNode(node.second, activePaneId, syncMode, onFocusPane, onSplit, onClose, onResize, onToggleMaximize, onTerminalReady, canClose, rendererMode)}
    />
  );
}

function renderLeaf(
  node: { id: string; shell: string; cwd?: string },
  isActive: boolean,
  isMaximized: boolean,
  syncMode: boolean,
  onFocusPane: (id: string) => void,
  onSplit: (id: string, direction: SplitDirection) => void,
  onClose: (id: string) => void,
  onToggleMaximize: (id: string) => void,
  onTerminalReady: (paneId: string, terminalId: string) => void,
  canClose: boolean,
  rendererMode: "wgpu" | "xterm",
) {
  const TerminalComponent = rendererMode === "wgpu" ? GpuTerminalArea : TerminalArea;

  return (
    <div
      key={node.id}
      className={`${styles.paneLeaf} ${isActive ? styles.paneActive : ""}`}
      onMouseDown={() => onFocusPane(node.id)}
    >
      <TerminalInfoBar
        shell={SHELL_LABELS[node.shell] ?? node.shell}
        cwd={node.cwd}
        isActive={isActive}
        isMaximized={isMaximized}
        onSplitRight={() => onSplit(node.id, "right")}
        onSplitDown={() => onSplit(node.id, "down")}
        onToggleMaximize={() => onToggleMaximize(node.id)}
        onClose={canClose ? () => onClose(node.id) : undefined}
      />
      <TerminalComponent
        shell={node.shell as "powershell" | "cmd" | "gitbash" | "wsl"}
        cwd={node.cwd}
        syncMode={syncMode}
        onTerminalReady={(tid) => onTerminalReady(node.id, tid)}
      />
    </div>
  );
}

function findLeaf(tree: PaneNode, id: string): PaneNode | null {
  if (tree.type === "terminal") return tree.id === id ? tree : null;
  return findLeaf(tree.first, id) ?? findLeaf(tree.second, id);
}
