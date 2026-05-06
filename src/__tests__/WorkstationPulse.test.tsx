import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { WorkstationPulse } from "../features/context/WorkstationPulse";
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
    startedAt: 1,
    logs: [],
    cost: 0.25,
    tokensUsed: 20_000,
    changedFileDetails: [],
    ...overrides,
  };
}

describe("WorkstationPulse", () => {
  it("keeps live context, tokens, and file pressure visible at the rail top", () => {
    render(
      <WorkstationPulse
        changedFilesCount={3}
        sessions={[
          session("a", { tokensUsed: 10_000 }),
          session("b", { status: "waiting", tokensUsed: 40_000, role: "reviewer" }),
        ]}
      />,
    );

    expect(screen.getByLabelText("Workstation pulse")).toBeTruthy();
    expect(screen.getByText("Attention")).toBeTruthy();
    expect(screen.getByText("2")).toBeTruthy();
    expect(screen.getByText("50k")).toBeTruthy();
    expect(screen.getByText("3")).toBeTruthy();
    expect(screen.getByText("Files")).toBeTruthy();
  });

  it("surfaces handoff pressure before review pressure", () => {
    render(<WorkstationPulse changedFilesCount={1} sessions={[session("a", { tokensUsed: 180_000 })]} />);

    expect(screen.getByText("Handoff watch")).toBeTruthy();
    expect(screen.getByText("90% peak context")).toBeTruthy();
  });

  it("uses the workstation graph as the rail file source when git counts are absent", () => {
    const workstationGraph = buildWorkstationGraph({
      workspaceId: "C:/repo",
      changedFiles: [{ path: "src/App.tsx", status: "modified" }],
      sessions: [session("a", { tokensUsed: 5_000 })],
    });

    render(<WorkstationPulse sessions={[session("a", { tokensUsed: 5_000 })]} workstationGraph={workstationGraph} />);

    expect(screen.getByLabelText("Workstation pulse").getAttribute("data-graph-source")).toBe("workstation-graph");
    expect(screen.getByText("Review ready")).toBeTruthy();
    expect(screen.getByText("1 changed file")).toBeTruthy();
  });

  it("prefers the focused graph file count over the global git count", () => {
    const workstationGraph = buildWorkstationGraph({
      workspaceId: "C:/repo",
      changedFiles: [{ path: "src/focused.ts", status: "modified" }],
      sessions: [session("a", { tokensUsed: 5_000 })],
    });

    render(
      <WorkstationPulse
        sessions={[session("a", { tokensUsed: 5_000 })]}
        changedFilesCount={6}
        workstationGraph={workstationGraph}
      />,
    );

    expect(screen.getByText("1 changed file")).toBeTruthy();
    expect(screen.queryByText("6 changed files")).toBeNull();
  });

  it("scopes live and token pressure to graph agent nodes when filtered", () => {
    const sessions = [
      session("build", { tokensUsed: 20_000 }),
      session("review", { tokensUsed: 60_000, handoffFrom: "build" }),
      session("audit", { tokensUsed: 180_000 }),
    ];
    const graph = filterWorkstationGraph(buildWorkstationGraph({ workspaceId: "C:/repo", sessions }), {
      agentId: "review",
    });

    render(<WorkstationPulse sessions={sessions} workstationGraph={graph} />);

    expect(screen.getByLabelText("Workstation pulse").getAttribute("data-graph-source")).toBe("workstation-graph");
    expect(screen.queryByText("90% peak context")).toBeNull();
    expect(screen.getByText("80k")).toBeTruthy();
  });
});
