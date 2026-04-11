import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { useTaskAgentLink } from "../shared/hooks/useTaskAgentLink";
import type { AgentSession } from "../shared/types/agent";
import type { KanbanTask } from "../shared/types/kanban";

function makeSession(overrides: Partial<AgentSession> = {}): AgentSession {
  return {
    id: "sess-1",
    name: "Test",
    status: "idle",
    model: "sonnet",
    prompt: "test",
    startedAt: Date.now(),
    logs: [],
    cost: 0.5,
    tokensUsed: 1000,
    ...overrides,
  };
}

function makeTask(overrides: Partial<KanbanTask> = {}): KanbanTask {
  return {
    id: "task-1",
    title: "Test task",
    column: "todo",
    priority: "medium",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

describe("useTaskAgentLink", () => {
  it("computes agentStatuses map from sessions", () => {
    const sessions = [
      makeSession({ id: "s1", status: "coding", cost: 0.25 }),
      makeSession({ id: "s2", status: "done", cost: 1.50 }),
    ];
    const { result } = renderHook(() =>
      useTaskAgentLink({ sessions, kanbanTasks: [], moveKanbanTask: () => {} }),
    );
    expect(result.current.agentStatuses).toEqual({
      s1: { status: "coding", cost: 0.25 },
      s2: { status: "done", cost: 1.50 },
    });
  });

  it("returns empty map for no sessions", () => {
    const { result } = renderHook(() =>
      useTaskAgentLink({ sessions: [], kanbanTasks: [], moveKanbanTask: () => {} }),
    );
    expect(result.current.agentStatuses).toEqual({});
  });
});

describe("KanbanTask worktree fields", () => {
  it("task can have branch and worktreePath", () => {
    const task = makeTask({
      branch: "feat/auth",
      worktreePath: "/project-feat/auth",
      assignedAgentId: "sess-1",
    });
    expect(task.branch).toBe("feat/auth");
    expect(task.assignedAgentId).toBe("sess-1");
  });

  it("task without agent fields works", () => {
    const task = makeTask();
    expect(task.assignedAgentId).toBeUndefined();
    expect(task.branch).toBeUndefined();
  });
});
