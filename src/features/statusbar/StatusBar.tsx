import { useState } from "react";
import { GitBranch, FileText, Cpu, Wrench, Layers } from "lucide-react";
import { useRepairJobs } from "../../shared/hooks/useRepairJobs";
import { useGhostLayers } from "../../shared/hooks/useGhostLayers";
import { RepairJobsPanel } from "../repair/RepairJobsPanel";
import { GhostDiffPanel } from "../ghost-diff/GhostDiffPanel";
import styles from "./StatusBar.module.css";

interface StatusBarProps {
  shell: string;
  branch: string;
  changedCount: number;
  encoding?: string;
  agentStatus?: string;
}

export function StatusBar({ shell, branch, changedCount, encoding = "UTF-8", agentStatus }: StatusBarProps) {
  const [repairOpen, setRepairOpen] = useState(false);
  const [ghostOpen, setGhostOpen] = useState(false);
  const { jobs, activeCount, config, setEnabled } = useRepairJobs();
  const {
    layers: ghostLayers,
    activeCount: ghostActiveCount,
    dismiss: dismissGhost,
  } = useGhostLayers();

  const repairActive = config.enabled || activeCount > 0;
  const ghostActive = ghostLayers.length > 0;

  return (
    <div className={styles.statusbar}>
      <div className={styles.left}>
        <span className={styles.item}>{shell}</span>
        {branch && (
          <span className={styles.item}>
            <GitBranch size={11} />
            {branch}
          </span>
        )}
        {changedCount > 0 && (
          <span className={styles.item}>
            <FileText size={11} />
            {changedCount} changed
          </span>
        )}
      </div>
      <div className={styles.right}>
        {agentStatus && (
          <span className={styles.item}>
            <Cpu size={11} />
            {agentStatus}
          </span>
        )}
        <button
          type="button"
          className={`${styles.repairBtn} ${repairActive ? styles.repairActive : ""}`}
          onClick={() => setRepairOpen((v) => !v)}
          title={config.enabled ? "Auto-repair watching" : "Auto-repair disabled"}
          aria-label="Auto-repair"
          aria-expanded={repairOpen}
        >
          <Wrench size={11} />
          {activeCount > 0 && <span className={styles.repairBadge}>{activeCount}</span>}
        </button>
        <button
          type="button"
          className={`${styles.repairBtn} ${ghostActive ? styles.repairActive : ""}`}
          onClick={() => setGhostOpen((v) => !v)}
          title={
            ghostLayers.length === 0
              ? "No active ghost layers"
              : `${ghostLayers.length} ghost layer${ghostLayers.length === 1 ? "" : "s"}`
          }
          aria-label="Ghost diff"
          aria-expanded={ghostOpen}
        >
          <Layers size={11} />
          {ghostActiveCount > 0 && (
            <span className={styles.repairBadge}>{ghostActiveCount}</span>
          )}
        </button>
        <span className={styles.item}>{encoding}</span>
        <span className={styles.item}>LF</span>
        <span className={styles.item}>Aether v0.1.0</span>
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
        <GhostDiffPanel
          layers={ghostLayers}
          onDismiss={dismissGhost}
          onClose={() => setGhostOpen(false)}
        />
      )}
    </div>
  );
}
