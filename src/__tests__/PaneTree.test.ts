import { describe, it, expect } from "vitest";
import { createTerminalLeaf, splitNode, removeNode, type PaneNode } from "../features/terminal/PaneTree";

describe("PaneTree — splitNode", () => {
  it("splits a single leaf into two", () => {
    const leaf = createTerminalLeaf("cmd", "/test");
    const result = splitNode(leaf, leaf.id, "horizontal", "cmd", "/test");

    expect(result.type).toBe("split");
    if (result.type === "split") {
      expect(result.direction).toBe("horizontal");
      expect(result.ratio).toBe(0.5);
      expect(result.first).toBe(leaf);
      expect(result.second.type).toBe("terminal");
    }
  });

  it("splits a nested leaf", () => {
    const leaf1 = createTerminalLeaf("cmd");
    const leaf2 = createTerminalLeaf("powershell");
    const tree: PaneNode = {
      type: "split",
      direction: "vertical",
      ratio: 0.5,
      first: leaf1,
      second: leaf2,
    };

    const result = splitNode(tree, leaf2.id, "horizontal", "gitbash");

    expect(result.type).toBe("split");
    if (result.type === "split") {
      expect(result.first).toBe(leaf1); // unchanged
      expect(result.second.type).toBe("split"); // leaf2 was split
      if (result.second.type === "split") {
        expect(result.second.first).toBe(leaf2);
        expect(result.second.second.type).toBe("terminal");
      }
    }
  });

  it("does nothing for non-matching ID", () => {
    const leaf = createTerminalLeaf("cmd");
    const result = splitNode(leaf, "nonexistent", "horizontal", "cmd");
    expect(result).toBe(leaf);
  });
});

describe("PaneTree — removeNode", () => {
  it("removes a leaf from a split, collapsing to sibling", () => {
    const leaf1 = createTerminalLeaf("cmd");
    const leaf2 = createTerminalLeaf("powershell");
    const tree: PaneNode = {
      type: "split",
      direction: "vertical",
      ratio: 0.5,
      first: leaf1,
      second: leaf2,
    };

    const result = removeNode(tree, leaf1.id);
    expect(result).toBe(leaf2);
  });

  it("returns null when removing the only node", () => {
    const leaf = createTerminalLeaf("cmd");
    const result = removeNode(leaf, leaf.id);
    expect(result).toBeNull();
  });

  it("preserves tree when removing non-matching ID", () => {
    const leaf = createTerminalLeaf("cmd");
    const result = removeNode(leaf, "nonexistent");
    expect(result).toBe(leaf);
  });

  it("handles deeply nested removal", () => {
    const a = createTerminalLeaf("cmd");
    const b = createTerminalLeaf("powershell");
    const c = createTerminalLeaf("gitbash");

    const tree: PaneNode = {
      type: "split",
      direction: "vertical",
      ratio: 0.5,
      first: a,
      second: {
        type: "split",
        direction: "horizontal",
        ratio: 0.5,
        first: b,
        second: c,
      },
    };

    // Remove b -> second collapses to just c
    const result = removeNode(tree, b.id);
    expect(result).not.toBeNull();
    if (result && result.type === "split") {
      expect(result.first).toBe(a);
      expect(result.second).toBe(c);
    }
  });
});
