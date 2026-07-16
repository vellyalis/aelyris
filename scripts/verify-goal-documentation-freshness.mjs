import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
  evaluateGoalDocumentationPolicy,
  generatedArtifactIsCurrent,
  goalDocumentationPolicySelfTest,
} from "./lib/goal-documentation-policy.mjs";

const ROOT = resolve(process.cwd());
const OUT = join(ROOT, ".codex-auto", "quality", "goal-documentation-freshness.json");
const SCORE_PATH = ".codex-auto/quality/release-quality-score.json";
const AUDIT_PATH = ".codex-auto/quality/final-goal-audit.json";
const LOCAL_TIME_ZONE = "Asia/Tokyo";
const CURRENT_STATE_DOCS = [
  "AGENTS.md",
  "README.md",
  "docs/README.md",
  "docs/AGENT_WORKFLOWS.md",
  "docs/PUBLICATION_READINESS.md",
  "docs/requirements.md",
  "docs/specs/README.md",
  "docs/specs/WU_RT_1_CONTINUATION.md",
  "docs/specs/AELYRIS_REQUIREMENTS_SPEC_DESIGN_TRACEABILITY_2026-06-27.md",
];
const DETAILED_CURRENT_STATE_DOCS = new Set([
  "docs/PUBLICATION_READINESS.md",
  "docs/specs/WU_RT_1_CONTINUATION.md",
  "docs/specs/AELYRIS_REQUIREMENTS_SPEC_DESIGN_TRACEABILITY_2026-06-27.md",
]);
const STALE_DOCUMENTATION_PATTERNS = [
  {
    id: "stale-merge-absence-claim",
    pattern: /No merge-to-main command exists/,
  },
  {
    id: "removed-project-skill-name",
    pattern: /\baelyris-(?:plan|fleet)\b/,
  },
  {
    id: "ui-token-still-proposed",
    pattern: /PROPOSED \(apply-ready change list, NOT applied\)/,
  },
  {
    id: "old-mcp-spec-branch",
    pattern: /codex\/release-hardening-quality-gates|Nothing here is\s+implemented yet/,
  },
  {
    id: "dead-traceability-verifier",
    pattern: /verify:mux-tmux-grade-contract|verify:native-daily-driver-terminal|FULL_NATIVE_RUST_FINAL_GOAL/,
  },
  {
    id: "stale-hardening-continuation",
    pattern:
      /Current target: hardening completion audit from H1 through H8|target is hardening completion audit|Baseline pushed commit before this continuation refresh|71af0b0 docs: track active work orders/,
  },
  {
    id: "old-hand-baked-release-score",
    pattern: /\b35\/100\b|\b124\/351\b/,
  },
];

function collectDocumentationPaths() {
  const paths = ["AGENTS.md", "README.md"];
  const stack = ["docs"];
  while (stack.length > 0) {
    const dir = stack.pop();
    for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
      const relative = join(dir, entry.name).replaceAll("\\", "/");
      if (relative.startsWith("docs/assets/")) continue;
      if (entry.isDirectory()) {
        stack.push(relative);
      } else if (entry.isFile() && /\.(md|mdx|txt)$/i.test(entry.name)) {
        paths.push(relative);
      }
    }
  }
  return [...new Set(paths)].sort();
}

function currentLocalDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: LOCAL_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function readJson(path) {
  const full = join(ROOT, path);
  if (!existsSync(full)) return null;
  return JSON.parse(readFileSync(full, "utf8"));
}

function readText(path) {
  const full = join(ROOT, path);
  if (!existsSync(full)) return null;
  return readFileSync(full, "utf8");
}

function docResult(path, releaseCandidateReady) {
  return evaluateGoalDocumentationPolicy({
    path,
    text: readText(path),
    detailed: DETAILED_CURRENT_STATE_DOCS.has(path),
    releaseCandidateReady,
  });
}

function staleDocumentationHits(paths) {
  const hits = [];
  for (const path of paths) {
    const text = readText(path);
    if (text == null) continue;
    for (const stalePattern of STALE_DOCUMENTATION_PATTERNS) {
      const match = text.match(stalePattern.pattern);
      if (!match) continue;
      hits.push({
        path,
        id: stalePattern.id,
        match: match[0].slice(0, 160),
      });
    }
  }
  return hits;
}

const score = readJson(SCORE_PATH);
const audit = readJson(AUDIT_PATH);
const projectedScorePercent =
  typeof audit?.score?.projectedAfterEvidenceMap?.percent === "number"
    ? audit.score.projectedAfterEvidenceMap.percent
    : 0;
const projectedScoreTotal =
  typeof audit?.score?.projectedAfterEvidenceMap?.total === "number" ? audit.score.projectedAfterEvidenceMap.total : 0;
