import type { AgentSession } from "../types/agent";

export interface GitChangedFile {
  path: string;
  status: string;
  staged?: boolean;
  conflicted?: boolean;
  additions?: number;
  deletions?: number;
  binary?: boolean;
  generated?: boolean;
  coverage?: ReviewCoverageState;
  validation?: ReviewValidationState;
}

export type ReviewRisk = "critical" | "high" | "medium" | "low";
export type ReviewRiskClass =
  | "security"
  | "dependency"
  | "migration"
  | "config"
  | "backend"
  | "frontend"
  | "test"
  | "docs"
  | "generated"
  | "binary"
  | "source";
export type ReviewCoverageState = "covered" | "missing" | "not_required" | "unknown";
export type ReviewValidationState = "passed" | "failed" | "missing" | "unknown";
export type ReviewMergeReadiness = "blocked" | "needs_validation" | "needs_review" | "ready";

export interface ReviewQueueSession {
  id: string;
  name: string;
  status: AgentSession["status"];
  role?: AgentSession["role"];
  owner?: string;
}

export interface ReviewQueueItem {
  path: string;
  status: string;
  risk: ReviewRisk;
  riskClass: ReviewRiskClass;
  reason: string;
  conflict: boolean;
  action?: "create" | "edit" | "delete";
  diffstat: {
    additions: number;
    deletions: number;
    total: number;
    binary: boolean;
  };
  generated: boolean;
  coverage: ReviewCoverageState;
  validation: ReviewValidationState;
  mergeReadiness: ReviewMergeReadiness;
  score: number;
  scoreBreakdown: {
    diffstat: number;
    fileRisk: number;
    coverage: number;
    conflicts: number;
    agentAuthors: number;
    validation: number;
    flags: number;
    total: number;
  };
  signals: string[];
  agentAuthors: string[];
  sessions: ReviewQueueSession[];
  lastTouched: number;
}

export interface ReviewQueueSummary {
  items: ReviewQueueItem[];
  conflictCount: number;
  highRiskCount: number;
  agentTouchedCount: number;
  needsValidationCount: number;
  blockedCount: number;
  readyCount: number;
  totalRiskScore: number;
  mergeReadiness: ReviewMergeReadiness;
}

const RISK_RANK: Record<ReviewRisk, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

const READINESS_RANK: Record<ReviewMergeReadiness, number> = {
  blocked: 0,
  needs_validation: 1,
  needs_review: 2,
  ready: 3,
};

const BINARY_EXTENSIONS = new Set([
  "avif",
  "bmp",
  "dll",
  "exe",
  "gif",
  "gz",
  "icns",
  "ico",
  "jpg",
  "jpeg",
  "mp4",
  "mov",
  "pdf",
  "png",
  "tar",
  "ttf",
  "wasm",
  "webp",
  "woff",
  "woff2",
  "zip",
]);

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//, "");
}

function classifyFile(
  path: string,
  status: string,
  action: ReviewQueueItem["action"],
  conflict: boolean,
  binary: boolean,
  generated: boolean,
) {
  const normalized = normalizePath(path).toLowerCase();
  const fileName = normalized.split("/").pop() ?? normalized;

  if (conflict || status === "conflicted") {
    return {
      riskClass: "source" as const,
      reason: "Multi-agent overlap",
      fileRiskScore: 48,
      signals: ["Conflict"],
    };
  }

  if (action === "delete" || status === "deleted") {
    return {
      riskClass: "source" as const,
      reason: "Deletion",
      fileRiskScore: 36,
      signals: ["Deletion"],
    };
  }

  if (
    normalized.includes(".env") ||
    normalized.includes("secret") ||
    normalized.includes("token") ||
    normalized.includes("auth") ||
    normalized.includes("permission") ||
    normalized.includes("security")
  ) {
    return {
      riskClass: "security" as const,
      reason: "Security-sensitive",
      fileRiskScore: 50,
      signals: ["Security"],
    };
  }

  if (
    fileName === "package.json" ||
    fileName === "pnpm-lock.yaml" ||
    fileName === "cargo.toml" ||
    fileName === "cargo.lock"
  ) {
    return {
      riskClass: "dependency" as const,
      reason: "Dependency/config",
      fileRiskScore: 44,
      signals: ["Dependency"],
    };
  }

  if (normalized.includes("/migrations/") || normalized.includes("migration")) {
    return {
      riskClass: "migration" as const,
      reason: "Migration",
      fileRiskScore: 42,
      signals: ["Migration"],
    };
  }

  if (normalized.includes("/config/") || fileName === "vite.config.ts" || fileName === "tsconfig.json") {
    return {
      riskClass: "config" as const,
      reason: "Platform/config",
      fileRiskScore: 38,
      signals: ["Config"],
    };
  }

  if (binary) {
    return {
      riskClass: "binary" as const,
      reason: "Binary/asset",
      fileRiskScore: 32,
      signals: ["Binary"],
    };
  }

  if (generated) {
    return {
      riskClass: "generated" as const,
      reason: "Generated file",
      fileRiskScore: 28,
      signals: ["Generated"],
    };
  }

  if (normalized.startsWith("src-tauri/")) {
    return {
      riskClass: "backend" as const,
      reason: "Backend/runtime",
      fileRiskScore: 34,
      signals: ["Backend"],
    };
  }

  if (status === "untracked" || action === "create") {
    return {
      riskClass: "source" as const,
      reason: "New surface",
      fileRiskScore: 26,
      signals: ["New"],
    };
  }

  if (normalized.includes("__tests__") || normalized.endsWith(".test.ts") || normalized.startsWith("docs/")) {
    return {
      riskClass: normalized.startsWith("docs/") ? ("docs" as const) : ("test" as const),
      reason: "Support file",
      fileRiskScore: 8,
      signals: [normalized.startsWith("docs/") ? "Docs" : "Test"],
    };
  }

  return {
    riskClass: normalized.startsWith("src/") ? ("frontend" as const) : ("source" as const),
    reason: "Needs review",
    fileRiskScore: 22,
    signals: [normalized.startsWith("src/") ? "Source" : "Review"],
  };
}

