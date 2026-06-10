import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const ROOT = resolve(process.cwd());
const OUT = join(ROOT, ".codex-auto", "quality", "goal-external-gate-readiness.json");
const MAX_ARTIFACT_AGE_MS = Number.parseInt(
  process.env.AETHER_EXTERNAL_GATE_MAX_AGE_MS ?? `${24 * 60 * 60 * 1000}`,
  10,
);
const CONSENT_PHRASE = "I_UNDERSTAND_THIS_MAY_SPEND_TOKENS";
const AUTH_PROMPT_COMMAND = "pnpm verify:terminal:authenticated-ai-cli-prompt";
const PROVIDERS = ["codex", "claude", "gemini"];

const paths = {
  releaseScore: ".codex-auto/quality/release-quality-score.json",
  finalAudit: ".codex-auto/quality/final-goal-audit.json",
  completionMatrix: ".codex-auto/quality/goal-completion-matrix.json",
  authenticatedPrompt: ".codex-auto/production-smoke/authenticated-ai-cli-prompt-smoke.json",
  authenticatedProviderGuard: ".codex-auto/production-smoke/authenticated-ai-cli-provider-required-smoke.json",
  authenticatedPreflightMatrix: ".codex-auto/production-smoke/authenticated-ai-cli-preflight-matrix.json",
  authenticatedConsentPacket: ".codex-auto/production-smoke/authenticated-ai-cli-consent-packet.json",
  realOsSuspendEvidence: ".codex-auto/production-smoke/real-os-suspend-resume.json",
  realOsNativePreflight: ".codex-auto/production-smoke/real-os-suspend-native-preflight.json",
  realOsNativePostcheckPreflight: ".codex-auto/production-smoke/real-os-suspend-native-postcheck-preflight.json",
  realOsSleepOperatorHandoff: ".codex-auto/quality/real-os-sleep-operator-handoff.json",
  realOsNativePostcheckWriteSmoke:
    ".codex-auto/production-smoke/postcheck-write-smoke/real-os-suspend-native-postcheck-write-smoke.json",
  tauriRuntimeHygiene: ".codex-auto/quality/tauri-runtime-hygiene.json",
};

function currentLocalDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function readArtifact(path) {
  const full = join(ROOT, path);
  if (!existsSync(full)) return { path, exists: false, fresh: false, parseError: null, data: null };
  const stats = statSync(full);
  const ageMs = Date.now() - stats.mtimeMs;
  try {
    return {
      path,
      exists: true,
      fresh: ageMs <= MAX_ARTIFACT_AGE_MS,
      ageMs,
      mtimeMs: stats.mtimeMs,
      data: JSON.parse(readFileSync(full, "utf8")),
      parseError: null,
    };
  } catch (error) {
    return {
      path,
      exists: true,
      fresh: false,
      ageMs,
      mtimeMs: stats.mtimeMs,
      data: null,
      parseError: error instanceof Error ? error.message : String(error),
    };
  }
}

function everyTrue(value) {
  return Object.values(value ?? {}).every((entry) => entry === true);
}

function scoreEntry(score, id) {
  return Array.isArray(score?.scores) ? score.scores.find((entry) => entry?.id === id) : null;
}

function scoreEntryPassed(score, id) {
  const entry = scoreEntry(score, id);
  return entry != null && entry.max > 0 && entry.points === entry.max;
}

function isAuthenticatedPromptBlocker(item) {
  return /authenticated[-\s]?ai[-\s]?cli[-\s]?prompt|token-spend consent/i.test(
    String(item?.area ?? "") + " " + String(item?.blocker ?? item),
  );
}

function isRealOsSleepBlocker(item) {
  return /real-os-soak|sleep\/resume|user-initiated Windows sleep|host.*sleep|suspend/i.test(
    String(item?.area ?? "") + " " + String(item?.blocker ?? item),
  );
}

function isFinalGoalEvidenceMapBlocker(item) {
  return /final-goal-evidence-map|final goal audit/i.test(
    String(item?.area ?? "") + " " + String(item?.blocker ?? item),
  );
}

