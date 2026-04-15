import { Settings, RefreshCw } from "lucide-react";
import logoSvg from "../../assets/logo.svg";
import styles from "./ProjectHeaderBar.module.css";

interface ProjectHeaderBarProps {
  projectName: string;
  branch: string;
  changedCount?: number;
  status: "idle" | "edit" | "thinking" | "error" | "waiting" | "done";
  activeAgent?: { model: string; cost: number } | null;
  onOpenSettings?: () => void;
  onRefresh?: () => void;
}

const STATUS_META: Record<string, { color: string; label: string }> = {
  idle: { color: "var(--status-idle)", label: "Idle" },
  edit: { color: "var(--status-edit)", label: "Coding" },
  thinking: { color: "var(--status-thinking)", label: "Thinking..." },
  error: { color: "var(--ctp-red)", label: "Error" },
  waiting: { color: "var(--ctp-yellow)", label: "Needs Attention" },
  done: { color: "var(--ctp-blue)", label: "Complete" },
};

export function ProjectHeaderBar({
  projectName, branch, changedCount, status, activeAgent, onOpenSettings, onRefresh,
}: ProjectHeaderBarProps) {
  const handleMinimize = async () => {
    try { const { getCurrentWindow } = await import("@tauri-apps/api/window"); getCurrentWindow().minimize(); } catch {}
  };
  const handleMaximize = async () => {
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      const win = getCurrentWindow();
      (await win.isMaximized()) ? win.unmaximize() : win.maximize();
    } catch {}
  };
  const handleClose = async () => {
    try { const { exit } = await import("@tauri-apps/plugin-process"); await exit(0); } catch {
      try { const { getCurrentWindow } = await import("@tauri-apps/api/window"); getCurrentWindow().close(); } catch {}
    }
  };

  const { color, label } = STATUS_META[status] ?? STATUS_META.idle;

  return (
    <div className={styles.header} data-tauri-drag-region>
      <div className={styles.left}>
        <img src={logoSvg} alt="Aether" width={28} height={28} className={styles.logo} />
        <div className={styles.projectInfo}>
          <div className={styles.topRow}>
            <span className={styles.name}>{projectName}</span>
            <span className={styles.branch}>⚡ {branch}</span>
            {changedCount !== undefined && changedCount > 0 && (
              <span className={styles.changes}>{changedCount} changed</span>
            )}
          </div>
          <div className={styles.bottomRow}>
            <span className={styles.status}>
              <span className={`${styles.dot} ${status !== "idle" ? styles.dotPulse : ""}`} style={{ background: color }} />
              <span className={styles.statusLabel}>{label}</span>
            </span>
            {activeAgent && (
              <>
                <span className={styles.model}>{activeAgent.model}</span>
                <span className={styles.cost}>&lt;${activeAgent.cost.toFixed(2)}</span>
              </>
            )}
          </div>
        </div>
      </div>

      <div className={styles.right}>
        <button className={styles.headerBtn} onClick={onRefresh} aria-label="Refresh"><RefreshCw size={14} /></button>
        <button className={styles.headerBtn} onClick={onOpenSettings} aria-label="Settings"><Settings size={14} /></button>
        {/* Window controls — right side for Windows UX */}
        <div className={styles.controls}>
          <button className={`${styles.ctrlBtn} ${styles.minimizeBtn}`} onClick={handleMinimize} aria-label="Minimize">
            <svg width="10" height="1" viewBox="0 0 10 1"><rect width="10" height="1" fill="currentColor"/></svg>
          </button>
          <button className={`${styles.ctrlBtn} ${styles.maximizeBtn}`} onClick={handleMaximize} aria-label="Maximize">
            <svg width="10" height="10" viewBox="0 0 10 10"><rect width="8" height="8" x="1" y="1" fill="none" stroke="currentColor" strokeWidth="1"/></svg>
          </button>
          <button className={`${styles.ctrlBtn} ${styles.closeBtn}`} onClick={handleClose} aria-label="Close">
            <svg width="10" height="10" viewBox="0 0 10 10"><line x1="1" y1="1" x2="9" y2="9" stroke="currentColor" strokeWidth="1.2"/><line x1="9" y1="1" x2="1" y2="9" stroke="currentColor" strokeWidth="1.2"/></svg>
          </button>
        </div>
      </div>
    </div>
  );
}
