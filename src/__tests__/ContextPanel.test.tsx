import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ContextPanel } from "../features/context/ContextPanel";
import { buildWorkstationGraph, filterWorkstationGraph } from "../shared/lib/workstationGraph";
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
    cost: 0.25,
    tokensUsed: 20_000,
    changedFileDetails: [],
    ...overrides,
  };
}

describe("ContextPanel", () => {
  it("summarizes context pressure, tokens, cost, and touched files", () => {
    render(
      <ContextPanel
        activeSessionId="b"
        sessions={[
          session("a", {
            tokensUsed: 10_000,
            cost: 0.12,
            changedFileDetails: [{ path: "src/App.tsx", action: "edit", toolName: "Edit", timestamp: 1 }],
          }),
          session("b", {
            name: "Reviewer",
            tokensUsed: 100_000,
            cost: 0.88,
            role: "reviewer",
            handoffFrom: "a",
            changedFileDetails: [{ path: "src/App.tsx", action: "edit", toolName: "Edit", timestamp: 2 }],
          }),
        ]}
      />,
    );

    expect(screen.getByText("Context")).toBeTruthy();
    expect(screen.getByText("Peak")).toBeTruthy();
    expect(screen.getAllByText("parsed").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("exact")).toBeTruthy();
    expect(screen.getAllByText("50%").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("100k left")).toBeTruthy();
    expect(screen.getByText("110k")).toBeTruthy();
    expect(screen.getByText("$1.00")).toBeTruthy();
    expect(screen.getAllByText("Reviewer").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("1 files")).toBeTruthy();
  });

  it("surfaces workspace review pressure when git changes exceed session file telemetry", () => {
    render(<ContextPanel activeSessionId="a" changedFilesCount={6} sessions={[session("a", { tokensUsed: 4_000 })]} />);

    expect(screen.getByText("Review queue")).toBeTruthy();
    expect(screen.getByText("6 changed files")).toBeTruthy();
    expect(screen.getByText("6")).toBeTruthy();
  });

  it("uses the focused graph file count instead of global git pressure", () => {
    const workstationGraph = buildWorkstationGraph({
      workspaceId: "C:/repo",
      changedFiles: [{ path: "src/focused.ts", status: "modified" }],
      sessions: [session("a", { name: "Focused", tokensUsed: 4_000 })],
    });

    render(
      <ContextPanel
        activeSessionId="a"
        changedFilesCount={6}
        sessions={[session("a", { name: "Focused", tokensUsed: 4_000 })]}
        workstationGraph={workstationGraph}
      />,
    );

    expect(screen.getByText("Review queue")).toBeTruthy();
    expect(screen.getByText("1 changed file")).toBeTruthy();
    expect(screen.queryByText("6 changed files")).toBeNull();
  });

  it("keeps compact mode focused on summary telemetry", () => {
    render(
      <ContextPanel
        density="compact"
        activeSessionId="b"
        sessions={[
          session("a", { name: "Builder", tokensUsed: 25_000 }),
          session("b", { name: "Reviewer", tokensUsed: 48_000 }),
        ]}
      />,
    );

    expect(screen.getByText("Context")).toBeTruthy();
    expect(screen.getByText("Peak")).toBeTruthy();
    expect(screen.getAllByText("Reviewer").length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByLabelText("Tracked sessions")).toBeNull();
    expect(screen.queryByText("2 total")).toBeNull();
  });

  it("scopes session telemetry to the supplied workstation graph snapshot", () => {
    const sessions = [
      session("build", { name: "Builder", tokensUsed: 20_000 }),
      session("review", { name: "Reviewer", tokensUsed: 60_000, handoffFrom: "build" }),
      session("audit", { name: "Auditor", tokensUsed: 100_000 }),
    ];
    const graph = filterWorkstationGraph(buildWorkstationGraph({ workspaceId: "C:/repo", sessions }), {
      agentId: "review",
    });

    render(<ContextPanel activeSessionId="review" sessions={sessions} workstationGraph={graph} />);

    expect(screen.getByLabelText("Context and agent telemetry").getAttribute("data-graph-source")).toBe(
      "workstation-graph",
    );
    expect(screen.getAllByText("Reviewer").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Builder")).toBeTruthy();
    expect(screen.queryByText("Auditor")).toBeNull();
    expect(screen.getByText("80k")).toBeTruthy();
  });

  it("renders a quiet empty state when no agent telemetry exists", () => {
    render(<ContextPanel activeSessionId={null} sessions={[]} />);

    expect(screen.getByText("Start an agent to capture context, handoff state, and changed files.")).toBeTruthy();
  });

  it("builds a redacted handoff context pack from supplied workspace state", () => {
    render(
      <ContextPanel
        activeSessionId="a"
        sessions={[
          session("a", {
            name: "Builder",
            logs: [{ timestamp: 1, type: "text", content: "Used AETHER_API_TOKEN=secret-value for a local smoke" }],
          }),
        ]}
        projectName="Aether"
        projectPath="C:/repo"
        branch="feature/context-pack"
        changedFiles={[{ path: "src/shared/lib/contextPack.ts", status: "created" }]}
        panes={[{ paneId: "pane-1", terminalId: "term-1", title: "PowerShell", role: "work", status: "live" }]}
        auditEvents={[
          {
            id: 42,
            timestamp: "2026-05-05T12:00:00.000Z",
            category: "agent",
            action: "final_report_written",
            severity: "info",
            entityType: "agent",
            entityId: "a",
            summary: "Context pack ready",
            metadata: { token: "secret-value" },
          },
        ]}
      />,
    );

    const pack = screen.getByLabelText("Context pack builder");
    expect(pack.getAttribute("data-redactions")).toBe("2");
    expect(screen.getByText("Copy project state")).toBeTruthy();
    expect(screen.getByLabelText("Copy context pack markdown")).toBeTruthy();
    expect(screen.getByLabelText("Copy context pack JSON")).toBeTruthy();
    expect(screen.queryByText("secret-value")).toBeNull();
  });
});
