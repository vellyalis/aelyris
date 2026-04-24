import { describe, expect, it } from "vitest";
import { createLeaf, type PaneNode, removePane, splitPane } from "../features/terminal/pane-tree";

describe("PaneTree (legacy compat) — splitPane", () => {
  it("splits a single leaf into two", () => {
    const leaf = createLeaf("cmd", "/test");
    const result = splitPane(leaf, leaf.id, "right", "cmd", "/test");

    expect(result.type).toBe("split");
    if (result.type === "split") {
      expect(result.direction).toBe("horizontal");
      expect(result.ratio).toBe(0.5);
      expect(result.first).toBe(leaf);
      expect(result.second.type).toBe("terminal");
    }
  });

  it("splits a nested leaf", () => {
    const leaf1 = createLeaf("cmd");
    const leaf2 = createLeaf("powershell");
    const tree: PaneNode = {
      type: "split",
      id: "test-split",
      direction: "vertical",
      ratio: 0.5,
      first: leaf1,
      second: leaf2,
    };

    const result = splitPane(tree, leaf2.id, "right", "gitbash");

    expect(result.type).toBe("split");
    if (result.type === "split") {
      expect(result.first).toBe(leaf1);
      expect(result.second.type).toBe("split");
      if (result.second.type === "split") {
        expect(result.second.first).toBe(leaf2);
        expect(result.second.second.type).toBe("terminal");
      }
    }
  });

  it("does nothing for non-matching ID", () => {
    const leaf = createLeaf("cmd");
    const result = splitPane(leaf, "nonexistent", "right", "cmd");
    expect(result).toBe(leaf);
  });
});

describe("PaneTree (legacy compat) — removePane", () => {
  it("removes a leaf from a split, collapsing to sibling", () => {
    const leaf1 = createLeaf("cmd");
    const leaf2 = createLeaf("powershell");
    const tree: PaneNode = {
      type: "split",
      id: "test-split",
      direction: "vertical",
      ratio: 0.5,
      first: leaf1,
      second: leaf2,
    };

    const result = removePane(tree, leaf1.id);
    expect(result).toBe(leaf2);
  });

  it("returns null when removing the only node", () => {
    const leaf = createLeaf("cmd");
    const result = removePane(leaf, leaf.id);
    expect(result).toBeNull();
  });

  it("preserves tree when removing non-matching ID", () => {
    const leaf = createLeaf("cmd");
    const result = removePane(leaf, "nonexistent");
    expect(result).toBe(leaf);
  });

  it("handles deeply nested removal", () => {
    const a = createLeaf("cmd");
    const b = createLeaf("powershell");
    const c = createLeaf("gitbash");

    const tree: PaneNode = {
      type: "split",
      id: "test-split",
      direction: "vertical",
      ratio: 0.5,
      first: a,
      second: {
        type: "split",
        id: "inner-split",
        direction: "horizontal",
        ratio: 0.5,
        first: b,
        second: c,
      },
    };

    const result = removePane(tree, b.id);
    expect(result).not.toBeNull();
    if (result && result.type === "split") {
      expect(result.first).toBe(a);
      expect(result.second).toBe(c);
    }
  });
});
