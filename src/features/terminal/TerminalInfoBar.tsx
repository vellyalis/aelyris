import styles from "./TerminalInfoBar.module.css";

interface TerminalInfoBarProps {
  shell: string;
  cwd?: string;
  branch?: string;
  activeAgent?: { model: string; cost: number } | null;
  isMaximized?: boolean;
  onToggleMaximize?: () => void;
  syncMode?: boolean;
  onToggleSync?: () => void;
}

export function TerminalInfoBar({ shell, cwd, branch, activeAgent, isMaximized, onToggleMaximize, syncMode, onToggleSync }: TerminalInfoBarProps) {
  const dir = cwd?.split("/").filter(Boolean).slice(-2).join("/") ?? "";

  return (
    <div className={styles.bar}>
      <span className={styles.shell}>{shell}</span>
      {dir && <span className={styles.cwd}>~/{dir}</span>}
      {branch && <span className={styles.branch}>⚡{branch}</span>}
      <div className={styles.spacer} />
      {activeAgent && (
        <>
          <span className={styles.meta}>{activeAgent.model}</span>
          <span className={styles.cost}>&lt;${activeAgent.cost.toFixed(2)}</span>
        </>
      )}
      {onToggleSync && (
        <button
          className={styles.toggleBtn}
          onClick={onToggleSync}
          title={syncMode ? "Disable Sync Input" : "Sync Input to All Panes"}
          style={syncMode ? { color: "var(--ctp-yellow)", opacity: 1 } : undefined}
          aria-label="Toggle synchronized input"
        >
          ⇄
        </button>
      )}
      {onToggleMaximize && (
        <button className={styles.toggleBtn} onClick={onToggleMaximize} title={isMaximized ? "Restore" : "Maximize"}>
          {isMaximized ? "⊟" : "□"}
        </button>
      )}
    </div>
  );
}
