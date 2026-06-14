import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { acquireFinalGoalArtifactLock } from "./final-goal-artifact-lock.mjs";

const ROOT = resolve(process.cwd());
const OUT = join(ROOT, ".codex-auto", "quality", "final-goal-audit.json");
const LOCAL_TIME_ZONE = "Asia/Tokyo";
const releaseFinalGoalArtifactLock = acquireFinalGoalArtifactLock("verify-final-goal-audit");
process.on("exit", releaseFinalGoalArtifactLock);

function readJson(path) {
  const full = join(ROOT, path);
  if (!existsSync(full)) return null;
  return JSON.parse(readFileSync(full, "utf8"));
}

function tryReadJson(path) {
  try {
    return { data: readJson(path), error: null };
  } catch (error) {
    return { data: null, error: error instanceof Error ? error.message : String(error) };
  }
}

function readText(path) {
  const full = join(ROOT, path);
  if (!existsSync(full)) return null;
  return readFileSync(full, "utf8");
}

function mtime(path) {
  const full = join(ROOT, path);
  return existsSync(full) ? statSync(full).mtimeMs : 0;
}

function fileSize(path) {
  const full = join(ROOT, path);
  return existsSync(full) ? statSync(full).size : 0;
}

function scoreById(score, id) {
  return Array.isArray(score?.scores) ? score.scores.find((item) => item.id === id) : null;
}

function scorePass(score, id) {
  const item = scoreById(score, id);
  return item && item.points === item.max && item.max > 0;
}

function gradeForPercent(percent) {
  return percent >= 97 ? "S" : percent >= 92 ? "A" : percent >= 85 ? "B" : percent >= 75 ? "C" : "D";
}

function check(id, label, passed, detail, evidence) {
  return {
    id,
    label,
    status: passed ? "proved" : "missing",
    detail,
    evidence,
  };
}

function classifyEvidencePath(path) {
  if (path.endsWith(".json")) return "json-artifact";
  if (path.includes("__tests__") || /\.test\.[cm]?[jt]sx?$/.test(path)) return "test-file";
  if (path.startsWith("docs/")) return "documentation";
  if (path.startsWith("scripts/")) return "verifier-source";
  return "source-file";
}

function hasOnlyAuthenticatedPromptBlocker(blockers) {
  if (!Array.isArray(blockers) || blockers.length !== 1) return false;
  return /authenticated[-\s]?ai[-\s]?cli[-\s]?prompt|token-spend consent/i.test(
    String(blockers[0]?.blocker ?? blockers[0] ?? ""),
  );
}

function isAuthenticatedPromptBlocker(blocker) {
  return /authenticated[-\s]?ai[-\s]?cli[-\s]?prompt|token-spend consent/i.test(
    String(blocker?.blocker ?? blocker ?? ""),
  );
}

function isHostSleepUnsupportedBlocker(blocker) {
  return /real OS sleep\/resume could not complete on this host|real OS sleep\/resume could not complete on this host\/user cycle|user-initiated Windows sleep\/resume event pair was not observed|timed out waiting for a real user-initiated Windows sleep\/resume event pair|SetSuspendState returned false|GetLastError=50|host sleep unsupported|ERROR_NOT_SUPPORTED/i.test(
    String(blocker?.blocker ?? blocker ?? ""),
  );
}

function isLiveAiChaosExternalBlocker(blocker) {
  return /live-ai-cli-post-launch-chaos|live AI CLI post-launch chaos|live AI CLI chaos/i.test(
    `${blocker?.area ?? ""} ${blocker?.blocker ?? blocker ?? ""}`,
  );
}

function isReleaseSigningOperatorBlocker(blocker) {
  return /release-doctor.*signing\/updater|signing\/updater warnings|regenerate signatures\/latest\.json|updater signatures|latest\.json/i.test(
    `${blocker?.area ?? ""} ${blocker?.blocker ?? blocker ?? ""}`,
  );
}

function summarizeHistoricalIncidentClosure(closure) {
  if (!closure || typeof closure !== "object") return null;
  const incidents = Array.isArray(closure.historicalIncidents) ? closure.historicalIncidents : [];
  const incidentCountsByKind = incidents.reduce((acc, incident) => {
    const kind = String(incident?.kind ?? "unknown");
    acc[kind] = (acc[kind] ?? 0) + 1;
    return acc;
  }, {});
  const latest = closure.latestIncident ?? incidents.at(-1) ?? null;
  return {
    closed: closure.closed === true,
    historicalIncidentCount: incidents.length,
    incidentCountsByKind,
    latestIncident: latest
      ? {
          run: latest.run ?? "unknown",
          kind: latest.kind ?? "unknown",
          mtimeMs: latest.mtimeMs ?? 0,
          count: latest.count ?? 0,
        }
      : null,
    cleanSuccessorRunCount: closure.cleanSuccessorRunCount ?? 0,
    cleanSuccessorRuns: Array.isArray(closure.cleanSuccessorRuns)
      ? closure.cleanSuccessorRuns.map((run) => ({
          id: run?.id ?? "unknown",
          mtimeMs: run?.mtimeMs ?? 0,
        }))
      : [],
  };
}

const releaseScorePath = ".codex-auto/quality/release-quality-score.json";
const nativeBoundaryPath = ".codex-auto/quality/native-boundary-contract.json";
const commandCenterPath = ".codex-auto/production-smoke/command-center-scenario.json";
const launchPlannerPath = ".codex-auto/production-smoke/ai-cli-launch-planner.json";
const commandRecoveryPath = ".codex-auto/production-smoke/command-recovery-contract.json";
const chunkedOscLivePath = ".codex-auto/production-smoke/chunked-osc-live.json";
const nativeHwndPasteLivePath = ".codex-auto/production-smoke/native-hwnd-paste-live.json";
const rightRailScalePath = ".codex-auto/performance/right-rail-scale-contract.json";
const rightRailInformationDensityPath = ".codex-auto/quality/right-rail-information-density-contract.json";
const rightRailStaleUrlTruthPath = ".codex-auto/production-smoke/right-rail-stale-url-truth.json";
const liveAiCliPostLaunchChaosPath = ".codex-auto/chaos-recovery/p2-07-live-tauri-pty-ai-cli-chaos.json";
const nativeAiCliPostLaunchChaosPath = ".codex-auto/chaos-recovery/native-ai-cli-post-launch-chaos.json";
const authenticatedPromptPath = ".codex-auto/production-smoke/authenticated-ai-cli-prompt-smoke.json";
const authenticatedPromptMatrixPath = ".codex-auto/production-smoke/authenticated-ai-cli-preflight-matrix.json";
const authenticatedPromptConsentPacketPath = ".codex-auto/production-smoke/authenticated-ai-cli-consent-packet.json";
const authenticatedPromptProviderGuardPath =
  ".codex-auto/production-smoke/authenticated-ai-cli-provider-required-smoke.json";
const externalGateReadinessPath = ".codex-auto/quality/goal-external-gate-readiness.json";
const releaseSigningOperatorHandoffPath = ".codex-auto/quality/release-signing-operator-handoff.json";
const tauriRuntimeHygienePath = ".codex-auto/quality/tauri-runtime-hygiene.json";
const productionBundleBudgetPath = ".codex-auto/quality/production-bundle-budget.json";
const supplyChainAuditPath = ".codex-auto/release-doctor/supply-chain-audit.json";
const glassLegibilityContractPath = ".codex-auto/quality/glass-legibility-contract.json";
const goalAntiStallContractPath = ".codex-auto/quality/goal-anti-stall-contract.json";
const realSuspendPath = ".codex-auto/production-smoke/real-os-suspend-resume.json";
const realSuspendDiagnosticPath = ".codex-auto/production-smoke/real-os-suspend-resume.diagnostic.json";
const realSuspendNativePreflightPath = ".codex-auto/production-smoke/real-os-suspend-native-preflight.json";
const realSuspendNativePostcheckPreflightPath =
  ".codex-auto/production-smoke/real-os-suspend-native-postcheck-preflight.json";
const realSuspendNativePostcheckWriteSmokePath =
  ".codex-auto/production-smoke/postcheck-write-smoke/real-os-suspend-native-postcheck-write-smoke.json";
