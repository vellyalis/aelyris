import { describe, it, expect } from "vitest";
import { getSessionColor } from "../shared/types/agent";
import type { WorktreeInfo, AgentSession } from "../shared/types/agent";

describe("WorktreeInfo type", () => {
  it("can represent a clean main worktree", () => {
    const wt: WorktreeInfo = {
      name: "main",
      path: "/home/user/project",
      branch: "main",
      is_main: true,
      head_sha: "abc123",
      status: "Clean",
    };
    expect(wt.is_main).toBe(true);
    expect(wt.status).toBe("Clean");
  });

  it("can represent a modified linked worktree", () => {
    const wt: WorktreeInfo = {
      name: "feature-auth",
      path: "/home/user/project-feature-auth",
      branch: "feature-auth",
      is_main: false,
      head_sha: "def456",
      status: "Modified",
    };
    expect(wt.is_main).toBe(false);
    expect(wt.status).toBe("Modified");
  });

  it("can represent a conflicted worktree", () => {
    const wt: WorktreeInfo = {
      name: "merge-fix",
      path: "/tmp/merge-fix",
      branch: "merge-fix",
      is_main: false,
      head_sha: "789abc",
      status: "Conflicted",
    };
    expect(wt.status).toBe("Conflicted");
  });
});

describe("AgentSession with worktree", () => {
  it("can have an attached worktree", () => {
    const session: AgentSession = {
      id: "sess-1",
      name: "Feature work",
      status: "coding",
      model: "sonnet",
      prompt: "Implement auth",
      startedAt: Date.now(),
      logs: [],
      cost: 0.12,
      tokensUsed: 500,
      worktree: {
        name: "feat-auth",
        path: "/project-feat-auth",
        branch: "feat-auth",
        is_main: false,
        head_sha: "aaa111",
        status: "Modified",
      },
    };
    expect(session.worktree?.branch).toBe("feat-auth");
    expect(session.worktree?.status).toBe("Modified");
  });

  it("permissionMode and detectedPort are optional", () => {
    const session: AgentSession = {
      id: "sess-2",
      name: "Test",
      status: "idle",
      model: "haiku",
      prompt: "test",
      startedAt: Date.now(),
      logs: [],
      cost: 0,
      tokensUsed: 0,
      permissionMode: "full",
      detectedPort: 3000,
    };
    expect(session.permissionMode).toBe("full");
    expect(session.detectedPort).toBe(3000);
  });
});

describe("getSessionColor", () => {
  it("returns consistent color for same ID", () => {
    const c1 = getSessionColor("test-id-123");
    const c2 = getSessionColor("test-id-123");
    expect(c1.accent).toBe(c2.accent);
  });

  it("returns different colors for different IDs", () => {
    const ids = ["a", "b", "c", "d", "e", "f", "g", "h"];
    const colors = ids.map((id) => getSessionColor(id).accent);
    const unique = new Set(colors);
    // At least 4 distinct colors from 8 IDs
    expect(unique.size).toBeGreaterThanOrEqual(4);
  });

  it("returns valid hex color", () => {
    const c = getSessionColor("any-id");
    expect(c.accent).toMatch(/^#[0-9a-f]{6}$/i);
  });
});
