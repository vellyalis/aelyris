import { describe, expect, it } from "vitest";
import { buildToolLedger } from "../shared/lib/toolLedger";
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
    cost: 0,
    tokensUsed: 0,
    ...overrides,
  };
}

describe("buildToolLedger", () => {
  it("prioritizes blocked and quiet sessions before routine recent activity", () => {
    const now = 10 * 60 * 1000;
    const ledger = buildToolLedger(
      [
        session("recent", {
          status: "done",
          logs: [{ timestamp: now - 1_000, type: "tool_result", content: "done" }],
        }),
        session("quiet", {
          status: "coding",
          logs: [{ timestamp: now - 8 * 60 * 1000, type: "text", content: "still working" }],
        }),
        session("blocked", {
          status: "waiting",
          logs: [{ timestamp: now - 2_000, type: "error", content: "permission required" }],
        }),
      ],
      now,
    );

    expect(ledger.items.map((item) => item.sessionId)).toEqual(["blocked", "quiet", "recent"]);
    expect(ledger.attentionCount).toBe(1);
    expect(ledger.attentionBreakdown.error).toBe(1);
    expect(ledger.quietCount).toBe(1);
    expect(ledger.oldestQuietAgeMs).toBe(8 * 60 * 1000);
  });

  it("extracts active tool use for live sessions", () => {
    const now = 20_000;
    const ledger = buildToolLedger(
      [
        session("tool", {
          status: "coding",
          role: "implementer",
          logs: [{ timestamp: now - 1_000, type: "tool_use", content: "Edit(src/App.tsx)" }],
        }),
      ],
      now,
    );

    expect(ledger.activeToolCount).toBe(1);
    expect(ledger.items[0]).toMatchObject({
      sessionId: "tool",
      state: "running",
      tool: "Edit",
      role: "implementer",
    });
  });

  it("uses structured watchdog decisions as ledger signals", () => {
    const now = Date.now();
    const ledger = buildToolLedger(
      [
        session("approval", {
          status: "coding",
          logs: [
            {
              timestamp: now - 500,
              type: "system",
              content: "Needs manual approval: Bash",
              metadata: {
                event: "watchdog_decision",
                toolName: "Bash",
                decision: "manual",
              },
            },
          ],
        }),
      ],
      now,
    );

    expect(ledger.attentionCount).toBe(1);
    expect(ledger.attentionBreakdown.manual).toBe(1);
    expect(ledger.items[0]).toMatchObject({
      sessionId: "approval",
      state: "blocked",
      tool: "Bash",
      summary: "Needs manual approval: Bash",
      attention: "manual",
    });
  });

  it("labels denied watchdog decisions with the matched rule", () => {
    const now = Date.now();
    const ledger = buildToolLedger(
      [
        session("denied", {
          status: "coding",
          logs: [
            {
              timestamp: now - 500,
              type: "error",
              content: "Auto-denied: Bash via destructive-command",
              metadata: {
                event: "watchdog_decision",
                toolName: "Bash",
                decision: "denied",
                rule: "destructive-command",
              },
            },
          ],
        }),
      ],
      now,
    );

    expect(ledger.items[0]).toMatchObject({
      state: "blocked",
      attention: "denied",
      rule: "destructive-command",
    });
    expect(ledger.attentionBreakdown.denied).toBe(1);
  });
});
