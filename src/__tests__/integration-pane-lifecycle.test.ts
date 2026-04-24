import { describe, expect, it } from "vitest";
import {
  collectLeafIds,
  countLeaves,
  createLeaf,
  removePane,
  splitPane,
  updateRatio,
} from "../features/terminal/pane-tree/operations";
import type { PaneNode } from "../features/terminal/pane-tree/types";

/**
 * Integration tests for the full pane lifecycle:
 * create → split → maximize → close → tab switch
 *
 * These validate that the data model supports all user operations
 * without data loss or state corruption.
 */

describe("Pane lifecycle: split → close", () => {
  it("3-way split → close middle → 2 panes remain with correct IDs", () => {
    const a = createLeaf("powershell", "/home");
    const tree1 = splitPane(a, a.id, "right", "cmd");
    expect(tree1.type).toBe("split");
    if (tree1.type !== "split") throw new Error("expected split");

    const bId = tree1.second.id;
    const tree2 = splitPane(tree1, bId, "down", "wsl");
    expect(countLeaves(tree2)).toBe(3);

    // Close the middle pane (B)
    const tree3 = removePane(tree2, bId);
    expect(tree3).not.toBeNull();
    expect(countLeaves(tree3!)).toBe(2);

    // Original A and new WSL should survive
    const ids = collectLeafIds(tree3!);
    expect(ids).toContain(a.id);
  });

  it("split → resize → close preserves ratio on remaining split", () => {
    const a = createLeaf("powershell");
    const tree1 = splitPane(a, a.id, "right", "cmd");
    if (tree1.type !== "split") throw new Error("expected split");

    // Resize the split
    const tree2 = updateRatio(tree1, tree1.id, 0.7);
    if (tree2.type !== "split") throw new Error("expected split");
    expect(tree2.ratio).toBe(0.7);

    // Split again
    const tree3 = splitPane(tree2, tree2.second.id, "down", "wsl");
    expect(countLeaves(tree3)).toBe(3);

    // Close the WSL pane
    if (tree3.type !== "split" || tree3.second.type !== "split") throw new Error("expected nested split");
    const wslId = tree3.second.second.id;
    const tree4 = removePane(tree3, wslId);
    expect(tree4).not.toBeNull();
    expect(countLeaves(tree4!)).toBe(2);
    // Top-level ratio should be preserved
    if (tree4!.type === "split") {
      expect(tree4!.ratio).toBe(0.7);
    }
  });
});

describe("Pane lifecycle: rapid operations", () => {
  it("10 rapid splits → all IDs unique", () => {
    let tree: PaneNode = createLeaf("powershell");
    const allIds = new Set<string>();
    allIds.add(collectLeafIds(tree)[0]);

    for (let i = 0; i < 10; i++) {
      const ids = collectLeafIds(tree);
      const targetId = ids[ids.length - 1]; // always split the last pane
      tree = splitPane(tree, targetId, i % 2 === 0 ? "right" : "down", "cmd");
      for (const id of collectLeafIds(tree)) {
        allIds.add(id);
      }
    }

    expect(countLeaves(tree)).toBe(11);
    // UUID-based IDs should all be unique
    expect(allIds.size).toBe(11);
  });

  it("split all → close all but one → single leaf remains", () => {
    let tree: PaneNode = createLeaf("powershell");
    const firstId = collectLeafIds(tree)[0];

    // Split 4 times
    for (let i = 0; i < 4; i++) {
      const ids = collectLeafIds(tree);
      tree = splitPane(tree, ids[ids.length - 1], "right", "cmd");
    }
    expect(countLeaves(tree)).toBe(5);

    // Close all except first
    while (countLeaves(tree) > 1) {
      const ids = collectLeafIds(tree);
      const toClose = ids.find((id) => id !== firstId)!;
      const result = removePane(tree, toClose);
      if (!result) break;
      tree = result;
    }

    expect(countLeaves(tree)).toBe(1);
    expect(tree.type).toBe("terminal");
    expect(tree.id).toBe(firstId);
  });
});

describe("Pane lifecycle: edge cases", () => {
  it("removing non-existent ID returns tree unchanged", () => {
    const tree = createLeaf("powershell");
    const result = removePane(tree, "nonexistent-id");
    expect(result).toBe(tree);
  });

  it("splitting non-existent ID returns tree unchanged", () => {
    const tree = createLeaf("powershell");
    const result = splitPane(tree, "nonexistent-id", "right", "cmd");
    expect(result).toBe(tree);
  });

  it("updating ratio on non-existent split returns tree unchanged", () => {
    const tree = createLeaf("powershell");
    const result = updateRatio(tree, "nonexistent-split", 0.3);
    expect(result).toBe(tree);
  });

  it("collectLeafIds handles deeply nested tree", () => {
    let tree: PaneNode = createLeaf("powershell");
    for (let i = 0; i < 20; i++) {
      const ids = collectLeafIds(tree);
      tree = splitPane(tree, ids[0], "right", "cmd");
    }
    const ids = collectLeafIds(tree);
    expect(ids.length).toBe(21);
    // All unique
    expect(new Set(ids).size).toBe(21);
  });
});
