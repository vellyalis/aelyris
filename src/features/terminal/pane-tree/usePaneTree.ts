import { useState, useCallback } from "react";
import type { PaneNode, SplitDirection } from "./types";
import { createLeaf, splitPane, removePane, updateRatio, collectLeafIds, countLeaves } from "./operations";
import type { ShellType } from "../../../App";

interface UsePaneTreeOptions {
  initialShell: ShellType;
  initialCwd?: string;
}

/**
 * Hook that manages PaneTree state: split, close, navigate, resize.
 * Pure state management — no UI rendering.
 */
export function usePaneTree({ initialShell, initialCwd }: UsePaneTreeOptions) {
  const [tree, setTree] = useState<PaneNode>(() => createLeaf(initialShell, initialCwd));
  const [activePaneId, setActivePaneId] = useState<string | null>(null);
  const [maximizedPaneId, setMaximizedPaneId] = useState<string | null>(null);
  const [terminalIds, setTerminalIds] = useState<Map<string, string>>(new Map());

  const split = useCallback((targetId: string, direction: SplitDirection) => {
    setTree((prev) => splitPane(prev, targetId, direction, initialShell, initialCwd));
  }, [initialShell, initialCwd]);

  const close = useCallback((targetId: string) => {
    setTree((prev) => {
      if (countLeaves(prev) <= 1) return prev; // don't close last pane
      return removePane(prev, targetId) ?? prev;
    });
    setActivePaneId((prev) => prev === targetId ? null : prev);
    setMaximizedPaneId((prev) => prev === targetId ? null : prev);
    setTerminalIds((prev) => {
      const next = new Map(prev);
      next.delete(targetId);
      return next;
    });
  }, []);

  const resize = useCallback((splitId: string, ratio: number) => {
    setTree((prev) => updateRatio(prev, splitId, ratio));
  }, []);

  const toggleMaximize = useCallback((paneId: string) => {
    setMaximizedPaneId((prev) => prev === paneId ? null : paneId);
  }, []);

  const registerTerminal = useCallback((paneId: string, terminalId: string) => {
    setTerminalIds((prev) => new Map(prev).set(paneId, terminalId));
  }, []);

  /** Navigate to the next/previous pane */
  const navigate = useCallback((delta: 1 | -1) => {
    const leafIds = collectLeafIds(tree);
    if (leafIds.length <= 1) return;
    const currentIdx = activePaneId ? leafIds.indexOf(activePaneId) : -1;
    const nextIdx = (currentIdx + delta + leafIds.length) % leafIds.length;
    setActivePaneId(leafIds[nextIdx]);
  }, [tree, activePaneId]);

  return {
    tree,
    activePaneId,
    setActivePaneId,
    maximizedPaneId,
    terminalIds,
    split,
    close,
    resize,
    toggleMaximize,
    registerTerminal,
    navigate,
  };
}
