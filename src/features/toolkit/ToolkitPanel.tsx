import styles from "./ToolkitPanel.module.css";

interface ToolkitAction {
  id: string;
  label: string;
  badge: string; // color
}

interface ToolkitPanelProps {
  projectName?: string;
  actions?: ToolkitAction[];
}

const DEFAULT_ACTIONS: ToolkitAction[] = [
  { id: "create-pr", label: "Create PR", badge: "#cba6f7" },
  { id: "commit-push", label: "Commit & Push", badge: "#a6e3a1" },
  { id: "worktree", label: "Worktree", badge: "#89b4fa" },
  { id: "dev-server", label: "Dev Server", badge: "#a6e3a1" },
  { id: "create-license", label: "Create License", badge: "#9399b2" },
  { id: "scope", label: "Scope DWG", badge: "#cba6f7" },
  { id: "open-vscode", label: "Open in VSCode", badge: "#89b4fa" },
  { id: "release", label: "Release", badge: "#f38ba8" },
  { id: "bump-version", label: "Bump Version", badge: "#f9e2af" },
  { id: "add-icon", label: "Add Icon", badge: "#94e2d5" },
];

export function ToolkitPanel({ projectName, actions = DEFAULT_ACTIONS }: ToolkitPanelProps) {
  return (
    <div className={styles.toolkit}>
      <div className={styles.header}>
        <span className={styles.title}>Toolkit</span>
        {projectName && <span className={styles.project}>{projectName}</span>}
      </div>
      <div className={styles.grid}>
        {actions.map((a) => (
          <button key={a.id} className={styles.action}>
            <span className={styles.actionLabel}>{a.label}</span>
            <span className={styles.badge} style={{ background: a.badge }} />
          </button>
        ))}
      </div>
    </div>
  );
}
