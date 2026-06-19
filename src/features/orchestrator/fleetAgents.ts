import type { AgentEvent } from "../../shared/types/eventBus";
import type { Task } from "../../shared/types/task";

/** A live loop-dispatched agent with a visible PTY pane to mount. */
export interface FleetAgent {
  taskId: string;
  terminalId: string;
  model: string;
  title: string;
}

interface SpawnInfo {
  terminalId: string;
  model: string;
}

/** Narrow an `agent_spawned` payload (mirrors the Rust `AgentSpawned` emit). */
function asSpawnInfo(payload: unknown): { taskId: string; spawn: SpawnInfo } | null {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  const { taskId, terminalId, model } = record;
  if (typeof taskId !== "string" || typeof terminalId !== "string") return null;
  return {
    taskId,
    spawn: { terminalId, model: typeof model === "string" ? model : "sonnet" },
  };
}

/**
 * Derive the live fleet from the event feed + the task graph: every currently
 * **running** task that has an announced visible PTY (its latest `agent_spawned`
 * event). The running set is authoritative for visibility — a tile disappears
 * the moment its task leaves Running (review/merge/done) — while the terminal id
 * and model come from the most recent spawn (a re-dispatch supersedes the old
 * pane). Pure so it is unit-testable without a backend.
 */
export function deriveFleetAgents(events: AgentEvent[], tasks: Task[]): FleetAgent[] {
  const spawns = new Map<string, SpawnInfo>();
  for (const event of events) {
    if (event.kind !== "agent_spawned") continue;
    const parsed = asSpawnInfo(event.payload);
    if (parsed) spawns.set(parsed.taskId, parsed.spawn); // latest wins (events are oldest-first)
  }

  const fleet: FleetAgent[] = [];
  for (const task of tasks) {
    if (task.status !== "running") continue;
    const spawn = spawns.get(task.id);
    if (!spawn) continue;
    fleet.push({ taskId: task.id, terminalId: spawn.terminalId, model: spawn.model, title: task.title });
  }
  return fleet;
}
