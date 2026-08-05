import type { AgentSession, TelemetryConfidence } from "../types/agent";
import type { CostCaps, CostLimit, CostUsage } from "../types/cost";
import { tokenTelemetryConfidence } from "./workstationSummary";

export type CostMeterStatus = "blocked" | "incomplete" | "within" | "agent_only";

export interface FleetCostMeter {
  readonly usage: CostUsage;
  readonly tokenConfidence: TelemetryConfidence;
  readonly costConfidence: TelemetryConfidence;
  readonly runtimeConfidence: TelemetryConfidence;
  readonly blockedBy: CostLimit[];
  readonly unknownLimits: CostLimit[];
  readonly status: CostMeterStatus;
}

const COST_LIVE_STATUSES = new Set<AgentSession["status"]>([
  "idle",
  "thinking",
  "generating",
  "coding",
  "waiting",
]);

export function isCostMeterLiveStatus(status: AgentSession["status"]): boolean {
  return COST_LIVE_STATUSES.has(status);
}

function finiteNonnegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function startedAtMs(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return value > 1_000_000_000_000 ? value : value * 1000;
}

function liveRuntime(sessions: readonly AgentSession[], now: number): {
  seconds: number;
  confidence: TelemetryConfidence;
} {
  if (sessions.length === 0) return { seconds: 0, confidence: "exact" };
  let maximum = 0;
  let validStarts = 0;
  for (const session of sessions) {
    const started = startedAtMs(session.startedAt);
    if (started <= 0) continue;
    validStarts += 1;
    maximum = Math.max(maximum, Math.floor(Math.max(0, now - started) / 1000));
  }
  return {
    seconds: maximum,
    confidence: validStarts === sessions.length ? "exact" : "unknown",
  };
}

function configuredBudgetCapCount(caps: CostCaps): number {
  return [caps.max_tokens, caps.max_cost_usd, caps.max_runtime_secs].filter((value) => value != null).length;
}

export function deriveFleetCostMeter(
  sessions: readonly AgentSession[],
  caps: CostCaps,
  now = Date.now(),
): FleetCostMeter {
  const liveSessions = sessions.filter((session) => isCostMeterLiveStatus(session.status));
  const runtime = liveRuntime(liveSessions, now);
  const usage: CostUsage = {
    active_agents: liveSessions.length,
    tokens_used: Math.round(sessions.reduce((sum, session) => sum + finiteNonnegative(session.tokensUsed), 0)),
    cost_usd: sessions.reduce((sum, session) => sum + finiteNonnegative(session.cost), 0),
    runtime_secs: runtime.seconds,
  };
  const tokenConfidence = tokenTelemetryConfidence(sessions);
  const costConfidence: TelemetryConfidence = sessions.some((session) => finiteNonnegative(session.cost) > 0)
    ? "parsed"
    : "unknown";
  const runtimeConfidence = runtime.confidence;
  const blockedBy: CostLimit[] = [];
  const unknownLimits: CostLimit[] = [];

  if (caps.max_agents != null && usage.active_agents >= caps.max_agents) blockedBy.push("agents");
  if (caps.max_tokens != null) {
    if (tokenConfidence === "unknown") unknownLimits.push("tokens");
    else if (usage.tokens_used >= caps.max_tokens) blockedBy.push("tokens");
  }
  if (caps.max_cost_usd != null) {
    if (costConfidence === "unknown") unknownLimits.push("cost");
    else if (usage.cost_usd >= caps.max_cost_usd) blockedBy.push("cost");
  }
  if (caps.max_runtime_secs != null) {
    if (runtimeConfidence === "unknown") unknownLimits.push("runtime");
    else if (usage.runtime_secs >= caps.max_runtime_secs) blockedBy.push("runtime");
  }

  const status: CostMeterStatus =
    blockedBy.length > 0
      ? "blocked"
      : unknownLimits.length > 0
        ? "incomplete"
        : configuredBudgetCapCount(caps) === 0
          ? "agent_only"
          : "within";

  return {
    usage,
    tokenConfidence,
    costConfidence,
    runtimeConfidence,
    blockedBy,
    unknownLimits,
    status,
  };
}
