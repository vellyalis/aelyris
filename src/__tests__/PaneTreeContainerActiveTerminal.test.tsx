import { act, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PaneAttachRequest, PaneRestartRequest } from "../features/terminal/pane-tree/PaneTreeContainer";
import { PaneTreeContainer } from "../features/terminal/pane-tree/PaneTreeContainer";
import type { PaneLifecycleState, PaneNode, SplitDirection } from "../features/terminal/pane-tree/types";
import { FALLBACK_TELEMETRY_EVENT, type FallbackTelemetryDetail } from "../shared/lib/fallbackTelemetry";

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

// PaneTreeRenderer mounts NativeTerminalArea / IMEInputBar / ResizeObserver
// and is far too heavy for a callback regression test. Replace it with a
// passthrough that captures the latest props so the test can call
// `onTerminalReady` / `onFocusPane` / `onSplit` directly and observe the
// container's contract for `onActiveTerminalChange`.
interface CapturedProps {
  tree: PaneNode;
  activePaneId: string | null;
  terminalIds: Map<string, string>;
  synchronizedPanes?: boolean;
  onFocusPane: (id: string) => void;
  onSplit: (id: string, direction: SplitDirection) => void;
  onClose: (id: string) => void;
  onRenamePane: (id: string, title: string | null) => void;
  onCyclePaneRole: (id: string) => void;
  onToggleMaximize: (id: string) => void;
  onTerminalReady: (paneId: string, terminalId: string) => void;
  onLayoutCommand?: (
    command:
      | "equalize"
      | "even-horizontal"
      | "even-vertical"
      | "tiled"
      | "move-next"
      | "move-previous"
      | "rotate-next"
      | "rotate-previous"
      | "sync-panes-on"
      | "sync-panes-off",
  ) => void;
  onPaneLifecycleChange?: (paneId: string, lifecycle: PaneLifecycleState) => void;
  restartPaneRequest?: PaneRestartRequest | null;
  attachPaneRequest?: PaneAttachRequest | null;
  suspendTerminalMounts?: boolean;
}

let captured: CapturedProps | null = null;

vi.mock("../features/terminal/pane-tree/PaneTreeRenderer", () => ({
  PaneTreeRenderer: (props: CapturedProps) => {
    captured = props;
    return null;
  },
}));

function leafIds(node: PaneNode): string[] {
  if (node.type === "terminal") return [node.id];
  return [...leafIds(node.first), ...leafIds(node.second)];
}

function firstLeafId(node: PaneNode): string {
  const [id] = leafIds(node);
  if (!id) throw new Error("expected at least one pane");
  return id;
}

function differentLeafId(ids: string[], current: string): string {
  const id = ids.find((candidate) => candidate !== current);
  if (!id) throw new Error("expected a different pane id");
  return id;
}

function collectFallbackEvents() {
  const events: FallbackTelemetryDetail[] = [];
  const listener = (event: Event) => {
    events.push((event as CustomEvent<FallbackTelemetryDetail>).detail);
  };
  window.addEventListener(FALLBACK_TELEMETRY_EVENT, listener);
  return {
    events,
    cleanup: () => window.removeEventListener(FALLBACK_TELEMETRY_EVENT, listener),
  };
}

function findLeaf(node: PaneNode, paneId: string): Extract<PaneNode, { type: "terminal" }> | null {
  if (node.type === "terminal") return node.id === paneId ? node : null;
  return findLeaf(node.first, paneId) ?? findLeaf(node.second, paneId);
}

let muxSplitCounter = 0;

async function splitAndFlush(c: CapturedProps, paneId: string, direction: SplitDirection): Promise<CapturedProps> {
  await act(async () => {
    const latest = (captured as unknown as CapturedProps) ?? c;
    latest.onSplit(paneId, direction);
    await Promise.resolve();
    await Promise.resolve();
  });
  return captured as unknown as CapturedProps;
}

