import { useEffect, useMemo } from "react";
import type { ShellType } from "../../../App";
import { countLeaves } from "./operations";
import { PaneTreeRenderer } from "./PaneTreeRenderer";
import { usePaneTree } from "./usePaneTree";

interface PaneTreeContainerProps {
  shell: ShellType;
  cwd?: string;
  /**
   * Fires whenever the focused-pane PTY id changes inside this tab —
   * lifts the otherwise-private `terminalIds` map up to the App layer
   * so global UI (e.g. the status-bar inline-image budget badge) can
   * point at the correct backend session. `null` while the focused
   * pane is still spawning, when the tab has zero panes (transient
   * state during close), or when no pane has been focused yet.
   */
  onActiveTerminalChange?: (terminalId: string | null) => void;
}

/**
 * Container that owns the PaneTree state for a single tab.
 * Connects the usePaneTree hook to the PaneTreeRenderer.
 */
export function PaneTreeContainer({
  shell,
  cwd,
  onActiveTerminalChange,
}: PaneTreeContainerProps) {
  const {
    tree,
    activePaneId,
    maximizedPaneId,
    terminalIds,
    setActivePaneId,
    split,
    close,
    closeAllPtys,
    resize,
    toggleMaximize,
    registerTerminal,
  } = usePaneTree({ initialShell: shell, initialCwd: cwd });

  // Clean up all PTYs when this tab/container is unmounted
  useEffect(() => {
    return () => {
      closeAllPtys();
    };
  }, [closeAllPtys]);

  // Resolve the active pane's PTY id. When `activePaneId` is null but
  // exactly one pane exists, fall back to that pane's id — the common
  // single-pane case where the user has not explicitly clicked yet
  // should still surface telemetry for the only live shell.
  const activeTerminalId = useMemo<string | null>(() => {
    if (activePaneId !== null) {
      return terminalIds.get(activePaneId) ?? null;
    }
    if (terminalIds.size === 1) {
      const only = terminalIds.values().next();
      return only.done ? null : (only.value ?? null);
    }
    return null;
  }, [activePaneId, terminalIds]);

  useEffect(() => {
    onActiveTerminalChange?.(activeTerminalId);
  }, [activeTerminalId, onActiveTerminalChange]);

  const canClose = countLeaves(tree) > 1;

  return (
    <PaneTreeRenderer
      tree={tree}
      activePaneId={activePaneId}
      maximizedPaneId={maximizedPaneId}
      terminalIds={terminalIds}
      onFocusPane={setActivePaneId}
      onSplit={split}
      onClose={close}
      onResize={resize}
      onToggleMaximize={toggleMaximize}
      onTerminalReady={registerTerminal}
      canClose={canClose}
    />
  );
}
