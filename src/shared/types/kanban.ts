export type KanbanColumnId = "todo" | "in_progress" | "review" | "done";
export type TaskPriority = "low" | "medium" | "high" | "critical";

export interface KanbanTask {
  id: string;
  title: string;
  description?: string;
  column: KanbanColumnId;
  priority: TaskPriority;
  assignedAgentId?: string;
  branch?: string;
  worktreePath?: string;
  terminalTabId?: string;
  labels?: string[];
  createdAt: number;
  updatedAt: number;
}

export const KANBAN_COLUMNS: { id: KanbanColumnId; label: string; color: string }[] = [
  { id: "todo", label: "Todo", color: "var(--text-muted)" },
  { id: "in_progress", label: "In Progress", color: "var(--ctp-yellow)" },
  { id: "review", label: "Review", color: "var(--ctp-peach)" },
  { id: "done", label: "Done", color: "var(--ctp-green)" },
];

export const PRIORITY_COLORS: Record<TaskPriority, string> = {
  low: "var(--text-muted)",
  medium: "var(--ctp-blue)",
  high: "var(--ctp-peach)",
  critical: "var(--ctp-red)",
};
