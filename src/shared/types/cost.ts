/**
 * Cost Manager types — TS mirror of `src-tauri/src/cost/mod.rs`. See
 * docs/specs/AELYRIS_COCKPIT_REQUIREMENTS_2026-06-13.md, Binding Requirement 7.
 */
export interface CostCaps {
  max_agents: number | null;
  max_tokens: number | null;
  max_cost_usd: number | null;
  max_runtime_secs: number | null;
}

export interface CostUsage {
  active_agents: number;
  tokens_used: number;
  cost_usd: number;
  runtime_secs: number;
}

export type CostLimit = "agents" | "tokens" | "cost" | "runtime";

export interface SpawnDecision {
  allowed: boolean;
  blocked_by?: CostLimit;
  reason?: string;
}
