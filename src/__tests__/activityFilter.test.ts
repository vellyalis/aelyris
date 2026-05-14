import { describe, expect, it } from "vitest";
import { collectActivity, filterActivity, LOG_TYPES, type LogType } from "../shared/lib/activityFilter";
import type { AgentSession } from "../shared/types/agent";

function makeSession(id: string, name: string, logs: AgentSession["logs"]): AgentSession {
  return {
    id,
    name,
    status: "done",
    model: "claude-sonnet",
    prompt: "",
    startedAt: 0,
    logs,
    cost: 0,
    tokensUsed: 0,
  };
}

const sessions: AgentSession[] = [
  makeSession("s1", "Alpha", [
    { timestamp: 100, type: "text", content: "Reading file config.ts" },
    { timestamp: 200, type: "tool_use", content: '{"name":"Edit","input":{}}' },
    { timestamp: 300, type: "error", content: "Permission denied" },
  ]),
  makeSession("s2", "Beta", [
    { timestamp: 150, type: "text", content: "Analyzing output" },
    { timestamp: 400, type: "tool_result", content: "ok — 3 files changed" },
  ]),
];

describe("collectActivity", () => {
  it("flattens all logs and sorts by timestamp descending", () => {
    const result = collectActivity(sessions);
    expect(result).toHaveLength(5);
    expect(result[0].timestamp).toBe(400);
    expect(result[4].timestamp).toBe(100);
  });

  it("attaches session id and name", () => {
    const result = collectActivity(sessions);
    const first = result[0];
    expect(first.sessionId).toBe("s2");
    expect(first.sessionName).toBe("Beta");
  });

  it("returns empty array for no sessions", () => {
    expect(collectActivity([])).toEqual([]);
  });

  it("can collect only the newest entries without materializing the full activity rail", () => {
    const result = collectActivity(sessions, { limit: 2 });

    expect(result.map((entry) => entry.timestamp)).toEqual([400, 300]);
  });
});

describe("filterActivity", () => {
  const entries = collectActivity(sessions);

  it("returns all entries when filter is empty", () => {
    const result = filterActivity(entries, { query: "", types: new Set(), sessionIds: new Set() });
    expect(result).toHaveLength(5);
  });

  it("filters by text substring (case-insensitive)", () => {
    const result = filterActivity(entries, { query: "CONFIG", types: new Set(), sessionIds: new Set() });
    expect(result).toHaveLength(1);
    expect(result[0].content).toContain("config.ts");
  });

  it("filters by log type", () => {
    const result = filterActivity(entries, { query: "", types: new Set<LogType>(["error"]), sessionIds: new Set() });
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("error");
  });

  it("filters by multiple types", () => {
    const result = filterActivity(entries, {
      query: "",
      types: new Set<LogType>(["text", "error"]),
      sessionIds: new Set(),
    });
    expect(result).toHaveLength(3);
  });

  it("filters by session id", () => {
    const result = filterActivity(entries, { query: "", types: new Set(), sessionIds: new Set(["s2"]) });
    expect(result).toHaveLength(2);
    expect(result.every((e) => e.sessionId === "s2")).toBe(true);
  });

  it("combines all filters with AND semantics", () => {
    const result = filterActivity(entries, {
      query: "file",
      types: new Set<LogType>(["text", "tool_result"]),
      sessionIds: new Set(["s1", "s2"]),
    });
    // "Reading file config.ts" (text, s1) + "ok — 3 files changed" (tool_result, s2)
    expect(result).toHaveLength(2);
  });

  it("matches against session name", () => {
    const result = filterActivity(entries, { query: "alpha", types: new Set(), sessionIds: new Set() });
    expect(result.every((e) => e.sessionId === "s1")).toBe(true);
  });

  it("returns no matches when filter excludes everything", () => {
    const result = filterActivity(entries, { query: "nonexistent", types: new Set(), sessionIds: new Set() });
    expect(result).toEqual([]);
  });
});

describe("LOG_TYPES", () => {
  it("contains all agent log types", () => {
    expect(LOG_TYPES).toContain("text");
    expect(LOG_TYPES).toContain("tool_use");
    expect(LOG_TYPES).toContain("tool_result");
    expect(LOG_TYPES).toContain("error");
    expect(LOG_TYPES).toContain("system");
  });
});
