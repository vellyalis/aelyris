/** Which AI CLI backs this session */
export type AgentCliType = "claude" | "gemini" | "codex" | string;

/** Metadata for a live interactive agent session (mirrors Rust InteractiveSessionInfo) */
export interface InteractiveSession {
  id: string;
  pty_id: string;
  backend?: "sidecar" | "native" | string;
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

/**
 * Map a model name to its backing CLI — TS mirror of Rust `AgentCli::from_model`.
 * Used to label/colour a loop-dispatched agent pane from its announced model.
 */
export function cliFromModel(model: string): AgentCliType {
  if (model.startsWith("codex")) return "codex";
  if (model.startsWith("gemini")) return "gemini";
  return "claude";
}
