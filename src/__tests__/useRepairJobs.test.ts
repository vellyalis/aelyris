import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useRepairJobs } from "../shared/hooks/useRepairJobs";
import { useToastStore } from "../shared/store/toastStore";

type InvokeFn = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
type ListenHandler<T> = (event: { payload: T }) => void;

const invokeMock = vi.fn() as unknown as InvokeFn & { mock: ReturnType<typeof vi.fn>["mock"] };
const listeners: Record<string, ListenHandler<unknown>> = {};
const unlistenMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: Record<string, unknown>) =>
    (invokeMock as unknown as InvokeFn)(cmd, args),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn((evt: string, handler: ListenHandler<unknown>) => {
    listeners[evt] = handler;
    return Promise.resolve(unlistenMock);
  }),
}));

async function flushMicrotasks() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("useRepairJobs", () => {
  beforeEach(() => {
    (invokeMock as unknown as ReturnType<typeof vi.fn>).mockReset();
    unlistenMock.mockReset();
    for (const k of Object.keys(listeners)) delete listeners[k];
    useToastStore.setState({ toasts: [] });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("hydrates initial jobs and config from IPC", async () => {
    (invokeMock as unknown as ReturnType<typeof vi.fn>).mockImplementation((cmd) => {
      if (cmd === "list_repair_jobs") {
        return Promise.resolve([
          {
            id: "repair-1",
            phase: { kind: "runningAgent" },
            branch: "fix/auto-abc",
            errorLine: "error: bang",
            elapsedSecs: 12,
          },
        ]);
      }
      if (cmd === "get_auto_repair_config") {
        return Promise.resolve({ enabled: true, pattern: "error:" });
      }
      return Promise.reject(new Error(`unexpected ${cmd}`));
    });

    const { result } = renderHook(() => useRepairJobs());
    await waitFor(() => expect(result.current.jobs).toHaveLength(1));
    expect(result.current.jobs[0].id).toBe("repair-1");
    expect(result.current.config.enabled).toBe(true);
    expect(result.current.activeCount).toBe(1);
  });

  it("applies repair:jobs-updated events", async () => {
    (invokeMock as unknown as ReturnType<typeof vi.fn>).mockImplementation((cmd) => {
      if (cmd === "list_repair_jobs") return Promise.resolve([]);
      if (cmd === "get_auto_repair_config")
        return Promise.resolve({ enabled: false, pattern: "x" });
      return Promise.reject(new Error(`unexpected ${cmd}`));
    });

    const { result } = renderHook(() => useRepairJobs());
    await waitFor(() => expect(result.current.config.pattern).toBe("x"));
    await flushMicrotasks();

    await act(async () => {
      listeners["repair:jobs-updated"]?.({
        payload: [
          {
            id: "r-2",
            phase: { kind: "succeeded" },
            branch: "fix/auto-x",
            errorLine: "err",
            elapsedSecs: 5,
          },
        ],
      });
    });
    expect(result.current.jobs).toHaveLength(1);
    expect(result.current.activeCount).toBe(0);
  });

  it("pushes a success toast on notification", async () => {
    (invokeMock as unknown as ReturnType<typeof vi.fn>).mockImplementation((cmd) => {
      if (cmd === "list_repair_jobs") return Promise.resolve([]);
      if (cmd === "get_auto_repair_config")
        return Promise.resolve({ enabled: false, pattern: "e" });
      return Promise.reject(new Error(`unexpected ${cmd}`));
    });
    renderHook(() => useRepairJobs());
    await flushMicrotasks();
    await flushMicrotasks();

    await act(async () => {
      listeners["repair:notification"]?.({
        payload: { job_id: "r-1", message: "Fixed!", is_success: true },
      });
    });
    const toasts = useToastStore.getState().toasts;
    const last = toasts[toasts.length - 1];
    expect(last?.type).toBe("success");
    expect(last?.description).toBe("Fixed!");
  });

  it("pushes an error toast on failed notification", async () => {
    (invokeMock as unknown as ReturnType<typeof vi.fn>).mockImplementation((cmd) => {
      if (cmd === "list_repair_jobs") return Promise.resolve([]);
      if (cmd === "get_auto_repair_config")
        return Promise.resolve({ enabled: false, pattern: "e" });
      return Promise.reject(new Error(`unexpected ${cmd}`));
    });
    renderHook(() => useRepairJobs());
    await flushMicrotasks();
    await flushMicrotasks();

    await act(async () => {
      listeners["repair:notification"]?.({
        payload: { job_id: "r-1", message: "tests red", is_success: false },
      });
    });
    const toasts = useToastStore.getState().toasts;
    expect(toasts[toasts.length - 1]?.type).toBe("error");
  });

  it("sends set_auto_repair_config when toggling", async () => {
    (invokeMock as unknown as ReturnType<typeof vi.fn>).mockImplementation((cmd) => {
      if (cmd === "list_repair_jobs") return Promise.resolve([]);
      if (cmd === "get_auto_repair_config")
        return Promise.resolve({ enabled: false, pattern: "p" });
      if (cmd === "set_auto_repair_config")
        return Promise.resolve({ enabled: true, pattern: "p" });
      return Promise.reject(new Error(`unexpected ${cmd}`));
    });

    const { result } = renderHook(() => useRepairJobs());
    await waitFor(() => expect(result.current.config.pattern).toBe("p"));
    await act(async () => {
      await result.current.setEnabled(true);
    });
    expect(result.current.config.enabled).toBe(true);
    expect(
      (invokeMock as unknown as ReturnType<typeof vi.fn>).mock.calls.some(
        (c) => c[0] === "set_auto_repair_config" && (c[1] as { enabled?: boolean })?.enabled === true,
      ),
    ).toBe(true);
  });
});
