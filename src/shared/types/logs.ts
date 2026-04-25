/**
 * Mirror of `src-tauri/src/logging::LogEntry`. Field names are
 * snake_case to match `serde`'s default rename strategy.
 */
export interface LogEntry {
  /** Monotonic counter assigned at emit time. Used to fetch deltas. */
  seq: number;
  /** Wall-clock timestamp at emit time in milliseconds since UNIX epoch. */
  timestamp_ms: number;
  /** Uppercase level name: `TRACE` | `DEBUG` | `INFO` | `WARN` | `ERROR`. */
  level: string;
  /** Module path / target the event originated from. */
  target: string;
  /** Formatted log message. */
  message: string;
  /** Extra structured fields, stringified on the Rust side. */
  fields: Record<string, string>;
}

export type LogLevel = "TRACE" | "DEBUG" | "INFO" | "WARN" | "ERROR";

export const LOG_LEVELS: readonly LogLevel[] = ["TRACE", "DEBUG", "INFO", "WARN", "ERROR"] as const;

const LEVEL_RANK: Record<string, number> = {
  TRACE: 0,
  DEBUG: 1,
  INFO: 2,
  WARN: 3,
  ERROR: 4,
};

/**
 * True iff `level` is at or above `min`. Unknown levels rank as
 * `INFO` so a future Rust-side level addition does not silently drop
 * entries from the viewer.
 */
export function levelAtLeast(level: string, min: LogLevel): boolean {
  const have = LEVEL_RANK[level] ?? LEVEL_RANK.INFO;
  const need = LEVEL_RANK[min];
  return have >= need;
}
