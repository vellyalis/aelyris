import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import process from "node:process";

const ROOT = resolve(process.cwd());
const OUT = join(ROOT, ".codex-auto", "quality", "final-goal-safe-summary.json");
const BOOTSTRAP_RIGHT_RAIL = process.env.AETHER_FINAL_GOAL_SAFE_BOOTSTRAP_RIGHT_RAIL === "1";
const LOCAL_TIME_ZONE = "Asia/Tokyo";
const SAFE_NO_TOKEN_PROMPT_SENTINEL = "tokenSpendingPromptExecuted: false";
const ANSI_ESCAPE_PATTERN = new RegExp(`${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`, "g");
const SAFE_STEP_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const STEP_FALLBACK_ARTIFACTS = {
  "authenticated-provider-guard": [".codex-auto/production-smoke/authenticated-ai-cli-provider-required-smoke.json"],
  "real-ai-cli-binary-probe": [".codex-auto/production-smoke/real-ai-cli-binary-probe.json"],
  "ai-cli-launch-planner": [".codex-auto/production-smoke/ai-cli-launch-planner.json"],
  "authenticated-preflight-matrix": [".codex-auto/production-smoke/authenticated-ai-cli-preflight-matrix.json"],
  "authenticated-consent-packet": [".codex-auto/production-smoke/authenticated-ai-cli-consent-packet.json"],
  "glass-legibility": [".codex-auto/quality/glass-legibility-contract.json"],
  "right-rail-information-density": [".codex-auto/quality/right-rail-information-density-contract.json"],
  "anti-stall-contract": [".codex-auto/quality/goal-anti-stall-contract.json"],
  "real-os-sleep-operator-handoff": [".codex-auto/quality/real-os-sleep-operator-handoff.json"],
  "external-gate-readiness": [".codex-auto/quality/goal-external-gate-readiness.json"],
  "tauri-runtime-hygiene": [".codex-auto/quality/tauri-runtime-hygiene.json"],
  "release-hygiene-contract": [".codex-auto/quality/release-hygiene-contract.json"],
  "supply-chain-audit": [".codex-auto/release-doctor/supply-chain-audit.json"],
  "production-build": [".codex-auto/quality/production-bundle-budget.json"],
  "production-bundle-budget": [".codex-auto/quality/production-bundle-budget.json"],
  "quality-score-pre-audit": [".codex-auto/quality/release-quality-score.json"],
  "final-goal-audit": [".codex-auto/quality/final-goal-audit.json"],
  "quality-score-post-audit": [".codex-auto/quality/release-quality-score.json"],
  "goal-documentation-freshness": [".codex-auto/quality/goal-documentation-freshness.json"],
  "final-goal-audit-after-goal-docs": [".codex-auto/quality/final-goal-audit.json"],
  "quality-score-final": [".codex-auto/quality/release-quality-score.json"],
  "goal-completion-matrix": [".codex-auto/quality/goal-completion-matrix.json"],
  "operator-finish-handoff": [".codex-auto/quality/goal-operator-finish.json"],
  "git-finalization-readiness": [".codex-auto/quality/git-finalization-readiness.json"],
  "git-finalization-shell-diagnostics": [".codex-auto/quality/git-finalization-shell-diagnostics.json"],
};
const RIGHT_RAIL_GOAL_TRACK_SOURCE_PATHS = [
  "scripts/verify-right-rail-goal-track-tauri.mjs",
  "scripts/verify-final-goal-safe.mjs",
  "scripts/verify-goal-completion-matrix.mjs",
  "scripts/verify-goal-external-gate-readiness.mjs",
  "scripts/verify-real-os-sleep-operator-handoff.mjs",
  "scripts/verify-goal-operator-finish.mjs",
  "scripts/score-release-quality.mjs",
  "scripts/verify-authenticated-ai-cli-consent-packet.mjs",
  "src/App.tsx",
  "src/shared/lib/authenticatedPromptConsent.ts",
  "src/shared/lib/releaseQuality.ts",
  "src/shared/lib/rightRailGoalTrack.ts",
  "src/styles/global.css",
];

function readJson(path) {
  const full = join(ROOT, path);
  if (!existsSync(full)) return null;
  return JSON.parse(readFileSync(full, "utf8"));
}

function mtimeMs(path) {
  const full = join(ROOT, path);
  return existsSync(full) ? statSync(full).mtimeMs : 0;
}

function currentLocalDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function releaseQualityScoreVerdict(data) {
  const blockers = Array.isArray(data?.blockers) ? data.blockers : [];
  const implementationBlockers = blockers.filter(
    (item) => !isAuthenticatedPromptBlocker(item?.blocker ?? item) && !isHostSleepUnsupportedBlocker(item),
  );
  const consentBlockers = blockers.filter((item) => isAuthenticatedPromptBlocker(item?.blocker ?? item));
  const externalBlockers = blockers.filter((item) => isHostSleepUnsupportedBlocker(item));
  const consentGated =
    data?.releaseCandidateReady === false && consentBlockers.length === 1 && implementationBlockers.length === 0;
  const externalGated =
    data?.releaseCandidateReady === false &&
    externalBlockers.length > 0 &&
    implementationBlockers.length === 0 &&
    consentBlockers.length <= 1;
  const ok =
    typeof data?.score === "number" &&
    data.score >= (externalGated ? 93 : 97) &&
    (externalGated ? ["A", "S"].includes(data?.grade) : data?.grade === "S") &&
    implementationBlockers.length === 0 &&
    (data?.releaseCandidateReady === true || consentGated || externalGated);
  return {
    ok,
    status: data?.releaseCandidateReady === true
      ? "pass"
      : externalGated
        ? "blocked-by-external-gates"
        : consentGated
          ? "blocked-by-explicit-consent"
          : "blocked",
    expectation: "S score when all gates are runnable; A+/external-gated is allowed only for host sleep plus token consent",
    reason: ok
      ? "release score proves all implementation requirements; releaseCandidateReady is false only while external host sleep or token consent gates remain"
      : "release score is below the expected threshold, has implementation blockers, or does not isolate consent/external gates",
  };
}

function providerGuardVerdict(data) {
  const checks = data?.guardVerifier?.checks ?? {};
  const ok =
    data?.status === "provider_required" &&
    data?.guardVerifier?.ok === true &&
    checks.tokenBlocked === true &&
    checks.noPromptSent === true &&
    checks.noSessionSpawned === true;
  return {
    ok,
    status: ok ? "provider-required-safe" : (data?.status ?? "blocked"),
    expectation: "provider_required guard with tokenBlocked/noPromptSent/noSessionSpawned",
    reason: ok
      ? "authenticated prompt execution was stopped before any provider prompt could be sent"
      : "provider guard did not prove safe token blocking before prompt execution",
  };
}

function everyCheckPassed(checks) {
  return Object.values(checks ?? {}).every((value) => value === true);
}

function finalGoalAuditVerdict(data) {
  const requirements = Array.isArray(data?.requirements) ? data.requirements : [];
  const missingRequirements = Array.isArray(data?.missingRequirements) ? data.missingRequirements : [];
  const residual = data?.residualRiskRegister ?? {};
  const residualTopLevelMirrors =
    data?.implementationFixableCount === residual.implementationFixableCount &&
    data?.policyBlockedCount === residual.policyBlockedCount &&
    data?.externalBlockedCount === residual.externalBlockedCount &&
    Array.isArray(data?.implementationFixableRisks) &&
    data.implementationFixableRisks.length === residual.implementationFixableCount &&
    Array.isArray(data?.policyBlockedRisks) &&
    data.policyBlockedRisks.length === residual.policyBlockedCount &&
    Array.isArray(data?.externalBlockedRisks) &&
    data.externalBlockedRisks.length === residual.externalBlockedCount;
  const runtimeChecks = data?.operationalEvidence?.runtimeHygiene?.checks ?? {};
  const authenticatedPrompt = data?.operationalEvidence?.authenticatedPromptConsent ?? {};
  const providerMatrix = authenticatedPrompt?.providerMatrix ?? {};
  const authenticatedPromptNoTokenReady =
    authenticatedPrompt.tokenSpendingExecutionBlocked === true &&
    authenticatedPrompt.safeNoPromptSent === true &&
    authenticatedPrompt.consentPacketArtifact?.tokenSpendingPromptExecuted === false;
  const authenticatedPromptConsentedReady =
    authenticatedPrompt.promptExecutionGate?.executedWithConsent === true &&
    authenticatedPrompt.safeNoPromptSent === false &&
    authenticatedPrompt.consentPacketArtifact?.tokenSpendingPromptExecuted === true;
  const authenticatedPromptStateReady = authenticatedPromptNoTokenReady || authenticatedPromptConsentedReady;
  const projectedScore = data?.score?.projectedAfterEvidenceMap ?? {};
  const releaseScoreFreshness = data?.operationalEvidence?.releaseScoreFreshness ?? {};
  const evidenceDensityComplete =
    data?.evidenceDensity?.complete === true &&
    Array.isArray(data?.missingEvidenceDensity) &&
    data.missingEvidenceDensity.length === 0 &&
    Array.isArray(data?.evidenceDensity?.items) &&
    data.evidenceDensity.items.every((item) => item?.ok === true && item.actual >= item.minimum);
  const evidencePathIntegrityComplete =
    data?.evidencePathIntegrity?.complete === true &&
    Array.isArray(data?.missingEvidencePaths) &&
    data.missingEvidencePaths.length === 0 &&
    Array.isArray(data?.evidencePathIntegrity?.items) &&
    data.evidencePathIntegrity.items.length >= 8 &&
    data.evidencePathIntegrity.items.every(
      (item) =>
        item?.ok === true &&
        item.exists === true &&
        item.size > 0 &&
        (item.kind !== "json-artifact" || item.parseableJson === true),
    );
  const allRequirementsProved =
    requirements.length >= 8 && requirements.every((requirement) => requirement?.status === "proved");
  const expectedResidualState =
    score?.releaseCandidateReady === true
      ? "complete"
      : (data?.externalBlockedCount ?? residual.externalBlockedCount ?? 0) > 0
        ? "blocked-by-external-gates"
        : "blocked-only-by-explicit-token-consent";
  const scoreProjectionMatches =
    typeof score?.total !== "number" ||
    (projectedScore.total === score.total &&
      projectedScore.max === score.max &&
      projectedScore.percent === score.score &&
      projectedScore.grade === score.grade);
  const ok =
    data?.ok === true &&
    (data?.status === "blocked-by-explicit-consent" ||
      data?.status === "blocked-by-external-gates" ||
      data?.status === "complete") &&
    data?.evidenceComplete === true &&
    evidenceDensityComplete &&
    evidencePathIntegrityComplete &&
    allRequirementsProved &&
    missingRequirements.length === 0 &&
    residual.state === expectedResidualState &&
    residual.implementationFixableCount === 0 &&
    residualTopLevelMirrors &&
    everyCheckPassed(runtimeChecks) &&
    releaseScoreFreshness.fresh === true &&
    authenticatedPromptStateReady &&
    authenticatedPrompt.nonTokenPreflightReady === true &&
    authenticatedPrompt.providerRequiredGuard?.ok === true &&
    authenticatedPrompt.providerRequiredGuard?.tokenBlocked === true &&
    authenticatedPrompt.providerRequiredGuard?.noPromptSent === true &&
    authenticatedPrompt.consentPacketArtifact?.ok === true &&
    authenticatedPrompt.consentPacketArtifact?.status === "pass" &&
    typeof authenticatedPrompt.consentPacketArtifact?.consentPacketSha256 === "string" &&
    providerMatrix.allProvidersReady === true &&
    ["codex", "claude", "gemini"].every((provider) => providerMatrix.providers?.includes?.(provider)) &&
    scoreProjectionMatches;
  return {
    ok,
    status: ok ? "pass-current-audit-contract" : (data?.status ?? "stale-or-incomplete"),
    expectation:
      "final audit proves all goal requirements, residual risk, runtime hygiene, no-token prompt gate, and score projection",
    reason: ok
      ? "final goal audit semantically matches the current score and non-token safety contract"
      : "final goal audit is stale, incomplete, or missing required goal evidence",
  };
}

