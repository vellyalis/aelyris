import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useAiCliLaunchEvidence } from "../features/app/useAiCliLaunchEvidence";

type InvokeFn = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;

const invokeMock = vi.fn() as unknown as InvokeFn & { mock: ReturnType<typeof vi.fn>["mock"] };

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: Record<string, unknown>) => (invokeMock as unknown as InvokeFn)(cmd, args),
}));

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}

function artifactFor(path: string, tag: string): string {
  if (path.endsWith("real-ai-cli-binary-probe.json")) {
    return JSON.stringify({ ok: true, status: "pass", startedAt: tag, checks: {} });
  }
  return JSON.stringify({});
}

async function flushPromises(): Promise<void> {
  await act(async () => {
    for (let index = 0; index < 8; index += 1) await Promise.resolve();
  });
}

describe("useAiCliLaunchEvidence", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    (invokeMock as unknown as ReturnType<typeof vi.fn>).mockReset();
  });

  it("suppresses overlap and rejects completion from an old project or unmounted owner", async () => {
    const oldReads = Array.from({ length: 6 }, () => deferred<string>());
    const unmountReads = Array.from({ length: 6 }, () => deferred<string>());
    let oldReadIndex = 0;
    let unmountReadIndex = 0;
    let holdProjectB = false;
    (invokeMock as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (_cmd: string, args?: Record<string, unknown>) => {
        const path = String(args?.path);
        if (path.startsWith("C:\\project-a")) {
          const pending = oldReads[oldReadIndex];
          oldReadIndex += 1;
          if (!pending) throw new Error("unexpected extra project-a read");
          return pending.promise;
        }
        if (holdProjectB) {
          const pending = unmountReads[unmountReadIndex];
          unmountReadIndex += 1;
          if (!pending) throw new Error("unexpected extra project-b read");
          return pending.promise;
        }
        return Promise.resolve(artifactFor(path, "project-b"));
      },
    );

    const { result, rerender, unmount } = renderHook(
      ({ projectPath }: { projectPath: string }) => useAiCliLaunchEvidence(projectPath),
      { initialProps: { projectPath: "C:\\project-a" } },
    );
    await flushPromises();
    expect(invokeMock).toHaveBeenCalledTimes(6);

    act(() => {
      vi.advanceTimersByTime(120_000);
    });
    await flushPromises();
    expect(invokeMock).toHaveBeenCalledTimes(6);

    rerender({ projectPath: "C:\\project-b" });
    await flushPromises();
    expect(invokeMock).toHaveBeenCalledTimes(12);
    expect(result.current.evidence?.startedAt).toBe("project-b");

    await act(async () => {
      oldReads.forEach((pending, index) => {
        pending.resolve(
          artifactFor(
            [
              "real-ai-cli-binary-probe.json",
              "native-terminal-input-host.json",
              "verify-ime.json",
              "process-reconnect-command-evidence.json",
              "mux-live-process-preservation.json",
              "interactive-ai-cli-boundary.json",
            ][index] ?? "",
            "project-a",
          ),
        );
      });
      for (let index = 0; index < 8; index += 1) await Promise.resolve();
    });
    expect(result.current.evidence?.startedAt).toBe("project-b");

    holdProjectB = true;
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    await flushPromises();
    expect(invokeMock).toHaveBeenCalledTimes(18);
    unmount();
    await act(async () => {
      unmountReads.forEach((pending, index) => {
        pending.resolve(
          artifactFor(
            [
              "real-ai-cli-binary-probe.json",
              "native-terminal-input-host.json",
              "verify-ime.json",
              "process-reconnect-command-evidence.json",
              "mux-live-process-preservation.json",
              "interactive-ai-cli-boundary.json",
            ][index] ?? "",
            "after-unmount",
          ),
        );
      });
      for (let index = 0; index < 8; index += 1) await Promise.resolve();
    });
    expect(result.current.evidence?.startedAt).toBe("project-b");
    act(() => {
      vi.advanceTimersByTime(120_000);
    });
    await flushPromises();
    expect(invokeMock).toHaveBeenCalledTimes(18);
  });

  it("retains the existing partial preflight contract within one completed generation", async () => {
    (invokeMock as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (_cmd: string, args?: Record<string, unknown>) => {
        const path = String(args?.path);
        if (path.endsWith("native-terminal-input-host.json")) {
          return Promise.resolve(JSON.stringify({ status: "pass", checks: [] }));
        }
        return Promise.reject(new Error(`missing ${path}`));
      },
    );

    const { result, unmount } = renderHook(() => useAiCliLaunchEvidence("C:\\project"));
    await flushPromises();
    expect(result.current.evidence).toBeNull();
    expect(result.current.preflight).toEqual(
      expect.objectContaining({
        nativeInputHost: expect.objectContaining({ status: "pass" }),
      }),
    );
    unmount();
  });
});
