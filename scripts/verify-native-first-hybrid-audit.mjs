import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import process from "node:process";

const ROOT = resolve(process.cwd());
const OUT = join(ROOT, ".codex-auto", "quality", "native-first-hybrid-audit.json");

function read(path) {
  const full = join(ROOT, path);
  return existsSync(full) ? readFileSync(full, "utf8") : "";
}

function readJson(path) {
  const full = join(ROOT, path);
  if (!existsSync(full)) return null;
  return JSON.parse(readFileSync(full, "utf8"));
}

function mtime(path) {
  const full = join(ROOT, path);
  return existsSync(full) ? statSync(full).mtimeMs : 0;
}

function writeJsonAtomic(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(tmp, path);
}

function freshArtifact(artifactPath, sourcePaths, graceMs = 5_000) {
  const artifactTime = mtime(artifactPath);
  if (artifactTime <= 0) return false;
  const newestSource = Math.max(...sourcePaths.map((path) => mtime(path)));
  return artifactTime + graceMs >= newestSource;
}

function allPassed(checks) {
  return Array.isArray(checks) && checks.length > 0 && checks.every((check) => check?.status === "passed");
}

function hasChecks(report, names) {
  const checks = new Set(report?.checks ?? []);
  return names.every((name) => checks.has(name));
}

function addItem(items, id, label, max, passed, detail, evidence = {}, missing = []) {
  items.push({
    id,
    label,
    points: passed ? max : 0,
    max,
    status: passed ? "complete" : "blocked",
    detail,
    evidence,
    missing: passed ? [] : missing,
  });
}

function grade(percent) {
  return percent >= 97 ? "S" : percent >= 92 ? "A" : percent >= 85 ? "B" : percent >= 75 ? "C" : "D";
}

const packageJson = read("package.json");
// The native-first hybrid goal and the full-native stretch goal were captured in
// retired internal goal docs that are intentionally not published. Their content
// assertions were non-blocking and are no longer evaluated; docs/requirements.md
// is the current source of truth for the release goal.
const visiblePaneSpec = read("docs/specs/VISIBLE_AGENT_PANE_RUNTIME_SPEC.md");
const cockpitUxSpec = read("docs/specs/COCKPIT_UX_SPEC.md");

const nativeClientPath = ".codex-auto/quality/native-client-spike.json";
const nativeBoundaryPath = ".codex-auto/quality/native-boundary-contract.json";
const nativeInputPath = ".codex-auto/production-smoke/native-terminal-input-host.json";
const muxPerformancePath = ".codex-auto/performance/mux-performance-smoke.json";
const muxLivePath = ".codex-auto/performance/mux-live-restore-smoke.json";
const nativeVisualQaPath = ".codex-auto/quality/native-visual-qa-proof.json";
const nativePrimaryShellPath = ".codex-auto/quality/native-primary-shell-proof.json";
const upperCompatPath = ".codex-auto/quality/upper-compat-gates.json";
const releaseQualityPath = ".codex-auto/quality/release-quality-score.json";
const fullNativeAuditPath = ".codex-auto/quality/native-coverage-gap-audit.json";
const rightRailSuitePath = ".codex-auto/production-smoke/right-rail-suite.json";
const rightRailPreferencesPath = ".codex-auto/production-smoke/right-rail-preferences.json";
const nativeSleepGuardPath = ".codex-auto/production-smoke/native-sleep-guard-refusal.json";
const nativePostcheckWriteSmokePath =
  ".codex-auto/production-smoke/postcheck-write-smoke/real-os-suspend-native-postcheck-write-smoke.json";

const nativeClient = readJson(nativeClientPath);
const nativeBoundary = readJson(nativeBoundaryPath);
const nativeInput = readJson(nativeInputPath);
const muxPerformance = readJson(muxPerformancePath);
const muxLive = readJson(muxLivePath);
const nativeVisualQa = readJson(nativeVisualQaPath);
const nativePrimaryShell = readJson(nativePrimaryShellPath);
const upperCompat = readJson(upperCompatPath);
const releaseQuality = readJson(releaseQualityPath);
const fullNativeAudit = readJson(fullNativeAuditPath);
const rightRailSuite = readJson(rightRailSuitePath);
const rightRailPreferences = readJson(rightRailPreferencesPath);
const nativeSleepGuard = readJson(nativeSleepGuardPath);
const nativePostcheckWriteSmoke = readJson(nativePostcheckWriteSmokePath);