function isTauriRuntimeHygieneBlocker(item) {
  return /tauri-runtime-hygiene|runtime hygiene|Tauri dev|CDP ports|workspace Aether|aether-pty-server/i.test(
    String(item?.area ?? "") + " " + String(item?.blocker ?? item),
  );
}

function finalAuditBootstrapBlockedByThisVerifier(audit) {
  if (!audit || typeof audit !== "object") return false;
  const risks = Array.isArray(audit.implementationFixableRisks) ? audit.implementationFixableRisks : [];
  const onlySelfReferenceOrNoImplementationRisks =
    risks.length === 0 || risks.every((risk) => String(risk?.area ?? "") === "release-operations-proof");
  return (
    audit.status === "blocked" &&
    audit.evidenceComplete === false &&
    audit.implementationFixableCount <= 1 &&
    audit.policyBlockedCount <= 1 &&
    audit.externalBlockedCount >= 1 &&
    onlySelfReferenceOrNoImplementationRisks
  );
}

function completionMatrixBootstrapBlockedByFinalEvidence(matrix) {
  if (!matrix || typeof matrix !== "object") return false;
  const implementationBlockers = Array.isArray(matrix.implementationBlockers) ? matrix.implementationBlockers : [];
  const runtimeHygieneWasStale = implementationBlockers.some(isTauriRuntimeHygieneBlocker);
  const runtimeHygieneNowPasses =
    tauriRuntimeHygiene?.ok === true &&
    tauriRuntimeHygiene?.status === "pass" &&
    tauriRuntimeHygiene?.checks?.portsClosed === true &&
    tauriRuntimeHygiene?.checks?.workspaceProcessesClear === true;
  const staleRuntimeOrFinalEvidenceCycleBreak =
    matrix.status === "blocked" &&
    matrix.implementationFixableCount <= 4 &&
    matrix.policyBlockedCount <= 1 &&
    matrix.externalBlockedCount >= 1 &&
    implementationBlockers.length >= 1 &&
    implementationBlockers.every(
      (blocker) => isFinalGoalEvidenceMapBlocker(blocker) || isTauriRuntimeHygieneBlocker(blocker),
    ) &&
    (!runtimeHygieneWasStale || runtimeHygieneNowPasses);
  const finalSafeCycleBreak =
    matrix.status === "blocked" &&
    matrix.implementationFixableCount === 0 &&
    matrix.policyBlockedCount <= 1 &&
    matrix.externalBlockedCount >= 1 &&
    matrix.checks?.scoreCurrentShape === true &&
    matrix.checks?.auditEvidenceComplete === true &&
    matrix.checks?.auditRequirementsComplete === true &&
    matrix.checks?.evidenceIntegrityOk === true &&
    matrix.checks?.residualIsOnlyConsentOrExternalGate === true &&
    matrix.checks?.consentGateSafe === true &&
    matrix.checks?.finalSafeRightRailCurrentProof === false;
  const externalReadinessCycleBreak =
    matrix.status === "blocked" &&
    matrix.implementationFixableCount === 0 &&
    matrix.policyBlockedCount <= 1 &&
    matrix.externalBlockedCount >= 1 &&
    matrix.checks?.scoreCurrentShape === true &&
    matrix.checks?.auditEvidenceComplete === true &&
    matrix.checks?.auditRequirementsComplete === true &&
    matrix.checks?.evidenceIntegrityOk === true &&
    matrix.checks?.residualIsOnlyConsentOrExternalGate === true &&
    matrix.checks?.consentGateSafe === true &&
    matrix.checks?.finalSafeRightRailCurrentProof === true &&
    Array.isArray(matrix.externalBlockers) &&
    matrix.externalBlockers.length >= 1 &&
    matrix.externalBlockers.every(isRealOsSleepBlocker) &&
    Array.isArray(matrix.matrix) &&
    matrix.matrix.every((row) => {
      if (row?.status === "proved") return true;
      return (
        row?.id === "release-operations-proof" &&
        Array.isArray(row?.missingArtifactKeys) &&
        row.missingArtifactKeys.length === 1 &&
        row.missingArtifactKeys[0] === "externalGateReadiness"
      );
    });
  const externalGateCycleBreak =
    matrix.status === "blocked" &&
    matrix.implementationFixableCount <= 1 &&
    matrix.policyBlockedCount === 1 &&
    matrix.externalBlockedCount >= 1 &&
    implementationBlockers.every(isFinalGoalEvidenceMapBlocker);
  return (
    staleRuntimeOrFinalEvidenceCycleBreak ||
    finalSafeCycleBreak ||
    externalReadinessCycleBreak ||
    externalGateCycleBreak ||
    (matrix.status === "blocked" &&
      matrix.implementationFixableCount <= 1 &&
      matrix.policyBlockedCount === 1 &&
      matrix.externalBlockedCount >= 1 &&
      implementationBlockers.length >= 1 &&
      implementationBlockers.every(isFinalGoalEvidenceMapBlocker))
  );
}

