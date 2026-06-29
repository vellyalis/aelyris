import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import process from "node:process";

const ROOT = resolve(process.cwd());
const OUT = join(ROOT, ".codex-auto", "quality", "native-operator-primary-terminal.json");

const ARTIFACTS = {
  nativeClient: ".codex-auto/quality/native-client-spike.json",
  nativeBoundary: ".codex-auto/quality/native-boundary-contract.json",
  textShaping: ".codex-auto/quality/native-text-shaping-fallback.json",
  nativeInput: ".codex-auto/production-smoke/native-terminal-input-host.json",
  nativePaste: ".codex-auto/production-smoke/native-hwnd-paste-live.json",
  processReconnect: ".codex-auto/production-smoke/process-reconnect-command-evidence.json",
  processReconnectEnvironmentBlocked:
    ".codex-auto/production-smoke/process-reconnect-command-evidence.json.environment-blocked.json",
  chunkedOsc: ".codex-auto/production-smoke/chunked-osc-live.json",
  chunkedOscEnvironmentBlocked: ".codex-auto/production-smoke/chunked-osc-live.environment-blocked.json",
  nativePostcheck:
    ".codex-auto/production-smoke/postcheck-write-smoke/real-os-suspend-native-postcheck-write-smoke.json",
};

const SOURCE_GROUPS = {
  nativeClient: [
    "scripts/verify-native-client-spike.mjs",
    "src-tauri/src/bin/aelyris_native.rs",
    "src-tauri/src/term/mod.rs",
    "src-tauri/src/term/text_shaping.rs",
    "src-tauri/Cargo.toml",
  ],
  nativeBoundary: [
    "scripts/verify-native-boundary-contract.mjs",
    "scripts/verify-mux-live-restore.mjs",
    "src-tauri/src/bin/aelyris_native.rs",
    "src-tauri/src/mux/graph.rs",
    "src-tauri/src/mux/manager.rs",
    "src-tauri/src/mux/store.rs",
  ],
  textShaping: [
    "scripts/verify-native-text-shaping-fallback.mjs",
    "src-tauri/src/bin/aelyris_native.rs",
    "src-tauri/src/term/mod.rs",
    "src-tauri/src/term/text_shaping.rs",
    "src-tauri/Cargo.toml",
  ],
  nativeInput: [
    "scripts/verify-native-terminal-input-host.mjs",
    "src-tauri/src/ipc/commands.rs",
    "src-tauri/src/lib.rs",
    "src-tauri/src/term/mod.rs",
    "src/features/terminal/TerminalCanvas.tsx",
    "src/features/terminal/hooks/useCanvasIME.ts",
    "src/shared/hooks/useEditableTargetGuard.ts",
    "src/shared/hooks/useKeyboardShortcuts.ts",
  ],
  nativePaste: [
    "scripts/verify-native-hwnd-paste-live.mjs",
    "scripts/verify-native-terminal-input-host.mjs",
    "src-tauri/src/ipc/commands.rs",
    "src-tauri/src/lib.rs",
    "src-tauri/src/term/mod.rs",
  ],
  processReconnect: [
    "scripts/verify-process-reconnect-command-evidence.mjs",
    "src-tauri/src/ipc/mux_commands.rs",
    "src-tauri/src/mux/graph.rs",
    "src-tauri/src/mux/manager.rs",
    "src-tauri/src/mux/store.rs",
    "src/features/terminal/pane-tree/persistence.ts",
    "src/features/terminal/pane-tree/types.ts",
  ],
  chunkedOsc: [
    "scripts/verify-chunked-osc-live.mjs",
    "src-tauri/src/pty/manager.rs",
    "src/features/terminal/TerminalCanvas.tsx",
  ],
  nativePostcheck: [
    "scripts/verify-real-os-suspend-evidence.mjs",
    "scripts/verify-native-client-spike.mjs",
    "src-tauri/src/bin/aelyris_native.rs",
  ],
};

const SOURCE_PATHS = Array.from(
  new Set(["scripts/verify-native-operator-primary-terminal.mjs", ...Object.values(SOURCE_GROUPS).flat()]),
);

function pathOf(path) {
  return join(ROOT, path);
}

function mtime(path) {
  const full = pathOf(path);
  return existsSync(full) ? statSync(full).mtimeMs : 0;
}

