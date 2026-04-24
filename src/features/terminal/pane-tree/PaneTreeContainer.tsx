import { useEffect } from "react";
import type { ShellType } from "../../../App";
import { countLeaves } from "./operations";
import { PaneTreeRenderer } from "./PaneTreeRenderer";
import { usePaneTree } from "./usePaneTree";

interface PaneTreeContainerProps {
  shell: ShellType;
  cwd?: string;
}

/**
 * Container that owns the PaneTree state for a single tab.
 * Connects the usePaneTree hook to the PaneTreeRenderer.
 */
export function PaneTreeContainer({ shell, cwd }: PaneTreeContainerProps) {
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
