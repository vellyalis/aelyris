// @ts-expect-error Node types are intentionally absent from the app tsconfig.
import { readFileSync } from "node:fs";
// @ts-expect-error Node types are intentionally absent from the app tsconfig.
import { join } from "node:path";
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useOrchestratorPlan } from "../shared/hooks/useOrchestratorPlan";
import type { CostUsage } from "../shared/types/cost";
import type { DispatchPlan, LoopState } from "../shared/types/orchestratorPlan";

declare const process: { cwd(): string };

const tauriMocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: tauriMocks.invoke }));

const USAGE: CostUsage = {
  active_agents: 1,
  tokens_used: 0,
  cost_usd: 0,
  runtime_secs: 0,
};

describe("useOrchestratorPlan", () => {
  beforeEach(() => tauriMocks.invoke.mockReset());

  it("invokes orchestrator_plan with the usage snapshot and returns the plan", async () => {
    const plan: DispatchPlan = { to_dispatch: ["a", "b"], state: "active" };
    tauriMocks.invoke.mockResolvedValue(plan);
    const { result } = renderHook(() => useOrchestratorPlan());
    const got = await result.current.fetchPlan(USAGE);
    expect(got).toEqual(plan);
    expect(tauriMocks.invoke).toHaveBeenCalledWith("orchestrator_plan", { usage: USAGE });
  });

  it("forwards every loop state from the backend unchanged", async () => {
    const states: LoopState[] = ["active", "complete", "stalled", "halted_by_budget"];
    for (const state of states) {
      tauriMocks.invoke.mockResolvedValue({ to_dispatch: [], state });
      const { result } = renderHook(() => useOrchestratorPlan());
      const got = await result.current.fetchPlan(USAGE);
      expect(got?.state).toBe(state);
    }
  });
});

describe("LoopState/DispatchPlan mirror the Rust source of truth", () => {
  const rust = readFileSync(join(process.cwd(), "src-tauri/src/orchestrator/mod.rs"), "utf8");

  it("every LoopState variant exists as a snake_case Rust enum variant", () => {
    // The Rust enum is #[serde(rename_all = "snake_case")]: PascalCase variant
    // names serialize to the snake_case wire values used by the TS union.
    const wireToRust: Record<LoopState, string> = {
      active: "Active",
      complete: "Complete",
      stalled: "Stalled",
      halted_by_budget: "HaltedByBudget",
    };
    for (const variant of Object.values(wireToRust)) {
      expect(rust).toContain(variant);
    }
    expect(rust).toContain('#[serde(rename_all = "snake_case")]');
  });

  it("DispatchPlan fields match the Rust struct", () => {
    expect(rust).toContain("pub struct DispatchPlan");
    expect(rust).toContain("pub to_dispatch: Vec<String>");
    expect(rust).toContain("pub state: LoopState");
  });
});
