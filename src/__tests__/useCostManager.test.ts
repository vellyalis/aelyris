import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CostMeterPanel } from "../features/cost-meter/CostMeterPanel";
import { useCostManager } from "../shared/hooks/useCostManager";
import type { AgentSession } from "../shared/types/agent";
import type { CostCaps, CostCapsPolicy } from "../shared/types/cost";

const tauriMocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  listen: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: tauriMocks.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: tauriMocks.listen }));

const CAPS: CostCaps = { max_agents: 4, max_tokens: null, max_cost_usd: null, max_runtime_secs: null };
const POLICY: CostCapsPolicy = { min_agents: 1, max_agents: 32 };

function hydrationResult(command: string): Promise<unknown> {
  if (command === "cost_caps") return Promise.resolve(CAPS);
  if (command === "cost_caps_policy") return Promise.resolve(POLICY);
  return Promise.resolve(null);
}

function session(overrides: Partial<AgentSession> = {}): AgentSession {
  return {
    id: "agent-1",
    name: "Agent 1",
    status: "coding",
    model: "claude-sonnet",
    prompt: "work",
    startedAt: Date.now() - 60_000,
    logs: [],
    cost: 0.5,
    tokensUsed: 12_000,
    ...overrides,
  };
}

function installPanelMocks({
  initialCaps = { max_agents: 4, max_tokens: 20_000, max_cost_usd: 1, max_runtime_secs: null },
  setCaps,
}: {
  initialCaps?: CostCaps;
  setCaps?: (caps: CostCaps) => Promise<CostCaps>;
} = {}) {
  const listener: { current?: (payload: CostCaps) => void } = {};
  tauriMocks.listen.mockImplementation((name: string, callback: (event: { payload: CostCaps }) => void) => {
    if (name === "cost-caps-updated") listener.current = (payload) => callback({ payload });
    return Promise.resolve(vi.fn());
  });
  tauriMocks.invoke.mockImplementation((command: string, args?: { caps?: CostCaps }) => {
    if (command === "cost_caps") return Promise.resolve(initialCaps);
    if (command === "cost_caps_policy") return Promise.resolve(POLICY);
    if (command === "cost_set_caps") {
      const candidate = args?.caps ?? initialCaps;
      return setCaps ? setCaps(candidate) : Promise.resolve(candidate);
    }
    return Promise.resolve(null);
  });
  return { listener, initialCaps };
}

async function openCapEditor() {
  fireEvent.click(await screen.findByText("Edit caps"));
  await screen.findByRole("form", { name: "Fleet cap editor" });
}