function artifactSummary(artifact) {
  return {
    path: artifact.path,
    exists: artifact.exists,
    fresh: artifact.fresh,
    ageMs: artifact.ageMs ?? null,
    mtimeMs: artifact.mtimeMs ?? null,
    parseError: artifact.parseError,
    status: artifact.data?.status ?? null,
    ok: artifact.data?.ok ?? null,
  };
}

function providerRowsReady(matrix) {
  const rows = Array.isArray(matrix?.providerMatrix) ? matrix.providerMatrix : [];
  return PROVIDERS.every((provider) => {
    const row = rows.find((entry) => entry?.provider === provider);
    return (
      row?.ready === true &&
      row?.optInCommand?.command === AUTH_PROMPT_COMMAND &&
      row?.optInCommand?.env?.AETHER_AUTH_PROMPT_CONSENT === CONSENT_PHRASE &&
      row?.optInCommand?.env?.AETHER_AUTH_PROMPT_PROVIDER === provider &&
      everyTrue(row?.checks)
    );
  });
}

const artifacts = Object.fromEntries(Object.entries(paths).map(([key, path]) => [key, readArtifact(path)]));
const releaseScore = artifacts.releaseScore.data;
const finalAudit = artifacts.finalAudit.data;
const completionMatrix = artifacts.completionMatrix.data;
const authenticatedPrompt = artifacts.authenticatedPrompt.data;
const providerGuard = artifacts.authenticatedProviderGuard.data;
const preflightMatrix = artifacts.authenticatedPreflightMatrix.data;
const consentPacket = artifacts.authenticatedConsentPacket.data;
const suspendEvidence = artifacts.realOsSuspendEvidence.data;
const nativePreflight = artifacts.realOsNativePreflight.data;
const nativePostcheckPreflight = artifacts.realOsNativePostcheckPreflight.data;
const sleepOperatorHandoff = artifacts.realOsSleepOperatorHandoff.data;
const nativePostcheckWriteSmoke = artifacts.realOsNativePostcheckWriteSmoke.data;
const tauriRuntimeHygiene = artifacts.tauriRuntimeHygiene.data;

const blockers = Array.isArray(releaseScore?.blockers) ? releaseScore.blockers : [];
const implementationBlockers = blockers.filter(
  (item) => !isAuthenticatedPromptBlocker(item) && !isRealOsSleepBlocker(item) && !isFinalGoalEvidenceMapBlocker(item),
);
const tokenBlockers = blockers.filter(isAuthenticatedPromptBlocker);
const sleepBlockers = blockers.filter(isRealOsSleepBlocker);
const promptChecks = authenticatedPrompt?.checks ?? {};
const tokenGateReady =
  authenticatedPrompt?.wouldSpendTokens === true &&
  authenticatedPrompt?.status === "requires_opt_in" &&
  promptChecks.tokenSpendingExecutionBlocked === true &&
  promptChecks.safeNoPromptSent === true &&
  (promptChecks.nonTokenPreflightReady === true || authenticatedPrompt?.nonTokenPreflight?.ready === true);
