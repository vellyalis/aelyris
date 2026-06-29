import type { ImageMetrics } from "../../shared/types/terminal";

export const TERMINAL_PERFORMANCE_EVENT = "aelyris:terminal-performance-sample";

export const MiB = 1024 * 1024;

export const PERFORMANCE_BUDGETS = {
  terminalFpsMin: 45,
  terminalFrameMsMax: 24,
  droppedRenderFramesMax: 0,
  scrollbackMemoryWarnBytes: 16 * MiB,
  ipcLatencyMsMax: 80,
  terminalSpawnMsMax: 1_500,
  terminalStreamWireMsMax: 120,
  ipcDroppedChunksMax: 0,
  eventLoopLagMsMax: 50,
  rightRailRenderMsMax: 32,
  dashboardUpdateMsMax: 1_000,
  dbWriteLatencyMsMax: 50,
  heapUsedWarnBytes: 512 * MiB,
  rendererProcessMemoryWarnBytes: 768 * MiB,
  dashboardProcessMemoryWarnBytes: 384 * MiB,
  rendererCpuPctMax: 65,
  dashboardCpuPctMax: 35,
} as const;

export interface TerminalRenderSample {
  terminalId: string;
  sampledAt: number;
  fps: number | null;
  frameMs: number;
  droppedRenderFrames: number;
  renderer: "canvas2d" | "webgl";
  webglFallback: boolean;
  cols: number;
  rows: number;
  scrollbackRows: number;
  scrollbackMemoryBytes: number;
}

export interface BackendPerformanceMetrics {
  terminalId: string | null;
  activeTerminalCount: number;
  paneCount: number;
  visibleCols: number | null;
  visibleRows: number | null;
  scrollbackRows: number;
  scrollbackEstimatedBytes: number;
  inlineImageBytes: number;
  inlineImageCap: number;
  inlineImageCount: number;
  ipcBatchMaxBytes: number;
  ipcBatchIntervalMs: number;
  terminalJournalFlushBytes: number;
  terminalJournalFlushIntervalMs: number;
  ipcLatencyMs: number | null;
  lastTerminalSpawnMs: number | null;
  lastTerminalStreamWireMs: number | null;
  dbWriteLatencyMs: number | null;
  eventQueueLagMs: number | null;
}

export interface RuntimePerformanceMetrics {
  eventLoopLagMs: number | null;
  rightRailRenderMs: number | null;
  rightRailMode: string;
  rightRailWidth: number | null;
  dashboardUpdateLatencyMs: number | null;
  heapUsedBytes: number | null;
  heapLimitBytes: number | null;
  rendererProcessMemoryBytes: number | null;
  dashboardProcessMemoryBytes: number | null;
  rendererCpuPct: number | null;
  dashboardCpuPct: number | null;
}

export interface DashboardPerformanceProbe {
  updateLatencyMs: number | null;
  processMemoryBytes: number | null;
  cpuPct: number | null;
}

export interface PerformanceBudgetWarning {
  id: string;
  label: string;
  value: string;
  budget: string;
  severity: "warn" | "critical";
}

export interface PerformanceObservatorySnapshot {
  updatedAt: number;
  terminalId: string | null;
  terminal: {
    fps: number | null;
    frameMs: number | null;
    droppedRenderFrames: number;
    renderer: "canvas2d" | "webgl" | "unknown";
    webglFallback: boolean;
    cols: number | null;
    rows: number | null;
    scrollbackRows: number;
    scrollbackMemoryBytes: number;
    ipcDroppedChunks: number;
    imageMetrics: ImageMetrics | null;
  };
  backend: BackendPerformanceMetrics | null;
  runtime: RuntimePerformanceMetrics;
  budgets: typeof PERFORMANCE_BUDGETS;
  budgetWarnings: PerformanceBudgetWarning[];
}

export interface PerformanceDiagnosticBundle {
  kind: "aelyris.performance.diagnostic";
  generatedAt: string;
  summary: {
    terminalId: string | null;
    warningCount: number;
    criticalCount: number;
    renderer: string;
    webglFallback: boolean;
    paneCount: number;
  };
  snapshot: PerformanceObservatorySnapshot;
}