describe("useCostManager", () => {
  beforeEach(() => {
    tauriMocks.invoke.mockReset();
    tauriMocks.listen.mockReset();
    tauriMocks.listen.mockResolvedValue(vi.fn());
  });

  it("hydrates caps from cost_caps", async () => {
    tauriMocks.invoke.mockImplementation(hydrationResult);
    const { result } = renderHook(() => useCostManager());
    await waitFor(() => expect(result.current.caps).toEqual(CAPS));
    expect(result.current.policy).toEqual(POLICY);
  });

  it("syncs caps on cost-caps-updated", async () => {
    const ref: { current?: (payload: CostCaps) => void } = {};
    tauriMocks.listen.mockImplementation((name: string, cb: (e: { payload: CostCaps }) => void) => {
      if (name === "cost-caps-updated") ref.current = (payload) => cb({ payload });
      return Promise.resolve(vi.fn());
    });
    tauriMocks.invoke.mockImplementation(hydrationResult);

    const { result } = renderHook(() => useCostManager());
    await waitFor(() => expect(ref.current).toBeTypeOf("function"));

    act(() => ref.current?.({ ...CAPS, max_agents: 8 }));
    await waitFor(() => expect(result.current.caps?.max_agents).toBe(8));
  });

  it("canSpawn invokes cost_can_spawn with the usage and returns the decision", async () => {
    tauriMocks.invoke.mockImplementation((cmd: string) => {
      if (cmd === "cost_can_spawn") return Promise.resolve({ allowed: false, blocked_by: "agents" });
      return hydrationResult(cmd);
    });
    const { result } = renderHook(() => useCostManager());
    const usage = { active_agents: 4, tokens_used: 0, cost_usd: 0, runtime_secs: 0 };
    let decision: Awaited<ReturnType<typeof result.current.canSpawn>> = null;
    await act(async () => {
      decision = await result.current.canSpawn(usage);
    });
    expect(decision).toMatchObject({ allowed: false, blocked_by: "agents" });
    expect(tauriMocks.invoke).toHaveBeenCalledWith("cost_can_spawn", { usage });
  });

  it("updateCaps invokes cost_set_caps", async () => {
    tauriMocks.invoke.mockImplementation((cmd: string) => {
      if (cmd === "cost_set_caps") return Promise.resolve({ ...CAPS, max_agents: 6 });
      return hydrationResult(cmd);
    });
    const { result } = renderHook(() => useCostManager());
    const next = { ...CAPS, max_agents: 6 };
    let updated: CostCaps = CAPS;
    await act(async () => {
      updated = await result.current.updateCaps(next);
    });
    expect(updated.max_agents).toBe(6);
    expect(tauriMocks.invoke).toHaveBeenCalledWith("cost_set_caps", { caps: next });
    expect(result.current.caps?.max_agents).toBe(6);
  });

  it("rethrows backend validation errors so an editor can preserve its dirty draft", async () => {
    const error = { code: "invalid_cost_caps", field: "max_agents", message: "must be between 1 and 32" };
    tauriMocks.invoke.mockImplementation((cmd: string) => {
      if (cmd === "cost_set_caps") return Promise.reject(error);
      return hydrationResult(cmd);
    });
    const { result } = renderHook(() => useCostManager());
    await waitFor(() => expect(result.current.policy).toEqual(POLICY));

    await expect(result.current.updateCaps({ ...CAPS, max_agents: 0 })).rejects.toEqual(error);
    expect(result.current.caps).toEqual(CAPS);
  });

  it("does not let stale initial hydration overwrite a newer saved cap set", async () => {
    let resolveInitialCaps: (caps: CostCaps) => void = () => {};
    const initialCaps = new Promise<CostCaps>((resolve) => {
      resolveInitialCaps = resolve;
    });
    tauriMocks.invoke.mockImplementation((command: string) => {
      if (command === "cost_caps") return initialCaps;
      if (command === "cost_caps_policy") return Promise.resolve(POLICY);
      if (command === "cost_set_caps") return Promise.resolve({ ...CAPS, max_agents: 6 });
      return Promise.resolve(null);
    });

    const { result } = renderHook(() => useCostManager());
    await waitFor(() => expect(result.current.policy).toEqual(POLICY));
    await act(async () => {
      await result.current.updateCaps({ ...CAPS, max_agents: 6 });
    });
    expect(result.current.caps?.max_agents).toBe(6);

    await act(async () => {
      resolveInitialCaps(CAPS);
      await initialCaps;
    });
    expect(result.current.caps?.max_agents).toBe(6);
  });

  it("does not let stale initial hydration overwrite a newer push event", async () => {
    const listener: { current?: (payload: CostCaps) => void } = {};
    let resolveInitialCaps: (caps: CostCaps) => void = () => {};
    const initialCaps = new Promise<CostCaps>((resolve) => {
      resolveInitialCaps = resolve;
    });
    tauriMocks.listen.mockImplementation((name: string, callback: (event: { payload: CostCaps }) => void) => {
      if (name === "cost-caps-updated") listener.current = (payload) => callback({ payload });
      return Promise.resolve(vi.fn());
    });
    tauriMocks.invoke.mockImplementation((command: string) => {
      if (command === "cost_caps") return initialCaps;
      if (command === "cost_caps_policy") return Promise.resolve(POLICY);
      return Promise.resolve(null);
    });

    const { result } = renderHook(() => useCostManager());
    await waitFor(() => expect(listener.current).toBeTypeOf("function"));
    act(() => listener.current?.({ ...CAPS, max_agents: 8 }));
    await waitFor(() => expect(result.current.caps?.max_agents).toBe(8));

    await act(async () => {
      resolveInitialCaps(CAPS);
      await initialCaps;
    });
    expect(result.current.caps?.max_agents).toBe(8);
  });

  it("requires an explicit save before changing runtime caps", async () => {
    installPanelMocks();
    render(createElement(CostMeterPanel, { sessions: [session({ status: "done" })] }));

    expect(await screen.findByText("12k / 20k")).toBeTruthy();
    expect(screen.getByText("$0.50 / $1.00")).toBeTruthy();
    expect(screen.getByText("Reported fleet usage is within the configured caps.")).toBeTruthy();
    await openCapEditor();

    const save = screen.getByRole("button", { name: "Save caps" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Max agents"), { target: { value: "6" } });
    fireEvent.change(screen.getByLabelText("Max reported tokens"), { target: { value: "30000" } });
    fireEvent.change(screen.getByLabelText("Max reported cost (USD)"), { target: { value: "2.50" } });
    fireEvent.change(screen.getByLabelText("Max runtime (seconds)"), { target: { value: "600" } });

    expect(tauriMocks.invoke).not.toHaveBeenCalledWith("cost_set_caps", expect.anything());
    expect(save.disabled).toBe(false);
    fireEvent.click(save);

    await waitFor(() =>
      expect(tauriMocks.invoke).toHaveBeenCalledWith("cost_set_caps", {
        caps: {
          max_agents: 6,
          max_tokens: 30_000,
          max_cost_usd: 2.5,
          max_runtime_secs: 600,
        },
      }),
    );
    expect(await screen.findByText(/Saved fleet caps: agents 6/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Save caps" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("keeps malformed drafts local and never invokes the backend", async () => {
    installPanelMocks();
    render(createElement(CostMeterPanel, { sessions: [] }));
    await openCapEditor();

    fireEvent.change(screen.getByLabelText("Max agents"), { target: { value: "0" } });
    fireEvent.change(screen.getByLabelText("Max reported tokens"), { target: { value: "1.5" } });

    expect(screen.getByText("Enter a whole number from 1 to 32.")).toBeTruthy();
    expect(screen.getByText("Leave blank or enter a positive whole number.")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Save caps" }) as HTMLButtonElement).disabled).toBe(true);
    expect(tauriMocks.invoke).not.toHaveBeenCalledWith("cost_set_caps", expect.anything());
  });

  it("keeps a rejected backend draft editable with its field error", async () => {
    const rejection = {
      code: "invalid_cost_caps" as const,
      field: "max_agents" as const,
      message: "must be between 1 and 32",
    };
    installPanelMocks({ setCaps: () => Promise.reject(rejection) });
    render(createElement(CostMeterPanel, { sessions: [] }));
    await openCapEditor();

    const agents = screen.getByLabelText("Max agents") as HTMLInputElement;
    fireEvent.change(agents, { target: { value: "6" } });
    fireEvent.click(screen.getByRole("button", { name: "Save caps" }));

    expect(await screen.findByText(/Cap update failed: max_agents: must be between 1 and 32/)).toBeTruthy();
    expect(screen.getByText("must be between 1 and 32")).toBeTruthy();
    expect(agents.value).toBe("6");
    expect((screen.getByRole("button", { name: "Save caps" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("preserves a dirty draft across external updates and requires conflict resolution", async () => {
    const { listener } = installPanelMocks();
    render(createElement(CostMeterPanel, { sessions: [] }));
    await openCapEditor();
    await waitFor(() => expect(listener.current).toBeTypeOf("function"));

    const agents = screen.getByLabelText("Max agents") as HTMLInputElement;
    fireEvent.change(agents, { target: { value: "6" } });
    act(() => listener.current?.({ max_agents: 8, max_tokens: null, max_cost_usd: null, max_runtime_secs: null }));

    expect(await screen.findByText("Runtime caps changed while this draft was open.")).toBeTruthy();
    expect(agents.value).toBe("6");
    expect((screen.getByRole("button", { name: "Save caps" }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Keep draft" }));
    expect(screen.queryByText("Runtime caps changed while this draft was open.")).toBeNull();
    expect(agents.value).toBe("6");
    expect((screen.getByRole("button", { name: "Save caps" }) as HTMLButtonElement).disabled).toBe(false);

    act(() => listener.current?.({ max_agents: 9, max_tokens: null, max_cost_usd: null, max_runtime_secs: null }));
    expect(await screen.findByText("Runtime caps changed while this draft was open.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Use latest" }));
    expect(agents.value).toBe("9");
    expect((screen.getByRole("button", { name: "Save caps" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("warns when proposed known caps are already reached without claiming agent termination", async () => {
    installPanelMocks({
      initialCaps: { max_agents: 4, max_tokens: 20_000, max_cost_usd: 1, max_runtime_secs: 120 },
    });
    render(createElement(CostMeterPanel, { sessions: [session()] }));
    await openCapEditor();

    fireEvent.change(screen.getByLabelText("Max agents"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("Max reported tokens"), { target: { value: "10000" } });
    fireEvent.change(screen.getByLabelText("Max reported cost (USD)"), { target: { value: "0.25" } });
    fireEvent.change(screen.getByLabelText("Max runtime (seconds)"), { target: { value: "30" } });

    expect(screen.getByText(/Proposed agent \+ token \+ cost \+ runtime cap is already reached/)).toBeTruthy();
    expect(screen.getByText(/Future orchestration will block or halt; existing work is not killed/)).toBeTruthy();
  });
});
