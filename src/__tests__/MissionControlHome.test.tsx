import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MissionControlHome } from "../features/dashboard/MissionControlHome";
import { buildWorkstationGraph } from "../shared/lib/workstationGraph";
import type { AgentSession } from "../shared/types/agent";
import type { AuditEventRecord } from "../shared/types/audit";

afterEach(() => cleanup());

function session(id: string, overrides: Partial<AgentSession> = {}): AgentSession {
  return {
    id,
    name: `Agent ${id}`,
    status: "coding",
    model: "claude-sonnet",
    prompt: "work",
    startedAt: 1,
    logs: [],
    cost: 0.15,
    tokensUsed: 12_000,
    changedFileDetails: [],
    ...overrides,
  };
}

function auditEvent(id: number, overrides: Partial<AuditEventRecord> = {}): AuditEventRecord {
  return {
    id,
    timestamp: "2026-05-05T10:00:00.000Z",
    category: "agent",
    action: "agent_output",
    severity: "info",
    entityType: "agent",
    entityId: "agent-a",
    summary: "Agent output",
    metadata: {},
    ...overrides,
  };
}

describe("MissionControlHome", () => {
  it("summarizes project, panes, agents, review pressure, blockers, report, release, and health", () => {
    const onOpenObserve = vi.fn();
    const sessions = [
      session("a", { name: "Builder", tokensUsed: 32_000 }),
      session("b", { name: "Reviewer", status: "waiting", tokensUsed: 90_000, role: "reviewer" }),
    ];
    const changedFiles = [
      { path: "src-tauri/Cargo.toml", status: "modified" },
      { path: "src/App.tsx", status: "modified" },
    ];
    const graph = buildWorkstationGraph({
      workspaceId: "C:/repo",
      sessions,
      panes: [
        { paneId: "pane-a", terminalId: "pty-a", status: "live" },
        { paneId: "pane-b", status: "detached" },
      ],
      changedFiles,
    });

    render(
      <MissionControlHome
        projectName="Aether_Terminal"
        projectPath="C:/repo/Aether_Terminal"
        branch="main"
        panes={[
          { paneId: "pane-a", terminalId: "pty-a", lifecycle: "live" },
          { paneId: "pane-b", lifecycle: "detached" },
        ]}
        sessions={sessions}
        changedFiles={changedFiles}
        auditEvents={[
          auditEvent(1, {
            action: "final_report_written",
            summary: "P1-05 final report written",
            category: "final_report",
          }),
        ]}
        workstationGraph={graph}
        contextWarnPct={85}
        onOpenObserve={onOpenObserve}
      />,
    );

    const home = screen.getByLabelText("Mission Control home");
    expect(home.getAttribute("data-graph-source")).toBe("workstation-graph");
    expect(screen.getByText("Mission Control")).toBeTruthy();
    expect(screen.getByText("Aether_Terminal")).toBeTruthy();
    expect(screen.getByText("main")).toBeTruthy();
    expect(screen.getByText("Panes")).toBeTruthy();
    expect(screen.getByText("2 total")).toBeTruthy();
    expect(screen.getByText("Agents")).toBeTruthy();
    expect(screen.getAllByText("Review queue").length).toBeGreaterThan(0);

    const nextAction = screen.getByLabelText("Current next action");
    expect(within(nextAction).getByText("Resolve blocker")).toBeTruthy();
    expect(within(screen.getByLabelText("Recent blockers")).getByText("Reviewer")).toBeTruthy();
    expect(within(screen.getByLabelText("Last final report")).getByText("P1-05 final report written")).toBeTruthy();
    expect(within(screen.getByLabelText("Release readiness")).getByText("Blocked")).toBeTruthy();
    expect(within(screen.getByLabelText("Workspace health")).getByText("Needs attention")).toBeTruthy();

    fireEvent.click(within(nextAction).getByRole("button", { name: "Observe" }));
    expect(onOpenObserve).toHaveBeenCalledTimes(1);
  });

  it("keeps the idle project state actionable without false blockers", () => {
    const onOpenCommand = vi.fn();

    render(
      <MissionControlHome
        projectName="Clean"
        projectPath="C:/repo/Clean"
        branch="main"
        panes={[]}
        sessions={[]}
        changedFiles={[]}
        auditEvents={[]}
        onOpenCommand={onOpenCommand}
      />,
    );

    expect(within(screen.getByLabelText("Current next action")).getByText("Open terminal or start agent")).toBeTruthy();
    expect(within(screen.getByLabelText("Recent blockers")).getByText("No blockers")).toBeTruthy();
    expect(within(screen.getByLabelText("Last final report")).getByText("No final report yet")).toBeTruthy();
    expect(within(screen.getByLabelText("Release readiness")).getByText("Ready")).toBeTruthy();
    expect(within(screen.getByLabelText("Workspace health")).getByText("Healthy")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Command" }));
    expect(onOpenCommand).toHaveBeenCalledTimes(1);
  });
});
