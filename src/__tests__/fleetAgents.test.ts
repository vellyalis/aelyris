import { describe, expect, it } from "vitest";
import { deriveFleetAgents } from "../features/orchestrator/fleetAgents";
import type { AgentEvent } from "../shared/types/eventBus";
import type { Task } from "../shared/types/task";
import type { TaskStatus } from "../shared/types/taskStatus";

function spawnEvent(taskId: string, terminalId: string, model = "sonnet"): AgentEvent {
  return { kind: "agent_spawned", channel: "system", payload: { taskId, terminalId, model } };
}

function task(id: string, status: TaskStatus, title = id): Task {
  return {
    id,
    title,
    description: "",
    status,
    priority: "medium",
    dependencies: [],
    outputs: [],
  };
}

describe("deriveFleetAgents", () => {
  it("returns a tile for each running task that has an announced pane", () => {
    const events = [spawnEvent("t1", "term-1", "opus"), spawnEvent("t2", "term-2", "codex")];
    const tasks = [task("t1", "running", "Build login"), task("t2", "running", "Wire API")];

    const fleet = deriveFleetAgents(events, tasks);

    expect(fleet).toEqual([
      { taskId: "t1", terminalId: "term-1", model: "opus", title: "Build login" },
      { taskId: "t2", terminalId: "term-2", model: "codex", title: "Wire API" },
    ]);
  });

  it("hides a task that is not running even if it was spawned (left Running -> tile gone)", () => {
    const events = [spawnEvent("t1", "term-1")];
    // The task moved Running -> review after its agent exited: no live pane.
    expect(deriveFleetAgents(events, [task("t1", "review")])).toEqual([]);
    expect(deriveFleetAgents(events, [task("t1", "done")])).toEqual([]);
  });

  it("hides a running task with no announced pane", () => {
    expect(deriveFleetAgents([], [task("t1", "running")])).toEqual([]);
  });

  it("uses the latest spawn when a task is re-dispatched (new terminal supersedes)", () => {
    const events = [spawnEvent("t1", "term-old"), spawnEvent("t1", "term-new", "opus")];
    const fleet = deriveFleetAgents(events, [task("t1", "running")]);
    expect(fleet).toHaveLength(1);
    expect(fleet[0].terminalId).toBe("term-new");
    expect(fleet[0].model).toBe("opus");
  });

  it("ignores non-spawn events and malformed payloads", () => {
    const events: AgentEvent[] = [
      { kind: "task_created", channel: "planning", payload: { id: "t1" } },
      { kind: "agent_spawned", channel: "system", payload: { taskId: "t1" } }, // missing terminalId
      { kind: "agent_spawned", channel: "system", payload: null },
    ];
    expect(deriveFleetAgents(events, [task("t1", "running")])).toEqual([]);
  });

  it("defaults a missing model to sonnet", () => {
    const events: AgentEvent[] = [
      { kind: "agent_spawned", channel: "system", payload: { taskId: "t1", terminalId: "term-1" } },
    ];
    expect(deriveFleetAgents(events, [task("t1", "running")])[0].model).toBe("sonnet");
  });
});
