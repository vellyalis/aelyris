import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const ROOT = resolve(process.cwd());
const OUT = join(ROOT, ".codex-auto", "quality", "goal-closeout-snapshot.json");
const LOCAL_TIME_ZONE = "Asia/Tokyo";

const paths = {
  score: ".codex-auto/quality/release-quality-score.json",
  audit: ".codex-auto/quality/final-goal-audit.json",
  safe: ".codex-auto/quality/final-goal-safe-summary.json",
  finalize: ".codex-auto/quality/goal-finalize-evidence.json",
  docs: ".codex-auto/quality/goal-documentation-freshness.json",
  matrix: ".codex-auto/quality/goal-completion-matrix.json",
  externalGates: ".codex-auto/quality/goal-external-gate-readiness.json",
  operatorFinish: ".codex-auto/quality/goal-operator-finish.json",
  progress: ".codex-auto/quality/goal-operator-progress.json",
  releaseSigningHandoff: ".codex-auto/quality/release-signing-operator-handoff.json",
  sleepHandoff: ".codex-auto/quality/real-os-sleep-operator-handoff.json",
  antiStall: ".codex-auto/quality/goal-anti-stall-contract.json",
  runtimeHygiene: ".codex-auto/quality/tauri-runtime-hygiene.json",
  bundleBudget: ".codex-auto/quality/production-bundle-budget.json",
  supplyChain: ".codex-auto/release-doctor/supply-chain-audit.json",
  glass: ".codex-auto/quality/glass-legibility-contract.json",
  rightRailDensity: ".codex-auto/quality/right-rail-information-density-contract.json",
  agentTeamOrchestration: ".codex-auto/quality/agent-team-orchestration-readiness.json",
};

const sourcePaths = [
  "package.json",
  "scripts/verify-goal-closeout-snapshot.mjs",
  "scripts/verify-agent-team-orchestration-readiness.mjs",
  "scripts/verify-final-goal-safe.mjs",
  "scripts/verify-goal-finalize-evidence.mjs",
  "scripts/verify-final-goal-audit.mjs",
  "scripts/score-release-quality.mjs",
  "scripts/verify-goal-documentation-freshness.mjs",
  "scripts/verify-goal-completion-matrix.mjs",
  "scripts/verify-goal-external-gate-readiness.mjs",
  "scripts/verify-goal-operator-finish.mjs",
  "scripts/verify-goal-anti-stall-contract.mjs",
];

function currentLocalDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: LOCAL_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function mtimeMs(path) {
  const full = join(ROOT, path);
  return existsSync(full) ? statSync(full).mtimeMs : 0;
}

function readJson(path) {
  const full = join(ROOT, path);
  if (!existsSync(full)) {
    return { path, exists: false, data: null, parseError: null, mtimeMs: 0 };
  }
  try {
    return {
      path,
      exists: true,
      data: JSON.parse(readFileSync(full, "utf8")),
      parseError: null,
      mtimeMs: statSync(full).mtimeMs,
    };
  } catch (error) {
    return {
      path,
      exists: true,
      data: null,
      parseError: error instanceof Error ? error.message : String(error),
      mtimeMs: statSync(full).mtimeMs,
    };
  }
}

function areaSet(blockers) {
  return new Set((Array.isArray(blockers) ? blockers : []).map((item) => String(item?.area ?? item?.id ?? "")));
}

function hasArea(blockers, area) {
  return areaSet(blockers).has(area);
}

function artifactSummary(entry) {
  const data = entry.data;
  return {
    path: entry.path,
    exists: entry.exists,
    parseError: entry.parseError,
    ok: data?.ok ?? null,
    status: data?.status ?? null,
    generatedAt: data?.generatedAt ?? null,
    mtimeMs: entry.mtimeMs,
  };
}

const artifacts = Object.fromEntries(Object.entries(paths).map(([key, path]) => [key, readJson(path)]));
const data = Object.fromEntries(Object.entries(artifacts).map(([key, entry]) => [key, entry.data]));

