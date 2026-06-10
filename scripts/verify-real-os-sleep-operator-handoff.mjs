import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const ROOT = resolve(process.cwd());
const OUT = join(ROOT, ".codex-auto", "quality", "real-os-sleep-operator-handoff.json");
const LOCAL_TIME_ZONE = "Asia/Tokyo";

const paths = {
  releaseScore: ".codex-auto/quality/release-quality-score.json",
  finalAudit: ".codex-auto/quality/final-goal-audit.json",
  completionMatrix: ".codex-auto/quality/goal-completion-matrix.json",
  externalGateReadiness: ".codex-auto/quality/goal-external-gate-readiness.json",
  operatorFinish: ".codex-auto/quality/goal-operator-finish.json",
  operatorProgress: ".codex-auto/quality/goal-operator-progress.json",
  realOsSuspendEvidence: ".codex-auto/production-smoke/real-os-suspend-resume.json",
  realOsSuspendDiagnostic: ".codex-auto/production-smoke/real-os-suspend-resume.diagnostic.json",
  realOsNativePreflight: ".codex-auto/production-smoke/real-os-suspend-native-preflight.json",
  realOsNativePostcheckPreflight: ".codex-auto/production-smoke/real-os-suspend-native-postcheck-preflight.json",
  realOsNativePostcheckWriteSmoke:
    ".codex-auto/production-smoke/postcheck-write-smoke/real-os-suspend-native-postcheck-write-smoke.json",
  packageJson: "package.json",
  realOsSuspendVerifier: "scripts/verify-real-os-suspend-evidence.mjs",
};

const USER_CYCLE_COMMAND = "pnpm verify:production:suspend:native-user-cycle";
const OPERATOR_FINISH_COMMAND = "pnpm verify:goal:operator-finish";
const FINALIZE_COMMAND = "pnpm verify:goal:finalize";
const SAFE_COMMAND = "pnpm verify:goal:safe";
const AFTER_MANUAL_GATE_COMMANDS = [OPERATOR_FINISH_COMMAND, FINALIZE_COMMAND, SAFE_COMMAND];
const SLEEP_PHRASE = "I_WILL_MANUALLY_SLEEP_WINDOWS_WHILE_VERIFIER_WAITS";

function currentLocalDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: LOCAL_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function readText(path) {
  const full = join(ROOT, path);
  return existsSync(full) ? readFileSync(full, "utf8") : "";
}

function readJson(path) {
  const full = join(ROOT, path);
  if (!existsSync(full)) return { exists: false, data: null, parseError: null, mtimeMs: 0, size: 0 };
  const stats = statSync(full);
  try {
    return {
      exists: true,
      data: JSON.parse(readFileSync(full, "utf8")),
      parseError: null,
      mtimeMs: stats.mtimeMs,
      size: stats.size,
    };
  } catch (error) {
    return {
      exists: true,
      data: null,
      parseError: error instanceof Error ? error.message : String(error),
      mtimeMs: stats.mtimeMs,
      size: stats.size,
    };
  }
}

function everyTrue(value) {
  return Object.values(value ?? {}).every((entry) => entry === true);
}

function scoreEntry(score, id) {
  return Array.isArray(score?.scores) ? score.scores.find((entry) => entry?.id === id) : null;
}

function isRealOsSleepBlocker(value) {
  return /real-os-soak|sleep\/resume|SetSuspendState returned false|GetLastError=50|host.*sleep|suspend/i.test(
    String(value ?? ""),
  );
}

function isFinalEvidenceMapBlocker(value) {
  return /final-goal-evidence-map|final goal audit/i.test(String(value ?? ""));
}

function finalAuditBootstrapBlockedByThisVerifier(audit) {
  if (!audit || typeof audit !== "object") return false;
  const risks = Array.isArray(audit.implementationFixableRisks) ? audit.implementationFixableRisks : [];
  return (
    audit.status === "blocked" &&
    audit.evidenceComplete === false &&
    audit.implementationFixableCount <= 1 &&
    audit.policyBlockedCount <= 1 &&
    audit.externalBlockedCount >= 1 &&
    (risks.length === 0 || risks.every((risk) => String(risk?.area ?? "") === "release-operations-proof"))
  );
}

function completionMatrixBootstrapBlockedByFinalEvidence(matrix) {
  if (!matrix || typeof matrix !== "object") return false;
  const implementationBlockers = Array.isArray(matrix.implementationBlockers) ? matrix.implementationBlockers : [];
  return (
    matrix.status === "blocked" &&
    matrix.implementationFixableCount <= 1 &&
    matrix.policyBlockedCount <= 1 &&
    matrix.externalBlockedCount >= 1 &&
    implementationBlockers.length >= 1 &&
    implementationBlockers.every((blocker) =>
      isFinalEvidenceMapBlocker(`${blocker?.area ?? ""} ${blocker?.blocker ?? blocker}`),
    )
  );
}

