import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { useCallback, useState } from "react";
import type { ShellType } from "../../../shared/types/terminalPane";
import { reportInvokeFailure } from "../../../shared/lib/fallbackTelemetry";
import { isTauriRuntime } from "../../../shared/lib/tauriRuntime";
import {
  collectLeafIds,
  countLeaves,
  createLeaf,
  createLeafWithId,
  cycleLeafRole,
  equalizePaneRatios,
  movePaneInOrder,
  normalizePaneTitle,
  rebalancePaneLayout,
  removePane,
  rotatePanesInOrder,
  splitPane,
  uniquePaneTitle,
  updateLeafMeta,
  updateRatio,
} from "./operations";
import type { PaneNode, PaneRole, SplitDirection } from "./types";

interface UsePaneTreeOptions {
  initialShell: ShellType;
  initialCwd?: string;
  initialTree?: PaneNode;
  initialActivePaneId?: string | null;
}

function closeBackendTerminal(terminalId: string, operation = "close_terminal") {
  if (!isTauriRuntime()) return;
  Promise.resolve({ invoke: tauriInvoke })
    .then(({ invoke }) => invoke("close_terminal", { id: terminalId }))
    .catch((err) => {
      reportInvokeFailure({
        source: "pane-tree",
        operation,
        err,
        severity: "error",
        userVisible: true,
      });
    });
}

export function usePaneTree({ initialShell, initialCwd, initialTree, initialActivePaneId }: UsePaneTreeOptions) {
  const [tree, setTree] = useState<PaneNode>(() => initialTree ?? createLeaf(initialShell, initialCwd));
  const [activePaneId, setActivePaneId] = useState<string | null>(initialActivePaneId ?? null);
  const [maximizedPaneId, setMaximizedPaneId] = useState<string | null>(null);
  const [terminalIds, setTerminalIds] = useState<Map<string, string>>(new Map());

  const split = useCallback(
    (targetId: string, direction: SplitDirection) => {
      setTree((prev) => splitPane(prev, targetId, direction, initialShell, initialCwd));
      setMaximizedPaneId(null);
    },
    [initialShell, initialCwd],
  );

  const splitWithContext = useCallback(
    (targetId: string, direction: SplitDirection, shell: ShellType, cwd?: string) => {
      setTree((prev) => splitPane(prev, targetId, direction, shell, cwd));
      setMaximizedPaneId(null);
    },
    [],
  );

  const splitWithExistingTerminal = useCallback(
    (targetId: string, direction: SplitDirection, terminalId: string, shell: ShellType, cwd?: string) => {
      const newLeaf = createLeafWithId(terminalId, shell, cwd);
      setTree((prev) => splitPane(prev, targetId, direction, initialShell, initialCwd, newLeaf));
      setTerminalIds((prev) => new Map(prev).set(terminalId, terminalId));
      setActivePaneId(terminalId);
      setMaximizedPaneId(null);
    },
    [initialShell, initialCwd],
  );

  const close = useCallback(
    (targetId: string, options: { closeBackend?: boolean } = {}) => {
      const closeBackend = options.closeBackend ?? true;
      const shouldClosePty = countLeaves(tree) > 1 && collectLeafIds(tree).includes(targetId);
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
      setTerminalIds((prev) => {
        if (!shouldClosePty) return prev;
        const ptyId = prev.get(targetId);
        if (ptyId && closeBackend) {
          closeBackendTerminal(ptyId);
        }
        const next = new Map(prev);
        next.delete(targetId);
        return next;
      });
      setMaximizedPaneId((prev) => (prev === targetId ? null : prev));
    },
    [tree],
  );

  const resize = useCallback((splitId: string, ratio: number) => {
    setTree((prev) => updateRatio(prev, splitId, ratio));
  }, []);

  const equalize = useCallback(() => {
    setTree((prev) => equalizePaneRatios(prev));
    setMaximizedPaneId(null);
  }, []);

  const rebalance = useCallback((direction: "horizontal" | "vertical" | "tiled") => {
    setTree((prev) => rebalancePaneLayout(prev, direction));
    setMaximizedPaneId(null);
  }, []);

  const moveActive = useCallback(
    (delta: 1 | -1) => {
      if (!activePaneId) return;
      setTree((prev) => movePaneInOrder(prev, activePaneId, delta));
      setMaximizedPaneId(null);
    },
    [activePaneId],
  );

  const rotatePanes = useCallback((delta: 1 | -1) => {
    setTree((prev) => rotatePanesInOrder(prev, delta));
    setMaximizedPaneId(null);
  }, []);

  const toggleMaximize = useCallback((paneId: string) => {
    setMaximizedPaneId((prev) => (prev === paneId ? null : paneId));
  }, []);

  const renamePane = useCallback((paneId: string, title: string | null) => {
    setTree((prev) => {
      const normalized = normalizePaneTitle(title);
      return updateLeafMeta(prev, paneId, {
        title: normalized ? uniquePaneTitle(prev, paneId, normalized) : null,
      });
    });
  }, []);

  const setPaneRole = useCallback((paneId: string, role: PaneRole | null) => {
    setTree((prev) => updateLeafMeta(prev, paneId, { role }));
  }, []);

  const cyclePaneRole = useCallback((paneId: string) => {
    setTree((prev) => cycleLeafRole(prev, paneId));
  }, []);

  const registerTerminal = useCallback((paneId: string, terminalId: string) => {
    setTerminalIds((prev) => new Map(prev).set(paneId, terminalId));
  }, []);

  const unregisterTerminal = useCallback((paneId: string) => {
    setTerminalIds((prev) => {
      if (!prev.has(paneId)) return prev;
      const next = new Map(prev);
      next.delete(paneId);
      return next;
    });
  }, []);

  const replaceTree = useCallback((nextTree: PaneNode, nextActivePaneId: string | null) => {
    setTerminalIds((prev) => {
      for (const ptyId of prev.values()) {
        closeBackendTerminal(ptyId, "replace_tree_close_terminal");
      }
      return new Map();
    });
    setTree(nextTree);
    setActivePaneId(nextActivePaneId);
    setMaximizedPaneId(null);
  }, []);

  /** Close all PTYs in this tree (called when parent tab is closed). */
  const closeAllPtys = useCallback(() => {
    setTerminalIds((prev) => {
      for (const ptyId of prev.values()) {
        closeBackendTerminal(ptyId, "close_all_terminals_close_terminal");
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
    splitWithContext,
    splitWithExistingTerminal,
    close,
    closeAllPtys,
    resize,
    equalize,
    rebalance,
    moveActive,
    rotatePanes,
    toggleMaximize,
    renamePane,
    setPaneRole,
    cyclePaneRole,
    registerTerminal,
    unregisterTerminal,
    replaceTree,
    navigate,
  };
}
