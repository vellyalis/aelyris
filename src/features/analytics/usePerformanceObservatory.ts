import { useEffect, useMemo, useRef, useState } from "react";

import { type Invoke, useImageMetrics } from "../../shared/hooks/useImageMetrics";
import { usePtyLag } from "../../shared/hooks/usePtyLag";
import {
  type BackendPerformanceMetrics,
  buildPerformanceObservatorySnapshot,
  type DashboardPerformanceProbe,
  type RuntimePerformanceMetrics,
  TERMINAL_PERFORMANCE_EVENT,
  type TerminalRenderSample,
} from "./performanceObservatory";

const DEFAULT_POLL_INTERVAL_MS = 1_000;

const defaultInvoke: Invoke = async (cmd, args) => {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke(cmd, args) as Promise<never>;
};

interface UsePerformanceObservatoryOptions {
  terminalId: string | null;
  paneCount: number;
  rightRailMode: string;
  rightRailWidth: number | null;
  dashboardStateUrl?: string | null;
  pollIntervalMs?: number;
  invoke?: Invoke;
  fetchDashboardState?: (url: string) => Promise<unknown>;
}

type PerformanceWithMemory = Performance & {
  memory?: {
    usedJSHeapSize?: number;
    jsHeapSizeLimit?: number;
  };
};

function now(): number {
  return typeof performance !== "undefined" && typeof performance.now === "function" ? performance.now() : Date.now();
}

function readHeapMemory(): { heapUsedBytes: number | null; heapLimitBytes: number | null } {
  if (typeof performance === "undefined") return { heapUsedBytes: null, heapLimitBytes: null };
  const memory = (performance as PerformanceWithMemory).memory;
  const heapUsedBytes = typeof memory?.usedJSHeapSize === "number" ? memory.usedJSHeapSize : null;
  const heapLimitBytes = typeof memory?.jsHeapSizeLimit === "number" ? memory.jsHeapSizeLimit : null;
  return { heapUsedBytes, heapLimitBytes };
}

function isLocalDashboardStateUrl(value: string | null | undefined): value is string {
  if (!value) return false;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return (url.protocol === "http:" || url.protocol === "https:") && (host === "127.0.0.1" || host === "localhost");
  } catch {
    return false;
  }
}

function readConfiguredDashboardStateUrl(): string | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  const fromQuery = params.get("aetherDashboardStateUrl") ?? params.get("dashboardStateUrl");
  if (isLocalDashboardStateUrl(fromQuery)) return fromQuery;
  try {
    const fromStorage = window.localStorage.getItem("aether:dashboardStateUrl");
    return isLocalDashboardStateUrl(fromStorage) ? fromStorage : null;
  } catch {
    return null;
  }
}

async function defaultFetchDashboardState(url: string): Promise<unknown> {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`dashboard state returned ${response.status}`);
  return response.json();
}

function readDashboardProbe(payload: unknown, latencyMs: number): DashboardPerformanceProbe {
  const state = typeof payload === "object" && payload !== null ? (payload as Record<string, unknown>) : {};
  const processTree = Array.isArray(state.processTree)
    ? state.processTree
    : typeof state.health === "object" &&
        state.health !== null &&
        Array.isArray((state.health as Record<string, unknown>).processTree)
      ? ((state.health as Record<string, unknown>).processTree as unknown[])
      : [];
  const dashboardProcess = processTree.find((row) => {
    if (typeof row !== "object" || row === null) return false;
    const record = row as Record<string, unknown>;
    const name = String(record.name ?? record.processName ?? "").toLowerCase();
    return name.includes("dashboard") || name.includes("codex-progress-server");
  });
  const record =
    typeof dashboardProcess === "object" && dashboardProcess !== null
      ? (dashboardProcess as Record<string, unknown>)
      : {};
  const workingSetMb = Number(record.workingSetMb ?? record.memoryMb ?? NaN);
  const cpuPct = Number(record.cpu ?? record.cpuPct ?? NaN);
  return {
    updateLatencyMs: latencyMs,
    processMemoryBytes: Number.isFinite(workingSetMb) ? Math.max(0, workingSetMb) * 1024 * 1024 : null,
    cpuPct: Number.isFinite(cpuPct) ? Math.max(0, cpuPct) : null,
  };
}

