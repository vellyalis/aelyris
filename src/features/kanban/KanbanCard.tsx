import { GitBranch, Play, X } from "lucide-react";
import { memo } from "react";
import type { KanbanTask } from "../../shared/types/kanban";
import { PRIORITY_COLORS } from "../../shared/types/kanban";
import styles from "./KanbanBoard.module.css";

interface KanbanCardProps {
  task: KanbanTask;
  isActive: boolean;
  onStartAgent?: (title: string) => void;
  onDelete?: (id: string) => void;
  onActivate?: (id: string) => void;
}

export const KanbanCard = memo(function KanbanCard({
  task,
  isActive,
  onStartAgent,
  onDelete,
  onActivate,
}: KanbanCardProps) {
  const priorityColor = PRIORITY_COLORS[task.priority ?? "medium"];

  return (
    <div
      className={`${styles.card} ${isActive ? styles.cardActive : ""}`}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("taskId", task.id);
        e.dataTransfer.effectAllowed = "move";
        // Pin the drag ghost to the actual card so the user keeps their spatial
        // anchor instead of seeing the browser default outline. Offset by the
        // pointer so it feels like they're holding the card at the grab point.
        const rect = e.currentTarget.getBoundingClientRect();
        e.dataTransfer.setDragImage(e.currentTarget, e.clientX - rect.left, e.clientY - rect.top);
      }}
      onClick={() => onActivate?.(task.id)}
    >
      <div className={styles.cardPriorityStripe} style={{ background: priorityColor }} />
      <div className={styles.cardBody}>
        <div className={styles.cardTitle}>{task.title}</div>
        {task.branch && (
          <span className={styles.cardBranch}>
            <GitBranch size={10} aria-hidden="true" />
            {task.branch}
          </span>
        )}
        <div className={styles.cardActions}>
          {(task.column === "todo" || task.column === "in_progress") && onStartAgent && (
            <button
              className={styles.cardBtn}
              onClick={(e) => {
                e.stopPropagation();
                onStartAgent(task.title);
              }}
              title="Start Agent"
              aria-label="Start agent for task"
            >
              <Play size={10} />
            </button>
          )}
          <button
            className={styles.cardBtn}
            onClick={(e) => {
              e.stopPropagation();
              onDelete?.(task.id);
            }}
            title="Delete"
            aria-label="Delete task"
          >
            <X size={10} strokeWidth={2} aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );
});
