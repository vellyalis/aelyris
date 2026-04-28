import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useFileList } from "../features/quick-open/useFileList";

type InvokeFn = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
type ListenHandler<T> = (event: { payload: T }) => void;

const invokeMock = vi.fn() as unknown as InvokeFn & { mock: ReturnType<typeof vi.fn>["mock"] };
const listenMock = vi.fn();
const listeners: Record<string, ListenHandler<unknown>> = {};
const unlistenMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: Record<string, unknown>) => (invokeMock as unknown as InvokeFn)(cmd, args),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: (evt: string, handler: ListenHandler<unknown>) => {
    listenMock(evt, handler);
    listeners[evt] = handler;
    return Promise.resolve(unlistenMock);
  },
}));

function deferred<T>() {
  let resolveFn: ((value: T) => void) | undefined;
  const promise = new Promise<T>((res) => {
    resolveFn = res;
  });
  return {
    promise,
    resolve: (value: T) => {
      if (!resolveFn) throw new Error("deferred resolver missing");
      resolveFn(value);
    },
  };
}

describe("useFileList", () => {
  beforeEach(() => {
    (invokeMock as unknown as ReturnType<typeof vi.fn>).mockReset();
    listenMock.mockReset();
    unlistenMock.mockReset();
    for (const key of Object.keys(listeners)) delete listeners[key];
  });

  it("ignores stale list_all_files responses from a previous project", async () => {
    const first = deferred<Array<{ relative_path: string; size: number }>>();
    const second = deferred<Array<{ relative_path: string; size: number }>>();
    (invokeMock as unknown as ReturnType<typeof vi.fn>).mockImplementation((_cmd, args) => {
      return (args?.rootPath === "C:/repo-a" ? first.promise : second.promise) as Promise<unknown>;
    });

    const { result, rerender } = renderHook(({ projectPath }) => useFileList(projectPath), {
      initialProps: { projectPath: "C:/repo-a" },
    });
    rerender({ projectPath: "C:/repo-b" });

    await act(async () => {
      second.resolve([{ relative_path: "b.ts", size: 1 }]);
      await Promise.resolve();
    });
    await waitFor(() => expect(result.current.files).toEqual(["b.ts"]));

    await act(async () => {
      first.resolve([{ relative_path: "a.ts", size: 1 }]);
      await Promise.resolve();
    });

    expect(result.current.files).toEqual(["b.ts"]);
  });
});
