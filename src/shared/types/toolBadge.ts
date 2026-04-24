export type ToolName =
  | "Read"
  | "Edit"
  | "Write"
  | "Bash"
  | "Glob"
  | "Grep"
  | "Search"
  | "TodoRead"
  | "TodoWrite"
  | "Agent";

export const TOOL_COLORS: Record<ToolName, string> = {
  Edit: "var(--ctp-yellow)",
  Bash: "var(--ctp-green)",
  Read: "var(--ctp-blue)",
  Write: "var(--ctp-peach)",
  Glob: "var(--ctp-mauve)",
  Grep: "var(--ctp-cyan)",
  Search: "var(--ctp-cyan)",
  TodoRead: "var(--ctp-magenta)",
  TodoWrite: "var(--ctp-magenta)",
  Agent: "var(--ctp-sky)",
};

const TOOL_PATTERN = /\b(Read|Edit|Write|Bash|Glob|Grep|Search|TodoRead|TodoWrite|Agent)\s*\(/;

export function extractToolName(logContent: string): ToolName | null {
  const match = logContent.match(TOOL_PATTERN);
  return match ? (match[1] as ToolName) : null;
}