export function estimateScrollbackMemoryBytes(rows: number, cols: number, bytesPerCell = 16): number {
  if (!Number.isFinite(rows) || !Number.isFinite(cols) || !Number.isFinite(bytesPerCell)) return 0;
  return Math.max(0, Math.floor(rows)) * Math.max(0, Math.floor(cols)) * Math.max(1, Math.floor(bytesPerCell));
}

export function publishTerminalPerformanceSample(sample: TerminalRenderSample): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<TerminalRenderSample>(TERMINAL_PERFORMANCE_EVENT, { detail: sample }));
}

export function buildPerformanceObservatorySnapshot(input: {
  terminalId: string | null;
  renderSample: TerminalRenderSample | null;
  backend: BackendPerformanceMetrics | null;
  runtime: RuntimePerformanceMetrics;
  ipcDroppedChunks: number;
  imageMetrics: ImageMetrics | null;
  paneCount: number;
}): PerformanceObservatorySnapshot {
  const backend = input.backend;
  const sample = input.renderSample;
  const terminal = {
    fps: sample?.fps ?? null,
    frameMs: sample?.frameMs ?? null,
    droppedRenderFrames: sample?.droppedRenderFrames ?? 0,
    renderer: sample?.renderer ?? "unknown",
    webglFallback: sample?.webglFallback ?? false,
    cols: sample?.cols ?? backend?.visibleCols ?? null,
    rows: sample?.rows ?? backend?.visibleRows ?? null,
    scrollbackRows: sample?.scrollbackRows ?? backend?.scrollbackRows ?? 0,
    scrollbackMemoryBytes: sample?.scrollbackMemoryBytes ?? backend?.scrollbackEstimatedBytes ?? 0,
    ipcDroppedChunks: input.ipcDroppedChunks,
    imageMetrics: input.imageMetrics,
  } satisfies PerformanceObservatorySnapshot["terminal"];

  const withPaneFallback =
    backend && backend.paneCount === 0 && input.paneCount > 0 ? { ...backend, paneCount: input.paneCount } : backend;
  const runtime: RuntimePerformanceMetrics = {
    ...input.runtime,
    eventLoopLagMs: maxNullable(input.runtime.eventLoopLagMs, backend?.eventQueueLagMs ?? null),
  };
  const snapshot: PerformanceObservatorySnapshot = {
    updatedAt: Date.now(),
    terminalId: input.terminalId,
    terminal,
    backend: withPaneFallback,
    runtime,
    budgets: PERFORMANCE_BUDGETS,
    budgetWarnings: [],
  };
  snapshot.budgetWarnings = classifyPerformanceBudgets(snapshot);
  return snapshot;
}