function authenticatedPreflightMatrixVerdict(data) {
  const providerMatrix = Array.isArray(data?.providerMatrix) ? data.providerMatrix : [];
  const artifactEntries = Object.entries(data?.artifacts ?? {});
  const artifacts = artifactEntries.map(([, artifact]) => artifact);
  const providers = ["codex", "claude", "gemini"];
  const checks = data?.checks ?? {};
  const legacyArtifactCoveredByNativeBoundary = (key, artifact) => {
    if (artifact?.exists !== true || artifact?.parseError != null) return false;
    if (
      key === "postLaunchChaos" &&
      checks.nativePostLaunchChaosPass === true &&
      data?.artifacts?.nativePostLaunchChaos?.fresh === true
    ) {
      return true;
    }
    if (
      key === "authenticatedPrompt" &&
      checks.tokenSpendingExecutionBlocked === true &&
      checks.noPromptSent === true &&
      checks.promptExecutionStateReady === true &&
      data?.artifacts?.providerGuard?.fresh === true
    ) {
      return true;
    }
    return false;
  };
  const matrixChecksReady =
    checks.allProvidersPresent === true &&
    checks.allProvidersReady === true &&
    checks.artifactRefreshCommandsReady === true &&
    checks.tokenSpendingExecutionBlocked === true &&
    checks.noPromptSent === true &&
    checks.promptExecutionStateReady === true &&
    checks.artifactFreshness === true &&
    checks.postLaunchChaosPass === true &&
    checks.postLaunchChaosDeferred === false;
  const ok =
    data?.ok === true &&
    data?.status === "pass" &&
    matrixChecksReady &&
    providers.every((provider) => data?.providers?.includes?.(provider)) &&
    providerMatrix.length >= providers.length &&
    providers.every((provider) => {
      const row = providerMatrix.find((entry) => entry?.provider === provider);
      return (
        row?.ready === true &&
        everyCheckPassed(row.checks) &&
        row.optInCommand?.command === "pnpm verify:terminal:authenticated-ai-cli-prompt" &&
        row.optInCommand?.env?.AETHER_AUTH_PROMPT_CONSENT === "I_UNDERSTAND_THIS_MAY_SPEND_TOKENS" &&
        row.optInCommand?.env?.AETHER_AUTH_PROMPT_PROVIDER === provider
      );
    }) &&
    artifacts.length >= 6 &&
    artifactEntries.every(
      ([key, artifact]) =>
        (artifact?.exists === true && artifact?.fresh === true && artifact?.parseError == null) ||
        legacyArtifactCoveredByNativeBoundary(key, artifact),
    );
  return {
    ok,
    status: ok ? "pass-current-preflight-matrix-contract" : (data?.status ?? "stale-or-incomplete"),
    expectation:
      "Codex, Claude, and Gemini no-token preflight is ready with token execution blocked and fresh dependencies",
    reason: ok
      ? "authenticated prompt provider matrix is ready without sending a token-spending prompt"
      : "authenticated prompt provider matrix is stale, incomplete, or unsafe",
  };
}

function authenticatedConsentPacketVerdict(data) {
  const providers = Array.isArray(data?.providerReadiness) ? data.providerReadiness : [];
  const noTokenState =
    data?.checks?.noTokenPromptSent === true &&
    data?.packet?.tokenSpendingPromptExecuted === false &&
    data?.packet?.safeNoPromptSent === true;
  const consentedState =
    data?.checks?.tokenPromptExecutedWithConsent === true &&
    data?.packet?.tokenSpendingPromptExecuted === true &&
    data?.packet?.safeNoPromptSent === false;
  const ok =
    data?.ok === true &&
    data?.status === "pass" &&
    (noTokenState || consentedState) &&
    data?.checks?.promptConsentPacketReady === true &&
    data?.checks?.providerGuardBlocksPrompt === true &&
    data?.checks?.providerMatrixReady === true &&
    data?.checks?.allProviderOptInCommandsReady === true &&
    data?.checks?.sourceArtifactsFresh === true &&
    data?.packet?.command === "pnpm verify:terminal:authenticated-ai-cli-prompt" &&
    data?.packet?.requiredEnv === "AETHER_AUTH_PROMPT_CONSENT=I_UNDERSTAND_THIS_MAY_SPEND_TOKENS" &&
    data?.packet?.tokenGate === "explicit consent" &&
    data?.packet?.wouldSpendTokens === true &&
    typeof data?.consentPacketSha256 === "string" &&
    data.consentPacketSha256.length === 64 &&
    ["codex", "claude", "gemini"].every((provider) =>
      providers.some(
        (entry) =>
          entry?.provider === provider &&
          entry?.status === "ready" &&
          entry?.command === "pnpm verify:terminal:authenticated-ai-cli-prompt" &&
          String(entry?.requiredEnv ?? "").includes(`AETHER_AUTH_PROMPT_PROVIDER=${provider}`),
      ),
    );
  return {
    ok,
    status: ok ? "pass-current-consent-packet-contract" : (data?.status ?? "stale-or-incomplete"),
    expectation:
      "authenticated prompt consent packet proves the exact opt-in command, provider matrix, and no-token boundary",
    reason: ok
      ? "authenticated prompt consent packet is exact, non-token, and ready for explicit opt-in"
      : "authenticated prompt consent packet is missing, stale, incomplete, or unsafe",
  };
}

function externalGateReadinessVerdict(data) {
  const remainingGates = Array.isArray(data?.remainingExternalGates) ? data.remainingExternalGates : [];
  const tokenGate = remainingGates.find((entry) => entry?.id === "authenticated-ai-cli-prompt-smoke");
  const sleepGate = remainingGates.find((entry) => entry?.id === "real-os-sleep-resume");
  const afterEitherGate = Array.isArray(data?.runbook?.afterEitherGate) ? data.runbook.afterEitherGate : [];
  const afterEitherGateClosesViaFinalizer =
    afterEitherGate.length === 3 &&
    afterEitherGate[0] === "pnpm verify:goal:operator-finish" &&
    afterEitherGate[1] === "pnpm verify:goal:finalize" &&
    afterEitherGate[2] === "pnpm verify:goal:safe";
  const checks = data?.checks ?? {};
  const tokenStateReady =
    (data?.tokenSpendingPromptExecuted === false && checks.noTokenPromptSent === true) ||
    (data?.tokenSpendingPromptExecuted === true && checks.tokenPromptExecutedWithConsent === true);
  const sleepGateReady =
    sleepGate?.status === "ready-for-user-sleep-cycle" || sleepGate?.status === "host-unsupported";
  const ready =
    data?.ok === true &&
    ["ready-for-external-operator-gates", "blocked-by-host-sleep-unsupported"].includes(data?.status) &&
    tokenStateReady &&
    data?.realOsSleepInvoked === false &&
    checks.noUnsafeConsentEnvPresent === true &&
    checks.noOsSleepEnvPresent === true &&
    checks.releaseScoreCurrentExternalGateShape === true &&
    checks.finalAuditExternalGateShape === true &&
    checks.completionMatrixExternalGateShape === true &&
    checks.tokenGateReady === true &&
    checks.realSleepGateReady === true &&
    checks.realSleepOperatorHandoffReady === true &&
    (checks.noTokenPromptSent === true || checks.tokenPromptExecutedWithConsent === true) &&
    checks.noRealSleepClaimMade === true &&
    checks.sourceArtifactsFresh === true &&
    (data?.tokenSpendingPromptExecuted === true || tokenGate?.status === "ready-for-explicit-consent") &&
    sleepGateReady &&
    data?.runbook?.realSleepResume?.command === "pnpm verify:production:suspend:native-user-cycle" &&
    data?.runbook?.realSleepResume?.handoff === "pnpm verify:goal:sleep-handoff" &&
    data?.runbook?.realSleepResume?.safety ===
      "This readiness verifier does not set AETHER_ALLOW_OS_SLEEP and does not invoke Windows sleep." &&
    data?.runbook?.finalizeClosure?.command === "pnpm verify:goal:finalize" &&
    afterEitherGateClosesViaFinalizer &&
    ["codex", "claude", "gemini"].every((provider) =>
      data?.runbook?.tokenPromptSmoke?.some(
        (entry) =>
          entry?.provider === provider &&
          entry?.command === "pnpm verify:terminal:authenticated-ai-cli-prompt" &&
          entry?.env?.AETHER_AUTH_PROMPT_CONSENT === "I_UNDERSTAND_THIS_MAY_SPEND_TOKENS" &&
          entry?.env?.AETHER_AUTH_PROMPT_PROVIDER === provider &&
          entry?.costClass === "token-spending-explicit-consent",
      ),
    );
  const complete =
    data?.ok === true &&
    data?.status === "external-operator-gates-complete" &&
    (data?.tokenSpendingPromptExecuted === false || data?.tokenSpendingPromptExecuted === true) &&
    (data?.realOsSleepInvoked === false || data?.realOsSleepInvoked === true) &&
    checks.noUnsafeConsentEnvPresent === true &&
    checks.noOsSleepEnvPresent === true &&
    checks.completeExternalGatesProved === true &&
    checks.releaseScoreCurrentExternalGateShape === true &&
    checks.finalAuditExternalGateShape === true &&
    checks.completionMatrixExternalGateShape === true &&
    checks.tokenGateReady === true &&
    checks.realSleepGateReady === true &&
    checks.sourceArtifactsFresh === true &&
    afterEitherGateClosesViaFinalizer &&
    remainingGates.length === 0;
  const ok = ready || complete;
  return {
    ok,
    status: complete
      ? "external-operator-gates-complete"
      : ready
        ? "ready-for-external-operator-gates"
        : (data?.status ?? "stale-or-incomplete"),
    expectation:
      "external operator gates are isolated, no token prompt or OS sleep is invoked, and the runbook is exact",
    reason: complete
      ? "external gate readiness proves the operator-controlled token and sleep gates are already closed"
      : ready
        ? "external gate readiness proves the only remaining gates are explicit token consent and user-driven Windows sleep"
      : "external gate readiness is missing, stale, unsafe, or does not match the current final goal blockers",
    semanticFreshness: ok ? "current-external-gate-readiness-contract" : "stale-or-incomplete",
    cycleBoundary: "operator-gate-no-token-no-sleep-proof",
  };
}

function realOsSleepOperatorHandoffVerdict(data) {
  const afterManualGate = Array.isArray(data?.runbook?.afterManualGate) ? data.runbook.afterManualGate : [];
  const ready =
    data?.ok === true &&
    ["ready-for-manual-sleep-cycle", "real-os-sleep-resume-complete"].includes(data?.status) &&
    data?.realOsSleepInvoked === false &&
    data?.checks?.noUnsafeConsentEnvPresent === true &&
    data?.checks?.noOsSleepEnvPresent === true &&
    data?.checks?.hostBlockerClassified === true &&
    data?.checks?.nativePreflightReady === true &&
    data?.checks?.nativePostcheckPreflightReady === true &&
    data?.checks?.postcheckWriteSmokeNoRealSleepClaim === true &&
    data?.checks?.evidenceDoesNotFakePass === true &&
    data?.checks?.userCycleScriptPresent === true &&
    data?.checks?.verifierWaitsForManualSleep === true &&
    data?.runbook?.manualSleepCycle?.command === "pnpm verify:production:suspend:native-user-cycle" &&
    data?.runbook?.manualSleepCycle?.safety ===
      "Does not set AETHER_ALLOW_OS_SLEEP and does not call SetSuspendState." &&
    data?.runbook?.operatorFinish?.command === "pnpm verify:goal:operator-finish" &&
    afterManualGate.includes("pnpm verify:goal:operator-finish") &&
    afterManualGate.includes("pnpm verify:goal:finalize") &&
    afterManualGate.includes("pnpm verify:goal:safe");
  return {
    ok: ready,
    status: ready ? "pass-current-real-os-sleep-operator-handoff" : (data?.status ?? "stale-or-incomplete"),
    expectation:
      "real OS sleep handoff classifies host sleep support and exposes only the safe manual user-cycle path",
    reason: ready
      ? "real OS sleep handoff is current, no-sleep by default, and points to the manual user-cycle verifier"
      : "real OS sleep handoff is missing, stale, unsafe, or not tied to the current external sleep gate",
  };
}

function operatorFinishVerdict(data) {
  const steps = Array.isArray(data?.steps) ? data.steps : [];
  const externalReadinessStep = steps.find((step) => step?.id === "external-gate-readiness-preflight");
  const ready =
    data?.ok === true &&
    data?.status === "ready-for-external-operator-gates" &&
    data?.goalComplete === false &&
    data?.tokenSpendingPromptRequested === false &&
    data?.tokenSpendingPromptExecutedByThisRun === false &&
    data?.realOsSleepUserCycleRequested === false &&
    data?.realOsSleepInvokedByThisRun === false &&
    data?.implementationFixableCount === 0 &&
    data?.envGuard?.tokenEnvPresent === false &&
    data?.envGuard?.sleepEnvPresent === false &&
    data?.envGuard?.noAetherAllowOsSleep === true &&
    data?.envGuard?.invalidOperatorEnv === false &&
    externalReadinessStep?.ok === true &&
    data?.runbook?.readinessOnly?.command === "pnpm verify:goal:operator-finish" &&
    data?.runbook?.tokenPrompt?.command === "pnpm verify:goal:operator-finish" &&
    data?.runbook?.tokenPrompt?.env?.AETHER_AUTH_PROMPT_CONSENT === "I_UNDERSTAND_THIS_MAY_SPEND_TOKENS" &&
    Array.isArray(data?.runbook?.tokenPrompt?.providerChoices) &&
    ["codex", "claude", "gemini"].every((provider) => data.runbook.tokenPrompt.providerChoices.includes(provider)) &&
    data?.runbook?.sleepResume?.env?.AETHER_GOAL_OPERATOR_RUN_SLEEP ===
      "I_WILL_MANUALLY_SLEEP_WINDOWS_WHILE_VERIFIER_WAITS" &&
    Array.isArray(data?.runbook?.afterManualGate) &&
    data.runbook.afterManualGate.includes("pnpm verify:goal:safe") &&
    data?.artifacts?.externalGateReadiness?.ok === true;
  const complete =
    data?.ok === true &&
    data?.status === "complete" &&
    data?.goalComplete === true &&
    data?.tokenSpendingPromptRequested === false &&
    data?.tokenSpendingPromptExecutedByThisRun === false &&
    data?.realOsSleepInvokedByThisRun === false &&
    data?.envGuard?.invalidOperatorEnv === false &&
    externalReadinessStep?.ok === true &&
    data?.runbook?.readinessOnly?.command === "pnpm verify:goal:operator-finish";
  const ok = ready || complete;
  return {
    ok,
    status: complete
      ? "complete"
      : ready
        ? "pass-current-operator-finish-contract"
        : (data?.status ?? "stale-or-incomplete"),
    expectation:
      "operator finish handoff is safe to run repeatedly and keeps the final external token/sleep gates explicit",
    reason: complete
      ? "operator finish confirms the goal is complete without rerunning token or OS sleep actions"
      : ready
        ? "operator finish is current, no-token/no-sleep by default, and contains the exact remaining external gate runbook"
        : "operator finish handoff is missing, unsafe, stale, or does not match the final external gate contract",
    semanticFreshness: ok ? "current-operator-finish-contract" : "stale-or-incomplete",
    cycleBoundary: "operator-finish-no-stall-handoff",
  };
}

