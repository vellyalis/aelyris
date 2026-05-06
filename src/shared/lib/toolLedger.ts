import type { AgentLog, AgentSession } from "../types/agent";
import { extractToolName, type ToolName } from "../types/toolBadge";
import { isLiveAgentStatus } from "./workstationSummary";

export type ToolLedgerState = "blocked" | "running" | "quiet" | "recent";
export type ToolLedgerAttention = "manual" | "denied" | "error" | "waiting";

export interface ToolLedgerItem {
  sessionId: string;
  sessionName: string;
  status: AgentSession["status"];
  state: ToolLedgerState;
  tool: ToolName | null;
  summary: string;
  timestamp: number;
  ageMs: number;
  role?: AgentSession["role"];
  attention?: ToolLedgerAttention;
  rule?: string;
}

export interface ToolLedgerSummary {
  items: ToolLedgerItem[];
  activeToolCount: number;
  attentionCount: number;
  attentionBreakdown: Record<ToolLedgerAttention, number>;
  quietCount: number;
  oldestQuietAgeMs: number;
}

const QUIET_AFTER_MS = 5 * 60 * 1000;

function lastInterestingLog(session: AgentSession): AgentLog | null {
  for (let index = session.logs.length - 1; index >= 0; index--) {
    const log = session.logs[index];
    if (log.type === "tool_use" || log.type === "tool_result" || log.type === "error" || log.type === "system") {
      return log;
    }
  }
  return session.logs.at(-1) ?? null;
}

function toolNameForLog(log: AgentLog | null): ToolName | null {
  if (!log) return null;
  const metadataTool = log.metadata?.toolName ? extractToolName(`${log.metadata.toolName}(`) : null;
  return metadataTool ?? (log.type === "tool_use" ? extractToolName(log.content) : null);
}

function isBlockedLog(log: AgentLog | null): boolean {
  return (
    log?.metadata?.event === "watchdog_decision" &&
    (log.metadata.decision === "manual" || log.metadata.decision === "denied")
  );
}

function attentionFor(session: AgentSession, log: AgentLog | null): ToolLedgerAttention | undefined {
  if (log?.metadata?.event === "watchdog_decision") {
    if (log.metadata.decision === "manual") return "manual";
    if (log.metadata.decision === "denied") return "denied";
  }
  if (session.status === "error" || log?.type === "error") return "error";
  if (session.status === "waiting") return "waiting";
  return undefined;
}

function logSummary(log: AgentLog | null, fallback: string): string {
  if (!log) return fallback;
  const trimmed = log.content.replace(/\s+/g, " ").trim();
  if (!trimmed) return fallback;
  return trimmed.length > 96 ? `${trimmed.slice(0, 93)}...` : trimmed;
}

export function buildToolLedger(sessions: readonly AgentSession[], now = Date.now()): ToolLedgerSummary {
  const items: ToolLedgerItem[] = sessions.map((session) => {
    const log = lastInterestingLog(session);
    const tool = toolNameForLog(log);
    const timestamp = log?.timestamp ?? session.startedAt;
    const ageMs = Math.max(0, now - timestamp);
    const live = isLiveAgentStatus(session.status);
    const blocked =
      session.status === "waiting" || session.status === "error" || log?.type === "error" || isBlockedLog(log);
    const attention = blocked ? attentionFor(session, log) : undefined;
    const state: ToolLedgerState = blocked
      ? "blocked"
      : live && log?.type === "tool_use"
        ? "running"
        : live && ageMs >= QUIET_AFTER_MS
          ? "quiet"
          : "recent";

    return {
      sessionId: session.id,
      sessionName: session.name,
      status: session.status,
      state,
      tool,
      summary: logSummary(log, live ? "Waiting for first activity" : "No recent tool activity"),
      timestamp,
      ageMs,
      role: session.role,
      attention,
      rule: log?.metadata?.rule,
    };
  });

  const stateRank: Record<ToolLedgerState, number> = {
    blocked: 0,
    quiet: 1,
    running: 2,
    recent: 3,
  };

  items.sort((a, b) => {
    const rank = stateRank[a.state] - stateRank[b.state];
    if (rank !== 0) return rank;
    return b.timestamp - a.timestamp;
  });

  const attentionBreakdown: Record<ToolLedgerAttention, number> = {
    manual: 0,
    denied: 0,
    error: 0,
    waiting: 0,
  };
  for (const item of items) {
    if (item.attention) attentionBreakdown[item.attention] += 1;
  }
  const quietItems = items.filter((item) => item.state === "quiet");

  return {
    items,
    activeToolCount: items.filter((item) => item.state === "running").length,
    attentionCount: items.filter((item) => item.state === "blocked").length,
    attentionBreakdown,
    quietCount: quietItems.length,
    oldestQuietAgeMs: quietItems.reduce((max, item) => Math.max(max, item.ageMs), 0),
  };
}