const effectiveScorePercent = Math.max(score?.score ?? 0, projectedScorePercent);
const effectiveScoreTotal = Math.max(score?.total ?? 0, projectedScoreTotal);
const scoreShapeValid =
  Number.isInteger(score?.score) &&
  score.score >= 0 &&
  score.score <= 100 &&
  Number.isFinite(score?.total) &&
  Number.isFinite(score?.max) &&
  score.total >= 0 &&
  score.max >= score.total &&
  score.max >= 300 &&
  typeof score?.grade === "string" &&
  typeof score?.releaseCandidateReady === "boolean" &&
  Array.isArray(score?.scores) &&
  score.scores.some((item) => item?.id === "final-goal-evidence-map") &&
  Array.isArray(score?.blockers);
const auditResidualRiskRegister = audit?.residualRiskRegister ?? null;
const auditResidualCountsMatch =
  auditResidualRiskRegister != null &&
  audit?.implementationFixableCount === auditResidualRiskRegister.implementationFixableCount &&
  audit?.policyBlockedCount === auditResidualRiskRegister.policyBlockedCount &&
  audit?.externalBlockedCount === auditResidualRiskRegister.externalBlockedCount;
const auditResidualRiskStateValid =
  audit?.status === "complete"
    ? auditResidualRiskRegister?.state === "complete" &&
      audit?.goalComplete === true &&
      audit?.evidenceComplete === true &&
      auditResidualRiskRegister?.completionClaimAllowed === true
    : audit?.status === "blocked-by-explicit-consent"
      ? auditResidualRiskRegister?.state === "blocked-only-by-explicit-token-consent" &&
        auditResidualRiskRegister?.implementationFixableCount === 0 &&
        auditResidualRiskRegister?.policyBlockedCount === 1 &&
        (auditResidualRiskRegister?.externalBlockedCount ?? 0) === 0
      : audit?.status === "blocked-by-external-gates"
        ? auditResidualRiskRegister?.state === "blocked-by-external-gates" &&
          auditResidualRiskRegister?.implementationFixableCount === 0 &&
          (auditResidualRiskRegister?.externalBlockedCount ?? 0) >= 1
        : audit?.status === "blocked"
          ? auditResidualRiskRegister?.state === "implementation-risk-open" &&
            (auditResidualRiskRegister?.implementationFixableCount ?? 0) > 0 &&
            audit?.goalComplete === false
          : false;
const localDate = currentLocalDate();
const docs = CURRENT_STATE_DOCS.map((path) => docResult(path, score?.releaseCandidateReady === true));
const documentationPaths = collectDocumentationPaths();
const stalePatternHits = staleDocumentationHits(documentationPaths);
const policySelfTest = goalDocumentationPolicySelfTest();
const checks = {
  scoreExists: score != null,
  auditExists: audit != null,
  scoreArtifactCurrent: generatedArtifactIsCurrent(score, localDate),
  auditArtifactCurrent: generatedArtifactIsCurrent(audit, localDate),
  scoreIsCurrentShape:
    scoreShapeValid && effectiveScorePercent === score?.score && effectiveScoreTotal === score?.total,
  auditIsCurrentConsentGate:
    audit != null &&
    (audit?.status === "blocked-by-explicit-consent" ||
      audit?.status === "blocked-by-external-gates" ||
      audit?.status === "complete" ||
      audit?.status === "blocked") &&
    auditResidualCountsMatch &&
    auditResidualRiskStateValid,
  documentationPolicySelfTestPasses: policySelfTest.ok,
  currentStateDocsSourceLinked: docs.every((doc) => doc.ok),
  noKnownStaleDocumentationPatterns: stalePatternHits.length === 0,
};

const ok = Object.values(checks).every(Boolean);
const report = {
  version: 2,
  contractVersion: "source-linked-machine-truth/v2",
  generatedAt: new Date().toISOString(),
  timeZone: LOCAL_TIME_ZONE,
  ok,
  status: ok ? "pass-current-goal-docs-contract" : "failed",
  localDate,
  requiredDocPaths: CURRENT_STATE_DOCS,
  checkedDocCount: docs.length,
  policySelfTest,
  stalePatternScan: {
    checkedPathCount: documentationPaths.length,
    patterns: STALE_DOCUMENTATION_PATTERNS.map((item) => item.id),
    hits: stalePatternHits,
  },
  score: score
    ? {
        generatedAt: score.generatedAt,
        localDate: score.localDate,
        score: score.score,
        grade: score.grade,
        total: score.total,
        max: score.max,
        releaseCandidateReady: score.releaseCandidateReady === true,
      }
    : null,
  audit: audit
    ? {
        generatedAt: audit.generatedAt,
        localDate: audit.localDate,
        ok: audit.ok === true,
        status: audit.status,
        implementationFixableCount: audit.residualRiskRegister?.implementationFixableCount ?? null,
        policyBlockedCount: audit.residualRiskRegister?.policyBlockedCount ?? null,
        externalBlockedCount: audit.residualRiskRegister?.externalBlockedCount ?? null,
      }
    : null,
  checks,
  docs,
};

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ artifact: OUT, ...report }, null, 2));
if (!report.ok) process.exitCode = 1;