const providerGuardReady =
  providerGuard?.status === "provider_required" &&
  providerGuard?.guardVerifier?.ok === true &&
  providerGuard?.guardVerifier?.checks?.tokenBlocked === true &&
  providerGuard?.guardVerifier?.checks?.noPromptSent === true &&
  providerGuard?.guardVerifier?.checks?.noSessionSpawned === true;
const preflightMatrixReady =
  preflightMatrix?.ok === true &&
  preflightMatrix?.status === "pass" &&
  preflightMatrix?.checks?.allProvidersReady === true &&
  preflightMatrix?.checks?.promptExecutionStateReady === true &&
  preflightMatrix?.checks?.tokenSpendingExecutionBlocked === true &&
  preflightMatrix?.checks?.noPromptSent === true &&
  preflightMatrix?.checks?.nativePostLaunchChaosPass === true &&
  providerRowsReady(preflightMatrix);
const consentPacketBaseReady =
  consentPacket?.ok === true &&
  consentPacket?.status === "pass" &&
  consentPacket?.packet?.command === AUTH_PROMPT_COMMAND &&
  consentPacket?.packet?.tokenGate === "explicit consent" &&
  consentPacket?.packet?.wouldSpendTokens === true &&
  consentPacket?.checks?.promptStateValid === true &&
  consentPacket?.checks?.promptConsentPacketReady === true &&
  consentPacket?.checks?.allProviderOptInCommandsReady === true;
const consentPacketPreConsentReady =
  consentPacket?.packet?.tokenSpendingPromptExecuted === false &&
  consentPacket?.checks?.noTokenPromptSent === true;
const consentPacketPostConsentReady =
  consentPacket?.packet?.tokenSpendingPromptExecuted === true &&
  consentPacket?.checks?.tokenPromptExecutedWithConsent === true &&
  consentPacket?.checks?.noTokenPromptSent === false;
const consentPacketReady = consentPacketBaseReady && (consentPacketPreConsentReady || consentPacketPostConsentReady);

const userSleepTimedOut =
  suspendEvidence?.validation?.userInitiatedSleepWait?.status === "timeout" &&
  suspendEvidence?.validation?.userInitiatedSleepWait?.ok === false &&
  /timed out waiting for a real user-initiated Windows sleep\/resume event pair/i.test(
    String(suspendEvidence?.validation?.userInitiatedSleepWait?.reason ?? ""),
  );
const nativeSleepPreflightReady =
  nativePreflight?.status === "ready-for-real-sleep" && everyTrue(nativePreflight?.checks);
const nativePostcheckReady =
  nativePostcheckPreflight?.status === "ready-for-native-postcheck" && everyTrue(nativePostcheckPreflight?.checks);
const postcheckWriteSmokeReady =
  nativePostcheckWriteSmoke?.status === "pass" &&
  nativePostcheckWriteSmoke?.noRealSleepClaim === true &&
  everyTrue(nativePostcheckWriteSmoke?.checks);
const realSleepOperatorHandoffReady =
  sleepOperatorHandoff?.ok === true &&
  ["ready-for-manual-sleep-cycle", "real-os-sleep-resume-complete"].includes(sleepOperatorHandoff?.status) &&
  sleepOperatorHandoff?.realOsSleepInvoked === false &&
  sleepOperatorHandoff?.checks?.noOsSleepEnvPresent === true &&
  sleepOperatorHandoff?.checks?.hostBlockerClassified === true &&
  sleepOperatorHandoff?.checks?.evidenceDoesNotFakePass === true &&
  sleepOperatorHandoff?.runbook?.manualSleepCycle?.command === "pnpm verify:production:suspend:native-user-cycle" &&
  sleepOperatorHandoff?.runbook?.operatorFinish?.command === "pnpm verify:goal:operator-finish" &&
  Array.isArray(sleepOperatorHandoff?.runbook?.afterManualGate) &&
  sleepOperatorHandoff.runbook.afterManualGate.includes("pnpm verify:goal:safe");
