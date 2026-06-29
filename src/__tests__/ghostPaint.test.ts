import { describe, expect, it, vi } from "vitest";

import {
  classifyHunk,
  type DeltaDecoration,
  type GhostEditor,
  installGhostPaint,
  type MonacoNs,
  type RangeLike,
  type ViewZone,
  type ViewZoneAccessor,
} from "../features/editor/ghostPaint";
import type { DiffHunk, LayerTint } from "../shared/types/ghostdiff";

const tint: LayerTint = { roleColor: "#cba6f7", roleLabel: "impl" };

function hunk(
  baseStart: number,
  baseLen: number,
  lineKinds: ("add" | "remove" | "context")[],
  texts: string[] = [],
): DiffHunk {
  return {
    baseStart,
    baseLen,
    headStart: baseStart,
    headLen: baseLen,
    lines: lineKinds.map((k, i) => {
      const t = texts[i] ?? k[0];
      if (k === "add") return { kind: "add", text: t };
      if (k === "remove") return { kind: "remove", text: t };
      return { kind: "context", text: t };
    }),
  };
}

interface FakeDecoration extends DeltaDecoration {
  __id: string;
}

interface FakeZone extends ViewZone {
  __id: string;
}

function makeFakeEditor() {
  const added: FakeDecoration[] = [];
  const removedIds: string[] = [];
  const zonesAdded: FakeZone[] = [];
  const zonesRemoved: string[] = [];
  let nextDecorationId = 1;
  let nextZoneId = 1;

  const accessor: ViewZoneAccessor = {
    addZone(zone) {
      const id = `zone-${nextZoneId++}`;
      zonesAdded.push({ ...zone, __id: id });
      return id;
    },
    removeZone(id) {
      zonesRemoved.push(id);
    },
  };

  const editor: GhostEditor = {
    deltaDecorations(oldIds, newDecorations) {
      removedIds.push(...oldIds);
      const ids: string[] = [];
      for (const d of newDecorations) {
        const id = `dec-${nextDecorationId++}`;
        added.push({ ...d, __id: id });
        ids.push(id);
      }
      return ids;
    },
    changeViewZones(cb) {
      cb(accessor);
    },
  };

  return { editor, added, removedIds, zonesAdded, zonesRemoved };
}

const monaco: MonacoNs = {
  Range: class implements RangeLike {
    startLineNumber: number;
    startColumn: number;
    endLineNumber: number;
    endColumn: number;
    constructor(sl: number, sc: number, el: number, ec: number) {
      this.startLineNumber = sl;
      this.startColumn = sc;
      this.endLineNumber = el;
      this.endColumn = ec;
    }
  } as unknown as MonacoNs["Range"],
};

describe("classifyHunk", () => {
  it("classifies pure-add hunks as add", () => {
    expect(classifyHunk(hunk(10, 0, ["add", "add"]))).toBe("add");
  });

  it("classifies pure-delete hunks as delete", () => {
    expect(classifyHunk(hunk(10, 2, ["remove", "remove"]))).toBe("delete");
  });

  it("classifies mixed hunks as mixed", () => {
    expect(classifyHunk(hunk(10, 2, ["remove", "add"]))).toBe("mixed");
  });

  it("classifies context-only hunks as empty", () => {
    expect(classifyHunk(hunk(10, 2, ["context", "context"]))).toBe("empty");
  });
});

