import { useAppStore } from "../../shared/store/appStore";
import { KANBAN_COLUMNS } from "../../shared/types/kanban";
import { KanbanColumn } from "./KanbanColumn";
import styles from "./KanbanBoard.module.css";

interface KanbanBoardProps {
  onStartAgent?: (prompt: string) => void;
}

export function KanbanBoard({ onStartAgent }: KanbanBoardProps) {
  const { kanbanTasks, moveKanbanTask, deleteKanbanTask } = useAppStore();

  return (
    <div className={styles.board}>
      {KANBAN_COLUMNS.map((col) => (
        <KanbanColumn
          key={col.id}
          columnId={col.id}
          label={col.label}
          color={col.color}
          tasks={kanbanTasks.filter((t) => t.column === col.id)}
          onDrop={moveKanbanTask}
          onStartAgent={onStartAgent}
          onDelete={deleteKanbanTask}
        />
      ))}
    </div>
  );
}
