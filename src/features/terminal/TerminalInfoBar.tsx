import { memo } from "react";
import {
  GitBranch,
  SplitSquareVertical,
  SplitSquareHorizontal,
  ArrowLeftRight,
  Maximize2,
  Minimize2,
  X,
} from "lucide-react";
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
      {branch && (
        <span className={styles.branch}>
          <GitBranch size={10} aria-hidden="true" />
          {branch}
        </span>
      )}
      <div className={styles.spacer} />
      {activeAgent && (
        <>
          <span className={styles.meta}>{activeAgent.model}</span>
          <span className={styles.cost}>&lt;${activeAgent.cost.toFixed(2)}</span>
        </>
      )}
      {onSplitRight && (
        <button
          type="button"
          className={styles.toggleBtn}
          onClick={onSplitRight}
          aria-label="Split pane right"
          title="Split Right (Alt+Shift+Right)"
        >
          <SplitSquareVertical size={12} aria-hidden="true" />
        </button>
      )}
      {onSplitDown && (
        <button
          type="button"
          className={styles.toggleBtn}
          onClick={onSplitDown}
          aria-label="Split pane down"
          title="Split Down (Alt+Shift+Down)"
        >
          <SplitSquareHorizontal size={12} aria-hidden="true" />
        </button>
      )}
      {onToggleSync && (
        <button
          type="button"
          className={`${styles.toggleBtn} ${syncMode ? styles.toggleBtnActive : ""}`}
          onClick={onToggleSync}
          aria-pressed={!!syncMode}
          aria-label="Toggle synchronized input"
          title={syncMode ? "Disable Sync Input" : "Sync Input to All Panes"}
        >
          <ArrowLeftRight size={12} aria-hidden="true" />
        </button>
      )}
      {onToggleMaximize && (
        <button
          type="button"
          className={styles.toggleBtn}
          onClick={onToggleMaximize}
          aria-pressed={!!isMaximized}
          aria-label={isMaximized ? "Restore pane" : "Maximize pane"}
          title={isMaximized ? "Restore" : "Maximize"}
        >
          {isMaximized ? <Minimize2 size={12} aria-hidden="true" /> : <Maximize2 size={12} aria-hidden="true" />}
        </button>
      )}
      {onClose && (
        <button
          type="button"
          className={styles.toggleBtn}
          onClick={onClose}
          aria-label="Close pane"
          title="Close Pane (Ctrl+Shift+W)"
        >
          <X size={12} aria-hidden="true" />
        </button>
      )}
    </div>
  );
});
