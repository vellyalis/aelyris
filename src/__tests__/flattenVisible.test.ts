import { describe, expect, it } from "vitest";
import { type FlattenEntry, flattenVisible } from "../features/file-tree/flattenVisible";

// Shorthand helpers so each test case reads like a small file-tree literal.
const dir = (name: string, path: string, file_type = "folder"): FlattenEntry => ({
  name,
  path,
  is_dir: true,
  file_type,
});
const file = (name: string, path: string, file_type = "ts"): FlattenEntry => ({
  name,
  path,
  is_dir: false,
  file_type,
});

describe("flattenVisible", () => {
  it("returns empty array when the root has no contents entry yet", () => {
    expect(flattenVisible("/p", new Map(), new Set())).toEqual([]);
  });

  it("returns the root's immediate children at depth 0 when nothing is expanded", () => {
    const entries = new Map([["/p", [dir("src", "/p/src"), file("README.md", "/p/README.md")]]]);
    const flat = flattenVisible("/p", entries, new Set());
    expect(flat.map((f) => f.path)).toEqual(["/p/src", "/p/README.md"]);
    expect(flat.every((f) => f.depth === 0)).toBe(true);
    // Parent is always the walked dir (root) at depth 0.
    expect(flat.every((f) => f.parent === "/p")).toBe(true);
  });

  it("skips children of a dir that is not in the expanded set", () => {
    const entries = new Map([
      ["/p", [dir("src", "/p/src")]],
      ["/p/src", [file("a.ts", "/p/src/a.ts")]],
    ]);
    const flat = flattenVisible("/p", entries, new Set());
    expect(flat.map((f) => f.path)).toEqual(["/p/src"]);
    expect(flat[0].isOpen).toBe(false);
  });

  it("walks into an expanded directory and assigns depth + parent correctly", () => {
    const entries = new Map([
      ["/p", [dir("src", "/p/src"), file("README.md", "/p/README.md")]],
      ["/p/src", [file("a.ts", "/p/src/a.ts"), dir("nested", "/p/src/nested")]],
      ["/p/src/nested", [file("deep.ts", "/p/src/nested/deep.ts")]],
    ]);
    const expanded = new Set(["/p/src", "/p/src/nested"]);
    const flat = flattenVisible("/p", entries, expanded);
    expect(flat).toEqual([
      expect.objectContaining({ path: "/p/src", depth: 0, isOpen: true, parent: "/p" }),
      expect.objectContaining({ path: "/p/src/a.ts", depth: 1, isOpen: false, parent: "/p/src" }),
      expect.objectContaining({ path: "/p/src/nested", depth: 1, isOpen: true, parent: "/p/src" }),
      expect.objectContaining({ path: "/p/src/nested/deep.ts", depth: 2, isOpen: false, parent: "/p/src/nested" }),
      expect.objectContaining({ path: "/p/README.md", depth: 0, isOpen: false, parent: "/p" }),
    ]);
  });

  it("stops walking a subtree whose contents haven't been loaded", () => {
    // `/p/src` is marked expanded but we haven't loaded its children yet —
    // the loading state shouldn't produce phantom rows or throw.
    const entries = new Map([["/p", [dir("src", "/p/src"), file("README.md", "/p/README.md")]]]);
    const flat = flattenVisible("/p", entries, new Set(["/p/src"]));
    expect(flat.map((f) => f.path)).toEqual(["/p/src", "/p/README.md"]);
    // isOpen still reflects the expanded set even though children haven't
    // arrived — so the UI can show the caret chevron in the open orientation.
    expect(flat[0].isOpen).toBe(true);
  });

  it("preserves the child order that the backend returned", () => {
    // No sorting should happen here — the backend picks the ordering and
    // the flat projection just mirrors it.
    const entries = new Map([["/p", [file("z.ts", "/p/z.ts"), file("a.ts", "/p/a.ts"), file("m.ts", "/p/m.ts")]]]);
    const flat = flattenVisible("/p", entries, new Set());
    expect(flat.map((f) => f.name)).toEqual(["z.ts", "a.ts", "m.ts"]);
  });

  it("supports being re-rooted at a subdirectory", () => {
    // When the user clicks into a subdirectory, `currentRoot` shifts and
    // the flat projection walks from there — no ancestor rows.
    const entries = new Map([
      ["/p", [dir("src", "/p/src")]],
      ["/p/src", [file("a.ts", "/p/src/a.ts")]],
    ]);
    const flat = flattenVisible("/p/src", entries, new Set());
    expect(flat.map((f) => f.path)).toEqual(["/p/src/a.ts"]);
    expect(flat[0].depth).toBe(0);
    expect(flat[0].parent).toBe("/p/src");
  });
});