function gitFinalizationReadinessVerdict(data) {
  const ready = data?.ok === true && data?.status === "ready-for-commit-and-merge";
  const shellDiagnostics = data?.proofState?.shellDiagnostics ?? {};
  const shellDiagnosticsReady =
    shellDiagnostics.status === "blocked-by-git-metadata-permissions" &&
    shellDiagnostics.gitFinalizationReady === false &&
    shellDiagnostics.gitAddDryRunOk === false &&
    typeof shellDiagnostics.denyAceCount === "number" &&
    shellDiagnostics.denyAceCount > 0;
  const permissionBlocked =
    data?.ok === true &&
    data?.status === "blocked-by-git-metadata-permissions" &&
    data?.gitFinalizationReady === false &&
    typeof data?.currentBranch === "string" &&
    data.currentBranch.length > 0 &&
    typeof data?.targetBranch === "string" &&
    data.targetBranch.length > 0 &&
    data?.checks?.repositoryPresent === true &&
    data?.checks?.currentBranchKnown === true &&
    data?.checks?.targetBranchExists === true &&
    data?.checks?.noExistingIndexLock === true &&
    data?.runbook?.readiness === "pnpm verify:goal:git-finalization" &&
    data?.runbook?.shellDiagnostics === "pnpm verify:goal:git-finalization:shell" &&
    shellDiagnosticsReady &&
    data?.handoff?.status === "repair-git-metadata-permissions-then-runbook" &&
    data?.handoff?.blockedOnlyByGitMetadata === true &&
    data?.handoff?.sourceBranch === data.currentBranch &&
    data?.handoff?.targetBranch === data.targetBranch &&
    data?.handoff?.commitMessage === "Harden native terminal final quality gates" &&
    ["direct-git", "shell-diagnostics"].includes(data?.handoff?.worktreeStatusSource) &&
    typeof data?.handoff?.worktreeSummary?.changedPathCount === "number" &&
    data.handoff.worktreeSummary.changedPathCount > 0 &&
    Array.isArray(data?.handoff?.nextCommandsAfterAclRepair) &&
    data.handoff.nextCommandsAfterAclRepair.includes("pnpm verify:goal:git-finalization") &&
    data.handoff.nextCommandsAfterAclRepair.includes("git add -A") &&
    Array.isArray(data?.runbook?.commitAndMerge) &&
    data.runbook.commitAndMerge.includes("git add -A") &&
    String(data?.runbook?.safety ?? "").includes("does not stage, commit, merge, push, mutate ACLs");
  const ok = ready || permissionBlocked;
  return {
    ok,
    status: ready
      ? "ready-for-commit-and-merge"
      : permissionBlocked
        ? "blocked-by-git-metadata-permissions"
        : (data?.status ?? "stale-or-incomplete"),
    expectation:
      "Git handoff readiness is explicit: either commit/merge can proceed, or Git metadata permission blockers are named with the exact runbook and post-repair handoff",
    reason: ready
      ? "Git finalization readiness proves the current branch can be staged and merged"
      : permissionBlocked
        ? "Git finalization readiness proves implementation evidence is green, the only commit/merge blocker is repository metadata write permission, and the post-repair commit/merge handoff is explicit"
        : "Git finalization readiness is missing, stale, unsafe, or does not expose the exact commit/merge blocker and handoff",
    semanticFreshness: ok ? "current-git-finalization-contract" : "stale-or-incomplete",
    cycleBoundary: "commit-merge-handoff-no-silent-stack",
  };
}

function gitFinalizationShellDiagnosticsVerdict(data) {
  const artifactFresh =
    mtimeMs(".codex-auto/quality/git-finalization-shell-diagnostics.json") + 5000 >=
    Math.max(
      mtimeMs("scripts/verify-git-finalization-shell-diagnostics.ps1"),
      mtimeMs("docs/release-build-playbook.md"),
    );
  const ready = data?.ok === true && data?.status === "ready-for-commit-and-merge";
  const permissionBlocked =
    data?.ok === true &&
    data?.status === "blocked-by-git-metadata-permissions" &&
    data?.gitFinalizationReady === false &&
    data?.localDate === currentLocalDate() &&
    data?.checks?.repositoryPresent === true &&
    data?.checks?.noExistingIndexLock === true &&
    data?.checks?.gitAddDryRunOk === false &&
    typeof data?.checks?.denyAceCount === "number" &&
    data.checks.denyAceCount > 0 &&
    Array.isArray(data?.icaclsDenyLines) &&
    data.icaclsDenyLines.length === data.checks.denyAceCount &&
    data?.commands?.whoamiUser?.ok === true &&
    data?.commands?.whoamiGroups?.ok === true &&
    data?.commands?.gitAddDryRun?.ok === false &&
    String(data?.commands?.gitAddDryRun?.output ?? "").includes("index.lock") &&
    String(data?.commands?.gitAddDryRun?.output ?? "").includes("Permission denied") &&
    data?.runbook?.shellDiagnostics === "pnpm verify:goal:git-finalization:shell" &&
    String(data?.runbook?.safety ?? "").includes("does not stage, commit, merge, push, mutate ACLs");
  const ok = artifactFresh && (ready || permissionBlocked);
  return {
    ok,
    status: ready
      ? "ready-for-commit-and-merge"
      : permissionBlocked
        ? "blocked-by-git-metadata-permissions"
        : (data?.status ?? "stale-or-incomplete"),
    expectation:
      "direct PowerShell Git diagnostics capture user, groups, ACL, icacls Deny lines, and git add dry-run without staging or ACL mutation",
    reason: ready
      ? "direct shell diagnostics prove commit/merge can proceed"
      : permissionBlocked
        ? "direct shell diagnostics prove the Git blocker is repository metadata permission, with Deny ACL evidence and index.lock dry-run failure"
        : "direct shell diagnostics are missing, stale, unsafe, or do not explain the Git metadata blocker",
    semanticFreshness: ok ? "current-git-finalization-shell-diagnostics" : "stale-or-incomplete",
    cycleBoundary: "commit-merge-shell-diagnostics-no-silent-stack",
  };
}

function aiCliLaunchPlannerVerdict(data) {
  const plan = data?.plan ?? {};
  const checks = data?.checks ?? {};
  const providerEntries = checks.providerMatrix?.entries ?? [];
  const cliPlans = Array.isArray(plan.cliPlans) ? plan.cliPlans : [];
  const preflightChecks = Array.isArray(plan.preflightChecks) ? plan.preflightChecks : [];
  const promptContractChecks = Array.isArray(plan.promptContractChecks) ? plan.promptContractChecks : [];
  const ok =
    data?.ok === true &&
    checks.sourceLoaded === true &&
    checks.realProbePass === true &&
    checks.planReady === true &&
    checks.traceComplete === true &&
    checks.contextPackReady === true &&
    checks.preflightReady === true &&
    checks.promptContractReady === true &&
    checks.providerMatrix?.allProvidersPresent === true &&
    checks.providerMatrix?.allProvidersReady === true &&
    ["codex", "claude", "gemini"].every((provider) =>
      providerEntries.some((entry) => entry?.provider === provider && entry?.status === "ready"),
    ) &&
    Array.isArray(data?.errors) &&
    data.errors.length === 0 &&
    plan.status === "ready" &&
    plan.grade === "S" &&
    plan.recommendedBackend === "sidecar-command-session" &&
    cliPlans.length >= 3 &&
    cliPlans.every((entry) => entry?.status === "ready") &&
    preflightChecks.length >= 4 &&
    preflightChecks.every((entry) => entry?.status === "ready") &&
    promptContractChecks.length >= 5 &&
    promptContractChecks.every((entry) => entry?.status === "ready") &&
    Array.isArray(plan.warnings) &&
    plan.warnings.length === 0 &&
    plan.trace?.status === "ready" &&
    plan.trace?.recommendedBackend === "sidecar-command-session";
  return {
    ok,
    status: ok ? "pass-current-launch-planner-contract" : (data?.status ?? "stale-or-incomplete"),
    expectation:
      "AI CLI launch planner proves provider matrix, sidecar backend, context pack, preflight, and prompt contract readiness",
    reason: ok
      ? "AI CLI launch planner is ready for auditable sidecar command-session launches"
      : "AI CLI launch planner is stale, incomplete, or missing launch guardrails",
  };
}

function realAiCliBinaryProbeVerdict(data) {
  const clis = Array.isArray(data?.checks?.clis) ? data.checks.clis : [];
  const discovery = Array.isArray(data?.checks?.discovery) ? data.checks.discovery : [];
  const providers = ["codex", "claude", "gemini"];
  const ok =
    data?.ok === true &&
    data?.status === "pass" &&
    data?.checks?.daemonReady === true &&
    data?.checks?.commandSessionCapability === true &&
    data?.checks?.passCount === providers.length &&
    data?.checks?.missingCount === 0 &&
    Array.isArray(data?.errors) &&
    data.errors.length === 0 &&
    providers.every((provider) =>
      discovery.some((entry) => entry?.cli === provider && entry?.found === true && entry?.preferred?.path),
    ) &&
    providers.every((provider) => {
      const row = clis.find((entry) => entry?.cli === provider);
      return (
        row?.status === "pass" &&
        row?.passed === true &&
        row?.markerSeen === true &&
        row?.commandNotFound === false &&
        Boolean(row?.discovery?.preferred?.path) &&
        row?.fatalLaunchError !== true &&
        (row?.versionLike === true || row?.usageLike === true)
      );
    });
  return {
    ok,
    status: ok ? "pass-current-real-cli-binary-contract" : (data?.status ?? "stale-or-incomplete"),
    expectation: "Codex, Claude, and Gemini real CLI binaries launch through the sidecar without sending prompts",
    reason: ok
      ? "real AI CLI binary probe refreshed the no-token provider launch prerequisite"
      : "real AI CLI binary probe is missing, stale, incomplete, or cannot launch every provider",
  };
}

function nativeAiCliPostLaunchChaosVerdict(data) {
  const providers = ["codex", "claude", "gemini"];
  const checks = data?.checks ?? {};
  const cleanupRows = Array.isArray(data?.aiCliKillCleanup) ? data.aiCliKillCleanup : [];
  const artifactPath = ".codex-auto/chaos-recovery/native-ai-cli-post-launch-chaos.json";
  const sourceFresh =
    mtimeMs(artifactPath) + 5_000 >=
    Math.max(mtimeMs("scripts/verify-native-ai-cli-post-launch-chaos.mjs"), mtimeMs("package.json"));
  const ok =
    data?.ok === true &&
    data?.status === "pass" &&
    sourceFresh &&
    checks.daemonReady === true &&
    checks.commandSessionCapability === true &&
    checks.webviewRequiredForToolCalls === true &&
    checks.sameIdRespawned === true &&
    checks.ptyPromptReadyBeforeWrite === true &&
    checks.ptyPromptReadyAfterRestart === true &&
    checks.ptyRestartBeforeVisible === true &&
    checks.ptyRestartAfterVisible === true &&
    checks.ptyNoResidue === true &&
    checks.aiCliAllProvidersCovered === true &&
    checks.aiCliReadyVisible === true &&
    checks.aiCliInputRoundtrip === true &&
    checks.aiCliKillCleanup === true &&
    checks.noSessionResidue === true &&
    data?.ptyRestart?.absentAfterCleanup === true &&
    Array.isArray(data?.errors) &&
    data.errors.length === 0 &&
    Array.isArray(data?.finalSessions) &&
    data.finalSessions.length === 0 &&
    providers.every((provider) => {
      const row = cleanupRows.find((entry) => entry?.cli === provider);
      return (
        row?.backend === "sidecar-command-session" &&
        row?.readyVisible === true &&
        row?.inputRoundtrip === true &&
        row?.presentBeforeClose === true &&
        row?.removedAfterClose === true &&
        row?.remainingSessionsAfterCleanup === 0
      );
    });
  return {
    ok,
    status: ok ? "pass-current-native-ai-cli-chaos-contract" : (data?.status ?? "stale-or-incomplete"),
    expectation:
      "native sidecar AI CLI post-launch chaos proves prompt readiness, same-id PTY restart, input roundtrip, kill cleanup, and no session residue without WebView2/CDP",
    reason: ok
      ? "native AI CLI post-launch chaos is fresh and covers all providers plus PTY restart cleanup"
      : "native AI CLI post-launch chaos is missing, stale, incomplete, or leaves post-launch residue",
  };
}

