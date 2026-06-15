import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useCostManager } from "../shared/hooks/useCostManager";
import type { CostCaps } from "../shared/types/cost";

const tauriMocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  listen: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: tauriMocks.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: tauriMocks.listen }));

const CAPS: CostCaps = { max_agents: 4, max_tokens: null, max_cost_usd: null, max_runtime_secs: null };

describe("useCostManager", () => {
  beforeEach(() => {
    tauriMocks.invoke.mockReset();
    tauriMocks.listen.mockReset();
    tauriMocks.listen.mockResolvedValue(vi.fn());
  });

  it("hydrates caps from cost_caps", async () => {
    tauriMocks.invoke.mockImplementation((cmd: string) => (cmd === "cost_caps" ? Promise.resolve(CAPS) : Promise.resolve(null)));
    const { result } = renderHook(() => useCostManager());
    await waitFor(() => expect(result.current.caps).toEqual(CAPS));
  });

  it("syncs caps on cost-caps-updated", async () => {
    const ref: { current?: (payload: CostCaps) => void } = {};
    tauriMocks.listen.mockImplementation((name: string, cb: (e: { payload: CostCaps }) => void) => {
      if (name === "cost-caps-updated") ref.current = (payload) => cb({ payload });
      return Promise.resolve(vi.fn());
    });
    tauriMocks.invoke.mockResolvedValue(CAPS);

    const { result } = renderHook(() => useCostManager());
    await waitFor(() => expect(ref.current).toBeTypeOf("function"));

    act(() => ref.current?.({ ...CAPS, max_agents: 8 }));
    await waitFor(() => expect(result.current.caps?.max_agents).toBe(8));
  });

  it("canSpawn invokes cost_can_spawn with the usage and returns the decision", async () => {
    tauriMocks.invoke.mockImplementation((cmd: string) =>
      cmd === "cost_can_spawn" ? Promise.resolve({ allowed: false, blocked_by: "agents" }) : Promise.resolve(CAPS),
    );
    const { result } = renderHook(() => useCostManager());
    const usage = { active_agents: 4, tokens_used: 0, cost_usd: 0, runtime_secs: 0 };
    const decision = await result.current.canSpawn(usage);
    expect(decision).toMatchObject({ allowed: false, blocked_by: "agents" });
    expect(tauriMocks.invoke).toHaveBeenCalledWith("cost_can_spawn", { usage });
  });

  it("updateCaps invokes cost_set_caps", async () => {
    tauriMocks.invoke.mockImplementation((cmd: string) =>
      cmd === "cost_set_caps" ? Promise.resolve({ ...CAPS, max_agents: 6 }) : Promise.resolve(CAPS),
    );
    const { result } = renderHook(() => useCostManager());
    const next = { ...CAPS, max_agents: 6 };
    const updated = await result.current.updateCaps(next);
    expect(updated?.max_agents).toBe(6);
    expect(tauriMocks.invoke).toHaveBeenCalledWith("cost_set_caps", { caps: next });
  });
});
