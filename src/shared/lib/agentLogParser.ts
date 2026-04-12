/**
 * Parse agent log content to extract structured information.
 * Identifies file changes, tool results, and actionable items.
 */

export interface ParsedToolUse {
  tool: string;
  filePath?: string;
  isFileChange: boolean;
  summary: string;
}

/** Extract tool name and file path from a tool_use log entry */
export function parseToolUse(content: string): ParsedToolUse {
  // Format: "Edit({"file_path":"/path/to/file",...})" or "Write({"file_path":...})"
  const toolMatch = content.match(/^(\w+)\((.+)\)$/s);
  if (!toolMatch) {
    return { tool: "unknown", isFileChange: false, summary: content.slice(0, 100) };
  }

  const tool = toolMatch[1];
  const argsStr = toolMatch[2];

  const CHANGE_TOOLS = new Set(["Edit", "Write"]);
  const isFileChange = CHANGE_TOOLS.has(tool);

  let filePath: string | undefined;
  try {
    const args = JSON.parse(argsStr);
    filePath = args.file_path ?? args.path ?? args.file ?? undefined;
  } catch {
    // Try regex fallback for truncated JSON
    const pathMatch = argsStr.match(/"(?:file_path|path)"\s*:\s*"([^"]+)"/);
    if (pathMatch) filePath = pathMatch[1];
  }

  const summary = filePath
    ? `${tool} → ${filePath.split("/").pop()}`
    : `${tool}(${argsStr.slice(0, 60)})`;

  return { tool, filePath, isFileChange, summary };
}

/** Check if a tool_result contains a diff-like output */
export function containsDiff(content: string): boolean {
  return content.includes("@@") && (content.includes("---") || content.includes("+++"));
}

/** Extract file path from a tool_result if it contains one */
export function extractFilePath(content: string): string | null {
  const match = content.match(/(?:---|\+\+\+)\s+[ab]\/(.+)/);
  return match ? match[1] : null;
}
