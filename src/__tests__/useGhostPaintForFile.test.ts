import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  computeRelativePath,
  useGhostPaintForFile,
} from "../features/editor/useGhostPaintForFile";
import type {
  FileDelta,
  LayerSummary,
} from "../shared/types/ghostdiff";
import type { LineRange } from "../features/editor/ghostConflict";
import type {
  DeltaDecoration,
  GhostEditor,
  MonacoNs,
  RangeLike,
  ViewZone,
  ViewZoneAccessor,
} from "../features/editor/ghostPaint";

describe("computeRelativePath", () => {
  it("returns null for a null filePath", () => {
    expect(computeRelativePath(null, "/repo")).toBeNull();
  });

  it("strips the project prefix and normalizes slashes", () => {
    expect(
      computeRelativePath(
        "C:\\Users\\owner\\Aether_Terminal\\src\\App.tsx",
        "C:\\Users\\owner\\Aether_Terminal",
      ),
    ).toBe("src/App.tsx");
  });

  it("handles posix paths without mutation", () => {
    expect(computeRelativePath("/repo/src/a.ts", "/repo")).toBe("src/a.ts");
  });

  it("handles projectPath with a trailing slash", () => {
    expect(computeRelativePath("/repo/src/a.ts", "/repo/")).toBe("src/a.ts");
  });

  it("returns null when the file is outside the project", () => {
    expect(
      computeRelativePath("/other/src/a.ts", "/repo"),
    ).toBeNull();
  });

  it("matches case-insensitively (Windows)", () => {
    expect(
      computeRelativePath(
        "C:\\Users\\OWNER\\project\\src\\a.ts",
        "C:\\Users\\owner\\project",
      ),
    ).toBe("src/a.ts");
  });

  it("returns the file as-is when no projectPath is provided", () => {
    expect(computeRelativePath("/abs/path/a.ts", null)).toBe("abs/path/a.ts");
  });
});

// ─── Hook integration tests ─────────────────────────────────────────────────

type ListenHandler<T> = (event: { payload: T }) => void;

const invokeMock = vi.fn();
const listeners: Record<string, ListenHandler<unknown>> = {};
const unlistenMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: Record<string, unknown>) =>
    invokeMock(cmd, args),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn((evt: string, handler: ListenHandler<unknown>) => {
    listeners[evt] = handler;
    return Promise.resolve(unlistenMock);
  }),
}));

function makeLayer(
  id: string,
  filePaths: string[],
  overrides: Partial<LayerSummary> = {},
): LayerSummary {
  // Default `isComplete: true` so paint tests exercise the ghost pass
  // without needing liveMode. Incomplete layers are covered explicitly by
  // the live-mode tests.
  return {
    id,
    source: {
      kind: "worktree",
      path: `/tmp/wt/${id}`,
      branch: `b/${id}`,
      repoPath: "/tmp/repo",
    },
    tint: { roleColor: "#cba6f7", roleLabel: "impl" },
    isComplete: true,
    createdAt: 0,
    fileCount: filePaths.length,
    hunkCount: filePaths.length,
    filePaths,
    ...overrides,
  };
}

function makeDelta(path: string): FileDelta {
  return {
    path,
    baseContent: "",
    headContent: "",
    hunks: [
      {
        baseStart: 10,
        baseLen: 0,
        headStart: 10,
        headLen: 1,
        lines: [{ kind: "add", text: "new" }],
      },
    ],
  };
}

