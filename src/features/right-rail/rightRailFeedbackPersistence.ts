import {
  RIGHT_RAIL_EDGE_FEEDBACK_AXIS_IDS,
  RIGHT_RAIL_EDGE_FEEDBACK_AXIS_LABELS,
  RIGHT_RAIL_EDGE_FEEDBACK_STORAGE_PREFIX,
} from "./rightRailFeedbackContract";
import type { RightRailEdgeScore, RightRailEdgeScoreFeedbackEntry, RightRailEdgeScoreItem } from "./rightRailTypes";

export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
export function isRightRailEdgeFeedbackAxisId(value: unknown): value is RightRailEdgeScoreItem["id"] {
  return typeof value === "string" && RIGHT_RAIL_EDGE_FEEDBACK_AXIS_IDS.includes(value as RightRailEdgeScoreItem["id"]);
}
export function isSafeRightRailEdgeFeedbackAxisId(value: unknown): value is string {
  return typeof value === "string" && /^[a-z][a-z0-9_-]{0,31}$/.test(value);
}
export function sanitizeRightRailEdgeFeedbackAxisLabel(axisId: string, value: unknown): string {
  if (isRightRailEdgeFeedbackAxisId(axisId)) return RIGHT_RAIL_EDGE_FEEDBACK_AXIS_LABELS[axisId];
  if (typeof value !== "string") return "Legacy axis";
  const normalized = value.replace(/[^\p{L}\p{N}\s_-]/gu, "").trim().replace(/\s+/g, " ").slice(0, 32);
  return normalized.length > 0 ? normalized : "Legacy axis";
}
export function isRightRailEdgeFeedbackTrend(value: unknown): value is RightRailEdgeScoreFeedbackEntry["trend"] {
  return value === "baseline" || value === "improved" || value === "flat" || value === "regressed";
}
export function isRightRailEdgeFeedbackGrade(value: unknown): value is RightRailEdgeScore["grade"] {
  return value === "S" || value === "A" || value === "B" || value === "C" || value === "D";
}
export function sanitizeBoundedNumber(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

export function normalizeProjectPath(path?: string | null): string | null {
  if (!path) return null;
  const normalized = path.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

export function rightRailWorkspaceStorageHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function rightRailEdgeFeedbackStorageKey(projectPath: string): string | null {
  const normalized = normalizeProjectPath(projectPath);
  if (!normalized) return null;
  return `${RIGHT_RAIL_EDGE_FEEDBACK_STORAGE_PREFIX}${rightRailWorkspaceStorageHash(normalized)}`;
}
