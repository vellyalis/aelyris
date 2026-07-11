export type WorkspaceDensity = "focus" | "balanced" | "dense";

export type WorkspaceDashboardPortMode = "workspace-stable" | "explicit" | "disabled";

export interface WorkspaceDashboardPortPolicy {
  mode: WorkspaceDashboardPortMode;
  basePort: number;
  span: number;
  explicitPort?: number | null;
}

export interface WorkspaceNotificationPolicy {
  browser: boolean;
  localJson: boolean;
  jsonl: boolean;
  trueDecisionOnly: boolean;
}

export interface WorkspacePaneLayoutPolicy {
  density: WorkspaceDensity;
  sidebarCollapsed: boolean;
  sidebarWidth: number;
  rightPanelWidth: number;
  rightRailMode: "command" | "review" | "observe";
}

export interface WorkspaceRiskPolicy {
  approvalRequired: boolean;
  blockUnsafePaths: boolean;
  safePaths: string[];
}

export interface WorkspaceContextPolicy {
  includeAudit: boolean;
  includeDiff: boolean;
  maxFiles: number;
  maxTokens: number;
  redactSecrets: boolean;
}

export interface WorkspaceProfileDefaults {
  defaultShell: string;
  preferredModel: string;
  agents: string[];
  workflows: string[];
  watchRules: string[];
  dashboardPortPolicy: WorkspaceDashboardPortPolicy;
  notificationPolicy: WorkspaceNotificationPolicy;
  visualDensity: WorkspaceDensity;
  paneLayout: WorkspacePaneLayoutPolicy;
  riskPolicy: WorkspaceRiskPolicy;
  contextPolicy: WorkspaceContextPolicy;
}

export interface WorkspaceProfileOverride {
  defaultShell?: string;
  preferredModel?: string;
  agents?: string[];
  workflows?: string[];
  watchRules?: string[];
  safePaths?: string[];
  dashboardPortPolicy?: Partial<WorkspaceDashboardPortPolicy>;
  notificationPolicy?: Partial<WorkspaceNotificationPolicy>;
  visualDensity?: WorkspaceDensity;
  paneLayout?: Partial<WorkspacePaneLayoutPolicy>;
  riskPolicy?: Partial<WorkspaceRiskPolicy>;
  contextPolicy?: Partial<WorkspaceContextPolicy>;
}

export interface WorkspaceThreadRunState {
  threadId: string;
  status: "idle" | "active" | "blocked" | "complete";
  activePaneId?: string | null;
  activeRoadmapId?: string | null;
  lastValidationId?: string | null;
  lastActiveAt?: string | null;
}

export interface WorkspaceProfileState {
  version: 1;
  globalDefaults: WorkspaceProfileDefaults;
  workspaceOverrides: Record<string, WorkspaceProfileOverride>;
  threadRunState: Record<string, Record<string, WorkspaceThreadRunState>>;
}

export interface ResolvedWorkspaceProfile extends WorkspaceProfileDefaults {
  version: 1;
  profileId: string;
  workspaceRoot: string;
  threadId: string;
  safePaths: string[];
  dashboardPort: number | null;
  monitoringScope: {
    workspaceRoot: string;
    threadId: string;
    isolateEvents: true;
  };
  runState: WorkspaceThreadRunState;
}

export interface WorkspaceScopedEvent {
  workspaceId?: string | null;
  workspace?: string | null;
  workspaceRoot?: string | null;
  threadId?: string | null;
  metadata?: Record<string, unknown>;
}

const DEFAULT_DASHBOARD_BASE_PORT = 47820;
const DEFAULT_DASHBOARD_PORT_SPAN = 1200;

