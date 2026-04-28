import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useGitStatus } from "../shared/hooks/useGitStatus";

type InvokeFn = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
type ListenHandler<T> = (event: { payload: T }) => void;

const invokeMock = vi.fn() as unknown as InvokeFn & { mock: ReturnType<typeof vi.fn>["mock"] };
const order: string[] = [];

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: Record<string, unknown>) => (invokeMock as unknown as InvokeFn)(cmd, args),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: (_evt: string, _handler: ListenHandler<unknown>) => {
    order.push("listen");
    return Promise.resolve(() => {});
  },
}));

describe("useGitStatus", () => {
  beforeEach(() => {
    (invokeMock as unknown as ReturnType<typeof vi.fn>).mockReset();
    order.length = 0;
    (invokeMock as unknown as ReturnType<typeof vi.fn>).mockImplementation((cmd) => {
      if (cmd === "git_status") {
        return Promise.resolve({ branch: "main", is_dirty: false, changed_files: [] });
      }
      if (cmd === "start_fs_watcher") {
        order.push("start");
        return Promise.resolve(undefined);
      }
      if (cmd === "stop_fs_watcher") {
        order.push("stop");
        return Promise.resolve(undefined);
      }
      return Promise.reject(new Error(`unexpected ${cmd}`));
    });
  });

  it("arms fs:changed listener before starting the watcher", async () => {
    renderHook(() => useGitStatus("C:/repo"));

    await waitFor(() => expect(order).toContain("start"));
    expect(order.indexOf("listen")).toBeGreaterThanOrEqual(0);
    expect(order.indexOf("listen")).toBeLessThan(order.indexOf("start"));
  });
});
