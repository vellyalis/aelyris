import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type AgentFleetSession, headlessToFleetSession } from "../shared/lib/agentFleet";
import type { AgentSession } from "../shared/types/agent";

// ReactFlow doesn't behave well in jsdom (resize observer / measureText). The
// only thing this test cares about is that ConductorView renders *some* DOM
// when the conductor tab is active — the inner DAG fidelity is unrelated to
// the tab-routing bug we're guarding against.
vi.mock("@xyflow/react", () => ({
  ReactFlow: ({ children }: { children?: React.ReactNode }) => <div data-testid="reactflow-mock">{children}</div>,
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

const baseSession = (id: string, overrides: Partial<AgentSession> = {}): AgentFleetSession =>
  headlessToFleetSession({
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
  it("renders session cards as role=button so nested controls stay valid HTML", () => {
    render(<AgentInspector sessions={[baseSession("a")]} activeSessionId="a" onSelectSession={() => {}} />);

    // SessionCard uses role="button" (not <button>) so it can nest action
    // controls without invalid interactive nesting; the card is present.
    expect(screen.getAllByRole("button").length).toBeGreaterThan(0);
    expect(screen.getByText("Session a")).toBeTruthy();
  });

  it("does not pin the raw model id onto session cards", () => {
    render(
      <AgentInspector
        sessions={[baseSession("a", { model: "claude-opus-4-7" })]}
        activeSessionId="a"
        onSelectSession={() => {}}
      />,
    );

    // The raw model id is intentionally not surfaced on the card (low-value
    // metadata). Total cost lives in the summary, not on the card, so it is not
    // asserted here.
    expect(screen.queryByText("claude-opus-4-7")).toBeNull();
  });

  it("names the icon-only session toolbar controls", () => {
    render(<AgentInspector sessions={[baseSession("a")]} activeSessionId="a" onSelectSession={() => {}} />);

    expect(screen.getByLabelText("Copy session info")).toBeTruthy();
    expect(screen.getByLabelText("Add session")).toBeTruthy();
  });

  it("shows an action-oriented empty state when there are no sessions", () => {
    render(<AgentInspector sessions={[]} activeSessionId={null} onSelectSession={() => {}} />);

    expect(screen.getByText("No agent sessions")).toBeTruthy();
    expect(screen.getByText(/Use \+ or Orchestra to start a run/)).toBeTruthy();
  });

  it("hides contextual tabs until their data exists", () => {
    render(
      <AgentInspector sessions={[baseSession("a", { logs: [] })]} activeSessionId="a" onSelectSession={() => {}} />,
    );

    expect(screen.queryByLabelText("Activity")).toBeNull();
    expect(screen.queryByLabelText("Parallel sessions")).toBeNull();
    expect(screen.queryByLabelText("Conductor DAG")).toBeNull();
    expect(screen.queryByLabelText("File diffs")).toBeNull();
  });

  it("shows contextual tabs only for relevant session state", () => {
    const sessions = [
      baseSession("a", {
        role: "reviewer",
        logs: [{ timestamp: 1, type: "text", content: "ready" }],
        changedFileDetails: [{ path: "src/foo.ts", action: "edit", toolName: "Edit", timestamp: Date.now() }],
        filesChanged: 1,
      }),
      baseSession("b"),
    ];
    render(<AgentInspector sessions={sessions} activeSessionId="a" onSelectSession={() => {}} />);

    expect(screen.getByLabelText("Activity")).toBeTruthy();
    expect(screen.getByLabelText("Parallel sessions")).toBeTruthy();
    expect(screen.getByLabelText("Conductor DAG")).toBeTruthy();
    expect(screen.getByLabelText("File diffs")).toBeTruthy();
  });

  it("keeps file diffs scoped to the active session", () => {
    const sessions = [
      baseSession("a", { logs: [] }),
      baseSession("b", {
        changedFileDetails: [{ path: "src/other.ts", action: "edit", toolName: "Edit", timestamp: Date.now() }],
        filesChanged: 1,
      }),
    ];
    render(<AgentInspector sessions={sessions} activeSessionId="a" onSelectSession={() => {}} />);

    expect(screen.queryByLabelText("File diffs")).toBeNull();
  });

  it("conductor tab does not also render the parallel-pane fallback", () => {
    const sessions = [baseSession("a", { role: "implementer" }), baseSession("b", { handoffFrom: "a" })];
    render(<AgentInspector sessions={sessions} activeSessionId="a" onSelectSession={() => {}} />);

    fireEvent.click(screen.getByLabelText("Conductor DAG"));

    // Conductor placeholder must be present (proves we routed to conductor).
    expect(screen.getByTestId("reactflow-mock")).toBeTruthy();
    expect(screen.getByLabelText("Conductor role summary")).toBeTruthy();

    // Bug guard: the parallel-pane fallback must NOT also be rendered.
    // SessionCard buttons have aria-label "Select session ..."; the parallel
    // panes use the same prefix. We assert no node with that aria-label
    // exists when the conductor tab is selected.
    expect(screen.queryAllByLabelText(/^Select session /)).toHaveLength(0);
  });

  it("treats conductor role chips as summaries, not positional graph headers", () => {
    const sources = import.meta.glob("../features/agent-inspector/ConductorView.tsx", {
      query: "?raw",
      import: "default",
      eager: true,
    }) as Record<string, string>;
    const src = Object.values(sources)[0] ?? "";

    expect(src).toContain("roleSummaries");
    expect(src).toContain('aria-label="Conductor role summary"');
    expect(src).not.toContain("columnLabels");
  });

  it("diffs tab does not also render the parallel-pane fallback", () => {
    const sessionWithChanges = baseSession("x", {
      changedFileDetails: [{ path: "src/foo.ts", action: "edit", toolName: "Edit", timestamp: Date.now() }],
      filesChanged: 1,
    });
    render(<AgentInspector sessions={[sessionWithChanges]} activeSessionId="x" onSelectSession={() => {}} />);

    fireEvent.click(screen.getByLabelText("File diffs"));

    // Diffs panel should be present (file path text).
    expect(screen.getByText("src/foo.ts")).toBeTruthy();

    // Bug guard: parallel-pane fallback must not coexist.
    expect(screen.queryAllByLabelText(/^Select session /)).toHaveLength(0);
  });

  it("does not claim there are no file changes when only an estimated file count exists", () => {
    const sessionWithEstimatedChanges = baseSession("x", { changedFileDetails: [], filesChanged: 3 });
    render(<AgentInspector sessions={[sessionWithEstimatedChanges]} activeSessionId="x" onSelectSession={() => {}} />);

    fireEvent.click(screen.getByLabelText("File diffs"));

    expect(
      screen.getByText("This session reported changed files, but file-level diff details were not captured yet."),
    ).toBeTruthy();
    expect(screen.queryByText("This agent session has not modified any files yet.")).toBeNull();
  });

  it("keeps app session tab routing anchored on explicit workspace paths", () => {
    const sources = import.meta.glob("../App.tsx", {
      query: "?raw",
      import: "default",
      eager: true,
    }) as Record<string, string>;
    const src = Object.values(sources)[0] ?? "";

    expect(src).toContain("function sessionTabMatches(session: AgentSession, tabCwd?: string): boolean");
    expect(src).toContain("session.workspaceScope");
    expect(src).toContain("session.worktree?.path");
    expect(src).not.toContain("agent.prompt.includes");
  });

  it("parallel tab still renders parallel panes", () => {
    const sessions = [baseSession("a"), baseSession("b")];
    render(<AgentInspector sessions={sessions} activeSessionId="a" onSelectSession={() => {}} />);

    fireEvent.click(screen.getByLabelText("Parallel sessions"));

    // Sanity: parallel panes appear when explicitly switching to the parallel tab.
    expect(screen.queryAllByLabelText(/^Select session /).length).toBeGreaterThanOrEqual(2);
  });

  it("promotes conductor when parallel sessions have roles or handoffs", () => {
    const sessions = [baseSession("a", { role: "implementer" }), baseSession("b", { handoffFrom: "a" })];
    render(<AgentInspector sessions={sessions} activeSessionId="a" onSelectSession={() => {}} />);

    expect(screen.getByTestId("reactflow-mock")).toBeTruthy();
    expect(screen.getByLabelText("Conductor role summary")).toBeTruthy();
  });

  it("lets users return to the parallel pane view after conductor auto-promotion", () => {
    const sessions = [baseSession("a", { role: "implementer" }), baseSession("b", { handoffFrom: "a" })];
    render(<AgentInspector sessions={sessions} activeSessionId="a" onSelectSession={() => {}} />);

    fireEvent.click(screen.getByLabelText("Parallel sessions"));

    expect(screen.queryAllByLabelText(/^Select session /).length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByTestId("reactflow-mock")).toBeNull();
  });

  it("keeps session activity adaptive instead of rendering a persistent log list", () => {
    const session = baseSession("a", {
      logs: [
        { timestamp: 1, type: "text", content: "older noisy log" },
        { timestamp: 2, type: "text", content: "latest quiet summary" },
      ],
    });
    render(<AgentInspector sessions={[session]} activeSessionId="a" onSelectSession={() => {}} />);

    const latestMentions = screen.getAllByText("latest quiet summary");
    expect(latestMentions).toHaveLength(2);
    expect(screen.queryByText("older noisy log")).toBeNull();

    const summaryButton = latestMentions[1];
    expect(summaryButton).toBeDefined();
    if (!summaryButton) throw new Error("Expected session activity summary trigger");
    fireEvent.click(summaryButton);
    expect(screen.getByText("older noisy log")).toBeTruthy();
  });
});
