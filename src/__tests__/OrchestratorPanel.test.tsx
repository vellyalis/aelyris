import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
    owner: partial.owner ?? null,
    priority: partial.priority ?? "medium",
    estimate: null,
    dependencies: partial.dependencies ?? [],
    outputs: partial.outputs ?? [],
    source_branch: partial.source_branch ?? null,
    target_branch: partial.target_branch ?? null,
  };
}

const CAPS = { max_agents: 4, max_tokens: null, max_cost_usd: null, max_runtime_secs: null };

function mockInvoke(tasks: Task[], plan: unknown, decisions: Record<string, string> = {}) {
  tauriMocks.invoke.mockImplementation((cmd: string, args?: Record<string, unknown>) => {
    switch (cmd) {
      case "task_list":
        return Promise.resolve(tasks);
      case "cost_caps":
        return Promise.resolve(CAPS);
      case "event_recent":
        return Promise.resolve([]);
      case "context_all":
        return Promise.resolve(decisions);
      case "orchestrator_plan":
        return Promise.resolve(plan);
      case "plan_build":
        return Promise.resolve(["t1"]);
      case "review_branch":
        return Promise.resolve({
          gates: {
            tests_pass: true,
            lint_pass: true,
            types_pass: true,
            design_consistent: true,
            context_aligned: true,
          },
          verdict: { verdict: "merge" },
          mergeOk: true,
          reasons: [],
        });
      case "orchestrator_step":
        if (args?.gates && Object.keys(args.gates as object).length > 0) {
          return Promise.resolve({
            dispatched: [],
            merged: ["t1"],
            rejected: [],
            recovered: [],
            escalations: [],
            state: "complete",
          });
        }
        return Promise.resolve({
          dispatched: ["t1"],
          merged: [],
          rejected: [],
          recovered: [],
          escalations: [],
          state: "active",
        });
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

  it("renders the shared context-store decisions", async () => {
    mockInvoke([], { to_dispatch: [], state: "complete" }, { "merge-strategy": "auto-ff" });

    render(<OrchestratorPanel />);

    await waitFor(() => expect(screen.getByText("Decisions")).toBeTruthy());
    expect(screen.getByText("merge-strategy")).toBeTruthy();
    expect(screen.getByText("auto-ff")).toBeTruthy();
  });

  it("builds a plan from a goal and explicitly starts the next visible step", async () => {
    mockInvoke([task({ id: "t1", title: "Implement goal", status: "ready" })], {
      to_dispatch: ["t1"],
      state: "active",
    });

    render(<OrchestratorPanel projectPath="C:/repo" />);
    await waitFor(() => expect(screen.getByText("Implement goal")).toBeTruthy());

    fireEvent.change(screen.getByLabelText("Goal"), {
      target: { value: "Add a product-accessible mission flow" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Build plan" }));

    await waitFor(() =>
      expect(tauriMocks.invoke).toHaveBeenCalledWith("plan_build", {
        goal: "Add a product-accessible mission flow",
        context: null,
        repoPath: "C:/repo",
        model: null,
      }),
    );
    await waitFor(() => expect(screen.getByText(/Plan created/)).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "Run next step" }));

    await waitFor(() =>
      expect(tauriMocks.invoke).toHaveBeenCalledWith("orchestrator_step", {
        usage: {
          active_agents: 0,
          tokens_used: 0,
          cost_usd: 0,
          runtime_secs: 0,
        },
        repoPath: "C:/repo",
        reviewerId: "operator",
        gates: {},
      }),
    );
    await waitFor(() => expect(screen.getByText("1 dispatched")).toBeTruthy());
  });

  it("runs real review gates and feeds their verdict into the merge step", async () => {
    mockInvoke([task({ id: "t1", title: "Ready for review", status: "review", owner: "worker-a" })], {
      to_dispatch: [],
      state: "active",
    });

    render(<OrchestratorPanel projectPath="C:/repo" />);

    await waitFor(() => expect(screen.getByText("Ready for review")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Review & merge" }));

    await waitFor(() =>
      expect(tauriMocks.invoke).toHaveBeenCalledWith("review_branch", {
        repoPath: "C:/repo",
        taskId: "t1",
        reviewerId: "cockpit-reviewer",
        model: "codex",
      }),
    );
    await waitFor(() =>
      expect(tauriMocks.invoke).toHaveBeenCalledWith("orchestrator_step", {
        usage: {
          active_agents: 0,
          tokens_used: 0,
          cost_usd: 0,
          runtime_secs: 0,
        },
        repoPath: "C:/repo",
        reviewerId: "cockpit-reviewer",
        gates: {
          t1: {
            tests_pass: true,
            lint_pass: true,
            types_pass: true,
            design_consistent: true,
            context_aligned: true,
          },
        },
      }),
    );
    await waitFor(() => expect(screen.getByText("Ready for review reviewed and merged.")).toBeTruthy());
  });
});