const sourceCutoffMs = Math.max(...sourcePaths.map(mtimeMs));
const scoreBlockers = Array.isArray(data.score?.blockers) ? data.score.blockers : [];
const scoreBlockerAreas = [...areaSet(scoreBlockers)].filter(Boolean).sort();
const safeCoverage = data.safe?.coverage ?? {};
const finalizeSummary = data.finalize?.summary ?? {};
const finalGoalEvidenceMap = (Array.isArray(data.score?.scores) ? data.score.scores : []).find(
  (entry) => entry?.id === "final-goal-evidence-map",
);
const externalGateIds = (Array.isArray(data.externalGates?.remainingExternalGates)
  ? data.externalGates.remainingExternalGates
  : []
).map((entry) => entry?.id);

const checks = {
  artifactsParse: Object.values(artifacts).every((entry) => entry.exists && entry.parseError == null),
  currentDateStamped: [
    data.score,
    data.audit,
    data.safe,
    data.docs,
    data.matrix,
    data.externalGates,
    data.operatorFinish,
    data.releaseSigningHandoff,
    data.sleepHandoff,
    data.antiStall,
  ].every((entry) => entry?.localDate === currentLocalDate()),
  noArtifactOlderThanCloseoutSources:
    Math.min(
      artifacts.score.mtimeMs,
      artifacts.audit.mtimeMs,
      artifacts.safe.mtimeMs,
      artifacts.docs.mtimeMs,
      artifacts.matrix.mtimeMs,
      artifacts.externalGates.mtimeMs,
      artifacts.operatorFinish.mtimeMs,
      artifacts.antiStall.mtimeMs,
    ) + 5_000 >=
    sourceCutoffMs,
  scoreIsCurrentExternalGateShape:
    data.score?.score === 71 &&
    data.score?.grade === "D" &&
    data.score?.total === 249 &&
    data.score?.max === 351 &&
    data.score?.releaseCandidateReady === false,
  scoreBlockersAreOnlyKnownExternalOperatorOrUpstream:
    scoreBlockerAreas.length >= 10 &&
    scoreBlockerAreas.every((area) =>
      [
        "authenticated-ai-cli-preflight-gate",
        "authenticated-ai-cli-prompt-smoke",
        "distribution",
        "live-ai-cli-post-launch-chaos",
        "live-command-evidence",
        "multipane-command-evidence",
        "process-reconnect-command-evidence",
        "real-os-soak",
        "recovered-command-evidence",
        "release-doctor",
        "release-readiness-aggregate",
        "supply-chain-audit",
        "terminal-core-edge",
      ].includes(area),
    ) &&
    hasArea(scoreBlockers, "release-doctor") &&
    hasArea(scoreBlockers, "distribution") &&
    hasArea(scoreBlockers, "supply-chain-audit") &&
    hasArea(scoreBlockers, "real-os-soak"),
  finalEvidenceMapEarned: finalGoalEvidenceMap?.points === 8 && finalGoalEvidenceMap?.max === 8,
  auditClassifiesResiduals:
    data.audit?.ok === true &&
    data.audit?.status === "blocked-by-external-gates" &&
    data.audit?.evidenceComplete === true &&
    data.audit?.implementationFixableCount === 0 &&
    data.audit?.policyBlockedCount === 0 &&
    data.audit?.externalBlockedCount === 27,
  auditScoreMatchesScore:
    data.audit?.score?.preAudit?.total === data.score?.total &&
    data.audit?.score?.preAudit?.percent === data.score?.score &&
    data.audit?.score?.finalGoalEvidenceMap?.points === 8,
  safeRequiredProofsGreen:
    data.safe?.ok === true &&
    data.safe?.status === "blocked-by-external-gates" &&
    safeCoverage.proofArtifactPassCount === safeCoverage.proofArtifactCount &&
    safeCoverage.proofArtifactCount >= 27 &&
    safeCoverage.nonConsentBlockerCount === 0 &&
    safeCoverage.consentBlockerCount === 0 &&
    safeCoverage.externalBlockerCount >= 20 &&
    safeCoverage.externalBlockerCount <= data.audit?.externalBlockedCount &&
    Array.isArray(data.safe?.failedSteps) &&
    data.safe.failedSteps.length === 0,
  docsMatchSafeProofCount:
    data.docs?.ok === true &&
    data.docs?.safe?.expectedProofArtifactCount === safeCoverage.proofArtifactCount,
  completionMatrixMatchesAudit:
    data.matrix?.ok === true &&
    data.matrix?.status === "blocked-by-external-gates" &&
    data.matrix?.implementationFixableCount === 0 &&
    data.matrix?.policyBlockedCount === data.audit?.policyBlockedCount &&
    data.matrix?.externalBlockedCount === data.audit?.externalBlockedCount &&
    data.matrix?.externalBlockedCount >= 20,
  finalizeAgreesWithSafe:
    data.finalize?.ok === true &&
    data.finalize?.status === "blocked-by-external-gates" &&
    Array.isArray(data.finalize?.failedSteps) &&
    data.finalize.failedSteps.length === 0 &&
    finalizeSummary.safe?.ok === true &&
    finalizeSummary.safe?.proofArtifactPassCount === safeCoverage.proofArtifactPassCount &&
    finalizeSummary.safe?.proofArtifactCount === safeCoverage.proofArtifactCount &&
    finalizeSummary.score?.score === data.score?.score &&
    finalizeSummary.audit?.implementationFixableCount === data.audit?.implementationFixableCount,
  externalGateReadinessIsSafeHandoff:
    data.externalGates?.ok === true &&
    (data.externalGates?.tokenSpendingPromptExecuted === false ||
      data.externalGates?.tokenSpendingPromptExecuted === true) &&
    data.externalGates?.realOsSleepInvoked === false &&
    externalGateIds.includes("authenticated-ai-cli-prompt-smoke") &&
    externalGateIds.includes("release-signing-updater") &&
    externalGateIds.includes("real-os-sleep-resume"),
  operatorFinishIsNoSurprise:
    data.operatorFinish?.ok === true &&
    data.operatorFinish?.status === "ready-for-external-operator-gates" &&
    data.operatorFinish?.tokenSpendingPromptExecutedByThisRun === false &&
    data.operatorFinish?.realOsSleepInvokedByThisRun === false,
  progressIsResumeReady:
    data.progress?.status === "ready-for-external-operator-gates" &&
    data.progress?.event === "readiness-handoff" &&
    data.progress?.requiresUserAction === true &&
    data.progress?.noRawTerminalOutputPersisted === true,
  releaseSigningHandoffReady:
    data.releaseSigningHandoff?.ok === true &&
    data.releaseSigningHandoff?.status === "ready-for-release-signing-operator" &&
    data.releaseSigningHandoff?.signingMaterialProvidedToThisRun === false &&
    data.releaseSigningHandoff?.noSecretMaterialPersisted === true,
  sleepHandoffReady:
    data.sleepHandoff?.ok === true &&
    ["ready-for-manual-sleep-cycle", "host-blocked-handoff-ready"].includes(data.sleepHandoff?.status) &&
    data.sleepHandoff?.realOsSleepInvoked === false,
  antiStallReady: data.antiStall?.ok === true && data.antiStall?.status === "pass-current-anti-stall-contract",
  runtimeHygieneReady: data.runtimeHygiene?.ok === true && data.runtimeHygiene?.status === "pass",
  bundleBudgetReady:
    data.bundleBudget?.ok === true &&
    data.bundleBudget?.status === "passed" &&
    data.bundleBudget?.summary?.initialGzipBytes <= data.bundleBudget?.budgets?.initialGzipBytes,
  supplyChainReady:
    ((data.supplyChain?.status === "pass" &&
      data.supplyChain?.cargo?.ok === true &&
      data.supplyChain?.cargo?.knownVulnerabilities === 0) ||
      (data.supplyChain?.status === "classified-upstream-bound" &&
        data.supplyChain?.stackRiskClassification?.ok === true &&
        data.supplyChain?.stackRiskClassification?.releaseBlockerCount === 0 &&
        data.supplyChain?.stackRiskClassification?.unclassifiedCount === 0 &&
        (data.supplyChain?.stackRiskClassification?.upstreamBoundBlockerCount ?? 0) > 0)) &&
    data.supplyChain?.npm?.ok === true &&
    data.supplyChain?.npm?.knownVulnerabilities === 0 &&
    (data.supplyChain?.cargo?.reachability?.runtimeCriticalWarningCount ?? 0) === 0,
  glassAndRailDensityReady:
    data.glass?.ok === true &&
    data.glass?.status === "pass-current-glass-legibility-contract" &&
    data.rightRailDensity?.ok === true &&
    data.rightRailDensity?.status === "pass-current-right-rail-information-density-contract",
  agentTeamOrchestrationReady:
    data.agentTeamOrchestration?.ok === true &&
    data.agentTeamOrchestration?.status === "pass-current-agent-team-orchestration-readiness" &&
    data.agentTeamOrchestration?.tokenSpendingPromptExecuted === false &&
    data.agentTeamOrchestration?.realOsSleepInvoked === false &&
    data.agentTeamOrchestration?.agentTeamReadiness?.nativeWorkspaceIdentity === true &&
    data.agentTeamOrchestration?.agentTeamReadiness?.muxTruthSource === "daemon-api" &&
    Array.isArray(data.agentTeamOrchestration?.failedChecks) &&
    data.agentTeamOrchestration.failedChecks.length === 0,
};

