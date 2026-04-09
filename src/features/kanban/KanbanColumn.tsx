import { memo, useCallback } from "react";
import type { KanbanTask, KanbanColumnId } from "../../shared/types/kanban";
import { KanbanCard } from "./KanbanCard";
import styles from "./KanbanBoard.module.css";

interface KanbanColumnProps {
  columnId: KanbanColumnId;
  label: string;
  color: string;
  tasks: KanbanTask[];
  onDrop: (taskId: string, toColumn: KanbanColumnId) => void;
  onStartAgent?: (title: string) => void;
  onDelete?: (id: string) => void;
}

export const KanbanColumn = memo(function KanbanColumn({ columnId, label, color, tasks, onDrop, onStartAgent, onDelete }: KanbanColumnProps) {
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.currentTarget.classList.add(styles.dropHover);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.currentTarget.classList.remove(styles.dropHover);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.currentTarget.classList.remove(styles.dropHover);
    const taskId = e.dataTransfer.getData("taskId");
    if (taskId) onDrop(taskId, columnId);
  }, [onDrop, columnId]);

  return (
    <div
      className={styles.column}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className={styles.colHeader}>
        <span className={styles.colDot} style={{ background: color }} />
        <span className={styles.colLabel}>{label}</span>
        <span className={styles.colCount}>{tasks.length}</span>
      </div>
      <div className={styles.colCards}>
        {tasks.map((t) => (
          <KanbanCard key={t.id} task={t} onStartAgent={onStartAgent} onDelete={onDelete} />
        ))}
      </div>
    </div>
  );
});