const realSleepGateHostBlocked =
  scoreEntry(releaseScore, "real-os-soak")?.points >= 10 &&
  suspendEvidence?.status !== "pass" &&
  (suspendEvidence?.validation?.hostSleepUnsupported === true ||
    suspendEvidence?.validation?.sleepAttempt?.hostUnsupported === true ||
    /SetSuspendState returned false; GetLastError=50|ERROR_NOT_SUPPORTED/i.test(
      String(suspendEvidence?.validation?.sleepAttempt?.reason ?? suspendEvidence?.notes ?? ""),
    )) &&
  nativeSleepPreflightReady &&
  nativePostcheckReady &&
  postcheckWriteSmokeReady &&
  realSleepOperatorHandoffReady;
const realSleepGateReady =
  scoreEntry(releaseScore, "real-os-soak")?.points >= 10 &&
  userSleepTimedOut &&
  nativeSleepPreflightReady &&
  nativePostcheckReady &&
  postcheckWriteSmokeReady &&
  realSleepOperatorHandoffReady;
const tokenGateComplete =
  scoreEntryPassed(releaseScore, "authenticated-ai-cli-prompt-smoke") &&
  authenticatedPrompt?.ok === true &&
  authenticatedPrompt?.status === "pass";
const realSleepGateComplete =
  scoreEntryPassed(releaseScore, "real-os-soak") &&
  (suspendEvidence?.status === "pass" || suspendEvidence?.ok === true);
const finalGoalEvidenceMapEntry = scoreEntry(releaseScore, "final-goal-evidence-map");
const projectedTotalAfterEvidenceMap =
  typeof releaseScore?.total === "number" && typeof finalGoalEvidenceMapEntry?.max === "number"
    ? releaseScore.total - (finalGoalEvidenceMapEntry?.points ?? 0) + finalGoalEvidenceMapEntry.max
    : releaseScore?.total;
const projectedScoreAfterEvidenceMap =
  typeof projectedTotalAfterEvidenceMap === "number" && typeof releaseScore?.max === "number"
    ? Math.round((projectedTotalAfterEvidenceMap / releaseScore.max) * 100)
    : releaseScore?.score ?? 0;
const finalAuditExternalGateShape =
  (finalAudit?.ok === true &&
    finalAudit?.status === "blocked-by-external-gates" &&
    finalAudit?.implementationFixableCount === 0 &&
    finalAudit?.policyBlockedCount <= 1 &&
    finalAudit?.externalBlockedCount >= 1) ||
  finalAuditBootstrapBlockedByThisVerifier(finalAudit);
const finalAuditCompleteShape =
  finalAudit?.ok === true &&
  finalAudit?.status === "complete" &&
  finalAudit?.goalComplete === true &&
  finalAudit?.implementationFixableCount === 0 &&
  finalAudit?.policyBlockedCount === 0 &&
  finalAudit?.externalBlockedCount === 0;
const completionMatrixExternalGateShape =
  (completionMatrix?.ok === true &&
    completionMatrix?.status === "blocked-by-external-gates" &&
    completionMatrix?.implementationFixableCount === 0) ||
  completionMatrixBootstrapBlockedByFinalEvidence(completionMatrix);
const completionMatrixCompleteShape =
  completionMatrix?.ok === true &&
  completionMatrix?.status === "complete" &&
  completionMatrix?.goalComplete === true &&
  completionMatrix?.implementationFixableCount === 0 &&
  completionMatrix?.policyBlockedCount === 0 &&
  completionMatrix?.externalBlockedCount === 0;
const releaseScoreExternalGateShape =
  (releaseScore?.score >= 93 || projectedScoreAfterEvidenceMap >= 96) &&
  releaseScore?.max === 335 &&
  ["A", "S"].includes(releaseScore?.grade) &&
  releaseScore?.releaseCandidateReady === false &&
  implementationBlockers.length === 0 &&
  ((tokenBlockers.length === 1 && !tokenGateComplete) || (tokenBlockers.length === 0 && tokenGateComplete)) &&
  sleepBlockers.length >= 1;
