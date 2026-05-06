import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DecisionInboxPanel } from "../features/decision-inbox";
import type { AuditEventRecord } from "../shared/types/audit";
import type { AgentSession } from "../shared/types/agent";

afterEach(() => cleanup());

function session(id: string, overrides: Partial<AgentSession> = {}): AgentSession {
  return {
    id,
    name: `Agent ${id}`,
    status: "coding",
    model: "claude-sonnet",
    prompt: "work",
    startedAt: Date.now(),
    logs: [],
    cost: 0,
    tokensUsed: 0,
    ...overrides,
  };
}

function audit(id: number, overrides: Partial<AuditEventRecord> = {}): AuditEventRecord {
  return {
    id,
    timestamp: new Date().toISOString(),
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

describe("DecisionInboxPanel", () => {
  it("renders compact pending decisions with context, risk, consequence, timeout, and focus action", () => {
    const onSelectSession = vi.fn();
    render(
      <DecisionInboxPanel
        activeSessionId={null}
        onSelectSession={onSelectSession}
        auditEvents={[
          audit(2, {
            metadata: {
              decisionRequest: {
                kind: "product_decision",
                reason: "Choose the dashboard completion copy for partial validation.",
              },
              workflowId: "workflow-copy",
            },
          }),
        ]}
        sessions={[
          session("manual", {
            name: "Builder",
            logs: [
              {
                timestamp: Date.now() - 1_000,
                type: "system",
                content: "Needs manual approval: Bash(rm -rf dist)",
                metadata: {
                  event: "watchdog_decision",
                  decision: "manual",
                  toolName: "Bash",
                  riskClasses: ["destructive", "delete"],
                },
              },
            ],
          }),
        ]}
      />,
    );

    expect(screen.getByText("Decision Inbox")).toBeTruthy();
    expect(screen.getByText("Destructive Operation · Builder")).toBeTruthy();
    expect(screen.getByText("Product Direction · workflow-copy")).toBeTruthy();
    expect(screen.getAllByText("Recommended").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Consequence").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Timeout").length).toBeGreaterThan(0);
    expect(screen.getByText("Critical")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Focus Destructive Operation · Builder" }));
    expect(onSelectSession).toHaveBeenCalledWith("manual");
  });

  it("does not show self-healable audit events or auto approvals", () => {
    render(
      <DecisionInboxPanel
        activeSessionId={null}
        onSelectSession={vi.fn()}
        auditEvents={[
          audit(1, {
            action: "retry_scheduled",
            summary: "External dependency probe scheduled",
            metadata: {
              blockerAnalysis: { kind: "external_dependency", status: "blocked" },
              retryPolicy: { action: "probe" },
              notifyUser: true,
            },
          }),
        ]}
        sessions={[
          session("approved", {
            logs: [
              {
                timestamp: Date.now() - 1_000,
                type: "system",
                content: "Auto-approved: Read",
                metadata: { event: "watchdog_decision", decision: "approved", toolName: "Read" },
              },
            ],
          }),
        ]}
      />,
    );

    expect(screen.getByText("No human decisions")).toBeTruthy();
    expect(screen.queryByText("External dependency probe scheduled")).toBeNull();
    expect(screen.queryByText("Agent approved")).toBeNull();
  });

  it("renders decision history separately from pending decisions", () => {
    render(
      <DecisionInboxPanel
        activeSessionId={null}
        onSelectSession={vi.fn()}
        auditEvents={[]}
        sessions={[
          session("denied", {
            logs: [
              {
                timestamp: Date.now() - 3_000,
                type: "error",
                content: "Auto-denied: Bash(curl --token=abc)",
                metadata: {
                  event: "watchdog_decision",
                  decision: "denied",
                  toolName: "Bash",
                  riskClasses: ["secret-bearing"],
                },
              },
            ],
          }),
        ]}
      />,
    );

    expect(screen.getAllByText("History").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Security Exception · Agent denied")).toBeTruthy();
    expect(screen.getByText("denied")).toBeTruthy();
  });
});
