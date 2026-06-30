import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tauriMocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: tauriMocks.invoke }));

const fleetMock = vi.hoisted(() => ({ sessions: [] as unknown[] }));
vi.mock("../shared/hooks/useAgentFleet", () => ({
  useAgentFleet: () => ({ fleetSessions: fleetMock.sessions }),
}));

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock("../shared/store/toastStore", () => ({ toast: toastMock }));

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
  toastMock.success.mockReset();
  toastMock.error.mockReset();
  toastMock.info.mockReset();
  tauriMocks.invoke.mockReset();
  tauriMocks.invoke.mockImplementation((cmd: string, _args?: unknown) => {
    switch (cmd) {
      case "merge_intents_pending":
        return Promise.resolve(intents);
      case "inspect_merge_worktree_branch":
        return Promise.resolve(readiness);
      case "merge_diff":
        return Promise.resolve("+added line\n-removed line");
      case "request_merge_intent": {
        const intent = {
          intentId: "merge:t1:uuid",
          repoPath: "/repo",
          sourceBranch: "agent/feat-x",
          targetBranch: "main",
          state: "queued",
          taskId: "t1",
        };
        intents = [intent];
        return Promise.resolve(intent);
      }
      case "approve_merge_intent":
        return Promise.resolve({ intentId: "merge:t1:uuid", status: "merged" });
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

  it("requests a durable merge intent and then surfaces it as approvable", async () => {
    render(<MergeQueuePanel visible onClose={() => {}} />);
    fireEvent.click(screen.getByText("Request merge"));
    await waitFor(() =>
      expect(tauriMocks.invoke).toHaveBeenCalledWith("request_merge_intent", {
        repoPath: "/repo",
        taskId: "t1",
        sessionId: "t1",
        sourceBranch: "agent/feat-x",
        targetBranch: "main",
      }),
    );
    // The reloaded intents now include a queued one → an Approve action appears.
    await waitFor(() => expect(screen.getByText("Approve")).toBeTruthy());
    expect(screen.getByText("queued")).toBeTruthy();
  });

  it("approves an existing intent through the durable approve command", async () => {
    intents = [
      {
        intentId: "merge:t1:uuid",
        repoPath: "/repo",
        sourceBranch: "agent/feat-x",
        targetBranch: "main",
        state: "ready_to_merge",
        taskId: "t1",
      },
    ];
    render(<MergeQueuePanel visible onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText("Approve")).toBeTruthy());
    fireEvent.click(screen.getByText("Approve"));
    await waitFor(() =>
      expect(tauriMocks.invoke).toHaveBeenCalledWith("approve_merge_intent", {
        intentId: "merge:t1:uuid",
        reviewerId: "operator",
      }),
    );
    await waitFor(() => expect(toastMock.success).toHaveBeenCalled());
  });

  it("shows an empty state when no branch is ready", () => {
    fleetMock.sessions = [];
    render(<MergeQueuePanel visible onClose={() => {}} />);
    expect(screen.getByText("No branches ready to merge")).toBeTruthy();
  });
});
