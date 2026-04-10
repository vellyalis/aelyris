import { memo } from "react";
import { Play, GitBranch } from "lucide-react";
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

export const KanbanCard = memo(function KanbanCard({ task, isActive, onStartAgent, onDelete, onActivate }: KanbanCardProps) {
  const priorityColor = PRIORITY_COLORS[task.priority ?? "medium"];

  return (
    <div
      className={`${styles.card} ${isActive ? styles.cardActive : ""}`}
      draggable
      onDragStart={(e) => e.dataTransfer.setData("taskId", task.id)}
      onClick={() => onActivate?.(task.id)}
    >
      <div className={styles.cardPriorityStripe} style={{ background: priorityColor }} />
      <div className={styles.cardBody}>
        <div className={styles.cardTitle}>{task.title}</div>
        {task.branch && (
          <span className={styles.cardBranch}>
            <GitBranch size={9} />
            {task.branch}
          </span>
        )}
        <div className={styles.cardActions}>
          {(task.column === "todo" || task.column === "in_progress") && onStartAgent && (
            <button
              className={styles.cardBtn}
              onClick={(e) => { e.stopPropagation(); onStartAgent(task.title); }}
              title="Start Agent"
            >
              <Play size={10} />
            </button>
          )}
          <button
            className={styles.cardBtn}
            onClick={(e) => { e.stopPropagation(); onDelete?.(task.id); }}
            title="Delete"
          >×</button>
        </div>
      </div>
    </div>
  );
});