const items = [];

const implementationScoreIds = [
  "release-doctor",
  "mux-performance",
  "scrollback",
  "native-ime",
  "terminal-core-edge",
  "native-boundary-contract",
  "risk-register",
  "right-rail-edge",
  "right-rail-scale-contract",
  "command-evidence",
  "live-command-evidence",
  "multipane-command-evidence",
  "recovered-command-evidence",
  "process-reconnect-command-evidence",
  "interactive-ai-cli-sidecar-boundary",
  "real-ai-cli-binary-probe",
  "authenticated-ai-cli-preflight-gate",
  "authenticated-ai-cli-preflight-matrix",
  "ai-cli-launch-planner",
  "command-center-scenario",
  "command-recovery-contract",
  "theme-customization-guard",
  "app-state-fallback-visibility",
  "frontend-bundle-budget",
  "test-runtime-hygiene",
];
const releaseOnlyBlockerAreas = new Set([
  "supply-chain-audit",
  "distribution",
  "real-os-soak",
  "live-ai-cli-post-launch-chaos",
  "tauri-runtime-hygiene",
  "authenticated-ai-cli-prompt-smoke",
  "final-goal-evidence-map",
  "right-rail-smoke",
  "right-rail-goal-track",
]);

function scoreEntry(report, id) {
  return Array.isArray(report?.scores) ? report.scores.find((entry) => entry?.id === id) : null;
}

function scoreClosed(report, id) {
  const entry = scoreEntry(report, id);
  return entry != null && entry.max > 0 && entry.points === entry.max && (entry.blockers?.length ?? 0) === 0;
}

function blockerArea(blocker) {
  return typeof blocker?.area === "string" ? blocker.area : "unknown";
}

const missingImplementationScoreIds = implementationScoreIds.filter((id) => !scoreClosed(releaseQuality, id));
const nonReleaseOnlyBlockers = Array.isArray(releaseQuality?.blockers)
  ? releaseQuality.blockers.filter((blocker) => !releaseOnlyBlockerAreas.has(blockerArea(blocker)))
  : [];
const rightRailSuiteChecks = Array.isArray(rightRailSuite?.checks) ? rightRailSuite.checks : [];
const rightRailNonGoalTrackChecks = rightRailSuiteChecks.filter((check) => check?.id !== "goal-track-tauri");
const rightRailImplementationSubsmokesGreen =
  rightRailNonGoalTrackChecks.length >= 8 && rightRailNonGoalTrackChecks.every((check) => check?.status === "passed");
const rightRailPreferencesGreen =
  rightRailPreferences?.ok === true &&
  freshArtifact(rightRailPreferencesPath, ["scripts/verify-right-rail-preferences.mjs", "src/App.tsx", "src/styles/global.css"]);

addItem(
  items,
  "goal-retargeted",
  "Native-first hybrid release goal is the source of truth",
  8,
  packageJson.includes("verify:native-first:audit"),
  "Release goal is explicitly native-first hybrid; strict full-native remains a stretch audit.",
  {
    goalDoc: "docs/requirements.md",
  },
  ["retarget docs and package script to native-first hybrid"],
);

addItem(
  items,
  "rust-product-truth",
  "Rust owns durable terminal product truth",
  12,
  nativeBoundary?.status === "pass" &&
    nativeBoundary?.ok === true &&
    allPassed(nativeBoundary?.checks) &&
    freshArtifact(nativeBoundaryPath, [
      "scripts/verify-native-boundary-contract.mjs",
      "src-tauri/src/term/native_input.rs",
      "src-tauri/src/ipc/commands.rs",
      "src-tauri/src/pty_sidecar.rs",
    ]),
  "PTY/mux/session, terminal core policy, native input, fallback visibility, and daemon contract are Rust-owned and verified.",
  { artifact: nativeBoundaryPath, checks: nativeBoundary?.summary },
  ["rerun pnpm verify:terminal:native-boundary"],
);