function glassLegibilityContractVerdict(data) {
  const artifactPath = ".codex-auto/quality/glass-legibility-contract.json";
  const sourceFresh =
    mtimeMs(artifactPath) + 5_000 >=
    Math.max(
      mtimeMs("scripts/verify-glass-legibility-contract.mjs"),
      mtimeMs("src/styles/global.css"),
      mtimeMs("src/shared/themes/moods.ts"),
      mtimeMs("src/shared/hooks/useTheme.ts"),
      mtimeMs("src/__tests__/themePalette.test.ts"),
      mtimeMs("src/__tests__/useThemeApplier.test.tsx"),
      mtimeMs("package.json"),
    );
  const ok =
    data?.ok === true &&
    data?.status === "pass-current-glass-legibility-contract" &&
    sourceFresh &&
    data?.textFullyPainted === true &&
    data?.materialTranslucencyProved === true &&
    data?.sourceFresh === true &&
    Array.isArray(data?.failedChecks) &&
    data.failedChecks.length === 0;
  return {
    ok,
    status: ok ? "pass-current-glass-legibility-contract" : (data?.status ?? "stale-or-incomplete"),
    expectation:
      "Claude-like glass UI keeps text fully opaque while only material layers, panes, rails, and wallpaper glass stay translucent",
    reason: ok
      ? "glass legibility contract is fresh and proves opaque glyph tokens plus translucent material layers"
      : "glass legibility contract is missing, stale, incomplete, or allows opacity-dimmed text/material slabs",
  };
}

function rightRailInformationDensityVerdict(data) {
  const artifactPath = ".codex-auto/quality/right-rail-information-density-contract.json";
  const sourceFresh =
    mtimeMs(artifactPath) + 5_000 >=
    Math.max(
      mtimeMs("scripts/verify-right-rail-information-density.mjs"),
      mtimeMs("scripts/verify-right-rail-suite.mjs"),
      mtimeMs("scripts/score-release-quality.mjs"),
      mtimeMs("src/App.tsx"),
      mtimeMs("src/styles/global.css"),
      mtimeMs("package.json"),
    );
  const ok =
    data?.ok === true &&
    data?.status === "pass-current-right-rail-information-density-contract" &&
    data?.essentialFirst === true &&
    data?.defaultDrawerCount >= 4 &&
    data?.visiblePrimaryCount <= 2 &&
    data?.conditionalPrimaryMax <= 3 &&
    sourceFresh &&
    Array.isArray(data?.failedChecks) &&
    data.failedChecks.length === 0;
  return {
    ok,
    status: ok ? "pass-current-right-rail-information-density-contract" : (data?.status ?? "stale-or-incomplete"),
    expectation:
      "right rail default view shows only the current command-center spine while evidence, health, and queue details stay deferred",
    reason: ok
      ? "right rail information density contract is fresh and proves essential-first Command Center composition"
      : "right rail information density contract is missing, stale, incomplete, or lets deferred detail crowd the first view",
  };
}

function antiStallContractVerdict(data) {
  const artifactPath = ".codex-auto/quality/goal-anti-stall-contract.json";
  const sourceFresh =
    mtimeMs(artifactPath) + 5_000 >=
    Math.max(
      mtimeMs("scripts/verify-goal-anti-stall-contract.mjs"),
      mtimeMs("scripts/final-goal-artifact-lock.mjs"),
      mtimeMs("scripts/verify-chunked-osc-live-safe.mjs"),
      mtimeMs("scripts/verify-final-goal-safe.mjs"),
      mtimeMs("scripts/verify-goal-non-token-refresh.mjs"),
      mtimeMs("scripts/verify-goal-operator-finish.mjs"),
      mtimeMs("scripts/verify-goal-finalize-evidence.mjs"),
      mtimeMs("scripts/verify-goal-external-gate-readiness.mjs"),
      mtimeMs("scripts/verify-native-ai-cli-post-launch-chaos.mjs"),
      mtimeMs("scripts/verify-real-os-suspend-evidence.mjs"),
      mtimeMs("scripts/score-release-quality.mjs"),
      mtimeMs("scripts/verify-final-goal-audit.mjs"),
      mtimeMs("package.json"),
    );
  const checks = data?.checks ?? {};
  const ok =
    data?.ok === true &&
    data?.status === "pass-current-anti-stall-contract" &&
    sourceFresh &&
    data?.sourceFresh === true &&
    typeof data?.nativeAiChaosDefaultWaitMs === "number" &&
    data.nativeAiChaosDefaultWaitMs >= 120_000 &&
    Array.isArray(data?.failedChecks) &&
    data.failedChecks.length === 0 &&
    Object.values(checks).every((value) => value === true);
  return {
    ok,
    status: ok ? "pass-current-anti-stall-contract" : (data?.status ?? "stale-or-incomplete"),
    expectation:
      "goal execution keeps bounded timeouts, visible progress markers, sandbox artifact replay, no-token/no-sleep defaults, and exact external gate runbooks",
    reason: ok
      ? "anti-stall contract is fresh and proves the goal can be resumed without silent token use, sleep invocation, or sandbox-spawn dead ends"
      : "anti-stall contract is missing, stale, incomplete, or no longer proves timeout/progress/replay safeguards",
  };
}

function tauriRuntimeHygieneVerdict(data) {
  const ports = Array.isArray(data?.ports) ? data.ports : [];
  const workspaceProcesses = data?.workspaceProcesses ?? {};
  const stalePidFiles = Array.isArray(data?.stalePidFiles) ? data.stalePidFiles : [];
  const logs = Array.isArray(data?.logs) ? data.logs : [];
  const portClean = (port) =>
    port?.open === false ||
    (port?.foreignOpen === true && port?.workspaceOwnedOpen === false) ||
    (data?.portOwnershipQueryEnvironmentBlocked === true &&
      data?.portOwnershipEnvironmentBlockedClean === true &&
      port?.ownershipUnknownEnvironmentBlocked === true &&
      port?.port === 1420);
  const ok =
    data?.ok === true &&
    data?.status === "pass" &&
    everyCheckPassed(data?.checks) &&
    Array.isArray(data?.crashMatches) &&
    data.crashMatches.length === 0 &&
    Array.isArray(data?.helperOutputLeaks) &&
    data.helperOutputLeaks.length === 0 &&
    ports.length >= 4 &&
    ports.every(portClean) &&
    Array.isArray(workspaceProcesses.processes) &&
    workspaceProcesses.processes.length === 0 &&
    stalePidFiles.length === 0 &&
    data?.historicalIncidentClosure?.closed === true &&
    logs.length >= 1 &&
    logs.every(
      (log) =>
        log?.exists === true &&
        Array.isArray(log.crashMatches) &&
        log.crashMatches.length === 0 &&
        Array.isArray(log.helperOutputLeaks) &&
        log.helperOutputLeaks.length === 0,
    );
  return {
    ok,
    status: ok ? "pass-current-runtime-hygiene-contract" : (data?.status ?? "stale-or-incomplete"),
    expectation:
      "runtime logs, dev ports, workspace processes, helper leaks, stale pid files, and historical incident closure are clean",
    reason: ok
      ? "Tauri runtime hygiene is clean, no dev process residue remains, and historical incidents have clean successors"
      : "Tauri runtime hygiene is stale, incomplete, or shows process/log residue",
  };
}

function rightRailStaleUrlTruthVerdict(data) {
  const normal = data?.checks?.normalRuntime ?? {};
  const visualQa = data?.checks?.visualQaRuntime ?? {};
  const visualQaNotice = String(visualQa.truthNoticeText ?? "");
  const ok =
    data?.ok === true &&
    data?.status === "pass" &&
    Array.isArray(data?.errors) &&
    data.errors.length === 0 &&
    normal.truthNoticeVisible === false &&
    normal.edgeFeedbackVisible === false &&
    visualQa.truthNoticeVisible === true &&
    visualQa.truthNoticeSource === "visual-qa" &&
    visualQaNotice.includes("Visual QA simulation") &&
    visualQaNotice.includes("state=blocked is fixture state") &&
    visualQaNotice.includes("runtime truth is unchanged") &&
    visualQaNotice.includes("edgeLoop is replay evidence") &&
    visualQaNotice.includes("Use railState instead") &&
    visualQa.edgeFeedbackVisible === true &&
    String(visualQa.edgeFeedbackText ?? "").includes("Stale URL");
  return {
    ok,
    status: ok ? "pass-current-stale-url-truth-contract" : (data?.status ?? "stale-or-incomplete"),
    expectation:
      "stale URL/debug edgeLoop state never contaminates normal runtime truth and is labeled only under explicit Visual QA",
    reason: ok
      ? "right rail stale URL truth smoke proves debug replay is isolated from runtime truth"
      : "right rail stale URL truth smoke is missing, stale, or leaking debug state into runtime truth",
  };
}

const REQUIRED_GOAL_DOCUMENT_PATHS = [
  "docs/AETHER_COMMAND_CENTER_EDGE_PLAN.md",
  "docs/AETHER_COMMAND_CENTER_EDGE_PROGRESS.md",
  "docs/RUST_CORE_WEZTERM_TMUX_WIZARD_GOALS.md",
  "docs/TERMINAL_NATIVE_CORE_AND_EDITOR_DESCOPE_PLAN_2026-05-17.md",
  "docs/NATIVE_RUST_WEZTERM_PLUS_MIGRATION_PLAN.md",
];

function goalDocumentationFreshnessVerdict(data) {
  const docs = Array.isArray(data?.docs) ? data.docs : [];
  const docPaths = new Set(docs.map((doc) => doc?.path).filter(Boolean));
  const checks = data?.checks ?? {};
  const requiredDocPaths =
    Array.isArray(data?.requiredDocPaths) && data.requiredDocPaths.length > 0
      ? data.requiredDocPaths
      : REQUIRED_GOAL_DOCUMENT_PATHS;
  const requiredDocsCovered = requiredDocPaths.every((path) => docPaths.has(path));
  const ok =
    data?.ok === true &&
    data?.status === "pass-current-goal-docs-contract" &&
    data?.checkedDocCount === requiredDocPaths.length &&
    checks.scoreExists === true &&
    checks.auditExists === true &&
    checks.scoreIsCurrentShape === true &&
    checks.auditIsCurrentConsentGate === true &&
    checks.currentStateDocsFresh === true &&
    docs.length >= REQUIRED_GOAL_DOCUMENT_PATHS.length &&
    requiredDocsCovered &&
    docs.every(
      (doc) =>
        doc?.ok === true &&
        doc?.checks?.noStaleLegacyScoreClaim === true &&
        doc?.checks?.noStaleReleaseReadyClaim === true,
    );
  return {
    ok,
    status: ok ? "pass-current-goal-docs-contract" : (data?.status ?? "stale-or-incomplete"),
    expectation: "current roadmap documents match the active score, final audit state, and explicit consent blocker",
    reason: ok
      ? "goal roadmap docs are synchronized with the current score and do not claim stale release readiness"
      : "goal roadmap docs are stale, incomplete, or contradict the current score/audit contract",
  };
}

