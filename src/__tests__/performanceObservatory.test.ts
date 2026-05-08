import { describe, expect, it } from "vitest";

import {
  type BackendPerformanceMetrics,
  buildPerformanceObservatorySnapshot,
  createPerformanceDiagnosticBundle,
  estimateScrollbackMemoryBytes,
  PERFORMANCE_BUDGETS,
  type RuntimePerformanceMetrics,
  type TerminalRenderSample,
} from "../features/analytics/performanceObservatory";

const runtime: RuntimePerformanceMetrics = {
  eventLoopLagMs: 0,
  rightRailRenderMs: 12,
  rightRailMode: "observe",
  rightRailWidth: 320,
  dashboardUpdateLatencyMs: null,
  heapUsedBytes: 64 * 1024 * 1024,
  heapLimitBytes: 1024 * 1024 * 1024,
  rendererProcessMemoryBytes: 64 * 1024 * 1024,
  dashboardProcessMemoryBytes: null,
  rendererCpuPct: null,
  dashboardCpuPct: null,
};

const backend: BackendPerformanceMetrics = {
  terminalId: "term-1",
  activeTerminalCount: 2,
  paneCount: 2,
  visibleCols: 120,
  visibleRows: 32,
  scrollbackRows: 100,
  scrollbackEstimatedBytes: estimateScrollbackMemoryBytes(100, 120),
  inlineImageBytes: 0,
  inlineImageCap: 50 * 1024 * 1024,
  inlineImageCount: 0,
  ipcBatchMaxBytes: 64 * 1024,
  ipcBatchIntervalMs: 16,
  terminalJournalFlushBytes: 32 * 1024,
  terminalJournalFlushIntervalMs: 500,
  ipcLatencyMs: 12,
  lastTerminalSpawnMs: 650,
  lastTerminalStreamWireMs: 30,
  dbWriteLatencyMs: null,
  eventQueueLagMs: null,
};

function sample(overrides: Partial<TerminalRenderSample> = {}): TerminalRenderSample {
  return {
    terminalId: "term-1",
    sampledAt: 1,
    fps: 60,
    frameMs: 8,
    droppedRenderFrames: 0,
    renderer: "canvas2d",
    webglFallback: true,
    cols: 120,
    rows: 32,
    scrollbackRows: 100,
    scrollbackMemoryBytes: estimateScrollbackMemoryBytes(100, 120),
    ...overrides,
  };
}

describe("performance observatory", () => {
  it("estimates scrollback memory from rows and columns", () => {
    expect(estimateScrollbackMemoryBytes(100, 80)).toBe(128_000);
    expect(estimateScrollbackMemoryBytes(-1, 80)).toBe(0);
  });

  it("keeps nominal samples within budget", () => {
    const snapshot = buildPerformanceObservatorySnapshot({
      terminalId: "term-1",
      renderSample: sample(),
      backend,
      runtime,
      ipcDroppedChunks: 0,
      imageMetrics: null,
      paneCount: 2,
    });

    expect(snapshot.budgetWarnings).toEqual([]);
    expect(snapshot.terminal.renderer).toBe("canvas2d");
    expect(snapshot.terminal.webglFallback).toBe(true);
  });

  it("flags render, scrollback, IPC, event lag, right rail, and heap budget violations", () => {
    const snapshot = buildPerformanceObservatorySnapshot({
      terminalId: "term-1",
      renderSample: sample({
        fps: 28,
        frameMs: 52,
        droppedRenderFrames: 8,
        scrollbackRows: 50_000,
        scrollbackMemoryBytes: PERFORMANCE_BUDGETS.scrollbackMemoryWarnBytes * 3,
      }),
      backend: {
        ...backend,
        ipcLatencyMs: 240,
        lastTerminalSpawnMs: PERFORMANCE_BUDGETS.terminalSpawnMsMax * 3,
        lastTerminalStreamWireMs: PERFORMANCE_BUDGETS.terminalStreamWireMsMax * 5,
        dbWriteLatencyMs: 180,
      },
      runtime: {
        ...runtime,
        eventLoopLagMs: 180,
        rightRailRenderMs: 140,
        heapUsedBytes: PERFORMANCE_BUDGETS.heapUsedWarnBytes * 2,
        rendererProcessMemoryBytes: PERFORMANCE_BUDGETS.rendererProcessMemoryWarnBytes * 2,
        dashboardProcessMemoryBytes: PERFORMANCE_BUDGETS.dashboardProcessMemoryWarnBytes * 2,
        rendererCpuPct: 94,
        dashboardCpuPct: 84,
      },
      ipcDroppedChunks: 12,
      imageMetrics: null,
      paneCount: 2,
    });

    expect(snapshot.budgetWarnings.map((warning) => warning.id)).toEqual(
      expect.arrayContaining([
        "terminal-fps",
        "terminal-frame",
        "terminal-dropped-render",
        "scrollback-memory",
        "ipc-latency",
        "terminal-spawn",
        "terminal-stream-wire",
        "ipc-dropped",
        "event-loop-lag",
        "right-rail-render",
        "db-write",
        "renderer-memory",
        "renderer-process-memory",
        "dashboard-process-memory",
        "renderer-cpu",
        "dashboard-cpu",
      ]),
    );
    expect(snapshot.budgetWarnings.some((warning) => warning.severity === "critical")).toBe(true);
  });

  it("builds an exportable diagnostic bundle with summary counts", () => {
    const snapshot = buildPerformanceObservatorySnapshot({
      terminalId: "term-1",
      renderSample: sample({ fps: 20 }),
      backend,
      runtime,
      ipcDroppedChunks: 0,
      imageMetrics: null,
      paneCount: 2,
    });

    const bundle = createPerformanceDiagnosticBundle(snapshot);

    expect(bundle.kind).toBe("aether.performance.diagnostic");
    expect(bundle.summary.terminalId).toBe("term-1");
    expect(bundle.summary.warningCount).toBe(snapshot.budgetWarnings.length);
    expect(bundle.summary.criticalCount).toBe(1);
    expect(bundle.summary.webglFallback).toBe(true);
    expect(bundle.snapshot).toBe(snapshot);
  });

  it("treats backend event queue lag as runtime lag budget evidence", () => {
    const snapshot = buildPerformanceObservatorySnapshot({
      terminalId: "term-1",
      renderSample: sample(),
      backend: { ...backend, eventQueueLagMs: 125 },
      runtime: { ...runtime, eventLoopLagMs: null },
      ipcDroppedChunks: 0,
      imageMetrics: null,
      paneCount: 2,
    });

    expect(snapshot.runtime.eventLoopLagMs).toBe(125);
    expect(snapshot.budgetWarnings.map((warning) => warning.id)).toContain("event-loop-lag");
  });
});
