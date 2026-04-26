import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentSession } from "../shared/types/agent";

// ReactFlow doesn't behave well in jsdom (resize observer / measureText). The
// only thing this test cares about is that ConductorView renders *some* DOM
// when the conductor tab is active — the inner DAG fidelity is unrelated to
// the tab-routing bug we're guarding against.
vi.mock("@xyflow/react", () => ({
  ReactFlow: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="reactflow-mock">{children}</div>
  ),
  Background: () => null,
  Controls: () => null,
  Handle: () => null,
  Position: { Left: "left", Right: "right", Top: "top", Bottom: "bottom" },
  MarkerType: { ArrowClosed: "arrowclosed" },
}));

// Diff viewer is lazy + Monaco — it must not load in unit tests.
vi.mock("../features/diff-viewer/DiffViewer", () => ({
  DiffViewer: () => <div data-testid="diff-viewer-mock" />,
}));

import { AgentInspector } from "../features/agent-inspector/AgentInspector";

afterEach(() => cleanup());

const baseSession = (id: string, overrides: Partial<AgentSession> = {}): AgentSession => ({
  id,
  name: `Session ${id}`,
  status: "coding",
  model: "claude-opus-4-7",
  prompt: "do stuff",
  startedAt: Date.now() - 60_000,
  logs: [],
  cost: 0.42,
  tokensUsed: 1234,
  ...overrides,
});

describe("AgentInspector tab routing", () => {
  it("conductor tab does not also render the parallel-pane fallback", () => {
    const sessions = [baseSession("a"), baseSession("b")];
    render(
      <AgentInspector
        sessions={sessions}
        activeSessionId="a"
        onSelectSession={() => {}}
      />,
    );

    fireEvent.click(screen.getByLabelText("Conductor DAG"));

    // Conductor placeholder must be present (proves we routed to conductor).
    expect(screen.getByTestId("reactflow-mock")).toBeTruthy();

    // Bug guard: the parallel-pane fallback must NOT also be rendered.
    // SessionCard buttons have aria-label "Select session ..."; the parallel
    // panes use the same prefix. We assert no node with that aria-label
    // exists when the conductor tab is selected.
    expect(screen.queryAllByLabelText(/^Select session /)).toHaveLength(0);
  });

  it("diffs tab does not also render the parallel-pane fallback", () => {
    const sessionWithChanges = baseSession("x", {
      changedFileDetails: [{ path: "src/foo.ts", action: "edit", toolName: "Edit", timestamp: Date.now() }],
      filesChanged: 1,
    });
    render(
      <AgentInspector
        sessions={[sessionWithChanges]}
        activeSessionId="x"
        onSelectSession={() => {}}
      />,
    );

    fireEvent.click(screen.getByLabelText("File diffs"));

    // Diffs panel should be present (file path text).
    expect(screen.getByText("src/foo.ts")).toBeTruthy();

    // Bug guard: parallel-pane fallback must not coexist.
    expect(screen.queryAllByLabelText(/^Select session /)).toHaveLength(0);
  });

  it("parallel tab still renders parallel panes", () => {
    const sessions = [baseSession("a"), baseSession("b")];
    render(
      <AgentInspector
        sessions={sessions}
        activeSessionId="a"
        onSelectSession={() => {}}
      />,
    );

    fireEvent.click(screen.getByLabelText("Parallel sessions"));

    // Sanity: parallel panes appear when explicitly switching to the parallel tab.
    expect(screen.queryAllByLabelText(/^Select session /).length).toBeGreaterThanOrEqual(2);
  });
});