function readJson(path) {
  const full = pathOf(path);
  if (!existsSync(full)) {
    return null;
  }
  try {
    return JSON.parse(readFileSync(full, "utf8"));
  } catch {
    return null;
  }
}

function writeJsonAtomic(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(tmp, path);
}

function includesCheck(artifact, id) {
  return artifact?.checks?.includes?.(id) === true;
}

function check(id, passed, detail, evidence = {}, options = {}) {
  const externalBlocked = passed !== true && options.externalBlocked === true;
  return {
    id,
    status: passed ? "passed" : externalBlocked ? "external-blocked" : "failed",
    detail,
    evidence,
    ...(externalBlocked ? { externalBlocker: options.externalBlocker ?? detail } : {}),
  };
}

function fresh(path, cutoffMs) {
  return mtime(path) + 5000 >= cutoffMs;
}

function cutoffMsFor(paths) {
  return Math.max(...paths.map(mtime));
}

const sourceCutoffMs = cutoffMsFor(SOURCE_PATHS);
const freshnessCutoffs = Object.fromEntries(
  Object.entries(SOURCE_GROUPS).map(([id, sourcePaths]) => [
    id,
    {
      cutoffMs: cutoffMsFor(sourcePaths),
      sourcePaths,
    },
  ]),
);
function artifactFresh(id) {
  return fresh(ARTIFACTS[id], freshnessCutoffs[id].cutoffMs);
}

function artifactEnvironmentBlocked(artifact) {
  return artifact?.status === "environment-blocked" || artifact?.hostBlocked === true;
}

function hasRealSleepResumeOperatorGate() {
  return (
    nativePostcheck?.checks?.noRealSleepClaim === true ||
    nativePostcheck?.noRealSleepClaim === true ||
    visualQa?.readyForSleepResumeDogfood === true ||
    visualQa?.sleepResumeRecoveryProbe?.readyForRealSleepResumeDogfood === true ||
    primaryShell?.remainingFullNativeBlockers?.includes?.("real-windows-sleep-resume-visual-dogfood") === true
  );
}

const nativeClient = readJson(ARTIFACTS.nativeClient);const nativeBoundary = readJson(ARTIFACTS.nativeBoundary);
const textShaping = readJson(ARTIFACTS.textShaping);
const nativeInput = readJson(ARTIFACTS.nativeInput);
const nativePaste = readJson(ARTIFACTS.nativePaste);
const processReconnect = readJson(ARTIFACTS.processReconnect);
const processReconnectEnvironmentBlocked = readJson(ARTIFACTS.processReconnectEnvironmentBlocked);
const chunkedOsc = readJson(ARTIFACTS.chunkedOsc);
const chunkedOscEnvironmentBlocked = readJson(ARTIFACTS.chunkedOscEnvironmentBlocked);
const nativePostcheck = readJson(ARTIFACTS.nativePostcheck);
const visualQa = nativeClient?.nativeVisualQa?.visualQa;
const primaryShell = nativeClient?.nativePrimaryShell?.primaryShell;

