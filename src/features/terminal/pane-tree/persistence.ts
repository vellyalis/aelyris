import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import type { ShellType } from "../../../shared/types/terminalPane";
import { formatFallbackError, reportFallback } from "../../../shared/lib/fallbackTelemetry";
import { isTauriRuntime } from "../../../shared/lib/tauriRuntime";
import { collectLeafIds, createLeaf, createLeafWithId } from "./operations";
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
const CONTROL_CHAR_RANGE = "\\u0000-\\u001f\\u007f";
const CONTROL_CHARS_REGEX = new RegExp(`[${CONTROL_CHAR_RANGE}]`, "g");

function reportPaneTreePersistenceFailure(operation: string, err: unknown, severity: "info" | "warning" = "warning") {
  reportFallback({
    source: "pane-tree-persistence",
    operation,
    severity,
    message: formatFallbackError(err),
    userVisible: true,
  });
}

export interface PaneTreeSnapshot {
  version: typeof SNAPSHOT_VERSION;
  tree: PaneNode;
  activePaneId: string | null;
  sessionId?: string;
  layoutId?: string;
  muxWorkspaceId?: string;
  synchronizedPanes?: boolean;
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

interface MuxGraphSnapshot {
  version: number;
  activeWorkspaceId: string;
  workspaces: Record<string, MuxWorkspaceRecord>;
}

interface MuxWorkspaceRecord {
  id: string;
  name?: string;
  activeWindowId: string;
  windows: Record<string, MuxWindowRecord>;
}

interface MuxWindowRecord {
  id: string;
  activeTabId: string;
  tabs: Record<string, MuxTabRecord>;
}

interface MuxTabRecord {
  id: string;
  title?: string;
  layout: {
    root: MuxLayoutNode;
    activePaneId: string;
  };
  panes: Record<string, MuxPaneRecord>;
  synchronizedPanes?: boolean;
}

type MuxLayoutNode =
  | { kind: "pane"; paneId?: string; pane_id?: string }
  | { kind: "split"; axis: "horizontal" | "vertical"; ratio: number; first: MuxLayoutNode; second: MuxLayoutNode };

interface MuxPaneRecord {
  id: string;
  title?: string;
  shell?: string;
  cwd?: string;
  role?: string | null;
  lifecycle?: unknown;
  pty?: {
    terminalId?: string;
    processId?: number | null;
    cols?: number;
    rows?: number;
  } | null;
  project?: {
    branch?: string | null;
  } | null;
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
      reportPaneTreePersistenceFailure(
        "local_snapshot_invalid",
        `Pane tree snapshot ${key} failed validation`,
        "warning",
      );
      try {
        localStorage.removeItem(key);
      } catch (err) {
        reportPaneTreePersistenceFailure("local_remove_invalid_snapshot", err, "warning");
      }
      return null;
    }
    return snapshot;
  } catch (err) {
    reportPaneTreePersistenceFailure("local_load_snapshot", err, "warning");
    try {
      localStorage.removeItem(key);
    } catch (removeErr) {
      reportPaneTreePersistenceFailure("local_remove_after_load_failure", removeErr, "warning");
    }
    return null;
  }
}

export function savePaneTreeSnapshot(key: string, snapshot: Omit<PaneTreeSnapshot, "version">): void {
  try {
    const safe = normalizeSnapshot(snapshot);
    if (!safe) {
      reportPaneTreePersistenceFailure(
        "local_save_invalid_snapshot",
        `Pane tree snapshot ${key} failed validation`,
        "warning",
      );
      return;
    }
    localStorage.setItem(key, JSON.stringify(safe));
  } catch (err) {
    reportPaneTreePersistenceFailure("local_save_snapshot", err, "warning");
  }
}

export function deletePaneTreeSnapshot(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch (err) {
    reportPaneTreePersistenceFailure("local_delete_snapshot", err, "warning");
  }
}

export async function loadPaneTreeSnapshotFromBackend(
  key: string,
  fallbackShell: ShellType,
  fallbackCwd?: string,
): Promise<PaneTreeSnapshot | null> {
  if (!isTauriRuntime()) return null;
  try {
    const { invoke } = await Promise.resolve({ invoke: tauriInvoke });
    const record = await invoke<BackendPaneTreeLayoutRecord | null>("get_pane_tree_layout", { storageKey: key });
    if (!record?.layoutJson) return null;
    const snapshot = sanitizeSnapshot(JSON.parse(record.layoutJson), fallbackShell, fallbackCwd);
    if (!snapshot)
      reportPaneTreePersistenceFailure(
        "backend_snapshot_invalid",
        `Backend pane tree snapshot ${key} failed validation`,
        "warning",
      );
    return snapshot;
  } catch (err) {
    reportPaneTreePersistenceFailure("backend_load_snapshot", err, "warning");
    return null;
  }
}

