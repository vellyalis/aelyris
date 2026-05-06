import { Cpu, Download, FileText, Gauge, GitBranch, Layers, Wrench, X } from "lucide-react";
import { useState } from "react";
import { usePerformanceObservatory } from "../analytics/usePerformanceObservatory";
import { useGhostLayers } from "../../shared/hooks/useGhostLayers";
import { useRepairJobs } from "../../shared/hooks/useRepairJobs";
import {
  formatBytes,
  formatFps,
  formatMs,
  createPerformanceDiagnosticBundle,
  type PerformanceObservatorySnapshot,
} from "../analytics/performanceObservatory";
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
  paneCount?: number;
  rightRailMode?: string;
  rightRailWidth?: number | null;
}

export function StatusBar({
  shell,
  branch,
  changedCount,
  encoding = "UTF-8",
  agentStatus,
  terminalId = null,
  paneCount = 0,
  rightRailMode = "command",
  rightRailWidth = null,
}: StatusBarProps) {
  const [repairOpen, setRepairOpen] = useState(false);
  const [ghostOpen, setGhostOpen] = useState(false);
  const [perfOpen, setPerfOpen] = useState(false);
  const { jobs, activeCount, config, setEnabled } = useRepairJobs();
  const { layers: ghostLayers, activeCount: ghostActiveCount, dismiss: dismissGhost } = useGhostLayers();
  const performanceSnapshot = usePerformanceObservatory({
    terminalId,
    paneCount,
    rightRailMode,
    rightRailWidth,
  });
  const imageMetrics = performanceSnapshot.terminal.imageMetrics;

  const repairActive = config.enabled || activeCount > 0;
  const ghostActive = ghostLayers.length > 0;
  const perfWarnings = performanceSnapshot.budgetWarnings;
  const perfCritical = perfWarnings.some((warning) => warning.severity === "critical");
  const perfActive = perfWarnings.length > 0;
  const statusTitle = `Shell: ${shell}. Encoding: ${encoding}. Line endings: LF.`;

  return (
    <div className={styles.statusbar} title={statusTitle}>
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
      </div>
      <div className={styles.right}>
        <InlineImageBudget metrics={imageMetrics} />
        <button
          type="button"
          className={`${styles.actionBtn} ${perfActive ? styles.actionBtnActive : ""} ${
            perfCritical ? styles.actionBtnDanger : ""
          }`}
          onClick={() => setPerfOpen((v) => !v)}
          title={performanceTitle(performanceSnapshot)}
          aria-label="Performance observatory"
          aria-expanded={perfOpen}
        >
          <Gauge size={10} strokeWidth={1.75} aria-hidden="true" />
          {perfWarnings.length > 0 && <span className={styles.repairBadge}>{perfWarnings.length}</span>}
        </button>
        {agentStatus && (
          <span className={`${styles.item} ${styles.passive}`}>
            <Cpu size={10} strokeWidth={1.75} aria-hidden="true" />
            {agentStatus}
          </span>
        )}
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
      {perfOpen && <PerformanceObservatoryPanel snapshot={performanceSnapshot} onClose={() => setPerfOpen(false)} />}
    </div>
  );
}

function performanceTitle(snapshot: PerformanceObservatorySnapshot): string {
  const warnings = snapshot.budgetWarnings.length;
  return [
    `Performance: ${warnings === 0 ? "within budgets" : `${warnings} budget issue${warnings === 1 ? "" : "s"}`}`,
    `Terminal: ${formatFps(snapshot.terminal.fps)} / ${formatMs(snapshot.terminal.frameMs)}`,
    `Dropped render: ${snapshot.terminal.droppedRenderFrames}`,
    `Renderer: ${snapshot.terminal.renderer}${snapshot.terminal.webglFallback ? " (WebGL fallback)" : ""}`,
    `Scrollback: ${snapshot.terminal.scrollbackRows.toLocaleString()} rows / ${formatBytes(
      snapshot.terminal.scrollbackMemoryBytes,
    )}`,
    `Panes: ${snapshot.backend?.paneCount ?? 0}`,
    `IPC: ${formatMs(snapshot.backend?.ipcLatencyMs)} / dropped ${snapshot.terminal.ipcDroppedChunks}`,
    `DB write: ${formatMs(snapshot.backend?.dbWriteLatencyMs)}`,
    `Event lag: ${formatMs(snapshot.runtime.eventLoopLagMs)}`,
    `Right rail: ${formatMs(snapshot.runtime.rightRailRenderMs)}`,
    `Dashboard: ${formatMs(snapshot.runtime.dashboardUpdateLatencyMs)}`,
    `Memory: ${formatBytes(snapshot.runtime.heapUsedBytes)}`,
  ].join("\n");
}

