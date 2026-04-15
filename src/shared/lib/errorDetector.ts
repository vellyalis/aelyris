/**
 * Terminal output error detection.
 * Analyzes terminal output lines for common error patterns
 * and suggests actions (e.g., "Ask AI to fix this").
 *
 * Used by the Watchdog system to detect errors in real-time.
 */

export interface DetectedError {
  type: ErrorType;
  message: string;
  /** Suggested AI prompt for auto-fix */
  suggestedPrompt: string;
}

export type ErrorType =
  | "build_error"
  | "test_failure"
  | "runtime_error"
  | "dependency_error"
  | "permission_error"
  | "network_error";

interface ErrorPattern {
  pattern: RegExp;
  type: ErrorType;
  extractMessage: (match: RegExpMatchArray, line: string) => string;
  promptTemplate: string;
}

const ERROR_PATTERNS: ErrorPattern[] = [
  // TypeScript / JavaScript
  {
    pattern: /error TS\d+: (.+)/,
    type: "build_error",
    extractMessage: (m) => m[1],
    promptTemplate: "Fix TypeScript error: {message}",
  },
  {
    pattern: /SyntaxError: (.+)/,
    type: "build_error",
    extractMessage: (m) => m[1],
    promptTemplate: "Fix syntax error: {message}",
  },
  // Rust
  {
    pattern: /error\[E\d+\]: (.+)/,
    type: "build_error",
    extractMessage: (m) => m[1],
    promptTemplate: "Fix Rust compiler error: {message}",
  },
  // Python
  {
    pattern: /^(\w+Error): (.+)/,
    type: "runtime_error",
    extractMessage: (m) => `${m[1]}: ${m[2]}`,
    promptTemplate: "Fix Python error: {message}",
  },
  // Test failures
  {
    pattern: /FAIL\s+(.+)/,
    type: "test_failure",
    extractMessage: (m) => m[1],
    promptTemplate: "Fix failing test: {message}",
  },
  {
    pattern: /(\d+) failed/,
    type: "test_failure",
    extractMessage: (m) => `${m[1]} test(s) failed`,
    promptTemplate: "Fix the {message}",
  },
  // npm / pnpm
  {
    pattern: /ERR_MODULE_NOT_FOUND|Cannot find module '([^']+)'/,
    type: "dependency_error",
    extractMessage: (m) => m[1] ? `Module not found: ${m[1]}` : "Module not found",
    promptTemplate: "Fix missing dependency: {message}",
  },
  {
    pattern: /ENOENT|No such file or directory/,
    type: "runtime_error",
    extractMessage: (_m, line) => line.trim().slice(0, 120),
    promptTemplate: "Fix file not found error: {message}",
  },
  // Permission
  {
    pattern: /EACCES|Permission denied/i,
    type: "permission_error",
    extractMessage: (_m, line) => line.trim().slice(0, 120),
    promptTemplate: "Fix permission error: {message}",
  },
  // Network
  {
    pattern: /ECONNREFUSED|ETIMEDOUT|ERR_CONNECTION_REFUSED/,
    type: "network_error",
    extractMessage: (_m, line) => line.trim().slice(0, 120),
    promptTemplate: "Fix network error: {message}",
  },
];

/**
 * Detect errors in a terminal output line.
 * Returns null if no error pattern matches.
 */
export function detectError(line: string): DetectedError | null {
  // Strip ANSI escape codes
  const clean = line.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "").trim();
  if (clean.length === 0) return null;

  for (const pattern of ERROR_PATTERNS) {
    const match = clean.match(pattern.pattern);
    if (match) {
      const message = pattern.extractMessage(match, clean);
      return {
        type: pattern.type,
        message,
        suggestedPrompt: pattern.promptTemplate.replace("{message}", message),
      };
    }
  }

  return null;
}
