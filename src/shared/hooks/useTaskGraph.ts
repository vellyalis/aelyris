import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useCallback, useEffect, useState } from "react";
import { reportInvokeFailure } from "../lib/fallbackTelemetry";
import { isTauriRuntime } from "../lib/tauriRuntime";
import type { Task } from "../types/task";
import type { TaskStatus } from "../types/taskStatus";

/**
 * Consumes the backend Task Graph (BR4): hydrates via `task_list`, stays in
 * sync via the `task-graph-updated` event, and exposes create/transition
 * mutations. The backend re-runs the dependency gate on every mutation, so the
 * returned ids are the tasks whose status changed (null on failure).
 */
export function useTaskGraph() {
  const [tasks, setTasks] = useState<Task[]>([]);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    let cancelled = false;
    let unlisten: UnlistenFn | null = null;

    void listen<Task[]>("task-graph-updated", (event) => {
      if (!cancelled) setTasks(event.payload);
    })
      .then((unsubscribe) => {
        if (cancelled) {
          unsubscribe();
          return;
        }
        unlisten = unsubscribe;
      })
      .catch((err) => {
        reportInvokeFailure({
          source: "task-graph",
          operation: "listen:task-graph-updated",
          err,
          userVisible: false,
        });
      });

    void invoke<Task[]>("task_list")
      .then((list) => {
        if (!cancelled) setTasks(list);
      })
      .catch((err) => {
        reportInvokeFailure({ source: "task-graph", operation: "task_list", err, userVisible: false });
      });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  const createTask = useCallback(async (task: Task): Promise<string[] | null> => {
    try {
      return await invoke<string[]>("task_create", { task });
    } catch (err) {
      reportInvokeFailure({ source: "task-graph", operation: "task_create", err, userVisible: true });
      return null;
    }
  }, []);

  const transitionTask = useCallback(async (id: string, to: TaskStatus): Promise<string[] | null> => {
    try {
      return await invoke<string[]>("task_transition", { id, to });
    } catch (err) {
      reportInvokeFailure({ source: "task-graph", operation: "task_transition", err, userVisible: true });
      return null;
    }
  }, []);

  return { tasks, createTask, transitionTask };
}
