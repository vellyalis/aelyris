import type { ShellType } from "../../../App";
import type { PaneLifecycleState, PaneNode, PaneRegistryEntry, PaneRole, SplitDirection, TerminalLeaf } from "./types";
import { PANE_ROLES, splitDirectionToTree } from "./types";

function uid(): string {
  return crypto.randomUUID().slice(0, 8);
}

export interface PaneSwitcherEntry extends PaneRegistryEntry {
  label?: string;
  route?: string;
}

/** Create a fresh terminal leaf */
export function createLeaf(
  shell: ShellType,
  cwd?: string,
  meta: { title?: string; role?: PaneRole } = {},
): TerminalLeaf {
  return {
    type: "terminal",
    id: `pane-${uid()}`,
    shell,
    cwd,
    ...normalizeLeafMeta(meta),
  };
}

/** Split the target leaf into a split containing the original + a new terminal */
export function splitPane(
  tree: PaneNode,
  targetId: string,
  splitDir: SplitDirection,
  shell: ShellType,
  cwd?: string,
): PaneNode {
  if (tree.type === "terminal") {
    if (tree.id !== targetId) return tree;
    const { direction, newFirst } = splitDirectionToTree(splitDir);
    const newLeaf = createLeaf(shell, cwd);
    return {
      type: "split",
      id: `split-${uid()}`,
      direction,
      ratio: 0.5,
      first: newFirst ? newLeaf : tree,
      second: newFirst ? tree : newLeaf,
    };
  }

  return {
    ...tree,
    first: splitPane(tree.first, targetId, splitDir, shell, cwd),
    second: splitPane(tree.second, targetId, splitDir, shell, cwd),
  };
}

/** Remove a terminal leaf. Returns null if the entire tree is removed. */
export function removePane(tree: PaneNode, targetId: string): PaneNode | null {
  if (tree.type === "terminal") {
    return tree.id === targetId ? null : tree;
  }

  const first = removePane(tree.first, targetId);
  const second = removePane(tree.second, targetId);

  if (first === null) return second;
  if (second === null) return first;

  return { ...tree, first, second };
}

/** Update the split ratio for a specific split node */
export function updateRatio(tree: PaneNode, splitId: string, ratio: number): PaneNode {
  if (tree.type === "terminal") return tree;
  if (tree.id === splitId) return { ...tree, ratio };
  return {
    ...tree,
    first: updateRatio(tree.first, splitId, ratio),
    second: updateRatio(tree.second, splitId, ratio),
  };
}

/** Collect all terminal leaf IDs in tree order (for navigation) */
export function collectLeafIds(tree: PaneNode): string[] {
  if (tree.type === "terminal") return [tree.id];
  return [...collectLeafIds(tree.first), ...collectLeafIds(tree.second)];
}

/** Count terminal leaves */
export function countLeaves(tree: PaneNode): number {
  if (tree.type === "terminal") return 1;
  return countLeaves(tree.first) + countLeaves(tree.second);
}

/** Locate a terminal leaf by pane id. */
export function findLeaf(tree: PaneNode, targetId: string): TerminalLeaf | null {
  if (tree.type === "terminal") return tree.id === targetId ? tree : null;
  return findLeaf(tree.first, targetId) ?? findLeaf(tree.second, targetId);
}

/** Collect terminal leaves in stable tree order, enriched with current PTY ids. */
export function collectPaneRegistry(
  tree: PaneNode,
  terminalIds: ReadonlyMap<string, string> = new Map(),
  lifecycleStates: ReadonlyMap<string, PaneLifecycleState> = new Map(),
): PaneRegistryEntry[] {
  const entries: PaneRegistryEntry[] = [];
  collectPaneRegistryInto(tree, terminalIds, lifecycleStates, entries);
  return entries;
}

