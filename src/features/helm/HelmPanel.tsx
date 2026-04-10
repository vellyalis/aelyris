import { useState, useCallback, useRef, useEffect } from "react";
import { EmptyState } from "../../shared/ui/EmptyState";
import styles from "./HelmPanel.module.css";

interface Task {
  id: string;
  label: string;
  done: boolean;
}

function loadTasks(): Task[] {
  try { return JSON.parse(localStorage.getItem("aether:helm:tasks") ?? "[]"); } catch { return []; }
}
function saveTasks(tasks: Task[]) {
  try { localStorage.setItem("aether:helm:tasks", JSON.stringify(tasks)); } catch {}
}

export function HelmPanel() {
  const [tasks, setTasks] = useState<Task[]>(loadTasks);
  const [adding, setAdding] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // Global click listener — close if click is outside the input
  useEffect(() => {
    if (!adding) return;

    const handler = (e: MouseEvent) => {
      if (inputRef.current && !inputRef.current.contains(e.target as Node)) {
        setAdding(false);
        setNewLabel("");
      }
    };

    // Use 'click' (fires after mousedown+mouseup) with capture phase
    // requestAnimationFrame ensures the input is mounted first
    requestAnimationFrame(() => {
      document.addEventListener("click", handler, true);
    });

    return () => document.removeEventListener("click", handler, true);
  }, [adding]);

  const addTask = useCallback(() => {
    if (!newLabel.trim()) return;
    const t: Task = { id: `t-${Date.now()}`, label: newLabel.trim(), done: false };
    setTasks((prev) => { const u = [...prev, t]; saveTasks(u); return u; });
    setNewLabel("");
    setAdding(false);
  }, [newLabel]);

  const toggleTask = useCallback((id: string) => {
    setTasks((prev) => { const u = prev.map((t) => t.id === id ? { ...t, done: !t.done } : t); saveTasks(u); return u; });
  }, []);

  const deleteTask = useCallback((id: string) => {
    setTasks((prev) => { const u = prev.filter((t) => t.id !== id); saveTasks(u); return u; });
  }, []);

  const doneCount = tasks.filter((t) => t.done).length;

  return (
    <div className={styles.helm}>
      <div className={styles.header}>
        <span>Tasks</span>
        {tasks.length > 0 && <span className={styles.count}>{doneCount}/{tasks.length}</span>}
        <button className={styles.addBtn} onClick={() => setAdding(true)}>+</button>
      </div>
      <div className={styles.content}>
        {adding && (
          <input
            ref={inputRef}
            autoFocus
            className={styles.addInput}
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") addTask();
              if (e.key === "Escape") { setAdding(false); setNewLabel(""); }
            }}
            placeholder="Add task..."
          />
        )}
        {tasks.length === 0 && !adding && (
          <EmptyState preset="tasks" title="No tasks" description="Click + to add a task" />
        )}
        {tasks.map((t) => (
          <div key={t.id} className={`${styles.task} ${t.done ? styles.taskDone : ""}`}>
            <input type="checkbox" checked={t.done} onClick={() => toggleTask(t.id)} readOnly className={styles.checkbox} />
            <span className={styles.taskLabel}>{t.label}</span>
            <button className={styles.deleteBtn} onClick={() => deleteTask(t.id)}>×</button>
          </div>
        ))}
      </div>
    </div>
  );
}
