import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useWorktreeActions } from "../shared/hooks/useWorktreeActions";
import type { AgentSession } from "../shared/types/agent";

// Behavior-based replacement for the old AgentInspectorWorktreeFailure source-
// regex test: assert that worktree create/remove failures surface a toast and
// return null/void (the contract AgentInspector relies on to keep its inline
// form open) instead of being swallowed.

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

const toastErrorMock = vi.fn();
vi.mock("../shared/store/toastStore", () => ({
  toast: { error: (...args: unknown[]) => toastErrorMock(...args) },
}));

function makeOptions(sessions: AgentSession[] = []) {
  return {
    projectPath: "C:/repo",
    sessions,
    addTabWithCwd: vi.fn(),
    stopAgent: vi.fn(),
    onRefresh: vi.fn(),
  };
}

const sessionWithWorktree: AgentSession = {
  id: "s1",
  name: "s1",
  status: "coding",
  model: "claude",
  prompt: "",
  startedAt: 0,
  logs: [],
  cost: 0,
  tokensUsed: 0,
  worktree: { name: "wt", path: "C:/wt", branch: "b", is_main: false, head_sha: "x", status: "Clean" },
};

describe("useWorktreeActions failure handling", () => {
  afterEach(() => vi.clearAllMocks());

  it("returns null and surfaces a toast when create_worktree fails", async () => {
    invokeMock.mockRejectedValueOnce(new Error("git worktree add boom"));
    const { result } = renderHook(() => useWorktreeActions(makeOptions()));

    const out = await result.current.createWorktree("s1", "feature/x");

    expect(out).toBeNull();
    expect(toastErrorMock).toHaveBeenCalledWith("Worktree creation failed", expect.stringContaining("boom"));
  });

  it("surfaces a toast when remove_worktree fails", async () => {
    invokeMock.mockRejectedValueOnce(new Error("git worktree remove boom"));
    const { result } = renderHook(() => useWorktreeActions(makeOptions([sessionWithWorktree])));

    await result.current.removeWorktree("s1");

    expect(toastErrorMock).toHaveBeenCalledWith("Remove worktree failed", expect.stringContaining("boom"));
  });

  it("does nothing when removing a session that has no worktree", async () => {
    const noWorktree: AgentSession = { ...sessionWithWorktree, worktree: undefined };
    const { result } = renderHook(() => useWorktreeActions(makeOptions([noWorktree])));

    await result.current.removeWorktree("s1");

    expect(invokeMock).not.toHaveBeenCalled();
    expect(toastErrorMock).not.toHaveBeenCalled();
  });
});
