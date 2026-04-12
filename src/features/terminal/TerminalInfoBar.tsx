import { memo } from "react";
import styles from "./TerminalInfoBar.module.css";

interface TerminalInfoBarProps {
  shell: string;
  cwd?: string;
  branch?: string;
  activeAgent?: { model: string; cost: number } | null;
  isActive?: boolean;
  isMaximized?: boolean;
  onToggleMaximize?: () => void;
  syncMode?: boolean;
  onToggleSync?: () => void;
  onSplitRight?: () => void;
  onSplitDown?: () => void;
  onClose?: () => void;
}

export const TerminalInfoBar = memo(function TerminalInfoBar({ shell, cwd, branch, activeAgent, isActive: _isActive, isMaximized, onToggleMaximize, syncMode, onToggleSync, onSplitRight, onSplitDown, onClose }: TerminalInfoBarProps) {
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
      {onSplitRight && (
        <button className={styles.toggleBtn} onClick={onSplitRight} title="Split Right (Alt+Shift+Right)" aria-label="Split pane right">⎸</button>
      )}
      {onSplitDown && (
        <button className={styles.toggleBtn} onClick={onSplitDown} title="Split Down (Alt+Shift+Down)" aria-label="Split pane down">⎯</button>
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
        <button className={styles.toggleBtn} onClick={onToggleMaximize} title={isMaximized ? "Restore" : "Maximize"} aria-label={isMaximized ? "Restore pane" : "Maximize pane"}>
          {isMaximized ? "⊟" : "□"}
        </button>
      )}
      {onClose && (
        <button className={styles.toggleBtn} onClick={onClose} title="Close Pane (Ctrl+Shift+W)" aria-label="Close pane">×</button>
      )}
    </div>
  );
});
