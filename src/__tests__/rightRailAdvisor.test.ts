import { describe, expect, it } from "vitest";
import {
  deriveRightRailActions,
  deriveRightRailNowState,
  deriveRightRailRecommendation,
} from "../shared/lib/rightRailAdvisor";
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

describe("deriveRightRailActions", () => {
  it("returns ranked actions instead of a decorative single hint", () => {
    const actions = deriveRightRailActions({
      sessions: [
        session("long", { name: "Long Runner", tokensUsed: 190_000 }),
        session("blocked", { status: "waiting", blockedReason: "needs approval" }),
      ],
      interactiveSessionCount: 1,
      changedFilesCount: 6,
      contextWarnPct: 85,
      currentMode: "command",
      pendingDecisionCount: 2,
    });

    expect(actions.map((action) => action.id)).toEqual([
      "handoff-context",
      "resolve-approvals",
      "recover-attention",
      "review-queue",
      "parallel-run",
    ]);
    expect(actions.map((action) => action.priority)).toEqual([110, 105, 95, 80, 68]);
  });

  it("makes blocked approvals the primary state when context is healthy", () => {
    const actions = deriveRightRailActions({
      sessions: [session("a", { tokensUsed: 5_000 })],
      interactiveSessionCount: 0,
      changedFilesCount: 0,
      contextWarnPct: 85,
      currentMode: "observe",
      pendingDecisionCount: 3,
    });

    expect(actions[0]).toMatchObject({
      id: "resolve-approvals",
      mode: "command",
      state: "blocked",
      label: "Resolve approvals",
      detail: "3 pending decisions",
    });
  });

  it("uses focused test panes to rank verification before the general queue", () => {
    const actions = deriveRightRailActions({
      sessions: [session("a", { tokensUsed: 5_000 })],
      interactiveSessionCount: 0,
      changedFilesCount: 4,
      contextWarnPct: 85,
      currentMode: "command",
      selectedPane: { role: "test", title: "Test pane" },
    });

    expect(actions[0]).toMatchObject({
      id: "focused-review",
      label: "Verify changes",
      detail: "Test pane · 4 changed files",
    });
    expect(actions[1]).toMatchObject({ id: "review-queue" });
  });

  it("promotes conductor topology when traced runs exist", () => {
    const actions = deriveRightRailActions({
      sessions: [
        session("impl", { role: "implementer" }),
        session("review", { role: "reviewer", handoffFrom: "impl" }),
      ],
      interactiveSessionCount: 0,
      changedFilesCount: 0,
      contextWarnPct: 85,
      currentMode: "command",
    });

    expect(actions.some((action) => action.id === "open-conductor")).toBe(true);
  });

  it("turns graph risks, final reports, provenance, and context packs into concrete actions", () => {
    const actions = deriveRightRailActions({
      sessions: [
        session("impl", {
          role: "implementer",
          changedFileDetails: [{ path: "src/App.tsx", action: "edit", toolName: "edit", timestamp: 1 }],
          finalReport: { status: "ready" },
          closeState: "collectable",
        }),
      ],
      interactiveSessionCount: 0,
      changedFilesCount: 0,
      contextWarnPct: 85,
      currentMode: "command",
      workstationGraph: buildWorkstationGraph({
        workspaceId: "C:/repo",
        sessions: [
          session("impl", {
            role: "implementer",
            changedFileDetails: [{ path: "src/App.tsx", action: "edit", toolName: "edit", timestamp: 1 }],
          }),
        ],
        risks: [{ id: "r1", title: "test failure", status: "open", agentId: "impl" }],
        blockers: [{ id: "b1", title: "approval", kind: "approval", status: "open", agentId: "impl" }],
        finalReports: [{ id: "fr1", title: "Final report", status: "ready", agentId: "impl" }],
        contextPacks: [{ id: "ctx1", title: "Release context", status: "attached", agentId: "impl" }],
      }),
    });

    expect(actions.map((action) => action.id)).toEqual([
      "inspect-risk",
      "collect-final-report",
      "trace-provenance",
      "review-queue",
      "inspect-context",
    ]);
    expect(actions[0]).toMatchObject({
      label: "Inspect blockers",
      detail: "2 risks or blockers",
      state: "blocked",
    });
    expect(actions[1]).toMatchObject({
      targetSessionId: "impl",
      detail: "Agent impl · final report ready",
    });
    expect(actions[2]).toMatchObject({
      targetSessionId: "impl",
      detail: "1 owned change",
    });
  });

  it("keeps idle rail actionable", () => {
    const actions = deriveRightRailActions({
      sessions: [],
      interactiveSessionCount: 0,
      changedFilesCount: 0,
      contextWarnPct: 85,
      currentMode: "observe",
    });

    expect(actions).toEqual([
      {
        id: "ready-command",
        mode: "command",
        tone: "command",
        state: "idle",
        priority: 10,
        label: "Ready for command",
        detail: "Launch agents, workflows, or tools",
      },
    ]);
  });
});

describe("deriveRightRailNowState", () => {
  it("summarizes review-ready state from graph-derived files", () => {
    const now = deriveRightRailNowState({
      sessions: [session("a", { tokensUsed: 5_000 })],
      interactiveSessionCount: 0,
      changedFilesCount: 0,
      contextWarnPct: 85,
      currentMode: "command",
      workstationGraph: buildWorkstationGraph({
        workspaceId: "C:/repo",
        changedFiles: [{ path: "src/App.tsx", status: "modified" }],
      }),
    });

    expect(now).toEqual({
      state: "review-ready",
      label: "Review ready",
      detail: "1 changed file",
      tone: "review",
    });
  });
});
