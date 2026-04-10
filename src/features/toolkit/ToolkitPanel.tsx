import { useState, useCallback } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { GitPullRequest, Upload, GitBranch, Play, FolderOpen, ClipboardList, ScrollText, FlaskConical } from "lucide-react";
import { showPrompt } from "../../shared/ui/PromptDialog";
import styles from "./ToolkitPanel.module.css";

const ICON_MAP: Record<string, React.ReactNode> = {
  "create-pr": <GitPullRequest size={12} />,
  "commit-push": <Upload size={12} />,
  "worktree": <GitBranch size={12} />,
  "dev-server": <Play size={12} />,
  "open-vscode": <FolderOpen size={12} />,
  "git-status": <ClipboardList size={12} />,
  "git-log": <ScrollText size={12} />,
  "npm-test": <FlaskConical size={12} />,
};

export interface ToolkitAction {
  id: string;
  label: string;
  icon?: string;
  badge: string;
  command: string;
}

interface ToolkitPanelProps {
  projectName?: string;
  onRunCommand?: (command: string) => void;
}

const DEFAULT_ACTIONS: ToolkitAction[] = [
  { id: "create-pr", label: "Create PR", badge: "var(--ctp-mauve)", command: "gh pr create --fill" },
  { id: "commit-push", label: "Commit & Push", badge: "var(--ctp-green)", command: "git add -A && git commit -m 'update' && git push" },
  { id: "worktree", label: "Worktree", badge: "var(--ctp-blue)", command: "git worktree list" },
  { id: "dev-server", label: "Dev Server", badge: "var(--ctp-green)", command: "pnpm dev" },
  { id: "open-vscode", label: "Open in VSCode", badge: "var(--ctp-blue)", command: "code ." },
  { id: "git-status", label: "Git Status", badge: "var(--ctp-yellow)", command: "git status" },
  { id: "git-log", label: "Git Log", badge: "var(--text-secondary)", command: "git log --oneline -15" },
  { id: "npm-test", label: "Run Tests", badge: "var(--ctp-red)", command: "npm test" },
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
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");

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

  const handleAdd = useCallback(async () => {
    const label = await showPrompt("Add Tool", { placeholder: "Button label..." });
    if (!label) return;
    const command = await showPrompt("Command", { placeholder: "Command to run..." });
    if (!command) return;
    const newAction: ToolkitAction = {
      id: `custom-${Date.now()}`,
      label,
      badge: "var(--ctp-cyan)",
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

  const handleImport = useCallback(() => {
    if (!importText.trim()) return;
    const newAction: ToolkitAction = {
      id: `import-${Date.now()}`,
      label: importText.trim().split(" ").slice(0, 3).join(" "),
      badge: "var(--ctp-cyan)",
      command: importText.trim(),
    };
    const updated = [...actions, newAction];
    setActions(updated);
    saveActions(projectName, updated);
    setImportText("");
    setImportOpen(false);
  }, [importText, actions, projectName]);

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
            <span className={styles.actionIcon}>{ICON_MAP[a.id] ?? null}</span>
            <span className={styles.actionLabel}>{a.label}</span>
            <span className={styles.badge} style={{ background: a.badge }} />
          </button>
        ))}
      </div>
      <div className={styles.bottomActions}>
        <button className={styles.bottomBtn} onClick={async () => { const cmd = await showPrompt("Generate Tool", { placeholder: "Describe what the tool should do..." }); if (cmd) { const newAction: ToolkitAction = { id: `gen-${Date.now()}`, label: cmd.split(" ").slice(0, 3).join(" "), badge: "var(--ctp-mauve)", command: cmd }; const updated = [...actions, newAction]; setActions(updated); saveActions(projectName, updated); } }}>⊕ Generate...</button>
        <button className={styles.bottomBtn} onClick={handleAdd}>⊕ Create...</button>
        <button className={styles.bottomBtn} onClick={() => setImportOpen(true)}>⊕ Import...</button>
      </div>

      {/* Import Tool Dialog */}
      <Dialog.Root open={importOpen} onOpenChange={setImportOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className={styles.importOverlay} />
          <Dialog.Content className={styles.importPanel} aria-describedby={undefined}>
            <Dialog.Title className={styles.importTitle}>Import Tool</Dialog.Title>
            <textarea
              className={styles.importTextarea}
              placeholder="Paste a copied recipe or command below..."
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              rows={4}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter" && e.ctrlKey) handleImport();
              }}
            />
            <div className={styles.importActions}>
              <Dialog.Close asChild>
                <button className={styles.importCancel}>Cancel</button>
              </Dialog.Close>
              <button className={styles.importSubmit} onClick={handleImport} disabled={!importText.trim()}>
                Import
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
