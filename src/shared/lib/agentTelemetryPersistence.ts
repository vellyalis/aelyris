import type { AgentFinalReportInfo, AgentLog, AgentSession, FileChangeDetail } from "../types/agent";

export const AGENT_TELEMETRY_STORAGE_KEY = "aether:agentTelemetry:v1";

type AgentLogMetadata = NonNullable<AgentLog["metadata"]>;

const MAX_SESSIONS = 40;
const MAX_LOGS_PER_SESSION = 120;
const MAX_FILE_DETAILS_PER_SESSION = 160;
const CORRUPT_TELEMETRY_VISIBILITY_POLICY = "corrupt-agent-telemetry-is-auditable";

export interface AgentTelemetrySnapshotParseError {
  kind: "invalid-json" | "invalid-shape";
  message: string;
  rawPreview: string;
  timestamp: number;
  visibilityPolicy: typeof CORRUPT_TELEMETRY_VISIBILITY_POLICY;
}

export interface AgentTelemetrySnapshotParseResult {
  sessions: AgentSession[];
  error: AgentTelemetrySnapshotParseError | null;
  droppedSessionCount: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function sanitizeFileAction(value: unknown): FileChangeDetail["action"] {
  return value === "create" || value === "delete" ? value : "edit";
}

function sanitizeStringArray(value: unknown, limit: number): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((item): item is string => typeof item === "string" && item.length > 0).slice(-limit);
}

function sanitizeRiskClasses(value: unknown): AgentLogMetadata["riskClasses"] {
  const allowed = new Set([
    "read-only",
    "build/test",
    "file mutation",
    "git mutation",
    "package install",
    "network",
    "process kill",
    "delete",
    "permission",
    "secret-bearing",
    "destructive",
    "unknown",
  ]);
  return sanitizeStringArray(value, 12)?.filter((item) => allowed.has(item)) as AgentLogMetadata["riskClasses"];
}

function sanitizeFinalReport(value: unknown): AgentFinalReportInfo | undefined {
  if (!isRecord(value)) return undefined;
  const status = value.status;
  if (status !== "missing" && status !== "pending" && status !== "ready" && status !== "collected") return undefined;
  return {
    status,
    title: typeof value.title === "string" ? value.title : undefined,
    path: typeof value.path === "string" ? value.path : undefined,
    summary: typeof value.summary === "string" ? value.summary : undefined,
    updatedAt: isFiniteNumber(value.updatedAt) ? value.updatedAt : undefined,
  };
}

function sanitizeLogMetadata(value: unknown): AgentLog["metadata"] | undefined {
  if (!isRecord(value)) return undefined;
  const event =
    value.event === "watchdog_decision" || value.event === "agent_telemetry_corrupt_snapshot" ? value.event : undefined;
  const decision =
    value.decision === "approved" || value.decision === "denied" || value.decision === "manual"
      ? value.decision
      : undefined;
  const metadata: AgentLog["metadata"] = {
    event,
    toolName: typeof value.toolName === "string" ? value.toolName.slice(0, 120) : undefined,
    decision,
    rule: typeof value.rule === "string" ? value.rule.slice(0, 240) : undefined,
    approvalReplayKey: typeof value.approvalReplayKey === "string" ? value.approvalReplayKey.slice(0, 240) : undefined,
    riskClasses: sanitizeRiskClasses(value.riskClasses),
    riskSeverity:
      value.riskSeverity === "allow" || value.riskSeverity === "review" || value.riskSeverity === "deny"
        ? value.riskSeverity
        : undefined,
    source: typeof value.source === "string" ? value.source.slice(0, 80) : undefined,
    visibilityPolicy: typeof value.visibilityPolicy === "string" ? value.visibilityPolicy.slice(0, 120) : undefined,
    rawPreview: typeof value.rawPreview === "string" ? value.rawPreview.slice(0, 240) : undefined,
  };
  return Object.values(metadata).some((item) => item !== undefined) ? metadata : undefined;
}

function sanitizeLog(value: unknown): AgentLog | null {
  if (!isRecord(value)) return null;
  const type = value.type;
  if (type !== "text" && type !== "tool_use" && type !== "tool_result" && type !== "error" && type !== "system") {
    return null;
  }
  return {
    timestamp: isFiniteNumber(value.timestamp) ? value.timestamp : Date.now(),
    type,
    content: typeof value.content === "string" ? value.content.slice(0, 300) : "",
    metadata: sanitizeLogMetadata(value.metadata),
  };
}

