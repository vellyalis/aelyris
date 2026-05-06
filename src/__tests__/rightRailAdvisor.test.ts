import { describe, expect, it } from "vitest";
import { deriveRightRailRecommendation } from "../shared/lib/rightRailAdvisor";
import { buildWorkstationGraph } from "../shared/lib/workstationGraph";
import type { AgentSession } from "../shared/types/agent";

function session(id: string, overrides: Partial<AgentSession> = {}): AgentSession {
  return {
    id,
    name: `Agent ${id}`,
    status: "coding",
    model: "claude-sonnet",
    prompt: "work",
    startedAt: 1,
    logs: [],
    cost: 0,
    tokensUsed: 10_000,
    ...overrides,
  };
}

describe("deriveRightRailRecommendation", () => {
  it("prioritizes context pressure over review work", () => {
    const recommendation = deriveRightRailRecommendation({
      sessions: [session("a", { name: "Long Runner", tokensUsed: 190_000 })],
      interactiveSessionCount: 0,
      changedFilesCount: 4,
      contextWarnPct: 85,
      currentMode: "command",
    });

    expect(recommendation).toEqual({
      mode: "observe",
      tone: "warn",
      label: "Handoff watch",
      detail: "Long Runner is at 95% context",
    });
  });

  it("sends changed files to the review rail", () => {
    const recommendation = deriveRightRailRecommendation({
      sessions: [session("a", { tokensUsed: 5_000 })],
      interactiveSessionCount: 0,
      changedFilesCount: 2,
      contextWarnPct: 85,
      currentMode: "command",
    });

    expect(recommendation?.mode).toBe("review");
    expect(recommendation?.label).toBe("Review queue");
    expect(recommendation?.detail).toBe("2 changed files");
  });

  it("uses the selected review pane to sharpen review recommendations", () => {
    const recommendation = deriveRightRailRecommendation({
      sessions: [session("a", { tokensUsed: 5_000 })],
      interactiveSessionCount: 0,
      changedFilesCount: 3,
      contextWarnPct: 85,
      currentMode: "command",
      selectedPane: { role: "review", title: "PR sweep" },
    });

    expect(recommendation).toEqual({
      mode: "review",
      tone: "review",
      label: "Focused review",
      detail: "PR sweep · 3 changed files",
    });
  });

  it("uses the selected agent pane to sharpen observe recommendations", () => {
    const recommendation = deriveRightRailRecommendation({
      sessions: [session("a")],
      interactiveSessionCount: 0,
      changedFilesCount: 0,
      contextWarnPct: 85,
      currentMode: "command",
      selectedPane: { role: "agent", title: "Claude worker" },
    });

    expect(recommendation).toEqual({
      mode: "observe",
      tone: "observe",
      label: "Track agent",
      detail: "Claude worker · 1 live session",
    });
  });

  it("does not suggest the mode that is already open", () => {
    const recommendation = deriveRightRailRecommendation({
      sessions: [session("a", { tokensUsed: 5_000 })],
      interactiveSessionCount: 0,
      changedFilesCount: 2,
      contextWarnPct: 85,
      currentMode: "review",
    });

    expect(recommendation).toBeNull();
  });

  it("uses graph-derived changed files when direct git status has not loaded", () => {
    const recommendation = deriveRightRailRecommendation({
      sessions: [session("a", { tokensUsed: 5_000 })],
      interactiveSessionCount: 0,
      changedFilesCount: 0,
      contextWarnPct: 85,
      currentMode: "command",
      workstationGraph: buildWorkstationGraph({
        workspaceId: "C:/repo",
        changedFiles: [
          { path: "src/App.tsx", status: "modified" },
          { path: "src-tauri/Cargo.toml", status: "modified" },
        ],
      }),
    });

    expect(recommendation).toMatchObject({
      mode: "review",
      label: "Review queue",
      detail: "2 changed files",
    });
  });

  it("surfaces parallel work in observe mode", () => {
    const recommendation = deriveRightRailRecommendation({
      sessions: [session("a"), session("b")],
      interactiveSessionCount: 1,
      changedFilesCount: 0,
      contextWarnPct: 85,
      currentMode: "command",
    });

    expect(recommendation).toMatchObject({
      mode: "observe",
      tone: "observe",
      label: "Parallel run",
      detail: "3 live sessions",
    });
  });
});
