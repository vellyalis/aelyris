import { describe, expect, it } from "vitest";
import { deriveRightRailWorkforceSummary, WORKFORCE_GUARDRAIL_PROFILES } from "../shared/lib/rightRailWorkforce";
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

describe("deriveRightRailWorkforceSummary", () => {
  it("publishes stable guardrail profile options for the command rail override", () => {
    expect(WORKFORCE_GUARDRAIL_PROFILES).toEqual(["Conservative", "Release", "Builder", "Research"]);
  });

  it("turns pending decisions and graph risks into a conservative command-center state", () => {
    const summary = deriveRightRailWorkforceSummary({
      sessions: [
        session("impl", {
          role: "implementer",
          status: "waiting",
          blockedReason: "approval required",
          handoffFrom: "planner",
        }),
      ],
      interactiveSessionCount: 1,
      changedFilesCount: 2,
      pendingDecisionCount: 1,
      workstationGraph: buildWorkstationGraph({
        workspaceId: "C:/repo",
        risks: [{ id: "r1", title: "missing test", status: "open", agentId: "impl" }],
        contextPacks: [{ id: "ctx", title: "handoff", status: "attached", agentId: "impl" }],
      }),
    });

    expect(summary).toMatchObject({
      tone: "blocked",
      headline: "Needs command decision",
      guardrailProfile: "Conservative",
      liveCount: 2,
      blockedCount: 3,
      reviewCount: 2,
      handoffCount: 2,
    });
    expect(summary.topAgents[0]).toMatchObject({
      id: "impl",
      role: "implementer",
      next: "approval required",
    });
  });

  it("uses release guardrails when changed files are the main pressure", () => {
    const summary = deriveRightRailWorkforceSummary({
      sessions: [session("review", { status: "done", filesChanged: 4 })],
      interactiveSessionCount: 0,
      changedFilesCount: 4,
      pendingDecisionCount: 0,
    });

    expect(summary.tone).toBe("review");
    expect(summary.headline).toBe("Review pressure active");
    expect(summary.guardrailProfile).toBe("Release");
    expect(summary.detail).toBe("0 live · 0 blocked · 4 files");
  });

  it("keeps idle workspaces ready without inventing work", () => {
    const summary = deriveRightRailWorkforceSummary({
      sessions: [],
      interactiveSessionCount: 0,
      changedFilesCount: 0,
      pendingDecisionCount: 0,
    });

    expect(summary).toMatchObject({
      tone: "ready",
      headline: "Ready to launch",
      guardrailProfile: "Research",
      liveCount: 0,
      blockedCount: 0,
      reviewCount: 0,
      handoffCount: 0,
      topAgents: [],
    });
  });
});
