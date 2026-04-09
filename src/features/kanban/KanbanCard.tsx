import { memo } from "react";
import { Play } from "lucide-react";
import type { KanbanTask } from "../../shared/types/kanban";
import styles from "./KanbanBoard.module.css";

interface KanbanCardProps {
  task: KanbanTask;
  onStartAgent?: (title: string) => void;
  onDelete?: (id: string) => void;
}

export const KanbanCard = memo(function KanbanCard({ task, onStartAgent, onDelete }: KanbanCardProps) {
  return (
    <div
      className={styles.card}
      draggable
      onDragStart={(e) => e.dataTransfer.setData("taskId", task.id)}
    >
      <div className={styles.cardTitle}>{task.title}</div>
      {task.branch && <span className={styles.cardBranch}>⚡{task.branch}</span>}
      <div className={styles.cardActions}>
        {(task.column === "todo" || task.column === "in_progress") && onStartAgent && (
          <button className={styles.cardBtn} onClick={() => onStartAgent(task.title)} title="Start Agent">
            <Play size={10} />
          </button>
        )}
        <button className={styles.cardBtn} onClick={() => onDelete?.(task.id)} title="Delete">×</button>
      </div>
    </div>
  );
});