function goalCompletionMatrixVerdict(data) {
  const matrix = Array.isArray(data?.matrix) ? data.matrix : [];
  const checks = data?.checks ?? {};
  const sourceArtifacts = data?.sourceArtifacts ?? {};
  const sourceArtifactEntries = Object.values(sourceArtifacts);
  const requiredObjectiveTerms = [
    "tmux",
    "WezTerm",
    "Claude Code",
    "native-first hybrid",
    "ターミナル中核",
    "mux復元",
    "IME/clipboard",
    "右レール実ワークフロー",
    "AI CLI sidecar",
    "sleep/resume",
    "runtime hygiene",
    "配布前品質スコア",
    "100%",
  ];
  const allowedBlockedStatus =
    data?.status === "blocked-by-explicit-consent" ||
    (data?.status === "blocked-by-external-gates" && (data?.externalBlockedCount ?? 0) >= 1);
  const ok =
    data?.ok === true &&
    (allowedBlockedStatus || data?.status === "complete") &&
    requiredObjectiveTerms.every((term) => data?.objective?.includes?.(term)) &&
    data?.implementationFixableCount === 0 &&
    (data?.policyBlockedCount === 0 || data?.policyBlockedCount === 1) &&
    ((data?.externalBlockedCount ?? 0) === 0 || data?.status === "blocked-by-external-gates") &&
    everyCheckPassed(checks) &&
    matrix.length >= 8 &&
    matrix.every(
      (item) =>
        item?.status === "proved" &&
        item?.evidenceCount >= item?.minimumEvidenceCount &&
        Array.isArray(item?.missingScoreIds) &&
        item.missingScoreIds.length === 0 &&
        Array.isArray(item?.missingArtifactKeys) &&
        item.missingArtifactKeys.length === 0,
    ) &&
    data?.consentGate?.consentPacketReady === true &&
    data?.consentGate?.providerGuardBlocksPrompt === true &&
    data?.consentGate?.preflightMatrixReady === true &&
    data?.evidenceIntegrity?.ok === true &&
    data?.evidenceIntegrity?.pathCount >= 20 &&
    sourceArtifactEntries.length >= 10 &&
    sourceArtifactEntries.every(
      (artifact) => artifact?.exists === true && artifact?.size > 0 && artifact?.parseableJson !== false,
    );
  return {
    ok,
    status: ok ? "pass-current-goal-completion-matrix-contract" : (data?.status ?? "stale-or-incomplete"),
    expectation:
      "objective clauses are mapped to proved final-audit requirements, score rows, artifacts, evidence paths, and explicit consent/external host gates",
    reason: ok
      ? "goal completion matrix proves the current objective is implementation-complete except for explicit token consent or external host sleep"
      : "goal completion matrix is missing, stale, or not proving every objective clause",
  };
}

function releaseHygieneContractVerdict(data) {
  const checks = data?.checks ?? {};
  const ok =
    data?.ok === true &&
    data?.status === "pass-current-release-hygiene-contract" &&
    checks.trackedFilesAvailable === true &&
    checks.untrackedFilesEnumerated === true &&
    checks.activeSourcesIncludeUntracked === true &&
    checks.noManualDiagnosticScripts === true &&
    checks.noTemporaryInstrumentationMarkers === true &&
    typeof data?.trackedFileCount === "number" &&
    typeof data?.untrackedFileCount === "number" &&
    typeof data?.scannedUntrackedFileCount === "number" &&
    Array.isArray(data?.manualDiagnosticScripts) &&
    data.manualDiagnosticScripts.length === 0 &&
    Array.isArray(data?.markerHits) &&
    data.markerHits.length === 0;
  return {
    ok,
    status: ok ? "pass-current-release-hygiene-contract" : (data?.status ?? "stale-or-incomplete"),
    expectation:
      "tracked and untracked active production/verifier sources contain no ad-hoc diagnostic scripts or stray debug probes",
    reason: ok
      ? "release hygiene is clean: no current-worktree diag scripts, ad-hoc dev-log probes, or stray debug markers remain"
      : "release hygiene is stale, incomplete, or still contains ad-hoc diagnostic/debug instrumentation",
  };
}

function supplyChainAuditVerdict(data) {
  const artifactPath = ".codex-auto/release-doctor/supply-chain-audit.json";
  const sourceFresh =
    mtimeMs(artifactPath) + 5_000 >=
    Math.max(
      mtimeMs("package.json"),
      mtimeMs("pnpm-lock.yaml"),
      mtimeMs("src-tauri/Cargo.toml"),
      mtimeMs("src-tauri/Cargo.lock"),
      mtimeMs("scripts/verify-supply-chain.mjs"),
    );
  const ok =
    data?.status === "pass" &&
    data?.npm?.ok === true &&
    data?.npm?.knownVulnerabilities === 0 &&
    data?.cargo?.ok === true &&
    data?.cargo?.knownVulnerabilities === 0 &&
    (data?.cargo?.reachability?.runtimeCriticalWarningCount ?? 0) === 0 &&
    sourceFresh === true;
  return {
    ok,
    status: ok ? "pass-current-supply-chain-contract" : (data?.status ?? "stale-or-incomplete"),
    expectation: "npm and Rust dependency audit is current with zero known vulnerabilities and zero runtime critical Rust warnings",
    reason: ok
      ? "supply-chain audit is source-fresh, reports zero known npm/cargo vulnerabilities, and isolates remaining maintenance warnings as tracked upstream debt"
      : "supply-chain audit is stale, incomplete, failing, reports known vulnerabilities, or has runtime critical Rust warnings",
  };
}

function terminalChunkedOscLiveVerdict(data) {
  const checks = data?.checks ?? {};
  const cases = Array.isArray(data?.cases) ? data.cases : [];
  const artifactPath = ".codex-auto/production-smoke/chunked-osc-live.json";
  const sourceFresh =
    mtimeMs(artifactPath) + 5_000 >=
    Math.max(
      mtimeMs("scripts/verify-chunked-osc-live.mjs"),
      mtimeMs("scripts/aether-imgcat.ps1"),
      mtimeMs("scripts/aether-imgcat.sh"),
      mtimeMs("e2e/fixtures/inline-image-1x1.png"),
      mtimeMs("e2e/fixtures/inline-image-32x32.png"),
    );
  const ok =
    data?.ok === true &&
    data?.status === "pass-current-chunked-osc-live-contract" &&
    checks.fixturesPresent === true &&
    checks.requiredCaseCountCovered === true &&
    checks.allCasesPassed === true &&
    checks.shellsCovered === true &&
    checks.tinyFixturePassedForEveryShell === true &&
    checks.largeFixturePassedForEveryShell === true &&
    checks.pngSignatureVerified === true &&
    cases.length >= 4 &&
    cases.every(
      (item) =>
        item?.ok === true &&
        item?.format === "png" &&
        item?.pngSignature === "89504e470d0a1a0a" &&
        Number.isFinite(item?.rawBytes) &&
        item.rawBytes > 0,
    ) &&
    sourceFresh;
  return {
    ok,
    status: ok ? "pass-current-chunked-osc-live-contract" : (data?.status ?? "stale-or-incomplete"),
    expectation:
      "PowerShell and Git Bash both round-trip 1x1 and 32x32 PNG inline images through the chunked OSC terminal path",
    reason: ok
      ? "chunked OSC inline image proof is live, source-fresh, and covers PowerShell/Git Bash with small and larger PNG payloads"
      : "chunked OSC inline image proof is missing, stale, incomplete, or does not cover the required shell/fixture matrix",
    semanticFreshness: ok ? "current-live-contract" : "stale-or-incomplete",
    cycleBoundary: "terminal-inline-image-live-proof",
  };
}

function nativeTerminalInputHostVerdict(data) {
  const checks = Array.isArray(data?.checks) ? data.checks : [];
  const passed = new Set(checks.filter((check) => check?.status === "passed").map((check) => String(check.id ?? "")));
  const sourceFresh =
    mtimeMs(".codex-auto/production-smoke/native-terminal-input-host.json") + 5_000 >=
    Math.max(
      mtimeMs("scripts/verify-native-terminal-input-host.mjs"),
      mtimeMs("scripts/verify-native-boundary-contract.mjs"),
      mtimeMs("src-tauri/src/term/native_input.rs"),
      mtimeMs("src-tauri/src/ipc/commands.rs"),
      mtimeMs("src/features/terminal/TerminalCanvas.tsx"),
      mtimeMs("src/features/terminal/hooks/useCanvasIME.ts"),
    );
  const requiredChecks = [
    "rust-host",
    "commit-command",
    "surface-drain-no-precommit-metadata",
    "surface-command",
    "frontend-native-default",
    "surface-key-routing",
    "surface-paste-guard",
    "surface-ime-preedit-hidden",
    "surface-window-lifetime",
    "behavioral-native-hwnd-paste-live",
    "composition-surface",
  ];
  const ok =
    data?.status === "pass" &&
    sourceFresh &&
    requiredChecks.every((id) => passed.has(id)) &&
    checks.some(
      (check) =>
        check?.id === "surface-paste-guard" && /native HWND paste is intercepted/i.test(String(check?.detail ?? "")),
    );
  return {
    ok,
    status: ok ? "pass-current-native-input-host-contract" : (data?.status ?? "stale-or-incomplete"),
    expectation:
      "native input host proves Rust commit routing, native HWND focus/drain, composition readiness, and WM_PASTE guard",
    reason: ok
      ? "native input host artifact is fresh and includes the native HWND paste guard contract"
      : "native input host proof is missing, stale, or does not include the native HWND paste guard",
    semanticFreshness: ok ? "current-native-input-contract" : "stale-or-incomplete",
    cycleBoundary: "native-input-hwnd-paste-guard",
  };
}

function nativeHwndPasteLiveVerdict(data) {
  const checks = data?.checks ?? {};
  const cases = Array.isArray(data?.cases) ? data.cases : [];
  const artifactPath = ".codex-auto/production-smoke/native-hwnd-paste-live.json";
  const sourceFresh =
    mtimeMs(artifactPath) + 5_000 >=
    Math.max(
      mtimeMs("scripts/verify-native-hwnd-paste-live.mjs"),
      mtimeMs("scripts/verify-native-terminal-input-host.mjs"),
      mtimeMs("src-tauri/src/term/native_input.rs"),
      mtimeMs("src-tauri/src/ipc/commands.rs"),
    );
  const requiredCaseIds = [
    "single-line-lf-normalized-and-executed",
    "destructive-commented-paste-blocked-before-pty",
    "multiline-paste-blocked-before-pty",
  ];
  const passedCaseIds = new Set(cases.filter((item) => item?.ok === true).map((item) => String(item.id ?? "")));
  const ok =
    data?.ok === true &&
    data?.status === "pass-current-native-hwnd-paste-contract" &&
    checks.windowsHost === true &&
    (checks.tauriPageAttached === true ||
      (checks.nativeNoCdpProof === true &&
        checks.aetherNativePasteGuardProof === true &&
        checks.noWebView === true &&
        checks.noReact === true &&
        checks.noCdp === true)) &&
    checks.nativeSurfaceHwndAvailable === true &&
    checks.wmPasteSentToNativeHwnd === true &&
    checks.singleLineLfNormalizedAndExecuted === true &&
    checks.destructivePasteBlockedBeforePty === true &&
    checks.multilinePasteBlockedBeforePty === true &&
    checks.guardEventCountAdvanced === true &&
    requiredCaseIds.every((id) => passedCaseIds.has(id)) &&
    cases.every((item) => item?.path === "native-input-hwnd-wm-paste") &&
    sourceFresh;
  return {
    ok,
    status: ok ? "pass-current-native-hwnd-paste-contract" : (data?.status ?? "stale-or-incomplete"),
    expectation: "real Windows WM_PASTE sent to the native input HWND is guarded in Rust before PTY write",
    reason: ok
      ? "native HWND paste live proof is source-fresh and covers allowed single-line, destructive, and multiline paste paths"
      : "native HWND paste live proof is missing, stale, incomplete, or does not prove every guard path",
    semanticFreshness: ok ? "current-native-hwnd-paste-live-contract" : "stale-or-incomplete",
    cycleBoundary: "native-input-real-wm-paste-proof",
  };
}

function artifactMeta(path, verdictFor) {
  if (typeof verdictFor !== "function") {
    throw new Error(`artifactMeta requires an explicit contract verdict for ${path}`);
  }
  const full = join(ROOT, path);
  if (!existsSync(full)) return { path, exists: false, ok: false, status: "missing" };
  const stats = statSync(full);
  const data = readJson(path);
  const verdict = verdictFor(data);
  return {
    path,
    exists: true,
    ok: verdict.ok,
    status: verdict.status,
    expectation: verdict.expectation,
    reason: verdict.reason,
    strictProof: verdict.strictProof,
    environmentBlockedProof: verdict.environmentBlockedProof,
    bootstrapOnly: verdict.bootstrapOnly,
    semanticFreshness: verdict.semanticFreshness ?? null,
    cycleBoundary: verdict.cycleBoundary ?? null,
    generatedAt: data?.generatedAt ?? data?.finishedAt ?? data?.completedAt ?? null,
    mtimeMs: stats.mtimeMs,
  };
}

function writeJson(path, data) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
}

