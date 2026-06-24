/**
 * Shell safety utilities — command validation and path escaping.
 *
 * Used by:
 * - ToolkitPanel (command import validation)
 * - TerminalArea (image paste path escaping)
 */

export type CommandRiskClass =
  | "read-only"
  | "build/test"
  | "file mutation"
  | "git mutation"
  | "package install"
  | "network"
  | "process kill"
  | "delete"
  | "permission"
  | "secret-bearing"
  | "destructive"
  | "unknown";

export type CommandRiskSeverity = "allow" | "review" | "deny";

export interface CommandPathScope {
  paths: string[];
  unsafePaths: string[];
}

export interface CommandSecretFinding {
  kind: string;
  index: number;
}

export interface CommandRiskReport {
  command: string;
  redactedCommand: string;
  preview: string;
  classes: CommandRiskClass[];
  severity: CommandRiskSeverity;
  requiresApproval: boolean;
  allowExecution: boolean;
  reasons: string[];
  lineCount: number;
  multiline: boolean;
  pathScope: CommandPathScope;
  secretFindings: CommandSecretFinding[];
  confidence: "high" | "medium" | "low";
}

export interface CommandRiskOptions {
  workspaceRoot?: string | null;
  safePaths?: readonly string[];
}

/** Patterns that indicate potentially destructive commands. */
const DANGEROUS_PATTERNS: Array<{ pattern: RegExp; reason: string; riskClass: CommandRiskClass }> = [
  /\brm\s+(-rf?|--recursive)\b/i,
  /\bdel\s+\/[sfq]/i,
  /\bformat\s+[a-z]:/i,
  /\brmdir\s+\/s/i,
  /\bmkfs\b/i,
  /\bdd\s+if=/i,
  // No `\b` before `>` — the normal shell form `echo x > /dev/sda` has a space
  // before `>` and there is no word boundary between a space and `>`.
  />\s*\/dev\/sd[a-z]/i,
  /\bchmod\s+(-[rR]\s+)?777\b/,
  /\bcurl\b.*\|\s*(ba)?sh\b/i,
  /\bwget\b.*\|\s*(ba)?sh\b/i,
  /\bpowershell\b.*-enc/i,
  /\biex\b.*downloadstring/i,
  /\bgit\s+reset\s+--hard\b/i,
  /\bgit\s+clean\s+-[a-z]*f/i,
  /\bRemove-Item\b[\s\S]*(?:^|\s)-Recurse\b[\s\S]*(?:^|\s)-Force\b/i,
].map((pattern) => ({
  pattern,
  reason: `Potentially dangerous pattern detected: ${pattern.source}`,
  riskClass: pattern.source.includes("git")
    ? "git mutation"
    : pattern.source.includes("del")
      ? "delete"
      : "destructive",
}));

const SECRET_PATTERNS: Array<{ kind: string; pattern: RegExp }> = [
  { kind: "bearer-token", pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/gi },
  { kind: "openai-token", pattern: /\bsk-[A-Za-z0-9_-]{12,}/gi },
  {
    kind: "assignment",
    pattern:
      /\b[A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|PASSWD|API_KEY|ACCESS_KEY|PRIVATE_KEY)[A-Z0-9_]*\s*=\s*("[^"]*"|'[^']*'|[^\s"';&|]+)/gi,
  },
  {
    kind: "flag",
    pattern: /(--?(?:token|secret|password|api[-_]?key|authorization)\s*[=:]?\s*)("[^"]*"|'[^']*'|[^\s"';&|]+)/gi,
  },
];

