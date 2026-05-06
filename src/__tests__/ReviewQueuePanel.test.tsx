import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReviewQueuePanel } from "../features/review/ReviewQueuePanel";
import { buildWorkstationGraph } from "../shared/lib/workstationGraph";
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
    cost: 0,
    tokensUsed: 0,
    changedFileDetails: [],
    ...overrides,
  };
}

describe("ReviewQueuePanel", () => {
  it("shows risk, conflict, and agent review metrics", () => {
    render(
      <ReviewQueuePanel
        activeSessionId="a"
        changedFiles={[{ path: "src/App.tsx", status: "modified" }]}
        sessions={[
          session("a", {
            name: "Implementer",
            role: "implementer",
            changedFileDetails: [{ path: "src/App.tsx", action: "edit", toolName: "Edit", timestamp: 1 }],
          }),
          session("b", {
            name: "Reviewer",
            role: "reviewer",
            changedFileDetails: [{ path: "src/App.tsx", action: "edit", toolName: "Edit", timestamp: 2 }],
          }),
        ]}
        onOpenDiff={vi.fn()}
        onSelectSession={vi.fn()}
        onStartAgent={vi.fn()}
      />,
    );

    expect(screen.getByText("Review Queue")).toBeTruthy();
    expect(screen.getByText("Critical")).toBeTruthy();
    expect(screen.getByText("Multi-agent overlap")).toBeTruthy();
    expect(screen.getByText("Merge readiness")).toBeTruthy();
    expect(screen.getAllByText("Blocked").length).toBeGreaterThan(0);
    expect(screen.getByText("Conflicts")).toBeTruthy();
    expect(screen.getByText("Validate")).toBeTruthy();
    expect(screen.getByText("implementer")).toBeTruthy();
    expect(screen.getByText("reviewer")).toBeTruthy();
  });

  it("opens diffs and can start a reviewer agent", () => {
    const onOpenDiff = vi.fn();
    const onStartAgent = vi.fn();

    render(
      <ReviewQueuePanel
        activeSessionId={null}
        changedFiles={[{ path: "src-tauri/Cargo.toml", status: "modified" }]}
        sessions={[]}
        onOpenDiff={onOpenDiff}
        onSelectSession={vi.fn()}
        onStartAgent={onStartAgent}
      />,
    );

    fireEvent.click(screen.getByText("Cargo.toml"));
    expect(onOpenDiff).toHaveBeenCalledWith("src-tauri/Cargo.toml");

    fireEvent.click(screen.getByRole("button", { name: "Start reviewer agent" }));
    expect(onStartAgent).toHaveBeenCalledWith(expect.stringContaining("src-tauri/Cargo.toml"), "opus", {
      role: "reviewer",
    });
    expect(onStartAgent.mock.calls[0][0]).toContain("merge readiness");
    expect(onStartAgent.mock.calls[0][0]).toContain("score");
  });

  it("renders diffstat, coverage, validation, and readiness scoring", () => {
    render(
      <ReviewQueuePanel
        activeSessionId={null}
        changedFiles={[
          {
            path: "src/shared/lib/reviewQueue.ts",
            status: "modified",
            additions: 180,
            deletions: 24,
          },
          { path: "src/__tests__/reviewQueue.test.ts", status: "modified", additions: 20, deletions: 0 },
          { path: "src/generated/schema.generated.ts", status: "modified", generated: true, validation: "missing" },
        ]}
        sessions={[
          session("author", {
            owner: "codex",
            changedFileDetails: [
              { path: "src/shared/lib/reviewQueue.ts", action: "edit", toolName: "Edit", timestamp: 3 },
            ],
            logs: [{ timestamp: 4, type: "tool_result", content: "vitest reviewQueue.test.ts passed" }],
          }),
        ]}
        onOpenDiff={vi.fn()}
        onSelectSession={vi.fn()}
      />,
    );

    expect(screen.getAllByText("180+/24-").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Covered").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Validated").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Validate").length).toBeGreaterThan(0);
    expect(screen.getByText("Generated")).toBeTruthy();
    expect(screen.getByText("codex")).toBeTruthy();
  });

  it("builds the queue from workstation graph file nodes when git status is not loaded", () => {
    const onOpenDiff = vi.fn();
    const workstationGraph = buildWorkstationGraph({
      workspaceId: "C:/repo",
      changedFiles: [{ path: "src-tauri/Cargo.toml", status: "modified" }],
    });

    render(
      <ReviewQueuePanel
        activeSessionId={null}
        changedFiles={[]}
        sessions={[]}
        onOpenDiff={onOpenDiff}
        onSelectSession={vi.fn()}
        workstationGraph={workstationGraph}
      />,
    );

    expect(screen.getByLabelText("AI review queue").getAttribute("data-graph-source")).toBe("workstation-graph");
    expect(screen.getByText("Cargo.toml")).toBeTruthy();
    fireEvent.click(screen.getByText("Cargo.toml"));
    expect(onOpenDiff).toHaveBeenCalledWith("src-tauri/Cargo.toml");
  });

  it("uses graph files as the authoritative queue when a focused graph is supplied", () => {
    const onOpenDiff = vi.fn();
    const sessions = [
      session("agent-a", {
        changedFileDetails: [{ path: "src/focused.ts", action: "edit", toolName: "Edit", timestamp: 1 }],
      }),
    ];
    const workstationGraph = buildWorkstationGraph({
      workspaceId: "C:/repo",
      sessions,
    });

    render(
      <ReviewQueuePanel
        activeSessionId={null}
        changedFiles={[{ path: "src/global.ts", status: "modified" }]}
        sessions={sessions}
        onOpenDiff={onOpenDiff}
        onSelectSession={vi.fn()}
        workstationGraph={workstationGraph}
      />,
    );

    expect(screen.getByText("focused.ts")).toBeTruthy();
    expect(screen.queryByText("global.ts")).toBeNull();
    fireEvent.click(screen.getByText("focused.ts"));
    expect(onOpenDiff).toHaveBeenCalledWith("src/focused.ts");
  });
});
