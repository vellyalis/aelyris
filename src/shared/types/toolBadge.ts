export type ToolName =
  | "Read"
  | "Edit"
  | "Write"
  | "MultiEdit"
  | "Bash"
  | "Glob"
  | "Grep"
  | "LS"
  | "Search"
  | "WebFetch"
  | "WebSearch"
  | "TodoRead"
  | "TodoWrite"
  | "Agent";

export const TOOL_COLORS: Record<ToolName, string> = {
  Edit: "var(--ctp-yellow)",
  MultiEdit: "var(--ctp-yellow)",
  Bash: "var(--ctp-green)",
  Read: "var(--ctp-blue)",
  Write: "var(--ctp-peach)",
  Glob: "var(--ctp-mauve)",
  Grep: "var(--ctp-cyan)",
  LS: "var(--ctp-blue)",
  Search: "var(--ctp-cyan)",
  WebFetch: "var(--ctp-sapphire)",
  WebSearch: "var(--ctp-sapphire)",
  TodoRead: "var(--ctp-magenta)",
  TodoWrite: "var(--ctp-magenta)",
  Agent: "var(--ctp-sky)",
};

const TOOL_PATTERN =
  /\b(Read|Edit|Write|MultiEdit|Bash|Glob|Grep|LS|Search|WebFetch|WebSearch|TodoRead|TodoWrite|Agent)\s*\(/;

export function extractToolName(logContent: string): ToolName | null {
  const match = logContent.match(TOOL_PATTERN);
  return match ? (match[1] as ToolName) : null;
}