export function buildReviewQueue(
  sessions: readonly AgentSession[],
  changedFiles: readonly GitChangedFile[],
): ReviewQueueSummary {
  const relatedTests = collectRelatedTests(sessions, changedFiles);
  const agentSessionsById = new Map(sessions.map((session) => [session.id, session]));
  const byPath = new Map<
    string,
    {
      path: string;
      status: string;
      action?: ReviewQueueItem["action"];
      staged?: boolean;
      conflicted?: boolean;
      additions: number;
      deletions: number;
      binary: boolean;
      generated: boolean;
      coverage?: ReviewCoverageState;
      validation?: ReviewValidationState;
      sessions: Map<string, ReviewQueueSession>;
      lastTouched: number;
    }
  >();

  for (const file of changedFiles) {
    const path = normalizePath(file.path);
    byPath.set(path.toLowerCase(), {
      path,
      status: file.status,
      staged: file.staged,
      conflicted: file.conflicted,
      additions: normalizeCount(file.additions),
      deletions: normalizeCount(file.deletions),
      binary: Boolean(file.binary) || isBinaryPath(path),
      generated: Boolean(file.generated) || isGeneratedPath(path),
      coverage: file.coverage,
      validation: file.validation,
      sessions: new Map(),
      lastTouched: 0,
    });
  }

  for (const session of sessions) {
    for (const detail of session.changedFileDetails ?? []) {
      const path = normalizePath(detail.path);
      const key = path.toLowerCase();
      const existing = byPath.get(key) ?? {
        path,
        status: detail.action,
        additions: 0,
        deletions: 0,
        binary: isBinaryPath(path),
        generated: isGeneratedPath(path),
        sessions: new Map<string, ReviewQueueSession>(),
        lastTouched: 0,
      };
      existing.action = detail.action;
      existing.status = existing.status || detail.action;
      existing.lastTouched = Math.max(existing.lastTouched, detail.timestamp);
      existing.sessions.set(session.id, {
        id: session.id,
        name: session.name,
        status: session.status,
        role: session.role,
        owner: session.owner,
      });
      byPath.set(key, existing);
    }
  }

  const items = [...byPath.values()].map((entry) => {
    const itemSessions = [...entry.sessions.values()].sort((a, b) => a.name.localeCompare(b.name));
    const conflict = Boolean(entry.conflicted) || itemSessions.length > 1 || entry.status === "conflicted";
    const diffstat = {
      additions: entry.additions,
      deletions: entry.deletions,
      total: entry.additions + entry.deletions,
      binary: entry.binary,
    };
    const fileRisk = classifyFile(entry.path, entry.status, entry.action, conflict, entry.binary, entry.generated);
    const coverage =
      entry.coverage ?? inferCoverage(entry.path, fileRisk.riskClass, entry.binary, entry.generated, relatedTests);
    const validation =
      entry.validation ?? inferValidation(entry.path, fileRisk.riskClass, itemSessions, agentSessionsById);
    const agentAuthors = itemSessions.map((session) => session.owner ?? session.role ?? session.name);
    const scoreBreakdown = scoreReviewItem({
      conflict,
      diffstat,
      fileRiskScore: fileRisk.fileRiskScore,
      riskClass: fileRisk.riskClass,
      generated: entry.generated,
      coverage,
      validation,
      sessionCount: itemSessions.length,
    });
    const risk = riskFromScore(scoreBreakdown.total, conflict, validation);
    const mergeReadiness = readinessFor({ conflict, risk, coverage, validation });
    const signals = compactSignals([
      ...fileRisk.signals,
      diffstat.total > 0 ? `${diffstat.additions}+/${diffstat.deletions}-` : null,
      coverage === "covered" ? "Covered" : coverage === "missing" ? "Coverage gap" : null,
      validation === "passed" ? "Validated" : validation === "failed" ? "Validation failed" : null,
      itemSessions.length > 0 ? `Agent ${itemSessions.length}` : null,
      entry.staged ? "Staged" : null,
    ]);
    return {
      path: entry.path,
      status: entry.status || "modified",
      action: entry.action,
      sessions: itemSessions,
      agentAuthors,
      conflict,
      diffstat,
      generated: entry.generated,
      coverage,
      validation,
      mergeReadiness,
      riskClass: fileRisk.riskClass,
      signals,
      score: scoreBreakdown.total,
      scoreBreakdown,
      lastTouched: entry.lastTouched,
      risk,
      reason: fileRisk.reason,
    };
  });

  items.sort((a, b) => {
    const readiness = READINESS_RANK[a.mergeReadiness] - READINESS_RANK[b.mergeReadiness];
    if (readiness !== 0) return readiness;
    if (a.conflict !== b.conflict) return a.conflict ? -1 : 1;
    const risk = RISK_RANK[a.risk] - RISK_RANK[b.risk];
    if (risk !== 0) return risk;
    if (a.score !== b.score) return b.score - a.score;
    if (a.lastTouched !== b.lastTouched) return b.lastTouched - a.lastTouched;
    return a.path.localeCompare(b.path);
  });

  const blockedCount = items.filter((item) => item.mergeReadiness === "blocked").length;
  const needsValidationCount = items.filter((item) => item.mergeReadiness === "needs_validation").length;
  const readyCount = items.filter((item) => item.mergeReadiness === "ready").length;

  return {
    items,
    conflictCount: items.filter((item) => item.conflict).length,
    highRiskCount: items.filter((item) => item.risk === "critical" || item.risk === "high").length,
    agentTouchedCount: items.filter((item) => item.sessions.length > 0).length,
    needsValidationCount,
    blockedCount,
    readyCount,
    totalRiskScore: items.reduce((sum, item) => sum + item.score, 0),
    mergeReadiness:
      blockedCount > 0
        ? "blocked"
        : needsValidationCount > 0
          ? "needs_validation"
          : items.some((item) => item.mergeReadiness === "needs_review")
            ? "needs_review"
            : "ready",
  };
}

