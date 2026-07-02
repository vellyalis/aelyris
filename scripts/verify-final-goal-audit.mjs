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

function check(id, label, passed, detail, evidence, options = {}) {
  const externallyBlocked = passed !== true && options.externalBlocked === true;
  return {
    id,
    label,
    status: passed ? "proved" : externallyBlocked ? "external-blocked" : "missing",
    detail,
    evidence,
    ...(externallyBlocked
      ? {
          externalBlocker: options.externalBlocker ?? "Requirement proof is blocked by an external host gate.",
        }
      : {}),
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
  return /authenticated[-\s]?(?:ai[-\s]?cli[-\s]?)?prompt|token-spend consent/i.test(
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

function isMuxLiveRestoreHostBlocker(blocker) {
  const text = `${blocker?.area ?? ""} ${blocker?.blocker ?? blocker ?? ""}`;
  return (
    /mux-performance|mux live restore|PTY sidecar process launch|pty-sidecar-spawn/i.test(text) &&
    /environment-blocked|spawn EPERM|host process policy/i.test(text)
  );
}

function isSupplyChainEnvironmentBlocker(blocker) {
  const text = `${blocker?.area ?? ""} ${blocker?.blocker ?? blocker ?? ""}`;
  return (
    /supply-chain-audit|npm supply-chain|npm audit/i.test(text) &&
    /environment-blocked|spawn EPERM|audit unavailable/i.test(text)
  );
}

function isSupplyChainUpstreamBoundBlocker(blocker) {
  const text = `${blocker?.area ?? ""} ${blocker?.blocker ?? blocker ?? ""}`;
  return (
    /supply-chain-audit|supply-chain/i.test(text) &&
    /classified-upstream-bound|upstream-bound dependency BLOCK|upstreamBound=/i.test(text)
  );
}

function isCommandEvidenceEnvironmentBlocker(blocker) {
  const text = `${blocker?.area ?? ""} ${blocker?.blocker ?? blocker ?? ""}`;
  return (
    /command-evidence|live-command-evidence|multipane-command-evidence|recovered-command-evidence|process-reconnect-command-evidence/i.test(
      text,
    ) &&
    /environment-blocked|spawn EPERM|connect ECONNREFUSED|Cannot attach to WebView2 CDP|CDP endpoint did not respond|browserType\.launch|PowerShell failed \(null\)|No running debug\/release Aelyris\.exe/i.test(
      text,
    )
  );
}
function isChunkedOscEnvironmentBlocker(blocker) {
  const text = `${blocker?.area ?? ""} ${blocker?.blocker ?? blocker ?? ""}`;
  return (
    /chunked OSC|chunked-osc-live/i.test(text) &&
    /environment-blocked|CDP|ECONNREFUSED|Cannot attach to WebView2|browserType\.launch|spawn EPERM|No running debug\/release Aelyris\.exe/i.test(
      text,
    )
  );
}
function isNativeHwndPasteDegradedBlocker(blocker) {
  const text = `${blocker?.area ?? ""} ${blocker?.blocker ?? blocker ?? ""}`;
  return (
    /terminal-core-edge|native HWND paste|WM_PASTE/i.test(text) &&
    /WebView2\/CDP WM_PASTE path unexercised|degraded no-CDP Rust proof/i.test(text)
  );
}
function isRightRailEdgeEnvironmentBlocker(blocker) {
  const text = `${blocker?.area ?? ""} ${blocker?.blocker ?? blocker ?? ""}`;
  return /right-rail-edge/i.test(text) && /visual QA evidence|fresh visual QA evidence/i.test(text);
}

function isReleaseReadinessExternalBlocker(blocker) {
  const text = `${blocker?.area ?? ""} ${blocker?.blocker ?? blocker ?? ""}`;
  return (
    /release-readiness-aggregate|release readiness/i.test(text) &&
    /currently blocked|externally blocked|external-blocked|environment-blocked|review|release=block|spawn EPERM|CDP|ECONNREFUSED|WebView2|real Windows sleep\/resume|real OS sleep\/resume|host\/operator proof|signing\/updater|explicit token|authenticated AI CLI prompt/i.test(
      text,
    )
  );
}

function isReleaseReadinessAggregateBlocker(blocker) {
  return /release-readiness-aggregate|release readiness/i.test(`${blocker?.area ?? ""} ${blocker?.blocker ?? blocker ?? ""}`);
}

function isReleaseSigningOperatorBlocker(blocker) {
  return /release-doctor.*signing\/updater|signing\/updater warnings|regenerate signatures\/latest\.json|updater signatures|latest\.json/i.test(
    `${blocker?.area ?? ""} ${blocker?.blocker ?? blocker ?? ""}`,
  );
}

function isDistributionSigningOperatorBlocker(blocker) {
  return /distribution|signed exe|signed distribution|installer artifacts|signing material|TAURI_SIGNING/i.test(
    `${blocker?.area ?? ""} ${blocker?.blocker ?? blocker ?? ""}`,
  );
}

function isRightRailGoalTrackEnvironmentBlocker(blocker) {
  return /right-rail-goal-track|right rail Tauri goal-track/i.test(
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
const releaseReadinessAggregatePath = ".codex-auto/quality/release-readiness-aggregate.json";
const nativeBoundaryPath = ".codex-auto/quality/native-boundary-contract.json";
const commandCenterPath = ".codex-auto/production-smoke/command-center-scenario.json";
const launchPlannerPath = ".codex-auto/production-smoke/ai-cli-launch-planner.json";
const commandRecoveryPath = ".codex-auto/production-smoke/command-recovery-contract.json";
const chunkedOscLivePath = ".codex-auto/production-smoke/chunked-osc-live.json";
const chunkedOscLiveEnvironmentBlockedPath = ".codex-auto/production-smoke/chunked-osc-live.environment-blocked.json";
const nativeHwndPasteLivePath = ".codex-auto/production-smoke/native-hwnd-paste-live.json";
const rightRailScalePath = ".codex-auto/performance/right-rail-scale-contract.json";
const rightRailInformationDensityPath = ".codex-auto/quality/right-rail-information-density-contract.json";
const rightRailStaleUrlTruthPath = ".codex-auto/production-smoke/right-rail-stale-url-truth.json";
const rightRailGoalTrackTauriEnvironmentBlockedPath =
  ".codex-auto/production-smoke/right-rail-goal-track-tauri.json.environment-blocked.json";
const rightRailEdgeFeedbackPath = ".codex-auto/production-smoke/right-rail-edge-feedback.json";
const rightRailEdgeFeedbackEnvironmentBlockedPath =
  ".codex-auto/production-smoke/right-rail-edge-feedback.environment-blocked.json";
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
const muxLiveRestorePath = ".codex-auto/performance/mux-live-restore-smoke.json";
const processReconnectCommandEvidencePath = ".codex-auto/production-smoke/process-reconnect-command-evidence.json";
const processReconnectCommandEvidenceEnvironmentBlockedPath =
  ".codex-auto/production-smoke/process-reconnect-command-evidence.json.environment-blocked.json";
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
  "README.md",
  "docs/README.md",
  "docs/PUBLICATION_READINESS.md",
  "docs/requirements.md",
  "docs/specs/README.md",
  "docs/specs/AELYRIS_REQUIREMENTS_SPEC_DESIGN_TRACEABILITY_2026-06-27.md",
];
const detailedCurrentStateDocPaths = new Set([
  "docs/PUBLICATION_READINESS.md",
  "docs/specs/AELYRIS_REQUIREMENTS_SPEC_DESIGN_TRACEABILITY_2026-06-27.md",
]);
const releaseScoreSourcePaths = [
  "package.json",
  "vite.config.ts",
  "vitest.config.ts",
  "scripts/score-release-quality.mjs",
  "scripts/verify-final-goal-audit.mjs",
  "scripts/verify-final-goal-safe.mjs",
  "scripts/verify-chunked-osc-live.mjs",
  "scripts/verify-native-hwnd-paste-live.mjs",
  "scripts/verify-mux-live-restore.mjs",
  "scripts/verify-process-reconnect-command-evidence.mjs",
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
  "src/shared/themes/moods/material.ts",
  "src/shared/themes/moods/tokens.ts",
  "src/shared/themes/moods/surfaces.ts",
  "src/features/settings/Settings.tsx",
  "src/styles/global.css",
  "src-tauri/Cargo.toml",
  "src-tauri/src/lib.rs",
  "src-tauri/src/pty_sidecar.rs",
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
  chunkedOscLiveEnvironmentBlockedPath,
  nativeHwndPasteLivePath,
  rightRailScalePath,
  rightRailInformationDensityPath,
  rightRailStaleUrlTruthPath,
  liveAiCliPostLaunchChaosPath,
  nativeAiCliPostLaunchChaosPath,
  tauriRuntimeHygienePath,
  productionBundleBudgetPath,
  supplyChainAuditPath,
  muxLiveRestorePath,
  processReconnectCommandEvidencePath,
  processReconnectCommandEvidenceEnvironmentBlockedPath,
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
const releaseReadinessAggregate = readJson(releaseReadinessAggregatePath);
const nativeBoundary = readJson(nativeBoundaryPath);
const commandCenter = readJson(commandCenterPath);
const launchPlanner = readJson(launchPlannerPath);
const commandRecovery = readJson(commandRecoveryPath);
const chunkedOscLive = readJson(chunkedOscLivePath);
const chunkedOscLiveEnvironmentBlocked = readJson(chunkedOscLiveEnvironmentBlockedPath);
const nativeHwndPasteLive = readJson(nativeHwndPasteLivePath);
const rightRailScale = readJson(rightRailScalePath);
const rightRailInformationDensity = readJson(rightRailInformationDensityPath);
const rightRailStaleUrlTruth = readJson(rightRailStaleUrlTruthPath);
const rightRailGoalTrackTauriEnvironmentBlocked = readJson(rightRailGoalTrackTauriEnvironmentBlockedPath);
const rightRailEdgeFeedbackEnvironmentBlocked = readJson(rightRailEdgeFeedbackEnvironmentBlockedPath);
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
const muxLiveRestore = readJson(muxLiveRestorePath);
const processReconnectCommandEvidenceEnvironmentBlocked = readJson(
  processReconnectCommandEvidenceEnvironmentBlockedPath,
);
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
    consentProviderRequired: text?.includes("AELYRIS_AUTH_PROMPT_PROVIDER=codex|claude|gemini") === true,
    noStaleLegacyScoreClaim: !/100\/116/.test(text ?? ""),
    noStaleReleaseReadyClaim:
      releaseScore?.releaseCandidateReady === true ? true : !/releaseCandidateReady=true/.test(text ?? ""),
  };
  const requiredChecks = [
    "exists",
    "updatedForCurrentDate",
    "currentScorePercent",
    "currentScoreTotal",
    "currentReleaseCandidateState",
    "noStaleLegacyScoreClaim",
    "noStaleReleaseReadyClaim",
    ...(detailedCurrentStateDocPaths.has(path)
      ? ["consentGateNamed", "consentPacketNamed", "consentProviderRequired"]
      : []),
  ];
  return {
    path,
    checks,
    requiredChecks,
    ok: requiredChecks.every((id) => checks[id] === true),
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
const releaseScoreFresh = mtime(releaseScorePath) + 5_000 >= (latestReleaseScoreDependency?.mtimeMs ?? 0);
const releaseScoreMeetsCandidateThreshold = scoreProjectedPercentWithEvidenceMap >= 92;
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
const terminalCoreEdgeScore = scoreById(releaseScore, "terminal-core-edge");
const muxPerformanceScore = scoreById(releaseScore, "mux-performance");
const processReconnectCommandEvidenceScore = scoreById(releaseScore, "process-reconnect-command-evidence");
const chunkedOscLiveContractReady =
  chunkedOscLive?.ok === true &&
  chunkedOscLive?.status === "pass-current-chunked-osc-live-contract" &&
  chunkedOscLiveChecks.requiredCaseCountCovered === true &&
  chunkedOscLiveChecks.allCasesPassed === true &&
  chunkedOscLiveChecks.shellsCovered === true &&
  chunkedOscLiveChecks.tinyFixturePassedForEveryShell === true &&
  chunkedOscLiveChecks.largeFixturePassedForEveryShell === true &&
  chunkedOscLiveChecks.pngSignatureVerified === true;
const nativeHwndPasteLiveStrictReady =
  nativeHwndPasteLive?.ok === true &&
  nativeHwndPasteLive?.status === "pass-current-native-hwnd-paste-contract" &&
  nativeHwndPasteLiveChecks.wmPasteSentToNativeHwnd === true &&
  nativeHwndPasteLiveChecks.singleLineLfNormalizedAndExecuted === true &&
  nativeHwndPasteLiveChecks.destructivePasteBlockedBeforePty === true &&
  nativeHwndPasteLiveChecks.multilinePasteBlockedBeforePty === true;
const nativeHwndPasteLiveDegradedReady =
  nativeHwndPasteLive?.ok === true &&
  nativeHwndPasteLive?.status === "pass-degraded-no-cdp" &&
  nativeHwndPasteLive?.degraded === true &&
  nativeHwndPasteLiveChecks.nativeNoCdpProof === true &&
  nativeHwndPasteLiveChecks.aelyrisNativePasteGuardProof === true &&
  nativeHwndPasteLiveChecks.noWebView === true &&
  nativeHwndPasteLiveChecks.noReact === true &&
  nativeHwndPasteLiveChecks.noCdp === true &&
  nativeHwndPasteLiveChecks.wmPasteSentToNativeHwnd === true &&
  nativeHwndPasteLiveChecks.singleLineLfNormalizedAndExecuted === true &&
  nativeHwndPasteLiveChecks.destructivePasteBlockedBeforePty === true &&
  nativeHwndPasteLiveChecks.multilinePasteBlockedBeforePty === true;
const nativeHwndPasteLiveContractReady = nativeHwndPasteLiveStrictReady || nativeHwndPasteLiveDegradedReady;
const chunkedOscEnvironmentBlockText = [
  ...(Array.isArray(chunkedOscLiveEnvironmentBlocked?.errors) ? chunkedOscLiveEnvironmentBlocked.errors : []),
  chunkedOscLiveEnvironmentBlocked?.stderrTail,
  chunkedOscLiveEnvironmentBlocked?.nextRequiredAction,
].join("\n");
const chunkedOscEnvironmentSourceFiles = Array.isArray(chunkedOscLiveEnvironmentBlocked?.sourceContract?.files)
  ? chunkedOscLiveEnvironmentBlocked.sourceContract.files
  : [];
const chunkedOscLiveHostBlockedEvidenceReady =
  chunkedOscLiveEnvironmentBlocked?.status === "environment-blocked" &&
  chunkedOscLiveEnvironmentBlocked?.preservesPrimaryArtifact === true &&
  chunkedOscLiveEnvironmentBlocked?.primaryArtifact?.exists === true &&
  chunkedOscLiveEnvironmentBlocked?.primaryArtifact?.ok === true &&
  chunkedOscLiveContractReady &&
  chunkedOscEnvironmentSourceFiles.length >= 5 &&
  chunkedOscEnvironmentSourceFiles.every((file) => file?.exists === true) &&
  /CDP|ECONNREFUSED|Cannot attach to WebView2|connect ECONNREFUSED/i.test(chunkedOscEnvironmentBlockText) &&
  mtime(chunkedOscLiveEnvironmentBlockedPath) + 5_000 >=
    Math.max(
      mtime("scripts/verify-chunked-osc-live.mjs"),
      mtime("scripts/aelyris-imgcat.ps1"),
      mtime("scripts/aelyris-imgcat.sh"),
      mtime("e2e/fixtures/inline-image-1x1.png"),
      mtime("e2e/fixtures/inline-image-32x32.png"),
    );
const muxLiveRestoreHostBlockedEvidenceReady =
  muxLiveRestore?.status === "environment-blocked" &&
  muxLiveRestore?.hostBlocked === true &&
  Array.isArray(muxLiveRestore?.errors) &&
  muxLiveRestore.errors.some((error) =>
    /spawn EPERM|host process policy|PTY sidecar process launch/i.test(String(error)),
  ) &&
  mtime(muxLiveRestorePath) + 5_000 >= mtime("scripts/verify-mux-live-restore.mjs");
const processReconnectEnvironmentBlockText = [
  ...(Array.isArray(processReconnectCommandEvidenceEnvironmentBlocked?.errors)
    ? processReconnectCommandEvidenceEnvironmentBlocked.errors
    : []),
  processReconnectCommandEvidenceEnvironmentBlocked?.stderrTail,
  processReconnectCommandEvidenceEnvironmentBlocked?.nextRequiredAction,
].join("\n");
const processReconnectCommandEvidenceHostBlockedReady =
  processReconnectCommandEvidenceEnvironmentBlocked?.status === "environment-blocked" &&
  processReconnectCommandEvidenceEnvironmentBlocked?.preservesPrimaryArtifact === true &&
  /PowerShell failed|spawnSync powershell\.exe EPERM|spawn EPERM/i.test(processReconnectEnvironmentBlockText) &&
  mtime(processReconnectCommandEvidenceEnvironmentBlockedPath) + 5_000 >=
    mtime("scripts/verify-process-reconnect-command-evidence.mjs");
const supplyChainEnvironmentBlockedEvidenceReady =
  supplyChainAudit?.status === "environment-blocked" &&
  supplyChainAudit?.npm?.ok === false &&
  /spawn EPERM|audit unavailable/i.test(String(supplyChainAudit?.npm?.unavailableReason ?? "")) &&
  supplyChainAudit?.cargo?.ok === true &&
  supplyChainAudit?.cargo?.knownVulnerabilities === 0 &&
  supplyChainAudit?.cargo?.reachability?.runtimeCriticalWarningCount === 0 &&
  mtime(supplyChainAuditPath) + 5_000 >= mtime("scripts/verify-supply-chain.mjs");
const supplyChainUpstreamBoundEvidenceReady =
  supplyChainAudit?.status === "classified-upstream-bound" &&
  supplyChainAudit?.npm?.ok === true &&
  supplyChainAudit?.npm?.knownVulnerabilities === 0 &&
  typeof supplyChainAudit?.cargo?.knownVulnerabilities === "number" &&
  supplyChainAudit.cargo.knownVulnerabilities > 0 &&
  supplyChainAudit?.cargo?.reachability?.runtimeCriticalWarningCount === 0 &&
  supplyChainAudit?.stackRiskClassification?.ok === true &&
  supplyChainAudit?.stackRiskClassification?.releaseBlockerCount === 0 &&
  supplyChainAudit?.stackRiskClassification?.unclassifiedCount === 0 &&
  (supplyChainAudit?.stackRiskClassification?.upstreamBoundBlockerCount ?? 0) > 0 &&
  mtime(supplyChainAuditPath) + 5_000 >=
    Math.max(
      mtime("scripts/verify-supply-chain.mjs"),
      mtime("scripts/verify-stack-risk.mjs"),
      mtime("src-tauri/Cargo.toml"),
      mtime("src-tauri/Cargo.lock"),
      mtime("src-tauri/pty-server/Cargo.toml"),
      mtime("src-tauri/pty-server/Cargo.lock"),
    );
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
const distributionSigningOperatorBlockers = productBlockers.filter((item) =>
  isDistributionSigningOperatorBlocker(item),
);
const rightRailEdgeEnvironmentBlockers = productBlockers.filter((item) => isRightRailEdgeEnvironmentBlocker(item));
const releaseSigningOperatorHandoffReady =
  releaseSigningOperatorHandoff?.ok === true &&
  ["ready-for-release-signing-operator", "release-signing-complete"].includes(releaseSigningOperatorHandoff?.status) &&
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
const distributionSigningOperatorGateReady =
  distributionSigningOperatorBlockers.length >= 1 && releaseSigningOperatorHandoffReady;
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
const rightRailStaleUrlTruthCovered = rightRailStaleUrlTruthReady || nativeAiCliPostLaunchReady;
const rightRailInformationDensityReady =
  rightRailInformationDensity?.ok === true &&
  rightRailInformationDensity?.status === "pass-current-right-rail-information-density-contract" &&
  rightRailInformationDensity?.essentialFirst === true &&
  rightRailInformationDensity?.defaultDrawerCount >= 4 &&
  rightRailInformationDensity?.visiblePrimaryCount <= 2 &&
  rightRailInformationDensity?.conditionalPrimaryMax <= 3 &&
  Array.isArray(rightRailInformationDensity?.failedChecks) &&
  rightRailInformationDensity.failedChecks.length === 0;
const rightRailEdgeEnvironmentBlockText = [
  ...(Array.isArray(rightRailEdgeFeedbackEnvironmentBlocked?.errors)
    ? rightRailEdgeFeedbackEnvironmentBlocked.errors
    : []),
  rightRailEdgeFeedbackEnvironmentBlocked?.nextRequiredAction,
].join("\n");
const rightRailEdgeVisualHostBlockedEvidenceReady =
  rightRailEdgeFeedbackEnvironmentBlocked?.status === "environment-blocked" &&
  rightRailEdgeFeedbackEnvironmentBlocked?.preservesPrimaryArtifact === true &&
  rightRailEdgeFeedbackEnvironmentBlocked?.primaryArtifact?.exists === true &&
  /browserType\.launch: spawn EPERM|chrome-headless-shell\.exe|spawn EPERM|504 \(Outdated Optimize Dep\)|Outdated Optimize Dep/i.test(
    rightRailEdgeEnvironmentBlockText,
  ) &&
  mtime(rightRailEdgeFeedbackEnvironmentBlockedPath) + 5_000 >=
    Math.max(
      mtime("scripts/verify-right-rail-edge-feedback.mjs"),
      mtime("src/App.tsx"),
      mtime("src/styles/global.css"),
      mtime("src/shared/lib/rightRailAdvisor.ts"),
      mtime("src/__tests__/rightRailAdvisor.test.ts"),
    );
const rightRailGoalTrackTauriHostBlockedEvidenceReady =
  rightRailGoalTrackTauriEnvironmentBlocked?.status === "environment-blocked" &&
  rightRailGoalTrackTauriEnvironmentBlocked?.preservesPrimaryArtifact === true &&
  /Cannot attach to WebView2 CDP|ECONNREFUSED|connect ECONNREFUSED|browserType\.connectOverCDP/i.test(
    [
      ...(Array.isArray(rightRailGoalTrackTauriEnvironmentBlocked?.errors)
        ? rightRailGoalTrackTauriEnvironmentBlocked.errors
        : []),
      rightRailGoalTrackTauriEnvironmentBlocked?.nextRequiredAction,
    ].join("\n"),
  ) &&
  mtime(rightRailGoalTrackTauriEnvironmentBlockedPath) + 5_000 >=
    Math.max(mtime("scripts/verify-right-rail-goal-track-tauri.mjs"), mtime("scripts/score-release-quality.mjs"));
const rightRailCommandCenterComplete =
  releaseScoreFresh &&
  scorePass(releaseScore, "right-rail-smoke") &&
  scorePass(releaseScore, "right-rail-edge") &&
  scorePass(releaseScore, "right-rail-scale-contract") &&
  scorePass(releaseScore, "right-rail-goal-track") &&
  rightRailInformationDensityReady &&
  actionStateCoverage.covered >= 12 &&
  (twentySessionStress.sessions >= 20 || twentySessionStress.boundedActionStack === true) &&
  (reviewQueueScale.files >= 500 || reviewQueueScale.boundedVisibleRows === true);
const rightRailCommandCenterExternalBlocked =
  releaseScoreFresh &&
  scorePass(releaseScore, "right-rail-smoke") &&
  scorePass(releaseScore, "right-rail-scale-contract") &&
  (scorePass(releaseScore, "right-rail-edge") || rightRailEdgeVisualHostBlockedEvidenceReady) &&
  (scorePass(releaseScore, "right-rail-goal-track") || rightRailGoalTrackTauriHostBlockedEvidenceReady) &&
  rightRailInformationDensityReady &&
  rightRailStaleUrlTruthCovered &&
  actionStateCoverage.covered >= 12 &&
  (twentySessionStress.sessions >= 20 || twentySessionStress.boundedActionStack === true) &&
  (reviewQueueScale.files >= 500 || reviewQueueScale.boundedVisibleRows === true);
const liveAiChaosExternalDependencyReady =
  !nativeAiCliPostLaunchReady &&
  liveAiCliPostLaunchChaos?.status === "external_dependency" &&
  /WebView2 CDP endpoint/i.test(String(liveAiCliPostLaunchChaos?.dependency ?? "")) &&
  /Cannot attach to WebView2 CDP|ECONNREFUSED|TCP timeout|connectOverCDP/i.test(
    String(liveAiCliPostLaunchChaos?.error ?? ""),
  ) &&
  liveAiChaosBlockers.length > 0;
const liveAiChaosExternalGateEvidenceReady =
  liveAiChaosExternalDependencyReady ||
  (liveAiChaosBlockers.length > 0 && nativeAiCliPostLaunchReady && rightRailStaleUrlTruthCovered);
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
    "AELYRIS_AUTH_PROMPT_CONSENT=I_UNDERSTAND_THIS_MAY_SPEND_TOKENS" &&
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
  ["ready-for-external-operator-gates", "blocked-by-host-sleep-unsupported"].includes(externalGateReadiness?.status) &&
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
const releaseOperationsExternalGateEvidenceReady =
  promptConsentBoundaryReady &&
  promptProviderGuardReady &&
  promptProviderMatrixReady &&
  promptConsentPacketReady &&
  goalAntiStallContractReady &&
  productionBundleBudget?.ok === true &&
  (externalGateReadinessSourceReady ||
    (externalGateReadiness?.checks?.noUnsafeConsentEnvPresent === true &&
      externalGateReadiness?.checks?.noOsSleepEnvPresent === true));
const promptExecutionGate = {
  command: authenticatedPrompt?.nextCommand?.command ?? "pnpm verify:terminal:authenticated-ai-cli-prompt",
  requiredEnv: promptChecks.requiredEnv ?? "AELYRIS_AUTH_PROMPT_CONSENT=I_UNDERSTAND_THIS_MAY_SPEND_TOKENS",
  requiredProviderEnv: "AELYRIS_AUTH_PROMPT_PROVIDER=codex|claude|gemini",
  env: authenticatedPrompt?.nextCommand?.env ?? {},
  provider:
    authenticatedPrompt?.provider ?? authenticatedPrompt?.nextCommand?.env?.AELYRIS_AUTH_PROMPT_PROVIDER ?? "unknown",
  cdp: authenticatedPrompt?.nextCommand?.env?.AELYRIS_TAURI_CDP ?? authenticatedPrompt?.cdp ?? null,
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
const releaseReadinessClaims = releaseReadinessAggregate?.claims ?? {};
const releaseReadinessNonPassClaims = Object.entries(releaseReadinessClaims).filter(
  ([, status]) => status !== "pass",
);
const nonReleaseReadinessBlockers = productBlockers.filter((blocker) => !isReleaseReadinessAggregateBlocker(blocker));
const nonReleaseReadinessBlockersExternalOrPolicyOnly = nonReleaseReadinessBlockers.every(
  (blocker) =>
    isAuthenticatedPromptBlocker(blocker) ||
    isHostSleepUnsupportedBlocker(blocker) ||
    isLiveAiChaosExternalBlocker(blocker) ||
    isRightRailEdgeEnvironmentBlocker(blocker) ||
    isNativeHwndPasteDegradedBlocker(blocker) ||
    isMuxLiveRestoreHostBlocker(blocker) ||
    isSupplyChainEnvironmentBlocker(blocker) ||
    isSupplyChainUpstreamBoundBlocker(blocker) ||
    isCommandEvidenceEnvironmentBlocker(blocker) ||
    isChunkedOscEnvironmentBlocker(blocker) ||
    isReleaseSigningOperatorBlocker(blocker) ||
    isDistributionSigningOperatorBlocker(blocker) ||
    isRightRailGoalTrackEnvironmentBlocker(blocker),
);
const releaseReadinessExternalOrReviewReady =
  releaseReadinessAggregate != null &&
  ["block", "external-blocked", "review"].includes(releaseReadinessAggregate?.status) &&
  releaseReadinessNonPassClaims.length > 0 &&
  releaseReadinessNonPassClaims.every(
    ([id, status]) => status === "review" || status === "external-blocked" || (id === "release" && status === "block"),
  ) &&
  nonReleaseReadinessBlockersExternalOrPolicyOnly;
const unresolvedBlockersCanBeExternallyClosed =
  productBlockers.length > 0 &&
  productBlockers.every(
    (blocker) =>
      isAuthenticatedPromptBlocker(blocker) ||
      isHostSleepUnsupportedBlocker(blocker) ||
      isLiveAiChaosExternalBlocker(blocker) ||
      isRightRailEdgeEnvironmentBlocker(blocker) ||
      isNativeHwndPasteDegradedBlocker(blocker) ||
      isMuxLiveRestoreHostBlocker(blocker) ||
      isSupplyChainEnvironmentBlocker(blocker) ||
      isSupplyChainUpstreamBoundBlocker(blocker) ||
      isCommandEvidenceEnvironmentBlocker(blocker) ||
      isChunkedOscEnvironmentBlocker(blocker) ||
      isReleaseSigningOperatorBlocker(blocker) ||
      isDistributionSigningOperatorBlocker(blocker) ||
      isRightRailGoalTrackEnvironmentBlocker(blocker) ||
      (isReleaseReadinessAggregateBlocker(blocker) && releaseReadinessExternalOrReviewReady),
  ) &&
  (hostSleepBlockers.length === 0 || realSuspendExternalBlockedEvidenceReady) &&
  (liveAiChaosBlockers.length === 0 || liveAiChaosExternalGateEvidenceReady) &&
  (rightRailEdgeEnvironmentBlockers.length === 0 || rightRailEdgeVisualHostBlockedEvidenceReady) &&
  (!productBlockers.some((blocker) => isRightRailGoalTrackEnvironmentBlocker(blocker)) ||
    rightRailGoalTrackTauriHostBlockedEvidenceReady) &&
  (productBlockers.some((blocker) => isNativeHwndPasteDegradedBlocker(blocker))
    ? nativeHwndPasteLiveDegradedReady
    : true) &&
  (productBlockers.some((blocker) => isAuthenticatedPromptBlocker(blocker)) ? promptConsentPacketReady : true) &&
  (distributionSigningOperatorBlockers.length === 0 || distributionSigningOperatorGateReady);
const releaseOpsBlockedByExternalGates =
  releaseScore?.releaseCandidateReady === false && unresolvedBlockersCanBeExternallyClosed;
const operationalEvidenceReadiness = {
  runtimeHygieneOperationallyClean,
  goalAntiStallContractReady,
  currentStateDocsFresh,
  releaseOpsComplete,
  promptConsentBoundaryReady,
  promptProviderGuardReady,
  promptProviderMatrixReady,
  promptConsentPacketReady,
  externalGateReadinessSourceReady,
  hostSleepReady: hostSleepBlockers.length === 0 || realSuspendExternalBlockedEvidenceReady,
  liveAiChaosReady: liveAiChaosBlockers.length === 0 || liveAiChaosExternalGateEvidenceReady,
};
const operationalEvidenceReady =
  operationalEvidenceReadiness.runtimeHygieneOperationallyClean &&
  operationalEvidenceReadiness.goalAntiStallContractReady &&
  operationalEvidenceReadiness.currentStateDocsFresh &&
  (releaseOpsComplete ||
    (operationalEvidenceReadiness.promptConsentBoundaryReady &&
      operationalEvidenceReadiness.promptProviderGuardReady &&
      operationalEvidenceReadiness.promptProviderMatrixReady &&
      operationalEvidenceReadiness.promptConsentPacketReady &&
      operationalEvidenceReadiness.externalGateReadinessSourceReady &&
      operationalEvidenceReadiness.hostSleepReady &&
      operationalEvidenceReadiness.liveAiChaosReady));
const operationalEvidence = {
  ready: operationalEvidenceReady,
  readiness: operationalEvidenceReadiness,
  releaseScoreFreshness: {
    fresh: releaseScoreFresh,
    projectedPercentWithEvidenceMap: scoreProjectedPercentWithEvidenceMap,
    releaseCandidateThresholdMet: releaseScoreMeetsCandidateThreshold,
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
    status: supplyChainAudit?.status ?? "missing",
    classifiedUpstreamBound: supplyChainUpstreamBoundEvidenceReady,
    stackRiskClassification: supplyChainAudit?.stackRiskClassification ?? null,
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

const rustNativeTerminalCoreExternalBlocked =
  releaseScoreFresh &&
  !scorePass(releaseScore, "terminal-core-edge") &&
  (terminalCoreEdgeScore?.points ?? 0) >= 8 &&
  scorePass(releaseScore, "terminal-render-fidelity") &&
  scorePass(releaseScore, "native-boundary-contract") &&
  scorePass(releaseScore, "native-ime") &&
  scorePass(releaseScore, "scrollback") &&
  nativeBoundary?.ok === true &&
  nativeBoundaryIds.has("native-input-rust-host") &&
  nativeBoundaryIds.has("webview-ime-fallback-contained") &&
  nativeBoundaryIds.has("clipboard-native-first") &&
  chunkedOscLiveContractReady &&
  nativeHwndPasteLiveContractReady &&
  nativeHwndPasteLiveDegradedReady;
const rustMuxDaemonBoundaryExternalBlocked =
  releaseScoreFresh &&
  scorePass(releaseScore, "mux-performance") &&
  !scorePass(releaseScore, "process-reconnect-command-evidence") &&
  (processReconnectCommandEvidenceScore?.points ?? 0) === 0 &&
  nativeBoundaryIds.has("mux-ui-rust-owned") &&
  nativeBoundaryIds.has("sidecar-command-session-boundary") &&
  nativeBoundaryIds.has("sidecar-command-session-artifact") &&
  processReconnectCommandEvidenceHostBlockedReady;
const aiCliLaunchPlannerCoreReady =
  releaseScoreFresh &&
  scorePass(releaseScore, "ai-cli-launch-planner") &&
  scorePass(releaseScore, "authenticated-ai-cli-preflight-matrix") &&
  nativeAiCliPostLaunchReady &&
  rightRailStaleUrlTruthCovered &&
  promptConsentPacketReady &&
  promptProviderGuardReady &&
  promptProviderMatrixReady &&
  launchPlanner?.ok === true &&
  launchChecks.planReady === true &&
  launchChecks.contextPackReady === true &&
  launchChecks.preflightReady === true &&
  launchChecks.promptContractReady === true &&
  launchPlan.recommendedBackend === "sidecar-command-session" &&
  launchPlan.trace?.recommendedBackend === "sidecar-command-session";
const aiCliLaunchPlannerExternalBlocked =
  aiCliLaunchPlannerCoreReady &&
  (!scorePass(releaseScore, "authenticated-ai-cli-preflight-gate") ||
    !scorePass(releaseScore, "live-ai-cli-post-launch-chaos"));
const releaseOperationsProofComplete =
  releaseScoreFresh &&
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
  (releaseOpsBlockedByConsent || releaseOpsBlockedByExternalGates || releaseOpsComplete);
const releaseOperationsProofExternalBlocked =
  releaseScoreFresh &&
  !releaseOperationsProofComplete &&
  (scorePass(releaseScore, "release-doctor") || releaseDoctorOperatorGateReady) &&
  (scorePass(releaseScore, "supply-chain-audit") ||
    supplyChainEnvironmentBlockedEvidenceReady ||
    supplyChainUpstreamBoundEvidenceReady) &&
  (scorePass(releaseScore, "distribution") || distributionSigningOperatorGateReady) &&
  scorePass(releaseScore, "frontend-bundle-budget") &&
  scorePass(releaseScore, "test-runtime-hygiene") &&
  scorePass(releaseScore, "risk-register") &&
  (scorePass(releaseScore, "real-os-soak") || realSuspendExternalBlockedEvidenceReady) &&
  scorePass(releaseScore, "tauri-runtime-hygiene") &&
  (scorePass(releaseScore, "authenticated-ai-cli-preflight-gate") ||
    (promptConsentBoundaryReady && promptProviderGuardReady && promptProviderMatrixReady && promptConsentPacketReady)) &&
  releaseOperationsExternalGateEvidenceReady &&
  (releaseSigningOperatorBlockers.length === 0 || releaseDoctorOperatorGateReady) &&
  (distributionSigningOperatorBlockers.length === 0 || distributionSigningOperatorGateReady) &&
  (scorePass(releaseScore, "supply-chain-audit") ||
    supplyChainEnvironmentBlockedEvidenceReady ||
    supplyChainUpstreamBoundEvidenceReady);

const requirements = [
  check(
    "rust-native-terminal-core",
    "Rust native terminal core",
    releaseScoreFresh &&
      scorePass(releaseScore, "terminal-core-edge") &&
      scorePass(releaseScore, "terminal-render-fidelity") &&
      scorePass(releaseScore, "native-boundary-contract") &&
      scorePass(releaseScore, "native-ime") &&
      scorePass(releaseScore, "scrollback") &&
      nativeBoundary?.ok === true &&
      nativeBoundaryIds.has("native-input-rust-host") &&
      nativeBoundaryIds.has("webview-ime-fallback-contained") &&
      nativeBoundaryIds.has("clipboard-native-first") &&
      chunkedOscLiveContractReady &&
      nativeHwndPasteLiveContractReady,
    "Rust-owned input, native IME, persistent scrollback, guarded clipboard, native HWND paste, chunked OSC inline image handling, and crisp terminal text rendering are proven by fresh release evidence.",
    [
      releaseScorePath,
      nativeBoundaryPath,
      chunkedOscLivePath,
      chunkedOscLiveEnvironmentBlockedPath,
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
    {
      externalBlocked: rustNativeTerminalCoreExternalBlocked,
      externalBlocker:
        "Rust native terminal source, native boundary, IME, scrollback, HWND paste, and last chunked OSC contract evidence are present, but the fresh chunked OSC live proof is blocked by WebView2/CDP availability on this host.",
    },
  ),
  check(
    "rust-mux-daemon-boundary",
    "Rust mux and daemon boundary",
    releaseScoreFresh &&
      scorePass(releaseScore, "mux-performance") &&
      scorePass(releaseScore, "process-reconnect-command-evidence") &&
      nativeBoundaryIds.has("mux-ui-rust-owned") &&
      nativeBoundaryIds.has("sidecar-command-session-boundary") &&
      nativeBoundaryIds.has("sidecar-command-session-artifact"),
    "Mux restore/performance, process reconnect, sidecar command sessions, and UI-to-mux ownership are proven.",
    [
      releaseScorePath,
      nativeBoundaryPath,
      muxLiveRestorePath,
      processReconnectCommandEvidencePath,
      processReconnectCommandEvidenceEnvironmentBlockedPath,
      "scripts/verify-mux-live-restore.mjs",
      "scripts/verify-process-reconnect-command-evidence.mjs",
      "src-tauri/src/pty/registry.rs",
      "src/features/terminal/pane-tree/usePaneTree.ts",
      "src/__tests__/paneTreePersistence.test.ts",
    ],
    {
      externalBlocked: rustMuxDaemonBoundaryExternalBlocked,
      externalBlocker:
        "Rust mux ownership and sidecar command-session boundary contracts are present, but mux live restore and process reconnect command evidence are blocked by host process policy on this machine.",
    },
  ),
  check(
    "right-rail-command-center",
    "Right rail Command Center edge",
    rightRailCommandCenterComplete,
    "The rail has ranked actions, essential-first information density, scale coverage, final-goal visibility, and bounded large-review behavior.",
    [
      releaseScorePath,
      rightRailScalePath,
      rightRailInformationDensityPath,
      rightRailEdgeFeedbackPath,
      rightRailEdgeFeedbackEnvironmentBlockedPath,
      "src/shared/lib/rightRailGoalTrack.ts",
      "src/__tests__/rightRailGoalTrack.test.ts",
    ],
    {
      externalBlocked: rightRailCommandCenterExternalBlocked,
      externalBlocker:
        "Right rail Command Center source, scale, density, and goal-track contracts are present, but fresh live visual QA is blocked by Playwright/Chromium launch policy on this host.",
    },
  ),
  check(
    "fallback-and-stale-visibility",
    "Fallback and stale state visibility",
    releaseScoreFresh &&
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
    releaseScoreFresh &&
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
    releaseScoreFresh &&
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
    {
      externalBlocked: aiCliLaunchPlannerExternalBlocked,
      externalBlocker:
        "AI CLI planner, provider matrix, native-first post-launch chaos, and prompt consent packet are current, but the full authenticated prompt/live WebView2 proof remains gated by token-spend/provider/host execution.",
    },
  ),
  check(
    "theme-customization",
    "Customization and visual preset isolation",
    releaseScoreFresh &&
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
      "src/shared/themes/moods/material.ts",
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
    releaseOperationsProofComplete,
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
    {
      externalBlocked: releaseOperationsProofExternalBlocked,
      externalBlocker:
        "Release operations contracts are present, but signing/updater, supply-chain upstream dependency movement, real OS sleep, and explicit-consent/live host gates require upstream/operator/host execution before a release claim is allowed.",
    },
  ),
];

const missing = requirements.filter((item) => item.status === "missing");
const externallyBlockedRequirements = requirements.filter((item) => item.status === "external-blocked");
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
      isReleaseSigningOperatorBlocker(blocker) ||
      isDistributionSigningOperatorBlocker(blocker) ||
      isMuxLiveRestoreHostBlocker(blocker) ||
      isSupplyChainEnvironmentBlocker(blocker) ||
      isSupplyChainUpstreamBoundBlocker(blocker) ||
      isChunkedOscEnvironmentBlocker(blocker) ||
      isNativeHwndPasteDegradedBlocker(blocker) ||
      isRightRailEdgeEnvironmentBlocker(blocker) ||
      isRightRailGoalTrackEnvironmentBlocker(blocker) ||
      isCommandEvidenceEnvironmentBlocker(blocker) ||
      (isReleaseReadinessExternalBlocker(blocker) && releaseReadinessExternalOrReviewReady),
  ) &&
    (hostSleepBlockers.length === 0 || realSuspendExternalBlockedEvidenceReady) &&
    (liveAiChaosBlockers.length === 0 || liveAiChaosExternalGateEvidenceReady) &&
    (distributionSigningOperatorBlockers.length === 0 || distributionSigningOperatorGateReady) &&
    (!unresolvedBlockers.some((blocker) => isMuxLiveRestoreHostBlocker(blocker)) ||
      (muxLiveRestore?.status === "environment-blocked" && muxLiveRestore?.hostBlocked === true)) &&
    (!unresolvedBlockers.some((blocker) => isSupplyChainEnvironmentBlocker(blocker)) ||
      supplyChainEnvironmentBlockedEvidenceReady) &&
    (!unresolvedBlockers.some((blocker) => isSupplyChainUpstreamBoundBlocker(blocker)) ||
      supplyChainUpstreamBoundEvidenceReady) &&
    (!unresolvedBlockers.some((blocker) => isChunkedOscEnvironmentBlocker(blocker)) ||
      chunkedOscLiveHostBlockedEvidenceReady) &&
    (!unresolvedBlockers.some((blocker) => isNativeHwndPasteDegradedBlocker(blocker)) ||
      nativeHwndPasteLiveDegradedReady) &&
    (!unresolvedBlockers.some((blocker) => isRightRailEdgeEnvironmentBlocker(blocker)) ||
      rightRailEdgeVisualHostBlockedEvidenceReady) &&
    (!unresolvedBlockers.some((blocker) => isRightRailGoalTrackEnvironmentBlocker(blocker)) ||
      rightRailGoalTrackTauriHostBlockedEvidenceReady));
const externalBlockerReadiness = {
  allowedExternalBlockersOnly,
  everyBlockerClassified:
    unresolvedBlockers.length === 0 ||
    unresolvedBlockers.every(
      (blocker) =>
        isAuthenticatedPromptBlocker(blocker) ||
        isHostSleepUnsupportedBlocker(blocker) ||
        isLiveAiChaosExternalBlocker(blocker) ||
        isReleaseSigningOperatorBlocker(blocker) ||
        isDistributionSigningOperatorBlocker(blocker) ||
        isMuxLiveRestoreHostBlocker(blocker) ||
        isSupplyChainEnvironmentBlocker(blocker) ||
        isSupplyChainUpstreamBoundBlocker(blocker) ||
        isChunkedOscEnvironmentBlocker(blocker) ||
        isNativeHwndPasteDegradedBlocker(blocker) ||
        isRightRailEdgeEnvironmentBlocker(blocker) ||
        isRightRailGoalTrackEnvironmentBlocker(blocker) ||
        isCommandEvidenceEnvironmentBlocker(blocker) ||
        (isReleaseReadinessExternalBlocker(blocker) && releaseReadinessExternalOrReviewReady),
    ),
  hostSleepReady: hostSleepBlockers.length === 0 || realSuspendExternalBlockedEvidenceReady,
  liveAiChaosReady: liveAiChaosBlockers.length === 0 || liveAiChaosExternalGateEvidenceReady,
  distributionSigningOperatorReady:
    distributionSigningOperatorBlockers.length === 0 || distributionSigningOperatorGateReady,
  muxLiveRestoreHostReady:
    !unresolvedBlockers.some((blocker) => isMuxLiveRestoreHostBlocker(blocker)) ||
    (muxLiveRestore?.status === "environment-blocked" && muxLiveRestore?.hostBlocked === true),
  supplyChainEnvironmentReady:
    !unresolvedBlockers.some((blocker) => isSupplyChainEnvironmentBlocker(blocker)) ||
    supplyChainEnvironmentBlockedEvidenceReady,
  supplyChainUpstreamBoundReady:
    !unresolvedBlockers.some((blocker) => isSupplyChainUpstreamBoundBlocker(blocker)) ||
    supplyChainUpstreamBoundEvidenceReady,
  chunkedOscHostReady:
    !unresolvedBlockers.some((blocker) => isChunkedOscEnvironmentBlocker(blocker)) ||
    chunkedOscLiveHostBlockedEvidenceReady,
  nativeHwndPasteReady:
    !unresolvedBlockers.some((blocker) => isNativeHwndPasteDegradedBlocker(blocker)) ||
    nativeHwndPasteLiveDegradedReady,
  rightRailEdgeHostReady:
    !unresolvedBlockers.some((blocker) => isRightRailEdgeEnvironmentBlocker(blocker)) ||
    rightRailEdgeVisualHostBlockedEvidenceReady,
  rightRailGoalTrackHostReady:
    !unresolvedBlockers.some((blocker) => isRightRailGoalTrackEnvironmentBlocker(blocker)) ||
    rightRailGoalTrackTauriHostBlockedEvidenceReady,
};
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
  releaseScore?.releaseCandidateReady === true &&
  unresolvedBlockers.length === 0;
const policyBlockedRisks = unresolvedBlockers
  .filter((blocker) => isAuthenticatedPromptBlocker(blocker) && !promptConsentPacketReady)
  .map((blocker) => ({
    kind: "explicit-token-spend-consent",
    area: blocker?.area ?? "authenticated-ai-cli-prompt-smoke",
    blocker: blocker?.blocker ?? String(blocker),
    canAutoResolve: false,
    requiredAction:
      "User must explicitly approve the authenticated AI CLI prompt smoke before token-spending execution.",
  }));
let externalBlockedRisks = unresolvedBlockers
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
      .filter((blocker) => isAuthenticatedPromptBlocker(blocker) && promptConsentPacketReady)
      .map((blocker) => ({
        kind: "authenticated-ai-cli-prompt-host-or-token-proof-gate",
        area: blocker?.area ?? "authenticated-ai-cli-prompt-smoke",
        blocker: blocker?.blocker ?? String(blocker),
        canAutoResolve: false,
        requiredAction: `Run ${promptExecutionGate.command} with ${promptExecutionGate.requiredEnv}, ${promptExecutionGate.requiredProviderEnv}, and a reachable WebView2 CDP endpoint, then rerun pnpm verify:quality-score and pnpm verify:final-goal-audit.`,
      })),
  )
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
  )
  .concat(
    unresolvedBlockers
      .filter((blocker) => isDistributionSigningOperatorBlocker(blocker))
      .map((blocker) => ({
        kind: "signed-distribution-operator-gate",
        area: blocker?.area ?? "distribution",
        blocker: blocker?.blocker ?? String(blocker),
        canAutoResolve: false,
        requiredAction:
          "Run pnpm tauri:build:dist in a secure operator shell with current TAURI signing material, then rerun pnpm verify:release:doctor and pnpm verify:quality-score.",
      })),
  )
  .concat(
    unresolvedBlockers
      .filter((blocker) => isMuxLiveRestoreHostBlocker(blocker))
      .map((blocker) => ({
        kind: "mux-live-restore-host-process-policy",
        area: blocker?.area ?? "mux-performance",
        blocker: blocker?.blocker ?? String(blocker),
        canAutoResolve: false,
        requiredAction:
          "Run pnpm verify:mux-live on a Windows host where Node can launch the PTY sidecar process, then rerun pnpm verify:quality-score and pnpm verify:final-goal-audit.",
      })),
  )
  .concat(
    unresolvedBlockers
      .filter((blocker) => isSupplyChainEnvironmentBlocker(blocker))
      .map((blocker) => ({
        kind: "npm-supply-chain-audit-environment-blocked",
        area: blocker?.area ?? "supply-chain-audit",
        blocker: blocker?.blocker ?? String(blocker),
        canAutoResolve: false,
        requiredAction:
          "Run pnpm verify:supply-chain on a host where Node can launch pnpm and the npm audit registry is reachable, then rerun pnpm verify:quality-score and pnpm verify:final-goal-audit.",
      })),
  )
  .concat(
    unresolvedBlockers
      .filter((blocker) => isSupplyChainUpstreamBoundBlocker(blocker))
      .map((blocker) => ({
        kind: "supply-chain-upstream-bound-dependency-block",
        area: blocker?.area ?? "supply-chain-audit",
        blocker: blocker?.blocker ?? String(blocker),
        canAutoResolve: false,
        requiredAction:
          "Wait for the upstream Tauri/tauri-utils/quick-xml dependency graph to accept patched dependency ranges or replace that upstream dependency graph, then rerun pnpm verify:stack-risk, pnpm verify:supply-chain, pnpm verify:quality-score, and pnpm verify:final-goal-audit.",
      })),
  )
  .concat(
    unresolvedBlockers
      .filter((blocker) => isCommandEvidenceEnvironmentBlocker(blocker))
      .map((blocker) => ({
        kind: "command-evidence-host-proof-environment-blocked",
        area: blocker?.area ?? "command-evidence",
        blocker: blocker?.blocker ?? String(blocker),
        canAutoResolve: false,
        requiredAction:
          "Run the matching command-evidence verifier on a Windows host with Aelyris/WebView2 CDP available, then rerun pnpm verify:quality-score and pnpm verify:final-goal-audit.",
      })),
  )
  .concat(
    unresolvedBlockers
      .filter((blocker) => isRightRailEdgeEnvironmentBlocker(blocker))
      .map((blocker) => ({
        kind: "right-rail-visual-qa-host-proof-environment-blocked",
        area: blocker?.area ?? "right-rail-edge",
        blocker: blocker?.blocker ?? String(blocker),
        canAutoResolve: false,
        requiredAction:
          "Run pnpm verify:right-rail-edge on a host where Playwright Chromium can launch, then rerun pnpm verify:quality-score and pnpm verify:final-goal-audit.",
      })),
  )
  .concat(
    unresolvedBlockers
      .filter((blocker) => isRightRailGoalTrackEnvironmentBlocker(blocker))
      .map((blocker) => ({
        kind: "right-rail-goal-track-tauri-host-proof-environment-blocked",
        area: blocker?.area ?? "right-rail-goal-track",
        blocker: blocker?.blocker ?? String(blocker),
        canAutoResolve: false,
        requiredAction:
          "Run pnpm verify:right-rail-goal-track-tauri on a Windows host with Aelyris/WebView2 CDP available, then rerun pnpm verify:quality-score and pnpm verify:final-goal-audit.",
      })),
  )
  .concat(
    unresolvedBlockers
      .filter((blocker) => isChunkedOscEnvironmentBlocker(blocker))
      .map((blocker) => ({
        kind: "chunked-osc-live-host-proof-environment-blocked",
        area: blocker?.area ?? "terminal-core-edge",
        blocker: blocker?.blocker ?? String(blocker),
        canAutoResolve: false,
        requiredAction:
          "Run pnpm verify:terminal:chunked-osc-live on a Windows host with Aelyris/WebView2 CDP available, then rerun pnpm verify:quality-score and pnpm verify:final-goal-audit.",
      })),
  )
  .concat(
    unresolvedBlockers
      .filter((blocker) => isNativeHwndPasteDegradedBlocker(blocker))
      .map((blocker) => ({
        kind: "native-hwnd-paste-webview2-cdp-path-unexercised",
        area: blocker?.area ?? "terminal-core-edge",
        blocker: blocker?.blocker ?? String(blocker),
        canAutoResolve: false,
        requiredAction:
          "Run pnpm verify:terminal:native-hwnd-paste on a Windows host with Aelyris/WebView2 CDP available so the WebView2/CDP WM_PASTE path is exercised, then rerun pnpm verify:quality-score and pnpm verify:final-goal-audit.",
      })),
  )
  .concat(
    unresolvedBlockers
      .filter((blocker) => isReleaseReadinessExternalBlocker(blocker))
      .map((blocker) => ({
        kind: "release-readiness-aggregate-external-proof-gate",
        area: blocker?.area ?? "release-readiness-aggregate",
        blocker: blocker?.blocker ?? String(blocker),
        canAutoResolve: false,
        requiredAction:
          "Run the remaining host/operator release readiness proof gates, then rerun pnpm verify:release-readiness-aggregate, pnpm verify:quality-score, and pnpm verify:final-goal-audit.",
      })),
  );
externalBlockedRisks = [
  ...externallyBlockedRequirements.map((requirement) => ({
    kind: "requirement-external-proof-environment-blocked",
    area: requirement.id,
    blocker: requirement.externalBlocker,
    canAutoResolve: false,
    requiredAction:
      "Run the required live proof on a host where the browser/WebView2/Playwright policy permits capture, then rerun pnpm verify:quality-score and pnpm verify:final-goal-audit.",
  })),
  ...externalBlockedRisks,
];
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
        !isMuxLiveRestoreHostBlocker(blocker) &&
        !isSupplyChainEnvironmentBlocker(blocker) &&
        !isSupplyChainUpstreamBoundBlocker(blocker) &&
        !isChunkedOscEnvironmentBlocker(blocker) &&
        !isNativeHwndPasteDegradedBlocker(blocker) &&
        !(isRightRailEdgeEnvironmentBlocker(blocker) && rightRailEdgeVisualHostBlockedEvidenceReady) &&
        !isCommandEvidenceEnvironmentBlocker(blocker) &&
        !isDistributionSigningOperatorBlocker(blocker) &&
        !(isRightRailGoalTrackEnvironmentBlocker(blocker) && rightRailGoalTrackTauriHostBlockedEvidenceReady) &&
        !(isReleaseReadinessExternalBlocker(blocker) && releaseReadinessExternalOrReviewReady) &&
        !(isLiveAiChaosExternalBlocker(blocker) && liveAiChaosExternalGateEvidenceReady),
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
  externallyBlockedRequirements: externallyBlockedRequirements.map((item) => item.id),
  evidenceDensity,
  missingEvidenceDensity,
  evidencePathIntegrity,
  missingEvidencePaths,
  unresolvedBlockers,
  residualRiskRegister,
  operationalEvidence,
  externalBlockerReadiness,
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
if (nativeHwndPasteLiveDegradedReady) {
  console.warn("native HWND paste WebView2/CDP WM_PASTE path unexercised; degraded no-CDP Rust proof only.");
}
console.log(JSON.stringify({ artifact: OUT, ...report }, null, 2));

if (!evidenceComplete) {
  process.exitCode = 1;
}
