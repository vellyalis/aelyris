import { useState, useCallback } from "react";
import { Plus } from "lucide-react";
import { useAppStore } from "../../shared/store/appStore";
import { KANBAN_COLUMNS, type TaskPriority } from "../../shared/types/kanban";
import { KanbanColumn } from "./KanbanColumn";
import styles from "./KanbanBoard.module.css";

interface KanbanBoardProps {
  onStartAgent?: (prompt: string) => void;
  onActivateTask?: (taskId: string) => void;
  onMoveWithSideEffects?: (taskId: string, toColumn: string) => void;
}

export function KanbanBoard({ onStartAgent, onActivateTask, onMoveWithSideEffects }: KanbanBoardProps) {
  const { kanbanTasks, addKanbanTask, moveKanbanTask, deleteKanbanTask, activeTaskId, setActiveTaskId } = useAppStore();
  const [newTitle, setNewTitle] = useState("");
  const [newPriority, setNewPriority] = useState<TaskPriority>("medium");
  const [showForm, setShowForm] = useState(false);

  const handleAdd = useCallback(() => {
    if (!newTitle.trim()) return;
    addKanbanTask(newTitle.trim(), newPriority);
    setNewTitle("");
    setShowForm(false);
  }, [newTitle, newPriority, addKanbanTask]);

  const handleActivate = useCallback((taskId: string) => {
    setActiveTaskId(taskId);
    onActivateTask?.(taskId);
  }, [setActiveTaskId, onActivateTask]);

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <span className={styles.headerTitle}>Tasks</span>
        <span className={styles.headerCount}>{kanbanTasks.length}</span>
        <button className={styles.addBtn} onClick={() => setShowForm(!showForm)} title="New Task">
          <Plus size={14} />
        </button>
      </div>

      {showForm && (
        <div className={styles.form}>
          <input
            className={styles.formInput}
            placeholder="Task title..."
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleAdd(); if (e.key === "Escape") setShowForm(false); }}
            autoFocus
          />
          <div className={styles.formRow}>
            <select
              className={styles.formSelect}
              value={newPriority}
              onChange={(e) => setNewPriority(e.target.value as TaskPriority)}
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="critical">Critical</option>
            </select>
            <button className={styles.formSubmit} onClick={handleAdd} disabled={!newTitle.trim()}>
              Add
            </button>
          </div>
        </div>
      )}

      <div className={styles.board}>
        {KANBAN_COLUMNS.map((col) => (
          <KanbanColumn
            key={col.id}
            columnId={col.id}
            label={col.label}
            color={col.color}
            tasks={kanbanTasks.filter((t) => t.column === col.id)}
            activeTaskId={activeTaskId}
            onDrop={(taskId, toColumn) => {
              moveKanbanTask(taskId, toColumn);
              onMoveWithSideEffects?.(taskId, toColumn);
            }}
            onStartAgent={onStartAgent}
            onDelete={deleteKanbanTask}
            onActivate={handleActivate}
          />
        ))}
      </div>
    </div>
  );
}