function sanitizeSession(value: unknown): AgentSession | null {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.name !== "string") return null;
  const status = value.status;
  if (
    status !== "idle" &&
    status !== "thinking" &&
    status !== "coding" &&
    status !== "waiting" &&
    status !== "error" &&
    status !== "done" &&
    status !== "generating"
  ) {
    return null;
  }

  const logs = Array.isArray(value.logs)
    ? value.logs.map(sanitizeLog).filter((log): log is AgentLog => log != null)
    : [];
  const changedFileDetails: FileChangeDetail[] | undefined = Array.isArray(value.changedFileDetails)
    ? value.changedFileDetails
        .filter(isRecord)
        .map((detail) => ({
          path: typeof detail.path === "string" ? detail.path : "",
          action: sanitizeFileAction(detail.action),
          toolName: typeof detail.toolName === "string" ? detail.toolName : "unknown",
          timestamp: isFiniteNumber(detail.timestamp) ? detail.timestamp : Date.now(),
        }))
        .filter((detail) => detail.path.length > 0)
        .slice(-MAX_FILE_DETAILS_PER_SESSION)
    : undefined;

  return {
    id: value.id,
    name: value.name,
    status,
    model: typeof value.model === "string" ? value.model : "unknown",
    prompt: typeof value.prompt === "string" ? value.prompt : "",
    startedAt: isFiniteNumber(value.startedAt) ? value.startedAt : Date.now(),
    logs: logs.slice(-MAX_LOGS_PER_SESSION),
    cost: isFiniteNumber(value.cost) ? value.cost : 0,
    tokensUsed: isFiniteNumber(value.tokensUsed) ? value.tokensUsed : 0,
    branch: typeof value.branch === "string" ? value.branch : undefined,
    filesChanged: isFiniteNumber(value.filesChanged) ? value.filesChanged : changedFileDetails?.length,
    changedFileDetails,
    watchdog: typeof value.watchdog === "string" ? value.watchdog : undefined,
    permissionMode:
      value.permissionMode === "full" ||
      value.permissionMode === "edit" ||
      value.permissionMode === "plan" ||
      value.permissionMode === "readonly"
        ? value.permissionMode
        : undefined,
    detectedPort: isFiniteNumber(value.detectedPort) ? value.detectedPort : undefined,
    role: typeof value.role === "string" ? (value.role as AgentSession["role"]) : undefined,
    handoffFrom: typeof value.handoffFrom === "string" ? value.handoffFrom : undefined,
    owner: typeof value.owner === "string" ? value.owner : undefined,
    workspaceScope: typeof value.workspaceScope === "string" ? value.workspaceScope : undefined,
    writeSet: sanitizeStringArray(value.writeSet, MAX_FILE_DETAILS_PER_SESSION),
    finalReport: sanitizeFinalReport(value.finalReport),
    closeState:
      value.closeState === "active" || value.closeState === "collectable" || value.closeState === "collected"
        ? value.closeState
        : undefined,
    blockedReason: typeof value.blockedReason === "string" ? value.blockedReason : undefined,
    nextActor: typeof value.nextActor === "string" ? value.nextActor : undefined,
  };
}

export function serializeAgentTelemetrySnapshot(sessions: readonly AgentSession[]): string {
  const payload = {
    version: 1,
    savedAt: Date.now(),
    sessions: [...sessions]
      .sort((a, b) => b.startedAt - a.startedAt)
      .slice(0, MAX_SESSIONS)
      .map((session) => ({
        ...session,
        logs: session.logs.slice(-MAX_LOGS_PER_SESSION),
        changedFileDetails: session.changedFileDetails?.slice(-MAX_FILE_DETAILS_PER_SESSION),
      })),
  };
  return JSON.stringify(payload);
}

function telemetryParseError(
  kind: AgentTelemetrySnapshotParseError["kind"],
  message: string,
  raw: string,
): AgentTelemetrySnapshotParseError {
  return {
    kind,
    message,
    rawPreview: raw.slice(0, 240),
    timestamp: Date.now(),
    visibilityPolicy: CORRUPT_TELEMETRY_VISIBILITY_POLICY,
  };
}

export function createAgentTelemetryRecoverySession(
  error: AgentTelemetrySnapshotParseError,
  source: string,
): AgentSession {
  return {
    id: `agent-telemetry-recovery-${source}-${error.timestamp}`,
    name: "Telemetry recovery",
    status: "error",
    model: "telemetry",
    prompt: `Recover ${source} agent telemetry snapshot`,
    startedAt: error.timestamp,
    logs: [
      {
        timestamp: error.timestamp,
        type: "error",
        content: `Agent telemetry snapshot could not be restored from ${source}: ${error.message}`,
        metadata: {
          event: "agent_telemetry_corrupt_snapshot",
          source,
          visibilityPolicy: error.visibilityPolicy,
          rawPreview: error.rawPreview,
        },
      },
    ],
    cost: 0,
    tokensUsed: 0,
    closeState: "collectable",
    blockedReason: "Agent telemetry snapshot is corrupt; provenance was not silently discarded.",
    nextActor: "user",
  };
}

export function parseAgentTelemetrySnapshotResult(raw: string | null): AgentTelemetrySnapshotParseResult {
  if (!raw) return { sessions: [], error: null, droppedSessionCount: 0 };
  try {
    const parsed = JSON.parse(raw);
    if (!isRecord(parsed) || !Array.isArray(parsed.sessions)) {
      return {
        sessions: [],
        error: telemetryParseError("invalid-shape", "snapshot payload is missing a sessions array", raw),
        droppedSessionCount: 0,
      };
    }
    const sessions = parsed.sessions.map(sanitizeSession).filter((session): session is AgentSession => session != null);
    return {
      sessions,
      error: null,
      droppedSessionCount: parsed.sessions.length - sessions.length,
    };
  } catch (error) {
    return {
      sessions: [],
      error: telemetryParseError("invalid-json", error instanceof Error ? error.message : String(error), raw),
      droppedSessionCount: 0,
    };
  }
}

export function parseAgentTelemetrySnapshot(raw: string | null): AgentSession[] {
  return parseAgentTelemetrySnapshotResult(raw).sessions;
}

export function loadAgentTelemetrySnapshot(storage: Storage = window.localStorage): AgentSession[] {
  const result = parseAgentTelemetrySnapshotResult(storage.getItem(AGENT_TELEMETRY_STORAGE_KEY));
  return result.error ? [createAgentTelemetryRecoverySession(result.error, "localStorage")] : result.sessions;
}

export function saveAgentTelemetrySnapshot(
  sessions: readonly AgentSession[],
  storage: Storage = window.localStorage,
): void {
  storage.setItem(AGENT_TELEMETRY_STORAGE_KEY, serializeAgentTelemetrySnapshot(sessions));
}
