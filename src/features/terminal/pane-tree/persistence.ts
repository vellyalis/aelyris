import type { ShellType } from "../../../App";
import { collectLeafIds, createLeaf } from "./operations";
import {
  PANE_ATTACH_STATES,
  PANE_HEALTH_STATES,
  PANE_LIFECYCLE_STATES,
  PANE_ROLES,
  type PaneNode,
  type PaneRole,
  type PaneScrollbackCheckpoint,
  type PaneSessionIntent,
  type TerminalLeaf,
} from "./types";

const SNAPSHOT_VERSION = 1;
const STORAGE_PREFIX = "aether:paneTree:";
const VALID_SHELLS: ShellType[] = ["powershell", "cmd", "gitbash", "wsl"];
const MAX_DEPTH = 16;

export interface PaneTreeSnapshot {
  version: typeof SNAPSHOT_VERSION;
  tree: PaneNode;
  activePaneId: string | null;
  sessionId?: string;
  layoutId?: string;
  backendBindings?: Record<string, PaneBackendBindingFingerprint>;
  paneIntents?: Record<string, PaneSessionIntent>;
}

export interface PaneBackendBindingFingerprint {
  terminalId: string;
}

interface BackendPaneTreeLayoutRecord {
  storageKey: string;
  projectPath: string;
  layoutJson: string;
  updatedAt: string;
}

export function paneTreeStorageKey(tabId: string): string {
  return `${STORAGE_PREFIX}${tabId}`;
}

export function loadPaneTreeSnapshot(
  key: string,
  fallbackShell: ShellType,
  fallbackCwd?: string,
): PaneTreeSnapshot | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    const snapshot = sanitizeSnapshot(parsed, fallbackShell, fallbackCwd);
    if (!snapshot) {
      localStorage.removeItem(key);
      return null;
    }
    return snapshot;
  } catch {
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
    return null;
  }
}

export function savePaneTreeSnapshot(key: string, snapshot: Omit<PaneTreeSnapshot, "version">): void {
  try {
    const safe = normalizeSnapshot(snapshot);
    if (!safe) return;
    localStorage.setItem(key, JSON.stringify(safe));
  } catch {
    /* ignore */
  }
}

export function deletePaneTreeSnapshot(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

export async function loadPaneTreeSnapshotFromBackend(
  key: string,
  fallbackShell: ShellType,
  fallbackCwd?: string,
): Promise<PaneTreeSnapshot | null> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const record = await invoke<BackendPaneTreeLayoutRecord | null>("get_pane_tree_layout", { storageKey: key });
    if (!record?.layoutJson) return null;
    return sanitizeSnapshot(JSON.parse(record.layoutJson), fallbackShell, fallbackCwd);
  } catch {
    return null;
  }
}

export async function savePaneTreeSnapshotToBackend(
  key: string,
  snapshot: Omit<PaneTreeSnapshot, "version">,
  projectPath = "",
): Promise<boolean> {
  try {
    const safe = normalizeSnapshot(snapshot);
    if (!safe) return false;
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("save_pane_tree_layout", {
      storageKey: key,
      projectPath,
      layoutJson: JSON.stringify(safe),
    });
    return true;
  } catch {
    return false;
  }
}

export async function deletePaneTreeSnapshotFromBackend(key: string): Promise<boolean> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("delete_pane_tree_layout", { storageKey: key });
    return true;
  } catch {
    return false;
  }
}

function normalizeSnapshot(snapshot: Omit<PaneTreeSnapshot, "version">): PaneTreeSnapshot | null {
  return sanitizeSnapshot({ ...snapshot, version: SNAPSHOT_VERSION }, "powershell");
}