export function classifyPerformanceBudgets(snapshot: PerformanceObservatorySnapshot): PerformanceBudgetWarning[] {
  const warnings: PerformanceBudgetWarning[] = [];
  const b = snapshot.budgets;
  const t = snapshot.terminal;
  const r = snapshot.runtime;
  const backend = snapshot.backend;

  if (t.fps !== null && t.fps < b.terminalFpsMin) {
    warnings.push({
      id: "terminal-fps",
      label: "Terminal FPS",
      value: `${Math.round(t.fps)} fps`,
      budget: `>= ${b.terminalFpsMin} fps`,
      severity: t.fps < 30 ? "critical" : "warn",
    });
  }
  if (t.frameMs !== null && t.frameMs > b.terminalFrameMsMax) {
    warnings.push({
      id: "terminal-frame",
      label: "Frame time",
      value: formatMs(t.frameMs),
      budget: `<= ${b.terminalFrameMsMax} ms`,
      severity: t.frameMs > 50 ? "critical" : "warn",
    });
  }
  if (t.droppedRenderFrames > b.droppedRenderFramesMax) {
    warnings.push({
      id: "terminal-dropped-render",
      label: "Dropped render frames",
      value: String(t.droppedRenderFrames),
      budget: String(b.droppedRenderFramesMax),
      severity: t.droppedRenderFrames > 5 ? "critical" : "warn",
    });
  }
  if (t.scrollbackMemoryBytes > b.scrollbackMemoryWarnBytes) {
    warnings.push({
      id: "scrollback-memory",
      label: "Scrollback memory",
      value: formatBytes(t.scrollbackMemoryBytes),
      budget: `<= ${formatBytes(b.scrollbackMemoryWarnBytes)}`,
      severity: t.scrollbackMemoryBytes > b.scrollbackMemoryWarnBytes * 2 ? "critical" : "warn",
    });
  }
  if ((backend?.ipcLatencyMs ?? null) !== null && (backend?.ipcLatencyMs ?? 0) > b.ipcLatencyMsMax) {
    warnings.push({
      id: "ipc-latency",
      label: "IPC latency",
      value: formatMs(backend?.ipcLatencyMs ?? 0),
      budget: `<= ${b.ipcLatencyMsMax} ms`,
      severity: (backend?.ipcLatencyMs ?? 0) > 200 ? "critical" : "warn",
    });
  }
  if ((backend?.lastTerminalSpawnMs ?? null) !== null && (backend?.lastTerminalSpawnMs ?? 0) > b.terminalSpawnMsMax) {
    warnings.push({
      id: "terminal-spawn",
      label: "Terminal spawn",
      value: formatMs(backend?.lastTerminalSpawnMs ?? 0),
      budget: `<= ${b.terminalSpawnMsMax} ms`,
      severity: (backend?.lastTerminalSpawnMs ?? 0) > b.terminalSpawnMsMax * 2 ? "critical" : "warn",
    });
  }
  if (
    (backend?.lastTerminalStreamWireMs ?? null) !== null &&
    (backend?.lastTerminalStreamWireMs ?? 0) > b.terminalStreamWireMsMax
  ) {
    warnings.push({
      id: "terminal-stream-wire",
      label: "Terminal stream wire",
      value: formatMs(backend?.lastTerminalStreamWireMs ?? 0),
      budget: `<= ${b.terminalStreamWireMsMax} ms`,
      severity: (backend?.lastTerminalStreamWireMs ?? 0) > b.terminalStreamWireMsMax * 4 ? "critical" : "warn",
    });
  }
  if (t.ipcDroppedChunks > b.ipcDroppedChunksMax) {
    warnings.push({
      id: "ipc-dropped",
      label: "IPC dropped chunks",
      value: String(t.ipcDroppedChunks),
      budget: String(b.ipcDroppedChunksMax),
      severity: t.ipcDroppedChunks > 100 ? "critical" : "warn",
    });
  }
  if (r.eventLoopLagMs !== null && r.eventLoopLagMs > b.eventLoopLagMsMax) {
    warnings.push({
      id: "event-loop-lag",
      label: "Event queue lag",
      value: formatMs(r.eventLoopLagMs),
      budget: `<= ${b.eventLoopLagMsMax} ms`,
      severity: r.eventLoopLagMs > 150 ? "critical" : "warn",
    });
  }
  if (r.rightRailRenderMs !== null && r.rightRailRenderMs > b.rightRailRenderMsMax) {
    warnings.push({
      id: "right-rail-render",
      label: "Right rail render",
      value: formatMs(r.rightRailRenderMs),
      budget: `<= ${b.rightRailRenderMsMax} ms`,
      severity: r.rightRailRenderMs > 100 ? "critical" : "warn",
    });
  }
  if (r.dashboardUpdateLatencyMs !== null && r.dashboardUpdateLatencyMs > b.dashboardUpdateMsMax) {
    warnings.push({
      id: "dashboard-update",
      label: "Dashboard update",
      value: formatMs(r.dashboardUpdateLatencyMs),
      budget: `<= ${b.dashboardUpdateMsMax} ms`,
      severity: r.dashboardUpdateLatencyMs > b.dashboardUpdateMsMax * 2 ? "critical" : "warn",
    });
  }
  if (backend?.dbWriteLatencyMs !== null && backend?.dbWriteLatencyMs !== undefined) {
    if (backend.dbWriteLatencyMs > b.dbWriteLatencyMsMax) {
      warnings.push({
        id: "db-write",
        label: "DB write latency",
        value: formatMs(backend.dbWriteLatencyMs),
        budget: `<= ${b.dbWriteLatencyMsMax} ms`,
        severity: backend.dbWriteLatencyMs > 150 ? "critical" : "warn",
      });
    }
  }
  if (r.heapUsedBytes !== null && r.heapUsedBytes > b.heapUsedWarnBytes) {
    warnings.push({
      id: "renderer-memory",
      label: "Renderer memory",
      value: formatBytes(r.heapUsedBytes),
      budget: `<= ${formatBytes(b.heapUsedWarnBytes)}`,
      severity: r.heapUsedBytes > b.heapUsedWarnBytes * 1.5 ? "critical" : "warn",
    });
  }
  if (r.rendererProcessMemoryBytes !== null && r.rendererProcessMemoryBytes > b.rendererProcessMemoryWarnBytes) {
    warnings.push({
      id: "renderer-process-memory",
      label: "Renderer process memory",
      value: formatBytes(r.rendererProcessMemoryBytes),
      budget: `<= ${formatBytes(b.rendererProcessMemoryWarnBytes)}`,
      severity: r.rendererProcessMemoryBytes > b.rendererProcessMemoryWarnBytes * 1.5 ? "critical" : "warn",
    });
  }
  if (r.dashboardProcessMemoryBytes !== null && r.dashboardProcessMemoryBytes > b.dashboardProcessMemoryWarnBytes) {
    warnings.push({
      id: "dashboard-process-memory",
      label: "Dashboard process memory",
      value: formatBytes(r.dashboardProcessMemoryBytes),
      budget: `<= ${formatBytes(b.dashboardProcessMemoryWarnBytes)}`,
      severity: r.dashboardProcessMemoryBytes > b.dashboardProcessMemoryWarnBytes * 1.5 ? "critical" : "warn",
    });
  }
  if (r.rendererCpuPct !== null && r.rendererCpuPct > b.rendererCpuPctMax) {
    warnings.push({
      id: "renderer-cpu",
      label: "Renderer CPU",
      value: `${Math.round(r.rendererCpuPct)}%`,
      budget: `<= ${b.rendererCpuPctMax}%`,
      severity: r.rendererCpuPct > 90 ? "critical" : "warn",
    });
  }
  if (r.dashboardCpuPct !== null && r.dashboardCpuPct > b.dashboardCpuPctMax) {
    warnings.push({
      id: "dashboard-cpu",
      label: "Dashboard CPU",
      value: `${Math.round(r.dashboardCpuPct)}%`,
      budget: `<= ${b.dashboardCpuPctMax}%`,
      severity: r.dashboardCpuPct > 80 ? "critical" : "warn",
    });
  }

  return warnings;
}