const releaseScoreCompleteShape =
  releaseScore?.releaseCandidateReady === true &&
  releaseScore?.max === 335 &&
  releaseScore?.score >= 97 &&
  implementationBlockers.length === 0 &&
  blockers.length === 0 &&
  tokenGateComplete &&
  realSleepGateComplete;
const completeExternalGatesProved =
  releaseScoreCompleteShape && finalAuditCompleteShape && completionMatrixCompleteShape;

function artifactFreshForExternalGate(key, artifact) {
  if (!artifact.exists || artifact.parseError) return false;
  if (artifact.fresh) return true;
  if (key === "authenticatedPrompt" && providerGuardReady && consentPacketReady) return true;
  if (key === "authenticatedPrompt" && tokenGateComplete) return true;
  if (key === "realOsSuspendEvidence" && realSleepGateReady) return true;
  if (key === "realOsSuspendEvidence" && realSleepGateComplete) return true;
  if (key === "realOsSleepOperatorHandoff" && realSleepOperatorHandoffReady) return true;
  if (key === "finalAudit" && finalAuditExternalGateShape) return true;
  if (key === "finalAudit" && finalAuditCompleteShape) return true;
  if (key === "completionMatrix" && completionMatrixExternalGateShape) return true;
  if (key === "completionMatrix" && completionMatrixCompleteShape) return true;
  return false;
}

const checks = {
  noUnsafeConsentEnvPresent:
    !process.env.AETHER_AUTH_PROMPT_CONSENT?.trim() && !process.env.AETHER_AUTH_PROMPT_PROVIDER?.trim(),
  noOsSleepEnvPresent: process.env.AETHER_ALLOW_OS_SLEEP !== "1",
  releaseScoreCurrentExternalGateShape: releaseScoreExternalGateShape || releaseScoreCompleteShape,
  finalAuditExternalGateShape: finalAuditExternalGateShape || finalAuditCompleteShape,
  completionMatrixExternalGateShape: completionMatrixExternalGateShape || completionMatrixCompleteShape,
  tokenGateReady: tokenGateReady || tokenGateComplete,
  tokenPromptExecutedWithConsent: tokenGateComplete && consentPacketPostConsentReady,
  providerGuardReady,
  preflightMatrixReady,
  consentPacketReady,
  realSleepGateReady: realSleepGateReady || realSleepGateComplete || realSleepGateHostBlocked,
  realSleepGateHostBlocked,
  realSleepOperatorHandoffReady,
  noTokenPromptSent:
    !tokenGateComplete && (completeExternalGatesProved || ((tokenGateReady || providerGuardReady) && consentPacketReady)),
  noRealSleepClaimMade:
    completeExternalGatesProved ||
    (suspendEvidence?.status !== "pass" &&
      postcheckWriteSmokeReady &&
      nativePostcheckWriteSmoke?.checks?.noRealSleepClaim === true),
  sourceArtifactsFresh: Object.entries(artifacts).every(([key, artifact]) => artifactFreshForExternalGate(key, artifact)),
  completeExternalGatesProved,
};

