import type { AgentSession } from "../types/agent";
import { agentContextPercent } from "./workstationSummary";

export type BudgetWarningKind = "cost" | "context";

export interface BudgetThresholds {
  /** Per-session cost cap in USD. */
  perSessionCostCap: number;
  /** Context usage percent (0-100) that triggers a warning. */
  contextWarnPct: number;
}

export const DEFAULT_BUDGET_THRESHOLDS: BudgetThresholds = {
  perSessionCostCap: 2,
  contextWarnPct: 85,
};

/**
 * Classify a session's budget status. Returns the most severe warning
 * (cost overrun wins over context), or null if the session is within limits.
 */
export function getBudgetWarning(
  session: AgentSession,
  thresholds: BudgetThresholds = DEFAULT_BUDGET_THRESHOLDS,
): BudgetWarningKind | null {
  if (session.cost > thresholds.perSessionCostCap) return "cost";
  if (agentContextPercent(session) >= thresholds.contextWarnPct) return "context";
  return null;
}

export function countOverBudget(
  sessions: readonly AgentSession[],
  thresholds: BudgetThresholds = DEFAULT_BUDGET_THRESHOLDS,
): number {
  let n = 0;
  for (const s of sessions) {
    if (getBudgetWarning(s, thresholds)) n++;
  }
  return n;
}