function sanitizeSnapshot(value: unknown, fallbackShell: ShellType, fallbackCwd?: string): PaneTreeSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (record.version !== SNAPSHOT_VERSION) return null;

  const seenIds = new Set<string>();
  const tree = sanitizePaneNode(record.tree, fallbackShell, fallbackCwd, seenIds, 0);
  if (!tree) return null;

  const leafIds = new Set(collectLeafIds(tree));
  const activePaneId =
    typeof record.activePaneId === "string" && leafIds.has(record.activePaneId) ? record.activePaneId : null;

  const backendBindings = sanitizeBackendBindings(record.backendBindings, leafIds);
  const paneIntents = sanitizePaneIntents(record.paneIntents, leafIds);
  const sessionId = sanitizeBoundedString(record.sessionId, 160);
  const layoutId = sanitizeBoundedString(record.layoutId, 160);

  return {
    version: SNAPSHOT_VERSION,
    tree,
    activePaneId,
    ...(sessionId ? { sessionId } : {}),
    ...(layoutId ? { layoutId } : {}),
    ...(backendBindings ? { backendBindings } : {}),
    ...(paneIntents ? { paneIntents } : {}),
  };
}

function sanitizePaneNode(
  value: unknown,
  fallbackShell: ShellType,
  fallbackCwd: string | undefined,
  seenIds: Set<string>,
  depth: number,
): PaneNode | null {
  if (depth > MAX_DEPTH || !value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (record.type === "terminal") {
    return sanitizeLeaf(record, fallbackShell, fallbackCwd, seenIds);
  }
  if (record.type === "split") {
    const id = sanitizeId(record.id, "split", seenIds);
    if (!id) return null;
    const direction = record.direction === "horizontal" || record.direction === "vertical" ? record.direction : null;
    if (!direction) return null;
    const first = sanitizePaneNode(record.first, fallbackShell, fallbackCwd, seenIds, depth + 1);
    const second = sanitizePaneNode(record.second, fallbackShell, fallbackCwd, seenIds, depth + 1);
    if (!first || !second) return null;
    return {
      type: "split",
      id,
      direction,
      ratio: sanitizeRatio(record.ratio),
      first,
      second,
    };
  }
  return null;
}

function sanitizeLeaf(
  record: Record<string, unknown>,
  fallbackShell: ShellType,
  fallbackCwd: string | undefined,
  seenIds: Set<string>,
): TerminalLeaf | null {
  const id = sanitizeId(record.id, "pane", seenIds);
  if (!id) return null;
  const shell =
    typeof record.shell === "string" && VALID_SHELLS.includes(record.shell as ShellType)
      ? (record.shell as ShellType)
      : fallbackShell;
  const cwd = typeof record.cwd === "string" ? record.cwd : fallbackCwd;
  const title = sanitizeTitle(record.title);
  const role = sanitizeRole(record.role);
  return {
    ...createLeaf(shell, cwd, { title, role }),
    id,
  };
}

function sanitizeId(value: unknown, prefix: "pane" | "split", seenIds: Set<string>): string | null {
  if (typeof value !== "string") return null;
  if (!value.startsWith(`${prefix}-`) || value.length > 80 || !/^[a-z]+-[A-Za-z0-9_-]+$/.test(value)) return null;
  if (seenIds.has(value)) return null;
  seenIds.add(value);
  return value;
}

function sanitizeRatio(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0.5;
  return Math.max(0.08, Math.min(0.92, value));
}

function sanitizeTitle(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const title = value.replace(/\s+/g, " ").trim().slice(0, 48);
  return title || undefined;
}

function sanitizeRole(value: unknown): PaneRole | undefined {
  return typeof value === "string" && PANE_ROLES.includes(value as PaneRole) ? (value as PaneRole) : undefined;
}

function sanitizeBackendBindings(
  value: unknown,
  leafIds: ReadonlySet<string>,
): Record<string, PaneBackendBindingFingerprint> | undefined {
  if (!value || typeof value !== "object") return undefined;
  const bindings: Record<string, PaneBackendBindingFingerprint> = {};
  for (const [paneId, rawBinding] of Object.entries(value as Record<string, unknown>)) {
    if (!leafIds.has(paneId) || !rawBinding || typeof rawBinding !== "object") continue;
    const terminalId = sanitizeTerminalId((rawBinding as Record<string, unknown>).terminalId);
    if (terminalId) bindings[paneId] = { terminalId };
  }
  return Object.keys(bindings).length > 0 ? bindings : undefined;
}

function sanitizePaneIntents(
  value: unknown,
  leafIds: ReadonlySet<string>,
): Record<string, PaneSessionIntent> | undefined {
  if (!value || typeof value !== "object") return undefined;
  const intents: Record<string, PaneSessionIntent> = {};
  for (const [paneId, rawIntent] of Object.entries(value as Record<string, unknown>)) {
    if (!leafIds.has(paneId) || !rawIntent || typeof rawIntent !== "object") continue;
    const record = rawIntent as Record<string, unknown>;
    const terminalId = sanitizeTerminalId(record.terminalId);
    const sessionId = sanitizeBoundedString(record.sessionId, 160);
    const cwd = sanitizeBoundedString(record.cwd, 2048);
    const branch = sanitizeBoundedString(record.branch, 256);
    const command = sanitizeBoundedString(record.command, 512);
    const name = sanitizeTitle(record.name);
    const role = sanitizeRole(record.role);
    const layoutId = sanitizeBoundedString(record.layoutId, 160);
    const attachState = sanitizeLiteral(record.attachState, PANE_ATTACH_STATES);
    const health = sanitizeLiteral(record.health, PANE_HEALTH_STATES);
    const lifecycle = sanitizeLiteral(record.lifecycle, PANE_LIFECYCLE_STATES);
    const createdAt = sanitizeBoundedString(record.createdAt, 80);
    const lastActiveAt = sanitizeBoundedString(record.lastActiveAt, 80);
    const processId = sanitizeProcessId(record.processId);
    const scrollbackCheckpoint = sanitizeScrollbackCheckpoint(record.scrollbackCheckpoint);
    intents[paneId] = {
      paneId,
      ...(sessionId ? { sessionId } : {}),
      ...(terminalId ? { terminalId } : {}),
      ...(processId !== undefined ? { processId } : {}),
      ...(cwd ? { cwd } : {}),
      ...(branch ? { branch } : {}),
      ...(command ? { command } : {}),
      ...(role ? { role } : {}),
      ...(name ? { name } : {}),
      ...(layoutId ? { layoutId } : {}),
      ...(attachState ? { attachState } : {}),
      ...(health ? { health } : {}),
      ...(lifecycle ? { lifecycle } : {}),
      ...(createdAt ? { createdAt } : {}),
      ...(lastActiveAt ? { lastActiveAt } : {}),
      ...(scrollbackCheckpoint ? { scrollbackCheckpoint } : {}),
    };
  }
  return Object.keys(intents).length > 0 ? intents : undefined;
}

function sanitizeTerminalId(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const terminalId = value.trim();
  if (!terminalId || terminalId.length > 160 || /\s/.test(terminalId)) return undefined;
  return terminalId;
}

function sanitizeBoundedString(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  return normalized ? normalized.slice(0, maxLength) : undefined;
}

function sanitizeProcessId(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) return undefined;
  return value <= 999_999_999 ? value : undefined;
}

