import { useState, useCallback } from "react";
import type { PaneNode, SplitDirection } from "./types";
import { createLeaf, splitPane, removePane, updateRatio, collectLeafIds, countLeaves } from "./operations";
import type { ShellType } from "../../../App";

interface UsePaneTreeOptions {
  initialShell: ShellType;
  initialCwd?: string;
}

export function usePaneTree({ initialShell, initialCwd }: UsePaneTreeOptions) {
  const [tree, setTree] = useState<PaneNode>(() => createLeaf(initialShell, initialCwd));
  const [activePaneId, setActivePaneId] = useState<string | null>(null);
  const [maximizedPaneId, setMaximizedPaneId] = useState<string | null>(null);
  const [terminalIds, setTerminalIds] = useState<Map<string, string>>(new Map());

  const split = useCallback((targetId: string, direction: SplitDirection) => {
    setTree((prev) => splitPane(prev, targetId, direction, initialShell, initialCwd));
    setMaximizedPaneId(null);
  }, [initialShell, initialCwd]);

  const close = useCallback((targetId: string) => {
    // Close the PTY on the Rust side before removing from tree
    setTerminalIds((prev) => {
      const ptyId = prev.get(targetId);
      if (ptyId) {
        import("@tauri-apps/api/core").then(({ invoke }) => {
          invoke("close_terminal", { id: ptyId }).catch(() => {});
        });
      }
      const next = new Map(prev);
      next.delete(targetId);
      return next;
    });

    setTree((prev) => {
      if (countLeaves(prev) <= 1) return prev;
      return removePane(prev, targetId) ?? prev;
    });
    setActivePaneId((prev) => prev === targetId ? null : prev);
    setMaximizedPaneId((prev) => prev === targetId ? null : prev);
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
