import type { AuditEventRecord, AuditSeverity } from "../types/audit";
import { deriveAuditRecoveryHint, getAuditCorrelationId } from "./auditRecovery";

export type AuditTraceStatus = "clean" | "active-risk" | "needs-verify" | "verified" | "empty";

export interface AuditTraceSummary {
  traceId: string | null;
  status: AuditTraceStatus;
  label: string;
  detail: string;
  eventCount: number;
  riskCount: number;
  recoverableCount: number;
  latestSeverity: AuditSeverity | null;
  latestTimestamp: string | null;
}

export function buildAuditTraceSummary(
  entries: AuditEventRecord[],
  traceId: string | null | undefined,
): AuditTraceSummary {
  const normalizedTrace = normalizeTrace(traceId);
  if (!normalizedTrace) return emptySummary(null);

  const traceEntries = [...entries.filter((entry) => getAuditCorrelationId(entry.metadata) === normalizedTrace)].sort(
    compareNewestFirst,
  );

  if (traceEntries.length === 0) return emptySummary(normalizedTrace);

  const latest = traceEntries[0];
  const riskEntries = traceEntries.filter(isRisk);
  const recoverableCount = traceEntries.filter((entry) => deriveAuditRecoveryHint(entry).recoverable).length;
  const latestRisk = riskEntries[0] ?? null;
  const stabilizerAfterRisk = latestRisk
    ? (traceEntries.find(
        (entry) => !isRisk(entry) && isAtOrAfter(entry, latestRisk) && isStabilizingAction(entry.action),
      ) ?? null)
    : null;
  const status = traceStatus(latest, riskEntries.length, stabilizerAfterRisk);

  return {
    traceId: normalizedTrace,
    status,
    label: statusLabel(status),
    detail: statusDetail(status, riskEntries.length, recoverableCount),
    eventCount: traceEntries.length,
    riskCount: riskEntries.length,
    recoverableCount,
    latestSeverity: latest.severity,
    latestTimestamp: latest.timestamp,
  };
}

function emptySummary(traceId: string | null): AuditTraceSummary {
  return {
    traceId,
    status: "empty",
    label: "No trace",
    detail: traceId ? "No events match this trace." : "Select a trace to inspect recovery status.",
    eventCount: 0,
    riskCount: 0,
    recoverableCount: 0,
    latestSeverity: null,
    latestTimestamp: null,
  };
}

function normalizeTrace(traceId: string | null | undefined): string | null {
  if (!traceId) return null;
  const trimmed = traceId.replace(/\s+/g, " ").trim();
  return trimmed || null;
}

function traceStatus(
  latest: AuditEventRecord,
  riskCount: number,
  stabilizerAfterRisk: AuditEventRecord | null,
): AuditTraceStatus {
  if (isRisk(latest)) return "active-risk";
  if (riskCount === 0) return "clean";
  if (stabilizerAfterRisk) return "verified";
  return "needs-verify";
}

function statusLabel(status: AuditTraceStatus): string {
  if (status === "active-risk") return "Active risk";
  if (status === "needs-verify") return "Needs verify";
  if (status === "verified") return "Verified";
  if (status === "clean") return "Clean";
  return "No trace";
}

function statusDetail(status: AuditTraceStatus, riskCount: number, recoverableCount: number): string {
  if (status === "active-risk") return "Latest event is still a warning or error.";
  if (status === "needs-verify") return "Risk was recorded but no stabilizing event followed it.";
  if (status === "verified") return "A stabilizing event followed the latest risk.";
  if (status === "clean") return "No warnings or errors are present for this trace.";
  return `${riskCount} risks, ${recoverableCount} recoveries.`;
}

function compareNewestFirst(left: AuditEventRecord, right: AuditEventRecord): number {
  return readTime(right.timestamp) - readTime(left.timestamp) || right.id - left.id;
}

function isAtOrAfter(entry: AuditEventRecord, target: AuditEventRecord): boolean {
  const entryTime = readTime(entry.timestamp);
  const targetTime = readTime(target.timestamp);
  if (entryTime !== targetTime) return entryTime > targetTime;
  return entry.id >= target.id;
}

function readTime(timestamp: string): number {
  const time = Date.parse(timestamp);
  return Number.isFinite(time) ? time : 0;
}

function isRisk(entry: AuditEventRecord): boolean {
  return entry.severity === "warn" || entry.severity === "error";
}

function isStabilizingAction(action: string): boolean {
  return /recover|resolved|verify|verified|restart|respawn|spawn|retry|restored|healthy/i.test(action);
}
