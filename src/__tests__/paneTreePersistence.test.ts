import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PaneNode } from "../features/terminal/pane-tree";
import { FALLBACK_TELEMETRY_EVENT, type FallbackTelemetryDetail } from "../shared/lib/fallbackTelemetry";

const KEY = "aether:paneTree:test-tab";
const invokeMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

type PanePersistenceModule = typeof import("../features/terminal/pane-tree/persistence");

let deletePaneTreeSnapshotFromBackend: PanePersistenceModule["deletePaneTreeSnapshotFromBackend"];
let loadPaneTreeSnapshot: PanePersistenceModule["loadPaneTreeSnapshot"];
let loadPaneTreeSnapshotFromBackend: PanePersistenceModule["loadPaneTreeSnapshotFromBackend"];
let muxWorkspaceIdCandidates: PanePersistenceModule["muxWorkspaceIdCandidates"];
let paneTreeSnapshotFromMuxGraph: PanePersistenceModule["paneTreeSnapshotFromMuxGraph"];
let savePaneTreeSnapshot: PanePersistenceModule["savePaneTreeSnapshot"];
let savePaneTreeSnapshotToBackend: PanePersistenceModule["savePaneTreeSnapshotToBackend"];

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

beforeEach(async () => {
  vi.resetModules();
  localStorage.clear();
  invokeMock.mockReset();
  const module = await import("../features/terminal/pane-tree/persistence");
  deletePaneTreeSnapshotFromBackend = module.deletePaneTreeSnapshotFromBackend;
  loadPaneTreeSnapshot = module.loadPaneTreeSnapshot;
  loadPaneTreeSnapshotFromBackend = module.loadPaneTreeSnapshotFromBackend;
  muxWorkspaceIdCandidates = module.muxWorkspaceIdCandidates;
  paneTreeSnapshotFromMuxGraph = module.paneTreeSnapshotFromMuxGraph;
  savePaneTreeSnapshot = module.savePaneTreeSnapshot;
  savePaneTreeSnapshotToBackend = module.savePaneTreeSnapshotToBackend;
});

