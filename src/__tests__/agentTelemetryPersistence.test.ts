import { describe, expect, it } from "vitest";
import { parseAgentTelemetrySnapshot, serializeAgentTelemetrySnapshot } from "../shared/lib/agentTelemetryPersistence";
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

describe("agent telemetry persistence", () => {
  it("round-trips lineage, tool ledger logs, review details, and token state", () => {
    const raw = serializeAgentTelemetrySnapshot([
      session("child", {
        name: "Reviewer",
        status: "waiting",
        role: "reviewer",
        handoffFrom: "root",
        tokensUsed: 32_000,
        cost: 0.42,
        logs: [
          {
            timestamp: 2_000,
            type: "system",
            content: "Needs manual approval: Bash",
            metadata: {
              event: "watchdog_decision",
              toolName: "Bash",
              decision: "manual",
              rule: "destructive-command",
            },
          },
        ],
        changedFileDetails: [{ path: "src/App.tsx", action: "edit", toolName: "Edit", timestamp: 3_000 }],
      }),
    ]);

    expect(parseAgentTelemetrySnapshot(raw)[0]).toMatchObject({
      id: "child",
      name: "Reviewer",
      status: "waiting",
      role: "reviewer",
      handoffFrom: "root",
      tokensUsed: 32_000,
      cost: 0.42,
      logs: [
        {
          type: "system",
          metadata: {
            event: "watchdog_decision",
            toolName: "Bash",
            decision: "manual",
            rule: "destructive-command",
          },
        },
      ],
      changedFileDetails: [{ path: "src/App.tsx", action: "edit", toolName: "Edit", timestamp: 3_000 }],
    });
  });

  it("ignores corrupt snapshots and invalid session rows", () => {
    expect(parseAgentTelemetrySnapshot("not-json")).toEqual([]);
    expect(
      parseAgentTelemetrySnapshot(
        JSON.stringify({
          sessions: [
            { id: "missing-status", name: "bad" },
            { id: "ok", name: "OK", status: "done", model: "m", prompt: "p", startedAt: 1, logs: [] },
          ],
        }),
      ).map((item) => item.id),
    ).toEqual(["ok"]);
  });

  it("caps persisted logs and file details to bounded snapshots", () => {
    const raw = serializeAgentTelemetrySnapshot([
      session("large", {
        logs: Array.from({ length: 130 }, (_, index) => ({
          timestamp: index,
          type: "text" as const,
          content: `line ${index}`,
        })),
        changedFileDetails: Array.from({ length: 170 }, (_, index) => ({
          path: `src/${index}.ts`,
          action: "edit" as const,
          toolName: "Edit",
          timestamp: index,
        })),
      }),
    ]);
    const [restored] = parseAgentTelemetrySnapshot(raw);

    expect(restored.logs).toHaveLength(120);
    expect(restored.logs[0]?.content).toBe("line 10");
    expect(restored.changedFileDetails).toHaveLength(160);
    expect(restored.changedFileDetails?.[0]?.path).toBe("src/10.ts");
  });
});