function completionMatrixBlockedOnlyByManualSleepCycle(matrix) {
  if (!matrix || typeof matrix !== "object") return false;
  const externalBlockers = Array.isArray(matrix.externalBlockers) ? matrix.externalBlockers : [];
  const checks = matrix.checks ?? {};
  const allowedUnreadyChecks = new Set(["matrixRequirementsComplete", "finalSafeRightRailCurrentProof"]);
  const checksAreOnlySelfCycleBlocked = Object.entries(checks).every(([id, ok]) => {
    return ok === true || allowedUnreadyChecks.has(id);
  });
  return (
    matrix.status === "blocked" &&
    matrix.implementationFixableCount === 0 &&
    matrix.policyBlockedCount === 0 &&
    matrix.externalBlockedCount >= 1 &&
    checksAreOnlySelfCycleBlocked &&
    externalBlockers.length >= 1 &&
    externalBlockers.every((blocker) => isRealOsSleepBlocker(`${blocker?.area ?? ""} ${blocker?.blocker ?? blocker}`))
  );
}

function artifactSummary(path, artifact) {
  return {
    path,
    exists: artifact.exists,
    parseError: artifact.parseError,
    ok: artifact.data?.ok ?? null,
    status: artifact.data?.status ?? null,
    generatedAt: artifact.data?.generatedAt ?? null,
    mtimeMs: artifact.mtimeMs,
    size: artifact.size,
  };
}

const artifacts = Object.fromEntries(
  Object.entries(paths)
    .filter(([key]) => !["packageJson", "realOsSuspendVerifier"].includes(key))
    .map(([key, path]) => [key, readJson(path)]),
);
const packageJson = readText(paths.packageJson);
const realOsSuspendVerifier = readText(paths.realOsSuspendVerifier);
const rightRailGoalTrackSource = readText("src/shared/lib/rightRailGoalTrack.ts");
const rightRailGoalTrackTestSource = readText("src/__tests__/rightRailGoalTrack.test.ts");
const releaseBuildPlaybook = readText("docs/release-build-playbook.md");

const releaseScore = artifacts.releaseScore.data;
const finalAudit = artifacts.finalAudit.data;
const completionMatrix = artifacts.completionMatrix.data;
const externalGateReadiness = artifacts.externalGateReadiness.data;
const operatorFinish = artifacts.operatorFinish.data;
const operatorProgress = artifacts.operatorProgress.data;
const realOsSuspendEvidence = artifacts.realOsSuspendEvidence.data;
const realOsSuspendDiagnostic = artifacts.realOsSuspendDiagnostic.data;
const nativePreflight = artifacts.realOsNativePreflight.data;
const nativePostcheckPreflight = artifacts.realOsNativePostcheckPreflight.data;
const nativePostcheckWriteSmoke = artifacts.realOsNativePostcheckWriteSmoke.data;

const releaseBlockers = Array.isArray(releaseScore?.blockers) ? releaseScore.blockers : [];
const implementationBlockers = releaseBlockers.filter((blocker) => {
  const text = `${blocker?.area ?? ""} ${blocker?.blocker ?? blocker}`;
  return !isRealOsSleepBlocker(text) && !isFinalEvidenceMapBlocker(text);
});
const realSleepScore = scoreEntry(releaseScore, "real-os-soak");
const sleepAttempt = realOsSuspendEvidence?.validation?.sleepAttempt ?? {};
const userInitiatedWait = realOsSuspendEvidence?.validation?.userInitiatedSleepWait ?? {};
const powerCapabilities = realOsSuspendDiagnostic?.validation?.powerCapabilities ?? {};
const hostUnsupported =
  realOsSuspendEvidence?.validation?.hostSleepUnsupported === true ||
  sleepAttempt.hostUnsupported === true ||
  /SetSuspendState returned false; GetLastError=50|ERROR_NOT_SUPPORTED/i.test(
    `${sleepAttempt.reason ?? ""} ${realOsSuspendEvidence?.notes ?? ""}`,
  );
const userCycleTimedOut =
  userInitiatedWait.status === "timeout" &&
  /timed out waiting for a real user-initiated Windows sleep\/resume event pair/i.test(
    String(userInitiatedWait.reason ?? ""),
  );