function PerformanceObservatoryPanel({
  snapshot,
  onClose,
}: {
  snapshot: PerformanceObservatorySnapshot;
  onClose: () => void;
}) {
  const t = snapshot.terminal;
  const backend = snapshot.backend;
  const runtime = snapshot.runtime;
  const warnings = snapshot.budgetWarnings;

  return (
    <div className={styles.perfPanel} role="dialog" aria-label="Performance Observatory">
      <div className={styles.perfHeader}>
        <div>
          <div className={styles.perfTitle}>Performance Observatory</div>
          <div className={styles.perfSubtitle}>
            {warnings.length === 0 ? "Budgets nominal" : `${warnings.length} budget issue${warnings.length === 1 ? "" : "s"}`}
          </div>
        </div>
        <button
          type="button"
          className={styles.perfIconButton}
          onClick={() => exportPerformanceDiagnosticBundle(snapshot)}
          aria-label="Export performance diagnostic bundle"
          title="Export diagnostic bundle"
        >
          <Download size={12} aria-hidden="true" />
        </button>
        <button type="button" className={styles.perfClose} onClick={onClose} aria-label="Close performance observatory">
          <X size={12} aria-hidden="true" />
        </button>
      </div>

      <MetricSection
        title="Terminal"
        rows={[
          ["FPS", formatFps(t.fps), `>= ${snapshot.budgets.terminalFpsMin} fps`],
          ["Frame", formatMs(t.frameMs), `<= ${snapshot.budgets.terminalFrameMsMax} ms`],
          ["Dropped render", String(t.droppedRenderFrames), String(snapshot.budgets.droppedRenderFramesMax)],
          ["Renderer", `${t.renderer}${t.webglFallback ? " / WebGL fallback" : ""}`, "webgl when available"],
          ["Scrollback", `${t.scrollbackRows.toLocaleString()} rows`, formatBytes(t.scrollbackMemoryBytes)],
          [
            "Inline images",
            t.imageMetrics ? `${formatBytes(t.imageMetrics.bytesUsed)} / ${formatBytes(t.imageMetrics.cap)}` : "n/a",
            `${t.imageMetrics?.count ?? 0} retained`,
          ],
        ]}
      />

      <MetricSection
        title="IPC / DB"
        rows={[
          ["Panes", String(backend?.paneCount ?? 0), `${backend?.activeTerminalCount ?? 0} active PTYs`],
          ["IPC latency", formatMs(backend?.ipcLatencyMs), `<= ${snapshot.budgets.ipcLatencyMsMax} ms`],
          ["IPC dropped", String(t.ipcDroppedChunks), String(snapshot.budgets.ipcDroppedChunksMax)],
          ["Output batch", formatBytes(backend?.ipcBatchMaxBytes), `${backend?.ipcBatchIntervalMs ?? "n/a"} ms cadence`],
          ["DB write", formatMs(backend?.dbWriteLatencyMs), `<= ${snapshot.budgets.dbWriteLatencyMsMax} ms`],
          ["Event queue", formatMs(runtime.eventLoopLagMs), `<= ${snapshot.budgets.eventLoopLagMsMax} ms`],
        ]}
      />

      <MetricSection
        title="UI / Processes"
        rows={[
          ["Right rail", formatMs(runtime.rightRailRenderMs), `${runtime.rightRailMode} / ${runtime.rightRailWidth ?? "n/a"} px`],
          ["Dashboard", formatMs(runtime.dashboardUpdateLatencyMs), `<= ${snapshot.budgets.dashboardUpdateMsMax} ms`],
          ["Renderer heap", formatBytes(runtime.heapUsedBytes), `<= ${formatBytes(snapshot.budgets.heapUsedWarnBytes)}`],
          [
            "Renderer process",
            formatBytes(runtime.rendererProcessMemoryBytes),
            `<= ${formatBytes(snapshot.budgets.rendererProcessMemoryWarnBytes)}`,
          ],
          [
            "Renderer CPU",
            runtime.rendererCpuPct === null ? "n/a" : `${runtime.rendererCpuPct.toFixed(0)}%`,
            `<= ${snapshot.budgets.rendererCpuPctMax}%`,
          ],
          [
            "Dashboard memory",
            formatBytes(runtime.dashboardProcessMemoryBytes),
            `<= ${formatBytes(snapshot.budgets.dashboardProcessMemoryWarnBytes)}`,
          ],
          [
            "Dashboard CPU",
            runtime.dashboardCpuPct === null ? "n/a" : `${runtime.dashboardCpuPct.toFixed(0)}%`,
            `<= ${snapshot.budgets.dashboardCpuPctMax}%`,
          ],
        ]}
      />

      {warnings.length > 0 && (
        <div className={styles.perfWarnings}>
          <div className={styles.perfSectionTitle}>Budget Warnings</div>
          {warnings.map((warning) => (
            <div key={warning.id} className={styles.perfWarning} data-severity={warning.severity}>
              <span>{warning.label}</span>
              <span>
                {warning.value} / {warning.budget}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function exportPerformanceDiagnosticBundle(snapshot: PerformanceObservatorySnapshot): void {
  if (typeof document === "undefined") return;
  const bundle = createPerformanceDiagnosticBundle(snapshot);
  const json = JSON.stringify(bundle, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${bundle.kind}-${bundle.generatedAt.replace(/[:.]/g, "-")}.json`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function MetricSection({
  title,
  rows,
}: {
  title: string;
  rows: Array<[label: string, value: string, budget: string]>;
}) {
  return (
    <section className={styles.perfSection}>
      <div className={styles.perfSectionTitle}>{title}</div>
      <div className={styles.perfRows}>
        {rows.map(([label, value, budget]) => (
          <div key={label} className={styles.perfRow}>
            <span>{label}</span>
            <strong>{value}</strong>
            <em>{budget}</em>
          </div>
        ))}
      </div>
    </section>
  );
}
