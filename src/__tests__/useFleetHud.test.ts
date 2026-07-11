import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useFleetHud } from "../features/fleet-hud/useFleetHud";
import type { Task } from "../shared/types/task";
import type { TaskStatus } from "../shared/types/taskStatus";

const tauriMocks = vi.hoisted(() => ({ listen: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: tauriMocks.listen }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

function task(id: string, status: TaskStatus): Task {
  return { id, title: id.toUpperCase(), description: "", status, priority: "medium", dependencies: [], outputs: [] };
}

function spawn(taskId: string, model: string) {
  return { payload: { kind: "agent_spawned", payload: { taskId, model, terminalId: `t-${taskId}` } } };
}

describe("useFleetHud", () => {
  let emit: (event: unknown) => void;
  beforeEach(() => {
    tauriMocks.listen.mockReset();
    tauriMocks.listen.mockImplementation((name: string, cb: (e: unknown) => void) => {
      if (name === "agent-event") emit = cb;
      return Promise.resolve(() => {});
    });
  });

  it("shows a card only for dispatched + active tasks, bucketed attention→running→review", async () => {
    const tasks = [task("a", "running"), task("b", "review"), task("c", "blocked"), task("d", "pending")];
    const { result, rerender } = renderHook(({ t }) => useFleetHud(t), { initialProps: { t: tasks } });
    await waitFor(() => expect(typeof emit).toBe("function"));

    act(() => {
      emit(spawn("a", "sonnet"));
      emit(spawn("b", "opus"));
      emit(spawn("c", "haiku"));
      emit(spawn("d", "sonnet")); // dispatched but task is pending → excluded
    });
    rerender({ t: tasks });

    await waitFor(() => expect(result.current.agents).toHaveLength(3));
    expect(result.current.agents.map((a) => a.taskId)).toEqual(["c", "a", "b"]); // attention, running, review
    expect(result.current.agents[0].model).toBe("haiku");
    expect(result.current.summary).toMatchObject({ total: 3, running: 1, review: 1, attention: 1 });
    expect(result.current.hasAgents).toBe(true);
  });

  it("drops an agent from the fleet when its task completes", async () => {
    let tasks = [task("a", "running")];
    const { result, rerender } = renderHook(({ t }) => useFleetHud(t), { initialProps: { t: tasks } });
    await waitFor(() => expect(typeof emit).toBe("function"));

    act(() => emit(spawn("a", "sonnet")));
    rerender({ t: tasks });
    await waitFor(() => expect(result.current.hasAgents).toBe(true));

    tasks = [task("a", "done")];
    rerender({ t: tasks });
    await waitFor(() => expect(result.current.hasAgents).toBe(false));
  });

  it("derives a blocked reason from TaskGraph dependencies without a second fleet owner", async () => {
    const blocked = { ...task("blocked", "blocked"), dependencies: ["setup"] };
    const tasks = [blocked, { ...task("setup", "running"), title: "Setup workspace" }];
    const { result, rerender } = renderHook(({ t }) => useFleetHud(t), { initialProps: { t: tasks } });
    await waitFor(() => expect(typeof emit).toBe("function"));
    act(() => emit(spawn("blocked", "codex")));
    rerender({ t: tasks });
    await waitFor(() => expect(result.current.agents).toHaveLength(1));
    expect(result.current.agents[0].attentionReason).toBe("Waiting for Setup workspace");
  });
});