export const DEFAULT_WORKSPACE_PROFILE_DEFAULTS: WorkspaceProfileDefaults = {
  defaultShell: "powershell",
  preferredModel: "claude-sonnet",
  agents: ["coder", "reviewer"],
  workflows: [],
  watchRules: [],
  dashboardPortPolicy: {
    mode: "workspace-stable",
    basePort: DEFAULT_DASHBOARD_BASE_PORT,
    span: DEFAULT_DASHBOARD_PORT_SPAN,
    explicitPort: null,
  },
  notificationPolicy: {
    browser: true,
    localJson: true,
    jsonl: true,
    trueDecisionOnly: true,
  },
  visualDensity: "balanced",
  paneLayout: {
    density: "balanced",
    sidebarCollapsed: false,
    sidebarWidth: 240,
    rightPanelWidth: 320,
    rightRailMode: "command",
  },
  riskPolicy: {
    approvalRequired: true,
    blockUnsafePaths: true,
    safePaths: [],
  },
  contextPolicy: {
    includeAudit: true,
    includeDiff: true,
    maxFiles: 40,
    maxTokens: 120_000,
    redactSecrets: true,
  },
};

export function createWorkspaceProfileState(defaults: Partial<WorkspaceProfileDefaults> = {}): WorkspaceProfileState {
  return {
    version: 1,
    globalDefaults: mergeDefaults(DEFAULT_WORKSPACE_PROFILE_DEFAULTS, defaults),
    workspaceOverrides: {},
    threadRunState: {},
  };
}

export function parseWorkspaceProfileState(raw: string | null | undefined): WorkspaceProfileState {
  if (!raw) return createWorkspaceProfileState();
  try {
    const parsed = JSON.parse(raw) as Partial<WorkspaceProfileState>;
    return normalizeWorkspaceProfileState(parsed);
  } catch {
    return createWorkspaceProfileState();
  }
}

export function normalizeWorkspaceRoot(path: string | null | undefined): string {
  const normalized = String(path ?? "workspace")
    .replace(/\\/g, "/")
    .replace(/\/+/g, "/")
    .replace(/\/$/, "");
  return normalized || "workspace";
}

export function workspaceProfileKey(workspaceRoot: string): string {
  return normalizeWorkspaceRoot(workspaceRoot).toLowerCase();
}

export function stableWorkspaceDashboardPort(
  workspaceRoot: string,
  policy: WorkspaceDashboardPortPolicy = DEFAULT_WORKSPACE_PROFILE_DEFAULTS.dashboardPortPolicy,
): number | null {
  if (policy.mode === "disabled") return null;
  if (policy.mode === "explicit" && Number.isFinite(policy.explicitPort ?? NaN)) {
    return clampPort(Number(policy.explicitPort));
  }
  const basePort = clampPort(policy.basePort || DEFAULT_DASHBOARD_BASE_PORT);
  const span = Math.max(1, Math.min(10_000, Math.round(policy.span || DEFAULT_DASHBOARD_PORT_SPAN)));
  let hash = 2166136261;
  for (const char of normalizeWorkspaceRoot(workspaceRoot).toLowerCase()) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return clampPort(basePort + (Math.abs(hash) % span));
}