const currentStateDocPaths = [
  "docs/AETHER_COMMAND_CENTER_EDGE_PLAN.md",
  "docs/AETHER_COMMAND_CENTER_EDGE_PROGRESS.md",
  "docs/RUST_CORE_WEZTERM_TMUX_WIZARD_GOALS.md",
  "docs/TERMINAL_NATIVE_CORE_AND_EDITOR_DESCOPE_PLAN_2026-05-17.md",
  "docs/NATIVE_RUST_WEZTERM_PLUS_MIGRATION_PLAN.md",
];
const releaseScoreSourcePaths = [
  "package.json",
  "vite.config.ts",
  "vitest.config.ts",
  "scripts/score-release-quality.mjs",
  "scripts/verify-final-goal-audit.mjs",
  "scripts/verify-final-goal-safe.mjs",
  "scripts/verify-chunked-osc-live.mjs",
  "scripts/verify-native-hwnd-paste-live.mjs",
  "scripts/verify-goal-documentation-freshness.mjs",
  "scripts/verify-authenticated-ai-cli-consent-packet.mjs",
  "scripts/verify-goal-external-gate-readiness.mjs",
  "scripts/verify-native-boundary-contract.mjs",
  "scripts/verify-native-ai-cli-post-launch-chaos.mjs",
  "scripts/verify-native-terminal-input-host.mjs",
  "scripts/verify-production-bundle-budget.mjs",
  "scripts/verify-supply-chain.mjs",
  "scripts/verify-right-rail-stale-url-truth.mjs",
  "scripts/verify-glass-legibility-contract.mjs",
  "scripts/verify-goal-anti-stall-contract.mjs",
  ...currentStateDocPaths,
  "src/App.tsx",
  "src/shared/lib/rightRailAdvisor.ts",
  "src/shared/lib/rightRailGoalTrack.ts",
  "src/shared/lib/releaseQuality.ts",
  "src/shared/lib/authenticatedPromptConsent.ts",
  "src/shared/lib/aiCliLaunchPlanner.ts",
  "src/shared/lib/commandRecovery.ts",
  "src/shared/lib/terminalEvidence.ts",
  "src/shared/lib/agentFileChanges.ts",
  "src/shared/lib/agentTelemetryPersistence.ts",
  "src/shared/store/appStore.ts",
  "src/shared/hooks/useAgentManager.ts",
  "src/shared/lib/recentCommands.ts",
  "src/features/helm/HelmPanel.tsx",
  "src/features/header/ProjectHeaderBar.tsx",
  "src/features/terminal/NativeTerminalArea.tsx",
  "src/features/terminal/TerminalCanvas.tsx",
  "src/features/terminal/keymap.ts",
  "src/features/terminal/hooks/useCanvasIME.ts",
  "src/features/terminal/hooks/useTerminalSelection.ts",
  "src/features/terminal/hooks/useAICliDetection.ts",
  "src/features/terminal/pane-tree/PaneTreeContainer.tsx",
  "src/features/terminal/pane-tree/usePaneTree.ts",
  "src/features/terminal/pane-tree/persistence.ts",
  "src/shared/hooks/useKeyboardShortcuts.ts",
  "src/shared/hooks/useEditableTargetGuard.ts",
  "src/shared/hooks/useLivePanes.ts",
  "src/shared/hooks/useGhostLayers.ts",
  "src/shared/hooks/usePromptMarks.ts",
  "src/__tests__/setup.ts",
  "src/__tests__/agentFileChanges.test.ts",
  "src/__tests__/agentTelemetryPersistence.test.ts",
  "src/__tests__/themePalette.test.ts",
  "src/__tests__/useThemeApplier.test.tsx",
  "src/__tests__/useAgentManagerTelemetry.test.tsx",
  "src/__tests__/useImageMetrics.test.tsx",
  "src/shared/lib/bootMetrics.ts",
  "src/shared/hooks/useTheme.ts",
  "src/shared/themes/moods.ts",
  "src/features/settings/Settings.tsx",
  "src/styles/global.css",
  "src-tauri/Cargo.toml",
  "src-tauri/src/lib.rs",
  "src-tauri/src/pty_sidecar.rs",
  "src-tauri/src/agent/parser.rs",
  "src-tauri/src/term/native.rs",
  "src-tauri/src/term/native_input.rs",
  "src-tauri/src/ipc/commands.rs",
  "src-tauri/src/ipc/interactive_commands.rs",
  "src-tauri/src/config/settings.rs",
];
const releaseScoreArtifactPaths = [
  nativeBoundaryPath,
  commandCenterPath,
  launchPlannerPath,
  authenticatedPromptPath,
  authenticatedPromptMatrixPath,
  authenticatedPromptConsentPacketPath,
  authenticatedPromptProviderGuardPath,
  externalGateReadinessPath,
  releaseSigningOperatorHandoffPath,
  commandRecoveryPath,
  chunkedOscLivePath,
  nativeHwndPasteLivePath,
  rightRailScalePath,
  rightRailInformationDensityPath,
  rightRailStaleUrlTruthPath,
  liveAiCliPostLaunchChaosPath,
  nativeAiCliPostLaunchChaosPath,
  tauriRuntimeHygienePath,
  productionBundleBudgetPath,
  supplyChainAuditPath,
  glassLegibilityContractPath,
  goalAntiStallContractPath,
  realSuspendPath,
  realSuspendDiagnosticPath,
  realSuspendNativePreflightPath,
  realSuspendNativePostcheckPreflightPath,
  realSuspendNativePostcheckWriteSmokePath,
];
const releaseScoreFreshnessIgnoredArtifactPaths = new Set([
  // This artifact is an operator-runbook/readiness view generated from the
  // score/audit/matrix chain. Treating it as an upstream score dependency
  // makes concurrent verifier runs incorrectly mark the score stale.
  externalGateReadinessPath,
]);

const releaseScore = readJson(releaseScorePath);
const nativeBoundary = readJson(nativeBoundaryPath);
const commandCenter = readJson(commandCenterPath);
const launchPlanner = readJson(launchPlannerPath);
const commandRecovery = readJson(commandRecoveryPath);
const chunkedOscLive = readJson(chunkedOscLivePath);
const nativeHwndPasteLive = readJson(nativeHwndPasteLivePath);
const rightRailScale = readJson(rightRailScalePath);
const rightRailInformationDensity = readJson(rightRailInformationDensityPath);
const rightRailStaleUrlTruth = readJson(rightRailStaleUrlTruthPath);
const liveAiCliPostLaunchChaos = readJson(liveAiCliPostLaunchChaosPath);
const nativeAiCliPostLaunchChaos = readJson(nativeAiCliPostLaunchChaosPath);
const authenticatedPrompt = readJson(authenticatedPromptPath);
const authenticatedPromptMatrix = readJson(authenticatedPromptMatrixPath);
const authenticatedPromptConsentPacket = readJson(authenticatedPromptConsentPacketPath);
const authenticatedPromptProviderGuard = readJson(authenticatedPromptProviderGuardPath);
const externalGateReadiness = readJson(externalGateReadinessPath);
const releaseSigningOperatorHandoff = readJson(releaseSigningOperatorHandoffPath);
const tauriRuntimeHygiene = readJson(tauriRuntimeHygienePath);
const productionBundleBudget = readJson(productionBundleBudgetPath);
const supplyChainAudit = readJson(supplyChainAuditPath);
const glassLegibilityContract = readJson(glassLegibilityContractPath);
const goalAntiStallContract = readJson(goalAntiStallContractPath);
const realSuspend = readJson(realSuspendPath);
const realSuspendDiagnostic = readJson(realSuspendDiagnosticPath);
const realSuspendNativePreflight = readJson(realSuspendNativePreflightPath);
const realSuspendNativePostcheckPreflight = readJson(realSuspendNativePostcheckPreflightPath);
const realSuspendNativePostcheckWriteSmoke = readJson(realSuspendNativePostcheckWriteSmokePath);

function currentLocalDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function currentStateDocFreshness(path) {
  const text = readText(path);
  const scorePercent = `${releaseScore?.score ?? "?"}/100`;
  const scoreTotal = `${releaseScore?.total ?? "?"}/${releaseScore?.max ?? "?"}`;
  const finalGoalEvidenceScore = scoreById(releaseScore, "final-goal-evidence-map");
  const projectedTotal =
    typeof releaseScore?.total === "number" && typeof finalGoalEvidenceScore?.max === "number"
      ? releaseScore.total - (finalGoalEvidenceScore?.points ?? 0) + finalGoalEvidenceScore.max
      : releaseScore?.total;
  const projectedPercent =
    typeof projectedTotal === "number" && typeof releaseScore?.max === "number"
      ? Math.round((projectedTotal / releaseScore.max) * 100)
      : releaseScore?.score;
  const projectedScorePercent = `${projectedPercent ?? "?"}/100`;
  const projectedScoreTotal = `${projectedTotal ?? "?"}/${releaseScore?.max ?? "?"}`;
  const localDate = currentLocalDate();
  const checks = {
    exists: text != null,
    updatedForCurrentDate: text?.includes(localDate) === true,
    currentScorePercent: text?.includes(scorePercent) === true || text?.includes(projectedScorePercent) === true,
    currentScoreTotal: text?.includes(scoreTotal) === true || text?.includes(projectedScoreTotal) === true,
    currentReleaseCandidateState:
      text?.includes(`releaseCandidateReady=${releaseScore?.releaseCandidateReady === true}`) === true,
    consentGateNamed: text?.includes("authenticated-ai-cli-prompt-smoke") === true,
    consentPacketNamed: text?.includes("authenticated-ai-cli-consent-packet") === true,
    consentProviderRequired: text?.includes("AETHER_AUTH_PROMPT_PROVIDER=codex|claude|gemini") === true,
    consentGateStatus:
      text?.includes("blocked-by-explicit-consent") === true ||
      text?.includes("blocked-by-external-gates") === true ||
      text?.includes("complete") === true,
    noStaleLegacyScoreClaim: !/100\/116/.test(text ?? ""),
    noStaleReleaseReadyClaim: !/releaseCandidateReady=true/.test(text ?? ""),
  };
  return {
    path,
    checks,
    ok: Object.values(checks).every(Boolean),
  };
}

const currentStateDocs = currentStateDocPaths.map(currentStateDocFreshness);
const currentStateDocsFresh = currentStateDocs.every((doc) => doc.ok);

const releaseScoreDependencyPaths = [
  ...releaseScoreSourcePaths,
  ...releaseScoreArtifactPaths.filter((path) => !releaseScoreFreshnessIgnoredArtifactPaths.has(path)),
];
const releaseScoreIgnoredFreshnessArtifacts = releaseScoreArtifactPaths
  .filter((path) => releaseScoreFreshnessIgnoredArtifactPaths.has(path))
  .map((path) => ({
    path,
    mtimeMs: mtime(path),
  }));
