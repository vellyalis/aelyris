import { PixelAvatar } from "../../shared/ui/PixelAvatar";
import styles from "./ProjectHeaderBar.module.css";

interface ProjectHeaderBarProps {
  projectName: string;
  branch: string;
  status: "idle" | "edit" | "thinking";
  activeAgent?: { model: string; cost: number } | null;
}

const STATUS_META: Record<string, { color: string; label: string }> = {
  idle: { color: "var(--status-idle)", label: "Idle" },
  edit: { color: "var(--status-edit)", label: "Edit" },
  thinking: { color: "var(--status-thinking)", label: "Thinking..." },
};

export function ProjectHeaderBar({
  projectName, branch, status, activeAgent,
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
        <PixelAvatar seed={projectName} size={18} />
        <span className={styles.name}>{projectName}</span>
        <span className={styles.branch}>⚡{branch}</span>
        {activeAgent && (
          <span className={styles.status}>
            <span className={styles.dot} style={{ background: color }} />
            {label}
          </span>
        )}
      </div>
      <div className={styles.right}>
        {activeAgent && (
          <>
            <span className={styles.model}>{activeAgent.model}</span>
            <span className={styles.cost}>&lt;${activeAgent.cost.toFixed(2)}</span>
          </>
        )}
        <div className={styles.controls}>
          <button className={styles.ctrlBtn} onClick={handleMinimize}>
            <svg width="10" height="1" viewBox="0 0 10 1"><rect width="10" height="1" fill="currentColor"/></svg>
          </button>
          <button className={styles.ctrlBtn} onClick={handleMaximize}>
            <svg width="10" height="10" viewBox="0 0 10 10"><rect width="9" height="9" x=".5" y=".5" fill="none" stroke="currentColor" strokeWidth="1"/></svg>
          </button>
          <button className={`${styles.ctrlBtn} ${styles.closeBtn}`} onClick={handleClose}>
            <svg width="10" height="10" viewBox="0 0 10 10"><line x1="0" y1="0" x2="10" y2="10" stroke="currentColor" strokeWidth="1.2"/><line x1="10" y1="0" x2="0" y2="10" stroke="currentColor" strokeWidth="1.2"/></svg>
          </button>
        </div>
      </div>
    </div>
  );
}