export async function loadPaneTreeSnapshotFromMux(
  workspaceId: string,
  fallbackShell: ShellType,
  fallbackCwd?: string,
): Promise<PaneTreeSnapshot | null> {
  if (!isTauriRuntime()) return null;
  try {
    const { invoke } = await Promise.resolve({ invoke: tauriInvoke });
    const graph = await invoke<MuxGraphSnapshot | null>("mux_get_workspace", { workspaceId });
    const snapshot = graph ? paneTreeSnapshotFromMuxGraph(graph, fallbackShell, fallbackCwd) : null;
    if (graph && !snapshot) {
      reportPaneTreePersistenceFailure(
        "mux_snapshot_invalid",
        `Mux workspace snapshot ${workspaceId} failed validation`,
        "warning",
      );
    }
    return snapshot;
  } catch (err) {
    reportPaneTreePersistenceFailure("mux_load_snapshot", err, "warning");
    return null;
  }
}

export function muxWorkspaceIdCandidates(
  snapshot: PaneTreeSnapshot | null | undefined,
  fallbackStorageKey?: string,
): string[] {
  const candidates = new Set<string>();
  const add = (value: unknown) => {
    const id = sanitizeTerminalId(value);
    if (id) candidates.add(id);
  };
  add(snapshot?.muxWorkspaceId);
  if (snapshot?.activePaneId) add(snapshot.backendBindings?.[snapshot.activePaneId]?.terminalId);
  for (const binding of Object.values(snapshot?.backendBindings ?? {})) add(binding.terminalId);
  for (const intent of Object.values(snapshot?.paneIntents ?? {})) add(intent.terminalId);
  add(snapshot?.sessionId);
  add(snapshot?.layoutId);
  add(fallbackStorageKey);
  return [...candidates];
}

export function paneTreeSnapshotFromMuxGraph(
  graph: MuxGraphSnapshot,
  fallbackShell: ShellType,
  fallbackCwd?: string,
): PaneTreeSnapshot | null {
  if (!graph || graph.version !== 1 || !graph.activeWorkspaceId) return null;
  const workspace = graph.workspaces?.[graph.activeWorkspaceId];
  const window = workspace?.windows?.[workspace.activeWindowId];
  const tab = window?.tabs?.[window.activeTabId];
  if (!workspace || !window || !tab) return null;

  const seenIds = new Set<string>();
  const tree = muxLayoutNodeToPaneNode(tab.layout?.root, tab.panes, fallbackShell, fallbackCwd, seenIds, "root");
  if (!tree) return null;

  const leafIds = new Set(collectLeafIds(tree));
  const activePaneId = leafIds.has(tab.layout?.activePaneId)
    ? tab.layout.activePaneId
    : (collectLeafIds(tree)[0] ?? null);
  const backendBindings: Record<string, PaneBackendBindingFingerprint> = {};
  const paneIntents: Record<string, PaneSessionIntent> = {};
  for (const paneId of leafIds) {
    const pane = tab.panes[paneId];
    if (!pane) continue;
    const terminalId = sanitizeTerminalId(pane.pty?.terminalId) ?? paneId;
    if (terminalId) backendBindings[paneId] = { terminalId };
    const lifecycle = muxLifecycleToPaneLifecycle(pane.lifecycle);
    paneIntents[paneId] = {
      paneId,
      terminalId,
      ...(sanitizeProcessId(pane.pty?.processId) ? { processId: sanitizeProcessId(pane.pty?.processId) } : {}),
      ...(sanitizeBoundedString(pane.cwd, 2048) ? { cwd: sanitizeBoundedString(pane.cwd, 2048) } : {}),
      ...(sanitizeBoundedString(pane.project?.branch, 256)
        ? { branch: sanitizeBoundedString(pane.project?.branch, 256) }
        : {}),
      ...(sanitizeTitle(pane.title) ? { name: sanitizeTitle(pane.title) } : {}),
      ...(sanitizeRole(pane.role) ? { role: sanitizeRole(pane.role) } : {}),
      sessionId: graph.activeWorkspaceId,
      layoutId: tab.id,
      lifecycle,
      attachState: lifecycle === "live" ? "attached" : lifecycle === "detached" ? "detached" : "ended",
      health:
        lifecycle === "live"
          ? "healthy"
          : lifecycle === "exited"
            ? "exited"
            : lifecycle === "crashed"
              ? "crashed"
              : "unknown",
    };
  }

  return {
    version: SNAPSHOT_VERSION,
    tree,
    activePaneId,
    sessionId: graph.activeWorkspaceId,
    layoutId: tab.id,
    muxWorkspaceId: graph.activeWorkspaceId,
    synchronizedPanes: tab.synchronizedPanes === true,
    ...(Object.keys(backendBindings).length ? { backendBindings } : {}),
    ...(Object.keys(paneIntents).length ? { paneIntents } : {}),
  };
}