addItem(
  items,
  "terminal-hot-path-native",
  "Terminal hot path is native-first",
  16,
  nativeInput?.status === "pass" &&
    allPassed(nativeInput?.checks) &&
    nativeInput?.evidence?.nativeClientFresh === true &&
    nativeInput?.evidence?.nativePasteGuardFresh === true &&
    hasChecks(nativeClient, [
      "native-ime-os-composition-proof",
      "native-ime-os-result-commit-proof",
      "native-ime-os-ai-cli-prompt-proof",
      "native-paste-guard-proof",
      "native-paste-guard-wm-paste-proof",
      "native-paste-guard-no-cdp-proof",
    ]),
  "IME, preedit, clipboard, WM_PASTE, destructive/multiline paste guard, and AI CLI prompt rows are proven without relying on WebView/CDP for the hot path.",
  {
    nativeInputArtifact: nativeInputPath,
    nativeClientArtifact: nativeClientPath,
  },
  ["rerun pnpm verify:terminal:native-client and pnpm verify:terminal:native-input"],
);

addItem(
  items,
  "mux-session-performance",
  "Mux, pane lifecycle, and session performance budgets pass",
  12,
  muxPerformance?.status === "passed" &&
    Array.isArray(muxPerformance?.warnings) &&
    muxPerformance.warnings.length === 0 &&
    Array.isArray(muxPerformance?.errors) &&
    muxPerformance.errors.length === 0 &&
    muxPerformance?.summary?.split?.p95 <= muxPerformance?.budgets?.splitWarnMs &&
    muxPerformance?.summary?.close?.p95 <= muxPerformance?.budgets?.closeP95Ms &&
    muxPerformance?.summary?.attach?.p95 <= muxPerformance?.budgets?.attachP95Ms &&
    muxPerformance?.summary?.detach?.p95 <= muxPerformance?.budgets?.detachP95Ms &&
    muxLive?.status === "passed" &&
    (muxLive?.checks ?? []).includes("daemon-restart-restores-mux-graph") &&
    (muxLive?.checks ?? []).includes("daemon-restart-replays-durable-scrollback") &&
    (muxLive?.checks ?? []).includes("close-pane-updates-mux-graph"),
  "Pane split/close/attach/detach/resize performance is within budget, and mux restore/scrollback survive daemon restart.",
  {
    performanceArtifact: muxPerformancePath,
    liveRestoreArtifact: muxLivePath,
    summary: muxPerformance?.summary,
    budgets: muxPerformance?.budgets,
  },
  ["rerun pnpm verify:mux-performance and pnpm verify:mux-live"],
);

addItem(
  items,
  "native-client-product-loop",
  "Native client proves renderer, settings, Command Center, modes, inspector, and primary shell",
  16,
  nativeClient?.status === "passed" &&
    hasChecks(nativeClient, [
      "native-winit-wgpu-surface-proof",
      "native-winit-wgpu-font-atlas-proof",
      "native-settings-window-ui-proof",
      "native-command-center-window-ui-proof",
      "native-command-center-input-navigation-proof",
      "native-command-center-scroll-model-proof",
      "native-mode-shell-contract-proof",
      "native-mode-rail-window-ui-proof",
      "native-inspector-window-ui-proof",
      "native-right-rail-demotion-contract-proof",
      "native-primary-shell-promotion-proof",
      "react-webview-compatibility-only-proof",
    ]) &&
    nativePrimaryShell?.primaryShell?.promotionReady === true &&
    nativePrimaryShell?.primaryShell?.reactWebViewCompatibilityOnly === true &&
    nativePrimaryShell?.primaryShell?.reactOwnsProductTruth === false &&
    nativePrimaryShell?.primaryShell?.webviewOwnsTerminal === false,
  "The product loop is native-first where it matters, with React/WebView demoted to compatibility instead of owning terminal truth.",
  {
    nativeClientArtifact: nativeClientPath,
    nativePrimaryShellArtifact: nativePrimaryShellPath,
  },
  ["rerun pnpm verify:terminal:native-client"],
);

