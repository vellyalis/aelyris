import type {
  AgentLineageEntry,
  AgentRecycleStatus,
  AgentSession,
  AgentStatus,
  ContextRemainingWire,
} from "../types/agent";
import { type AgentRunStatus, normalizeAgentRunStatus } from "../types/agentStatus";
import type { InteractiveSession } from "../types/interactiveAgent";
import { normalizeContextRemaining } from "./contextTelemetry";

export type AgentFleetRuntime = "headless" | "interactive";

/**
 * Unified fleet session — the single source the cockpit UI projects from.
 *
 * Extends {@link AgentSession} so any rail panel that already consumes
 * `AgentSession[]` accepts `AgentFleetSession[]` unchanged (structural
 * compatibility, no projection layer needed). `runtime` plus the
 * interactive-specific fields then let panels progressively distinguish
 * headless from interactive runs.
 *
 * `AgentSession.status` carries the legacy UI status (`AgentStatus`); `runStatus`
 * is the canonical run status (`AgentRunStatus`). Headless runs spread their
 * `AgentSession` through verbatim; interactive/backend runs synthesize the
 * `AgentSession` shape from their own DTO.
 */
export interface AgentFleetSession extends AgentSession {
  runtime: AgentFleetRuntime;
  runStatus: AgentRunStatus;
  /** Working directory. Headless runs derive it from workspaceScope/worktree. */
  cwd: string;
  backend?: string;
  cli?: string;
  ptyId?: string;
  /**
   * Captured permission-menu prompt for an interactive run that is
   * `waiting_approval` — the gated command the human is being asked to approve.
   * Present only for a confirmed Claude selectable menu; the Decision Inbox marks
   * a row keystroke-resolvable (and shows the command) only when this is set.
   */
  approvalPrompt?: string;
  worktreeBranch?: string;
  worktreePath?: string;
  repoPath?: string;
}

export interface BackendSessionLineageEntry {
  logical_session_id: string;
  checkpoint_seq?: number | null;
  pty_id?: string | null;
  status?: string | null;
  predecessor_session_id?: string | null;
  updated_at?: number | null;
}

export interface BackendSessionRecycleStatus {
  predecessor_id: string;
  successor_id: string;
  handoff_seq: number;
  state: string;
  correlation_id: string;
  failure_reason?: string | null;
  updated_at: number;
}

export interface BackendAgentFleetSession {
  id: string;
  logical_session_id?: string | null;
  run_mode: AgentFleetRuntime;
  status: AgentRunStatus | string;
  model: string;
  prompt?: string | null;
  cwd: string;
  workspace_scope?: string | null;
  cost: number;
  tokens_used: number;
  started_at?: number | null;
  last_activity?: number | null;
  turn_count?: number | null;
  context_remaining?: ContextRemainingWire | null;
  cli?: string | null;
  backend?: string | null;
  pty_id?: string | null;
  approval_prompt?: string | null;
  predecessor_session_id?: string | null;
  lineage?: BackendSessionLineageEntry[] | null;
  recycle_status?: BackendSessionRecycleStatus | null;
  worktree_branch?: string | null;
  worktree_path?: string | null;
  repo_path?: string | null;
}

export function agentRunStatusToLegacyStatus(status: AgentRunStatus): AgentStatus {
  switch (status) {
    case "waiting_approval":
    case "blocked":
      return "waiting";
    case "spawning":
    case "retiring":
      return "thinking";
    case "running_tests":
    case "summarizing":
      return "coding";
    default:
      return status;
  }
}

function normalizeOrFallback(status: string): AgentRunStatus {
  return normalizeAgentRunStatus(status) ?? "error";
}

