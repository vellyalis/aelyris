export type KanbanColumnId = "todo" | "in_progress" | "review" | "done";

export interface KanbanTask {
  id: string;
  title: string;
  column: KanbanColumnId;
  assignedAgentId?: string;
  branch?: string;
  createdAt: number;
  updatedAt: number;
}

export const KANBAN_COLUMNS: { id: KanbanColumnId; label: string; color: string }[] = [
  { id: "todo", label: "Todo", color: "var(--text-muted)" },
  { id: "in_progress", label: "In Progress", color: "#f9e2af" },
  { id: "review", label: "Review", color: "#fab387" },
  { id: "done", label: "Done", color: "#a6e3a1" },
];
