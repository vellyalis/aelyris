import type { AgentSession, AgentStatus } from "../types/agent";
import { normalizeAgentRunStatus, type AgentRunStatus } from "../types/agentStatus";
import type { InteractiveSession } from "../types/interactiveAgent";

export type AgentFleetRuntime = "headless" | "interactive";

export interface AgentFleetSession {
  id: string;
  runtime: AgentFleetRuntime;
  status: AgentRunStatus;
  uiStatus: AgentStatus;
  name: string;
  model: string;
  prompt: string;
  cwd: string;
  workspaceScope?: string;
  cost: number;
  tokensUsed: number;
  startedAt: number;
  role?: AgentSession["role"];
  handoffFrom?: string;
  backend?: string;
  cli?: string;
  ptyId?: string;
  worktreeBranch?: string;
  worktreePath?: string;
  repoPath?: string;
}

export interface BackendAgentFleetSession {
  id: string;
  run_mode: AgentFleetRuntime;
  status: AgentRunStatus | string;
  model: string;
  prompt?: string | null;
  cwd: string;
  workspace_scope?: string | null;
  cost: number;
  tokens_used: number;
  started_at?: number | null;
  cli?: string | null;
  backend?: string | null;
  pty_id?: string | null;
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
      return "thinking";
    case "running_tests":
      return "coding";
    default:
      return status;
  }
}

function normalizeOrFallback(status: string): AgentRunStatus {
  return normalizeAgentRunStatus(status) ?? "error";
}

export function headlessToFleetSession(session: AgentSession): AgentFleetSession {
  const status = normalizeOrFallback(session.status);
  return {
    id: session.id,
    runtime: "headless",
    status,
    uiStatus: agentRunStatusToLegacyStatus(status),
    name: session.name,
    model: session.model,
    prompt: session.prompt,
    cwd: session.workspaceScope ?? session.worktree?.path ?? "",
    workspaceScope: session.workspaceScope ?? session.worktree?.path,
    cost: session.cost,
    tokensUsed: session.tokensUsed,
    startedAt: session.startedAt,
    role: session.role,
    handoffFrom: session.handoffFrom,
  };
}

export function interactiveToFleetSession(session: InteractiveSession): AgentFleetSession {
  const status = normalizeOrFallback(session.status);
  return {
    id: session.id,
    runtime: "interactive",
    status,
    uiStatus: agentRunStatusToLegacyStatus(status),
    name: `${session.cli} interactive`,
    model: session.model,
    prompt: session.initial_prompt ?? "",
    cwd: session.cwd,
    workspaceScope: session.worktree_path ?? session.cwd,
    cost: session.cost,
    tokensUsed: session.tokens_used,
    startedAt: session.started_at,
    backend: session.backend,
    cli: session.cli,
    ptyId: session.pty_id,
    worktreeBranch: session.worktree_branch,
    worktreePath: session.worktree_path,
    repoPath: session.repo_path,
  };
}

export function backendToFleetSession(session: BackendAgentFleetSession): AgentFleetSession {
  const status = normalizeOrFallback(session.status);
  const runtime: AgentFleetRuntime = session.run_mode === "interactive" ? "interactive" : "headless";
  return {
    id: session.id,
    runtime,
    status,
    uiStatus: agentRunStatusToLegacyStatus(status),
    name: runtime === "interactive" ? `${session.cli ?? "agent"} interactive` : "Agent",
    model: session.model,
    prompt: session.prompt ?? "",
    cwd: session.cwd,
    workspaceScope: session.workspace_scope ?? session.worktree_path ?? session.cwd,
    cost: session.cost,
    tokensUsed: session.tokens_used,
    startedAt: session.started_at ?? 0,
    backend: session.backend ?? undefined,
    cli: session.cli ?? undefined,
    ptyId: session.pty_id ?? undefined,
    worktreeBranch: session.worktree_branch ?? undefined,
    worktreePath: session.worktree_path ?? undefined,
    repoPath: session.repo_path ?? undefined,
  };
}

export function mergeAgentFleetSessions(
  headless: AgentSession[],
  interactive: InteractiveSession[],
): AgentFleetSession[] {
  return [
    ...headless.map(headlessToFleetSession),
    ...interactive.map(interactiveToFleetSession),
  ].sort((a, b) => b.startedAt - a.startedAt);
}

export function mapBackendAgentFleetSessions(sessions: BackendAgentFleetSession[]): AgentFleetSession[] {
  return sessions.map(backendToFleetSession).sort((a, b) => b.startedAt - a.startedAt);
}