function normalizeLineage(lineage: BackendSessionLineageEntry[] | null | undefined): AgentLineageEntry[] | undefined {
  const normalized = (lineage ?? [])
    .filter((entry) => entry.logical_session_id.trim().length > 0)
    .map((entry) => ({
      logicalSessionId: entry.logical_session_id,
      checkpointSeq: entry.checkpoint_seq ?? undefined,
      ptyId: entry.pty_id ?? undefined,
      status: entry.status ?? undefined,
      predecessorSessionId: entry.predecessor_session_id ?? undefined,
      updatedAt: entry.updated_at ?? undefined,
    }));
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeRecycleStatus(
  status: BackendSessionRecycleStatus | null | undefined,
): AgentRecycleStatus | undefined {
  if (!status) return undefined;
  return {
    predecessorId: status.predecessor_id,
    successorId: status.successor_id,
    handoffSeq: status.handoff_seq,
    state: status.state,
    correlationId: status.correlation_id,
    failureReason: status.failure_reason ?? undefined,
    updatedAt: status.updated_at,
  };
}

export function headlessToFleetSession(session: AgentSession): AgentFleetSession {
  return {
    ...session,
    runtime: "headless",
    runStatus: normalizeOrFallback(session.status),
    cwd: session.workspaceScope ?? session.worktree?.path ?? "",
  };
}

export function interactiveToFleetSession(session: InteractiveSession): AgentFleetSession {
  const runStatus = normalizeOrFallback(session.status);
  return {
    id: session.id,
    name: `${session.cli} interactive`,
    status: agentRunStatusToLegacyStatus(runStatus),
    model: session.model,
    prompt: session.initial_prompt ?? "",
    startedAt: session.started_at,
    logicalSessionId: session.logical_session_id ?? session.id,
    lastActivity: session.last_activity,
    turnCount: session.turn_count,
    contextRemaining: normalizeContextRemaining(session.context_remaining),
    // Interactive sessions carry no structured headless telemetry yet; expose an
    // empty log array so log-rendering surfaces can map() without guards.
    logs: [],
    cost: session.cost,
    tokensUsed: session.tokens_used,
    workspaceScope: session.worktree_path ?? session.cwd,
    runtime: "interactive",
    runStatus,
    cwd: session.cwd,
    backend: session.backend,
    cli: session.cli,
    ptyId: session.pty_id,
    approvalPrompt: session.approval_prompt ?? undefined,
    worktreeBranch: session.worktree_branch,
    worktreePath: session.worktree_path,
    repoPath: session.repo_path,
  };
}

export function backendToFleetSession(session: BackendAgentFleetSession): AgentFleetSession {
  const runStatus = normalizeOrFallback(session.status);
  const runtime: AgentFleetRuntime = session.run_mode === "interactive" ? "interactive" : "headless";
  const predecessorSessionId = session.predecessor_session_id ?? undefined;
  const lineage = normalizeLineage(session.lineage);
  const recycleStatus = normalizeRecycleStatus(session.recycle_status);
  return {
    id: session.id,
    name: runtime === "interactive" ? `${session.cli ?? "agent"} interactive` : "Agent",
    status: agentRunStatusToLegacyStatus(runStatus),
    model: session.model,
    prompt: session.prompt ?? "",
    startedAt: session.started_at ?? 0,
    logicalSessionId: session.logical_session_id ?? undefined,
    lastActivity: session.last_activity ?? undefined,
    turnCount: session.turn_count ?? undefined,
    contextRemaining: normalizeContextRemaining(session.context_remaining),
    logs: [],
    cost: session.cost,
    tokensUsed: session.tokens_used,
    workspaceScope: session.workspace_scope ?? session.worktree_path ?? session.cwd,
    runtime,
    runStatus,
    cwd: session.cwd,
    backend: session.backend ?? undefined,
    cli: session.cli ?? undefined,
    ptyId: session.pty_id ?? undefined,
    // Without this, a waiting_approval gate reaches the rail with no captured
    // menu and the Decision Inbox (which requires approvalPrompt) never mounts.
    approvalPrompt: session.approval_prompt ?? undefined,
    predecessorSessionId,
    lineage,
    recycleStatus,
    handoffFrom: predecessorSessionId,
    worktreeBranch: session.worktree_branch ?? undefined,
    worktreePath: session.worktree_path ?? undefined,
    repoPath: session.repo_path ?? undefined,
  };
}

export function mergeAgentFleetSessions(
  headless: AgentSession[],
  interactive: InteractiveSession[],
): AgentFleetSession[] {
  return [...headless.map(headlessToFleetSession), ...interactive.map(interactiveToFleetSession)].sort(
    (a, b) => b.startedAt - a.startedAt,
  );
}

export function mapBackendAgentFleetSessions(sessions: BackendAgentFleetSession[]): AgentFleetSession[] {
  return sessions.map(backendToFleetSession).sort((a, b) => b.startedAt - a.startedAt);
}