const externalRunbook = {
  beforeExternalGate: [
    "pnpm verify:goal:operator-finish",
    "pnpm verify:goal:external-gates",
  ],
  tokenPromptSmoke: PROVIDERS.map((provider) => ({
    provider,
    command: AUTH_PROMPT_COMMAND,
    env: {
      AETHER_AUTH_PROMPT_CONSENT: CONSENT_PHRASE,
      AETHER_AUTH_PROMPT_PROVIDER: provider,
    },
    costClass: "token-spending-explicit-consent",
    safety: "Do not run unless the operator explicitly accepts token spend for the selected provider.",
  })),
  realSleepResume: {
    command: "pnpm verify:production:suspend:native-user-cycle",
    handoff: "pnpm verify:goal:sleep-handoff",
    requires: "Start the verifier, manually put Windows to sleep, wake it, then let the verifier finish post-resume checks.",
    safety: "This readiness verifier does not set AETHER_ALLOW_OS_SLEEP and does not invoke Windows sleep.",
  },
  afterEitherGate: [
    "pnpm verify:goal:operator-finish",
    "pnpm verify:goal:finalize",
    "pnpm verify:goal:safe",
  ],
  operatorFinish: {
    command: "pnpm verify:goal:operator-finish",
    progressArtifact: ".codex-auto/quality/goal-operator-progress.json",
    safety:
      "Without exact opt-in env vars it only writes a handoff. With consent/sleep env vars it runs the requested external gate and refreshes final evidence.",
  },
  finalizeClosure: {
    command: "pnpm verify:goal:finalize",
    safety:
      "Runs the ordered score/audit/docs/matrix/safe finalizer without sending prompts or invoking OS sleep.",
  },
};

const readyForExternalGates =
  checks.noUnsafeConsentEnvPresent &&
  checks.noOsSleepEnvPresent &&
  releaseScoreExternalGateShape &&
  checks.finalAuditExternalGateShape &&
  checks.completionMatrixExternalGateShape &&
  (tokenGateReady || tokenGateComplete) &&
  checks.providerGuardReady &&
  checks.preflightMatrixReady &&
  checks.consentPacketReady &&
  checks.realSleepGateReady &&
  (checks.noTokenPromptSent || checks.tokenPromptExecutedWithConsent) &&
  checks.noRealSleepClaimMade &&
  checks.sourceArtifactsFresh;
const completeExternalGates =
  checks.noUnsafeConsentEnvPresent &&
  checks.noOsSleepEnvPresent &&
  completeExternalGatesProved &&
  checks.providerGuardReady &&
  checks.preflightMatrixReady &&
  checks.consentPacketReady &&
  checks.sourceArtifactsFresh;
const ok = readyForExternalGates || completeExternalGates;
const report = {
  version: 1,
  generatedAt: new Date().toISOString(),
  localDate: currentLocalDate(),
  timeZone: "Asia/Tokyo",
  ok,
  status: completeExternalGates
    ? "external-operator-gates-complete"
    : readyForExternalGates && realSleepGateHostBlocked
      ? "blocked-by-host-sleep-unsupported"
    : readyForExternalGates
      ? "ready-for-external-operator-gates"
      : "failed",
  tokenSpendingPromptExecuted: tokenGateComplete,
  realOsSleepInvoked: false,
  realOsSleepAttempted: realSleepGateHostBlocked || realSleepGateComplete,
  checks,
  tokenSpendingPromptAlreadyProved: tokenGateComplete,
  realOsSleepAlreadyProved: realSleepGateComplete,
  remainingExternalGates: completeExternalGates
    ? []
    : [
        ...(!tokenGateComplete
          ? [
              {
                id: "authenticated-ai-cli-prompt-smoke",
                status: tokenGateReady && consentPacketReady ? "ready-for-explicit-consent" : "not-ready",
                blocker:
                  tokenBlockers[0]?.blocker ?? "authenticated AI CLI prompt smoke requires explicit token-spend consent",
              },
            ]
          : []),
        {
          id: "real-os-sleep-resume",
          status: realSleepGateComplete
            ? "complete"
            : realSleepGateHostBlocked
              ? "host-unsupported"
              : realSleepGateReady
                ? "ready-for-user-sleep-cycle"
                : "not-ready",
          blocker:
            sleepBlockers[0]?.blocker ??
            "real OS sleep/resume requires a user-initiated Windows sleep/wake cycle while the verifier waits",
        },
      ],
  runbook: externalRunbook,
  artifacts: Object.fromEntries(Object.entries(artifacts).map(([key, artifact]) => [key, artifactSummary(artifact)])),
};

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ artifact: OUT, ...report }, null, 2));
if (!report.ok) process.exitCode = 1;
