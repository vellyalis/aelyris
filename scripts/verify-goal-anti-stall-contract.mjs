import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const ROOT = resolve(process.cwd());
const OUT = join(ROOT, ".codex-auto", "quality", "goal-anti-stall-contract.json");
const LOCAL_TIME_ZONE = "Asia/Tokyo";

const sourcePaths = {
  verifier: "scripts/verify-goal-anti-stall-contract.mjs",
  finalGoalArtifactLock: "scripts/final-goal-artifact-lock.mjs",
  finalSafe: "scripts/verify-final-goal-safe.mjs",
  nonTokenRefresh: "scripts/verify-goal-non-token-refresh.mjs",
  chunkedOscSafe: "scripts/verify-chunked-osc-live-safe.mjs",
  operatorFinish: "scripts/verify-goal-operator-finish.mjs",
  gitFinalization: "scripts/verify-git-finalization-readiness.mjs",
  gitFinalizationShellDiagnostics: "scripts/verify-git-finalization-shell-diagnostics.ps1",
  goalFinalize: "scripts/verify-goal-finalize-evidence.mjs",
  goalCloseout: "scripts/verify-goal-closeout-snapshot.mjs",
  externalGateReadiness: "scripts/verify-goal-external-gate-readiness.mjs",
  releaseSigningOperatorHandoff: "scripts/verify-release-signing-operator-handoff.mjs",
  realOsSleepOperatorHandoff: "scripts/verify-real-os-sleep-operator-handoff.mjs",
  nativeAiCliChaos: "scripts/verify-native-ai-cli-post-launch-chaos.mjs",
  realOsSuspend: "scripts/verify-real-os-suspend-evidence.mjs",
  score: "scripts/score-release-quality.mjs",
  finalAudit: "scripts/verify-final-goal-audit.mjs",
  packageJson: "package.json",
  vitestConfig: "vitest.config.ts",
};
const progressArtifactPath = ".codex-auto/quality/goal-operator-progress.json";

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

function readJsonSafe(path) {
  const full = join(ROOT, path);
  if (!existsSync(full)) return { exists: false, data: null, parseError: null };
  try {
    return { exists: true, data: JSON.parse(readFileSync(full, "utf8")), parseError: null };
  } catch (error) {
    return { exists: true, data: null, parseError: error instanceof Error ? error.message : String(error) };
  }
}

function mtimeMs(path) {
  const full = join(ROOT, path);
  return existsSync(full) ? statSync(full).mtimeMs : 0;
}

function hasAll(source, needles) {
  return needles.every((needle) => source.includes(needle));
}

function parseDefaultNativeAiChaosWait(source) {
  const match = source.match(/AELYRIS_NATIVE_AI_CHAOS_WAIT_MS\s*\?\?\s*"(\d+)"/);
  return match ? Number.parseInt(match[1], 10) : 0;
}

const finalSafe = readText(sourcePaths.finalSafe);
const finalGoalArtifactLock = readText(sourcePaths.finalGoalArtifactLock);
const nonTokenRefresh = readText(sourcePaths.nonTokenRefresh);
const chunkedOscSafe = readText(sourcePaths.chunkedOscSafe);
const operatorFinish = readText(sourcePaths.operatorFinish);
const gitFinalization = readText(sourcePaths.gitFinalization);
const gitFinalizationShellDiagnostics = readText(sourcePaths.gitFinalizationShellDiagnostics);
const goalFinalize = readText(sourcePaths.goalFinalize);
const goalCloseout = readText(sourcePaths.goalCloseout);
const externalGateReadiness = readText(sourcePaths.externalGateReadiness);
const releaseSigningOperatorHandoff = readText(sourcePaths.releaseSigningOperatorHandoff);
const realOsSleepOperatorHandoff = readText(sourcePaths.realOsSleepOperatorHandoff);
const nativeAiCliChaos = readText(sourcePaths.nativeAiCliChaos);
const realOsSuspend = readText(sourcePaths.realOsSuspend);
const score = readText(sourcePaths.score);
const finalAudit = readText(sourcePaths.finalAudit);
const packageJson = readText(sourcePaths.packageJson);
const vitestConfig = readText(sourcePaths.vitestConfig);
const operatorProgress = readJsonSafe(progressArtifactPath);

const nativeAiChaosDefaultWaitMs = parseDefaultNativeAiChaosWait(nativeAiCliChaos);

