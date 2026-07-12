import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { reportInvokeFailure } from "../../shared/lib/fallbackTelemetry";
import { buildRightRailActionAuditPayload, type RightRailAction, type RightRailMode } from "../../shared/lib/rightRailAdvisor";
import { isTauriRuntime } from "../../shared/lib/tauriRuntime";
import type { AuditJournalEventRecord } from "../../shared/types/audit";
import type { RightRailEdgeScore, RightRailEdgeScoreFeedbackEntry, RightRailEdgeScoreItem } from "./rightRailTypes";

export function compactRightRailOwnerId(value: string | undefined): string {
  if (!value) return "";
  const trimmed = value.trim();
  if (trimmed.length <= 10) return trimmed;
  return `${trimmed.slice(0, 4)}-${trimmed.slice(-4)}`;
}

export function formatRightRailPathOwner(path: string | undefined): string {
  if (!path) return "";
  const normalized = path.replace(/\\/g, "/");
  return normalized.split("/").filter(Boolean).pop() ?? normalized;
}

export function formatRightRailActionOwner(action: RightRailAction): string {
  if (action.targetSessionId) return `Session ${compactRightRailOwnerId(action.targetSessionId)}`;
  if (action.targetPaneRole) return `Pane ${action.targetPaneRole}`;
  if (action.targetFilePath) return `File ${formatRightRailPathOwner(action.targetFilePath)}`;
  if (action.target.role) return `Role ${action.target.role}`;
  if (action.target.widget) return `Widget ${action.target.widget}`;
  return `${action.target.kind} ${action.target.label}`;
}

export function formatInspectorProof(evidence: string | undefined, fallback: string): string {
  const normalized = evidence?.trim();
  if (!normalized) return fallback;
  const lower = normalized.toLowerCase();
  if (lower.includes("cannot read properties") || lower.includes("reading 'invoke'") || lower.includes("not available in this webview")) return fallback;
  return normalized;
}

export async function appendRightRailActionAudit(action: RightRailAction, workspaceId: string, previousMode: RightRailMode): Promise<AuditJournalEventRecord | null> {
  if (!workspaceId || !isTauriRuntime()) return null;
  try {
    const { invoke } = await Promise.resolve({ invoke: tauriInvoke });
    return await invoke<AuditJournalEventRecord>("append_audit_event", {
      event: {
        workspaceId, threadId: null, sessionId: action.targetSessionId ?? null, paneId: null, terminalId: null,
        agentId: action.targetSessionId ?? null, workflowId: null, taskId: null, correlationId: null,
        kind: action.execution.auditEvent,
        severity: action.execution.status === "blocked" ? "warn" : "info",
        source: "right-rail", confidence: 0.9,
        payloadJson: buildRightRailActionAuditPayload(action, previousMode),
      },
    });
  } catch (err) {
    reportInvokeFailure({ source: "app", operation: "append_right_rail_action_audit", err, severity: "warning" });
    return null;
  }
}

export async function appendRightRailActionOutcomeAudit(
  action: RightRailAction,
  workspaceId: string,
  previousMode: RightRailMode,
  outcome: "blocked" | "failed",
  detail: string,
): Promise<AuditJournalEventRecord | null> {
  if (!workspaceId || !isTauriRuntime()) return null;
  try {
    const { invoke } = await Promise.resolve({ invoke: tauriInvoke });
    return await invoke<AuditJournalEventRecord>("append_audit_event", {
      event: {
        workspaceId, threadId: null, sessionId: action.targetSessionId ?? null, paneId: null, terminalId: null,
        agentId: action.targetSessionId ?? null, workflowId: null, taskId: null, correlationId: null,
        kind: `${action.execution.auditEvent}.${outcome}`, severity: "warn", source: "right-rail", confidence: 0.92,
        payloadJson: {
          actionId: action.id, label: action.label, operation: action.execution.operation,
          fromMode: previousMode, toMode: action.mode, outcome, detail,
          recoveryStep: action.execution.recoveryStep ?? null,
          disabledReason: action.execution.disabledReason ?? null,
          targetFilePath: action.targetFilePath ?? null,
          targetPaneRole: action.targetPaneRole ?? null,
        },
      },
    });
  } catch (err) {
    reportInvokeFailure({ source: "app", operation: "append_right_rail_action_outcome_audit", err, severity: "warning" });
    return null;
  }
}

export async function appendRightRailEdgeScoreInteractionAudit({
  item, workspaceId, fromMode, score, grade, stage,
}: {
  item: RightRailEdgeScoreItem;
  workspaceId: string;
  fromMode: RightRailMode;
  score: number;
  grade: RightRailEdgeScore["grade"];
  stage: "clicked" | "destination-reached";
}): Promise<AuditJournalEventRecord | null> {
  if (!workspaceId || !isTauriRuntime()) return null;
  try {
    const { invoke } = await Promise.resolve({ invoke: tauriInvoke });
    return await invoke<AuditJournalEventRecord>("append_audit_event", {
      event: {
        workspaceId, threadId: null, sessionId: null, paneId: null, terminalId: null, agentId: null,
        workflowId: null, taskId: null, correlationId: null, kind: `right_rail.edge_score.${stage}`,
        severity: item.status === "gap" ? "warn" : "info", source: "right-rail", confidence: 0.88,
        payloadJson: {
          axisId: item.id, axisLabel: item.label, axisStatus: item.status, axisScore: item.score, axisMax: item.max,
          edgeScore: score, edgeGrade: grade, fromMode, toMode: item.routeMode,
          targetWidget: item.focusWidget, actionLabel: item.actionLabel,
          privacy: "no command text, prompt text, file path, or user input captured",
        },
      },
    });
  } catch (err) {
    reportInvokeFailure({ source: "app", operation: "append_right_rail_edge_score_interaction_audit", err, severity: "warning" });
    return null;
  }
}

export async function appendRightRailEdgeFeedbackStaleAudit({ entry, workspaceId, staleReason }: {
  entry: RightRailEdgeScoreFeedbackEntry;
  workspaceId: string;
  staleReason: string;
}): Promise<AuditJournalEventRecord | null> {
  if (!workspaceId || !isTauriRuntime()) return null;
  try {
    const { invoke } = await Promise.resolve({ invoke: tauriInvoke });
    return await invoke<AuditJournalEventRecord>("append_audit_event", {
      event: {
        workspaceId, threadId: null, sessionId: null, paneId: null, terminalId: null, agentId: null,
        workflowId: null, taskId: null, correlationId: null, kind: "right_rail.edge_feedback.stale",
        severity: "warn", source: "right-rail", confidence: 0.86,
        payloadJson: {
          axisId: entry.axisId, axisLabel: entry.axisLabel, score: entry.score, grade: entry.grade, staleReason,
          privacy: "no command text, prompt text, file path, or user input captured",
        },
      },
    });
  } catch (err) {
    reportInvokeFailure({ source: "app", operation: "append_right_rail_edge_feedback_stale_audit", err, severity: "warning" });
    return null;
  }
}
