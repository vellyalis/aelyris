import { listen } from "@tauri-apps/api/event";
import { useEffect, useMemo, useState } from "react";
import { isTauriRuntime } from "../../shared/lib/tauriRuntime";
import type { Task } from "../../shared/types/task";
import type { TaskStatus } from "../../shared/types/taskStatus";

/**
 * Fleet HUD data (visible-fleet overview). The dispatched fleet is the autonomy
 * loop's PaneFleet agents — which live in the Task Graph (status) and announce
 * themselves via the `agent_spawned` event (model + spawn time), NOT in the
 * AgentInspector's `useAgentFleet` registry. So the HUD joins those two live
 * signals: a card per task that has been dispatched and is still active.
 */
export type FleetBucket = "attention" | "error" | "running" | "review";

export interface FleetHudAgent {
  taskId: string;
  title: string;
  model: string;
  status: TaskStatus;
  bucket: FleetBucket;
  /** Epoch ms the agent was dispatched (from the spawn event), for elapsed. */
  startedAt: number;
  /** TaskGraph-owned reason for attention state; never inferred from logs. */
  attentionReason?: string;
}

export interface FleetHudSummary {
  total: number;
  running: number;
  review: number;
  /** blocked + failed — the agents that may need a human. */
  attention: number;
}

interface SpawnInfo {
  model: string;
  terminalId: string;
  startedAt: number;
}

/** Only dispatched-and-still-active tasks are fleet members; done/pending drop. */
const ACTIVE: ReadonlySet<TaskStatus> = new Set<TaskStatus>(["running", "review", "blocked", "failed"]);

function bucketOf(status: TaskStatus): FleetBucket {
  switch (status) {
    case "blocked":
      return "attention";
    case "failed":
      return "error";
    case "review":
      return "review";
    default:
      return "running";
  }
}

// attention first (needs a human), then error, then live work, then review.
const ORDER: Record<FleetBucket, number> = { attention: 0, error: 1, running: 2, review: 3 };

function attentionReason(task: Task, tasksById: ReadonlyMap<string, Task>): string | undefined {
  if (task.status === "failed") return "Task execution failed; no structured failure reason was recorded.";
  if (task.status !== "blocked") return undefined;
  const incomplete = task.dependencies.flatMap((id) => {
    const dependency = tasksById.get(id);
    return dependency && dependency.status !== "done" ? [dependency] : [];
  });
  if (incomplete.length === 0) return "Task is blocked; no structured reason was recorded.";
  return `Waiting for ${incomplete.map((dependency) => dependency.title || dependency.id).join(", ")}`;
}

export function useFleetHud(tasks: Task[]): {
  agents: FleetHudAgent[];
  summary: FleetHudSummary;
  hasAgents: boolean;
} {
  const [spawns, setSpawns] = useState<ReadonlyMap<string, SpawnInfo>>(() => new Map());

  // Subscribe to the loop's spawn announcements; record each agent's model and
  // first-seen time (its dispatch moment) so elapsed is stable across re-renders.
  useEffect(() => {
    if (!isTauriRuntime()) return;
    let cancelled = false;
    let unlisten: (() => void) | null = null;

    void listen<{ kind?: string; payload?: { taskId?: unknown; terminalId?: unknown; model?: unknown } }>(
      "agent-event",
      (event) => {
        if (cancelled || event.payload?.kind !== "agent_spawned") return;
        const payload = event.payload.payload ?? {};
        const taskId = typeof payload.taskId === "string" ? payload.taskId : null;
        if (!taskId) return;
        const model = typeof payload.model === "string" && payload.model.length > 0 ? payload.model : "agent";
        const terminalId = typeof payload.terminalId === "string" ? payload.terminalId : "";
        // Each agent_spawned is one real dispatch, so overwrite: a re-dispatched
        // (failed→running) task must show the CURRENT attempt's elapsed, not the
        // first try's. (The event fires once per dispatch, never per re-render.)
        setSpawns((prev) => new Map(prev).set(taskId, { model, terminalId, startedAt: Date.now() }));
      },
    )
      .then((un) => {
        if (cancelled) un();
        else unlisten = un;
      })
      .catch(() => {
        /* losing the spawn stream just means no cards until the next mount */
      });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  // Prune spawn entries whose task is gone or finished so the map stays bounded.
  useEffect(() => {
    setSpawns((prev) => {
      if (prev.size === 0) return prev;
      const live = new Map<string, { status: TaskStatus }>();
      for (const task of tasks) live.set(task.id, task);
      let changed = false;
      const next = new Map(prev);
      for (const id of prev.keys()) {
        const task = live.get(id);
        if (!task || !ACTIVE.has(task.status)) {
          next.delete(id);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [tasks]);

  const agents = useMemo(() => {
    const list: FleetHudAgent[] = [];
    const tasksById = new Map(tasks.map((task) => [task.id, task]));
    for (const task of tasks) {
      const spawn = spawns.get(task.id);
      if (!spawn || !ACTIVE.has(task.status)) continue;
      list.push({
        taskId: task.id,
        title: task.title || task.id,
        model: spawn.model,
        status: task.status,
        bucket: bucketOf(task.status),
        startedAt: spawn.startedAt,
        attentionReason: attentionReason(task, tasksById),
      });
    }
    list.sort((a, b) => ORDER[a.bucket] - ORDER[b.bucket] || b.startedAt - a.startedAt);
    return list;
  }, [tasks, spawns]);

  const summary = useMemo<FleetHudSummary>(
    () => ({
      total: agents.length,
      running: agents.filter((a) => a.bucket === "running").length,
      review: agents.filter((a) => a.bucket === "review").length,
      attention: agents.filter((a) => a.bucket === "attention" || a.bucket === "error").length,
    }),
    [agents],
  );

  return { agents, summary, hasAgents: agents.length > 0 };
}
