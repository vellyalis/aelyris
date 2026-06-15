import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useTaskGraph } from "../shared/hooks/useTaskGraph";
import type { Task } from "../shared/types/task";

const tauriMocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  listen: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: tauriMocks.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: tauriMocks.listen }));

function task(id: string, overrides: Partial<Task> = {}): Task {
  return {
    id,
    title: `Task ${id}`,
    description: "",
    status: "pending",
    priority: "medium",
    dependencies: [],
    outputs: [],
    ...overrides,
  };
}

describe("useTaskGraph", () => {
  beforeEach(() => {
    tauriMocks.invoke.mockReset();
    tauriMocks.listen.mockReset();
    tauriMocks.listen.mockResolvedValue(vi.fn());
  });

  it("hydrates from task_list on mount", async () => {
    tauriMocks.invoke.mockImplementation((cmd: string) =>
      cmd === "task_list" ? Promise.resolve([task("root", { status: "ready" })]) : Promise.resolve(null),
    );
    const { result } = renderHook(() => useTaskGraph());
    await waitFor(() => {
      expect(result.current.tasks).toHaveLength(1);
      expect(result.current.tasks[0]).toMatchObject({ id: "root", status: "ready" });
    });
  });

  it("stays in sync with task-graph-updated events", async () => {
    const ref: { current?: (payload: Task[]) => void } = {};
    tauriMocks.listen.mockImplementation((event: string, cb: (e: { payload: Task[] }) => void) => {
      if (event === "task-graph-updated") ref.current = (payload) => cb({ payload });
      return Promise.resolve(vi.fn());
    });
    tauriMocks.invoke.mockResolvedValue([]);

    const { result } = renderHook(() => useTaskGraph());
    await waitFor(() => expect(ref.current).toBeTypeOf("function"));

    act(() => ref.current?.([task("a"), task("b", { status: "running" })]));
    await waitFor(() => {
      expect(result.current.tasks.map((t) => t.id)).toEqual(["a", "b"]);
      expect(result.current.tasks[1].status).toBe("running");
    });
  });

  it("createTask invokes task_create with the task and returns changed ids", async () => {
    tauriMocks.invoke.mockImplementation((cmd: string) =>
      cmd === "task_create" ? Promise.resolve(["root"]) : Promise.resolve([]),
    );
    const { result } = renderHook(() => useTaskGraph());
    const changed = await result.current.createTask(task("root"));
    expect(changed).toEqual(["root"]);
    expect(tauriMocks.invoke).toHaveBeenCalledWith("task_create", { task: expect.objectContaining({ id: "root" }) });
  });

  it("transitionTask invokes task_transition with id + target status", async () => {
    tauriMocks.invoke.mockImplementation((cmd: string) =>
      cmd === "task_transition" ? Promise.resolve([]) : Promise.resolve([]),
    );
    const { result } = renderHook(() => useTaskGraph());
    await result.current.transitionTask("root", "running");
    expect(tauriMocks.invoke).toHaveBeenCalledWith("task_transition", { id: "root", to: "running" });
  });

  it("returns null and reports when a mutation fails", async () => {
    tauriMocks.invoke.mockImplementation((cmd: string) =>
      cmd === "task_create" ? Promise.reject(new Error("boom")) : Promise.resolve([]),
    );
    const { result } = renderHook(() => useTaskGraph());
    const changed = await result.current.createTask(task("x"));
    expect(changed).toBeNull();
  });
});