function scoreReviewItem({
  conflict,
  diffstat,
  fileRiskScore,
  riskClass,
  generated,
  coverage,
  validation,
  sessionCount,
}: {
  conflict: boolean;
  diffstat: ReviewQueueItem["diffstat"];
  fileRiskScore: number;
  riskClass: ReviewRiskClass;
  generated: boolean;
  coverage: ReviewCoverageState;
  validation: ReviewValidationState;
  sessionCount: number;
}): ReviewQueueItem["scoreBreakdown"] {
  const diffScore = diffstat.binary
    ? 22
    : diffstat.total >= 1000
      ? 24
      : diffstat.total >= 300
        ? 18
        : diffstat.total >= 100
          ? 12
          : diffstat.total >= 30
            ? 6
            : diffstat.total > 0
              ? 2
              : 0;
  const coverageScore = coverage === "missing" ? 16 : coverage === "unknown" ? 6 : coverage === "covered" ? -8 : 0;
  const validationScore =
    validation === "failed" ? 35 : validation === "missing" ? 14 : validation === "passed" ? -10 : 0;
  const flags =
    (riskClass === "security" ? 10 : 0) +
    (riskClass === "dependency" || riskClass === "config" || riskClass === "migration" ? 8 : 0) +
    (generated ? 6 : 0) +
    (diffstat.binary || riskClass === "binary" ? 12 : 0);
  const conflicts = conflict ? 40 : 0;
  const agentAuthors = sessionCount > 1 ? 15 : sessionCount === 1 ? 5 : 0;
  const total = Math.max(
    0,
    fileRiskScore + diffScore + coverageScore + validationScore + flags + conflicts + agentAuthors,
  );
  return {
    diffstat: diffScore,
    fileRisk: fileRiskScore,
    coverage: coverageScore,
    conflicts,
    agentAuthors,
    validation: validationScore,
    flags,
    total,
  };
}

function riskFromScore(score: number, conflict: boolean, validation: ReviewValidationState): ReviewRisk {
  if (conflict || validation === "failed" || score >= 78) return "critical";
  if (score >= 45) return "high";
  if (score >= 20) return "medium";
  return "low";
}

