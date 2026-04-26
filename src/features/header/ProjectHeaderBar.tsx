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
    /* Close path with a hard-stop fallback. Codex review (round 5)
     * caught the original race: `win.close()` resolves when the
     * close *request* is acknowledged, NOT when the window is
     * actually destroyed — destruction happens later inside
     * `App.tsx`'s `onCloseRequested` callback. So the previous
     * `Promise.race(closePromise, timeout)` could mark `closed =
     * true` and skip the fallback in the very stalled-listener
     * scenario the timeout was meant to cover.
     *
     * New strategy: kick the proper close lifecycle (so the unsaved
     * files prompt + bounds save fire), wait the hard-stop window
     * unconditionally, then call `process.exit(0)`. If the close
     * actually succeeded, the renderer is already gone and `exit(0)`
     * is a no-op. If it stalled, exit(0) finishes the job.
     *
     * Required capabilities: `core:window:allow-close` for the
     * close-request, `core:window:allow-destroy` for the actual
     * tear-down inside `onCloseRequested`. Both granted in
     * `src-tauri/capabilities/default.json`. */
    const HARD_STOP_MS = 800;

    // Kick the close lifecycle. We don't await this — the
    // unconditional timeout below ensures we always reach the
    // process.exit fallback after HARD_STOP_MS regardless of how
    // long Tauri takes to actually destroy the window.
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

    // Wait for the lifecycle to complete (or stall). exit(0) is
    // safe to call whether or not the window was already destroyed.
    await new Promise<void>((resolve) => setTimeout(resolve, HARD_STOP_MS));

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
