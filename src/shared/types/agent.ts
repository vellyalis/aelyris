export type AgentStatus = "idle" | "thinking" | "coding" | "waiting" | "error" | "done" | "generating";

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
  watchdog?: string; // watchdog name if attached
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