const WINDOWS_ABSOLUTE_PATH = /\b[A-Za-z]:[\\/][^\s"'`|&;)]*/g;
// Group 2 is the path WITHOUT the leading quote/space delimiter, so a quoted path
// like "/etc/passwd" is recognized as absolute/system (else the deny is bypassed).
const UNIX_ABSOLUTE_PATH = /(^|[\s"'`])(\/[A-Za-z0-9._~+\-/]*)/g;

const REVIEW_CLASSES = new Set<CommandRiskClass>([
  "file mutation",
  "git mutation",
  "package install",
  "network",
  "process kill",
  "delete",
  "permission",
  "secret-bearing",
  "unknown",
]);

function uniqueClasses(classes: CommandRiskClass[]): CommandRiskClass[] {
  return Array.from(new Set(classes));
}

function commandBody(command: string): string {
  return command.trim().replace(/(\r\n|\r|\n)+$/g, "");
}

function commandLineCount(command: string): number {
  const body = commandBody(command);
  if (!body) return 0;
  return body.split(/\r\n|\r|\n/).length;
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+$/g, "").toLowerCase();
}

function isAbsolutePath(path: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(path) || path.startsWith("/");
}

function extractCommandPaths(command: string): string[] {
  const paths = new Set<string>();
  for (const match of command.matchAll(WINDOWS_ABSOLUTE_PATH)) paths.add(match[0]);
  for (const match of command.matchAll(UNIX_ABSOLUTE_PATH)) {
    // match[2] is the path without the leading quote/space delimiter.
    const value = (match[2] ?? "").trim();
    if (value.length > 1) paths.add(value);
  }
  return Array.from(paths);
}

function isSystemPath(path: string): boolean {
  const normalized = normalizePath(path);
  return [
    "c:/windows",
    "c:/program files",
    "c:/program files (x86)",
    "d:/windows",
    "/etc",
    "/usr",
    "/bin",
    "/sbin",
  ].some((prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`));
}

function isUnsafePath(path: string, options: CommandRiskOptions): boolean {
  if (isSystemPath(path)) return true;
  if (!isAbsolutePath(path)) return false;
  const safePaths = [options.workspaceRoot, ...(options.safePaths ?? [])]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .map(normalizePath);
  if (safePaths.length === 0) return false;
  const normalized = normalizePath(path);
  return !safePaths.some((safe) => normalized === safe || normalized.startsWith(`${safe}/`));
}

function findSecretFindings(command: string): CommandSecretFinding[] {
  const findings: CommandSecretFinding[] = [];
  for (const { kind, pattern } of SECRET_PATTERNS) {
    pattern.lastIndex = 0;
    for (const match of command.matchAll(pattern)) {
      findings.push({ kind, index: match.index ?? 0 });
    }
  }
  return findings.sort((a, b) => a.index - b.index);
}

function maskQuotedShellText(command: string): string {
  let out = "";
  let quote: '"' | "'" | "`" | null = null;
  let escaped = false;

  for (let index = 0; index < command.length; index += 1) {
    const char = command[index];
    const next = command[index + 1];

    if (quote) {
      if (escaped) {
        escaped = false;
        out += " ";
        continue;
      }
      if (char === "\\" || (quote === "`" && char === "`")) {
        escaped = true;
        out += " ";
        continue;
      }
      if (char === quote) {
        quote = null;
        out += char;
        continue;
      }
      out += char === "\n" || char === "\r" ? char : " ";
      continue;
    }

    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      out += char;
      continue;
    }

    if (char === "#" && (index === 0 || /\s/.test(command[index - 1] ?? ""))) {
      while (index < command.length && command[index] !== "\n" && command[index] !== "\r") {
        out += " ";
        index += 1;
      }
      index -= 1;
      continue;
    }

    if (char === "/" && next === "/" && (index === 0 || /\s/.test(command[index - 1] ?? ""))) {
      while (index < command.length && command[index] !== "\n" && command[index] !== "\r") {
        out += " ";
        index += 1;
      }
      index -= 1;
      continue;
    }

    out += char;
  }

  return out;
}

export function redactSensitiveCommand(command: string): string {
  let redacted = command;
  redacted = redacted.replace(/\b(Bearer\s+)[A-Za-z0-9._~+/=-]{12,}/gi, "$1[REDACTED]");
  redacted = redacted.replace(/\bsk-[A-Za-z0-9_-]{12,}/gi, "[REDACTED]");
  redacted = redacted.replace(
    /\b([A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|PASSWD|API_KEY|ACCESS_KEY|PRIVATE_KEY)[A-Z0-9_]*\s*=\s*)("[^"]*"|'[^']*'|[^\s"';&|]+)/gi,
    "$1[REDACTED]",
  );
  redacted = redacted.replace(
    /(--?(?:token|secret|password|api[-_]?key|authorization)\s*[=:]?\s*)("[^"]*"|'[^']*'|[^\s"';&|]+)/gi,
    "$1[REDACTED]",
  );
  return redacted;
}

function classifyByPattern(command: string): { classes: CommandRiskClass[]; reasons: string[] } {
  const scan = maskQuotedShellText(command);
  const lower = scan.toLowerCase();
  const classes: CommandRiskClass[] = [];
  const reasons: string[] = [];

  if (
    /^(git\s+(status|diff|log|show|branch|rev-parse|remote\s+-v)\b|rg\b|grep\b|ls\b|dir\b|pwd\b|cat\b|type\b|where\b|echo\b|printf\b|write-host\b|get-content\b|get-childitem\b|get-location\b|select-string\b)/i.test(
      scan,
    )
  ) {
    classes.push("read-only");
    reasons.push("Matches a read-only inspection command.");
  }

  if (
    /\b(cargo\s+(test|check|build|clippy)|pnpm(\.cmd)?\s+(test|build|exec\s+(vitest|tsc|playwright)|run\s+(test|build|lint|typecheck))|npm\s+(test|run\s+(test|build|lint|typecheck))|yarn\s+(test|build)|bun\s+(test|run)|vitest\s+run|tsc\s+--noemit|playwright\s+test)\b/i.test(
      scan,
    )
  ) {
    classes.push("build/test");
    reasons.push("Matches a build or test command.");
  }

  if (
    /\b(git\s+(add|commit|push|pull|merge|rebase|reset|checkout|switch|restore|clean|cherry-pick|tag)\b)/i.test(scan)
  ) {
    classes.push("git mutation");
    reasons.push("Mutates git state or repository history.");
  }

  if (
    /\b(pnpm|npm|yarn|bun)\s+(add|install|remove|uninstall|update|upgrade)\b|\b(cargo\s+(add|install|update)|pip\s+install|uv\s+(add|pip\s+install))\b/i.test(
      scan,
    )
  ) {
    classes.push("package install");
    reasons.push("Changes dependencies or installs executable code.");
  }

  if (/\b(curl|wget|iwr|irm|invoke-webrequest|invoke-restmethod|gh\s+release|git\s+clone)\b/i.test(scan)) {
    classes.push("network");
    reasons.push("Contacts the network or downloads remote content.");
  }

  if (/\b(taskkill|stop-process|killall|pkill|kill\s+-9|kill\s+\d+)/i.test(scan)) {
    classes.push("process kill");
    reasons.push("Stops a process or process tree.");
  }

  if (/\b(sudo|runas|set-executionpolicy|icacls|takeown|chmod|chown|start-process\b[\s\S]*-verb\s+runas)/i.test(scan)) {
    classes.push("permission");
    reasons.push("Changes permissions or requests elevation.");
  }

  if (
    /\b(remove-item|del|erase|rmdir|rm)\b/i.test(scan) ||
    /(^|[^>])>\s*[^&]/.test(scan) ||
    /\b(set-content|add-content|out-file|new-item|move-item|copy-item|mkdir|touch)\b/i.test(scan)
  ) {
    classes.push(/\b(remove-item|del|erase|rmdir|rm)\b/i.test(scan) ? "delete" : "file mutation");
    reasons.push("Mutates files or directories.");
  }

  if (lower.includes("| sh") || lower.includes("| bash") || lower.includes("downloadstring")) {
    classes.push("destructive");
    reasons.push("Executes downloaded or opaque code.");
  }

  return { classes, reasons };
}

export function classifyCommand(command: string, options: CommandRiskOptions = {}): CommandRiskReport {
  const trimmed = commandBody(command);
  const lineCount = commandLineCount(command);
  const secretFindings = findSecretFindings(command);
  const redactedCommand = redactSensitiveCommand(command);
  const paths = extractCommandPaths(command);
  const unsafePaths = paths.filter((path) => isUnsafePath(path, options));
  const classes: CommandRiskClass[] = [];
  const reasons: string[] = [];

  if (!trimmed) {
    return {
      command,
      redactedCommand,
      preview: "",
      classes: ["unknown"],
      severity: "deny",
      requiresApproval: true,
      allowExecution: false,
      reasons: ["Command is empty."],
      lineCount,
      multiline: false,
      pathScope: { paths, unsafePaths },
      secretFindings,
      confidence: "high",
    };
  }

  const patternMatch = classifyByPattern(trimmed);
  classes.push(...patternMatch.classes);
  reasons.push(...patternMatch.reasons);

  const scanCommand = maskQuotedShellText(trimmed);
  for (const dangerous of DANGEROUS_PATTERNS) {
    if (dangerous.pattern.test(scanCommand)) {
      classes.push(dangerous.riskClass, "destructive");
      reasons.push(dangerous.reason);
    }
  }

  if (secretFindings.length > 0) {
    classes.push("secret-bearing");
    reasons.push("Command contains token-like or secret-bearing text.");
  }

  if (unsafePaths.length > 0) {
    reasons.push("Command references paths outside the configured safe scope.");
  }

  if (classes.length === 0) {
    classes.push("unknown");
    reasons.push("No known safe command pattern matched.");
  }

  const unique = uniqueClasses(classes);
  const destructive = unique.includes("destructive") || unsafePaths.length > 0;
  const severity: CommandRiskSeverity = destructive
    ? "deny"
    : unique.some((riskClass) => REVIEW_CLASSES.has(riskClass)) || lineCount > 1
      ? "review"
      : "allow";

  return {
    command,
    redactedCommand,
    preview: redactedCommand.trim().slice(0, 500),
    classes: unique,
    severity,
    requiresApproval: severity !== "allow",
    allowExecution: severity !== "deny",
    reasons,
    lineCount,
    multiline: lineCount > 1,
    pathScope: { paths, unsafePaths },
    secretFindings,
    confidence: unique.includes("unknown") ? "low" : unique.includes("secret-bearing") ? "medium" : "high",
  };
}

export function formatCommandRiskSummary(report: CommandRiskReport): string {
  const lines = [
    `Risk: ${report.severity}`,
    `Classes: ${report.classes.join(", ")}`,
    `Command: ${report.preview || "(empty)"}`,
  ];
  if (report.multiline) lines.push(`Lines: ${report.lineCount}`);
  if (report.pathScope.unsafePaths.length > 0) lines.push(`Unsafe paths: ${report.pathScope.unsafePaths.join(", ")}`);
  if (report.secretFindings.length > 0) lines.push(`Secrets: ${report.secretFindings.length} redacted`);
  if (report.reasons.length > 0) lines.push(`Reason: ${report.reasons.join(" ")}`);
  return lines.join("\n");
}

/** Check if a command string contains potentially dangerous patterns. */
export function detectDangerousCommand(command: string): string | null {
  const scanCommand = maskQuotedShellText(command);
  for (const { pattern, reason } of DANGEROUS_PATTERNS) {
    if (pattern.test(scanCommand)) {
      return reason;
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
  const report = classifyCommand(command);
  if (!report.allowExecution) return report.reasons[0] ?? "Command requires explicit approval";
  return detectDangerousCommand(command);
}
