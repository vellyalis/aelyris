/**
 * Detects file changes from agent output log lines.
 * Agent CLIs (claude, codex, gemini) emit structured JSON with tool_use events
 * that indicate file modifications (Write, Edit, etc.)
 */

export interface FileChange {
  timestamp: number;
  path: string;
  action: "create" | "edit" | "delete";
  toolName: string;
}

export interface FileChangeParseError {
  timestamp: number;
  linePreview: string;
  error: string;
  visibilityPolicy: "malformed-agent-structured-output-is-auditable";
}

export type FileChangeParseEvent =
  | { kind: "change"; change: FileChange }
  | { kind: "parser_error"; error: FileChangeParseError }
  | { kind: "none" };

const WRITE_TOOLS = new Set(["Write", "write_file", "create_file"]);
const EDIT_TOOLS = new Set(["Edit", "edit_file", "str_replace_editor"]);
const DELETE_TOOLS = new Set(["delete_file", "remove_file"]);
const MAX_LINE_PREVIEW = 240;

function looksStructuredAgentLine(line: string): boolean {
  const trimmed = line.trimStart();
  return trimmed.startsWith("{") || trimmed.startsWith("[");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function fileChangeFromParsed(parsed: unknown): FileChange | null {
  if (typeof parsed !== "object" || parsed == null) return null;
  const record = parsed as {
    type?: string;
    name?: string;
    input?: { file_path?: string; path?: string };
    message?: {
      content?: { type: string; name?: string; input?: { file_path?: string; path?: string; target?: string } }[];
    };
  };

  // Claude format: { type: "tool_use", message: { content: [{ type: "tool_use", name: "Write", input: { file_path: "..." } }] } }
  const toolUses = record.message?.content?.filter?.((c) => c.type === "tool_use") ?? [];

  for (const tool of toolUses) {
    const name = tool.name ?? "";
    const path = tool.input?.file_path ?? tool.input?.path ?? tool.input?.target ?? null;
    if (!path) continue;

    if (WRITE_TOOLS.has(name)) {
      return { timestamp: Date.now(), path, action: "create", toolName: name };
    }
    if (EDIT_TOOLS.has(name)) {
      return { timestamp: Date.now(), path, action: "edit", toolName: name };
    }
    if (DELETE_TOOLS.has(name)) {
      return { timestamp: Date.now(), path, action: "delete", toolName: name };
    }
  }

  // Direct tool_use format
  if (record.type === "tool_use") {
    const name = record.name ?? "";
    const path = record.input?.file_path ?? record.input?.path ?? null;
    if (path) {
      if (WRITE_TOOLS.has(name)) return { timestamp: Date.now(), path, action: "create", toolName: name };
      if (EDIT_TOOLS.has(name)) return { timestamp: Date.now(), path, action: "edit", toolName: name };
      if (DELETE_TOOLS.has(name)) return { timestamp: Date.now(), path, action: "delete", toolName: name };
    }
  }

  return null;
}

/**
 * Parse a single agent output line for file change events.
 * Returns a FileChange if a file modification tool was used, null otherwise.
 */
export function parseFileChange(line: string): FileChange | null {
  const event = parseFileChangeEvent(line);
  return event.kind === "change" ? event.change : null;
}

/**
 * Parse a single agent output line while preserving malformed structured lines as audit evidence.
 */
export function parseFileChangeEvent(line: string): FileChangeParseEvent {
  if (!line.trim()) return { kind: "none" };
  try {
    const parsed = JSON.parse(line);
    const change = fileChangeFromParsed(parsed);
    return change ? { kind: "change", change } : { kind: "none" };
  } catch (error) {
    if (looksStructuredAgentLine(line)) {
      return {
        kind: "parser_error",
        error: {
          timestamp: Date.now(),
          linePreview: line.slice(0, MAX_LINE_PREVIEW),
          error: errorMessage(error),
          visibilityPolicy: "malformed-agent-structured-output-is-auditable",
        },
      };
    }
  }
  return { kind: "none" };
}

/**
 * Track all file changes from an agent session.
 */
export class FileChangeTracker {
  private changes: FileChange[] = [];
  private parserErrors: FileChangeParseError[] = [];

  addLine(line: string): FileChange | null {
    const event = parseFileChangeEvent(line);
    if (event.kind === "parser_error") {
      this.parserErrors.push(event.error);
      return null;
    }
    if (event.kind === "change") {
      this.changes.push(event.change);
      return event.change;
    }
    return null;
  }

  getChanges(): readonly FileChange[] {
    return this.changes;
  }

  getChangedFiles(): string[] {
    return [...new Set(this.changes.map((c) => c.path))];
  }

  getParserErrors(): readonly FileChangeParseError[] {
    return this.parserErrors;
  }

  get changeCount(): number {
    return this.changes.length;
  }

  get parserErrorCount(): number {
    return this.parserErrors.length;
  }
}