const operatorProgressData = operatorProgress.data ?? {};
const operatorProgressStatus = String(operatorProgressData.status ?? "");
const operatorProgressEvent = String(operatorProgressData.event ?? "");
const operatorProgressNextAction = String(operatorProgressData.nextAction ?? "");
const operatorProgressExternalGateKind = String(operatorProgressData.externalGateKind ?? "");
const operatorProgressCurrentLocalDate = operatorProgressData.localDate === currentLocalDate();
const operatorProgressIsRunning = operatorProgressStatus === "running";
const operatorProgressHasHeartbeat =
  typeof operatorProgressData.lastHeartbeatAt === "string" && operatorProgressData.lastHeartbeatAt.length > 0;
const operatorProgressHasNextHeartbeat =
  typeof operatorProgressData.nextHeartbeatAt === "string" && operatorProgressData.nextHeartbeatAt.length > 0;

const requiredSafeFallbackSteps = [
  "authenticated-provider-guard",
  "real-ai-cli-binary-probe",
  "ai-cli-launch-planner",
  "authenticated-preflight-matrix",
  "authenticated-consent-packet",
  "glass-legibility",
  "right-rail-information-density",
  "release-signing-operator-handoff",
  "real-os-sleep-operator-handoff",
  "tauri-runtime-hygiene",
  "production-build",
  "goal-completion-matrix",
  "external-gate-readiness",
  "operator-finish-handoff",
  "git-finalization-readiness",
];

