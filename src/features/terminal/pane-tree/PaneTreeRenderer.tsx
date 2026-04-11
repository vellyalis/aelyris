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
  const TerminalComponent = rendererMode === "wgpu" ? GpuTerminalArea : TerminalArea;

  return renderNode(
    tree, activePaneId, maximizedPaneId, syncMode,
    onFocusPane, onSplit, onClose, onResize, onToggleMaximize, onTerminalReady, canClose,
    TerminalComponent,
  );
}

function renderNode(
  node: PaneNode,
  activePaneId: string | null,
  maximizedPaneId: string | null,
  syncMode: boolean,
  onFocusPane: (id: string) => void,
  onSplit: (id: string, direction: SplitDirection) => void,
  onClose: (id: string) => void,
  onResize: (splitId: string, ratio: number) => void,
  onToggleMaximize: (id: string) => void,
  onTerminalReady: (paneId: string, terminalId: string) => void,
  canClose: boolean,
  TerminalComponent: typeof TerminalArea | typeof GpuTerminalArea,
): React.ReactElement {
  if (node.type === "terminal") {
    const isActive = node.id === activePaneId;
    const isMaximized = node.id === maximizedPaneId;
    // When another pane is maximized, hide this one via CSS (don't unmount)
    const isHidden = maximizedPaneId !== null && !isMaximized;

    return (
      <div
        key={node.id}
        className={styles.paneLeaf}
        style={isHidden ? { display: "none" } : undefined}
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

  // When a pane is maximized, hide the SplitPane chrome but keep children mounted
  const isHiddenSplit = maximizedPaneId !== null;

  if (isHiddenSplit) {
    // Render children flat (no SplitPane wrapper) — hidden ones get display:none
    return (
      <div key={node.id} style={{ display: "contents" }}>
        {renderNode(node.first, activePaneId, maximizedPaneId, syncMode, onFocusPane, onSplit, onClose, onResize, onToggleMaximize, onTerminalReady, canClose, TerminalComponent)}
        {renderNode(node.second, activePaneId, maximizedPaneId, syncMode, onFocusPane, onSplit, onClose, onResize, onToggleMaximize, onTerminalReady, canClose, TerminalComponent)}
      </div>
    );
  }

  return (
    <SplitPane
      key={node.id}
      direction={node.direction}
      defaultRatio={node.ratio}
      onRatioChange={(r) => onResize(node.id, r)}
      first={renderNode(node.first, activePaneId, maximizedPaneId, syncMode, onFocusPane, onSplit, onClose, onResize, onToggleMaximize, onTerminalReady, canClose, TerminalComponent)}
      second={renderNode(node.second, activePaneId, maximizedPaneId, syncMode, onFocusPane, onSplit, onClose, onResize, onToggleMaximize, onTerminalReady, canClose, TerminalComponent)}
    />
  );
}
