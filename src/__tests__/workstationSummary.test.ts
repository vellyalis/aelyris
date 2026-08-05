import { describe, expect, it } from "vitest";
import { deriveFleetCostMeter } from "../shared/lib/costMeter";
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

  it("derives honest reported usage and known cap violations for the cost meter", () => {
    const now = 1_800_000_000_000;
    const meter = deriveFleetCostMeter(
      [
        session("live", { status: "coding", startedAt: now - 90_000, tokensUsed: 40_000, cost: 0.4 }),
        session("done", {
          status: "done",
          startedAt: Math.floor((now - 500_000) / 1000),
          tokensUsed: 60_000,
          cost: 0.6,
        }),
      ],
      { max_agents: 4, max_tokens: 100_000, max_cost_usd: 2, max_runtime_secs: 120 },
      now,
    );

    expect(meter.usage).toEqual({ active_agents: 1, tokens_used: 100_000, cost_usd: 1, runtime_secs: 90 });
    expect(meter.tokenConfidence).toBe("parsed");
    expect(meter.costConfidence).toBe("parsed");
    expect(meter.blockedBy).toEqual(["tokens"]);
    expect(meter.status).toBe("blocked");
  });

  it("marks configured token and cost caps incomplete instead of treating missing telemetry as zero", () => {
    const meter = deriveFleetCostMeter(
      [session("unknown", { tokensUsed: 0, cost: 0, status: "done" })],
      { max_agents: 4, max_tokens: 50_000, max_cost_usd: 1, max_runtime_secs: null },
      1_800_000_000_000,
    );

    expect(meter.usage.tokens_used).toBe(0);
    expect(meter.usage.cost_usd).toBe(0);
    expect(meter.unknownLimits).toEqual(["tokens", "cost"]);
    expect(meter.blockedBy).toEqual([]);
    expect(meter.status).toBe("incomplete");
  });

  it("does not claim exact runtime coverage when a live session start timestamp is invalid", () => {
    const meter = deriveFleetCostMeter(
      [session("invalid-runtime", { status: "coding", startedAt: 0, tokensUsed: 1_000 })],
      { max_agents: 4, max_tokens: null, max_cost_usd: null, max_runtime_secs: 60 },
      1_800_000_000_000,
    );

    expect(meter.runtimeConfidence).toBe("unknown");
    expect(meter.unknownLimits).toEqual(["runtime"]);
    expect(meter.blockedBy).toEqual([]);
  });
});