export function buildWorkspaceProfile(input: {
  state?: WorkspaceProfileState;
  workspaceRoot: string | null | undefined;
  threadId: string | null | undefined;
  override?: WorkspaceProfileOverride;
}): ResolvedWorkspaceProfile {
  const state = normalizeWorkspaceProfileState(input.state ?? createWorkspaceProfileState());
  const workspaceRoot = normalizeWorkspaceRoot(input.workspaceRoot);
  const key = workspaceProfileKey(workspaceRoot);
  const workspaceOverride = {
    ...(state.workspaceOverrides[key] ?? {}),
    ...(input.override ?? {}),
  };
  const defaults = state.globalDefaults;
  const dashboardPortPolicy = {
    ...defaults.dashboardPortPolicy,
    ...(workspaceOverride.dashboardPortPolicy ?? {}),
  };
  const riskPolicy = {
    ...defaults.riskPolicy,
    ...(workspaceOverride.riskPolicy ?? {}),
    safePaths: normalizedUniquePaths([
      ...defaults.riskPolicy.safePaths,
      workspaceRoot,
      ...(workspaceOverride.safePaths ?? []),
      ...(workspaceOverride.riskPolicy?.safePaths ?? []),
    ]),
  };
  const paneLayout = {
    ...defaults.paneLayout,
    ...(workspaceOverride.paneLayout ?? {}),
    density: workspaceOverride.visualDensity ?? workspaceOverride.paneLayout?.density ?? defaults.visualDensity,
  };
  const threadId = String(input.threadId || "default-thread");
  const runState =
    state.threadRunState[key]?.[threadId] ??
    ({
      threadId,
      status: "idle",
      activePaneId: null,
      activeRoadmapId: null,
      lastValidationId: null,
      lastActiveAt: null,
    } satisfies WorkspaceThreadRunState);
  const dashboardPort = stableWorkspaceDashboardPort(workspaceRoot, dashboardPortPolicy);

  return {
    version: 1,
    profileId: profileId(workspaceRoot, threadId),
    workspaceRoot,
    threadId,
    defaultShell: workspaceOverride.defaultShell ?? defaults.defaultShell,
    preferredModel: workspaceOverride.preferredModel ?? defaults.preferredModel,
    agents: workspaceOverride.agents ?? defaults.agents,
    workflows: workspaceOverride.workflows ?? defaults.workflows,
    watchRules: workspaceOverride.watchRules ?? defaults.watchRules,
    dashboardPortPolicy,
    dashboardPort,
    notificationPolicy: {
      ...defaults.notificationPolicy,
      ...(workspaceOverride.notificationPolicy ?? {}),
    },
    visualDensity: paneLayout.density,
    paneLayout,
    riskPolicy,
    contextPolicy: {
      ...defaults.contextPolicy,
      ...(workspaceOverride.contextPolicy ?? {}),
    },
    safePaths: riskPolicy.safePaths,
    monitoringScope: {
      workspaceRoot,
      threadId,
      isolateEvents: true,
    },
    runState,
  };
}

export function upsertWorkspaceProfileOverride(
  state: WorkspaceProfileState,
  workspaceRoot: string,
  override: WorkspaceProfileOverride,
): WorkspaceProfileState {
  const normalized = normalizeWorkspaceProfileState(state);
  const key = workspaceProfileKey(workspaceRoot);
  return {
    ...normalized,
    workspaceOverrides: {
      ...normalized.workspaceOverrides,
      [key]: {
        ...(normalized.workspaceOverrides[key] ?? {}),
        ...override,
      },
    },
  };
}

export function upsertThreadRunState(
  state: WorkspaceProfileState,
  workspaceRoot: string,
  threadId: string,
  patch: Partial<WorkspaceThreadRunState>,
): WorkspaceProfileState {
  const normalized = normalizeWorkspaceProfileState(state);
  const workspaceKey = workspaceProfileKey(workspaceRoot);
  const current = normalized.threadRunState[workspaceKey]?.[threadId] ?? {
    threadId,
    status: "idle",
    activePaneId: null,
    activeRoadmapId: null,
    lastValidationId: null,
    lastActiveAt: null,
  };
  const nextThread = {
    ...current,
    ...patch,
    threadId,
  };
  return {
    ...normalized,
    threadRunState: {
      ...normalized.threadRunState,
      [workspaceKey]: {
        ...(normalized.threadRunState[workspaceKey] ?? {}),
        [threadId]: nextThread,
      },
    },
  };
}

export function filterWorkspaceScopedEvents<T extends WorkspaceScopedEvent>(
  events: T[],
  profile: Pick<ResolvedWorkspaceProfile, "workspaceRoot" | "threadId">,
): T[] {
  const workspaceKey = workspaceProfileKey(profile.workspaceRoot);
  return events.filter((event) => {
    const eventWorkspace =
      event.workspaceId ??
      event.workspaceRoot ??
      event.workspace ??
      (typeof event.metadata?.workspaceId === "string" ? event.metadata.workspaceId : null) ??
      (typeof event.metadata?.workspaceRoot === "string" ? event.metadata.workspaceRoot : null) ??
      (typeof event.metadata?.cwd === "string" ? event.metadata.cwd : null);
    if (eventWorkspace && workspaceProfileKey(eventWorkspace) !== workspaceKey) return false;

    const eventThread =
      event.threadId ??
      (typeof event.metadata?.threadId === "string" ? event.metadata.threadId : null) ??
      (typeof event.metadata?.activeTabId === "string" ? event.metadata.activeTabId : null);
    if (eventThread && eventThread !== profile.threadId) return false;

    return true;
  });
}

