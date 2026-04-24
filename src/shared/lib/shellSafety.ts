/**
 * Shell safety utilities — command validation and path escaping.
 *
 * Used by:
 * - ToolkitPanel (command import validation)
 * - TerminalArea (image paste path escaping)
 */

/** Patterns that indicate potentially destructive commands. */
const DANGEROUS_PATTERNS = [
  /\brm\s+(-rf?|--recursive)\b/i,
  /\bdel\s+\/[sfq]/i,
  /\bformat\s+[a-z]:/i,
  /\brmdir\s+\/s/i,
  /\bmkfs\b/i,
  /\bdd\s+if=/i,
  /\b>\s*\/dev\/sd[a-z]/i,
  /\bchmod\s+(-[rR]\s+)?777\b/,
  /\bcurl\b.*\|\s*(ba)?sh\b/i,
  /\bwget\b.*\|\s*(ba)?sh\b/i,
  /\bpowershell\b.*-enc/i,
  /\biex\b.*downloadstring/i,
];

/** Check if a command string contains potentially dangerous patterns. */
export function detectDangerousCommand(command: string): string | null {
  const lower = command.toLowerCase();
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(lower)) {
      return `Potentially dangerous pattern detected: ${pattern.source}`;
    }
  }
  return null;
}

/**
 * Escape a file path for safe use in shell commands.
 * Handles: double quotes, backticks, dollar signs, backslashes.
 */
export function escapeShellPath(path: string): string {
  return path
    .replace(/\\/g, "/") // normalize to forward slashes
    .replace(/"/g, '\\"') // escape double quotes
    .replace(/`/g, "\\`") // escape backticks
    .replace(/\$/g, "\\$"); // escape dollar signs
}

/**
 * Validate that a command is safe enough to execute.
 * Returns an error message if unsafe, or null if OK.
 */
export function validateCommand(command: string): string | null {
  if (!command.trim()) return "Command is empty";
  if (command.length > 2000) return "Command too long";
  return detectDangerousCommand(command);
}
