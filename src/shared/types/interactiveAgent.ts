import type { ContextRemainingWire } from "./agent";

/** Which AI CLI backs this session */
export type AgentCliType = "claude" | "gemini" | "codex" | string;

/** Metadata for a live interactive agent session (mirrors Rust InteractiveSessionInfo) */
export interface InteractiveSession {
  id: string;
  logical_session_id?: string;
  pty_id: string;
  backend?: "sidecar" | "native" | string;
  cli: AgentCliType;
  status: string;
  model: string;
  initial_prompt?: string;
  /**
   * Captured permission-menu prompt while `status` is `waiting_approval` — the
   * gated command/action the human is being asked to approve. Present only for a
   * confirmed Claude selectable menu; the backend clears it on any other status.
   */
  approval_prompt?: string | null;
  cwd: string;
  worktree_branch?: string;
  worktree_path?: string;
  repo_path?: string;
  short_id?: number | null;
  cost: number;
  tokens_used: number;
  started_at: number;
  last_activity?: number;
  turn_count?: number;
  context_remaining?: ContextRemainingWire | null;
}

/** Result from spawn_interactive_agent IPC */
export interface SpawnResult {
  session_id: string;
  pty_id: string;
  worktree_path?: string;
  backend?: "sidecar" | "native" | string;
}

/** CLI display metadata */
export const CLI_LABELS: Record<string, { label: string; color: string }> = {
  // Claude stays on the Rose Pine lavender (#c4a7e7) rather than Catppuccin
  // mauve to match Anthropic brand recognition across surfaces.
  claude: { label: "Claude", color: "#c4a7e7" },
  gemini: { label: "Gemini", color: "var(--ctp-blue)" },
  codex: { label: "Codex", color: "var(--ctp-green)" },
};

export function getCliLabel(cli: AgentCliType): string {
  return CLI_LABELS[cli]?.label ?? cli;
}

export function getCliColor(cli: AgentCliType): string {
  return CLI_LABELS[cli]?.color ?? "var(--text-primary)";
}
