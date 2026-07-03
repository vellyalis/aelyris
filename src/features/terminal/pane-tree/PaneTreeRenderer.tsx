import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAppStore } from "../../../shared/store/appStore";
import { SplitPane } from "../../../shared/ui/SplitPane";
import { TERMINAL_PREFIX_COMMAND_EVENT } from "../hooks/useCanvasIME";
import { NativeTerminalArea } from "../NativeTerminalArea";
import { TerminalInfoBar } from "../TerminalInfoBar";
import { snapTerminalCssPixel } from "../terminalMetrics";
import type { PaneRestartRequest } from "./PaneTreeContainer";
import styles from "./PaneTreeRenderer.module.css";
import type { PaneLifecycleState, PaneNode, PaneRole, SplitDirection } from "./types";

interface PaneTreeRendererProps {
  tree: PaneNode;
  activePaneId: string | null;
  maximizedPaneId: string | null;
  /**
   * paneId → PTY terminalId. `undefined` until the terminal finishes
   * spawning; consumers must gracefully fall back while it is absent.
   */
  terminalIds: Map<string, string>;
  paneLifecycleStates?: ReadonlyMap<string, PaneLifecycleState>;
  /** terminalId → live agent identity for fleet panes (drives the agent chip). */
  agentMeta?: ReadonlyMap<string, { model: string; status: "running" | "done" | "error" }>;
  synchronizedPanes?: boolean;
  onFocusPane: (id: string) => void;
  onSplit: (id: string, direction: SplitDirection) => void;
  onClose: (id: string) => void;
  onResize: (splitId: string, ratio: number) => void;
  onLayoutCommand?: (
    command:
      | "equalize"
      | "even-horizontal"
      | "even-vertical"
      | "tiled"
      | "move-next"
      | "move-previous"
      | "rotate-next"
      | "rotate-previous"
      | "sync-panes-on"
      | "sync-panes-off",
  ) => void;
  onToggleMaximize: (id: string) => void;
  onRenamePane: (id: string, title: string | null) => void;
  onCyclePaneRole: (id: string) => void;
  onSetPaneRole: (id: string, role: PaneRole) => void;
  onTerminalReady: (paneId: string, terminalId: string) => void;
  onPaneLifecycleChange?: (paneId: string, lifecycle: PaneLifecycleState) => void;
  restartPaneRequest?: PaneRestartRequest | null;
  suspendTerminalMounts?: boolean;
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
  title?: string;
  role?: PaneRole;
}

/**
 * Stable PaneTree renderer — absolute positioning approach.
 *
 * Design:
 * 1. SplitPane layout tree renders invisible "slot" divs (for sizing only)
 * 2. All NativeTerminalArea components are rendered in a FLAT list with stable keys
 * 3. Each NativeTerminalArea is absolutely positioned to match its slot's rect
 * 4. ResizeObserver on each slot updates the position
 *
 * This guarantees NativeTerminalArea is NEVER unmounted on split/maximize/close.
 * The flat list only grows (on split) or shrinks (on close).
 */
