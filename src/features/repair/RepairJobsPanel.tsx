import { CheckCircle2, Loader2, Wrench, XCircle } from "lucide-react";
import { useEffect, useRef } from "react";
import {
  type AutoRepairConfig,
  isPhaseActive,
  type RepairJobInfo,
  type RepairPhase,
  repairPhaseLabel,
} from "../../shared/types/repair";
import styles from "./RepairJobsPanel.module.css";

interface RepairJobsPanelProps {
  jobs: RepairJobInfo[];
  config: AutoRepairConfig;
  onToggleEnabled: (enabled: boolean) => void;
  onClose: () => void;
}

/**
 * Popover anchored to the StatusBar repair button. Shows a global on/off
 * toggle at the top and a live list of active / recent repair jobs.
 *
 * Display only — no job-specific actions yet. `AutoRepairManager` has no
 * cancel method today; when it grows one, add a row-level button here.
 */
export function RepairJobsPanel({ jobs, config, onToggleEnabled, onClose }: RepairJobsPanelProps) {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    const onClick = (e: MouseEvent) => {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener("keydown", onKey);
    // Defer so the opening click itself doesn't immediately close us.
    const raf = requestAnimationFrame(() => {
      window.addEventListener("mousedown", onClick);
    });
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onClick);
      cancelAnimationFrame(raf);
    };
  }, [onClose]);

  const sortedJobs = [...jobs].sort((a, b) => {
    const aActive = isPhaseActive(a.phase) ? 0 : 1;
    const bActive = isPhaseActive(b.phase) ? 0 : 1;
    if (aActive !== bActive) return aActive - bActive;
    return b.elapsedSecs - a.elapsedSecs;
  });

  return (
    <div ref={rootRef} className={styles.panel} role="dialog" aria-label="Auto-repair jobs">
      <div className={styles.header}>
        <div className={styles.headerTitle}>
          <Wrench size={12} />
          <span>Auto-repair</span>
        </div>
        <label className={styles.toggle}>
          <input type="checkbox" checked={config.enabled} onChange={(e) => onToggleEnabled(e.target.checked)} />
          <span>{config.enabled ? "Watching" : "Disabled"}</span>
        </label>
      </div>
      {config.enabled && config.pattern && (
        <div className={styles.pattern} title={config.pattern}>
          Pattern: <code>{config.pattern}</code>
        </div>
      )}
      <div className={styles.list}>
        {sortedJobs.length === 0 ? (
          <div className={styles.empty}>
            {config.enabled ? "No active jobs. Waiting for error output..." : "Auto-repair is off."}
          </div>
        ) : (
          sortedJobs.map((job) => <JobRow key={job.id} job={job} />)
        )}
      </div>
    </div>
  );
}

function JobRow({ job }: { job: RepairJobInfo }) {
  return (
    <div className={styles.row}>
      <PhaseIcon phase={job.phase} />
      <div className={styles.rowBody}>
        <div className={styles.rowTop}>
          <code className={styles.branch}>{job.branch}</code>
          <span className={styles.elapsed}>{formatElapsed(job.elapsedSecs)}</span>
        </div>
        <div className={styles.rowPhase}>{repairPhaseLabel(job.phase)}</div>
        <div className={styles.rowError} title={job.errorLine}>
          {job.errorLine}
        </div>
      </div>
    </div>
  );
}

function PhaseIcon({ phase }: { phase: RepairPhase }) {
  switch (phase.kind) {
    case "succeeded":
      return <CheckCircle2 size={14} className={styles.iconSuccess} />;
    case "failed":
      return <XCircle size={14} className={styles.iconFail} />;
    default:
      return <Loader2 size={14} className={styles.iconActive} />;
  }
}

function formatElapsed(secs: number): string {
  if (secs < 60) return `${secs}s`;
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}m${s.toString().padStart(2, "0")}s`;
}
