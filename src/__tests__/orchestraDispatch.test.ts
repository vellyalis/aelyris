import { describe, expect, it, vi } from "vitest";
import {
  launchOrchestraPrompts,
  routeOrchestraPrompts,
  type OrchestraRoutingDecision,
} from "../shared/lib/orchestraDispatch";
import type { OrchestraPrompt } from "../shared/lib/orchestrator";

function prompt(overrides: Partial<OrchestraPrompt> = {}): OrchestraPrompt {
  return {
    roleId: "implementer",
    model: "sonnet",
    prompt: "Implement the task",
    branchName: "agent/implementer/task-1",
    ...overrides,
  };
}

function decision(model: string): OrchestraRoutingDecision {
  return {
    recommended_model: model,
    reasoning: "test",
    estimated_cost: 0,
    fallback_model: "claude-sonnet",
    task_type: "CodeGen",
    complexity: "Moderate",
  };
}

describe("routeOrchestraPrompts", () => {
  it("normalizes routed Claude model names", async () => {
    const routed = await routeOrchestraPrompts(
      [prompt()],
      async () => decision("claude-opus"),
      true,
    );

    expect(routed[0].model).toBe("opus");
  });

  it("keeps role defaults when routing is disabled or unavailable", async () => {
    await expect(
      routeOrchestraPrompts([prompt({ model: "haiku" })], async () => decision("claude-opus"), false),
    ).resolves.toMatchObject([{ model: "haiku" }]);

    await expect(
      routeOrchestraPrompts([prompt({ model: "sonnet" })], async () => {
        throw new Error("router unavailable");
      }, true),
    ).resolves.toMatchObject([{ model: "sonnet" }]);
  });
});

describe("launchOrchestraPrompts", () => {
  it("launches prompts with worktree branch and initial prompt intact", async () => {
    const start = vi.fn(async () => "session-1");
    const launched = await launchOrchestraPrompts([prompt()], "C:/repo", start);

    expect(launched).toBe(1);
    expect(start).toHaveBeenCalledWith({
      cwd: "C:/repo",
      model: "sonnet",
      initialPrompt: "Implement the task",
      branchName: "agent/implementer/task-1",
    });
  });
});