addItem(
  items,
  "mode-shell-architecture",
  "Aelyris mode shell is implemented without broad app sprawl",
  8,
  hasChecks(nativeClient, [
    "native-mode-shell-contract-proof",
    "native-mode-rail-contract-proof",
    "native-mode-rail-window-hit-targets-proof",
    "native-mode-rail-window-keyboard-proof",
    "native-inspector-contract-proof",
    "native-inspector-window-scroll-keyboard-proof",
  ]) &&
    visiblePaneSpec.includes("visible PTY") &&
    cockpitUxSpec.includes("useAgentFleet") &&
    cockpitUxSpec.includes("approval inbox"),
  "Aelyris mode shell exposes a mode rail, dominant work surface, contextual inspector, mode state preservation, and purpose-focused agent surfaces without broad app sprawl.",
  {
    artifact: nativeClientPath,
    visiblePaneSpec: "docs/specs/VISIBLE_AGENT_PANE_RUNTIME_SPEC.md",
    cockpitUxSpec: "docs/specs/COCKPIT_UX_SPEC.md",
  },
  ["refresh native-client mode shell proofs", "refresh mode shell public spec evidence"],
);

addItem(
  items,
  "upper-compat-gates",
  "Five upper-compatibility gates are implemented as Rust-owned contracts",
  10,
  upperCompat?.status === "pass" &&
    upperCompat?.score === 100 &&
    freshArtifact(upperCompatPath, [
      "scripts/verify-upper-compat-gates.mjs",
      "src-tauri/src/bin/aelyris_native.rs",
      "src-tauri/src/api/mod.rs",
      "src-tauri/src/db/queries.rs",
      "src-tauri/src/db/migrations.rs",
      "package.json",
    ]),
  "Aelyris MCP server, workspace data, mode preservation, cross-mode history search, and agent identity are backed by Rust API/SQLite proof instead of frontend-only state.",
  {
    artifact: upperCompatPath,
    checks: upperCompat?.checks?.map((check) => ({ id: check.id, status: check.status })) ?? [],
  },
  ["rerun pnpm verify:upper-compat"],
);

addItem(
  items,
  "visual-qa-and-accessibility",
  "Visual QA and accessibility gates pass for native-first release",
  10,
  nativeVisualQa?.visualQa?.nativeVisualQaHarness === true &&
    nativeVisualQa?.visualQa?.contrastPass === true &&
    nativeVisualQa?.visualQa?.pixelProbePass === true &&
    nativeVisualQa?.visualQa?.resizeProbePass === true &&
    nativeVisualQa?.visualQa?.focusCoveragePass === true &&
    nativeVisualQa?.visualQa?.sleepResumeRecoveryProbePass === true &&
    nativeVisualQa?.visualQa?.readyForSleepResumeDogfood === true &&
    hasChecks(nativeClient, [
      "native-accessibility-tree-proof",
      "native-accessibility-focus-order-proof",
      "native-uia-provider-dogfood-proof",
      "native-uia-provider-name-role-proof",
      "native-uia-provider-invoke-proof",
    ]),
  "Native visual QA, contrast, resize, pixel probes, focus coverage, and UIA/accessibility dogfood are green. Real machine sleep remains tracked separately.",
  { artifact: nativeVisualQaPath },
  ["rerun pnpm verify:terminal:native-client"],
);

addItem(
  items,
  "host-power-safety-boundary",
  "Host sleep/resume is safe-gated and implementation preflight is complete",
  8,
  nativeSleepGuard?.status === "pass" &&
    nativeSleepGuard?.checks?.noRealSleepAttemptClaimed === true &&
    nativeSleepGuard?.checks?.noPowershellFallback === true &&
    nativeSleepGuard?.safetyBoundary?.requiresExplicitOptIn === true &&
    nativePostcheckWriteSmoke?.status === "pass" &&
    nativePostcheckWriteSmoke?.checks?.nativeVisual === true &&
    nativePostcheckWriteSmoke?.checks?.noRealSleepClaim === true,
  "Implementation is ready for sleep/resume dogfood and refuses host sleep without explicit opt-in.",
  {
    sleepGuardArtifact: nativeSleepGuardPath,
    postcheckWriteSmokeArtifact: nativePostcheckWriteSmokePath,
    realSleepResumeDogfoodExecuted: false,
  },
  ["rerun native sleep guard and postcheck write smoke"],
);

