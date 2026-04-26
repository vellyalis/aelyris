import { Cpu, FileText, GitBranch, Layers, Wrench } from "lucide-react";
import { useState } from "react";
import { useGhostLayers } from "../../shared/hooks/useGhostLayers";
import { useImageMetrics } from "../../shared/hooks/useImageMetrics";
import { useRepairJobs } from "../../shared/hooks/useRepairJobs";
import { GhostDiffPanel } from "../ghost-diff/GhostDiffPanel";
import { RepairJobsPanel } from "../repair/RepairJobsPanel";
import { InlineImageBudget } from "./InlineImageBudget";
import styles from "./StatusBar.module.css";

interface StatusBarProps {
  shell: string;
  branch: string;
  changedCount: number;
  encoding?: string;
  agentStatus?: string;
  /**
   * PTY id of the currently active terminal pane. Powers the inline-
   * image budget badge (Sprint 3 wave 3) — `null` keeps the badge
   * hidden, which is the right behaviour while a pane is still
   * spawning or no pane has focus yet.
   */
  terminalId?: string | null;
}

export function StatusBar({
  shell,
  branch,
  changedCount,
  encoding = "UTF-8",
  agentStatus,
  terminalId = null,
}: StatusBarProps) {
  const [repairOpen, setRepairOpen] = useState(false);
  const [ghostOpen, setGhostOpen] = useState(false);
  const { jobs, activeCount, config, setEnabled } = useRepairJobs();
  const { layers: ghostLayers, activeCount: ghostActiveCount, dismiss: dismissGhost } = useGhostLayers();
  const imageMetrics = useImageMetrics(terminalId);

  const repairActive = config.enabled || activeCount > 0;
  const ghostActive = ghostLayers.length > 0;

  return (
    <div className={styles.statusbar}>
      <div className={styles.left}>
        {branch && (
          <span className={`${styles.item} ${styles.branchAnchor}`} title={`Current branch: ${branch}`}>
            <GitBranch size={10} strokeWidth={1.75} aria-hidden="true" />
            {branch}
          </span>
        )}
        {changedCount > 0 && (
          <span className={styles.item} title={`${changedCount} files changed`}>
            <FileText size={10} strokeWidth={1.75} aria-hidden="true" />
            {changedCount} changed
          </span>
        )}
        <span className={styles.separator} aria-hidden="true" />
        <span className={`${styles.item} ${styles.passive}`}>{shell}</span>
      </div>
      <div className={styles.right}>
        <InlineImageBudget metrics={imageMetrics} />
        {agentStatus && (
          <span className={`${styles.item} ${styles.passive}`}>
            <Cpu size={10} strokeWidth={1.75} aria-hidden="true" />
            {agentStatus}
          </span>
        )}
        <span className={`${styles.item} ${styles.passive}`}>{encoding}</span>
        <span className={`${styles.item} ${styles.passive}`}>LF</span>
        <span className={styles.separator} aria-hidden="true" />
        <button
          type="button"
          className={`${styles.actionBtn} ${repairActive ? styles.actionBtnActive : ""}`}
          onClick={() => setRepairOpen((v) => !v)}
          title={config.enabled ? "Auto-repair watching" : "Auto-repair disabled"}
          aria-label="Auto-repair"
          aria-expanded={repairOpen}
        >
          <Wrench size={10} strokeWidth={1.75} aria-hidden="true" />
          {activeCount > 0 && <span className={styles.repairBadge}>{activeCount}</span>}
        </button>
        <button
          type="button"
          className={`${styles.actionBtn} ${ghostActive ? styles.actionBtnActive : ""}`}
          onClick={() => setGhostOpen((v) => !v)}
          title={
            ghostLayers.length === 0
              ? "No active ghost layers"
              : `${ghostLayers.length} ghost layer${ghostLayers.length === 1 ? "" : "s"}`
          }
          aria-label="Ghost diff"
          aria-expanded={ghostOpen}
        >
          <Layers size={10} strokeWidth={1.75} aria-hidden="true" />
          {ghostActiveCount > 0 && <span className={styles.repairBadge}>{ghostActiveCount}</span>}
        </button>
      </div>
      {repairOpen && (
        <RepairJobsPanel
          jobs={jobs}
          config={config}
          onToggleEnabled={setEnabled}
          onClose={() => setRepairOpen(false)}
        />
      )}
      {ghostOpen && (
        <GhostDiffPanel layers={ghostLayers} onDismiss={dismissGhost} onClose={() => setGhostOpen(false)} />
      )}
    </div>
  );
}
