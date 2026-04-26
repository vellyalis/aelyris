import { PanelLeft, PanelLeftClose, RefreshCw, Settings } from "lucide-react";
import logoSvg from "../../assets/logo.svg";
import { useAttenuatedPulse } from "../../shared/hooks/useAttenuatedPulse";
import { MenuBar, type Menu } from "../menubar/MenuBar";
import styles from "./ProjectHeaderBar.module.css";

interface ProjectHeaderBarProps {
  projectName: string;
  branch: string;
  changedCount?: number;
  status: "idle" | "edit" | "thinking" | "error" | "waiting" | "done";
  activeAgent?: { model: string; cost: number } | null;
  onOpenSettings?: () => void;
  onRefresh?: () => void;
  /** Application menus (File / Edit / View / Terminal / Help) — fanned
   *  out from the hamburger button on the left of the header. */
  menus: Menu[];
  /** Sidebar collapse state + toggle — Apple/VS Code chrome puts a
   *  panel toggle right next to the hamburger so a single click
   *  reclaims the workspace width. Ctrl+B fires the same toggle. */
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
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
  projectName,
  branch,
  changedCount,
  status,
  activeAgent,
  onOpenSettings,
  onRefresh,
  menus,
  sidebarCollapsed,
  onToggleSidebar,
}: ProjectHeaderBarProps) {
  const handleMinimize = async () => {
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      getCurrentWindow().minimize();
    } catch {}
  };
  const handleMaximize = async () => {
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      const win = getCurrentWindow();
      (await win.isMaximized()) ? win.unmaximize() : win.maximize();
    } catch {}
  };
  const handleClose = async () => {
    /* Close path with a hard-stop fallback. Three failure modes had to
     * be covered by hand because each one masked the others:
     *
     *  1. `core:window:allow-close` capability missing → `close()`
     *     throws `AccessControlNotAllowed`; the bare `catch {}`
     *     swallows it and the user thinks the button is dead.
     *  2. `App.tsx`'s `onCloseRequested` hangs (an `await` for window
     *     position never resolves while the runtime is busy) → close
     *     never proceeds, no error, no log.
     *  3. The user has unsaved files and `showConfirm` is rejected
     *     in some edge case → recursive `win.close()` would loop.
     *
     * Strategy: kick `close()` first so the proper lifecycle gets a
     * chance (saves bounds, prompts for unsaved files). If it hasn't
     * completed in 800 ms, fall through to `process.exit(0)` which
     * tears the process down regardless. Both branches log loudly so
     * the next regression doesn't disappear. */
    const HARD_STOP_MS = 800;
    let closed = false;
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      const win = getCurrentWindow();
      const closePromise = win
        .close()
        .then(() => {
          closed = true;
        })
        .catch((err) => {
          // eslint-disable-next-line no-console
          console.error("[ProjectHeaderBar] window.close() rejected", err);
        });
      const timeout = new Promise<void>((resolve) => setTimeout(resolve, HARD_STOP_MS));
      await Promise.race([closePromise, timeout]);
      if (closed) return;
      // eslint-disable-next-line no-console
      console.warn(
        `[ProjectHeaderBar] window.close() did not resolve within ${HARD_STOP_MS}ms — escalating to process.exit`,
      );
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[ProjectHeaderBar] window.close() threw before resolving", err);
    }
    try {
      const { exit } = await import("@tauri-apps/plugin-process");
      await exit(0);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[ProjectHeaderBar] process.exit(0) also failed", err);
    }
  };

  const { color, label } = STATUS_META[status] ?? STATUS_META.idle;
  const pulsePhase = useAttenuatedPulse(status !== "idle");
  const dotPulseClass =
    pulsePhase === "active" ? styles.dotPulse : pulsePhase === "ambient" ? styles.dotAmbient : "";

  return (
    <div className={styles.header} data-tauri-drag-region>
      <div className={styles.left}>
        <div className={styles.chromeCluster} aria-label="App chrome">
          <MenuBar menus={menus} />
          <button
            type="button"
            className={styles.headerBtn}
            onClick={onToggleSidebar}
            aria-label={sidebarCollapsed ? "Show sidebar" : "Hide sidebar"}
            aria-pressed={!sidebarCollapsed}
            title={`${sidebarCollapsed ? "Show" : "Hide"} sidebar (Ctrl+B)`}
          >
            {sidebarCollapsed ? (
              <PanelLeft size={14} aria-hidden="true" />
            ) : (
              <PanelLeftClose size={14} aria-hidden="true" />
            )}
          </button>
        </div>
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
              <span
                className={`${styles.dot} ${dotPulseClass}`}
                style={{ background: color }}
              />
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
        <button className={styles.headerBtn} onClick={onRefresh} aria-label="Refresh">
          <RefreshCw size={14} />
        </button>
        <button className={styles.headerBtn} onClick={onOpenSettings} aria-label="Settings">
          <Settings size={14} />
        </button>
        <span className={styles.controlsSeparator} aria-hidden="true" />
        {/* Window controls — right side for Windows UX */}
        <div className={styles.controls}>
          <button className={`${styles.ctrlBtn} ${styles.minimizeBtn}`} onClick={handleMinimize} aria-label="Minimize">
            <svg width="10" height="1" viewBox="0 0 10 1">
              <rect width="10" height="1" fill="currentColor" />
            </svg>
          </button>
          <button className={`${styles.ctrlBtn} ${styles.maximizeBtn}`} onClick={handleMaximize} aria-label="Maximize">
            <svg width="10" height="10" viewBox="0 0 10 10">
              <rect width="8" height="8" x="1" y="1" fill="none" stroke="currentColor" strokeWidth="1" />
            </svg>
          </button>
          <button className={`${styles.ctrlBtn} ${styles.closeBtn}`} onClick={handleClose} aria-label="Close">
            <svg width="10" height="10" viewBox="0 0 10 10">
              <line x1="1" y1="1" x2="9" y2="9" stroke="currentColor" strokeWidth="1.2" />
              <line x1="9" y1="1" x2="1" y2="9" stroke="currentColor" strokeWidth="1.2" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
