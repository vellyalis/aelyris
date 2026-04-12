import { describe, it, expect } from "vitest";
import { createLeaf, splitPane, removePane, collectLeafIds, countLeaves } from "../features/terminal/pane-tree/operations";
import { splitDirectionToTree } from "../features/terminal/pane-tree/types";
import type { PaneNode } from "../features/terminal/pane-tree/types";

describe("createLeaf", () => {
  it("creates a terminal leaf with unique id", () => {
    const a = createLeaf("powershell", "/home");
    const b = createLeaf("cmd");
    expect(a.type).toBe("terminal");
    expect(a.shell).toBe("powershell");
    expect(a.cwd).toBe("/home");
    expect(a.id).not.toBe(b.id);
  });
});

describe("splitPane", () => {
  it("splits a leaf into a split node with two children", () => {
    const leaf = createLeaf("powershell");
    const result = splitPane(leaf, leaf.id, "right", "cmd");
    expect(result.type).toBe("split");
    if (result.type === "split") {
      expect(result.direction).toBe("horizontal");
      expect(result.first.type).toBe("terminal");
      expect(result.second.type).toBe("terminal");
      expect(result.ratio).toBe(0.5);
    }
  });

  it("splits 'down' creates vertical split", () => {
    const leaf = createLeaf("powershell");
    const result = splitPane(leaf, leaf.id, "down", "cmd");
    if (result.type === "split") {
      expect(result.direction).toBe("vertical");
    }
  });

  it("splits 'left' puts new pane as first child", () => {
    const leaf = createLeaf("powershell");
    const result = splitPane(leaf, leaf.id, "left", "cmd");
    if (result.type === "split") {
      expect((result.first as { shell: string }).shell).toBe("cmd"); // new pane is first
      expect((result.second as { shell: string }).shell).toBe("powershell"); // original is second
    }
  });

  it("preserves original leaf id after split (PTY session survival)", () => {
    const leaf = createLeaf("powershell");
    const originalId = leaf.id;
    const tree = splitPane(leaf, leaf.id, "right", "cmd");
    // The original leaf must keep its ID — this is what keeps the PTY alive
    const leafIds = collectLeafIds(tree);
    expect(leafIds).toContain(originalId);
    // The original leaf should be the first child (split right = original stays left)
    if (tree.type === "split") {
      expect(tree.first.id).toBe(originalId);
    }
  });

  it("preserves all leaf ids after multiple splits", () => {
    const leaf = createLeaf("powershell");
    const id1 = leaf.id;
    const tree1 = splitPane(leaf, leaf.id, "right", "cmd");
    if (tree1.type !== "split") throw new Error("expected split");
    const id2 = tree1.second.id;
    const tree2 = splitPane(tree1, id2, "down", "wsl");
    const allIds = collectLeafIds(tree2);
    expect(allIds).toContain(id1);
    expect(allIds).toContain(id2);
    expect(allIds.length).toBe(3);
  });

  it("does not split non-matching id", () => {
    const leaf = createLeaf("powershell");
    const result = splitPane(leaf, "nonexistent", "right", "cmd");
    expect(result).toBe(leaf); // unchanged
  });

  it("splits deeply nested node", () => {
    const leaf = createLeaf("powershell");
    const tree1 = splitPane(leaf, leaf.id, "right", "cmd");
    if (tree1.type !== "split") throw new Error("expected split");
    const innerLeafId = tree1.second.id;
    const tree2 = splitPane(tree1, innerLeafId, "down", "wsl");
    expect(countLeaves(tree2)).toBe(3);
  });
});

describe("removePane", () => {
  it("removes a leaf, collapsing the parent split", () => {
    const leaf = createLeaf("powershell");
    const tree = splitPane(leaf, leaf.id, "right", "cmd");
    if (tree.type !== "split") throw new Error("expected split");
    const result = removePane(tree, tree.second.id);
    expect(result).not.toBeNull();
    expect(result!.type).toBe("terminal");
  });

  it("returns null when removing the only leaf", () => {
    const leaf = createLeaf("powershell");
    expect(removePane(leaf, leaf.id)).toBeNull();
  });

  it("preserves surviving leaf ids after close", () => {
    const a = createLeaf("powershell");
    const tree = splitPane(a, a.id, "right", "cmd");
    if (tree.type !== "split") throw new Error("expected split");
    const bId = tree.second.id;
    // Close B — A should survive with same ID
    const result = removePane(tree, bId);
    expect(result).not.toBeNull();
    expect(result!.id).toBe(a.id);
  });

  it("returns unchanged tree when id not found", () => {
    const leaf = createLeaf("powershell");
    expect(removePane(leaf, "nonexistent")).toBe(leaf);
  });
});

describe("collectLeafIds", () => {
  it("returns single id for leaf", () => {
    const leaf = createLeaf("powershell");
    expect(collectLeafIds(leaf)).toEqual([leaf.id]);
  });

  it("returns ids in tree order for split", () => {
    const leaf = createLeaf("powershell");
    const tree = splitPane(leaf, leaf.id, "right", "cmd");
    const ids = collectLeafIds(tree);
    expect(ids.length).toBe(2);
  });
});

describe("countLeaves", () => {
  it("counts correctly for nested tree", () => {
    const leaf = createLeaf("powershell");
    let tree: PaneNode = splitPane(leaf, leaf.id, "right", "cmd");
    if (tree.type === "split") {
      tree = splitPane(tree, tree.second.id, "down", "wsl");
    }
    expect(countLeaves(tree)).toBe(3);
  });
});

describe("splitDirectionToTree", () => {
  it("right = horizontal, new second", () => {
    expect(splitDirectionToTree("right")).toEqual({ direction: "horizontal", newFirst: false });
  });
  it("left = horizontal, new first", () => {
    expect(splitDirectionToTree("left")).toEqual({ direction: "horizontal", newFirst: true });
  });
  it("down = vertical, new second", () => {
    expect(splitDirectionToTree("down")).toEqual({ direction: "vertical", newFirst: false });
  });
  it("up = vertical, new first", () => {
    expect(splitDirectionToTree("up")).toEqual({ direction: "vertical", newFirst: true });
  });
});