function sanitizeScrollbackCheckpoint(value: unknown): PaneScrollbackCheckpoint | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const terminalId = sanitizeTerminalId(record.terminalId);
  const cursorRow = sanitizeNonNegativeInteger(record.cursorRow);
  const cursorCol = sanitizeNonNegativeInteger(record.cursorCol);
  const visibleRows = sanitizeNonNegativeInteger(record.visibleRows);
  const scrollbackRows = sanitizeNonNegativeInteger(record.scrollbackRows);
  const byteCount = sanitizeNonNegativeInteger(record.byteCount);
  const capturedAt = sanitizeBoundedString(record.capturedAt, 80);
  const checkpoint: PaneScrollbackCheckpoint = {
    ...(terminalId ? { terminalId } : {}),
    ...(cursorRow !== undefined ? { cursorRow } : {}),
    ...(cursorCol !== undefined ? { cursorCol } : {}),
    ...(visibleRows !== undefined ? { visibleRows } : {}),
    ...(scrollbackRows !== undefined ? { scrollbackRows } : {}),
    ...(byteCount !== undefined ? { byteCount } : {}),
    ...(capturedAt ? { capturedAt } : {}),
  };
  return Object.keys(checkpoint).length > 0 ? checkpoint : undefined;
}

function sanitizeNonNegativeInteger(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) return undefined;
  return Number.isSafeInteger(value) ? value : undefined;
}

function sanitizeLiteral<const T extends readonly string[]>(value: unknown, allowed: T): T[number] | undefined {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T[number]) : undefined;
}
