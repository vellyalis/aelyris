import { useCallback, useState } from "react";
import type { ShellType } from "../../../App";
import { collectLeafIds, countLeaves, createLeaf, removePane, splitPane, updateRatio } from "./operations";
import type { PaneNode, SplitDirection } from "./types";

interface UsePaneTreeOptions {
  initialShell: ShellType;
  initialCwd?: string;
}

export function usePaneTree({ initialShell, initialCwd }: UsePaneTreeOptions) {
  const [tree, setTree] = useState<PaneNode>(() => createLeaf(initialShell, initialCwd));
  const [activePaneId, setActivePaneId] = useState<string | null>(null);
  const [maximizedPaneId, setMaximizedPaneId] = useState<string | null>(null);
  const [terminalIds, setTerminalIds] = useState<Map<string, string>>(new Map());

  const split = useCallback(
    (targetId: string, direction: SplitDirection) => {
      setTree((prev) => splitPane(prev, targetId, direction, initialShell, initialCwd));
      setMaximizedPaneId(null);
    },
    [initialShell, initialCwd],
  );

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
      const nextTree = removePane(prev, targetId);
      if (!nextTree) return prev;
      // If the closed pane was active (or selected by JS focus), refocus
      // a sibling instead of dropping to `null`. Without this the user
      // would stare at an unfocused tree until their next click; with
      // 3+ panes the gold-rule indicator went dark on the wrong frame
      // and the agent inspector / inline-image badge lost its target
      // until something else triggered a focus event.
      setActivePaneId((cur) => {
        if (cur !== targetId) return cur;
        const remaining = collectLeafIds(nextTree);
        return remaining[0] ?? null;
      });
      return nextTree;
    });
    setMaximizedPaneId((prev) => (prev === targetId ? null : prev));
  }, []);

  const resize = useCallback((splitId: string, ratio: number) => {
    setTree((prev) => updateRatio(prev, splitId, ratio));
  }, []);

  const toggleMaximize = useCallback((paneId: string) => {
    setMaximizedPaneId((prev) => (prev === paneId ? null : paneId));
  }, []);

  const registerTerminal = useCallback((paneId: string, terminalId: string) => {
    setTerminalIds((prev) => new Map(prev).set(paneId, terminalId));
  }, []);

  /** Close all PTYs in this tree (called when parent tab is closed). */
  const closeAllPtys = useCallback(() => {
    setTerminalIds((prev) => {
      for (const ptyId of prev.values()) {
        import("@tauri-apps/api/core").then(({ invoke }) => {
          invoke("close_terminal", { id: ptyId }).catch(() => {});
        });
      }
      return new Map();
    });
  }, []);

  const navigate = useCallback(
    (delta: 1 | -1) => {
      const leafIds = collectLeafIds(tree);
      if (leafIds.length <= 1) return;
      const currentIdx = activePaneId ? leafIds.indexOf(activePaneId) : -1;
      const nextIdx = (currentIdx + delta + leafIds.length) % leafIds.length;
      setActivePaneId(leafIds[nextIdx]);
    },
    [tree, activePaneId],
  );

  return {
    tree,
    activePaneId,
    setActivePaneId,
    maximizedPaneId,
    terminalIds,
    split,
    close,
    closeAllPtys,
    resize,
    toggleMaximize,
    registerTerminal,
    navigate,
  };
}