const releaseScoreDependencyMtimes = releaseScoreDependencyPaths.map((path) => ({
  path,
  mtimeMs: mtime(path),
}));
const latestReleaseScoreDependency = releaseScoreDependencyMtimes.sort(
  (left, right) => right.mtimeMs - left.mtimeMs,
)[0];
const finalGoalEvidenceMapScore = scoreById(releaseScore, "final-goal-evidence-map");
const finalGoalEvidenceMapPoints = finalGoalEvidenceMapScore?.points ?? 0;
const finalGoalEvidenceMapMax = finalGoalEvidenceMapScore?.max ?? 0;
const scoreProjectedTotalWithEvidenceMap =
  typeof releaseScore?.total === "number"
    ? releaseScore.total - finalGoalEvidenceMapPoints + finalGoalEvidenceMapMax
    : 0;
const scoreProjectedPercentWithEvidenceMap = releaseScore?.max
  ? Math.round((scoreProjectedTotalWithEvidenceMap / releaseScore.max) * 100)
  : 0;
const scoreFresh =
  scoreProjectedPercentWithEvidenceMap >= 92 &&
  mtime(releaseScorePath) + 5_000 >= (latestReleaseScoreDependency?.mtimeMs ?? 0);
const nativeBoundaryIds = new Set(
  Array.isArray(nativeBoundary?.checks)
    ? nativeBoundary.checks.filter((item) => item?.status === "passed").map((item) => item.id)
    : [],
);
const commandCenterChecks = commandCenter?.checks ?? {};
const launchChecks = launchPlanner?.checks ?? {};
const launchPlan = launchPlanner?.plan ?? {};
const commandRecoveryChecks = commandRecovery?.checks ?? {};
const chunkedOscLiveChecks = chunkedOscLive?.checks ?? {};
const nativeHwndPasteLiveChecks = nativeHwndPasteLive?.checks ?? {};
const failedCommandRecovery = commandRecoveryChecks?.failedCommandRecovery ?? {};
const failedCommandRecoveryChecks = commandRecoveryChecks?.failedCommandRecovery?.checks ?? {};
const deniedToolRecoveryChecks = commandRecoveryChecks?.deniedToolRecovery?.checks ?? {};
const scaleChecks = rightRailScale?.checks ?? {};
const actionStateCoverage = scaleChecks.actionStateCoverage ?? scaleChecks.sourceActionStateCoverage ?? {};
const twentySessionStress = scaleChecks.twentySessionStress ?? scaleChecks.sourceTwentySessionStress ?? {};
const reviewQueueScale = scaleChecks.reviewQueueScale ?? scaleChecks.sourceReviewQueueScale ?? {};
const themeCustomizationScore = scoreById(releaseScore, "theme-customization-guard");
const releaseDoctorScore = scoreById(releaseScore, "release-doctor");
const releaseBlockers = Array.isArray(releaseScore?.blockers) ? releaseScore.blockers : [];
const productBlockers = releaseBlockers.filter((item) => item?.area !== "final-goal-evidence-map");
const hostSleepBlockers = productBlockers.filter((item) => isHostSleepUnsupportedBlocker(item));
const liveAiChaosBlockers = productBlockers.filter((item) => isLiveAiChaosExternalBlocker(item));
const releaseSigningOperatorBlockers = productBlockers.filter((item) => isReleaseSigningOperatorBlocker(item));
const releaseSigningOperatorHandoffReady =
  releaseSigningOperatorHandoff?.ok === true &&
  ["ready-for-release-signing-operator", "release-signing-complete"].includes(
    releaseSigningOperatorHandoff?.status,
  ) &&
  releaseSigningOperatorHandoff?.signingMaterialProvidedToThisRun === false &&
  releaseSigningOperatorHandoff?.noSecretMaterialPersisted === true &&
  releaseSigningOperatorHandoff?.checks?.localUnsignedDistReady === true &&
  releaseSigningOperatorHandoff?.checks?.signingWarningClassified === true &&
  releaseSigningOperatorHandoff?.checks?.updaterWarningClassified === true;
const releaseDoctorOperatorGateReady =
  (releaseDoctorScore?.points ?? 0) >= 14 &&
  releaseDoctorScore?.detail?.includes("pass_with_warnings") === true &&
  releaseSigningOperatorBlockers.length >= 1 &&
  releaseSigningOperatorHandoffReady;
const releaseOpsBlockedByConsent =
  releaseScore?.releaseCandidateReady === false && hasOnlyAuthenticatedPromptBlocker(productBlockers);
const releaseOpsComplete = productBlockers.length === 0 && (releaseScore?.score ?? 0) >= 92;
const realSuspendSleepAttempt =
  realSuspend?.validation?.sleepAttempt ?? realSuspendDiagnostic?.validation?.sleepAttempt;
const realSuspendUserInitiatedSleepWait =
  realSuspend?.validation?.userInitiatedSleepWait ?? realSuspendDiagnostic?.validation?.userInitiatedSleepWait;
const realSuspendHostUnsupported =
  realSuspend?.validation?.hostSleepUnsupported === true ||
  realSuspendDiagnostic?.validation?.hostSleepUnsupported === true ||
  realSuspendSleepAttempt?.hostUnsupported === true ||
  /ERROR_NOT_SUPPORTED|GetLastError=50|not supported|SetSuspendState returned false/i.test(
    `${realSuspendSleepAttempt?.reason ?? ""} ${realSuspend?.notes ?? ""} ${realSuspendDiagnostic?.notes ?? ""}`,
  );
const realSuspendUserCycleTimedOut =
  realSuspendUserInitiatedSleepWait?.ok === false &&
  realSuspendUserInitiatedSleepWait?.status === "timeout" &&
  /timed out waiting for a real user-initiated Windows sleep\/resume event pair|event pair was not observed/i.test(
    `${realSuspendUserInitiatedSleepWait?.reason ?? ""} ${realSuspend?.notes ?? ""} ${realSuspendDiagnostic?.notes ?? ""}`,
  );
const realSuspendNativePreflightReady =
  realSuspendNativePreflight?.status === "ready-for-real-sleep" &&
  Object.values(realSuspendNativePreflight?.checks ?? {}).every((value) => value === true);
const realSuspendNativePostcheckPreflightReady =
  realSuspendNativePostcheckPreflight?.status === "ready-for-native-postcheck" &&
  Object.values(realSuspendNativePostcheckPreflight?.checks ?? {}).every((value) => value === true);
const realSuspendNativePostcheckWriteSmokePass =
  realSuspendNativePostcheckWriteSmoke?.status === "pass" &&
  realSuspendNativePostcheckWriteSmoke?.noRealSleepClaim === true &&
  Object.values(realSuspendNativePostcheckWriteSmoke?.checks ?? {}).every((value) => value === true);
const realSuspendHostBlockedEvidenceReady =
  realSuspendHostUnsupported &&
  realSuspendSleepAttempt?.ok === false &&
  realSuspendNativePreflightReady &&
  realSuspendNativePostcheckPreflightReady &&
  realSuspendNativePostcheckWriteSmokePass &&
  scoreById(releaseScore, "real-os-soak")?.points >= 10;
const realSuspendUserCycleBlockedEvidenceReady =
  realSuspendUserCycleTimedOut &&
  realSuspendNativePreflightReady &&
  realSuspendNativePostcheckPreflightReady &&
  realSuspendNativePostcheckWriteSmokePass &&
  scoreById(releaseScore, "real-os-soak")?.points >= 10;
const realSuspendExternalBlockedEvidenceReady =
  realSuspendHostBlockedEvidenceReady || realSuspendUserCycleBlockedEvidenceReady;
const nativeAiCliPostLaunchChecks = nativeAiCliPostLaunchChaos?.checks ?? {};
const nativeAiCliPostLaunchReady =
  nativeAiCliPostLaunchChaos?.ok === true &&
  nativeAiCliPostLaunchChaos?.status === "pass" &&
  nativeAiCliPostLaunchChecks.commandSessionCapability === true &&
  nativeAiCliPostLaunchChecks.webviewRequiredForToolCalls === true &&
  nativeAiCliPostLaunchChecks.sameIdRespawned === true &&
  nativeAiCliPostLaunchChecks.ptyPromptReadyBeforeWrite === true &&
  nativeAiCliPostLaunchChecks.ptyPromptReadyAfterRestart === true &&
  nativeAiCliPostLaunchChecks.ptyRestartBeforeVisible === true &&
  nativeAiCliPostLaunchChecks.ptyRestartAfterVisible === true &&
  nativeAiCliPostLaunchChecks.ptyNoResidue === true &&
  nativeAiCliPostLaunchChecks.aiCliAllProvidersCovered === true &&
  nativeAiCliPostLaunchChecks.aiCliReadyVisible === true &&
  nativeAiCliPostLaunchChecks.aiCliInputRoundtrip === true &&
  nativeAiCliPostLaunchChecks.aiCliKillCleanup === true &&
  nativeAiCliPostLaunchChecks.noSessionResidue === true;
const rightRailStaleUrlTruthReady =
  rightRailStaleUrlTruth?.ok === true &&
  rightRailStaleUrlTruth?.status === "pass" &&
  rightRailStaleUrlTruth?.checks?.visualQaRuntime?.truthNoticeVisible === true;
const rightRailStaleUrlTruthCovered =
  rightRailStaleUrlTruthReady || nativeAiCliPostLaunchReady;