const powerCapabilityCaptured =
  powerCapabilities.queried === true &&
  Array.isArray(powerCapabilities.availableStates) &&
  powerCapabilities.availableStates.length > 0;
const modernStandbyOnly =
  powerCapabilities.modernStandbyAvailable === true &&
  powerCapabilities.s3Available === false &&
  powerCapabilities.availableStates?.includes?.("S0");
const realSleepAlreadyProved =
  realOsSuspendEvidence?.status === "pass" &&
  realOsSuspendEvidence?.validation?.windowsPowerEvents?.suspendEventFound === true &&
  realOsSuspendEvidence?.validation?.windowsPowerEvents?.resumeEventFound === true;

const checks = {
  noUnsafeConsentEnvPresent:
    !process.env.AETHER_AUTH_PROMPT_CONSENT?.trim() && !process.env.AETHER_AUTH_PROMPT_PROVIDER?.trim(),
  noOsSleepEnvPresent:
    process.env.AETHER_ALLOW_OS_SLEEP !== "1" && process.env.AETHER_GOAL_OPERATOR_RUN_SLEEP !== SLEEP_PHRASE,
  releaseScoreExternalGateShape:
    releaseScore?.releaseCandidateReady === false &&
    releaseScore?.score >= 93 &&
    releaseScore?.max === 335 &&
    implementationBlockers.length === 0 &&
    realSleepScore?.points >= 10,
  finalAuditExternalGateShape:
    (finalAudit?.ok === true &&
      finalAudit?.status === "blocked-by-external-gates" &&
      finalAudit?.implementationFixableCount === 0 &&
      finalAudit?.externalBlockedCount >= 1) ||
    finalAuditBootstrapBlockedByThisVerifier(finalAudit),
  completionMatrixExternalGateShape:
    (completionMatrix?.ok === true &&
      completionMatrix?.status === "blocked-by-external-gates" &&
      completionMatrix?.implementationFixableCount === 0) ||
    completionMatrixBootstrapBlockedByFinalEvidence(completionMatrix) ||
    completionMatrixBlockedOnlyByManualSleepCycle(completionMatrix),
  externalReadinessReferencesSleepGate:
    externalGateReadiness?.realOsSleepInvoked === false &&
    externalGateReadiness?.remainingExternalGates?.some?.((entry) => entry?.id === "real-os-sleep-resume") === true,
  operatorFinishReadinessOnly:
    (operatorFinish?.ok === true || operatorFinish?.status === "failed") &&
    operatorFinish?.realOsSleepInvokedByThisRun === false &&
    operatorFinish?.runbook?.sleepResume?.command === OPERATOR_FINISH_COMMAND &&
    operatorFinish?.runbook?.sleepResume?.env?.AETHER_GOAL_OPERATOR_RUN_SLEEP === SLEEP_PHRASE,
  progressArtifactResumeReady:
    ["ready-for-external-operator-gates", "failed"].includes(operatorProgress?.status) &&
    operatorProgress?.requiresUserAction === true &&
    operatorProgress?.noRawTerminalOutputPersisted === true &&
    operatorProgress?.realOsSleepInvokedByThisRun === false &&
    typeof operatorProgress?.lastHeartbeatAt === "string" &&
    typeof operatorProgress?.nextAction === "string" &&
    operatorProgress.nextAction.includes("real sleep operator gate"),
  hostBlockerClassified: realSleepAlreadyProved || hostUnsupported || userCycleTimedOut || modernStandbyOnly,
  powerCapabilitiesCaptured: powerCapabilityCaptured,
  nativePreflightReady: nativePreflight?.status === "ready-for-real-sleep" && everyTrue(nativePreflight?.checks),
  nativePostcheckPreflightReady:
    nativePostcheckPreflight?.status === "ready-for-native-postcheck" && everyTrue(nativePostcheckPreflight?.checks),
  postcheckWriteSmokeNoRealSleepClaim:
    nativePostcheckWriteSmoke?.status === "pass" &&
    nativePostcheckWriteSmoke?.noRealSleepClaim === true &&
    nativePostcheckWriteSmoke?.checks?.noRealSleepClaim === true,
  evidenceDoesNotFakePass:
    realSleepAlreadyProved ||
    (realOsSuspendEvidence?.status !== "pass" &&
      realOsSuspendEvidence?.validation?.windowsPowerEvents?.suspendEventFound !== true),
  userCycleScriptPresent: packageJson.includes(
    '"verify:production:suspend:native-user-cycle": "node scripts/verify-real-os-suspend-evidence.mjs --native-primary --launch-native-primary --user-sleep-cycle"',
  ),
  verifierWaitsForManualSleep:
    realOsSuspendVerifier.includes("--user-sleep-cycle") &&
    realOsSuspendVerifier.includes("Put Windows to sleep manually now") &&
    realOsSuspendVerifier.includes("USER_INITIATED_SLEEP_CYCLE") &&
    realOsSuspendVerifier.includes("invokeWindowsSleep") &&
    realOsSuspendVerifier.includes("runUserInitiatedSleepCycle"),
  runbookClosesLoop:
    packageJson.includes('"verify:goal:operator-finish"') &&
    packageJson.includes('"verify:goal:finalize"') &&
    packageJson.includes('"verify:goal:safe"'),
  rightRailManualSleepActionClosesLoop:
    rightRailGoalTrackSource.includes(USER_CYCLE_COMMAND) &&
    rightRailGoalTrackSource.includes(
      'const followUpCommands = ["pnpm verify:goal:operator-finish", "pnpm verify:goal:finalize", "pnpm verify:goal:safe"]',
    ) &&
    rightRailGoalTrackTestSource.includes(
      'followUpCommands: ["pnpm verify:goal:operator-finish", "pnpm verify:goal:finalize", "pnpm verify:goal:safe"]',
    ) &&
    rightRailGoalTrackTestSource.includes("# manually sleep and wake Windows while the verifier waits"),
  releasePlaybookClosesLoop:
    releaseBuildPlaybook.includes("Real Windows Sleep/Resume Gate") &&
    releaseBuildPlaybook.includes(USER_CYCLE_COMMAND) &&
    releaseBuildPlaybook.includes(OPERATOR_FINISH_COMMAND) &&
    releaseBuildPlaybook.includes(FINALIZE_COMMAND) &&
    releaseBuildPlaybook.includes(SAFE_COMMAND),
};

