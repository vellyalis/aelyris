import { memo, useCallback, useState } from "react";
import type { KanbanColumnId, KanbanTask } from "../../shared/types/kanban";
import styles from "./KanbanBoard.module.css";
import { KanbanCard } from "./KanbanCard";

interface KanbanColumnProps {
  columnId: KanbanColumnId;
  label: string;
  color: string;
  tasks: KanbanTask[];
  activeTaskId: string | null;
  onDrop: (taskId: string, toColumn: KanbanColumnId) => void;
  onStartAgent?: (title: string) => void;
  onDelete?: (id: string) => void;
  onActivate?: (id: string) => void;
}

export const KanbanColumn = memo(function KanbanColumn({
  columnId,
  label,
  color,
  tasks,
  activeTaskId,
  onDrop,
  onStartAgent,
  onDelete,
  onActivate,
}: KanbanColumnProps) {
  const [dragHover, setDragHover] = useState(false);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragHover(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    // Only clear when the pointer actually leaves the column — dragleave also
    // fires for nested children, which would otherwise flicker the placeholder.
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setDragHover(false);
    }
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragHover(false);
      const taskId = e.dataTransfer.getData("taskId");
      if (taskId) onDrop(taskId, columnId);
    },
    [onDrop, columnId],
  );

  return (
    <div
      className={`${styles.column} ${dragHover ? styles.dropHover : ""}`}
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
          <KanbanCard
            key={t.id}
            task={t}
            isActive={t.id === activeTaskId}
            onStartAgent={onStartAgent}
            onDelete={onDelete}
            onActivate={onActivate}
          />
        ))}
        {dragHover && <div className={styles.dropPlaceholder} aria-hidden="true" />}
      </div>
    </div>
  );
});