export function usePerformanceObservatory({
  terminalId,
  paneCount,
  rightRailMode,
  rightRailWidth,
  dashboardStateUrl,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
  invoke = defaultInvoke,
  fetchDashboardState = defaultFetchDashboardState,
}: UsePerformanceObservatoryOptions) {
  const imageMetrics = useImageMetrics(terminalId, { invoke, pollIntervalMs });
  const lag = usePtyLag(terminalId);
  const invokeRef = useRef(invoke);
  invokeRef.current = invoke;
  const resolvedDashboardStateUrl = useMemo(
    () => (dashboardStateUrl === undefined ? readConfiguredDashboardStateUrl() : dashboardStateUrl),
    [dashboardStateUrl],
  );

  const [renderSample, setRenderSample] = useState<TerminalRenderSample | null>(null);
  const [backend, setBackend] = useState<BackendPerformanceMetrics | null>(null);
  const [eventLoopLagMs, setEventLoopLagMs] = useState<number | null>(null);
  const [rightRailRenderMs, setRightRailRenderMs] = useState<number | null>(null);
  const rightRailMeasuredOnceRef = useRef(false);
  const [heapMemory, setHeapMemory] = useState(readHeapMemory);
  const [dashboardProbe, setDashboardProbe] = useState<DashboardPerformanceProbe>({
    updateLatencyMs: null,
    processMemoryBytes: null,
    cpuPct: null,
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onSample = (event: Event) => {
      const detail = (event as CustomEvent<TerminalRenderSample>).detail;
      if (!detail || detail.terminalId !== terminalId) return;
      setRenderSample(detail);
    };
    window.addEventListener(TERMINAL_PERFORMANCE_EVENT, onSample as EventListener);
    return () => window.removeEventListener(TERMINAL_PERFORMANCE_EVENT, onSample as EventListener);
  }, [terminalId]);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const poll = async () => {
      const startedAt = now();
      try {
        const result = await invokeRef.current<BackendPerformanceMetrics>("performance_observatory_metrics", {
          terminalId,
        });
        if (!cancelled) {
          setBackend({
            ...result,
            ipcLatencyMs: result.ipcLatencyMs ?? Math.max(0, now() - startedAt),
          });
        }
      } catch {
        if (!cancelled) setBackend(null);
      } finally {
        if (!cancelled) timer = setTimeout(poll, pollIntervalMs);
      }
    };

    void poll();
    return () => {
      cancelled = true;
      if (timer !== null) clearTimeout(timer);
    };
  }, [terminalId, pollIntervalMs]);

  useEffect(() => {
    if (!resolvedDashboardStateUrl) {
      setDashboardProbe({ updateLatencyMs: null, processMemoryBytes: null, cpuPct: null });
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const poll = async () => {
      const startedAt = now();
      try {
        const payload = await fetchDashboardState(resolvedDashboardStateUrl);
        if (!cancelled) setDashboardProbe(readDashboardProbe(payload, Math.max(0, now() - startedAt)));
      } catch {
        if (!cancelled) {
          setDashboardProbe((prev) => ({
            updateLatencyMs: prev.updateLatencyMs,
            processMemoryBytes: null,
            cpuPct: null,
          }));
        }
      } finally {
        if (!cancelled) timer = setTimeout(poll, pollIntervalMs);
      }
    };

    void poll();
    return () => {
      cancelled = true;
      if (timer !== null) clearTimeout(timer);
    };
  }, [fetchDashboardState, pollIntervalMs, resolvedDashboardStateUrl]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const intervalMs = Math.max(250, Math.min(2_000, pollIntervalMs));
    let expected = now() + intervalMs;
    const timer = window.setInterval(() => {
      const current = now();
      setEventLoopLagMs(Math.max(0, current - expected));
      expected = current + intervalMs;
      setHeapMemory(readHeapMemory());
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [pollIntervalMs]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!rightRailMeasuredOnceRef.current) {
      rightRailMeasuredOnceRef.current = true;
      setRightRailRenderMs(null);
      return;
    }
    const startedAt = now();
    const raf = window.requestAnimationFrame(() => {
      setRightRailRenderMs(Math.max(0, now() - startedAt));
    });
    return () => window.cancelAnimationFrame(raf);
  }, [rightRailMode, rightRailWidth]);

  const runtime = useMemo<RuntimePerformanceMetrics>(
    () => ({
      eventLoopLagMs,
      rightRailRenderMs,
      rightRailMode,
      rightRailWidth,
      dashboardUpdateLatencyMs: dashboardProbe.updateLatencyMs,
      heapUsedBytes: heapMemory.heapUsedBytes,
      heapLimitBytes: heapMemory.heapLimitBytes,
      rendererProcessMemoryBytes: heapMemory.heapUsedBytes,
      dashboardProcessMemoryBytes: dashboardProbe.processMemoryBytes,
      rendererCpuPct: null,
      dashboardCpuPct: dashboardProbe.cpuPct,
    }),
    [
      dashboardProbe.cpuPct,
      dashboardProbe.processMemoryBytes,
      dashboardProbe.updateLatencyMs,
      eventLoopLagMs,
      heapMemory.heapLimitBytes,
      heapMemory.heapUsedBytes,
      rightRailMode,
      rightRailRenderMs,
      rightRailWidth,
    ],
  );

  return useMemo(
    () =>
      buildPerformanceObservatorySnapshot({
        terminalId,
        renderSample,
        backend,
        runtime,
        ipcDroppedChunks: lag.dropped,
        imageMetrics,
        paneCount,
      }),
    [backend, imageMetrics, lag.dropped, paneCount, renderSample, runtime, terminalId],
  );
}