export async function savePaneTreeSnapshotToBackend(
  key: string,
  snapshot: Omit<PaneTreeSnapshot, "version">,
  projectPath = "",
): Promise<boolean> {
  if (!isTauriRuntime()) return false;
  try {
    const safe = normalizeSnapshot(snapshot);
    if (!safe) {
      reportPaneTreePersistenceFailure(
        "backend_save_invalid_snapshot",
        `Pane tree snapshot ${key} failed validation`,
        "warning",
      );
      return false;
    }
    const { invoke } = await Promise.resolve({ invoke: tauriInvoke });
    await invoke("save_pane_tree_layout", {
      storageKey: key,
      projectPath,
      layoutJson: JSON.stringify(safe),
    });
    return true;
  } catch (err) {
    reportPaneTreePersistenceFailure("backend_save_snapshot", err, "warning");
    return false;
  }
}

export async function deletePaneTreeSnapshotFromBackend(key: string): Promise<boolean> {
  if (!isTauriRuntime()) return false;
  try {
    const { invoke } = await Promise.resolve({ invoke: tauriInvoke });
    await invoke("delete_pane_tree_layout", { storageKey: key });
    return true;
  } catch (err) {
    reportPaneTreePersistenceFailure("backend_delete_snapshot", err, "warning");
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
  const muxWorkspaceId = sanitizeTerminalId(record.muxWorkspaceId);
  const synchronizedPanes = record.synchronizedPanes === true;

  return {
    version: SNAPSHOT_VERSION,
    tree,
    activePaneId,
    ...(sessionId ? { sessionId } : {}),
    ...(layoutId ? { layoutId } : {}),
    ...(muxWorkspaceId ? { muxWorkspaceId } : {}),
    ...(synchronizedPanes ? { synchronizedPanes } : {}),
    ...(backendBindings ? { backendBindings } : {}),
    ...(paneIntents ? { paneIntents } : {}),
  };
}

function muxLayoutNodeToPaneNode(
  node: MuxLayoutNode | undefined,
  panes: Record<string, MuxPaneRecord>,
  fallbackShell: ShellType,
  fallbackCwd: string | undefined,
  seenIds: Set<string>,
  path: string,
): PaneNode | null {
  if (!node) return null;
  if (node.kind === "pane") {
    const paneId = sanitizePaneId(node.paneId ?? node.pane_id, seenIds);
    if (!paneId) return null;
    const pane = panes[paneId];
    if (!pane) return null;
    return createLeafWithId(
      paneId,
      sanitizeShell(pane.shell, fallbackShell),
      sanitizeBoundedString(pane.cwd, 2048) ?? fallbackCwd,
      {
        title: sanitizeTitle(pane.title),
        role: sanitizeRole(pane.role),
      },
    );
  }
  if (node.kind === "split") {
    const first = muxLayoutNodeToPaneNode(node.first, panes, fallbackShell, fallbackCwd, seenIds, `${path}-a`);
    const second = muxLayoutNodeToPaneNode(node.second, panes, fallbackShell, fallbackCwd, seenIds, `${path}-b`);
    if (!first || !second) return null;
    return {
      type: "split",
      id: uniqueSyntheticSplitId(`split-mux-${path}`, seenIds),
      direction: node.axis === "vertical" ? "vertical" : "horizontal",
      ratio: sanitizeRatio(node.ratio),
      first,
      second,
    };
  }
  return null;
}

function sanitizeShell(value: unknown, fallbackShell: ShellType): ShellType {
  return typeof value === "string" && VALID_SHELLS.includes(value as ShellType) ? (value as ShellType) : fallbackShell;
}

function muxLifecycleToPaneLifecycle(value: unknown): PaneSessionIntent["lifecycle"] {
  if (value === "active") return "live";
  if (value === "detached") return "detached";
  if (typeof value === "object" && value !== null && "exited" in value) return "exited";
  if (typeof value === "object" && value !== null && "dead" in value) return "crashed";
  return "detached";
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
    const id = sanitizeSplitId(record.id, seenIds);
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
  const id = sanitizePaneId(record.id, seenIds);
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

function sanitizeSplitId(value: unknown, seenIds: Set<string>): string | null {
  if (typeof value !== "string") return null;
  if (!value.startsWith("split-") || value.length > 80 || !/^[a-z]+-[A-Za-z0-9_-]+$/.test(value)) return null;
  if (seenIds.has(value)) return null;
  seenIds.add(value);
  return value;
}

function sanitizePaneId(value: unknown, seenIds: Set<string>): string | null {
  if (typeof value !== "string") return null;
  const id = value.trim();
  if (!id || id.length > 160 || CONTROL_CHARS_REGEX.test(id) || /\s/.test(id)) return null;
  CONTROL_CHARS_REGEX.lastIndex = 0;
  if (seenIds.has(id)) return null;
  seenIds.add(id);
  return id;
}

function uniqueSyntheticSplitId(base: string, seenIds: Set<string>): string {
  const normalized = base.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 72) || "split-mux";
  let candidate = normalized.startsWith("split-") ? normalized : `split-${normalized}`;
  let index = 1;
  while (seenIds.has(candidate)) {
    candidate = `${normalized}-${index++}`;
  }
  seenIds.add(candidate);
  return candidate;
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
  const normalized = value.replace(CONTROL_CHARS_REGEX, " ").replace(/\s+/g, " ").trim();
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
