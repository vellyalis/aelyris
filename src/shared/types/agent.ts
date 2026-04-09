export type AgentStatus = "idle" | "thinking" | "coding" | "waiting" | "error" | "done";

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
}

export interface AgentLog {
  timestamp: number;
  type: "text" | "tool_use" | "tool_result" | "error" | "system";
  content: string;
}

export const STATUS_COLORS: Record<AgentStatus, string> = {
  idle: "rgba(255,255,255,0.35)",
  thinking: "#cba6f7",
  coding: "#a6e3a1",
  waiting: "#f9e2af",
  error: "#f38ba8",
  done: "#89b4fa",
};

export const STATUS_LABELS: Record<AgentStatus, string> = {
  idle: "Idle",
  thinking: "Thinking...",
  coding: "Coding",
  waiting: "Needs Attention",
  error: "Error",
  done: "Complete",
};
