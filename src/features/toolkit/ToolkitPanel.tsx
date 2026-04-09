import { useState, useCallback } from "react";
import styles from "./ToolkitPanel.module.css";

export interface ToolkitAction {
  id: string;
  label: string;
  badge: string;
  command: string;
}

interface ToolkitPanelProps {
  projectName?: string;
  onRunCommand?: (command: string) => void;
}

const DEFAULT_ACTIONS: ToolkitAction[] = [
  { id: "create-pr", label: "Create PR", badge: "#cba6f7", command: "gh pr create --fill" },
  { id: "commit-push", label: "Commit & Push", badge: "#a6e3a1", command: "git add -A && git commit -m 'update' && git push" },
  { id: "worktree", label: "Worktree", badge: "#89b4fa", command: "git worktree list" },
  { id: "dev-server", label: "Dev Server", badge: "#a6e3a1", command: "pnpm dev" },
  { id: "open-vscode", label: "Open in VSCode", badge: "#89b4fa", command: "code ." },
  { id: "git-status", label: "Git Status", badge: "#f9e2af", command: "git status" },
  { id: "git-log", label: "Git Log", badge: "#9399b2", command: "git log --oneline -15" },
  { id: "npm-test", label: "Run Tests", badge: "#f38ba8", command: "npm test" },
];

function loadActions(projectName: string): ToolkitAction[] {
  try {
    const saved = localStorage.getItem(`aether:toolkit:${projectName}`);
    if (saved) return JSON.parse(saved);
  } catch { /* ignore */ }
  return DEFAULT_ACTIONS;
}

function saveActions(projectName: string, actions: ToolkitAction[]) {
  try { localStorage.setItem(`aether:toolkit:${projectName}`, JSON.stringify(actions)); } catch { /* ignore */ }
}

export function ToolkitPanel({ projectName = "default", onRunCommand }: ToolkitPanelProps) {
  const [actions, setActions] = useState<ToolkitAction[]>(() => loadActions(projectName));
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState("");
  const [editCommand, setEditCommand] = useState("");

  const handleEdit = useCallback((action: ToolkitAction) => {
    setEditingId(action.id);
    setEditLabel(action.label);
    setEditCommand(action.command);
  }, []);

  const handleSaveEdit = useCallback(() => {
    if (!editingId) return;
    const updated = actions.map((a) =>
      a.id === editingId ? { ...a, label: editLabel, command: editCommand } : a
    );
    setActions(updated);
    saveActions(projectName, updated);
    setEditingId(null);
  }, [editingId, editLabel, editCommand, actions, projectName]);

  const handleAdd = useCallback(() => {
    const label = prompt("Button label:");
    if (!label) return;
    const command = prompt("Command to run:");
    if (!command) return;
    const newAction: ToolkitAction = {
      id: `custom-${Date.now()}`,
      label,
      badge: "#94e2d5",
      command,
    };
    const updated = [...actions, newAction];
    setActions(updated);
    saveActions(projectName, updated);
  }, [actions, projectName]);

  const handleDelete = useCallback(() => {
    if (!editingId) return;
    const updated = actions.filter((a) => a.id !== editingId);
    setActions(updated);
    saveActions(projectName, updated);
    setEditingId(null);
  }, [editingId, actions, projectName]);

  return (
    <div className={styles.toolkit}>
      <div className={styles.header}>
        <span className={styles.title}>Toolkit</span>
        <span className={styles.project}>{projectName}</span>
        <button className={styles.addBtn} onClick={handleAdd} title="Add action">+</button>
      </div>

      {editingId && (
        <div className={styles.editForm}>
          <input className={styles.editInput} value={editLabel} onChange={(e) => setEditLabel(e.target.value)} placeholder="Label" />
          <input className={styles.editInput} value={editCommand} onChange={(e) => setEditCommand(e.target.value)} placeholder="Command" />
          <div className={styles.editActions}>
            <button className={styles.editDelete} onClick={handleDelete}>Delete</button>
            <button className={styles.editCancel} onClick={() => setEditingId(null)}>Cancel</button>
            <button className={styles.editSave} onClick={handleSaveEdit}>Save</button>
          </div>
        </div>
      )}

      <div className={styles.grid}>
        {actions.map((a) => (
          <button
            key={a.id}
            className={styles.action}
            onClick={() => onRunCommand?.(a.command)}
            onContextMenu={(e) => { e.preventDefault(); handleEdit(a); }}
            title={a.command}
          >
            <span className={styles.actionLabel}>{a.label}</span>
            <span className={styles.badge} style={{ background: a.badge }} />
          </button>
        ))}
      </div>
    </div>
  );
}