const checks = {
  packageScriptPresent: packageJson.includes(
    '"verify:goal:anti-stall": "node scripts/verify-goal-anti-stall-contract.mjs"',
  ),
  buildAvoidsWindowsSpawnDeadEnds:
    packageJson.includes('"build":') &&
    packageJson.includes("AELYRIS_VITE_NO_ESBUILD_SPAWN=1") &&
    packageJson.includes("NODE_OPTIONS=--require ./scripts/vite-windows-net-use-shim.cjs") &&
    packageJson.includes("vite build --configLoader native"),
  testAvoidsWindowsSpawnDeadEnds:
    packageJson.includes('"test":') &&
    packageJson.includes("AELYRIS_VITE_NO_ESBUILD_SPAWN=1") &&
    packageJson.includes("vitest run --configLoader native") &&
    packageJson.includes('"test:watch":') &&
    packageJson.includes("vitest --configLoader native") &&
    vitestConfig.includes("aelyris:vitest-typescript-transpile-no-esbuild-spawn") &&
    vitestConfig.includes("esbuild: noEsbuildSpawn ? false : undefined") &&
    vitestConfig.includes('pool: noEsbuildSpawn ? "threads" : "forks"') &&
    vitestConfig.includes("isolate: true"),
  safeStepCacheBounded: finalSafe.includes("SAFE_STEP_CACHE_MAX_AGE_MS") && finalSafe.includes("24 * 60 * 60 * 1000"),
  safeFallbackCoversCriticalSteps: requiredSafeFallbackSteps.every((step) => finalSafe.includes(`"${step}"`)),
  safeReplayExplainsSpawnBlocks: hasAll(finalSafe, [
    "sandboxArtifactReplay",
    "replayReason",
    "child process execution was blocked by the current sandbox",
    "spawnSync",
    "EPERM",
  ]),
  safeFailsOnRealFailures: hasAll(finalSafe, [
    "failedSteps",
    "noFailedSafeSteps",
    "proofArtifactsPassed",
    "implementationFixableCountZero",
  ]),
  operatorFinishIsNoSurpriseByDefault: hasAll(operatorFinish, [
    "tokenSpendingPromptRequested: tokenPromptRequested",
    "realOsSleepUserCycleRequested: sleepUserCycleRequested",
    "tokenSpendingPromptExecutedByThisRun: false",
    "realOsSleepInvokedByThisRun: false",
  ]),
  operatorFinishRequiresExactHumanOptIn: hasAll(operatorFinish, [
    "const tokenPromptRequested = false",
    "tokenEntryPoint: \"pnpm verify:goal:operator:token-smoke\"",
    "I_WILL_MANUALLY_SLEEP_WINDOWS_WHILE_VERIFIER_WAITS",
    "NO_TOKEN_SCRUBBED_ENV_KEYS",
    "delete env.AELYRIS_ALLOW_OS_SLEEP",
    "delete env.AELYRIS_GOAL_OPERATOR_RUN_SLEEP",
  ]),
  operatorFinishHasReplayFallback: hasAll(operatorFinish, [
    "spawnBlocked",
    "artifactFallback",
    "same-day safe readiness artifact is already green",
  ]),
  operatorFinishRunbookClosesLoop: hasAll(operatorFinish, [
    "pnpm verify:goal:operator-finish",
    "pnpm verify:goal:finalize",
    "pnpm verify:goal:safe",
    "pnpm verify:goal:closeout",
    "goal-finalize",
  ]),
  gitFinalizationReadinessIsSafeHandoff:
    packageJson.includes('"verify:goal:git-finalization": "node scripts/verify-git-finalization-readiness.mjs"') &&
    packageJson.includes(
      '"verify:goal:git-finalization:shell": "powershell -NoProfile -ExecutionPolicy Bypass -File scripts/verify-git-finalization-shell-diagnostics.ps1"',
    ) &&
    finalSafe.includes("gitFinalizationReadinessVerdict") &&
    finalSafe.includes("gitFinalizationShellDiagnosticsVerdict") &&
    finalSafe.includes("gitFinalizationReadinessPassed") &&
    finalSafe.includes("gitFinalizationShellDiagnosticsPassed") &&
    hasAll(gitFinalization, [
      "blocked-by-git-metadata-permissions",
      "ready-for-commit-and-merge",
      "gitFinalizationReady",
      "git add -A --dry-run",
      "does not stage, commit, merge, push, mutate ACLs",
      "branchFromHead",
      "localBranchExists",
      "probeCreateAndDelete",
    ]) &&
    hasAll(gitFinalizationShellDiagnostics, [
      "git-finalization-shell-diagnostics.json",
      "whoami /user",
      "whoami /groups",
      "icacls .git",
      "git add -A --dry-run",
      "icaclsDenyLines",
      "does not stage, commit, merge, push, mutate ACLs",
    ]),
  goalFinalizeSkipsGitUnlessRequested: hasAll(goalFinalize, [
    "INCLUDE_GIT_FINALIZATION",
    'process.env.AELYRIS_GOAL_FINALIZE_INCLUDE_GIT === "1"',
    "...(INCLUDE_GIT_FINALIZATION",
    "includeGitFinalization",
  ]),
  operatorFinishStreamsLongExternalSteps: hasAll(operatorFinish, [
    "runNodeStepStreaming",
    "AELYRIS_GOAL_OPERATOR_HEARTBEAT_MS",
    "[goal-operator] start",
    "[goal-operator] waiting",
    "progressHeartbeatMs",
    "streamed: true",
  ]),
  operatorFinishPersistsHeartbeatSnapshot: hasAll(operatorFinish, [
    "goal-operator-progress.json",
    "writeOperatorProgress",
    "lastHeartbeatAt",
    "nextHeartbeatAt",
    "noRawTerminalOutputPersisted",
    "manual-windows-sleep-resume",
    "readiness-handoff",
  ]),
  operatorProgressArtifactIsResumeReady:
    operatorProgress.exists === true &&
    operatorProgress.parseError == null &&
    operatorProgressCurrentLocalDate &&
    operatorProgressHasHeartbeat &&
    (operatorProgressIsRunning ? operatorProgressHasNextHeartbeat : true) &&
    typeof operatorProgressData.activeStep !== "undefined" &&
    typeof operatorProgressData.requiresUserAction === "boolean" &&
    typeof operatorProgressData.tokenSpendingPromptRequested === "boolean" &&
    operatorProgressData.realOsSleepInvokedByThisRun === false &&
    operatorProgressData.noRawTerminalOutputPersisted === true &&
    operatorProgressNextAction.length > 0 &&
    [
      "readiness-handoff",
      "post-run-summary",
      "start",
      "heartbeat",
      "finish",
    ].includes(operatorProgressEvent) &&
    [
      "none",
      "external-gate-handoff",
      "token-spending-ai-cli-prompt",
      "manual-windows-sleep-resume",
      "post-operator-finalize",
      "complete",
    ].includes(operatorProgressExternalGateKind),
  nonTokenRefreshHasProgressAndTimeouts: hasAll(nonTokenRefresh, [
    "DEFAULT_STEP_TIMEOUT_MS",
    "[goal-refresh] start",
    "[goal-refresh] ${accepted.ok",
    "[goal-refresh] ${result.ok",
    "timedOut",
    "timeoutMs",
  ]),
  nonTokenRefreshNeverSpendsTokensOrSleeps: hasAll(nonTokenRefresh, [
    "tokenSpendingPromptExecutedByThisRun: false",
    "realOsSleepInvoked: false",
    "scrubNoTokenEnvironment",
    "assertNoTokenStepGraph(stepDescriptors)",
    'AELYRIS_NON_TOKEN_GOAL_REFRESH: "1"',
  ]),
  nonTokenRefreshCoversCurrentContracts: hasAll(nonTokenRefresh, [
    "chunked-osc-live",
    "glass-legibility",
    "right-rail-information-density",
      "real-os-sleep-operator-handoff",
      "release-signing-operator-handoff",
      "external-gate-readiness",
    "goal-documentation-freshness",
    "goal-completion-matrix",
    "right-rail-goal-track",
  ]),
  goalFinalizeClosesSelfReferenceLoop:
    packageJson.includes('"verify:goal:finalize": "node scripts/verify-goal-finalize-evidence.mjs"') &&
    hasAll(goalFinalize, [
      "finalizeSequence",
      "quality-score-pre-audit",
      "final-goal-audit-1",
      "quality-score-1",
      "goal-documentation-freshness",
      "final-goal-audit-2",
      "quality-score-2",
      "goal-completion-matrix",
      "git-finalization-shell-diagnostics",
      "git-finalization-readiness",
      "goal-safe",
      "AELYRIS_GOAL_FINALIZE_SKIP_OPERATOR",
      // Retired internal progress docs are intentionally not published; the
      // finalize evidence script no longer needs to reference a removed doc, so
      // that reference is not required here.
      "scripts/verify-goal-external-gate-readiness.mjs",
      "delete env.AELYRIS_AUTH_PROMPT_CONSENT",
      "delete env.AELYRIS_GOAL_OPERATOR_RUN_SLEEP",
      "tokenSpendingPromptExecuted: false",
      "realOsSleepInvoked: false",
      "nextRequiredAction",
      "externalGateRunbook",
      "pnpm verify:production:suspend:native-user-cycle",
      "afterExternalGate",
      "sourceCutoffMsForStep",
      "goal-documentation-freshness",
      "real-os-sleep-operator-handoff",
      "release-signing-operator-handoff",
    ]),
  finalAuditScoreUseSharedArtifactLock:
    hasAll(finalGoalArtifactLock, [
      "acquireFinalGoalArtifactLock",
      "final-goal-evidence.lock",
      "AELYRIS_FINAL_GOAL_LOCK_TIMEOUT_MS",
      "AELYRIS_FINAL_GOAL_LOCK_STALE_MS",
    ]) &&
    hasAll(score, [
      "acquireFinalGoalArtifactLock",
      "score-release-quality",
      "process.on(\"exit\", releaseFinalGoalArtifactLock)",
    ]) &&
    hasAll(finalAudit, [
      "acquireFinalGoalArtifactLock",
      "verify-final-goal-audit",
      "process.on(\"exit\", releaseFinalGoalArtifactLock)",
    ]),
  nativeAiCliChaosWaitIsLongEnough: nativeAiChaosDefaultWaitMs >= 120_000,
  nativeAiCliChaosCleansUpAndRestarts: hasAll(nativeAiCliChaos, [
    "same-id close + respawn recovery",
    "prompt readiness before writes",
    "zero residue",
    "forced close",
  ]),
  externalGateReadinessNamesOnlyExternalGates: hasAll(externalGateReadiness, [
    "ready-for-external-operator-gates",
    "tokenSpendingPromptExecuted",
    "realOsSleepInvoked",
    "release-signing-updater",
    "explicit consent",
    "user-initiated Windows sleep",
    "beforeExternalGate",
    "afterEitherGate",
    "finalizeClosure",
    "goal-operator-progress.json",
    "pnpm verify:goal:finalize",
    "pnpm verify:goal:closeout",
    "pnpm verify:goal:sleep-handoff",
  ]),
  goalCloseoutSnapshotClosesArtifactDrift:
    packageJson.includes('"verify:goal:closeout": "node scripts/verify-goal-closeout-snapshot.mjs"') &&
    hasAll(goalCloseout, [
      "goal-closeout-snapshot.json",
      "noArtifactOlderThanCloseoutSources",
      "scoreIsCurrentExternalGateShape",
      "scoreBlockersAreOnlyKnownExternalOperatorOrUpstream",
      "safeRequiredProofsGreen",
      "finalizeAgreesWithSafe",
      "externalGateReadinessIsSafeHandoff",
      "Only external/operator/upstream gates remain",
      "pnpm verify:goal:closeout",
    ]),
  releaseSigningOperatorHandoffPreventsRepeatStall:
    packageJson.includes(
      '"verify:goal:release-signing-handoff": "node scripts/verify-release-signing-operator-handoff.mjs"',
    ) &&
    hasAll(releaseSigningOperatorHandoff, [
      "ready-for-release-signing-operator",
      "noSecretMaterialPersisted",
      "TAURI_SIGNING_PRIVATE_KEY",
      "pnpm tauri:build:dist",
      "pnpm verify:release:doctor",
      "pnpm verify:quality-score",
      "pnpm verify:goal:finalize",
      "pnpm verify:goal:safe",
      "pnpm verify:goal:closeout",
    ]),
  realOsSleepOperatorHandoffPreventsRepeatStall:
    packageJson.includes('"verify:goal:sleep-handoff": "node scripts/verify-real-os-sleep-operator-handoff.mjs"') &&
    hasAll(realOsSleepOperatorHandoff, [
      "ready-for-manual-sleep-cycle",
      "hostBlockerClassified",
      "evidenceDoesNotFakePass",
      "Does not set AELYRIS_ALLOW_OS_SLEEP and does not call SetSuspendState.",
      "pnpm verify:production:suspend:native-user-cycle",
      "pnpm verify:goal:operator-finish",
      "pnpm verify:goal:finalize",
      "pnpm verify:goal:safe",
      "pnpm verify:goal:closeout",
    ]),
  realSleepVerifierWaitsForUserCycle: hasAll(realOsSuspend, [
    "--user-sleep-cycle",
    "manually",
    "sleep",
    "wake",
  ]),
  scoreRequiresAntiStallContract: hasAll(score, [
    "goalAntiStallContractPath",
    "goalAntiStallContractFresh",
    "pass-current-anti-stall-contract",
  ]),
  finalAuditRequiresAntiStallContract: hasAll(finalAudit, [
    "goalAntiStallContractReady",
    "antiStallContract",
    "pass-current-anti-stall-contract",
  ]),
  chunkedOscSafeWrapperPreventsSilentStack:
    packageJson.includes('"verify:terminal:chunked-osc-live:safe": "node scripts/verify-chunked-osc-live-safe.mjs"') &&
    hasAll(chunkedOscSafe, [
      "chunked-osc-live.environment-blocked.json",
      "preservesPrimaryArtifact",
      "stillProvesLastLiveRun",
      "connect ECONNREFUSED",
      "connectOverCDP",
    ]),
};

