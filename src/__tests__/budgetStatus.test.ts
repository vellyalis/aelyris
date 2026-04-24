import { describe, expect, it } from "vitest";
import { countOverBudget, getBudgetWarning } from "../shared/lib/budgetStatus";
import type { AgentSession } from "../shared/types/agent";

function makeSession(overrides: Partial<AgentSession> = {}): AgentSession {
  return {
    id: "s1",
    name: "Session",
    status: "coding",
    model: "claude-sonnet",
    prompt: "do things",
    startedAt: 0,
    logs: [],
    cost: 0,
    tokensUsed: 0,
    ...overrides,
  };
}

describe("getBudgetWarning", () => {
  it("returns null when within both thresholds", () => {
    expect(getBudgetWarning(makeSession({ cost: 0.5, tokensUsed: 1000 }))).toBe(null);
  });

  it("returns 'cost' when cost exceeds cap", () => {
    expect(getBudgetWarning(makeSession({ cost: 3 }))).toBe("cost");
  });

  it("returns 'context' when token usage reaches warn percent", () => {
    // claude-sonnet has 200k tokens. 85% = 170_000
    expect(getBudgetWarning(makeSession({ tokensUsed: 175_000 }))).toBe("context");
  });

  it("cost wins over context when both exceed", () => {
    expect(getBudgetWarning(makeSession({ cost: 5, tokensUsed: 190_000 }))).toBe("cost");
  });

  it("respects custom thresholds", () => {
    expect(getBudgetWarning(makeSession({ cost: 1.5 }), { perSessionCostCap: 1, contextWarnPct: 90 })).toBe("cost");
    expect(getBudgetWarning(makeSession({ cost: 0.5 }), { perSessionCostCap: 1, contextWarnPct: 90 })).toBe(null);
  });
});

describe("countOverBudget", () => {
  it("counts sessions above any threshold", () => {
    const sessions = [
      makeSession({ id: "a", cost: 0.1 }),
      makeSession({ id: "b", cost: 3 }), // over cost
      makeSession({ id: "c", tokensUsed: 180_000 }), // over context
      makeSession({ id: "d", cost: 1 }),
    ];
    expect(countOverBudget(sessions)).toBe(2);
  });

  it("returns 0 for empty input", () => {
    expect(countOverBudget([])).toBe(0);
  });
});
