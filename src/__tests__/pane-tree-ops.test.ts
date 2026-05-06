import { describe, expect, it } from "vitest";
import {
  collectLeafIds,
  collectPaneSwitcherEntries,
  countLeaves,
  createLeaf,
  cycleLeafRole,
  findLeaf,
  normalizePaneTitle,
  removePane,
  splitPane,
  uniquePaneTitle,
  updateLeafMeta,
} from "../features/terminal/pane-tree/operations";
import type { PaneNode } from "../features/terminal/pane-tree/types";
import { splitDirectionToTree } from "../features/terminal/pane-tree/types";

describe("createLeaf", () => {
  it("creates a terminal leaf with unique id", () => {
    const a = createLeaf("powershell", "/home");
    const b = createLeaf("cmd");
    expect(a.type).toBe("terminal");
    expect(a.shell).toBe("powershell");
    expect(a.cwd).toBe("/home");
    expect(a.id).not.toBe(b.id);
  });

  it("keeps optional pane identity metadata compact", () => {
    const leaf = createLeaf("powershell", "/home", {
      title: "  frontend    server  ",
      role: "build",
    });
    expect(leaf.title).toBe("frontend server");
    expect(leaf.role).toBe("build");
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

describe("collectPaneSwitcherEntries", () => {
  it("returns a single-pane fallback entry", () => {
    const leaf = createLeaf("powershell", "C:\\repo");
    const entries = collectPaneSwitcherEntries(leaf, new Map([[leaf.id, "pty-main"]]), "main");

    expect(entries).toEqual([
      {
        paneId: leaf.id,
        terminalId: "pty-main",
        lifecycle: "live",
        index: 0,
        shell: "powershell",
        cwd: "C:\\repo",
        title: undefined,
        role: undefined,
        label: "powershell pane 1",
        route: "main.1 powershell pane 1",
      },
    ]);
  });

  it("classifies layout-only and explicit lifecycle states for session truth consumers", () => {
    const leaf = createLeaf("powershell", "C:\\repo");

    expect(collectPaneSwitcherEntries(leaf)[0]).toMatchObject({
      paneId: leaf.id,
      terminalId: null,
      lifecycle: "layout-only",
    });

    expect(
      collectPaneSwitcherEntries(leaf, new Map([[leaf.id, "pty-main"]]), "main", new Map([[leaf.id, "crashed"]])),
    ).toMatchObject([
      {
        paneId: leaf.id,
        terminalId: "pty-main",
        lifecycle: "crashed",
      },
    ]);
  });

  it("keeps split traversal order aligned with collectLeafIds", () => {
    const root = createLeaf("powershell", undefined, { title: "root" });
    const rightSplit = splitPane(root, root.id, "right", "cmd");
    if (rightSplit.type !== "split") throw new Error("expected split");
    const rightId = rightSplit.second.id;

    const nested = splitPane(rightSplit, rightId, "up", "gitbash");
    const ids = collectLeafIds(nested);
    const entries = collectPaneSwitcherEntries(nested);

    expect(entries.map((entry) => entry.paneId)).toEqual(ids);
    expect(entries.map((entry) => entry.index)).toEqual([0, 1, 2]);
    expect(entries.map((entry) => entry.shell)).toEqual(["powershell", "gitbash", "cmd"]);
  });

  it("uses title and role labels without changing left split order", () => {
    const original = createLeaf("powershell", undefined, { role: "build" });
    const tree = splitPane(original, original.id, "left", "cmd");
    if (tree.type !== "split") throw new Error("expected split");
    const titled = updateLeafMeta(tree, tree.first.id, { title: "helper" });

    const entries = collectPaneSwitcherEntries(titled);

    expect(entries.map((entry) => entry.paneId)).toEqual(collectLeafIds(titled));
    expect(entries.map((entry) => entry.label)).toEqual(["helper", "@build"]);
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

describe("pane identity metadata", () => {
  it("updates a leaf title without changing its id", () => {
    const leaf = createLeaf("powershell");
    const next = updateLeafMeta(leaf, leaf.id, { title: "reviewer" });
    expect(next.type).toBe("terminal");
    if (next.type === "terminal") {
      expect(next.id).toBe(leaf.id);
      expect(next.title).toBe("reviewer");
    }
  });

  it("cycles roles in a stable workstation order", () => {
    const leaf = createLeaf("powershell");
    const work = cycleLeafRole(leaf, leaf.id);
    expect(findLeaf(work, leaf.id)?.role).toBe("work");
    const plan = cycleLeafRole(work, leaf.id);
    expect(findLeaf(plan, leaf.id)?.role).toBe("plan");
  });

  it("normalizes and disambiguates pane titles for routing", () => {
    const a = createLeaf("powershell", undefined, { title: "Build" });
    const tree = splitPane(a, a.id, "right", "cmd");
    if (tree.type !== "split") throw new Error("expected split");
    const bId = tree.second.id;

    expect(normalizePaneTitle("  Build   ")).toBe("Build");
    expect(uniquePaneTitle(tree, bId, "build")).toBe("build 2");
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
