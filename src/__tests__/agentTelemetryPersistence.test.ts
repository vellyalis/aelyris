import { describe, expect, it } from "vitest";
import {
  createAgentTelemetryRecoverySession,
  loadAgentTelemetrySnapshot,
  parseAgentTelemetrySnapshot,
  parseAgentTelemetrySnapshotResult,
  serializeAgentTelemetrySnapshot,
} from "../shared/lib/agentTelemetryPersistence";
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
        contextRemaining: {
          pct: 12,
          usedPct: 88,
          confidence: "parsed",
          source: "claude_grid_context_left",
          updatedAt: 4_000,
          warn: true,
          hard: false,
        },
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
      contextRemaining: {
        pct: 12,
        usedPct: 88,
        confidence: "parsed",
        source: "claude_grid_context_left",
        updatedAt: 4_000,
        warn: true,
        hard: false,
      },
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

  it("surfaces corrupt snapshots as auditable recovery state and still drops invalid session rows", () => {
    const corrupt = parseAgentTelemetrySnapshotResult("not-json");
    expect(corrupt.sessions).toEqual([]);
    expect(corrupt.error).toMatchObject({
      kind: "invalid-json",
      visibilityPolicy: "corrupt-agent-telemetry-is-auditable",
      rawPreview: "not-json",
    });

    expect(corrupt.error).not.toBeNull();
    const recovery = createAgentTelemetryRecoverySession(
      corrupt.error ?? expect.fail("expected corrupt snapshot error"),
      "test",
    );
    expect(recovery).toMatchObject({
      status: "error",
      name: "Telemetry recovery",
      blockedReason: "Agent telemetry snapshot is corrupt; provenance was not silently discarded.",
      logs: [
        {
          type: "error",
          metadata: {
            event: "agent_telemetry_corrupt_snapshot",
            source: "test",
            visibilityPolicy: "corrupt-agent-telemetry-is-auditable",
          },
        },
      ],
    });

    const storage = {
      getItem: () => "not-json",
      setItem: () => undefined,
      removeItem: () => undefined,
      clear: () => undefined,
      key: () => null,
      length: 1,
    } satisfies Storage;
    expect(loadAgentTelemetrySnapshot(storage)[0]).toMatchObject({
      status: "error",
      blockedReason: "Agent telemetry snapshot is corrupt; provenance was not silently discarded.",
    });

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

  it("reports invalid snapshot shape instead of treating it as an empty healthy snapshot", () => {
    const result = parseAgentTelemetrySnapshotResult(JSON.stringify({ rows: [] }));
    expect(result.sessions).toEqual([]);
    expect(result.error).toMatchObject({
      kind: "invalid-shape",
      message: "snapshot payload is missing a sessions array",
      visibilityPolicy: "corrupt-agent-telemetry-is-auditable",
    });
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
