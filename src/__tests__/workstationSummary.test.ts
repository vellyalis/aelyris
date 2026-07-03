import { describe, expect, it } from "vitest";
import { agentContextPercent, agentContextWindow, buildWorkstationSummary, rankAgentSessions } from "../shared/lib/workstationSummary";
import type { AgentSession } from "../shared/types/agent";

function session(id: string, overrides: Partial<AgentSession> = {}): AgentSession {
  return {
    id,
    name: `Agent ${id}`,
    status: "coding",
    model: "claude-sonnet",
    prompt: "work",
    startedAt: 1_000,
    logs: [],
    cost: 0.25,
    tokensUsed: 10_000,
    changedFileDetails: [],
    ...overrides,
  };
}

describe("buildWorkstationSummary", () => {
  it("centralizes live, attention, context, cost, tokens, and changed file totals", () => {
    const summary = buildWorkstationSummary({
      changedFilesCount: 5,
      interactiveSessionCount: 1,
      sessions: [
        session("a", {
          status: "waiting",
          tokensUsed: 40_000,
          cost: 0.4,
          role: "reviewer",
          changedFileDetails: [{ path: "src/App.tsx", action: "edit", toolName: "Edit", timestamp: 1 }],
        }),
        session("b", {
          status: "done",
          tokensUsed: 100_000,
          cost: 0.6,
          handoffFrom: "a",
          changedFileDetails: [{ path: "src/App.tsx", action: "edit", toolName: "Edit", timestamp: 2 }],
        }),
      ],
    });

    expect(summary.liveSessionCount).toBe(1);
    expect(summary.liveRunCount).toBe(2);
    expect(summary.attentionCount).toBe(1);
    expect(summary.totalTokens).toBe(140_000);
    expect(summary.totalCost).toBe(1);
    expect(Math.round(summary.peakContextPct)).toBe(50);
    expect(summary.peakSession?.id).toBe("b");
    expect(summary.contextConfidence).toBe("parsed");
    expect(summary.tokenConfidence).toBe("parsed");
    expect(summary.fileConfidence).toBe("exact");
    expect(summary.tracedSessionCount).toBe(2);
    expect(summary.sessionChangedFileCount).toBe(1);
    expect(summary.changedFilesCount).toBe(5);
  });


  it("prefers runtime context remaining telemetry over token fallback", () => {
    const runtimeSession = session("runtime", {
      tokensUsed: 0,
      contextRemaining: {
        pct: 12,
        usedPct: 88,
        confidence: "parsed",
        source: "claude_grid_context_left",
        updatedAt: 2_000,
        warn: true,
        hard: false,
      },
    });
    const summary = buildWorkstationSummary({ sessions: [runtimeSession] });

    expect(agentContextPercent(runtimeSession)).toBe(88);
    expect(summary.peakContextPct).toBe(88);
    expect(summary.contextConfidence).toBe("parsed");
  });
  it("marks context as estimated when the peak model uses the fallback context window", () => {
    const summary = buildWorkstationSummary({
      sessions: [session("a", { model: "custom-model", tokensUsed: 25_000, filesChanged: 2 })],
    });

    expect(summary.contextConfidence).toBe("estimated");
    expect(summary.tokenConfidence).toBe("parsed");
    expect(summary.fileConfidence).toBe("estimated");
  });

  it("reports context window remaining tokens for focused session UI", () => {
    expect(agentContextWindow(session("a", { tokensUsed: 180_000 }))).toEqual({
      used: 180_000,
      max: 200_000,
      remaining: 20_000,
    });
  });

  it("uses one stable ranking for compact rail components", () => {
    expect(
      rankAgentSessions([
        session("done", { status: "done", startedAt: 5_000 }),
        session("wait", { status: "waiting", startedAt: 1_000 }),
        session("code", { status: "coding", startedAt: 2_000 }),
      ]).map((s) => s.id),
    ).toEqual(["code", "wait", "done"]);
  });
});
