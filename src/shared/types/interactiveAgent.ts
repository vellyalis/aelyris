/** Which AI CLI backs this session */
export type AgentCliType = "claude" | "gemini" | "codex" | string;

/** Metadata for a live interactive agent session (mirrors Rust InteractiveSessionInfo) */
export interface InteractiveSession {
  id: string;
  pty_id: string;
  cli: AgentCliType;
  status: string;
  model: string;
  initial_prompt?: string;
  cwd: string;
  worktree_branch?: string;
  worktree_path?: string;
  repo_path?: string;
  cost: number;
  tokens_used: number;
  started_at: number;
}

/** Result from spawn_interactive_agent IPC */
export interface SpawnResult {
  session_id: string;
  pty_id: string;
  worktree_path?: string;
}

/** CLI display metadata */
export const CLI_LABELS: Record<string, { label: string; color: string }> = {
  claude: { label: "Claude", color: "#c4a7e7" },
  gemini: { label: "Gemini", color: "#89b4fa" },
  codex: { label: "Codex", color: "#a6e3a1" },
};

export function getCliLabel(cli: AgentCliType): string {
  return CLI_LABELS[cli]?.label ?? cli;
}

export function getCliColor(cli: AgentCliType): string {
  return CLI_LABELS[cli]?.color ?? "#cdd6f4";
}