function makeFakeEditor(): {
  editor: GhostEditor;
  monaco: MonacoNs;
  zoneAddCount: () => number;
  disposeThrows: { decoration: boolean; zone: boolean };
} {
  let zoneAddCount = 0;
  const disposeThrows = { decoration: false, zone: false };

  const accessor: ViewZoneAccessor = {
    addZone: (_z: ViewZone) => {
      zoneAddCount++;
      return `zone-${zoneAddCount}`;
    },
    removeZone: () => {
      if (disposeThrows.zone) throw new Error("editor disposed");
    },
  };

  const editor: GhostEditor = {
    deltaDecorations(_old: string[], newDecs: DeltaDecoration[]): string[] {
      if (disposeThrows.decoration && newDecs.length === 0) {
        throw new Error("editor disposed");
      }
      return newDecs.map((_d, i) => `dec-${i}`);
    },
    changeViewZones(cb) {
      cb(accessor);
    },
  };

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

  return { editor, monaco, zoneAddCount: () => zoneAddCount, disposeThrows };
}

describe("useGhostPaintForFile (integration)", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    unlistenMock.mockReset();
    for (const k of Object.keys(listeners)) delete listeners[k];
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("paints ghost hunks when a layer matches the open file", async () => {
    invokeMock.mockImplementation((cmd: string, args: Record<string, unknown>) => {
      if (cmd === "list_ghost_layers") {
        return Promise.resolve([makeLayer("l1", ["src/foo.ts"])]);
      }
      if (cmd === "get_ghost_layer_file") {
        expect(args.filePath).toBe("src/foo.ts");
        return Promise.resolve(makeDelta("src/foo.ts"));
      }
      return Promise.reject(new Error(`unexpected ${cmd}`));
    });

    const fake = makeFakeEditor();
    const { result } = renderHook(() =>
      useGhostPaintForFile({
        editor: fake.editor,
        monaco: fake.monaco,
        filePath: "/repo/src/foo.ts",
        projectPath: "/repo",
      }),
    );

    await waitFor(() => expect(result.current.layerCount).toBe(1));
    expect(fake.zoneAddCount()).toBe(1);
    expect(result.current.conflictCount).toBe(0);
  });

  it("reports conflictCount when user dirty ranges overlap a hunk", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "list_ghost_layers") {
        return Promise.resolve([makeLayer("l1", ["src/foo.ts"])]);
      }
      if (cmd === "get_ghost_layer_file") {
        return Promise.resolve(makeDelta("src/foo.ts"));
      }
      return Promise.reject(new Error(`unexpected ${cmd}`));
    });

    let push: ((r: LineRange[]) => void) | null = null;
    const subscribe = (listener: (r: LineRange[]) => void) => {
      push = listener;
      return () => {
        push = null;
      };
    };

    const fake = makeFakeEditor();
    const { result } = renderHook(() =>
      useGhostPaintForFile({
        editor: fake.editor,
        monaco: fake.monaco,
        filePath: "/repo/src/foo.ts",
        projectPath: "/repo",
        subscribeToModelChanges: subscribe,
      }),
    );

    await waitFor(() => expect(result.current.layerCount).toBe(1));
    // Dirty line 10 overlaps the sole hunk (baseStart=10, baseLen=0 → anchor 10).
    await act(async () => {
      push?.([{ start: 10, end: 10 }]);
    });
    await waitFor(() => expect(result.current.conflictCount).toBe(1));
    expect(result.current.layerCount).toBe(1);
  });

  it("clears dirty ranges when filePath changes so stale state cannot bleed", async () => {
    invokeMock.mockImplementation((cmd: string, args: Record<string, unknown>) => {
      if (cmd === "list_ghost_layers") {
        return Promise.resolve([
          makeLayer("l1", ["src/a.ts"]),
          makeLayer("l2", ["src/b.ts"]),
        ]);
      }
      if (cmd === "get_ghost_layer_file") {
        return Promise.resolve(makeDelta(args.filePath as string));
      }
      return Promise.reject(new Error(`unexpected ${cmd}`));
    });

    let push: ((r: LineRange[]) => void) | null = null;
    const subscribe = (listener: (r: LineRange[]) => void) => {
      push = listener;
      return () => {
        push = null;
      };
    };

    const fake = makeFakeEditor();
    const { result, rerender } = renderHook(
      (props: { filePath: string }) =>
        useGhostPaintForFile({
          editor: fake.editor,
          monaco: fake.monaco,
          filePath: props.filePath,
          projectPath: "/repo",
          subscribeToModelChanges: subscribe,
        }),
      { initialProps: { filePath: "/repo/src/a.ts" } },
    );

    await waitFor(() => expect(result.current.layerCount).toBe(1));
    await act(async () => {
      push?.([{ start: 10, end: 10 }]);
    });
    await waitFor(() => expect(result.current.conflictCount).toBe(1));

    // Switch file: dirty ranges must reset, new file gets fresh paint.
    rerender({ filePath: "/repo/src/b.ts" });
    await waitFor(() =>
      expect(result.current.conflictCount === 0 && result.current.layerCount === 1).toBe(
        true,
      ),
    );
  });

  it("reports zero layers when the open file is outside the project", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "list_ghost_layers") {
        return Promise.resolve([makeLayer("l1", ["src/a.ts"])]);
      }
      return Promise.reject(new Error(`unexpected ${cmd}`));
    });

    const fake = makeFakeEditor();
    const { result } = renderHook(() =>
      useGhostPaintForFile({
        editor: fake.editor,
        monaco: fake.monaco,
        filePath: "/elsewhere/src/a.ts",
        projectPath: "/repo",
      }),
    );

    // Let the initial hydrate settle. No paint should happen.
    await waitFor(() => {
      expect(result.current.layerCount).toBe(0);
    });
    expect(fake.zoneAddCount()).toBe(0);
  });

  it("does not anchor read-only (branch comparison) layers for accept", async () => {
    // Branch comparison layers should still paint, but Tab / Shift+Tab must
    // not be armed against them.
    const roLayer: LayerSummary = {
      id: "bc1",
      source: {
        kind: "branchComparison",
        repoPath: "/tmp/repo",
        baseBranch: "main",
        headBranch: "feature",
      },
      tint: { roleColor: "#89dceb", roleLabel: "branch" },
      isComplete: true,
      createdAt: 0,
      fileCount: 1,
      hunkCount: 1,
      filePaths: ["src/foo.ts"],
    };
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "list_ghost_layers") {
        return Promise.resolve([roLayer]);
      }
      if (cmd === "get_ghost_layer_file") {
        return Promise.resolve(makeDelta("src/foo.ts"));
      }
      return Promise.reject(new Error(`unexpected ${cmd}`));
    });

    const fake = makeFakeEditor();
    const { result } = renderHook(() =>
      useGhostPaintForFile({
        editor: fake.editor,
        monaco: fake.monaco,
        filePath: "/repo/src/foo.ts",
        projectPath: "/repo",
      }),
    );

    await waitFor(() => expect(result.current.layerCount).toBe(1));
    // Paint did happen (layerCount=1, zone added) but no accept anchors.
    expect(fake.zoneAddCount()).toBe(1);
    expect(result.current.hasHunkAtLine(10)).toBe(false);
    expect(result.current.hunksAtLine(10)).toHaveLength(0);

    // acceptAllInFile must also skip the layer — no apply IPC fired.
    const next = await act(() => result.current.acceptAllInFile());
    expect(next).toBeNull();
    expect(
      invokeMock.mock.calls.some(([cmd]) => cmd === "apply_ghost_file"),
    ).toBe(false);
  });

  it("hasHunkAtLine / hunksAtLine resolve the anchor at the base line", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "list_ghost_layers") {
        return Promise.resolve([makeLayer("l1", ["src/foo.ts"])]);
      }
      if (cmd === "get_ghost_layer_file") {
        return Promise.resolve(makeDelta("src/foo.ts"));
      }
      return Promise.reject(new Error(`unexpected ${cmd}`));
    });

    const fake = makeFakeEditor();
    const { result } = renderHook(() =>
      useGhostPaintForFile({
        editor: fake.editor,
        monaco: fake.monaco,
        filePath: "/repo/src/foo.ts",
        projectPath: "/repo",
      }),
    );

    await waitFor(() => expect(result.current.layerCount).toBe(1));
    // makeDelta creates a pure-add hunk anchored at line 10.
    expect(result.current.hasHunkAtLine(10)).toBe(true);
    expect(result.current.hasHunkAtLine(5)).toBe(false);

    const hits = result.current.hunksAtLine(10);
    expect(hits).toHaveLength(1);
    expect(hits[0].layerId).toBe("l1");
    expect(hits[0].hunkIndex).toBe(0);
  });

  it("acceptHunkAtLine invokes apply_ghost_hunk and returns updated content", async () => {
    invokeMock.mockImplementation((cmd: string, args: Record<string, unknown>) => {
      if (cmd === "list_ghost_layers") {
        return Promise.resolve([makeLayer("l1", ["src/foo.ts"])]);
      }
      if (cmd === "get_ghost_layer_file") {
        return Promise.resolve(makeDelta("src/foo.ts"));
      }
      if (cmd === "apply_ghost_hunk") {
        expect(args.layerId).toBe("l1");
        expect(args.filePath).toBe("src/foo.ts");
        expect(args.hunkIndex).toBe(0);
        return Promise.resolve({
          updatedContent: "patched body",
          filePath: "/repo/src/foo.ts",
          remainingHunks: 0,
        });
      }
      return Promise.reject(new Error(`unexpected ${cmd}`));
    });

    const fake = makeFakeEditor();
    const { result } = renderHook(() =>
      useGhostPaintForFile({
        editor: fake.editor,
        monaco: fake.monaco,
        filePath: "/repo/src/foo.ts",
        projectPath: "/repo",
      }),
    );

    await waitFor(() => expect(result.current.layerCount).toBe(1));
    const next = await act(() => result.current.acceptHunkAtLine(10));
    expect(next).toBe("patched body");
  });

  it("acceptHunkAtLine drops the second concurrent call (in-flight lock)", async () => {
    let resolveApply!: (v: unknown) => void;
    const applyPromise = new Promise((res) => {
      resolveApply = res;
    });
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "list_ghost_layers") {
        return Promise.resolve([makeLayer("l1", ["src/foo.ts"])]);
      }
      if (cmd === "get_ghost_layer_file") {
        return Promise.resolve(makeDelta("src/foo.ts"));
      }
      if (cmd === "apply_ghost_hunk") {
        // First call hangs until we release it — gives us a window for
        // the second call to race past. With the in-flight lock the
        // second call must return null without invoking the backend.
        return applyPromise;
      }
      return Promise.reject(new Error(`unexpected ${cmd}`));
    });

    const fake = makeFakeEditor();
    const { result } = renderHook(() =>
      useGhostPaintForFile({
        editor: fake.editor,
        monaco: fake.monaco,
        filePath: "/repo/src/foo.ts",
        projectPath: "/repo",
      }),
    );

    await waitFor(() => expect(result.current.layerCount).toBe(1));

    // Fire both without awaiting the first — simulates Tab burst.
    const firstPromise = result.current.acceptHunkAtLine(10);
    const second = await result.current.acceptHunkAtLine(10);
    expect(second).toBeNull();
    // Only one apply_ghost_hunk call must have hit the backend.
    const applyCalls = invokeMock.mock.calls.filter(
      ([cmd]) => cmd === "apply_ghost_hunk",
    );
    expect(applyCalls).toHaveLength(1);

    // Let the first one finish so the test doesn't dangle a promise.
    resolveApply({
      updatedContent: "patched",
      filePath: "/repo/src/foo.ts",
      remainingHunks: 0,
    });
    await firstPromise;
  });

  it("acceptHunkAtLine returns null when no hunk anchors the line", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "list_ghost_layers") {
        return Promise.resolve([makeLayer("l1", ["src/foo.ts"])]);
      }
      if (cmd === "get_ghost_layer_file") {
        return Promise.resolve(makeDelta("src/foo.ts"));
      }
      return Promise.reject(new Error(`unexpected ${cmd}`));
    });

    const fake = makeFakeEditor();
    const { result } = renderHook(() =>
      useGhostPaintForFile({
        editor: fake.editor,
        monaco: fake.monaco,
        filePath: "/repo/src/foo.ts",
        projectPath: "/repo",
      }),
    );

    await waitFor(() => expect(result.current.layerCount).toBe(1));
    const next = await act(() => result.current.acceptHunkAtLine(999));
    expect(next).toBeNull();
    // apply_ghost_hunk must not be invoked.
    expect(
      invokeMock.mock.calls.some(([cmd]) => cmd === "apply_ghost_hunk"),
    ).toBe(false);
  });

  it("acceptAllInFile invokes apply_ghost_file once per layer", async () => {
    invokeMock.mockImplementation((cmd: string, args: Record<string, unknown>) => {
      if (cmd === "list_ghost_layers") {
        return Promise.resolve([
          makeLayer("l1", ["src/foo.ts"]),
          makeLayer("l2", ["src/foo.ts"]),
        ]);
      }
      if (cmd === "get_ghost_layer_file") {
        return Promise.resolve(makeDelta("src/foo.ts"));
      }
      if (cmd === "apply_ghost_file") {
        return Promise.resolve({
          updatedContent: `after-${args.layerId}`,
          filePath: "/repo/src/foo.ts",
          remainingHunks: 0,
        });
      }
      return Promise.reject(new Error(`unexpected ${cmd}`));
    });

    const fake = makeFakeEditor();
    const { result } = renderHook(() =>
      useGhostPaintForFile({
        editor: fake.editor,
        monaco: fake.monaco,
        filePath: "/repo/src/foo.ts",
        projectPath: "/repo",
      }),
    );

    await waitFor(() => expect(result.current.layerCount).toBe(2));
    const next = await act(() => result.current.acceptAllInFile());
    // Newest layer is applied last, so its updatedContent wins.
    expect(next).toBe("after-l2");

    const applyCalls = invokeMock.mock.calls.filter(
      ([cmd]) => cmd === "apply_ghost_file",
    );
    expect(applyCalls).toHaveLength(2);
  });

  it("dismissFileLayers invokes dismiss_ghost_file per layer with the relative path", async () => {
    invokeMock.mockImplementation((cmd: string, args?: Record<string, unknown>) => {
      if (cmd === "list_ghost_layers") {
        return Promise.resolve([
          makeLayer("l1", ["src/foo.ts", "src/bar.ts"]),
          makeLayer("l2", ["src/foo.ts"]),
        ]);
      }
      if (cmd === "get_ghost_layer_file") {
        return Promise.resolve(makeDelta("src/foo.ts"));
      }
      if (cmd === "dismiss_ghost_file") {
        // Must target only the open file, never the layer wholesale.
        expect(args?.filePath).toBe("src/foo.ts");
        return Promise.resolve(true);
      }
      if (cmd === "dismiss_ghost_layer") {
        throw new Error("dismiss_ghost_layer must not be called from Esc");
      }
      return Promise.reject(new Error(`unexpected ${cmd}`));
    });

    const fake = makeFakeEditor();
    const { result } = renderHook(() =>
      useGhostPaintForFile({
        editor: fake.editor,
        monaco: fake.monaco,
        filePath: "/repo/src/foo.ts",
        projectPath: "/repo",
      }),
    );

    await waitFor(() => expect(result.current.layerCount).toBe(2));
    const count = await act(() => result.current.dismissFileLayers());
    expect(count).toBe(2);
    const dismissCalls = invokeMock.mock.calls.filter(
      ([cmd]) => cmd === "dismiss_ghost_file",
    );
    expect(dismissCalls).toHaveLength(2);
  });

  it("dismissFileLayers reports only layers that actually cleared", async () => {
    invokeMock.mockImplementation((cmd: string, args?: Record<string, unknown>) => {
      if (cmd === "list_ghost_layers") {
        return Promise.resolve([
          makeLayer("l1", ["src/foo.ts"]),
          makeLayer("l2", ["src/foo.ts"]),
        ]);
      }
      if (cmd === "get_ghost_layer_file") {
        return Promise.resolve(makeDelta("src/foo.ts"));
      }
      if (cmd === "dismiss_ghost_file") {
        // l1 already had no hunks (e.g. racing mark-complete); l2 clears.
        return Promise.resolve(args?.layerId === "l2");
      }
      return Promise.reject(new Error(`unexpected ${cmd}`));
    });

    const fake = makeFakeEditor();
    const { result } = renderHook(() =>
      useGhostPaintForFile({
        editor: fake.editor,
        monaco: fake.monaco,
        filePath: "/repo/src/foo.ts",
        projectPath: "/repo",
      }),
    );

    await waitFor(() => expect(result.current.layerCount).toBe(2));
    const count = await act(() => result.current.dismissFileLayers());
    expect(count).toBe(1);
  });

  it("skips in-progress layers by default (live mode off)", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "list_ghost_layers") {
        return Promise.resolve([
          makeLayer("l1", ["src/foo.ts"], { isComplete: false }),
        ]);
      }
      if (cmd === "get_ghost_layer_file") {
        return Promise.resolve(makeDelta("src/foo.ts"));
      }
      return Promise.reject(new Error(`unexpected ${cmd}`));
    });

    const fake = makeFakeEditor();
    const { result } = renderHook(() =>
      useGhostPaintForFile({
        editor: fake.editor,
        monaco: fake.monaco,
        filePath: "/repo/src/foo.ts",
        projectPath: "/repo",
        // liveMode omitted → defaults to false
      }),
    );

    // Wait long enough for any paint pass. layerCount must stay 0.
    await waitFor(() => {
      expect(result.current.layerCount).toBe(0);
    });
    expect(fake.zoneAddCount()).toBe(0);
  });

  it("paints in-progress layers when live mode is on", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "list_ghost_layers") {
        return Promise.resolve([
          makeLayer("l1", ["src/foo.ts"], { isComplete: false }),
        ]);
      }
      if (cmd === "get_ghost_layer_file") {
        return Promise.resolve(makeDelta("src/foo.ts"));
      }
      return Promise.reject(new Error(`unexpected ${cmd}`));
    });

    const fake = makeFakeEditor();
    const { result } = renderHook(() =>
      useGhostPaintForFile({
        editor: fake.editor,
        monaco: fake.monaco,
        filePath: "/repo/src/foo.ts",
        projectPath: "/repo",
        liveMode: true,
      }),
    );

    await waitFor(() => expect(result.current.layerCount).toBe(1));
    expect(fake.zoneAddCount()).toBe(1);
  });

  it("swallows editor-disposed exceptions during paint teardown", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "list_ghost_layers") {
        return Promise.resolve([makeLayer("l1", ["src/a.ts"])]);
      }
      if (cmd === "get_ghost_layer_file") {
        return Promise.resolve(makeDelta("src/a.ts"));
      }
      return Promise.reject(new Error(`unexpected ${cmd}`));
    });

    const fake = makeFakeEditor();
    const { result, unmount } = renderHook(() =>
      useGhostPaintForFile({
        editor: fake.editor,
        monaco: fake.monaco,
        filePath: "/repo/src/a.ts",
        projectPath: "/repo",
      }),
    );

    await waitFor(() => expect(result.current.layerCount).toBe(1));
    // Simulate the Monaco editor being torn down before the hook unmounts.
    fake.disposeThrows.decoration = true;
    fake.disposeThrows.zone = true;
    // Must not throw.
    expect(() => unmount()).not.toThrow();
  });
});
