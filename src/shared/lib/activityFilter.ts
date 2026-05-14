import type { AgentLog, AgentSession } from "../types/agent";
import { extractToolName } from "../types/toolBadge";

export type LogType = AgentLog["type"];

export const LOG_TYPES: readonly LogType[] = ["text", "tool_use", "tool_result", "error", "system"] as const;

export interface ActivityEntry extends AgentLog {
  sessionId: string;
  sessionName: string;
}

export interface ActivityFilter {
  /** Case-insensitive substring match against content + tool name. Empty = no text filter. */
  query: string;
  /** Allowed log types. Empty set = all types allowed. */
  types: ReadonlySet<LogType>;
  /** Allowed session IDs. Empty set = all sessions allowed. */
  sessionIds: ReadonlySet<string>;
}

export interface CollectActivityOptions {
  limit?: number;
}

export const EMPTY_FILTER: ActivityFilter = {
  query: "",
  types: new Set(),
  sessionIds: new Set(),
};

function insertByTimestampDesc(entries: ActivityEntry[], entry: ActivityEntry, limit: number): void {
  let lo = 0;
  let hi = entries.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (entries[mid].timestamp < entry.timestamp) hi = mid;
    else lo = mid + 1;
  }
  if (lo >= limit) return;
  entries.splice(lo, 0, entry);
  if (entries.length > limit) entries.length = limit;
}

/** Build a flat, time-desc-sorted activity list from all sessions. */
export function collectActivity(
  sessions: readonly AgentSession[],
  options: CollectActivityOptions = {},
): ActivityEntry[] {
  const limit = options.limit;
  const out: ActivityEntry[] = [];
  for (const s of sessions) {
    for (const log of s.logs) {
      const entry = { ...log, sessionId: s.id, sessionName: s.name };
      if (typeof limit === "number" && limit > 0) insertByTimestampDesc(out, entry, limit);
      else out.push(entry);
    }
  }
  if (typeof limit !== "number" || limit <= 0) out.sort((a, b) => b.timestamp - a.timestamp);
  return out;
}

/** Apply filter criteria to an activity list. Pure function, stable. */
export function filterActivity(entries: readonly ActivityEntry[], filter: ActivityFilter): ActivityEntry[] {
  const q = filter.query.trim().toLowerCase();
  const typeAll = filter.types.size === 0;
  const sessionAll = filter.sessionIds.size === 0;
  if (!q && typeAll && sessionAll) return [...entries];

  const out: ActivityEntry[] = [];
  for (const e of entries) {
    if (!typeAll && !filter.types.has(e.type)) continue;
    if (!sessionAll && !filter.sessionIds.has(e.sessionId)) continue;
    if (q) {
      const toolName = e.type === "tool_use" ? (extractToolName(e.content) ?? "") : "";
      const haystack = `${e.content} ${toolName} ${e.sessionName}`.toLowerCase();
      if (!haystack.includes(q)) continue;
    }
    out.push(e);
  }
  return out;
}
