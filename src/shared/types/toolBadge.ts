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
  Edit: "#f9e2af",
  Bash: "#a6e3a1",
  Read: "#89b4fa",
  Write: "#fab387",
  Glob: "#cba6f7",
  Grep: "#94e2d5",
  Search: "#94e2d5",
  TodoRead: "#f5c2e7",
  TodoWrite: "#f5c2e7",
  Agent: "#89dceb",
};

const TOOL_PATTERN = /\b(Read|Edit|Write|Bash|Glob|Grep|Search|TodoRead|TodoWrite|Agent)\s*\(/;

export function extractToolName(logContent: string): ToolName | null {
  const match = logContent.match(TOOL_PATTERN);
  return match ? (match[1] as ToolName) : null;
}
