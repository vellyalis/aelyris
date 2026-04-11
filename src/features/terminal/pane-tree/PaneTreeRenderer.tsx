import { useRef, useEffect, useMemo, useState, useCallback } from "react";
import { createPortal } from "react-dom";
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

interface LeafInfo {
  id: string;
  shell: string;
  cwd?: string;
}

/**
 * Portal-based PaneTree renderer.
 *
 * All TerminalArea components are mounted ONCE and never unmounted on
 * split/maximize/restore. The layout tree (SplitPane) contains empty
 * "slot" divs. Each terminal is portalled into its matching slot.
 * This guarantees xterm.js + PTY survival across tree changes.
 */
export function PaneTreeRenderer({
  tree, activePaneId, maximizedPaneId, syncMode,
  onFocusPane, onSplit, onClose, onResize, onToggleMaximize, onTerminalReady, canClose,
}: PaneTreeRendererProps) {
  const rendererMode = useGpuRenderer();
  const TerminalComponent = rendererMode === "wgpu" ? GpuTerminalArea : TerminalArea;

  const leaves = useMemo(() => collectLeaves(tree), [tree]);

  // Slot registry: paneId → DOM element
  const slotRefs = useRef(new Map<string, HTMLDivElement>());

  // Trigger re-render after slots are mounted so portals can attach
  const [, setSlotsReady] = useState(0);

  const registerSlot = useCallback((id: string, el: HTMLDivElement | null) => {
    if (el && slotRefs.current.get(id) !== el) {
      slotRefs.current.set(id, el);
      setSlotsReady((v) => v + 1);
    }
  }, []);

  // Clean up removed slots
  useEffect(() => {
    const leafIds = new Set(leaves.map((l) => l.id));
    for (const id of slotRefs.current.keys()) {
      if (!leafIds.has(id)) {
        slotRefs.current.delete(id);
      }
    }
  }, [leaves]);

  return (
    <div className={styles.paneRoot}>
      {/* Layout tree with empty slot divs */}
      {maximizedPaneId ? (
        <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
          {leaves.map((leaf) => (
            <div
              key={leaf.id}
              ref={(el) => registerSlot(leaf.id, el)}
              className={styles.paneSlot}
              style={leaf.id === maximizedPaneId
                ? { display: "flex", flex: 1, overflow: "hidden" }
                : { display: "none" }
              }
            />
          ))}
        </div>
      ) : (
        renderLayout(tree, registerSlot, onFocusPane, onResize)
      )}

      {/* Portal terminals into their slots */}
      {leaves.map((leaf) => {
        const slotEl = slotRefs.current.get(leaf.id);
        if (!slotEl) return null;

        const isActive = leaf.id === activePaneId;
        const isMaximized = leaf.id === maximizedPaneId;

        return createPortal(
          <div className={styles.paneLeaf} onMouseDown={() => onFocusPane(leaf.id)}>
            <TerminalInfoBar
              shell={SHELL_LABELS[leaf.shell] ?? leaf.shell}
              cwd={leaf.cwd}
              isActive={isActive}
              isMaximized={isMaximized}
              onSplitRight={() => onSplit(leaf.id, "right")}
              onSplitDown={() => onSplit(leaf.id, "down")}
              onToggleMaximize={() => onToggleMaximize(leaf.id)}
              onClose={canClose ? () => onClose(leaf.id) : undefined}
            />
            <TerminalComponent
              shell={leaf.shell as "powershell" | "cmd" | "gitbash" | "wsl"}
              cwd={leaf.cwd}
              syncMode={syncMode}
              onTerminalReady={(tid) => onTerminalReady(leaf.id, tid)}
            />
          </div>,
          slotEl,
          leaf.id,
        );
      })}
    </div>
  );
}

function renderLayout(
  node: PaneNode,
  registerSlot: (id: string, el: HTMLDivElement | null) => void,
  onFocusPane: (id: string) => void,
  onResize: (splitId: string, ratio: number) => void,
): React.ReactElement {
  if (node.type === "terminal") {
    return (
      <div
        key={node.id}
        ref={(el) => registerSlot(node.id, el)}
        className={styles.paneSlot}
        onMouseDown={() => onFocusPane(node.id)}
      />
    );
  }

  return (
    <SplitPane
      key={node.id}
      direction={node.direction}
      defaultRatio={node.ratio}
      onRatioChange={(r) => onResize(node.id, r)}
      first={renderLayout(node.first, registerSlot, onFocusPane, onResize)}
      second={renderLayout(node.second, registerSlot, onFocusPane, onResize)}
    />
  );
}

function collectLeaves(tree: PaneNode): LeafInfo[] {
  if (tree.type === "terminal") return [{ id: tree.id, shell: tree.shell, cwd: tree.cwd }];
  return [...collectLeaves(tree.first), ...collectLeaves(tree.second)];
}