function normalizeWorkspaceProfileState(input: Partial<WorkspaceProfileState>): WorkspaceProfileState {
  const defaults = mergeDefaults(DEFAULT_WORKSPACE_PROFILE_DEFAULTS, input.globalDefaults ?? {});
  const workspaceOverrides: Record<string, WorkspaceProfileOverride> = {};
  for (const [key, value] of Object.entries(input.workspaceOverrides ?? {})) {
    workspaceOverrides[workspaceProfileKey(key)] = normalizeOverride(value);
  }
  const threadRunState: WorkspaceProfileState["threadRunState"] = {};
  for (const [workspace, threads] of Object.entries(input.threadRunState ?? {})) {
    const workspaceKey = workspaceProfileKey(workspace);
    threadRunState[workspaceKey] = {};
    for (const [threadId, state] of Object.entries(threads ?? {})) {
      threadRunState[workspaceKey][threadId] = {
        threadId,
        status: isRunStatus(state?.status) ? state.status : "idle",
        activePaneId: state?.activePaneId ?? null,
        activeRoadmapId: state?.activeRoadmapId ?? null,
        lastValidationId: state?.lastValidationId ?? null,
        lastActiveAt: state?.lastActiveAt ?? null,
      };
    }
  }
  return {
    version: 1,
    globalDefaults: defaults,
    workspaceOverrides,
    threadRunState,
  };
}

function mergeDefaults(
  base: WorkspaceProfileDefaults,
  patch: Partial<WorkspaceProfileDefaults>,
): WorkspaceProfileDefaults {
  return {
    ...base,
    ...patch,
    dashboardPortPolicy: { ...base.dashboardPortPolicy, ...(patch.dashboardPortPolicy ?? {}) },
    notificationPolicy: { ...base.notificationPolicy, ...(patch.notificationPolicy ?? {}) },
    paneLayout: { ...base.paneLayout, ...(patch.paneLayout ?? {}) },
    riskPolicy: {
      ...base.riskPolicy,
      ...(patch.riskPolicy ?? {}),
      safePaths: normalizedUniquePaths([...(base.riskPolicy.safePaths ?? []), ...(patch.riskPolicy?.safePaths ?? [])]),
    },
    contextPolicy: { ...base.contextPolicy, ...(patch.contextPolicy ?? {}) },
  };
}

function normalizeOverride(value: WorkspaceProfileOverride | undefined): WorkspaceProfileOverride {
  const override = value ?? {};
  return {
    ...override,
    safePaths: override.safePaths ? normalizedUniquePaths(override.safePaths) : undefined,
    riskPolicy: override.riskPolicy
      ? {
          ...override.riskPolicy,
          safePaths: override.riskPolicy.safePaths ? normalizedUniquePaths(override.riskPolicy.safePaths) : undefined,
        }
      : undefined,
  };
}

function normalizedUniquePaths(paths: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const path of paths) {
    if (!path) continue;
    const normalized = normalizeWorkspaceRoot(path);
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
  }
  return out;
}

function profileId(workspaceRoot: string, threadId: string): string {
  return `${hashText(`${normalizeWorkspaceRoot(workspaceRoot).toLowerCase()}::${threadId}`).toString(16)}`;
}

function hashText(text: string): number {
  let hash = 2166136261;
  for (const char of text) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function clampPort(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_DASHBOARD_BASE_PORT;
  return Math.max(1, Math.min(65535, Math.round(value)));
}

function isRunStatus(value: unknown): value is WorkspaceThreadRunState["status"] {
  return value === "idle" || value === "active" || value === "blocked" || value === "complete";
}