function maxNullable(left: number | null, right: number | null): number | null {
  if (left === null) return right;
  if (right === null) return left;
  return Math.max(left, right);
}

export function createPerformanceDiagnosticBundle(
  snapshot: PerformanceObservatorySnapshot,
): PerformanceDiagnosticBundle {
  return {
    kind: "aelyris.performance.diagnostic",
    generatedAt: new Date(snapshot.updatedAt).toISOString(),
    summary: {
      terminalId: snapshot.terminalId,
      warningCount: snapshot.budgetWarnings.length,
      criticalCount: snapshot.budgetWarnings.filter((warning) => warning.severity === "critical").length,
      renderer: snapshot.terminal.renderer,
      webglFallback: snapshot.terminal.webglFallback,
      paneCount: snapshot.backend?.paneCount ?? 0,
    },
    snapshot,
  };
}

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes)) return "n/a";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < MiB) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / MiB).toFixed(1)} MiB`;
}

export function formatMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return "n/a";
  return ms < 10 ? `${ms.toFixed(1)} ms` : `${Math.round(ms)} ms`;
}

export function formatFps(fps: number | null | undefined): string {
  if (fps === null || fps === undefined || !Number.isFinite(fps)) return "n/a";
  return `${Math.round(fps)} fps`;
}
