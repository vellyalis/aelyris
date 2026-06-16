import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OrchestratorPanel } from "../features/orchestrator/OrchestratorPanel";
import type { Task } from "../shared/types/task";

const tauriMocks = vi.hoisted(() => {
  const listeners = new Map<string, (event: { payload: unknown }) => void>();
  return {
    listeners,
    invoke: vi.fn(),
    listen: vi.fn(async (name: string, cb: (event: { payload: unknown }) => void) => {
      listeners.set(name, cb);
      return () => listeners.delete(name);
    }),
  };
});

vi.mock("@tauri-apps/api/core", () => ({ invoke: tauriMocks.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: tauriMocks.listen }));

function task(partial: Partial<Task> & { id: string }): Task {
  return {
    id: partial.id,
    title: partial.title ?? partial.id,
    description: "",
    status: partial.status ?? "pending",
    owner: null,
    priority: partial.priority ?? "medium",
    estimate: null,
    dependencies: [],
    outputs: [],
    source_branch: null,
    target_branch: null,
  };
}

const CAPS = { max_agents: 4, max_tokens: null, max_cost_usd: null, max_runtime_secs: null };

function mockInvoke(tasks: Task[], plan: unknown) {
  tauriMocks.invoke.mockImplementation((cmd: string) => {
    switch (cmd) {
      case "task_list":
        return Promise.resolve(tasks);
      case "cost_caps":
        return Promise.resolve(CAPS);
      case "event_recent":
        return Promise.resolve([]);
      case "orchestrator_plan":
        return Promise.resolve(plan);
      default:
        return Promise.resolve(null);
    }
  });
}

describe("OrchestratorPanel", () => {
  beforeEach(() => {
    tauriMocks.listeners.clear();
    tauriMocks.invoke.mockReset();
    tauriMocks.listen.mockClear();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders the live task graph, the loop state, and the next dispatch", async () => {
    mockInvoke([task({ id: "t1", title: "Build backend", status: "running" })], {
      to_dispatch: ["t2"],
      state: "active",
    });

    render(<OrchestratorPanel />);

    await waitFor(() => expect(screen.getByText("Build backend")).toBeTruthy());
    expect(screen.getByText("Active")).toBeTruthy();
    expect(screen.getByText("running")).toBeTruthy();
    expect(screen.getByText("t2")).toBeTruthy(); // scheduler's next move
  });

  it("re-renders when the backend pushes task-graph-updated", async () => {
    mockInvoke([task({ id: "t1", title: "First", status: "pending" })], {
      to_dispatch: [],
      state: "active",
    });

    render(<OrchestratorPanel />);
    await waitFor(() => expect(screen.getByText("First")).toBeTruthy());

    act(() => {
      tauriMocks.listeners.get("task-graph-updated")?.({
        payload: [
          task({ id: "t1", title: "First", status: "done" }),
          task({ id: "t2", title: "Second", status: "running" }),
        ],
      });
    });

    await waitFor(() => expect(screen.getByText("Second")).toBeTruthy());
    expect(screen.getByText("done")).toBeTruthy();
  });

  it("shows the empty state and a terminal loop badge for an empty graph", async () => {
    mockInvoke([], { to_dispatch: [], state: "complete" });

    render(<OrchestratorPanel />);

    await waitFor(() => expect(screen.getByText("No tasks in the graph yet")).toBeTruthy());
    expect(screen.getByText("Complete")).toBeTruthy();
  });

  it("renders the recent activity feed from the event bus", async () => {
    mockInvoke([task({ id: "t1", title: "First", status: "review" })], {
      to_dispatch: [],
      state: "active",
    });

    render(<OrchestratorPanel />);
    await waitFor(() => expect(screen.getByText("First")).toBeTruthy());

    act(() => {
      tauriMocks.listeners.get("agent-event")?.({
        payload: { kind: "task_completed", channel: "review", payload: { id: "t1" } },
      });
    });

    await waitFor(() => expect(screen.getByText("merged")).toBeTruthy());
    expect(screen.getByText("Activity")).toBeTruthy();
  });
});
