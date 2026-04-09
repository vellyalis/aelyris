import styles from "./ToolkitPanel.module.css";

interface ToolkitAction {
  id: string;
  label: string;
  badge: string;
  command: string;
}

interface ToolkitPanelProps {
  projectName?: string;
  actions?: ToolkitAction[];
  onRunCommand?: (command: string) => void;
}

const DEFAULT_ACTIONS: ToolkitAction[] = [
  { id: "create-pr", label: "Create PR", badge: "#cba6f7", command: "gh pr create --fill" },
  { id: "commit-push", label: "Commit & Push", badge: "#a6e3a1", command: "git add -A && git commit -m 'update' && git push" },
  { id: "worktree", label: "Worktree", badge: "#89b4fa", command: "git worktree list" },
  { id: "dev-server", label: "Dev Server", badge: "#a6e3a1", command: "pnpm dev" },
  { id: "create-license", label: "Create License", badge: "#9399b2", command: "echo MIT > LICENSE" },
  { id: "scope", label: "Scope DWG", badge: "#cba6f7", command: "git log --oneline -20" },
  { id: "open-vscode", label: "Open in VSCode", badge: "#89b4fa", command: "code ." },
  { id: "release", label: "Release", badge: "#f38ba8", command: "pnpm tauri build" },
  { id: "bump-version", label: "Bump Version", badge: "#f9e2af", command: "npm version patch" },
  { id: "add-icon", label: "Add Icon", badge: "#94e2d5", command: "echo 'add icon'" },
];

export function ToolkitPanel({ projectName, actions = DEFAULT_ACTIONS, onRunCommand }: ToolkitPanelProps) {
  return (
    <div className={styles.toolkit}>
      <div className={styles.header}>
        <span className={styles.title}>Toolkit</span>
        {projectName && <span className={styles.project}>{projectName}</span>}
      </div>
      <div className={styles.grid}>
        {actions.map((a) => (
          <button key={a.id} className={styles.action} onClick={() => onRunCommand?.(a.command)}>
            <span className={styles.actionLabel}>{a.label}</span>
            <span className={styles.badge} style={{ background: a.badge }} />
          </button>
        ))}
      </div>
    </div>
  );
}
