import type { AgentSession, AgentStatus } from "../types/agent";
import { getMaxTokens, getModelBySpecifier } from "../types/model";

export const LIVE_AGENT_STATUSES = new Set<AgentStatus>(["thinking", "generating", "coding", "waiting"]);

export type TelemetryConfidence = "exact" | "parsed" | "estimated" | "unknown";

const STATUS_RANK: Record<AgentStatus, number> = {
  generating: 0,
  coding: 1,
  thinking: 2,
  waiting: 3,
  error: 4,
  idle: 5,
  done: 6,
};

export interface WorkstationSummaryInput {
  sessions: readonly AgentSession[];
  changedFilesCount?: number;
  interactiveSessionCount?: number;
}

export interface WorkstationSummary {
  sessions: readonly AgentSession[];
  rankedSessions: AgentSession[];
  liveSessions: AgentSession[];
  liveSessionCount: number;
  liveRunCount: number;
  interactiveSessionCount: number;
  attentionCount: number;
  totalTokens: number;
  totalCost: number;
  peakContextPct: number;
  peakSession: AgentSession | null;
  tokenConfidence: TelemetryConfidence;
  contextConfidence: TelemetryConfidence;
  fileConfidence: TelemetryConfidence;
  tracedSessionCount: number;
  sessionChangedFileCount: number;
  changedFilesCount: number;
}

export function isLiveAgentStatus(status: AgentStatus): boolean {
  return LIVE_AGENT_STATUSES.has(status);
}

export function agentContextPercent(session: AgentSession): number {
  const max = getMaxTokens(session.model);
  if (max <= 0) return 0;
  return Math.min(100, (session.tokensUsed / max) * 100);
}

export function agentContextWindow(session: AgentSession): { used: number; max: number; remaining: number } {
  const max = getMaxTokens(session.model);
  const used = Math.max(0, session.tokensUsed);
  return {
    used,
    max,
    remaining: Math.max(0, max - used),
  };
}

export function tokenTelemetryConfidence(sessions: readonly AgentSession[]): TelemetryConfidence {
  if (sessions.length === 0) return "unknown";
  return sessions.some((session) => session.tokensUsed > 0) ? "parsed" : "unknown";
}

export function contextTelemetryConfidence(session: AgentSession | null): TelemetryConfidence {
  if (!session || session.tokensUsed <= 0) return "unknown";
  return getModelBySpecifier(session.model) ? "parsed" : "estimated";
}

export function fileTelemetryConfidence(
  sessions: readonly AgentSession[],
  changedFilesCount: number,
): TelemetryConfidence {
  if (changedFilesCount <= 0) return "unknown";
  if (sessions.some((session) => (session.changedFileDetails?.length ?? 0) > 0)) return "exact";
  return sessions.some((session) => (session.filesChanged ?? 0) > 0) ? "estimated" : "parsed";
}

export function agentFileCount(session: AgentSession): number {
  const detailedCount = session.changedFileDetails?.length ?? 0;
  if (detailedCount > 0) return detailedCount;
  return session.filesChanged ?? 0;
}

export function compactWorkstationNumber(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 10_000) return `${Math.round(value / 1_000)}k`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return String(value);
}

export function rankAgentSessions<T extends AgentSession>(sessions: readonly T[], limit?: number): T[] {
  const ranked = [...sessions].sort((a, b) => {
    const rank = STATUS_RANK[a.status] - STATUS_RANK[b.status];
    if (rank !== 0) return rank;
    return b.startedAt - a.startedAt;
  });
  return typeof limit === "number" ? ranked.slice(0, limit) : ranked;
}

function collectChangedFileKeys(sessions: readonly AgentSession[]): Set<string> {
  const files = new Set<string>();
  for (const session of sessions) {
    const details = session.changedFileDetails ?? [];
    if (details.length > 0) {
      for (const detail of details) files.add(detail.path);
      continue;
    }
    for (let index = 0; index < (session.filesChanged ?? 0); index++) {
      files.add(`${session.id}:${index}`);
    }
  }
  return files;
}

export function buildWorkstationSummary({
  sessions,
  changedFilesCount = 0,
  interactiveSessionCount = 0,
}: WorkstationSummaryInput): WorkstationSummary {
  const liveSessions = sessions.filter((session) => isLiveAgentStatus(session.status));
  const attentionCount = sessions.filter(
    (session) => session.status === "waiting" || session.status === "error",
  ).length;
  const totalTokens = sessions.reduce((sum, session) => sum + session.tokensUsed, 0);
  const totalCost = sessions.reduce((sum, session) => sum + session.cost, 0);
  const peakSession = sessions.reduce<AgentSession | null>((top, session) => {
    if (!top) return session;
    return agentContextPercent(session) > agentContextPercent(top) ? session : top;
  }, null);
  const peakContextPct = peakSession ? agentContextPercent(peakSession) : 0;
  const sessionChangedFileCount = collectChangedFileKeys(sessions).size;
  const resolvedChangedFilesCount = Math.max(sessionChangedFileCount, changedFilesCount);

  return {
    sessions,
    rankedSessions: rankAgentSessions(sessions),
    liveSessions,
    liveSessionCount: liveSessions.length,
    liveRunCount: liveSessions.length + interactiveSessionCount,
    interactiveSessionCount,
    attentionCount,
    totalTokens,
    totalCost,
    peakContextPct,
    peakSession,
    tokenConfidence: tokenTelemetryConfidence(sessions),
    contextConfidence: contextTelemetryConfidence(peakSession),
    fileConfidence: fileTelemetryConfidence(sessions, resolvedChangedFilesCount),
    tracedSessionCount: sessions.filter((session) => session.role || session.handoffFrom).length,
    sessionChangedFileCount,
    changedFilesCount: resolvedChangedFilesCount,
  };
}