const checks = [
  check(
    "native-client-fresh-green",
    nativeClient?.status === "passed" &&
      artifactFresh("nativeClient") &&
      includesCheck(nativeClient, "native-winit-wgpu-font-atlas-proof") &&
      includesCheck(nativeClient, "native-primary-shell-promotion-proof") &&
      includesCheck(nativeClient, "react-webview-compatibility-only-proof"),
    "fresh native client proof must show no-WebView winit/wgpu terminal, primary-shell promotion, and React/WebView demotion",
    {
      artifact: ARTIFACTS.nativeClient,
      fresh: artifactFresh("nativeClient"),
      cutoffMs: freshnessCutoffs.nativeClient.cutoffMs,
    },
  ),
  check(
    "native-boundary-green",
    nativeBoundary?.ok === true && nativeBoundary?.status === "pass" && artifactFresh("nativeBoundary"),
    "native boundary contract must be green and current before operator-primary claims",
    {
      artifact: ARTIFACTS.nativeBoundary,
      fresh: artifactFresh("nativeBoundary"),
      cutoffMs: freshnessCutoffs.nativeBoundary.cutoffMs,
    },
  ),
  check(
    "native-input-paste-current",
    nativeInput?.ok === true && artifactFresh("nativeInput") && nativePaste?.ok === true && artifactFresh("nativePaste"),
    "native input, IME commit path, and HWND paste guard must be current",
    {
      inputArtifact: ARTIFACTS.nativeInput,
      pasteArtifact: ARTIFACTS.nativePaste,
      inputFresh: artifactFresh("nativeInput"),
      inputCutoffMs: freshnessCutoffs.nativeInput.cutoffMs,
      pasteFresh: artifactFresh("nativePaste"),
      pasteCutoffMs: freshnessCutoffs.nativePaste.cutoffMs,
    },
  ),
  check(
    "system-text-shaping-ready",
    textShaping?.systemTextShapingReady === true &&
      artifactFresh("textShaping") &&
      textShaping?.realFontFallbackReady === true &&
      textShaping?.rendererTextShapingIntegrated === true &&
      textShaping?.rendererFallbackGlyphRasterizationReady === true &&
      textShaping?.unsupportedSystemShaper === false,
    "operator-primary native terminal quality requires DirectWrite system shaping, real font fallback, renderer integration, and fallback glyph rasterization",
    {
      artifact: ARTIFACTS.textShaping,
      systemTextShapingReady: textShaping?.systemTextShapingReady ?? null,
      realFontFallbackReady: textShaping?.realFontFallbackReady ?? null,
      rendererTextShapingIntegrated: textShaping?.rendererTextShapingIntegrated ?? null,
      rendererFallbackGlyphRasterizationReady: textShaping?.rendererFallbackGlyphRasterizationReady ?? null,
      readyForNativeShapingClaim: textShaping?.readyForNativeShapingClaim ?? null,
      unsupportedSystemShaper: textShaping?.unsupportedSystemShaper ?? null,
      fresh: artifactFresh("textShaping"),
      cutoffMs: freshnessCutoffs.textShaping.cutoffMs,
    },
  ),
  check(
    "visual-regression-ready",
    visualQa?.nativeVisualQaHarness === true &&
      visualQa?.pixelProbePass === true &&
      visualQa?.contrastPass === true &&
      visualQa?.resizeProbePass === true &&
      visualQa?.focusCoveragePass === true &&
      visualQa?.sleepResumeDogfood === true &&
      visualQa?.readyForFullNativeClaim === true,
    "native visual regression must prove nonblank rendering, contrast, resize, focus, and real sleep/resume dogfood",
    {
      artifact: ARTIFACTS.nativeClient,
      readyForFullNativeClaim: visualQa?.readyForFullNativeClaim ?? null,
      readyForSleepResumeDogfood: visualQa?.readyForSleepResumeDogfood ?? null,
      sleepResumeDogfood: visualQa?.sleepResumeDogfood ?? null,
      sleepResumeRecoveryProbeReady: visualQa?.sleepResumeRecoveryProbe?.readyForRealSleepResumeDogfood ?? null,
    },
    {
      externalBlocked:
        visualQa?.nativeVisualQaHarness === true &&
        visualQa?.pixelProbePass === true &&
        visualQa?.contrastPass === true &&
        visualQa?.resizeProbePass === true &&
        visualQa?.focusCoveragePass === true &&
        hasRealSleepResumeOperatorGate(),
      externalBlocker:
        "Native visual QA is ready for the real Windows sleep/resume dogfood, but that proof requires an operator-controlled host sleep cycle.",
    },
  ),
  check(
    "primary-shell-operator-primary",
    primaryShell?.readyForFullNativeClaim === true &&
      primaryShell?.primaryShellWindow?.interactiveWindow === true &&
      primaryShell?.primaryShellWindow?.nonBlank === true &&
      primaryShell?.primaryShellWindow?.webviewUsed === false &&
      primaryShell?.primaryShellWindow?.reactUsed === false,
    "primary native shell must be interactive, nonblank, and ready for full-native claim",
    {
      artifact: ARTIFACTS.nativeClient,
      readyForFullNativeClaim: primaryShell?.readyForFullNativeClaim ?? null,
      promotionReady: primaryShell?.promotionReady ?? null,
      remainingFullNativeBlockers: primaryShell?.remainingFullNativeBlockers ?? [],
    },
    {
      externalBlocked:
        primaryShell?.promotionReady === true &&
        primaryShell?.primaryShellWindow?.interactiveWindow === true &&
        primaryShell?.primaryShellWindow?.nonBlank === true &&
        primaryShell?.primaryShellWindow?.webviewUsed === false &&
        primaryShell?.primaryShellWindow?.reactUsed === false &&
        hasRealSleepResumeOperatorGate(),
      externalBlocker:
        "Primary native shell is promoted and nonblank, but the full-native claim is waiting on real Windows sleep/resume visual dogfood.",
    },
  ),
  check(
    "process-reconnect-and-osc-current",
    processReconnect?.ok === true && artifactFresh("processReconnect") && chunkedOsc?.ok === true && artifactFresh("chunkedOsc"),
    "process reconnect and chunked OSC behavior must be current operator-primary evidence",
    {
      processReconnect: ARTIFACTS.processReconnect,
      processReconnectEnvironmentBlocked: ARTIFACTS.processReconnectEnvironmentBlocked,
      chunkedOsc: ARTIFACTS.chunkedOsc,
      chunkedOscEnvironmentBlocked: ARTIFACTS.chunkedOscEnvironmentBlocked,
      processReconnectFresh: artifactFresh("processReconnect"),
      processReconnectEnvironmentBlockedStatus: processReconnectEnvironmentBlocked?.status ?? null,
      processReconnectCutoffMs: freshnessCutoffs.processReconnect.cutoffMs,
      chunkedOscFresh: artifactFresh("chunkedOsc"),
      chunkedOscEnvironmentBlockedStatus: chunkedOscEnvironmentBlocked?.status ?? null,
      chunkedOscCutoffMs: freshnessCutoffs.chunkedOsc.cutoffMs,
    },
    {
      externalBlocked:
        (processReconnect?.ok === true || artifactEnvironmentBlocked(processReconnectEnvironmentBlocked)) &&
        (chunkedOsc?.ok === true || artifactEnvironmentBlocked(chunkedOscEnvironmentBlocked)) &&
        (artifactEnvironmentBlocked(processReconnectEnvironmentBlocked) || artifactEnvironmentBlocked(chunkedOscEnvironmentBlocked)),
      externalBlocker:
        "Process reconnect or chunked OSC operator-primary live proof is blocked by host process/WebView2 policy, with environment-blocked artifacts preserved.",
    },
  ),
  check(
    "native-sleep-resume-postcheck",
    nativePostcheck?.ok === true && nativePostcheck?.checks?.nativeVisual === true && artifactFresh("nativePostcheck"),
    "native operator-primary proof requires a current post-resume visual write smoke",
    {
      artifact: ARTIFACTS.nativePostcheck,
      fresh: artifactFresh("nativePostcheck"),
      cutoffMs: freshnessCutoffs.nativePostcheck.cutoffMs,
      noRealSleepClaim: nativePostcheck?.checks?.noRealSleepClaim ?? nativePostcheck?.noRealSleepClaim ?? null,
    },
    {
      externalBlocked: hasRealSleepResumeOperatorGate(),
      externalBlocker:
        "The native post-resume visual proof requires an operator-controlled real Windows sleep/resume cycle before a operator-primary claim is allowed.",
    },
  ),
];

