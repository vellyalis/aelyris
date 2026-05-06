import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PaneNode } from "../features/terminal/pane-tree";
import {
  deletePaneTreeSnapshotFromBackend,
  loadPaneTreeSnapshot,
  loadPaneTreeSnapshotFromBackend,
  savePaneTreeSnapshot,
  savePaneTreeSnapshotToBackend,
} from "../features/terminal/pane-tree/persistence";

const KEY = "aether:paneTree:test-tab";
const invokeMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

beforeEach(() => {
  localStorage.clear();
  invokeMock.mockReset();
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
});
