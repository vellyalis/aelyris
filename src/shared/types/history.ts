/**
 * Phase 3B-2 — types for semantic command history search.
 *
 * Mirrors `src-tauri/src/history/types.rs` and the IPC surface in
 * `src-tauri/src/ipc/history_commands.rs`.
 */

export interface HistoryEntry {
  command_id: number;
  command: string;
  cwd: string;
  exit_code: number | null;
  executed_at: string;
}

export interface SearchFilters {
  since?: string;
  until?: string;
  cwd_prefix?: string;
  only_failed?: boolean;
}

export interface SearchHit {
  entry: HistoryEntry;
  score: number;
}

/** Human-readable relative time ("2 hours ago") for SQLite UTC timestamps. */
export function formatExecutedAt(isoLike: string): string {
  // SQLite's `datetime('now')` emits "YYYY-MM-DD HH:MM:SS" in UTC without a
  // timezone suffix. Coerce to a value Date() will parse as UTC.
  const parsed = new Date(`${isoLike.replace(" ", "T")}Z`);
  if (Number.isNaN(parsed.getTime())) return isoLike;

  const diffMs = Date.now() - parsed.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return "just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d ago`;
  return parsed.toLocaleDateString();
}