const rightRailInformationDensityReady =
  rightRailInformationDensity?.ok === true &&
  rightRailInformationDensity?.status === "pass-current-right-rail-information-density-contract" &&
  rightRailInformationDensity?.essentialFirst === true &&
  rightRailInformationDensity?.defaultDrawerCount >= 4 &&
  rightRailInformationDensity?.visiblePrimaryCount <= 2 &&
  rightRailInformationDensity?.conditionalPrimaryMax <= 3 &&
  Array.isArray(rightRailInformationDensity?.failedChecks) &&
  rightRailInformationDensity.failedChecks.length === 0;
const liveAiChaosExternalDependencyReady =
  !nativeAiCliPostLaunchReady &&
  liveAiCliPostLaunchChaos?.status === "external_dependency" &&
  /WebView2 CDP endpoint/i.test(String(liveAiCliPostLaunchChaos?.dependency ?? "")) &&
  /Cannot attach to WebView2 CDP|ECONNREFUSED|TCP timeout|connectOverCDP/i.test(
    String(liveAiCliPostLaunchChaos?.error ?? ""),
  ) &&
  liveAiChaosBlockers.length > 0;
const runtimeHygieneChecks = tauriRuntimeHygiene?.checks ?? {};
const runtimeHygieneOperationallyClean =
  tauriRuntimeHygiene?.ok === true &&
  runtimeHygieneChecks.noCrashMarkers === true &&
  runtimeHygieneChecks.noHelperOutputLeaks === true &&
  runtimeHygieneChecks.portsClosed === true &&
  runtimeHygieneChecks.workspaceProcessesClear === true &&
  runtimeHygieneChecks.noStalePidFiles === true &&
  runtimeHygieneChecks.historicalIncidentsClassified === true &&
  runtimeHygieneChecks.historicalIncidentsHaveCleanSuccessor === true;
const promptChecks = authenticatedPrompt?.checks ?? {};
const promptBlockedWithoutConsent =
  authenticatedPrompt?.status === "requires_opt_in" &&
  promptChecks.tokenSpendingExecutionBlocked === true &&
  promptChecks.safeNoPromptSent === true &&
  (promptChecks.nonTokenPreflightReady === true || authenticatedPrompt?.nonTokenPreflight?.ready === true);
const promptExecutedWithConsent =
  authenticatedPrompt?.status === "pass" &&
  authenticatedPrompt?.ok === true &&
  promptChecks.consent === true &&
  promptChecks.preflightReadyBeforePrompt === true &&
  promptChecks.promptMarkerObserved === true &&
  promptChecks.cleanup === true &&
  authenticatedPrompt?.outputEvidence?.privacy === "raw terminal output not persisted" &&
  authenticatedPrompt?.outputEvidence?.markerPresent === true;
const promptConsentBoundaryReady = promptBlockedWithoutConsent || promptExecutedWithConsent;
const promptProviderGuardReady =
  authenticatedPromptProviderGuard?.status === "provider_required" &&
  authenticatedPromptProviderGuard?.guardVerifier?.ok === true &&
  authenticatedPromptProviderGuard?.guardVerifier?.checks?.tokenBlocked === true &&
  authenticatedPromptProviderGuard?.guardVerifier?.checks?.noPromptSent === true &&
  authenticatedPromptProviderGuard?.guardVerifier?.checks?.noSessionSpawned === true;
const promptProviderMatrixReady =
  authenticatedPromptMatrix?.ok === true &&
  authenticatedPromptMatrix?.checks?.allProvidersReady === true &&
  authenticatedPromptMatrix?.checks?.promptExecutionStateReady === true;
const promptConsentPacketStateReady =
  (authenticatedPromptConsentPacket?.checks?.noTokenPromptSent === true &&
    authenticatedPromptConsentPacket?.packet?.tokenSpendingPromptExecuted === false) ||
  (authenticatedPromptConsentPacket?.checks?.tokenPromptExecutedWithConsent === true &&
    authenticatedPromptConsentPacket?.packet?.tokenSpendingPromptExecuted === true);
const promptConsentPacketReady =
  authenticatedPromptConsentPacket?.ok === true &&
  authenticatedPromptConsentPacket?.status === "pass" &&
  authenticatedPromptConsentPacket?.checks?.promptStateValid === true &&
  promptConsentPacketStateReady &&
  authenticatedPromptConsentPacket?.checks?.promptConsentPacketReady === true &&
  authenticatedPromptConsentPacket?.checks?.providerGuardBlocksPrompt === true &&
  authenticatedPromptConsentPacket?.checks?.providerMatrixReady === true &&
  authenticatedPromptConsentPacket?.checks?.allProviderOptInCommandsReady === true &&
  authenticatedPromptConsentPacket?.checks?.sourceArtifactsFresh === true &&
  authenticatedPromptConsentPacket?.packet?.command === "pnpm verify:terminal:authenticated-ai-cli-prompt" &&
  authenticatedPromptConsentPacket?.packet?.requiredEnv ===
    "AETHER_AUTH_PROMPT_CONSENT=I_UNDERSTAND_THIS_MAY_SPEND_TOKENS" &&
  authenticatedPromptConsentPacket?.packet?.tokenGate === "explicit consent" &&
  typeof authenticatedPromptConsentPacket?.consentPacketSha256 === "string";
const glassLegibilityContractReady =
  glassLegibilityContract?.ok === true &&
  glassLegibilityContract?.status === "pass-current-glass-legibility-contract" &&
  glassLegibilityContract?.textFullyPainted === true &&
  glassLegibilityContract?.materialTranslucencyProved === true &&
  glassLegibilityContract?.sourceFresh === true;
const goalAntiStallContractReady =
  goalAntiStallContract?.ok === true &&
  goalAntiStallContract?.status === "pass-current-anti-stall-contract" &&
  goalAntiStallContract?.sourceFresh === true &&
  goalAntiStallContract?.nativeAiChaosDefaultWaitMs >= 120_000 &&
  Array.isArray(goalAntiStallContract?.failedChecks) &&
  goalAntiStallContract.failedChecks.length === 0 &&
  Object.values(goalAntiStallContract?.checks ?? {}).every((value) => value === true);
const externalGateReadinessReady =
  externalGateReadiness?.ok === true &&
  ["ready-for-external-operator-gates", "blocked-by-host-sleep-unsupported"].includes(
    externalGateReadiness?.status,
  ) &&
  ((externalGateReadiness?.tokenSpendingPromptExecuted === false &&
    externalGateReadiness?.checks?.noTokenPromptSent === true) ||
    (externalGateReadiness?.tokenSpendingPromptExecuted === true &&
      externalGateReadiness?.checks?.tokenPromptExecutedWithConsent === true)) &&
  externalGateReadiness?.realOsSleepInvoked === false &&
  externalGateReadiness?.checks?.releaseScoreCurrentExternalGateShape === true &&
  externalGateReadiness?.checks?.finalAuditExternalGateShape === true &&
  externalGateReadiness?.checks?.completionMatrixExternalGateShape === true &&
  externalGateReadiness?.checks?.tokenGateReady === true &&
  externalGateReadiness?.checks?.realSleepGateReady === true &&
  (externalGateReadiness?.checks?.noTokenPromptSent === true ||
    externalGateReadiness?.checks?.tokenPromptExecutedWithConsent === true) &&
  externalGateReadiness?.checks?.noRealSleepClaimMade === true;
const externalGateReadinessComplete =
  externalGateReadiness?.ok === true &&
  externalGateReadiness?.status === "external-operator-gates-complete" &&
  (externalGateReadiness?.tokenSpendingPromptExecuted === false ||
    externalGateReadiness?.tokenSpendingPromptExecuted === true) &&
  (externalGateReadiness?.realOsSleepInvoked === false || externalGateReadiness?.realOsSleepInvoked === true) &&
  externalGateReadiness?.checks?.completeExternalGatesProved === true &&
  externalGateReadiness?.checks?.releaseScoreCurrentExternalGateShape === true &&
  externalGateReadiness?.checks?.finalAuditExternalGateShape === true &&
  externalGateReadiness?.checks?.completionMatrixExternalGateShape === true &&
  externalGateReadiness?.checks?.tokenGateReady === true &&
  externalGateReadiness?.checks?.realSleepGateReady === true &&
  externalGateReadiness?.checks?.sourceArtifactsFresh === true;
const externalGateReadinessSourceReady =
  externalGateReadinessReady ||
  externalGateReadinessComplete ||
  (((externalGateReadiness?.tokenSpendingPromptExecuted === false &&
    externalGateReadiness?.checks?.noTokenPromptSent === true) ||
    (externalGateReadiness?.tokenSpendingPromptExecuted === true &&
      externalGateReadiness?.checks?.tokenPromptExecutedWithConsent === true)) &&
    externalGateReadiness?.realOsSleepInvoked === false &&
    externalGateReadiness?.checks?.releaseScoreCurrentExternalGateShape === true &&
    externalGateReadiness?.checks?.tokenGateReady === true &&
    externalGateReadiness?.checks?.providerGuardReady === true &&
    externalGateReadiness?.checks?.preflightMatrixReady === true &&
    externalGateReadiness?.checks?.consentPacketReady === true &&
    externalGateReadiness?.checks?.realSleepGateReady === true &&
    (externalGateReadiness?.checks?.noTokenPromptSent === true ||
      externalGateReadiness?.checks?.tokenPromptExecutedWithConsent === true) &&
    externalGateReadiness?.checks?.noRealSleepClaimMade === true &&
    externalGateReadiness?.checks?.sourceArtifactsFresh === true) ||
  (externalGateReadiness?.checks?.noUnsafeConsentEnvPresent === true &&
    externalGateReadiness?.checks?.noOsSleepEnvPresent === true &&
    promptConsentBoundaryReady &&
    promptProviderGuardReady &&
    promptProviderMatrixReady &&
    promptConsentPacketReady &&
    realSuspendExternalBlockedEvidenceReady &&
    (releaseSigningOperatorBlockers.length === 0 || releaseDoctorOperatorGateReady));
