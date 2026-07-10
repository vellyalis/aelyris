import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { reportFallback, reportInvokeFailure } from "../../../shared/lib/fallbackTelemetry";
import { isTauriRuntime } from "../../../shared/lib/tauriRuntime";
import type { ShellType } from "../../../shared/types/terminalPane";
import type { PaneSwitcherEntry } from "./operations";
import { collectLeafIds, collectLeaves, collectPaneSwitcherEntries, countLeaves, findLeaf } from "./operations";
import { PaneTreeRenderer } from "./PaneTreeRenderer";
import {
  loadPaneTreeSnapshot,
  loadPaneTreeSnapshotFromBackend,
  loadPaneTreeSnapshotFromMux,
  muxWorkspaceIdCandidates,
  type PaneBackendBindingFingerprint,
  type PaneTreeSnapshot,
  savePaneTreeSnapshot,
  savePaneTreeSnapshotToBackend,
} from "./persistence";
import {
  lifecycleFromPtyStreamState,
  type PtyStreamStateEvent,
  PaneHealthState,
  PaneLifecycleState,
  PaneNode,
  PaneSessionIntent,
  SplitDirection,
  VisibleAgentPaneBinding,
} from "./types";
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

export type PaneLayoutCommand =
  | "equalize"
  | "even-horizontal"
  | "even-vertical"
  | "tiled"
  | "move-next"
  | "move-previous"
  | "rotate-next"
  | "rotate-previous"
  | "sync-panes-on"
  | "sync-panes-off";

export interface PaneLayoutRequest {
  command: PaneLayoutCommand;
  sequence: number;
}

/**
 * Imperative bridge to mount autonomy-loop agents' already-spawned PTYs as real
 * split panes in this tab (1 pane = 1 agent). Each agent terminal is spawned
 * in-process by the loop with a live render bridge; here we split the active pane
 * and bind that terminal, so the operator watches it work in a genuine pane. The
 * full live set is carried (not one at a time) so a burst of dispatches is never
 * lost to render batching; already-mounted terminals are skipped.
 */
export interface PaneAgentSpawnRequest {
  agents: ReadonlyArray<{
    terminalId: string;
    model: string;
    taskId?: string;
    roleId?: string;
    backend?: VisibleAgentPaneBinding["backend"];
    durability?: VisibleAgentPaneBinding["durability"];
    branchName?: string;
    spawnedAt?: string;
  }>;
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
  /** Emits the current pane topology and PTY bindings for mux-style switchers. */
  onPaneRegistryChange?: (panes: PaneSwitcherEntry[]) => void;
  /** Human window label used by mux-style pane switcher routes. */
  switcherWindowLabel?: string;
  /** Imperative focus bridge used by global commands; never remounts terminals. */
  focusPaneRequest?: PaneFocusRequest | null;
  /** Imperative close bridge used by process/workstation management surfaces. */
  closePaneRequest?: PaneCloseRequest | null;
  /** Imperative restart bridge used by process/workstation management surfaces. */
  restartPaneRequest?: PaneRestartRequest | null;
  /** Imperative attach bridge used to bind a detached layout leaf to an existing backend PTY. */
  attachPaneRequest?: PaneAttachRequest | null;
  /** Imperative rename bridge used by mux-style management surfaces. */
  renamePaneRequest?: PaneRenameRequest | null;
  /** Imperative role-cycle bridge used by mux-style management surfaces. */
  cyclePaneRoleRequest?: PaneRoleCycleRequest | null;
  /** Imperative layout bridge used by mux-style layout and swap commands. */
  layoutRequest?: PaneLayoutRequest | null;
  /** Imperative bridge to mount a loop-dispatched agent's PTY as a split pane. */
  spawnAgentPaneRequest?: PaneAgentSpawnRequest | null;
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
  short_id?: number;
  name?: string;
  role?: string;
  shell_type?: string;
  cwd?: string;
}

/** Most recent finished agent panes kept on screen; older ones auto-close. */
const MAX_DONE_AGENT_PANES = 6;

function agentBindingsToMeta(bindings: ReadonlyMap<string, VisibleAgentPaneBinding>) {
  const meta = new Map<string, { model: string; status: "running" | "done" | "error" }>();
  for (const binding of bindings.values()) {
    meta.set(binding.terminalId, { model: binding.model, status: binding.status });
  }
  return meta;
}

