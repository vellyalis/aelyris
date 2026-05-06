import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ShellType } from "../../../App";
import type { PaneSwitcherEntry } from "./operations";
import { collectLeafIds, collectPaneSwitcherEntries, countLeaves, findLeaf } from "./operations";
import { PaneTreeRenderer } from "./PaneTreeRenderer";
import {
  loadPaneTreeSnapshot,
  loadPaneTreeSnapshotFromBackend,
  type PaneBackendBindingFingerprint,
  type PaneTreeSnapshot,
  savePaneTreeSnapshot,
  savePaneTreeSnapshotToBackend,
} from "./persistence";
import type { PaneHealthState, PaneLifecycleState, PaneNode, PaneSessionIntent } from "./types";
import { usePaneTree } from "./usePaneTree";

export interface PaneFocusRequest {
  paneId: string;
  sequence: number;
}

export interface PaneCloseRequest {
  paneId: string;
  sequence: number;
}

export interface PaneRestartRequest {
  paneId: string;
  sequence: number;
  onComplete?: (error: string | null) => void;
}

export interface PaneAttachRequest {
  paneId: string;
  terminalId: string;
  sequence: number;
  onComplete?: (error: string | null) => void;
}

export interface PaneRenameRequest {
  paneId: string;
  title: string | null;
  sequence: number;
}

export interface PaneRoleCycleRequest {
  paneId: string;
  sequence: number;
}

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
  /** Emits the current pane topology and PTY bindings for tmux-style switchers. */
  onPaneRegistryChange?: (panes: PaneSwitcherEntry[]) => void;
  /** Human window label used by tmux-style pane switcher routes. */
  switcherWindowLabel?: string;
  /** Imperative focus bridge used by global commands; never remounts terminals. */
  focusPaneRequest?: PaneFocusRequest | null;
  /** Imperative close bridge used by process/workstation management surfaces. */
  closePaneRequest?: PaneCloseRequest | null;
  /** Imperative restart bridge used by process/workstation management surfaces. */
  restartPaneRequest?: PaneRestartRequest | null;
  /** Imperative attach bridge used to bind a detached layout leaf to an existing backend PTY. */
  attachPaneRequest?: PaneAttachRequest | null;
  /** Imperative rename bridge used by tmux-style management surfaces. */
  renamePaneRequest?: PaneRenameRequest | null;
  /** Imperative role-cycle bridge used by tmux-style management surfaces. */
  cyclePaneRoleRequest?: PaneRoleCycleRequest | null;
  /** localStorage key used to restore this tab's pane topology and labels. */
  layoutStorageKey?: string;
  /** Used only for durable backend layout metadata; empty is accepted. */
  projectPath?: string;
}

interface PendingBackendPaneTreeSnapshot {
  storageKey: string;
  snapshot: Omit<PaneTreeSnapshot, "version">;
  projectPath: string;
}

interface BackendPaneInfo {
  terminal_id: string;
  name?: string;
  role?: string;
  shell_type?: string;
  cwd?: string;
}

/**
 * Container that owns the PaneTree state for a single tab.
 * Connects the usePaneTree hook to the PaneTreeRenderer.
 */
