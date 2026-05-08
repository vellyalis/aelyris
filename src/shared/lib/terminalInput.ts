import { type CommandRiskOptions, type CommandRiskReport, classifyCommand } from "./shellSafety";

/**
 * Normalize prompt-entered command text for PTY writes.
 *
 * The backend expects a single carriage return to submit the command. Prompt
 * dialogs may hand back pasted Windows CRLF text, so only the final line ending
 * is collapsed instead of adding an extra enter.
 */
export function normalizeCommandInput(text: string): string {
  if (text.endsWith("\r\n")) return `${text.slice(0, -2)}\r`;
  if (text.endsWith("\n")) return `${text.slice(0, -1)}\r`;
  if (text.endsWith("\r")) return text;
  return `${text}\r`;
}

/**
 * Normalize text pasted into the direct terminal input path.
 *
 * Browser clipboard text usually uses `\n`/`\r\n`, while the PTY keyboard
 * path sends Enter as `\r`. PowerShell/PSReadLine is especially sensitive to
 * lone LF bytes: they can move the visual cursor without submitting the line.
 */
export function normalizeTerminalPasteInput(text: string): string {
  return text.replace(/\r\n|\n|\r/g, "\r");
}

export function countTerminalPasteLineEndings(text: string): number {
  return text.match(/\r\n|\n|\r/g)?.length ?? 0;
}

export const TERMINAL_PASTE_GUARD_EVENT = "aether:terminal-paste-guard";

export interface TerminalPasteGuard {
  originalText: string;
  normalizedText: string;
  lineEndingCount: number;
  lineCount: number;
  shouldConfirm: boolean;
  shouldBlock: boolean;
  reason: string;
  risk: CommandRiskReport;
}

export function classifyTerminalPasteInput(text: string, options: CommandRiskOptions = {}): TerminalPasteGuard {
  const normalizedText = normalizeTerminalPasteInput(text);
  const lineEndingCount = countTerminalPasteLineEndings(text);
  const risk = classifyCommand(text, options);
  const shouldBlock = !risk.allowExecution;
  const shouldConfirm = !shouldBlock && (risk.requiresApproval || risk.multiline || lineEndingCount > 1);
  const reason = shouldBlock
    ? (risk.reasons[0] ?? "Paste blocked by command risk firewall.")
    : shouldConfirm
      ? risk.multiline || lineEndingCount > 1
        ? "Multi-line paste requires confirmation before writing to the PTY."
        : (risk.reasons[0] ?? "Paste requires confirmation before writing to the PTY.")
      : "Paste allowed.";

  return {
    originalText: text,
    normalizedText,
    lineEndingCount,
    lineCount: risk.lineCount,
    shouldConfirm,
    shouldBlock,
    reason,
    risk,
  };
}
