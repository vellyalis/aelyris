import type { FleetCostMeter } from "../../shared/lib/costMeter";
import type { CostCaps, CostCapsPolicy, CostLimit } from "../../shared/types/cost";

export type CostCapDraftField = "maxAgents" | "maxTokens" | "maxCostUsd" | "maxRuntimeSecs";

export interface CostCapDraft {
  readonly maxAgents: string;
  readonly maxTokens: string;
  readonly maxCostUsd: string;
  readonly maxRuntimeSecs: string;
}

export interface ParsedCostCapDraft {
  readonly caps: CostCaps | null;
  readonly errors: Partial<Record<CostCapDraftField, string>>;
}

export interface CostCapEditorState {
  readonly draft: CostCapDraft;
  readonly baseline: CostCaps;
  readonly conflict: CostCaps | null;
}

function optionalValue(value: number | null): string {
  return value == null ? "" : String(value);
}

export function draftFromCaps(caps: CostCaps): CostCapDraft {
  return {
    maxAgents: optionalValue(caps.max_agents),
    maxTokens: optionalValue(caps.max_tokens),
    maxCostUsd: optionalValue(caps.max_cost_usd),
    maxRuntimeSecs: optionalValue(caps.max_runtime_secs),
  };
}

export function initializeCostCapEditor(caps: CostCaps): CostCapEditorState {
  return { draft: draftFromCaps(caps), baseline: caps, conflict: null };
}

function parseRequiredInteger(
  value: string,
  field: CostCapDraftField,
  min: number,
  max: number,
  errors: Partial<Record<CostCapDraftField, string>>,
): number | null {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) {
    errors[field] = "Enter a whole number.";
    return null;
  }
  const parsed = Number(trimmed);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    errors[field] = `Enter a whole number from ${min} to ${max}.`;
    return null;
  }
  return parsed;
}

function parseOptionalInteger(
  value: string,
  field: CostCapDraftField,
  errors: Partial<Record<CostCapDraftField, string>>,
): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!/^\d+$/.test(trimmed)) {
    errors[field] = "Leave blank or enter a positive whole number.";
    return null;
  }
  const parsed = Number(trimmed);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    errors[field] = "Leave blank or enter a positive whole number.";
    return null;
  }
  return parsed;
}

function parseOptionalCost(value: string, errors: Partial<Record<CostCapDraftField, string>>): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!/^(?:\d+\.?\d*|\.\d+)$/.test(trimmed)) {
    errors.maxCostUsd = "Leave blank or enter a positive USD amount.";
    return null;
  }
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    errors.maxCostUsd = "Leave blank or enter a finite positive USD amount.";
    return null;
  }
  return parsed;
}

export function parseCostCapDraft(draft: CostCapDraft, policy: CostCapsPolicy): ParsedCostCapDraft {
  const errors: Partial<Record<CostCapDraftField, string>> = {};
  const maxAgents = parseRequiredInteger(draft.maxAgents, "maxAgents", policy.min_agents, policy.max_agents, errors);
  const maxTokens = parseOptionalInteger(draft.maxTokens, "maxTokens", errors);
  const maxCostUsd = parseOptionalCost(draft.maxCostUsd, errors);
  const maxRuntimeSecs = parseOptionalInteger(draft.maxRuntimeSecs, "maxRuntimeSecs", errors);
  if (Object.keys(errors).length > 0 || maxAgents == null) return { caps: null, errors };
  return {
    caps: {
      max_agents: maxAgents,
      max_tokens: maxTokens,
      max_cost_usd: maxCostUsd,
      max_runtime_secs: maxRuntimeSecs,
    },
    errors,
  };
}

export function costCapsEqual(left: CostCaps, right: CostCaps): boolean {
  return (
    left.max_agents === right.max_agents &&
    left.max_tokens === right.max_tokens &&
    left.max_cost_usd === right.max_cost_usd &&
    left.max_runtime_secs === right.max_runtime_secs
  );
}

export function costCapDraftIsDirty(draft: CostCapDraft, baseline: CostCaps, policy: CostCapsPolicy): boolean {
  const parsed = parseCostCapDraft(draft, policy);
  return parsed.caps == null || !costCapsEqual(parsed.caps, baseline);
}

export function synchronizeCostCapEditor(
  state: CostCapEditorState | null,
  incomingCaps: CostCaps,
  policy: CostCapsPolicy,
): CostCapEditorState {
  if (!state) return initializeCostCapEditor(incomingCaps);
  if (costCapsEqual(state.baseline, incomingCaps)) return state;
  if (costCapDraftIsDirty(state.draft, state.baseline, policy)) {
    return { ...state, conflict: incomingCaps };
  }
  return initializeCostCapEditor(incomingCaps);
}

export function capsReachedByReportedUsage(caps: CostCaps, meter: FleetCostMeter): CostLimit[] {
  const reached: CostLimit[] = [];
  if (caps.max_agents != null && meter.usage.active_agents >= caps.max_agents) reached.push("agents");
  if (caps.max_tokens != null && meter.tokenConfidence !== "unknown" && meter.usage.tokens_used >= caps.max_tokens) {
    reached.push("tokens");
  }
  if (caps.max_cost_usd != null && meter.costConfidence !== "unknown" && meter.usage.cost_usd >= caps.max_cost_usd) {
    reached.push("cost");
  }
  if (
    caps.max_runtime_secs != null &&
    meter.runtimeConfidence !== "unknown" &&
    meter.usage.runtime_secs >= caps.max_runtime_secs
  ) {
    reached.push("runtime");
  }
  return reached;
}
