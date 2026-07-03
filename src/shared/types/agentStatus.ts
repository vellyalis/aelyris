export const AGENT_RUN_STATUSES = [
  "spawning",
  "thinking",
  "coding",
  "running_tests",
  "waiting_approval",
  "blocked",
  "summarizing",
  "retiring",
  "idle",
  "done",
  "error",
] as const;

export type AgentRunStatus = (typeof AGENT_RUN_STATUSES)[number];

const LEGACY_STATUS_MAP = {
  waiting: "waiting_approval",
  generating: "coding",
} as const;

export function normalizeAgentRunStatus(status: string): AgentRunStatus | null {
  const normalized = status in LEGACY_STATUS_MAP ? LEGACY_STATUS_MAP[status as keyof typeof LEGACY_STATUS_MAP] : status;
  return AGENT_RUN_STATUSES.includes(normalized as AgentRunStatus) ? (normalized as AgentRunStatus) : null;
}
