import styles from "./TerminalInfoBar.module.css";

interface TerminalInfoBarProps {
  shell: string;
  cwd?: string;
  isMaximized?: boolean;
  onToggleMaximize?: () => void;
}

export function TerminalInfoBar({ shell, cwd, isMaximized, onToggleMaximize }: TerminalInfoBarProps) {
  const dir = cwd?.split("/").filter(Boolean).slice(-2).join("/") ?? "";

  return (
    <div className={styles.bar}>
      <span className={styles.shell}>{shell}</span>
      {dir && <span className={styles.cwd}>{dir}</span>}
      <div className={styles.spacer} />
      {onToggleMaximize && (
        <button className={styles.toggleBtn} onClick={onToggleMaximize} title={isMaximized ? "Restore" : "Maximize"}>
          {isMaximized ? "⊟" : "□"}
        </button>
      )}
    </div>
  );
}
