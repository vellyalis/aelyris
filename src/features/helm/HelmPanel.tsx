import { useState, useCallback } from "react";
import { Cloud, Monitor, Paperclip } from "lucide-react";
import styles from "./HelmPanel.module.css";

interface Task {
  id: string;
  label: string;
  done: boolean;
}

function loadTasks(): Task[] {
  try {
    const saved = localStorage.getItem("aether:helm:tasks");
    if (saved) return JSON.parse(saved);
  } catch { /* ignore */ }
  return [];
}

function saveTasks(tasks: Task[]) {
  try { localStorage.setItem("aether:helm:tasks", JSON.stringify(tasks)); } catch { /* ignore */ }
}

export function HelmPanel() {
  const [tasks, setTasks] = useState<Task[]>(loadTasks);
  const [adding, setAdding] = useState(false);
  const [newLabel, setNewLabel] = useState("");

  const toggleTask = useCallback((id: string) => {
    setTasks((prev) => {
      const updated = prev.map((t) => t.id === id ? { ...t, done: !t.done } : t);
      saveTasks(updated);
      return updated;
    });
  }, []);

  const addTask = useCallback(() => {
    if (!newLabel.trim()) return;
    const task: Task = { id: `task-${Date.now()}`, label: newLabel.trim(), done: false };
    setTasks((prev) => { const u = [...prev, task]; saveTasks(u); return u; });
    setNewLabel("");
    setAdding(false);
  }, [newLabel]);

  const deleteTask = useCallback((id: string) => {
    setTasks((prev) => { const u = prev.filter((t) => t.id !== id); saveTasks(u); return u; });
  }, []);

  const doneCount = tasks.filter((t) => t.done).length;

  return (
    <div className={styles.helm}>
      <div className={styles.header}>
        <span>Helm</span>
        {tasks.length > 0 && <span className={styles.count}>{doneCount}/{tasks.length}</span>}
        <div className={styles.helmIcons}>
          <button className={styles.helmIcon} title="Sync"><Cloud size={10} /></button>
          <button className={styles.helmIcon} title="Terminal"><Monitor size={10} /></button>
          <button className={styles.helmIcon} title="Attach"><Paperclip size={10} /></button>
        </div>
        <button className={styles.addBtn} onClick={() => setAdding(true)}>+</button>
      </div>
      <div className={styles.content}>
        {adding && (
          <div className={styles.addForm}>
            <input
              autoFocus
              className={styles.addInput}
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") addTask(); if (e.key === "Escape") setAdding(false); }}
              placeholder="New task..."
            />
          </div>
        )}
        {tasks.length === 0 && !adding && (
          <div className={styles.empty}>No tasks yet</div>
        )}
        {tasks.map((t) => (
          <div key={t.id} className={`${styles.task} ${t.done ? styles.taskDone : ""}`}>
            <input type="checkbox" checked={t.done} onChange={() => toggleTask(t.id)} className={styles.checkbox} />
            <span className={styles.taskLabel}>{t.label}</span>
            <button className={styles.deleteBtn} onClick={() => deleteTask(t.id)}>×</button>
          </div>
        ))}
      </div>
    </div>
  );
}
