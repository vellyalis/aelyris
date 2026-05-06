import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RunGraphPanel } from "../features/context/RunGraphPanel";
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

describe("RunGraphPanel", () => {
  it("renders lineage, context pressure, and latest tool activity", () => {
    const onSelectSession = vi.fn();
    render(
      <RunGraphPanel
        activeSessionId="review"
        onSelectSession={onSelectSession}
        sessions={[
          session("build", {
            name: "Builder",
            role: "implementer",
            tokensUsed: 40_000,
            logs: [{ timestamp: 1, type: "tool_use", content: "Edit(src/App.tsx)" }],
          }),
          session("review", {
            name: "Reviewer",
            role: "reviewer",
            handoffFrom: "build",
            tokensUsed: 80_000,
          }),
        ]}
      />,
    );

    expect(screen.getByLabelText("Agent run graph")).toBeTruthy();
    expect(screen.getByText("Run Graph")).toBeTruthy();
    expect(screen.getByText("Links")).toBeTruthy();
    expect(screen.getByText("Roles")).toBeTruthy();
    expect(screen.getByText("Reports")).toBeTruthy();
    expect(screen.getByText("Collect")).toBeTruthy();
    expect(screen.getByText("Builder")).toBeTruthy();
    expect(screen.getByText("Reviewer")).toBeTruthy();
    expect(screen.getByText("from Builder")).toBeTruthy();
    expect(screen.getAllByText("40%").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Edit")).toBeTruthy();

    fireEvent.click(screen.getByText("Reviewer"));
    expect(onSelectSession).toHaveBeenCalledWith("review");
  });

  it("surfaces orphan handoffs instead of hiding broken lineage", () => {
    render(
      <RunGraphPanel
        activeSessionId={null}
        onSelectSession={vi.fn()}
        sessions={[session("orphan", { name: "Detached Reviewer", handoffFrom: "gone" })]}
      />,
    );

    expect(screen.getByText("1 handoff without parent telemetry")).toBeTruthy();
    expect(screen.getByText("orphan handoff")).toBeTruthy();
  });

  it("scopes visible runs to the supplied workstation graph filter", () => {
    const sessions = [
      session("build", { name: "Builder", role: "implementer" }),
      session("review", { name: "Reviewer", role: "reviewer", handoffFrom: "build" }),
      session("audit", { name: "Auditor", role: "reviewer" }),
    ];
    const fullGraph = buildWorkstationGraph({
      workspaceId: "C:/repo",
      sessions,
    });
    const focusedGraph = filterWorkstationGraph(fullGraph, { agentId: "review" });

    render(
      <RunGraphPanel
        activeSessionId={null}
        onSelectSession={vi.fn()}
        sessions={sessions}
        workstationGraph={focusedGraph}
      />,
    );

    expect(screen.getByLabelText("Agent run graph").getAttribute("data-graph-source")).toBe("workstation-graph");
    expect(screen.getByText("Reviewer")).toBeTruthy();
    expect(screen.getByText("Builder")).toBeTruthy();
    expect(screen.queryByText("Auditor")).toBeNull();
  });

  it("renders ownership, workspace scope, write set, report status, and completed collection state", () => {
    const sessions = [
      session("done-agent", {
        name: "Collected Builder",
        status: "done",
        owner: "review-lead",
        workspaceScope: "C:/Users/owner/Aether_Terminal",
        writeSet: ["src/App.tsx", "src/shared/types/agent.ts"],
        finalReport: { status: "missing" },
      }),
    ];
    const graph = buildWorkstationGraph({
      workspaceId: "C:/Users/owner/Aether_Terminal",
      sessions,
      finalReports: [{ id: "report-1", title: "Agent final report", status: "ready", agentId: "done-agent" }],
    });

    render(
      <RunGraphPanel
        activeSessionId="done-agent"
        onSelectSession={vi.fn()}
        sessions={sessions}
        workstationGraph={graph}
      />,
    );

    expect(screen.getByText("Collected Builder")).toBeTruthy();
    expect(screen.getAllByText("Collect").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("owner review-lead")).toBeTruthy();
    expect(screen.getByText("scope .../owner/Aether_Terminal")).toBeTruthy();
    expect(screen.getByText("2 writes")).toBeTruthy();
    expect(screen.getByText("report ready")).toBeTruthy();
  });

  it("surfaces stale and blocked policy state with the next required actor", () => {
    render(
      <RunGraphPanel
        activeSessionId={null}
        onSelectSession={vi.fn()}
        sessions={[
          session("stale", {
            name: "Stale Worker",
            status: "coding",
            startedAt: Date.now() - 20 * 60 * 1000,
            logs: [],
          }),
          session("blocked", {
            name: "Blocked Reviewer",
            status: "waiting",
            blockedReason: "permission required for Bash",
            nextActor: "human",
            logs: [],
          }),
        ]}
      />,
    );

    expect(screen.getByText("Stale Worker").closest("button")?.getAttribute("data-state")).toBe("stale");
    expect(screen.getByText("Blocked Reviewer").closest("button")?.getAttribute("data-state")).toBe("blocked");
    expect(screen.getByText("permission required for Bash · next human")).toBeTruthy();
  });
});
