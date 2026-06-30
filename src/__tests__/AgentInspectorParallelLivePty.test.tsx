import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type AgentFleetSession, headlessToFleetSession } from "../shared/lib/agentFleet";
import type { AgentSession } from "../shared/types/agent";

// ConductorView pulls in ReactFlow, which misbehaves in jsdom.
vi.mock("@xyflow/react", () => ({
  ReactFlow: ({ children }: { children?: React.ReactNode }) => <div data-testid="reactflow-mock">{children}</div>,
  Background: () => null,
  Controls: () => null,
  Handle: () => null,
  Position: { Left: "left", Right: "right", Top: "top", Bottom: "bottom" },
  MarkerType: { ArrowClosed: "arrowclosed" },
}));

vi.mock("../features/diff-viewer/DiffViewer", () => ({
  DiffViewer: () => <div data-testid="diff-viewer-mock" />,
}));

// The real TerminalCanvas needs a live PTY + canvas 2D context (unavailable in
// jsdom); stub it so we can assert which tile mounts a live mirror and with
// what terminalId.
vi.mock("../features/terminal/TerminalCanvas", () => ({
  TerminalCanvas: ({ terminalId }: { terminalId: string }) => (
    <canvas data-testid="fleet-grid-terminal" data-terminal-id={terminalId} />
  ),
}));

import { AgentInspector } from "../features/agent-inspector/AgentInspector";

const headless = (id: string, overrides: Partial<AgentSession> = {}): AgentFleetSession =>
  headlessToFleetSession({
    id,
    name: `Session ${id}`,
    status: "coding",
    model: "claude-opus-4-7",
    prompt: "do stuff",
    startedAt: Date.now() - 60_000,
    logs: [],
    cost: 0.1,
    tokensUsed: 100,
    ...overrides,
  });

const live = (id: string, ptyId: string): AgentFleetSession => ({
  id,
  name: `Session ${id}`,
  status: "coding",
  model: "claude-opus-4-7",
  prompt: "do stuff",
  startedAt: Date.now() - 30_000,
  logs: [],
  cost: 0.2,
  tokensUsed: 200,
  runtime: "interactive",
  runStatus: "coding",
  cwd: "/repo",
  ptyId,
});

let clientWidthSpy: ReturnType<typeof vi.spyOn> | null = null;
let clientHeightSpy: ReturnType<typeof vi.spyOn> | null = null;

beforeEach(() => {
  // FleetGridTerminal measures its container; jsdom reports 0 unless stubbed.
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
      unobserve() {}
    },
  );
  clientWidthSpy = vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(800);
  clientHeightSpy = vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(400);
});

afterEach(() => {
  clientWidthSpy?.mockRestore();
  clientHeightSpy?.mockRestore();
  vi.unstubAllGlobals();
  cleanup();
});

describe("AgentInspector parallel view — live PTY tiles", () => {
  it("mounts a live terminal keyed by ptyId for a running session that owns a PTY", () => {
    render(
      <AgentInspector
        sessions={[live("a", "pty-live-1"), headless("b")]}
        activeSessionId="a"
        onSelectSession={() => {}}
      />,
    );
    fireEvent.click(screen.getByLabelText("Parallel sessions"));

    const canvases = screen.getAllByTestId("fleet-grid-terminal");
    expect(canvases).toHaveLength(1);
    expect(canvases[0].getAttribute("data-terminal-id")).toBe("pty-live-1");
  });

  it("keeps the cheap log-tail fallback for a session without a PTY", () => {
    render(
      <AgentInspector
        sessions={[live("a", "pty-live-1"), headless("b")]}
        activeSessionId="a"
        onSelectSession={() => {}}
      />,
    );
    fireEvent.click(screen.getByLabelText("Parallel sessions"));

    // Headless tile has no logs → the "Waiting for activity..." placeholder.
    expect(screen.getByText("Waiting for activity...")).toBeTruthy();
  });

  it("preserves the summary bar, conflict chip, and --session-accent on the tile", () => {
    const sharedFile = { path: "src/shared.ts", action: "edit" as const, toolName: "Edit", timestamp: Date.now() };
    render(
      <AgentInspector
        sessions={[
          { ...live("a", "pty-live-1"), changedFileDetails: [sharedFile] },
          { ...headless("b"), changedFileDetails: [sharedFile] },
        ]}
        activeSessionId="a"
        onSelectSession={() => {}}
      />,
    );
    fireEvent.click(screen.getByLabelText("Parallel sessions"));

    expect(screen.getByText(/agents running/)).toBeTruthy();
    expect(screen.getByText(/1 file conflict/)).toBeTruthy();

    const tile = screen.getByLabelText("Select session Session a");
    expect(tile.getAttribute("style") ?? "").toContain("--session-accent");
  });

  it("does not mount a live terminal for a done session even if it carries a ptyId", () => {
    // Two running sessions keep the Parallel tab available; the done one (with a
    // stale ptyId) must fall back to the log tail, not a live mirror.
    render(
      <AgentInspector
        sessions={[
          live("a", "pty-live-1"),
          live("c", "pty-live-3"),
          { ...live("b", "pty-done"), status: "done", runStatus: "done" },
        ]}
        activeSessionId="a"
        onSelectSession={() => {}}
      />,
    );
    fireEvent.click(screen.getByLabelText("Parallel sessions"));

    const ids = screen.getAllByTestId("fleet-grid-terminal").map((c) => c.getAttribute("data-terminal-id"));
    expect(ids).toHaveLength(2);
    expect(ids).not.toContain("pty-done");
  });
});