const failedChecks = Object.entries(checks)
  .filter(([, ok]) => ok !== true)
  .map(([id]) => id);
const readyForManualSleepCycle = failedChecks.length === 0 && !realSleepAlreadyProved;
const ok = failedChecks.length === 0;
const status = realSleepAlreadyProved
  ? "real-os-sleep-resume-complete"
  : readyForManualSleepCycle
    ? "ready-for-manual-sleep-cycle"
    : "failed";

const report = {
  version: 1,
  generatedAt: new Date().toISOString(),
  localDate: currentLocalDate(),
  timeZone: LOCAL_TIME_ZONE,
  ok,
  status,
  realOsSleepInvoked: false,
  realOsSleepAlreadyProved: realSleepAlreadyProved,
  hostClassification: {
    hostUnsupported,
    modernStandbyOnly,
    userCycleTimedOut,
    availableStates: powerCapabilities.availableStates ?? [],
    sleepAttemptStage: sleepAttempt.stage ?? null,
    sleepAttemptReason: sleepAttempt.reason ?? null,
    powerRequestsQueried: powerCapabilities.requests?.queried ?? null,
    powerRequestsError: powerCapabilities.requests?.error ?? null,
  },
  checks,
  failedChecks,
  runbook: {
    readiness: [OPERATOR_FINISH_COMMAND, "pnpm verify:goal:external-gates", "pnpm verify:goal:sleep-handoff"],
    manualSleepCycle: {
      command: USER_CYCLE_COMMAND,
      requires:
        "Start the verifier, manually put Windows to sleep from Start menu/lid/power button, wake it, then let post-resume probes finish.",
      safety: "Does not set AETHER_ALLOW_OS_SLEEP and does not call SetSuspendState.",
      progressArtifact: ".codex-auto/quality/goal-operator-progress.json",
      evidenceArtifact: ".codex-auto/production-smoke/real-os-suspend-resume.json",
    },
    operatorFinish: {
      command: OPERATOR_FINISH_COMMAND,
      env: {
        AETHER_GOAL_OPERATOR_RUN_SLEEP: SLEEP_PHRASE,
      },
      safety: "Runs the same manual user-cycle path with heartbeat snapshots; it still does not invoke the OS sleep API.",
    },
    afterManualGate: AFTER_MANUAL_GATE_COMMANDS,
  },
  nextRequiredAction: realSleepAlreadyProved
    ? `Close the evidence loop with ${AFTER_MANUAL_GATE_COMMANDS.join(", ")}.`
    : "Run pnpm verify:goal:operator-finish, then run the manual sleep cycle command while physically sleeping and waking Windows.",
  artifacts: Object.fromEntries(Object.entries(artifacts).map(([key, artifact]) => [key, artifactSummary(paths[key], artifact)])),
};

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ artifact: OUT, ...report }, null, 2));
if (!report.ok) process.exitCode = 1;
