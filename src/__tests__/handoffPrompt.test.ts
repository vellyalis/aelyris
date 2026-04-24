import { describe, expect, it } from "vitest";
import { buildHandoffPrompt } from "../shared/lib/handoffPrompt";
import type { AgentSession } from "../shared/types/agent";

function makeSession(overrides: Partial<AgentSession> = {}): AgentSession {
  return {
    id: "s1",
    name: "Test Session",
    status: "done",
    model: "claude-sonnet",
    prompt: "Refactor auth module",
    startedAt: 0,
    logs: [],
    cost: 0,
    tokensUsed: 0,
    ...overrides,
  };
}

describe("buildHandoffPrompt", () => {
  it("includes session name, model and original prompt", () => {
    const prompt = buildHandoffPrompt(makeSession());
    expect(prompt).toContain("Test Session");
    expect(prompt).toContain("claude-sonnet");
    expect(prompt).toContain("Refactor auth module");
  });

  it("includes the latest text log as assistant output", () => {
    const prompt = buildHandoffPrompt(
      makeSession({
        logs: [
          { timestamp: 1, type: "text", content: "early thought" },
          { timestamp: 2, type: "text", content: "final answer" },
        ],
      }),
    );
    expect(prompt).toContain("final answer");
    expect(prompt).not.toContain("early thought");
  });

  it("includes the latest tool_result", () => {
    const prompt = buildHandoffPrompt(
      makeSession({
        logs: [
          { timestamp: 1, type: "tool_result", content: "first result" },
          { timestamp: 2, type: "tool_result", content: "second result" },
        ],
      }),
    );
    expect(prompt).toContain("second result");
  });

  it("mentions file count when files were changed", () => {
    const prompt = buildHandoffPrompt(makeSession({ filesChanged: 5 }));
    expect(prompt).toContain("Files changed so far: 5");
  });

  it("omits file line when nothing changed", () => {
    const prompt = buildHandoffPrompt(makeSession({ filesChanged: 0 }));
    expect(prompt).not.toContain("Files changed so far");
  });

  it("truncates very long text logs", () => {
    const huge = "x".repeat(5000);
    const prompt = buildHandoffPrompt(makeSession({ logs: [{ timestamp: 1, type: "text", content: huge }] }));
    expect(prompt).toContain("truncated");
    expect(prompt.length).toBeLessThan(5000);
  });

  it("ends with a prompt skeleton line for the user to fill", () => {
    const prompt = buildHandoffPrompt(makeSession());
    expect(prompt.trimEnd().endsWith("Your task:")).toBe(true);
  });

  it("skips empty text logs", () => {
    const prompt = buildHandoffPrompt(
      makeSession({
        logs: [
          { timestamp: 1, type: "text", content: "   " },
          { timestamp: 2, type: "text", content: "real content" },
        ],
      }),
    );
    expect(prompt).toContain("real content");
  });
});
