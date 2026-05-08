import { describe, expect, it } from "vitest";
import {
  buildWorkspaceProfile,
  createWorkspaceProfileState,
  filterWorkspaceScopedEvents,
  parseWorkspaceProfileState,
  stableWorkspaceDashboardPort,
  upsertThreadRunState,
  upsertWorkspaceProfileOverride,
} from "../shared/lib/workspaceProfile";

describe("workspaceProfile", () => {
  it("merges global defaults, workspace overrides, and thread run state", () => {
    let state = createWorkspaceProfileState({
      preferredModel: "claude-sonnet",
      visualDensity: "balanced",
    });
    state = upsertWorkspaceProfileOverride(state, "C:\\repo\\Aether", {
      preferredModel: "gpt-5.2",
      visualDensity: "dense",
      safePaths: ["C:/repo/Aether/scripts"],
      dashboardPortPolicy: { mode: "explicit", explicitPort: 49231 },
    });
    state = upsertThreadRunState(state, "C:/repo/Aether", "thread-a", {
      status: "active",
      activePaneId: "pane-1",
      activeRoadmapId: "P2-03",
    });

    const profile = buildWorkspaceProfile({
      state,
      workspaceRoot: "C:/repo/Aether",
      threadId: "thread-a",
    });

    expect(profile.workspaceRoot).toBe("C:/repo/Aether");
    expect(profile.threadId).toBe("thread-a");
    expect(profile.preferredModel).toBe("gpt-5.2");
    expect(profile.visualDensity).toBe("dense");
    expect(profile.dashboardPort).toBe(49231);
    expect(profile.safePaths).toEqual(["C:/repo/Aether", "C:/repo/Aether/scripts"]);
    expect(profile.runState).toMatchObject({
      status: "active",
      activePaneId: "pane-1",
      activeRoadmapId: "P2-03",
    });
  });

  it("keeps per-thread run state isolated inside the same workspace", () => {
    let state = createWorkspaceProfileState();
    state = upsertThreadRunState(state, "C:/repo/Aether", "thread-a", {
      status: "active",
      activeRoadmapId: "P2-03",
    });
    state = upsertThreadRunState(state, "C:/repo/Aether", "thread-b", {
      status: "blocked",
      activeRoadmapId: "P2-04",
    });

    expect(
      buildWorkspaceProfile({ state, workspaceRoot: "C:/repo/Aether", threadId: "thread-a" }).runState,
    ).toMatchObject({
      status: "active",
      activeRoadmapId: "P2-03",
    });
    expect(
      buildWorkspaceProfile({ state, workspaceRoot: "C:/repo/Aether", threadId: "thread-b" }).runState,
    ).toMatchObject({
      status: "blocked",
      activeRoadmapId: "P2-04",
    });
  });

  it("filters monitoring events by workspace and thread without mixing unrelated projects", () => {
    const profile = buildWorkspaceProfile({
      state: createWorkspaceProfileState(),
      workspaceRoot: "C:/repo/Aether",
      threadId: "thread-a",
    });
    const events = [
      { id: "same", workspaceId: "C:/repo/Aether", threadId: "thread-a" },
      { id: "workspace-wide", workspaceId: "C:/repo/Aether" },
      { id: "other-thread", workspaceId: "C:/repo/Aether", threadId: "thread-b" },
      { id: "other-workspace", workspaceId: "D:/other", threadId: "thread-a" },
      { id: "metadata-match", metadata: { cwd: "C:/repo/Aether", threadId: "thread-a" } },
    ];

    expect(filterWorkspaceScopedEvents(events, profile).map((event) => event.id)).toEqual([
      "same",
      "workspace-wide",
      "metadata-match",
    ]);
  });

  it("assigns stable but separate dashboard ports per workspace", () => {
    const first = stableWorkspaceDashboardPort("C:/repo/Aether");
    expect(stableWorkspaceDashboardPort("C:\\repo\\Aether")).toBe(first);
    expect(stableWorkspaceDashboardPort("D:/repo/Other")).not.toBe(first);
  });

  it("parses older or corrupted profile storage back to defaults", () => {
    expect(parseWorkspaceProfileState("{not-json").globalDefaults.defaultShell).toBe("powershell");
    expect(parseWorkspaceProfileState(JSON.stringify({ version: 1 })).globalDefaults.dashboardPortPolicy.mode).toBe(
      "workspace-stable",
    );
  });
});
