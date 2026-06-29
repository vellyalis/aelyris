import { describe, expect, it } from "vitest";
import { deriveCommandRecoveryPlan } from "../shared/lib/commandRecovery";
import { buildWorkstationGraph } from "../shared/lib/workstationGraph";
import type { AgentSession } from "../shared/types/agent";
import type { AuditEventRecord } from "../shared/types/audit";

function emitRecoveryCheck(name: string, value: Record<string, unknown>) {
  console.log(`AELYRIS_COMMAND_RECOVERY_CHECK ${JSON.stringify({ name, value })}`);
}

function session(id: string, overrides: Partial<AgentSession> = {}): AgentSession {
  return {
    id,
    name: `Agent ${id}`,
    status: "coding",
    model: "gpt-5.5",
    prompt: "work",
    startedAt: 1,
    logs: [],
    cost: 0,
    tokensUsed: 12_000,
    ...overrides,
  };
}

function audit(overrides: Partial<AuditEventRecord> = {}): AuditEventRecord {
  return {
    id: 42,
    timestamp: "2026-05-19T12:00:00.000Z",
    category: "terminal",
    action: "send_keys_failed",
    severity: "warn",
    entityType: "command_block",
    entityId: "cmd-fail",
    summary: "Failed to send retry input to stale native fallback pane",
    metadata: {
      commandBlockId: "cmd-fail",
      correlationId: "terminal:pane-impl:cmd-fail",
      error: "writer unavailable",
      backend: "native-fallback",
      stale: true,
      redacted: true,
    },
    ...overrides,
  };
}

describe("deriveCommandRecoveryPlan", () => {
  it("turns a failed command into retry, handoff, recovery actions, and audit payloads", () => {
    const owner = session("impl", {
      name: "Implementer",
      status: "error",
      role: "implementer",
      worktree: {
        name: "native-edge",
        path: "C:/repo/.aelyris/worktrees/native-edge",
        branch: "codex/native-edge",
        is_main: false,
        head_sha: "abc123",
        status: "Modified",
      },
      changedFileDetails: [
        { path: "src/features/terminal/NativeTerminalArea.tsx", action: "edit", toolName: "apply_patch", timestamp: 2 },
      ],
      logs: [{ timestamp: 3, type: "error", content: "pnpm test failed" }],
    });
    const command = {
      id: "cmd-fail",
      command: "pnpm test -- NativeTerminalArea",
      cwd: "C:/repo",
      status: "failed",
      exitCode: 1,
      paneId: "pane-impl",
      terminalId: "term-impl",
      processId: 4242,
      agentId: "impl",
      filePaths: ["src/features/terminal/NativeTerminalArea.tsx"],
      validationKind: "test",
      endSequence: 99,
      endHistorySize: 200,
    } as const;
    const graph = buildWorkstationGraph({
      workspaceId: "C:/repo",
      sessions: [owner],
      panes: [{ paneId: "pane-impl", terminalId: "term-impl", role: "work", status: "stale" }],
      commandBlocks: [command],
      risks: [
        {
          id: "cmd-risk",
          title: "Failed terminal validation",
          status: "open",
          severity: "high",
          filePath: "src/features/terminal/NativeTerminalArea.tsx",
          agentId: "impl",
        },
      ],
    });

    const plan = deriveCommandRecoveryPlan({
      workspaceId: "C:/repo",
      sessions: [owner],
      commandBlocks: [command],
      auditEvents: [audit()],
      workstationGraph: graph,
      pendingDecisionCount: 1,
    });

    expect(plan.status).toBe("ready");
    expect(plan.checks).toEqual({
      failedCommandDetected: true,
      recoveryHintReady: true,
      retryReady: true,
      handoffReady: true,
      auditPayloadsReady: true,
      noSilentFallback: true,
    });
    expect(plan.retry).toMatchObject({
      command: "pnpm test -- NativeTerminalArea",
      cwd: "C:/repo",
      paneId: "pane-impl",
      terminalId: "term-impl",
    });
    expect(plan.handoff?.prompt).toContain("Before retrying, inspect the audit payload");
    expect(plan.handoff?.files).toEqual(["src/features/terminal/NativeTerminalArea.tsx"]);
    expect(plan.provenance[0]).toMatchObject({
      hasEvidence: true,
      path: "src/features/terminal/NativeTerminalArea.tsx",
    });
    expect(plan.actions.map((action) => action.id)).toEqual(
      expect.arrayContaining(["resolve-approvals", "recover-attention", "inspect-risk"]),
    );
    expect(plan.guards).toEqual(
      expect.arrayContaining(["failed-command-visible", "manual-confirmation-required", "no-silent-retry"]),
    );
    expect(plan.guards).toEqual(expect.arrayContaining(["fallback-visible", "stale-state-visible"]));
    expect(plan.auditPayloads[0]).toMatchObject({
      recovery: {
        failedCommandId: "cmd-fail",
        failedCommand: "pnpm test -- NativeTerminalArea",
        exitCode: 1,
        auditEventId: 42,
        correlationId: "terminal:pane-impl:cmd-fail",
        recoveryKind: "restart-pane",
        retryCommand: "pnpm test -- NativeTerminalArea",
        affectedFiles: ["src/features/terminal/NativeTerminalArea.tsx"],
      },
    });

    emitRecoveryCheck("failedCommandRecovery", {
      status: plan.status,
      checks: plan.checks,
      actionIds: plan.actions.map((action) => action.id),
      guardIds: plan.guards,
      auditPayloadCount: plan.auditPayloads.length,
      retryCommand: plan.retry?.command,
      handoffFiles: plan.handoff?.files,
      provenanceHasEvidence: plan.provenance.every((trace) => trace.hasEvidence),
    });
  });

  it("routes denied tool recovery through review denial without silently retrying", () => {
    const command = {
      id: "cmd-denied",
      command: "npm run deploy",
      cwd: "C:/repo",
      status: "failed",
      exitCode: 1,
      agentId: "review",
      filePaths: ["package.json"],
    } as const;
    const plan = deriveCommandRecoveryPlan({
      workspaceId: "C:/repo",
      sessions: [session("review", { status: "waiting", role: "reviewer" })],
      commandBlocks: [command],
      auditEvents: [
        audit({
          id: 43,
          action: "watchdog_decision",
          summary: "Deploy denied by owner policy",
          metadata: { commandBlockId: "cmd-denied", decision: "denied", correlationId: "watchdog:cmd-denied" },
        }),
      ],
      pendingDecisionCount: 1,
    });

    expect(plan.recoveryHint).toMatchObject({
      kind: "review-denial",
      recoverable: true,
      label: "Review denial",
    });
    expect(plan.checks.noSilentFallback).toBe(true);
    expect(plan.retry?.expectedResult).toContain("owner confirms recovery");
    expect(plan.auditPayloads.every((payload) => payload.recovery.recoveryKind === "review-denial")).toBe(true);

    emitRecoveryCheck("deniedToolRecovery", {
      status: plan.status,
      checks: plan.checks,
      recoveryKind: plan.recoveryHint.kind,
      auditPayloadCount: plan.auditPayloads.length,
      guardIds: plan.guards,
    });
  });
});
