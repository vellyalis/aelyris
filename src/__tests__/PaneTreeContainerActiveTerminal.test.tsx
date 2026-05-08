import { act, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PaneAttachRequest, PaneRestartRequest } from "../features/terminal/pane-tree/PaneTreeContainer";
import { PaneTreeContainer } from "../features/terminal/pane-tree/PaneTreeContainer";
import type { PaneLifecycleState, PaneNode, SplitDirection } from "../features/terminal/pane-tree/types";

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
  onFocusPane: (id: string) => void;
  onSplit: (id: string, direction: SplitDirection) => void;
  onClose: (id: string) => void;
  onRenamePane: (id: string, title: string | null) => void;
  onCyclePaneRole: (id: string) => void;
  onTerminalReady: (paneId: string, terminalId: string) => void;
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

function findLeaf(node: PaneNode, paneId: string): Extract<PaneNode, { type: "terminal" }> | null {
  if (node.type === "terminal") return node.id === paneId ? node : null;
  return findLeaf(node.first, paneId) ?? findLeaf(node.second, paneId);
}

describe("PaneTreeContainer onActiveTerminalChange", () => {
  beforeEach(() => {
    localStorage.clear();
    invokeMock.mockReset();
    invokeMock.mockImplementation((command: string) => {
      if (command === "get_pane_tree_layout") return Promise.resolve(null);
      if (command === "list_terminals") return Promise.resolve([]);
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

  it("reports null with two unfocused panes — fallback only fires when exactly one pane exists", () => {
    const onChange = vi.fn();
    render(<PaneTreeContainer shell="powershell" onActiveTerminalChange={onChange} />);
    let c = captured as unknown as CapturedProps;
    const firstId = firstLeafId(c.tree);
    act(() => {
      c.onTerminalReady(firstId, "pty-A");
    });
    expect(onChange).toHaveBeenLastCalledWith("pty-A");

    // Split → 2 panes. The new pane has not yet registered its PTY id.
    act(() => {
      c.onSplit(firstId, "right");
    });
    c = captured as unknown as CapturedProps;
    const ids = leafIds(c.tree);
    const newPaneId = differentLeafId(ids, firstId);
    act(() => {
      c.onTerminalReady(newPaneId, "pty-B");
    });
    // Two panes, no explicit focus → ambiguous → null.
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it("switches to the focused pane's PTY id when the user clicks into it", () => {
    const onChange = vi.fn();
    render(<PaneTreeContainer shell="powershell" onActiveTerminalChange={onChange} />);
    let c = captured as unknown as CapturedProps;
    const firstId = firstLeafId(c.tree);
    act(() => {
      c.onTerminalReady(firstId, "pty-A");
      c.onSplit(firstId, "right");
    });
    c = captured as unknown as CapturedProps;
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
      c.onSplit(firstId, "right");
    });
    c = captured as unknown as CapturedProps;
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
      c.onSplit(firstId, "right");
    });
    c = captured as unknown as CapturedProps;
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
    expect(invokeMock).toHaveBeenCalledWith("close_terminal", { id: "pty-B" });
  });

  it("forwards a global restart request to the renderer without changing the tree", async () => {
    const { rerender } = render(<PaneTreeContainer shell="powershell" />);
    let c = captured as unknown as CapturedProps;
    const firstId = firstLeafId(c.tree);

    act(() => {
      c.onTerminalReady(firstId, "pty-A");
      c.onSplit(firstId, "right");
    });
    c = captured as unknown as CapturedProps;
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
        expect.objectContaining({ paneId: "pane-restored", terminalId: "pty-restored", lifecycle: "exited" }),
      ]);
    });
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
