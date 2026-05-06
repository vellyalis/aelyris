import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToolLedgerPanel } from "../features/context/ToolLedgerPanel";
import { buildWorkstationGraph, filterWorkstationGraph } from "../shared/lib/workstationGraph";
import type { AgentSession } from "../shared/types/agent";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

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

describe("ToolLedgerPanel", () => {
  it("renders compact tool state and selects sessions", () => {
    const onSelectSession = vi.fn();
    render(
      <ToolLedgerPanel
        activeSessionId="a"
        onSelectSession={onSelectSession}
        sessions={[
          session("a", {
            name: "Builder",
            role: "implementer",
            logs: [{ timestamp: Date.now() - 500, type: "tool_use", content: "Bash(pnpm test)" }],
          }),
          session("b", {
            name: "Reviewer",
            status: "waiting",
            logs: [{ timestamp: Date.now() - 1_000, type: "error", content: "needs approval" }],
          }),
        ]}
      />,
    );

    expect(screen.getByText("Run Ledger")).toBeTruthy();
    expect(screen.getByText("Builder")).toBeTruthy();
    expect(screen.getByText("Reviewer")).toBeTruthy();
    expect(screen.getByText("Bash")).toBeTruthy();
    expect(screen.getByText("Manual")).toBeTruthy();
    expect(screen.getByText("Denied")).toBeTruthy();
    expect(screen.getByText("Wait")).toBeTruthy();

    fireEvent.click(screen.getByTitle("Builder: Bash(pnpm test)"));
    expect(onSelectSession).toHaveBeenCalledWith("a");
  });

  it("renders an empty state without sessions", () => {
    render(<ToolLedgerPanel activeSessionId={null} sessions={[]} onSelectSession={() => {}} />);

    expect(screen.getByText("No runs yet")).toBeTruthy();
  });

  it("ticks age labels without waiting for a new agent event", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:10.000Z"));

    render(
      <ToolLedgerPanel
        activeSessionId={null}
        sessions={[
          session("a", {
            logs: [{ timestamp: Date.now() - 1_000, type: "tool_result", content: "done" }],
          }),
        ]}
        onSelectSession={() => {}}
      />,
    );

    expect(screen.getByText("1s")).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(30_000);
    });

    expect(screen.getByText("31s")).toBeTruthy();
  });

  it("scopes visible ledger rows to graph agent nodes", () => {
    const now = Date.now();
    const sessions = [
      session("build", {
        name: "Builder",
        logs: [{ timestamp: now - 1_000, type: "tool_use", content: "Bash(pnpm build)" }],
      }),
      session("review", {
        name: "Reviewer",
        handoffFrom: "build",
        logs: [{ timestamp: now - 2_000, type: "tool_use", content: "Edit(src/App.tsx)" }],
      }),
      session("audit", {
        name: "Auditor",
        logs: [{ timestamp: now - 3_000, type: "tool_use", content: "Read(src/Other.tsx)" }],
      }),
    ];
    const graph = filterWorkstationGraph(buildWorkstationGraph({ workspaceId: "C:/repo", sessions }), {
      agentId: "review",
    });

    render(
      <ToolLedgerPanel
        activeSessionId={null}
        sessions={sessions}
        workstationGraph={graph}
        onSelectSession={() => {}}
      />,
    );

    expect(screen.getByLabelText("Run and tool ledger").getAttribute("data-graph-source")).toBe("workstation-graph");
    expect(screen.getByText("Builder")).toBeTruthy();
    expect(screen.getByText("Reviewer")).toBeTruthy();
    expect(screen.queryByText("Auditor")).toBeNull();
  });

  it("surfaces approval, denial, error, waiting, and quiet breakdowns", () => {
    const now = Date.now();

    render(
      <ToolLedgerPanel
        activeSessionId={null}
        sessions={[
          session("manual", {
            logs: [
              {
                timestamp: now - 1_000,
                type: "system",
                content: "Needs manual approval: Bash",
                metadata: { event: "watchdog_decision", decision: "manual", toolName: "Bash" },
              },
            ],
          }),
          session("denied", {
            logs: [
              {
                timestamp: now - 2_000,
                type: "error",
                content: "Auto-denied: Bash",
                metadata: { event: "watchdog_decision", decision: "denied", toolName: "Bash" },
              },
            ],
          }),
          session("error", {
            status: "error",
            logs: [{ timestamp: now - 3_000, type: "error", content: "failed" }],
          }),
          session("waiting", {
            status: "waiting",
            logs: [{ timestamp: now - 4_000, type: "text", content: "waiting" }],
          }),
          session("quiet", {
            logs: [{ timestamp: now - 8 * 60 * 1000, type: "text", content: "working" }],
          }),
        ]}
        onSelectSession={() => {}}
      />,
    );

    expect(screen.getByText("Manual")).toBeTruthy();
    expect(screen.getByText("Denied")).toBeTruthy();
    expect(screen.getByText("Err")).toBeTruthy();
    expect(screen.getByText("Wait")).toBeTruthy();
    expect(screen.getByText("Silent")).toBeTruthy();
    expect(screen.getAllByText("8m").length).toBeGreaterThanOrEqual(1);
  });
});
