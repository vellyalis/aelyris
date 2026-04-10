import { PixelAvatar } from "../../shared/ui/PixelAvatar";
import { Settings, RefreshCw } from "lucide-react";
import styles from "./ProjectHeaderBar.module.css";

interface ProjectHeaderBarProps {
  projectName: string;
  branch: string;
  status: "idle" | "edit" | "thinking";
  activeAgent?: { model: string; cost: number } | null;
  onOpenSettings?: () => void;
  onRefresh?: () => void;
}

const STATUS_META: Record<string, { color: string; label: string }> = {
  idle: { color: "var(--status-idle)", label: "Idle" },
  edit: { color: "var(--status-edit)", label: "Edit" },
  thinking: { color: "var(--status-thinking)", label: "Thinking..." },
};

export function ProjectHeaderBar({
  projectName, branch, status, activeAgent, onOpenSettings, onRefresh,
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
      {/* macOS-style traffic lights */}
      <div className={styles.controls}>
        <button className={`${styles.ctrlBtn} ${styles.closeBtn}`} onClick={handleClose} aria-label="Close">
          <svg width="6" height="6" viewBox="0 0 6 6"><line x1="0.5" y1="0.5" x2="5.5" y2="5.5" stroke="rgba(0,0,0,0.5)" strokeWidth="1.2"/><line x1="5.5" y1="0.5" x2="0.5" y2="5.5" stroke="rgba(0,0,0,0.5)" strokeWidth="1.2"/></svg>
        </button>
        <button className={`${styles.ctrlBtn} ${styles.minimizeBtn}`} onClick={handleMinimize} aria-label="Minimize">
          <svg width="6" height="1" viewBox="0 0 6 1"><rect width="6" height="1" fill="rgba(0,0,0,0.5)"/></svg>
        </button>
        <button className={`${styles.ctrlBtn} ${styles.maximizeBtn}`} onClick={handleMaximize} aria-label="Maximize">
          <svg width="6" height="6" viewBox="0 0 6 6"><path d="M0.5 3.5V0.5H3.5M5.5 2.5V5.5H2.5" stroke="rgba(0,0,0,0.5)" strokeWidth="1" fill="none"/></svg>
        </button>
      </div>

      <div className={styles.left}>
        <PixelAvatar seed={projectName} size={28} />
        <div className={styles.projectInfo}>
          <div className={styles.topRow}>
            <span className={styles.name}>{projectName}</span>
            <span className={styles.branch}>⚡{branch}</span>
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
      </div>
    </div>
  );
}