/** Collect pane switcher rows in stable tmux-style tree order. */
export function collectPaneSwitcherEntries(
  tree: PaneNode,
  terminalIds: ReadonlyMap<string, string> = new Map(),
  windowLabel = "window",
  lifecycleStates: ReadonlyMap<string, PaneLifecycleState> = new Map(),
): PaneSwitcherEntry[] {
  return collectPaneRegistry(tree, terminalIds, lifecycleStates).map((pane) => {
    const label = pane.title || (pane.role ? `@${pane.role}` : `${pane.shell} pane ${pane.index + 1}`);
    return {
      ...pane,
      label,
      route: `${windowLabel}.${pane.index + 1} ${label}`,
    };
  });
}

/** Update terminal-only metadata without disturbing PTY identity. */
export function updateLeafMeta(
  tree: PaneNode,
  targetId: string,
  patch: { title?: string | null; role?: PaneRole | null },
): PaneNode {
  if (tree.type === "terminal") {
    if (tree.id !== targetId) return tree;
    const next = { ...tree, ...normalizeLeafMeta(patch) };
    if (patch.title !== undefined && !next.title) delete next.title;
    if (patch.role !== undefined && !next.role) delete next.role;
    return next;
  }

  return {
    ...tree,
    first: updateLeafMeta(tree.first, targetId, patch),
    second: updateLeafMeta(tree.second, targetId, patch),
  };
}

/** Return a compact title, or undefined when the label should be cleared. */
export function normalizePaneTitle(title: string | null | undefined): string | undefined {
  return typeof title === "string" ? title.replace(/\s+/g, " ").trim().slice(0, 48) || undefined : undefined;
}

/** Keep pane names unambiguous for command/workflow targeting. */
export function uniquePaneTitle(tree: PaneNode, targetId: string, title: string): string {
  const titleTaken = (candidate: string) => {
    const lower = candidate.toLowerCase();
    return collectLeafTitles(tree).some((leaf) => leaf.id !== targetId && leaf.title.toLowerCase() === lower);
  };
  if (!titleTaken(title)) return title;

  const base = title.slice(0, 44).trim() || "Pane";
  for (let idx = 2; idx < 100; idx += 1) {
    const candidate = `${base} ${idx}`.slice(0, 48);
    if (!titleTaken(candidate)) return candidate;
  }
  return `${base} ${uid().slice(0, 3)}`.slice(0, 48);
}

/** Cycle a pane through the small set of workstation roles. */
export function cycleLeafRole(tree: PaneNode, targetId: string): PaneNode {
  const leaf = findLeaf(tree, targetId);
  const currentIndex = leaf?.role ? PANE_ROLES.indexOf(leaf.role) : -1;
  const nextRole = PANE_ROLES[(currentIndex + 1) % PANE_ROLES.length] ?? "work";
  return updateLeafMeta(tree, targetId, { role: nextRole });
}

function normalizeLeafMeta(meta: { title?: string | null; role?: PaneRole | null }): {
  title?: string;
  role?: PaneRole;
} {
  const title = normalizePaneTitle(meta.title);
  return {
    ...(title ? { title } : {}),
    ...(meta.role ? { role: meta.role } : {}),
  };
}

function collectLeafTitles(tree: PaneNode): { id: string; title: string }[] {
  if (tree.type === "terminal") {
    return tree.title ? [{ id: tree.id, title: tree.title }] : [];
  }
  return [...collectLeafTitles(tree.first), ...collectLeafTitles(tree.second)];
}

function collectPaneRegistryInto(
  tree: PaneNode,
  terminalIds: ReadonlyMap<string, string>,
  lifecycleStates: ReadonlyMap<string, PaneLifecycleState>,
  entries: PaneRegistryEntry[],
): void {
  if (tree.type === "terminal") {
    const terminalId = terminalIds.get(tree.id) ?? null;
    entries.push({
      paneId: tree.id,
      terminalId,
      lifecycle: lifecycleStates.get(tree.id) ?? (terminalId ? "live" : "layout-only"),
      index: entries.length,
      shell: tree.shell,
      cwd: tree.cwd,
      title: tree.title,
      role: tree.role,
    });
    return;
  }
  collectPaneRegistryInto(tree.first, terminalIds, lifecycleStates, entries);
  collectPaneRegistryInto(tree.second, terminalIds, lifecycleStates, entries);
}
