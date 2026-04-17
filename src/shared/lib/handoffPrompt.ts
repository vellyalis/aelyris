import type { AgentSession } from "../types/agent";

/**
 * Build a handoff prompt template from a source session.
 *
 * Picks the most recent substantive text log and the last tool_result, quotes
 * them into a prompt skeleton the user can edit before dispatching a new agent.
 */
export function buildHandoffPrompt(session: AgentSession): string {
  const texts = session.logs.filter((l) => l.type === "text" && l.content.trim().length > 0);
  const lastText = texts[texts.length - 1]?.content.trim() ?? "";

  const results = session.logs.filter((l) => l.type === "tool_result" && l.content.trim().length > 0);
  const lastResult = results[results.length - 1]?.content.trim() ?? "";

  const filesNote = session.filesChanged && session.filesChanged > 0
    ? `\n\nFiles changed so far: ${session.filesChanged}.`
    : "";

  const parts: string[] = [];
  parts.push(`Context from "${session.name}" (${session.model}):`);
  parts.push(`Original task: ${session.prompt}`);
  if (lastText) {
    parts.push(`Latest assistant output:\n${truncate(lastText, 1200)}`);
  }
  if (lastResult) {
    parts.push(`Latest tool result:\n${truncate(lastResult, 800)}`);
  }
  if (filesNote) parts.push(filesNote.trim());
  parts.push(`\n---\nYour task: `);

  return parts.join("\n\n");
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}\n…[truncated ${value.length - max} chars]`;
}
