import { reportInvokeFailure } from "./fallbackTelemetry";

const STORAGE_KEY = "aether:recentCommands";
const MAX_RECENT = 6;

/** Load the recently-used command ID list (most recent first). */
export function loadRecentCommands(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is string => typeof v === "string").slice(0, MAX_RECENT);
  } catch (err) {
    reportInvokeFailure({
      source: "recent-commands",
      operation: "load_recent_commands",
      err,
      severity: "info",
      userVisible: true,
    });
    return [];
  }
}

/** Move commandId to the front of the recent list, dedupe, cap at MAX_RECENT. */
export function recordRecentCommand(commandId: string): string[] {
  const next = dedupePrepend(loadRecentCommands(), commandId).slice(0, MAX_RECENT);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch (err) {
    reportInvokeFailure({
      source: "recent-commands",
      operation: "persist_recent_commands",
      err,
      userVisible: true,
    });
  }
  return next;
}

export function dedupePrepend(list: readonly string[], id: string): string[] {
  return [id, ...list.filter((x) => x !== id)];
}

export { MAX_RECENT };