const failedChecks = Object.entries(checks)
  .filter(([, ok]) => ok !== true)
  .map(([id]) => id);

const sourceFresh = Object.values(sourcePaths).every((path) => mtimeMs(path) > 0);

const report = {
  version: 1,
  generatedAt: new Date().toISOString(),
  localDate: currentLocalDate(),
  timeZone: LOCAL_TIME_ZONE,
  ok: failedChecks.length === 0 && sourceFresh,
  status: failedChecks.length === 0 && sourceFresh ? "pass-current-anti-stall-contract" : "failed",
  sourceFresh,
  nativeAiChaosDefaultWaitMs,
  requiredSafeFallbackSteps,
  progressArtifact: {
    path: progressArtifactPath,
    exists: operatorProgress.exists,
    parseError: operatorProgress.parseError,
    status: operatorProgressData.status ?? null,
    event: operatorProgressData.event ?? null,
    externalGateKind: operatorProgressData.externalGateKind ?? null,
    requiresUserAction: operatorProgressData.requiresUserAction ?? null,
    lastHeartbeatAt: operatorProgressData.lastHeartbeatAt ?? null,
    nextHeartbeatAt: operatorProgressData.nextHeartbeatAt ?? null,
    noRawTerminalOutputPersisted: operatorProgressData.noRawTerminalOutputPersisted ?? null,
    nextAction: operatorProgressData.nextAction ?? null,
  },
  checks,
  failedChecks,
  contract:
  "Goal work must keep bounded step timeouts, visible progress markers, persisted operator progress snapshots, EPERM artifact replay, no-token/no-sleep defaults, exact human opt-in gates, Windows spawn-safe build/test defaults, optional git handoff, a closed operator refresh runbook, and a closeout snapshot that catches artifact drift.",
};

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ artifact: OUT, ...report }, null, 2));
if (!report.ok) process.exitCode = 1;
