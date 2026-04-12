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

const WRITE_TOOLS = new Set(["Write", "write_file", "create_file"]);
const EDIT_TOOLS = new Set(["Edit", "edit_file", "str_replace_editor"]);
const DELETE_TOOLS = new Set(["delete_file", "remove_file"]);

/**
 * Parse a single agent output line for file change events.
 * Returns a FileChange if a file modification tool was used, null otherwise.
 */
export function parseFileChange(line: string): FileChange | null {
  try {
    const parsed = JSON.parse(line);

    // Claude format: { type: "tool_use", message: { content: [{ type: "tool_use", name: "Write", input: { file_path: "..." } }] } }
    const toolUses = parsed.message?.content?.filter?.(
      (c: { type: string }) => c.type === "tool_use"
    ) ?? [];

    for (const tool of toolUses) {
      const name = tool.name;
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
    if (parsed.type === "tool_use") {
      const name = parsed.name;
      const path = parsed.input?.file_path ?? parsed.input?.path ?? null;
      if (path) {
        if (WRITE_TOOLS.has(name)) return { timestamp: Date.now(), path, action: "create", toolName: name };
        if (EDIT_TOOLS.has(name)) return { timestamp: Date.now(), path, action: "edit", toolName: name };
        if (DELETE_TOOLS.has(name)) return { timestamp: Date.now(), path, action: "delete", toolName: name };
      }
    }
  } catch {
    // Not JSON — ignore
  }
  return null;
}

/**
 * Track all file changes from an agent session.
 */
export class FileChangeTracker {
  private changes: FileChange[] = [];

  addLine(line: string): FileChange | null {
    const change = parseFileChange(line);
    if (change) {
      this.changes.push(change);
    }
    return change;
  }

  getChanges(): readonly FileChange[] {
    return this.changes;
  }

  getChangedFiles(): string[] {
    return [...new Set(this.changes.map((c) => c.path))];
  }

  get changeCount(): number {
    return this.changes.length;
  }
}
