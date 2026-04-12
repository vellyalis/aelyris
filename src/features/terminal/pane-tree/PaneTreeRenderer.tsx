import { useRef, useEffect, useMemo, useState, useCallback } from "react";
import type { PaneNode, SplitDirection } from "./types";
import { TerminalArea } from "../TerminalArea";
import { GpuTerminalArea } from "../GpuTerminalArea";
import { TerminalInfoBar } from "../TerminalInfoBar";
import { useGpuRenderer } from "../../../shared/hooks/useGpuRenderer";
import { SplitPane } from "../../../shared/ui/SplitPane";
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
 * Stable PaneTree renderer — absolute positioning approach.
 *
 * Design:
 * 1. SplitPane layout tree renders invisible "slot" divs (for sizing only)
 * 2. All TerminalArea components are rendered in a FLAT list with stable keys
 * 3. Each TerminalArea is absolutely positioned to match its slot's rect
 * 4. ResizeObserver on each slot updates the position
 *
 * This guarantees TerminalArea is NEVER unmounted on split/maximize/close.
 * The flat list only grows (on split) or shrinks (on close).
 */
export function PaneTreeRenderer({
  tree, activePaneId, maximizedPaneId, syncMode,
  onFocusPane, onSplit, onClose, onResize, onToggleMaximize, onTerminalReady, canClose,
}: PaneTreeRendererProps) {
  const rendererMode = useGpuRenderer();
  const rootRef = useRef<HTMLDivElement>(null);

  // Accumulate all leaves ever seen (never remove — React handles unmount via key removal)
  const leavesRef = useRef(new Map<string, LeafInfo>());
  const currentLeaves = useMemo(() => collectLeaves(tree), [tree]);

  // Update the accumulated leaf map
  const currentIds = new Set<string>();
  for (const leaf of currentLeaves) {
    currentIds.add(leaf.id);
    if (!leavesRef.current.has(leaf.id)) {
      leavesRef.current.set(leaf.id, leaf);
    }
  }
  // Remove leaves that no longer exist in the tree
  for (const id of leavesRef.current.keys()) {
    if (!currentIds.has(id)) {
      leavesRef.current.delete(id);
    }
  }

  // Stable array derived from the map (order doesn't matter for absolute positioning)
  const stableLeaves = Array.from(leavesRef.current.values());

  // Slot rects: paneId → DOMRect (updated by ResizeObserver)
  const [slotRects, setSlotRects] = useState<Map<string, DOMRect>>(new Map());
  const slotEls = useRef(new Map<string, HTMLDivElement>());

  const registerSlot = useCallback((id: string, el: HTMLDivElement | null) => {
    if (el) {
      slotEls.current.set(id, el);
    } else {
      slotEls.current.delete(id);
    }
  }, []);

  // ResizeObserver to track slot positions
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const updateRects = () => {
      const rootRect = root.getBoundingClientRect();
      const newRects = new Map<string, DOMRect>();
      for (const [id, el] of slotEls.current) {
        const r = el.getBoundingClientRect();
        // Relative to root
        newRects.set(id, new DOMRect(
          r.left - rootRect.left,
          r.top - rootRect.top,
          r.width,
          r.height,
        ));
      }
      setSlotRects(newRects);
    };

    const ro = new ResizeObserver(updateRects);
    ro.observe(root);
    // Also observe all slots
    for (const el of slotEls.current.values()) {
      ro.observe(el);
    }

    // Initial measurement
    requestAnimationFrame(updateRects);

    return () => ro.disconnect();
  }, [tree, maximizedPaneId]); // Re-setup when tree or maximize changes

  return (
    <div ref={rootRef} className={styles.paneRoot}>
      {/* Layer 1: Layout tree (invisible slots for sizing) */}
      <div className={styles.layoutLayer}>
        {maximizedPaneId ? (
          <>
            {currentLeaves.map((leaf) => (
              <div
                key={leaf.id}
                ref={(el) => registerSlot(leaf.id, el)}
                className={styles.paneSlot}
                style={leaf.id === maximizedPaneId
                  ? { display: "flex", flex: 1 }
                  : { display: "none" }
                }
              />
            ))}
          </>
        ) : (
          renderLayout(tree, registerSlot, onResize)
        )}
      </div>

      {/* Layer 2: Stable terminal instances (absolute positioned) */}
      {stableLeaves.map((leaf) => {
        const rect = slotRects.get(leaf.id);
        const isVisible = maximizedPaneId ? leaf.id === maximizedPaneId : currentIds.has(leaf.id);
        const isActive = leaf.id === activePaneId;
        const isMaximized = leaf.id === maximizedPaneId;

        return (
          <div
            key={leaf.id}
            className={styles.terminalMount}
            style={rect && isVisible ? {
              position: "absolute",
              left: rect.left,
              top: rect.top,
              width: rect.width,
              height: rect.height,
            } : { display: "none" }}
            onMouseDown={() => onFocusPane(leaf.id)}
          >
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
            {rendererMode === "wgpu" ? (
              <GpuTerminalArea
                shell={leaf.shell as "powershell" | "cmd" | "gitbash" | "wsl"}
                cwd={leaf.cwd}
                syncMode={syncMode}
                onTerminalReady={(tid) => onTerminalReady(leaf.id, tid)}
              />
            ) : (
              <TerminalArea
                shell={leaf.shell as "powershell" | "cmd" | "gitbash" | "wsl"}
                cwd={leaf.cwd}
                syncMode={syncMode}
                onTerminalReady={(tid) => onTerminalReady(leaf.id, tid)}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Render the layout tree — only empty sizing divs, no terminals */
function renderLayout(
  node: PaneNode,
  registerSlot: (id: string, el: HTMLDivElement | null) => void,
  onResize: (splitId: string, ratio: number) => void,
): React.ReactElement {
  if (node.type === "terminal") {
    return (
      <div
        key={node.id}
        ref={(el) => registerSlot(node.id, el)}
        className={styles.paneSlot}
      />
    );
  }

  return (
    <SplitPane
      key={node.id}
      direction={node.direction}
      defaultRatio={node.ratio}
      onRatioChange={(r) => onResize(node.id, r)}
      first={renderLayout(node.first, registerSlot, onResize)}
      second={renderLayout(node.second, registerSlot, onResize)}
    />
  );
}

function collectLeaves(tree: PaneNode): LeafInfo[] {
  if (tree.type === "terminal") return [{ id: tree.id, shell: tree.shell, cwd: tree.cwd }];
  return [...collectLeaves(tree.first), ...collectLeaves(tree.second)];
}
