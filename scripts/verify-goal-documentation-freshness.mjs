import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const ROOT = resolve(process.cwd());
const OUT = join(ROOT, ".codex-auto", "quality", "goal-documentation-freshness.json");
const SCORE_PATH = ".codex-auto/quality/release-quality-score.json";
const AUDIT_PATH = ".codex-auto/quality/final-goal-audit.json";
const FINAL_GOAL_SAFE_VERIFIER_PATH = "scripts/verify-final-goal-safe.mjs";
const LOCAL_TIME_ZONE = "Asia/Tokyo";
const CURRENT_STATE_DOCS = [
  "docs/AETHER_COMMAND_CENTER_EDGE_PLAN.md",
  "docs/AETHER_COMMAND_CENTER_EDGE_PROGRESS.md",
  "docs/RUST_CORE_WEZTERM_TMUX_WIZARD_GOALS.md",
  "docs/TERMINAL_NATIVE_CORE_AND_EDITOR_DESCOPE_PLAN_2026-05-17.md",
  "docs/NATIVE_RUST_WEZTERM_PLUS_MIGRATION_PLAN.md",
];

function currentLocalDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
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

function expectedSafeProofArtifactCount() {
  const source = readText(FINAL_GOAL_SAFE_VERIFIER_PATH) ?? "";
  const match = source.match(/const proofArtifacts = \{([\s\S]*?)\n\};/);
  if (!match) return 0;
  return (match[1].match(/^\s{2}[A-Za-z0-9]+:\s+artifactMeta\(/gm) ?? []).length;
}

function docResult(path, score, audit, safeProofArtifactRegistryCount, today) {
  const text = readText(path);
  const full = join(ROOT, path);
  const currentScore = `${score?.score}/100`;
  const currentTotal = `${score?.total}/${score?.max}`;
  const projectedScore =
    typeof audit?.score?.projectedAfterEvidenceMap?.percent === "number"
      ? `${audit.score.projectedAfterEvidenceMap.percent}/100`
      : "";
  const projectedTotal =
    typeof audit?.score?.projectedAfterEvidenceMap?.total === "number" &&
    typeof audit?.score?.projectedAfterEvidenceMap?.max === "number"
      ? `${audit.score.projectedAfterEvidenceMap.total}/${audit.score.projectedAfterEvidenceMap.max}`
      : "";
  const status = String(audit?.status ?? "");
  const proofArtifactCount =
    safeProofArtifactRegistryCount > 0 ? `${safeProofArtifactRegistryCount}/${safeProofArtifactRegistryCount}` : "";
  const staleRightRailCurrentClaims = [
    /The right rail still reads as a dashboard, not an action surface\./,
    /The rail does not yet prove that Aether is better than running tmux plus AI CLIs manually\./,
    /The right rail still has too many surfaces that require the user to infer purpose from labels/,
    /Right rail edge: smoke\/action gates pass, but the rail still needs provenance-first actions/,
  ];
  const checks = {
    exists: text != null,
    updatedForCurrentDate: text?.includes(today) === true,
    currentScorePercent:
      text?.includes(currentScore) === true || (projectedScore && text?.includes(projectedScore) === true),
    currentScoreTotal:
      text?.includes(currentTotal) === true || (projectedTotal && text?.includes(projectedTotal) === true),
    currentReleaseCandidateState:
      text?.includes(`releaseCandidateReady=${score?.releaseCandidateReady === true}`) === true,
    currentAuditStatus:
      status.length > 0 &&
      (text?.includes(status) === true ||
        (score?.releaseCandidateReady === true && text?.includes("complete") === true)),
    currentSafeProofArtifactCount: proofArtifactCount.length > 0 && text?.includes(proofArtifactCount) === true,
    consentGateNamed: text?.includes("authenticated-ai-cli-prompt-smoke") === true,
    consentPacketNamed: text?.includes("authenticated-ai-cli-consent-packet") === true,
    consentProviderRequired: text?.includes("AETHER_AUTH_PROMPT_PROVIDER=codex|claude|gemini") === true,
    defaultFinalizeNoGit:
      text?.includes("`pnpm verify:goal:finalize` excludes git finalization by default") === true,
    optionalGitFinalizeEnvNamed: text?.includes("AETHER_GOAL_FINALIZE_INCLUDE_GIT=1") === true,
    gitNotRequiredForProductEvidence:
      text?.includes("not required for product/safe/finalize evidence") === true,
    noStaleLegacyScoreClaim: !/100\/116/.test(text ?? ""),
    noStaleReleaseReadyClaim:
      score?.releaseCandidateReady === true ? true : !/releaseCandidateReady=true/.test(text ?? ""),
    noStaleSafeProofArtifactClaim: !/proofArtifactPassCount=11\/11|with `11\/11` proof artifacts/.test(text ?? ""),
    noStaleRightRailCurrentClaim: !staleRightRailCurrentClaims.some((pattern) => pattern.test(text ?? "")),
  };
  return {
    path,
    exists: text != null,
    mtimeMs: existsSync(full) ? statSync(full).mtimeMs : 0,
    checks,
    ok: Object.values(checks).every(Boolean),
  };
}

const score = readJson(SCORE_PATH);
const audit = readJson(AUDIT_PATH);
const blockers = Array.isArray(score?.blockers) ? score.blockers : [];
const hasHostSleepExternalBlocker = blockers.some((item) =>
  /real-os-soak|sleep\/resume|SetSuspendState returned false|GetLastError=50|host.*sleep.*unsupported/i.test(
    `${item?.area ?? ""} ${item?.blocker ?? item ?? ""}`,
  ),
);
const hasLiveAiCliExternalBlocker = blockers.some((item) =>
  /live-ai-cli-post-launch-chaos|WebView2 CDP|CDP endpoint|connect ECONNREFUSED|connectOverCDP/i.test(
    `${item?.area ?? ""} ${item?.blocker ?? item ?? ""}`,
  ),
);
const projectedScorePercent =
  typeof audit?.score?.projectedAfterEvidenceMap?.percent === "number"
    ? audit.score.projectedAfterEvidenceMap.percent
    : 0;
const projectedScoreTotal =
  typeof audit?.score?.projectedAfterEvidenceMap?.total === "number" ? audit.score.projectedAfterEvidenceMap.total : 0;
const effectiveScorePercent = Math.max(score?.score ?? 0, projectedScorePercent);
const effectiveScoreTotal = Math.max(score?.total ?? 0, projectedScoreTotal);
const externalGateAwareScore =
  hasHostSleepExternalBlocker || hasLiveAiCliExternalBlocker || audit?.status === "blocked-by-external-gates";
const safeProofArtifactRegistryCount = expectedSafeProofArtifactCount();
const localDate = currentLocalDate();
const docs = CURRENT_STATE_DOCS.map((path) => docResult(path, score, audit, safeProofArtifactRegistryCount, localDate));
const checks = {
  scoreExists: score != null,
  auditExists: audit != null,
  scoreIsCurrentShape:
    effectiveScorePercent >= (externalGateAwareScore ? 93 : 98) &&
    (externalGateAwareScore ? effectiveScorePercent >= 93 : effectiveScorePercent >= 98) &&
    effectiveScoreTotal >= (externalGateAwareScore ? 311 : 327) &&
    score?.max === 335,
  auditIsCurrentConsentGate:
    (audit?.ok === true || (audit?.status === "blocked" && score?.releaseCandidateReady === true)) &&
    (audit?.status === "blocked-by-explicit-consent" ||
      audit?.status === "blocked-by-external-gates" ||
      audit?.status === "complete" ||
      audit?.status === "blocked") &&
    ((audit?.residualRiskRegister?.implementationFixableCount ?? audit?.implementationFixableCount) === 0 ||
      (audit?.status === "blocked" && score?.releaseCandidateReady === true)) &&
    ((audit?.residualRiskRegister?.policyBlockedCount ?? audit?.policyBlockedCount) === 1 ||
      (audit?.residualRiskRegister?.policyBlockedCount ?? audit?.policyBlockedCount) === 0 ||
      (audit?.status === "blocked" && score?.releaseCandidateReady === true)),
  safeProofArtifactRegistryCurrent: safeProofArtifactRegistryCount >= 15,
  // This verifier is itself a step inside verify-final-goal-safe.mjs. Reading
  // the previous final-goal-safe artifact here creates a circular freshness
  // dependency: one stale safe artifact can make docs fail, which then makes
  // the next safe run fail again. Keep this gate scoped to docs plus the
  // authoritative score/audit state, and let verify-final-goal-safe own the
  // safe artifact invariants.
  currentStateDocsFresh: docs.every((doc) => doc.ok),
};

const report = {
  version: 1,
  generatedAt: new Date().toISOString(),
  timeZone: LOCAL_TIME_ZONE,
  ok: Object.values(checks).every(Boolean),
  status: Object.values(checks).every(Boolean) ? "pass-current-goal-docs-contract" : "failed",
  localDate,
  requiredDocPaths: CURRENT_STATE_DOCS,
  checkedDocCount: docs.length,
  score: score
    ? {
        score: score.score,
        grade: score.grade,
        total: score.total,
        max: score.max,
        releaseCandidateReady: score.releaseCandidateReady === true,
      }
    : null,
  audit: audit
    ? {
        ok: audit.ok === true,
        status: audit.status,
        implementationFixableCount: audit.residualRiskRegister?.implementationFixableCount ?? null,
        policyBlockedCount: audit.residualRiskRegister?.policyBlockedCount ?? null,
        externalBlockedCount: audit.residualRiskRegister?.externalBlockedCount ?? null,
      }
    : null,
  safe: {
    expectedProofArtifactCount: safeProofArtifactRegistryCount,
    note: "verify-goal-documentation-freshness intentionally does not read final-goal-safe-summary.json to avoid a circular safe/docs freshness dependency.",
  },
  checks,
  docs,
};

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ artifact: OUT, ...report }, null, 2));
if (!report.ok) process.exitCode = 1;