const failed = checks.filter((item) => item.status === "failed");
const externalBlockedChecks = checks.filter((item) => item.status === "external-blocked");
const ok = failed.length === 0 && externalBlockedChecks.length === 0;
const externallyBlockedOnly = failed.length === 0 && externalBlockedChecks.length > 0;
const report = {
  version: 1,
  ok,
  status: ok ? "pass" : externallyBlockedOnly ? "environment-blocked-current-contract" : "blocked",
  externalBlocked: externallyBlockedOnly,  generatedAt: new Date().toISOString(),
  sourceCutoffMs,
  sourcePaths: SOURCE_PATHS,
  freshnessCutoffs,
  artifactPaths: ARTIFACTS,
  readyForOperatorPrimaryClaim: ok,
  summary: ok
    ? "native operator-primary terminal proof is current"
    : externallyBlockedOnly
      ? `${externalBlockedChecks.length} native operator-primary terminal gates require external host/operator proof`
      : `${failed.length} native operator-primary terminal gates are blocked`,
  blockers: failed.map((item) => item.detail),
  externalBlockers: externalBlockedChecks.map((item) => item.externalBlocker ?? item.detail),
  failedChecks: failed.map((item) => item.id),
  externalBlockedChecks: externalBlockedChecks.map((item) => item.id),
  checks,
};
writeJsonAtomic(OUT, report);
console.log(JSON.stringify(report, null, 2));
if (!report.ok) {
  process.exitCode = 1;
}