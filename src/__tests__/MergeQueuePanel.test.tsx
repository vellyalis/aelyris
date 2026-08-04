import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tauriMocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: tauriMocks.invoke }));

const fleetMock = vi.hoisted(() => ({ sessions: [] as unknown[] }));
vi.mock("../shared/hooks/useAgentFleet", () => ({
  useAgentFleet: () => ({ fleetSessions: fleetMock.sessions }),
}));

import { MergeQueuePanel } from "../features/merge-queue/MergeQueuePanel";

function doneSession() {
  return {
    id: "t1",
    name: "Agent t1",
    status: "done",
    runtime: "interactive",
    runStatus: "done",
    model: "claude-sonnet",
    prompt: "",
    startedAt: 0,
    logs: [],
    cost: 0,
    tokensUsed: 0,
    cwd: "/repo",
    worktreeBranch: "agent/feat-x",
    repoPath: "/repo",
  };
}

const readiness = {
  repoPath: "/repo",
  sourceBranch: "agent/feat-x",
  targetBranch: "main",
  sourceOid: "a",
  targetOid: "b",
  mergeBaseOid: "c",
  sourceAhead: 2,
  sourceBehind: 0,
  canFastForward: true,
  alreadyMerged: false,
  status: "fast_forward_ready",
};

let intents: Array<Record<string, unknown>>;

beforeEach(() => {
  fleetMock.sessions = [doneSession()];
  intents = [];
  tauriMocks.invoke.mockReset();
  tauriMocks.invoke.mockImplementation((cmd: string, _args?: unknown) => {
    switch (cmd) {
      case "merge_intents_pending":
        return Promise.resolve(intents);
      case "inspect_merge_worktree_branch":
        return Promise.resolve(readiness);
      case "merge_diff":
        return Promise.resolve("+added line\n-removed line");
      default:
        return Promise.reject(new Error(`unexpected command ${cmd}`));
    }
  });
});

afterEach(() => cleanup());

describe("MergeQueuePanel", () => {
  it("lists a done branch with its merge readiness", async () => {
    render(<MergeQueuePanel visible onClose={() => {}} />);
    expect(screen.getByText("agent/feat-x")).toBeTruthy();
    await waitFor(() => expect(screen.getByText("Fast-forward ready")).toBeTruthy());
    expect(screen.getByText("↑2 ↓0")).toBeTruthy();
  });

  it("loads the three-dot diff on demand", async () => {
    render(<MergeQueuePanel visible onClose={() => {}} />);
    fireEvent.click(screen.getByText("View diff"));
    await waitFor(() => expect(screen.getByText(/\+added line/)).toBeTruthy());
    expect(tauriMocks.invoke).toHaveBeenCalledWith("merge_diff", {
      repoPath: "/repo",
      base: "main",
      branch: "agent/feat-x",
    });
  });

  it("does not expose the retired raw merge request or approval actions", async () => {
    render(<MergeQueuePanel visible onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText("Fast-forward ready")).toBeTruthy());
    expect(screen.queryByText("Request merge")).toBeNull();
    expect(screen.queryByText("Approve")).toBeNull();
    expect(tauriMocks.invoke).not.toHaveBeenCalledWith("request_merge_intent", expect.anything());
    expect(tauriMocks.invoke).not.toHaveBeenCalledWith("approve_merge_intent", expect.anything());
  });

  it("renders a persisted intent with no live session as read-only evidence", async () => {
    fleetMock.sessions = [];
    intents = [
      {
        intentId: "merge:gone:uuid",
        repoPath: "/repo",
        sourceBranch: "agent/old-task",
        targetBranch: "main",
        state: "queued",
        taskId: "gone",
      },
    ];
    render(<MergeQueuePanel visible onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText("agent/old-task")).toBeTruthy());
    expect(screen.getByText("queued")).toBeTruthy();
    expect(screen.queryByText("Approve")).toBeNull();
    expect(screen.queryByText("No branches ready to merge")).toBeNull();
  });

  it("shows an empty state when no branch is ready", () => {
    fleetMock.sessions = [];
    render(<MergeQueuePanel visible onClose={() => {}} />);
    expect(screen.getByText("No branches ready to merge")).toBeTruthy();
  });
});