function readinessFor({
  conflict,
  risk,
  coverage,
  validation,
}: {
  conflict: boolean;
  risk: ReviewRisk;
  coverage: ReviewCoverageState;
  validation: ReviewValidationState;
}): ReviewMergeReadiness {
  if (conflict || validation === "failed") return "blocked";
  if (coverage === "missing" || validation === "missing") return "needs_validation";
  if (risk === "critical" || risk === "high" || coverage === "unknown" || validation === "unknown")
    return "needs_review";
  return "ready";
}

function normalizeCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
}

function isBinaryPath(path: string): boolean {
  const ext = normalizePath(path).split(".").pop()?.toLowerCase();
  return Boolean(ext && BINARY_EXTENSIONS.has(ext));
}

function isGeneratedPath(path: string): boolean {
  const normalized = normalizePath(path).toLowerCase();
  return (
    normalized.includes("/generated/") ||
    normalized.includes("/dist/") ||
    normalized.includes("/coverage/") ||
    normalized.includes(".generated.") ||
    normalized.includes(".gen.") ||
    normalized.endsWith(".snap")
  );
}

function isTestPath(path: string): boolean {
  const normalized = normalizePath(path).toLowerCase();
  return (
    normalized.includes("__tests__/") ||
    normalized.includes("/tests/") ||
    normalized.endsWith(".test.ts") ||
    normalized.endsWith(".test.tsx") ||
    normalized.endsWith(".spec.ts") ||
    normalized.endsWith(".spec.tsx") ||
    normalized.endsWith("_test.rs")
  );
}

function isCodePath(path: string): boolean {
  const normalized = normalizePath(path).toLowerCase();
  return /\.(cjs|css|js|jsx|mjs|rs|ts|tsx)$/.test(normalized) && !isTestPath(normalized);
}

function collectRelatedTests(sessions: readonly AgentSession[], changedFiles: readonly GitChangedFile[]): Set<string> {
  const tests = new Set<string>();
  for (const file of changedFiles) {
    if (isTestPath(file.path)) tests.add(testKey(file.path));
  }
  for (const session of sessions) {
    for (const detail of session.changedFileDetails ?? []) {
      if (isTestPath(detail.path)) tests.add(testKey(detail.path));
    }
  }
  return tests;
}

function inferCoverage(
  path: string,
  riskClass: ReviewRiskClass,
  binary: boolean,
  generated: boolean,
  relatedTests: Set<string>,
): ReviewCoverageState {
  const normalized = normalizePath(path).toLowerCase();
  if (binary || generated || riskClass === "docs" || riskClass === "test" || isTestPath(normalized))
    return "not_required";
  if (!isCodePath(normalized)) return "unknown";
  return relatedTests.has(testKey(path)) ? "covered" : "missing";
}

function inferValidation(
  path: string,
  riskClass: ReviewRiskClass,
  sessions: readonly ReviewQueueSession[],
  sessionById: Map<string, AgentSession>,
): ReviewValidationState {
  let sawPass = false;
  for (const session of sessions) {
    const source = sessionById.get(session.id);
    if (!source) continue;
    const state = validationFromLogs(source.logs);
    if (state === "failed") return "failed";
    if (state === "passed") sawPass = true;
  }
  if (sawPass) return "passed";
  if (isCodePath(path) || riskClass === "security" || riskClass === "dependency" || riskClass === "backend") {
    return "missing";
  }
  return "unknown";
}

function validationFromLogs(logs: AgentSession["logs"]): ReviewValidationState {
  let sawValidation = false;
  let sawPass = false;
  for (const log of logs) {
    const content = `${log.metadata?.toolName ?? ""} ${log.content}`;
    if (!/\b(test|vitest|playwright|tsc|cargo|validation|validated|check)\b/i.test(content)) continue;
    sawValidation = true;
    if (
      /\b(fail(?:ed|ure)?|error|timed out|timeout|exit code [1-9]\d*)\b/i.test(content) &&
      !/\b0 failed\b/i.test(content)
    ) {
      return "failed";
    }
    if (/\b(pass(?:ed)?|success|succeeded|exit code 0|0 failed|validated)\b/i.test(content)) {
      sawPass = true;
    }
  }
  if (sawPass) return "passed";
  return sawValidation ? "unknown" : "missing";
}

function testKey(path: string): string {
  const file = normalizePath(path).toLowerCase().split("/").pop() ?? path.toLowerCase();
  return file
    .replace(/\.module(?=\.)/, "")
    .replace(/\.(test|spec)\.(ts|tsx|js|jsx|mjs|cjs)$/, "")
    .replace(/_test\.rs$/, "")
    .replace(/\.(ts|tsx|js|jsx|mjs|cjs|rs|css)$/, "");
}

function compactSignals(signals: Array<string | null>): string[] {
  return [...new Set(signals.filter((signal): signal is string => Boolean(signal)))].slice(0, 6);
}