function preserveSeedAgentBindings(
  primary: PaneTreeSnapshot | null,
  seed: PaneTreeSnapshot | null,
): PaneTreeSnapshot | null {
  if (!primary || primary.agentBindings || !seed?.agentBindings) return primary;
  const leafIds = new Set(collectLeafIds(primary.tree));
  const agentBindings = Object.fromEntries(
    Object.entries(seed.agentBindings).filter(([paneId]) => leafIds.has(paneId)),
  );
  return Object.keys(agentBindings).length > 0 ? { ...primary, agentBindings } : primary;
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
  layoutRequest,
  spawnAgentPaneRequest,
  layoutStorageKey,
  projectPath,
}: PaneTreeContainerProps) {
  const initialSnapshot = useMemo(
    () => (layoutStorageKey ? loadPaneTreeSnapshot(layoutStorageKey, shell, cwd) : null),
    [cwd, layoutStorageKey, shell],
  );
  const hasFastSnapshot = initialSnapshot !== null;
  const [layoutHydrated, setLayoutHydrated] = useState(() => !layoutStorageKey);
  const [paneLifecycleStates, setPaneLifecycleStates] = useState<ReadonlyMap<string, PaneLifecycleState>>(
    () => new Map(),
  );
  const [paneLifecycleAttempts, setPaneLifecycleAttempts] = useState<ReadonlyMap<string, number>>(() => new Map());
  const initialAgentBindings = useMemo(
    () => new Map(Object.entries(initialSnapshot?.agentBindings ?? {})),
    [initialSnapshot],
  );
  // Durable per-agent-pane contract (keyed by pane id == terminal id for loop
  // agents). This persists task/backend/durability so restored visible panes do
  // not become anonymous shells.
  const [agentBindings, setAgentBindings] = useState<ReadonlyMap<string, VisibleAgentPaneBinding>>(
    () => initialAgentBindings,
  );
  // Renderer-facing projection keyed by terminal id; kept separate so the UI
  // only consumes display identity while the persistence layer owns the contract.
  const [agentMeta, setAgentMeta] = useState<
    ReadonlyMap<string, { model: string; status: "running" | "done" | "error" }>
  >(() => agentBindingsToMeta(initialAgentBindings));
  const [synchronizedPanes, setSynchronizedPanes] = useState(() => initialSnapshot?.synchronizedPanes === true);
  const [orphanedBackendPanes, setOrphanedBackendPanes] = useState<PaneSwitcherEntry[]>([]);
  const [terminalShortIds, setTerminalShortIds] = useState<ReadonlyMap<string, number>>(() => new Map());
  const [backendReconciled, setBackendReconciled] = useState(() => !layoutStorageKey);
  const [backendRefreshNonce, setBackendRefreshNonce] = useState(0);
  const syncModeSequenceRef = useRef(0);
  const {
    tree,
    activePaneId,
    maximizedPaneId,
    terminalIds,
    setActivePaneId,
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
  } = usePaneTree({
    initialShell: shell,
    initialCwd: cwd,
    initialTree: initialSnapshot?.tree,
    initialActivePaneId: initialSnapshot?.activePaneId,
  });
  const backendBindingsRef = useRef<Record<string, PaneBackendBindingFingerprint> | undefined>(
    initialSnapshot?.backendBindings,
  );
  const workspaceTerminalIdRef = useRef<string | null>(
    initialSnapshot?.muxWorkspaceId ?? Object.values(initialSnapshot?.backendBindings ?? {})[0]?.terminalId ?? null,
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
  const flushPaneTreeSnapshot = useCallback(
    (pending: PendingBackendPaneTreeSnapshot, sequence: number) => {
      savePaneTreeSnapshot(pending.storageKey, pending.snapshot);
      flushBackendSnapshot(pending, sequence);
    },
    [flushBackendSnapshot],
  );

  useEffect(() => {
    if (!layoutStorageKey) return;
    let cancelled = false;
    setLayoutHydrated(false);
    setBackendReconciled(false);

    const applySnapshot = (snapshot: PaneTreeSnapshot | null, shouldReplace: boolean) => {
      if (!snapshot) return;
      backendBindingsRef.current = snapshot.backendBindings ?? {};
      workspaceTerminalIdRef.current =
        snapshot.muxWorkspaceId ?? Object.values(snapshot.backendBindings ?? {})[0]?.terminalId ?? null;
      const restoredAgentBindings = new Map(Object.entries(snapshot.agentBindings ?? {}));
      setAgentBindings(restoredAgentBindings);
      setAgentMeta(agentBindingsToMeta(restoredAgentBindings));
      setSynchronizedPanes(snapshot.synchronizedPanes === true);
      if (shouldReplace) replaceTree(snapshot.tree, snapshot.activePaneId);
    };

    const load = async () => {
      const backendSnapshot = hasFastSnapshot
        ? null
        : await loadPaneTreeSnapshotFromBackend(layoutStorageKey, shell, cwd);
      const seedSnapshot = initialSnapshot ?? backendSnapshot;
      let muxSnapshot: PaneTreeSnapshot | null = null;
      for (const workspaceId of muxWorkspaceIdCandidates(seedSnapshot, layoutStorageKey)) {
        muxSnapshot = await loadPaneTreeSnapshotFromMux(workspaceId, shell, cwd);
        if (muxSnapshot) break;
      }
      if (cancelled) return;
      const nextSnapshot = preserveSeedAgentBindings(muxSnapshot, seedSnapshot) ?? seedSnapshot;
      applySnapshot(nextSnapshot, nextSnapshot !== initialSnapshot);
      setLayoutHydrated(true);
    };

    void load().catch(() => {
      if (!cancelled) setLayoutHydrated(true);
    });
    return () => {
      cancelled = true;
    };
  }, [cwd, hasFastSnapshot, initialSnapshot, layoutStorageKey, replaceTree, shell]);

  useEffect(() => {
    void backendRefreshNonce;
    if (!layoutStorageKey || !layoutHydrated) {
      if (!layoutStorageKey) setBackendReconciled(true);
      return;
    }
    if (!isTauriRuntime()) {
      setBackendReconciled(true);
      return;
    }
    let cancelled = false;
    if (terminalIds.size === 0) setBackendReconciled(false);
    Promise.resolve({ invoke })
      .then(async ({ invoke }) => {
        const listTerminalIds = async (operation: string): Promise<string[]> => {
          try {
            return parseTerminalIds(await invoke<unknown>("list_terminals"));
          } catch (err) {
            reportInvokeFailure({
              source: "pane-metadata",
              operation,
              err,
              userVisible: true,
            });
            return [];
          }
        };
        const backendPanes = await invoke<unknown>("list_panes_info")
          .then(parseBackendPaneInfo)
          .catch(async (err) => {
            reportInvokeFailure({
              source: "pane-metadata",
              operation: "list_panes_info",
              err,
              userVisible: true,
            });
            const activeTerminalIds = await listTerminalIds("list_terminals_after_list_panes_info_failed");
            return activeTerminalIds.map((terminalId) => ({ terminal_id: terminalId }));
          });
        if (backendPanes.length > 0) return backendPanes;
        const activeTerminalIds = await listTerminalIds("list_terminals_after_empty_panes");
        return activeTerminalIds.map((terminalId) => ({ terminal_id: terminalId }));
      })
      .then((backendPanes) => {
        if (cancelled) return;
        setTerminalShortIds((prev) => {
          const next = shortIdsFromBackendPanes(backendPanes);
          return numberMapEqual(prev, next) ? prev : next;
        });
        if (backendPanes.length === 0) {
          setOrphanedBackendPanes([]);
          // Loop agent panes are in-process terminals, absent from the sidecar's
          // pane list — never reconcile them as dead.
          const endedPaneIds = Array.from(terminalIds.keys()).filter((paneId) => !agentPaneIdsRef.current.has(paneId));
          setPaneLifecycleStates((prev) => {
            if (terminalIds.size === 0) return prev;
            let changed = false;
            const next = new Map(prev);
            for (const paneId of terminalIds.keys()) {
              if (agentPaneIdsRef.current.has(paneId)) continue;
              const current = next.get(paneId);
              if (current && current !== "layout-only" && current !== "detached" && current !== "live") continue;
              next.set(paneId, "exited");
              changed = true;
            }
            return changed ? next : prev;
          });
          endedPaneIds.forEach(unregisterTerminal);
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
        const endedPaneIds = restoredPaneIds.filter((paneId) => {
          // Loop agent panes are in-process terminals, absent from the sidecar's
          // pane list — never reconcile them as dead.
          if (agentPaneIdsRef.current.has(paneId)) return false;
          const terminalId = terminalIds.get(paneId);
          return Boolean(terminalId && !backendTerminalIds.has(terminalId));
        });
        setPaneLifecycleStates((prev) => {
          let changed = false;
          const next = new Map(prev);
          const attachedPaneIds = new Set(reconciliation.attached.map((attached) => attached.paneId));
          for (const paneId of restoredPaneIds) {
            if (agentPaneIdsRef.current.has(paneId)) continue;
            const current = next.get(paneId);
            const terminalId = terminalIds.get(paneId);
            const lifecycle = terminalId
              ? backendTerminalIds.has(terminalId)
                ? "live"
                : "exited"
              : attachedPaneIds.has(paneId)
                ? "live"
                : "detached";
            if (current && current !== "layout-only" && current !== "detached" && current !== "live") {
              continue;
            }
            if (current !== lifecycle) {
              next.set(paneId, lifecycle);
              changed = true;
            }
          }
          return changed ? next : prev;
        });
        endedPaneIds.forEach(unregisterTerminal);
        setOrphanedBackendPanes(reconciliation.orphaned);
        setBackendReconciled(true);
      })
      .catch(() => {
        if (!cancelled) setBackendReconciled(true);
      });
    return () => {
      cancelled = true;
    };
  }, [
    backendRefreshNonce,
    layoutHydrated,
    layoutStorageKey,
    registerTerminal,
    switcherWindowLabel,
    terminalIds,
    tree,
    unregisterTerminal,
  ]);

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
    if (!isTauriRuntime() || terminalIds.size === 0) return;
    let cancelled = false;
    const unlisteners: Array<() => void> = [];
    for (const [paneId, terminalId] of terminalIds) {
      void Promise.resolve()
        .then(() =>
          listen<PtyStreamStateEvent>(`pty-stream-state-${terminalId}`, ({ payload }) => {
            const lifecycle = lifecycleFromPtyStreamState(payload.state);
            setPaneLifecycleStates((prev) => new Map(prev).set(paneId, lifecycle).set(terminalId, lifecycle));
            setPaneLifecycleAttempts((prev) => {
              const next = new Map(prev);
              if (payload.state === "reconnecting") {
                next.set(paneId, payload.attempt).set(terminalId, payload.attempt);
              } else {
                next.delete(paneId);
                next.delete(terminalId);
              }
              return next;
            });
          }),
        )
        .then((unlisten) => {
          if (cancelled) unlisten();
          else unlisteners.push(unlisten);
        })
        .catch(() => {
          /* Tauri event bridge unavailable; backend reconciliation remains authoritative. */
        });
    }
    return () => {
      cancelled = true;
      for (const unlisten of unlisteners) unlisten();
    };
  }, [terminalIds]);

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
    const muxWorkspaceId = workspaceTerminalIdRef.current ?? Object.values(backendBindings ?? {})[0]?.terminalId;
    const paneIntents = buildPaneSessionIntents(
      tree,
      terminalIds,
      paneLifecycleStates,
      backendBindings,
      sessionId,
      layoutId,
      activePaneId,
    );
    const leafIds = new Set(collectLeafIds(tree));
    const persistedAgentBindings = Object.fromEntries(
      Array.from(agentBindings.entries()).filter(([paneId, binding]) => leafIds.has(paneId) && binding.terminalId),
    );
    const snapshot = {
      tree,
      activePaneId,
      sessionId,
      layoutId,
      muxWorkspaceId,
      synchronizedPanes,
      backendBindings,
      paneIntents,
      agentBindings: Object.keys(persistedAgentBindings).length > 0 ? persistedAgentBindings : undefined,
    };
    const pending = {
      storageKey: layoutStorageKey,
      snapshot,
      projectPath: projectPath ?? cwd ?? "",
    };
    const sequence = backendSaveSequenceRef.current + 1;
    backendSaveSequenceRef.current = sequence;
    pendingBackendSnapshotRef.current = pending;
    const timer = window.setTimeout(() => {
      flushPaneTreeSnapshot(pending, sequence);
    }, 180);
    return () => window.clearTimeout(timer);
  }, [
    activePaneId,
    agentBindings,
    cwd,
    flushPaneTreeSnapshot,
    layoutHydrated,
    layoutStorageKey,
    paneLifecycleStates,
    projectPath,
    synchronizedPanes,
    terminalIds,
    tree,
  ]);

  useEffect(() => {
    return () => {
      const pending = pendingBackendSnapshotRef.current;
      if (!pending) return;
      flushPaneTreeSnapshot(pending, backendSaveSequenceRef.current);
    };
  }, [flushPaneTreeSnapshot]);

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

  const paneRegistry = useMemo(() => {
    const frontendPanes = collectPaneSwitcherEntries(tree, terminalIds, switcherWindowLabel, paneLifecycleStates).map(
      (pane) => {
        const shortId = pane.terminalId ? terminalShortIds.get(pane.terminalId) : undefined;
        return shortId ? { ...pane, shortId } : pane;
      },
    );
    return [...frontendPanes, ...orphanedBackendPanes];
  }, [orphanedBackendPanes, paneLifecycleStates, switcherWindowLabel, terminalIds, terminalShortIds, tree]);
  useEffect(() => {
    onPaneRegistryChangeRef.current?.(paneRegistry);
  }, [paneRegistry]);

  const handledFocusSequenceRef = useRef<number | null>(null);
  const handledCloseSequenceRef = useRef<number | null>(null);
  const handledRestartMissingSequenceRef = useRef<number | null>(null);
  const handledAttachSequenceRef = useRef<number | null>(null);
  const handledRenameSequenceRef = useRef<number | null>(null);
  const handledRoleCycleSequenceRef = useRef<number | null>(null);
  const handledLayoutSequenceRef = useRef<number | null>(null);
  const handledAgentSpawnSequenceRef = useRef<number | null>(null);
  // PaneIds (== terminalIds) of loop-dispatched agent panes. Tracked so backend
  // reconciliation does not mistake them for dead (they are in-process terminals,
  // not in the sidecar's pane list) and so we can close them when they exit.
  const agentPaneIdsRef = useRef<Set<string>>(new Set());
  // TerminalIds ever mounted as an agent pane — never cleared, so a pane that
  // exited and closed is not re-mounted when the (cumulative) request re-renders.
  const everMountedAgentsRef = useRef<Set<string>>(new Set());
  const agentPaneUnlistenRef = useRef<Map<string, () => void>>(new Map());
  // FIFO of finished ("done") agent panes, kept on screen for review. Bounded so
  // the kept-on-exit fleet panes can't accumulate without limit across many
  // dispatch rounds (memory/DOM/render-cost leak) — the oldest is closed when the
  // cap is exceeded. `everMountedAgentsRef` still bars re-mounting a closed agent.
  const doneAgentOrderRef = useRef<string[]>([]);
  // Agent-pane exit listeners are registered ONCE per agent and never re-registered
  // (already-mounted agents are skipped on later dispatch rounds). `close` is
  // `useCallback([tree])`, so a listener that captured an early `close` would compute
  // `shouldClosePty` from a STALE `tree` snapshot when it later evicts a done pane —
  // leaking that pane's `terminalIds` entry. Route eviction through a ref kept at the
  // latest `close` so the listener always sees the live tree.
  const closeRef = useRef(close);
  useEffect(() => {
    closeRef.current = close;
  }, [close]);

  useEffect(() => {
    for (const binding of agentBindings.values()) {
      everMountedAgentsRef.current.add(binding.terminalId);
      if (binding.status === "running" && terminalIds.get(binding.paneId) === binding.terminalId) {
        agentPaneIdsRef.current.add(binding.terminalId);
      } else if (binding.status !== "running") {
        agentPaneIdsRef.current.delete(binding.terminalId);
      }
    }
  }, [agentBindings, terminalIds]);

  useEffect(() => {
    if (!layoutStorageKey || !backendReconciled || agentBindings.size === 0) return;
    const missingRestoredAgents = Array.from(agentBindings.values()).filter(
      (binding) =>
        binding.status === "running" &&
        !terminalIds.has(binding.paneId) &&
        !agentPaneIdsRef.current.has(binding.terminalId),
    );
    if (missingRestoredAgents.length === 0) return;
    const now = new Date().toISOString();
    setPaneLifecycleStates((prev) => {
      const next = new Map(prev);
      for (const binding of missingRestoredAgents) next.set(binding.paneId, "exited");
      return next;
    });
    setAgentBindings((prev) => {
      const next = new Map(prev);
      let changed = false;
      for (const binding of missingRestoredAgents) {
        const current = next.get(binding.paneId);
        if (!current || current.status !== "running") continue;
        next.set(binding.paneId, { ...current, status: "error", updatedAt: now });
        changed = true;
      }
      return changed ? next : prev;
    });
    setAgentMeta((prev) => {
      const next = new Map(prev);
      let changed = false;
      for (const binding of missingRestoredAgents) {
        const current = next.get(binding.terminalId);
        if (!current || current.status !== "running") continue;
        next.set(binding.terminalId, { ...current, status: "error" });
        changed = true;
      }
      return changed ? next : prev;
    });
  }, [agentBindings, backendReconciled, layoutStorageKey, terminalIds]);

  const firstLiveTerminalId = useMemo(() => {
    for (const paneId of collectLeafIds(tree)) {
      const terminalId = terminalIds.get(paneId);
      if (terminalId) return terminalId;
    }
    return null;
  }, [terminalIds, tree]);

  useEffect(() => {
    if (!workspaceTerminalIdRef.current && firstLiveTerminalId) {
      workspaceTerminalIdRef.current = firstLiveTerminalId;
    }
  }, [firstLiveTerminalId]);

  const splitViaMux = useCallback(
    (targetId: string, direction: SplitDirection) => {
      const targetLeaf = findLeaf(tree, targetId);
      const targetTerminalId = terminalIds.get(targetId);
      const workspaceId = workspaceTerminalIdRef.current ?? firstLiveTerminalId ?? targetTerminalId;
      if (!targetLeaf) return;
      if (!targetTerminalId || !workspaceId) {
        reportFallback({
          source: "pane-mux",
          operation: "mux_split_pane",
          severity: "warning",
          message: "mux split unavailable; local split recovery mounted a new pane",
          userVisible: true,
        });
        console.warn("mux split unavailable; applying local split recovery", {
          targetId,
          direction,
          hasTargetTerminalId: Boolean(targetTerminalId),
          hasWorkspaceId: Boolean(workspaceId),
        });
        splitWithContext(targetId, direction, targetLeaf.shell, targetLeaf.cwd ?? cwd);
        return;
      }

      const axis = direction === "left" || direction === "right" ? "horizontal" : "vertical";
      const invokeMuxSplit = (candidateWorkspaceId: string) =>
        invoke<string>("mux_split_pane", {
          workspaceId: candidateWorkspaceId,
          targetPaneId: targetTerminalId,
          axis,
          shell: targetLeaf.shell,
          cwd: targetLeaf.cwd ?? cwd,
          cols: 80,
          rows: 24,
        });
      const attachMuxPane = (terminalId: string, boundWorkspaceId: string) => {
        workspaceTerminalIdRef.current = boundWorkspaceId;
        splitWithExistingTerminal(targetId, direction, terminalId, targetLeaf.shell, targetLeaf.cwd ?? cwd);
        setPaneLifecycleStates((prev) => {
          const next = new Map(prev);
          next.set(terminalId, "live");
          return next;
        });
      };

      invokeMuxSplit(workspaceId)
        .then((terminalId) => {
          attachMuxPane(terminalId, workspaceId);
        })
        .catch((err) => {
          const retryWorkspaceId =
            firstLiveTerminalId && firstLiveTerminalId !== workspaceId ? firstLiveTerminalId : null;
          if (retryWorkspaceId) {
            console.warn("mux split failed; retrying with live workspace", {
              workspaceId,
              retryWorkspaceId,
              err,
            });
            invokeMuxSplit(retryWorkspaceId)
              .then((terminalId) => {
                attachMuxPane(terminalId, retryWorkspaceId);
              })
              .catch((retryErr) => {
                reportInvokeFailure({
                  source: "pane-mux",
                  operation: "mux_split_pane",
                  err: retryErr,
                  severity: "error",
                  userVisible: true,
                });
                console.warn("mux split failed after live workspace retry", retryErr);
                splitWithContext(targetId, direction, targetLeaf.shell, targetLeaf.cwd ?? cwd);
              });
            return;
          }
          reportInvokeFailure({
            source: "pane-mux",
            operation: "mux_split_pane",
            err,
            severity: "error",
            userVisible: true,
          });
          console.warn("mux split failed", err);
          splitWithContext(targetId, direction, targetLeaf.shell, targetLeaf.cwd ?? cwd);
        });
    },
    [cwd, firstLiveTerminalId, splitWithContext, splitWithExistingTerminal, terminalIds, tree],
  );

  const closeViaMux = useCallback(
    (paneId: string) => {
      const terminalId = terminalIds.get(paneId);
      const workspaceId = workspaceTerminalIdRef.current ?? firstLiveTerminalId;
      if (!terminalId || !workspaceId) {
        reportFallback({
          source: "pane-mux",
          operation: "mux_close_pane",
          severity: "warning",
          message: "mux close unavailable; closing local pane binding only",
          userVisible: true,
        });
        close(paneId);
        return;
      }

      const invokeMuxClose = (candidateWorkspaceId: string) =>
        invoke("mux_close_pane", { workspaceId: candidateWorkspaceId, paneId: terminalId });
      const detachMuxPane = (boundWorkspaceId: string) => {
        workspaceTerminalIdRef.current = boundWorkspaceId;
        close(paneId, { closeBackend: false });
      };

      invokeMuxClose(workspaceId)
        .then(() => {
          detachMuxPane(workspaceId);
        })
        .catch((err) => {
          const retryWorkspaceId =
            firstLiveTerminalId && firstLiveTerminalId !== workspaceId ? firstLiveTerminalId : null;
          if (retryWorkspaceId) {
            console.warn("mux pane close failed; retrying with live workspace", {
              workspaceId,
              retryWorkspaceId,
              err,
            });
            invokeMuxClose(retryWorkspaceId)
              .then(() => {
                detachMuxPane(retryWorkspaceId);
              })
              .catch((retryErr) => {
                reportInvokeFailure({
                  source: "pane-mux",
                  operation: "mux_close_pane",
                  err: retryErr,
                  severity: "error",
                  userVisible: true,
                });
                console.warn("mux pane close failed after live workspace retry", retryErr);
                close(paneId);
              });
            return;
          }
          reportInvokeFailure({
            source: "pane-mux",
            operation: "mux_close_pane",
            err,
            severity: "error",
            userVisible: true,
          });
          console.warn("mux pane close failed", err);
          close(paneId);
        });
    },
    [close, firstLiveTerminalId, terminalIds],
  );

  const applyLocalLayoutCommand = useCallback(
    (command: PaneLayoutCommand) => {
      switch (command) {
        case "equalize":
          equalize();
          break;
        case "even-horizontal":
          rebalance("horizontal");
          break;
        case "even-vertical":
          rebalance("vertical");
          break;
        case "tiled":
          rebalance("tiled");
          break;
        case "move-next":
          moveActive(1);
          break;
        case "move-previous":
          moveActive(-1);
          break;
        case "rotate-next":
          rotatePanes(1);
          break;
        case "rotate-previous":
          rotatePanes(-1);
          break;
        case "sync-panes-on":
        case "sync-panes-off":
          break;
      }
    },
    [equalize, moveActive, rebalance, rotatePanes],
  );

  const applyLayoutViaMux = useCallback(
    (command: PaneLayoutCommand) => {
      const workspaceId = workspaceTerminalIdRef.current ?? firstLiveTerminalId;
      if (command === "sync-panes-on" || command === "sync-panes-off") {
        if (!workspaceId) return;
        const enabled = command === "sync-panes-on";
        const sequence = syncModeSequenceRef.current + 1;
        syncModeSequenceRef.current = sequence;
        setSynchronizedPanes(enabled);
        invoke("mux_set_panes_synchronized", {
          workspaceId,
          enabled,
        }).catch((err) => {
          if (syncModeSequenceRef.current === sequence) setSynchronizedPanes(!enabled);
          reportInvokeFailure({
            source: "pane-mux",
            operation: "mux_set_panes_synchronized",
            err,
            severity: "error",
            userVisible: true,
          });
          console.warn("mux synchronized panes failed", err);
        });
        return;
      }

      if (!workspaceId || terminalIds.size === 0) {
        reportFallback({
          source: "pane-mux",
          operation: "mux_apply_layout",
          severity: "warning",
          message: "mux layout unavailable; applying local layout recovery",
          userVisible: true,
        });
        applyLocalLayoutCommand(command);
        return;
      }

      if (command === "move-next" || command === "move-previous") {
        if (!activePaneId) return;
        const leaves = collectLeaves(tree);
        if (leaves.length <= 1) return;
        const currentIndex = leaves.findIndex((leaf) => leaf.id === activePaneId);
        if (currentIndex < 0) return;
        const delta = command === "move-next" ? 1 : -1;
        const targetPaneId = leaves[(currentIndex + delta + leaves.length) % leaves.length]?.id;
        const firstPaneId = terminalIds.get(activePaneId);
        const secondPaneId = targetPaneId ? terminalIds.get(targetPaneId) : undefined;
        if (!firstPaneId || !secondPaneId) {
          reportFallback({
            source: "pane-mux",
            operation: "mux_swap_panes",
            severity: "warning",
            message: "mux swap skipped because pane PTY binding is missing",
            userVisible: true,
          });
          console.warn("mux swap skipped because pane PTY binding is missing", { activePaneId, targetPaneId });
          return;
        }
        invoke("mux_swap_panes", { workspaceId, firstPaneId, secondPaneId })
          .then(() => applyLocalLayoutCommand(command))
          .catch((err) => {
            reportInvokeFailure({
              source: "pane-mux",
              operation: "mux_swap_panes",
              err,
              severity: "error",
              userVisible: true,
            });
            console.warn("mux swap failed", err);
          });
        return;
      }

      invoke("mux_apply_layout", { workspaceId, command })
        .then(() => applyLocalLayoutCommand(command))
        .catch((err) => {
          reportInvokeFailure({
            source: "pane-mux",
            operation: "mux_apply_layout",
            err,
            severity: "error",
            userVisible: true,
          });
          console.warn("mux layout failed", err);
        });
    },
    [activePaneId, applyLocalLayoutCommand, firstLiveTerminalId, terminalIds, tree],
  );

  const toggleMaximizeViaMux = useCallback(
    (paneId: string) => {
      const workspaceId = workspaceTerminalIdRef.current ?? firstLiveTerminalId;
      const backendPaneId = terminalIds.get(paneId);
      if (!workspaceId || !backendPaneId) {
        reportFallback({
          source: "pane-mux",
          operation: "mux_set_pane_zoom",
          severity: "warning",
          message: "mux zoom unavailable; toggling local maximize only",
          userVisible: true,
        });
        toggleMaximize(paneId);
        return;
      }
      const zoomed = maximizedPaneId !== paneId;
      invoke("mux_set_pane_zoom", { workspaceId, paneId: backendPaneId, zoomed })
        .then(() => toggleMaximize(paneId))
        .catch((err) => {
          reportInvokeFailure({
            source: "pane-mux",
            operation: "mux_set_pane_zoom",
            err,
            severity: "error",
            userVisible: true,
          });
          console.warn("mux pane zoom failed", err);
        });
    },
    [firstLiveTerminalId, maximizedPaneId, terminalIds, toggleMaximize],
  );

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
    closeViaMux(closePaneRequest.paneId);
  }, [closePaneRequest, closeViaMux, tree]);

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
    Promise.resolve({ invoke })
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

  useEffect(() => {
    if (!layoutRequest) return;
    if (handledLayoutSequenceRef.current === layoutRequest.sequence) return;
    handledLayoutSequenceRef.current = layoutRequest.sequence;
    applyLayoutViaMux(layoutRequest.command);
  }, [applyLayoutViaMux, layoutRequest]);

  // Mount loop-dispatched agents' PTYs as real split panes: split the active
  // pane and BIND each existing agent terminal (no new shell), so the operator
  // watches the agents work in genuine, resizable panes. Tiles the layout so
  // accumulating agents fill the tab. Each pane closes when its agent exits.
  useEffect(() => {
    if (!spawnAgentPaneRequest) return;
    if (handledAgentSpawnSequenceRef.current === spawnAgentPaneRequest.sequence) return;
    handledAgentSpawnSequenceRef.current = spawnAgentPaneRequest.sequence;

    let mountedAny = false;
    for (const agent of spawnAgentPaneRequest.agents) {
      const { terminalId, model, taskId, roleId, branchName } = agent;
      if (everMountedAgentsRef.current.has(terminalId) || collectLeafIds(tree).includes(terminalId)) continue;
      const targetId = activePaneId && findLeaf(tree, activePaneId) ? activePaneId : collectLeafIds(tree)[0];
      if (!targetId) break;
      const targetLeaf = findLeaf(tree, targetId);
      const direction: SplitDirection = agentPaneIdsRef.current.size % 2 === 0 ? "right" : "down";
      splitWithExistingTerminal(targetId, direction, terminalId, targetLeaf?.shell ?? shell, targetLeaf?.cwd ?? cwd);
      const backend = agent.backend ?? "native";
      const durability = agent.durability ?? (backend === "sidecar" ? "tmux-durable" : "degraded");
      const bindingCwd = targetLeaf?.cwd ?? cwd;
      const binding: VisibleAgentPaneBinding = {
        paneId: terminalId,
        terminalId,
        model,
        backend,
        durability,
        status: "running",
        ...(taskId ? { taskId } : {}),
        ...(roleId ? { roleId } : {}),
        ...(bindingCwd ? { cwd: bindingCwd } : {}),
        ...(branchName ? { branchName } : {}),
        spawnedAt: agent.spawnedAt ?? new Date().toISOString(),
      };
      agentPaneIdsRef.current.add(terminalId);
      everMountedAgentsRef.current.add(terminalId);
      setPaneLifecycleStates((prev) => new Map(prev).set(terminalId, "live"));
      setAgentMeta((prev) => new Map(prev).set(terminalId, { model, status: "running" }));
      setAgentBindings((prev) => new Map(prev).set(terminalId, binding));
      mountedAny = true;

      if (isTauriRuntime()) {
        const id = terminalId;
        void listen(`pty-exit-${id}`, () => {
          const unlisten = agentPaneUnlistenRef.current.get(id);
          unlisten?.();
          agentPaneUnlistenRef.current.delete(id);
          // KEEP the pane: mark the agent done so its final claude output stays on
          // screen for review. The fleet persists instead of vanishing the instant
          // each agent finishes — the visible-fleet experience (PaneTreeRenderer
          // keeps the terminal buffer mounted for agent panes even once exited).
          setAgentMeta((prev) => {
            const meta = prev.get(id);
            if (!meta) return prev;
            return new Map(prev).set(id, { ...meta, status: "done" });
          });
          setAgentBindings((prev) => {
            const current = prev.get(id);
            if (!current) return prev;
            return new Map(prev).set(id, { ...current, status: "done", updatedAt: new Date().toISOString() });
          });
          // Bound the kept "done" panes: close the oldest once over the cap so
          // they cannot accumulate without limit across many dispatch rounds.
          agentPaneIdsRef.current.delete(id);
          doneAgentOrderRef.current.push(id);
          while (doneAgentOrderRef.current.length > MAX_DONE_AGENT_PANES) {
            const evict = doneAgentOrderRef.current.shift();
            if (!evict) break;
            setAgentMeta((prev) => {
              if (!prev.has(evict)) return prev;
              const next = new Map(prev);
              next.delete(evict);
              return next;
            });
            setAgentBindings((prev) => {
              if (!prev.has(evict)) return prev;
              const next = new Map(prev);
              next.delete(evict);
              return next;
            });
            closeRef.current(evict, { closeBackend: false });
          }
        })
          .then((unlisten) => {
            agentPaneUnlistenRef.current.set(id, unlisten);
          })
          .catch(() => {
            /* backend unreachable — the pane stays until manually closed */
          });
      }
    }
    if (mountedAny) rebalance("tiled");
    // `close` is intentionally not a dep: the exit listener reaches it via `closeRef`
    // (kept current by its own effect), so this effect need not re-run when `close`
    // changes identity — re-running would only risk re-mounting churn.
  }, [spawnAgentPaneRequest, activePaneId, tree, splitWithExistingTerminal, rebalance, shell, cwd]);

  // Detach agent-pane exit listeners on unmount.
  useEffect(() => {
    const listeners = agentPaneUnlistenRef.current;
    return () => {
      for (const unlisten of listeners.values()) unlisten();
      listeners.clear();
    };
  }, []);

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
    if (terminalIds.size === 0 || !isTauriRuntime()) return;

    Promise.resolve({ invoke })
      .then(({ invoke }) => {
        for (const [paneId, terminalId] of terminalIds) {
          const route = backendPaneRouting.get(paneId);
          const name = route?.name ?? "";
          const lastName = renamedBackendNames.current.get(terminalId);
          if (lastName !== name && (name || lastName !== undefined)) {
            renamedBackendNames.current.set(terminalId, name);
            invoke("rename_pane", { terminalId, name }).catch((err) => {
              renamedBackendNames.current.delete(terminalId);
              reportInvokeFailure({
                source: "pane-metadata",
                operation: "rename_pane",
                err,
                severity: "warning",
                userVisible: true,
              });
            });
          }

          const role = route?.role ?? "";
          const lastRole = syncedBackendRoles.current.get(terminalId);
          if (lastRole !== role && (role || lastRole !== undefined)) {
            syncedBackendRoles.current.set(terminalId, role);
            invoke("set_pane_role", { terminalId, role }).catch((err) => {
              syncedBackendRoles.current.delete(terminalId);
              reportInvokeFailure({
                source: "pane-metadata",
                operation: "set_pane_role",
                err,
                severity: "warning",
                userVisible: true,
              });
            });
          }
        }
      })
      .catch((err) => {
        reportInvokeFailure({
          source: "pane-metadata",
          operation: "load_tauri_core",
          err,
          severity: "warning",
          userVisible: true,
        });
      });
  }, [backendPaneRouting, terminalIds]);

  const canClose = countLeaves(tree) > 1;

  return (
    <PaneTreeRenderer
      tree={tree}
      activePaneId={activePaneId}
      maximizedPaneId={maximizedPaneId}
      terminalIds={terminalIds}
      paneLifecycleStates={paneLifecycleStates}
      paneLifecycleAttempts={paneLifecycleAttempts}
      agentMeta={agentMeta}
      terminalShortIds={terminalShortIds}
      synchronizedPanes={synchronizedPanes}
      onFocusPane={setActivePaneId}
      onSplit={splitViaMux}
      onClose={closeViaMux}
      onResize={resize}
      onLayoutCommand={applyLayoutViaMux}
      onToggleMaximize={toggleMaximizeViaMux}
      onRenamePane={renamePane}
      onCyclePaneRole={cyclePaneRole}
      onSetPaneRole={setPaneRole}
      onTerminalReady={registerTerminal}
      onPaneLifecycleChange={(paneId, lifecycle) => {
        const previousLifecycle = paneLifecycleStates.get(paneId);
        const restartingEndedPane =
          (lifecycle === "starting" || lifecycle === "restarting") &&
          (previousLifecycle === "detached" || previousLifecycle === "exited" || previousLifecycle === "crashed");
        if (lifecycle === "exited" || lifecycle === "detached" || restartingEndedPane) {
          unregisterTerminal(paneId);
        }
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
        shortId: pane.short_id,
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
      short_id: normalizePositiveInteger(record.short_id),
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

function normalizePositiveInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}

function shortIdsFromBackendPanes(panes: readonly BackendPaneInfo[]): ReadonlyMap<string, number> {
  const next = new Map<string, number>();
  for (const pane of panes) {
    if (pane.short_id) next.set(pane.terminal_id, pane.short_id);
  }
  return next;
}

function numberMapEqual(left: ReadonlyMap<string, number>, right: ReadonlyMap<string, number>): boolean {
  if (left.size !== right.size) return false;
  for (const [key, value] of left) {
    if (right.get(key) !== value) return false;
  }
  return true;
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
