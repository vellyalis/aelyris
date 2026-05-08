import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { type BackendPerformanceMetrics, MiB } from "../features/analytics/performanceObservatory";
import { usePerformanceObservatory } from "../features/analytics/usePerformanceObservatory";
import type { Invoke } from "../shared/hooks/useImageMetrics";

const backend: BackendPerformanceMetrics = {
  terminalId: null,
  activeTerminalCount: 0,
  paneCount: 0,
  visibleCols: null,
  visibleRows: null,
  scrollbackRows: 0,
  scrollbackEstimatedBytes: 0,
  inlineImageBytes: 0,
  inlineImageCap: 0,
  inlineImageCount: 0,
  ipcBatchMaxBytes: 64 * 1024,
  ipcBatchIntervalMs: 16,
  terminalJournalFlushBytes: 32 * 1024,
  terminalJournalFlushIntervalMs: 500,
  ipcLatencyMs: 12,
  lastTerminalSpawnMs: 650,
  lastTerminalStreamWireMs: 30,
  dbWriteLatencyMs: null,
  eventQueueLagMs: 75,
};

describe("usePerformanceObservatory", () => {
  it("samples dashboard update latency and process metrics when a dashboard state URL is supplied", async () => {
    const invoke = vi.fn(async () => backend) as unknown as Invoke;
    const fetchDashboardState = vi.fn(async () => ({
      processTree: [{ name: "codex-progress-server", workingSetMb: 128, cpu: 12.5 }],
    }));

    const { result } = renderHook(() =>
      usePerformanceObservatory({
        terminalId: null,
        paneCount: 2,
        rightRailMode: "observe",
        rightRailWidth: 320,
        dashboardStateUrl: "http://127.0.0.1:48371/state",
        pollIntervalMs: 10_000,
        invoke,
        fetchDashboardState,
      }),
    );

    await waitFor(() => expect(result.current.runtime.dashboardUpdateLatencyMs).not.toBeNull());

    expect(fetchDashboardState).toHaveBeenCalledWith("http://127.0.0.1:48371/state");
    expect(result.current.backend?.paneCount).toBe(2);
    expect(result.current.runtime.eventLoopLagMs).toBe(75);
    expect(result.current.runtime.dashboardProcessMemoryBytes).toBe(128 * MiB);
    expect(result.current.runtime.dashboardCpuPct).toBe(12.5);
  });

  it("discovers a local dashboard state URL from workspace configuration", async () => {
    localStorage.setItem("aether:dashboardStateUrl", "http://localhost:48371/state");
    const invoke = vi.fn(async () => backend) as unknown as Invoke;
    const fetchDashboardState = vi.fn(async () => ({
      health: {
        processTree: [{ processName: "codex-progress-server", memoryMb: 96, cpuPct: 8 }],
      },
    }));

    try {
      const { result } = renderHook(() =>
        usePerformanceObservatory({
          terminalId: null,
          paneCount: 1,
          rightRailMode: "observe",
          rightRailWidth: 320,
          pollIntervalMs: 10_000,
          invoke,
          fetchDashboardState,
        }),
      );

      await waitFor(() => expect(result.current.runtime.dashboardUpdateLatencyMs).not.toBeNull());

      expect(fetchDashboardState).toHaveBeenCalledWith("http://localhost:48371/state");
      expect(result.current.runtime.dashboardProcessMemoryBytes).toBe(96 * MiB);
      expect(result.current.runtime.dashboardCpuPct).toBe(8);
    } finally {
      localStorage.removeItem("aether:dashboardStateUrl");
    }
  });
});
