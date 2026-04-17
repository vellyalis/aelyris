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
}

export interface AgentLog {
  timestamp: number;
  type: "text" | "tool_use" | "tool_result" | "error" | "system";
  content: string;
}

export const STATUS_COLORS: Record<AgentStatus, string> = {
  idle: "#4ade80",
  thinking: "#fbbf24",
  coding: "#a6e3a1",
  waiting: "#f38ba8",
  error: "#f38ba8",
  done: "#89b4fa",
  generating: "#cba6f7",
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

// Scape-inspired session-specific colors for parallel identification
const SESSION_PALETTE = [
  { accent: "#7c3aed", dim: "rgba(124, 58, 237, 0.4)", subtle: "rgba(124, 58, 237, 0.2)", glow: "rgba(124, 58, 237, 0.35)" },  // purple
  { accent: "#2563eb", dim: "rgba(37, 99, 235, 0.4)",  subtle: "rgba(37, 99, 235, 0.2)",  glow: "rgba(37, 99, 235, 0.35)" },   // blue
  { accent: "#dc2626", dim: "rgba(220, 38, 38, 0.4)",  subtle: "rgba(220, 38, 38, 0.2)",  glow: "rgba(220, 38, 38, 0.35)" },   // red
  { accent: "#059669", dim: "rgba(5, 150, 105, 0.4)",  subtle: "rgba(5, 150, 105, 0.2)",  glow: "rgba(5, 150, 105, 0.35)" },   // emerald
  { accent: "#d97706", dim: "rgba(217, 119, 6, 0.4)",  subtle: "rgba(217, 119, 6, 0.2)",  glow: "rgba(217, 119, 6, 0.35)" },   // amber
  { accent: "#db2777", dim: "rgba(219, 39, 119, 0.4)", subtle: "rgba(219, 39, 119, 0.2)", glow: "rgba(219, 39, 119, 0.35)" },  // pink
  { accent: "#0891b2", dim: "rgba(8, 145, 178, 0.4)",  subtle: "rgba(8, 145, 178, 0.2)",  glow: "rgba(8, 145, 178, 0.35)" },   // cyan
  { accent: "#4f46e5", dim: "rgba(79, 70, 229, 0.4)",  subtle: "rgba(79, 70, 229, 0.2)",  glow: "rgba(79, 70, 229, 0.35)" },   // indigo
] as const;

export type SessionColor = typeof SESSION_PALETTE[number];

export function getSessionColor(sessionId: string): SessionColor {
  let hash = 0;
  for (let i = 0; i < sessionId.length; i++) {
    hash = ((hash << 5) - hash + sessionId.charCodeAt(i)) | 0;
  }
  return SESSION_PALETTE[Math.abs(hash) % SESSION_PALETTE.length];
}
