import { act, render, renderHook, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CostMeterPanel } from "../features/cost-meter/CostMeterPanel";
import { useCostManager } from "../shared/hooks/useCostManager";
import type { AgentSession } from "../shared/types/agent";
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

  it("renders reported usage beside configured caps without a cap-editing control", async () => {
    tauriMocks.invoke.mockImplementation((cmd: string) =>
      cmd === "cost_caps"
        ? Promise.resolve({ max_agents: 4, max_tokens: 20_000, max_cost_usd: 1, max_runtime_secs: null })
        : Promise.resolve(null),
    );
    const session: AgentSession = {
      id: "done",
      name: "Completed agent",
      status: "done",
      model: "claude-sonnet",
      prompt: "work",
      startedAt: Date.now() - 60_000,
      logs: [],
      cost: 0.5,
      tokensUsed: 12_000,
    };

    render(createElement(CostMeterPanel, { sessions: [session] }));

    expect(await screen.findByText("12k / 20k")).toBeTruthy();
    expect(screen.getByText("$0.50 / $1.00")).toBeTruthy();
    expect(screen.getByText("Reported fleet usage is within the configured caps.")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
