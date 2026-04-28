import { PanelLeft, PanelLeftClose, RefreshCw, Settings } from "lucide-react";
import logoPng from "../../assets/logo.png";
import { useAttenuatedPulse } from "../../shared/hooks/useAttenuatedPulse";
import { useAppStore } from "../../shared/store/appStore";
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
    /* Close path. Two failure modes have to be covered while NOT
     * trampling the unsaved-changes confirmation:
     *
     *  1. Capability denied (`core:window:allow-close` /
     *     `allow-destroy`) → `close()` rejects, the renderer is
     *     never torn down. Caught logs + a hard-stop fallback to
     *     `process.exit(0)` covers this.
     *
     *  2. Stalled `onCloseRequested` (an `await win.outerPosition()`
     *     never resolves while the runtime is busy). Same hard-stop
     *     fallback covers it.
     *
     * Critical NOT-bug (Codex r6): when the user has unsaved files
     * the close lifecycle calls `event.preventDefault()` and waits
     * for `showConfirm`. A blanket "exit after 800 ms" would
     * silently kill the process while the confirm dialog is still
     * up, losing the user's edits. So the fallback only arms when
     * `unsavedFiles.size === 0` — the happy path that should
     * complete in well under 800 ms. With unsaved files we just
     * fire `close()` and let the confirm dialog drive the
     * lifecycle to completion (either user confirms → close
     * proceeds, or cancels → window stays).
     */
    const HARD_STOP_MS = 800;
    const hasUnsaved = useAppStore.getState().unsavedFiles.size > 0;

    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      void getCurrentWindow()
        .close()
        .catch((err) => {
          // eslint-disable-next-line no-console
          console.error("[ProjectHeaderBar] window.close() rejected", err);
        });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[ProjectHeaderBar] failed to import @tauri-apps/api/window", err);
    }

    if (hasUnsaved) {
      // Let the confirm dialog drive the rest of the lifecycle.
      // No hard-stop here — exit(0) during a live confirm would
      // discard unsaved edits.
      return;
    }

    await new Promise<void>((resolve) => setTimeout(resolve, HARD_STOP_MS));

    // Re-check unsaved state *after* the timeout: if an autosave
    // landed, or `markUnsaved` fired between the two reads, the
    // confirm path may now be active. Guard once more before we
    // pull the trigger on `exit(0)`.
    if (useAppStore.getState().unsavedFiles.size > 0) return;

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
        <img src={logoPng} alt="Aether" width={28} height={28} className={styles.logo} />
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
