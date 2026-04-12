import { describe, it, expect } from "vitest";
import type { AgentLog, AgentStatus } from "../shared/types/agent";

/**
 * Tests for agent session merge logic extracted from useAgentManager.
 * When new session data arrives from Rust, we merge it with existing
 * sessions (preserving logs and startedAt from prior state).
 */

interface AgentSessionRaw {
  id: string;
  status: string;
  model: string;
  prompt: string;
  cwd: string;
  cost: number;
  tokens_used: number;
}

interface AgentSession {
  id: string;
  name: string;
  status: AgentStatus;
  model: string;
  prompt: string;
  startedAt: number;
  logs: AgentLog[];
  cost: number;
  tokensUsed: number;
}

function mergeSessions(prev: AgentSession[], raw: AgentSessionRaw[]): AgentSession[] {
  const map = new Map(prev.map((s) => [s.id, s]));
  return raw.map((r) => {
    const existing = map.get(r.id);
    return {
      id: r.id,
      name: existing?.name ?? r.cwd.split("/").filter(Boolean).pop() ?? "Agent",
      status: r.status as AgentStatus,
      model: r.model,
      prompt: r.prompt,
      startedAt: existing?.startedAt ?? Date.now(),
      logs: existing?.logs ?? [],
      cost: r.cost,
      tokensUsed: r.tokens_used,
    };
  });
}

describe("Agent session merge", () => {
  const baseRaw: AgentSessionRaw = {
    id: "abc123",
    status: "thinking",
    model: "sonnet",
    prompt: "fix the bug",
    cwd: "/home/user/project",
    cost: 0.05,
    tokens_used: 1000,
  };

  it("creates new session from raw data", () => {
    const result = mergeSessions([], [baseRaw]);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("abc123");
    expect(result[0].name).toBe("project");
    expect(result[0].status).toBe("thinking");
    expect(result[0].model).toBe("sonnet");
    expect(result[0].cost).toBe(0.05);
    expect(result[0].tokensUsed).toBe(1000);
    expect(result[0].logs).toEqual([]);
  });

  it("preserves existing logs on merge", () => {
    const existing: AgentSession[] = [{
      id: "abc123",
      name: "MyAgent",
      status: "thinking",
      model: "sonnet",
      prompt: "fix the bug",
      startedAt: 1000,
      logs: [{ timestamp: 1000, type: "text", content: "Starting..." }],
      cost: 0.01,
      tokensUsed: 500,
    }];
    const updated: AgentSessionRaw[] = [{
      ...baseRaw,
      status: "coding",
      cost: 0.10,
      tokens_used: 2000,
    }];

    const result = mergeSessions(existing, updated);
    expect(result[0].status).toBe("coding");
    expect(result[0].cost).toBe(0.10);
    expect(result[0].tokensUsed).toBe(2000);
    // Preserved from existing:
    expect(result[0].name).toBe("MyAgent");
    expect(result[0].startedAt).toBe(1000);
    expect(result[0].logs).toHaveLength(1);
  });

  it("removes sessions no longer in raw data", () => {
    const existing: AgentSession[] = [{
      id: "old",
      name: "Old",
      status: "done",
      model: "sonnet",
      prompt: "old task",
      startedAt: 500,
      logs: [],
      cost: 0,
      tokensUsed: 0,
    }];
    const result = mergeSessions(existing, [baseRaw]);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("abc123");
  });

  it("extracts name from cwd path", () => {
    const raw: AgentSessionRaw[] = [{
      ...baseRaw,
      cwd: "C:/Users/dev/my-project",
    }];
    const result = mergeSessions([], raw);
    expect(result[0].name).toBe("my-project");
  });

  it("falls back to Agent when cwd is empty", () => {
    const raw: AgentSessionRaw[] = [{
      ...baseRaw,
      cwd: "",
    }];
    const result = mergeSessions([], raw);
    expect(result[0].name).toBe("Agent");
  });

  it("handles multiple sessions correctly", () => {
    const raw: AgentSessionRaw[] = [
      { ...baseRaw, id: "a", cwd: "/project-a" },
      { ...baseRaw, id: "b", cwd: "/project-b" },
    ];
    const result = mergeSessions([], raw);
    expect(result).toHaveLength(2);
    expect(result[0].name).toBe("project-a");
    expect(result[1].name).toBe("project-b");
  });
});

describe("Agent log parsing", () => {
  function parseAgentLine(line: string): { type: AgentLog["type"]; content: string } {
    try {
      const parsed = JSON.parse(line);
      if (parsed.type === "assistant") {
        return { type: "text", content: parsed.message?.content?.[0]?.text ?? line };
      } else if (parsed.type === "tool_use" || parsed.message?.content?.some?.((c: { type: string }) => c.type === "tool_use")) {
        const toolUse = parsed.message?.content?.find?.((c: { type: string }) => c.type === "tool_use");
        return { type: "tool_use", content: toolUse ? `${toolUse.name}(${JSON.stringify(toolUse.input).slice(0, 100)})` : line };
      } else if (parsed.type === "tool_result") {
        return { type: "tool_result", content: parsed.content?.slice?.(0, 200) ?? line };
      } else if (parsed.type === "result") {
        return { type: "system", content: `Session complete. Cost: $${parsed.cost_usd ?? 0}` };
      }
    } catch {
      // Not JSON
    }
    return { type: "text", content: line.slice(0, 300) };
  }

  it("parses assistant message", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: { content: [{ type: "text", text: "I'll fix the bug" }] },
    });
    const result = parseAgentLine(line);
    expect(result.type).toBe("text");
    expect(result.content).toBe("I'll fix the bug");
  });

  it("parses tool_use message", () => {
    const line = JSON.stringify({
      type: "tool_use",
      message: { content: [{ type: "tool_use", name: "Read", input: { path: "main.ts" } }] },
    });
    const result = parseAgentLine(line);
    expect(result.type).toBe("tool_use");
    expect(result.content).toContain("Read");
  });

  it("parses tool_result message", () => {
    const line = JSON.stringify({
      type: "tool_result",
      content: "File contents here...",
    });
    const result = parseAgentLine(line);
    expect(result.type).toBe("tool_result");
    expect(result.content).toBe("File contents here...");
  });

  it("parses result message with cost", () => {
    const line = JSON.stringify({
      type: "result",
      cost_usd: 0.42,
    });
    const result = parseAgentLine(line);
    expect(result.type).toBe("system");
    expect(result.content).toBe("Session complete. Cost: $0.42");
  });

  it("handles non-JSON text", () => {
    const result = parseAgentLine("plain text output");
    expect(result.type).toBe("text");
    expect(result.content).toBe("plain text output");
  });

  it("truncates long non-JSON text to 300 chars", () => {
    const longText = "a".repeat(500);
    const result = parseAgentLine(longText);
    expect(result.content.length).toBe(300);
  });
});
