import styles from "./TerminalInfoBar.module.css";

interface TerminalInfoBarProps {
  shell: string;
  cwd?: string;
  branch?: string;
  isMaximized?: boolean;
  onToggleMaximize?: () => void;
}

export function TerminalInfoBar({ shell, cwd, branch, isMaximized, onToggleMaximize }: TerminalInfoBarProps) {
  const dir = cwd?.split("/").filter(Boolean).slice(-2).join("/") ?? "";

  return (
    <div className={styles.bar}>
      <span className={styles.shell}>{shell}</span>
      {dir && <span className={styles.cwd}>~/{dir}</span>}
      {branch && <span className={styles.branch}>⚡{branch}</span>}
      <div className={styles.spacer} />
      <span className={styles.meta}>personal</span>
      <span className={styles.meta}>Opus 4.6</span>
      {onToggleMaximize && (
        <button className={styles.toggleBtn} onClick={onToggleMaximize} title={isMaximized ? "Restore" : "Maximize"}>
          {isMaximized ? "⊟" : "□"}
        </button>
      )}
    </div>
  );
}
