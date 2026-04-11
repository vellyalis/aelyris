import { useEffect, useRef, useMemo } from "react";
import type { AgentSession } from "../types/agent";
import type { KanbanTask } from "../types/kanban";

interface UseTaskAgentLinkOptions {
  sessions: AgentSession[];
  kanbanTasks: KanbanTask[];
  moveKanbanTask: (taskId: string, toColumn: "todo" | "in_progress" | "review" | "done") => void;
}

/**
 * Watches agent sessions for completion and auto-moves linked Kanban tasks to "review".
 * Also computes an agentStatuses map for UI badges.
 */
export function useTaskAgentLink({ sessions, kanbanTasks, moveKanbanTask }: UseTaskAgentLinkOptions) {
  const prevStatuses = useRef<Record<string, string>>({});

  useEffect(() => {
    for (const s of sessions) {
      const prev = prevStatuses.current[s.id];
      if (prev && prev !== "done" && s.status === "done") {
        const linkedTask = kanbanTasks.find((t) => t.assignedAgentId === s.id);
        if (linkedTask && linkedTask.column === "in_progress") {
          moveKanbanTask(linkedTask.id, "review");
        }
      }
      prevStatuses.current[s.id] = s.status;
    }
  }, [sessions, kanbanTasks, moveKanbanTask]);

  const agentStatuses = useMemo(() => {
    const map: Record<string, { status: string; cost: number }> = {};
    for (const s of sessions) {
      map[s.id] = { status: s.status, cost: s.cost };
    }
    return map;
  }, [sessions]);

  return { agentStatuses };
}
