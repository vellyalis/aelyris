export type AgentStatus = "idle" | "thinking" | "coding" | "waiting" | "error" | "done" | "generating";

export interface WorktreeInfo {
  name: string;
  path: string;
  branch: string;
  is_main: boolean;
  head_sha: string;
  status: "Clean" | "Modified" | "Conflicted";
}

/** Detail of a single file change made by an agent. */
export interface FileChangeDetail {
  path: string;
  action: "create" | "edit" | "delete";
  toolName: string;
  timestamp: number;
}

export type AgentFinalReportStatus = "missing" | "pending" | "ready" | "collected";

export interface AgentFinalReportInfo {
  status: AgentFinalReportStatus;
  title?: string;
  path?: string;
  summary?: string;
  updatedAt?: number;
}

export type AgentCloseState = "active" | "collectable" | "collected";

export interface AgentSession {
  id: string;
  name: string;
  status: AgentStatus;
  model: string;
  prompt: string;
  startedAt: number;
  logs: AgentLog[];
  cost: number;
  tokensUsed: number;
  branch?: string;
  filesChanged?: number;
  /** Detailed list of files changed by the agent (for inline diff display). */
  changedFileDetails?: FileChangeDetail[];
  watchdog?: string;
  worktree?: WorktreeInfo;
  permissionMode?: "full" | "edit" | "plan" | "readonly";
  detectedPort?: number;
  /** Orchestra role assigned at launch (Phase 3B-1). */
  role?: import("../lib/orchestrator").OrchestraRoleId;
  /** Optional parent session id when spawned via handoff. */
  handoffFrom?: string;
  /** Human or automation owner responsible for the run. */
  owner?: string;
  /** Workspace or worktree scope the run is allowed to operate in. */
  workspaceScope?: string;
  /** Explicit write set when supplied by a backend/subagent controller. */
  writeSet?: string[];
  /** Latest final report status for this run. */
  finalReport?: AgentFinalReportInfo;
  /** Completion collection state for closed/done runs. */
  closeState?: AgentCloseState;
  /** Typed blocked reason when the run needs intervention. */
  blockedReason?: string;
  /** Required actor for blocked policy handling. */
  nextActor?: string;
}

export interface AgentLog {
  timestamp: number;
  type: "text" | "tool_use" | "tool_result" | "error" | "system";
  content: string;
  metadata?: {
    event?: "watchdog_decision" | "agent_telemetry_corrupt_snapshot";
    toolName?: string;
    decision?: "approved" | "denied" | "manual";
    rule?: string;
    approvalReplayKey?: string;
    approvalReplayRecord?: import("../lib/watchdogDecision").ApprovalReplayRecord;
    riskClasses?: import("../lib/shellSafety").CommandRiskClass[];
    riskSeverity?: import("../lib/shellSafety").CommandRiskSeverity;
    source?: string;
    visibilityPolicy?: string;
    rawPreview?: string;
  };
}

export const STATUS_COLORS: Record<AgentStatus, string> = {
  // idle + thinking stay as Tailwind hex — chosen distinct from Catppuccin
  // yellow/green so the "new state" transitions read as intentional.
  idle: "#4ade80",
  thinking: "#fbbf24",
  coding: "var(--ctp-green)",
  waiting: "var(--ctp-red)",
  error: "var(--ctp-red)",
  done: "var(--ctp-blue)",
  generating: "var(--ctp-mauve)",
};

export const STATUS_LABELS: Record<AgentStatus, string> = {
  idle: "Idle",
  thinking: "Thinking...",
  coding: "Coding",
  waiting: "Needs Attention",
  error: "Error",
  done: "Complete",
  generating: "Generating",
};

/**
 * Narrow a free-form backend status string (e.g. an interactive session's
 * `status`, typed as `string` because Rust emits it untyped) to a known
 * AgentStatus. STATUS_LABELS is the single source of valid keys.
 */
export function isAgentStatus(value: string): value is AgentStatus {
  return value in STATUS_LABELS;
}

// Scape-inspired session-specific colors for parallel identification
const SESSION_PALETTE = [
  {
    accent: "#7c3aed",
    dim: "rgba(124, 58, 237, 0.4)",
    subtle: "rgba(124, 58, 237, 0.2)",
    glow: "rgba(124, 58, 237, 0.35)",
  }, // purple
  {
    accent: "#2563eb",
    dim: "rgba(37, 99, 235, 0.4)",
    subtle: "rgba(37, 99, 235, 0.2)",
    glow: "rgba(37, 99, 235, 0.35)",
  }, // blue
  {
    accent: "#dc2626",
    dim: "rgba(220, 38, 38, 0.4)",
    subtle: "rgba(220, 38, 38, 0.2)",
    glow: "rgba(220, 38, 38, 0.35)",
  }, // red
  {
    accent: "#059669",
    dim: "rgba(5, 150, 105, 0.4)",
    subtle: "rgba(5, 150, 105, 0.2)",
    glow: "rgba(5, 150, 105, 0.35)",
  }, // emerald
  {
    accent: "#d97706",
    dim: "rgba(217, 119, 6, 0.4)",
    subtle: "rgba(217, 119, 6, 0.2)",
    glow: "rgba(217, 119, 6, 0.35)",
  }, // amber
  {
    accent: "#db2777",
    dim: "rgba(219, 39, 119, 0.4)",
    subtle: "rgba(219, 39, 119, 0.2)",
    glow: "rgba(219, 39, 119, 0.35)",
  }, // pink
  {
    accent: "#0891b2",
    dim: "rgba(8, 145, 178, 0.4)",
    subtle: "rgba(8, 145, 178, 0.2)",
    glow: "rgba(8, 145, 178, 0.35)",
  }, // cyan
  {
    accent: "#4f46e5",
    dim: "rgba(79, 70, 229, 0.4)",
    subtle: "rgba(79, 70, 229, 0.2)",
    glow: "rgba(79, 70, 229, 0.35)",
  }, // indigo
] as const;

export type SessionColor = (typeof SESSION_PALETTE)[number];

export function getSessionColor(sessionId: string): SessionColor {
  let hash = 0;
  for (let i = 0; i < sessionId.length; i++) {
    hash = ((hash << 5) - hash + sessionId.charCodeAt(i)) | 0;
  }
  return SESSION_PALETTE[Math.abs(hash) % SESSION_PALETTE.length];
}
