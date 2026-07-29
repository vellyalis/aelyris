import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useAuthenticatedPromptEvidence } from "../features/app/useAuthenticatedPromptEvidence";

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

function consent(provider: string): string {
  return JSON.stringify({
    ok: true,
    status: "pass",
    provider,
    wouldSpendTokens: true,
    checks: {},
  });
}

function matrix(): string {
  return JSON.stringify({
    ok: true,
    status: "pass",
    checks: { allProvidersReady: true },
    providerMatrix: [],
  });
}

async function flushPromises(): Promise<void> {
  await act(async () => {
    for (let index = 0; index < 8; index += 1) await Promise.resolve();
  });
}

describe("useAuthenticatedPromptEvidence", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    (invokeMock as unknown as ReturnType<typeof vi.fn>).mockReset();
  });

  it("suppresses overlap and rejects completion from an old project or unmounted owner", async () => {
    const oldReads = Array.from({ length: 2 }, () => deferred<string>());
    const unmountReads = Array.from({ length: 2 }, () => deferred<string>());
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
        return Promise.resolve(
          path.endsWith("authenticated-ai-cli-prompt-smoke.json") ? consent("project-b") : matrix(),
        );
      },
    );

    const { result, rerender, unmount } = renderHook(
      ({ projectPath }: { projectPath: string }) => useAuthenticatedPromptEvidence(projectPath),
      { initialProps: { projectPath: "C:\\project-a" } },
    );
    await flushPromises();
    expect(invokeMock).toHaveBeenCalledTimes(2);

    act(() => {
      vi.advanceTimersByTime(120_000);
    });
    await flushPromises();
    expect(invokeMock).toHaveBeenCalledTimes(2);

    rerender({ projectPath: "C:\\project-b" });
    await flushPromises();
    expect(invokeMock).toHaveBeenCalledTimes(4);
    expect(result.current.provider).toBe("project-b");

    await act(async () => {
      oldReads[0]?.resolve(consent("project-a"));
      oldReads[1]?.resolve(matrix());
      for (let index = 0; index < 8; index += 1) await Promise.resolve();
    });
    expect(result.current.provider).toBe("project-b");

    holdProjectB = true;
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    await flushPromises();
    expect(invokeMock).toHaveBeenCalledTimes(6);
    unmount();
    await act(async () => {
      unmountReads[0]?.resolve(consent("after-unmount"));
      unmountReads[1]?.resolve(matrix());
      for (let index = 0; index < 8; index += 1) await Promise.resolve();
    });
    expect(result.current.provider).toBe("project-b");
    act(() => {
      vi.advanceTimersByTime(120_000);
    });
    await flushPromises();
    expect(invokeMock).toHaveBeenCalledTimes(6);
  });
});
