import { useState } from "react";
import { Cloud, Monitor, Paperclip } from "lucide-react";
import { useAppStore } from "../../shared/store/appStore";
import { KanbanBoard } from "../kanban/KanbanBoard";
import styles from "./HelmPanel.module.css";

interface HelmPanelProps {
  onStartAgent?: (prompt: string) => void;
}

export function HelmPanel({ onStartAgent }: HelmPanelProps) {
  const { kanbanTasks, addKanbanTask } = useAppStore();
  const [adding, setAdding] = useState(false);
  const [newTitle, setNewTitle] = useState("");

  const doneCount = kanbanTasks.filter((t) => t.column === "done").length;

  const handleAdd = () => {
    if (!newTitle.trim()) return;
    addKanbanTask(newTitle.trim());
    setNewTitle("");
    setAdding(false);
  };

  return (
    <div className={styles.helm}>
      <div className={styles.header}>
        <span>Helm</span>
        {kanbanTasks.length > 0 && <span className={styles.count}>{doneCount}/{kanbanTasks.length}</span>}
        <div className={styles.helmIcons}>
          <button className={styles.helmIcon} title="Sync"><Cloud size={10} /></button>
          <button className={styles.helmIcon} title="Terminal"><Monitor size={10} /></button>
          <button className={styles.helmIcon} title="Attach"><Paperclip size={10} /></button>
        </div>
        <button className={styles.addBtn} onClick={() => setAdding(true)}>+</button>
      </div>
      {adding && (
        <div className={styles.addForm}>
          <input
            autoFocus
            className={styles.addInput}
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleAdd(); if (e.key === "Escape") setAdding(false); }}
            placeholder="New task..."
          />
        </div>
      )}
      <KanbanBoard onStartAgent={onStartAgent} />
    </div>
  );
}
