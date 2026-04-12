import type { PaneNode, TerminalLeaf, SplitDirection } from "./types";
import { splitDirectionToTree } from "./types";
import type { ShellType } from "../../../App";

function uid(): string {
  return crypto.randomUUID().slice(0, 8);
}

/** Create a fresh terminal leaf */
export function createLeaf(shell: ShellType, cwd?: string): TerminalLeaf {
  return { type: "terminal", id: `pane-${uid()}`, shell, cwd };
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
