import { useRef, useEffect, useMemo, useState, useCallback } from "react";
import type { PaneNode, SplitDirection } from "./types";
import { NativeTerminalArea } from "../NativeTerminalArea";
import { TerminalInfoBar } from "../TerminalInfoBar";
import { SplitPane } from "../../../shared/ui/SplitPane";
import styles from "./PaneTreeRenderer.module.css";

interface PaneTreeRendererProps {
  tree: PaneNode;
  activePaneId: string | null;
  maximizedPaneId: string | null;
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
 * 2. All NativeTerminalArea components are rendered in a FLAT list with stable keys
 * 3. Each NativeTerminalArea is absolutely positioned to match its slot's rect
 * 4. ResizeObserver on each slot updates the position
 *
 * This guarantees NativeTerminalArea is NEVER unmounted on split/maximize/close.
 * The flat list only grows (on split) or shrinks (on close).
 */
export function PaneTreeRenderer({
  tree, activePaneId, maximizedPaneId,
  onFocusPane, onSplit, onClose, onResize, onToggleMaximize, onTerminalReady, canClose,
}: PaneTreeRendererProps) {
  const rootRef = useRef<HTMLDivElement>(null);

  // Accumulate all leaves ever seen (never remove — React handles unmount via key removal)
  const leavesRef = useRef(new Map<string, LeafInfo>());
  // Track which leaves have ever had a non-zero rect.  Once true, we keep
  // NativeTerminalArea mounted even if the rect later goes to zero (e.g.
  // maximize sets the non-maxed slots to `display: none`, collapsing their
  // rect).  Without this, hidden panes would unmount → PTY dropped → new
  // PTY on restore, losing the previous shell/CLI state.
  const initializedRef = useRef(new Set<string>());
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
      initializedRef.current.delete(id);
    }
  }

  // Stable array derived from the map (order doesn't matter for absolute positioning)
  const stableLeaves = Array.from(leavesRef.current.values());

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
      next.set(id, new DOMRect(
        Math.round(r.left - rootRect.left),
        Math.round(r.top - rootRect.top),
        Math.round(r.width),
        Math.round(r.height),
      ));
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

  const registerSlot = useCallback((id: string, el: HTMLDivElement | null) => {
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
  }, [scheduleUpdate]);

  // React re-invokes inline ref callbacks on every parent render — an
  // unobserve/observe churn every frame during drag.  Cache one stable
  // callback per pane id so the observer registration survives renders.
  const slotRefCache = useRef(new Map<string, (el: HTMLDivElement | null) => void>());
  const getSlotRef = useCallback((id: string) => {
    const cache = slotRefCache.current;
    let cb = cache.get(id);
    if (!cb) {
      cb = (el: HTMLDivElement | null) => registerSlot(id, el);
      cache.set(id, cb);
    }
    return cb;
  }, [registerSlot]);

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
  useEffect(() => {
    scheduleUpdate();
  }, [tree, maximizedPaneId, scheduleUpdate]);

  return (
    <div ref={rootRef} className={styles.paneRoot}>
      {/* Layer 1: Layout tree (invisible slots for sizing) */}
      <div className={styles.layoutLayer}>
        {maximizedPaneId ? (
          <>
            {currentLeaves.map((leaf) => (
              <div
                key={leaf.id}
                ref={getSlotRef(leaf.id)}
                className={styles.paneSlot}
                style={leaf.id === maximizedPaneId
                  ? { display: "flex", flex: 1 }
                  : { display: "none" }
                }
              />
            ))}
          </>
        ) : (
          renderLayout(tree, getSlotRef, onResize)
        )}
      </div>

      {/* Layer 2: Stable terminal instances (absolute positioned).
          We gate NativeTerminalArea mounting on a non-zero rect so the
          first measurement produces real cols/rows. Otherwise the PTY
          spawns at the MIN_COLS/MIN_ROWS fallback and programs render at
          the wrong width until the user resizes by hand. */}
      {stableLeaves.map((leaf) => {
        const rect = slotRects.get(leaf.id);
        const isVisible = maximizedPaneId ? leaf.id === maximizedPaneId : currentIds.has(leaf.id);
        const isActive = leaf.id === activePaneId;
        const isMaximized = leaf.id === maximizedPaneId;
        const hasRealSize = !!rect && rect.width > 0 && rect.height > 0;
        // Latch the "has been real size" bit — once a NativeTerminalArea has
        // mounted at non-zero dimensions, keep it mounted for the lifetime
        // of the pane.  This survives maximize (non-max slots get rect=0
        // via display:none) without unmounting and re-spawning the PTY.
        if (hasRealSize) initializedRef.current.add(leaf.id);
        const shouldMount = hasRealSize || initializedRef.current.has(leaf.id);

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
            {shouldMount && (
              <NativeTerminalArea
                shell={leaf.shell as ShellKind}
                cwd={leaf.cwd}
                onTerminalReady={(tid) => onTerminalReady(leaf.id, tid)}
              />
            )}
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
    return (
      <div
        key={node.id}
        ref={getSlotRef(node.id)}
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
      first={renderLayout(node.first, getSlotRef, onResize)}
      second={renderLayout(node.second, getSlotRef, onResize)}
    />
  );
}

function collectLeaves(tree: PaneNode): LeafInfo[] {
  if (tree.type === "terminal") return [{ id: tree.id, shell: tree.shell, cwd: tree.cwd }];
  return [...collectLeaves(tree.first), ...collectLeaves(tree.second)];
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
