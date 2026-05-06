import type { TerminalPaneTarget } from "../../App";
import type { AgentSession } from "../types/agent";
import type { AuditEventRecord } from "../types/audit";
import { type AuditRecoveryHint, deriveAuditRecoveryHint, getAuditCorrelationId } from "./auditRecovery";

export interface Guardrail {
  id: string;
  label: string;
  detail: string;
  state: "ok" | "watch" | "risk" | "idle";
}

export interface Incident {
  id: number;
  action: string;
  severity: string;
  summary: string;
  target: string;
  recovery: AuditRecoveryHint;
  correlationId: string | null;
  pane?: TerminalPaneTarget;
}

export interface ReliabilityReport {
  detail: string;
  grade: string;
  guardrails: Guardrail[];
  incidents: Incident[];
  label: string;
  score: number;
  tone: "good" | "watch" | "risk";
}

export function buildReliabilityReport({
  sessions,
  panes,
  changedFilesCount,
  auditEvents,
}: {
  sessions: AgentSession[];
  panes: TerminalPaneTarget[];
  changedFilesCount: number;
  auditEvents: AuditEventRecord[];
}): ReliabilityReport {
  const liveSessions = sessions.filter((s) => s.status !== "idle" && s.status !== "done");
  const blockedSessions = sessions.filter((s) => s.status === "waiting" || s.status === "error");
  const livePanes = panes.filter(isControllablePane);
  const paneRoles = new Set(panes.map((pane) => pane.role).filter(Boolean));
  const hasReviewLoad = changedFilesCount > 0 || sessions.some((s) => (s.changedFileDetails?.length ?? 0) > 0);
  const auditWarnings = auditEvents.filter((event) => event.severity === "warn").length;
  const auditErrors = auditEvents.filter((event) => event.severity === "error").length;
  const auditAttention = auditWarnings + auditErrors;
  const inputFailures = auditEvents.filter(isInputPathFailure);
  const incidents: Incident[] = auditEvents
    .filter((event) => event.severity === "warn" || event.severity === "error")
    .slice(0, 3)
    .map((event) => ({
      id: event.id,
      action: event.action,
      severity: event.severity,
      summary: event.summary,
      target: eventTarget(event),
      recovery: deriveAuditRecoveryHint(event),
      correlationId: getAuditCorrelationId(event.metadata),
      pane: findIncidentPane(event, panes),
    }));

  const guardrails: Guardrail[] = [
    {
      id: "input",
      label: "Input path",
      detail:
        inputFailures.length > 0
          ? `${inputFailures.length} input fault${inputFailures.length === 1 ? "" : "s"}`
          : "IME composition guarded",
      state: inputFailures.some((event) => event.severity === "error")
        ? "risk"
        : inputFailures.length > 0
          ? "watch"
          : "ok",
    },
    {
      id: "process",
      label: "Pane control",
      detail:
        livePanes.length > 0
          ? `${livePanes.length} controllable pane${livePanes.length === 1 ? "" : "s"}`
          : "No live panes",
      state: livePanes.length > 0 ? "ok" : "idle",
    },
    {
      id: "roles",
      label: "Workspace roles",
      detail:
        paneRoles.size > 0 ? `${paneRoles.size} role lane${paneRoles.size === 1 ? "" : "s"}` : "No roles assigned",
      state: paneRoles.size > 0 ? "ok" : "idle",
    },
    {
      id: "review",
      label: "Review pressure",
      detail: hasReviewLoad ? `${changedFilesCount} changed file${changedFilesCount === 1 ? "" : "s"}` : "Clean queue",
      state: hasReviewLoad ? "watch" : "ok",
    },
    {
      id: "agents",
      label: "Agent health",
      detail:
        blockedSessions.length > 0
          ? `${blockedSessions.length} need attention`
          : `${liveSessions.length} active session${liveSessions.length === 1 ? "" : "s"}`,
      state: blockedSessions.length > 0 ? "watch" : "ok",
    },
    {
      id: "diagnostics",
      label: "Audit trail",
      detail:
        auditAttention > 0
          ? `${auditErrors} errors / ${auditWarnings} warnings`
          : auditEvents.length > 0
            ? `${auditEvents.length} clean events`
            : "Waiting for events",
      state: auditErrors > 0 ? "risk" : auditWarnings > 0 ? "watch" : "ok",
    },
    {
      id: "logs",
      label: "Diagnostics",
      detail: "Logs kept out of primary flow",
      state: "ok",
    },
  ];

  const okWeight = guardrails.reduce((sum, guardrail) => {
    if (guardrail.state === "ok") return sum + 1;
    if (guardrail.state === "idle") return sum + 0.72;
    if (guardrail.state === "risk") return sum + 0.1;
    return sum + 0.48;
  }, 0);
  const score = Math.round((okWeight / guardrails.length) * 100);
  const tone = score >= 88 ? "good" : score >= 72 ? "watch" : "risk";
  const grade = score >= 92 ? "A" : score >= 84 ? "B" : score >= 72 ? "C" : "D";
  const label = tone === "good" ? "Operationally steady" : tone === "watch" ? "Needs watch" : "Risk rising";
  const detail =
    auditAttention > 0
      ? `${auditAttention} audit event${auditAttention === 1 ? "" : "s"} need review`
      : blockedSessions.length > 0
        ? `${blockedSessions.length} blocked session${blockedSessions.length === 1 ? "" : "s"}`
        : `${guardrails.filter((g) => g.state === "ok").length}/${guardrails.length} guardrails green`;

  return { detail, grade, guardrails, incidents, label, score, tone };
}

function eventTarget(event: AuditEventRecord): string {
  if (event.entityType && event.entityId) return `${event.entityType}:${event.entityId}`;
  return event.category;
}

function isInputPathFailure(event: AuditEventRecord): boolean {
  if (event.category !== "terminal" || (event.severity !== "warn" && event.severity !== "error")) return false;
  const action = event.action.toLowerCase();
  return (
    action.includes("input") ||
    action.includes("ime") ||
    action.includes("write") ||
    action.includes("send_keys") ||
    action.includes("paste")
  );
}

function findIncidentPane(event: AuditEventRecord, panes: TerminalPaneTarget[]): TerminalPaneTarget | undefined {
  const entityId = event.entityId;
  if (!entityId) return undefined;
  return panes.find((pane) => pane.terminalId === entityId || pane.paneId === entityId || pane.role === entityId);
}

function isControllablePane(pane: TerminalPaneTarget): boolean {
  if (!pane.terminalId) return false;
  const lifecycle = pane.lifecycle;
  return !["detached", "orphaned", "exited", "crashed", "layout-only"].includes(lifecycle ?? "");
}
