import {
  ArrowLeftRight,
  GitBranch,
  Maximize2,
  Minimize2,
  SplitSquareHorizontal,
  SplitSquareVertical,
  X,
} from "lucide-react";
import { memo } from "react";
import { lastCommandEnd, usePromptMarks } from "../../shared/hooks/usePromptMarks";
import { usePtyLag } from "../../shared/hooks/usePtyLag";
import styles from "./TerminalInfoBar.module.css";

interface TerminalInfoBarProps {
  shell: string;
  cwd?: string;
  branch?: string;
  /**
   * PTY id. When present, the bar subscribes to OSC 133 prompt marks and
   * renders a coloured dot for the last command's exit status. Pass `null`
   * when the terminal has not finished spawning yet — the indicator simply
   * stays hidden until the first mark arrives.
   */
  terminalId?: string | null;
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

export const TerminalInfoBar = memo(function TerminalInfoBar({
  shell,
  cwd,
  branch,
  terminalId,
  activeAgent,
  isActive: _isActive,
  isMaximized,
  onToggleMaximize,
  syncMode,
  onToggleSync,
  onSplitRight,
  onSplitDown,
  onClose,
}: TerminalInfoBarProps) {
  const dir = cwd?.split("/").filter(Boolean).slice(-2).join("/") ?? "";
  // Hook is always called (React rules); it no-ops when terminalId is null.
  const marks = usePromptMarks(terminalId ?? null);
  const lastEnd = lastCommandEnd(marks);
  const lag = usePtyLag(terminalId ?? null);

  return (
    <div className={styles.bar}>
      <span className={styles.shell}>{shell}</span>
      {lastEnd && (
        <ExitStatusDot exitCode={lastEnd.exitCode} />
      )}
      {lag.active && <BackpressureBadge dropped={lag.dropped} />}
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

interface ExitStatusDotProps {
  exitCode: number | null;
}

/**
 * Small coloured dot reporting the last command's exit status. Powered by
 * OSC 133;D — only rendered after a shell integration script has emitted
 * at least one CommandEnd mark, so sessions without the integration show
 * nothing (rather than a misleading "green, all good" state).
 *
 * - `exit 0`   → green  (success)
 * - `exit !=0` → red    (failure, with the code in the tooltip)
 * - `null`     → muted  (shell signalled an end but did not report a code)
 */
interface BackpressureBadgeProps {
  dropped: number;
}

/**
 * Renders while the broadcast channel feeding this pane is dropping
 * chunks under load (cargo build --verbose, test floods, etc.). The
 * badge auto-decays 5s after the last drop event so it never lingers
 * past the actual incident.
 *
 * The number is a ceiling, not a precision count — broadcast `Lagged`
 * reports the gap since the subscriber's last successful recv, and
 * very large floods can collapse multiple gaps into a single number.
 * The point is "you're losing rendered output", not telemetry.
 */
function BackpressureBadge({ dropped }: BackpressureBadgeProps) {
  const formatted = dropped.toLocaleString();
  const label = `Terminal output throttled — dropped ${formatted} chunk${dropped === 1 ? "" : "s"}.`;
  return (
    <span
      className={styles.lagBadge}
      role="status"
      aria-label={label}
      title={label}
    >
      throttled · {formatted}
    </span>
  );
}

function ExitStatusDot({ exitCode }: ExitStatusDotProps) {
  const color =
    exitCode === null
      ? "var(--text-muted)"
      : exitCode === 0
        ? "var(--ctp-green)"
        : "var(--ctp-red)";
  const label =
    exitCode === null
      ? "Last command finished (exit code unreported)"
      : exitCode === 0
        ? "Last command succeeded (exit 0)"
        : `Last command failed (exit ${exitCode})`;
  return (
    <span
      className={styles.exitDot}
      style={{ background: color }}
      role="status"
      aria-label={label}
      title={label}
    />
  );
}