const promptExecutionGate = {
  command: authenticatedPrompt?.nextCommand?.command ?? "pnpm verify:terminal:authenticated-ai-cli-prompt",
  requiredEnv: promptChecks.requiredEnv ?? "AETHER_AUTH_PROMPT_CONSENT=I_UNDERSTAND_THIS_MAY_SPEND_TOKENS",
  requiredProviderEnv: "AETHER_AUTH_PROMPT_PROVIDER=codex|claude|gemini",
  env: authenticatedPrompt?.nextCommand?.env ?? {},
  provider:
    authenticatedPrompt?.provider ?? authenticatedPrompt?.nextCommand?.env?.AETHER_AUTH_PROMPT_PROVIDER ?? "unknown",
  cdp: authenticatedPrompt?.nextCommand?.env?.AETHER_TAURI_CDP ?? authenticatedPrompt?.cdp ?? null,
  wouldSpendTokens: authenticatedPrompt?.wouldSpendTokens === true,
  tokenGate: authenticatedPrompt?.wouldSpendTokens === true ? "explicit consent" : "not required",
  consentPacketReady:
    (promptChecks.consentPacketReady === true || promptExecutedWithConsent) && promptConsentPacketReady,
  consentPacketArtifact: {
    path: authenticatedPromptConsentPacketPath,
    ok: promptConsentPacketReady,
    status: authenticatedPromptConsentPacket?.status ?? "missing",
    consentPacketSha256: authenticatedPromptConsentPacket?.consentPacketSha256 ?? null,
  },
  readyToRunAfterConsent:
    !promptExecutedWithConsent &&
    promptConsentBoundaryReady &&
    promptProviderGuardReady &&
    promptProviderMatrixReady &&
    promptConsentPacketReady &&
    authenticatedPrompt?.wouldSpendTokens === true,
  executedWithConsent: promptExecutedWithConsent,
  providerReadiness: Array.isArray(authenticatedPromptMatrix?.providers) ? authenticatedPromptMatrix.providers : [],
};
const unresolvedBlockersCanBeExternallyClosed =
  productBlockers.length > 0 &&
  productBlockers.every(
    (blocker) =>
      isAuthenticatedPromptBlocker(blocker) ||
      isHostSleepUnsupportedBlocker(blocker) ||
      isLiveAiChaosExternalBlocker(blocker) ||
      isReleaseSigningOperatorBlocker(blocker),
  ) &&
  (hostSleepBlockers.length === 0 || realSuspendExternalBlockedEvidenceReady) &&
  (liveAiChaosBlockers.length === 0 || liveAiChaosExternalDependencyReady) &&
  (productBlockers.some((blocker) => isAuthenticatedPromptBlocker(blocker)) ? promptConsentPacketReady : true);
const releaseOpsBlockedByExternalGates =
  releaseScore?.releaseCandidateReady === false && unresolvedBlockersCanBeExternallyClosed;
const operationalEvidenceReady =
  runtimeHygieneOperationallyClean &&
  goalAntiStallContractReady &&
  currentStateDocsFresh &&
  (releaseOpsComplete ||
    (promptConsentBoundaryReady &&
      promptProviderGuardReady &&
      promptProviderMatrixReady &&
      promptConsentPacketReady &&
      externalGateReadinessSourceReady &&
      (hostSleepBlockers.length === 0 || realSuspendExternalBlockedEvidenceReady) &&
      (liveAiChaosBlockers.length === 0 || liveAiChaosExternalDependencyReady)));
const operationalEvidence = {
  releaseScoreFreshness: {
    fresh: scoreFresh,
    latestDependency: latestReleaseScoreDependency ?? null,
    checkedSourceCount: releaseScoreSourcePaths.length,
    checkedArtifactCount: releaseScoreDependencyPaths.length - releaseScoreSourcePaths.length,
    ignoredDownstreamArtifacts: releaseScoreIgnoredFreshnessArtifacts,
  },
  runtimeHygiene: {
    ok: tauriRuntimeHygiene?.ok === true,
    activeLogRun: tauriRuntimeHygiene?.activeLogRun ?? null,
    checks: {
      noCrashMarkers: runtimeHygieneChecks.noCrashMarkers === true,
      noHelperOutputLeaks: runtimeHygieneChecks.noHelperOutputLeaks === true,
      portsClosed: runtimeHygieneChecks.portsClosed === true,
      workspaceProcessesClear: runtimeHygieneChecks.workspaceProcessesClear === true,
      noStalePidFiles: runtimeHygieneChecks.noStalePidFiles === true,
      historicalIncidentsClassified: runtimeHygieneChecks.historicalIncidentsClassified === true,
      historicalIncidentsHaveCleanSuccessor: runtimeHygieneChecks.historicalIncidentsHaveCleanSuccessor === true,
    },
    historicalIncidentClosure: summarizeHistoricalIncidentClosure(tauriRuntimeHygiene?.historicalIncidentClosure),
    previousCrashIncidentCount: Array.isArray(tauriRuntimeHygiene?.previousRunCrashMatches)
      ? tauriRuntimeHygiene.previousRunCrashMatches.length
      : 0,
    previousHelperOutputLeakCount: Array.isArray(tauriRuntimeHygiene?.previousRunHelperOutputLeaks)
      ? tauriRuntimeHygiene.previousRunHelperOutputLeaks.length
      : 0,
    observedLogRuns: Array.isArray(tauriRuntimeHygiene?.observedLogRuns)
      ? tauriRuntimeHygiene.observedLogRuns.map((run) => ({
          id: run?.id ?? "unknown",
          crashMatchCount: run?.crashMatchCount ?? 0,
          helperOutputLeakCount: run?.helperOutputLeakCount ?? 0,
        }))
      : [],
  },
  productionBundleBudget: {
    ok: productionBundleBudget?.ok === true,
    status: productionBundleBudget?.status ?? "missing",
    summary: productionBundleBudget?.summary ?? null,
    checks: Array.isArray(productionBundleBudget?.checks)
      ? productionBundleBudget.checks.map((item) => ({
          id: item?.id ?? "unknown",
          status: item?.status ?? "unknown",
          detail: item?.detail ?? "",
        }))
      : [],
  },
  supplyChainAudit: {
    ok: supplyChainAudit?.status === "pass",
    npmKnownVulnerabilities: supplyChainAudit?.npm?.knownVulnerabilities ?? null,
    cargoKnownVulnerabilities: supplyChainAudit?.cargo?.knownVulnerabilities ?? null,
    cargoWarningCount: supplyChainAudit?.cargo?.warningCount ?? null,
    cargoRuntimeCriticalWarningCount: supplyChainAudit?.cargo?.reachability?.runtimeCriticalWarningCount ?? null,
    cargoRuntimeMaintenanceWarningCount: supplyChainAudit?.cargo?.reachability?.runtimeMaintenanceWarningCount ?? null,
  },
  goalDocumentationFreshness: {
    ok: currentStateDocsFresh,
    checkedDocCount: currentStateDocs.length,
    docs: currentStateDocs,
  },
  antiStallContract: {
    path: goalAntiStallContractPath,
    ok: goalAntiStallContractReady,
    status: goalAntiStallContract?.status ?? "missing",
    nativeAiChaosDefaultWaitMs: goalAntiStallContract?.nativeAiChaosDefaultWaitMs ?? null,
    failedChecks: Array.isArray(goalAntiStallContract?.failedChecks) ? goalAntiStallContract.failedChecks : [],
    checks: goalAntiStallContract?.checks ?? {},
  },
  authenticatedPromptConsent: {
    status: authenticatedPrompt?.status ?? "missing",
    tokenSpendingExecutionBlocked: promptChecks.tokenSpendingExecutionBlocked === true,
    safeNoPromptSent: promptChecks.safeNoPromptSent === true,
    nonTokenPreflightReady:
      promptChecks.nonTokenPreflightReady === true || authenticatedPrompt?.nonTokenPreflight?.ready === true,
    promptExecutionGate,
    providerRequiredGuard: {
      ok: promptProviderGuardReady,
      tokenBlocked: authenticatedPromptProviderGuard?.guardVerifier?.checks?.tokenBlocked === true,
      noPromptSent: authenticatedPromptProviderGuard?.guardVerifier?.checks?.noPromptSent === true,
      noSessionSpawned: authenticatedPromptProviderGuard?.guardVerifier?.checks?.noSessionSpawned === true,
    },
    providerMatrix: {
      ok: promptProviderMatrixReady,
      providers: Array.isArray(authenticatedPromptMatrix?.providers) ? authenticatedPromptMatrix.providers : [],
      allProvidersReady: authenticatedPromptMatrix?.checks?.allProvidersReady === true,
    },
    consentPacketArtifact: {
      path: authenticatedPromptConsentPacketPath,
      ok: promptConsentPacketReady,
      status: authenticatedPromptConsentPacket?.status ?? "missing",
      consentPacketSha256: authenticatedPromptConsentPacket?.consentPacketSha256 ?? null,
      tokenSpendingPromptExecuted:
        authenticatedPromptConsentPacket?.packet?.tokenSpendingPromptExecuted === true
          ? true
          : authenticatedPromptConsentPacket?.packet?.tokenSpendingPromptExecuted === false
            ? false
            : null,
    },
    externalGateReadiness: {
      path: externalGateReadinessPath,
      ok: externalGateReadinessSourceReady,
      strictArtifactOk: externalGateReadinessReady,
      status: externalGateReadiness?.status ?? "missing",
      tokenSpendingPromptExecuted: externalGateReadiness?.tokenSpendingPromptExecuted ?? null,
      realOsSleepInvoked: externalGateReadiness?.realOsSleepInvoked ?? null,
    },
  },
  realOsSleepResume: {
    status: scoreById(releaseScore, "real-os-soak")?.detail ?? "missing",
    hostUnsupported: realSuspendHostUnsupported,
    sleepAttempt: realSuspendSleepAttempt ?? null,
    userInitiatedSleepWait: realSuspendUserInitiatedSleepWait ?? null,
    hostBlockedEvidenceReady: realSuspendExternalBlockedEvidenceReady,
    nativePreflightReady: realSuspendNativePreflightReady,
    nativePostcheckPreflightReady: realSuspendNativePostcheckPreflightReady,
    nativePostcheckWriteSmokePass: realSuspendNativePostcheckWriteSmokePass,
    noRealSleepClaim: !scorePass(releaseScore, "real-os-soak") && realSuspendExternalBlockedEvidenceReady,
  },
  liveAiCliPostLaunchChaos: {
    status: nativeAiCliPostLaunchReady ? "native-first-pass" : (liveAiCliPostLaunchChaos?.status ?? "missing"),
    nativeFirstReady: nativeAiCliPostLaunchReady,
    nativeFirstArtifact: nativeAiCliPostLaunchChaosPath,
    nativeFirstStatus: nativeAiCliPostLaunchChaos?.status ?? "missing",
    nativeFirstChecks: nativeAiCliPostLaunchChecks,
    staleUrlTruthReady: rightRailStaleUrlTruthReady,
    staleUrlTruthCovered: rightRailStaleUrlTruthCovered,
    staleUrlTruthCoveredByNativeFirst: !rightRailStaleUrlTruthReady && nativeAiCliPostLaunchReady,
    staleUrlTruthArtifact: rightRailStaleUrlTruthPath,
    webviewCdpStatus: liveAiCliPostLaunchChaos?.status ?? "missing",
    cdp: liveAiCliPostLaunchChaos?.cdp ?? null,
    dependency: liveAiCliPostLaunchChaos?.dependency ?? null,
    externalDependencyReady: liveAiChaosExternalDependencyReady,
    error: liveAiCliPostLaunchChaos?.error ?? null,
  },
};

