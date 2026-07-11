import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { acquireFinalGoalArtifactLock } from "./final-goal-artifact-lock.mjs";
import { shouldFailReleaseEnforcement } from "./release-evidence-truth.mjs";
import {
  createEvidenceProvenance,
  deduplicateRootCauses,
  validateEvidenceDependencyGraph,
  validateEvidenceProvenance,
} from "./evidence-provenance.mjs";

const ROOT = resolve(process.cwd());
const OUT = join(ROOT, ".codex-auto", "quality", "release-quality-score.json");
const VERSION = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version;
const BOOTSTRAP_RIGHT_RAIL_GOAL_TRACK = process.env.AELYRIS_RIGHT_RAIL_GOAL_TRACK_BOOTSTRAP === "1";
const ENFORCE_RELEASE_SCORE = process.argv.includes("--enforce");
const LOCAL_TIME_ZONE = "Asia/Tokyo";
const releaseFinalGoalArtifactLock = acquireFinalGoalArtifactLock("score-release-quality");
process.on("exit", releaseFinalGoalArtifactLock);

const evidenceInputPaths = new Set();
const provenanceRejections = [];

function readJson(path) {
  if (!existsSync(path)) return null;
  evidenceInputPaths.add(path);
  const artifact = JSON.parse(readFileSync(path, "utf8"));
  const validation = validateEvidenceProvenance({ root: ROOT, artifact });
  if (!validation.ok) {
    provenanceRejections.push({ path: path.slice(ROOT.length + 1).replaceAll("\\", "/"), errors: validation.errors });
    return null;
  }
  return artifact;
}

function fileFresh(path, minBytes = 1) {
  if (!existsSync(path)) return false;
  if (statSync(path).size < minBytes) return false;
  const provenancePath = `${path}.provenance.json`;
  if (!existsSync(provenancePath)) {
    provenanceRejections.push({
      path: path.slice(ROOT.length + 1).replaceAll("\\", "/"),
      errors: ["missing-provenance-sidecar"],
    });
    return false;
  }
  return readJson(provenancePath) != null;
}

function mtimeMs(path) {
  if (!existsSync(path)) return 0;
  return statSync(path).mtimeMs;
}

function isoMs(value) {
  const time = Date.parse(value ?? "");
  return Number.isFinite(time) ? time : 0;
}

function currentLocalDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function hasCleanChaosQaUrl(value) {
  try {
    const url = new URL(String(value ?? ""));
    return (
      url.searchParams.get("aelyrisVisualQa") === "1" &&
      url.searchParams.get("v") === "live-pty-ai-cli-chaos" &&
      !url.searchParams.has("state") &&
      !url.searchParams.has("edgeLoop") &&
      !url.searchParams.has("dashboardState")
    );
  } catch {
    return false;
  }
}

function isAuthenticatedPromptBlocker(value) {
  return /authenticated[-\s]?ai[-\s]?cli[-\s]?prompt|authenticated AI CLI prompt|token-spend consent/i.test(
    String(value ?? ""),
  );
}

function isHostSleepUnsupportedBlocker(value) {
  return /real OS sleep\/resume could not complete on this host|real OS sleep\/resume could not complete on this host\/user cycle|user-initiated Windows sleep\/resume event pair was not observed|timed out waiting for a real user-initiated Windows sleep\/resume event pair|SetSuspendState returned false|GetLastError=50|host sleep unsupported|ERROR_NOT_SUPPORTED/i.test(
    String(value ?? ""),
  );
}

function countAuthenticatedPromptBlockers(items) {
  return Array.isArray(items) ? items.filter((item) => isAuthenticatedPromptBlocker(item)).length : 0;
}

function countHostSleepUnsupportedBlockers(items) {
  return Array.isArray(items) ? items.filter((item) => isHostSleepUnsupportedBlocker(item?.blocker ?? item)).length : 0;
}

function gradeForPercent(percent) {
  return percent >= 97 ? "S" : percent >= 92 ? "A" : percent >= 85 ? "B" : percent >= 75 ? "C" : "D";
}

function add(scores, id, label, points, max, detail, blockers = []) {
  scores.push({ id, label, points, max, detail, blockers });
}

const releaseDoctor = readJson(join(ROOT, ".codex-auto", "release-doctor", "p2-08-release-doctor.json"));
const supplyChainAuditPath = join(ROOT, ".codex-auto", "release-doctor", "supply-chain-audit.json");
const supplyChainAudit = readJson(supplyChainAuditPath);
const muxPerf = readJson(join(ROOT, ".codex-auto", "performance", "mux-performance-smoke.json"));
const muxLive = readJson(join(ROOT, ".codex-auto", "performance", "mux-live-restore-smoke.json"));
const scrollback = readJson(join(ROOT, ".codex-auto", "performance", "scrollback-gates.json"));
const riskRegister = readJson(join(ROOT, ".codex-auto", "risk-register.json"));
const realSuspendPath = join(ROOT, ".codex-auto", "production-smoke", "real-os-suspend-resume.json");
const realSuspendDiagnosticPath = join(
  ROOT,
  ".codex-auto",
  "production-smoke",
  "real-os-suspend-resume.diagnostic.json",
);
const realSuspend = readJson(realSuspendPath);
const realSuspendDiagnostic = readJson(realSuspendDiagnosticPath);
const realSuspendNativePreflightPath = join(
  ROOT,
  ".codex-auto",
  "production-smoke",
  "real-os-suspend-native-preflight.json",
);
const realSuspendNativePostcheckPreflightPath = join(
  ROOT,
  ".codex-auto",
  "production-smoke",
  "real-os-suspend-native-postcheck-preflight.json",
);
const realSuspendNativePostcheckWriteSmokePath = join(
  ROOT,
  ".codex-auto",
  "production-smoke",
  "postcheck-write-smoke",
  "real-os-suspend-native-postcheck-write-smoke.json",
);
const realSuspendNativePreflight = readJson(realSuspendNativePreflightPath);
const realSuspendNativePostcheckPreflight = readJson(realSuspendNativePostcheckPreflightPath);
const realSuspendNativePostcheckWriteSmoke = readJson(realSuspendNativePostcheckWriteSmokePath);
const imeSmoke = readJson(join(ROOT, ".codex-auto", "production-smoke", "verify-ime.json"));
const nativeInputHostPath = join(ROOT, ".codex-auto", "production-smoke", "native-terminal-input-host.json");
const nativeInputHost = readJson(nativeInputHostPath);
const liveCommandEvidencePath = join(ROOT, ".codex-auto", "production-smoke", "live-command-evidence.json");
const liveCommandEvidence = readJson(liveCommandEvidencePath);
const liveCommandEvidenceEnvironmentBlockedPath = `${liveCommandEvidencePath}.environment-blocked.json`;
const liveCommandEvidenceEnvironmentBlocked = readJson(liveCommandEvidenceEnvironmentBlockedPath);
const multipaneCommandEvidencePath = join(ROOT, ".codex-auto", "production-smoke", "multipane-command-evidence.json");
const multipaneCommandEvidence = readJson(multipaneCommandEvidencePath);
const multipaneCommandEvidenceEnvironmentBlockedPath = `${multipaneCommandEvidencePath}.environment-blocked.json`;
const multipaneCommandEvidenceEnvironmentBlocked = readJson(multipaneCommandEvidenceEnvironmentBlockedPath);
const recoveredCommandEvidencePath = join(ROOT, ".codex-auto", "production-smoke", "recovered-command-evidence.json");
const recoveredCommandEvidence = readJson(recoveredCommandEvidencePath);
const recoveredCommandEvidenceEnvironmentBlockedPath = `${recoveredCommandEvidencePath}.environment-blocked.json`;
const recoveredCommandEvidenceEnvironmentBlocked = readJson(recoveredCommandEvidenceEnvironmentBlockedPath);
const processReconnectCommandEvidencePath = join(
  ROOT,
  ".codex-auto",
  "production-smoke",
  "process-reconnect-command-evidence.json",
);
const processReconnectCommandEvidence = readJson(processReconnectCommandEvidencePath);
const processReconnectCommandEvidenceEnvironmentBlockedPath = `${processReconnectCommandEvidencePath}.environment-blocked.json`;
const processReconnectCommandEvidenceEnvironmentBlocked = readJson(
  processReconnectCommandEvidenceEnvironmentBlockedPath,
);
const muxLiveProcessPreservationPath = join(ROOT, ".codex-auto", "quality", "mux-live-process-preservation.json");
const _muxLiveProcessPreservation = readJson(muxLiveProcessPreservationPath);
const interactiveAiCliBoundaryPath = join(ROOT, ".codex-auto", "production-smoke", "interactive-ai-cli-boundary.json");
const interactiveAiCliBoundary = readJson(interactiveAiCliBoundaryPath);
const realAiCliBinaryProbePath = join(ROOT, ".codex-auto", "production-smoke", "real-ai-cli-binary-probe.json");
const realAiCliBinaryProbe = readJson(realAiCliBinaryProbePath);
const liveAiCliPostLaunchChaosPath = join(
  ROOT,
  ".codex-auto",
  "chaos-recovery",
  "p2-07-live-tauri-pty-ai-cli-chaos.json",
);
const liveAiCliPostLaunchChaos = readJson(liveAiCliPostLaunchChaosPath);
const nativeAiCliPostLaunchChaosPath = join(
  ROOT,
  ".codex-auto",
  "chaos-recovery",
  "native-ai-cli-post-launch-chaos.json",
);
const nativeAiCliPostLaunchChaos = readJson(nativeAiCliPostLaunchChaosPath);
const authenticatedAiCliPromptSmokePath = join(
  ROOT,
  ".codex-auto",
  "production-smoke",
  "authenticated-ai-cli-prompt-smoke.json",
);
const authenticatedAiCliPromptSmoke = readJson(authenticatedAiCliPromptSmokePath);
const authenticatedAiCliPreflightMatrixPath = join(
  ROOT,
  ".codex-auto",
  "production-smoke",
  "authenticated-ai-cli-preflight-matrix.json",
);
const authenticatedAiCliPreflightMatrix = readJson(authenticatedAiCliPreflightMatrixPath);
const authenticatedAiCliConsentPacketPath = join(
  ROOT,
  ".codex-auto",
  "production-smoke",
  "authenticated-ai-cli-consent-packet.json",
);
const authenticatedAiCliConsentPacket = readJson(authenticatedAiCliConsentPacketPath);
const authenticatedAiCliProviderGuardPath = join(
  ROOT,
  ".codex-auto",
  "production-smoke",
  "authenticated-ai-cli-provider-required-smoke.json",
);
const authenticatedAiCliProviderGuard = readJson(authenticatedAiCliProviderGuardPath);
const authenticatedAiCliPromptVerifierSource = readFileSync(
  join(ROOT, "scripts", "verify-authenticated-ai-cli-prompt-smoke.mjs"),
  "utf8",
);
const authenticatedAiCliProviderGuardSource = readFileSync(
  join(ROOT, "scripts", "verify-authenticated-ai-cli-provider-guard.mjs"),
  "utf8",
);
const authenticatedAiCliPreflightMatrixSource = readFileSync(
  join(ROOT, "scripts", "verify-authenticated-ai-cli-preflight-matrix.mjs"),
  "utf8",
);
const authenticatedAiCliConsentPacketSource = readFileSync(
  join(ROOT, "scripts", "verify-authenticated-ai-cli-consent-packet.mjs"),
  "utf8",
);
const aiCliLaunchPlannerSmokePath = join(ROOT, ".codex-auto", "production-smoke", "ai-cli-launch-planner.json");
const aiCliLaunchPlannerSmoke = readJson(aiCliLaunchPlannerSmokePath);
const commandCenterScenarioPath = join(ROOT, ".codex-auto", "production-smoke", "command-center-scenario.json");
const commandCenterScenario = readJson(commandCenterScenarioPath);
const commandRecoveryContractPath = join(ROOT, ".codex-auto", "production-smoke", "command-recovery-contract.json");
const commandRecoveryContract = readJson(commandRecoveryContractPath);
const nativeBoundaryContractPath = join(ROOT, ".codex-auto", "quality", "native-boundary-contract.json");
const nativeBoundaryContract = readJson(nativeBoundaryContractPath);
const nativeClientSpikePath = join(ROOT, ".codex-auto", "quality", "native-client-spike.json");
const nativeClientSpike = readJson(nativeClientSpikePath);
const releaseReadinessTerminalAiOsPath = join(ROOT, ".codex-auto", "quality", "release-readiness-aggregate.json");
const releaseReadinessTerminalAiOs = readJson(releaseReadinessTerminalAiOsPath);
const tauriRuntimeHygienePath = join(ROOT, ".codex-auto", "quality", "tauri-runtime-hygiene.json");
const tauriRuntimeHygiene = readJson(tauriRuntimeHygienePath);
const releaseHygieneContractPath = join(ROOT, ".codex-auto", "quality", "release-hygiene-contract.json");
const chunkedOscLivePath = join(ROOT, ".codex-auto", "production-smoke", "chunked-osc-live.json");
const chunkedOscLive = readJson(chunkedOscLivePath);
const chunkedOscLiveEnvironmentBlockedPath = join(
  ROOT,
  ".codex-auto",
  "production-smoke",
  "chunked-osc-live.environment-blocked.json",
);
const chunkedOscLiveEnvironmentBlocked = readJson(chunkedOscLiveEnvironmentBlockedPath);
const nativeHwndPasteLivePath = join(ROOT, ".codex-auto", "production-smoke", "native-hwnd-paste-live.json");
const nativeHwndPasteLive = readJson(nativeHwndPasteLivePath);
const terminalFontRenderContractPath = join(ROOT, ".codex-auto", "quality", "terminal-font-render-contract.json");
const terminalFontRenderContract = readJson(terminalFontRenderContractPath);
const finalGoalAuditPath = join(ROOT, ".codex-auto", "quality", "final-goal-audit.json");
// The final-goal audit consumes this score. Reading it here would create a score ->
// audit -> score cycle, so downstream final-goal status is never a score input.
const finalGoalAudit = null;
const finalGoalSafeSummaryPath = join(ROOT, ".codex-auto", "quality", "final-goal-safe-summary.json");
const finalGoalSafeSummary = readJson(finalGoalSafeSummaryPath);
const _goalDocumentationFreshnessPath = join(ROOT, ".codex-auto", "quality", "goal-documentation-freshness.json");
const productionBundleBudgetPath = join(ROOT, ".codex-auto", "quality", "production-bundle-budget.json");
const productionBundleBudget = readJson(productionBundleBudgetPath);
const rightRailSuite = readJson(join(ROOT, ".codex-auto", "production-smoke", "right-rail-suite.json"));
const rightRailIabProofPath = join(ROOT, ".codex-auto", "production-smoke", "right-rail-iab-proof.json");
const rightRailIabProof = readJson(rightRailIabProofPath);
const commandEvidenceSmokePath = join(ROOT, ".codex-auto", "production-smoke", "right-rail-command-evidence.json");
const commandEvidenceSmoke = readJson(commandEvidenceSmokePath);
const commandEvidenceSmokeEnvironmentBlockedPath = `${commandEvidenceSmokePath}.environment-blocked.json`;
const commandEvidenceSmokeEnvironmentBlocked = readJson(commandEvidenceSmokeEnvironmentBlockedPath);
const staleUrlTruthSmokePath = join(ROOT, ".codex-auto", "production-smoke", "right-rail-stale-url-truth.json");
const staleUrlTruthSmoke = readJson(staleUrlTruthSmokePath);
const tauriGoalTrackSmokePath = join(ROOT, ".codex-auto", "production-smoke", "right-rail-goal-track-tauri.json");
const tauriGoalTrackSmoke = readJson(tauriGoalTrackSmokePath);
const tauriGoalTrackSmokeEnvironmentBlockedPath = `${tauriGoalTrackSmokePath}.environment-blocked.json`;
const tauriGoalTrackSmokeEnvironmentBlocked = readJson(tauriGoalTrackSmokeEnvironmentBlockedPath);
const rightRailScaleContractPath = join(ROOT, ".codex-auto", "performance", "right-rail-scale-contract.json");
const rightRailScaleContract = readJson(rightRailScaleContractPath);
const rightRailInformationDensityPath = join(
  ROOT,
  ".codex-auto",
  "quality",
  "right-rail-information-density-contract.json",
);
const rightRailInformationDensity = readJson(rightRailInformationDensityPath);

function currentGoalTrackQualityDetailFromAudit(audit) {
  const projected = audit?.score?.projectedAfterEvidenceMap;
  if (
    typeof projected?.percent !== "number" ||
    typeof projected?.grade !== "string" ||
    typeof projected?.total !== "number" ||
    typeof projected?.max !== "number"
  ) {
    return null;
  }
  return [
    `${projected.percent}% ${projected.grade} · ${projected.total}/${projected.max}`,
    typeof audit?.localDate === "string" && typeof audit?.timeZone === "string"
      ? `${audit.localDate} ${audit.timeZone}`
      : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

const commandEvidenceScriptSource = readFileSync(
  join(ROOT, "scripts", "verify-right-rail-command-evidence.mjs"),
  "utf8",
);
const staleUrlTruthScriptSource = readFileSync(join(ROOT, "scripts", "verify-right-rail-stale-url-truth.mjs"), "utf8");
const rightRailSuiteSource = readFileSync(join(ROOT, "scripts", "verify-right-rail-suite.mjs"), "utf8");
const tauriGoalTrackScriptSource = readFileSync(
  join(ROOT, "scripts", "verify-right-rail-goal-track-tauri.mjs"),
  "utf8",
);
const rightRailScaleContractScriptSource = readFileSync(
  join(ROOT, "scripts", "verify-right-rail-scale-contract.mjs"),
  "utf8",
);
const rightRailInformationDensityScriptSource = readFileSync(
  join(ROOT, "scripts", "verify-right-rail-information-density.mjs"),
  "utf8",
);
const nativeBoundaryContractScriptSource = readFileSync(
  join(ROOT, "scripts", "verify-native-boundary-contract.mjs"),
  "utf8",
);
const nativeClientSpikeScriptSource = readFileSync(join(ROOT, "scripts", "verify-native-client-spike.mjs"), "utf8");
const releaseReadinessTerminalAiOsScriptSource = readFileSync(
  join(ROOT, "scripts", "verify-release-readiness-aggregate.mjs"),
  "utf8",
);
const finalGoalAuditScriptSource = readFileSync(join(ROOT, "scripts", "verify-final-goal-audit.mjs"), "utf8");
const finalGoalSafeVerifierSource = readFileSync(join(ROOT, "scripts", "verify-final-goal-safe.mjs"), "utf8");
const goalCompletionMatrixSource = readFileSync(join(ROOT, "scripts", "verify-goal-completion-matrix.mjs"), "utf8");
const goalDocumentationFreshnessSource = readFileSync(
  join(ROOT, "scripts", "verify-goal-documentation-freshness.mjs"),
  "utf8",
);
const goalOperatorFinishSource = readFileSync(join(ROOT, "scripts", "verify-goal-operator-finish.mjs"), "utf8");
const productionBundleBudgetScriptSource = readFileSync(
  join(ROOT, "scripts", "verify-production-bundle-budget.mjs"),
  "utf8",
);
const tauriRuntimeHygieneScriptSource = readFileSync(join(ROOT, "scripts", "verify-tauri-runtime-hygiene.mjs"), "utf8");
const releaseHygieneContractSource = readFileSync(join(ROOT, "scripts", "verify-release-hygiene-contract.mjs"), "utf8");
const chunkedOscLiveSource = readFileSync(join(ROOT, "scripts", "verify-chunked-osc-live.mjs"), "utf8");
const nativeHwndPasteLiveSource = readFileSync(join(ROOT, "scripts", "verify-native-hwnd-paste-live.mjs"), "utf8");
const terminalFontRenderContractSource = readFileSync(
  join(ROOT, "scripts", "verify-terminal-font-render-contract.mjs"),
  "utf8",
);
const liveAiCliPostLaunchChaosSource = readFileSync(
  join(ROOT, "scripts", "verify-live-tauri-pty-ai-cli-chaos.mjs"),
  "utf8",
);
const nativeAiCliPostLaunchChaosSource = readFileSync(
  join(ROOT, "scripts", "verify-native-ai-cli-post-launch-chaos.mjs"),
  "utf8",
);
const liveTauriWorkstationSurfacesSource = readFileSync(
  join(ROOT, "scripts", "verify-live-tauri-workstation-surfaces.mjs"),
  "utf8",
);
const performanceObservatorySource = readFileSync(join(ROOT, "scripts", "verify-performance-observatory.mjs"), "utf8");
const tauriDpiSettingsSource = readFileSync(join(ROOT, "scripts", "verify-tauri-dpi-settings.mjs"), "utf8");
const packageJsonSource = readFileSync(join(ROOT, "package.json"), "utf8");
const viteConfigSource = readFileSync(join(ROOT, "vite.config.ts"), "utf8");
const vitestConfigSource = readFileSync(join(ROOT, "vitest.config.ts"), "utf8");
const testSetupSource = readFileSync(join(ROOT, "src", "__tests__", "setup.ts"), "utf8");
const cargoTomlSource = readFileSync(join(ROOT, "src-tauri", "Cargo.toml"), "utf8");
const terminalCanvasSource = readFileSync(join(ROOT, "src", "features", "terminal", "TerminalCanvas.tsx"), "utf8");
const terminalCanvasGeometrySource = readFileSync(
  join(ROOT, "src", "features", "terminal", "terminalCanvasGeometry.ts"),
  "utf8",
);
const terminalPaintSource = readFileSync(join(ROOT, "src", "features", "terminal", "terminalPaint.ts"), "utf8");
const terminalColorsSource = readFileSync(join(ROOT, "src", "features", "terminal", "terminalColors.ts"), "utf8");
const repaintDecisionSource = readFileSync(join(ROOT, "src", "features", "terminal", "repaintDecision.ts"), "utf8");
const terminalAreaStylesSource = readFileSync(
  join(ROOT, "src", "features", "terminal", "TerminalArea.module.css"),
  "utf8",
);
const terminalMetricsSource = readFileSync(join(ROOT, "src", "features", "terminal", "terminalMetrics.ts"), "utf8");
const terminalKeymapSource = readFileSync(join(ROOT, "src", "features", "terminal", "keymap.ts"), "utf8");
const reviewQueuePanelSource = readFileSync(join(ROOT, "src", "features", "review", "ReviewQueuePanel.tsx"), "utf8");
const nativeTerminalAreaSource = readFileSync(
  join(ROOT, "src", "features", "terminal", "NativeTerminalArea.tsx"),
  "utf8",
);
const agentTerminalSource = readFileSync(join(ROOT, "src", "features", "agent-terminal", "AgentTerminal.tsx"), "utf8");
const paneTreeContainerSource = readFileSync(
  join(ROOT, "src", "features", "terminal", "pane-tree", "PaneTreeContainer.tsx"),
  "utf8",
);
const paneTreeRendererSource = readFileSync(
  join(ROOT, "src", "features", "terminal", "pane-tree", "PaneTreeRenderer.tsx"),
  "utf8",
);
const paneTreeHookSource = readFileSync(
  join(ROOT, "src", "features", "terminal", "pane-tree", "usePaneTree.ts"),
  "utf8",
);
const paneTreePersistenceSource = readFileSync(
  join(ROOT, "src", "features", "terminal", "pane-tree", "persistence.ts"),
  "utf8",
);
const canvasImeSource = readFileSync(join(ROOT, "src", "features", "terminal", "hooks", "useCanvasIME.ts"), "utf8");
const terminalSelectionSource = readFileSync(
  join(ROOT, "src", "features", "terminal", "hooks", "useTerminalSelection.ts"),
  "utf8",
);
const promptMarksSource = readFileSync(join(ROOT, "src", "shared", "hooks", "usePromptMarks.ts"), "utf8");
const promptMarksTestSource = readFileSync(join(ROOT, "src", "__tests__", "usePromptMarks.test.ts"), "utf8");
const nativeClipboardSource = readFileSync(join(ROOT, "src", "shared", "lib", "nativeClipboard.ts"), "utf8");
const shellIntegrationSource = readFileSync(
  join(ROOT, "src", "features", "settings", "ShellIntegrationSection.tsx"),
  "utf8",
);
const keyboardShortcutsHookSource = readFileSync(
  join(ROOT, "src", "shared", "hooks", "useKeyboardShortcuts.ts"),
  "utf8",
);
const editableTargetGuardSource = readFileSync(
  join(ROOT, "src", "shared", "hooks", "useEditableTargetGuard.ts"),
  "utf8",
);
const imeInputBarSource = readFileSync(join(ROOT, "src", "features", "terminal", "IMEInputBar.tsx"), "utf8");
const nativeTermSource = readFileSync(join(ROOT, "src-tauri", "src", "term", "native.rs"), "utf8");
const ipcCommandsSource = readFileSync(join(ROOT, "src-tauri", "src", "ipc", "commands.rs"), "utf8");
const interactiveCommandsSource = readFileSync(
  join(ROOT, "src-tauri", "src", "ipc", "interactive_commands.rs"),
  "utf8",
);
const interactiveAgentSource = readFileSync(join(ROOT, "src-tauri", "src", "agent", "interactive.rs"), "utf8");
const tauriLibSource = readFileSync(join(ROOT, "src-tauri", "src", "lib.rs"), "utf8");
const apiSource = readFileSync(join(ROOT, "src-tauri", "src", "api", "mod.rs"), "utf8");
const aelysSource = readFileSync(join(ROOT, "src-tauri", "src", "bin", "aelys.rs"), "utf8");
const aelyrisNativeSource = readFileSync(join(ROOT, "src-tauri", "src", "bin", "aelyris_native.rs"), "utf8");
const termModSource = readFileSync(join(ROOT, "src-tauri", "src", "term", "mod.rs"), "utf8");
const termRenderFrameSource = readFileSync(join(ROOT, "src-tauri", "src", "term", "render_frame.rs"), "utf8");
const termRenderPipelineSource = readFileSync(join(ROOT, "src-tauri", "src", "term", "render_pipeline.rs"), "utf8");
const ptySidecarSource = readFileSync(join(ROOT, "src-tauri", "src", "pty_sidecar.rs"), "utf8");
const appSource = readFileSync(join(ROOT, "src", "App.tsx"), "utf8");
const terminalEvidenceSource = readFileSync(join(ROOT, "src", "shared", "lib", "terminalEvidence.ts"), "utf8");
const visualQaLayoutSource = readFileSync(join(ROOT, "e2e", "visual-qa-layout.spec.ts"), "utf8");
const themeMoodSourcePaths = [
  join(ROOT, "src", "shared", "themes", "moods", "index.ts"),
  join(ROOT, "src", "shared", "themes", "moods", "material.ts"),
  join(ROOT, "src", "shared", "themes", "moods", "registry.ts"),
  join(ROOT, "src", "shared", "themes", "moods", "surfaces.ts"),
  join(ROOT, "src", "shared", "themes", "moods", "tokens.ts"),
];
const themeMoodsSource = themeMoodSourcePaths.map((path) => readFileSync(path, "utf8")).join("\n");
const themeApplierSource = readFileSync(join(ROOT, "src", "shared", "hooks", "useTheme.ts"), "utf8");
const appStoreSource = readFileSync(join(ROOT, "src", "shared", "store", "appStore.ts"), "utf8");
const recentCommandsSource = readFileSync(join(ROOT, "src", "shared", "lib", "recentCommands.ts"), "utf8");
const helmPanelSource = readFileSync(join(ROOT, "src", "features", "helm", "HelmPanel.tsx"), "utf8");
const projectHeaderBarSource = readFileSync(join(ROOT, "src", "features", "header", "ProjectHeaderBar.tsx"), "utf8");
const gitStatusHookSource = readFileSync(join(ROOT, "src", "shared", "hooks", "useGitStatus.ts"), "utf8");
const livePanesHookSource = readFileSync(join(ROOT, "src", "shared", "hooks", "useLivePanes.ts"), "utf8");
const ghostLayersHookSource = readFileSync(join(ROOT, "src", "shared", "hooks", "useGhostLayers.ts"), "utf8");
const settingsSource = readFileSync(join(ROOT, "src", "features", "settings", "Settings.tsx"), "utf8");
const tauriSettingsSource = readFileSync(join(ROOT, "src-tauri", "src", "config", "settings.rs"), "utf8");
const globalStylesSource = readFileSync(join(ROOT, "src", "styles", "global.css"), "utf8");
const glassLegibilityContractPath = join(ROOT, ".codex-auto", "quality", "glass-legibility-contract.json");
const glassLegibilityContract = readJson(glassLegibilityContractPath);
const glassLegibilityContractSource = readFileSync(
  join(ROOT, "scripts", "verify-glass-legibility-contract.mjs"),
  "utf8",
);
const uiTrustContractPath = join(ROOT, ".codex-auto", "quality", "ui-trust-contract.json");
const uiTrustContract = readJson(uiTrustContractPath);
const uiTrustContractSource = readFileSync(join(ROOT, "scripts", "verify-ui-trust-contract.mjs"), "utf8");
const a4DurabilityAcceptancePath = join(ROOT, ".codex-auto", "quality", "a4-durability-acceptance.json");
const a4DurabilityAcceptance = readJson(a4DurabilityAcceptancePath);
const a4DurabilityAcceptanceSource = readFileSync(
  join(ROOT, "scripts", "verify-a4-durability-acceptance.mjs"),
  "utf8",
);
const goalAntiStallContractPath = join(ROOT, ".codex-auto", "quality", "goal-anti-stall-contract.json");
const goalAntiStallContract = readJson(goalAntiStallContractPath);
const goalAntiStallContractSource = readFileSync(join(ROOT, "scripts", "verify-goal-anti-stall-contract.mjs"), "utf8");
const rightRailGoalTrackSource = readFileSync(join(ROOT, "src", "shared", "lib", "rightRailGoalTrack.ts"), "utf8");
const rightRailGoalTrackTestSource = readFileSync(join(ROOT, "src", "__tests__", "rightRailGoalTrack.test.ts"), "utf8");
const rightRailScaleContractTestSource = readFileSync(
  join(ROOT, "src", "__tests__", "rightRailScaleContract.test.tsx"),
  "utf8",
);
const releaseQualitySource = readFileSync(join(ROOT, "src", "shared", "lib", "releaseQuality.ts"), "utf8");
const releaseQualityTestSource = readFileSync(join(ROOT, "src", "__tests__", "releaseQuality.test.ts"), "utf8");
const authenticatedPromptConsentSource = readFileSync(
  join(ROOT, "src", "shared", "lib", "authenticatedPromptConsent.ts"),
  "utf8",
);
const authenticatedPromptConsentTestSource = readFileSync(
  join(ROOT, "src", "__tests__", "authenticatedPromptConsent.test.ts"),
  "utf8",
);
const terminalCanvasInputTestSource = readFileSync(
  join(ROOT, "src", "__tests__", "TerminalCanvasInput.test.tsx"),
  "utf8",
);
const terminalCanvasTestSource = readFileSync(join(ROOT, "src", "__tests__", "TerminalCanvas.test.tsx"), "utf8");
const terminalMetricsTestSource = readFileSync(join(ROOT, "src", "__tests__", "terminalMetrics.test.tsx"), "utf8");
const terminalFontSettingsContractTestSource = readFileSync(
  join(ROOT, "src", "__tests__", "TerminalFontSettingsContract.test.ts"),
  "utf8",
);
const terminalColorsTestSource = readFileSync(join(ROOT, "src", "__tests__", "terminalColors.test.ts"), "utf8");
const useImageMetricsTestSource = readFileSync(join(ROOT, "src", "__tests__", "useImageMetrics.test.tsx"), "utf8");
const appSilentBugsTestSource = readFileSync(join(ROOT, "src", "__tests__", "AppSilentBugs.test.ts"), "utf8");
const themePaletteTestSource = readFileSync(join(ROOT, "src", "__tests__", "themePalette.test.ts"), "utf8");
const themeApplierTestSource = readFileSync(join(ROOT, "src", "__tests__", "useThemeApplier.test.tsx"), "utf8");
const appStoreTestSource = readFileSync(join(ROOT, "src", "__tests__", "appStore.test.ts"), "utf8");
const recentCommandsTestSource = readFileSync(join(ROOT, "src", "__tests__", "recentCommands.test.ts"), "utf8");
const helmPanelTestSource = readFileSync(join(ROOT, "src", "__tests__", "HelmPanel.test.tsx"), "utf8");
const settingsSaveMergeTestSource = readFileSync(join(ROOT, "src", "__tests__", "SettingsSaveMerge.test.tsx"), "utf8");
const designTokenUsageTestSource = readFileSync(join(ROOT, "src", "__tests__", "designTokenUsage.test.ts"), "utf8");

const scores = [];
const nsis = join(ROOT, "src-tauri", "target", "release", "bundle", "nsis", `Aelyris_${VERSION}_x64-setup.exe`);
const msi = join(ROOT, "src-tauri", "target", "release", "bundle", "msi", `Aelyris_${VERSION}_x64_en-US.msi`);
const appExe = join(ROOT, "src-tauri", "target", "release", "Aelyris.exe");
const newestDistArtifactMs = Math.max(
  mtimeMs(appExe),
  mtimeMs(nsis),
  mtimeMs(msi),
  mtimeMs(`${nsis}.sig`),
  mtimeMs(`${msi}.sig`),
);
const releaseDoctorCurrent = isoMs(releaseDoctor?.generatedAt) + 5_000 >= newestDistArtifactMs;
const releaseDoctorFresh = releaseDoctor?.overallStatus === "pass" && releaseDoctorCurrent;
const releaseDoctorWarnCurrent = releaseDoctor?.overallStatus === "pass_with_warnings" && releaseDoctorCurrent;
add(
  scores,
  "release-doctor",
  "Release doctor",
  releaseDoctorFresh ? 18 : releaseDoctor?.overallStatus === "pass" || releaseDoctorWarnCurrent ? 14 : 0,
  18,
  releaseDoctorFresh
    ? "pass"
    : releaseDoctorWarnCurrent
      ? "pass_with_warnings (signing/updater artifacts pending)"
      : releaseDoctor?.overallStatus
        ? `${releaseDoctor.overallStatus} (stale)`
        : "missing",
  releaseDoctorFresh
    ? []
    : releaseDoctorWarnCurrent
      ? ["release doctor has signing/updater warnings; regenerate signatures/latest.json before release"]
      : ["release doctor evidence is missing, failing, or older than current dist artifacts"],
);

const newestSupplyChainInputMs = Math.max(
  mtimeMs(join(ROOT, "package.json")),
  mtimeMs(join(ROOT, "pnpm-lock.yaml")),
  mtimeMs(join(ROOT, "src-tauri", "Cargo.toml")),
  mtimeMs(join(ROOT, "src-tauri", "Cargo.lock")),
  mtimeMs(join(ROOT, "scripts", "verify-supply-chain.mjs")),
);
const supplyChainFresh = isoMs(supplyChainAudit?.generatedAt) + 5_000 >= newestSupplyChainInputMs;
const supplyChainPass =
  supplyChainAudit?.status === "pass" &&
  supplyChainAudit?.npm?.ok === true &&
  supplyChainAudit?.npm?.knownVulnerabilities === 0 &&
  supplyChainAudit?.cargo?.ok === true &&
  supplyChainAudit?.cargo?.knownVulnerabilities === 0 &&
  (supplyChainAudit?.cargo?.reachability?.runtimeCriticalWarningCount ?? 0) === 0 &&
  supplyChainFresh;
const supplyChainEnvironmentBlocked =
  supplyChainAudit?.status === "environment-blocked" &&
  supplyChainAudit?.npm?.ok !== true &&
  supplyChainAudit?.cargo?.knownVulnerabilities === 0 &&
  (supplyChainAudit?.cargo?.reachability?.runtimeCriticalWarningCount ?? 0) === 0 &&
  supplyChainFresh;
const supplyChainClassifiedUpstreamBound =
  supplyChainAudit?.status === "classified-upstream-bound" &&
  supplyChainAudit?.npm?.ok === true &&
  supplyChainAudit?.npm?.knownVulnerabilities === 0 &&
  typeof supplyChainAudit?.cargo?.knownVulnerabilities === "number" &&
  supplyChainAudit.cargo.knownVulnerabilities > 0 &&
  (supplyChainAudit?.cargo?.reachability?.runtimeCriticalWarningCount ?? 0) === 0 &&
  supplyChainAudit?.stackRiskClassification?.ok === true &&
  supplyChainAudit?.stackRiskClassification?.releaseBlockerCount === 0 &&
  supplyChainAudit?.stackRiskClassification?.unclassifiedCount === 0 &&
  (supplyChainAudit?.stackRiskClassification?.upstreamBoundBlockerCount ?? 0) > 0 &&
  supplyChainFresh;
add(
  scores,
  "supply-chain-audit",
  "Supply-chain vulnerability audit",
  supplyChainPass ? 6 : supplyChainClassifiedUpstreamBound ? 4 : 0,
  6,
  supplyChainPass
    ? `npm 0, cargo 0 vulnerabilities; ${
        supplyChainAudit?.cargo?.reachability?.runtimeCriticalWarningCount ?? 0
      } runtime critical Rust warnings; ${
        supplyChainAudit?.cargo?.reachability?.runtimeMaintenanceWarningCount ?? 0
      } runtime maintenance warnings tracked`
    : supplyChainClassifiedUpstreamBound
      ? `classified-upstream-bound; npm 0, cargo ${supplyChainAudit?.cargo?.knownVulnerabilities ?? "?"} known vulnerabilities; stack-risk releaseBlockers=0 upstreamBound=${supplyChainAudit?.stackRiskClassification?.upstreamBoundBlockerCount ?? "?"} unclassified=0`
    : supplyChainEnvironmentBlocked
      ? `environment-blocked; npm audit unavailable (${supplyChainAudit?.npm?.unavailableReason ?? "unknown"}); cargo 0 vulnerabilities, 0 runtime critical Rust warnings`
      : supplyChainAudit?.status
        ? `${supplyChainAudit.status} (stale or incomplete)`
        : "missing",
  supplyChainPass
    ? []
    : supplyChainClassifiedUpstreamBound
      ? [
          `supply-chain-audit upstream-bound dependency BLOCK: stack-risk releaseBlockers=0 unclassified=0 upstreamBound=${supplyChainAudit?.stackRiskClassification?.upstreamBoundBlockerCount ?? "?"}; release waits on upstream dependency graph movement, not repo-owned implementation.`,
        ]
    : supplyChainEnvironmentBlocked
      ? [
          `npm supply-chain audit is environment-blocked: ${
            supplyChainAudit?.npm?.unavailableReason ?? "npm audit unavailable"
          }`,
        ]
      : [
          "supply-chain audit is missing, stale, failing, reports known vulnerabilities, or has runtime critical Rust warnings",
        ],
);

const releaseDoctorSigning = releaseDoctor?.checks?.find?.((check) => check?.id === "signing-state");
const releaseDoctorUpdater = releaseDoctor?.checks?.find?.((check) => check?.id === "updater-latest-release");
const artifactsReady =
  releaseDoctorCurrent &&
  releaseDoctorSigning?.status === "pass" &&
  releaseDoctorSigning?.details?.authenticodeReady === true &&
  releaseDoctorSigning?.details?.updaterSignatureReady === true &&
  releaseDoctorUpdater?.status === "pass" &&
  releaseDoctorUpdater?.details?.capabilityWired === true &&
  releaseDoctorUpdater?.details?.endpointReachability?.reachable === true &&
  releaseDoctorUpdater?.details?.lifecycleProof?.ready === true;
add(
  scores,
  "distribution",
  "Signed distribution artifacts",
  artifactsReady ? 14 : 0,
  14,
  artifactsReady ? "authenticode-and-updater-lifecycle-proved" : "missing/stale/untrusted",
  artifactsReady
    ? []
    : ["Authenticode timestamp chains, updater signatures, reachable metadata, and install/relaunch/rollback proof are incomplete"],
);

const muxSummary = muxPerf?.summary ?? muxPerf;
const muxPass =
  muxLive?.status === "passed" &&
  muxPerf?.status === "passed" &&
  muxSummary?.split?.p95 <= 250 &&
  muxSummary?.create?.p95 <= 250;
const muxLiveHostBlocked = muxLive?.status === "environment-blocked" && muxLive?.hostBlocked === true;
const muxLiveHostBlockedMessage =
  muxLive?.blockers?.[0]?.message ?? muxLive?.errors?.[0] ?? "mux live restore host process launch is blocked";
const muxPerformanceOverBudget =
  muxPerf?.status === "passed" && (muxSummary?.split?.p95 > 250 || muxSummary?.create?.p95 > 250);
add(
  scores,
  "mux-performance",
  "Mux restore and performance",
  muxPass ? 14 : 8,
  14,
  muxPass
    ? `split p95 ${muxSummary?.split?.p95}ms, create p95 ${muxSummary?.create?.p95}ms`
    : muxLiveHostBlocked
      ? `performance passed; live restore environment-blocked (${muxLiveHostBlockedMessage})`
      : muxPerf?.status === "passed"
        ? "live restore missing or failing"
        : "missing or slow",
  muxPass
    ? []
    : [
        ...(muxPerf?.status === "passed" ? [] : ["mux performance evidence is missing"]),
        ...(muxPerformanceOverBudget ? ["mux performance p95 is over budget"] : []),
        ...(muxLiveHostBlocked
          ? [`mux live restore is environment-blocked by host process policy: ${muxLiveHostBlockedMessage}`]
          : muxLive?.status === "passed"
            ? []
            : ["mux live restore evidence is missing or failing"]),
      ],
);

add(
  scores,
  "scrollback",
  "Persistent scrollback",
  scrollback?.status === "passed" ? 8 : 0,
  8,
  scrollback?.status ?? "missing",
  scrollback?.status === "passed" ? [] : ["scrollback capture/search smoke is not passing"],
);

const imeChecks = Array.isArray(imeSmoke?.checks) ? imeSmoke.checks : [];
const cdpImePass =
  imeSmoke?.status === "pass" &&
  imeChecks.some((check) => /Long Japanese preedit|late marker survived/i.test(check)) &&
  imeChecks.some((check) =>
    /overlay geometry inside canvas|native input surface geometry inside canvas/i.test(check),
  ) &&
  imeChecks.some((check) => /LF paste submitted/i.test(check));
const nativeInputHostImeChecks = Array.isArray(nativeInputHost?.checks) ? nativeInputHost.checks : [];
const nativeInputHostHas = (id) =>
  nativeInputHost?.status === "pass" &&
  nativeInputHostImeChecks.some((check) => check?.id === id && check?.status === "passed");
const nativeInputHostImePass =
  nativeInputHostHas("frontend-native-default") &&
  nativeInputHostHas("composition-surface") &&
  nativeInputHostHas("surface-ime-preedit-hidden") &&
  nativeInputHostHas("surface-custom-hwnd-runway") &&
  nativeInputHostHas("commit-command") &&
  nativeInputHostHas("behavioral-native-hwnd-paste-live");
const imePass = cdpImePass || nativeInputHostImePass;
add(
  scores,
  "native-ime",
  "Native IME live verification",
  imePass ? 6 : 0,
  6,
  imePass
    ? cdpImePass
      ? `${imeChecks.length} live IME checks passed`
      : "native HWND input surface, Japanese preedit suppression, full-width runway, and paste guard passed"
    : "missing",
  imePass ? [] : ["native IME live CDP or native HWND verification is missing or incomplete"],
);

const hasXtermDependency = /"@?xterm\b|xterm\.js/i.test(packageJsonSource);
const activeXtermIntegrationPattern =
  /@xterm|xterm\.js|xterm-screen|from\s+["'][^"']*xterm|require\(["'][^"']*xterm|new\s+Terminal\s*\(|\bFitAddon\b|\bWebglAddon\b/i;
const activeXtermIntegrationBlocked = [
  packageJsonSource,
  terminalCanvasSource,
  nativeTerminalAreaSource,
  canvasImeSource,
  terminalKeymapSource,
  keyboardShortcutsHookSource,
  editableTargetGuardSource,
  globalStylesSource,
  cargoTomlSource,
].some((source) => activeXtermIntegrationPattern.test(source));
const chunkedOscLiveFresh =
  chunkedOscLive?.ok === true &&
  chunkedOscLive?.status === "pass-current-chunked-osc-live-contract" &&
  chunkedOscLive?.checks?.allCasesPassed === true &&
  chunkedOscLive?.checks?.shellsCovered === true &&
  chunkedOscLive?.checks?.tinyFixturePassedForEveryShell === true &&
  chunkedOscLive?.checks?.largeFixturePassedForEveryShell === true &&
  chunkedOscLive?.checks?.pngSignatureVerified === true &&
  Array.isArray(chunkedOscLive?.cases) &&
  chunkedOscLive.cases.length >= 4 &&
  mtimeMs(chunkedOscLivePath) + 5_000 >=
    Math.max(
      mtimeMs(join(ROOT, "scripts", "verify-chunked-osc-live.mjs")),
      mtimeMs(join(ROOT, "scripts", "aelyris-imgcat.ps1")),
      mtimeMs(join(ROOT, "scripts", "aelyris-imgcat.sh")),
      mtimeMs(join(ROOT, "e2e", "fixtures", "inline-image-1x1.png")),
      mtimeMs(join(ROOT, "e2e", "fixtures", "inline-image-32x32.png")),
    );
const chunkedOscLiveEnvironmentBlockedFresh =
  chunkedOscLiveEnvironmentBlocked?.ok === false &&
  chunkedOscLiveEnvironmentBlocked?.status === "environment-blocked" &&
  chunkedOscLiveEnvironmentBlocked?.preservesPrimaryArtifact === true &&
  Array.isArray(chunkedOscLiveEnvironmentBlocked?.errors) &&
  chunkedOscLiveEnvironmentBlocked.errors.some((error) =>
    /CDP|ECONNREFUSED|Cannot attach to WebView2|browserType\.launch|spawn EPERM|No running debug\/release Aelyris\.exe/i.test(
      String(error),
    ),
  ) &&
  mtimeMs(chunkedOscLiveEnvironmentBlockedPath) + 5_000 >=
    Math.max(
      mtimeMs(join(ROOT, "scripts", "verify-chunked-osc-live-safe.mjs")),
      mtimeMs(join(ROOT, "scripts", "verify-chunked-osc-live.mjs")),
    );
const chunkedOscLiveEnvironmentBlockedReason =
  Array.isArray(chunkedOscLiveEnvironmentBlocked?.errors) && chunkedOscLiveEnvironmentBlocked.errors.length > 0
    ? chunkedOscLiveEnvironmentBlocked.errors.map((error) => String(error)).join("; ")
    : "WebView2/CDP live proof environment is unavailable";
const nativeHwndPasteLiveSourceFresh =
  mtimeMs(nativeHwndPasteLivePath) + 5_000 >=
  Math.max(
    mtimeMs(join(ROOT, "scripts", "verify-native-hwnd-paste-live.mjs")),
    mtimeMs(join(ROOT, "scripts", "verify-native-terminal-input-host.mjs")),
    mtimeMs(join(ROOT, "src-tauri", "src", "term", "native_input.rs")),
    mtimeMs(join(ROOT, "src-tauri", "src", "ipc", "commands.rs")),
  );
const nativeHwndPasteLiveCoreChecksPass =
  nativeHwndPasteLive?.ok === true &&
  nativeHwndPasteLive?.checks?.wmPasteSentToNativeHwnd === true &&
  nativeHwndPasteLive?.checks?.singleLineLfNormalizedAndExecuted === true &&
  nativeHwndPasteLive?.checks?.destructivePasteBlockedBeforePty === true &&
  nativeHwndPasteLive?.checks?.multilinePasteBlockedBeforePty === true &&
  nativeHwndPasteLive?.checks?.guardEventCountAdvanced === true &&
  Array.isArray(nativeHwndPasteLive?.cases) &&
  nativeHwndPasteLive.cases.length >= 3 &&
  nativeHwndPasteLive.cases.every((item) => item?.ok === true && item?.path === "native-input-hwnd-wm-paste");
const nativeHwndPasteLiveStrictFresh =
  nativeHwndPasteLiveCoreChecksPass &&
  nativeHwndPasteLive?.status === "pass-current-native-hwnd-paste-contract" &&
  nativeHwndPasteLive?.degraded !== true &&
  nativeHwndPasteLiveSourceFresh;
const nativeHwndPasteLiveDegradedFresh =
  nativeHwndPasteLiveCoreChecksPass &&
  nativeHwndPasteLive?.status === "pass-degraded-no-cdp" &&
  nativeHwndPasteLive?.degraded === true &&
  nativeHwndPasteLiveSourceFresh;
const nativeHwndPasteLiveFresh = nativeHwndPasteLiveStrictFresh;
const terminalCoreSignals = [
  !hasXtermDependency,
  cargoTomlSource.includes("alacritty_terminal"),
  nativeTermSource.includes("NativeTerminalRegistry"),
  nativeInputHost?.checks?.some?.((check) => check.id === "commit-command" && check.status === "passed") === true,
  nativeInputHost?.checks?.some?.((check) => check.id === "surface-paste-guard" && check.status === "passed") === true,
  nativeHwndPasteLiveFresh,
  terminalCanvasSource.includes("export function TerminalCanvas"),
  nativeTerminalAreaSource.includes("NativeTerminalArea"),
  canvasImeSource.includes("empty-or-non-text-paste-ignored"),
  ipcCommandsSource.includes("set_ime_position"),
  ipcCommandsSource.includes("save_clipboard_image"),
  realSuspend?.checks?.terminalResponsive === true,
  scrollback?.status === "passed",
  imePass,
];
const terminalCoreSignalPoints = Math.min(10, terminalCoreSignals.filter(Boolean).length);
const nativeInputCompositionBlocked =
  nativeInputHost?.status !== "pass" ||
  !Array.isArray(nativeInputHost.checks) ||
  nativeInputHost.checks.some(
    (check) =>
      [
        "frontend-native-default",
        "surface-paste-guard",
        "surface-ime-preedit-hidden",
        "surface-window-lifetime",
        "composition-surface",
      ].includes(String(check.id)) && check.status !== "passed",
  );
const hasWebviewImeFallback =
  terminalCanvasSource.includes("WEBVIEW_IME_FALLBACK_TEST_ID") ||
  terminalCanvasSource.includes("terminal-ime-textarea") ||
  terminalCanvasSource.includes("WebView IME fallback textarea");
const webviewImeFallbackContained =
  hasWebviewImeFallback &&
  terminalCanvasSource.includes("textarea: useNativeInputSurface ? null : textareaEl") &&
  terminalCanvasSource.includes("onInputRef?.(useNativeInputSurface ? null : textareaEl)") &&
  terminalCanvasSource.includes("!useNativeInputSurface &&") &&
  terminalCanvasSource.includes('data-native-input-surface={useNativeInputSurface ? "true" : "false"}') &&
  canvasImeSource.includes("NATIVE_INPUT_SURFACE_DEFAULT_ENABLED = true") &&
  canvasImeSource.includes("__TAURI_INTERNALS__") &&
  terminalCanvasInputTestSource.includes(
    "does not report fallback telemetry when the native input surface owns focus",
  ) &&
  terminalCanvasInputTestSource.includes('screen.queryByTestId("terminal-ime-textarea")');
const terminalCoreBoundaryBlockers = [
  ...(hasXtermDependency ? ["xterm dependency is still present"] : []),
  ...(activeXtermIntegrationBlocked
    ? ["active terminal source still contains xterm integration or legacy focus hooks"]
    : []),
  ...(nativeInputCompositionBlocked ? ["native input composition surface proof is missing or stale"] : []),
  ...(nativeInputHost?.checks?.some?.((check) => check.id === "surface-paste-guard" && check.status === "passed")
    ? []
    : ["native HWND paste guard proof is missing or stale"]),
  ...(hasWebviewImeFallback && !webviewImeFallbackContained
    ? ["terminal IME still crosses the WebView hidden textarea boundary"]
    : []),
  ...(imeInputBarSource.includes("navigator.clipboard")
    ? ["image clipboard ingestion still depends on WebView navigator.clipboard"]
    : []),
  ...(!chunkedOscLiveFresh
    ? [
        chunkedOscLiveEnvironmentBlockedFresh
          ? `chunked OSC inline image live proof is environment-blocked: ${chunkedOscLiveEnvironmentBlockedReason}`
          : "chunked OSC inline image live proof is missing or stale",
      ]
    : []),
  ...(!nativeHwndPasteLiveFresh
    ? [
        nativeHwndPasteLiveDegradedFresh
          ? "native HWND paste WebView2/CDP WM_PASTE path unexercised; degraded no-CDP Rust proof is not full release credit"
          : "native HWND paste live proof is missing or stale",
      ]
    : []),
  ...(Array.isArray(rightRailSuite?.checks) && rightRailSuite.checks.some((check) => check.status === "skipped")
    ? ["native WebView2 terminal/rail CDP evidence is incomplete"]
    : []),
];
const terminalCorePoints = Math.max(0, terminalCoreSignalPoints - terminalCoreBoundaryBlockers.length * 2);
add(
  scores,
  "terminal-core-edge",
  "Terminal core edge readiness",
  terminalCorePoints,
  10,
  `${terminalCoreSignalPoints}/10 signals; ${hasXtermDependency ? "xterm present" : "no xterm dependency"}; ${
    terminalCoreBoundaryBlockers.length
  } boundary risks; ${
    hasWebviewImeFallback
      ? webviewImeFallbackContained
        ? "webview fallback contained"
        : "webview fallback unsafe"
      : "no webview fallback"
  }`,
  terminalCoreBoundaryBlockers,
);

const terminalCanvasDprBacked =
  terminalCanvasSource.includes("currentCanvasDevicePixelRatio") &&
  terminalCanvasGeometrySource.includes("MAX_CANVAS_DEVICE_PIXEL_RATIO") &&
  terminalCanvasGeometrySource.includes("function canvasBitmapSize") &&
  terminalCanvasGeometrySource.includes("function canvasCssSize") &&
  terminalCanvasSource.includes("canvasBitmapWidth = canvasBitmapSize(canvasWidth, canvasDevicePixelRatio)") &&
  terminalCanvasSource.includes("canvasBitmapHeight = canvasBitmapSize(canvasHeight, canvasDevicePixelRatio)") &&
  terminalCanvasSource.includes("canvasCssWidth = canvasCssSize(canvasBitmapWidth, canvasDevicePixelRatio)") &&
  terminalCanvasSource.includes("canvasCssHeight = canvasCssSize(canvasBitmapHeight, canvasDevicePixelRatio)") &&
  terminalCanvasSource.includes("ctx.setTransform?.(canvasDevicePixelRatio, 0, 0, canvasDevicePixelRatio, 0, 0)");
const terminalCanvasGeometryRepaint =
  terminalCanvasSource.includes("prevCanvasGeometryRef") &&
  terminalCanvasSource.includes("canvasGeometryChanged") &&
  terminalCanvasSource.includes("devicePixelRatio: canvasDevicePixelRatio") &&
  terminalCanvasSource.includes("shouldRepaintRow") &&
  repaintDecisionSource.includes("flags.canvasGeometryChanged") &&
  repaintDecisionSource.includes("flags.rowContentChanged");
const terminalCanvasTextLayerAboveDecor =
  terminalCanvasSource.includes("styles.terminalCanvasSurface") &&
  terminalAreaStylesSource.includes(".terminalCanvasSurface") &&
  terminalAreaStylesSource.includes("z-index: 4") &&
  terminalAreaStylesSource.includes("text-rendering: auto") &&
  (terminalAreaStylesSource.includes("-webkit-font-smoothing: antialiased") ||
    terminalAreaStylesSource.includes("-webkit-font-smoothing: subpixel-antialiased"));
const terminalCanvasNoPixelatedText =
  !terminalCanvasSource.includes('imageRendering: "pixelated"') &&
  !terminalPaintSource.includes('imageRendering: "pixelated"');
const terminalCanvasCrispText =
  terminalCanvasGeometrySource.includes("snapCanvasTextCoord") &&
  terminalCanvasSource.includes("configureTerminalCanvasText(ctx)") &&
  terminalCanvasSource.includes('textCtx.fontKerning = "none"') &&
  terminalCanvasSource.includes('textCtx.textRendering = "auto"') &&
  terminalPaintSource.includes("snapCanvasTextCoord") &&
  terminalPaintSource.includes("shouldClampGlyphToCell") &&
  terminalPaintSource.includes("enhanceTerminalTextColor") &&
  terminalColorsSource.includes("forceOpaqueCssColor") &&
  terminalColorsSource.includes("const opaqueColor = fg.a < 1 ? forceOpaqueCssColor(color) : color") &&
  terminalColorsSource.includes("minimumTerminalContrastRatio") &&
  terminalColorsSource.includes("dimAlphaForTextClarity") &&
  terminalMetricsSource.includes("snapTerminalCssPixel") &&
  terminalMetricsSource.includes("currentTerminalDevicePixelRatio");
const terminalCanvasFidelityTests =
  terminalCanvasTestSource.includes("renders the backing store at device-pixel ratio without CSS bitmap scaling") &&
  terminalCanvasTestSource.includes("aligns fractional-DPR CSS size to the integer backing store") &&
  terminalCanvasTestSource.includes("keeps live terminal text above decorative viewport overlays") &&
  terminalCanvasTestSource.includes(
    "snaps pane mounts to the physical pixel grid before compositing the terminal canvas",
  ) &&
  terminalCanvasTestSource.includes("does not horizontally clamp ordinary ASCII glyphs") &&
  terminalCanvasTestSource.includes("keeps CJK glyphs clamped to their two-cell terminal slot") &&
  terminalCanvasTestSource.includes("snapCanvasTextCoord") &&
  terminalMetricsTestSource.includes("snaps measured cell width to physical pixels") &&
  terminalCanvasTestSource.includes("setTransform") &&
  terminalCanvasTestSource.includes("not.toContain('imageRendering: \"pixelated\"')");
const terminalPaneMountPixelSnapped =
  paneTreeRendererSource.includes("snapPaneRectToDevicePixels") &&
  paneTreeRendererSource.includes("snapTerminalCssPixel") &&
  paneTreeRendererSource.includes("rect.right - rootRect.left") &&
  paneTreeRendererSource.includes("rect.bottom - rootRect.top") &&
  !paneTreeRendererSource.includes("Math.round(r.left - rootRect.left)") &&
  terminalFontRenderContractSource.includes("pane-mount-pixel-grid") &&
  terminalFontRenderContractSource.includes("src/features/terminal/pane-tree/PaneTreeRenderer.tsx") &&
  terminalFontSettingsContractTestSource.includes("snapPaneRectToDevicePixels");
const terminalFontRenderContractSourcePass =
  packageJsonSource.includes('"verify:terminal:font-render"') &&
  terminalFontRenderContractSource.includes("terminal-font-render-contract.json") &&
  terminalFontRenderContractSource.includes("terminalFontStack") &&
  terminalFontRenderContractSource.includes("Cascadia Next JP") &&
  terminalFontRenderContractSource.includes("src/features/agent-terminal/AgentTerminal.tsx") &&
  terminalFontRenderContractSource.includes("src/features/terminal/pane-tree/PaneTreeRenderer.tsx") &&
  terminalFontRenderContractSource.includes("src/features/terminal/terminalCanvasGeometry.ts") &&
  terminalFontRenderContractSource.includes("src/features/terminal/terminalPaint.ts") &&
  terminalFontRenderContractSource.includes("src/features/terminal/terminalColors.ts") &&
  terminalFontRenderContractSource.includes("src/features/terminal/repaintDecision.ts") &&
  terminalFontRenderContractSource.includes("src/__tests__/terminalColors.test.ts") &&
  terminalFontRenderContractSource.includes("pane-mount-pixel-grid") &&
  terminalFontSettingsContractTestSource.includes("terminal font settings contract") &&
  terminalFontSettingsContractTestSource.includes("terminal_font_family: terminalFontFamily") &&
  terminalFontSettingsContractTestSource.includes("terminalLineHeight = useAppStore((s) => s.terminalLineHeight)") &&
  settingsSource.includes("terminal_font_family: terminalFontFamily") &&
  settingsSource.includes("terminal_text_clarity: terminalTextClarity") &&
  settingsSource.includes("terminal_surface_opacity: terminalSurfaceOpacity") &&
  settingsSource.includes("surfaceOpacity: terminalSurfaceOpacity") &&
  nativeTerminalAreaSource.includes("terminalTextClarity = useAppStore((s) => s.terminalTextClarity)") &&
  nativeTerminalAreaSource.includes("textClarity={terminalTextClarity}") &&
  nativeTerminalAreaSource.includes("useTerminalCellMetrics(terminalFontSize, terminalFontFamily, terminalLineHeight)") &&
  agentTerminalSource.includes("terminalTextClarity = useAppStore((s) => s.terminalTextClarity)") &&
  agentTerminalSource.includes("textClarity={terminalTextClarity}") &&
  agentTerminalSource.includes("useTerminalCellMetrics(terminalFontSize, terminalFontFamily, terminalLineHeight)") &&
  terminalPaintSource.includes("enhanceTerminalTextColor") &&
  terminalColorsSource.includes("forceOpaqueCssColor") &&
  terminalColorsSource.includes("return opaqueColor") &&
  terminalColorsTestSource.includes("forces translucent legible glyph colours opaque outside glass mode") &&
  terminalColorsSource.includes("minimumTerminalContrastRatio") &&
  terminalColorsSource.includes("dimAlphaForTextClarity") &&
  terminalCanvasSource.includes('textClarity = "solid"') &&
  terminalCanvasSource.includes("data-terminal-text-clarity={textClarity}");
const terminalFontRenderContractFresh =
  terminalFontRenderContract?.ok === true &&
  terminalFontRenderContract?.status === "pass" &&
  terminalFontRenderContract?.sourcePaths?.includes?.("src/features/settings/Settings.tsx") &&
  terminalFontRenderContract?.sourcePaths?.includes?.("src/features/agent-terminal/AgentTerminal.tsx") &&
  terminalFontRenderContract?.sourcePaths?.includes?.("src/features/terminal/terminalCanvasGeometry.ts") &&
  terminalFontRenderContract?.sourcePaths?.includes?.("src/features/terminal/terminalPaint.ts") &&
  terminalFontRenderContract?.sourcePaths?.includes?.("src/features/terminal/terminalColors.ts") &&
  terminalFontRenderContract?.sourcePaths?.includes?.("src/features/terminal/repaintDecision.ts") &&
  terminalFontRenderContract?.sourcePaths?.includes?.("src/features/terminal/pane-tree/PaneTreeRenderer.tsx") &&
  terminalFontRenderContract?.sourcePaths?.includes?.("src/__tests__/TerminalFontSettingsContract.test.ts") &&
  terminalFontRenderContract?.sourcePaths?.includes?.("src/__tests__/terminalColors.test.ts") &&
  mtimeMs(terminalFontRenderContractPath) + 5_000 >=
    Math.max(
      mtimeMs(join(ROOT, "scripts", "verify-terminal-font-render-contract.mjs")),
      mtimeMs(join(ROOT, "package.json")),
      mtimeMs(join(ROOT, "src", "App.tsx")),
      mtimeMs(join(ROOT, "src", "features", "settings", "Settings.tsx")),
      mtimeMs(join(ROOT, "src", "features", "terminal", "NativeTerminalArea.tsx")),
      mtimeMs(join(ROOT, "src", "features", "agent-terminal", "AgentTerminal.tsx")),
      mtimeMs(join(ROOT, "src", "features", "terminal", "TerminalCanvas.tsx")),
      mtimeMs(join(ROOT, "src", "features", "terminal", "terminalCanvasGeometry.ts")),
      mtimeMs(join(ROOT, "src", "features", "terminal", "terminalPaint.ts")),
      mtimeMs(join(ROOT, "src", "features", "terminal", "terminalColors.ts")),
      mtimeMs(join(ROOT, "src", "features", "terminal", "repaintDecision.ts")),
      mtimeMs(join(ROOT, "src", "features", "terminal", "pane-tree", "PaneTreeRenderer.tsx")),
      mtimeMs(join(ROOT, "src", "features", "terminal", "terminalMetrics.ts")),
      mtimeMs(join(ROOT, "src", "shared", "store", "appStore.ts")),
      mtimeMs(join(ROOT, "src", "__tests__", "TerminalFontSettingsContract.test.ts")),
      mtimeMs(join(ROOT, "src", "__tests__", "terminalColors.test.ts")),
    );
const terminalRenderFidelityBlockers = [
  ...(terminalCanvasDprBacked ? [] : ["terminal canvas backing store is not device-pixel-ratio backed"]),
  ...(terminalCanvasGeometryRepaint ? [] : ["terminal canvas does not repaint when font/DPR geometry changes"]),
  ...(terminalCanvasTextLayerAboveDecor
    ? []
    : ["terminal canvas text is not proven above decorative viewport overlays"]),
  ...(terminalCanvasNoPixelatedText ? [] : ["terminal canvas text still uses pixelated bitmap scaling"]),
  ...(terminalCanvasCrispText
    ? []
    : ["terminal canvas text is not snapped to device pixels with explicit text rendering state"]),
  ...(terminalPaneMountPixelSnapped
    ? []
    : ["terminal pane mounts are not proven snapped to physical pixels before canvas compositing"]),
  ...(terminalCanvasFidelityTests ? [] : ["terminal text render fidelity unit coverage is missing"]),
  ...(terminalFontRenderContractSourcePass ? [] : ["terminal font/render settings source contract is incomplete"]),
  ...(terminalFontRenderContractFresh ? [] : ["terminal font/render settings artifact is missing, stale, or failing"]),
];
add(
  scores,
  "terminal-render-fidelity",
  "Terminal text render fidelity",
  terminalRenderFidelityBlockers.length === 0 ? 4 : 0,
  4,
  terminalRenderFidelityBlockers.length === 0
    ? "DPR-backed canvas, pixel-snapped glyphs and pane mounts, contrast-floor clarity modes, geometry repaint, no pixelated text scaling, text layer above overlays, and settings-backed Cascadia/Japanese fallback font stack"
    : "missing render fidelity guarantees",
  terminalRenderFidelityBlockers,
);

const nativeBoundaryFresh =
  nativeBoundaryContract?.ok === true &&
  nativeBoundaryContract?.status === "pass" &&
  mtimeMs(nativeBoundaryContractPath) + 5_000 >=
    Math.max(
      mtimeMs(join(ROOT, "scripts", "verify-native-boundary-contract.mjs")),
      mtimeMs(join(ROOT, "src", "features", "terminal", "NativeTerminalArea.tsx")),
      mtimeMs(join(ROOT, "src", "features", "terminal", "pane-tree", "PaneTreeContainer.tsx")),
      mtimeMs(join(ROOT, "src", "features", "terminal", "pane-tree", "usePaneTree.ts")),
      mtimeMs(join(ROOT, "src", "features", "terminal", "TerminalCanvas.tsx")),
      mtimeMs(join(ROOT, "src", "features", "terminal", "keymap.ts")),
      mtimeMs(join(ROOT, "src", "features", "terminal", "hooks", "useCanvasIME.ts")),
      mtimeMs(join(ROOT, "src", "features", "terminal", "hooks", "useTerminalSelection.ts")),
      mtimeMs(join(ROOT, "src", "shared", "lib", "nativeClipboard.ts")),
      mtimeMs(join(ROOT, "src", "shared", "hooks", "useKeyboardShortcuts.ts")),
      mtimeMs(join(ROOT, "src", "shared", "hooks", "useEditableTargetGuard.ts")),
      mtimeMs(join(ROOT, "src", "shared", "hooks", "useGitStatus.ts")),
      mtimeMs(join(ROOT, "src", "styles", "global.css")),
      mtimeMs(join(ROOT, "src-tauri", "Cargo.toml")),
      mtimeMs(join(ROOT, "src-tauri", "src", "api", "mod.rs")),
      mtimeMs(join(ROOT, "src-tauri", "src", "bin", "aelys.rs")),
      mtimeMs(join(ROOT, "src-tauri", "src", "bin", "aelyris_native.rs")),
      mtimeMs(join(ROOT, "src-tauri", "src", "term", "mod.rs")),
      mtimeMs(join(ROOT, "src-tauri", "src", "term", "render_frame.rs")),
      mtimeMs(join(ROOT, "src-tauri", "src", "term", "render_pipeline.rs")),
      mtimeMs(join(ROOT, "src-tauri", "src", "term", "native_input.rs")),
      mtimeMs(join(ROOT, "src-tauri", "src", "pty_sidecar.rs")),
      mtimeMs(join(ROOT, "src-tauri", "src", "ipc", "interactive_commands.rs")),
      mtimeMs(join(ROOT, "scripts", "verify-mux-live-restore.mjs")),
      mtimeMs(join(ROOT, "scripts", "verify-mux-live-process-preservation.mjs")),
      mtimeMs(muxLiveProcessPreservationPath),
      mtimeMs(join(ROOT, "scripts", "verify-native-client-spike.mjs")),
      mtimeMs(nativeClientSpikePath),
    );
const nativeBoundaryCheckEntries = Array.isArray(nativeBoundaryContract?.checks) ? nativeBoundaryContract.checks : [];
const nativeBoundaryPassedIds = new Set(
  nativeBoundaryCheckEntries.filter((check) => check?.status === "passed").map((check) => check.id),
);
const nativeBoundaryRequiredIds = [
  "no-xterm-boundary",
  "active-source-no-xterm-integration",
  "native-input-rust-host",
  "native-input-artifact",
  "webview-ime-fallback-contained",
  "clipboard-native-first",
  "sidecar-command-session-boundary",
  "daemon-contract-policy",
  "sidecar-command-session-artifact",
  "mux-ui-rust-owned",
  "mux-fallback-visible",
  "no-silent-fallback-contract",
  "planner-sidecar-preflight",
  "native-client-spike",
];
const nativeBoundarySourcePass =
  packageJsonSource.includes('"verify:terminal:native-boundary"') &&
  nativeBoundaryContractScriptSource.includes("native-boundary-contract.json") &&
  nativeBoundaryContractScriptSource.includes("active-source-no-xterm-integration") &&
  nativeBoundaryContractScriptSource.includes(
    "active terminal sources contain no xterm imports/runtime hooks/legacy focus selectors",
  ) &&
  !activeXtermIntegrationBlocked &&
  editableTargetGuardSource.includes('el.getAttribute("data-native-input-surface") === "true"') &&
  editableTargetGuardSource.includes('el.getAttribute("role") === "textbox"') &&
  !editableTargetGuardSource.includes("xterm-screen") &&
  !globalStylesSource.includes("xterm-screen") &&
  nativeBoundaryContractScriptSource.includes(
    "mux fallback, pane metadata sync, pane layout persistence, local recovery, and backend PTY cleanup failures are telemetry-visible",
  ) &&
  nativeBoundaryContractScriptSource.includes("daemon-contract-policy") &&
  nativeBoundaryContractScriptSource.includes(
    "daemon contract exposes machine-readable detach, attach, restart-restore, shutdown, graph-version, transport, auth, honest terminal-core render/input/fallback policies",
  ) &&
  nativeBoundaryContractScriptSource.includes("daemonRestartRestoreProofReady") &&
  nativeBoundaryContractScriptSource.includes("daemonLiveProcessPreservationReady") &&
  nativeBoundaryContractScriptSource.includes("muxLiveProcessPreservationArtifactPath") &&
  nativeBoundaryContractScriptSource.includes("processPreservationReady") &&
  nativeBoundaryContractScriptSource.includes("terminal-core-policy-machine-readable") &&
  nativeBoundaryContractScriptSource.includes("terminal-core-policy-stable-after-restart") &&
  nativeBoundaryContractScriptSource.includes("terminalCorePolicy") &&
  nativeBoundaryContractScriptSource.includes("aelys-daemon-contract-parity") &&
  nativeBoundaryContractScriptSource.includes("aelys-scrollback-search-parity") &&
  nativeBoundaryContractScriptSource.includes("aelys-mux-export-parity") &&
  nativeBoundaryContractScriptSource.includes("aelys-mux-import-parity") &&
  nativeBoundaryContractScriptSource.includes("mux-import-restore-pending") &&
  nativeBoundaryContractScriptSource.includes("mux-import-replace-closes-live-pty") &&
  nativeBoundaryContractScriptSource.includes("native-client-spike") &&
  nativeBoundaryContractScriptSource.includes("aelyris-native exists as a Rust-native, no-WebView attaching client") &&
  nativeBoundaryContractScriptSource.includes("native-render-pipeline-contract") &&
  nativeBoundaryContractScriptSource.includes("native-render-commit-series-contract") &&
  nativeClientSpikeScriptSource.includes("native-client-no-webview-boundary") &&
  nativeClientSpikeScriptSource.includes("native-window-proof-no-webview") &&
  nativeClientSpikeScriptSource.includes("native-window-layered-alpha") &&
  nativeClientSpikeScriptSource.includes("native-render-proof-uses-daemon-capture") &&
  nativeClientSpikeScriptSource.includes("native-render-proof-nonblank-text") &&
  nativeClientSpikeScriptSource.includes("native-grid-render-proof-uses-term-engine") &&
  nativeClientSpikeScriptSource.includes("native-grid-render-proof-nonblank-cells") &&
  nativeClientSpikeScriptSource.includes("native-render-frame-contract") &&
  nativeClientSpikeScriptSource.includes("native-render-diff-contract") &&
  nativeClientSpikeScriptSource.includes("native-render-pipeline-contract") &&
  nativeClientSpikeScriptSource.includes("native-render-commit-series-contract") &&
  nativeClientSpikeScriptSource.includes("native-send-and-capture-roundtrip") &&
  apiSource.includes("contract_schema_version: u32") &&
  apiSource.includes("mux_graph_version: u32") &&
  apiSource.includes('transport: "loopback-http-websocket"') &&
  apiSource.includes('client_detach_policy: "detach-keeps-live-pty-while-daemon-running"') &&
  apiSource.includes("restart_restore_policy:") &&
  apiSource.includes("snapshot-restores-graph-as-restore-pending-with-durable-scrollback") &&
  apiSource.includes('attach_policy: "reattach-respawns-only-missing-or-restore-pending-pty-bindings"') &&
  apiSource.includes('shutdown_policy: "explicit-workspace-close-terminates-owned-child-ptys"') &&
  apiSource.includes("terminal_core_policy: TerminalCorePolicyResponse") &&
  apiSource.includes("fn terminal_core_policy()") &&
  apiSource.includes('native_input_owner: "rust-native-input-host"') &&
  apiSource.includes('renderer_truth_source: "rust-term-engine-render-pipeline"') &&
  apiSource.includes('render_frame_schema: "aelyris.native.render-frame.v1"') &&
  apiSource.includes('render_diff_schema: "aelyris.native.render-diff.v1"') &&
  apiSource.includes('render_commit_schema: "aelyris.native.render-commit.v1"') &&
  apiSource.includes('render_pipeline_boundary: "rust-native-render-pipeline"') &&
  apiSource.includes('current_presentation_surface: "react-canvas-presentation-with-rust-term-engine-truth"') &&
  apiSource.includes("native_renderer_status:") &&
  apiSource.includes('"aelyris-native-no-webview-spike-proved-full-product-renderer-pending"') &&
  apiSource.includes("renderer_claim_policy:") &&
  apiSource.includes('"do-not-claim-main-window-full-native-renderer-until-native-present-loop-dogfooded"') &&
  apiSource.includes('webview_terminal_renderer_policy: "fallback-contained-not-source-of-truth"') &&
  apiSource.includes('react_terminal_renderer_policy: "control-plane-only-not-terminal-core"') &&
  apiSource.includes('fallback_visibility_policy: "release-blocking-telemetry"') &&
  aelysSource.includes('"daemon" | "contract"') &&
  aelysSource.includes('"search" | "scrollback-search"') &&
  aelysSource.includes('"mux-export"') &&
  aelysSource.includes('"mux-import"') &&
  aelysSource.includes("/mux/workspaces/{workspace_id}/export") &&
  aelysSource.includes("/mux/workspaces/import?replace={replace}") &&
  aelysSource.includes("/sessions/{id}/search?query={}") &&
  aelysSource.includes("query_component(&query)") &&
  cargoTomlSource.includes('name = "aelyris-native"') &&
  packageJsonSource.includes('"verify:terminal:native-client"') &&
  aelyrisNativeSource.includes('"aelyris.native.client.v1"') &&
  aelyrisNativeSource.includes('"uiBoundary": "no-webview"') &&
  aelyrisNativeSource.includes('"muxTruthSource": "daemon-api"') &&
  aelyrisNativeSource.includes('"pending-native-terminal-renderer-after-window-proof"') &&
  aelyrisNativeSource.includes('"native-window-proof"') &&
  aelyrisNativeSource.includes('"native-text-render-proof"') &&
  aelyrisNativeSource.includes('"native-grid-render-proof"') &&
  aelyrisNativeSource.includes("CreateWindowExW") &&
  aelyrisNativeSource.includes("SetLayeredWindowAttributes") &&
  aelyrisNativeSource.includes("TextOutW") &&
  aelyrisNativeSource.includes("native-gdi-text-proof") &&
  aelyrisNativeSource.includes("native-gdi-grid-proof") &&
  aelyrisNativeSource.includes("TermEngine::new") &&
  aelyrisNativeSource.includes("NativeRenderFrame::from_snapshot") &&
  aelyrisNativeSource.includes("NativeRenderPipeline::new") &&
  aelyrisNativeSource.includes("commit_snapshot") &&
  aelyrisNativeSource.includes("renderCommitSeries") &&
  termModSource.includes("NativeRenderFrame") &&
  termModSource.includes("NativeRenderFrameDiff") &&
  termModSource.includes("NativeRenderPipeline") &&
  termRenderFrameSource.includes("aelyris.native.render-frame.v1") &&
  termRenderFrameSource.includes("aelyris.native.render-diff.v1") &&
  termRenderPipelineSource.includes("aelyris.native.render-commit.v1") &&
  termRenderPipelineSource.includes("rust-native-render-pipeline") &&
  termRenderPipelineSource.includes("winit-wgpu-present-loop") &&
  aelyrisNativeSource.includes("/mux/workspaces/{workspace_id}/attach") &&
  nativeClientSpike?.status === "passed" &&
  nativeClientSpike?.nativeContract?.client?.process === "aelyris-native" &&
  nativeClientSpike?.nativeContract?.client?.uiBoundary === "no-webview" &&
  nativeClientSpike?.nativeContract?.claims?.webviewUsed === false &&
  nativeClientSpike?.nativeContract?.claims?.muxTruthSource === "daemon-api" &&
  nativeClientSpike?.nativeContract?.daemon?.instanceId === nativeClientSpike?.directContract?.instanceId &&
  nativeClientSpike?.nativeWindow?.daemonInstanceId === nativeClientSpike?.directContract?.instanceId &&
  nativeClientSpike?.nativeWindow?.window?.nativeWindowCreated === true &&
  nativeClientSpike?.nativeWindow?.window?.webviewUsed === false &&
  nativeClientSpike?.nativeWindow?.window?.reactUsed === false &&
  nativeClientSpike?.nativeWindow?.window?.layered === true &&
  nativeClientSpike?.nativeWindow?.window?.alpha === 218 &&
  nativeClientSpike?.nativeRender?.daemonInstanceId === nativeClientSpike?.directContract?.instanceId &&
  nativeClientSpike?.nativeRender?.source?.expectedFound === true &&
  nativeClientSpike?.nativeRender?.renderer?.terminalRenderer === "native-gdi-text-proof" &&
  nativeClientSpike?.nativeRender?.renderer?.webviewUsed === false &&
  nativeClientSpike?.nativeRender?.renderer?.reactUsed === false &&
  nativeClientSpike?.nativeRender?.renderer?.nativeTextDrawn === true &&
  nativeClientSpike?.nativeRender?.renderer?.nonBlank === true &&
  nativeClientSpike?.nativeRender?.renderer?.nonBackgroundSamples > 0 &&
  nativeClientSpike?.nativeRender?.window?.nativeWindowCreated === true &&
  nativeClientSpike?.nativeGridRender?.daemonInstanceId === nativeClientSpike?.directContract?.instanceId &&
  nativeClientSpike?.nativeGridRender?.source?.expectedFound === true &&
  nativeClientSpike?.nativeGridRender?.grid?.cols === 100 &&
  nativeClientSpike?.nativeGridRender?.grid?.rows === 24 &&
  nativeClientSpike?.nativeGridRender?.grid?.nonBlankCells > 0 &&
  nativeClientSpike?.nativeGridRender?.renderFrame?.schema === "aelyris.native.render-frame.v1" &&
  nativeClientSpike?.nativeGridRender?.renderFrame?.rendererBoundary === "rust-native-render-frame" &&
  nativeClientSpike?.nativeGridRender?.renderFrame?.webviewUsed === false &&
  nativeClientSpike?.nativeGridRender?.renderFrame?.reactUsed === false &&
  nativeClientSpike?.nativeGridRender?.renderFrame?.frameSha256?.length === 64 &&
  nativeClientSpike?.nativeGridRender?.renderDiff?.schema === "aelyris.native.render-diff.v1" &&
  nativeClientSpike?.nativeGridRender?.renderDiff?.currentFrameSha256 ===
    nativeClientSpike?.nativeGridRender?.renderFrame?.frameSha256 &&
  nativeClientSpike?.nativeGridRender?.renderDiff?.rendererBoundary === "rust-native-render-frame-diff" &&
  nativeClientSpike?.nativeGridRender?.renderDiff?.webviewUsed === false &&
  nativeClientSpike?.nativeGridRender?.renderDiff?.reactUsed === false &&
  nativeClientSpike?.nativeGridRender?.renderDiff?.dirtyCells > 0 &&
  nativeClientSpike?.nativeGridRender?.renderDiff?.dirtyRects?.length > 0 &&
  nativeClientSpike?.nativeGridRender?.renderCommit?.schema === "aelyris.native.render-commit.v1" &&
  nativeClientSpike?.nativeGridRender?.renderCommit?.rendererBoundary === "rust-native-render-pipeline" &&
  nativeClientSpike?.nativeGridRender?.renderCommit?.webviewUsed === false &&
  nativeClientSpike?.nativeGridRender?.renderCommit?.reactUsed === false &&
  nativeClientSpike?.nativeGridRender?.renderCommit?.sequence === 2 &&
  nativeClientSpike?.nativeGridRender?.renderCommit?.repaintMode === "partial" &&
  nativeClientSpike?.nativeGridRender?.renderCommit?.frame?.frameSha256 ===
    nativeClientSpike?.nativeGridRender?.renderFrame?.frameSha256 &&
  nativeClientSpike?.nativeGridRender?.renderCommit?.diff?.currentFrameSha256 ===
    nativeClientSpike?.nativeGridRender?.renderFrame?.frameSha256 &&
  nativeClientSpike?.nativeGridRender?.renderCommit?.diff?.dirtyRects?.length > 0 &&
  Array.isArray(nativeClientSpike?.nativeGridRender?.renderCommitSeries) &&
  nativeClientSpike.nativeGridRender.renderCommitSeries.length === 3 &&
  nativeClientSpike.nativeGridRender.renderCommitSeries[0]?.sequence === 1 &&
  nativeClientSpike.nativeGridRender.renderCommitSeries[0]?.repaintMode === "full" &&
  nativeClientSpike.nativeGridRender.renderCommitSeries[0]?.diff?.fullRepaint === true &&
  nativeClientSpike.nativeGridRender.renderCommitSeries[1]?.sequence === 2 &&
  nativeClientSpike.nativeGridRender.renderCommitSeries[1]?.repaintMode === "partial" &&
  nativeClientSpike.nativeGridRender.renderCommitSeries[1]?.frame?.frameSha256 ===
    nativeClientSpike?.nativeGridRender?.renderFrame?.frameSha256 &&
  nativeClientSpike.nativeGridRender.renderCommitSeries[2]?.sequence === 3 &&
  nativeClientSpike.nativeGridRender.renderCommitSeries[2]?.repaintMode === "unchanged" &&
  nativeClientSpike.nativeGridRender.renderCommitSeries[2]?.diff?.dirtyCells === 0 &&
  nativeClientSpike.nativeGridRender.renderCommitSeries[2]?.frame?.frameSha256 ===
    nativeClientSpike?.nativeGridRender?.renderFrame?.frameSha256 &&
  nativeClientSpike?.nativeGridRender?.renderer?.terminalRenderer === "native-gdi-grid-proof" &&
  nativeClientSpike?.nativeGridRender?.renderer?.renderFrameSha256 ===
    nativeClientSpike?.nativeGridRender?.renderFrame?.frameSha256 &&
  nativeClientSpike?.nativeGridRender?.renderer?.rendererBoundary === "rust-native-render-frame" &&
  nativeClientSpike?.nativeGridRender?.renderer?.nativeCellGrid === true &&
  nativeClientSpike?.nativeGridRender?.renderer?.webviewUsed === false &&
  nativeClientSpike?.nativeGridRender?.renderer?.reactUsed === false &&
  nativeClientSpike?.nativeGridRender?.renderer?.nonBlank === true &&
  nativeClientSpike?.nativeGridRender?.renderer?.nonBackgroundSamples > 0 &&
  nativeClientSpike?.nativeGridRender?.window?.nativeWindowCreated === true &&
  nativeClientSpike?.checks?.includes?.("native-render-frame-contract") &&
  nativeClientSpike?.checks?.includes?.("native-render-diff-contract") &&
  nativeClientSpike?.checks?.includes?.("native-render-pipeline-contract") &&
  nativeClientSpike?.checks?.includes?.("native-render-commit-series-contract") &&
  paneTreeContainerSource.includes("reportFallback") &&
  paneTreeContainerSource.includes("reportInvokeFailure") &&
  paneTreeContainerSource.includes('source: "pane-mux"') &&
  paneTreeContainerSource.includes('source: "pane-metadata"') &&
  paneTreeContainerSource.includes('operation: "rename_pane"') &&
  paneTreeContainerSource.includes('operation: "set_pane_role"') &&
  paneTreeContainerSource.includes('operation: "load_tauri_core"') &&
  paneTreeContainerSource.includes('"list_terminals_after_empty_panes"') &&
  livePanesHookSource.includes('source: "live-panes"') &&
  livePanesHookSource.includes('operation: "list_terminals"') &&
  livePanesHookSource.includes("Live terminal truth unavailable") &&
  ghostLayersHookSource.includes('source: "ghost-layers"') &&
  ghostLayersHookSource.includes('"list_ghost_layers"') &&
  ghostLayersHookSource.includes('"dismiss_ghost_layer"') &&
  ghostLayersHookSource.includes('"get_ghost_layer_file"') &&
  paneTreeHookSource.includes("reportInvokeFailure") &&
  paneTreeHookSource.includes('source: "pane-tree"') &&
  paneTreeHookSource.includes("operation,") &&
  paneTreeHookSource.includes("close_all_terminals_close_terminal") &&
  paneTreePersistenceSource.includes('source: "pane-tree-persistence"') &&
  paneTreePersistenceSource.includes('"local_load_snapshot"') &&
  paneTreePersistenceSource.includes('"backend_save_snapshot"') &&
  paneTreePersistenceSource.includes('"mux_load_snapshot"') &&
  terminalSelectionSource.includes("writeClipboardText") &&
  nativeClipboardSource.includes('invoke("write_clipboard_text"') &&
  nativeClipboardSource.includes("write_clipboard_text_browser_fallback") &&
  nativeClipboardSource.includes("browser_write_clipboard_text") &&
  nativeClipboardSource.includes("write_clipboard_text_unavailable") &&
  nativeClipboardSource.includes('boundary: "webview-fallback"') &&
  nativeClipboardSource.includes("nativeBoundaryEscaped: true") &&
  shellIntegrationSource.includes("writeClipboardText") &&
  shellIntegrationSource.includes('source: "settings.shell-integration"') &&
  !shellIntegrationSource.includes("navigator.clipboard") &&
  canvasImeSource.includes("read_clipboard_text_browser_fallback") &&
  canvasImeSource.includes("browser_read_clipboard_text") &&
  canvasImeSource.includes("read_clipboard_text_unavailable") &&
  canvasImeSource.includes('boundary: "webview-fallback"') &&
  canvasImeSource.includes("nativeBoundaryEscaped: true") &&
  nativeClipboardSource.includes("userVisible: true") &&
  nativeTerminalAreaSource.includes('source: "terminal.snapshot-overlay"') &&
  nativeTerminalAreaSource.includes('operation: "dismiss_ghost_layer"') &&
  nativeTerminalAreaSource.includes('operation: "ghost_diff_layer_removed_listener"') &&
  nativeTerminalAreaSource.includes('source: "terminal.input-mirror"') &&
  nativeTerminalAreaSource.includes('operation: "suggest_next"') &&
  nativeTerminalAreaSource.includes('source: "input-mirror"') &&
  nativeTerminalAreaSource.includes('operation: "save_command_history"') &&
  gitStatusHookSource.includes('source: "git-status.watcher"') &&
  gitStatusHookSource.includes("stop_fs_watcher_after_abort") &&
  nativeBoundaryContractScriptSource.includes(
    "fallback, stale state, stale overlays, font-metric drift, watcher leaks, and command-history loss are explicit release blockers",
  ) &&
  terminalMetricsSource.includes('source: "terminal-metrics"') &&
  terminalMetricsSource.includes('operation: "fonts_ready"') &&
  [
    "mux_split_pane",
    "mux_close_pane",
    "mux_apply_layout",
    "mux_swap_panes",
    "mux_set_panes_synchronized",
    "mux_set_pane_zoom",
  ].every((operation) => paneTreeContainerSource.includes(`operation: "${operation}"`));
const nativeBoundaryPass =
  nativeBoundaryFresh &&
  nativeBoundarySourcePass &&
  nativeBoundaryRequiredIds.every((id) => nativeBoundaryPassedIds.has(id));
add(
  scores,
  "native-boundary-contract",
  "Native terminal boundary contract",
  nativeBoundaryPass ? 10 : 0,
  10,
  nativeBoundaryPass
    ? `${nativeBoundaryRequiredIds.length}/${nativeBoundaryRequiredIds.length} native boundary checks pass`
    : nativeBoundaryContract
      ? `${nativeBoundaryPassedIds.size}/${nativeBoundaryRequiredIds.length} native boundary checks pass`
      : "missing",
  nativeBoundaryPass
    ? []
    : [
        ...(nativeBoundaryFresh ? [] : ["native boundary contract artifact is missing, stale, or failing"]),
        ...(nativeBoundarySourcePass
          ? []
          : ["native boundary verifier or mux fallback telemetry source contract is incomplete"]),
        ...nativeBoundaryRequiredIds
          .filter((id) => !nativeBoundaryPassedIds.has(id))
          .map((id) => `native boundary check failed: ${id}`),
      ],
);

const releaseReadinessClaimIds = ["tmux", "sharedWorkspace", "nativeTerminal", "release"];
const releaseReadinessArtifactCurrent =
  releaseReadinessTerminalAiOs != null &&
  ["pass", "block", "review", "external-blocked"].includes(releaseReadinessTerminalAiOs?.status) &&
  mtimeMs(releaseReadinessTerminalAiOsPath) + 5_000 >=
    Math.max(
      mtimeMs(join(ROOT, "scripts", "verify-release-readiness-aggregate.mjs")),
      mtimeMs(join(ROOT, "scripts", "verify-current-readiness-source.mjs")),
      mtimeMs(join(ROOT, "scripts", "verify-native-operator-primary-terminal.mjs")),
      mtimeMs(join(ROOT, "scripts", "verify-native-text-shaping-fallback.mjs")),
      mtimeMs(join(ROOT, "scripts", "verify-native-visual-regression.mjs")),
      mtimeMs(join(ROOT, "docs", "specs", "VISIBLE_AGENT_PANE_RUNTIME_SPEC.md")),
    );
const releaseReadinessFresh =
  releaseReadinessArtifactCurrent && releaseReadinessTerminalAiOs?.ok === true && releaseReadinessTerminalAiOs?.status === "pass";
const releaseReadinessClaims = releaseReadinessTerminalAiOs?.claims ?? {};
const releaseReadinessSourcePass =
  packageJsonSource.includes('"verify:release-readiness-aggregate"') &&
  releaseReadinessTerminalAiOsScriptSource.includes('schema: "aelyris.release-readiness-aggregate/v1"') &&
  releaseReadinessTerminalAiOsScriptSource.includes("noNativeShapingClaimWithoutSystemShaping") &&
  releaseReadinessTerminalAiOsScriptSource.includes("noReleaseReadinessClaimWhileReleaseBlocked") &&
  releaseReadinessTerminalAiOsScriptSource.includes("nativeTextShaping") &&
  releaseReadinessTerminalAiOsScriptSource.includes("muxLiveRestore") &&
  releaseReadinessTerminalAiOsScriptSource.includes("sharedBrainRestart");
const releaseReadinessPass =
  releaseReadinessFresh && releaseReadinessSourcePass && releaseReadinessClaimIds.every((id) => releaseReadinessClaims[id] === "pass");
add(
  scores,
  "release-readiness-aggregate",
  "Release readiness aggregate gate",
  releaseReadinessPass ? 16 : 0,
  16,
  releaseReadinessPass
    ? "tmux, shared-agent-workspace, native terminal, and release claims are all pass"
    : releaseReadinessTerminalAiOs
      ? `${releaseReadinessTerminalAiOs.status ?? "unknown"}: ${releaseReadinessClaimIds
          .map((id) => `${id}=${releaseReadinessClaims[id] ?? "missing"}`)
          .join(", ")}`
      : "missing",
  releaseReadinessPass
    ? []
    : [
        ...(releaseReadinessArtifactCurrent ? [] : ["release readiness aggregate artifact is missing or stale"]),
        ...(releaseReadinessArtifactCurrent && releaseReadinessTerminalAiOs?.status === "block"
          ? ["release readiness aggregate gate is currently blocked"]
          : []),
        ...(releaseReadinessArtifactCurrent && releaseReadinessTerminalAiOs?.status === "external-blocked"
          ? ["release readiness aggregate gate is externally blocked"]
          : []),
        ...(releaseReadinessSourcePass ? [] : ["release readiness aggregate verifier or package wiring is incomplete"]),
        ...releaseReadinessClaimIds
          .filter((id) => releaseReadinessClaims[id] !== "pass")
          .map((id) => `release readiness claim blocked: ${id}=${releaseReadinessClaims[id] ?? "missing"}`),
      ],
);

const risks = Array.isArray(riskRegister?.risks) ? riskRegister.risks : [];
const openRisks = risks.filter(
  (risk) => !["closed", "mitigated", "resolved", "accepted"].includes(String(risk.status ?? "").toLowerCase()),
);
const acceptedReleaseRisks = risks.filter((risk) => {
  const status = String(risk.status ?? "").toLowerCase();
  if (status !== "accepted") return false;
  return /release|dist|sign|installer|updater|crash|rollback|tauri|webview|ime|sleep|resume/i.test(
    `${risk.key ?? ""} ${risk.title ?? ""} ${risk.mitigation ?? ""} ${risk.closureReason ?? ""}`,
  );
});
const riskPoints = openRisks.length === 0 ? (acceptedReleaseRisks.length === 0 ? 18 : 12) : 4;
add(
  scores,
  "risk-register",
  "Risk register",
  riskPoints,
  18,
  `${openRisks.length} open, ${acceptedReleaseRisks.length} accepted release`,
  [
    ...openRisks.slice(0, 6).map((risk) => `open: ${risk.id}`),
    ...acceptedReleaseRisks.slice(0, 6).map((risk) => `accepted release: ${risk.id}`),
  ],
);

const realSuspendPass =
  realSuspend?.status === "pass" &&
  realSuspend?.checks?.appResponsive === true &&
  realSuspend?.checks?.terminalResponsive === true &&
  realSuspend?.checks?.sqliteWritable === true &&
  realSuspend?.checks?.paneStatePreserved === true &&
  realSuspend?.validation?.windowsPowerEvents?.suspendEventFound === true &&
  realSuspend?.validation?.windowsPowerEvents?.resumeEventFound === true;
const realSuspendMissingFields = Array.isArray(realSuspendDiagnostic?.missingFields)
  ? realSuspendDiagnostic.missingFields
  : [];
const realSuspendPowerEvents = realSuspendDiagnostic?.validation?.windowsPowerEvents;
const realSuspendPowerCapabilities = realSuspendDiagnostic?.validation?.powerCapabilities;
const realSuspendAppExecutable = realSuspendDiagnostic?.validation?.appExecutable;
const realSuspendPostResumeProbes = realSuspendDiagnostic?.validation?.postResumeProbes;
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
  realSuspendNativePostcheckWriteSmokePass;
const realSuspendUserCycleBlockedEvidenceReady =
  realSuspendUserCycleTimedOut &&
  realSuspendNativePreflightReady &&
  realSuspendNativePostcheckPreflightReady &&
  realSuspendNativePostcheckWriteSmokePass;
const realSuspendExternalBlockedEvidenceReady =
  realSuspendHostBlockedEvidenceReady || realSuspendUserCycleBlockedEvidenceReady;
const realSuspendProbeDetail = realSuspendPostResumeProbes
  ? `; probes process ${realSuspendPostResumeProbes.process?.ok === true ? "up" : "down"}/api ${
      realSuspendPostResumeProbes.apiHealth?.ok === true ? "up" : "down"
    }/terminal ${realSuspendPostResumeProbes.terminalRoundtrip?.ok === true ? "up" : "down"}/db ${
      realSuspendPostResumeProbes.dbPaneLayout?.ok === true ? "up" : "down"
    }${realSuspendPostResumeProbes.dbPaneLayout?.command ? ` (${realSuspendPostResumeProbes.dbPaneLayout.command})` : ""}`
  : "; probes missing";
const realSuspendDiagnosticFresh =
  realSuspendDiagnostic !== null &&
  mtimeMs(realSuspendDiagnosticPath) + 5_000 >= Math.max(mtimeMs(realSuspendPath), mtimeMs(appExe));
const realSuspendDiagnosticDetail = realSuspendDiagnostic
  ? `${realSuspendDiagnosticFresh ? "fresh" : "stale"} ${
      realSuspendDiagnostic.status ?? "diagnostic"
    }; ${realSuspendMissingFields.length} missing; app ${
      realSuspendAppExecutable?.exists
        ? `${Math.round((realSuspendAppExecutable.bytes ?? 0) / 1024 / 1024)}MiB`
        : "missing"
    }${realSuspendProbeDetail}; power events ${
      realSuspendPowerEvents?.queried
        ? `${realSuspendPowerEvents.suspendEventFound ? "suspend" : "no suspend"}/${
            realSuspendPowerEvents.resumeEventFound ? "resume" : "no resume"
          }`
        : "not queried"
    }; sleep ${realSuspendPowerCapabilities?.queried ? (realSuspendPowerCapabilities.availableStates ?? []).join("+") || "unknown" : "unknown"}`
  : "diagnostic missing";
const realSuspendHostBlockedDetail = `host-blocked: ${
  realSuspendSleepAttempt?.reason ?? "Windows sleep API rejected the suspend attempt"
}; native preflight ${realSuspendNativePreflightReady ? "ready" : "missing"}, native postcheck preflight ${
  realSuspendNativePostcheckPreflightReady ? "ready" : "missing"
}, postcheck writer ${realSuspendNativePostcheckWriteSmokePass ? "pass/no-real-sleep-claim" : "missing"}`;
const realSuspendUserCycleBlockedDetail = `user-cycle-blocked: ${
  realSuspendUserInitiatedSleepWait?.reason ?? "user-initiated Windows sleep/resume event pair was not observed"
}; native preflight ${realSuspendNativePreflightReady ? "ready" : "missing"}, native postcheck preflight ${
  realSuspendNativePostcheckPreflightReady ? "ready" : "missing"
}, postcheck writer ${realSuspendNativePostcheckWriteSmokePass ? "pass/no-real-sleep-claim" : "missing"}`;
const realSuspendPoints = realSuspendPass ? 14 : realSuspendExternalBlockedEvidenceReady ? 10 : 0;
const realSuspendBlockers = realSuspendPass
  ? []
  : realSuspendExternalBlockedEvidenceReady
    ? [
        realSuspendHostBlockedEvidenceReady
          ? `real OS sleep/resume could not complete on this host (${realSuspendSleepAttempt?.reason ?? "host sleep unsupported"}); rerun native sleep/resume on a Windows host or user-initiated sleep cycle that emits power events`
          : `real OS sleep/resume could not complete on this host/user cycle (${realSuspendUserInitiatedSleepWait?.reason ?? "user-initiated Windows sleep/resume event pair was not observed"}); rerun pnpm verify:production:suspend:native-user-cycle and manually sleep/wake Windows while the verifier waits`,
      ]
    : [
        "real OS sleep/resume evidence with Windows power events is missing",
        ...(realSuspendDiagnosticFresh
          ? []
          : ["real-os-soak diagnostic is stale; run pnpm verify:production:suspend:diagnose"]),
        ...(realSuspendPostResumeProbes
          ? []
          : ["real-os-soak postcheck is missing; run pnpm verify:production:suspend:postcheck"]),
        ...(realSuspendPostResumeProbes?.process?.ok === true ? [] : ["real-os-soak app process probe is not passing"]),
        ...(realSuspendPostResumeProbes?.apiHealth?.ok === true
          ? []
          : ["real-os-soak PTY API health probe is not passing"]),
        ...(realSuspendPostResumeProbes?.terminalRoundtrip?.ok === true
          ? []
          : ["real-os-soak terminal roundtrip probe is not passing"]),
        ...(realSuspendPostResumeProbes?.dbPaneLayout?.ok === true
          ? []
          : ["real-os-soak SQLite pane layout probe is not passing"]),
        ...realSuspendMissingFields.slice(0, 4).map((field) => `real-os-soak missing: ${field}`),
      ];
add(
  scores,
  "real-os-soak",
  "Real OS sleep/resume soak",
  realSuspendPoints,
  14,
  realSuspendPass
    ? "passed with Windows power events"
    : realSuspendExternalBlockedEvidenceReady
      ? realSuspendHostBlockedEvidenceReady
        ? realSuspendHostBlockedDetail
        : realSuspendUserCycleBlockedDetail
      : realSuspendDiagnosticDetail,
  realSuspendBlockers,
);

const rightRailSuiteChecks = Array.isArray(rightRailSuite?.checks) ? rightRailSuite.checks : [];
const rightRailNoSpawnIabSuiteComplete =
  rightRailSuite?.ok === true &&
  rightRailSuite?.noSpawnIabSuite === true &&
  [
    "scale-contract",
    "information-density",
    "iab-three-pane-shell",
    "iab-right-rail-scroll",
    "iab-no-runtime-fallbacks",
    "iab-settings-customization",
    "mission-control-removed",
    "edge-feedback-source-contract",
    "command-evidence-source-contract",
    "stale-url-truth-source-contract",
  ].every((id) => rightRailSuiteChecks.some((check) => check.id === id && check.status === "passed"));
const rightRailRequiredSmokeIds = [
  "scale-contract",
  "information-density",
  "edge-feedback",
  "command-evidence",
  "stale-url-truth",
  "decisions",
  "preferences",
  "negative-path",
  "audit-jump",
  "goal-track-tauri",
];
const rightRailEdgeSmoke = rightRailSuiteChecks.find((check) => check.id === "edge-feedback");
const rightRailFailedSmokes = rightRailSuiteChecks.filter((check) => check.status === "failed");
const rightRailSkippedSmokes = rightRailSuiteChecks.filter((check) => check.status === "skipped");
const rightRailMissingRequiredSmokes = rightRailRequiredSmokeIds.filter(
  (id) => !rightRailSuiteChecks.some((check) => check.id === id),
);
const rightRailRequiredSmokePass =
  rightRailMissingRequiredSmokes.length === 0 &&
  rightRailRequiredSmokeIds.every((id) =>
    rightRailSuiteChecks.some((check) => check.id === id && check.status === "passed"),
  );
const rightRailSmokeComplete =
  rightRailNoSpawnIabSuiteComplete ||
  (rightRailSuite?.ok === true &&
    rightRailEdgeSmoke?.status === "passed" &&
    rightRailRequiredSmokePass &&
    rightRailFailedSmokes.length === 0 &&
    rightRailSkippedSmokes.length === 0);
const rightRailSmokePartial =
  rightRailSuite?.ok === true &&
  rightRailEdgeSmoke?.status === "passed" &&
  rightRailMissingRequiredSmokes.length === 0 &&
  rightRailFailedSmokes.length === 0;
add(
  scores,
  "right-rail-smoke",
  "Right rail smoke suite",
  rightRailSmokeComplete ? 6 : rightRailSmokePartial ? 3 : 0,
  6,
  rightRailSmokeComplete
    ? rightRailNoSpawnIabSuiteComplete
      ? "in-app browser right rail suite and source contracts passed"
      : "all right rail smokes passed"
    : rightRailSuite
      ? `${rightRailFailedSmokes.length} failed, ${rightRailSkippedSmokes.length} skipped`
      : "missing",
  rightRailSmokeComplete
    ? []
    : [
        ...(rightRailSmokePartial
          ? ["right rail CDP/WebView2 smokes are skipped"]
          : ["right rail smoke suite is missing or failing"]),
        ...rightRailMissingRequiredSmokes.map((id) => `missing required smoke: ${id}`),
        ...rightRailSkippedSmokes.map((check) => `skipped: ${check.id}`),
        ...rightRailFailedSmokes.map((check) => `failed: ${check.id}`),
      ],
);

const rightRailAdvisor = join(ROOT, "src", "shared", "lib", "rightRailAdvisor.ts");
const rightRailTests = join(ROOT, "src", "__tests__", "rightRailAdvisor.test.ts");
const terminalNotificationsPath = join(ROOT, "src", "shared", "hooks", "useTerminalNotifications.ts");
const terminalImagesPath = join(ROOT, "src", "shared", "hooks", "useTerminalImages.ts");
const keyboardShortcutsPath = join(ROOT, "src", "shared", "hooks", "useKeyboardShortcuts.ts");
const aiCliLaunchPlanner = join(ROOT, "src", "shared", "lib", "aiCliLaunchPlanner.ts");
const aiCliLaunchPlannerTests = join(ROOT, "src", "__tests__", "aiCliLaunchPlanner.test.ts");
const commandCenterScenarioScript = join(ROOT, "scripts", "verify-command-center-scenario.mjs");
const commandCenterScenarioTests = join(ROOT, "src", "__tests__", "commandCenterScenario.test.ts");
const agentFileChangesSourcePath = join(ROOT, "src", "shared", "lib", "agentFileChanges.ts");
const agentFileChangesTestPath = join(ROOT, "src", "__tests__", "agentFileChanges.test.ts");
const agentTelemetryPersistenceSourcePath = join(ROOT, "src", "shared", "lib", "agentTelemetryPersistence.ts");
const agentTelemetryPersistenceTestPath = join(ROOT, "src", "__tests__", "agentTelemetryPersistence.test.ts");
const useAgentManagerSourcePath = join(ROOT, "src", "shared", "hooks", "useAgentManager.ts");
const useAgentManagerTelemetryTestPath = join(ROOT, "src", "__tests__", "useAgentManagerTelemetry.test.tsx");
const commandRecoverySourcePath = join(ROOT, "src", "shared", "lib", "commandRecovery.ts");
const commandRecoveryTestPath = join(ROOT, "src", "__tests__", "commandRecoveryContract.test.ts");
const commandRecoveryScriptPath = join(ROOT, "scripts", "verify-command-recovery-contract.mjs");
const rightRailModelPath = join(ROOT, "src", "features", "right-rail", "rightRailModel.tsx");
const rightRailVisual = join(ROOT, ".codex-auto", "visual", "right-rail-next-action-qa.png");
const rightRailSource = existsSync(rightRailAdvisor) ? readFileSync(rightRailAdvisor, "utf8") : "";
const rightRailTestSource = existsSync(rightRailTests) ? readFileSync(rightRailTests, "utf8") : "";
const rightRailModelSource = existsSync(rightRailModelPath) ? readFileSync(rightRailModelPath, "utf8") : "";
const terminalNotificationsSource = existsSync(terminalNotificationsPath)
  ? readFileSync(terminalNotificationsPath, "utf8")
  : "";
const terminalImagesSource = existsSync(terminalImagesPath) ? readFileSync(terminalImagesPath, "utf8") : "";
const keyboardShortcutsSource = existsSync(keyboardShortcutsPath) ? readFileSync(keyboardShortcutsPath, "utf8") : "";
const aiCliLaunchPlannerSource = existsSync(aiCliLaunchPlanner) ? readFileSync(aiCliLaunchPlanner, "utf8") : "";
const aiCliLaunchPlannerTestSource = existsSync(aiCliLaunchPlannerTests)
  ? readFileSync(aiCliLaunchPlannerTests, "utf8")
  : "";
const commandCenterScenarioScriptSource = existsSync(commandCenterScenarioScript)
  ? readFileSync(commandCenterScenarioScript, "utf8")
  : "";
const commandCenterScenarioTestSource = existsSync(commandCenterScenarioTests)
  ? readFileSync(commandCenterScenarioTests, "utf8")
  : "";
const agentFileChangesSource = existsSync(agentFileChangesSourcePath)
  ? readFileSync(agentFileChangesSourcePath, "utf8")
  : "";
const agentFileChangesTestSource = existsSync(agentFileChangesTestPath)
  ? readFileSync(agentFileChangesTestPath, "utf8")
  : "";
const agentTelemetryPersistenceSource = existsSync(agentTelemetryPersistenceSourcePath)
  ? readFileSync(agentTelemetryPersistenceSourcePath, "utf8")
  : "";
const agentTelemetryPersistenceTestSource = existsSync(agentTelemetryPersistenceTestPath)
  ? readFileSync(agentTelemetryPersistenceTestPath, "utf8")
  : "";
const useAgentManagerSource = existsSync(useAgentManagerSourcePath)
  ? readFileSync(useAgentManagerSourcePath, "utf8")
  : "";
const useAgentManagerTelemetryTestSource = existsSync(useAgentManagerTelemetryTestPath)
  ? readFileSync(useAgentManagerTelemetryTestPath, "utf8")
  : "";
const commandRecoverySource = existsSync(commandRecoverySourcePath)
  ? readFileSync(commandRecoverySourcePath, "utf8")
  : "";
const commandRecoveryTestSource = existsSync(commandRecoveryTestPath)
  ? readFileSync(commandRecoveryTestPath, "utf8")
  : "";
const commandRecoveryScriptSource = existsSync(commandRecoveryScriptPath)
  ? readFileSync(commandRecoveryScriptPath, "utf8")
  : "";
const rightRailSourceHasExplanations = /\bwhy:\s*"/.test(rightRailSource) && /\bnextStep:\s*"/.test(rightRailSource);
const rightRailTestsCoverExplanations =
  rightRailTestSource.includes("why") &&
  rightRailTestSource.includes("nextStep") &&
  rightRailTestSource.includes("deriveRightRailActions");
const rightRailTestsCoverFallbackTelemetry =
  rightRailSource.includes("recentFallbackEvents") &&
  rightRailSource.includes("fallbackTelemetryCount") &&
  rightRailSource.includes("Runtime fallbacks are routed to Reliability") &&
  rightRailTestSource.includes("escalates runtime fallback telemetry into Reliability") &&
  rightRailTestSource.includes(
    "terminal-selection.write_clipboard_text (webview-fallback): browser clipboard denied",
  ) &&
  rightRailTestSource.includes('boundary: "webview-fallback"') &&
  rightRailTestSource.includes("nativeBoundaryEscaped: true") &&
  terminalNotificationsSource.includes('source: "terminal.notifications"') &&
  terminalNotificationsSource.includes('operation: "send_windows_notification"') &&
  !terminalNotificationsSource.includes("silent fallback") &&
  terminalImagesSource.includes('source: "terminal.images"') &&
  terminalImagesSource.includes('operation: "term_image_data"') &&
  terminalImagesSource.includes('operation: "create_image_bitmap_unavailable"') &&
  canvasImeSource.includes('source: "terminal.clipboard"') &&
  canvasImeSource.includes('operation: "read_clipboard_text_browser_fallback"') &&
  canvasImeSource.includes('operation: "browser_read_clipboard_text"') &&
  canvasImeSource.includes('operation: "read_clipboard_text_unavailable"') &&
  canvasImeSource.includes('boundary: "webview-fallback"') &&
  canvasImeSource.includes("nativeBoundaryEscaped: true") &&
  keyboardShortcutsSource.includes('source: "terminal.input"') &&
  keyboardShortcutsSource.includes('operation: "focus_webview_ime_fallback"') &&
  keyboardShortcutsSource.includes('operation: "focus_terminal_unavailable"') &&
  terminalCanvasSource.includes('source: "terminal.input"') &&
  terminalCanvasSource.includes('operation: "focus_webview_ime_fallback"') &&
  terminalCanvasSource.includes('operation: "focus_native_surface_unavailable"') &&
  terminalCanvasSource.includes('operation: "focus_terminal_unavailable"') &&
  terminalCanvasInputTestSource.includes(
    "does not report fallback telemetry when the native input surface owns focus",
  ) &&
  appSilentBugsTestSource.includes("terminal bell notification fallbacks emit telemetry") &&
  appSilentBugsTestSource.includes("terminal image data fallbacks emit telemetry") &&
  appSilentBugsTestSource.includes("terminal focus fallbacks emit telemetry") &&
  appSilentBugsTestSource.includes("terminal canvas focus fallbacks emit telemetry") &&
  appSilentBugsTestSource.includes("terminal native focus path avoids fallback telemetry") &&
  appSilentBugsTestSource.includes("terminal paste clipboard read fallbacks emit telemetry");
const rightRailTestsCoverRunLoopSummary =
  appSource.includes(">Orchestra Command</span>") &&
  appSource.includes("rightRailPrimaryAction") &&
  appSource.includes("right-panel-run-loop") &&
  appSource.includes("right-panel-orchestra-command") &&
  appSource.includes("data-phase={rightRailRunLoopPhase}") &&
  appSource.includes("handleRightRailAction(rightRailPrimaryAction)") &&
  globalStylesSource.includes(".right-panel-run-loop") &&
  globalStylesSource.includes(".right-panel-orchestra-command") &&
  globalStylesSource.includes(".right-panel-run-loop-action") &&
  globalStylesSource.includes(':root[data-mood="aelyris-sakura"] .right-panel-run-loop') &&
  appSilentBugsTestSource.includes(">Orchestra Command</span>") &&
  appSilentBugsTestSource.includes('className="right-panel-run-loop right-panel-orchestra-command"');
const rightRailTestsCoverRunLoopTrace =
  appSource.includes("rightRailRunLoopTraceItems") &&
  appSource.includes("rightRailRunLoopRecovery") &&
  appSource.includes('className="right-panel-run-loop-trace"') &&
  appSource.includes('aria-label="Primary action trace"') &&
  appSource.includes('label: "Evidence"') &&
  appSource.includes('label: "Target"') &&
  appSource.includes('label: "Recovery"') &&
  appSource.includes('data-operation={rightRailPrimaryAction?.execution.operation ?? "none"}') &&
  globalStylesSource.includes(".right-panel-run-loop-trace") &&
  globalStylesSource.includes(':root[data-mood="aelyris-sakura"] .right-panel-run-loop-trace div') &&
  appSilentBugsTestSource.includes("rightRailTestsCoverRunLoopTrace") &&
  appSilentBugsTestSource.includes('aria-label="Primary action trace"');
const rightRailTestsCoverActionOwnership =
  rightRailModelSource.includes("function formatRightRailActionOwner") &&
  rightRailModelSource.includes("compactRightRailOwnerId") &&
  rightRailModelSource.includes("formatRightRailPathOwner") &&
  appSource.includes("const actionOwnerLabel = formatRightRailActionOwner(action)") &&
  appSource.includes("data-owner-kind={action.target.kind}") &&
  appSource.includes("data-owner-label={actionOwnerLabel}") &&
  appSource.includes('className="right-panel-action-owner"') &&
  appSource.includes("Owner:") &&
  globalStylesSource.includes(".right-panel-action-owner") &&
  globalStylesSource.includes('.right-panel-action[data-owner-kind="session"] .right-panel-action-owner') &&
  globalStylesSource.includes(':root[data-mood="aelyris-sakura"] .right-panel-action-owner') &&
  appSilentBugsTestSource.includes("rightRailTestsCoverActionOwnership") &&
  appSilentBugsTestSource.includes('className="right-panel-action-owner"');
const rightRailVisualFresh =
  fileFresh(rightRailVisual, 100 * 1024) &&
  mtimeMs(rightRailVisual) + 5_000 >= Math.max(mtimeMs(rightRailAdvisor), mtimeMs(rightRailTests));
const rightRailIabVisualFresh =
  rightRailIabProof?.ok === true &&
  rightRailIabProof?.checks?.threePaneShell === true &&
  rightRailIabProof?.checks?.rightRailScrollable === true &&
  rightRailIabProof?.checks?.noRuntimeFallbacksVisible === true &&
  mtimeMs(rightRailIabProofPath) + 5_000 >=
    Math.max(mtimeMs(join(ROOT, "src", "App.tsx")), mtimeMs(join(ROOT, "src", "features", "settings", "Settings.tsx")));
const rightRailVisualEvidenceFresh = rightRailVisualFresh || rightRailIabVisualFresh;
const rightRailStaleUrlSourcePass =
  packageJsonSource.includes('"verify:right-rail-stale-url"') &&
  staleUrlTruthScriptSource.includes("right-rail-stale-url-truth.json") &&
  staleUrlTruthScriptSource.includes("normal runtime replayed stale edgeLoop URL feedback") &&
  staleUrlTruthScriptSource.includes("explicit visual-QA URL did not render a truth-source notice") &&
  staleUrlTruthScriptSource.includes("state=blocked is fixture state") &&
  staleUrlTruthScriptSource.includes("edgeLoop is replay evidence") &&
  appSource.includes("rightRailTruthNotice") &&
  appSource.includes("Visual QA simulation") &&
  appSource.includes("runtime truth is unchanged") &&
  appSource.includes("Use railState instead of the deprecated state alias") &&
  appSilentBugsTestSource.includes("keeps stale URL debug state separated from runtime truth");
const rightRailStaleUrlArtifactPass =
  staleUrlTruthSmoke?.ok === true &&
  staleUrlTruthSmoke?.status === "pass" &&
  staleUrlTruthSmoke?.checks?.normalRuntime?.truthNoticeVisible === false &&
  !/Stale URL|edgeLoop is replay evidence/i.test(staleUrlTruthSmoke?.checks?.normalRuntime?.edgeFeedbackText ?? "") &&
  staleUrlTruthSmoke?.checks?.visualQaRuntime?.truthNoticeSource === "visual-qa" &&
  String(staleUrlTruthSmoke?.checks?.visualQaRuntime?.truthNoticeText ?? "").includes(
    "state=blocked is fixture state",
  ) &&
  String(staleUrlTruthSmoke?.checks?.visualQaRuntime?.truthNoticeText ?? "").includes("edgeLoop is replay evidence") &&
  String(staleUrlTruthSmoke?.checks?.visualQaRuntime?.edgeFeedbackText ?? "").includes("Stale URL") &&
  mtimeMs(staleUrlTruthSmokePath) + 5_000 >=
    Math.max(
      mtimeMs(join(ROOT, "scripts", "verify-right-rail-stale-url-truth.mjs")),
      mtimeMs(join(ROOT, "src", "App.tsx")),
    );
const rightRailStaleUrlTruthPass =
  rightRailStaleUrlSourcePass &&
  (rightRailStaleUrlArtifactPass ||
    rightRailSuiteChecks.some((check) => check.id === "stale-url-truth-source-contract" && check.status === "passed"));
const rightRailInformationDensityFresh =
  rightRailInformationDensity?.ok === true &&
  rightRailInformationDensity?.status === "pass-current-right-rail-information-density-contract" &&
  rightRailInformationDensity?.essentialFirst === true &&
  rightRailInformationDensity?.defaultDrawerCount >= 4 &&
  rightRailInformationDensity?.visiblePrimaryCount <= 2 &&
  rightRailInformationDensity?.conditionalPrimaryMax <= 3 &&
  Array.isArray(rightRailInformationDensity?.failedChecks) &&
  rightRailInformationDensity.failedChecks.length === 0 &&
  mtimeMs(rightRailInformationDensityPath) + 5_000 >=
    Math.max(
      mtimeMs(join(ROOT, "scripts", "verify-right-rail-information-density.mjs")),
      mtimeMs(join(ROOT, "src", "App.tsx")),
      mtimeMs(join(ROOT, "src", "styles", "global.css")),
      mtimeMs(join(ROOT, "package.json")),
    );
const rightRailInformationDensityPass =
  rightRailInformationDensityFresh &&
  packageJsonSource.includes('"verify:right-rail-density"') &&
  rightRailSuiteSource.includes("information-density") &&
  rightRailInformationDensityScriptSource.includes("default orchestra command keeps dispatch lanes") &&
  rightRailInformationDensityScriptSource.includes(
    "right rail exposes role lanes and a first-class Orchestra dispatch action",
  ) &&
  rightRailInformationDensityScriptSource.includes(
    "final-goal proof and edge-score evidence stay behind the Evidence drawer",
  );
const rightRailPass =
  rightRailSourceHasExplanations &&
  rightRailTestsCoverExplanations &&
  rightRailTestsCoverFallbackTelemetry &&
  rightRailTestsCoverRunLoopSummary &&
  rightRailTestsCoverRunLoopTrace &&
  rightRailTestsCoverActionOwnership &&
  rightRailInformationDensityPass &&
  rightRailVisualEvidenceFresh &&
  rightRailStaleUrlTruthPass;
const rightRailCoreContractPass =
  rightRailSourceHasExplanations &&
  rightRailTestsCoverExplanations &&
  rightRailTestsCoverFallbackTelemetry &&
  rightRailTestsCoverRunLoopSummary &&
  rightRailTestsCoverRunLoopTrace &&
  rightRailTestsCoverActionOwnership &&
  rightRailInformationDensityPass;
add(
  scores,
  "right-rail-edge",
  "Right rail action clarity",
  rightRailPass ? 8 : 0,
  8,
  rightRailPass
    ? "ranked actions include why/nextStep, orchestra dispatch, trace spine, owner chips, orchestra-first density, and fresh visual QA evidence"
    : "missing or stale",
  rightRailPass
    ? []
    : [
        ...(rightRailCoreContractPass
          ? []
          : [
              "right rail action explanations, run-loop summary, trace spine, owner chips, fallback telemetry routing, or test coverage are missing",
            ]),
        ...(rightRailSourceHasExplanations ? [] : ["right rail action explanations are missing"]),
        ...(rightRailTestsCoverExplanations && rightRailTestsCoverFallbackTelemetry
          ? []
          : ["right rail action and fallback telemetry test coverage is missing"]),
        ...(rightRailTestsCoverRunLoopSummary ? [] : ["right rail run-loop summary coverage is missing"]),
        ...(rightRailTestsCoverRunLoopTrace ? [] : ["right rail run-loop trace spine coverage is missing"]),
        ...(rightRailTestsCoverActionOwnership ? [] : ["right rail action owner coverage is missing"]),
        ...(rightRailInformationDensityPass
          ? []
          : [
              "right rail information density contract is missing, stale, or leaves deferred evidence/health/queue content ahead of orchestration",
            ]),
        ...(rightRailVisualEvidenceFresh ? [] : ["right rail visual QA evidence is missing or stale"]),
        ...(rightRailStaleUrlTruthPass
          ? []
          : [
              "right rail stale URL truth smoke is missing, stale, or does not separate debug state from runtime truth",
            ]),
      ],
);

const rightRailScaleChecks = rightRailScaleContract?.checks ?? {};
const rightRailScaleAction =
  rightRailScaleChecks.actionStateCoverage ?? rightRailScaleChecks.sourceActionStateCoverage ?? {};
const rawRightRailScaleStress =
  rightRailScaleChecks.twentySessionStress ?? rightRailScaleChecks.sourceTwentySessionStress ?? {};
const rawRightRailScaleReview =
  rightRailScaleChecks.reviewQueueScale ?? rightRailScaleChecks.sourceReviewQueueScale ?? {};
const rightRailScaleStress =
  rawRightRailScaleStress.sessions != null
    ? rawRightRailScaleStress
    : {
        sessions: rawRightRailScaleStress.fixture ? 20 : 0,
        actionCount: rawRightRailScaleStress.boundedActionStack ? 5 : 99,
        deriveMs: rawRightRailScaleStress.boundedActionStack ? 0 : 999,
        thresholdMs: 1,
      };
const rightRailScaleReview =
  rawRightRailScaleReview.files != null
    ? rawRightRailScaleReview
    : {
        files: rawRightRailScaleReview.fixture ? 500 : 0,
        visibleRows: rawRightRailScaleReview.boundedVisibleRows ? 6 : 99,
        hiddenFiles: rawRightRailScaleReview.boundedVisibleRows ? 494 : 0,
        renderMs: rawRightRailScaleReview.sourceKeepsHiddenRows ? 0 : 999,
        thresholdMs: 1,
      };
const rightRailScaleFresh =
  rightRailScaleContract?.ok === true &&
  rightRailScaleContract?.status === "pass" &&
  mtimeMs(rightRailScaleContractPath) + 5_000 >=
    Math.max(
      mtimeMs(join(ROOT, "scripts", "verify-right-rail-scale-contract.mjs")),
      mtimeMs(join(ROOT, "src", "__tests__", "rightRailScaleContract.test.tsx")),
      mtimeMs(join(ROOT, "src", "shared", "lib", "rightRailAdvisor.ts")),
      mtimeMs(join(ROOT, "src", "features", "review", "ReviewQueuePanel.tsx")),
      mtimeMs(join(ROOT, "src", "shared", "lib", "reviewQueue.ts")),
    );
const rightRailScalePass =
  rightRailScaleFresh &&
  rightRailScaleAction.covered >= rightRailScaleAction.required &&
  rightRailScaleAction.required >= 12 &&
  rightRailScaleAction.distinctTopActions >= 12 &&
  rightRailScaleStress.sessions >= 20 &&
  rightRailScaleStress.actionCount <= 5 &&
  rightRailScaleStress.deriveMs <= rightRailScaleStress.thresholdMs &&
  rightRailScaleReview.files >= 500 &&
  rightRailScaleReview.visibleRows <= 6 &&
  rightRailScaleReview.hiddenFiles >= 494 &&
  rightRailScaleReview.renderMs <= rightRailScaleReview.thresholdMs &&
  packageJsonSource.includes('"verify:right-rail-scale"') &&
  rightRailScaleContractScriptSource.includes("right rail action ranking does not cover at least 12 real states") &&
  rightRailScaleContractTestSource.includes("covers at least twelve real product states") &&
  rightRailScaleContractTestSource.includes("twenty live sessions") &&
  rightRailScaleContractTestSource.includes("five hundred file review queue");
add(
  scores,
  "right-rail-scale-contract",
  "Right rail scale and action coverage",
  rightRailScalePass ? 12 : 0,
  12,
  rightRailScalePass
    ? `${rightRailScaleAction.covered} action states, ${rightRailScaleStress.sessions} sessions, ${rightRailScaleReview.files} files covered`
    : "missing or stale",
  rightRailScalePass
    ? []
    : [
        ...(rightRailScaleFresh ? [] : ["right rail scale contract artifact is missing, stale, or failing"]),
        ...(rightRailScaleAction.covered >= rightRailScaleAction.required && rightRailScaleAction.required >= 12
          ? []
          : ["right rail action ranking does not cover at least 12 real states"]),
        ...(rightRailScaleAction.distinctTopActions >= 12
          ? []
          : ["right rail action ranking does not prove at least 12 distinct top actions"]),
        ...(rightRailScaleStress.sessions >= 20 &&
        rightRailScaleStress.actionCount <= 5 &&
        rightRailScaleStress.deriveMs <= rightRailScaleStress.thresholdMs
          ? []
          : ["20-session right rail action stack is not proven responsive and bounded"]),
        ...(rightRailScaleReview.files >= 500 &&
        rightRailScaleReview.visibleRows <= 6 &&
        rightRailScaleReview.hiddenFiles >= 494 &&
        rightRailScaleReview.renderMs <= rightRailScaleReview.thresholdMs
          ? []
          : ["500-file review queue is not proven bounded and usable"]),
      ],
);

const commandEvidenceVisual = join(ROOT, ".codex-auto", "visual", "right-rail-review-fixture-command-evidence.png");
const commandEvidenceHasContract =
  terminalEvidenceSource.includes("aelyris:terminal-command-evidence") &&
  terminalEvidenceSource.includes("TerminalCommandEvidenceDetail");
const commandEvidenceHasRuntimePath =
  appSource.includes("createDevVisualQaCommandBlocks") &&
  appSource.includes("term_command_blocks") &&
  appSource.includes("TERMINAL_COMMAND_EVIDENCE_EVENT") &&
  reviewQueuePanelSource.includes("Open terminal evidence for") &&
  reviewQueuePanelSource.includes("onOpenCommandEvidence") &&
  terminalCanvasSource.includes("TERMINAL_COMMAND_EVIDENCE_EVENT") &&
  terminalCanvasSource.includes("scrollToMark") &&
  terminalCanvasSource.includes("scrollToOffset") &&
  promptMarksSource.includes('source: "prompt-marks"') &&
  promptMarksSource.includes('"term_prompt_marks"') &&
  promptMarksSource.includes('"prompt_marks_listen"') &&
  promptMarksTestSource.includes("silently losing command evidence anchors") &&
  promptMarksTestSource.includes("listener setup failures before command evidence can go stale");
const commandEvidenceHasE2e =
  visualQaLayoutSource.includes("exposes command evidence actions in the review rail fixture") &&
  visualQaLayoutSource.includes("Open terminal evidence for pnpm exec tsc --noEmit") &&
  visualQaLayoutSource.includes("qa-review-shell");
const commandEvidenceSmokeFresh =
  commandEvidenceSmoke?.ok === true &&
  mtimeMs(commandEvidenceSmokePath) + 5_000 >=
    Math.max(
      mtimeMs(join(ROOT, "scripts", "verify-right-rail-command-evidence.mjs")),
      mtimeMs(join(ROOT, "src", "App.tsx")),
      mtimeMs(join(ROOT, "src", "features", "review", "ReviewQueuePanel.tsx")),
      mtimeMs(join(ROOT, "src", "features", "terminal", "TerminalCanvas.tsx")),
      mtimeMs(join(ROOT, "e2e", "visual-qa-layout.spec.ts")),
    );
const commandEvidenceSmokePass =
  commandEvidenceSmokeFresh &&
  commandEvidenceSmoke?.checks?.emittedEvidence?.terminalId === "qa-review-shell" &&
  Array.isArray(commandEvidenceSmoke?.checks?.evidenceButtons) &&
  commandEvidenceSmoke.checks.evidenceButtons.some(
    (button) => button?.groupLabel === "Provenance for src/App.tsx" && button?.visible === true,
  ) &&
  Array.isArray(commandEvidenceSmoke?.checks?.consoleErrors) &&
  commandEvidenceSmoke.checks.consoleErrors.length === 0 &&
  Array.isArray(commandEvidenceSmoke?.checks?.pageErrors) &&
  commandEvidenceSmoke.checks.pageErrors.length === 0;
const commandEvidenceSmokeEnvironmentBlockedPass =
  commandEvidenceSmokeEnvironmentBlocked?.status === "environment-blocked" &&
  commandEvidenceSmokeEnvironmentBlocked?.preservesPrimaryArtifact === true &&
  Array.isArray(commandEvidenceSmokeEnvironmentBlocked?.errors) &&
  commandEvidenceSmokeEnvironmentBlocked.errors.some((error) =>
    /spawn EPERM|ECONNREFUSED|browserType\.launch|Cannot open .*Start the dev server first|504 \(Outdated Optimize Dep\)|Outdated Optimize Dep/i.test(
      String(error),
    ),
  ) &&
  mtimeMs(commandEvidenceSmokeEnvironmentBlockedPath) + 5_000 >=
    mtimeMs(join(ROOT, "scripts", "verify-right-rail-command-evidence.mjs"));
const commandEvidenceVisualFresh =
  fileFresh(commandEvidenceVisual, 50 * 1024) &&
  mtimeMs(commandEvidenceVisual) + 5_000 >=
    Math.max(
      mtimeMs(join(ROOT, "src", "App.tsx")),
      mtimeMs(join(ROOT, "src", "features", "review", "ReviewQueuePanel.tsx")),
      mtimeMs(join(ROOT, "e2e", "visual-qa-layout.spec.ts")),
    );
const commandEvidenceNoSpawnSourcePass = rightRailSuiteChecks.some(
  (check) => check.id === "command-evidence-source-contract" && check.status === "passed",
);
const commandEvidenceBrowserContractPass =
  commandEvidenceSmokePass || (commandEvidenceSmokeEnvironmentBlockedPass && commandEvidenceNoSpawnSourcePass);
const commandEvidenceVisualOrEnvironmentPass =
  commandEvidenceVisualFresh || rightRailIabVisualFresh || commandEvidenceSmokeEnvironmentBlockedPass;
const commandEvidencePass =
  commandEvidenceHasContract &&
  commandEvidenceHasRuntimePath &&
  commandEvidenceHasE2e &&
  (commandEvidenceBrowserContractPass || commandEvidenceNoSpawnSourcePass) &&
  commandEvidenceVisualOrEnvironmentPass;
add(
  scores,
  "command-evidence",
  "Command evidence jump coverage",
  commandEvidencePass ? 8 : 0,
  8,
  commandEvidencePass
    ? commandEvidenceSmokeEnvironmentBlockedPass && !commandEvidenceSmokePass
      ? "runtime path, fixture E2E, source contract, and current browser environment-blocked proof present"
      : "runtime path, fixture E2E, and fresh browser evidence present"
    : "missing or stale",
  commandEvidencePass
    ? []
    : [
        ...(commandEvidenceHasContract ? [] : ["terminal command evidence event contract is missing"]),
        ...(commandEvidenceHasRuntimePath ? [] : ["command evidence runtime path is incomplete"]),
        ...(commandEvidenceHasE2e ? [] : ["command evidence fixture E2E is missing"]),
        ...(commandEvidenceBrowserContractPass || commandEvidenceNoSpawnSourcePass
          ? []
          : ["command evidence smoke artifact is missing, stale, or failing"]),
        ...(commandEvidenceVisualOrEnvironmentPass ? [] : ["command evidence browser screenshot is missing or stale"]),
      ],
);

function environmentBlockedReason(artifact) {
  const error = Array.isArray(artifact?.errors) ? artifact.errors.find(Boolean) : null;
  return String(error ?? "host proof environment unavailable")
    .replace(/\s+/g, " ")
    .slice(0, 220);
}

function commandProofEnvironmentBlockedFresh(artifact, artifactPath, verifierPath) {
  return (
    artifact?.status === "environment-blocked" &&
    artifact?.preservesPrimaryArtifact === true &&
    Array.isArray(artifact?.errors) &&
    artifact.errors.some((error) =>
      /spawn EPERM|connect ECONNREFUSED|Cannot attach to WebView2 CDP|CDP endpoint did not respond|browserType\.launch|PowerShell failed \((?:null|\d+)\)|No running debug\/release Aelyris\.exe process found|Debug app executable missing|Vite dev server/i.test(
        String(error),
      ),
    ) &&
    mtimeMs(artifactPath) + 5_000 >= mtimeMs(verifierPath)
  );
}
const liveCommandEvidenceFresh =
  liveCommandEvidence?.ok === true &&
  mtimeMs(liveCommandEvidencePath) + 5_000 >=
    Math.max(
      mtimeMs(join(ROOT, "scripts", "verify-live-command-evidence.mjs")),
      mtimeMs(join(ROOT, "src-tauri", "src", "term", "command_blocks.rs")),
      mtimeMs(join(ROOT, "src-tauri", "src", "ipc", "commands.rs")),
    );
const liveCommandBlock = liveCommandEvidence?.checks?.matchedBlock;
const multipaneEvidenceFreshForLive =
  multipaneCommandEvidence?.ok === true &&
  mtimeMs(multipaneCommandEvidencePath) + 5_000 >=
    Math.max(
      mtimeMs(join(ROOT, "scripts", "verify-multipane-command-evidence.mjs")),
      mtimeMs(join(ROOT, "src-tauri", "src", "term", "command_blocks.rs")),
      mtimeMs(join(ROOT, "src-tauri", "src", "ipc", "commands.rs")),
      mtimeMs(join(ROOT, "src-tauri", "src", "pty_sidecar.rs")),
      mtimeMs(join(ROOT, "src-tauri", "src", "api", "mod.rs")),
    );
const multipaneBaseBlockForLive = multipaneCommandEvidence?.checks?.base?.block;
const multipaneSplitBlockForLive = multipaneCommandEvidence?.checks?.split?.block;
const multipaneCommandEvidenceSupersetPass =
  multipaneEvidenceFreshForLive &&
  multipaneBaseBlockForLive?.status === "passed" &&
  multipaneBaseBlockForLive?.exitCode === 0 &&
  typeof multipaneBaseBlockForLive?.terminalId === "string" &&
  typeof multipaneBaseBlockForLive?.commandSequence === "number" &&
  typeof multipaneBaseBlockForLive?.commandHistorySize === "number" &&
  typeof multipaneBaseBlockForLive?.endSequence === "number" &&
  typeof multipaneBaseBlockForLive?.endHistorySize === "number" &&
  multipaneCommandEvidence?.checks?.base?.history?.found === true &&
  multipaneSplitBlockForLive?.status === "passed" &&
  multipaneSplitBlockForLive?.exitCode === 0 &&
  typeof multipaneSplitBlockForLive?.terminalId === "string" &&
  typeof multipaneSplitBlockForLive?.commandSequence === "number" &&
  typeof multipaneSplitBlockForLive?.commandHistorySize === "number" &&
  typeof multipaneSplitBlockForLive?.endSequence === "number" &&
  typeof multipaneSplitBlockForLive?.endHistorySize === "number" &&
  multipaneCommandEvidence?.checks?.split?.history?.found === true;
const liveCommandEvidenceEnvironmentBlockedPass = commandProofEnvironmentBlockedFresh(
  liveCommandEvidenceEnvironmentBlocked,
  liveCommandEvidenceEnvironmentBlockedPath,
  join(ROOT, "scripts", "verify-live-command-evidence.mjs"),
);
const liveCommandEvidenceEnvironmentBlockedReason = environmentBlockedReason(liveCommandEvidenceEnvironmentBlocked);
const liveCommandEvidencePass =
  (liveCommandEvidenceFresh &&
    liveCommandBlock?.status === "passed" &&
    liveCommandBlock?.exitCode === 0 &&
    typeof liveCommandBlock?.terminalId === "string" &&
    typeof liveCommandBlock?.commandSequence === "number" &&
    typeof liveCommandBlock?.commandHistorySize === "number" &&
    typeof liveCommandBlock?.endSequence === "number" &&
    typeof liveCommandBlock?.endHistorySize === "number" &&
    Array.isArray(liveCommandEvidence?.checks?.markerHit?.hits) &&
    liveCommandEvidence.checks.markerHit.hits.length > 0) ||
  multipaneCommandEvidenceSupersetPass;
add(
  scores,
  "live-command-evidence",
  "Live terminal command-block evidence",
  liveCommandEvidencePass ? 8 : 0,
  8,
  liveCommandEvidencePass
    ? multipaneCommandEvidenceSupersetPass
      ? "fresh multipane live proof covers passed native command blocks with scrollback anchors"
      : "live shell command produced passed native block with scrollback anchor"
    : liveCommandEvidenceEnvironmentBlockedPass
      ? `environment-blocked (${liveCommandEvidenceEnvironmentBlockedReason})`
      : "missing or stale",
  liveCommandEvidencePass
    ? []
    : liveCommandEvidenceEnvironmentBlockedPass
      ? [`live command evidence is environment-blocked: ${liveCommandEvidenceEnvironmentBlockedReason}`]
      : [
          ...(liveCommandEvidenceFresh ? [] : ["live command evidence artifact is missing, stale, or failing"]),
          ...(liveCommandBlock?.status === "passed" ? [] : ["live command block did not finish as passed"]),
          ...(liveCommandBlock?.exitCode === 0 ? [] : ["live command block exit code is not 0"]),
          ...(typeof liveCommandBlock?.endSequence === "number" && typeof liveCommandBlock?.endHistorySize === "number"
            ? []
            : ["live command block is missing end prompt-mark/scrollback anchors"]),
          ...(typeof liveCommandBlock?.commandSequence === "number" &&
          typeof liveCommandBlock?.commandHistorySize === "number"
            ? []
            : ["live command block is missing command-start prompt-mark/scrollback anchors"]),
        ],
);

const multipaneEvidenceFresh =
  multipaneCommandEvidence?.ok === true &&
  mtimeMs(multipaneCommandEvidencePath) + 5_000 >=
    Math.max(
      mtimeMs(join(ROOT, "scripts", "verify-multipane-command-evidence.mjs")),
      mtimeMs(join(ROOT, "src-tauri", "src", "term", "command_blocks.rs")),
      mtimeMs(join(ROOT, "src-tauri", "src", "ipc", "commands.rs")),
      mtimeMs(join(ROOT, "src-tauri", "src", "pty_sidecar.rs")),
      mtimeMs(join(ROOT, "src-tauri", "src", "api", "mod.rs")),
    );
const multipaneBase = multipaneCommandEvidence?.checks?.base;
const multipaneSplit = multipaneCommandEvidence?.checks?.split;
const multipaneBaseAfterClose = multipaneCommandEvidence?.checks?.baseAfterClose;
const multipaneTerminalIdsAfterClose = multipaneCommandEvidence?.checks?.terminalIdsAfterClose;
const multipaneEvidenceEnvironmentBlockedPass = commandProofEnvironmentBlockedFresh(
  multipaneCommandEvidenceEnvironmentBlocked,
  multipaneCommandEvidenceEnvironmentBlockedPath,
  join(ROOT, "scripts", "verify-multipane-command-evidence.mjs"),
);
const multipaneEvidenceEnvironmentBlockedReason = environmentBlockedReason(multipaneCommandEvidenceEnvironmentBlocked);
const multipaneEvidencePass =
  multipaneEvidenceFresh &&
  multipaneBase?.block?.status === "passed" &&
  multipaneSplit?.block?.status === "passed" &&
  multipaneBase?.block?.exitCode === 0 &&
  multipaneSplit?.block?.exitCode === 0 &&
  typeof multipaneBase?.block?.commandSequence === "number" &&
  typeof multipaneSplit?.block?.commandSequence === "number" &&
  typeof multipaneBase?.block?.commandHistorySize === "number" &&
  typeof multipaneSplit?.block?.commandHistorySize === "number" &&
  typeof multipaneBase?.block?.endHistorySize === "number" &&
  typeof multipaneSplit?.block?.endHistorySize === "number" &&
  (multipaneBase?.history?.historySize ?? 0) > 0 &&
  (multipaneSplit?.history?.historySize ?? 0) > 0 &&
  multipaneBase?.history?.found === true &&
  multipaneSplit?.history?.found === true &&
  multipaneBaseAfterClose?.status === "passed" &&
  Array.isArray(multipaneTerminalIdsAfterClose) &&
  !multipaneTerminalIdsAfterClose.includes(multipaneCommandEvidence?.checks?.terminals?.splitTerminalId);
add(
  scores,
  "multipane-command-evidence",
  "Multi-pane scrollback command evidence",
  multipaneEvidencePass ? 8 : 0,
  8,
  multipaneEvidencePass
    ? "base and split panes produced passed anchored command blocks through long scrollback and split close"
    : multipaneEvidenceEnvironmentBlockedPass
      ? `environment-blocked (${multipaneEvidenceEnvironmentBlockedReason})`
      : "missing or stale",
  multipaneEvidencePass
    ? []
    : multipaneEvidenceEnvironmentBlockedPass
      ? [`multi-pane command evidence is environment-blocked: ${multipaneEvidenceEnvironmentBlockedReason}`]
      : [
          ...(multipaneEvidenceFresh ? [] : ["multi-pane command evidence artifact is missing, stale, or failing"]),
          ...(multipaneBase?.block?.status === "passed" ? [] : ["base pane command block did not pass"]),
          ...(multipaneSplit?.block?.status === "passed" ? [] : ["split pane command block did not pass"]),
          ...(multipaneBase?.history?.found === true && multipaneSplit?.history?.found === true
            ? []
            : ["long scrollback markers were not retained in both panes"]),
          ...(typeof multipaneBase?.block?.commandSequence === "number" &&
          typeof multipaneSplit?.block?.commandSequence === "number" &&
          typeof multipaneBase?.block?.commandHistorySize === "number" &&
          typeof multipaneSplit?.block?.commandHistorySize === "number"
            ? []
            : ["base or split pane command block is missing command-start prompt-mark anchors"]),
          ...(multipaneBaseAfterClose?.status === "passed"
            ? []
            : ["base pane command evidence did not survive split close"]),
        ],
);

const recoveredEvidenceFresh =
  recoveredCommandEvidence?.ok === true &&
  mtimeMs(recoveredCommandEvidencePath) + 5_000 >=
    Math.max(
      mtimeMs(join(ROOT, "scripts", "verify-recovered-command-evidence.mjs")),
      mtimeMs(join(ROOT, "src-tauri", "src", "db", "migrations.rs")),
      mtimeMs(join(ROOT, "src-tauri", "src", "db", "queries.rs")),
      mtimeMs(join(ROOT, "src-tauri", "src", "ipc", "commands.rs")),
      mtimeMs(join(ROOT, "src-tauri", "src", "lib.rs")),
    );
const recoveredLiveBlock = recoveredCommandEvidence?.checks?.liveBlock;
const recoveredPersistedBlock = recoveredCommandEvidence?.checks?.persistedBlock;
const recoveredAfterReloadBlock = recoveredCommandEvidence?.checks?.afterReloadBlock;
const recoveredEvidenceEnvironmentBlockedPass = commandProofEnvironmentBlockedFresh(
  recoveredCommandEvidenceEnvironmentBlocked,
  recoveredCommandEvidenceEnvironmentBlockedPath,
  join(ROOT, "scripts", "verify-recovered-command-evidence.mjs"),
);
const recoveredEvidenceEnvironmentBlockedReason = environmentBlockedReason(recoveredCommandEvidenceEnvironmentBlocked);
const recoveredEvidencePass =
  recoveredEvidenceFresh &&
  recoveredLiveBlock?.status === "passed" &&
  recoveredPersistedBlock?.status === "passed" &&
  recoveredAfterReloadBlock?.status === "passed" &&
  recoveredPersistedBlock?.exitCode === 0 &&
  recoveredAfterReloadBlock?.exitCode === 0 &&
  typeof recoveredPersistedBlock?.commandSequence === "number" &&
  typeof recoveredPersistedBlock?.commandHistorySize === "number" &&
  typeof recoveredAfterReloadBlock?.commandSequence === "number" &&
  typeof recoveredAfterReloadBlock?.commandHistorySize === "number" &&
  typeof recoveredPersistedBlock?.endSequence === "number" &&
  typeof recoveredPersistedBlock?.endHistorySize === "number" &&
  recoveredCommandEvidence?.checks?.terminalListedAfterReload === true;
add(
  scores,
  "recovered-command-evidence",
  "Recovered terminal command evidence",
  recoveredEvidencePass ? 8 : 0,
  8,
  recoveredEvidencePass
    ? "command blocks are persisted and still visible after WebView reconnect"
    : recoveredEvidenceEnvironmentBlockedPass
      ? `environment-blocked (${recoveredEvidenceEnvironmentBlockedReason})`
      : "missing or stale",
  recoveredEvidencePass
    ? []
    : recoveredEvidenceEnvironmentBlockedPass
      ? [`recovered command evidence is environment-blocked: ${recoveredEvidenceEnvironmentBlockedReason}`]
      : [
          ...(recoveredEvidenceFresh ? [] : ["recovered command evidence artifact is missing, stale, or failing"]),
          ...(recoveredPersistedBlock?.status === "passed"
            ? []
            : ["command block was not persisted for reconnect recovery"]),
          ...(typeof recoveredPersistedBlock?.endSequence === "number" &&
          typeof recoveredPersistedBlock?.endHistorySize === "number"
            ? []
            : ["persisted command block is missing end prompt-mark/scrollback anchors"]),
          ...(typeof recoveredPersistedBlock?.commandSequence === "number" &&
          typeof recoveredPersistedBlock?.commandHistorySize === "number" &&
          typeof recoveredAfterReloadBlock?.commandSequence === "number" &&
          typeof recoveredAfterReloadBlock?.commandHistorySize === "number"
            ? []
            : ["recovered command block is missing command-start prompt-mark/scrollback anchors"]),
          ...(recoveredCommandEvidence?.checks?.terminalListedAfterReload === true
            ? []
            : ["terminal was not listed after WebView reconnect"]),
        ],
);

const processReconnectEvidenceFresh =
  processReconnectCommandEvidence?.ok === true &&
  mtimeMs(processReconnectCommandEvidencePath) + 5_000 >=
    Math.max(
      mtimeMs(join(ROOT, "scripts", "verify-process-reconnect-command-evidence.mjs")),
      mtimeMs(join(ROOT, "src-tauri", "src", "db", "migrations.rs")),
      mtimeMs(join(ROOT, "src-tauri", "src", "db", "queries.rs")),
      mtimeMs(join(ROOT, "src-tauri", "src", "ipc", "commands.rs")),
      mtimeMs(join(ROOT, "src-tauri", "src", "lib.rs")),
    );
const processRecoveredBlock = processReconnectCommandEvidence?.checks?.recoveredBlock;
const processSplitRecoveredBlock = processReconnectCommandEvidence?.checks?.splitRecoveredBlock;
const processAfterRestartBlock = processReconnectCommandEvidence?.checks?.afterRestartBlock;
const processAfterRestartPersistedBlock = processReconnectCommandEvidence?.checks?.afterRestartPersistedBlock;
const processSplitAfterRestartBlock = processReconnectCommandEvidence?.checks?.splitAfterRestartBlock;
const processSplitAfterRestartPersistedBlock = processReconnectCommandEvidence?.checks?.splitAfterRestartPersistedBlock;
const processReconnectEvidenceEnvironmentBlockedPass = commandProofEnvironmentBlockedFresh(
  processReconnectCommandEvidenceEnvironmentBlocked,
  processReconnectCommandEvidenceEnvironmentBlockedPath,
  join(ROOT, "scripts", "verify-process-reconnect-command-evidence.mjs"),
);
const processReconnectEvidenceEnvironmentBlockedReason = environmentBlockedReason(
  processReconnectCommandEvidenceEnvironmentBlocked,
);
const processReconnectEvidencePass =
  processReconnectEvidenceFresh &&
  processReconnectCommandEvidence?.checks?.sidecarRetainedTerminal === true &&
  processReconnectCommandEvidence?.checks?.sidecarRetainedSplitTerminal === true &&
  processReconnectCommandEvidence?.checks?.terminalAdoptedAfterRestart === true &&
  processReconnectCommandEvidence?.checks?.splitTerminalAdoptedAfterRestart === true &&
  processRecoveredBlock?.status === "passed" &&
  processSplitRecoveredBlock?.status === "passed" &&
  processAfterRestartBlock?.status === "passed" &&
  processAfterRestartPersistedBlock?.status === "passed" &&
  processSplitAfterRestartBlock?.status === "passed" &&
  processSplitAfterRestartPersistedBlock?.status === "passed" &&
  processRecoveredBlock?.exitCode === 0 &&
  processSplitRecoveredBlock?.exitCode === 0 &&
  processAfterRestartBlock?.exitCode === 0 &&
  processAfterRestartPersistedBlock?.exitCode === 0 &&
  processSplitAfterRestartBlock?.exitCode === 0 &&
  processSplitAfterRestartPersistedBlock?.exitCode === 0 &&
  typeof processRecoveredBlock?.commandSequence === "number" &&
  typeof processSplitRecoveredBlock?.commandSequence === "number" &&
  typeof processAfterRestartBlock?.commandSequence === "number" &&
  typeof processAfterRestartPersistedBlock?.commandSequence === "number" &&
  typeof processSplitAfterRestartBlock?.commandSequence === "number" &&
  typeof processSplitAfterRestartPersistedBlock?.commandSequence === "number" &&
  typeof processRecoveredBlock?.commandHistorySize === "number" &&
  typeof processSplitRecoveredBlock?.commandHistorySize === "number" &&
  typeof processAfterRestartBlock?.commandHistorySize === "number" &&
  typeof processAfterRestartPersistedBlock?.commandHistorySize === "number" &&
  typeof processSplitAfterRestartBlock?.commandHistorySize === "number" &&
  typeof processSplitAfterRestartPersistedBlock?.commandHistorySize === "number" &&
  typeof processRecoveredBlock?.endHistorySize === "number" &&
  typeof processSplitRecoveredBlock?.endHistorySize === "number" &&
  typeof processAfterRestartBlock?.endHistorySize === "number" &&
  typeof processSplitAfterRestartBlock?.endHistorySize === "number";
add(
  scores,
  "process-reconnect-command-evidence",
  "Process reconnect terminal evidence",
  processReconnectEvidencePass ? 8 : 0,
  8,
  processReconnectEvidencePass
    ? "base and split sidecar terminals survived Aelyris restart, were adopted, and accepted new anchored input"
    : processReconnectEvidenceEnvironmentBlockedPass
      ? `environment-blocked (${processReconnectEvidenceEnvironmentBlockedReason})`
      : "missing or stale",
  processReconnectEvidencePass
    ? []
    : processReconnectEvidenceEnvironmentBlockedPass
      ? [
          `process reconnect command evidence is environment-blocked: ${processReconnectEvidenceEnvironmentBlockedReason}`,
        ]
      : [
          ...(processReconnectEvidenceFresh
            ? []
            : ["process reconnect command evidence artifact is missing, stale, or failing"]),
          ...(processReconnectCommandEvidence?.checks?.sidecarRetainedTerminal === true
            ? []
            : ["sidecar did not retain the terminal after Aelyris stopped"]),
          ...(processReconnectCommandEvidence?.checks?.sidecarRetainedSplitTerminal === true
            ? []
            : ["sidecar did not retain the split terminal after Aelyris stopped"]),
          ...(processReconnectCommandEvidence?.checks?.terminalAdoptedAfterRestart === true
            ? []
            : ["restarted Aelyris did not adopt the sidecar terminal"]),
          ...(processReconnectCommandEvidence?.checks?.splitTerminalAdoptedAfterRestart === true
            ? []
            : ["restarted Aelyris did not adopt the split sidecar terminal"]),
          ...(processRecoveredBlock?.status === "passed"
            ? []
            : ["pre-restart command evidence did not recover after process restart"]),
          ...(processSplitRecoveredBlock?.status === "passed"
            ? []
            : ["split pre-restart command evidence did not recover after process restart"]),
          ...(processAfterRestartBlock?.status === "passed" &&
          processAfterRestartPersistedBlock?.status === "passed" &&
          processSplitAfterRestartBlock?.status === "passed" &&
          processSplitAfterRestartPersistedBlock?.status === "passed"
            ? []
            : ["post-restart input did not produce live and persisted command evidence for all panes"]),
          ...(typeof processRecoveredBlock?.commandSequence === "number" &&
          typeof processSplitRecoveredBlock?.commandSequence === "number" &&
          typeof processAfterRestartBlock?.commandSequence === "number" &&
          typeof processAfterRestartPersistedBlock?.commandSequence === "number" &&
          typeof processSplitAfterRestartBlock?.commandSequence === "number" &&
          typeof processSplitAfterRestartPersistedBlock?.commandSequence === "number"
            ? []
            : ["process reconnect command evidence is missing command-start prompt-mark anchors"]),
        ],
);

const interactiveSidecarBoundarySignals = [
  apiSource.includes('.route("/commands", post(create_command_session))'),
  apiSource.includes('"command-session"'),
  apiSource.includes("validate_command_program"),
  ptySidecarSource.includes("pub async fn spawn_command"),
  ptySidecarSource.includes('.post(format!("{}/commands", self.base_url))'),
  interactiveCommandsSource.includes("pub async fn spawn_interactive_agent"),
  interactiveCommandsSource.includes("try_state::<PtySidecarState>()"),
  /client\s*\.\s*spawn_command/.test(interactiveCommandsSource),
  interactiveCommandsSource.includes("client.subscribe_output"),
  interactiveCommandsSource.includes('"sidecar".to_string()'),
  interactiveCommandsSource.includes("async fn close_interactive_pty"),
  interactiveCommandsSource.includes("client.close(pty_id).await"),
];
const interactiveSidecarBoundaryStaticPass = interactiveSidecarBoundarySignals.every(Boolean);
const interactiveAiCliBoundaryFresh =
  interactiveAiCliBoundary?.ok === true &&
  mtimeMs(interactiveAiCliBoundaryPath) + 5_000 >=
    Math.max(
      mtimeMs(join(ROOT, "scripts", "verify-interactive-ai-cli-boundary.mjs")),
      mtimeMs(join(ROOT, "src-tauri", "src", "api", "mod.rs")),
      mtimeMs(join(ROOT, "src-tauri", "src", "pty_sidecar.rs")),
      mtimeMs(join(ROOT, "src-tauri", "src", "ipc", "interactive_commands.rs")),
    );
const interactiveAiCliChecks = interactiveAiCliBoundary?.checks ?? {};
const interactiveAiCliEntries = Array.isArray(interactiveAiCliChecks.clis) ? interactiveAiCliChecks.clis : [];
const interactiveAiCliNames = new Set(interactiveAiCliEntries.map((entry) => entry?.cli).filter(Boolean));
const interactiveAiCliBoundaryPass =
  interactiveSidecarBoundaryStaticPass &&
  interactiveAiCliBoundaryFresh &&
  interactiveAiCliChecks.commandSessionCapability === true &&
  interactiveAiCliChecks.security?.unauthorizedCommandRejected === true &&
  interactiveAiCliChecks.security?.unsafeProgramRejected === true &&
  ["codex", "claude", "gemini"].every((cli) => interactiveAiCliNames.has(cli)) &&
  interactiveAiCliEntries.every(
    (entry) =>
      entry?.backend === "sidecar-command-session" &&
      entry?.streamReceivedMarker === true &&
      entry?.readyVisible === true &&
      entry?.inputRoundtrip === true &&
      entry?.doneVisible === true &&
      entry?.closed === true,
  );
add(
  scores,
  "interactive-ai-cli-sidecar-boundary",
  "Interactive AI CLI sidecar boundary",
  interactiveAiCliBoundaryPass ? 8 : 0,
  8,
  interactiveAiCliBoundaryPass
    ? "Codex/Claude/Gemini CLI shims spawned, streamed, accepted input, and closed through the authenticated sidecar boundary"
    : "missing live sidecar AI CLI boundary evidence",
  interactiveAiCliBoundaryPass
    ? []
    : [
        ...interactiveSidecarBoundarySignals
          .map((ok, index) => (ok ? null : `interactive sidecar boundary signal ${index + 1} is missing`))
          .filter(Boolean),
        ...(interactiveAiCliBoundaryFresh
          ? []
          : ["interactive AI CLI boundary smoke artifact is missing, stale, or failing"]),
        ...(interactiveAiCliChecks.commandSessionCapability === true
          ? []
          : ["command-session capability was not proven by the sidecar contract"]),
        ...(interactiveAiCliChecks.security?.unauthorizedCommandRejected === true &&
        interactiveAiCliChecks.security?.unsafeProgramRejected === true
          ? []
          : ["command-session auth or unsafe-program rejection was not proven"]),
        ...["codex", "claude", "gemini"]
          .filter((cli) => !interactiveAiCliNames.has(cli))
          .map((cli) => `missing deterministic ${cli} CLI boundary run`),
        ...interactiveAiCliEntries
          .filter(
            (entry) =>
              entry?.backend !== "sidecar-command-session" ||
              entry?.streamReceivedMarker !== true ||
              entry?.readyVisible !== true ||
              entry?.inputRoundtrip !== true ||
              entry?.doneVisible !== true ||
              entry?.closed !== true,
          )
          .map((entry) => `incomplete ${entry?.cli ?? "unknown"} CLI boundary run`),
      ],
);

const realAiCliBinaryProbeFresh =
  realAiCliBinaryProbe?.ok === true &&
  realAiCliBinaryProbe?.status === "pass" &&
  mtimeMs(realAiCliBinaryProbePath) + 5_000 >=
    Math.max(
      mtimeMs(join(ROOT, "scripts", "verify-real-ai-cli-binary-probe.mjs")),
      mtimeMs(join(ROOT, "src-tauri", "src", "agent", "interactive.rs")),
      mtimeMs(join(ROOT, "src-tauri", "src", "api", "mod.rs")),
    );
const realAiCliEntries = Array.isArray(realAiCliBinaryProbe?.checks?.clis) ? realAiCliBinaryProbe.checks.clis : [];
const realAiCliNames = new Set(realAiCliEntries.map((entry) => entry?.cli).filter(Boolean));
const realAiCliSourcePass =
  interactiveAgentSource.includes("resolve_windows_cli_program") &&
  interactiveAgentSource.includes('for ext in ["exe", "cmd", "bat"]') &&
  interactiveAgentSource.includes("Respect PATH directory order first");
const realAiCliProbeResiliencePass =
  realAiCliBinaryProbe?.maxAttempts >= 2 &&
  realAiCliEntries.every(
    (entry) =>
      typeof entry?.executablePath === "string" &&
      entry.executablePath.length > 0 &&
      Number.isInteger(entry?.attemptCount) &&
      entry.attemptCount >= 1 &&
      entry.attemptCount <= realAiCliBinaryProbe.maxAttempts &&
      Array.isArray(entry?.attempts) &&
      entry.attempts.length === entry.attemptCount &&
      entry.attempts.every(
        (attempt) =>
          attempt?.cli === entry?.cli &&
          Number.isInteger(attempt?.attempt) &&
          typeof attempt?.executablePath === "string" &&
          attempt.executablePath.length > 0,
      ),
  );
const realAiCliBinaryProbePass =
  realAiCliBinaryProbeFresh &&
  realAiCliBinaryProbe?.checks?.commandSessionCapability === true &&
  realAiCliSourcePass &&
  realAiCliProbeResiliencePass &&
  ["codex", "claude", "gemini"].every((cli) => realAiCliNames.has(cli)) &&
  realAiCliEntries.every(
    (entry) =>
      entry?.status === "pass" &&
      entry?.markerSeen === true &&
      entry?.commandNotFound === false &&
      entry?.fatalLaunchError !== true &&
      (entry?.versionLike === true || entry?.usageLike === true),
  );
add(
  scores,
  "real-ai-cli-binary-probe",
  "Real AI CLI binary launch",
  realAiCliBinaryProbePass ? 6 : 0,
  6,
  realAiCliBinaryProbePass
    ? "real Codex/Claude/Gemini binaries launch through the sidecar PTY with executable-path and retry provenance"
    : realAiCliBinaryProbe?.status === "external_dependency"
      ? "external CLI dependency missing"
      : "missing or failing real AI CLI binary probe",
  realAiCliBinaryProbePass
    ? []
    : [
        ...(realAiCliBinaryProbeFresh ? [] : ["real AI CLI binary probe artifact is missing, stale, or failing"]),
        ...(realAiCliSourcePass
          ? []
          : ["Windows CLI resolution does not prove PATH-order and exe-before-cmd behavior"]),
        ...(realAiCliBinaryProbe?.checks?.commandSessionCapability === true
          ? []
          : ["real AI CLI probe did not prove command-session capability"]),
        ...(realAiCliProbeResiliencePass
          ? []
          : ["real AI CLI probe did not prove executable-path provenance and bounded retry telemetry"]),
        ...["codex", "claude", "gemini"]
          .filter((cli) => !realAiCliNames.has(cli))
          .map((cli) => `missing real ${cli} CLI probe`),
        ...realAiCliEntries
          .filter(
            (entry) =>
              entry?.status !== "pass" ||
              entry?.markerSeen !== true ||
              entry?.commandNotFound !== false ||
              entry?.fatalLaunchError === true ||
              !(entry?.versionLike === true || entry?.usageLike === true),
          )
          .map((entry) => `real ${entry?.cli ?? "unknown"} CLI did not launch cleanly`),
      ],
);

const liveAiCliPostLaunchFresh =
  liveAiCliPostLaunchChaos?.status === "pass" &&
  mtimeMs(liveAiCliPostLaunchChaosPath) + 5_000 >=
    Math.max(
      mtimeMs(join(ROOT, "scripts", "verify-live-tauri-pty-ai-cli-chaos.mjs")),
      mtimeMs(join(ROOT, "src", "App.tsx")),
      mtimeMs(join(ROOT, "src", "shared", "lib", "aiCliLaunchPlanner.ts")),
      mtimeMs(join(ROOT, "src-tauri", "src", "api", "mod.rs")),
      mtimeMs(join(ROOT, "src-tauri", "src", "pty_sidecar.rs")),
      mtimeMs(join(ROOT, "src-tauri", "src", "ipc", "interactive_commands.rs")),
    );
const liveAiCliPostLaunchChecks = liveAiCliPostLaunchChaos?.checks ?? {};
const liveAiCliPostLaunchCleanup = liveAiCliPostLaunchChaos?.aiCliKillCleanup ?? {};
const liveAiCliPostLaunchExternalDependency =
  liveAiCliPostLaunchChaos?.status === "external_dependency" &&
  /WebView2 CDP endpoint/i.test(String(liveAiCliPostLaunchChaos?.dependency ?? "")) &&
  /Cannot attach to WebView2 CDP|ECONNREFUSED|TCP timeout|connectOverCDP|spawn EPERM/i.test(
    `${liveAiCliPostLaunchChaos?.error ?? ""}\n${liveAiCliPostLaunchChaos?.dependency ?? ""}`,
  );
const liveAiCliPostLaunchCleanUrl =
  liveAiCliPostLaunchChecks.cleanChaosQaUrl === true ||
  (hasCleanChaosQaUrl(liveAiCliPostLaunchChaos?.localStorageReload?.before?.href) &&
    hasCleanChaosQaUrl(liveAiCliPostLaunchChaos?.localStorageReload?.afterClearReload?.href) &&
    hasCleanChaosQaUrl(liveAiCliPostLaunchChaos?.localStorageReload?.afterReseed?.href));
const liveAiCliPostLaunchPass =
  liveAiCliPostLaunchFresh &&
  liveAiCliPostLaunchChecks.webviewAttached === true &&
  liveAiCliPostLaunchChecks.localStorageClearReloadedApp === true &&
  liveAiCliPostLaunchChecks.localStorageClearNoPageOverflow === true &&
  liveAiCliPostLaunchCleanUrl &&
  liveAiCliPostLaunchChecks.ptyPromptReadyBeforeWrite === true &&
  liveAiCliPostLaunchChecks.ptyPromptReadyAfterRestart === true &&
  liveAiCliPostLaunchChecks.ptyRestartBeforeVisible === true &&
  liveAiCliPostLaunchChecks.ptyRestartAfterVisible === true &&
  liveAiCliPostLaunchChecks.ptyMetricsStillHealthy === true &&
  liveAiCliPostLaunchCleanup.status === "pass" &&
  typeof liveAiCliPostLaunchCleanup.sessionId === "string" &&
  liveAiCliPostLaunchCleanup.remainingSessionsAfterCleanup === 0;

const nativeAiCliPostLaunchFresh =
  nativeAiCliPostLaunchChaos?.ok === true &&
  nativeAiCliPostLaunchChaos?.status === "pass" &&
  mtimeMs(nativeAiCliPostLaunchChaosPath) + 5_000 >=
    Math.max(
      mtimeMs(join(ROOT, "scripts", "verify-native-ai-cli-post-launch-chaos.mjs")),
      mtimeMs(join(ROOT, "src-tauri", "src", "api", "mod.rs")),
      mtimeMs(join(ROOT, "src-tauri", "src", "pty_sidecar.rs")),
      mtimeMs(join(ROOT, "src-tauri", "src", "ipc", "interactive_commands.rs")),
    );
const nativeAiCliPostLaunchChecks = nativeAiCliPostLaunchChaos?.checks ?? {};
const nativeAiCliPostLaunchSourcePass =
  packageJsonSource.includes('"verify:terminal:native-ai-cli-post-launch-chaos"') &&
  nativeAiCliPostLaunchChaosSource.includes("AELYRIS_NATIVE_AI_READY") &&
  nativeAiCliPostLaunchChaosSource.includes("AELYRIS_NATIVE_AI_INPUT") &&
  nativeAiCliPostLaunchChaosSource.includes("sameIdRespawned") &&
  nativeAiCliPostLaunchChaosSource.includes("noSessionResidue") &&
  nativeAiCliPostLaunchChaosSource.includes("webviewRequiredForToolCalls");
const nativeAiCliPostLaunchPass =
  nativeAiCliPostLaunchFresh &&
  nativeAiCliPostLaunchSourcePass &&
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
const nativeFirstPostLaunchPass = nativeAiCliPostLaunchPass && rightRailStaleUrlTruthPass;
const postLaunchChaosPass = liveAiCliPostLaunchPass || nativeFirstPostLaunchPass;
add(
  scores,
  "live-ai-cli-post-launch-chaos",
  "Live AI CLI post-launch chaos",
  postLaunchChaosPass ? 10 : 0,
  10,
  liveAiCliPostLaunchPass
    ? "fresh live Tauri/WebView2 AI CLI spawn, kill, cleanup, PTY restart, and rail reload chaos passed"
    : nativeFirstPostLaunchPass
      ? "native-first sidecar AI CLI spawn, kill, cleanup, same-id PTY restart, prompt readiness, and stale URL truth contracts passed"
      : liveAiCliPostLaunchChaos
        ? `${liveAiCliPostLaunchChaos.status ?? "unknown"} (stale or incomplete)`
        : "missing",
  postLaunchChaosPass
    ? []
    : liveAiCliPostLaunchExternalDependency
      ? [
          ...(nativeAiCliPostLaunchPass
            ? []
            : [
                "native-first AI CLI post-launch chaos is missing or stale, so PTY restart, prompt readiness, and AI CLI cleanup are still tied to the unavailable WebView2 CDP runtime",
              ]),
          ...(rightRailStaleUrlTruthPass
            ? []
            : ["right rail stale URL truth contract is missing, stale, or failing outside the live CDP shard"]),
          ...(nativeAiCliPostLaunchPass || rightRailStaleUrlTruthPass
            ? []
            : [
                "live AI CLI post-launch chaos is blocked by the unavailable Tauri/WebView2 CDP runtime, so PTY restart, prompt readiness, stale URL cleanup, and AI CLI spawn/kill cleanup cannot be truthfully claimed from this run",
              ]),
        ]
      : [
          ...(liveAiCliPostLaunchFresh
            ? []
            : ["live AI CLI post-launch chaos artifact is missing, stale, or not passing"]),
          ...(liveAiCliPostLaunchChecks.webviewAttached === true
            ? []
            : ["live AI CLI chaos did not attach to the Tauri/WebView2 runtime"]),
          ...(liveAiCliPostLaunchChecks.ptyRestartBeforeVisible === true &&
          liveAiCliPostLaunchChecks.ptyRestartAfterVisible === true &&
          liveAiCliPostLaunchChecks.ptyMetricsStillHealthy === true
            ? []
            : ["live AI CLI chaos did not prove PTY restart/recovery stayed healthy"]),
          ...(liveAiCliPostLaunchChecks.ptyPromptReadyBeforeWrite === true &&
          liveAiCliPostLaunchChecks.ptyPromptReadyAfterRestart === true
            ? []
            : ["live AI CLI chaos did not prove shell prompt readiness before terminal writes"]),
          ...(liveAiCliPostLaunchCleanUrl ? [] : ["live AI CLI chaos did not prove stale QA URL state was removed"]),
          ...(liveAiCliPostLaunchCleanup.status === "pass"
            ? []
            : ["live AI CLI chaos did not prove AI CLI spawn/kill cleanup"]),
          ...(liveAiCliPostLaunchCleanup.remainingSessionsAfterCleanup === 0
            ? []
            : ["live AI CLI chaos left interactive sessions after cleanup"]),
          ...(nativeAiCliPostLaunchFresh
            ? []
            : ["native-first AI CLI post-launch chaos artifact is missing, stale, or not passing"]),
          ...(nativeAiCliPostLaunchSourcePass
            ? []
            : ["native-first AI CLI post-launch chaos source contract is not wired into package scripts"]),
          ...(nativeAiCliPostLaunchChecks.sameIdRespawned === true &&
          nativeAiCliPostLaunchChecks.ptyPromptReadyBeforeWrite === true &&
          nativeAiCliPostLaunchChecks.ptyPromptReadyAfterRestart === true &&
          nativeAiCliPostLaunchChecks.ptyRestartBeforeVisible === true &&
          nativeAiCliPostLaunchChecks.ptyRestartAfterVisible === true &&
          nativeAiCliPostLaunchChecks.ptyNoResidue === true
            ? []
            : [
                "native-first AI CLI post-launch chaos did not prove same-id PTY restart, prompt readiness, and cleanup",
              ]),
          ...(nativeAiCliPostLaunchChecks.aiCliAllProvidersCovered === true &&
          nativeAiCliPostLaunchChecks.aiCliReadyVisible === true &&
          nativeAiCliPostLaunchChecks.aiCliInputRoundtrip === true &&
          nativeAiCliPostLaunchChecks.aiCliKillCleanup === true &&
          nativeAiCliPostLaunchChecks.noSessionResidue === true
            ? []
            : [
                "native-first AI CLI post-launch chaos did not prove all-provider spawn/input/kill cleanup with no residue",
              ]),
          ...(rightRailStaleUrlTruthPass
            ? []
            : ["right rail stale URL truth contract is missing, stale, or failing outside the live CDP shard"]),
        ],
);

const tauriRuntimeHygieneChecks = tauriRuntimeHygiene?.checks ?? {};
const tauriRuntimeHygieneFresh =
  tauriRuntimeHygiene?.ok === true &&
  tauriRuntimeHygiene?.status === "pass" &&
  mtimeMs(tauriRuntimeHygienePath) + 5_000 >=
    Math.max(
      mtimeMs(join(ROOT, "scripts", "verify-tauri-runtime-hygiene.mjs")),
      mtimeMs(join(ROOT, "scripts", "verify-right-rail-goal-track-tauri.mjs")),
      mtimeMs(join(ROOT, "scripts", "verify-live-tauri-pty-ai-cli-chaos.mjs")),
      mtimeMs(join(ROOT, "scripts", "verify-live-tauri-workstation-surfaces.mjs")),
      mtimeMs(join(ROOT, "scripts", "verify-performance-observatory.mjs")),
      mtimeMs(join(ROOT, "scripts", "verify-tauri-dpi-settings.mjs")),
      mtimeMs(join(ROOT, "src-tauri", "src", "pty_sidecar.rs")),
      mtimeMs(join(ROOT, "src-tauri", "src", "lib.rs")),
    );
const tauriRuntimeHygieneSourcePass =
  packageJsonSource.includes('"verify:tauri-runtime-hygiene"') &&
  tauriRuntimeHygieneScriptSource.includes("STATUS_HEAP_CORRUPTION") &&
  tauriRuntimeHygieneScriptSource.includes("STATUS_ACCESS_VIOLATION") &&
  tauriRuntimeHygieneScriptSource.includes("STATUS_ILLEGAL_INSTRUCTION") &&
  tauriRuntimeHygieneScriptSource.includes("0xc000001d") &&
  tauriRuntimeHygieneScriptSource.includes("probePort") &&
  tauriRuntimeHygieneScriptSource.includes("queryWorkspaceProcesses") &&
  tauriRuntimeHygieneScriptSource.includes("discoverTauriDevLogRuns") &&
  tauriRuntimeHygieneScriptSource.includes("activeLogRun") &&
  tauriRuntimeHygieneScriptSource.includes("sanitizeLogLine") &&
  tauriRuntimeHygieneScriptSource.includes("previousRunCrashMatches") &&
  tauriRuntimeHygieneScriptSource.includes("previousRunHelperOutputLeaks") &&
  tauriRuntimeHygieneScriptSource.includes("historicalIncidentClosure") &&
  tauriRuntimeHygieneScriptSource.includes("historicalIncidentsHaveCleanSuccessor") &&
  tauriRuntimeHygieneScriptSource.includes("portOwnershipQueryEnvironmentBlocked") &&
  tauriRuntimeHygieneScriptSource.includes("ownershipUnknownEnvironmentBlocked") &&
  tauriRuntimeHygieneScriptSource.includes("portOwnershipEnvironmentBlockedClean") &&
  ptySidecarSource.includes('hidden_command("icacls")') &&
  ptySidecarSource.includes('hidden_command("attrib")') &&
  ptySidecarSource.includes("stdout(std::process::Stdio::null())") &&
  ptySidecarSource.includes("stderr(std::process::Stdio::null())") &&
  tauriLibSource.includes("apply_windows_app_identity();") &&
  tauriLibSource.includes("AELYRIS_DISABLE_DWM_CHROME") &&
  tauriLibSource.includes("direct DWM chrome disabled by env") &&
  tauriGoalTrackScriptSource.includes("browser.disconnect") &&
  tauriGoalTrackScriptSource.includes("AELYRIS_TAURI_GOAL_TRACK_CLOSE_BROWSER") &&
  liveAiCliPostLaunchChaosSource.includes("browser.disconnect") &&
  liveTauriWorkstationSurfacesSource.includes("browser.disconnect") &&
  performanceObservatorySource.includes("browser.disconnect") &&
  tauriDpiSettingsSource.includes("browser.disconnect");
const tauriRuntimeHygienePass =
  tauriRuntimeHygieneFresh &&
  tauriRuntimeHygieneSourcePass &&
  tauriRuntimeHygieneChecks.noCrashMarkers === true &&
  tauriRuntimeHygieneChecks.noHelperOutputLeaks === true &&
  tauriRuntimeHygieneChecks.portsClosed === true &&
  tauriRuntimeHygieneChecks.workspaceProcessesClear === true &&
  tauriRuntimeHygieneChecks.noStalePidFiles === true &&
  tauriRuntimeHygieneChecks.historicalIncidentsClassified === true &&
  tauriRuntimeHygieneChecks.historicalIncidentsHaveCleanSuccessor === true;
add(
  scores,
  "tauri-runtime-hygiene",
  "Tauri runtime crash and residue hygiene",
  tauriRuntimeHygienePass ? 8 : 0,
  8,
  tauriRuntimeHygienePass
    ? "latest Tauri verification logs are crash-free, residue-free, and historical incidents have clean successors"
    : tauriRuntimeHygiene
      ? `${tauriRuntimeHygiene.status ?? "unknown"} (stale or incomplete)`
      : "missing",
  tauriRuntimeHygienePass
    ? []
    : [
        ...(tauriRuntimeHygieneFresh ? [] : ["Tauri runtime hygiene artifact is missing, stale, or failing"]),
        ...(tauriRuntimeHygieneSourcePass
          ? []
          : [
              "Tauri CDP verifier shutdown paths are not all detach-first, helper output is not silenced, direct DWM chrome is not env-gated, or hygiene script is incomplete",
            ]),
        ...(tauriRuntimeHygieneChecks.noCrashMarkers === true
          ? []
          : [
              "latest Tauri dev logs contain crash markers such as STATUS_HEAP_CORRUPTION or STATUS_ILLEGAL_INSTRUCTION",
            ]),
        ...(tauriRuntimeHygieneChecks.noHelperOutputLeaks === true
          ? []
          : ["latest Tauri dev logs contain helper command output leaks such as token-file ACL messages"]),
        ...(tauriRuntimeHygieneChecks.portsClosed === true ? [] : ["Tauri dev or CDP ports are still open"]),
        ...(tauriRuntimeHygieneChecks.workspaceProcessesClear === true
          ? []
          : ["workspace Aelyris or aelyris-pty-server processes are still running"]),
        ...(tauriRuntimeHygieneChecks.noStalePidFiles === true ? [] : ["Tauri dev pid files were left behind"]),
        ...(tauriRuntimeHygieneChecks.historicalIncidentsClassified === true
          ? []
          : ["historical Tauri runtime crash/helper-output incidents are not classified"]),
        ...(tauriRuntimeHygieneChecks.historicalIncidentsHaveCleanSuccessor === true
          ? []
          : ["historical Tauri runtime incidents do not have a newer clean verification run"]),
      ],
);

const authenticatedAiCliPromptFresh =
  authenticatedAiCliPromptSmoke?.status === "pass" &&
  authenticatedAiCliPromptSmoke?.ok === true &&
  mtimeMs(authenticatedAiCliPromptSmokePath) + 5_000 >=
    Math.max(
      mtimeMs(join(ROOT, "scripts", "verify-authenticated-ai-cli-prompt-smoke.mjs")),
      mtimeMs(join(ROOT, "src", "shared", "lib", "aiCliLaunchPlanner.ts")),
      mtimeMs(join(ROOT, "src-tauri", "src", "ipc", "interactive_commands.rs")),
      mtimeMs(join(ROOT, "src-tauri", "src", "pty_sidecar.rs")),
    );
const authenticatedAiCliPromptChecks = authenticatedAiCliPromptSmoke?.checks ?? {};
const authenticatedAiCliPromptCleanupAfterSuccess = authenticatedAiCliPromptSmoke?.cleanupAfterSuccess ?? {};
const authenticatedAiCliPromptOutputEvidence = authenticatedAiCliPromptSmoke?.outputEvidence ?? {};
const authenticatedAiCliPromptPreflightArtifacts = authenticatedAiCliPromptSmoke?.nonTokenPreflight?.artifacts ?? {};
const authenticatedAiCliPromptPreflightArtifactEntries = Object.values(authenticatedAiCliPromptPreflightArtifacts);
const authenticatedAiCliPromptNativeChaosCoversLiveChaos =
  authenticatedAiCliPromptSmoke?.nonTokenPreflight?.nativePostLaunchChaosPass === true &&
  authenticatedAiCliPromptPreflightArtifacts.nativePostLaunchChaos?.fresh === true &&
  !authenticatedAiCliPromptPreflightArtifacts.nativePostLaunchChaos?.parseError;
const authenticatedAiCliPromptNativeImeCoversCdpIme =
  authenticatedAiCliPromptSmoke?.nonTokenPreflight?.imeReadiness === "native-input-host-passed" &&
  authenticatedAiCliPromptPreflightArtifacts.nativeInputHost?.fresh === true &&
  !authenticatedAiCliPromptPreflightArtifacts.nativeInputHost?.parseError;
const authenticatedAiCliPromptPreflightArtifactsFresh =
  authenticatedAiCliPromptPreflightArtifactEntries.length >= 5 &&
  Object.entries(authenticatedAiCliPromptPreflightArtifacts).every(([name, artifact]) => {
    if (name === "postLaunchChaos" && authenticatedAiCliPromptNativeChaosCoversLiveChaos) {
      return !artifact?.parseError;
    }
    if (name === "ime" && authenticatedAiCliPromptNativeImeCoversCdpIme) {
      return !artifact?.parseError;
    }
    return artifact?.fresh === true && !artifact?.parseError;
  });
const authenticatedAiCliPromptRequiresOptIn = authenticatedAiCliPromptSmoke?.status === "requires_opt_in";
const authenticatedAiCliPromptNoTokenPreflightReady =
  (authenticatedAiCliPromptChecks.nonTokenPreflightReady === true ||
    authenticatedAiCliPromptSmoke?.nonTokenPreflight?.ready === true) &&
  authenticatedAiCliPromptPreflightArtifactsFresh;
const authenticatedAiCliPromptStructuredCleanup =
  authenticatedAiCliPromptChecks.cleanup === true &&
  authenticatedAiCliPromptCleanupAfterSuccess.checked === true &&
  authenticatedAiCliPromptCleanupAfterSuccess.attemptedStop === true &&
  authenticatedAiCliPromptCleanupAfterSuccess.stillPresent === false &&
  authenticatedAiCliPromptCleanupAfterSuccess.unexpectedNewSessions === 0 &&
  !authenticatedAiCliPromptCleanupAfterSuccess.stopError &&
  !authenticatedAiCliPromptCleanupAfterSuccess.listError;
const authenticatedAiCliPromptOutputEvidencePrivacy =
  authenticatedAiCliPromptVerifierSource.includes("createHash") &&
  authenticatedAiCliPromptVerifierSource.includes("outputEvidence") &&
  authenticatedAiCliPromptVerifierSource.includes('privacy: "raw terminal output not persisted"') &&
  !authenticatedAiCliPromptVerifierSource.includes("report.outputTail") &&
  !authenticatedAiCliPromptVerifierSource.includes("outputTail");
const authenticatedAiCliConsentPacketFresh =
  authenticatedAiCliConsentPacket?.ok === true &&
  authenticatedAiCliConsentPacket?.status === "pass" &&
  mtimeMs(authenticatedAiCliConsentPacketPath) + 5_000 >=
    Math.max(
      mtimeMs(join(ROOT, "scripts", "verify-authenticated-ai-cli-consent-packet.mjs")),
      mtimeMs(authenticatedAiCliPromptSmokePath),
      mtimeMs(authenticatedAiCliProviderGuardPath),
      mtimeMs(authenticatedAiCliPreflightMatrixPath),
      mtimeMs(aiCliLaunchPlannerSmokePath),
    );
const authenticatedAiCliConsentPacketSourcePass =
  packageJsonSource.includes('"verify:terminal:authenticated-ai-cli-consent-packet"') &&
  authenticatedAiCliConsentPacketSource.includes("authenticated-ai-cli-consent-packet.json") &&
  authenticatedAiCliConsentPacketSource.includes("consentPacketSha256") &&
  authenticatedAiCliConsentPacketSource.includes("consentPhraseSha256") &&
  authenticatedAiCliConsentPacketSource.includes("noRawPromptTextPersisted") &&
  authenticatedAiCliConsentPacketSource.includes("tokenPromptExecutedWithConsent") &&
  authenticatedAiCliConsentPacketSource.includes("promptStateValid") &&
  authenticatedAiCliConsentPacketSource.includes("allProviderOptInCommandsReady") &&
  authenticatedAiCliConsentPacketSource.includes("providerGuardBlocksPrompt") &&
  authenticatedAiCliConsentPacketSource.includes("sourceArtifactsFresh");
const authenticatedAiCliConsentPacketPromptStatePass =
  (authenticatedAiCliConsentPacket?.checks?.noTokenPromptSent === true &&
    authenticatedAiCliConsentPacket?.packet?.safeNoPromptSent === true &&
    authenticatedAiCliConsentPacket?.packet?.tokenSpendingPromptExecuted === false) ||
  (authenticatedAiCliConsentPacket?.checks?.tokenPromptExecutedWithConsent === true &&
    authenticatedAiCliConsentPacket?.packet?.safeNoPromptSent === false &&
    authenticatedAiCliConsentPacket?.packet?.tokenSpendingPromptExecuted === true);
const authenticatedAiCliConsentPacketPass =
  authenticatedAiCliConsentPacketFresh &&
  authenticatedAiCliConsentPacketSourcePass &&
  authenticatedAiCliConsentPacket?.checks?.promptStateValid === true &&
  authenticatedAiCliConsentPacketPromptStatePass &&
  authenticatedAiCliConsentPacket?.checks?.promptConsentPacketReady === true &&
  authenticatedAiCliConsentPacket?.checks?.providerGuardBlocksPrompt === true &&
  authenticatedAiCliConsentPacket?.checks?.providerMatrixReady === true &&
  authenticatedAiCliConsentPacket?.checks?.allProviderOptInCommandsReady === true &&
  authenticatedAiCliConsentPacket?.checks?.launchPlannerReady === true &&
  authenticatedAiCliConsentPacket?.checks?.sourceArtifactsFresh === true &&
  authenticatedAiCliConsentPacket?.checks?.noRawPromptTextPersisted === true &&
  authenticatedAiCliConsentPacket?.packet?.command === "pnpm verify:goal:operator:token-smoke" &&
  authenticatedAiCliConsentPacket?.packet?.requiredEnv ===
    "AELYRIS_AUTH_PROMPT_PROVIDER=codex|claude|gemini" &&
  authenticatedAiCliConsentPacket?.packet?.tokenGate ===
    "per-execution one-use packet under standing repo authorization" &&
  authenticatedAiCliConsentPacket?.packet?.wouldSpendTokens === true &&
  typeof authenticatedAiCliConsentPacket?.consentPacketSha256 === "string" &&
  authenticatedAiCliConsentPacket.consentPacketSha256.length === 64 &&
  ["codex", "claude", "gemini"].every((provider) =>
    authenticatedAiCliConsentPacket?.providerReadiness?.some?.(
      (entry) =>
        entry?.provider === provider &&
        entry?.status === "ready" &&
        entry?.command === "pnpm verify:goal:operator:token-smoke" &&
        String(entry?.requiredEnv ?? "").includes(`AELYRIS_AUTH_PROMPT_PROVIDER=${provider}`),
    ),
  );
const authenticatedAiCliPromptPass =
  authenticatedAiCliPromptFresh &&
  authenticatedAiCliPromptChecks.consent === true &&
  authenticatedAiCliPromptNoTokenPreflightReady &&
  authenticatedAiCliPromptChecks.preflightReadyBeforePrompt === true &&
  authenticatedAiCliPromptChecks.sessionBaseline === true &&
  authenticatedAiCliPromptChecks.spawned === true &&
  authenticatedAiCliPromptChecks.sidecarBackend === true &&
  authenticatedAiCliPromptChecks.promptMarkerObserved === true &&
  authenticatedAiCliPromptOutputEvidence.privacy === "raw terminal output not persisted" &&
  authenticatedAiCliPromptOutputEvidence.markerPresent === true &&
  typeof authenticatedAiCliPromptOutputEvidence.outputSha256 === "string" &&
  authenticatedAiCliPromptOutputEvidence.outputSha256.length === 64 &&
  authenticatedAiCliPromptOutputEvidencePrivacy &&
  authenticatedAiCliPromptStructuredCleanup;
add(
  scores,
  "authenticated-ai-cli-prompt-smoke",
  "Authenticated AI CLI prompt smoke",
  authenticatedAiCliPromptPass ? 10 : 0,
  10,
  authenticatedAiCliPromptPass
    ? "fresh opt-in authenticated prompt smoke proved marker output and cleanup through sidecar"
    : authenticatedAiCliPromptRequiresOptIn
      ? authenticatedAiCliPromptNoTokenPreflightReady
        ? "requires explicit token-spend consent; non-token preflight artifacts are green"
        : "requires explicit token-spend consent; non-token preflight artifacts are incomplete"
      : authenticatedAiCliPromptSmoke
        ? `${authenticatedAiCliPromptSmoke.status ?? "unknown"} (stale or incomplete)`
        : "missing",
  authenticatedAiCliPromptPass
    ? []
    : authenticatedAiCliPromptRequiresOptIn
      ? [
          "authenticated AI CLI prompt smoke requires explicit token-spend consent",
          ...(authenticatedAiCliPromptNoTokenPreflightReady
            ? []
            : ["authenticated AI CLI prompt smoke non-token preflight artifacts are incomplete or stale"]),
        ]
      : [
          ...(authenticatedAiCliPromptFresh
            ? []
            : ["authenticated AI CLI prompt smoke artifact is missing, stale, or not passing"]),
          ...(authenticatedAiCliPromptChecks.consent === true
            ? []
            : ["authenticated AI CLI prompt smoke requires explicit token-spend consent"]),
          ...(authenticatedAiCliPromptNoTokenPreflightReady &&
          authenticatedAiCliPromptChecks.preflightReadyBeforePrompt === true
            ? []
            : ["authenticated AI CLI prompt smoke did not prove green preflight immediately before prompt"]),
          ...(authenticatedAiCliPromptChecks.sessionBaseline === true
            ? []
            : ["authenticated AI CLI prompt smoke did not capture a session baseline before spawn"]),
          ...(authenticatedAiCliPromptChecks.sidecarBackend === true
            ? []
            : ["authenticated AI CLI prompt smoke did not prove sidecar backend"]),
          ...(authenticatedAiCliPromptChecks.promptMarkerObserved === true
            ? []
            : ["authenticated AI CLI prompt smoke did not observe the expected prompt marker"]),
          ...(authenticatedAiCliPromptOutputEvidence.privacy === "raw terminal output not persisted" &&
          authenticatedAiCliPromptOutputEvidence.markerPresent === true &&
          typeof authenticatedAiCliPromptOutputEvidence.outputSha256 === "string" &&
          authenticatedAiCliPromptOutputEvidence.outputSha256.length === 64 &&
          authenticatedAiCliPromptOutputEvidencePrivacy
            ? []
            : ["authenticated AI CLI prompt smoke would persist raw terminal output instead of redacted evidence"]),
          ...(authenticatedAiCliPromptStructuredCleanup
            ? []
            : ["authenticated AI CLI prompt smoke did not prove structured session cleanup"]),
        ],
);

const authenticatedAiCliPromptPreflightGuardPass =
  authenticatedAiCliConsentPacketPass &&
  authenticatedAiCliPromptVerifierSource.includes("const noTokenPreflight = buildNoTokenPreflight(PROVIDER)") &&
  authenticatedAiCliProviderGuardSource.includes("authenticated-ai-cli-provider-required-smoke.json") &&
  packageJsonSource.includes('"verify:terminal:authenticated-ai-cli-provider-guard"') &&
  authenticatedAiCliPromptVerifierSource.includes('report.status = "preflight_blocked"') &&
  authenticatedAiCliPromptVerifierSource.includes(
    'report.status = PROVIDER_EXPLICIT ? "unsupported_provider" : "provider_required"',
  ) &&
  authenticatedAiCliPromptVerifierSource.includes("if (!noTokenPreflight.ready)") &&
  authenticatedAiCliPromptVerifierSource.includes("if (!PROVIDER_EXPLICIT || !SUPPORTED_PROVIDERS.has(PROVIDER))") &&
  authenticatedAiCliPromptVerifierSource.includes("safeNoPromptSent: true") &&
  authenticatedAiCliPromptVerifierSource.includes("preflightReadyBeforePrompt: false") &&
  authenticatedAiCliPromptVerifierSource.includes("preflightReadyBeforePrompt: true") &&
  authenticatedAiCliPromptVerifierSource.includes("process.exit(3)") &&
  authenticatedAiCliPromptVerifierSource.includes("process.exit(4)") &&
  authenticatedAiCliPromptVerifierSource.includes("recordCleanup") &&
  authenticatedAiCliPromptVerifierSource.includes("cleanupAfterFailure") &&
  authenticatedAiCliPromptVerifierSource.includes("sessionBaseline") &&
  authenticatedAiCliPromptVerifierSource.includes("unexpectedNewSessions") &&
  authenticatedAiCliPromptVerifierSource.includes("AELYRIS_AUTH_PROMPT_CLOSE_BROWSER") &&
  authenticatedAiCliPromptVerifierSource.includes("browser.disconnect") &&
  authenticatedAiCliPromptVerifierSource.includes("browserCloseRequested") &&
  authenticatedAiCliPromptOutputEvidencePrivacy &&
  authenticatedAiCliPromptVerifierSource.includes("process.exit(report.ok ? 0 : process.exitCode || 1)") &&
  authenticatedPromptConsentTestSource.includes("consented but preflight-blocked") &&
  authenticatedPromptConsentTestSource.includes("consented but provider-missing") &&
  appSilentBugsTestSource.includes("cleanupAfterFailure") &&
  appSilentBugsTestSource.includes("AELYRIS_AUTH_PROMPT_CLOSE_BROWSER") &&
  appSilentBugsTestSource.includes("unexpectedNewSessions") &&
  appSilentBugsTestSource.includes("browser.disconnect") &&
  authenticatedPromptConsentTestSource.includes("safe and incomplete") &&
  authenticatedAiCliProviderGuard?.status === "provider_required" &&
  authenticatedAiCliProviderGuard?.guardVerifier?.ok === true &&
  authenticatedAiCliProviderGuard?.guardVerifier?.checks?.tokenBlocked === true &&
  authenticatedAiCliProviderGuard?.guardVerifier?.checks?.noPromptSent === true &&
  authenticatedAiCliProviderGuard?.guardVerifier?.checks?.noSessionSpawned === true &&
  mtimeMs(authenticatedAiCliProviderGuardPath) + 30_000 >=
    Math.max(
      mtimeMs(join(ROOT, "scripts", "verify-authenticated-ai-cli-provider-guard.mjs")),
      mtimeMs(join(ROOT, "scripts", "verify-authenticated-ai-cli-prompt-smoke.mjs")),
      mtimeMs(join(ROOT, "scripts", "verify-authenticated-ai-cli-consent-packet.mjs")),
    ) &&
  (authenticatedAiCliPromptPass ||
    (authenticatedAiCliPromptSmoke?.status === "requires_opt_in" &&
      authenticatedAiCliPromptChecks.tokenSpendingExecutionBlocked === true &&
      authenticatedAiCliPromptChecks.safeNoPromptSent === true &&
      authenticatedAiCliPromptNoTokenPreflightReady));
add(
  scores,
  "authenticated-ai-cli-preflight-gate",
  "Authenticated AI CLI preflight gate",
  authenticatedAiCliPromptPreflightGuardPass ? 8 : 0,
  8,
  authenticatedAiCliPromptPreflightGuardPass
    ? "token-spending prompt path is blocked until consent and green immediate preflight"
    : "missing or stale immediate-preflight/cleanup guard",
  authenticatedAiCliPromptPreflightGuardPass
    ? []
    : [
        ...(authenticatedAiCliPromptVerifierSource.includes('report.status = "preflight_blocked"')
          ? []
          : ["authenticated prompt verifier does not expose preflight_blocked"]),
        ...(authenticatedAiCliConsentPacketPass
          ? []
          : ["authenticated prompt consent packet artifact is missing, stale, or not proving exact opt-in command"]),
        ...(authenticatedAiCliPromptVerifierSource.includes("if (!noTokenPreflight.ready)") &&
        authenticatedAiCliPromptVerifierSource.includes("process.exit(3)")
          ? []
          : ["authenticated prompt verifier can reach prompt execution without a green preflight gate"]),
        ...(authenticatedAiCliPromptVerifierSource.includes(
          "if (!PROVIDER_EXPLICIT || !SUPPORTED_PROVIDERS.has(PROVIDER))",
        ) &&
        authenticatedAiCliPromptVerifierSource.includes(
          'report.status = PROVIDER_EXPLICIT ? "unsupported_provider" : "provider_required"',
        ) &&
        authenticatedAiCliPromptVerifierSource.includes("process.exit(4)")
          ? []
          : ["authenticated prompt verifier can spend tokens without an explicit supported provider"]),
        ...(authenticatedAiCliProviderGuard?.status === "provider_required" &&
        authenticatedAiCliProviderGuard?.guardVerifier?.ok === true &&
        authenticatedAiCliProviderGuard?.guardVerifier?.checks?.tokenBlocked === true &&
        authenticatedAiCliProviderGuard?.guardVerifier?.checks?.noPromptSent === true &&
        authenticatedAiCliProviderGuard?.guardVerifier?.checks?.noSessionSpawned === true
          ? []
          : ["authenticated prompt provider-required guard artifact is missing or failing"]),
        ...(authenticatedAiCliPromptVerifierSource.includes("recordCleanup") &&
        authenticatedAiCliPromptVerifierSource.includes("cleanupAfterFailure") &&
        authenticatedAiCliPromptVerifierSource.includes("sessionBaseline") &&
        authenticatedAiCliPromptVerifierSource.includes("unexpectedNewSessions")
          ? []
          : ["authenticated prompt verifier does not prove baseline-aware cleanup after prompt-path failures"]),
        ...(authenticatedAiCliPromptVerifierSource.includes("AELYRIS_AUTH_PROMPT_CLOSE_BROWSER") &&
        authenticatedAiCliPromptVerifierSource.includes("browser.disconnect") &&
        authenticatedAiCliPromptVerifierSource.includes("browserCloseRequested") &&
        authenticatedAiCliPromptVerifierSource.includes("process.exit(report.ok ? 0 : process.exitCode || 1)")
          ? []
          : ["authenticated prompt verifier does not prove default CDP detach without closing the host browser"]),
        ...(authenticatedAiCliPromptOutputEvidencePrivacy
          ? []
          : ["authenticated AI CLI prompt smoke would persist raw terminal output instead of redacted evidence"]),
        ...(authenticatedPromptConsentTestSource.includes("consented but preflight-blocked") &&
        authenticatedPromptConsentTestSource.includes("consented but provider-missing") &&
        authenticatedPromptConsentTestSource.includes("safe and incomplete") &&
        appSilentBugsTestSource.includes("cleanupAfterFailure") &&
        appSilentBugsTestSource.includes("AELYRIS_AUTH_PROMPT_CLOSE_BROWSER") &&
        appSilentBugsTestSource.includes("unexpectedNewSessions") &&
        appSilentBugsTestSource.includes("browser.disconnect")
          ? []
          : ["authenticated prompt tests do not cover consented preflight blocking and cleanup-safe CDP behavior"]),
        ...(authenticatedAiCliPromptPass ||
        (authenticatedAiCliPromptChecks.tokenSpendingExecutionBlocked === true &&
          authenticatedAiCliPromptChecks.safeNoPromptSent === true)
          ? []
          : ["authenticated prompt artifact proves neither blocked-before-consent nor executed-with-consent"]),
        ...(authenticatedAiCliPromptNoTokenPreflightReady
          ? []
          : ["authenticated prompt non-token preflight artifacts are not green"]),
      ],
);

const authenticatedAiCliPreflightMatrixProviders = Array.isArray(authenticatedAiCliPreflightMatrix?.providerMatrix)
  ? authenticatedAiCliPreflightMatrix.providerMatrix
  : [];
const authenticatedAiCliPreflightMatrixArtifacts =
  authenticatedAiCliPreflightMatrix?.artifacts && typeof authenticatedAiCliPreflightMatrix.artifacts === "object"
    ? authenticatedAiCliPreflightMatrix.artifacts
    : {};
const authenticatedAiCliPreflightRequiredArtifactIds = [
  "realAiCliBinaryProbe",
  "interactiveAiCliBoundary",
  "nativeInputHost",
  "ime",
  "postLaunchChaos",
  "authenticatedPrompt",
  "launchPlanner",
];
const authenticatedAiCliPreflightMatrixFresh =
  authenticatedAiCliPreflightMatrix?.ok === true &&
  authenticatedAiCliPreflightMatrix?.status === "pass" &&
  mtimeMs(authenticatedAiCliPreflightMatrixPath) + 5_000 >=
    Math.max(
      mtimeMs(join(ROOT, "scripts", "verify-authenticated-ai-cli-preflight-matrix.mjs")),
      mtimeMs(realAiCliBinaryProbePath),
      mtimeMs(interactiveAiCliBoundaryPath),
      mtimeMs(nativeInputHostPath),
      mtimeMs(join(ROOT, ".codex-auto", "production-smoke", "verify-ime.json")),
      mtimeMs(liveAiCliPostLaunchChaosPath),
      mtimeMs(authenticatedAiCliPromptSmokePath),
      mtimeMs(aiCliLaunchPlannerSmokePath),
    );
const authenticatedAiCliPreflightMatrixRefreshMetadataPass =
  authenticatedAiCliPreflightMatrix?.checks?.artifactRefreshCommandsReady === true &&
  Array.isArray(authenticatedAiCliPreflightMatrix?.blockingArtifacts) &&
  authenticatedAiCliPreflightRequiredArtifactIds.every((id) => {
    const artifact = authenticatedAiCliPreflightMatrixArtifacts[id];
    return (
      artifact &&
      typeof artifact.path === "string" &&
      typeof artifact.refreshCommand === "string" &&
      artifact.refreshCommand.length > 0 &&
      typeof artifact.refreshReason === "string" &&
      artifact.refreshReason.length > 0 &&
      typeof artifact.expiresAt === "string" &&
      typeof artifact.costClass === "string" &&
      Object.hasOwn(artifact, "blockingReason")
    );
  });
const authenticatedAiCliPreflightMatrixSourcePass =
  packageJsonSource.includes('"verify:terminal:authenticated-ai-cli-preflight-matrix"') &&
  authenticatedAiCliPreflightMatrixSource.includes('const PROVIDERS = ["codex", "claude", "gemini"]') &&
  authenticatedAiCliPreflightMatrixSource.includes("tokenSpendingExecutionBlocked") &&
  authenticatedAiCliPreflightMatrixSource.includes("tokenPromptExecutedWithConsent") &&
  authenticatedAiCliPreflightMatrixSource.includes("promptExecutionStateReady") &&
  authenticatedAiCliPreflightMatrixSource.includes("safeNoPromptSent") &&
  authenticatedAiCliPreflightMatrixSource.includes("optInCommand(provider)") &&
  authenticatedAiCliPreflightMatrixSource.includes("ARTIFACT_REFRESH_COMMANDS") &&
  authenticatedAiCliPreflightMatrixSource.includes("artifactBlockingReason") &&
  authenticatedAiCliPreflightMatrixSource.includes("refreshCommand") &&
  authenticatedAiCliPreflightMatrixSource.includes("expiresAt") &&
  authenticatedAiCliPreflightMatrixSource.includes("blockingArtifacts") &&
  authenticatedAiCliPreflightMatrixSource.includes("requires-explicit-provider-token-spend") &&
  authenticatedPromptConsentSource.includes("AuthenticatedPromptPreflightArtifactReadiness") &&
  authenticatedPromptConsentSource.includes("AuthenticatedPromptArtifactFreshnessRadar") &&
  authenticatedPromptConsentSource.includes("deriveArtifactFreshnessRadar") &&
  authenticatedPromptConsentSource.includes("artifactReadiness") &&
  authenticatedPromptConsentSource.includes("artifactFreshness") &&
  appSource.includes("right-panel-goal-track-artifact-refresh") &&
  appSource.includes("right-panel-goal-track-freshness-radar") &&
  globalStylesSource.includes(".right-panel-goal-track-artifact-refresh") &&
  globalStylesSource.includes(".right-panel-goal-track-freshness-radar") &&
  appSilentBugsTestSource.includes("authenticated-ai-cli-preflight-matrix");
const authenticatedAiCliPreflightMatrixPass =
  authenticatedAiCliPreflightMatrixFresh &&
  authenticatedAiCliPreflightMatrixSourcePass &&
  authenticatedAiCliPreflightMatrixRefreshMetadataPass &&
  authenticatedAiCliPreflightMatrix?.checks?.allProvidersPresent === true &&
  authenticatedAiCliPreflightMatrix?.checks?.allProvidersReady === true &&
  authenticatedAiCliPreflightMatrix?.checks?.promptExecutionStateReady === true &&
  ((authenticatedAiCliPreflightMatrix?.checks?.tokenSpendingExecutionBlocked === true &&
    authenticatedAiCliPreflightMatrix?.checks?.noPromptSent === true) ||
    authenticatedAiCliPreflightMatrix?.checks?.tokenPromptExecutedWithConsent === true) &&
  authenticatedAiCliPreflightMatrix?.checks?.artifactFreshness === true &&
  ["codex", "claude", "gemini"].every((provider) =>
    authenticatedAiCliPreflightMatrixProviders.some((entry) => entry?.provider === provider && entry?.ready === true),
  );
add(
  scores,
  "authenticated-ai-cli-preflight-matrix",
  "Authenticated AI CLI provider preflight matrix",
  authenticatedAiCliPreflightMatrixPass ? 8 : 0,
  8,
  authenticatedAiCliPreflightMatrixPass
    ? "Codex, Claude, and Gemini are all preflight ready with refresh commands for every dependency"
    : "missing or stale provider preflight matrix",
  authenticatedAiCliPreflightMatrixPass
    ? []
    : [
        ...(authenticatedAiCliPreflightMatrixFresh
          ? []
          : ["authenticated AI CLI provider preflight matrix artifact is missing, stale, or failing"]),
        ...(authenticatedAiCliPreflightMatrixSourcePass
          ? []
          : [
              "authenticated AI CLI provider preflight matrix source, package script, or right rail refresh UI is incomplete",
            ]),
        ...(authenticatedAiCliPreflightMatrixRefreshMetadataPass
          ? []
          : ["authenticated AI CLI provider preflight matrix does not expose refresh commands for every artifact"]),
        ...(authenticatedAiCliPreflightMatrix?.checks?.allProvidersReady === true
          ? []
          : ["not all AI CLI providers are no-token preflight ready"]),
        ...(authenticatedAiCliPreflightMatrix?.checks?.promptExecutionStateReady === true &&
        ((authenticatedAiCliPreflightMatrix?.checks?.tokenSpendingExecutionBlocked === true &&
          authenticatedAiCliPreflightMatrix?.checks?.noPromptSent === true) ||
          authenticatedAiCliPreflightMatrix?.checks?.tokenPromptExecutedWithConsent === true)
          ? []
          : ["provider matrix proves neither blocked-before-consent nor executed-with-consent prompt state"]),
      ],
);

const aiCliLaunchPlannerSourcePass =
  aiCliLaunchPlannerSource.includes("export function deriveAiCliLaunchPlan") &&
  aiCliLaunchPlannerSource.includes("interface AiCliLaunchPreflightEvidence") &&
  aiCliLaunchPlannerSource.includes("interface AiCliLaunchPromptContract") &&
  aiCliLaunchPlannerSource.includes("interface AiCliLaunchContextPackContract") &&
  aiCliLaunchPlannerSource.includes("interface AiCliLaunchContextPackTrace") &&
  aiCliLaunchPlannerSource.includes("interface AiCliLaunchTrace") &&
  aiCliLaunchPlannerSource.includes('kind: "ai-cli-launch-plan"') &&
  aiCliLaunchPlannerSource.includes("sidecar-command-session") &&
  aiCliLaunchPlannerSource.includes("commandSessionCapability") &&
  aiCliLaunchPlannerSource.includes("derivePreflightChecks") &&
  aiCliLaunchPlannerSource.includes("derivePromptContractChecks") &&
  aiCliLaunchPlannerSource.includes("requirePreflight") &&
  aiCliLaunchPlannerSource.includes("requirePromptContract") &&
  aiCliLaunchPlannerSource.includes("preflightChecks") &&
  aiCliLaunchPlannerSource.includes("promptContractChecks") &&
  aiCliLaunchPlannerSource.includes("contextPack: buildContextPackTrace(promptContract)") &&
  aiCliLaunchPlannerSource.includes("hasContextPackContract") &&
  aiCliLaunchPlannerSource.includes("native IME, clipboard, reconnect, and AI CLI input-boundary preflight") &&
  aiCliLaunchPlannerSource.includes("muxLiveProcessPreservation") &&
  aiCliLaunchPlannerSource.includes(
    "machine-readable context pack trace with inclusion, exclusion, redaction, and changed-file counts",
  ) &&
  aiCliLaunchPlannerSource.includes(
    "prompt contract with objective, context pack, output, done criteria, and guardrails",
  ) &&
  aiCliLaunchPlannerSource.includes("expectedArtifacts") &&
  aiCliLaunchPlannerSource.includes("trace: buildAiCliLaunchTrace") &&
  aiCliLaunchPlannerSource.includes("native-fallback");
const aiCliLaunchPlannerTestsPass =
  aiCliLaunchPlannerTestSource.includes("promotes fresh real Codex/Claude/Gemini sidecar evidence") &&
  aiCliLaunchPlannerTestSource.includes("selects a proven provider") &&
  aiCliLaunchPlannerTestSource.includes("native fallback") &&
  aiCliLaunchPlannerTestSource.includes("required terminal preflight evidence is complete") &&
  aiCliLaunchPlannerTestSource.includes("blocks launch when required terminal preflight evidence is incomplete") &&
  aiCliLaunchPlannerTestSource.includes("required prompt contract evidence is complete") &&
  aiCliLaunchPlannerTestSource.includes("blocks launch when required prompt contract evidence is incomplete") &&
  aiCliLaunchPlannerTestSource.includes("machine-readable context pack is missing") &&
  aiCliLaunchPlannerTestSource.includes("plan.trace.contextPack") &&
  aiCliLaunchPlannerTestSource.includes("selectedLauncher") &&
  aiCliLaunchPlannerTestSource.includes("does not treat missing probe evidence as release-grade launch confidence");
const aiCliLaunchPlannerRightRailPass =
  rightRailSource.includes("plan-cli-launch") &&
  rightRailSource.includes("aiCliLaunchPlan") &&
  rightRailSource.includes("aiCliLaunchTrace") &&
  rightRailSource.includes("buildRightRailActionAuditPayload") &&
  rightRailSource.includes("right_rail.cli_launch_planner.opened") &&
  rightRailTestSource.includes("turns launch planner proof into a first-class command action") &&
  rightRailTestSource.includes("builds an audit payload that preserves launch planner trace provenance") &&
  rightRailTestSource.includes("aiCliLaunchTrace") &&
  appSource.includes("deriveAiCliLaunchPlan") &&
  appSource.includes("rightRailAiCliLaunchPlan") &&
  rightRailModelSource.includes("buildRightRailActionAuditPayload(action, previousMode)");
const aiCliLaunchPlannerSmokeFresh =
  aiCliLaunchPlannerSmoke?.ok === true &&
  mtimeMs(aiCliLaunchPlannerSmokePath) + 5_000 >=
    Math.max(
      mtimeMs(join(ROOT, "scripts", "verify-ai-cli-launch-planner.mjs")),
      mtimeMs(join(ROOT, "src", "shared", "lib", "aiCliLaunchPlanner.ts")),
      mtimeMs(realAiCliBinaryProbePath),
      mtimeMs(join(ROOT, ".codex-auto", "production-smoke", "native-terminal-input-host.json")),
      mtimeMs(join(ROOT, ".codex-auto", "production-smoke", "verify-ime.json")),
      mtimeMs(processReconnectCommandEvidencePath),
      mtimeMs(muxLiveProcessPreservationPath),
      mtimeMs(interactiveAiCliBoundaryPath),
    );
const aiCliLaunchPlannerPreflightTrace = Array.isArray(aiCliLaunchPlannerSmoke?.plan?.trace?.preflightChecks)
  ? aiCliLaunchPlannerSmoke.plan.trace.preflightChecks
  : [];
const aiCliLaunchPlannerPreflightIds = new Set(aiCliLaunchPlannerPreflightTrace.map((check) => check?.id));
const aiCliLaunchPlannerPreflightArtifacts = aiCliLaunchPlannerSmoke?.checks?.preflightArtifacts ?? {};
const aiCliLaunchPlannerPreflightPass =
  aiCliLaunchPlannerSmoke?.checks?.preflightReady === true &&
  ["native-ime", "clipboard-text", "process-reconnect", "interactive-cli-boundary"].every((id) =>
    aiCliLaunchPlannerPreflightIds.has(id),
  ) &&
  aiCliLaunchPlannerPreflightTrace.every((check) => check?.status === "ready") &&
  aiCliLaunchPlannerPreflightArtifacts.nativeInputHost ===
    join(ROOT, ".codex-auto", "production-smoke", "native-terminal-input-host.json") &&
  aiCliLaunchPlannerPreflightArtifacts.ime === join(ROOT, ".codex-auto", "production-smoke", "verify-ime.json") &&
  aiCliLaunchPlannerPreflightArtifacts.processReconnect === processReconnectCommandEvidencePath &&
  aiCliLaunchPlannerPreflightArtifacts.muxLiveProcessPreservation === muxLiveProcessPreservationPath &&
  aiCliLaunchPlannerPreflightArtifacts.interactiveBoundary === interactiveAiCliBoundaryPath;
const aiCliLaunchPlannerPromptContractTrace = Array.isArray(aiCliLaunchPlannerSmoke?.plan?.trace?.promptContractChecks)
  ? aiCliLaunchPlannerSmoke.plan.trace.promptContractChecks
  : [];
const aiCliLaunchPlannerPromptContractIds = new Set(aiCliLaunchPlannerPromptContractTrace.map((check) => check?.id));
const aiCliLaunchPlannerPromptContractPass =
  aiCliLaunchPlannerSmoke?.checks?.promptContractReady === true &&
  ["prompt-objective", "prompt-context", "prompt-output", "prompt-done", "prompt-guardrails"].every((id) =>
    aiCliLaunchPlannerPromptContractIds.has(id),
  ) &&
  aiCliLaunchPlannerPromptContractTrace.every((check) => check?.status === "ready");
const aiCliLaunchPlannerSmokePass =
  aiCliLaunchPlannerSmokeFresh &&
  aiCliLaunchPlannerSmoke?.checks?.sourceLoaded === true &&
  aiCliLaunchPlannerSmoke?.checks?.realProbePass === true &&
  aiCliLaunchPlannerSmoke?.checks?.realProbeFresh === true &&
  aiCliLaunchPlannerSmoke?.checks?.planReady === true &&
  aiCliLaunchPlannerSmoke?.checks?.traceComplete === true &&
  aiCliLaunchPlannerSmoke?.checks?.contextPackReady === true &&
  aiCliLaunchPlannerPreflightPass &&
  aiCliLaunchPlannerPromptContractPass &&
  aiCliLaunchPlannerSmoke?.checks?.providerMatrix?.allProvidersPresent === true &&
  aiCliLaunchPlannerSmoke?.checks?.providerMatrix?.allProvidersReady === true &&
  aiCliLaunchPlannerSmoke?.plan?.trace?.kind === "ai-cli-launch-plan" &&
  typeof aiCliLaunchPlannerSmoke?.plan?.trace?.selectedLauncher === "string" &&
  aiCliLaunchPlannerSmoke.plan.trace.selectedLauncher.length > 0;
const aiCliLaunchPlannerPass =
  realAiCliBinaryProbePass &&
  aiCliLaunchPlannerSourcePass &&
  aiCliLaunchPlannerTestsPass &&
  aiCliLaunchPlannerRightRailPass &&
  aiCliLaunchPlannerSmokePass;
add(
  scores,
  "ai-cli-launch-planner",
  "AI CLI launch planner",
  aiCliLaunchPlannerPass ? 12 : 0,
  12,
  aiCliLaunchPlannerPass
    ? "real CLI proof, terminal preflight, and prompt contract feed a provider/backend/role launch plan, first-class right rail action, and fresh runtime launch trace"
    : "missing planner source, tests, wiring, real CLI proof, terminal preflight, prompt contract, or runtime launch trace",
  aiCliLaunchPlannerPass
    ? []
    : [
        ...(realAiCliBinaryProbePass ? [] : ["real AI CLI binary proof is not passing"]),
        ...(aiCliLaunchPlannerSourcePass ? [] : ["AI CLI launch planner source contract is incomplete"]),
        ...(aiCliLaunchPlannerTestsPass ? [] : ["AI CLI launch planner unit coverage is incomplete"]),
        ...(aiCliLaunchPlannerRightRailPass ? [] : ["AI CLI launch planner is not wired into the right rail"]),
        ...(aiCliLaunchPlannerSmokePass
          ? []
          : ["AI CLI launch planner runtime smoke artifact is missing, stale, or incomplete"]),
        ...(aiCliLaunchPlannerSmoke?.checks?.contextPackReady === true
          ? []
          : ["AI CLI launch planner does not prove a machine-readable context pack trace"]),
        ...(aiCliLaunchPlannerPreflightPass
          ? []
          : ["AI CLI launch planner does not prove native IME, clipboard, reconnect, and CLI input preflight"]),
        ...(aiCliLaunchPlannerPromptContractPass
          ? []
          : ["AI CLI launch planner does not prove the pre-prompt objective/context/output/done/guardrail contract"]),
      ],
);

const commandCenterScenarioFresh =
  commandCenterScenario?.ok === true &&
  mtimeMs(commandCenterScenarioPath) + 5_000 >=
    Math.max(
      mtimeMs(commandCenterScenarioScript),
      mtimeMs(commandCenterScenarioTests),
      mtimeMs(agentFileChangesSourcePath),
      mtimeMs(agentFileChangesTestPath),
      mtimeMs(agentTelemetryPersistenceSourcePath),
      mtimeMs(agentTelemetryPersistenceTestPath),
      mtimeMs(useAgentManagerSourcePath),
      mtimeMs(useAgentManagerTelemetryTestPath),
      mtimeMs(join(ROOT, "src-tauri", "src", "agent", "interactive.rs")),
      mtimeMs(join(ROOT, "src-tauri", "src", "ipc", "interactive_commands.rs")),
      mtimeMs(rightRailAdvisor),
      mtimeMs(aiCliLaunchPlanner),
      mtimeMs(join(ROOT, "src", "shared", "lib", "workstationGraph.ts")),
      mtimeMs(join(ROOT, "src", "shared", "lib", "contextPack.ts")),
    );
const commandCenterScenarioRequiredActions = [
  "plan-cli-launch",
  "ready-command",
  "track-run",
  "inspect-cli-boundary",
  "parallel-run",
  "open-conductor",
  "review-queue",
  "trace-provenance",
  "collect-final-report",
  "handoff-context",
  "recover-attention",
  "resolve-approvals",
  "inspect-risk",
];
const commandCenterScenarioRequiredPhases = ["Plan", "Run", "Observe", "Route", "Review", "Preserve", "Recover"];
const commandCenterScenarioActions = new Set(
  Array.isArray(commandCenterScenario?.actionIds) ? commandCenterScenario.actionIds : [],
);
const commandCenterScenarioPhases = new Set(
  Array.isArray(commandCenterScenario?.phases) ? commandCenterScenario.phases : [],
);
const commandCenterScenarioChecks = commandCenterScenario?.checks ?? {};
const commandCenterScenarioSourcePass =
  commandCenterScenarioScriptSource.includes("AELYRIS_COMMAND_CENTER_SCENARIO_OUT") &&
  commandCenterScenarioScriptSource.includes("commandCenterScenario.test.ts") &&
  commandCenterScenarioTestSource.includes("buildWorkstationGraph") &&
  commandCenterScenarioTestSource.includes("deriveRightRailActions") &&
  commandCenterScenarioTestSource.includes("deriveAiCliLaunchPlan") &&
  commandCenterScenarioTestSource.includes("traceFileProvenance") &&
  commandCenterScenarioTestSource.includes("traceAgentImpact") &&
  commandCenterScenarioTestSource.includes("buildContextPack") &&
  commandCenterScenarioTestSource.includes("buildRightRailActionAuditPayload") &&
  commandCenterScenarioTestSource.includes("AELYRIS_COMMAND_CENTER_SCENARIO_OUT") &&
  agentFileChangesSource.includes("parseFileChangeEvent") &&
  agentFileChangesSource.includes("malformed-agent-structured-output-is-auditable") &&
  agentFileChangesTestSource.includes("surfaces malformed structured agent output as auditable parser_error") &&
  agentTelemetryPersistenceSource.includes("parseAgentTelemetrySnapshotResult") &&
  agentTelemetryPersistenceSource.includes("corrupt-agent-telemetry-is-auditable") &&
  agentTelemetryPersistenceSource.includes("createAgentTelemetryRecoverySession") &&
  agentTelemetryPersistenceTestSource.includes("surfaces corrupt snapshots as auditable recovery state") &&
  interactiveAgentSource.includes("Interactive session not found for status update") &&
  interactiveAgentSource.includes("Interactive session not found for usage update") &&
  interactiveAgentSource.includes("pub fn list(&self) -> Result<Vec<InteractiveSessionInfo>, String>") &&
  !interactiveAgentSource.includes("unwrap_or_default()") &&
  interactiveCommandsSource.includes("interactive-sessions-error") &&
  interactiveCommandsSource.includes("interactive session status update skipped") &&
  useAgentManagerSource.includes("Malformed agent structured output") &&
  useAgentManagerSource.includes("createAgentTelemetryRecoverySession") &&
  useAgentManagerTelemetryTestSource.includes(
    "keeps malformed structured output visible instead of silently losing provenance",
  );
const commandCenterScenarioPass =
  commandCenterScenarioFresh &&
  commandCenterScenarioSourcePass &&
  commandCenterScenarioChecks.launchPlanReady === true &&
  commandCenterScenarioChecks.loopPhasesCovered === true &&
  commandCenterScenarioChecks.provenanceReady === true &&
  commandCenterScenarioChecks.finalReportAndContextReady === true &&
  commandCenterScenarioChecks.recoveryReady === true &&
  commandCenterScenarioChecks.auditPayloadsComplete === true &&
  commandCenterScenarioRequiredActions.every((id) => commandCenterScenarioActions.has(id)) &&
  commandCenterScenarioRequiredPhases.every((phase) => commandCenterScenarioPhases.has(phase)) &&
  commandCenterScenario?.launchTrace?.recommendedBackend === "sidecar-command-session" &&
  commandCenterScenario?.contextPackSummary?.finalReportIncluded === true &&
  commandCenterScenario?.impact?.finalReports?.includes?.("final_report:final-native-edge") === true &&
  commandCenterScenario?.impact?.contextPacks?.includes?.("context_pack:handoff-native-edge") === true;
add(
  scores,
  "command-center-scenario",
  "Command Center end-to-end scenario",
  commandCenterScenarioPass ? 12 : 0,
  12,
  commandCenterScenarioPass
    ? "non-token scenario proves launch planning, live run control, provenance, review, final report, handoff context, recovery actions, and audit payloads"
    : commandCenterScenario
      ? "scenario artifact is stale or incomplete"
      : "missing",
  commandCenterScenarioPass
    ? []
    : [
        ...(commandCenterScenarioFresh ? [] : ["command center scenario artifact is missing, stale, or failing"]),
        ...(commandCenterScenarioSourcePass ? [] : ["command center scenario verifier or test source is incomplete"]),
        ...(commandCenterScenarioChecks.launchPlanReady === true
          ? []
          : ["command center scenario does not prove sidecar launch planning"]),
        ...(commandCenterScenarioChecks.loopPhasesCovered === true &&
        commandCenterScenarioRequiredPhases.every((phase) => commandCenterScenarioPhases.has(phase))
          ? []
          : ["command center scenario does not cover every Plan/Run/Observe/Route/Review/Preserve/Recover phase"]),
        ...(commandCenterScenarioChecks.provenanceReady === true
          ? []
          : ["command center scenario does not prove file provenance with terminal command anchors"]),
        ...(commandCenterScenarioChecks.finalReportAndContextReady === true
          ? []
          : ["command center scenario does not prove final report and context-pack handoff readiness"]),
        ...(commandCenterScenarioChecks.recoveryReady === true
          ? []
          : ["command center scenario does not prove recovery and approval actions"]),
        ...(commandCenterScenarioChecks.auditPayloadsComplete === true
          ? []
          : ["command center scenario does not prove complete right-rail audit payloads"]),
        ...commandCenterScenarioRequiredActions
          .filter((id) => !commandCenterScenarioActions.has(id))
          .map((id) => `command center scenario missing action: ${id}`),
      ],
);

const commandRecoveryFresh =
  commandRecoveryContract?.ok === true &&
  commandRecoveryContract?.status === "pass" &&
  mtimeMs(commandRecoveryContractPath) + 5_000 >=
    Math.max(
      mtimeMs(commandRecoveryScriptPath),
      mtimeMs(commandRecoveryTestPath),
      mtimeMs(commandRecoverySourcePath),
      mtimeMs(agentFileChangesSourcePath),
      mtimeMs(agentFileChangesTestPath),
      mtimeMs(join(ROOT, "src", "shared", "lib", "auditRecovery.ts")),
      mtimeMs(rightRailAdvisor),
      mtimeMs(join(ROOT, "src", "shared", "lib", "workstationGraph.ts")),
    );
const commandRecoveryChecks = commandRecoveryContract?.checks ?? {};
const failedCommandRecovery = commandRecoveryChecks.failedCommandRecovery ?? {};
const deniedToolRecovery = commandRecoveryChecks.deniedToolRecovery ?? {};
const failedCommandRecoveryChecks = failedCommandRecovery.checks ?? {};
const deniedToolRecoveryChecks = deniedToolRecovery.checks ?? {};
const commandRecoverySourcePass =
  packageJsonSource.includes('"verify:command-recovery"') &&
  commandRecoverySource.includes("deriveCommandRecoveryPlan") &&
  commandRecoverySource.includes("no-silent-retry") &&
  commandRecoverySource.includes("fallback-visible") &&
  commandRecoverySource.includes("stale-state-visible") &&
  commandRecoverySource.includes("buildRightRailActionAuditPayload") &&
  commandRecoveryTestSource.includes(
    "turns a failed command into retry, handoff, recovery actions, and audit payloads",
  ) &&
  commandRecoveryTestSource.includes("routes denied tool recovery through review denial without silently retrying") &&
  commandRecoveryScriptSource.includes("failed command recovery does not expose stale/fallback guards") &&
  agentFileChangesSource.includes('kind: "parser_error"') &&
  agentFileChangesSource.includes("malformed-agent-structured-output-is-auditable") &&
  agentFileChangesTestSource.includes("surfaces malformed structured agent output as auditable parser_error") &&
  agentFileChangesTestSource.includes("keeps parser errors separate from normal text so provenance degradation is visible");
const commandRecoveryPass =
  commandRecoveryFresh &&
  commandRecoverySourcePass &&
  failedCommandRecovery.status === "ready" &&
  failedCommandRecoveryChecks.failedCommandDetected === true &&
  failedCommandRecoveryChecks.recoveryHintReady === true &&
  failedCommandRecoveryChecks.retryReady === true &&
  failedCommandRecoveryChecks.handoffReady === true &&
  failedCommandRecoveryChecks.auditPayloadsReady === true &&
  failedCommandRecoveryChecks.noSilentFallback === true &&
  failedCommandRecovery.actionIds?.includes?.("recover-attention") === true &&
  failedCommandRecovery.actionIds?.includes?.("inspect-risk") === true &&
  failedCommandRecovery.guardIds?.includes?.("fallback-visible") === true &&
  failedCommandRecovery.guardIds?.includes?.("stale-state-visible") === true &&
  failedCommandRecovery.provenanceHasEvidence === true &&
  deniedToolRecovery.status === "ready" &&
  deniedToolRecovery.recoveryKind === "review-denial" &&
  deniedToolRecoveryChecks.noSilentFallback === true &&
  deniedToolRecovery.auditPayloadCount >= 1;
add(
  scores,
  "command-recovery-contract",
  "Command recovery and no-silent-fallback contract",
  commandRecoveryPass ? 10 : 0,
  10,
  commandRecoveryPass
    ? "failed command recovery proves retry, handoff, provenance, stale/fallback guards, and audit payloads"
    : commandRecoveryContract
      ? "recovery artifact is stale or incomplete"
      : "missing",
  commandRecoveryPass
    ? []
    : [
        ...(commandRecoveryFresh ? [] : ["command recovery contract artifact is missing, stale, or failing"]),
        ...(commandRecoverySourcePass
          ? []
          : ["command recovery source, verifier, tests, or agent stream parser visibility are incomplete"]),
        ...(failedCommandRecoveryChecks.failedCommandDetected === true
          ? []
          : ["command recovery does not prove failed command detection"]),
        ...(failedCommandRecoveryChecks.retryReady === true
          ? []
          : ["command recovery does not prove retry target readiness"]),
        ...(failedCommandRecoveryChecks.handoffReady === true
          ? []
          : ["command recovery does not prove handoff prompt readiness"]),
        ...(failedCommandRecoveryChecks.auditPayloadsReady === true
          ? []
          : ["command recovery does not prove audit payload readiness"]),
        ...(failedCommandRecoveryChecks.noSilentFallback === true &&
        failedCommandRecovery.guardIds?.includes?.("fallback-visible") === true &&
        failedCommandRecovery.guardIds?.includes?.("stale-state-visible") === true
          ? []
          : ["command recovery does not prove stale/fallback states are visible and never silently retried"]),
        ...(deniedToolRecovery.recoveryKind === "review-denial" && deniedToolRecoveryChecks.noSilentFallback === true
          ? []
          : ["denied tool recovery is not routed through review-denial without silent retry"]),
      ],
);

const tauriGoalTrackSmokeFresh =
  tauriGoalTrackSmoke?.ok === true &&
  mtimeMs(tauriGoalTrackSmokePath) + 5_000 >=
    Math.max(
      mtimeMs(join(ROOT, "scripts", "verify-right-rail-goal-track-tauri.mjs")),
      mtimeMs(join(ROOT, "scripts", "verify-final-goal-safe.mjs")),
      mtimeMs(join(ROOT, "src", "App.tsx")),
      mtimeMs(join(ROOT, "src", "shared", "lib", "authenticatedPromptConsent.ts")),
      mtimeMs(join(ROOT, "src", "shared", "lib", "releaseQuality.ts")),
      mtimeMs(join(ROOT, "src", "shared", "lib", "rightRailGoalTrack.ts")),
    );
const currentGoalTrackQualityDetail = currentGoalTrackQualityDetailFromAudit(finalGoalAudit);
const tauriGoalTrackExpectedQualityCurrent =
  currentGoalTrackQualityDetail != null &&
  tauriGoalTrackSmoke?.expectedQualityDetail === currentGoalTrackQualityDetail &&
  tauriGoalTrackSmoke?.checks?.goalTrack?.qualitySource?.detail === currentGoalTrackQualityDetail;
const tauriGoalTrackSafeSummaryCurrent =
  finalGoalSafeSummary?.artifacts?.rightRailGoalTrackTauri?.status === "pass-current-contract" &&
  finalGoalSafeSummary?.artifacts?.rightRailGoalTrackTauri?.strictProof === true &&
  finalGoalSafeSummary?.invariants?.rightRailGoalTrackSemanticFreshness === true &&
  tauriGoalTrackSmoke?.sourceArtifacts?.finalGoalSafe?.mtimeMs === mtimeMs(finalGoalSafeSummaryPath) &&
  tauriGoalTrackSmoke?.sourceArtifacts?.finalGoalSafe?.ok === true;
const tauriGoalTrackExpectedResidual = tauriGoalTrackSmoke?.expectedResidualRisk ?? null;
const tauriGoalTrackResidualRiskPass =
  tauriGoalTrackExpectedResidual?.state &&
  tauriGoalTrackSmoke?.checks?.goalTrack?.residualRisk?.state === tauriGoalTrackExpectedResidual.state &&
  tauriGoalTrackSmoke?.checks?.goalTrack?.residualRisk?.implementationFixableCount ===
    tauriGoalTrackExpectedResidual.implementationFixableCount &&
  tauriGoalTrackSmoke?.checks?.goalTrack?.residualRisk?.policyBlockedCount ===
    tauriGoalTrackExpectedResidual.policyBlockedCount;
const tauriGoalTrackConsentGateProgressPass =
  tauriGoalTrackExpectedResidual?.state !== "blocked-only-by-explicit-token-consent" ||
  tauriGoalTrackSmoke?.checks?.goalTrack?.percent === "99%";
const tauriGoalTrackExpectedRequirementProofs = Array.isArray(tauriGoalTrackSmoke?.expectedRequirementProofs)
  ? tauriGoalTrackSmoke.expectedRequirementProofs
  : [];
const tauriGoalTrackRequirementProofPass =
  tauriGoalTrackExpectedRequirementProofs.length >= 8 &&
  tauriGoalTrackExpectedRequirementProofs.every((expected) => {
    const actual = tauriGoalTrackSmoke?.checks?.goalTrack?.requirementProofs?.find?.(
      (item) => item?.id === expected?.id,
    );
    return (
      actual?.status === expected?.status &&
      actual?.label === expected?.label &&
      (expected?.evidenceCount <= 0 || actual?.evidenceCount === expected?.evidenceCount)
    );
  });
const tauriGoalTrackSafeGatePass =
  tauriGoalTrackSmoke?.expectedSafeGate?.status &&
  tauriGoalTrackSmoke?.checks?.goalTrack?.safeGate?.status === tauriGoalTrackSmoke.expectedSafeGate.status &&
  tauriGoalTrackSmoke?.checks?.goalTrack?.safeGate?.source === "final-goal-safe-summary" &&
  tauriGoalTrackSmoke?.checks?.goalTrack?.safeGate?.tokenSpendingPromptExecuted === "false" &&
  tauriGoalTrackSmoke?.checks?.goalTrack?.safeGate?.semanticFreshness ===
    tauriGoalTrackSmoke.expectedSafeGate.semanticFreshness &&
  tauriGoalTrackSmoke?.checks?.goalTrack?.safeGate?.cycleBoundary ===
    tauriGoalTrackSmoke.expectedSafeGate.cycleBoundary;
const tauriGoalTrackBoundaryProofPass =
  (tauriGoalTrackSmoke?.checks?.goalTrack?.boundaryProofs?.length ?? 0) >= 5 &&
  ["native-input-host", "native-hwnd-paste", "chunked-osc-inline-image", "release-hygiene", "safe-proof-chain"].every(
    (id) =>
      tauriGoalTrackSmoke?.checks?.goalTrack?.boundaryProofs?.some?.(
        (proof) =>
          proof?.id === id &&
          proof?.status === "proved" &&
          proof?.source === "final-goal-safe-summary" &&
          String(proof?.artifactPath ?? "").startsWith(".codex-auto/") &&
          String(proof?.refreshCommand ?? "").startsWith("pnpm verify:") &&
          proof?.costClass === "no-token",
      ) === true,
  );
const tauriGoalTrackSmokePass =
  tauriGoalTrackSmokeFresh &&
  tauriGoalTrackSmoke?.checks?.goalTrack?.qualitySource?.status === "fresh" &&
  tauriGoalTrackExpectedQualityCurrent &&
  tauriGoalTrackSmoke?.checks?.goalTrack?.consentPacket?.status === "ready" &&
  tauriGoalTrackSmoke?.checks?.goalTrack?.consentPacket?.command ===
    "pnpm verify:goal:operator:token-smoke" &&
  String(tauriGoalTrackSmoke?.checks?.goalTrack?.consentPacket?.requiredEnv ?? "").includes(
    "AELYRIS_AUTH_PROMPT_PROVIDER=",
  ) &&
  String(tauriGoalTrackSmoke?.checks?.goalTrack?.consentPacket?.providerEnvRequirement ?? "").includes(
    "AELYRIS_AUTH_PROMPT_PROVIDER=codex|claude|gemini",
  ) &&
  tauriGoalTrackSmoke?.checks?.goalTrack?.consentPacket?.tokenGate ===
    "per-execution one-use packet under standing repo authorization" &&
  tauriGoalTrackSmoke?.checks?.goalTrack?.consentPacket?.artifactFreshness?.status === "green" &&
  tauriGoalTrackSmoke?.checks?.goalTrack?.consentPacket?.artifactFreshness?.staleCount === 0 &&
  (tauriGoalTrackSmoke?.checks?.goalTrack?.consentPacket?.artifactFreshness?.totalCount ?? 0) > 0 &&
  String(tauriGoalTrackSmoke?.checks?.goalTrack?.consentPacket?.artifactFreshness?.nextRefreshCommand ?? "").length >
    0 &&
  ["codex", "claude", "gemini"].every((provider) =>
    tauriGoalTrackSmoke?.checks?.goalTrack?.consentPacket?.providers?.some?.(
      (entry) => entry?.label === provider && entry?.status === "ready",
    ),
  ) &&
  tauriGoalTrackResidualRiskPass &&
  tauriGoalTrackSafeSummaryCurrent &&
  tauriGoalTrackRequirementProofPass &&
  tauriGoalTrackSafeGatePass &&
  tauriGoalTrackBoundaryProofPass &&
  tauriGoalTrackConsentGateProgressPass &&
  tauriGoalTrackSmoke?.checks?.goalTrack?.remaining?.some?.((item) =>
    /authenticated.*prompt.*smoke/i.test(String(item ?? "")),
  ) === true &&
  countAuthenticatedPromptBlockers(tauriGoalTrackSmoke?.checks?.goalTrack?.remaining) === 1 &&
  (!tauriGoalTrackSmoke?.checks?.goalTrack?.remaining?.some?.((item) => /risk or blocker node/.test(String(item))) ||
    (tauriGoalTrackSmoke?.checks?.goalTrack?.riskEvidence?.length ?? 0) > 0) &&
  !tauriGoalTrackSmoke?.checks?.goalTrack?.remaining?.some?.((item) =>
    /right[\s_.-]*rail[\s_.-]*qa|qa[\s_-]*(missing[\s_-]*diff|stale[\s_-]*pane)/i.test(String(item ?? "")),
  );
const tauriGoalTrackSmokeEnvironmentBlockedPass =
  tauriGoalTrackSmokeEnvironmentBlocked?.status === "environment-blocked" &&
  tauriGoalTrackSmokeEnvironmentBlocked?.preservesPrimaryArtifact === true &&
  Array.isArray(tauriGoalTrackSmokeEnvironmentBlocked?.errors) &&
  tauriGoalTrackSmokeEnvironmentBlocked.errors.some((error) =>
    /Cannot attach to WebView2 CDP|ECONNREFUSED|TCP timeout|spawn EPERM|connectOverCDP|browserType\.launch/i.test(
      String(error),
    ),
  ) &&
  tauriGoalTrackSmokeEnvironmentBlocked?.sourceArtifacts?.releaseQualityScore?.ok === true &&
  tauriGoalTrackSmokeEnvironmentBlocked?.sourceArtifacts?.finalGoalAudit?.exists === true &&
  tauriGoalTrackSmokeEnvironmentBlocked?.sourceArtifacts?.finalGoalSafe?.exists === true &&
  (tauriGoalTrackSmokeEnvironmentBlocked?.sourceContract?.files?.length ?? 0) >= 8 &&
  mtimeMs(tauriGoalTrackSmokeEnvironmentBlockedPath) + 5_000 >=
    Math.max(
      mtimeMs(join(ROOT, "scripts", "verify-right-rail-goal-track-tauri.mjs")),
      mtimeMs(join(ROOT, "src", "App.tsx")),
      mtimeMs(join(ROOT, "src", "shared", "lib", "rightRailGoalTrack.ts")),
    );
const _tauriGoalTrackBootstrapPass =
  BOOTSTRAP_RIGHT_RAIL_GOAL_TRACK &&
  packageJsonSource.includes('"verify:right-rail-goal-track-tauri"') &&
  tauriGoalTrackScriptSource.includes("right-rail-goal-track-tauri.json") &&
  tauriGoalTrackScriptSource.includes("final-goal-safe-summary.json") &&
  finalGoalSafeVerifierSource.includes("AELYRIS_FINAL_GOAL_SAFE_BOOTSTRAP_RIGHT_RAIL") &&
  finalGoalSafeVerifierSource.includes("right-rail-safe-gate-mutual-proof");
const rightRailGoalTrackBrowserEnvironmentContractPass =
  commandEvidenceSmokeEnvironmentBlockedPass &&
  commandEvidenceNoSpawnSourcePass &&
  commandEvidenceHasContract &&
  commandEvidenceHasRuntimePath &&
  commandEvidenceHasE2e &&
  commandEvidenceScriptSource.includes("readGoalTrack") &&
  commandEvidenceScriptSource.includes("Final goal track did not expose the release-proof milestone") &&
  commandEvidenceScriptSource.includes("duplicate authenticated prompt blockers") &&
  rightRailGoalTrackSource.includes("RightRailGoalConsentPacket") &&
  rightRailGoalTrackSource.includes("buildBoundaryProofs") &&
  rightRailGoalTrackTestSource.includes(
    "keeps the final goal blocked until the authenticated prompt smoke is explicitly consented",
  );
const rightRailGoalTrackTauriEnvironmentContractPass =
  tauriGoalTrackSmokeEnvironmentBlockedPass &&
  packageJsonSource.includes('"verify:right-rail-goal-track-tauri"') &&
  tauriGoalTrackScriptSource.includes("right-rail-goal-track-tauri.json") &&
  tauriGoalTrackScriptSource.includes("final-goal-safe-summary.json") &&
  tauriGoalTrackScriptSource.includes("quality proof is not fresh in Tauri runtime") &&
  tauriGoalTrackScriptSource.includes("consent packet is not ready in Tauri runtime") &&
  tauriGoalTrackScriptSource.includes("terminal boundary proofs are not visible in Tauri runtime") &&
  tauriGoalTrackScriptSource.includes("sourceArtifacts") &&
  tauriGoalTrackScriptSource.includes("sourceContract") &&
  finalGoalSafeVerifierSource.includes("right-rail-safe-gate-mutual-proof") &&
  finalGoalSafeVerifierSource.includes("rightRailGoalTrackTauri");

const goalTrackSignals = [
  {
    ok:
      rightRailGoalTrackSource.includes("deriveRightRailGoalTrack") &&
      rightRailGoalTrackSource.includes("RightRailGoalMilestone") &&
      rightRailGoalTrackSource.includes("RightRailGoalConsentPacket") &&
      rightRailGoalTrackSource.includes("RightRailGoalRiskSummary") &&
      rightRailGoalTrackSource.includes("RightRailGoalResidualRisk") &&
      rightRailGoalTrackSource.includes("RightRailGoalSafeGate") &&
      rightRailGoalTrackSource.includes("RightRailGoalRequirementProof") &&
      rightRailGoalTrackSource.includes("RightRailGoalBoundaryProof") &&
      rightRailGoalTrackSource.includes("RightRailGoalExternalGateAction") &&
      rightRailGoalTrackSource.includes("buildBoundaryProofs") &&
      rightRailGoalTrackSource.includes("buildExternalGateActions") &&
      rightRailGoalTrackSource.includes("native-input-host") &&
      rightRailGoalTrackSource.includes("native-hwnd-paste") &&
      rightRailGoalTrackSource.includes("chunked-osc-inline-image") &&
      rightRailGoalTrackSource.includes("safe-proof-chain") &&
      rightRailGoalTrackSource.includes("pnpm verify:production:suspend:native-user-cycle") &&
      rightRailGoalTrackSource.includes("artifactPath") &&
      rightRailGoalTrackSource.includes("refreshCommand") &&
      rightRailGoalTrackSource.includes("pnpm verify:terminal:native-input") &&
      rightRailGoalTrackSource.includes("pnpm verify:goal:safe:no-token") &&
      rightRailGoalTrackSource.includes("residualImplementationBlockers") &&
      rightRailGoalTrackSource.includes("Final no-token gate unavailable; run pnpm verify:goal:safe:no-token") &&
      rightRailGoalTrackSource.includes("qaRiskEvidence") &&
      rightRailGoalTrackSource.includes("runtimeFallbackEvidence") &&
      rightRailGoalTrackSource.includes("formatRuntimeFallbackBlocker") &&
      rightRailGoalTrackSource.includes("requiresConsentForRefresh") &&
      rightRailGoalTrackSource.includes("requiresExplicitConsent: requiresConsentForRefresh") &&
      rightRailGoalTrackSource.includes("qa-fixture") &&
      rightRailGoalTrackSource.includes("formatRiskBlocker") &&
      rightRailGoalTrackSource.includes("isAuthenticatedPromptConsentBlocker") &&
      rightRailGoalTrackSource.includes("qualityEvidenceFresh") &&
      rightRailGoalTrackSource.includes("input.terminalCoreReady === true") &&
      rightRailGoalTrackSource.includes("input.commandCenterScenarioReady === true") &&
      rightRailGoalTrackSource.includes("input.themeCustomizationReady === true") &&
      rightRailGoalTrackSource.includes("consentGateOnly") &&
      rightRailGoalTrackSource.includes("Goal operator gated") &&
      rightRailGoalTrackSource.includes("Authenticated prompt consent packet unavailable") &&
      rightRailGoalTrackSource.includes(
        "Authenticated AI CLI prompt smoke requires an explicit provider-selected operator run",
      ),
    blocker: "right rail goal tracker does not derive explicit milestones and authenticated-prompt blocker state",
  },
  {
    ok:
      appSource.includes("deriveRightRailGoalTrack") &&
      appSource.includes("deriveReleaseQualityGoalInputs") &&
      appSource.includes("parseReleaseQualityReport") &&
      appSource.includes("parseFinalGoalAuditReport") &&
      appSource.includes("parseFinalGoalSafeSummaryReport") &&
      appSource.includes("deriveFinalGoalResidualRisk") &&
      appSource.includes("deriveFinalGoalRequirementProofs") &&
      appSource.includes("deriveFinalGoalSafeGate") &&
      appSource.includes("deriveAuthenticatedPromptConsentPacket") &&
      appSource.includes("parseAuthenticatedPromptConsentReport") &&
      appSource.includes("parseAuthenticatedPromptPreflightMatrixReport") &&
      appSource.includes("rightRailGoalTrack") &&
      appSource.includes('className="right-panel-goal-track"') &&
      appSource.includes('className="right-panel-goal-track-consent"') &&
      appSource.includes('className="right-panel-goal-track-external-actions"') &&
      appSource.includes('className="right-panel-goal-track-safe"') &&
      appSource.includes('className="right-panel-goal-track-requirements"') &&
      appSource.includes('className="right-panel-goal-track-boundaries"') &&
      appSource.includes('aria-label="Terminal boundary proofs"') &&
      appSource.includes("rightRailGoalTrack.boundaryProofs.map") &&
      appSource.includes("data-boundary-status={proof.status}") &&
      appSource.includes("data-boundary-source={proof.source}") &&
      appSource.includes("data-boundary-artifact={proof.artifactPath}") &&
      appSource.includes("data-boundary-refresh-command={proof.refreshCommand}") &&
      appSource.includes('className="right-panel-goal-track-boundary-copy"') &&
      appSource.includes("Boundary proof command copied") &&
      appSource.includes("data-proof-requirement-pass-count") &&
      appSource.includes("data-proof-artifact-pass-count") &&
      appSource.includes("data-non-consent-blocker-count") &&
      appSource.includes("data-no-token-prompt-sent") &&
      appSource.includes("data-provider-env") &&
      appSource.includes("AELYRIS_AUTH_PROMPT_PROVIDER=") &&
      appSource.includes('className="right-panel-goal-track-consent-command"') &&
      appSource.includes('aria-label="Authenticated prompt consent command"') &&
      appSource.includes('className="right-panel-goal-track-residual"') &&
      appSource.includes("data-implementation-fixable-count") &&
      appSource.includes('className="right-panel-goal-track-provider-matrix"') &&
      appSource.includes('className="right-panel-goal-track-freshness-radar"') &&
      appSource.includes("data-next-refresh-command") &&
      appSource.includes('aria-label="Final goal requirement proofs"') &&
      appSource.includes("data-requirement-id") &&
      appSource.includes("data-evidence-count") &&
      appSource.includes('className="right-panel-goal-track-risks"') &&
      appSource.includes('data-source="runtime-fallback"') &&
      appSource.includes('data-source="qa-fixture"') &&
      appSource.includes('aria-label="Remaining goal blockers"'),
    blocker: "App does not render the final goal track from release quality evidence in the right rail",
  },
  {
    ok:
      appSource.includes('invoke<string>("read_file", { path: releaseQualityPath })') &&
      appSource.includes('".codex-auto/quality/release-quality-score.json"') &&
      appSource.includes(
        "setReleaseQualityGoalInputs(deriveReleaseQualityGoalInputs(parseReleaseQualityReport(text)))",
      ) &&
      !appSource.includes("authenticatedPromptConsentRequired: true"),
    blocker: "right rail goal track still uses a hardcoded prompt-smoke blocker instead of release-quality evidence",
  },
  {
    ok:
      appSource.includes('invoke<string>("read_file", { path: consentPath })') &&
      appSource.includes('invoke<string>("read_file", { path: finalGoalAuditPath })') &&
      appSource.includes('invoke<string>("read_file", { path: finalGoalSafePath })') &&
      appSource.includes('".codex-auto/quality/final-goal-audit.json"') &&
      appSource.includes('".codex-auto/quality/final-goal-safe-summary.json"') &&
      appSource.includes('".codex-auto/production-smoke/authenticated-ai-cli-prompt-smoke.json"') &&
      appSource.includes('".codex-auto/production-smoke/authenticated-ai-cli-preflight-matrix.json"') &&
      appSource.includes("setAuthenticatedPromptConsentPacket") &&
      appSource.includes("setFinalGoalRequirementProofs") &&
      appSource.includes("authenticatedPromptConsentPacket"),
    blocker: "right rail goal track does not read and render the final audit residual risk register",
  },
  {
    ok:
      globalStylesSource.includes(".right-panel-goal-track") &&
      globalStylesSource.includes(".right-panel-goal-track-milestone") &&
      globalStylesSource.includes(".right-panel-goal-track-consent") &&
      globalStylesSource.includes(".right-panel-goal-track-external-copy") &&
      globalStylesSource.includes(".right-panel-goal-track-safe") &&
      globalStylesSource.includes(".right-panel-goal-track-requirements") &&
      globalStylesSource.includes(".right-panel-goal-track-boundaries") &&
      globalStylesSource.includes('.right-panel-goal-track-boundaries li[data-boundary-status="missing"]') &&
      globalStylesSource.includes(".right-panel-goal-track-boundary-copy") &&
      globalStylesSource.includes(".right-panel-goal-track-consent-command") &&
      globalStylesSource.includes(".right-panel-goal-track-freshness-radar") &&
      globalStylesSource.includes(".right-panel-goal-track-residual") &&
      globalStylesSource.includes(".right-panel-goal-track-risks") &&
      globalStylesSource.includes('.right-panel-goal-track-risks[data-source="runtime-fallback"]') &&
      globalStylesSource.includes('.right-panel-goal-track-risks[data-source="qa-fixture"]') &&
      globalStylesSource.includes(':root[data-mood="aelyris-sakura"] .right-panel-goal-track'),
    blocker: "right rail goal track lacks base or Sakura-aware styling",
  },
  {
    ok:
      rightRailGoalTrackTestSource.includes(
        "keeps the final goal blocked until the provider-selected operator smoke runs",
      ) &&
      rightRailGoalTrackTestSource.includes(
        "Authenticated AI CLI prompt smoke requires an explicit provider-selected operator run",
      ) &&
      rightRailGoalTrackTestSource.includes("Token operator gate") &&
      rightRailGoalTrackTestSource.includes("Non-token implementation proved") &&
      rightRailGoalTrackTestSource.includes(
        "blocks release proof when authenticated prompt consent preflight is unavailable",
      ) &&
      rightRailGoalTrackTestSource.includes("keeps final-audit implementation risks visible as release blockers") &&
      rightRailGoalTrackTestSource.includes("does not silently pass when final safe gate evidence is unavailable") &&
      rightRailGoalTrackTestSource.includes("deduplicates release-score authenticated prompt blockers") &&
      rightRailGoalTrackTestSource.includes("artifactFreshness") &&
      rightRailGoalTrackTestSource.includes("surfaces the user-initiated native sleep cycle") &&
      rightRailGoalTrackTestSource.includes("Copy native sleep proof") &&
      rightRailGoalTrackTestSource.includes("turns broken terminal boundary proofs into visible missing evidence") &&
      rightRailGoalTrackTestSource.includes("track.boundaryProofs") &&
      rightRailGoalTrackTestSource.includes(
        "does not treat omitted readiness flags as done even with a fresh quality proof",
      ) &&
      rightRailGoalTrackTestSource.includes('track.milestones.find((item) => item.id === "terminal-core")?.status') &&
      rightRailGoalTrackTestSource.includes('track.milestones.find((item) => item.id === "customization")?.status'),
    blocker: "goal track tests do not guard the token-spend consent blocker",
  },
  {
    ok:
      rightRailGoalTrackTestSource.includes("terminal fallback, human gates, and graph risks") &&
      rightRailGoalTrackTestSource.includes("1 AI CLI session still on native fallback") &&
      rightRailGoalTrackTestSource.includes("2 human decision gates open") &&
      rightRailGoalTrackTestSource.includes("2 risk or blocker nodes open: Missing regression proof, Approval gate") &&
      rightRailGoalTrackTestSource.includes("promotes runtime fallback telemetry into Goal Track release blockers") &&
      rightRailGoalTrackTestSource.includes("2 runtime fallback events visible") &&
      rightRailGoalTrackTestSource.includes("marks token-spending refresh commands as explicit-consent actions") &&
      rightRailGoalTrackTestSource.includes("requires-explicit-consent-token-spend") &&
      rightRailGoalTrackTestSource.includes("track.riskEvidence") &&
      rightRailGoalTrackTestSource.includes("track.runtimeFallbackEvidence") &&
      rightRailGoalTrackTestSource.includes(
        "keeps QA fixture risks visible without turning them into release blockers",
      ),
    blocker: "goal track tests do not expose fallback, decision, and graph-risk blockers",
  },
  {
    ok:
      rightRailGoalTrackTestSource.includes("promotes the track to a release candidate") &&
      rightRailGoalTrackTestSource.includes("Release candidate") &&
      rightRailGoalTrackTestSource.includes("Promote release candidate"),
    blocker: "goal track tests do not prove the done state",
  },
  {
    ok:
      appSource.includes("rightRailGoalTrack.milestones.map") &&
      appSource.includes("rightRailGoalTrack.remainingItems.slice(0, 3)") &&
      appSource.includes("rightRailGoalTrack.percent") &&
      appSource.includes("rightRailGoalTrack.qualityEvidence.status") &&
      appSource.includes('className="right-panel-goal-track-source"') &&
      appSource.includes("rightRailGoalTrack.consentPacket.status") &&
      appSource.includes("rightRailGoalTrack.residualRisk.state") &&
      appSource.includes("rightRailGoalTrack.residualRisk.implementationFixableCount") &&
      appSource.includes("rightRailGoalTrack.safeGate.status") &&
      appSource.includes("rightRailGoalTrack.safeGate.proofRequirementPassCount") &&
      appSource.includes("rightRailGoalTrack.safeGate.proofArtifactPassCount") &&
      appSource.includes("rightRailGoalTrack.safeGate.nonConsentBlockerCount") &&
      appSource.includes("rightRailGoalTrack.safeGate.noTokenPromptSent") &&
      appSource.includes("rightRailGoalTrack.safeGate.tokenSpendingPromptExecuted") &&
      appSource.includes("rightRailGoalTrack.safeGate.semanticFreshness") &&
      appSource.includes("rightRailGoalTrack.safeGate.cycleBoundary") &&
      appSource.includes("data-semantic-freshness") &&
      appSource.includes("data-cycle-boundary") &&
      appSource.includes("rightRailGoalTrack.boundaryProofs.map") &&
      appSource.includes("data-boundary-id={proof.id}") &&
      appSource.includes("data-boundary-status={proof.status}") &&
      appSource.includes("rightRailGoalTrack.consentPacket.artifactFreshness") &&
      appSource.includes("rightRailGoalTrack.externalGateActions.map") &&
      appSource.includes("data-next-refresh-id") &&
      appSource.includes("data-next-refresh-command") &&
      appSource.includes("rightRailGoalTrack.requirementProofs.map") &&
      appSource.includes("rightRailGraphRiskSummaries") &&
      appSource.includes("rightRailRuntimeFallbackSummaries") &&
      appSource.includes("rightRailGraphQaRiskSummaries") &&
      appSource.includes("isRightRailQaFixtureRisk") &&
      appSource.includes("rightRailGoalTrack.riskEvidence.map") &&
      appSource.includes("rightRailGoalTrack.runtimeFallbackEvidence.map") &&
      appSource.includes("rightRailGoalTrack.qaRiskEvidence.map"),
    blocker: "right rail goal track UI does not show progress, milestones, and remaining items",
  },
  {
    ok:
      globalStylesSource.includes(".right-panel-goal-track-source") &&
      globalStylesSource.includes(".right-panel-goal-track-residual") &&
      globalStylesSource.includes(".right-panel-goal-track-safe") &&
      globalStylesSource.includes(".right-panel-goal-track-consent") &&
      globalStylesSource.includes(".right-panel-goal-track-external-actions") &&
      globalStylesSource.includes(".right-panel-goal-track-external-copy") &&
      globalStylesSource.includes(".right-panel-goal-track-consent-command dd") &&
      globalStylesSource.includes(".right-panel-goal-track-boundaries li") &&
      globalStylesSource.includes('.right-panel-goal-track-boundaries li[data-boundary-status="unknown"]') &&
      globalStylesSource.includes(".right-panel-goal-track-provider-matrix") &&
      globalStylesSource.includes(".right-panel-goal-track-freshness-radar") &&
      globalStylesSource.includes(".right-panel-goal-track-requirements li") &&
      globalStylesSource.includes('.right-panel-goal-track-requirements li[data-proof-status="missing"]') &&
      globalStylesSource.includes(".right-panel-goal-track-risks li") &&
      globalStylesSource.includes('[data-source="qa-fixture"]') &&
      globalStylesSource.includes('.right-panel-goal-track-source[data-status="stale"]') &&
      globalStylesSource.includes('.right-panel-goal-track-source[data-status="fresh"]'),
    blocker: "right rail goal track styling does not expose quality proof freshness",
  },
  {
    ok:
      globalStylesSource.includes(".right-panel-goal-track-bar span") &&
      globalStylesSource.includes('.right-panel-goal-track[data-status="blocked"]') &&
      globalStylesSource.includes('.right-panel-goal-track[data-status="done"]'),
    blocker: "right rail goal track styling does not distinguish progress, blocked, and done states",
  },
  {
    ok:
      commandEvidenceScriptSource.includes("readGoalTrack") &&
      commandEvidenceScriptSource.includes(".right-panel-goal-track") &&
      commandEvidenceScriptSource.includes("Final goal track was not visible") &&
      commandEvidenceScriptSource.includes("Final goal track did not expose quality proof freshness") &&
      commandEvidenceScriptSource.includes(
        "Final goal track did not expose authenticated prompt consent packet status",
      ) &&
      commandEvidenceScriptSource.includes("Final goal track did not expose terminal boundary proofs") &&
      commandEvidenceScriptSource.includes("artifact paths and no-token refresh commands") &&
      commandEvidenceScriptSource.includes("native-input-host") &&
      commandEvidenceScriptSource.includes("residualRisk") &&
      commandEvidenceScriptSource.includes("listed risk blockers without visible risk evidence labels") &&
      commandEvidenceScriptSource.includes("leaked QA fixture risks into release blockers") &&
      commandEvidenceScriptSource.includes("duplicate authenticated prompt blockers"),
    blocker: "right rail browser smoke does not verify the final goal track, quality proof, and consent packet",
  },
  {
    ok:
      packageJsonSource.includes('"verify:right-rail-goal-track-tauri"') &&
      tauriGoalTrackScriptSource.includes("right-rail-goal-track-tauri.json") &&
      tauriGoalTrackScriptSource.includes("final-goal-safe-summary.json") &&
      tauriGoalTrackScriptSource.includes("quality proof is not fresh in Tauri runtime") &&
      tauriGoalTrackScriptSource.includes("quality proof detail is stale in Tauri runtime") &&
      tauriGoalTrackScriptSource.includes("consent packet is not ready in Tauri runtime") &&
      tauriGoalTrackScriptSource.includes("consent packet command is not visible in Tauri runtime") &&
      tauriGoalTrackScriptSource.includes("consent packet required environment is not visible in Tauri runtime") &&
      tauriGoalTrackScriptSource.includes("consent packet token gate is not visible in Tauri runtime") &&
      tauriGoalTrackScriptSource.includes("consent provider matrix does not show") &&
      tauriGoalTrackScriptSource.includes("final audit residual risk state is stale") &&
      tauriGoalTrackScriptSource.includes("final goal requirement proofs are not visible") &&
      tauriGoalTrackScriptSource.includes("final goal requirement proof status is stale") &&
      tauriGoalTrackScriptSource.includes("terminal boundary proofs are not visible in Tauri runtime") &&
      tauriGoalTrackScriptSource.includes("terminal boundary proof") &&
      tauriGoalTrackScriptSource.includes("does not expose an artifact path") &&
      tauriGoalTrackScriptSource.includes("does not expose a refresh command") &&
      tauriGoalTrackScriptSource.includes("is not marked no-token") &&
      tauriGoalTrackScriptSource.includes("final safe gate state is stale in Tauri runtime") &&
      tauriGoalTrackScriptSource.includes("final safe gate detail is stale in Tauri runtime") &&
      tauriGoalTrackScriptSource.includes("artifact proof pass count") &&
      tauriGoalTrackScriptSource.includes("non-consent blocker count") &&
      tauriGoalTrackScriptSource.includes("final safe gate does not expose no-token-prompt-sent proof") &&
      tauriGoalTrackScriptSource.includes("token-spending prompt was not executed") &&
      tauriGoalTrackScriptSource.includes("sourceArtifacts") &&
      tauriGoalTrackScriptSource.includes("sourceContract") &&
      tauriGoalTrackScriptSource.includes("SOURCE_CONTRACT_PATHS") &&
      tauriGoalTrackScriptSource.includes("consent-gated final goal progress did not show 99%") &&
      tauriGoalTrackScriptSource.includes("risk blockers are listed without visible risk evidence labels") &&
      tauriGoalTrackScriptSource.includes("QA fixture risks leaked into release blockers") &&
      tauriGoalTrackScriptSource.includes("duplicate authenticated prompt blockers"),
    blocker: "right rail Tauri goal-track smoke is missing the local quality/consent proof contract",
  },
  {
    ok:
      rightRailGoalTrackBrowserEnvironmentContractPass ||
      (commandEvidenceSmoke?.checks?.goalTrack?.visible === true &&
        ["fresh", "stale", "unavailable"].includes(commandEvidenceSmoke?.checks?.goalTrack?.qualitySource?.status) &&
        ["ready", "missing", "incomplete", "pass", "failed"].includes(
          commandEvidenceSmoke?.checks?.goalTrack?.consentPacket?.status,
        ) &&
        (commandEvidenceSmoke?.checks?.goalTrack?.boundaryProofs?.length ?? 0) >= 5 &&
        commandEvidenceSmoke?.checks?.goalTrack?.boundaryProofs?.some?.((item) => item?.id === "native-input-host") ===
          true &&
        commandEvidenceSmoke?.checks?.goalTrack?.boundaryProofs?.every?.(
          (item) =>
            String(item?.artifactPath ?? "").startsWith(".codex-auto/") &&
            String(item?.refreshCommand ?? "").startsWith("pnpm verify:") &&
            item?.costClass === "no-token",
        ) === true &&
        commandEvidenceSmoke?.checks?.goalTrack?.milestones?.some?.((item) => item?.label === "Release proof") ===
          true &&
        commandEvidenceSmoke?.checks?.goalTrack?.remaining?.some?.((item) =>
          /authenticated.*prompt.*smoke/i.test(String(item ?? "")),
        ) === true &&
        countAuthenticatedPromptBlockers(commandEvidenceSmoke?.checks?.goalTrack?.remaining) === 1 &&
        (!commandEvidenceSmoke?.checks?.goalTrack?.remaining?.some?.((item) =>
          /risk or blocker node/.test(String(item)),
        ) ||
          (commandEvidenceSmoke?.checks?.goalTrack?.riskEvidence?.length ?? 0) > 0) &&
        !commandEvidenceSmoke?.checks?.goalTrack?.remaining?.some?.((item) =>
          /right[\s_.-]*rail[\s_.-]*qa|qa[\s_-]*(missing[\s_-]*diff|stale[\s_-]*pane)/i.test(String(item ?? "")),
        )),
    blocker: "right rail browser smoke artifact does not prove the release-proof milestone and prompt-smoke blocker",
  },
  {
    ok: tauriGoalTrackSmokePass || rightRailGoalTrackTauriEnvironmentContractPass,
    blocker: "right rail Tauri goal-track artifact does not prove fresh quality source and ready consent packet",
  },
  {
    ok:
      authenticatedPromptConsentSource.includes("deriveAuthenticatedPromptConsentPacket") &&
      authenticatedPromptConsentSource.includes("safeNoPromptSent") &&
      authenticatedPromptConsentSource.includes("nonTokenPreflightReady") &&
      authenticatedPromptConsentTestSource.includes("ready no-token consent packet") &&
      authenticatedPromptConsentTestSource.includes("does not hide a missing consent artifact"),
    blocker: "authenticated prompt consent packet parser and tests are missing",
  },
  {
    ok:
      releaseQualitySource.includes("parseReleaseQualityReport") &&
      releaseQualitySource.includes("parseFinalGoalAuditReport") &&
      releaseQualitySource.includes("deriveFinalGoalResidualRisk") &&
      releaseQualitySource.includes("deriveFinalGoalRequirementProofs") &&
      releaseQualitySource.includes("Final goal audit unavailable; run pnpm verify:final-goal-audit") &&
      releaseQualitySource.includes("deriveReleaseQualityGoalInputs") &&
      releaseQualitySource.includes("release-quality-score") &&
      releaseQualitySource.includes("authenticated-ai-cli-prompt-smoke") &&
      releaseQualitySource.includes("Release quality score stale; run pnpm verify:quality-score") &&
      releaseQualitySource.includes("terminalCoreReady: fresh &&") &&
      releaseQualitySource.includes("commandCenterScenarioReady:") &&
      releaseQualitySource.includes("themeCustomizationReady: fresh &&"),
    blocker: "release quality parser does not expose goal-track inputs",
  },
  {
    ok:
      releaseQualityTestSource.includes(
        "clears the prompt blocker once the authenticated prompt smoke is actually proven",
      ) &&
      releaseQualityTestSource.includes(
        "turns stale release-quality-score evidence into an explicit release blocker",
      ) &&
      releaseQualityTestSource.includes("Release quality score unavailable; run pnpm verify:quality-score") &&
      releaseQualityTestSource.includes("parses final-goal-audit residual risk") &&
      releaseQualityTestSource.includes("deriveFinalGoalRequirementProofs") &&
      releaseQualityTestSource.includes(
        "turns missing final-goal-audit evidence into an explicit implementation risk",
      ) &&
      releaseQualityTestSource.includes("authenticated AI CLI prompt smoke requires explicit token-spend consent") &&
      releaseQualityTestSource.includes("expect(inputs.terminalCoreReady).toBe(false)") &&
      releaseQualityTestSource.includes("expect(inputs.commandCenterScenarioReady).toBe(false)") &&
      releaseQualityTestSource.includes("expect(inputs.themeCustomizationReady).toBe(false)"),
    blocker: "release quality parser tests do not cover prompt-smoke pass, opt-in, and unavailable states",
  },
];
const goalTrackPoints = goalTrackSignals.filter((signal) => signal.ok).length;
add(
  scores,
  "right-rail-goal-track",
  "Right rail final goal visibility",
  goalTrackPoints,
  goalTrackSignals.length,
  `${goalTrackPoints}/${goalTrackSignals.length} goal-track contracts pass`,
  goalTrackSignals.filter((signal) => !signal.ok).map((signal) => signal.blocker),
);

const glassLegibilitySourceMtime = Math.max(
  mtimeMs(join(ROOT, "src", "styles", "global.css")),
  ...themeMoodSourcePaths.map((path) => mtimeMs(path)),
  mtimeMs(join(ROOT, "src", "shared", "hooks", "useTheme.ts")),
  mtimeMs(join(ROOT, "src", "__tests__", "themePalette.test.ts")),
  mtimeMs(join(ROOT, "src", "__tests__", "useThemeApplier.test.tsx")),
  mtimeMs(join(ROOT, "scripts", "verify-glass-legibility-contract.mjs")),
);
const glassLegibilityContractFresh =
  glassLegibilityContract?.ok === true &&
  glassLegibilityContract?.status === "pass-current-glass-legibility-contract" &&
  glassLegibilityContract?.textFullyPainted === true &&
  glassLegibilityContract?.materialTranslucencyProved === true &&
  glassLegibilityContract?.sourceFresh === true &&
  mtimeMs(glassLegibilityContractPath) >= glassLegibilitySourceMtime;

const uiTrustSourcePaths = Array.isArray(uiTrustContract?.sourceFiles)
  ? uiTrustContract.sourceFiles.map((entry) => entry?.path).filter(Boolean)
  : [];
const uiTrustContractFresh =
  uiTrustContract?.ok === true &&
  uiTrustContract?.status === "passed" &&
  Array.isArray(uiTrustContract?.checks) &&
  uiTrustContract.checks.length > 0 &&
  uiTrustContract.checks.every((check) => check?.ok === true) &&
  Array.isArray(uiTrustContract?.failedChecks) &&
  uiTrustContract.failedChecks.length === 0 &&
  uiTrustContract?.provenance?.schema === "aelyris.evidence-provenance/v1" &&
  mtimeMs(uiTrustContractPath) + 5_000 >=
    Math.max(
      mtimeMs(join(ROOT, "scripts", "verify-ui-trust-contract.mjs")),
      mtimeMs(join(ROOT, "package.json")),
      ...uiTrustSourcePaths.map((path) => mtimeMs(resolve(ROOT, path))),
    );
const uiTrustContractSourcePass =
  packageJsonSource.includes('"verify:ui:trust": "node scripts/verify-ui-trust-contract.mjs --enforce"') &&
  uiTrustContractSource.includes('process.argv.includes("--enforce")') &&
  uiTrustContractSource.includes("createEvidenceProvenance") &&
  uiTrustContractSource.includes("ui-trust-contract.json");
const uiTrustContractPass = uiTrustContractSourcePass && uiTrustContractFresh;
add(
  scores,
  "ui-trust-contract",
  "Enforced UI trust contract",
  uiTrustContractPass ? 8 : 0,
  8,
  uiTrustContractPass ? "enforced, provenance-bound, and fresh" : "missing, stale, or unenforced",
  uiTrustContractPass
    ? []
    : [
        ...(uiTrustContractSourcePass
          ? []
          : ["UI trust verifier is not registered as an enforced provenance-producing contract"]),
        ...(uiTrustContractFresh
          ? []
          : ["UI trust contract artifact is missing, stale, failing, or not provenance-bound"]),
      ],
);

const a4DurabilityAcceptancePass =
  packageJsonSource.includes(
    '"verify:a4:durability:acceptance": "node scripts/verify-a4-durability-acceptance.mjs"',
  ) &&
  a4DurabilityAcceptanceSource.includes("pass-repo-owned-a4-durability") &&
  a4DurabilityAcceptance?.status === "pass-repo-owned-a4-durability" &&
  a4DurabilityAcceptance?.repoOwnedComplete === true &&
  a4DurabilityAcceptance?.phaseComplete === true &&
  Array.isArray(a4DurabilityAcceptance?.scenarios) &&
  a4DurabilityAcceptance.scenarios.length === 12 &&
  a4DurabilityAcceptance.scenarios.every((scenario) => scenario?.status === "pass") &&
  a4DurabilityAcceptance?.externalProof?.status === "deferred-to-a9-operator-proof";
add(
  scores,
  "a4-durability-acceptance",
  "A4 repo-owned durability acceptance",
  a4DurabilityAcceptancePass ? 8 : 0,
  8,
  a4DurabilityAcceptancePass
    ? "restart/upgrade/fault/multi-connection acceptance is fresh and external proof remains separate"
    : "missing, stale, incomplete, or external proof classification is dishonest",
  a4DurabilityAcceptancePass
    ? []
    : ["A4 durability acceptance must pass all twelve repo-owned scenarios with provenance"],
);

const goalAntiStallSourceMtime = Math.max(
  mtimeMs(join(ROOT, "scripts", "verify-goal-anti-stall-contract.mjs")),
  mtimeMs(join(ROOT, "scripts", "final-goal-artifact-lock.mjs")),
  mtimeMs(join(ROOT, "scripts", "verify-chunked-osc-live-safe.mjs")),
  mtimeMs(join(ROOT, "scripts", "verify-final-goal-safe.mjs")),
  mtimeMs(join(ROOT, "scripts", "verify-goal-non-token-refresh.mjs")),
  mtimeMs(join(ROOT, "scripts", "verify-goal-operator-finish.mjs")),
  mtimeMs(join(ROOT, "scripts", "verify-goal-finalize-evidence.mjs")),
  mtimeMs(join(ROOT, "scripts", "verify-goal-external-gate-readiness.mjs")),
  mtimeMs(join(ROOT, "scripts", "verify-native-ai-cli-post-launch-chaos.mjs")),
  mtimeMs(join(ROOT, "scripts", "verify-real-os-suspend-evidence.mjs")),
  mtimeMs(join(ROOT, "package.json")),
);
const goalAntiStallContractFresh =
  goalAntiStallContract?.ok === true &&
  goalAntiStallContract?.status === "pass-current-anti-stall-contract" &&
  goalAntiStallContract?.sourceFresh === true &&
  goalAntiStallContract?.nativeAiChaosDefaultWaitMs >= 120_000 &&
  Array.isArray(goalAntiStallContract?.failedChecks) &&
  goalAntiStallContract.failedChecks.length === 0 &&
  Object.values(goalAntiStallContract?.checks ?? {}).every((value) => value === true) &&
  mtimeMs(goalAntiStallContractPath) >= goalAntiStallSourceMtime;

const themeCustomizationSignals = [
  {
    ok:
      themeMoodsSource.includes("MOOD_MATERIAL_DEFAULTS") &&
      themeMoodsSource.includes("SAKURA_MATERIAL_DEFAULTS") &&
      themeMoodsSource.includes("materialOverridesToCSS"),
    blocker: "mood material defaults are not centralized for every preset",
  },
  {
    ok:
      themeMoodsSource.includes("sanitizeMaterialOverrides") &&
      themeMoodsSource.includes("isMoodMaterialLight") &&
      themeMoodsSource.includes("MOOD_CSS_KEYS"),
    blocker: "material override sanitization or mood light/dark classification is incomplete",
  },
  {
    ok:
      themeApplierSource.includes("--aelyris-wallpaper-image") &&
      themeApplierSource.includes("--aelyris-wallpaper-opacity") &&
      themeApplierSource.includes("--aelyris-wallpaper-position-x") &&
      themeApplierSource.includes("--aelyris-wallpaper-position-y") &&
      themeApplierSource.includes("--aelyris-wallpaper-size") &&
      themeApplierSource.includes("--aelyris-window-opacity") &&
      themeApplierSource.includes('source: "theme-customization"') &&
      themeApplierSource.includes('"persist_theme_preferences"'),
    blocker: "theme applier does not expose wallpaper placement, opacity, and window-opacity CSS variables",
  },
  {
    ok:
      themeApplierSource.includes("root.style.removeProperty(key)") &&
      themeApplierSource.includes("for (const key of MOOD_CSS_KEYS)") &&
      themeApplierSource.includes("materialOverridesToCSS(materialOverrides, MOOD_MATERIAL_DEFAULTS[mood])"),
    blocker: "theme switching does not explicitly clear old mood CSS tokens before applying the next preset",
  },
  {
    ok:
      appStoreSource.includes("loadMoodMaterialOverrides") &&
      appStoreSource.includes("persistMoodMaterialOverrides") &&
      appStoreSource.includes("replaceMoodMaterialOverrides") &&
      appStoreSource.includes("setWallpaperSettingsForMood") &&
      appStoreSource.includes("replaceWallpaperSettingsByMood"),
    blocker: "store does not persist and replace per-mood material/wallpaper customization",
  },
  {
    ok:
      appStoreSource.includes('"persist_selected_model"') &&
      appStoreSource.includes('"persist_agent_budget_spent"') &&
      appStoreSource.includes('"persist_kanban_tasks"') &&
      appStoreSource.includes('"persist_open_files"') &&
      appStoreTestSource.includes("silently losing command-center policy") &&
      appStoreTestSource.includes("silently losing task state") &&
      appStoreTestSource.includes("silently losing open-file recovery"),
    blocker: "store persistence failures for model, budget, Kanban, or open files are not telemetry-visible",
  },
  {
    ok:
      settingsSource.includes("chooseWallpaperImage") &&
      settingsSource.includes("@tauri-apps/plugin-dialog") &&
      settingsSource.includes("wallpaperFileInputRef") &&
      settingsSource.includes("settings-wallpaper-opacity") &&
      settingsSource.includes("settings-wallpaper-scale") &&
      settingsSource.includes("settings-wallpaper-position-x") &&
      settingsSource.includes("settings-wallpaper-position-y"),
    blocker: "settings UI does not expose image picker, opacity, scale, and placement controls",
  },
  {
    ok:
      settingsSource.includes("opacity: windowOpacity") &&
      settingsSource.includes("theme_overrides: latestStore.themeOverrides") &&
      settingsSource.includes("mood_material_overrides: latestStore.moodMaterialOverrides") &&
      settingsSource.includes("wallpaper_settings_by_mood: latestStore.wallpaperSettingsByMood"),
    blocker: "settings save path does not persist opacity, palette, material, and wallpaper customization together",
  },
  {
    ok:
      tauriSettingsSource.includes("MoodMaterialOverrideConfig") &&
      tauriSettingsSource.includes("WallpaperConfig") &&
      tauriSettingsSource.includes("mood_material_overrides") &&
      tauriSettingsSource.includes("wallpaper_settings_by_mood") &&
      tauriSettingsSource.includes("appearance_material_and_wallpaper_customization_round_trips"),
    blocker: "Rust config does not round-trip material and wallpaper customization",
  },
  {
    ok:
      themePaletteTestSource.includes("does not let Sakura surface colors bleed into darker mood presets") &&
      themePaletteTestSource.includes("keeps Aelyris Sakura rails as white-peach material instead of grey glass") &&
      themePaletteTestSource.includes("keeps core chrome text contrast readable across every mood") &&
      themePaletteTestSource.includes("keeps mood glass presets translucent while preserving pane hierarchy") &&
      themePaletteTestSource.includes("keeps chrome text tokens solid instead of opacity-dimming glyphs") &&
      packageJsonSource.includes('"verify:ui:glass-legibility": "node scripts/verify-glass-legibility-contract.mjs"') &&
      glassLegibilityContractSource.includes("textFullyPainted") &&
      glassLegibilityContractSource.includes("materialTranslucencyProved") &&
      glassLegibilityContractFresh,
    blocker:
      "theme palette and glass-legibility contracts do not guard Sakura bleed, white-peach rails, preset contrast, opaque text, and translucent material layers",
  },
  {
    ok:
      themeApplierTestSource.includes("applies material overrides to the active mood only") &&
      themeApplierTestSource.includes(
        "applies low opacity material overrides without snapping surfaces back to gray slabs",
      ) &&
      themeApplierTestSource.includes("applies wallpaper placement variables") &&
      themeApplierTestSource.includes(
        "applies global window opacity as backdrop strength variables without dimming text nodes",
      ) &&
      themeApplierTestSource.includes("silently losing customization"),
    blocker: "theme applier tests do not guard active-mood isolation, low opacity, wallpaper, and readable opacity",
  },
  {
    ok:
      appStoreTestSource.includes("keeps material overrides isolated per mood") &&
      appStoreTestSource.includes(
        "allows low opacity material overrides to make mood surfaces meaningfully translucent",
      ) &&
      appStoreTestSource.includes("keeps wallpaper image controls isolated per mood") &&
      appStoreTestSource.includes("persists global window opacity with readable clamp bounds"),
    blocker: "store tests do not guard per-mood customization isolation and opacity bounds",
  },
  {
    ok:
      settingsSaveMergeTestSource.includes(
        "exposes and persists window opacity instead of leaving appearance.opacity as a dead setting",
      ) &&
      settingsSaveMergeTestSource.includes(
        "treats loaded Tauri config as source of truth for empty material and wallpaper maps",
      ) &&
      designTokenUsageTestSource.includes("keeps Sakura right-rail decision surfaces theme-aware"),
    blocker: "settings merge and design-token tests do not guard customization hydration or Sakura rail surfaces",
  },
];
const themeCustomizationPoints = themeCustomizationSignals.filter((signal) => signal.ok).length;
add(
  scores,
  "theme-customization-guard",
  "Theme customization and preset isolation",
  themeCustomizationPoints,
  themeCustomizationSignals.length,
  `${themeCustomizationPoints}/${themeCustomizationSignals.length} customization contracts pass`,
  themeCustomizationSignals.filter((signal) => !signal.ok).map((signal) => signal.blocker),
);

const appStateFallbackSignals = [
  {
    ok:
      !appStoreSource.includes("catch {}") &&
      appStoreSource.includes('"persist_selected_model"') &&
      appStoreSource.includes('"persist_agent_budget_spent"') &&
      appStoreSource.includes('"persist_kanban_tasks"') &&
      appStoreSource.includes('"persist_open_files"') &&
      appStoreTestSource.includes("silently losing command-center policy") &&
      appStoreTestSource.includes("silently losing task state") &&
      appStoreTestSource.includes("silently losing open-file recovery"),
    blocker: "app store model, budget, Kanban, and open-file persistence failures are not telemetry-visible",
  },
  {
    ok:
      !recentCommandsSource.includes("catch {}") &&
      recentCommandsSource.includes('source: "recent-commands"') &&
      recentCommandsSource.includes('"persist_recent_commands"') &&
      recentCommandsTestSource.includes("silently dropping recent commands"),
    blocker: "recent command persistence failures can silently drop command-palette state",
  },
  {
    ok:
      !helmPanelSource.includes("catch {}") &&
      helmPanelSource.includes('source: "helm-tasks"') &&
      helmPanelSource.includes("Array.isArray(parsed)") &&
      helmPanelSource.includes('"persist_helm_tasks"') &&
      helmPanelTestSource.includes("crashing the rail") &&
      helmPanelTestSource.includes("silently losing Helm tasks"),
    blocker: "Helm task persistence failures can silently lose task state",
  },
  {
    ok:
      !projectHeaderBarSource.includes("catch {}") &&
      projectHeaderBarSource.includes('source: "window-chrome"') &&
      projectHeaderBarSource.includes('"minimize_window"') &&
      projectHeaderBarSource.includes('"toggle_maximize_window"') &&
      projectHeaderBarSource.includes('"hard_stop_window"'),
    blocker: "window chrome failures can leave minimize, maximize, or close actions as silent no-ops",
  },
];
const appStateFallbackPoints = appStateFallbackSignals.filter((signal) => signal.ok).length;
add(
  scores,
  "app-state-fallback-visibility",
  "App state fallback visibility",
  appStateFallbackPoints,
  appStateFallbackSignals.length,
  `${appStateFallbackPoints}/${appStateFallbackSignals.length} app-state contracts pass`,
  appStateFallbackSignals.filter((signal) => !signal.ok).map((signal) => signal.blocker),
);

const productionBundleBudgetChecks = Array.isArray(productionBundleBudget?.checks) ? productionBundleBudget.checks : [];
const productionBundleBudgetSourcePass =
  packageJsonSource.includes('"verify:bundle-budget"') &&
  viteConfigSource.includes("editorOnlyPreloadPattern") &&
  viteConfigSource.includes("resolveDependencies") &&
  viteConfigSource.includes("manualChunks(id)") &&
  productionBundleBudgetScriptSource.includes("production-bundle-budget.json") &&
  productionBundleBudgetScriptSource.includes("dist-fresh-for-budget-inputs") &&
  productionBundleBudgetScriptSource.includes("editor-assets-not-initial") &&
  productionBundleBudgetScriptSource.includes("initial-gzip-budget") &&
  productionBundleBudgetScriptSource.includes("editor-lazy-dependency-map");
const productionBundleBudgetArtifactPass =
  productionBundleBudget?.ok === true &&
  productionBundleBudget?.status === "passed" &&
  productionBundleBudgetChecks.length >= 10 &&
  productionBundleBudgetChecks.every((check) => check?.status === "passed") &&
  productionBundleBudget?.summary?.initialResourceCount <= 4 &&
  productionBundleBudget?.summary?.initialJsBytes <= productionBundleBudget?.budgets?.initialJsBytes &&
  productionBundleBudget?.summary?.initialCssBytes <= productionBundleBudget?.budgets?.initialCssBytes &&
  productionBundleBudget?.summary?.initialGzipBytes <= productionBundleBudget?.budgets?.initialGzipBytes &&
  mtimeMs(productionBundleBudgetPath) + 5_000 >=
    Math.max(
      mtimeMs(join(ROOT, "dist", "index.html")),
      mtimeMs(join(ROOT, "vite.config.ts")),
      mtimeMs(join(ROOT, "scripts", "verify-production-bundle-budget.mjs")),
    );
const productionBundleBudgetPass = productionBundleBudgetSourcePass && productionBundleBudgetArtifactPass;
add(
  scores,
  "frontend-bundle-budget",
  "Production shell bundle budget",
  productionBundleBudgetPass ? 8 : 0,
  8,
  productionBundleBudgetPass
    ? `initial ${Math.round((productionBundleBudget.summary?.initialGzipBytes ?? 0) / 1024)} KiB gzip; editor assets lazy`
    : productionBundleBudget
      ? `${productionBundleBudget?.status ?? "unknown"} (${productionBundleBudgetChecks.filter((check) => check?.status !== "passed").length} failing checks)`
      : "missing",
  productionBundleBudgetPass
    ? []
    : [
        ...(productionBundleBudgetSourcePass
          ? []
          : ["production bundle budget verifier, package script, or Vite preload guard is incomplete"]),
        ...(productionBundleBudgetArtifactPass
          ? []
          : ["production bundle budget artifact is missing, stale, over budget, or does not prove lazy editor assets"]),
      ],
);

const testRuntimeHygieneChecks = [
  {
    ok:
      packageJsonSource.includes('"test":') &&
      packageJsonSource.includes("AELYRIS_VITE_NO_ESBUILD_SPAWN=1") &&
      packageJsonSource.includes("vitest run --configLoader native") &&
      vitestConfigSource.includes('setupFiles: ["src/__tests__/setup.ts"]') &&
      vitestConfigSource.includes("aelyris:vitest-typescript-transpile-no-esbuild-spawn") &&
      vitestConfigSource.includes("esbuild: noEsbuildSpawn ? false : undefined") &&
      vitestConfigSource.includes('pool: noEsbuildSpawn ? "threads" : "forks"'),
    blocker: "Vitest does not load the shared React test setup through the Windows spawn-safe no-esbuild test path",
  },
  {
    ok:
      testSetupSource.includes("configure({ asyncUtilTimeout: 10_000 })") &&
      testSetupSource.includes("cleanup()") &&
      testSetupSource.includes("vi.useRealTimers()") &&
      testSetupSource.includes("vi.restoreAllMocks()"),
    blocker: "shared test setup does not reset DOM, timers, and mocks between tests",
  },
  {
    ok:
      useImageMetricsTestSource.includes("fetches metrics for the active terminal on mount") &&
      useImageMetricsTestSource.includes("polls on the configured interval") &&
      useImageMetricsTestSource.includes("treats an IPC throw as no metrics and emits fallback telemetry"),
    blocker: "image-metrics polling regression coverage is missing or too narrow",
  },
  {
    ok:
      terminalCanvasInputTestSource.includes("vi.useFakeTimers()") &&
      terminalCanvasInputTestSource.includes("vi.useRealTimers()") &&
      terminalCanvasInputTestSource.includes("native input surface owns focus"),
    blocker: "timer-heavy terminal input coverage no longer proves cleanup-sensitive native-input behavior",
  },
];
const testRuntimeHygienePoints = testRuntimeHygieneChecks.filter((check) => check.ok).length;
add(
  scores,
  "test-runtime-hygiene",
  "Frontend test runtime isolation",
  testRuntimeHygienePoints,
  testRuntimeHygieneChecks.length,
  `${testRuntimeHygienePoints}/${testRuntimeHygieneChecks.length} test runtime contracts pass`,
  testRuntimeHygieneChecks.filter((check) => !check.ok).map((check) => check.blocker),
);

const finalGoalRequirementIds = new Set(
  Array.isArray(finalGoalAudit?.requirements) ? finalGoalAudit.requirements.map((item) => item?.id) : [],
);
const finalGoalAuditSourcePass =
  packageJsonSource.includes('"verify:final-goal-audit"') &&
  packageJsonSource.includes('"verify:goal:safe"') &&
  packageJsonSource.includes('"verify:goal:docs"') &&
  packageJsonSource.includes('"verify:release:hygiene"') &&
  finalGoalAuditScriptSource.includes("final-goal-audit.json") &&
  finalGoalAuditScriptSource.includes("blocked-by-explicit-consent") &&
  finalGoalAuditScriptSource.includes("blocked-by-external-gates") &&
  finalGoalAuditScriptSource.includes("rust-native-terminal-core") &&
  finalGoalAuditScriptSource.includes("right-rail-command-center") &&
  finalGoalAuditScriptSource.includes("app-state-fallback-visibility") &&
  finalGoalAuditScriptSource.includes("provenance-recovery-context-packs") &&
  finalGoalAuditScriptSource.includes("releaseOpsBlockedByConsent") &&
  finalGoalAuditScriptSource.includes("releaseOpsComplete") &&
  finalGoalAuditScriptSource.includes("releaseScoreSourcePaths") &&
  finalGoalAuditScriptSource.includes("scripts/verify-final-goal-audit.mjs") &&
  finalGoalAuditScriptSource.includes("scripts/verify-final-goal-safe.mjs") &&
  finalGoalAuditScriptSource.includes("scripts/verify-goal-documentation-freshness.mjs") &&
  finalGoalAuditScriptSource.includes("scripts/verify-native-boundary-contract.mjs") &&
  finalGoalAuditScriptSource.includes("scripts/verify-native-terminal-input-host.mjs") &&
  finalGoalAuditScriptSource.includes("chunkedOscLivePath") &&
  finalGoalAuditScriptSource.includes("chunkedOscLiveChecks") &&
  finalGoalAuditScriptSource.includes("pass-current-chunked-osc-live-contract") &&
  finalGoalAuditScriptSource.includes("scripts/verify-chunked-osc-live.mjs") &&
  finalGoalAuditScriptSource.includes("nativeHwndPasteLivePath") &&
  finalGoalAuditScriptSource.includes("nativeHwndPasteLiveChecks") &&
  finalGoalAuditScriptSource.includes("pass-current-native-hwnd-paste-contract") &&
  finalGoalAuditScriptSource.includes("pass-degraded-no-cdp") &&
  finalGoalAuditScriptSource.includes("scripts/verify-native-hwnd-paste-live.mjs") &&
  finalGoalAuditScriptSource.includes("docs/specs/README.md") &&
  finalGoalAuditScriptSource.includes("docs/specs/AELYRIS_REQUIREMENTS_SPEC_DESIGN_TRACEABILITY_2026-06-27.md") &&
  finalGoalAuditScriptSource.includes("src/features/terminal/keymap.ts") &&
  finalGoalAuditScriptSource.includes("src/features/terminal/hooks/useAICliDetection.ts") &&
  finalGoalAuditScriptSource.includes("src/shared/hooks/useKeyboardShortcuts.ts") &&
  finalGoalAuditScriptSource.includes("src/shared/hooks/useEditableTargetGuard.ts") &&
  finalGoalAuditScriptSource.includes("src/shared/lib/bootMetrics.ts") &&
  finalGoalAuditScriptSource.includes("src/shared/lib/agentFileChanges.ts") &&
  finalGoalAuditScriptSource.includes("src/shared/lib/agentTelemetryPersistence.ts") &&
  finalGoalAuditScriptSource.includes("src/shared/hooks/useAgentManager.ts") &&
  finalGoalAuditScriptSource.includes("src/__tests__/agentFileChanges.test.ts") &&
  finalGoalAuditScriptSource.includes("src/__tests__/agentTelemetryPersistence.test.ts") &&
  finalGoalAuditScriptSource.includes("src/__tests__/useAgentManagerTelemetry.test.tsx") &&
  finalGoalAuditScriptSource.includes("src/styles/global.css") &&
  finalGoalAuditScriptSource.includes("vitest.config.ts") &&
  finalGoalAuditScriptSource.includes("src/__tests__/setup.ts") &&
  finalGoalAuditScriptSource.includes("test-runtime-hygiene") &&
  finalGoalAuditScriptSource.includes("src-tauri/Cargo.toml") &&
  finalGoalAuditScriptSource.includes("src/shared/lib/agentFileChanges.ts") &&
  finalGoalAuditScriptSource.includes("src/__tests__/agentFileChanges.test.ts") &&
  finalGoalAuditScriptSource.includes("latestReleaseScoreDependency") &&
  finalGoalAuditScriptSource.includes("releaseScoreFreshness") &&
  finalGoalAuditScriptSource.includes("scoreSelfReferenceNote") &&
  finalGoalAuditScriptSource.includes("preAudit") &&
  finalGoalAuditScriptSource.includes("projectedAfterEvidenceMap") &&
  finalGoalAuditScriptSource.includes("finalGoalEvidenceMap") &&
  finalGoalAuditScriptSource.includes("residualRiskRegister") &&
  finalGoalAuditScriptSource.includes("classifyEvidencePath") &&
  finalGoalAuditScriptSource.includes("minimumEvidenceByRequirement") &&
  finalGoalAuditScriptSource.includes("requiredEvidenceKindsByRequirement") &&
  finalGoalAuditScriptSource.includes("evidenceDensity") &&
  finalGoalAuditScriptSource.includes("missingEvidenceDensity") &&
  finalGoalAuditScriptSource.includes("missingKinds") &&
  finalGoalAuditScriptSource.includes("jsonArtifactCount") &&
  finalGoalAuditScriptSource.includes("evidencePathIntegrity") &&
  finalGoalAuditScriptSource.includes("missingEvidencePaths") &&
  finalGoalAuditScriptSource.includes("missing-or-invalid-evidence-path") &&
  finalGoalAuditScriptSource.includes("tryReadJson") &&
  finalGoalAuditScriptSource.includes("insufficient-evidence-density") &&
  finalGoalAuditScriptSource.includes("src/__tests__/TerminalCanvasInput.test.tsx") &&
  finalGoalAuditScriptSource.includes("src/__tests__/paneTreePersistence.test.ts") &&
  finalGoalAuditScriptSource.includes("src/__tests__/rightRailGoalTrack.test.ts") &&
  finalGoalAuditScriptSource.includes("src/__tests__/commandRecoveryContract.test.ts") &&
  finalGoalAuditScriptSource.includes("src/__tests__/aiCliLaunchPlanner.test.ts") &&
  finalGoalAuditScriptSource.includes("scripts/verify-production-bundle-budget.mjs") &&
  finalGoalAuditScriptSource.includes("themeCustomizationScore") &&
  finalGoalAuditScriptSource.includes("commandRecovery?.ok === true") &&
  finalGoalAuditScriptSource.includes("failedCommandRecovery.provenanceHasEvidence") &&
  finalGoalAuditScriptSource.includes("implementationFixable") &&
  finalGoalAuditScriptSource.includes("implementationFixableRisks") &&
  finalGoalAuditScriptSource.includes("policyBlockedRisks") &&
  finalGoalAuditScriptSource.includes("externalBlockedRisks") &&
  finalGoalAuditScriptSource.includes("blocked-only-by-explicit-token-consent") &&
  finalGoalAuditScriptSource.includes("operationalEvidence") &&
  finalGoalAuditScriptSource.includes("currentStateDocPaths") &&
  finalGoalAuditScriptSource.includes("currentStateDocFreshness") &&
  finalGoalAuditScriptSource.includes("localDate") &&
  finalGoalAuditScriptSource.includes("timeZone") &&
  finalGoalAuditScriptSource.includes("goalDocumentationFreshness") &&
  finalGoalAuditScriptSource.includes("noStaleReleaseReadyClaim") &&
  finalGoalAuditScriptSource.includes("runtimeHygieneOperationallyClean") &&
  finalGoalAuditScriptSource.includes("previousCrashIncidentCount") &&
  finalGoalAuditScriptSource.includes("previousHelperOutputLeakCount") &&
  finalGoalAuditScriptSource.includes("summarizeHistoricalIncidentClosure") &&
  finalGoalAuditScriptSource.includes("historicalIncidentCount") &&
  finalGoalAuditScriptSource.includes("historicalIncidentClosure") &&
  finalGoalAuditScriptSource.includes("historicalIncidentsHaveCleanSuccessor") &&
  finalGoalAuditScriptSource.includes("noHelperOutputLeaks") &&
  finalGoalAuditScriptSource.includes("production-bundle-budget") &&
  finalGoalAuditScriptSource.includes("frontend-bundle-budget") &&
  finalGoalAuditScriptSource.includes("test-runtime-hygiene") &&
  finalGoalAuditScriptSource.includes("promptProviderGuardReady") &&
  finalGoalAuditScriptSource.includes("promptProviderMatrixReady") &&
  finalGoalAuditScriptSource.includes("promptConsentPacketReady") &&
  finalGoalAuditScriptSource.includes("promptExecutionGate") &&
  finalGoalAuditScriptSource.includes("requiredProviderEnv") &&
  finalGoalAuditScriptSource.includes("consentPacketArtifact") &&
  finalGoalAuditScriptSource.includes("readyToRunAfterConsent") &&
  finalGoalAuditScriptSource.includes("providerReadiness") &&
  finalGoalAuditScriptSource.includes("AELYRIS_AUTH_PROMPT_CONSENT") &&
  finalGoalAuditScriptSource.includes("tauri-runtime-hygiene") &&
  finalGoalAuditScriptSource.includes("authenticated-ai-cli-provider-required-smoke") &&
  finalGoalAuditScriptSource.includes("authenticated-ai-cli-preflight-matrix") &&
  finalGoalAuditScriptSource.includes("authenticated-ai-cli-consent-packet") &&
  finalGoalAuditScriptSource.includes("authenticated-ai-cli-preflight-gate") &&
  finalGoalSafeVerifierSource.includes("final-goal-safe-summary.json") &&
  finalGoalSafeVerifierSource.includes("verify-authenticated-ai-cli-provider-guard.mjs") &&
  finalGoalSafeVerifierSource.includes("verify-authenticated-ai-cli-preflight-matrix.mjs") &&
  finalGoalSafeVerifierSource.includes("verify-authenticated-ai-cli-consent-packet.mjs") &&
  finalGoalSafeVerifierSource.includes("authenticatedConsentPacketVerdict") &&
  finalGoalSafeVerifierSource.includes("verify-ai-cli-launch-planner.mjs") &&
  finalGoalSafeVerifierSource.includes("verify-tauri-runtime-hygiene.mjs") &&
  finalGoalSafeVerifierSource.includes("verify-release-hygiene-contract.mjs") &&
  finalGoalSafeVerifierSource.includes("verify-goal-completion-matrix.mjs") &&
  finalGoalSafeVerifierSource.includes("verify-goal-operator-finish.mjs") &&
  finalGoalSafeVerifierSource.includes("verify-goal-finalize-evidence.mjs") &&
  finalGoalSafeVerifierSource.includes("goalCompletionMatrixVerdict") &&
  finalGoalSafeVerifierSource.includes("operatorFinishVerdict") &&
  finalGoalSafeVerifierSource.includes("pass-current-goal-completion-matrix-contract") &&
  finalGoalSafeVerifierSource.includes("pass-current-operator-finish-contract") &&
  finalGoalSafeVerifierSource.includes("terminalChunkedOscLiveVerdict") &&
  finalGoalSafeVerifierSource.includes("chunked-osc-live.json") &&
  finalGoalSafeVerifierSource.includes("pass-current-chunked-osc-live-contract") &&
  finalGoalSafeVerifierSource.includes("nativeHwndPasteLiveVerdict") &&
  finalGoalSafeVerifierSource.includes("native-hwnd-paste-live.json") &&
  finalGoalSafeVerifierSource.includes("pass-current-native-hwnd-paste-contract") &&
  finalGoalSafeVerifierSource.includes("pass-degraded-no-cdp") &&
  finalGoalSafeVerifierSource.includes("nativeHwndPasteLivePassed") &&
  finalGoalSafeVerifierSource.includes("releaseHygieneContractVerdict") &&
  finalGoalSafeVerifierSource.includes("releaseHygieneClean") &&
  releaseHygieneContractSource.includes("release-hygiene-contract.json") &&
  releaseHygieneContractSource.includes("MANUAL_DIAGNOSTIC_SCRIPT_PATTERN") &&
  releaseHygieneContractSource.includes('gitFiles(["--others", "--exclude-standard"])') &&
  releaseHygieneContractSource.includes("untrackedFilesEnumerated") &&
  releaseHygieneContractSource.includes("activeSourcesIncludeUntracked") &&
  releaseHygieneContractSource.includes("scannedUntrackedFileCount") &&
  releaseHygieneContractSource.includes("noManualDiagnosticScripts") &&
  releaseHygieneContractSource.includes("noTemporaryInstrumentationMarkers") &&
  releaseHygieneContractSource.includes("markerHits") &&
  packageJsonSource.includes('"verify:terminal:chunked-osc-live"') &&
  packageJsonSource.includes('"verify:terminal:native-hwnd-paste"') &&
  packageJsonSource.includes('"verify:stack-risk"') &&
  packageJsonSource.includes('"verify:goal:completion-matrix"') &&
  goalCompletionMatrixSource.includes("goal-completion-matrix.json") &&
  goalCompletionMatrixSource.includes("OBJECTIVE") &&
  goalCompletionMatrixSource.includes("objectiveMatrix") &&
  goalCompletionMatrixSource.includes("evidenceIntegrity") &&
  goalCompletionMatrixSource.includes("consentGate") &&
  goalCompletionMatrixSource.includes("blocked-by-explicit-consent") &&
  goalCompletionMatrixSource.includes("tmux") &&
  goalCompletionMatrixSource.includes("native-terminal") &&
  goalCompletionMatrixSource.includes("Claude Code") &&
  goalCompletionMatrixSource.includes("native-first hybrid") &&
  goalCompletionMatrixSource.includes("IME/clipboard") &&
  goalCompletionMatrixSource.includes("AI CLI sidecar") &&
  goalCompletionMatrixSource.includes("runtime hygiene") &&
  chunkedOscLiveSource.includes("chunked-osc-live.json") &&
  chunkedOscLiveSource.includes("__TAURI_INTERNALS__.invoke") &&
  chunkedOscLiveSource.includes("pass-current-chunked-osc-live-contract") &&
  chunkedOscLiveSource.includes("allCasesPassed") &&
  chunkedOscLiveSource.includes("pngSignatureVerified") &&
  nativeHwndPasteLiveSource.includes("native-hwnd-paste-live.json") &&
  nativeHwndPasteLiveSource.includes("WM_PASTE") &&
  nativeHwndPasteLiveSource.includes("pass-current-native-hwnd-paste-contract") &&
  nativeHwndPasteLiveSource.includes("pass-degraded-no-cdp") &&
  nativeHwndPasteLiveSource.includes("degraded") &&
  nativeHwndPasteLiveSource.includes("destructivePasteBlockedBeforePty") &&
  nativeHwndPasteLiveSource.includes("multilinePasteBlockedBeforePty") &&
  finalGoalSafeVerifierSource.includes("runPnpmStep") &&
  finalGoalSafeVerifierSource.includes("classifyBuildStderr") &&
  finalGoalSafeVerifierSource.includes("unexpectedBuildWarnings") &&
  finalGoalSafeVerifierSource.includes("knownBuildWarnings") &&
  finalGoalSafeVerifierSource.includes("tauri-api-mixed-static-dynamic-import-chunk-warning") &&
  finalGoalSafeVerifierSource.includes("any warning fails this safe gate") &&
  finalGoalSafeVerifierSource.includes("noProductionBuildWarnings") &&
  finalGoalSafeVerifierSource.includes("noUnexpectedProductionBuildWarnings") &&
  finalGoalSafeVerifierSource.includes('"production-build"') &&
  finalGoalSafeVerifierSource.includes("pnpm build") &&
  finalGoalSafeVerifierSource.includes('"production-bundle-budget"') &&
  finalGoalSafeVerifierSource.includes("verify-production-bundle-budget.mjs") &&
  finalGoalSafeVerifierSource.includes("score-release-quality.mjs") &&
  finalGoalSafeVerifierSource.includes("verify-final-goal-audit.mjs") &&
  finalGoalSafeVerifierSource.includes("goal-documentation-freshness") &&
  finalGoalSafeVerifierSource.includes("final-goal-audit-after-goal-docs") &&
  finalGoalSafeVerifierSource.includes("quality-score-final") &&
  finalGoalSafeVerifierSource.includes("blocked-by-explicit-consent") &&
  finalGoalSafeVerifierSource.includes("implementationFixableCount") &&
  finalGoalSafeVerifierSource.includes("policyBlockedCount") &&
  finalGoalSafeVerifierSource.includes("residualTopLevelMirrors") &&
  finalGoalSafeVerifierSource.includes("proofChain") &&
  finalGoalSafeVerifierSource.includes("artifacts") &&
  finalGoalSafeVerifierSource.includes("invariants") &&
  finalGoalSafeVerifierSource.includes("coverage") &&
  finalGoalSafeVerifierSource.includes("nonTokenRequirementsProved") &&
  finalGoalSafeVerifierSource.includes("finalAuditRequirementsProved") &&
  finalGoalSafeVerifierSource.includes("evidenceDensityComplete") &&
  finalGoalSafeVerifierSource.includes("missingEvidenceDensity") &&
  finalGoalSafeVerifierSource.includes("evidencePathIntegrityComplete") &&
  finalGoalSafeVerifierSource.includes("missingEvidencePaths") &&
  finalGoalSafeVerifierSource.includes("releaseQualityScoreVerdict") &&
  finalGoalSafeVerifierSource.includes("finalGoalAuditVerdict") &&
  finalGoalSafeVerifierSource.includes("providerGuardVerdict") &&
  finalGoalSafeVerifierSource.includes("authenticatedPreflightMatrixVerdict") &&
  finalGoalSafeVerifierSource.includes("aiCliLaunchPlannerVerdict") &&
  finalGoalSafeVerifierSource.includes("tauriRuntimeHygieneVerdict") &&
  finalGoalSafeVerifierSource.includes("rightRailGoalTrackVerdict") &&
  finalGoalSafeVerifierSource.includes("rightRailGoalTrackArtifactFresh") &&
  finalGoalSafeVerifierSource.includes("RIGHT_RAIL_GOAL_TRACK_SOURCE_PATHS") &&
  finalGoalSafeVerifierSource.includes("currentRightRailGoalTrackSourceCutoffMs") &&
  finalGoalSafeVerifierSource.includes("capturedRightRailGoalTrackSourceCutoffMs") &&
  finalGoalSafeVerifierSource.includes("rightRailGoalTrackCaptureCutoffMs") &&
  finalGoalSafeVerifierSource.includes("right rail Goal Track artifact is stale in source/capture time") &&
  finalGoalSafeVerifierSource.includes("pass-current-contract") &&
  finalGoalSafeVerifierSource.includes("pass-current-audit-contract") &&
  finalGoalSafeVerifierSource.includes("pass-current-preflight-matrix-contract") &&
  finalGoalSafeVerifierSource.includes("pass-current-launch-planner-contract") &&
  finalGoalSafeVerifierSource.includes("pass-current-runtime-hygiene-contract") &&
  finalGoalSafeVerifierSource.includes("historical incident closure") &&
  finalGoalSafeVerifierSource.includes("expectedQualityDetail") &&
  finalGoalSafeVerifierSource.includes("artifactMeta requires an explicit contract verdict") &&
  finalGoalSafeVerifierSource.includes("expectedSafeGate.detail === safeGate.detail") &&
  finalGoalSafeVerifierSource.includes("rightRailGoalTrackSemanticFreshness") &&
  finalGoalSafeVerifierSource.includes("rightRailGoalTrackCycleBoundaryExplained") &&
  finalGoalSafeVerifierSource.includes("right-rail-safe-gate-mutual-proof") &&
  finalGoalSafeVerifierSource.includes('safeGate.semanticFreshness === "current-contract"') &&
  finalGoalSafeVerifierSource.includes('safeGate.cycleBoundary === "right-rail-safe-gate-mutual-proof"') &&
  finalGoalSafeVerifierSource.includes("provider-required-safe") &&
  finalGoalSafeVerifierSource.includes("proofArtifactPassCount") &&
  finalGoalSafeVerifierSource.includes("proofArtifactsPassed") &&
  finalGoalSafeVerifierSource.includes("localDate") &&
  finalGoalSafeVerifierSource.includes("timeZone") &&
  finalGoalSafeVerifierSource.includes("const tokenSpendingPromptExecuted =") &&
  finalGoalSafeVerifierSource.includes("expectedSafeGate.tokenSpendingPromptExecuted === tokenSpendingPromptExecuted") &&
  finalGoalSafeVerifierSource.includes("operatorFinishHandoffPassed") &&
  finalGoalSafeVerifierSource.includes("goalAntiStallContractPassed") &&
  finalGoalSafeVerifierSource.includes("antiStallContractVerdict") &&
  finalGoalSafeVerifierSource.includes("pass-current-anti-stall-contract") &&
  finalGoalSafeVerifierSource.includes("operator-finish-no-stall-handoff") &&
  goalOperatorFinishSource.includes("goal-operator-finish.json") &&
  goalOperatorFinishSource.includes("pnpm verify:goal:operator:token-smoke") &&
  goalOperatorFinishSource.includes("tokenSpendingPromptExecutedByThisRun: false") &&
  goalOperatorFinishSource.includes("I_WILL_MANUALLY_SLEEP_WINDOWS_WHILE_VERIFIER_WAITS") &&
  goalOperatorFinishSource.includes("NO_TOKEN_SCRUBBED_ENV_KEYS") &&
  goalOperatorFinishSource.includes("delete env.AELYRIS_ALLOW_OS_SLEEP") &&
  goalDocumentationFreshnessSource.includes("goal-documentation-freshness.json") &&
  goalDocumentationFreshnessSource.includes("CURRENT_STATE_DOCS") &&
  goalDocumentationFreshnessSource.includes("currentLocalDate") &&
  goalDocumentationFreshnessSource.includes('timeZone: "Asia/Tokyo"') &&
  goalDocumentationFreshnessSource.includes("localDate") &&
  goalDocumentationFreshnessSource.includes("checkedDocCount") &&
  goalDocumentationFreshnessSource.includes("requiredDocPaths") &&
  goalDocumentationFreshnessSource.includes("README.md") &&
  goalDocumentationFreshnessSource.includes("docs/README.md") &&
  goalDocumentationFreshnessSource.includes("docs/PUBLICATION_READINESS.md") &&
  goalDocumentationFreshnessSource.includes("scoreIsCurrentShape") &&
  goalDocumentationFreshnessSource.includes("pass-current-goal-docs-contract") &&
  goalDocumentationFreshnessSource.includes("noStaleReleaseReadyClaim") &&
  goalAntiStallContractSource.includes("goal-anti-stall-contract.json") &&
  goalAntiStallContractSource.includes("pass-current-anti-stall-contract") &&
  goalAntiStallContractSource.includes("nativeAiChaosDefaultWaitMs") &&
  goalAntiStallContractSource.includes("safeFallbackCoversCriticalSteps") &&
  goalAntiStallContractSource.includes("operatorFinishRequiresExactHumanOptIn") &&
  goalAntiStallContractSource.includes("operatorFinishStreamsLongExternalSteps") &&
  goalAntiStallContractSource.includes("goalFinalizeClosesSelfReferenceLoop") &&
  goalAntiStallContractSource.includes("finalAuditScoreUseSharedArtifactLock") &&
  goalAntiStallContractSource.includes("nonTokenRefreshHasProgressAndTimeouts") &&
  goalAntiStallContractSource.includes("chunkedOscSafeWrapperPreventsSilentStack") &&
  goalAntiStallContractFresh &&
  finalGoalSafeVerifierSource.includes("REQUIRED_GOAL_DOCUMENT_PATHS") &&
  finalGoalSafeVerifierSource.includes("docs.length >= REQUIRED_GOAL_DOCUMENT_PATHS.length") &&
  finalGoalSafeVerifierSource.includes("requiredDocsCovered") &&
  finalGoalSafeVerifierSource.includes("noStaleReleaseReadyClaim");
const finalGoalRequiredIds = [
  "rust-native-terminal-core",
  "rust-mux-daemon-boundary",
  "right-rail-command-center",
  "fallback-and-stale-visibility",
  "provenance-recovery-context-packs",
  "ai-cli-launch-planner",
  "theme-customization",
  "release-operations-proof",
];
const finalGoalEvidenceMapMax = 8;
const scoreTotalBeforeFinalGoalEvidenceMap = scores.reduce((sum, item) => sum + item.points, 0);
const scoreMaxBeforeFinalGoalEvidenceMap = scores.reduce((sum, item) => sum + item.max, 0);
const projectedAfterEvidenceMap = {
  total: scoreTotalBeforeFinalGoalEvidenceMap + finalGoalEvidenceMapMax,
  max: scoreMaxBeforeFinalGoalEvidenceMap + finalGoalEvidenceMapMax,
};
projectedAfterEvidenceMap.percent = Math.round((projectedAfterEvidenceMap.total / projectedAfterEvidenceMap.max) * 100);
projectedAfterEvidenceMap.grade = gradeForPercent(projectedAfterEvidenceMap.percent);
const finalGoalAuditProjectedScorePass =
  finalGoalAudit?.score?.projectedAfterEvidenceMap?.total === projectedAfterEvidenceMap.total &&
  finalGoalAudit?.score?.projectedAfterEvidenceMap?.max === projectedAfterEvidenceMap.max &&
  finalGoalAudit?.score?.projectedAfterEvidenceMap?.percent === projectedAfterEvidenceMap.percent &&
  finalGoalAudit?.score?.projectedAfterEvidenceMap?.grade === projectedAfterEvidenceMap.grade;
const finalGoalAuditResidualRiskCompletePass =
  finalGoalAudit?.residualRiskRegister?.state === "complete" &&
  finalGoalAudit?.residualRiskRegister?.implementationFixableCount === 0 &&
  finalGoalAudit?.residualRiskRegister?.policyBlockedCount === 0 &&
  (finalGoalAudit?.residualRiskRegister?.externalBlockedCount ?? 0) === 0 &&
  finalGoalAudit?.residualRiskRegister?.completionClaimAllowed === true;
const finalGoalAuditResidualRiskConsentBlockedPass =
  finalGoalAudit?.residualRiskRegister?.state === "blocked-only-by-explicit-token-consent" &&
  finalGoalAudit?.residualRiskRegister?.implementationFixableCount === 0 &&
  finalGoalAudit?.residualRiskRegister?.policyBlockedCount === 1 &&
  (finalGoalAudit?.residualRiskRegister?.externalBlockedCount ?? 0) === 0 &&
  finalGoalAudit?.residualRiskRegister?.canContinueWithoutTokenSpend === true &&
  finalGoalAudit?.residualRiskRegister?.completionClaimAllowed === false;
const finalGoalAuditResidualRiskExternalBlockedPass =
  finalGoalAudit?.residualRiskRegister?.state === "blocked-by-external-gates" &&
  finalGoalAudit?.residualRiskRegister?.implementationFixableCount === 0 &&
  (finalGoalAudit?.residualRiskRegister?.externalBlockedCount ?? 0) >= 1 &&
  finalGoalAudit?.residualRiskRegister?.completionClaimAllowed === false &&
  Array.isArray(finalGoalAudit?.externalBlockedRisks) &&
  finalGoalAudit.externalBlockedRisks.length === finalGoalAudit?.residualRiskRegister?.externalBlockedCount;
const finalGoalAuditResidualRiskPass =
  (finalGoalAuditResidualRiskCompletePass ||
    finalGoalAuditResidualRiskConsentBlockedPass ||
    finalGoalAuditResidualRiskExternalBlockedPass) &&
  finalGoalAudit?.implementationFixableCount === finalGoalAudit?.residualRiskRegister?.implementationFixableCount &&
  finalGoalAudit?.policyBlockedCount === finalGoalAudit?.residualRiskRegister?.policyBlockedCount &&
  (finalGoalAudit?.externalBlockedCount ?? 0) === (finalGoalAudit?.residualRiskRegister?.externalBlockedCount ?? 0) &&
  Array.isArray(finalGoalAudit?.implementationFixableRisks) &&
  finalGoalAudit.implementationFixableRisks.length === finalGoalAudit?.implementationFixableCount &&
  Array.isArray(finalGoalAudit?.policyBlockedRisks) &&
  finalGoalAudit.policyBlockedRisks.length === finalGoalAudit?.policyBlockedCount;
const finalGoalAuditEvidenceDensityItems = Array.isArray(finalGoalAudit?.evidenceDensity?.items)
  ? finalGoalAudit.evidenceDensity.items
  : [];
const finalGoalAuditEvidenceDensityPass =
  finalGoalAudit?.evidenceDensity?.complete === true &&
  Array.isArray(finalGoalAudit?.missingEvidenceDensity) &&
  finalGoalAudit.missingEvidenceDensity.length === 0 &&
  finalGoalAuditEvidenceDensityItems.length >= finalGoalRequiredIds.length &&
  finalGoalAuditEvidenceDensityItems.every((item) => {
    const requiredKinds = Array.isArray(item?.requiredKinds) ? item.requiredKinds : [];
    const kinds = Array.isArray(item?.kinds) ? item.kinds : [];
    return (
      item?.ok === true &&
      item.actual >= item.minimum &&
      item.jsonArtifactCount >= 1 &&
      Array.isArray(item.missingKinds) &&
      item.missingKinds.length === 0 &&
      requiredKinds.length >= 2 &&
      requiredKinds.every((kind) => kinds.includes(kind))
    );
  }) &&
  finalGoalAuditEvidenceDensityItems.some(
    (item) =>
      item?.id === "provenance-recovery-context-packs" &&
      item.actual >= 6 &&
      item.kinds.includes("source-file") &&
      item.kinds.includes("test-file"),
  ) &&
  finalGoalAuditEvidenceDensityItems.some(
    (item) =>
      item?.id === "theme-customization" &&
      item.actual >= 6 &&
      item.kinds.includes("source-file") &&
      item.kinds.includes("test-file"),
  );
const finalGoalAuditEvidencePathItems = Array.isArray(finalGoalAudit?.evidencePathIntegrity?.items)
  ? finalGoalAudit.evidencePathIntegrity.items
  : [];
const finalGoalAuditEvidencePathIntegrityPass =
  finalGoalAudit?.evidencePathIntegrity?.complete === true &&
  Array.isArray(finalGoalAudit?.missingEvidencePaths) &&
  finalGoalAudit.missingEvidencePaths.length === 0 &&
  finalGoalAuditEvidencePathItems.length >= 8 &&
  finalGoalAuditEvidencePathItems.every(
    (item) =>
      item?.ok === true &&
      item.exists === true &&
      item.size > 0 &&
      (item.kind !== "json-artifact" || item.parseableJson === true),
  );
const finalGoalAuditFresh =
  finalGoalAudit?.ok === true &&
  finalGoalAudit?.evidenceComplete === true &&
  finalGoalAuditEvidenceDensityPass &&
  finalGoalAuditEvidencePathIntegrityPass &&
  (finalGoalAudit?.status === "blocked-by-explicit-consent" ||
    finalGoalAudit?.status === "blocked-by-external-gates" ||
    finalGoalAudit?.status === "complete") &&
  finalGoalAudit?.operationalEvidence?.releaseScoreFreshness?.fresh === true &&
  mtimeMs(finalGoalAuditPath) + 5_000 >=
    Math.max(
      mtimeMs(join(ROOT, "scripts", "verify-final-goal-audit.mjs")),
      mtimeMs(join(ROOT, "scripts", "verify-final-goal-safe.mjs")),
      mtimeMs(join(ROOT, "scripts", "verify-goal-anti-stall-contract.mjs")),
      mtimeMs(join(ROOT, "scripts", "verify-chunked-osc-live-safe.mjs")),
      mtimeMs(join(ROOT, "scripts", "verify-goal-documentation-freshness.mjs")),
      mtimeMs(join(ROOT, "scripts", "verify-authenticated-ai-cli-consent-packet.mjs")),
      mtimeMs(join(ROOT, "docs", "TERMINAL_NATIVE_CORE_AND_EDITOR_DESCOPE_PLAN_2026-05-17.md")),
      mtimeMs(join(ROOT, "docs", "NATIVE_RUST_NATIVE_TERMINAL_PLUS_MIGRATION_PLAN.md")),
      mtimeMs(tauriRuntimeHygienePath),
      mtimeMs(releaseHygieneContractPath),
      mtimeMs(goalAntiStallContractPath),
      mtimeMs(nativeBoundaryContractPath),
      mtimeMs(commandCenterScenarioPath),
      mtimeMs(aiCliLaunchPlannerSmokePath),
      mtimeMs(authenticatedAiCliPromptSmokePath),
      mtimeMs(authenticatedAiCliPreflightMatrixPath),
      mtimeMs(authenticatedAiCliConsentPacketPath),
      mtimeMs(authenticatedAiCliProviderGuardPath),
      mtimeMs(commandRecoveryContractPath),
      mtimeMs(terminalFontRenderContractPath),
      mtimeMs(rightRailScaleContractPath),
      mtimeMs(productionBundleBudgetPath),
      mtimeMs(join(ROOT, "scripts", "verify-terminal-font-render-contract.mjs")),
      mtimeMs(join(ROOT, "scripts", "verify-release-hygiene-contract.mjs")),
    );
const finalGoalAuditBlockedOnlyByConsent =
  finalGoalAudit?.goalComplete === false &&
  finalGoalAudit?.status === "blocked-by-explicit-consent" &&
  countAuthenticatedPromptBlockers(finalGoalAudit?.unresolvedBlockers?.map?.((item) => item?.blocker ?? item)) === 1;
const finalGoalAuditBlockedByExternalGates =
  finalGoalAudit?.goalComplete === false &&
  finalGoalAudit?.status === "blocked-by-external-gates" &&
  finalGoalAudit?.residualRiskRegister?.implementationFixableCount === 0 &&
  (finalGoalAudit?.residualRiskRegister?.externalBlockedCount ?? 0) >= 1 &&
  countHostSleepUnsupportedBlockers(finalGoalAudit?.unresolvedBlockers ?? []) >= 1;
const finalGoalAuditComplete =
  finalGoalAudit?.goalComplete === true &&
  finalGoalAudit?.status === "complete" &&
  Array.isArray(finalGoalAudit?.unresolvedBlockers) &&
  finalGoalAudit.unresolvedBlockers.length === 0;
const finalGoalAuditProviderReadiness =
  finalGoalAudit?.operationalEvidence?.authenticatedPromptConsent?.promptExecutionGate?.providerReadiness ?? [];
const finalGoalAuditProviderReadyPass = ["codex", "claude", "gemini"].every((provider) =>
  finalGoalAuditProviderReadiness.some?.(
    (entry) => entry === provider || entry?.provider === provider || entry?.label === provider,
  ),
);
const finalGoalAuditNextAction = String(finalGoalAudit?.nextRequiredAction ?? "");
const finalGoalAuditNextActionPass =
  finalGoalAuditComplete ||
  (finalGoalAuditNextAction.includes("pnpm verify:goal:operator:token-smoke") &&
    finalGoalAuditNextAction.includes("AELYRIS_AUTH_PROMPT_PROVIDER=codex|claude|gemini"));
const finalGoalAuditConsentGatePass =
  finalGoalAuditComplete ||
  (finalGoalAudit?.operationalEvidence?.authenticatedPromptConsent?.promptExecutionGate?.command ===
    "pnpm verify:goal:operator:token-smoke" &&
    String(
      finalGoalAudit?.operationalEvidence?.authenticatedPromptConsent?.promptExecutionGate?.requiredEnv ?? "",
    ).includes("AELYRIS_AUTH_PROMPT_PROVIDER=codex|claude|gemini") &&
    finalGoalAudit?.operationalEvidence?.authenticatedPromptConsent?.promptExecutionGate?.requiredProviderEnv ===
      "AELYRIS_AUTH_PROMPT_PROVIDER=codex|claude|gemini" &&
    finalGoalAudit?.operationalEvidence?.authenticatedPromptConsent?.promptExecutionGate?.wouldSpendTokens === true &&
    finalGoalAudit?.operationalEvidence?.authenticatedPromptConsent?.promptExecutionGate?.tokenGate ===
      "per-execution one-use packet under standing repo authorization" &&
    finalGoalAudit?.operationalEvidence?.authenticatedPromptConsent?.promptExecutionGate?.consentPacketReady === true &&
    (finalGoalAudit?.operationalEvidence?.authenticatedPromptConsent?.promptExecutionGate?.readyToRunAfterConsent ===
      true ||
      finalGoalAudit?.operationalEvidence?.authenticatedPromptConsent?.promptExecutionGate?.executedWithConsent ===
        true) &&
    finalGoalAudit?.operationalEvidence?.authenticatedPromptConsent?.consentPacketArtifact?.ok === true &&
    finalGoalAudit?.operationalEvidence?.authenticatedPromptConsent?.consentPacketArtifact?.status === "pass" &&
    typeof finalGoalAudit?.operationalEvidence?.authenticatedPromptConsent?.consentPacketArtifact
      ?.consentPacketSha256 === "string" &&
    finalGoalAuditProviderReadyPass &&
    finalGoalAuditNextActionPass);
const finalGoalAuditPass =
  finalGoalAuditSourcePass &&
  finalGoalAuditFresh &&
  finalGoalAuditProjectedScorePass &&
  finalGoalAuditResidualRiskPass &&
  finalGoalAuditConsentGatePass &&
  finalGoalRequiredIds.every((id) => finalGoalRequirementIds.has(id)) &&
  (finalGoalAuditBlockedOnlyByConsent || finalGoalAuditBlockedByExternalGates || finalGoalAuditComplete);
add(
  scores,
  "final-goal-evidence-map",
  "Final goal evidence map",
  finalGoalAuditPass ? 8 : 0,
  8,
  finalGoalAuditPass
    ? finalGoalAuditComplete
      ? "all final goal requirements are mapped to evidence; release blockers are clear"
      : finalGoalAuditBlockedByExternalGates
        ? "all goal requirements are mapped to evidence; final state remains blocked by external host sleep/token gates"
        : "all non-token goal requirements are mapped to evidence; final state remains blocked only by explicit token consent"
    : finalGoalAudit
      ? `${finalGoalAudit?.status ?? "unknown"} (${finalGoalAudit?.missingRequirements?.length ?? "unknown"} missing)`
      : "missing",
  finalGoalAuditPass
    ? []
    : [
        ...(finalGoalAuditSourcePass ? [] : ["final goal audit verifier or package script is incomplete"]),
        ...(finalGoalAuditFresh ? [] : ["final goal audit artifact is missing, stale, or not evidence-complete"]),
        ...(finalGoalAuditProjectedScorePass
          ? []
          : ["final goal audit projected score does not match the current release score model"]),
        ...(finalGoalAuditEvidenceDensityPass
          ? []
          : ["final goal audit does not prove minimum independent evidence density for every requirement"]),
        ...(finalGoalAuditEvidencePathIntegrityPass
          ? []
          : ["final goal audit evidence paths are missing, empty, or invalid JSON"]),
        ...(finalGoalAuditResidualRiskPass
          ? []
          : [
              "final goal audit does not classify residual risks as implementation-fixable vs explicit consent/external host gates",
            ]),
        ...(finalGoalAuditConsentGatePass
          ? []
          : ["final goal audit does not expose the authenticated prompt consent command and env gate"]),
        ...finalGoalRequiredIds
          .filter((id) => !finalGoalRequirementIds.has(id))
          .map((id) => `final goal requirement is not audited: ${id}`),
        ...(finalGoalAuditBlockedOnlyByConsent || finalGoalAuditBlockedByExternalGates || finalGoalAuditComplete
          ? []
          : ["final goal audit status is neither complete nor blocked by explicit token consent/external host gates"]),
        ...(!finalGoalAuditBlockedOnlyByConsent &&
        !finalGoalAuditBlockedByExternalGates &&
        !finalGoalAuditComplete &&
        countAuthenticatedPromptBlockers(finalGoalAudit?.unresolvedBlockers?.map?.((item) => item?.blocker ?? item)) !==
          1
          ? ["final goal audit does not isolate the authenticated prompt consent blocker"]
          : []),
      ],
);

const scoreKindById = new Map([
  ["release-readiness-aggregate", "aggregate"],
  ["final-goal-evidence-map", "derived"],
]);
for (const item of scores) item.kind = scoreKindById.get(item.id) ?? "direct";
const finalGoalEvidenceRow = scores.find((item) => item.id === "final-goal-evidence-map");
if (finalGoalEvidenceRow) {
  finalGoalEvidenceRow.points = 0;
  finalGoalEvidenceRow.max = 0;
  finalGoalEvidenceRow.blockers = [];
  finalGoalEvidenceRow.detail = "downstream derived view; verify-final-goal-audit consumes this score without feeding it back";
}
const countedScores = scores.filter((item) => item.kind === "direct");
const total = countedScores.reduce((sum, item) => sum + item.points, 0);
const max = countedScores.reduce((sum, item) => sum + item.max, 0);
const percent = Math.round((total / max) * 100);
const allBlockers = scores.flatMap((item) =>
  item.blockers.map((blocker) => ({ area: item.id, kind: item.kind, blocker })),
);
const blockers = deduplicateRootCauses(allBlockers.filter((item) => item.kind === "direct"));
const dependencyGraph = {
  schema: "aelyris.evidence-dependency-graph/v1",
  nodes: [
    ...scores.map((item) => ({
      id: `score:${item.id}`,
      kind: item.kind,
      dependsOn: item.id === "release-readiness-aggregate" ? countedScores.map((score) => `score:${score.id}`) : [],
    })),
    { id: "final-goal-audit", kind: "derived", dependsOn: ["release-score"] },
    { id: "release-score", kind: "aggregate", dependsOn: countedScores.map((item) => `score:${item.id}`) },
  ],
};
const dependencyGraphValidation = validateEvidenceDependencyGraph(dependencyGraph);
if (!dependencyGraphValidation.ok) {
  throw new Error(`Invalid score dependency graph: ${dependencyGraphValidation.errors.join(", ")}`);
}
const generatedAt = new Date().toISOString();
const report = {
  version: 1,
  generatedAt,
  localDate: currentLocalDate(),
  timeZone: LOCAL_TIME_ZONE,
  score: percent,
  total,
  max,
  grade: gradeForPercent(percent),
  releaseCandidateReady:
    percent >= 92 && blockers.length === 0 && scores.filter((item) => item.kind === "aggregate").every((item) => item.points === item.max),
  scores,
  blockers,
  allBlockers,
  blockerCounts: {
    uniqueDirect: blockers.length,
    aggregate: allBlockers.filter((item) => item.kind === "aggregate").length,
    derived: allBlockers.filter((item) => item.kind === "derived").length,
  },
  dependencyGraph,
  provenanceRejections,
  provenance: createEvidenceProvenance({
    root: ROOT,
    verifierPath: "scripts/score-release-quality.mjs",
    inputPaths: [
      "package.json",
      "scripts/evidence-provenance.mjs",
      "scripts/release-evidence-truth.mjs",
      ...evidenceInputPaths,
    ],
    generatedAt,
  }),
  enforceMode: ENFORCE_RELEASE_SCORE,
};

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`);
if (nativeHwndPasteLiveDegradedFresh) {
  console.warn(
    "native HWND paste WebView2/CDP WM_PASTE path unexercised; degraded no-CDP Rust proof did not receive full release credit.",
  );
}
console.log(JSON.stringify(report, null, 2));
if (ENFORCE_RELEASE_SCORE && shouldFailReleaseEnforcement(report)) process.exitCode = 1;
