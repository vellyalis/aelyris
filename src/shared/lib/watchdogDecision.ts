import type { AgentLog } from "../types/agent";
import {
  type CommandRiskClass,
  type CommandRiskSeverity,
  classifyCommand,
  redactSensitiveCommand,
} from "./shellSafety";

export interface WatchdogDecisionEvent {
  decision: "approved" | "denied" | "manual";
  tool: string;
  rule?: string;
}

export interface ApprovalReplayRecord {
  version: 1;
  id: string;
  at: number;
  actor: "watchdog";
  decision: WatchdogDecisionEvent["decision"];
  tool: string;
  rule?: string;
  command: string;
  commandPreview: string;
  commandHash: string;
  riskClasses: CommandRiskClass[];
  riskSeverity: CommandRiskSeverity;
  requiresApproval: boolean;
  redacted: boolean;
}

export interface ApprovalReplayResult {
  matched: boolean;
  decision?: WatchdogDecisionEvent["decision"];
  record?: ApprovalReplayRecord;
  reason: string;
}

function normalizeDecision(value: unknown): WatchdogDecisionEvent["decision"] | null {
  return value === "approved" || value === "denied" || value === "manual" ? value : null;
}

export function parseWatchdogDecision(payload: unknown): WatchdogDecisionEvent | null {
  try {
    const raw = typeof payload === "string" ? payload : JSON.stringify(payload ?? null);
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const decision = normalizeDecision(parsed.decision);
    const tool = typeof parsed.tool === "string" ? parsed.tool.trim() : "";
    if (!decision || !tool) return null;
    const rule = typeof parsed.rule === "string" && parsed.rule.trim().length > 0 ? parsed.rule.trim() : undefined;
    return { decision, tool, rule };
  } catch {
    return null;
  }
}

function fnv1a32(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `fnv1a32:${hash.toString(16).padStart(8, "0")}`;
}

export function commandFromWatchdogTool(tool: string): string {
  const bash = tool.match(/^Bash\(([\s\S]*)\)$/i);
  return (bash?.[1] ?? tool).trim();
}

export function createApprovalReplayRecord(event: WatchdogDecisionEvent, timestamp = Date.now()): ApprovalReplayRecord {
  const command = commandFromWatchdogTool(event.tool);
  const risk = classifyCommand(command);
  const redacted = redactSensitiveCommand(command);
  const commandHash = fnv1a32(command);
  return {
    version: 1,
    id: `approval-${timestamp}-${commandHash.slice(commandHash.indexOf(":") + 1)}`,
    at: timestamp,
    actor: "watchdog",
    decision: event.decision,
    tool: event.tool,
    rule: event.rule,
    command,
    commandPreview: redacted.slice(0, 500),
    commandHash,
    riskClasses: risk.classes,
    riskSeverity: risk.severity,
    requiresApproval: risk.requiresApproval || event.decision === "manual",
    redacted: redacted !== command,
  };
}

export function replayApprovalRecord(record: ApprovalReplayRecord, event: WatchdogDecisionEvent): ApprovalReplayResult {
  const command = commandFromWatchdogTool(event.tool);
  const risk = classifyCommand(command);
  if (record.version !== 1) return { matched: false, reason: "unsupported approval record version" };
  if (record.commandHash !== fnv1a32(command)) return { matched: false, reason: "command hash mismatch" };
  if (record.riskSeverity !== risk.severity) return { matched: false, reason: "risk severity changed" };
  const currentClasses = risk.classes.join("|");
  if (record.riskClasses.join("|") !== currentClasses) return { matched: false, reason: "risk class changed" };
  if (record.decision !== event.decision) return { matched: false, reason: "decision changed" };
  return { matched: true, decision: record.decision, record, reason: "approval replay matched" };
}

export function watchdogDecisionToLog(event: WatchdogDecisionEvent, timestamp = Date.now()): AgentLog {
  const approvalReplayRecord = createApprovalReplayRecord(event, timestamp);
  const verb =
    event.decision === "approved"
      ? "Auto-approved"
      : event.decision === "denied"
        ? "Auto-denied"
        : "Needs manual approval";
  const suffix = event.rule ? ` via ${event.rule}` : "";
  return {
    timestamp,
    type: event.decision === "denied" ? "error" : "system",
    content: `${verb}: ${event.tool}${suffix}`,
    metadata: {
      event: "watchdog_decision",
      toolName: event.tool,
      decision: event.decision,
      rule: event.rule,
      approvalReplayRecord,
      approvalReplayKey: approvalReplayRecord.commandHash,
      riskClasses: approvalReplayRecord.riskClasses,
      riskSeverity: approvalReplayRecord.riskSeverity,
    },
  };
}