const requirements = [
  check(
    "rust-native-terminal-core",
    "Rust native terminal core",
    scoreFresh &&
      scorePass(releaseScore, "terminal-core-edge") &&
      scorePass(releaseScore, "terminal-render-fidelity") &&
      scorePass(releaseScore, "native-boundary-contract") &&
      scorePass(releaseScore, "native-ime") &&
      scorePass(releaseScore, "scrollback") &&
      nativeBoundary?.ok === true &&
      nativeBoundaryIds.has("native-input-rust-host") &&
      nativeBoundaryIds.has("webview-ime-fallback-contained") &&
      nativeBoundaryIds.has("clipboard-native-first") &&
      chunkedOscLive?.ok === true &&
      chunkedOscLive?.status === "pass-current-chunked-osc-live-contract" &&
      chunkedOscLiveChecks.requiredCaseCountCovered === true &&
      chunkedOscLiveChecks.allCasesPassed === true &&
      chunkedOscLiveChecks.shellsCovered === true &&
      chunkedOscLiveChecks.tinyFixturePassedForEveryShell === true &&
      chunkedOscLiveChecks.largeFixturePassedForEveryShell === true &&
      chunkedOscLiveChecks.pngSignatureVerified === true &&
      nativeHwndPasteLive?.ok === true &&
      nativeHwndPasteLive?.status === "pass-current-native-hwnd-paste-contract" &&
      nativeHwndPasteLiveChecks.wmPasteSentToNativeHwnd === true &&
      nativeHwndPasteLiveChecks.singleLineLfNormalizedAndExecuted === true &&
      nativeHwndPasteLiveChecks.destructivePasteBlockedBeforePty === true &&
      nativeHwndPasteLiveChecks.multilinePasteBlockedBeforePty === true,
    "Rust-owned input, native IME, persistent scrollback, guarded clipboard, native HWND paste, chunked OSC inline image handling, and crisp terminal text rendering are proven by fresh release evidence.",
    [
      releaseScorePath,
      nativeBoundaryPath,
      chunkedOscLivePath,
      nativeHwndPasteLivePath,
      "scripts/verify-chunked-osc-live.mjs",
      "scripts/verify-native-hwnd-paste-live.mjs",
      "src-tauri/src/term/native_input.rs",
      "src/features/terminal/TerminalCanvas.tsx",
      "src/features/terminal/TerminalArea.module.css",
      "src/features/terminal/hooks/useCanvasIME.ts",
      "src/__tests__/TerminalCanvas.test.tsx",
      "src/__tests__/TerminalCanvasInput.test.tsx",
    ],
  ),
  check(
    "rust-mux-daemon-boundary",
    "Rust mux and daemon boundary",
    scoreFresh &&
      scorePass(releaseScore, "mux-performance") &&
      scorePass(releaseScore, "process-reconnect-command-evidence") &&
      nativeBoundaryIds.has("mux-ui-rust-owned") &&
      nativeBoundaryIds.has("sidecar-command-session-boundary") &&
      nativeBoundaryIds.has("sidecar-command-session-artifact"),
    "Mux restore/performance, process reconnect, sidecar command sessions, and UI-to-mux ownership are proven.",
    [
      releaseScorePath,
      nativeBoundaryPath,
      "src-tauri/src/pty/registry.rs",
      "src/features/terminal/pane-tree/usePaneTree.ts",
      "src/__tests__/paneTreePersistence.test.ts",
    ],
  ),
  check(
    "right-rail-command-center",
    "Right rail Command Center edge",
    scoreFresh &&
      scorePass(releaseScore, "right-rail-smoke") &&
      scorePass(releaseScore, "right-rail-edge") &&
      scorePass(releaseScore, "right-rail-scale-contract") &&
      scorePass(releaseScore, "right-rail-goal-track") &&
      rightRailInformationDensityReady &&
      actionStateCoverage.covered >= 12 &&
      (twentySessionStress.sessions >= 20 || twentySessionStress.boundedActionStack === true) &&
      (reviewQueueScale.files >= 500 || reviewQueueScale.boundedVisibleRows === true),
    "The rail has ranked actions, essential-first information density, scale coverage, final-goal visibility, and bounded large-review behavior.",
    [
      releaseScorePath,
      rightRailScalePath,
      rightRailInformationDensityPath,
      "src/shared/lib/rightRailGoalTrack.ts",
      "src/__tests__/rightRailGoalTrack.test.ts",
    ],
  ),
  check(
    "fallback-and-stale-visibility",
    "Fallback and stale state visibility",
    scoreFresh &&
      scorePass(releaseScore, "command-recovery-contract") &&
      scorePass(releaseScore, "app-state-fallback-visibility") &&
      nativeBoundaryIds.has("mux-fallback-visible") &&
      nativeBoundaryIds.has("no-silent-fallback-contract") &&
      failedCommandRecoveryChecks.noSilentFallback === true &&
      deniedToolRecoveryChecks.noSilentFallback === true,
    "Fallbacks, stale state, failed commands, denied tools, and app-state persistence failures are visible and routed through recovery instead of silent retry.",
    [
      releaseScorePath,
      nativeBoundaryPath,
      commandRecoveryPath,
      "src/shared/lib/commandRecovery.ts",
      "src/shared/lib/agentTelemetryPersistence.ts",
      "src/features/terminal/NativeTerminalArea.tsx",
      "src/__tests__/commandRecoveryContract.test.ts",
      "src/__tests__/agentTelemetryPersistence.test.ts",
    ],
  ),
  check(
    "provenance-recovery-context-packs",
    "Provenance, recovery, context packs, and final reports",
    scoreFresh &&
      scorePass(releaseScore, "command-center-scenario") &&
      scorePass(releaseScore, "command-recovery-contract") &&
      commandCenter?.ok === true &&
      commandCenterChecks.provenanceReady === true &&
      commandCenterChecks.finalReportAndContextReady === true &&
      commandCenterChecks.recoveryReady === true &&
      commandCenterChecks.auditPayloadsComplete === true &&
      commandCenter?.contextPackSummary?.finalReportIncluded === true &&
      commandCenter?.auditPayloadCount >= 1 &&
      commandRecovery?.ok === true &&
      failedCommandRecovery.provenanceHasEvidence === true &&
      failedCommandRecoveryChecks.noSilentFallback === true &&
      deniedToolRecoveryChecks.noSilentFallback === true,
    "Command Center scenario links changed files, pane/session/agent evidence, recovery actions, context packs, final report, and audit payloads.",
    [
      commandCenterPath,
      commandRecoveryPath,
      releaseScorePath,
      "src/shared/lib/agentFileChanges.ts",
      "src/shared/hooks/useAgentManager.ts",
      "src/__tests__/agentFileChanges.test.ts",
    ],
  ),
  check(
    "ai-cli-launch-planner",
    "AI CLI launch planner and prompt contract",
    scoreFresh &&
      scorePass(releaseScore, "ai-cli-launch-planner") &&
      scorePass(releaseScore, "authenticated-ai-cli-preflight-gate") &&
      scorePass(releaseScore, "authenticated-ai-cli-preflight-matrix") &&
      scorePass(releaseScore, "live-ai-cli-post-launch-chaos") &&
      nativeAiCliPostLaunchReady &&
      rightRailStaleUrlTruthCovered &&
      promptConsentPacketReady &&
      launchPlanner?.ok === true &&
      launchChecks.planReady === true &&
      launchChecks.contextPackReady === true &&
      launchChecks.preflightReady === true &&
      launchChecks.promptContractReady === true &&
      launchPlan.recommendedBackend === "sidecar-command-session" &&
      launchPlan.trace?.recommendedBackend === "sidecar-command-session",
    "AI CLI launches are planned from provider/backend/role/preflight/context-pack/prompt-contract evidence, all providers have no-token preflight proof, and token-spending prompt execution is blocked until immediate preflight is green.",
    [
      launchPlannerPath,
      releaseScorePath,
      nativeAiCliPostLaunchChaosPath,
      rightRailStaleUrlTruthPath,
      authenticatedPromptPath,
      authenticatedPromptMatrixPath,
      authenticatedPromptConsentPacketPath,
      "scripts/verify-native-ai-cli-post-launch-chaos.mjs",
      "src/shared/lib/aiCliLaunchPlanner.ts",
      "src/shared/lib/authenticatedPromptConsent.ts",
      "src/__tests__/aiCliLaunchPlanner.test.ts",
    ],
  ),
  check(
    "theme-customization",
    "Customization and visual preset isolation",
    scoreFresh &&
      scorePass(releaseScore, "theme-customization-guard") &&
      themeCustomizationScore?.points === themeCustomizationScore?.max &&
      themeCustomizationScore?.max >= 13 &&
      String(themeCustomizationScore?.detail ?? "").includes("13/13") &&
      glassLegibilityContractReady,
    "Per-mood material, wallpaper, Sakura isolation, settings persistence, opaque text, and translucent glass-material contracts are green.",
    [
      releaseScorePath,
      glassLegibilityContractPath,
      "scripts/verify-glass-legibility-contract.mjs",
      "src/styles/global.css",
      "src/shared/themes/moods.ts",
      "src/shared/hooks/useTheme.ts",
      "src/features/settings/Settings.tsx",
      "src-tauri/src/config/settings.rs",
      "src/__tests__/themePalette.test.ts",
      "src/__tests__/useThemeApplier.test.tsx",
    ],
  ),
  check(
    "release-operations-proof",
    "Release and operations proof",
    scoreFresh &&
      (scorePass(releaseScore, "release-doctor") || releaseDoctorOperatorGateReady) &&
      scorePass(releaseScore, "supply-chain-audit") &&
      scorePass(releaseScore, "distribution") &&
      scorePass(releaseScore, "frontend-bundle-budget") &&
      scorePass(releaseScore, "test-runtime-hygiene") &&
      scorePass(releaseScore, "risk-register") &&
      (scorePass(releaseScore, "real-os-soak") || realSuspendExternalBlockedEvidenceReady) &&
      scorePass(releaseScore, "tauri-runtime-hygiene") &&
      scorePass(releaseScore, "authenticated-ai-cli-preflight-gate") &&
      promptConsentPacketReady &&
      goalAntiStallContractReady &&
      (releaseOpsComplete || externalGateReadinessSourceReady) &&
      productionBundleBudget?.ok === true &&
      (releaseOpsBlockedByConsent || releaseOpsBlockedByExternalGates || releaseOpsComplete),
    releaseOpsComplete
      ? "Release artifacts, supply-chain audit with zero runtime critical Rust warnings, production bundle budget, frontend test runtime isolation, risk register, real OS soak, Tauri runtime hygiene, anti-stall self-checks, and authenticated prompt execution are green; no release blockers remain."
      : realSuspendExternalBlockedEvidenceReady || releaseDoctorOperatorGateReady
        ? "Release artifacts, supply-chain audit with zero runtime critical Rust warnings, production bundle budget, frontend test runtime isolation, risk register, Tauri runtime hygiene, anti-stall self-checks, and authenticated prompt preflight safety are green; remaining release gates are external/operator-owned with no fake pass claim."
        : "Release artifacts, supply-chain audit with zero runtime critical Rust warnings, production bundle budget, frontend test runtime isolation, risk register, real OS soak, Tauri runtime hygiene, anti-stall self-checks, and authenticated prompt preflight safety are green; the only release blocker is explicit token-spend consent.",
    [
      releaseScorePath,
      supplyChainAuditPath,
      productionBundleBudgetPath,
      realSuspendPath,
      realSuspendDiagnosticPath,
      realSuspendNativePreflightPath,
      realSuspendNativePostcheckPreflightPath,
      realSuspendNativePostcheckWriteSmokePath,
      "vitest.config.ts",
      "src/__tests__/setup.ts",
      authenticatedPromptPath,
      authenticatedPromptConsentPacketPath,
      externalGateReadinessPath,
      releaseSigningOperatorHandoffPath,
      goalAntiStallContractPath,
      tauriRuntimeHygienePath,
      "scripts/verify-supply-chain.mjs",
      "scripts/verify-goal-anti-stall-contract.mjs",
      "scripts/verify-tauri-runtime-hygiene.mjs",
      "scripts/verify-production-bundle-budget.mjs",
    ],
  ),
];