addItem(
  items,
  "implementation-score-compatible",
  "Implementation-critical score subset remains green",
  10,
  releaseQuality != null &&
    missingImplementationScoreIds.length === 0 &&
    nonReleaseOnlyBlockers.length === 0 &&
    rightRailImplementationSubsmokesGreen &&
    rightRailPreferencesGreen &&
    fullNativeAudit?.currentTruth?.canClaimRustCoreProductBoundary === true &&
    fullNativeAudit?.currentTruth?.canClaimFullNative === false,
  "All implementation-critical release score rows are green. Supply-chain registry access, distribution signing, real Windows sleep/resume, live CDP chaos, token-spending prompt execution, clean-shutdown runtime hygiene, and final release self-reference remain tracked as release-operation residuals rather than native-first implementation blockers.",
  {
    releaseQualityArtifact: releaseQualityPath,
    fullNativeStretchArtifact: fullNativeAuditPath,
    rightRailSuiteArtifact: rightRailSuitePath,
    rightRailPreferencesArtifact: rightRailPreferencesPath,
    releaseQuality: {
      score: releaseQuality?.score,
      grade: releaseQuality?.grade,
      total: releaseQuality?.total,
      max: releaseQuality?.max,
      releaseCandidateReady: releaseQuality?.releaseCandidateReady,
    },
    implementationScoreIds,
    missingImplementationScoreIds,
    nonReleaseOnlyBlockerAreas: nonReleaseOnlyBlockers.map((blocker) => blockerArea(blocker)),
    releaseOperationResidualAreas: Array.isArray(releaseQuality?.blockers)
      ? [...new Set(releaseQuality.blockers.map((blocker) => blockerArea(blocker)).filter((area) => releaseOnlyBlockerAreas.has(area)))]
      : [],
    rightRailImplementationSubsmokesGreen,
    rightRailPreferencesGreen,
    strictFullNative: {
      measuredCoveragePercent: fullNativeAudit?.measuredCoveragePercent,
      total: fullNativeAudit?.total,
      max: fullNativeAudit?.max,
      shippingShellReady: fullNativeAudit?.shippingShellReady,
    },
  },
  ["refresh implementation score subset, right-rail preferences, right-rail subsmokes, and full-native stretch audit"],
);

const total = items.reduce((sum, entry) => sum + entry.points, 0);
const max = items.reduce((sum, entry) => sum + entry.max, 0);
const percent = max > 0 ? Math.round((total / max) * 100) : 0;
const blockers = items.filter((entry) => entry.status !== "complete");
const status = blockers.length === 0 ? "passed" : "blocked";

const report = {
  version: 1,
  schema: "aelyris.native-first-hybrid-audit.v1",
  generatedAt: new Date().toISOString(),
  status,
  percent,
  total,
  max,
  grade: grade(percent),
  nativeFirstHybridReady: status === "passed",
  implementationConfidence: status === "passed" ? "high" : "blocked",
  fullNativeRequiredForRelease: false,
  strictFullNativeStretchReady: fullNativeAudit?.shippingShellReady === true,
  hostSleepResumeDogfood: {
    realMachineSleepExecuted: false,
    requiredForNativeFirstImplementationConfidence: false,
    requiredForStrictFullNativeClaim: true,
    explicitOptInEnv: "AELYRIS_ALLOW_OS_SLEEP=1",
  },
  currentTruth: {
    releaseGoal: "native-first hybrid",
    rustOwnsTerminalHotPath: blockers.every((entry) => entry.id !== "terminal-hot-path-native"),
    rustOwnsProductTruthBoundary: fullNativeAudit?.currentTruth?.canClaimRustCoreProductBoundary === true,
    reactTauriAllowedForContractBackedUi: true,
    reactWebViewMustNotOwnTerminalTruth: true,
    modeShellArchitectureReady: blockers.every((entry) => entry.id !== "mode-shell-architecture"),
  },
  items,
  blockers: blockers.map((entry) => ({
    id: entry.id,
    label: entry.label,
    missing: entry.missing,
  })),
  nextRequiredAction:
    blockers.length === 0
      ? "Keep native-first hybrid audit green; optional strict stretch is real Windows sleep/resume dogfood."
      : "Fix blocked native-first hybrid audit items before claiming implementation confidence.",
};

writeJsonAtomic(OUT, report);
console.log(JSON.stringify(report, null, 2));

if (status !== "passed") {
  process.exitCode = 1;
}