describe("PaneTreeContainer onActiveTerminalChange", () => {
  beforeEach(() => {
    localStorage.clear();
    muxSplitCounter = 0;
    invokeMock.mockReset();
    invokeMock.mockImplementation((command: string) => {
      if (command === "get_pane_tree_layout") return Promise.resolve(null);
      if (command === "list_terminals") return Promise.resolve([]);
      if (command === "mux_split_pane") return Promise.resolve(`pty-mux-${++muxSplitCounter}`);
      if (command === "mux_close_pane") return Promise.resolve(undefined);
      if (command === "mux_set_pane_zoom") return Promise.resolve(undefined);
      return Promise.resolve(undefined);
    });
  });

  afterEach(() => {
    captured = null;
    localStorage.clear();
  });

  it("reports null on mount before any pane has registered its PTY id", () => {
    const onChange = vi.fn();
    render(<PaneTreeContainer shell="powershell" onActiveTerminalChange={onChange} />);
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("falls back to the only-pane's PTY id when no pane is explicitly focused", () => {
    const onChange = vi.fn();
    render(<PaneTreeContainer shell="powershell" onActiveTerminalChange={onChange} />);
    const c = captured as unknown as CapturedProps;
    const initialPaneId = firstLeafId(c.tree);
    act(() => {
      c.onTerminalReady(initialPaneId, "pty-abc-123");
    });
    // Last call must be the real PTY id, not the pane id and not the
    // tab UUID — this is the wiring that the StatusBar inline-image
    // budget badge depends on.
    expect(onChange).toHaveBeenLastCalledWith("pty-abc-123");
  });

  it("reports pane registry entries in tree order as PTYs come online", async () => {
    const onRegistryChange = vi.fn();
    render(<PaneTreeContainer shell="powershell" cwd="C:/repo" onPaneRegistryChange={onRegistryChange} />);
    const c = captured as unknown as CapturedProps;
    const initialPaneId = firstLeafId(c.tree);

    await waitFor(() => {
      expect(onRegistryChange).toHaveBeenLastCalledWith([
        expect.objectContaining({
          paneId: initialPaneId,
          terminalId: null,
          lifecycle: "layout-only",
          index: 0,
          shell: "powershell",
          cwd: "C:/repo",
        }),
      ]);
    });

    act(() => {
      c.onTerminalReady(initialPaneId, "pty-live-1");
    });

    await waitFor(() => {
      expect(onRegistryChange).toHaveBeenLastCalledWith([
        expect.objectContaining({
          paneId: initialPaneId,
          terminalId: "pty-live-1",
          index: 0,
        }),
      ]);
    });
  });

  it("propagates pane lifecycle state into registry entries", async () => {
    const onRegistryChange = vi.fn();
    render(<PaneTreeContainer shell="powershell" onPaneRegistryChange={onRegistryChange} />);
    const c = captured as unknown as CapturedProps;
    const initialPaneId = firstLeafId(c.tree);

    act(() => {
      c.onTerminalReady(initialPaneId, "pty-live-1");
      c.onPaneLifecycleChange?.(initialPaneId, "crashed");
    });

    await waitFor(() => {
      expect(onRegistryChange).toHaveBeenLastCalledWith([
        expect.objectContaining({
          paneId: initialPaneId,
          terminalId: "pty-live-1",
          lifecycle: "crashed",
        }),
      ]);
    });
  });

  it("drops stale crashed PTY bindings before starting a replacement shell", async () => {
    const onRegistryChange = vi.fn();
    render(<PaneTreeContainer shell="powershell" onPaneRegistryChange={onRegistryChange} />);
    let c = captured as unknown as CapturedProps;
    const initialPaneId = firstLeafId(c.tree);

    act(() => {
      c.onTerminalReady(initialPaneId, "pty-crashed");
      c.onPaneLifecycleChange?.(initialPaneId, "crashed");
    });

    await waitFor(() => {
      c = captured as unknown as CapturedProps;
      expect(c.terminalIds.get(initialPaneId)).toBe("pty-crashed");
    });

    act(() => {
      c.onPaneLifecycleChange?.(initialPaneId, "starting");
    });

    await waitFor(() => {
      c = captured as unknown as CapturedProps;
      expect(c.terminalIds.has(initialPaneId)).toBe(false);
      expect(onRegistryChange).toHaveBeenLastCalledWith([
        expect.objectContaining({
          paneId: initialPaneId,
          terminalId: null,
          lifecycle: "starting",
        }),
      ]);
    });
  });

  it("focuses the mux-created split pane instead of leaving focus ambiguous", async () => {
    const onChange = vi.fn();
    render(<PaneTreeContainer shell="powershell" onActiveTerminalChange={onChange} />);
    let c = captured as unknown as CapturedProps;
    const firstId = firstLeafId(c.tree);
    act(() => {
      c.onTerminalReady(firstId, "pty-A");
    });
    expect(onChange).toHaveBeenLastCalledWith("pty-A");

    // Split → 2 panes. The new pane has not yet registered its PTY id.
    c = await splitAndFlush(c, firstId, "right");
    const ids = leafIds(c.tree);
    const newPaneId = differentLeafId(ids, firstId);
    act(() => {
      c.onTerminalReady(newPaneId, "pty-B");
    });
    // Rust-mux split returns the pane id that the UI attaches, and the new
    // pane becomes active like tmux/WezTerm split workflows.
    expect(onChange).toHaveBeenLastCalledWith("pty-B");
  });

  it("keeps pane splitting usable when the Rust mux split path rejects", async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === "get_pane_tree_layout") return Promise.resolve(null);
      if (command === "list_terminals") return Promise.resolve([]);
      if (command === "mux_split_pane") return Promise.reject(new Error("mux graph is stale"));
      return Promise.resolve(undefined);
    });
    render(<PaneTreeContainer shell="powershell" cwd="C:/projects/current" />);
    let c = captured as unknown as CapturedProps;
    const firstId = firstLeafId(c.tree);
    act(() => {
      c.onTerminalReady(firstId, "pty-A");
    });

    c = await splitAndFlush(c, firstId, "right");

    await waitFor(() => {
      c = captured as unknown as CapturedProps;
      expect(leafIds(c.tree)).toHaveLength(2);
    });
    expect(leafIds(c.tree).map((id) => findLeaf(c.tree, id)?.cwd)).toEqual([
      "C:/projects/current",
      "C:/projects/current",
    ]);
    expect(invokeMock).toHaveBeenCalledWith(
      "mux_split_pane",
      expect.objectContaining({ workspaceId: "pty-A", targetPaneId: "pty-A" }),
    );
  });

  it("rebinds stale saved mux workspace ids to the live terminal workspace before local split recovery", async () => {
    localStorage.setItem(
      "aether:paneTree:tab-test",
      JSON.stringify({
        version: 1,
        tree: { type: "terminal", id: "pane-left", shell: "powershell" },
        activePaneId: "pane-left",
        muxWorkspaceId: "stale-workspace",
      }),
    );
    invokeMock.mockImplementation((command: string, args?: Record<string, unknown>) => {
      if (command === "get_pane_tree_layout") return Promise.resolve(null);
      if (command === "list_terminals") return Promise.resolve([]);
      if (command === "mux_get_workspace") return Promise.resolve(null);
      if (command === "mux_split_pane") {
        if (args?.workspaceId === "stale-workspace") return Promise.reject(new Error("workspace not found"));
        if (args?.workspaceId === "pty-A") return Promise.resolve("pty-mux-rebound");
      }
      return Promise.resolve(undefined);
    });

    render(<PaneTreeContainer shell="powershell" layoutStorageKey="aether:paneTree:tab-test" />);
    let c = captured as unknown as CapturedProps;
    const firstId = firstLeafId(c.tree);
    act(() => {
      c.onTerminalReady(firstId, "pty-A");
    });

    await splitAndFlush(c, firstId, "right");

    await waitFor(() => {
      c = captured as unknown as CapturedProps;
      expect(leafIds(c.tree)).toContain("pty-mux-rebound");
    });
    expect(invokeMock).toHaveBeenCalledWith(
      "mux_split_pane",
      expect.objectContaining({ workspaceId: "stale-workspace", targetPaneId: "pty-A" }),
    );
    expect(invokeMock).toHaveBeenCalledWith(
      "mux_split_pane",
      expect.objectContaining({ workspaceId: "pty-A", targetPaneId: "pty-A" }),
    );
  });

  it("preserves the target pane cwd when mux split falls back to local recovery", async () => {
    localStorage.setItem(
      "aether:paneTree:tab-test",
      JSON.stringify({
        version: 1,
        tree: {
          type: "terminal",
          id: "pane-target",
          shell: "powershell",
          cwd: "D:/work/specific-project",
        },
        activePaneId: "pane-target",
      }),
    );
    invokeMock.mockImplementation((command: string) => {
      if (command === "get_pane_tree_layout") return Promise.resolve(null);
      if (command === "list_terminals") return Promise.resolve([]);
      if (command === "mux_split_pane") return Promise.reject(new Error("mux unavailable"));
      return Promise.resolve(undefined);
    });
    render(<PaneTreeContainer shell="powershell" cwd="C:/fallback-root" layoutStorageKey="aether:paneTree:tab-test" />);
    let c = captured as unknown as CapturedProps;
    await waitFor(() => {
      c = captured as unknown as CapturedProps;
      expect(c.suspendTerminalMounts).toBe(false);
    });
    act(() => {
      c.onTerminalReady("pane-target", "pty-target");
    });

    c = await splitAndFlush(c, "pane-target", "right");

    await waitFor(() => {
      c = captured as unknown as CapturedProps;
      expect(leafIds(c.tree)).toHaveLength(2);
    });
    expect(leafIds(c.tree).map((id) => findLeaf(c.tree, id)?.cwd)).toEqual([
      "D:/work/specific-project",
      "D:/work/specific-project",
    ]);
  });

  it("does not ignore split requests before the initial pane has registered a PTY id", async () => {
    render(<PaneTreeContainer shell="powershell" />);
    const c = captured as unknown as CapturedProps;
    const firstId = firstLeafId(c.tree);

    await splitAndFlush(c, firstId, "right");

    await waitFor(() => {
      expect(leafIds((captured as unknown as CapturedProps).tree)).toHaveLength(2);
    });
    expect(invokeMock).not.toHaveBeenCalledWith("mux_split_pane", expect.anything());
  });

  it("switches to the focused pane's PTY id when the user clicks into it", async () => {
    const onChange = vi.fn();
    render(<PaneTreeContainer shell="powershell" onActiveTerminalChange={onChange} />);
    let c = captured as unknown as CapturedProps;
    const firstId = firstLeafId(c.tree);
    act(() => {
      c.onTerminalReady(firstId, "pty-A");
    });
    c = await splitAndFlush(c, firstId, "right");
    const ids = leafIds(c.tree);
    const otherId = differentLeafId(ids, firstId);
    act(() => {
      c.onTerminalReady(otherId, "pty-B");
      c.onFocusPane(otherId);
    });
    expect(onChange).toHaveBeenLastCalledWith("pty-B");

    act(() => {
      c.onFocusPane(firstId);
    });
    expect(onChange).toHaveBeenLastCalledWith("pty-A");
  });

  it("focuses an existing pane from a global switch request without changing the tree", async () => {
    const onChange = vi.fn();
    const { rerender } = render(<PaneTreeContainer shell="powershell" onActiveTerminalChange={onChange} />);
    let c = captured as unknown as CapturedProps;
    const firstId = firstLeafId(c.tree);

    act(() => {
      c.onTerminalReady(firstId, "pty-A");
    });
    c = await splitAndFlush(c, firstId, "right");
    const originalOrder = leafIds(c.tree);
    const otherId = differentLeafId(originalOrder, firstId);

    act(() => {
      c.onTerminalReady(otherId, "pty-B");
    });
    rerender(
      <PaneTreeContainer
        shell="powershell"
        onActiveTerminalChange={onChange}
        focusPaneRequest={{ paneId: otherId, sequence: 1 }}
      />,
    );

    await waitFor(() => {
      c = captured as unknown as CapturedProps;
      expect(c.activePaneId).toBe(otherId);
      expect(leafIds(c.tree)).toEqual(originalOrder);
      expect(onChange).toHaveBeenLastCalledWith("pty-B");
    });
  });

  it("closes an existing pane from a global close request", async () => {
    const { rerender } = render(<PaneTreeContainer shell="powershell" />);
    let c = captured as unknown as CapturedProps;
    const firstId = firstLeafId(c.tree);

    act(() => {
      c.onTerminalReady(firstId, "pty-A");
    });
    c = await splitAndFlush(c, firstId, "right");
    const originalOrder = leafIds(c.tree);
    const otherId = differentLeafId(originalOrder, firstId);
    act(() => {
      c.onTerminalReady(otherId, "pty-B");
    });

    rerender(<PaneTreeContainer shell="powershell" closePaneRequest={{ paneId: otherId, sequence: 1 }} />);

    await waitFor(() => {
      c = captured as unknown as CapturedProps;
      expect(leafIds(c.tree)).toEqual([firstId]);
      expect(c.terminalIds.has(otherId)).toBe(false);
    });
    expect(invokeMock).toHaveBeenCalledWith("mux_close_pane", { workspaceId: "pty-A", paneId: "pty-B" });
  });

  it("keeps pane closing usable when the Rust mux close path rejects", async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === "get_pane_tree_layout") return Promise.resolve(null);
      if (command === "list_terminals") return Promise.resolve([]);
      if (command === "mux_split_pane") return Promise.resolve(`pty-mux-${++muxSplitCounter}`);
      if (command === "mux_close_pane") return Promise.reject(new Error("mux close graph is stale"));
      return Promise.resolve(undefined);
    });
    render(<PaneTreeContainer shell="powershell" />);
    let c = captured as unknown as CapturedProps;
    const firstId = firstLeafId(c.tree);
    act(() => {
      c.onTerminalReady(firstId, "pty-A");
    });
    c = await splitAndFlush(c, firstId, "right");
    const otherId = differentLeafId(leafIds(c.tree), firstId);
    act(() => {
      c.onTerminalReady(otherId, "pty-B");
    });

    await act(async () => {
      (captured as unknown as CapturedProps).onClose(otherId);
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      c = captured as unknown as CapturedProps;
      expect(leafIds(c.tree)).toEqual([firstId]);
    });
    expect(invokeMock).toHaveBeenCalledWith("close_terminal", { id: "pty-B" });
  });

  it("reports backend terminal close failures instead of silently orphaning panes", async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === "get_pane_tree_layout") return Promise.resolve(null);
      if (command === "list_terminals") return Promise.resolve([]);
      if (command === "mux_split_pane") return Promise.resolve(`pty-mux-${++muxSplitCounter}`);
      if (command === "mux_close_pane") return Promise.reject(new Error("mux close graph is stale"));
      if (command === "close_terminal") return Promise.reject(new Error("backend terminal refused close"));
      return Promise.resolve(undefined);
    });
    const telemetry = collectFallbackEvents();
    try {
      render(<PaneTreeContainer shell="powershell" />);
      let c = captured as unknown as CapturedProps;
      const firstId = firstLeafId(c.tree);
      act(() => {
        c.onTerminalReady(firstId, "pty-A");
      });
      c = await splitAndFlush(c, firstId, "right");
      const otherId = differentLeafId(leafIds(c.tree), firstId);
      act(() => {
        c.onTerminalReady(otherId, "pty-B");
      });

      await act(async () => {
        (captured as unknown as CapturedProps).onClose(otherId);
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });

      await waitFor(() =>
        expect(
          telemetry.events.some((event) => event.source === "pane-tree" && event.operation === "close_terminal"),
        ).toBe(true),
      );
      expect(telemetry.events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            source: "pane-tree",
            operation: "close_terminal",
            severity: "error",
            message: "backend terminal refused close",
            userVisible: true,
          }),
        ]),
      );
    } finally {
      telemetry.cleanup();
    }
  });

  it("rebinds stale saved mux workspace ids to the live terminal workspace before local close recovery", async () => {
    localStorage.setItem(
      "aether:paneTree:tab-test",
      JSON.stringify({
        version: 1,
        tree: {
          type: "split",
          id: "split-root",
          direction: "horizontal",
          ratio: 0.5,
          first: { type: "terminal", id: "pane-left", shell: "powershell" },
          second: { type: "terminal", id: "pane-right", shell: "powershell" },
        },
        activePaneId: "pane-right",
        muxWorkspaceId: "stale-workspace",
      }),
    );
    invokeMock.mockImplementation((command: string, args?: Record<string, unknown>) => {
      if (command === "get_pane_tree_layout") return Promise.resolve(null);
      if (command === "list_terminals") return Promise.resolve([]);
      if (command === "mux_get_workspace") return Promise.resolve(null);
      if (command === "mux_close_pane") {
        if (args?.workspaceId === "stale-workspace") return Promise.reject(new Error("workspace not found"));
        if (args?.workspaceId === "pty-A") return Promise.resolve(undefined);
      }
      return Promise.resolve(undefined);
    });

    render(<PaneTreeContainer shell="powershell" layoutStorageKey="aether:paneTree:tab-test" />);
    let c = captured as unknown as CapturedProps;
    act(() => {
      c.onTerminalReady("pane-left", "pty-A");
      c.onTerminalReady("pane-right", "pty-B");
    });
    invokeMock.mockClear();

    await act(async () => {
      (captured as unknown as CapturedProps).onClose("pane-right");
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      c = captured as unknown as CapturedProps;
      expect(leafIds(c.tree)).toEqual(["pane-left"]);
    });
    expect(invokeMock).toHaveBeenCalledWith("mux_close_pane", {
      workspaceId: "stale-workspace",
      paneId: "pty-B",
    });
    expect(invokeMock).toHaveBeenCalledWith("mux_close_pane", {
      workspaceId: "pty-A",
      paneId: "pty-B",
    });
    expect(invokeMock).not.toHaveBeenCalledWith("close_terminal", expect.anything());
  });

  it("routes layout rebalance commands through the Rust mux before mirroring locally", async () => {
    render(<PaneTreeContainer shell="powershell" />);
    let c = captured as unknown as CapturedProps;
    const firstId = firstLeafId(c.tree);
    act(() => {
      c.onTerminalReady(firstId, "pty-A");
    });
    c = await splitAndFlush(c, firstId, "right");
    const otherId = differentLeafId(leafIds(c.tree), firstId);
    act(() => {
      c.onTerminalReady(otherId, "pty-B");
    });

    await act(async () => {
      (captured as unknown as CapturedProps).onLayoutCommand?.("tiled");
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(invokeMock).toHaveBeenCalledWith("mux_apply_layout", {
      workspaceId: "pty-A",
      command: "tiled",
    });
  });

  it("routes synchronized panes mode through the Rust mux tab state", async () => {
    render(<PaneTreeContainer shell="powershell" />);
    let c = captured as unknown as CapturedProps;
    const firstId = firstLeafId(c.tree);
    act(() => {
      c.onTerminalReady(firstId, "pty-A");
    });
    c = await splitAndFlush(c, firstId, "right");
    const otherId = differentLeafId(leafIds(c.tree), firstId);
    act(() => {
      c.onTerminalReady(otherId, "pty-B");
    });

    await act(async () => {
      (captured as unknown as CapturedProps).onLayoutCommand?.("sync-panes-on");
      await Promise.resolve();
      await Promise.resolve();
    });
    expect((captured as unknown as CapturedProps).synchronizedPanes).toBe(true);
    await act(async () => {
      (captured as unknown as CapturedProps).onLayoutCommand?.("sync-panes-off");
      await Promise.resolve();
      await Promise.resolve();
    });
    expect((captured as unknown as CapturedProps).synchronizedPanes).toBe(false);

    expect(invokeMock).toHaveBeenCalledWith("mux_set_panes_synchronized", {
      workspaceId: "pty-A",
      enabled: true,
    });
    expect(invokeMock).toHaveBeenCalledWith("mux_set_panes_synchronized", {
      workspaceId: "pty-A",
      enabled: false,
    });
  });

  it("routes move-next through mux pane swap before changing local order", async () => {
    render(<PaneTreeContainer shell="powershell" />);
    let c = captured as unknown as CapturedProps;
    const firstId = firstLeafId(c.tree);
    act(() => {
      c.onTerminalReady(firstId, "pty-A");
    });
    c = await splitAndFlush(c, firstId, "right");
    const otherId = differentLeafId(leafIds(c.tree), firstId);
    act(() => {
      c.onTerminalReady(otherId, "pty-B");
      c.onFocusPane(firstId);
    });

    await act(async () => {
      (captured as unknown as CapturedProps).onLayoutCommand?.("move-next");
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(invokeMock).toHaveBeenCalledWith("mux_swap_panes", {
      workspaceId: "pty-A",
      firstPaneId: "pty-A",
      secondPaneId: "pty-B",
    });
    expect(leafIds((captured as unknown as CapturedProps).tree)).toEqual([otherId, firstId]);
  });

  it("routes rotate-next through the Rust mux before rotating local pane order", async () => {
    render(<PaneTreeContainer shell="powershell" />);
    let c = captured as unknown as CapturedProps;
    const firstId = firstLeafId(c.tree);
    act(() => {
      c.onTerminalReady(firstId, "pty-A");
    });
    c = await splitAndFlush(c, firstId, "right");
    const otherId = differentLeafId(leafIds(c.tree), firstId);
    act(() => {
      c.onTerminalReady(otherId, "pty-B");
    });

    await act(async () => {
      (captured as unknown as CapturedProps).onLayoutCommand?.("rotate-next");
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(invokeMock).toHaveBeenCalledWith("mux_apply_layout", {
      workspaceId: "pty-A",
      command: "rotate-next",
    });
    expect(leafIds((captured as unknown as CapturedProps).tree)).toEqual([otherId, firstId]);
  });

  it("routes maximize through the Rust mux zoom state before mirroring locally", async () => {
    render(<PaneTreeContainer shell="powershell" />);
    let c = captured as unknown as CapturedProps;
    const firstId = firstLeafId(c.tree);
    act(() => {
      c.onTerminalReady(firstId, "pty-A");
    });
    c = await splitAndFlush(c, firstId, "right");
    const otherId = differentLeafId(leafIds(c.tree), firstId);
    act(() => {
      c.onTerminalReady(otherId, "pty-B");
    });

    await act(async () => {
      (captured as unknown as CapturedProps).onToggleMaximize(otherId);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(invokeMock).toHaveBeenCalledWith("mux_set_pane_zoom", {
      workspaceId: "pty-A",
      paneId: "pty-B",
      zoomed: true,
    });
  });

  it("forwards a global restart request to the renderer without changing the tree", async () => {
    const { rerender } = render(<PaneTreeContainer shell="powershell" />);
    let c = captured as unknown as CapturedProps;
    const firstId = firstLeafId(c.tree);

    act(() => {
      c.onTerminalReady(firstId, "pty-A");
    });
    c = await splitAndFlush(c, firstId, "right");
    const originalOrder = leafIds(c.tree);
    const otherId = differentLeafId(originalOrder, firstId);

    rerender(<PaneTreeContainer shell="powershell" restartPaneRequest={{ paneId: otherId, sequence: 3 }} />);

    await waitFor(() => {
      c = captured as unknown as CapturedProps;
      expect(c.restartPaneRequest).toEqual({ paneId: otherId, sequence: 3 });
      expect(leafIds(c.tree)).toEqual(originalOrder);
    });
  });

  it("restores a saved pane layout for the tab storage key", () => {
    localStorage.setItem(
      "aether:paneTree:tab-test",
      JSON.stringify({
        version: 1,
        tree: {
          type: "split",
          id: "split-root",
          direction: "horizontal",
          ratio: 0.42,
          first: { type: "terminal", id: "pane-left", shell: "powershell", role: "build" },
          second: { type: "terminal", id: "pane-right", shell: "cmd", title: "reviewer" },
        },
        activePaneId: "pane-right",
      }),
    );

    render(<PaneTreeContainer shell="powershell" layoutStorageKey="aether:paneTree:tab-test" />);

    const c = captured as unknown as CapturedProps;
    expect(leafIds(c.tree)).toEqual(["pane-left", "pane-right"]);
    expect(c.activePaneId).toBe("pane-right");
  });

  it("persists pane name and role edits for the tab storage key", async () => {
    render(<PaneTreeContainer shell="powershell" layoutStorageKey="aether:paneTree:tab-test" />);

    const c = captured as unknown as CapturedProps;
    const paneId = firstLeafId(c.tree);
    act(() => {
      c.onRenamePane(paneId, "frontend");
      c.onCyclePaneRole(paneId);
    });

    await waitFor(() => {
      const saved = JSON.parse(localStorage.getItem("aether:paneTree:tab-test") ?? "null");
      expect(saved?.tree).toMatchObject({
        id: paneId,
        title: "frontend",
        role: "work",
      });
    });
  });

  it("persists durable pane session intent for reload attach decisions", async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === "get_pane_tree_layout") return Promise.resolve(null);
      if (command === "list_panes_info") {
        return Promise.resolve([
          { terminal_id: "pty-durable-1", name: "build", role: "work", shell_type: "powershell" },
        ]);
      }
      if (command === "list_terminals") return Promise.resolve(["pty-durable-1"]);
      return Promise.resolve(undefined);
    });
    render(<PaneTreeContainer shell="powershell" cwd="C:/repo" layoutStorageKey="aether:paneTree:tab-test" />);

    const c = captured as unknown as CapturedProps;
    const paneId = firstLeafId(c.tree);
    act(() => {
      c.onTerminalReady(paneId, "pty-durable-1");
      c.onRenamePane(paneId, "build");
      c.onCyclePaneRole(paneId);
    });

    await waitFor(() => {
      const saved = JSON.parse(localStorage.getItem("aether:paneTree:tab-test") ?? "null");
      expect(saved?.sessionId).toBe("aether:paneTree:tab-test");
      expect(saved?.layoutId).toBe("aether:paneTree:tab-test");
      expect(saved?.paneIntents?.[paneId]).toMatchObject({
        paneId,
        sessionId: "aether:paneTree:tab-test",
        layoutId: "aether:paneTree:tab-test",
        terminalId: "pty-durable-1",
        cwd: "C:/repo",
        name: "build",
        role: "work",
        attachState: "attached",
        health: "healthy",
        lifecycle: "live",
      });
    });
  });

  it("flushes a pending backend layout mirror before unmount", async () => {
    vi.useFakeTimers();
    try {
      localStorage.setItem(
        "aether:paneTree:tab-test",
        JSON.stringify({
          version: 1,
          tree: { type: "terminal", id: "pane-fast", shell: "powershell" },
          activePaneId: "pane-fast",
        }),
      );

      const { unmount } = render(
        <PaneTreeContainer shell="powershell" layoutStorageKey="aether:paneTree:tab-test" projectPath="C:/repo" />,
      );
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      const c = captured as unknown as CapturedProps;

      invokeMock.mockClear();
      act(() => {
        c.onRenamePane("pane-fast", "frontend");
      });

      unmount();
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      const saveCall = invokeMock.mock.calls.find(([command]) => command === "save_pane_tree_layout");
      expect(saveCall).toBeDefined();
      expect(saveCall?.[1]).toMatchObject({
        storageKey: "aether:paneTree:tab-test",
        projectPath: "C:/repo",
      });
      expect(JSON.parse(saveCall?.[1].layoutJson)).toMatchObject({
        tree: { id: "pane-fast", title: "frontend" },
        activePaneId: "pane-fast",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("syncs pane names and roles to the backend registry", async () => {
    render(<PaneTreeContainer shell="powershell" layoutStorageKey="aether:paneTree:tab-test" />);

    const c = captured as unknown as CapturedProps;
    const paneId = firstLeafId(c.tree);
    act(() => {
      c.onTerminalReady(paneId, "pty-route-1");
      c.onRenamePane(paneId, "frontend");
      c.onCyclePaneRole(paneId);
    });

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("rename_pane", {
        terminalId: "pty-route-1",
        name: "frontend",
      });
      expect(invokeMock).toHaveBeenCalledWith("set_pane_role", {
        terminalId: "pty-route-1",
        role: "work",
      });
    });
  });

  it("reports pane metadata sync failures instead of leaving stale backend routing silent", async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === "get_pane_tree_layout") return Promise.resolve(null);
      if (command === "list_terminals") return Promise.resolve([]);
      if (command === "rename_pane") return Promise.reject(new Error("rename failed"));
      if (command === "set_pane_role") return Promise.reject(new Error("role failed"));
      return Promise.resolve(undefined);
    });
    const telemetry = collectFallbackEvents();
    try {
      render(<PaneTreeContainer shell="powershell" layoutStorageKey="aether:paneTree:tab-test" />);

      const c = captured as unknown as CapturedProps;
      const paneId = firstLeafId(c.tree);
      act(() => {
        c.onTerminalReady(paneId, "pty-route-failing");
        c.onRenamePane(paneId, "frontend");
        c.onCyclePaneRole(paneId);
      });

      await waitFor(() => {
        expect(telemetry.events).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              source: "pane-metadata",
              operation: "rename_pane",
              userVisible: true,
            }),
            expect.objectContaining({
              source: "pane-metadata",
              operation: "set_pane_role",
              userVisible: true,
            }),
          ]),
        );
      });
    } finally {
      telemetry.cleanup();
    }
  });

  it("reports backend terminal truth failures before marking restored panes exited", async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === "get_pane_tree_layout") return Promise.resolve(null);
      if (command === "list_panes_info") return Promise.resolve([]);
      if (command === "list_terminals") return Promise.reject(new Error("terminal registry unavailable"));
      return Promise.resolve(undefined);
    });
    const telemetry = collectFallbackEvents();
    try {
      render(<PaneTreeContainer shell="powershell" layoutStorageKey="aether:paneTree:tab-test" />);

      await waitFor(() => {
        expect(telemetry.events).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              source: "pane-metadata",
              operation: "list_terminals_after_empty_panes",
              userVisible: true,
            }),
          ]),
        );
      });
    } finally {
      telemetry.cleanup();
    }
  });

  it("applies a role-cycle request only once for a request sequence", async () => {
    const { rerender } = render(<PaneTreeContainer shell="powershell" />);

    let c = captured as unknown as CapturedProps;
    const paneId = firstLeafId(c.tree);

    rerender(<PaneTreeContainer shell="powershell" cyclePaneRoleRequest={{ paneId, sequence: 7 }} />);

    await waitFor(() => {
      c = captured as unknown as CapturedProps;
      expect(findLeaf(c.tree, paneId)?.role).toBe("work");
    });

    await act(async () => {
      await Promise.resolve();
    });

    c = captured as unknown as CapturedProps;
    expect(findLeaf(c.tree, paneId)?.role).toBe("work");
  });

  it("hydrates from the backend layout mirror when local cache is missing", async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === "get_pane_tree_layout") {
        return Promise.resolve({
          storageKey: "aether:paneTree:tab-test",
          projectPath: "C:/repo",
          updatedAt: "2026-05-01 00:00:00",
          layoutJson: JSON.stringify({
            version: 1,
            tree: {
              type: "split",
              id: "split-db",
              direction: "vertical",
              ratio: 0.6,
              first: { type: "terminal", id: "pane-db-left", shell: "powershell", role: "build" },
              second: { type: "terminal", id: "pane-db-right", shell: "cmd", title: "reviewer" },
            },
            activePaneId: "pane-db-right",
          }),
        });
      }
      return Promise.resolve(undefined);
    });

    render(<PaneTreeContainer shell="powershell" layoutStorageKey="aether:paneTree:tab-test" />);

    await waitFor(() => {
      const c = captured as unknown as CapturedProps;
      expect(leafIds(c.tree)).toEqual(["pane-db-left", "pane-db-right"]);
      expect(c.activePaneId).toBe("pane-db-right");
    });
  });

  it("prefers a Rust mux graph over the legacy local pane-tree snapshot during hydration", async () => {
    localStorage.setItem(
      "aether:paneTree:tab-test",
      JSON.stringify({
        version: 1,
        tree: { type: "terminal", id: "legacy-pane", shell: "powershell" },
        activePaneId: "legacy-pane",
        muxWorkspaceId: "workspace-pty-a",
      }),
    );
    invokeMock.mockImplementation((command: string) => {
      if (command === "mux_get_workspace") {
        return Promise.resolve({
          version: 1,
          activeWorkspaceId: "workspace-pty-a",
          workspaces: {
            "workspace-pty-a": {
              id: "workspace-pty-a",
              activeWindowId: "window-a",
              windows: {
                "window-a": {
                  id: "window-a",
                  activeTabId: "tab-a",
                  tabs: {
                    "tab-a": {
                      id: "tab-a",
                      synchronizedPanes: true,
                      layout: {
                        activePaneId: "pty-b",
                        root: {
                          kind: "split",
                          axis: "horizontal",
                          ratio: 0.5,
                          first: { kind: "pane", paneId: "pty-a" },
                          second: { kind: "pane", paneId: "pty-b" },
                        },
                      },
                      panes: {
                        "pty-a": {
                          id: "pty-a",
                          title: "build",
                          shell: "powershell",
                          cwd: "C:/repo",
                          lifecycle: "active",
                          pty: { terminalId: "pty-a", processId: 1, cols: 120, rows: 30 },
                        },
                        "pty-b": {
                          id: "pty-b",
                          title: "tests",
                          shell: "cmd",
                          cwd: "C:/repo",
                          lifecycle: "active",
                          pty: { terminalId: "pty-b", processId: 2, cols: 120, rows: 30 },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        });
      }
      if (command === "list_panes_info") {
        return Promise.resolve([
          { terminal_id: "pty-a", name: "build", shell_type: "powershell" },
          { terminal_id: "pty-b", name: "tests", shell_type: "cmd" },
        ]);
      }
      if (command === "list_terminals") return Promise.resolve(["pty-a", "pty-b"]);
      return Promise.resolve(undefined);
    });

    render(<PaneTreeContainer shell="powershell" layoutStorageKey="aether:paneTree:tab-test" />);

    await waitFor(() => {
      const c = captured as unknown as CapturedProps;
      expect(leafIds(c.tree)).toEqual(["pty-a", "pty-b"]);
      expect(c.activePaneId).toBe("pty-b");
      expect(c.synchronizedPanes).toBe(true);
    });
  });

  it("marks restored layout panes detached and surfaces unmatched backend PTYs as orphaned", async () => {
    localStorage.setItem(
      "aether:paneTree:tab-test",
      JSON.stringify({
        version: 1,
        tree: {
          type: "split",
          id: "split-root",
          direction: "horizontal",
          ratio: 0.5,
          first: { type: "terminal", id: "pane-left", shell: "powershell", title: "left" },
          second: { type: "terminal", id: "pane-right", shell: "cmd", title: "right" },
        },
        activePaneId: "pane-left",
      }),
    );
    invokeMock.mockImplementation((command: string) => {
      if (command === "list_terminals") return Promise.resolve(["pty-orphaned-backend"]);
      return Promise.resolve(undefined);
    });
    const onRegistryChange = vi.fn();

    render(
      <PaneTreeContainer
        shell="powershell"
        layoutStorageKey="aether:paneTree:tab-test"
        onPaneRegistryChange={onRegistryChange}
      />,
    );

    await waitFor(() => {
      expect(onRegistryChange).toHaveBeenLastCalledWith([
        expect.objectContaining({ paneId: "pane-left", terminalId: null, lifecycle: "detached" }),
        expect.objectContaining({ paneId: "pane-right", terminalId: null, lifecycle: "detached" }),
        expect.objectContaining({
          paneId: "orphan-pty-orphaned-backend",
          terminalId: "pty-orphaned-backend",
          lifecycle: "orphaned",
        }),
      ]);
    });
  });

  it("attaches uniquely matched backend pane metadata to the restored layout", async () => {
    localStorage.setItem(
      "aether:paneTree:tab-test",
      JSON.stringify({
        version: 1,
        tree: {
          type: "split",
          id: "split-root",
          direction: "horizontal",
          ratio: 0.5,
          first: { type: "terminal", id: "pane-left", shell: "powershell", title: "left" },
          second: { type: "terminal", id: "pane-right", shell: "cmd", role: "review" },
        },
        activePaneId: "pane-left",
      }),
    );
    invokeMock.mockImplementation((command: string) => {
      if (command === "list_panes_info") {
        return Promise.resolve([
          { terminal_id: "pty-left", name: "left", role: "", shell_type: "powershell", cwd: "C:/repo" },
          { terminal_id: "pty-review", name: "", role: "review", shell_type: "cmd", cwd: "C:/repo" },
        ]);
      }
      return Promise.resolve([]);
    });
    const onRegistryChange = vi.fn();

    render(
      <PaneTreeContainer
        shell="powershell"
        layoutStorageKey="aether:paneTree:tab-test"
        onPaneRegistryChange={onRegistryChange}
      />,
    );

    await waitFor(() => {
      expect(onRegistryChange).toHaveBeenLastCalledWith([
        expect.objectContaining({ paneId: "pane-left", terminalId: "pty-left", lifecycle: "live" }),
        expect.objectContaining({ paneId: "pane-right", terminalId: "pty-review", lifecycle: "live" }),
      ]);
    });
    const c = captured as unknown as CapturedProps;
    expect(c.terminalIds.get("pane-left")).toBe("pty-left");
    expect(c.terminalIds.get("pane-right")).toBe("pty-review");
    expect(c.suspendTerminalMounts).toBe(false);
  });

  it("does not bind the same backend PTY to duplicate restored pane matches", async () => {
    localStorage.setItem(
      "aether:paneTree:tab-test",
      JSON.stringify({
        version: 1,
        tree: {
          type: "split",
          id: "split-root",
          direction: "horizontal",
          ratio: 0.5,
          first: { type: "terminal", id: "pane-left", shell: "powershell", title: "server" },
          second: { type: "terminal", id: "pane-right", shell: "cmd", title: "server" },
        },
        activePaneId: "pane-left",
      }),
    );
    invokeMock.mockImplementation((command: string) => {
      if (command === "list_panes_info") {
        return Promise.resolve([{ terminal_id: "pty-server", name: "server", shell_type: "powershell" }]);
      }
      return Promise.resolve([]);
    });
    const onRegistryChange = vi.fn();

    render(
      <PaneTreeContainer
        shell="powershell"
        layoutStorageKey="aether:paneTree:tab-test"
        onPaneRegistryChange={onRegistryChange}
      />,
    );

    await waitFor(() => {
      expect(onRegistryChange).toHaveBeenLastCalledWith([
        expect.objectContaining({ paneId: "pane-left", terminalId: "pty-server", lifecycle: "live" }),
        expect.objectContaining({ paneId: "pane-right", terminalId: null, lifecycle: "detached" }),
      ]);
    });
    const c = captured as unknown as CapturedProps;
    expect(c.terminalIds.get("pane-left")).toBe("pty-server");
    expect(c.terminalIds.has("pane-right")).toBe(false);
  });

  it("prefers saved backend binding fingerprints over duplicate restored pane titles", async () => {
    localStorage.setItem(
      "aether:paneTree:tab-test",
      JSON.stringify({
        version: 1,
        tree: {
          type: "split",
          id: "split-root",
          direction: "horizontal",
          ratio: 0.5,
          first: { type: "terminal", id: "pane-left", shell: "powershell", title: "server" },
          second: { type: "terminal", id: "pane-right", shell: "cmd", title: "server" },
        },
        activePaneId: "pane-left",
        backendBindings: {
          "pane-left": { terminalId: "pty-left-stable" },
          "pane-right": { terminalId: "pty-right-stable" },
        },
      }),
    );
    invokeMock.mockImplementation((command: string) => {
      if (command === "list_panes_info") {
        return Promise.resolve([
          { terminal_id: "pty-left-stable", name: "server", shell_type: "powershell" },
          { terminal_id: "pty-right-stable", name: "server", shell_type: "cmd" },
        ]);
      }
      return Promise.resolve([]);
    });
    const onRegistryChange = vi.fn();

    render(
      <PaneTreeContainer
        shell="powershell"
        layoutStorageKey="aether:paneTree:tab-test"
        onPaneRegistryChange={onRegistryChange}
      />,
    );

    await waitFor(() => {
      expect(onRegistryChange).toHaveBeenLastCalledWith([
        expect.objectContaining({ paneId: "pane-left", terminalId: "pty-left-stable", lifecycle: "live" }),
        expect.objectContaining({ paneId: "pane-right", terminalId: "pty-right-stable", lifecycle: "live" }),
      ]);
    });
    const c = captured as unknown as CapturedProps;
    expect(c.terminalIds.get("pane-left")).toBe("pty-left-stable");
    expect(c.terminalIds.get("pane-right")).toBe("pty-right-stable");
  });

  it("persists backend binding fingerprints with the pane layout", async () => {
    render(<PaneTreeContainer shell="powershell" layoutStorageKey="aether:paneTree:tab-test" />);

    const c = captured as unknown as CapturedProps;
    const paneId = firstLeafId(c.tree);
    act(() => {
      c.onTerminalReady(paneId, "pty-stable-main");
    });

    await waitFor(() => {
      const saved = JSON.parse(localStorage.getItem("aether:paneTree:tab-test") ?? "null");
      expect(saved?.backendBindings).toEqual({
        [paneId]: { terminalId: "pty-stable-main" },
      });
    });
  });

  it("manually attaches an active orphaned PTY to a detached restored pane", async () => {
    localStorage.setItem(
      "aether:paneTree:tab-test",
      JSON.stringify({
        version: 1,
        tree: { type: "terminal", id: "pane-restored", shell: "powershell", title: "restored" },
        activePaneId: "pane-restored",
      }),
    );
    invokeMock.mockImplementation((command: string) => {
      if (command === "list_terminals") return Promise.resolve(["pty-orphaned-backend"]);
      return Promise.resolve(undefined);
    });
    const onRegistryChange = vi.fn();
    const onComplete = vi.fn();
    const { rerender } = render(
      <PaneTreeContainer
        shell="powershell"
        layoutStorageKey="aether:paneTree:tab-test"
        onPaneRegistryChange={onRegistryChange}
      />,
    );

    await waitFor(() => {
      expect(onRegistryChange).toHaveBeenLastCalledWith([
        expect.objectContaining({ paneId: "pane-restored", terminalId: null, lifecycle: "detached" }),
        expect.objectContaining({
          paneId: "orphan-pty-orphaned-backend",
          terminalId: "pty-orphaned-backend",
          lifecycle: "orphaned",
        }),
      ]);
    });

    rerender(
      <PaneTreeContainer
        shell="powershell"
        layoutStorageKey="aether:paneTree:tab-test"
        onPaneRegistryChange={onRegistryChange}
        attachPaneRequest={{
          paneId: "pane-restored",
          terminalId: "pty-orphaned-backend",
          sequence: 1,
          onComplete,
        }}
      />,
    );

    await waitFor(() => {
      expect(onComplete).toHaveBeenCalledWith(null);
      expect(onRegistryChange).toHaveBeenLastCalledWith([
        expect.objectContaining({ paneId: "pane-restored", terminalId: "pty-orphaned-backend", lifecycle: "live" }),
      ]);
    });
    const c = captured as unknown as CapturedProps;
    expect(c.activePaneId).toBe("pane-restored");
    expect(c.terminalIds.get("pane-restored")).toBe("pty-orphaned-backend");
  });

  it("keeps unrelated orphaned backend PTYs visible after manual attach", async () => {
    localStorage.setItem(
      "aether:paneTree:tab-test",
      JSON.stringify({
        version: 1,
        tree: { type: "terminal", id: "pane-restored", shell: "powershell", title: "restored" },
        activePaneId: "pane-restored",
      }),
    );
    invokeMock.mockImplementation((command: string) => {
      if (command === "list_terminals") return Promise.resolve(["pty-one", "pty-two"]);
      return Promise.resolve(undefined);
    });
    const onRegistryChange = vi.fn();
    const onComplete = vi.fn();
    const { rerender } = render(
      <PaneTreeContainer
        shell="powershell"
        layoutStorageKey="aether:paneTree:tab-test"
        onPaneRegistryChange={onRegistryChange}
      />,
    );

    await waitFor(() => {
      expect(onRegistryChange).toHaveBeenLastCalledWith([
        expect.objectContaining({ paneId: "pane-restored", terminalId: null, lifecycle: "detached" }),
        expect.objectContaining({ terminalId: "pty-one", lifecycle: "orphaned" }),
        expect.objectContaining({ terminalId: "pty-two", lifecycle: "orphaned" }),
      ]);
    });

    rerender(
      <PaneTreeContainer
        shell="powershell"
        layoutStorageKey="aether:paneTree:tab-test"
        onPaneRegistryChange={onRegistryChange}
        attachPaneRequest={{
          paneId: "pane-restored",
          terminalId: "pty-one",
          sequence: 3,
          onComplete,
        }}
      />,
    );

    await waitFor(() => {
      expect(onComplete).toHaveBeenCalledWith(null);
      expect(onRegistryChange).toHaveBeenLastCalledWith([
        expect.objectContaining({ paneId: "pane-restored", terminalId: "pty-one", lifecycle: "live" }),
        expect.objectContaining({ terminalId: "pty-two", lifecycle: "orphaned" }),
      ]);
    });
    expect(onRegistryChange.mock.calls.at(-1)?.[0]).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ paneId: "orphan-pty-one" })]),
    );
  });

  it("rejects manual attach when the backend PTY disappeared", async () => {
    localStorage.setItem(
      "aether:paneTree:tab-test",
      JSON.stringify({
        version: 1,
        tree: { type: "terminal", id: "pane-restored", shell: "powershell", title: "restored" },
        activePaneId: "pane-restored",
      }),
    );
    invokeMock.mockImplementation((command: string) => {
      if (command === "list_terminals") return Promise.resolve([]);
      return Promise.resolve(undefined);
    });
    const onComplete = vi.fn();
    const { rerender } = render(<PaneTreeContainer shell="powershell" layoutStorageKey="aether:paneTree:tab-test" />);

    await waitFor(() => {
      const c = captured as unknown as CapturedProps;
      expect(c.suspendTerminalMounts).toBe(false);
    });

    rerender(
      <PaneTreeContainer
        shell="powershell"
        layoutStorageKey="aether:paneTree:tab-test"
        attachPaneRequest={{
          paneId: "pane-restored",
          terminalId: "pty-gone",
          sequence: 2,
          onComplete,
        }}
      />,
    );

    await waitFor(() => {
      expect(onComplete).toHaveBeenCalledWith("Attach source is no longer active.");
    });
    const c = captured as unknown as CapturedProps;
    expect(c.terminalIds.has("pane-restored")).toBe(false);
  });

  it("revalidates pane truth on window focus and marks disappeared backend PTYs exited", async () => {
    localStorage.setItem(
      "aether:paneTree:tab-test",
      JSON.stringify({
        version: 1,
        tree: { type: "terminal", id: "pane-restored", shell: "powershell", title: "restored" },
        activePaneId: "pane-restored",
      }),
    );
    let backendPanes: unknown[] = [
      { terminal_id: "pty-restored", name: "restored", shell_type: "powershell", cwd: "C:/repo" },
    ];
    invokeMock.mockImplementation((command: string) => {
      if (command === "list_panes_info") return Promise.resolve(backendPanes);
      if (command === "list_terminals") return Promise.resolve([]);
      return Promise.resolve(undefined);
    });
    const onRegistryChange = vi.fn();
    render(
      <PaneTreeContainer
        shell="powershell"
        layoutStorageKey="aether:paneTree:tab-test"
        onPaneRegistryChange={onRegistryChange}
      />,
    );

    await waitFor(() => {
      expect(onRegistryChange).toHaveBeenLastCalledWith([
        expect.objectContaining({ paneId: "pane-restored", terminalId: "pty-restored", lifecycle: "live" }),
      ]);
    });

    backendPanes = [];
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });

    await waitFor(() => {
      expect(onRegistryChange).toHaveBeenLastCalledWith([
        expect.objectContaining({ paneId: "pane-restored", terminalId: null, lifecycle: "exited" }),
      ]);
    });
    expect((captured as unknown as CapturedProps).terminalIds.has("pane-restored")).toBe(false);
  });

  it("revalidates pane truth on reconnect and surfaces newly orphaned backend PTYs", async () => {
    localStorage.setItem(
      "aether:paneTree:tab-test",
      JSON.stringify({
        version: 1,
        tree: { type: "terminal", id: "pane-restored", shell: "powershell", title: "restored" },
        activePaneId: "pane-restored",
      }),
    );
    let backendPanes: unknown[] = [
      { terminal_id: "pty-restored", name: "restored", shell_type: "powershell", cwd: "C:/repo" },
    ];
    invokeMock.mockImplementation((command: string) => {
      if (command === "list_panes_info") return Promise.resolve(backendPanes);
      return Promise.resolve([]);
    });
    const onRegistryChange = vi.fn();
    render(
      <PaneTreeContainer
        shell="powershell"
        layoutStorageKey="aether:paneTree:tab-test"
        onPaneRegistryChange={onRegistryChange}
      />,
    );

    await waitFor(() => {
      expect(onRegistryChange).toHaveBeenLastCalledWith([
        expect.objectContaining({ paneId: "pane-restored", terminalId: "pty-restored", lifecycle: "live" }),
      ]);
    });

    backendPanes = [
      { terminal_id: "pty-restored", name: "restored", shell_type: "powershell", cwd: "C:/repo" },
      { terminal_id: "pty-new-orphan", name: "background", shell_type: "powershell", cwd: "C:/repo" },
    ];
    act(() => {
      window.dispatchEvent(new Event("online"));
    });

    await waitFor(() => {
      expect(onRegistryChange).toHaveBeenLastCalledWith([
        expect.objectContaining({ paneId: "pane-restored", terminalId: "pty-restored", lifecycle: "live" }),
        expect.objectContaining({
          paneId: "orphan-pty-new-orphan",
          terminalId: "pty-new-orphan",
          lifecycle: "orphaned",
        }),
      ]);
    });
  });
});