const missing = requirements.filter((item) => item.status !== "proved");
const minimumEvidenceByRequirement = {
  "rust-native-terminal-core": 7,
  "rust-mux-daemon-boundary": 5,
  "right-rail-command-center": 4,
  "fallback-and-stale-visibility": 8,
  "provenance-recovery-context-packs": 6,
  "ai-cli-launch-planner": 8,
  "theme-customization": 6,
  "release-operations-proof": 10,
};
const requiredEvidenceKindsByRequirement = {
  "rust-native-terminal-core": ["json-artifact", "verifier-source", "source-file", "test-file"],
  "rust-mux-daemon-boundary": ["json-artifact", "source-file", "test-file"],
  "right-rail-command-center": ["json-artifact", "source-file", "test-file"],
  "fallback-and-stale-visibility": ["json-artifact", "source-file", "test-file"],
  "provenance-recovery-context-packs": ["json-artifact", "source-file", "test-file"],
  "ai-cli-launch-planner": ["json-artifact", "source-file", "test-file"],
  "theme-customization": ["json-artifact", "source-file", "test-file"],
  "release-operations-proof": ["json-artifact", "verifier-source", "test-file"],
};
const evidencePathItems = requirements.flatMap((requirement) =>
  (Array.isArray(requirement.evidence) ? requirement.evidence : []).map((path) => {
    const full = join(ROOT, path);
    const exists = existsSync(full);
    const size = fileSize(path);
    const jsonArtifact = path.endsWith(".json");
    const parsed = jsonArtifact ? tryReadJson(path) : { data: null, error: null };
    const kind = classifyEvidencePath(path);
    return {
      requirementId: requirement.id,
      path,
      kind,
      exists,
      size,
      mtimeMs: mtime(path),
      parseableJson: jsonArtifact ? parsed.data != null && parsed.error == null : null,
      parseError: parsed.error,
      ok: exists && size > 0 && (!jsonArtifact || (parsed.data != null && parsed.error == null)),
    };
  }),
);
const missingEvidencePaths = evidencePathItems.filter((item) => item.ok !== true);
const evidencePathIntegrity = {
  complete: missingEvidencePaths.length === 0,
  items: evidencePathItems,
};
const evidenceItemsByRequirement = evidencePathItems.reduce((acc, item) => {
  if (!acc.has(item.requirementId)) acc.set(item.requirementId, []);
  acc.get(item.requirementId).push(item);
  return acc;
}, new Map());
const evidenceDensityItems = requirements.map((requirement) => {
  const minimum = minimumEvidenceByRequirement[requirement.id] ?? 1;
  const requiredKinds = requiredEvidenceKindsByRequirement[requirement.id] ?? ["json-artifact"];
  const items = evidenceItemsByRequirement.get(requirement.id) ?? [];
  const actual = items.length;
  const okKinds = new Set(items.filter((item) => item.ok).map((item) => item.kind));
  const missingKinds = requiredKinds.filter((kind) => !okKinds.has(kind));
  const jsonArtifactCount = items.filter((item) => item.kind === "json-artifact" && item.ok).length;
  return {
    id: requirement.id,
    actual,
    minimum,
    kinds: [...okKinds].sort(),
    requiredKinds,
    missingKinds,
    jsonArtifactCount,
    ok: actual >= minimum && missingKinds.length === 0 && jsonArtifactCount >= 1,
  };
});
const missingEvidenceDensity = evidenceDensityItems.filter((item) => item.ok !== true);
const evidenceDensity = {
  complete: missingEvidenceDensity.length === 0,
  items: evidenceDensityItems,
};
const unresolvedBlockers = productBlockers;
const authenticatedPromptOnly = hasOnlyAuthenticatedPromptBlocker(unresolvedBlockers);
const allowedExternalBlockersOnly =
  unresolvedBlockers.length === 0 ||
  (unresolvedBlockers.every(
    (blocker) =>
      isAuthenticatedPromptBlocker(blocker) ||
      isHostSleepUnsupportedBlocker(blocker) ||
      isLiveAiChaosExternalBlocker(blocker) ||
      isReleaseSigningOperatorBlocker(blocker),
  ) &&
    (hostSleepBlockers.length === 0 || realSuspendExternalBlockedEvidenceReady) &&
    (liveAiChaosBlockers.length === 0 || liveAiChaosExternalDependencyReady));
