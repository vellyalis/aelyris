import { RIGHT_RAIL_EDGE_FEEDBACK_STORAGE_PREFIX } from "./rightRailFeedbackContract";

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
