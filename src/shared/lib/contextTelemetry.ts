import type { ContextRemaining, ContextRemainingWire, TelemetryConfidence } from "../types/agent";

const CONFIDENCE_VALUES = new Set<TelemetryConfidence>(["exact", "parsed", "estimated", "unknown"]);

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function clampPct(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function readNumber(record: Record<string, unknown>, snake: string, camel: string): number | null {
  return finiteNumber(record[camel]) ?? finiteNumber(record[snake]);
}

export function normalizeContextRemaining(value: unknown): ContextRemaining | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const record = value as Record<string, unknown>;
  const confidence = CONFIDENCE_VALUES.has(record.confidence as TelemetryConfidence)
    ? (record.confidence as TelemetryConfidence)
    : "unknown";
  const pct = readNumber(record, "pct", "pct");
  const usedPct = readNumber(record, "used_pct", "usedPct");
  const updatedAt = readNumber(record, "updated_at", "updatedAt") ?? 0;
  return {
    pct: pct == null ? null : clampPct(pct),
    usedPct: usedPct == null ? null : clampPct(usedPct),
    confidence,
    source: typeof record.source === "string" ? record.source : "unknown",
    updatedAt,
    warn: record.warn === true,
    hard: record.hard === true,
  };
}

export function contextRemainingToWire(value: ContextRemaining): ContextRemainingWire {
  return {
    pct: value.pct,
    used_pct: value.usedPct,
    confidence: value.confidence,
    source: value.source,
    updated_at: value.updatedAt,
    warn: value.warn,
    hard: value.hard,
  };
}
