import { invoke } from "@tauri-apps/api/core";
import { useCallback } from "react";
import { reportInvokeFailure } from "../lib/fallbackTelemetry";
import type { CostUsage } from "../types/cost";
import type { DispatchPlan } from "../types/orchestratorPlan";

/**
 * Reads the orchestrator's next scheduling decision (BR9) for the live task
 * graph. `fetchPlan(usage)` returns which tasks to dispatch now and the loop
 * state, given the current fleet usage — a pure read the cockpit loop view uses
 * to render the next move without performing it. Returns null if the call fails
 * (e.g. outside the Tauri runtime).
 */
export function useOrchestratorPlan() {
  const fetchPlan = useCallback(async (usage: CostUsage): Promise<DispatchPlan | null> => {
    try {
      return await invoke<DispatchPlan>("orchestrator_plan", { usage });
    } catch (err) {
      reportInvokeFailure({ source: "orchestrator", operation: "orchestrator_plan", err, userVisible: false });
      return null;
    }
  }, []);

  return { fetchPlan };
}