describe("pane tree persistence", () => {
  it("round-trips split ratios, active pane, and identity metadata", () => {
    const tree: PaneNode = {
      type: "split",
      id: "split-root",
      direction: "horizontal",
      ratio: 0.37,
      first: {
        type: "terminal",
        id: "pane-left",
        shell: "powershell",
        title: "frontend",
        role: "build",
      },
      second: {
        type: "terminal",
        id: "pane-right",
        shell: "cmd",
        cwd: "C:/repo",
        role: "review",
      },
    };

    savePaneTreeSnapshot(KEY, {
      tree,
      activePaneId: "pane-right",
      backendBindings: {
        "pane-left": { terminalId: "pty-left" },
        "pane-right": { terminalId: "pty-right" },
        "pane-stale": { terminalId: "pty-stale" },
      },
    });
    const loaded = loadPaneTreeSnapshot(KEY, "powershell");

    expect(loaded?.activePaneId).toBe("pane-right");
    expect(loaded?.tree).toMatchObject({
      type: "split",
      ratio: 0.37,
      first: { id: "pane-left", title: "frontend", role: "build" },
      second: { id: "pane-right", cwd: "C:/repo", role: "review" },
    });
    expect(loaded?.backendBindings).toEqual({
      "pane-left": { terminalId: "pty-left" },
      "pane-right": { terminalId: "pty-right" },
    });
  });

  it("round-trips durable pane session intent while dropping stale pane intent", () => {
    const tree: PaneNode = {
      type: "terminal",
      id: "pane-main",
      shell: "powershell",
      cwd: "C:/repo",
      title: "build",
      role: "build",
    };

    savePaneTreeSnapshot(KEY, {
      tree,
      activePaneId: "pane-main",
      sessionId: "aether:paneTree:tab-test",
      layoutId: "aether:paneTree:tab-test",
      paneIntents: {
        "pane-main": {
          paneId: "pane-main",
          sessionId: "aether:paneTree:tab-test",
          terminalId: "pty-build",
          processId: 4242,
          cwd: "C:/repo",
          branch: "feature/session-intent",
          command: "pnpm test",
          role: "build",
          name: "build",
          layoutId: "aether:paneTree:tab-test",
          attachState: "attached",
          health: "healthy",
          lifecycle: "live",
          lastActiveAt: "2026-05-05T08:30:00.000Z",
          scrollbackCheckpoint: {
            terminalId: "pty-build",
            cursorRow: 12,
            cursorCol: 4,
            visibleRows: 30,
            scrollbackRows: 120,
            byteCount: 4096,
            capturedAt: "2026-05-05T08:29:00.000Z",
          },
        },
        "pane-stale": {
          paneId: "pane-stale",
          terminalId: "pty-stale",
        },
      },
    });

    const loaded = loadPaneTreeSnapshot(KEY, "powershell");

    expect(loaded?.sessionId).toBe("aether:paneTree:tab-test");
    expect(loaded?.layoutId).toBe("aether:paneTree:tab-test");
    expect(loaded?.paneIntents).toEqual({
      "pane-main": {
        paneId: "pane-main",
        sessionId: "aether:paneTree:tab-test",
        terminalId: "pty-build",
        processId: 4242,
        cwd: "C:/repo",
        branch: "feature/session-intent",
        command: "pnpm test",
        role: "build",
        name: "build",
        layoutId: "aether:paneTree:tab-test",
        attachState: "attached",
        health: "healthy",
        lifecycle: "live",
        lastActiveAt: "2026-05-05T08:30:00.000Z",
        scrollbackCheckpoint: {
          terminalId: "pty-build",
          cursorRow: 12,
          cursorCol: 4,
          visibleRows: 30,
          scrollbackRows: 120,
          byteCount: 4096,
          capturedAt: "2026-05-05T08:29:00.000Z",
        },
      },
    });
  });

  it("drops corrupted snapshots instead of booting an invalid tree", () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({
        version: 1,
        tree: {
          type: "split",
          id: "split-root",
          direction: "horizontal",
          ratio: 0.5,
          first: { type: "terminal", id: "pane-same", shell: "powershell" },
          second: { type: "terminal", id: "pane-same", shell: "cmd" },
        },
        activePaneId: "pane-same",
      }),
    );

    expect(loadPaneTreeSnapshot(KEY, "powershell")).toBeNull();
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it("reports local pane tree load failures instead of silently losing restore state", () => {
    const telemetry = collectFallbackEvents();
    try {
      localStorage.setItem(`${KEY}:broken-json`, "{");

      expect(loadPaneTreeSnapshot(`${KEY}:broken-json`, "powershell")).toBeNull();

      expect(telemetry.events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            source: "pane-tree-persistence",
            operation: "local_load_snapshot",
            userVisible: true,
          }),
        ]),
      );
    } finally {
      telemetry.cleanup();
    }
  });

  it("clears stale active pane references", () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({
        version: 1,
        tree: { type: "terminal", id: "pane-live", shell: "powershell" },
        activePaneId: "pane-stale",
      }),
    );

    expect(loadPaneTreeSnapshot(KEY, "powershell")?.activePaneId).toBeNull();
  });

  it("keeps mux-owned pane ids that do not use the legacy pane prefix", () => {
    const muxPaneId = "8a4e1c18-2e4b-4b59-9c67-a28b5efc8d22";
    savePaneTreeSnapshot(KEY, {
      tree: { type: "terminal", id: muxPaneId, shell: "powershell" },
      activePaneId: muxPaneId,
      backendBindings: { [muxPaneId]: { terminalId: muxPaneId } },
      muxWorkspaceId: muxPaneId,
    });

    const loaded = loadPaneTreeSnapshot(KEY, "cmd");

    expect(loaded?.tree).toMatchObject({ id: muxPaneId, shell: "powershell" });
    expect(loaded?.activePaneId).toBe(muxPaneId);
    expect(loaded?.muxWorkspaceId).toBe(muxPaneId);
  });

  it("converts a Rust mux graph into a pane tree snapshot", () => {
    const graph = {
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
                  layout: {
                    activePaneId: "pty-b",
                    root: {
                      kind: "split",
                      axis: "horizontal",
                      ratio: 0.42,
                      first: { kind: "pane", pane_id: "pty-a" },
                      second: { kind: "pane", paneId: "pty-b" },
                    },
                  },
                  panes: {
                    "pty-a": {
                      id: "pty-a",
                      title: "build",
                      shell: "powershell",
                      cwd: "C:/repo",
                      role: "build",
                      lifecycle: "active",
                      pty: { terminalId: "pty-a", processId: 111, cols: 120, rows: 30 },
                    },
                    "pty-b": {
                      id: "pty-b",
                      title: "review",
                      shell: "cmd",
                      cwd: "C:/repo",
                      role: "review",
                      lifecycle: "detached",
                      pty: { terminalId: "pty-b", processId: null, cols: 120, rows: 30 },
                    },
                  },
                },
              },
            },
          },
        },
      },
    } as const;

    const snapshot = paneTreeSnapshotFromMuxGraph(graph, "powershell");

    expect(snapshot).toMatchObject({
      activePaneId: "pty-b",
      muxWorkspaceId: "workspace-pty-a",
      tree: {
        type: "split",
        direction: "horizontal",
        ratio: 0.42,
        first: { id: "pty-a", title: "build", role: "build" },
        second: { id: "pty-b", shell: "cmd", title: "review", role: "review" },
      },
      backendBindings: {
        "pty-a": { terminalId: "pty-a" },
        "pty-b": { terminalId: "pty-b" },
      },
    });
    expect(snapshot?.paneIntents?.["pty-a"]).toMatchObject({
      terminalId: "pty-a",
      processId: 111,
      lifecycle: "live",
      attachState: "attached",
      health: "healthy",
    });
    expect(snapshot?.paneIntents?.["pty-b"]).toMatchObject({
      lifecycle: "detached",
      attachState: "detached",
    });
  });

  it("orders mux workspace lookup candidates from explicit mux id to bindings", () => {
    expect(
      muxWorkspaceIdCandidates(
        {
          version: 1,
          tree: { type: "terminal", id: "pty-a", shell: "powershell" },
          activePaneId: "pty-a",
          muxWorkspaceId: "workspace-explicit",
          backendBindings: { "pty-a": { terminalId: "pty-a" } },
          paneIntents: { "pty-b": { paneId: "pty-b", terminalId: "pty-b" } },
        },
        "aether:paneTree:tab",
      ),
    ).toEqual(["workspace-explicit", "pty-a", "pty-b", "aether:paneTree:tab"]);
  });

  it("loads a sanitized snapshot from the backend mirror", async () => {
    invokeMock.mockResolvedValue({
      storageKey: KEY,
      projectPath: "C:/repo",
      updatedAt: "2026-05-01 00:00:00",
      layoutJson: JSON.stringify({
        version: 1,
        tree: {
          type: "terminal",
          id: "pane-build",
          shell: "powershell",
          title: "build",
          role: "build",
        },
        activePaneId: "pane-build",
      }),
    });

    const loaded = await loadPaneTreeSnapshotFromBackend(KEY, "cmd");

    expect(invokeMock).toHaveBeenCalledWith("get_pane_tree_layout", { storageKey: KEY });
    expect(loaded?.tree).toMatchObject({ id: "pane-build", title: "build", role: "build" });
    expect(loaded?.activePaneId).toBe("pane-build");
  });

  it("saves and deletes snapshots through backend IPC", async () => {
    const tree: PaneNode = {
      type: "terminal",
      id: "pane-main",
      shell: "powershell",
      role: "work",
    };
    invokeMock.mockResolvedValue(undefined);

    await expect(savePaneTreeSnapshotToBackend(KEY, { tree, activePaneId: "pane-main" }, "C:/repo")).resolves.toBe(
      true,
    );
    expect(invokeMock).toHaveBeenCalledWith("save_pane_tree_layout", {
      storageKey: KEY,
      projectPath: "C:/repo",
      layoutJson: expect.stringContaining('"pane-main"'),
    });

    await expect(deletePaneTreeSnapshotFromBackend(KEY)).resolves.toBe(true);
    expect(invokeMock).toHaveBeenLastCalledWith("delete_pane_tree_layout", { storageKey: KEY });
  });

  it("reports backend pane tree persistence failures instead of silently disabling restore proof", async () => {
    const tree: PaneNode = {
      type: "terminal",
      id: "pane-main",
      shell: "powershell",
      role: "work",
    };
    invokeMock.mockRejectedValue(new Error("sqlite locked"));
    const telemetry = collectFallbackEvents();
    try {
      await expect(
        savePaneTreeSnapshotToBackend(`${KEY}:backend-fail`, { tree, activePaneId: "pane-main" }, "C:/repo"),
      ).resolves.toBe(false);

      expect(telemetry.events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            source: "pane-tree-persistence",
            operation: "backend_save_snapshot",
            userVisible: true,
          }),
        ]),
      );
    } finally {
      telemetry.cleanup();
    }
  });
});