export function PaneTreeRenderer({
  tree,
  activePaneId,
  maximizedPaneId,
  terminalIds,
  paneLifecycleStates,
  agentMeta,
  synchronizedPanes = false,
  onFocusPane,
  onSplit,
  onClose,
  onResize,
  onLayoutCommand,
  onToggleMaximize,
  onRenamePane,
  onCyclePaneRole,
  onSetPaneRole,
  onTerminalReady,
  onPaneLifecycleChange,
  restartPaneRequest,
  suspendTerminalMounts = false,
  canClose,
}: PaneTreeRendererProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const terminalTextClarity = useAppStore((s) => s.terminalTextClarity);
  const [snapshotMarkHandlers, setSnapshotMarkHandlers] = useState<Map<string, () => void>>(new Map());

  // Accumulate all leaves ever seen (never remove — React handles unmount via key removal)
  const leavesRef = useRef(new Map<string, LeafInfo>());
  // Track which leaves have ever had a non-zero rect.  Once true, we keep
  // NativeTerminalArea mounted even if the rect later goes to zero (e.g.
  // maximize sets the non-maxed slots to `display: none`, collapsing their
  // rect).  Without this, hidden panes would unmount → PTY dropped → new
  // PTY on restore, losing the previous shell/CLI state.
  const initializedRef = useRef(new Set<string>());
  const currentLeaves = useMemo(() => collectLeaves(tree), [tree]);
  const registerSnapshotMarkHandler = useCallback((paneId: string, handler: (() => void) | null) => {
    setSnapshotMarkHandlers((prev) => {
      const current = prev.get(paneId);
      if (current === handler || (!current && !handler)) return prev;
      const next = new Map(prev);
      if (handler) next.set(paneId, handler);
      else next.delete(paneId);
      return next;
    });
  }, []);

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
      initializedRef.current.delete(id);
    }
  }

  // Stable array derived from the map (order doesn't matter for absolute positioning)
  const stableLeaves = Array.from(leavesRef.current.values());
  const layoutMeasurementKey = `${maximizedPaneId ?? "split"}:${currentLeaves.map((leaf) => leaf.id).join("|")}`;

  // Slot rects: paneId → DOMRect (updated by ResizeObserver)
  const [slotRects, setSlotRects] = useState<Map<string, DOMRect>>(new Map());
  const slotEls = useRef(new Map<string, HTMLDivElement>());
  const observerRef = useRef<ResizeObserver | null>(null);
  const rafRef = useRef(0);

  // Read current slot geometry and push it into `slotRects` only when a
  // value actually changed — saves a React re-render for every frame that
  // ResizeObserver fires with no-op dimensions (common during the settling
  // phase of a split-pane drag).  We compare in sub-pixel-rounded space so
  // browser layout noise (e.g. 512.0001 → 512) does not count as change.
  const updateRects = useCallback(() => {
    const root = rootRef.current;
    if (!root) return;
    const rootRect = root.getBoundingClientRect();
    const next = new Map<string, DOMRect>();
    for (const [id, el] of slotEls.current) {
      const r = el.getBoundingClientRect();
      next.set(id, snapPaneRectToDevicePixels(r, rootRect));
    }
    setSlotRects((prev) => (rectsEqual(prev, next) ? prev : next));
  }, []);

  // rAF-coalesced version used by the ResizeObserver callback and by
  // tree/maximize transitions.  Multiple observer hits within a single
  // frame collapse to a single measurement pass.
  const scheduleUpdate = useCallback(() => {
    if (rafRef.current !== 0) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      updateRects();
    });
  }, [updateRects]);

  const registerSlot = useCallback(
    (id: string, el: HTMLDivElement | null) => {
      const observer = observerRef.current;
      const prev = slotEls.current.get(id);
      if (el) {
        if (prev === el) return;
        if (prev && observer) observer.unobserve(prev);
        slotEls.current.set(id, el);
        observer?.observe(el);
        scheduleUpdate();
      } else if (prev) {
        if (observer) observer.unobserve(prev);
        slotEls.current.delete(id);
        scheduleUpdate();
      }
    },
    [scheduleUpdate],
  );

  // React re-invokes inline ref callbacks on every parent render — an
  // unobserve/observe churn every frame during drag.  Cache one stable
  // callback per pane id so the observer registration survives renders.
  const slotRefCache = useRef(new Map<string, (el: HTMLDivElement | null) => void>());
  const getSlotRef = useCallback(
    (id: string) => {
      const cache = slotRefCache.current;
      let cb = cache.get(id);
      if (!cb) {
        cb = (el: HTMLDivElement | null) => registerSlot(id, el);
        cache.set(id, cb);
      }
      return cb;
    },
    [registerSlot],
  );

  // Drop cached ref callbacks for leaves that no longer exist, so the
  // cache doesn't grow unbounded as panes are created and closed.
  useEffect(() => {
    const cache = slotRefCache.current;
    for (const id of cache.keys()) {
      if (!currentIds.has(id)) cache.delete(id);
    }
  });

  // One long-lived ResizeObserver covering the root + every current slot.
  // Slots are attached/detached via `registerSlot` above, so this effect
  // only runs once — we do NOT depend on [tree, maximizedPaneId] so the
  // observer is preserved across layout changes (no teardown/re-create).
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const ro = new ResizeObserver(scheduleUpdate);
    observerRef.current = ro;
    ro.observe(root);
    for (const el of slotEls.current.values()) ro.observe(el);
    // Seed the initial rects after the first paint.
    scheduleUpdate();
    return () => {
      ro.disconnect();
      observerRef.current = null;
      if (rafRef.current !== 0) cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    };
  }, [scheduleUpdate]);

  // Remeasure when the layout topology changes (split, close, maximize) —
  // the DOM may have reshuffled without any one slot changing size, so the
  // observer alone won't fire.
  // biome-ignore lint/correctness/useExhaustiveDependencies: topology/maximize changes intentionally retrigger measurement.
  useEffect(() => {
    scheduleUpdate();
  }, [layoutMeasurementKey, scheduleUpdate]);

  useEffect(() => {
    const onPrefixCommand = (event: Event) => {
      const detail = (event as CustomEvent<{ terminalId?: string; command?: string }>).detail;
      if (!detail?.terminalId || !detail.command) return;
      const paneId = [...terminalIds.entries()].find(([, terminalId]) => terminalId === detail.terminalId)?.[0];
      if (!paneId) return;
      switch (detail.command) {
        case "split-right":
          onSplit(paneId, "right");
          break;
        case "split-down":
          onSplit(paneId, "down");
          break;
        case "close":
          if (canClose) onClose(paneId);
          break;
        case "toggle-maximize":
          onToggleMaximize(paneId);
          break;
        case "focus-next":
          onFocusPane(nextPaneId(currentLeaves, paneId, 1));
          break;
        case "focus-previous":
          onFocusPane(nextPaneId(currentLeaves, paneId, -1));
          break;
        case "move-next":
          onFocusPane(paneId);
          onLayoutCommand?.("move-next");
          break;
        case "move-previous":
          onFocusPane(paneId);
          onLayoutCommand?.("move-previous");
          break;
        case "rotate-next":
          onLayoutCommand?.("rotate-next");
          break;
        case "rotate-previous":
          onLayoutCommand?.("rotate-previous");
          break;
        case "equalize":
          onLayoutCommand?.("equalize");
          break;
        case "tiled":
          onLayoutCommand?.("tiled");
          break;
        case "sync-panes":
          onLayoutCommand?.(synchronizedPanes ? "sync-panes-off" : "sync-panes-on");
          break;
      }
    };
    document.addEventListener(TERMINAL_PREFIX_COMMAND_EVENT, onPrefixCommand);
    return () => document.removeEventListener(TERMINAL_PREFIX_COMMAND_EVENT, onPrefixCommand);
  }, [
    canClose,
    currentLeaves,
    onClose,
    onFocusPane,
    onLayoutCommand,
    onSplit,
    onToggleMaximize,
    synchronizedPanes,
    terminalIds,
  ]);

  return (
    <div ref={rootRef} className={styles.paneRoot}>
      {/* Layer 1: Layout tree (invisible slots for sizing) */}
      <div className={styles.layoutLayer}>
        {maximizedPaneId
          ? currentLeaves.map((leaf) => (
              <div
                key={leaf.id}
                ref={getSlotRef(leaf.id)}
                className={styles.paneSlot}
                style={leaf.id === maximizedPaneId ? { display: "flex", flex: 1 } : { display: "none" }}
              />
            ))
          : renderLayout(tree, getSlotRef, onResize)}
      </div>

      {/* Layer 2: Stable terminal instances (absolute positioned).
          We gate NativeTerminalArea mounting on a non-zero rect so the
          first measurement produces real cols/rows. Otherwise the PTY
          spawns at the MIN_COLS/MIN_ROWS fallback and programs render at
          the wrong width until the user resizes by hand. */}
      {stableLeaves.map((leaf) => {
        const rect = slotRects.get(leaf.id);
        const isVisible = maximizedPaneId ? leaf.id === maximizedPaneId : currentIds.has(leaf.id);
        /* `usePaneTree` initialises `activePaneId` to `null` and only
         * sets it on the first explicit click. With a single freshly-
         * opened pane that means `null === leaf.id` is always false,
         * so the gold-rule active-pane signal added in `0e28820` never
         * shows even though that one pane *is* the only place
         * keystrokes land. Treat the lone leaf as implicitly active —
         * the same fallback `PaneTreeContainer.activeTerminalId`
         * already uses for the inline-image budget badge. */
        const isActive =
          leaf.id === activePaneId || (activePaneId === null && currentLeaves.length === 1 && currentIds.has(leaf.id));
        const isMaximized = leaf.id === maximizedPaneId;
        const hasRealSize = !!rect && rect.width > 0 && rect.height > 0;
        // Latch the "has been real size" bit — once a NativeTerminalArea has
        // mounted at non-zero dimensions, keep it mounted for the lifetime
        // of the pane.  This survives maximize (non-max slots get rect=0
        // via display:none) without unmounting and re-spawning the PTY.
        if (hasRealSize) initializedRef.current.add(leaf.id);
        const lifecycle = paneLifecycleStates?.get(leaf.id);
        const terminalId = terminalIds.get(leaf.id) ?? null;
        // Agent panes are bound by terminal id (== leaf.id at spawn); surface the
        // live identity so the pane reads as a fleet member, not a blank shell.
        const agent = agentMeta?.get(terminalId ?? leaf.id);
        const endedLifecycle = lifecycle === "detached" || lifecycle === "exited" || lifecycle === "crashed";
        const shouldSuspendForLeaf = suspendTerminalMounts && lifecycle !== "starting" && lifecycle !== "restarting";
        // A finished AGENT pane keeps its terminal mounted (not the "Ended pane"
        // placeholder) so claude's final output stays visible — the fleet persists
        // for review instead of vanishing the moment the agent exits.
        const shouldHoldForAttach = endedLifecycle && (!agent || !terminalId);
        const shouldMount =
          !shouldSuspendForLeaf && !shouldHoldForAttach && (hasRealSize || initializedRef.current.has(leaf.id));
        const shouldShowPaneHeader = currentLeaves.length > 1 && !maximizedPaneId;

        return (
          // biome-ignore lint/a11y/noStaticElementInteractions: the terminal mount itself claims focus without changing keyboard semantics.
          <div
            key={leaf.id}
            className={styles.terminalMount}
            data-active={isActive ? "true" : undefined}
            data-maximized={isMaximized ? "true" : undefined}
            data-agent={agent ? "true" : undefined}
            data-terminal-text-clarity={terminalTextClarity}
            style={
              rect && isVisible
                ? {
                    position: "absolute",
                    left: rect.left,
                    top: rect.top,
                    width: rect.width,
                    height: rect.height,
                  }
                : { display: "none" }
            }
            onMouseDown={() => onFocusPane(leaf.id)}
          >
            {shouldShowPaneHeader && (
              <TerminalInfoBar
                shell={SHELL_LABELS[leaf.shell] ?? leaf.shell}
                cwd={leaf.cwd}
                terminalId={terminalId}
                paneTitle={leaf.title}
                paneRole={leaf.role}
                activeAgent={agent ? { model: agent.model, status: agent.status } : null}
                isActive={isActive}
                isMaximized={isMaximized}
                onRenamePane={(title) => onRenamePane(leaf.id, title)}
                onCyclePaneRole={() => onCyclePaneRole(leaf.id)}
                onSetPaneRole={(role) => onSetPaneRole(leaf.id, role)}
                onSplitRight={() => onSplit(leaf.id, "right")}
                onSplitDown={() => onSplit(leaf.id, "down")}
                syncMode={synchronizedPanes}
                onToggleSync={() => onLayoutCommand?.(synchronizedPanes ? "sync-panes-off" : "sync-panes-on")}
                onMarkSnapshot={snapshotMarkHandlers.get(leaf.id)}
                onToggleMaximize={() => onToggleMaximize(leaf.id)}
                onClose={canClose ? () => onClose(leaf.id) : undefined}
              />
            )}
            {shouldMount ? (
              <NativeTerminalArea
                shell={leaf.shell as ShellKind}
                cwd={leaf.cwd}
                attachedTerminalId={terminalId}
                onTerminalReady={(tid) => onTerminalReady(leaf.id, tid)}
                onLifecycleChange={(lifecycle) => onPaneLifecycleChange?.(leaf.id, lifecycle)}
                restartRequest={restartPaneRequest?.paneId === leaf.id ? restartPaneRequest : null}
                onSnapshotMarkHandlerChange={(handler) => registerSnapshotMarkHandler(leaf.id, handler)}
              />
            ) : shouldHoldForAttach ? (
              <div className={styles.lifecyclePlaceholder} data-lifecycle={lifecycle}>
                <span>
                  {lifecycle === "detached" ? "Detached pane" : lifecycle === "crashed" ? "Crashed pane" : "Ended pane"}
                </span>
                <button
                  type="button"
                  onMouseDown={(event) => {
                    event.stopPropagation();
                    onPaneLifecycleChange?.(leaf.id, "starting");
                  }}
                  onClick={(event) => {
                    event.stopPropagation();
                    onPaneLifecycleChange?.(leaf.id, "starting");
                  }}
                >
                  New shell
                </button>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

type ShellKind = "powershell" | "cmd" | "gitbash" | "wsl";

/** Render the layout tree — only empty sizing divs, no terminals */
function renderLayout(
  node: PaneNode,
  getSlotRef: (id: string) => (el: HTMLDivElement | null) => void,
  onResize: (splitId: string, ratio: number) => void,
): React.ReactElement {
  if (node.type === "terminal") {
    return <div key={node.id} ref={getSlotRef(node.id)} className={styles.paneSlot} />;
  }

  return (
    <SplitPane
      key={node.id}
      direction={node.direction}
      defaultRatio={node.ratio}
      onRatioChange={(r) => onResize(node.id, r)}
      first={renderLayout(node.first, getSlotRef, onResize)}
      second={renderLayout(node.second, getSlotRef, onResize)}
    />
  );
}

function collectLeaves(tree: PaneNode): LeafInfo[] {
  if (tree.type === "terminal") {
    return [{ id: tree.id, shell: tree.shell, cwd: tree.cwd, title: tree.title, role: tree.role }];
  }
  return [...collectLeaves(tree.first), ...collectLeaves(tree.second)];
}

function snapPaneRectToDevicePixels(rect: DOMRect, rootRect: DOMRect): DOMRect {
  const left = snapTerminalCssPixel(rect.left - rootRect.left);
  const top = snapTerminalCssPixel(rect.top - rootRect.top);
  const right = snapTerminalCssPixel(rect.right - rootRect.left);
  const bottom = snapTerminalCssPixel(rect.bottom - rootRect.top);
  return new DOMRect(left, top, Math.max(0, right - left), Math.max(0, bottom - top));
}

function nextPaneId(leaves: readonly LeafInfo[], paneId: string, delta: 1 | -1): string {
  const index = leaves.findIndex((leaf) => leaf.id === paneId);
  if (index < 0 || leaves.length === 0) return paneId;
  return leaves[(index + delta + leaves.length) % leaves.length].id;
}

/** Shallow structural equality over two rect maps (same keys, same L/T/W/H). */
function rectsEqual(a: Map<string, DOMRect>, b: Map<string, DOMRect>): boolean {
  if (a.size !== b.size) return false;
  for (const [id, ra] of a) {
    const rb = b.get(id);
    if (!rb) return false;
    if (ra.left !== rb.left || ra.top !== rb.top || ra.width !== rb.width || ra.height !== rb.height) {
      return false;
    }
  }
  return true;
}