describe("installGhostPaint", () => {
  it("adds a view zone per pure-add hunk", () => {
    const { editor, zonesAdded, added } = makeFakeEditor();
    const handle = installGhostPaint(editor, monaco, {
      hunks: [hunk(10, 0, ["add", "add"], ["new-1", "new-2"])],
      tint,
      layerId: "layer-a",
    });
    expect(zonesAdded).toHaveLength(1);
    expect(zonesAdded[0].heightInLines).toBe(2);
    expect(zonesAdded[0].afterLineNumber).toBe(10);
    expect(added).toHaveLength(0); // no decorations for pure-add
    expect(handle.paintedIndices).toEqual([0]);
    expect(handle.deferredIndices).toEqual([]);
  });

  it("adds a whole-line strikethrough decoration per pure-delete hunk", () => {
    const { editor, added, zonesAdded } = makeFakeEditor();
    const handle = installGhostPaint(editor, monaco, {
      hunks: [hunk(5, 3, ["remove", "remove", "remove"])],
      tint,
      layerId: "layer-b",
    });
    expect(zonesAdded).toHaveLength(0);
    expect(added).toHaveLength(1);
    const dec = added[0];
    expect(dec.options.isWholeLine).toBe(true);
    expect(dec.options.className).toBe("aelyris-ghost-delete-line");
    expect(dec.range.startLineNumber).toBe(5);
    expect(dec.range.endLineNumber).toBe(7);
    expect(handle.paintedIndices).toEqual([0]);
  });

  it("routes mixed hunks to a gutter-only glyph and reports deferredIndices", () => {
    const { editor, added, zonesAdded } = makeFakeEditor();
    const handle = installGhostPaint(editor, monaco, {
      hunks: [hunk(20, 2, ["remove", "add"])],
      tint,
      layerId: "layer-c",
    });
    expect(zonesAdded).toHaveLength(0);
    expect(added).toHaveLength(1);
    expect(added[0].options.linesDecorationsClassName).toBe("aelyris-ghost-modify-gutter");
    expect(handle.deferredIndices).toEqual([0]);
    expect(handle.paintedIndices).toEqual([]);
  });

  it("skips hunks whose indices are in skipHunkIndices", () => {
    const { editor, added, zonesAdded } = makeFakeEditor();
    const handle = installGhostPaint(editor, monaco, {
      hunks: [hunk(5, 0, ["add"], ["new"]), hunk(20, 2, ["remove", "remove"])],
      tint,
      skipHunkIndices: new Set([0]),
      layerId: "layer-d",
    });
    expect(zonesAdded).toHaveLength(0); // add hunk skipped
    expect(added).toHaveLength(1); // delete hunk painted
    expect(handle.paintedIndices).toEqual([1]);
  });

  it("writes the tint color into the add-zone DOM for role coloring", () => {
    const { editor, zonesAdded } = makeFakeEditor();
    installGhostPaint(editor, monaco, {
      hunks: [hunk(10, 0, ["add"], ["hello"])],
      tint: { roleColor: "#ff5555", roleLabel: "test" },
      layerId: "layer-e",
    });
    const node = zonesAdded[0].domNode;
    expect(node.style.getPropertyValue("--aelyris-ghost-tint")).toBe("#ff5555");
    expect(node.dataset.aelyrisLayer).toBe("layer-e");
    expect(node.textContent).toContain("hello");
  });

  it("dispose removes decorations and zones it installed", () => {
    const { editor, removedIds, zonesRemoved } = makeFakeEditor();
    const handle = installGhostPaint(editor, monaco, {
      hunks: [hunk(5, 0, ["add"], ["added"]), hunk(10, 2, ["remove", "remove"])],
      tint,
      layerId: "layer-f",
    });
    handle.dispose();
    // One delete decoration installed → one id cleared.
    expect(removedIds.length).toBe(1);
    // One add zone installed → one removal recorded.
    expect(zonesRemoved.length).toBe(1);
  });

  it("no-ops cleanly when given zero hunks", () => {
    const { editor, added, zonesAdded } = makeFakeEditor();
    const handle = installGhostPaint(editor, monaco, {
      hunks: [],
      tint,
      layerId: "layer-g",
    });
    expect(added).toHaveLength(0);
    expect(zonesAdded).toHaveLength(0);
    expect(handle.paintedIndices).toEqual([]);
    expect(handle.deferredIndices).toEqual([]);
    // dispose must not throw even when nothing was installed.
    expect(() => handle.dispose()).not.toThrow();
  });

  it("suppresses mouse-down on the phantom zone", () => {
    const { editor, zonesAdded } = makeFakeEditor();
    installGhostPaint(editor, monaco, {
      hunks: [hunk(10, 0, ["add"], ["x"])],
      tint,
      layerId: "layer-h",
    });
    expect(zonesAdded[0].suppressMouseDown).toBe(true);
  });
});

describe("installGhostPaint tint label in hover", () => {
  it("includes the role label in hover messages", () => {
    const { editor, added } = makeFakeEditor();
    installGhostPaint(editor, monaco, {
      hunks: [hunk(5, 1, ["remove"])],
      tint: { roleColor: "#fab387", roleLabel: "repair" },
      layerId: "layer-hover",
    });
    expect(added[0].options.hoverMessage?.value).toContain("repair");
  });

  // Unused silence: quiet vi import linter in case no spies are created.
  it("has vi available", () => {
    expect(vi).toBeDefined();
  });
});
