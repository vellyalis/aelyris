import { describe, expect, it } from "vitest";
import { buildDecisionInbox, isTrueHumanDecisionKind } from "../shared/lib/decisionInbox";
import type { AgentFleetSession } from "../shared/lib/agentFleet";

import type { AuditEventRecord } from "../shared/types/audit";

function session(id: string, overrides: Partial<AgentFleetSession> = {}): AgentFleetSession {
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
    runtime: "headless",
    runStatus: "coding",
    cwd: "",
    ...overrides,
  };
}

function audit(id: number, overrides: Partial<AuditEventRecord> = {}): AuditEventRecord {
  return {
    id,
    timestamp: "2026-05-05T00:00:00.000Z",
    category: "workflow",
    action: "decision_requested",
    severity: "warn",
    entityType: "workflow",
    entityId: "workflow-a",
    summary: "Decision requested",
    metadata: {},
    ...overrides,
  };
}

describe("decisionInbox", () => {
  it("keeps only explicit human decision kinds", () => {
    expect(isTrueHumanDecisionKind("product_decision")).toBe(true);
    expect(isTrueHumanDecisionKind("code_conflict")).toBe(true);
    expect(isTrueHumanDecisionKind("destructive")).toBe(true);
    expect(isTrueHumanDecisionKind("external_dependency")).toBe(false);
    expect(isTrueHumanDecisionKind("validation_failed")).toBe(false);
    expect(isTrueHumanDecisionKind("timeout")).toBe(false);
  });

  it("derives pending manual watchdog approvals and excludes auto approvals", () => {
    const inbox = buildDecisionInbox({
      now: 10_000,
      sessions: [
        session("manual", {
          name: "Builder",
          logs: [
            {
              timestamp: 9_000,
              type: "system",
              content: "Needs manual approval: Bash(rm -rf .cache)",
              metadata: {
                event: "watchdog_decision",
                decision: "manual",
                toolName: "Bash",
                riskClasses: ["destructive", "delete"],
              },
            },
          ],
        }),
        session("approved", {
          logs: [
            {
              timestamp: 8_000,
              type: "system",
              content: "Auto-approved: Read",
              metadata: { event: "watchdog_decision", decision: "approved", toolName: "Read" },
            },
          ],
        }),
      ],
    });

    expect(inbox.pendingCount).toBe(1);
    expect(inbox.pendingItems[0]).toMatchObject({
      sessionId: "manual",
      type: "destructive_operation",
      risk: "critical",
      status: "pending",
    });
    expect(inbox.items.some((item) => item.sessionId === "approved")).toBe(false);
  });

  it("routes workflow product and conflict decisions while ignoring self-healable blockers", () => {
    const inbox = buildDecisionInbox({
      auditEvents: [
        audit(1, {
          metadata: {
            decisionRequest: {
              kind: "product_decision",
              reason: "Pick whether release doctor blocks unsigned dev builds.",
            },
            workflowId: "workflow-product",
          },
        }),
        audit(2, {
          metadata: {
            blockerAnalysis: {
              kind: "code_conflict",
              reason: "Merge conflict strategy required for src/App.tsx.",
              status: "blocked",
            },
            taskId: "P2-02",
            notifyUser: true,
          },
        }),
        audit(3, {
          action: "retry_scheduled",
          summary: "External dependency probe scheduled",
          metadata: {
            blockerAnalysis: { kind: "external_dependency", status: "blocked" },
            retryPolicy: { action: "probe" },
            notifyUser: true,
          },
        }),
      ],
    });

    expect(inbox.pendingItems.map((item) => item.type)).toEqual(["merge_conflict_strategy", "product_direction"]);
    expect(inbox.pendingItems.some((item) => item.context.includes("External dependency"))).toBe(false);
  });

  it("lifts live workflow waiting-gate state into the decision inbox without audit delivery", () => {
    const inbox = buildDecisionInbox({
      now: 11_000,
      workflows: [
        {
          id: "workflow-live",
          workflow_name: "Release gate",
          task_title: "Ship release",
          current_phase: 1,
          phases: [
            {
              name: "review",
              status: "waiting_gate",
              decision_request: {
                kind: "human_review",
                reason: "Approve signed updater manifest before publish.",
                options: ["approve", "reject"],
                default_option: "approve",
                requested_at: "10000",
              },
            },
          ],
        },
      ],
    });

    expect(inbox.pendingCount).toBe(1);
    expect(inbox.pendingItems[0]).toMatchObject({
      source: "workflow",
      workflowId: "workflow-live",
      type: "permission_required",
      context: "Approve signed updater manifest before publish.",
    });
  });

  it("surfaces a waiting interactive agent as a keystroke-resolvable approval carrying its ptyId", () => {
    const inbox = buildDecisionInbox({
      now: 5_000,
      sessions: [
        session("int-wait", {
          name: "claude interactive",
          status: "waiting",
          runtime: "interactive",
          runStatus: "waiting_approval",
          ptyId: "pty-7",
          cli: "claude",
        }),
      ],
    });

    expect(inbox.pendingCount).toBe(1);
    expect(inbox.pendingItems[0]).toMatchObject({
      sessionId: "int-wait",
      ptyId: "pty-7",
      type: "permission_required",
      source: "agent",
      status: "pending",
    });
    expect(inbox.pendingItems[0].evidence).toContain("runStatus=waiting_approval");
  });

  it("surfaces a blocked interactive agent for inspection only (no keystroke resolution)", () => {
    const inbox = buildDecisionInbox({
      now: 5_000,
      sessions: [
        session("int-block", {
          name: "codex interactive",
          status: "waiting",
          runtime: "interactive",
          runStatus: "blocked",
          ptyId: "pty-8",
          blockedReason: "Needs human direction on merge strategy",
        }),
      ],
    });

    expect(inbox.pendingCount).toBe(1);
    const item = inbox.pendingItems[0];
    expect(item).toMatchObject({ sessionId: "int-block", source: "agent", status: "pending" });
    // `blocked` is broader than an approval prompt, so it is Focus-only: no ptyId
    // means the panel renders no Approve/Deny and never sends a blind keystroke.
    expect(item.ptyId).toBeUndefined();
    expect(item.context).toContain("merge strategy");
  });

  it("emits a single row for a blocked interactive gate even when nextActor is set", () => {
    const inbox = buildDecisionInbox({
      now: 5_000,
      sessions: [
        session("int-dup", {
          name: "claude interactive",
          status: "waiting",
          runtime: "interactive",
          runStatus: "blocked",
          ptyId: "pty-9",
          nextActor: "human",
          blockedReason: "Permission required for destructive command",
        }),
      ],
    });

    const forSession = inbox.items.filter((item) => item.sessionId === "int-dup");
    expect(forSession).toHaveLength(1);
    expect(forSession[0]).toMatchObject({ source: "agent", status: "pending" });
    expect(forSession[0].ptyId).toBeUndefined();
  });

  it("does not surface an interactive approval that has no addressable pty id", () => {
    const inbox = buildDecisionInbox({
      sessions: [
        session("no-pty", {
          runtime: "interactive",
          runStatus: "waiting_approval",
          ptyId: undefined,
        }),
      ],
    });

    expect(inbox.pendingCount).toBe(0);
  });

  it("does not treat a headless waiting run as a keystroke-resolvable approval", () => {
    const inbox = buildDecisionInbox({
      sessions: [
        session("headless-wait", {
          runtime: "headless",
          runStatus: "waiting_approval",
          ptyId: "pty-x",
        }),
      ],
    });

    expect(inbox.pendingCount).toBe(0);
  });

  it("keeps denied watchdog decisions in history instead of the pending queue", () => {
    const inbox = buildDecisionInbox({
      sessions: [
        session("denied", {
          logs: [
            {
              timestamp: 7_000,
              type: "error",
              content: "Auto-denied: Bash(curl token)",
              metadata: {
                event: "watchdog_decision",
                decision: "denied",
                toolName: "Bash",
                riskClasses: ["network", "secret-bearing"],
              },
            },
          ],
        }),
      ],
    });

    expect(inbox.pendingCount).toBe(0);
    expect(inbox.historyItems).toHaveLength(1);
    expect(inbox.historyItems[0]).toMatchObject({ status: "decided", type: "security_exception" });
  });
});
