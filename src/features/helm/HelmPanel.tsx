import { Circle, CircleCheck, Plus, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { EmptyState } from "../../shared/ui/EmptyState";
import { PanelHeader } from "../../shared/ui/PanelHeader";
import styles from "./HelmPanel.module.css";

interface Task {
  id: string;
  label: string;
  done: boolean;
}

function loadTasks(): Task[] {
  try {
    return JSON.parse(localStorage.getItem("aether:helm:tasks") ?? "[]");
  } catch {
    return [];
  }
}
function saveTasks(tasks: Task[]) {
  try {
    localStorage.setItem("aether:helm:tasks", JSON.stringify(tasks));
  } catch {}
}

export function HelmPanel() {
  const [tasks, setTasks] = useState<Task[]>(loadTasks);
  const [adding, setAdding] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!adding) return;
    const handler = (e: MouseEvent) => {
      if (inputRef.current?.contains(e.target as Node)) return;
      setAdding(false);
      setNewLabel("");
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [adding]);

  const addTask = useCallback(() => {
    if (!newLabel.trim()) return;
    const t: Task = { id: `t-${Date.now()}`, label: newLabel.trim(), done: false };
    setTasks((prev) => {
      const u = [...prev, t];
      saveTasks(u);
      return u;
    });
    setNewLabel("");
    setAdding(false);
  }, [newLabel]);

  const toggleTask = useCallback((id: string) => {
    setTasks((prev) => {
      const u = prev.map((t) => (t.id === id ? { ...t, done: !t.done } : t));
      saveTasks(u);
      return u;
    });
  }, []);

  const deleteTask = useCallback((id: string) => {
    setTasks((prev) => {
      const u = prev.filter((t) => t.id !== id);
      saveTasks(u);
      return u;
    });
  }, []);

  const doneCount = tasks.filter((t) => t.done).length;

  return (
    <div className={styles.helm}>
      <PanelHeader
        title="Tasks"
        count={tasks.length > 0 ? `${doneCount}/${tasks.length}` : undefined}
        actions={
          <button className={styles.addBtn} onClick={() => setAdding(true)} title="Add task" aria-label="Add task">
            <Plus size={12} aria-hidden="true" />
          </button>
        }
      />
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
              if (e.key === "Escape") {
                setAdding(false);
                setNewLabel("");
              }
            }}
            placeholder="Add task..."
          />
        )}
        {tasks.length === 0 && !adding && (
          <EmptyState preset="tasks" title="No tasks" description="Click + to add a task" />
        )}
        {tasks.map((t) => (
          <div key={t.id} className={`${styles.task} ${t.done ? styles.taskDone : ""}`}>
            <button
              type="button"
              role="checkbox"
              aria-checked={t.done}
              aria-label={t.done ? `Mark task incomplete: ${t.label}` : `Mark task complete: ${t.label}`}
              className={styles.checkbox}
              onClick={() => toggleTask(t.id)}
            >
              {t.done ? <CircleCheck size={14} aria-hidden="true" /> : <Circle size={14} aria-hidden="true" />}
            </button>
            <span className={styles.taskLabel}>{t.label}</span>
            <button
              className={styles.deleteBtn}
              onClick={() => deleteTask(t.id)}
              aria-label={`Delete task: ${t.label}`}
            >
              <X size={10} aria-hidden="true" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