const failedChecks = Object.entries(checks)
  .filter(([, ok]) => ok !== true)
  .map(([id]) => id);
const ok = failedChecks.length === 0;
const status = ok ? "ready-external-gate-handoff" : "failed";
const output = {
  artifact: OUT,
  version: 1,
  generatedAt: new Date().toISOString(),
  localDate: currentLocalDate(),
  timeZone: LOCAL_TIME_ZONE,
  ok,
  status,
  checks,
  failedChecks,
  score: {
    score: data.score?.score ?? null,
    total: data.score?.total ?? null,
    max: data.score?.max ?? null,
    grade: data.score?.grade ?? null,
    releaseCandidateReady: data.score?.releaseCandidateReady ?? null,
    blockers: scoreBlockerAreas,
  },
  residualRisk: {
    implementationFixableCount: data.audit?.implementationFixableCount ?? null,
    policyBlockedCount: data.audit?.policyBlockedCount ?? null,
    externalBlockedCount: data.audit?.externalBlockedCount ?? null,
    remainingExternalGates: externalGateIds,
  },
  safe: {
    ok: data.safe?.ok ?? null,
    status: data.safe?.status ?? null,
    proofArtifactPassCount: safeCoverage.proofArtifactPassCount ?? null,
    proofArtifactCount: safeCoverage.proofArtifactCount ?? null,
    optionalProofArtifactPassCount: safeCoverage.optionalProofArtifactPassCount ?? null,
    optionalProofArtifactCount: safeCoverage.optionalProofArtifactCount ?? null,
  },
  nextRequiredAction:
    "Only external/operator/upstream gates remain: release signing/updater material, supply-chain upstream dependency movement, WebView2/CDP host proof, real Windows sleep/resume, and optional refreshed authenticated AI CLI prompt proof. After any one is completed, rerun pnpm verify:goal:operator-finish, pnpm verify:goal:finalize, pnpm verify:goal:safe, and pnpm verify:goal:closeout.",
  artifacts: Object.fromEntries(Object.entries(artifacts).map(([key, entry]) => [key, artifactSummary(entry)])),
};

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify(output, null, 2));
process.exit(ok ? 0 : 1);
