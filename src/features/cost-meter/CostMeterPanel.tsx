import { AlertTriangle, CircleDollarSign, Clock3, Gauge, UsersRound } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { useCostManager } from "../../shared/hooks/useCostManager";
import { deriveFleetCostMeter, type FleetCostMeter, isCostMeterLiveStatus } from "../../shared/lib/costMeter";
import { compactWorkstationNumber } from "../../shared/lib/workstationSummary";
import type { AgentSession, TelemetryConfidence } from "../../shared/types/agent";
import type { CostCaps, CostLimit } from "../../shared/types/cost";
import styles from "./CostMeterPanel.module.css";

interface CostMeterPanelProps {
  readonly sessions: readonly AgentSession[];
}

const LIMIT_LABEL: Record<CostLimit, string> = {
  agents: "agent",
  tokens: "token",
  cost: "cost",
  runtime: "runtime",
};

function formatUsd(value: number): string {
  if (value >= 100) return `$${Math.round(value).toLocaleString()}`;
  return `$${value.toFixed(2)}`;
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
}

function metricValue(value: string, cap: string | null): string {
  return cap == null ? value : `${value} / ${cap}`;
}

function statusCopy(meter: FleetCostMeter, caps: CostCaps): string {
  if (meter.blockedBy.length > 0) {
    return `Configured ${meter.blockedBy.map((limit) => LIMIT_LABEL[limit]).join(" + ")} cap reached.`;
  }
  if (meter.unknownLimits.length > 0) {
    return `Cap coverage incomplete: ${meter.unknownLimits.map((limit) => LIMIT_LABEL[limit]).join(" + ")} telemetry unknown.`;
  }
  if (meter.status === "agent_only") {
    return caps.max_agents == null
      ? "No fleet caps are configured."
      : "Agent cap is configured; token, cost, and runtime remain uncapped.";
  }
  return "Reported fleet usage is within the configured caps.";
}

export function CostMeterPanel({ sessions }: CostMeterPanelProps) {
  const { caps } = useCostManager();
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!sessions.some((session) => isCostMeterLiveStatus(session.status))) return;
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, [sessions]);

  const meter = useMemo(() => (caps ? deriveFleetCostMeter(sessions, caps, now) : null), [caps, now, sessions]);

  if (!caps || !meter) {
    return <p className={styles.loading}>Reading configured fleet caps…</p>;
  }

  const tokenValue =
    meter.tokenConfidence === "unknown" ? "unknown" : compactWorkstationNumber(meter.usage.tokens_used);
  const costValue = meter.costConfidence === "unknown" ? "unknown" : formatUsd(meter.usage.cost_usd);

  return (
    <section className={styles.panel} aria-label="Fleet cost meter" data-status={meter.status}>
      <div className={styles.status} data-status={meter.status} role="status">
        {meter.status === "blocked" || meter.status === "incomplete" ? (
          <AlertTriangle size={13} aria-hidden="true" />
        ) : (
          <Gauge size={13} aria-hidden="true" />
        )}
        <span>{statusCopy(meter, caps)}</span>
      </div>

      <fieldset className={styles.metrics} aria-label="Reported fleet usage and caps">
        <Metric
          icon={<UsersRound size={12} />}
          label="Agents"
          value={metricValue(String(meter.usage.active_agents), caps.max_agents == null ? null : String(caps.max_agents))}
          confidence="exact"
        />
        <Metric
          icon={<Gauge size={12} />}
          label="Tokens"
          value={metricValue(tokenValue, caps.max_tokens == null ? null : compactWorkstationNumber(caps.max_tokens))}
          confidence={meter.tokenConfidence}
        />
        <Metric
          icon={<CircleDollarSign size={12} />}
          label="Cost"
          value={metricValue(costValue, caps.max_cost_usd == null ? null : formatUsd(caps.max_cost_usd))}
          confidence={meter.costConfidence}
        />
        <Metric
          icon={<Clock3 size={12} />}
          label="Runtime"
          value={metricValue(
            formatDuration(meter.usage.runtime_secs),
            caps.max_runtime_secs == null ? null : formatDuration(caps.max_runtime_secs),
          )}
          confidence={meter.runtimeConfidence}
        />
      </fieldset>

      <p className={styles.disclosure}>
        Values are reported session telemetry. Unknown is never treated as zero; cap editing stays outside this read-only view.
      </p>
    </section>
  );
}

function Metric({
  icon,
  label,
  value,
  confidence,
}: {
  readonly icon: ReactNode;
  readonly label: string;
  readonly value: string;
  readonly confidence: TelemetryConfidence;
}) {
  return (
    <div className={styles.metric} data-confidence={confidence} title={`${label} telemetry: ${confidence}`}>
      <span className={styles.metricIcon} aria-hidden="true">
        {icon}
      </span>
      <span className={styles.metricCopy}>
        <strong>{value}</strong>
        <span>{label}</span>
      </span>
      <span className={styles.confidence}>{confidence}</span>
    </div>
  );
}