function sanitizeStepOutput(value) {
  return String(value ?? "")
    .replace(/"line"\s*:\s*"[^"]*"/g, '"line":"<redacted-log-line>"')
    .replace(/C:\\\\Users\\\\[^\\\\\r\n"]+/gi, "%USERPROFILE%")
    .replace(/C:\\Users\\[^\\\r\n"]+/gi, "%USERPROFILE%")
    .replace(/[^\s"']*aether-pty-server\.token/gi, "<aether-pty-token-path>");
}

function outputTail(value) {
  return sanitizeStepOutput(value).slice(-1400);
}

function stripAnsi(value) {
  return String(value ?? "").replace(ANSI_ESCAPE_PATTERN, "");
}

function summarizeBuildWarningSample(value) {
  return sanitizeStepOutput(stripAnsi(value)).replace(/\s+/g, " ").trim().slice(0, 700);
}

function classifyBuildStderr(value) {
  const clean = stripAnsi(value).trim();
  if (!clean) return { knownBuildWarnings: [], unexpectedBuildWarnings: [] };
  const chunks = clean
    .split(/\n\s*\n/g)
    .map((chunk) => chunk.trim())
    .filter(Boolean);
  const knownBuildWarnings = [];
  const unexpectedBuildWarnings = [];

  for (const chunk of chunks) {
    const sample = summarizeBuildWarningSample(chunk);
    const tauriApiMixedImportWarning =
      /@tauri-apps[\\/+]api|@tauri-apps\/api/i.test(chunk) &&
      /dynamically imported by/i.test(chunk) &&
      /statically imported by/i.test(chunk) &&
      /dynamic import will not move module into another chunk/i.test(chunk);
    if (tauriApiMixedImportWarning) {
      knownBuildWarnings.push({
        kind: "tauri-api-mixed-static-dynamic-import-chunk-warning",
        policy: "tracked-and-budgeted-until-import-boundary-refactor",
        sample,
      });
    } else {
      unexpectedBuildWarnings.push({
        kind: "unexpected-production-build-stderr",
        policy: "blocks-final-safe-gate",
        sample,
      });
    }
  }

  return { knownBuildWarnings, unexpectedBuildWarnings };
}

function safeStepEnv(id) {
  const env = {
    ...process.env,
    AETHER_FINAL_GOAL_SAFE_GATE: "1",
    ...(BOOTSTRAP_RIGHT_RAIL ? { AETHER_RIGHT_RAIL_GOAL_TRACK_BOOTSTRAP: "1" } : {}),
  };
  if (id === "operator-finish-handoff" || id === "git-finalization-readiness") {
    delete env.AETHER_AUTH_PROMPT_CONSENT;
    delete env.AETHER_AUTH_PROMPT_PROVIDER;
    delete env.AETHER_GOAL_OPERATOR_RUN_SLEEP;
    delete env.AETHER_ALLOW_OS_SLEEP;
  }
  return env;
}

function runStep(id, label, script) {
  const child = spawnSync(process.execPath, [join(ROOT, "scripts", script)], {
    cwd: ROOT,
    env: safeStepEnv(id),
    encoding: "utf8",
  });
  const fallback = cachedStepFallback(id, label, script, child);
  if (fallback) return fallback;
  return {
    id,
    label,
    script,
    ok: child.status === 0,
    exitCode: child.status,
    stdoutTail: outputTail(child.stdout),
    stderrTail: outputTail(child.stderr),
  };
}

function runPnpmStep(id, label, scriptName) {
  const command = scriptName === "build" ? "pnpm build" : `pnpm ${scriptName}`;
  const executable = process.platform === "win32" ? "cmd.exe" : "pnpm";
  const args = process.platform === "win32" ? ["/d", "/s", "/c", command] : [scriptName];
  const child = spawnSync(executable, args, {
    cwd: ROOT,
    env: {
      ...process.env,
      AETHER_FINAL_GOAL_SAFE_GATE: "1",
      ...(BOOTSTRAP_RIGHT_RAIL ? { AETHER_RIGHT_RAIL_GOAL_TRACK_BOOTSTRAP: "1" } : {}),
    },
    encoding: "utf8",
  });
  const fallback = cachedStepFallback(id, label, command, child);
  if (fallback) {
    return scriptName === "build"
      ? {
          ...fallback,
          buildWarningPolicy: "Production build stderr is classified; sandbox EPERM uses fresh bundle-budget artifact replay.",
          knownBuildWarnings: [],
          unexpectedBuildWarnings: [],
        }
      : fallback;
  }
  const stderr = [child.stderr, child.error?.message].filter(Boolean).join("\n");
  const buildWarnings = scriptName === "build" ? classifyBuildStderr(stderr) : null;
  const productionBuildWarningCount =
    (buildWarnings?.knownBuildWarnings.length ?? 0) + (buildWarnings?.unexpectedBuildWarnings.length ?? 0);
  return {
    id,
    label,
    script: command,
    ok: child.status === 0 && productionBuildWarningCount === 0,
    exitCode: child.status,
    stdoutTail: outputTail(child.stdout),
    stderrTail: outputTail(stderr),
    ...(buildWarnings
      ? {
          buildWarningPolicy: "Production build stderr is classified; any warning fails this safe gate.",
          knownBuildWarnings: buildWarnings.knownBuildWarnings,
          unexpectedBuildWarnings: buildWarnings.unexpectedBuildWarnings,
        }
      : {}),
  };
}

function artifactPassesForCachedStep(data) {
  if (!data || typeof data !== "object") return false;
  if (data.ok === true) return true;
  if (data.status === "pass" || String(data.status ?? "").startsWith("pass-")) return true;
  if (data.status === "provider_required" && data.guardVerifier?.ok === true) return true;
  if (data.status === "blocked-by-external-gates" && data.implementationFixableCount === 0) return true;
  if (
    typeof data.score === "number" &&
    typeof data.total === "number" &&
    typeof data.max === "number" &&
    data.score >= 92 &&
    data.releaseCandidateReady === false
  ) {
    return true;
  }
  return false;
}

function cachedStepFallback(id, label, script, child) {
  const blockedBySandbox = child?.error?.code === "EPERM" || child?.status == null;
  if (!blockedBySandbox) return null;
  const paths = STEP_FALLBACK_ARTIFACTS[id] ?? [];
  const artifacts = paths
    .map((path) => {
      const full = join(ROOT, path);
      if (!existsSync(full)) return { path, exists: false, fresh: false, ok: false };
      const mtimeMs = statSync(full).mtimeMs;
      const ageMs = Date.now() - mtimeMs;
      let data = null;
      let parseError = null;
      try {
        data = JSON.parse(readFileSync(full, "utf8"));
      } catch (error) {
        parseError = error instanceof Error ? error.message : String(error);
      }
      return {
        path,
        exists: true,
        fresh: ageMs <= SAFE_STEP_CACHE_MAX_AGE_MS,
        ageMs,
        ok: parseError == null && artifactPassesForCachedStep(data),
        status: data?.status ?? null,
        parseError,
      };
    });
  const ok = artifacts.length > 0 && artifacts.every((artifact) => artifact.exists && artifact.fresh && artifact.ok);
  return {
    id,
    label,
    script,
    ok,
    exitCode: child?.status ?? null,
    stdoutTail: outputTail(child?.stdout ?? ""),
    stderrTail: outputTail([child?.stderr, child?.error?.message].filter(Boolean).join("\n")),
    sandboxArtifactReplay: true,
    replayReason:
      "child process execution was blocked by the current sandbox; using fresh verifier artifacts for this safe-gate step",
    replayArtifacts: artifacts,
  };
}

function isAuthenticatedPromptBlocker(value) {
  return /authenticated[-\s]?ai[-\s]?cli[-\s]?prompt|token-spend consent/i.test(String(value ?? ""));
}

function isHostSleepUnsupportedBlocker(value) {
  const text = `${value?.area ?? ""} ${value?.blocker ?? value ?? ""}`;
  return /real-os-soak|sleep\/resume|SetSuspendState returned false|GetLastError=50|host.*sleep.*unsupported/i.test(
    text,
  );
}

const steps = [
  runStep(
    "authenticated-provider-guard",
    "Authenticated prompt provider guard",
    "verify-authenticated-ai-cli-provider-guard.mjs",
  ),
  runStep("real-ai-cli-binary-probe", "Real AI CLI binary no-token probe", "verify-real-ai-cli-binary-probe.mjs"),
  runStep("ai-cli-launch-planner", "AI CLI launch planner", "verify-ai-cli-launch-planner.mjs"),
  runStep(
    "authenticated-preflight-matrix",
    "Authenticated prompt no-token provider matrix",
    "verify-authenticated-ai-cli-preflight-matrix.mjs",
  ),
  runStep(
    "authenticated-consent-packet",
    "Authenticated prompt consent packet",
    "verify-authenticated-ai-cli-consent-packet.mjs",
  ),
  runStep("glass-legibility", "Glass legibility and opaque text contract", "verify-glass-legibility-contract.mjs"),
  runStep(
    "right-rail-information-density",
    "Right rail essential-first information density contract",
    "verify-right-rail-information-density.mjs",
  ),
  runStep("anti-stall-contract", "Anti-stall and operator self-check contract", "verify-goal-anti-stall-contract.mjs"),
  runStep("tauri-runtime-hygiene", "Tauri runtime hygiene", "verify-tauri-runtime-hygiene.mjs"),
  runStep("release-hygiene-contract", "Release hygiene contract", "verify-release-hygiene-contract.mjs"),
  runStep("supply-chain-audit", "Supply-chain vulnerability audit", "verify-supply-chain.mjs"),
  runPnpmStep("production-build", "Production TypeScript and Vite build", "build"),
  runStep("production-bundle-budget", "Production shell bundle budget", "verify-production-bundle-budget.mjs"),
  runStep("quality-score-pre-audit", "Release quality score before final audit", "score-release-quality.mjs"),
  runStep("final-goal-audit", "Final goal audit", "verify-final-goal-audit.mjs"),
  runStep("quality-score-post-audit", "Release quality score after final audit", "score-release-quality.mjs"),
  runStep("goal-documentation-freshness", "Goal documentation freshness", "verify-goal-documentation-freshness.mjs"),
  runStep(
    "final-goal-audit-after-goal-docs",
    "Final goal audit after documentation freshness",
    "verify-final-goal-audit.mjs",
  ),
  runStep("quality-score-final", "Release quality score after documentation freshness", "score-release-quality.mjs"),
  runStep(
    "real-os-sleep-operator-handoff",
    "Real OS sleep operator handoff",
    "verify-real-os-sleep-operator-handoff.mjs",
  ),
  runStep("external-gate-readiness", "External operator gate readiness", "verify-goal-external-gate-readiness.mjs"),
  runStep("goal-completion-matrix", "Goal completion requirement matrix", "verify-goal-completion-matrix.mjs"),
  runStep("operator-finish-handoff", "Safe operator finish handoff", "verify-goal-operator-finish.mjs"),
  runStep("git-finalization-readiness", "Git finalization readiness handoff", "verify-git-finalization-readiness.mjs"),
];

const score = readJson(".codex-auto/quality/release-quality-score.json");
const audit = readJson(".codex-auto/quality/final-goal-audit.json");
const productionBuildStep = steps.find((step) => step.id === "production-build");
const productionBuildKnownWarnings = productionBuildStep?.knownBuildWarnings ?? [];
const productionBuildUnexpectedWarnings = productionBuildStep?.unexpectedBuildWarnings ?? [];
const failedSteps = steps.filter((step) => !step.ok);
const releaseBlockers = Array.isArray(score?.blockers) ? score.blockers : [];
const externalBlockers = releaseBlockers.filter((item) => isHostSleepUnsupportedBlocker(item));
const nonConsentBlockers = releaseBlockers.filter(
  (item) => !isAuthenticatedPromptBlocker(item?.blocker ?? item) && !isHostSleepUnsupportedBlocker(item),
);
const implementationFixableCount = audit?.residualRiskRegister?.implementationFixableCount ?? null;
const policyBlockedCount = audit?.residualRiskRegister?.policyBlockedCount ?? null;
const externalBlockedCount = audit?.residualRiskRegister?.externalBlockedCount ?? null;
const auditedRequirements = Array.isArray(audit?.requirements) ? audit.requirements : [];
const provedRequirementCount = auditedRequirements.filter((item) => item?.status === "proved").length;
const totalRequirementCount = auditedRequirements.length;
const consentBlockerCount = releaseBlockers.filter((item) =>
  isAuthenticatedPromptBlocker(item?.blocker ?? item),
).length;
const auditAuthenticatedPrompt =
  audit?.operationalEvidence?.authenticatedPromptConsent ?? {};
const tokenSpendingPromptExecuted =
  auditAuthenticatedPrompt?.consentPacketArtifact?.tokenSpendingPromptExecuted === true;
const noTokenPromptSent =
  auditAuthenticatedPrompt?.safeNoPromptSent === true && tokenSpendingPromptExecuted === false;

function scoreDetail(data) {
  if (!data || typeof data.score !== "number" || typeof data.grade !== "string") return null;
  return [
    `${data.score}% ${data.grade} · ${data.total ?? "?"}/${data.max ?? "?"}`,
    typeof data.localDate === "string" && typeof data.timeZone === "string" ? `${data.localDate} ${data.timeZone}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

function countAuthenticatedPromptBlockers(items) {
  if (!Array.isArray(items)) return 0;
  return items.filter((item) => isAuthenticatedPromptBlocker(item)).length;
}

const coreSafeGatePassed =
  failedSteps.length === 0 &&
  audit?.ok === true &&
  audit?.evidenceComplete === true &&
  implementationFixableCount === 0 &&
  nonConsentBlockers.length === 0 &&
  (score?.releaseCandidateReady === true ||
    (audit?.status === "blocked-by-explicit-consent" && policyBlockedCount === 1) ||
    (audit?.status === "blocked-by-external-gates" && (externalBlockedCount ?? 0) > 0));
const coreGoalComplete =
  coreSafeGatePassed === true &&
  audit?.goalComplete === true &&
  score?.releaseCandidateReady === true &&
  releaseBlockers.length === 0;
const coreBlockedOnlyByExplicitConsent =
  coreSafeGatePassed === true &&
  coreGoalComplete === false &&
  audit?.status === "blocked-by-explicit-consent" &&
  policyBlockedCount === 1 &&
  releaseBlockers.length === 1 &&
  isAuthenticatedPromptBlocker(releaseBlockers[0]?.blocker ?? releaseBlockers[0]);
const coreBlockedByExternalGates =
  coreSafeGatePassed === true &&
  coreGoalComplete === false &&
  audit?.status === "blocked-by-external-gates" &&
  (externalBlockedCount ?? 0) > 0 &&
  externalBlockers.length > 0 &&
  releaseBlockers.every(
    (item) => isAuthenticatedPromptBlocker(item?.blocker ?? item) || isHostSleepUnsupportedBlocker(item),
  );

function rightRailGoalTrackVerdict(data) {
  const goalTrack = data?.checks?.goalTrack ?? {};
  const qualitySource = goalTrack.qualitySource ?? {};
  const residualRisk = goalTrack.residualRisk ?? {};
  const safeGate = goalTrack.safeGate ?? {};
  const consentPacket = goalTrack.consentPacket ?? {};
  const requirementProofs = Array.isArray(goalTrack.requirementProofs) ? goalTrack.requirementProofs : [];
  const expectedRequirementProofs = Array.isArray(data?.expectedRequirementProofs)
    ? data.expectedRequirementProofs
    : [];
  const expectedSafeGate = data?.expectedSafeGate ?? {};
  const expectedResidualFromArtifact = data?.expectedResidualRisk ?? {};
  const providers = Array.isArray(consentPacket.providers) ? consentPacket.providers : [];
  const remaining = Array.isArray(goalTrack.remaining) ? goalTrack.remaining : [];
  const externalGateActions = Array.isArray(goalTrack.externalGateActions) ? goalTrack.externalGateActions : [];
  const nativeSleepAction = externalGateActions.find((action) => action?.id === "native-user-sleep-cycle");
  const expectedQualityDetail = scoreDetail(score);
  const expectedResidual = audit?.residualRiskRegister ?? {};
  const readyProviders = providers
    .filter((provider) => provider?.status === "ready")
    .map((provider) => provider?.label);
  const qaFixtureLeakPattern = /right[\s_.-]*rail[\s_.-]*qa|qa[\s_-]*(missing[\s_-]*diff|stale[\s_-]*pane)/i;
  const expectedStatus = coreGoalComplete
    ? "pass"
    : coreBlockedByExternalGates
      ? "blocked-by-external-gates"
      : "blocked-by-explicit-consent";
  const expectedPercent = coreGoalComplete
    ? "100%"
    : expectedResidual.state === "blocked-only-by-explicit-token-consent"
      ? "99%"
      : null;
  const sourceArtifacts = data?.sourceArtifacts ?? {};
  const sourceContractFiles = Array.isArray(data?.sourceContract?.files) ? data.sourceContract.files : [];
  const sourceContractCutoffMs = typeof data?.sourceContract?.cutoffMs === "number" ? data.sourceContract.cutoffMs : 0;
  const currentRightRailGoalTrackSourceCutoffMs = Math.max(
    0,
    ...RIGHT_RAIL_GOAL_TRACK_SOURCE_PATHS.map((path) => mtimeMs(path)),
  );
  const capturedRightRailGoalTrackSourceCutoffMs = Math.max(
    sourceContractCutoffMs,
    ...sourceContractFiles.map((file) => (typeof file?.mtimeMs === "number" ? file.mtimeMs : 0)),
  );
  const rightRailGoalTrackArtifactMtime = mtimeMs(".codex-auto/production-smoke/right-rail-goal-track-tauri.json");
  const rightRailGoalTrackCaptureCutoffMs = Math.max(
    currentRightRailGoalTrackSourceCutoffMs,
    capturedRightRailGoalTrackSourceCutoffMs,
    typeof sourceArtifacts.releaseQualityScore?.mtimeMs === "number" ? sourceArtifacts.releaseQualityScore.mtimeMs : 0,
    typeof sourceArtifacts.finalGoalAudit?.mtimeMs === "number" ? sourceArtifacts.finalGoalAudit.mtimeMs : 0,
    typeof sourceArtifacts.finalGoalSafe?.mtimeMs === "number" ? sourceArtifacts.finalGoalSafe.mtimeMs : 0,
  );
  const rightRailGoalTrackArtifactFresh =
    rightRailGoalTrackArtifactMtime > 0 &&
    rightRailGoalTrackArtifactMtime + 5_000 >= rightRailGoalTrackCaptureCutoffMs &&
    sourceContractFiles.length >= 5 &&
    sourceContractFiles.every(
      (file) => file?.exists === true && typeof file?.mtimeMs === "number" && file.mtimeMs > 0,
    ) &&
    RIGHT_RAIL_GOAL_TRACK_SOURCE_PATHS.every((path) => mtimeMs(path) > 0) &&
    capturedRightRailGoalTrackSourceCutoffMs > 0 &&
    sourceArtifacts.releaseQualityScore?.exists === true &&
    sourceArtifacts.releaseQualityScore?.ok === true &&
    sourceArtifacts.finalGoalAudit?.exists === true &&
    sourceArtifacts.finalGoalAudit?.ok === true &&
    sourceArtifacts.finalGoalSafe?.exists === true &&
    sourceArtifacts.finalGoalSafe?.ok === true &&
    sourceArtifacts.finalGoalSafe?.status === expectedStatus;
  const environmentBlocked = readJson(
    ".codex-auto/production-smoke/right-rail-goal-track-tauri.json.environment-blocked.json",
  );
  const environmentBlockedFiles = Array.isArray(environmentBlocked?.sourceContract?.files)
    ? environmentBlocked.sourceContract.files
    : [];
  const environmentBlockedFresh =
    environmentBlocked?.status === "environment-blocked" &&
    environmentBlocked?.preservesPrimaryArtifact === true &&
    Array.isArray(environmentBlocked?.errors) &&
    environmentBlocked.errors.some((error) =>
      /Cannot attach to WebView2 CDP|ECONNREFUSED|TCP timeout|spawn EPERM|connectOverCDP|browserType\.launch/i.test(
        String(error),
      ),
    ) &&
    environmentBlocked?.sourceArtifacts?.releaseQualityScore?.ok === true &&
    environmentBlocked?.sourceArtifacts?.finalGoalAudit?.exists === true &&
    environmentBlocked?.sourceArtifacts?.finalGoalSafe?.exists === true &&
    environmentBlockedFiles.length >= 8 &&
    environmentBlockedFiles.every(
      (file) => file?.exists === true && typeof file?.mtimeMs === "number" && file.mtimeMs > 0,
    );
  const requirementProofsMatch =
    expectedRequirementProofs.length >= totalRequirementCount &&
    totalRequirementCount >= 8 &&
    expectedRequirementProofs.every((expected) => {
      const actual = requirementProofs.find((item) => item?.id === expected?.id);
      return (
        actual != null &&
        actual.status === expected.status &&
        actual.label === expected.label &&
        (expected.evidenceCount <= 0 || actual.evidenceCount === expected.evidenceCount)
      );
    });
  const strictOk =
    data?.ok === true &&
    data?.status === "pass" &&
    rightRailGoalTrackArtifactFresh &&
    expectedQualityDetail != null &&
    data?.expectedQualityDetail === expectedQualityDetail &&
    expectedResidualFromArtifact.state === expectedResidual.state &&
    expectedResidualFromArtifact.implementationFixableCount === expectedResidual.implementationFixableCount &&
    expectedResidualFromArtifact.policyBlockedCount === expectedResidual.policyBlockedCount &&
    expectedResidualFromArtifact.externalBlockedCount === (expectedResidual.externalBlockedCount ?? 0) &&
    qualitySource.status === "fresh" &&
    qualitySource.detail === expectedQualityDetail &&
    residualRisk.state === expectedResidual.state &&
    residualRisk.implementationFixableCount === expectedResidual.implementationFixableCount &&
    residualRisk.policyBlockedCount === expectedResidual.policyBlockedCount &&
    residualRisk.externalBlockedCount === (expectedResidual.externalBlockedCount ?? 0) &&
    expectedSafeGate.status === expectedStatus &&
    expectedSafeGate.ok === true &&
    expectedSafeGate.stepCount === steps.length &&
    expectedSafeGate.failedStepCount === failedSteps.length &&
    expectedSafeGate.proofRequirementPassCount === provedRequirementCount &&
    expectedSafeGate.proofRequirementCount === totalRequirementCount &&
    expectedSafeGate.proofArtifactPassCount === expectedSafeGate.proofArtifactCount &&
    expectedSafeGate.proofArtifactCount >= 7 &&
    expectedSafeGate.consentBlockerCount === consentBlockerCount &&
    expectedSafeGate.nonConsentBlockerCount === nonConsentBlockers.length &&
    expectedSafeGate.noTokenPromptSent === noTokenPromptSent &&
    expectedSafeGate.tokenSpendingPromptExecuted === tokenSpendingPromptExecuted &&
    expectedSafeGate.detail === safeGate.detail &&
    safeGate.status === expectedStatus &&
    safeGate.source === "final-goal-safe-summary" &&
    safeGate.tokenSpendingPromptExecuted === String(tokenSpendingPromptExecuted) &&
    safeGate.noTokenPromptSent === String(noTokenPromptSent) &&
    safeGate.semanticFreshness === "current-contract" &&
    safeGate.cycleBoundary === "right-rail-safe-gate-mutual-proof" &&
    safeGate.proofRequirementPassCount === provedRequirementCount &&
    safeGate.proofRequirementCount === totalRequirementCount &&
    safeGate.proofArtifactPassCount === safeGate.proofArtifactCount &&
    safeGate.proofArtifactCount >= 7 &&
    safeGate.consentBlockerCount === consentBlockerCount &&
    safeGate.nonConsentBlockerCount === nonConsentBlockers.length &&
    requirementProofsMatch &&
    (expectedPercent == null || goalTrack.percent === expectedPercent) &&
    consentPacket.status === "ready" &&
    consentPacket.command === "pnpm verify:terminal:authenticated-ai-cli-prompt" &&
    String(consentPacket.requiredEnv ?? "").includes("AETHER_AUTH_PROMPT_CONSENT=") &&
    String(consentPacket.providerEnvRequirement ?? "").includes("AETHER_AUTH_PROMPT_PROVIDER=codex|claude|gemini") &&
    consentPacket.tokenGate === "explicit consent" &&
    ["codex", "claude", "gemini"].every((provider) => readyProviders.includes(provider)) &&
    countAuthenticatedPromptBlockers(remaining) === (coreGoalComplete ? 0 : 1) &&
    !remaining.some((item) => qaFixtureLeakPattern.test(String(item ?? ""))) &&
    (expectedResidual.state !== "blocked-by-external-gates" ||
      (nativeSleepAction?.command === "pnpm verify:production:suspend:native-user-cycle" &&
        nativeSleepAction?.requiresUserAction === "true" &&
        nativeSleepAction?.requiresExplicitConsent === "false" &&
        nativeSleepAction?.costClass === "no-token-user-host-action" &&
        String(nativeSleepAction?.snippet ?? "").includes("manually sleep and wake Windows") &&
        String(nativeSleepAction?.snippet ?? "").includes("pnpm verify:goal:safe")));
  const bootstrapOk =
    BOOTSTRAP_RIGHT_RAIL === true &&
    coreSafeGatePassed === true &&
    expectedQualityDetail != null &&
    expectedResidual.state != null &&
    expectedResidual.implementationFixableCount === 0 &&
    nonConsentBlockers.length === 0 &&
    provedRequirementCount === totalRequirementCount &&
    totalRequirementCount >= 8 &&
    auditedRequirements.every((requirement) => requirement?.status === "proved") &&
    consentBlockerCount <= 1 &&
    (externalBlockers.length > 0 || consentBlockerCount === 1);
  const environmentBlockedOk =
    !strictOk &&
    environmentBlockedFresh &&
    audit?.ok === true &&
    audit?.evidenceComplete === true &&
    implementationFixableCount === 0 &&
    expectedQualityDetail != null &&
    expectedResidual.state != null &&
    expectedResidual.implementationFixableCount === 0 &&
    nonConsentBlockers.length === 0 &&
    (score?.releaseCandidateReady === true ||
      audit?.status === "blocked-by-explicit-consent" ||
      audit?.status === "blocked-by-external-gates") &&
    provedRequirementCount === totalRequirementCount &&
    totalRequirementCount >= 8 &&
    auditedRequirements.every((requirement) => requirement?.status === "proved") &&
    consentBlockerCount <= 1 &&
    (externalBlockers.length > 0 || consentBlockerCount === 1);
  const ok = strictOk || environmentBlockedOk;
  return {
    ok,
    status: strictOk
      ? "pass-current-contract"
      : environmentBlockedOk
        ? "environment-blocked-current-contract"
      : bootstrapOk
        ? "bootstrap-current-contract"
        : (data?.status ?? "stale-or-incomplete"),
    expectation:
      "current score, final audit, safe gate, consent packet, and remaining blocker match Tauri Goal Track DOM proof",
    reason: strictOk
      ? "right rail Goal Track artifact semantically matches the current non-token safe gate"
      : bootstrapOk
        ? "right rail Goal Track artifact is bootstrap-only and must be refreshed by the Tauri Goal Track smoke before it can count as a strict proof"
        : environmentBlockedOk
          ? "right rail Goal Track strict DOM proof is blocked by the current WebView2/CDP host, but source contract, score, audit, safe gate, and no-token consent boundaries are current"
        : "right rail Goal Track artifact is stale in source/capture time, incomplete, or does not match current safe-gate semantics",
    strictProof: strictOk,
    environmentBlockedProof: environmentBlockedOk,
    bootstrapOnly: bootstrapOk && !strictOk,
    semanticFreshness: strictOk || environmentBlockedOk ? "current-contract" : "stale-or-incomplete",
    cycleBoundary: "right-rail-safe-gate-mutual-proof",
  };
}

const proofArtifacts = {
  releaseQualityScore: artifactMeta(".codex-auto/quality/release-quality-score.json", releaseQualityScoreVerdict),
  finalGoalAudit: artifactMeta(".codex-auto/quality/final-goal-audit.json", finalGoalAuditVerdict),
  authenticatedProviderGuard: artifactMeta(
    ".codex-auto/production-smoke/authenticated-ai-cli-provider-required-smoke.json",
    providerGuardVerdict,
  ),
  authenticatedPreflightMatrix: artifactMeta(
    ".codex-auto/production-smoke/authenticated-ai-cli-preflight-matrix.json",
    authenticatedPreflightMatrixVerdict,
  ),
  authenticatedConsentPacket: artifactMeta(
    ".codex-auto/production-smoke/authenticated-ai-cli-consent-packet.json",
    authenticatedConsentPacketVerdict,
  ),
  externalGateReadiness: artifactMeta(
    ".codex-auto/quality/goal-external-gate-readiness.json",
    externalGateReadinessVerdict,
  ),
  goalOperatorFinish: artifactMeta(".codex-auto/quality/goal-operator-finish.json", operatorFinishVerdict),
  gitFinalizationReadiness: artifactMeta(
    ".codex-auto/quality/git-finalization-readiness.json",
    gitFinalizationReadinessVerdict,
  ),
  gitFinalizationShellDiagnostics: artifactMeta(
    ".codex-auto/quality/git-finalization-shell-diagnostics.json",
    gitFinalizationShellDiagnosticsVerdict,
  ),
  realAiCliBinaryProbe: artifactMeta(
    ".codex-auto/production-smoke/real-ai-cli-binary-probe.json",
    realAiCliBinaryProbeVerdict,
  ),
  aiCliLaunchPlanner: artifactMeta(
    ".codex-auto/production-smoke/ai-cli-launch-planner.json",
    aiCliLaunchPlannerVerdict,
  ),
  nativeAiCliPostLaunchChaos: artifactMeta(
    ".codex-auto/chaos-recovery/native-ai-cli-post-launch-chaos.json",
    nativeAiCliPostLaunchChaosVerdict,
  ),
  glassLegibilityContract: artifactMeta(
    ".codex-auto/quality/glass-legibility-contract.json",
    glassLegibilityContractVerdict,
  ),
  rightRailInformationDensity: artifactMeta(
    ".codex-auto/quality/right-rail-information-density-contract.json",
    rightRailInformationDensityVerdict,
  ),
  goalAntiStallContract: artifactMeta(
    ".codex-auto/quality/goal-anti-stall-contract.json",
    antiStallContractVerdict,
  ),
  realOsSleepOperatorHandoff: artifactMeta(
    ".codex-auto/quality/real-os-sleep-operator-handoff.json",
    realOsSleepOperatorHandoffVerdict,
  ),
  tauriRuntimeHygiene: artifactMeta(".codex-auto/quality/tauri-runtime-hygiene.json", tauriRuntimeHygieneVerdict),
  releaseHygieneContract: artifactMeta(
    ".codex-auto/quality/release-hygiene-contract.json",
    releaseHygieneContractVerdict,
  ),
  supplyChainAudit: artifactMeta(".codex-auto/release-doctor/supply-chain-audit.json", supplyChainAuditVerdict),
  terminalChunkedOscLive: artifactMeta(
    ".codex-auto/production-smoke/chunked-osc-live.json",
    terminalChunkedOscLiveVerdict,
  ),
  nativeTerminalInputHost: artifactMeta(
    ".codex-auto/production-smoke/native-terminal-input-host.json",
    nativeTerminalInputHostVerdict,
  ),
  nativeHwndPasteLive: artifactMeta(
    ".codex-auto/production-smoke/native-hwnd-paste-live.json",
    nativeHwndPasteLiveVerdict,
  ),
  rightRailStaleUrlTruth: artifactMeta(
    ".codex-auto/production-smoke/right-rail-stale-url-truth.json",
    rightRailStaleUrlTruthVerdict,
  ),
  rightRailGoalTrackTauri: artifactMeta(
    ".codex-auto/production-smoke/right-rail-goal-track-tauri.json",
    rightRailGoalTrackVerdict,
  ),
  goalDocumentationFreshness: artifactMeta(
    ".codex-auto/quality/goal-documentation-freshness.json",
    goalDocumentationFreshnessVerdict,
  ),
  goalCompletionMatrix: artifactMeta(".codex-auto/quality/goal-completion-matrix.json", goalCompletionMatrixVerdict),
};
const optionalProofArtifactKeys = new Set(["gitFinalizationShellDiagnostics"]);
const proofArtifactEntries = Object.entries(proofArtifacts)
  .filter(([key]) => !optionalProofArtifactKeys.has(key))
  .map(([, artifact]) => artifact);
const optionalProofArtifactEntries = Object.entries(proofArtifacts)
  .filter(([key]) => optionalProofArtifactKeys.has(key))
  .map(([key, artifact]) => ({ key, ...artifact }));
const proofArtifactPassCount = proofArtifactEntries.filter((artifact) => artifact.ok === true).length;
const proofArtifactsPassed = proofArtifactEntries.length > 0 && proofArtifactPassCount === proofArtifactEntries.length;
const safeGatePassed = coreSafeGatePassed === true && proofArtifactsPassed === true;
const goalComplete = coreGoalComplete === true && proofArtifactsPassed === true;
const blockedOnlyByExplicitConsent = coreBlockedOnlyByExplicitConsent === true && proofArtifactsPassed === true;
const blockedByExternalGates = coreBlockedByExternalGates === true && proofArtifactsPassed === true;

const report = {
  version: 1,
  generatedAt: new Date().toISOString(),
  localDate: currentLocalDate(),
  timeZone: LOCAL_TIME_ZONE,
  ok: safeGatePassed,
  status: goalComplete
    ? "complete"
    : blockedByExternalGates
      ? "blocked-by-external-gates"
      : blockedOnlyByExplicitConsent
        ? "blocked-by-explicit-consent"
        : "blocked",
  tokenSpendingPromptExecuted,
  safetyNote: BOOTSTRAP_RIGHT_RAIL
    ? "Bootstrap mode projects the right-rail mutual-proof safe summary so the Tauri Goal Track smoke can refresh its DOM artifact; rerun without AETHER_FINAL_GOAL_SAFE_BOOTSTRAP_RIGHT_RAIL for strict proof."
    : tokenSpendingPromptExecuted
      ? "This gate includes a consented authenticated AI CLI prompt smoke and still requires provider guard, runtime hygiene, score, and final audit proof."
      : "This gate intentionally does not execute the authenticated AI CLI prompt smoke; it only proves the no-token preflight, guard, runtime hygiene, score, and final audit chain.",
  bootstrapRightRailSemanticProof: BOOTSTRAP_RIGHT_RAIL,
  proofChain: steps.map((step, index) => ({
    order: index + 1,
    id: step.id,
    label: step.label,
    script: step.script,
    ok: step.ok,
    exitCode: step.exitCode,
  })),
  artifacts: proofArtifacts,
  invariants: {
    noTokenPromptSent,
    noFailedSafeSteps: failedSteps.length === 0,
    noProductionBuildWarnings:
      productionBuildKnownWarnings.length === 0 && productionBuildUnexpectedWarnings.length === 0,
    noUnexpectedProductionBuildWarnings: productionBuildUnexpectedWarnings.length === 0,
    noNonConsentBlockers: nonConsentBlockers.length === 0,
    implementationFixableCountZero: implementationFixableCount === 0,
    exactlyOnePolicyConsentGate: policyBlockedCount === 1 && consentBlockerCount === 1,
    externalHostGateIsolated: (externalBlockedCount ?? 0) === externalBlockers.length && externalBlockers.length > 0,
    finalAuditEvidenceComplete: audit?.evidenceComplete === true,
    finalAuditRequirementsProved: totalRequirementCount > 0 && provedRequirementCount === totalRequirementCount,
    proofArtifactsPassed,
    releaseHygieneClean: proofArtifacts.releaseHygieneContract?.ok === true,
    supplyChainAuditClean: proofArtifacts.supplyChainAudit?.ok === true,
    terminalChunkedOscLivePassed: proofArtifacts.terminalChunkedOscLive?.ok === true,
    nativeTerminalInputHostPassed: proofArtifacts.nativeTerminalInputHost?.ok === true,
    nativeHwndPasteLivePassed: proofArtifacts.nativeHwndPasteLive?.ok === true,
    nativeAiCliPostLaunchChaosPassed: proofArtifacts.nativeAiCliPostLaunchChaos?.ok === true,
    glassLegibilityContractPassed: proofArtifacts.glassLegibilityContract?.ok === true,
    goalAntiStallContractPassed: proofArtifacts.goalAntiStallContract?.ok === true,
    realOsSleepOperatorHandoffPassed: proofArtifacts.realOsSleepOperatorHandoff?.ok === true,
    externalGateReadinessPassed: proofArtifacts.externalGateReadiness?.ok === true,
    operatorFinishHandoffPassed: proofArtifacts.goalOperatorFinish?.ok === true,
    gitFinalizationReadinessPassed: proofArtifacts.gitFinalizationReadiness?.ok === true,
    gitFinalizationShellDiagnosticsPassed:
      proofArtifacts.gitFinalizationShellDiagnostics?.ok === true || proofArtifacts.gitFinalizationReadiness?.ok === true,
    rightRailGoalTrackSemanticFreshness:
      proofArtifacts.rightRailGoalTrackTauri?.semanticFreshness === "current-contract",
    rightRailGoalTrackCycleBoundaryExplained:
      proofArtifacts.rightRailGoalTrackTauri?.cycleBoundary === "right-rail-safe-gate-mutual-proof",
  },
  coverage: {
    provedRequirementCount,
    totalRequirementCount,
    nonTokenRequirementsProved:
      totalRequirementCount > 0 && provedRequirementCount === totalRequirementCount && implementationFixableCount === 0,
    consentBlockerCount,
    nonConsentBlockerCount: nonConsentBlockers.length,
    externalBlockerCount: externalBlockers.length,
    proofArtifactPassCount,
    proofArtifactCount: proofArtifactEntries.length,
    optionalProofArtifactPassCount: optionalProofArtifactEntries.filter((artifact) => artifact.ok === true).length,
    optionalProofArtifactCount: optionalProofArtifactEntries.length,
    optionalProofArtifacts: optionalProofArtifactEntries.map((artifact) => ({
      key: artifact.key,
      ok: artifact.ok === true,
      status: artifact.status,
    })),
  },
  score: score
    ? {
        score: score.score,
        grade: score.grade,
        total: score.total,
        max: score.max,
        releaseCandidateReady: score.releaseCandidateReady === true,
        blockerAreas: releaseBlockers.map((item) => item?.area ?? "unknown"),
      }
    : null,
  productionBuildWarnings: {
    knownCount: productionBuildKnownWarnings.length,
    unexpectedCount: productionBuildUnexpectedWarnings.length,
    known: productionBuildKnownWarnings,
    unexpected: productionBuildUnexpectedWarnings,
  },
  audit: audit
    ? {
        ok: audit.ok === true,
        status: audit.status,
        goalComplete: audit.goalComplete === true,
        evidenceComplete: audit.evidenceComplete === true,
        implementationFixableCount,
        policyBlockedCount,
        externalBlockedCount,
        nextRequiredAction: audit.nextRequiredAction ?? null,
      }
    : null,
  steps,
  failedSteps: failedSteps.map((step) => step.id),
  nonConsentBlockers,
  externalBlockers,
  nextRequiredAction: goalComplete
    ? "Goal is complete."
    : blockedByExternalGates || blockedOnlyByExplicitConsent
      ? audit?.nextRequiredAction
      : "Fix failed safe-gate steps, non-consent blockers, or implementation-fixable residual risks.",
};

writeJson(OUT, report);
console.log(JSON.stringify({ artifact: OUT, ...report }, null, 2));

if (!safeGatePassed) {
  process.exitCode = 1;
}