const evidenceComplete =
  missing.length === 0 &&
  evidenceDensity.complete &&
  evidencePathIntegrity.complete &&
  operationalEvidenceReady &&
  (authenticatedPromptOnly || allowedExternalBlockersOnly);
const goalComplete =
  missing.length === 0 &&
  evidenceDensity.complete &&
  evidencePathIntegrity.complete &&
  operationalEvidenceReady &&
  unresolvedBlockers.length === 0;
const policyBlockedRisks = unresolvedBlockers
  .filter((blocker) => isAuthenticatedPromptBlocker(blocker))
  .map((blocker) => ({
    kind: "explicit-token-spend-consent",
    area: blocker?.area ?? "authenticated-ai-cli-prompt-smoke",
    blocker: blocker?.blocker ?? String(blocker),
    canAutoResolve: false,
    requiredAction:
      "User must explicitly approve the authenticated AI CLI prompt smoke before token-spending execution.",
  }));
const externalBlockedRisks = unresolvedBlockers
  .filter((blocker) => isHostSleepUnsupportedBlocker(blocker))
  .map((blocker) => ({
    kind: "host-sleep-unsupported",
    area: blocker?.area ?? "real-os-soak",
    blocker: blocker?.blocker ?? String(blocker),
    canAutoResolve: false,
    requiredAction:
      "Run the native sleep/resume gate on a Windows host or user-initiated sleep cycle that supports real suspend and emits System power events.",
  }))
  .concat(
    unresolvedBlockers
      .filter((blocker) => isLiveAiChaosExternalBlocker(blocker))
      .map((blocker) => ({
        kind: "webview2-cdp-unavailable",
        area: blocker?.area ?? "live-ai-cli-post-launch-chaos",
        blocker: blocker?.blocker ?? String(blocker),
        canAutoResolve: false,
        requiredAction:
          "Run the live AI CLI post-launch chaos gate against a Tauri/WebView2 runtime exposing the configured CDP endpoint.",
      })),
  )
  .concat(
    unresolvedBlockers
      .filter((blocker) => isReleaseSigningOperatorBlocker(blocker))
      .map((blocker) => ({
        kind: "release-signing-updater-operator-gate",
        area: blocker?.area ?? "release-doctor",
        blocker: blocker?.blocker ?? String(blocker),
        canAutoResolve: false,
        requiredAction:
          "Regenerate current updater signatures/latest.json with the release signing material, then rerun pnpm verify:release:doctor and pnpm verify:quality-score.",
      })),
  );
const implementationFixableRisks = [
  ...missing.map((requirement) => ({
    kind: "missing-requirement",
    area: requirement.id,
    blocker: requirement.detail,
    canAutoResolve: true,
    requiredAction: `Fix ${requirement.label} evidence and rerun pnpm verify:final-goal-audit.`,
  })),
  ...missingEvidenceDensity.map((item) => ({
    kind: "insufficient-evidence-density",
    area: item.id,
    blocker: `Final goal requirement has ${item.actual}/${item.minimum} required evidence links and is missing evidence kinds: ${
      item.missingKinds?.length ? item.missingKinds.join(", ") : "none"
    }.`,
    canAutoResolve: true,
    requiredAction:
      "Add independent JSON artifact, source, verifier, or test evidence as required and rerun pnpm verify:final-goal-audit.",
  })),
  ...missingEvidencePaths.map((item) => ({
    kind: "missing-or-invalid-evidence-path",
    area: item.requirementId,
    blocker: `Final goal evidence path is missing, empty, or invalid JSON: ${item.path}`,
    canAutoResolve: true,
    requiredAction:
      "Regenerate the referenced artifact or fix the evidence path, then rerun pnpm verify:final-goal-audit.",
  })),
  ...unresolvedBlockers
    .filter(
      (blocker) =>
        !isAuthenticatedPromptBlocker(blocker) &&
        !isHostSleepUnsupportedBlocker(blocker) &&
        !isReleaseSigningOperatorBlocker(blocker) &&
        !(isLiveAiChaosExternalBlocker(blocker) && liveAiChaosExternalDependencyReady),
    )
    .map((blocker) => ({
      kind: "release-blocker",
      area: blocker?.area ?? "unknown",
      blocker: blocker?.blocker ?? String(blocker),
      canAutoResolve: true,
      requiredAction: "Fix the release blocker and rerun pnpm verify:quality-score plus pnpm verify:final-goal-audit.",
    })),
];
const residualRiskRegister = {
  state: goalComplete
    ? "complete"
    : evidenceComplete && implementationFixableRisks.length === 0 && externalBlockedRisks.length > 0
      ? "blocked-by-external-gates"
      : evidenceComplete && implementationFixableRisks.length === 0 && policyBlockedRisks.length === 1
        ? "blocked-only-by-explicit-token-consent"
        : "implementation-risk-open",
  implementationFixableCount: implementationFixableRisks.length,
  policyBlockedCount: policyBlockedRisks.length,
  externalBlockedCount: externalBlockedRisks.length,
  implementationFixable: implementationFixableRisks,
  policyBlocked: policyBlockedRisks,
  externalBlocked: externalBlockedRisks,
  canContinueWithoutTokenSpend: implementationFixableRisks.length === 0 && externalBlockedRisks.length === 0,
  completionClaimAllowed: goalComplete,
};
const projectedFinalGoalEvidenceMapPoints = evidenceComplete ? finalGoalEvidenceMapMax : finalGoalEvidenceMapPoints;
const projectedTotal = (releaseScore?.total ?? 0) - finalGoalEvidenceMapPoints + projectedFinalGoalEvidenceMapPoints;
const projectedPercent = releaseScore?.max ? Math.round((projectedTotal / releaseScore.max) * 100) : 0;
const scoreSelfReferenceNote =
  "preAudit excludes the final-goal-evidence-map points that this audit artifact enables; projectedAfterEvidenceMap shows the score after rerunning pnpm verify:quality-score with this fresh audit.";

const report = {
  ok: evidenceComplete,
  status: goalComplete
    ? "complete"
    : evidenceComplete && externalBlockedRisks.length > 0
      ? "blocked-by-external-gates"
      : evidenceComplete
        ? "blocked-by-explicit-consent"
        : "blocked",
  generatedAt: new Date().toISOString(),
  localDate: currentLocalDate(),
  timeZone: LOCAL_TIME_ZONE,
  goalComplete,
  evidenceComplete,
  implementationFixableCount: residualRiskRegister.implementationFixableCount,
  policyBlockedCount: residualRiskRegister.policyBlockedCount,
  externalBlockedCount: residualRiskRegister.externalBlockedCount,
  implementationFixableRisks,
  policyBlockedRisks,
  externalBlockedRisks,
  score: {
    selfReferenceNote: scoreSelfReferenceNote,
    finalGoalEvidenceMap: {
      points: finalGoalEvidenceMapPoints,
      max: finalGoalEvidenceMapMax,
      projectedPoints: projectedFinalGoalEvidenceMapPoints,
    },
    preAudit: {
      total: releaseScore?.total ?? 0,
      max: releaseScore?.max ?? 0,
      percent: releaseScore?.score ?? 0,
      grade: releaseScore?.grade ?? "unknown",
      releaseCandidateReady: releaseScore?.releaseCandidateReady === true,
    },
    projectedAfterEvidenceMap: {
      total: projectedTotal,
      max: releaseScore?.max ?? 0,
      percent: projectedPercent,
      grade: gradeForPercent(projectedPercent),
      releaseCandidateReady: releaseScore?.releaseCandidateReady === true,
    },
  },
  requirements,
  missingRequirements: missing.map((item) => item.id),
  evidenceDensity,
  missingEvidenceDensity,
  evidencePathIntegrity,
  missingEvidencePaths,
  unresolvedBlockers,
  residualRiskRegister,
  operationalEvidence,
  nextRequiredAction: goalComplete
    ? "Goal is complete."
    : residualRiskRegister.state === "blocked-by-external-gates"
      ? `Run pnpm verify:production:suspend:native-user-cycle on this host and manually put Windows to sleep while the verifier waits, or run a real native sleep/resume cycle on a capable host; then close the evidence loop with pnpm verify:goal:operator-finish, pnpm verify:goal:finalize, pnpm verify:goal:safe, and pnpm verify:goal:closeout. If token-spend validation is also desired, set ${promptExecutionGate.requiredEnv} and ${promptExecutionGate.requiredProviderEnv}, then run ${promptExecutionGate.command}.`
      : residualRiskRegister.state === "blocked-only-by-explicit-token-consent"
        ? `Set ${promptExecutionGate.requiredEnv} and ${promptExecutionGate.requiredProviderEnv}, then run ${promptExecutionGate.command} if token-spend validation is desired.`
        : "Fix missing requirements and rerun pnpm verify:final-goal-audit.",
};

mkdirSync(dirname(OUT), { recursive: true });
rmSync(OUT, { force: true });
writeFileSync(OUT, `${JSON.stringify({ version: 1, ...report }, null, 2)}\n`);
console.log(JSON.stringify({ artifact: OUT, ...report }, null, 2));

if (!evidenceComplete) {
  process.exitCode = 1;
}
