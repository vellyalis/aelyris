import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useContextStore } from "../shared/hooks/useContextStore";

const tauriMocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  listen: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: tauriMocks.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: tauriMocks.listen }));

describe("useContextStore", () => {
  beforeEach(() => {
    tauriMocks.invoke.mockReset();
    tauriMocks.listen.mockReset();
    tauriMocks.listen.mockResolvedValue(vi.fn());
  });

  it("hydrates from context_all on mount", async () => {
    tauriMocks.invoke.mockImplementation((cmd: string) =>
      cmd === "context_all" ? Promise.resolve({ auth_method: "jwt", database: "postgresql" }) : Promise.resolve(null),
    );
    const { result } = renderHook(() => useContextStore());
    await waitFor(() => {
      expect(result.current.decisions).toEqual({ auth_method: "jwt", database: "postgresql" });
    });
  });

  it("stays in sync with context-store-updated events", async () => {
    const ref: { current?: (payload: Record<string, string>) => void } = {};
    tauriMocks.listen.mockImplementation((event: string, cb: (e: { payload: Record<string, string> }) => void) => {
      if (event === "context-store-updated") ref.current = (payload) => cb({ payload });
      return Promise.resolve(vi.fn());
    });
    tauriMocks.invoke.mockResolvedValue({});

    const { result } = renderHook(() => useContextStore());
    await waitFor(() => expect(ref.current).toBeTypeOf("function"));

    act(() => ref.current?.({ framework: "nextjs" }));
    await waitFor(() => expect(result.current.decisions).toEqual({ framework: "nextjs" }));
  });

  it("setDecision invokes context_set and returns the change", async () => {
    tauriMocks.invoke.mockImplementation((cmd: string) =>
      cmd === "context_set" ? Promise.resolve({ key: "auth_method", value: "jwt" }) : Promise.resolve({}),
    );
    const { result } = renderHook(() => useContextStore());
    const change = await result.current.setDecision("auth_method", "jwt");
    expect(change).toEqual({ key: "auth_method", value: "jwt" });
    expect(tauriMocks.invoke).toHaveBeenCalledWith("context_set", { key: "auth_method", value: "jwt" });
  });

  it("returns null when a set fails", async () => {
    tauriMocks.invoke.mockImplementation((cmd: string) =>
      cmd === "context_set" ? Promise.reject(new Error("boom")) : Promise.resolve({}),
    );
    const { result } = renderHook(() => useContextStore());
    expect(await result.current.setDecision("k", "v")).toBeNull();
  });
});