export function PaneTreeContainer({
  shell,
  cwd,
  onActiveTerminalChange,
  onPaneRegistryChange,
  switcherWindowLabel = "window",
  focusPaneRequest,
  closePaneRequest,
  restartPaneRequest,
  attachPaneRequest,
  renamePaneRequest,
  cyclePaneRoleRequest,
  layoutStorageKey,
  projectPath,
}: PaneTreeContainerProps) {
  const initialSnapshot = useMemo(
    () => (layoutStorageKey ? loadPaneTreeSnapshot(layoutStorageKey, shell, cwd) : null),
    [cwd, layoutStorageKey, shell],
  );
  const hasFastSnapshot = initialSnapshot !== null;
  const [layoutHydrated, setLayoutHydrated] = useState(() => !layoutStorageKey || hasFastSnapshot);
  const [paneLifecycleStates, setPaneLifecycleStates] = useState<ReadonlyMap<string, PaneLifecycleState>>(
    () => new Map(),
  );
  const [orphanedBackendPanes, setOrphanedBackendPanes] = useState<PaneSwitcherEntry[]>([]);
  const [backendReconciled, setBackendReconciled] = useState(() => !layoutStorageKey);
  const [backendRefreshNonce, setBackendRefreshNonce] = useState(0);
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
    renamePane,
    setPaneRole,
    cyclePaneRole,
    registerTerminal,
    replaceTree,
  } = usePaneTree({
    initialShell: shell,
    initialCwd: cwd,
    initialTree: initialSnapshot?.tree,
    initialActivePaneId: initialSnapshot?.activePaneId,
  });
  const backendBindingsRef = useRef<Record<string, PaneBackendBindingFingerprint> | undefined>(
    initialSnapshot?.backendBindings,
  );
  const pendingBackendSnapshotRef = useRef<PendingBackendPaneTreeSnapshot | null>(null);
  const backendSaveSequenceRef = useRef(0);
  const flushBackendSnapshot = useCallback((pending: PendingBackendPaneTreeSnapshot, sequence: number) => {
    void savePaneTreeSnapshotToBackend(pending.storageKey, pending.snapshot, pending.projectPath).then((saved) => {
      if (saved && backendSaveSequenceRef.current === sequence) {
        pendingBackendSnapshotRef.current = null;
      }
    });
  }, []);

  useEffect(() => {
    if (!layoutStorageKey || hasFastSnapshot) return;
    let cancelled = false;
    setLayoutHydrated(false);
    setBackendReconciled(false);
    loadPaneTreeSnapshotFromBackend(layoutStorageKey, shell, cwd).then((snapshot) => {
      if (cancelled) return;
      if (snapshot) {
        backendBindingsRef.current = snapshot.backendBindings ?? {};
        replaceTree(snapshot.tree, snapshot.activePaneId);
      }
      setLayoutHydrated(true);
    });
    return () => {
      cancelled = true;
    };
  }, [cwd, hasFastSnapshot, layoutStorageKey, replaceTree, shell]);

  useEffect(() => {
    void backendRefreshNonce;
    if (!layoutStorageKey || !layoutHydrated) {
      if (!layoutStorageKey) setBackendReconciled(true);
      return;
    }
    let cancelled = false;
    if (terminalIds.size === 0) setBackendReconciled(false);
    import("@tauri-apps/api/core")
      .then(async ({ invoke }) => {
        const backendPanes = await invoke<unknown>("list_panes_info")
          .then(parseBackendPaneInfo)
          .catch(async () => {
            const activeTerminalIds = await invoke<unknown>("list_terminals").catch(() => []);
            return parseTerminalIds(activeTerminalIds).map((terminalId) => ({ terminal_id: terminalId }));
          });
        if (backendPanes.length > 0) return backendPanes;
        const activeTerminalIds = await invoke<unknown>("list_terminals").catch(() => []);
        return parseTerminalIds(activeTerminalIds).map((terminalId) => ({ terminal_id: terminalId }));
      })
      .then((backendPanes) => {
        if (cancelled) return;
        if (backendPanes.length === 0) {
          setOrphanedBackendPanes([]);
          setPaneLifecycleStates((prev) => {
            if (terminalIds.size === 0) return prev;
            let changed = false;
            const next = new Map(prev);
            for (const paneId of terminalIds.keys()) {
              const current = next.get(paneId);
              if (current && current !== "layout-only" && current !== "detached" && current !== "live") continue;
              next.set(paneId, "exited");
              changed = true;
            }
            return changed ? next : prev;
          });
          setBackendReconciled(true);
          return;
        }
        const restoredPaneIds = collectLeafIds(tree);
        if (restoredPaneIds.length === 0) {
          setBackendReconciled(true);
          return;
        }
        const registeredTerminalIds = new Set(terminalIds.values());
        const registeredPaneIds = new Set(terminalIds.keys());
        const backendTerminalIds = new Set(backendPanes.map((pane) => pane.terminal_id));
        const reconciliation = reconcileHydratedLayoutWithBackend(
          tree,
          backendPanes,
          switcherWindowLabel,
          registeredPaneIds,
          registeredTerminalIds,
          backendBindingsRef.current,
        );
        for (const attached of reconciliation.attached) {
          registerTerminal(attached.paneId, attached.terminalId);
        }
        setPaneLifecycleStates((prev) => {
          let changed = false;
          const next = new Map(prev);
          const attachedPaneIds = new Set(reconciliation.attached.map((attached) => attached.paneId));
          for (const paneId of restoredPaneIds) {
            const current = next.get(paneId);
            const terminalId = terminalIds.get(paneId);
            const lifecycle = terminalId
              ? backendTerminalIds.has(terminalId)
                ? "live"
                : "exited"
              : attachedPaneIds.has(paneId)
                ? "live"
                : "detached";
            if (current && current !== "layout-only" && current !== "detached" && current !== "live") continue;
            if (current !== lifecycle) {
              next.set(paneId, lifecycle);
              changed = true;
            }
          }
          return changed ? next : prev;
        });
        setOrphanedBackendPanes(reconciliation.orphaned);
        setBackendReconciled(true);
      })
      .catch(() => {
        if (!cancelled) setBackendReconciled(true);
      });
    return () => {
      cancelled = true;
    };
  }, [backendRefreshNonce, layoutHydrated, layoutStorageKey, registerTerminal, switcherWindowLabel, terminalIds, tree]);

  useEffect(() => {
    if (!layoutStorageKey || !layoutHydrated) return;
    let lastRefreshAt = 0;
    const requestRefresh = () => {
      const now = Date.now();
      if (now - lastRefreshAt < 2000) return;
      lastRefreshAt = now;
      setBackendRefreshNonce((value) => value + 1);
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") requestRefresh();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("online", requestRefresh);
    window.addEventListener("focus", requestRefresh);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("online", requestRefresh);
      window.removeEventListener("focus", requestRefresh);
    };
  }, [layoutHydrated, layoutStorageKey]);

  useEffect(() => {
    if (terminalIds.size === 0 || orphanedBackendPanes.length === 0) return;
    const attachedTerminalIds = new Set(terminalIds.values());
    setOrphanedBackendPanes((prev) => {
      const next = prev.filter((pane) => !pane.terminalId || !attachedTerminalIds.has(pane.terminalId));
      return next.length === prev.length ? prev : next;
    });
  }, [orphanedBackendPanes.length, terminalIds]);

  useEffect(() => {
    if (!layoutStorageKey || !layoutHydrated) return;
    const backendBindings = mergeBackendBindings(tree, backendBindingsRef.current, terminalIds);
    backendBindingsRef.current = backendBindings;
    const sessionId = layoutStorageKey;
    const layoutId = layoutStorageKey;
    const paneIntents = buildPaneSessionIntents(
      tree,
      terminalIds,
      paneLifecycleStates,
      backendBindings,
      sessionId,
      layoutId,
      activePaneId,
    );
    const snapshot = { tree, activePaneId, sessionId, layoutId, backendBindings, paneIntents };
    const pending = {
      storageKey: layoutStorageKey,
      snapshot,
      projectPath: projectPath ?? cwd ?? "",
    };
    const sequence = backendSaveSequenceRef.current + 1;
    backendSaveSequenceRef.current = sequence;
    pendingBackendSnapshotRef.current = pending;
    savePaneTreeSnapshot(layoutStorageKey, snapshot);
    const timer = window.setTimeout(() => {
      flushBackendSnapshot(pending, sequence);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [
    activePaneId,
    cwd,
    flushBackendSnapshot,
    layoutHydrated,
    layoutStorageKey,
    paneLifecycleStates,
    projectPath,
    terminalIds,
    tree,
  ]);

  useEffect(() => {
    return () => {
      const pending = pendingBackendSnapshotRef.current;
      if (!pending) return;
      flushBackendSnapshot(pending, backendSaveSequenceRef.current);
    };
  }, [flushBackendSnapshot]);

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

  const onPaneRegistryChangeRef = useRef(onPaneRegistryChange);
  useEffect(() => {
    onPaneRegistryChangeRef.current = onPaneRegistryChange;
  }, [onPaneRegistryChange]);

  const paneRegistry = useMemo(
    () => [
      ...collectPaneSwitcherEntries(tree, terminalIds, switcherWindowLabel, paneLifecycleStates),
      ...orphanedBackendPanes,
    ],
    [orphanedBackendPanes, paneLifecycleStates, switcherWindowLabel, terminalIds, tree],
  );
  useEffect(() => {
    onPaneRegistryChangeRef.current?.(paneRegistry);
  }, [paneRegistry]);

  const handledFocusSequenceRef = useRef<number | null>(null);
  const handledCloseSequenceRef = useRef<number | null>(null);
  const handledRestartMissingSequenceRef = useRef<number | null>(null);
  const handledAttachSequenceRef = useRef<number | null>(null);
  const handledRenameSequenceRef = useRef<number | null>(null);
  const handledRoleCycleSequenceRef = useRef<number | null>(null);

  useEffect(() => {
    if (!focusPaneRequest) return;
    if (handledFocusSequenceRef.current === focusPaneRequest.sequence) return;
    handledFocusSequenceRef.current = focusPaneRequest.sequence;
    if (!findLeaf(tree, focusPaneRequest.paneId)) return;
    setActivePaneId(focusPaneRequest.paneId);
  }, [focusPaneRequest, setActivePaneId, tree]);

  useEffect(() => {
    if (!closePaneRequest) return;
    if (handledCloseSequenceRef.current === closePaneRequest.sequence) return;
    handledCloseSequenceRef.current = closePaneRequest.sequence;
    if (!findLeaf(tree, closePaneRequest.paneId)) return;
    close(closePaneRequest.paneId);
  }, [close, closePaneRequest, tree]);

  useEffect(() => {
    if (!restartPaneRequest) return;
    if (findLeaf(tree, restartPaneRequest.paneId)) return;
    if (handledRestartMissingSequenceRef.current === restartPaneRequest.sequence) return;
    handledRestartMissingSequenceRef.current = restartPaneRequest.sequence;
    restartPaneRequest.onComplete?.("Restart target was removed.");
  }, [restartPaneRequest, tree]);

  useEffect(() => {
    if (!attachPaneRequest) return;
    if (handledAttachSequenceRef.current === attachPaneRequest.sequence) return;
    handledAttachSequenceRef.current = attachPaneRequest.sequence;

    const leaf = findLeaf(tree, attachPaneRequest.paneId);
    if (!leaf) {
      attachPaneRequest.onComplete?.("Attach target was removed.");
      return;
    }
    if (terminalIds.has(attachPaneRequest.paneId)) {
      attachPaneRequest.onComplete?.("Attach target already has a terminal.");
      return;
    }

    let cancelled = false;
    import("@tauri-apps/api/core")
      .then(({ invoke }) => invoke<unknown>("list_terminals"))
      .then((payload) => {
        if (cancelled) return;
        const activeTerminalIds = new Set(parseTerminalIds(payload));
        if (!activeTerminalIds.has(attachPaneRequest.terminalId)) {
          attachPaneRequest.onComplete?.("Attach source is no longer active.");
          return;
        }
        registerTerminal(attachPaneRequest.paneId, attachPaneRequest.terminalId);
        setActivePaneId(attachPaneRequest.paneId);
        setPaneLifecycleStates((prev) => {
          const next = new Map(prev);
          next.set(attachPaneRequest.paneId, "live");
          return next;
        });
        setOrphanedBackendPanes((prev) => prev.filter((pane) => pane.terminalId !== attachPaneRequest.terminalId));
        attachPaneRequest.onComplete?.(null);
      })
      .catch((err) => {
        if (!cancelled) attachPaneRequest.onComplete?.(err instanceof Error ? err.message : String(err));
      });

    return () => {
      cancelled = true;
    };
  }, [attachPaneRequest, registerTerminal, setActivePaneId, terminalIds, tree]);

  useEffect(() => {
    if (!renamePaneRequest) return;
    if (handledRenameSequenceRef.current === renamePaneRequest.sequence) return;
    handledRenameSequenceRef.current = renamePaneRequest.sequence;
    if (!findLeaf(tree, renamePaneRequest.paneId)) return;
    renamePane(renamePaneRequest.paneId, renamePaneRequest.title);
  }, [renamePane, renamePaneRequest, tree]);

  useEffect(() => {
    if (!cyclePaneRoleRequest) return;
    if (handledRoleCycleSequenceRef.current === cyclePaneRoleRequest.sequence) return;
    handledRoleCycleSequenceRef.current = cyclePaneRoleRequest.sequence;
    if (!findLeaf(tree, cyclePaneRoleRequest.paneId)) return;
    cyclePaneRole(cyclePaneRoleRequest.paneId);
  }, [cyclePaneRole, cyclePaneRoleRequest, tree]);

  const backendPaneRouting = useMemo(() => collectBackendPaneRouting(tree), [tree]);
  const renamedBackendNames = useRef(new Map<string, string>());
  const syncedBackendRoles = useRef(new Map<string, string>());

  useEffect(() => {
    const liveTerminalIds = new Set(terminalIds.values());
    for (const terminalId of renamedBackendNames.current.keys()) {
      if (!liveTerminalIds.has(terminalId)) renamedBackendNames.current.delete(terminalId);
    }
    for (const terminalId of syncedBackendRoles.current.keys()) {
      if (!liveTerminalIds.has(terminalId)) syncedBackendRoles.current.delete(terminalId);
    }
    if (terminalIds.size === 0) return;

    import("@tauri-apps/api/core")
      .then(({ invoke }) => {
        for (const [paneId, terminalId] of terminalIds) {
          const route = backendPaneRouting.get(paneId);
          const name = route?.name ?? "";
          const lastName = renamedBackendNames.current.get(terminalId);
          if (lastName !== name && (name || lastName !== undefined)) {
            renamedBackendNames.current.set(terminalId, name);
            invoke("rename_pane", { terminalId, name }).catch(() => {
              renamedBackendNames.current.delete(terminalId);
            });
          }

          const role = route?.role ?? "";
          const lastRole = syncedBackendRoles.current.get(terminalId);
          if (lastRole !== role && (role || lastRole !== undefined)) {
            syncedBackendRoles.current.set(terminalId, role);
            invoke("set_pane_role", { terminalId, role }).catch(() => {
              syncedBackendRoles.current.delete(terminalId);
            });
          }
        }
      })
      .catch(() => {});
  }, [backendPaneRouting, terminalIds]);

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
      onRenamePane={renamePane}
      onCyclePaneRole={cyclePaneRole}
      onSetPaneRole={setPaneRole}
      onTerminalReady={registerTerminal}
      onPaneLifecycleChange={(paneId, lifecycle) => {
        setPaneLifecycleStates((prev) => {
          if (prev.get(paneId) === lifecycle) return prev;
          const next = new Map(prev);
          next.set(paneId, lifecycle);
          return next;
        });
      }}
      restartPaneRequest={restartPaneRequest}
      suspendTerminalMounts={layoutStorageKey ? !backendReconciled : false}
      canClose={canClose}
    />
  );
}

function collectBackendPaneRouting(
  tree: PaneNode,
  routes = new Map<string, { name: string; role: string }>(),
): Map<string, { name: string; role: string }> {
  if (tree.type === "terminal") {
    routes.set(tree.id, { name: tree.title ?? "", role: tree.role ?? "" });
    return routes;
  }
  collectBackendPaneRouting(tree.first, routes);
  collectBackendPaneRouting(tree.second, routes);
  return routes;
}

function reconcileHydratedLayoutWithBackend(
  tree: PaneNode,
  backendPanes: readonly BackendPaneInfo[],
  windowLabel: string,
  occupiedPaneIds: ReadonlySet<string> = new Set(),
  occupiedTerminalIds: ReadonlySet<string> = new Set(),
  backendBindings: Readonly<Record<string, PaneBackendBindingFingerprint>> = {},
): { attached: Array<{ paneId: string; terminalId: string }>; orphaned: PaneSwitcherEntry[] } {
  const matchedTerminalIds = new Set<string>(occupiedTerminalIds);
  const attached: Array<{ paneId: string; terminalId: string }> = [];
  for (const leaf of collectTerminalLeaves(tree)) {
    if (occupiedPaneIds.has(leaf.id)) continue;
    const fingerprint = backendBindings[leaf.id];
    const fingerprintMatch = fingerprint
      ? backendPanes.find(
          (pane) => !matchedTerminalIds.has(pane.terminal_id) && pane.terminal_id === fingerprint.terminalId,
        )
      : undefined;
    if (fingerprintMatch) {
      matchedTerminalIds.add(fingerprintMatch.terminal_id);
      attached.push({ paneId: leaf.id, terminalId: fingerprintMatch.terminal_id });
      continue;
    }

    const metadataMatches = backendPanes.filter(
      (pane) => !matchedTerminalIds.has(pane.terminal_id) && backendPaneMatchesLeaf(pane, leaf),
    );
    if (metadataMatches.length === 1) {
      matchedTerminalIds.add(metadataMatches[0].terminal_id);
      attached.push({ paneId: leaf.id, terminalId: metadataMatches[0].terminal_id });
    }
  }

  const orphaned = backendPanes
    .filter((pane) => !matchedTerminalIds.has(pane.terminal_id))
    .map((pane, offset): PaneSwitcherEntry => {
      const label = pane.name || (pane.role ? `@${pane.role}` : `${normalizeShellType(pane.shell_type)} orphan`);
      return {
        paneId: `orphan-${pane.terminal_id}`,
        terminalId: pane.terminal_id,
        lifecycle: "orphaned",
        index: collectLeafIds(tree).length + offset,
        shell: normalizeShellType(pane.shell_type),
        cwd: pane.cwd,
        title: pane.name || undefined,
        role: normalizeBackendRole(pane.role),
        label,
        route: `${windowLabel}.${collectLeafIds(tree).length + offset + 1} ${label}`,
      };
    });
  return { attached, orphaned };
}

function mergeBackendBindings(
  tree: PaneNode,
  previousBindings: Readonly<Record<string, PaneBackendBindingFingerprint>> | undefined,
  terminalIds: ReadonlyMap<string, string>,
): Record<string, PaneBackendBindingFingerprint> | undefined {
  const leafIds = new Set(collectLeafIds(tree));
  const next: Record<string, PaneBackendBindingFingerprint> = {};
  for (const paneId of leafIds) {
    const terminalId = terminalIds.get(paneId) ?? previousBindings?.[paneId]?.terminalId;
    if (terminalId) next[paneId] = { terminalId };
  }
  return Object.keys(next).length > 0 ? next : undefined;
}

function buildPaneSessionIntents(
  tree: PaneNode,
  terminalIds: ReadonlyMap<string, string>,
  lifecycles: ReadonlyMap<string, PaneLifecycleState>,
  backendBindings: Readonly<Record<string, PaneBackendBindingFingerprint>> | undefined,
  sessionId: string,
  layoutId: string,
  activePaneId: string | null,
): Record<string, PaneSessionIntent> | undefined {
  const intents: Record<string, PaneSessionIntent> = {};
  for (const leaf of collectTerminalLeaves(tree)) {
    const terminalId = terminalIds.get(leaf.id) ?? backendBindings?.[leaf.id]?.terminalId;
    const lifecycle = lifecycles.get(leaf.id) ?? (terminalId ? "live" : "detached");
    const intent: PaneSessionIntent = {
      paneId: leaf.id,
      sessionId,
      layoutId,
      ...(terminalId ? { terminalId } : {}),
      ...(leaf.cwd ? { cwd: leaf.cwd } : {}),
      ...(leaf.role ? { role: leaf.role } : {}),
      ...(leaf.title ? { name: leaf.title } : {}),
      attachState: paneAttachStateFromLifecycle(lifecycle, terminalId),
      health: paneHealthFromLifecycle(lifecycle),
      lifecycle,
      ...(activePaneId === leaf.id ? { lastActiveAt: new Date().toISOString() } : {}),
    };
    intents[leaf.id] = intent;
  }
  return Object.keys(intents).length > 0 ? intents : undefined;
}

function paneAttachStateFromLifecycle(lifecycle: PaneLifecycleState, terminalId: string | undefined) {
  if (lifecycle === "orphaned") return "orphaned";
  if (lifecycle === "restarting") return "restarting";
  if (lifecycle === "exited" || lifecycle === "crashed") return "ended";
  return terminalId && lifecycle === "live" ? "attached" : "detached";
}

function paneHealthFromLifecycle(lifecycle: PaneLifecycleState): PaneHealthState {
  if (lifecycle === "live") return "healthy";
  if (lifecycle === "crashed") return "crashed";
  if (lifecycle === "exited") return "exited";
  if (lifecycle === "starting" || lifecycle === "restarting") return "degraded";
  return "unknown";
}

function backendPaneMatchesLeaf(pane: BackendPaneInfo, leaf: Extract<PaneNode, { type: "terminal" }>): boolean {
  const paneName = normalizeComparable(pane.name);
  const paneRole = normalizeComparable(pane.role);
  return Boolean((leaf.title && paneName === normalizeComparable(leaf.title)) || (leaf.role && paneRole === leaf.role));
}

function collectTerminalLeaves(tree: PaneNode): Array<Extract<PaneNode, { type: "terminal" }>> {
  if (tree.type === "terminal") return [tree];
  return [...collectTerminalLeaves(tree.first), ...collectTerminalLeaves(tree.second)];
}

function parseBackendPaneInfo(payload: unknown): BackendPaneInfo[] {
  if (!Array.isArray(payload)) return [];
  const panes: BackendPaneInfo[] = [];
  for (const item of payload) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const terminalId = normalizeString(record.terminal_id);
    if (!terminalId) continue;
    panes.push({
      terminal_id: terminalId,
      name: normalizeString(record.name),
      role: normalizeString(record.role),
      shell_type: normalizeString(record.shell_type),
      cwd: normalizeString(record.cwd),
    });
  }
  return panes;
}

function parseTerminalIds(payload: unknown): string[] {
  return Array.isArray(payload) ? payload.map(normalizeString).filter(Boolean) : [];
}

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeComparable(value: string | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function normalizeShellType(value: string | undefined): ShellType {
  const normalized = normalizeComparable(value);
  if (normalized === "cmd" || normalized === "gitbash" || normalized === "wsl" || normalized === "powershell") {
    return normalized;
  }
  return "powershell";
}

function normalizeBackendRole(value: string | undefined) {
  const normalized = normalizeComparable(value);
  return normalized === "work" ||
    normalized === "plan" ||
    normalized === "build" ||
    normalized === "test" ||
    normalized === "review" ||
    normalized === "agent" ||
    normalized === "logs"
    ? normalized
    : undefined;
}
