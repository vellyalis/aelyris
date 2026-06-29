import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import process from "node:process";

const ROOT = resolve(process.cwd());
const OUT = join(ROOT, ".codex-auto", "quality", "full-native-rust-gap-audit.json");

function source(path) {
  const full = join(ROOT, path);
  return existsSync(full) ? readFileSync(full, "utf8") : "";
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function readJsonTextStable(full) {
  let lastText = "";
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      const text = readFileSync(full, "utf8");
      lastText = text;
      if (text.trim().length > 0) return text;
    } catch {
      // The producer may be replacing the artifact atomically; retry briefly.
    }
    sleepSync(25 * (attempt + 1));
  }
  return lastText;
}

function json(path) {
  const full = join(ROOT, path);
  if (!existsSync(full)) return null;
  try {
    return JSON.parse(readJsonTextStable(full));
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

function mtime(path) {
  const full = join(ROOT, path);
  return existsSync(full) ? statSync(full).mtimeMs : 0;
}

function item(id, label, points, max, passed, detail, missing = []) {
  return {
    id,
    label,
    points: passed ? max : points,
    max,
    status: passed ? "complete" : points > 0 ? "partial" : "missing",
    detail,
    missing: passed ? [] : missing,
  };
}

function nearlyEqual(actual, expected, epsilon = 0.001) {
  return Math.abs(Number(actual) - expected) <= epsilon;
}

const packageJson = source("package.json");
const cargoToml = source("src-tauri/Cargo.toml");
const aetherNative = source("src-tauri/src/bin/aether_native.rs");
const renderFrame = source("src-tauri/src/term/render_frame.rs");
const renderPipeline = source("src-tauri/src/term/render_pipeline.rs");
const nativeInput = source("src-tauri/src/term/native_input.rs");
const ipcCommands = source("src-tauri/src/ipc/commands.rs");
const settingsUi = source("src/features/settings/Settings.tsx");
const rightRailSources = [
  source("src/features/agent-inspector/AgentInspector.tsx"),
  source("src/features/context/LivePanesPanel.tsx"),
  source("src/shared/lib/rightRailGoalTrack.ts"),
  source("src/shared/lib/rightRailAdvisor.ts"),
].join("\n");
const docs = [
  source("docs/history/NATIVE_RUST_WEZTERM_PLUS_MIGRATION_PLAN.md"),
  source("docs/history/RUST_CORE_WEZTERM_TMUX_WIZARD_GOALS.md"),
  source("docs/history/TERMINAL_NATIVE_CORE_AND_EDITOR_DESCOPE_PLAN_2026-05-17.md"),
  source("docs/history/FULL_NATIVE_RUST_FINAL_GOAL.md"),
].join("\n");

const nativeClientPath = ".codex-auto/quality/native-client-spike.json";
const nativeBoundaryPath = ".codex-auto/quality/native-boundary-contract.json";
const nativeInputPath = ".codex-auto/production-smoke/native-terminal-input-host.json";
const finalGoalPath = ".codex-auto/quality/final-goal-audit.json";
const nativeCommandCenterPath = ".codex-auto/quality/native-command-center-proof.json";
const nativeCommandCenterWindowPath = ".codex-auto/quality/native-command-center-window-proof.json";
const nativeCommandCenterInputScrollPath = ".codex-auto/quality/native-command-center-input-scroll-proof.json";
const nativeSettingsWindowPath = ".codex-auto/quality/native-settings-window-proof.json";
const nativeModeShellPath = ".codex-auto/quality/native-mode-shell-proof.json";
const nativeModeRailWindowPath = ".codex-auto/quality/native-mode-rail-window-proof.json";
const nativeInspectorWindowPath = ".codex-auto/quality/native-inspector-window-proof.json";
const nativeRightRailDemotionPath = ".codex-auto/quality/native-right-rail-demotion-proof.json";
const nativeImeDogfoodPath = ".codex-auto/quality/native-ime-hwnd-dogfood-proof.json";
const nativeImeOsDogfoodPath = ".codex-auto/quality/native-ime-os-dogfood-proof.json";
const nativeAccessibilityPath = ".codex-auto/quality/native-accessibility-proof.json";
const nativeUiaProviderPath = ".codex-auto/quality/native-uia-provider-proof.json";
const nativeVisualQaPath = ".codex-auto/quality/native-visual-qa-proof.json";
const nativePrimaryShellPath = ".codex-auto/quality/native-primary-shell-proof.json";
const realOsSuspendPath = ".codex-auto/production-smoke/real-os-suspend-resume.json";
const nativeSleepResumePreflightPath = ".codex-auto/production-smoke/real-os-suspend-native-preflight.json";
const nativePostcheckPreflightPath = ".codex-auto/production-smoke/real-os-suspend-native-postcheck-preflight.json";
const nativePostcheckWriteSmokePath =
  ".codex-auto/production-smoke/postcheck-write-smoke/real-os-suspend-native-postcheck-write-smoke.json";
const nativeSleepGuardPath = ".codex-auto/production-smoke/native-sleep-guard-refusal.json";

const nativeClient = json(nativeClientPath);
const nativeBoundary = json(nativeBoundaryPath);
const nativeInputArtifact = json(nativeInputPath);
const nativeCommandCenterArtifact = json(nativeCommandCenterPath);
const nativeCommandCenterWindowArtifact = json(nativeCommandCenterWindowPath);
const nativeCommandCenterInputScrollArtifact = json(nativeCommandCenterInputScrollPath);
const nativeSettingsWindowArtifact = json(nativeSettingsWindowPath);
const nativeModeShellArtifact = json(nativeModeShellPath);
const nativeModeRailWindowArtifact = json(nativeModeRailWindowPath);
const nativeInspectorWindowArtifact = json(nativeInspectorWindowPath);
const nativeRightRailDemotionArtifact = json(nativeRightRailDemotionPath);
const nativeImeDogfoodArtifact = json(nativeImeDogfoodPath);
const nativeImeOsDogfoodArtifact = json(nativeImeOsDogfoodPath);
const nativeAccessibilityArtifact = json(nativeAccessibilityPath);
const nativeUiaProviderArtifact = json(nativeUiaProviderPath);
const nativeVisualQaArtifact = json(nativeVisualQaPath);
const nativePrimaryShellArtifact = json(nativePrimaryShellPath);
const realOsSuspendArtifact = json(realOsSuspendPath);
const nativeSleepResumePreflightArtifact = json(nativeSleepResumePreflightPath);
const nativePostcheckPreflightArtifact = json(nativePostcheckPreflightPath);
const nativePostcheckWriteSmokeArtifact = json(nativePostcheckWriteSmokePath);
const nativeSleepGuardArtifact = json(nativeSleepGuardPath);
const expectedModeShellIds = ["terminal", "agents", "workspace", "review", "git", "context", "history", "settings"];
const expectedModeShellShortcuts = ["Alt+1", "Alt+2", "Alt+3", "Alt+4", "Alt+5", "Alt+6", "Alt+7", "Alt+8"];

function exactModeShellModes(modeShell) {
  const ids = modeShell?.modes?.map?.((mode) => mode.id) ?? [];
  const shortcuts = modeShell?.modes?.map?.((mode) => mode.shortcut) ?? [];
  return (
    ids.length === expectedModeShellIds.length &&
    ids.every((id, index) => id === expectedModeShellIds[index]) &&
    shortcuts.length === expectedModeShellShortcuts.length &&
    shortcuts.every((shortcut, index) => shortcut === expectedModeShellShortcuts[index])
  );
}

function routeMatches(route, kind, source, path) {
  return route?.kind === kind && route?.source === source && route?.route === path && route?.owner === "rust";
}

function exactNativeSleepResumeRunbook(commandCenter) {
  const actions = commandCenter?.actions;
  if (!Array.isArray(actions)) return false;
  const action = (id) => actions.find((entry) => entry?.id === id);
  const required = [
    ["open-sleep-resume-preflight", "open-native-sleep-resume-preflight"],
    ["arm-native-sleep-resume", "run-proof"],
    ["verify-native-sleep-guard", "run-proof"],
    ["check-native-postcheck-readiness", "run-proof"],
    ["run-native-user-sleep-cycle", "run-user-initiated-host-power-proof"],
    ["run-native-sleep-cycle", "run-guarded-host-power-proof"],
    ["record-native-resume", "run-proof"],
    ["run-native-postcheck", "run-proof"],
    ["run-full-native-audit", "run-proof"],
  ];
  return (
    required.every(([id, operation]) => {
      const entry = action(id);
      return entry?.operation === operation && entry?.requiresReact === false && entry?.requiresWebView === false;
    }) &&
    action("verify-native-sleep-guard")?.provesExplicitOptInBoundary === true &&
    action("verify-native-sleep-guard")?.evidencePath ===
      ".codex-auto/production-smoke/native-sleep-guard-refusal.json" &&
    action("run-native-user-sleep-cycle")?.command === "pnpm verify:production:suspend:native-user-cycle" &&
    action("run-native-user-sleep-cycle")?.requiresUserSleepAction === true &&
    action("run-native-user-sleep-cycle")?.doesNotInvokeSleepApi === true &&
    action("run-native-sleep-cycle")?.requiresExplicitOptIn === true &&
    action("run-native-sleep-cycle")?.explicitOptInEnv === "QUORUM_ALLOW_OS_SLEEP=1"
  );
}

function exactModeShellRoutes(modeShell) {
  const routeMatrix = new Map((modeShell?.routeMatrix ?? []).map((entry) => [entry.mode, entry.selectedEntityRoute]));
  return (
    routeMatches(routeMatrix.get("terminal"), "pane", "mux-daemon", "pane:active") &&
    routeMatches(routeMatrix.get("agents"), "agent-session", "ai-cli-orchestrator", "agent:active") &&
    routeMatches(routeMatrix.get("workspace"), "workspace-item", "project-index", "workspace:selected") &&
    routeMatches(routeMatrix.get("review"), "review-queue", "command-center", "review:ready") &&
    routeMatches(routeMatrix.get("git"), "git-worktree", "git2", "git:worktree") &&
    routeMatches(routeMatrix.get("context"), "context-pack", "context-index", "context:active") &&
    routeMatches(routeMatrix.get("history"), "history-index", "sqlite-scrollback", "history:recent-command") &&
    routeMatches(routeMatrix.get("settings"), "settings-profile", "rust-config", "settings:active-profile")
  );
}

function exactModeShellProof(container) {
  const commandCenter = container?.commandCenter;
  const modeShell = container?.modeShell;
  return (
    commandCenter?.schema === "aether.native.command-center-proof.v1" &&
    modeShell?.schema === "aether.native.mode-shell.v1" &&
    modeShell?.nativeModeShell === true &&
    modeShell?.webviewUsed === false &&
    modeShell?.reactUsed === false &&
    exactModeShellModes(modeShell) &&
    modeShell?.selectedMode === "terminal" &&
    routeMatches(modeShell?.selectedEntityRoute, "pane", "mux-daemon", "pane:active") &&
    exactModeShellRoutes(modeShell) &&
    modeShell?.modeRail?.schema === "aether.native.mode-rail.v1" &&
    modeShell?.modeRail?.modeCount === 8 &&
    modeShell?.modeRail?.shortcuts?.join?.("|") === expectedModeShellShortcuts.join("|") &&
    modeShell?.modeRail?.keyboardFirst === true &&
    modeShell?.modeRail?.shortcutsStable === true &&
    modeShell?.modeRail?.webviewUsed === false &&
    modeShell?.modeRail?.reactUsed === false &&
    modeShell?.inspector?.schema === "aether.native.inspector.v1" &&
    modeShell?.inspector?.contextualInspector === true &&
    modeShell?.inspector?.commandCenterBacked === true &&
    modeShell?.inspector?.evidenceRows === commandCenter?.evidence?.length &&
    modeShell?.inspector?.actionsCount === commandCenter?.actions?.length &&
    modeShell?.inspector?.blockerCount === commandCenter?.blockerCount &&
    modeShell?.inspector?.webviewUsed === false &&
    modeShell?.inspector?.reactUsed === false &&
    modeShell?.rightInspectorContractId === "aether.native.inspector.v1:command-center" &&
    modeShell?.guardrails?.modeCountAtLeastEight === true &&
    modeShell?.guardrails?.selectedIndexInBounds === true &&
    modeShell?.guardrails?.noReactDependency === true &&
    modeShell?.guardrails?.noWebViewDependency === true &&
    modeShell?.readyForReactDemotion === false &&
    modeShell?.nextProof === "native-mode-rail-window-proof"
  );
}

function exactModeRailWindowProof(container) {
  const window = container?.window;
  return (
    container?.operation === "mode-rail-window-proof" &&
    container?.modeShell?.schema === "aether.native.mode-shell.v1" &&
    window?.schema === "aether.native.mode-rail-window-proof.v1" &&
    window?.nativeModeRailWindow === true &&
    window?.nativeModeRail === true &&
    window?.windowUi === true &&
    window?.interactiveWindow === true &&
    window?.layered === true &&
    window?.webviewUsed === false &&
    window?.reactUsed === false &&
    window?.selectedMode === "terminal" &&
    window?.focusedMode === "terminal" &&
    window?.modeRowsRendered === 8 &&
    window?.hitTargetCount === 8 &&
    window?.hitTargets?.length === 8 &&
    window?.hitTargets?.every?.(
      (target, index) => target.id === expectedModeShellIds[index] && target.shortcut === expectedModeShellShortcuts[index],
    ) &&
    window?.keyboardNavigation === true &&
    window?.keyboardTransitions?.length >= 5 &&
    window?.nonBlank === true &&
    window?.readyForReactDemotion === false &&
    window?.nextProof === "native-inspector-window-proof"
  );
}

function exactInspectorWindowProof(container) {
  const commandCenter = container?.commandCenter;
  const window = container?.window;
  return (
    container?.operation === "inspector-window-proof" &&
    commandCenter?.schema === "aether.native.command-center-proof.v1" &&
    container?.modeShell?.schema === "aether.native.mode-shell.v1" &&
    window?.schema === "aether.native.inspector-window-proof.v1" &&
    window?.nativeInspectorWindow === true &&
    window?.nativeContextualInspector === true &&
    window?.windowUi === true &&
    window?.interactiveWindow === true &&
    window?.layered === true &&
    window?.webviewUsed === false &&
    window?.reactUsed === false &&
    window?.selectedMode === "terminal" &&
    window?.rightInspectorContractId === "aether.native.inspector.v1:command-center" &&
    window?.inspector?.schema === "aether.native.inspector.v1" &&
    window?.commandCenterBacked === true &&
    window?.contextualInspector === true &&
    window?.evidenceRowsTotal === commandCenter?.evidence?.length &&
    window?.actionRowsTotal === commandCenter?.actions?.length &&
    window?.evidenceRowsRendered === Math.min(commandCenter?.evidence?.length ?? 0, 5) &&
    window?.actionRowsRendered === Math.min(commandCenter?.actions?.length ?? 0, window?.visibleRows ?? 0) &&
    window?.actionHitTargets?.length >= 1 &&
    window?.keyboardSelection === true &&
    window?.scrollModel === true &&
    window?.keyboardTransitions?.length >= 5 &&
    window?.guardrails?.selectedActionInBounds === true &&
    window?.guardrails?.scrollOffsetInBounds === true &&
    window?.guardrails?.dispatchDoesNotRequireReact === true &&
    window?.guardrails?.dispatchDoesNotRequireWebView === true &&
    window?.nonBlank === true &&
    window?.readyForReactDemotion === false &&
    window?.nextProof === "react-right-rail-compatibility-demotion"
  );
}

function exactRightRailDemotionProof(container) {
  const demotion = container?.rightRailDemotion;
  return (
    container?.operation === "right-rail-demotion-proof" &&
    container?.commandCenter?.schema === "aether.native.command-center-proof.v1" &&
    container?.modeShell?.schema === "aether.native.mode-shell.v1" &&
    demotion?.schema === "aether.native.right-rail-demotion-proof.v1" &&
    demotion?.nativeRightRailDemotionProof === true &&
    demotion?.sourceOfTruth === "rust-native-command-center-mode-shell-inspector" &&
    demotion?.webviewUsed === false &&
    demotion?.reactUsed === false &&
    demotion?.nativeProductPathReady === true &&
    demotion?.nativePrerequisites?.length >= 7 &&
    demotion?.nativePrerequisites?.every?.((entry) => entry.complete === true) &&
    demotion?.reactCompatibilityOnly === true &&
    demotion?.reactRightRailSourcesPresent === true &&
    demotion?.reactSourcesMarkedCompatibilityOnly === true &&
    demotion?.compatibilityStatus === "react-right-rail-compatibility-only" &&
    demotion?.compatibilityClients?.length >= 4 &&
    demotion?.compatibilityClients?.every?.(
      (entry) =>
        entry.compatibilityMarkerPresent === true &&
        entry.compatibilityRole === "legacy-tauri-react-client" &&
        entry.reactOwnsProductTruth === false &&
        entry.webviewDispatchRequired === false,
    ) &&
    demotion?.nativeReplacementMap?.length >= 4 &&
    demotion?.guardrails?.doesNotClaimReactRemoved === true &&
    demotion?.guardrails?.compatibilityOnlyClaimBackedByMarkers === true &&
    demotion?.guardrails?.reactSourcesMarkedCompatibilityOnly === true &&
    demotion?.guardrails?.reactProductTruthDisabled === true &&
    demotion?.guardrails?.nativeReplacementReadyBeforeDemotion === true &&
    demotion?.reactDemotionComplete === true &&
    demotion?.readyForReactDemotion === false &&
    demotion?.readyForFullNativeClaim === false &&
    demotion?.nextProof === "aether-native-primary-daily-driver-promotion"
  );
}

function exactSettingsWindowProof(container) {
  const window = container?.window;
  return (
    container?.operation === "settings-window-proof" &&
    container?.settings?.schema === "aether.native.settings-proof.v1" &&
    container?.settings?.nativeSettings === true &&
    container?.settings?.webviewUsed === false &&
    container?.settings?.reactUsed === false &&
    container?.settings?.hotReloadProof?.changedWithoutReact === true &&
    window?.schema === "aether.native.settings-window-proof.v1" &&
    window?.nativeSettingsWindow === true &&
    window?.nativeSettingsCustomization === true &&
    window?.windowUi === true &&
    window?.interactiveWindow === true &&
    window?.layered === true &&
    window?.webviewUsed === false &&
    window?.reactUsed === false &&
    window?.controlRowsRendered >= 8 &&
    window?.controlHitTargets?.length >= 8 &&
    window?.keyboardNavigation === true &&
    window?.keyboardTransitions?.length >= 5 &&
    window?.hotReloadBound === true &&
    window?.wallpaperControls?.includes?.("opacity") &&
    window?.wallpaperControls?.includes?.("scale") &&
    window?.materialControls?.includes?.("panel") &&
    window?.nonBlank === true &&
    window?.settingsUiStatus === "native-settings-window-ui" &&
    window?.readyForReactSettingsDemotion === true &&
    window?.readyForFullNativeClaim === false &&
    window?.nextProof === "react-settings-compatibility-demotion"
  );
}

function exactImeHwndDogfoodProof(container) {
  const dogfood = container?.imeDogfood;
  return (
    container?.operation === "ime-dogfood-proof" &&
    dogfood?.schema === "aether.native.ime-dogfood-proof.v1" &&
    dogfood?.mode === "native-hwnd-message-loop-dogfood" &&
    dogfood?.nativeHwndImeDogfood === true &&
    dogfood?.nativeCompositionSurfaceReady === true &&
    dogfood?.webviewCompositionBridgeRequired === false &&
    dogfood?.imeStartCompositionObserved === true &&
    dogfood?.committedText === "あいう" &&
    dogfood?.committedTextMatches === true &&
    dogfood?.directPtyCommitCount === 1 &&
    dogfood?.aiCliPromptRows?.length === 3 &&
    dogfood?.aiCliPromptRows?.every?.(
      (row) => ["codex", "claude", "gemini"].includes(row.provider) && row.committedLineVisible === true,
    ) &&
    dogfood?.aiCliPromptDogfood === true &&
    dogfood?.webviewUsed === false &&
    dogfood?.reactUsed === false &&
    dogfood?.realOsImeDogfood === false &&
    dogfood?.nextProof === "real-os-ime-composition-dogfood"
  );
}

function exactImeOsDogfoodProof(container) {
  const dogfood = container?.imeOsDogfood;
  return (
    container?.operation === "ime-os-dogfood-proof" &&
    dogfood?.schema === "aether.native.ime-os-dogfood-proof.v1" &&
    dogfood?.mode === "win32-imm32-composition-dogfood" &&
    dogfood?.nativeOsImeDogfood === true &&
    dogfood?.imeApi === "Imm32" &&
    dogfood?.imeContextAvailable === true &&
    dogfood?.imeSetOpenStatusOk === true &&
    dogfood?.immSetPreeditOk === true &&
    dogfood?.immSetResultOk === true &&
    dogfood?.immNotifyCompleteOk === true &&
    dogfood?.nativeCompositionSurfaceReady === true &&
    dogfood?.webviewCompositionBridgeRequired === false &&
    dogfood?.imeStartCompositionObserved === true &&
    (dogfood?.preeditTextMatches === true || dogfood?.manualJapaneseImeCandidateDogfood === false) &&
    dogfood?.committedText === "あいう" &&
    dogfood?.committedTextMatches === true &&
    dogfood?.directPtyCommitCount === 1 &&
    dogfood?.aiCliPromptRows?.length === 3 &&
    dogfood?.aiCliPromptRows?.every?.(
      (row) => ["codex", "claude", "gemini"].includes(row.provider) && row.committedLineVisible === true,
    ) &&
    dogfood?.aiCliPromptDogfood === true &&
    dogfood?.webviewUsed === false &&
    dogfood?.reactUsed === false &&
    dogfood?.realOsImeDogfood === true &&
    dogfood?.tsfCandidateUiDogfood === false &&
    dogfood?.manualJapaneseImeCandidateDogfood === false &&
    dogfood?.guardrails?.noWmCharCommitFallback === true &&
    dogfood?.guardrails?.commitReadFromNativeImeResultString === true &&
    dogfood?.nextProof === "native-ime-manual-japanese-candidate-sweep"
  );
}

function exactAccessibilityTreeProof(container) {
  const accessibility = container?.accessibility;
  return (
    container?.operation === "accessibility-proof" &&
    accessibility?.schema === "aether.native.accessibility-proof.v1" &&
    accessibility?.nativeAccessibilityTreeProof === true &&
    accessibility?.mode === "semantic-tree-proof" &&
    accessibility?.webviewUsed === false &&
    accessibility?.reactUsed === false &&
    accessibility?.namedNodes >= 16 &&
    accessibility?.unnamedNodes === 0 &&
    accessibility?.focusableNodes >= 12 &&
    accessibility?.keyboardTraversal === true &&
    accessibility?.roles?.includes?.("window") &&
    accessibility?.roles?.includes?.("terminal") &&
    accessibility?.roles?.includes?.("button") &&
    accessibility?.roles?.includes?.("tab") &&
    accessibility?.guardrails?.noUnnamedFocusableNodes === true &&
    accessibility?.guardrails?.actionsDoNotRequireReact === true &&
    accessibility?.guardrails?.actionsDoNotRequireWebView === true &&
    accessibility?.accessibilityApisPlanned?.includes?.("UIAutomation") &&
    accessibility?.accessibilityApisPlanned?.includes?.("accesskit") &&
    accessibility?.readyForNativeUiaProvider === true &&
    accessibility?.screenReaderProviderReady === false &&
    accessibility?.readyForFullNativeClaim === false &&
    accessibility?.nextProof === "native-uia-provider-dogfood"
  );
}

function exactUiaProviderProof(container) {
  const provider = container?.uiaProvider;
  return (
    container?.operation === "uia-provider-proof" &&
    provider?.schema === "aether.native.uia-provider-proof.v1" &&
    provider?.nativeUiaProviderDogfood === true &&
    provider?.mode === "win32-uia-client-dogfood" &&
    provider?.webviewUsed === false &&
    provider?.reactUsed === false &&
    provider?.uiaProviderBound === true &&
    provider?.elementFromHandle === true &&
    provider?.root?.name === "Aether Native Accessibility Dogfood" &&
    provider?.descendantCount >= 3 &&
    provider?.dogfoodChecks?.rootNameReadable === true &&
    provider?.dogfoodChecks?.terminalNameReadable === true &&
    provider?.dogfoodChecks?.actionNameReadable === true &&
    provider?.dogfoodChecks?.settingsNameReadable === true &&
    provider?.dogfoodChecks?.buttonInvokePatternAvailable === true &&
    provider?.dogfoodChecks?.buttonInvokedThroughUia === true &&
    provider?.screenReaderProviderReady === true &&
    provider?.manualNarratorDogfood === false &&
    provider?.guardrails?.noReactDependency === true &&
    provider?.guardrails?.noWebViewDependency === true &&
    provider?.guardrails?.uiaClientObservedNativeHwnd === true &&
    provider?.guardrails?.invokeDidNotUseDomClick === true &&
    provider?.readyForFullNativeClaim === false &&
    provider?.nextProof === "native-accessibility-manual-screen-reader-sweep"
  );
}

function exactVisualQaHarnessProof(container) {
  const visualQa = container?.visualQa;
  return (
    container?.operation === "visual-qa-proof" &&
    visualQa?.schema === "aether.native.visual-qa-proof.v1" &&
    visualQa?.nativeVisualQaHarness === true &&
    visualQa?.mode === "native-pixel-contrast-harness" &&
    visualQa?.webviewUsed === false &&
    visualQa?.reactUsed === false &&
    visualQa?.allRequiredSurfacesComplete === true &&
    visualQa?.allRequiredSurfacesNonBlank === true &&
    visualQa?.surfaceCount >= 7 &&
    visualQa?.nonblankSurfaceCount >= 6 &&
    visualQa?.contrastPass === true &&
    visualQa?.contrastPairs?.length >= 4 &&
    visualQa?.contrastPairs?.every?.((pair) => pair.wcagAaText === true && pair.ratio >= 4.5) &&
    visualQa?.pixelProbePass === true &&
    visualQa?.pixelProbe?.schema === "aether.native.visual-pixel-probe.v1" &&
    visualQa?.pixelProbe?.webviewCdpUsed === false &&
    visualQa?.pixelProbe?.nonBlank === true &&
    visualQa?.resizeProbePass === true &&
    visualQa?.focusCoveragePass === true &&
    visualQa?.sleepResumeRecoveryProbe?.schema === "aether.native.sleep-resume-recovery-probe.v1" &&
    visualQa?.sleepResumeRecoveryProbe?.syntheticPowerBroadcastDogfood === true &&
    visualQa?.sleepResumeRecoveryProbe?.realWindowsSleepResumeDogfood === false &&
    visualQa?.sleepResumeRecoveryProbe?.doesNotClaimMachineSleep === true &&
    visualQa?.sleepResumeRecoveryProbe?.wmPowerBroadcastObserved === true &&
    visualQa?.sleepResumeRecoveryProbe?.postResumeVisualNonBlank === true &&
    visualQa?.sleepResumeRecoveryProbe?.readyForRealSleepResumeDogfood === true &&
    visualQa?.sleepResumeRecoveryProbePass === true &&
    visualQa?.sleepResumeDogfood === false &&
    visualQa?.readyForSleepResumeDogfood === true &&
    visualQa?.readyForFullNativeClaim === false &&
    visualQa?.nextProof === "native-sleep-resume-visual-dogfood"
  );
}

function exactPrimaryShellProof(container) {
  const primary = container?.primaryShell;
  return (
    container?.operation === "primary-shell-proof" &&
    primary?.schema === "aether.native.primary-shell-proof.v1" &&
    primary?.nativePrimaryShellPromotion === true &&
    primary?.primarySurface === "aether-native" &&
    primary?.launchProfile === "native-primary" &&
    primary?.productTruthOwner === "rust-native-shell" &&
    primary?.reactWebViewCompatibilityOnly === true &&
    primary?.reactOwnsProductTruth === false &&
    primary?.webviewOwnsTerminal === false &&
    primary?.webviewUsed === false &&
    primary?.reactUsed === false &&
    primary?.promotionReady === true &&
    primary?.prerequisites?.length >= 8 &&
    primary?.prerequisites?.every?.((entry) => entry.complete === true) &&
    primary?.primaryShellWindow?.schema === "aether.native.primary-shell-window-proof.v1" &&
    primary?.primaryShellWindow?.nativePrimaryShellWindow === true &&
    primary?.primaryShellWindow?.nonBlank === true &&
    primary?.primaryShellWindow?.modeRowsRendered >= 8 &&
    primary?.primaryShellWindow?.actionRowsRendered >= 4 &&
    primary?.primaryShellWindow?.webviewUsed === false &&
    primary?.primaryShellWindow?.reactUsed === false &&
    primary?.guardrails?.doesNotRemoveReactShell === true &&
    primary?.guardrails?.primaryLaunchDoesNotUseWebView === true &&
    primary?.guardrails?.primaryLaunchDoesNotUseReact === true &&
    primary?.readyForFullNativeClaim === false &&
    primary?.nextProof === "real-windows-sleep-resume-dogfood"
  );
}

function exactRealOsNativeSleepResumeDogfood(evidence) {
  const appPath = String(evidence?.app?.executable ?? "").toLowerCase();
  const resumedAt = Date.parse(evidence?.suspend?.resumedAt ?? "");
  const resumeAfterPrimaryProof =
    Number.isFinite(resumedAt) && resumedAt >= Math.floor(mtime(nativePrimaryShellPath));
  const postResume = evidence?.validation?.postResumeProbes;
  const processProbe = postResume?.process;
  const windowsPowerEvents = evidence?.validation?.windowsPowerEvents;
  return (
    evidence?.status === "pass" &&
    appPath.includes("aether-native") &&
    evidence?.app?.processName === "aether-native" &&
    evidence?.app?.targetKind === "aether-native-primary-shell" &&
    evidence?.validation?.suspendTarget?.targetKind === "aether-native-primary-shell" &&
    evidence?.validation?.suspendTarget?.nativePrimaryRequested === true &&
    evidence?.validation?.suspendTarget?.launchNativePrimaryRequested === true &&
    evidence?.validation?.nativePrimaryLaunch?.requested === true &&
    evidence?.validation?.nativePrimaryLaunch?.ok === true &&
    evidence?.validation?.nativePrimaryLaunch?.status === "launched" &&
    Number(evidence?.validation?.nativePrimaryLaunch?.pid ?? 0) > 0 &&
    Number(evidence?.suspend?.approximateDurationSeconds ?? 0) >= 10 &&
    evidence?.checks?.appResponsive === true &&
    evidence?.checks?.terminalResponsive === true &&
    evidence?.checks?.sqliteWritable === true &&
    evidence?.checks?.paneStatePreserved === true &&
    windowsPowerEvents?.source === "aether-native-power-events-proof" &&
    windowsPowerEvents?.nativeWindowsEventLog === true &&
    windowsPowerEvents?.powershellUsed === false &&
    windowsPowerEvents?.suspendEventFound === true &&
    windowsPowerEvents?.resumeEventFound === true &&
    processProbe?.ok === true &&
    processProbe?.expectedProcessName === "aether-native" &&
    Number(processProbe?.matchingProcessCount ?? 0) >= 1 &&
    processProbe?.processes?.some?.((entry) => entry.matchesExecutable === true) === true &&
    postResume?.apiHealth?.ok === true &&
    postResume?.terminalRoundtrip?.ok === true &&
    postResume?.dbPaneLayout?.ok === true &&
    postResume?.nativeVisual?.ok === true &&
    postResume?.nativeVisual?.visualQa?.pixelProbePass === true &&
    postResume?.nativeVisual?.visualQa?.contrastPass === true &&
    postResume?.nativeVisual?.visualQa?.resizeProbePass === true &&
    postResume?.nativeVisual?.visualQa?.focusCoveragePass === true &&
    postResume?.nativeVisual?.visualQa?.webviewUsed === false &&
    postResume?.nativeVisual?.visualQa?.reactUsed === false &&
    postResume?.nativeVisual?.primaryShell?.nativePrimaryShellWindow === true &&
    postResume?.nativeVisual?.primaryShell?.interactiveWindow === true &&
    postResume?.nativeVisual?.primaryShell?.nonBlank === true &&
    postResume?.nativeVisual?.primaryShell?.webviewUsed === false &&
    postResume?.nativeVisual?.primaryShell?.reactUsed === false &&
    resumeAfterPrimaryProof
  );
}

const nativeClientFresh =
  nativeClient?.status === "passed" &&
  mtime(nativeClientPath) + 5_000 >=
    Math.max(
      mtime("scripts/verify-native-client-spike.mjs"),
      mtime("src-tauri/src/bin/aether_native.rs"),
      mtime("src-tauri/src/term/render_frame.rs"),
      mtime("src-tauri/src/term/render_pipeline.rs"),
    );

const nativeBoundaryFresh =
  (nativeBoundary?.status === "passed" || nativeBoundary?.status === "pass") &&
  mtime(nativeBoundaryPath) + 5_000 >=
    Math.max(mtime("scripts/verify-native-boundary-contract.mjs"), mtime("src-tauri/src/bin/aether_native.rs"));

const nativeInputFresh =
  nativeInputArtifact?.status === "pass" &&
  mtime(nativeInputPath) + 5_000 >=
    Math.max(mtime("scripts/verify-native-terminal-input-host.mjs"), mtime("src-tauri/src/term/native_input.rs"));

const hasReactWebViewShell =
  packageJson.includes('"react"') &&
  packageJson.includes('"@tauri-apps/api"') &&
  packageJson.includes('"@monaco-editor/react"');

const hasNativeClientContract =
  cargoToml.includes('name = "aether-native"') &&
  aetherNative.includes("full_native_readiness_contract") &&
  aetherNative.includes("aether.full-native-readiness.v1") &&
  aetherNative.includes('"daily-driver no-WebView Rust client"');

const hasRenderFrameContract =
  renderFrame.includes("aether.native.render-frame.v1") &&
  renderPipeline.includes("winit-wgpu-present-loop") &&
  nativeClient?.nativeGridRender?.renderFrame?.schema === "aether.native.render-frame.v1" &&
  nativeClient?.nativeGridRender?.renderer?.renderFrameSha256 === nativeClient?.nativeGridRender?.renderFrame?.frameSha256;

const hasNoWebViewNativeProof =
  nativeClient?.nativeContract?.client?.process === "aether-native" &&
  nativeClient?.nativeWindow?.window?.webviewUsed === false &&
  nativeClient?.nativeGridRender?.renderer?.webviewUsed === false &&
  nativeClient?.checks?.includes?.("native-client-no-webview-boundary") &&
  nativeClient?.checks?.includes?.("native-window-proof-no-webview") &&
  nativeClient?.checks?.includes?.("native-grid-render-proof-uses-term-engine");

const hasNativePresentLoop =
  aetherNative.includes('"present-loop-proof"') &&
  aetherNative.includes("native_present_loop_proof") &&
  nativeClient?.nativePresentLoop?.operation === "present-loop-proof" &&
  nativeClient?.nativePresentLoop?.presentLoop?.terminalRenderer === "native-win32-present-loop-proof" &&
  nativeClient?.nativePresentLoop?.presentLoop?.presentLoop === true &&
  nativeClient?.nativePresentLoop?.presentLoop?.interactiveWindow === true &&
  nativeClient?.nativePresentLoop?.presentLoop?.framesPresented >= 2 &&
  nativeClient?.nativePresentLoop?.presentLoop?.nonBlank === true &&
  nativeClient?.nativePresentLoop?.presentLoop?.webviewUsed === false &&
  nativeClient?.nativePresentLoop?.presentLoop?.reactUsed === false &&
  nativeClient?.nativePresentLoop?.presentLoop?.renderFrameSha256 ===
    nativeClient?.nativePresentLoop?.renderFrame?.frameSha256 &&
  nativeClient?.checks?.includes?.("native-present-loop-proof") &&
  nativeClient?.checks?.includes?.("native-present-loop-nonblank-frames");

const hasNativeInputProof =
  nativeInput.includes("NativeTerminalInputHost") &&
  (nativeInput.includes("pub fn preedit") || ipcCommands.includes("native_terminal_input_preedit")) &&
  nativeInputArtifact?.checks?.some?.((check) => check?.id === "surface-ime-preedit-hidden") &&
  nativeInputArtifact?.checks?.some?.((check) => check?.id === "behavioral-native-hwnd-paste-live");

const hasGpuRenderProof =
  /\bwgpu\b/.test(cargoToml) &&
  aetherNative.includes('"gpu-render-proof"') &&
  aetherNative.includes("native_gpu_render_proof") &&
  nativeClient?.nativeGpuRender?.operation === "gpu-render-proof" &&
  nativeClient?.nativeGpuRender?.renderFrame?.schema === "aether.native.render-frame.v1" &&
  nativeClient?.nativeGpuRender?.gpu?.terminalRenderer === "wgpu-offscreen-frame-proof" &&
  nativeClient?.nativeGpuRender?.gpu?.gpuRenderer === true &&
  nativeClient?.nativeGpuRender?.gpu?.renderFrameSha256 === nativeClient?.nativeGpuRender?.renderFrame?.frameSha256 &&
  nativeClient?.nativeGpuRender?.gpu?.webviewUsed === false &&
  nativeClient?.nativeGpuRender?.gpu?.reactUsed === false &&
  nativeClient?.checks?.includes?.("native-gpu-render-proof") &&
  nativeClient?.checks?.includes?.("native-gpu-render-frame-contract");
const hasWinitWgpuSurfaceProof =
  /\bwgpu\b/.test(cargoToml) &&
  /\bwinit\b/.test(cargoToml) &&
  aetherNative.includes("winit-wgpu-surface-present-loop") &&
  aetherNative.includes("native-winit-wgpu-terminal") &&
  nativeClient?.nativeWinitWgpu?.operation === "winit-wgpu-proof" &&
  nativeClient?.nativeWinitWgpu?.renderFrame?.schema === "aether.native.render-frame.v1" &&
  nativeClient?.nativeWinitWgpu?.winitWgpu?.terminalRenderer === "native-winit-wgpu-terminal" &&
  nativeClient?.nativeWinitWgpu?.winitWgpu?.renderer === "winit-wgpu-surface-present-loop" &&
  nativeClient?.nativeWinitWgpu?.winitWgpu?.gpuRenderer === true &&
  nativeClient?.nativeWinitWgpu?.winitWgpu?.presentableSurface === true &&
  nativeClient?.nativeWinitWgpu?.winitWgpu?.surfaceConfigured === true &&
  nativeClient?.nativeWinitWgpu?.winitWgpu?.framesPresented >= 2 &&
  nativeClient?.nativeWinitWgpu?.winitWgpu?.renderFrameSha256 === nativeClient?.nativeWinitWgpu?.renderFrame?.frameSha256 &&
  nativeClient?.nativeWinitWgpu?.winitWgpu?.webviewUsed === false &&
  nativeClient?.nativeWinitWgpu?.winitWgpu?.reactUsed === false &&
  nativeClient?.checks?.includes?.("native-winit-wgpu-surface-proof") &&
  nativeClient?.checks?.includes?.("native-winit-wgpu-frame-contract");
const hasWinitWgpuDirtyRectCellProof =
  hasWinitWgpuSurfaceProof &&
  nativeClient?.nativeWinitWgpu?.winitWgpu?.terminalGlyphQuads > 0 &&
  nativeClient?.nativeWinitWgpu?.winitWgpu?.cursorQuads >= 1 &&
  nativeClient?.nativeWinitWgpu?.winitWgpu?.dirtyRectDogfood === true &&
  nativeClient?.nativeWinitWgpu?.winitWgpu?.dirtyRectsRendered > 0 &&
  nativeClient?.nativeWinitWgpu?.winitWgpu?.dirtyCells > 0;
const hasWinitWgpuFontAtlasTerminal =
  hasWinitWgpuDirtyRectCellProof &&
  nativeClient?.nativeWinitWgpu?.winitWgpu?.glyphMode === "font-atlas" &&
  nativeClient?.nativeWinitWgpu?.winitWgpu?.fontAtlas === true &&
  nativeClient?.nativeWinitWgpu?.winitWgpu?.fontAtlasGlyphs > 0 &&
  Boolean(nativeClient?.nativeWinitWgpu?.winitWgpu?.fontAtlasFontPath) &&
  nativeClient?.checks?.includes?.("native-winit-wgpu-font-atlas-proof");
const hasNativeImeStateProof =
  nativeClient?.nativeIme?.operation === "ime-proof" &&
  nativeClient?.nativeIme?.ime?.schema === "aether.native.ime-proof.v1" &&
  nativeClient?.nativeIme?.ime?.nativeImeStateMachine === true &&
  nativeClient?.nativeIme?.ime?.nativePreeditOverlay === true &&
  nativeClient?.nativeIme?.ime?.nativeCommitPath === true &&
  nativeClient?.nativeIme?.ime?.preedit?.active === true &&
  nativeClient?.nativeIme?.ime?.preedit?.text === "あああ" &&
  nativeClient?.nativeIme?.ime?.commit?.active === false &&
  nativeClient?.nativeIme?.ime?.commit?.text === "あいう" &&
  nativeClient?.nativeIme?.ime?.committedLineVisible === true &&
  nativeClient?.nativeIme?.ime?.webviewUsed === false &&
  nativeClient?.nativeIme?.ime?.reactUsed === false &&
  nativeClient?.nativeIme?.ime?.realOsImeDogfood === false &&
  nativeClient?.checks?.includes?.("native-ime-state-machine-proof") &&
  nativeClient?.checks?.includes?.("native-ime-preedit-anchor-proof") &&
  nativeClient?.checks?.includes?.("native-ime-commit-render-frame-proof");
const hasNativeImeHwndDogfoodClientProof =
  exactImeHwndDogfoodProof(nativeClient?.nativeImeDogfood) &&
  nativeClient?.checks?.includes?.("native-ime-hwnd-dogfood-proof") &&
  nativeClient?.checks?.includes?.("native-ime-ai-cli-prompt-row-proof") &&
  nativeClient?.checks?.includes?.("native-ime-dogfood-honesty-proof");
const hasNativeImeHwndDogfoodStandaloneProof =
  exactImeHwndDogfoodProof(nativeImeDogfoodArtifact) &&
  mtime(nativeImeDogfoodPath) + 5_000 >=
    Math.max(mtime("src-tauri/src/bin/aether_native.rs"), mtime("scripts/verify-full-native-rust-gap-audit.mjs"));
const hasNativeImeHwndDogfood = hasNativeImeHwndDogfoodClientProof || hasNativeImeHwndDogfoodStandaloneProof;
const hasNativeImeOsDogfoodClientProof =
  exactImeOsDogfoodProof(nativeClient?.nativeImeOsDogfood) &&
  nativeClient?.checks?.includes?.("native-ime-os-composition-proof") &&
  nativeClient?.checks?.includes?.("native-ime-os-result-commit-proof") &&
  nativeClient?.checks?.includes?.("native-ime-os-ai-cli-prompt-proof");
const hasNativeImeOsDogfoodStandaloneProof =
  exactImeOsDogfoodProof(nativeImeOsDogfoodArtifact) &&
  mtime(nativeImeOsDogfoodPath) + 5_000 >=
    Math.max(mtime("src-tauri/src/bin/aether_native.rs"), mtime("scripts/verify-full-native-rust-gap-audit.mjs"));
const hasNativeImeDogfood = hasNativeImeOsDogfoodClientProof || hasNativeImeOsDogfoodStandaloneProof;
const hasNativeSettingsProof =
  nativeClient?.nativeSettings?.operation === "settings-proof" &&
  nativeClient?.nativeSettings?.settings?.schema === "aether.native.settings-proof.v1" &&
  nativeClient?.nativeSettings?.settings?.nativeSettings === true &&
  nativeClient?.nativeSettings?.settings?.webviewUsed === false &&
  nativeClient?.nativeSettings?.settings?.reactUsed === false &&
  nativeClient?.nativeSettings?.settings?.theme === "sakura-hub" &&
  nativeClient?.nativeSettings?.settings?.mood === "aether-sakura" &&
  nativeClient?.nativeSettings?.settings?.hotReloadProof?.changedWithoutReact === true &&
  nativeClient?.nativeSettings?.settings?.paletteProof?.accentCount >= 3 &&
  nativeClient?.nativeSettings?.settings?.materialProof?.panelColor === "#fff2f7" &&
  nativeClient?.nativeSettings?.settings?.wallpaperProof?.imagePath === "C:\\Images\\aether-native-sakura.jpg" &&
  nearlyEqual(nativeClient?.nativeSettings?.settings?.wallpaperProof?.opacity, 0.31) &&
  nativeClient?.checks?.includes?.("native-settings-config-roundtrip-proof") &&
  nativeClient?.checks?.includes?.("native-settings-hot-reload-proof") &&
  nativeClient?.checks?.includes?.("native-settings-wallpaper-customization-proof") &&
  nativeClient?.checks?.includes?.("native-settings-material-customization-proof");
const hasNativeSettingsWindowClientProof =
  exactSettingsWindowProof(nativeClient?.nativeSettingsWindow) &&
  nativeClient?.checks?.includes?.("native-settings-window-ui-proof") &&
  nativeClient?.checks?.includes?.("native-settings-window-controls-proof") &&
  nativeClient?.checks?.includes?.("native-settings-window-hot-reload-proof") &&
  nativeClient?.checks?.includes?.("native-settings-window-nonblank-proof");
const hasNativeSettingsWindowStandaloneProof =
  exactSettingsWindowProof(nativeSettingsWindowArtifact) &&
  mtime(nativeSettingsWindowPath) + 5_000 >=
    Math.max(mtime("src-tauri/src/bin/aether_native.rs"), mtime("scripts/verify-full-native-rust-gap-audit.mjs"));
const hasNativeSettings = hasNativeSettingsWindowClientProof || hasNativeSettingsWindowStandaloneProof;
const hasNativeCommandCenterClientProof =
  nativeClient?.nativeCommandCenter?.operation === "command-center-proof" &&
  nativeClient?.nativeCommandCenter?.commandCenter?.schema === "aether.native.command-center-proof.v1" &&
  nativeClient?.nativeCommandCenter?.commandCenter?.nativeCommandCenter === true &&
  nativeClient?.nativeCommandCenter?.commandCenter?.mode === "data-contract-proof" &&
  nativeClient?.nativeCommandCenter?.commandCenter?.webviewUsed === false &&
  nativeClient?.nativeCommandCenter?.commandCenter?.reactUsed === false &&
  nativeClient?.nativeCommandCenter?.commandCenter?.rightRailDataOwnedByRust === true &&
  nativeClient?.nativeCommandCenter?.commandCenter?.recoverySurface?.operation === "open-recovery" &&
  nativeClient?.nativeCommandCenter?.commandCenter?.aiCliSurface?.operation === "open-ai-cli-launch-plan" &&
  exactNativeSleepResumeRunbook(nativeClient?.nativeCommandCenter?.commandCenter) &&
  nativeClient?.nativeCommandCenter?.commandCenter?.nextProof === "native-command-center-window-ui" &&
  nativeClient?.checks?.includes?.("native-command-center-data-contract-proof") &&
  nativeClient?.checks?.includes?.("native-command-center-actions-proof") &&
  nativeClient?.checks?.includes?.("native-command-center-sleep-resume-runbook-proof") &&
  nativeClient?.checks?.includes?.("native-command-center-recovery-surface-proof") &&
  nativeClient?.checks?.includes?.("native-command-center-ai-cli-surface-proof");
const hasNativeCommandCenterStandaloneProof =
  nativeCommandCenterArtifact?.operation === "command-center-proof" &&
  nativeCommandCenterArtifact?.commandCenter?.schema === "aether.native.command-center-proof.v1" &&
  nativeCommandCenterArtifact?.commandCenter?.nativeCommandCenter === true &&
  nativeCommandCenterArtifact?.commandCenter?.mode === "data-contract-proof" &&
  nativeCommandCenterArtifact?.commandCenter?.webviewUsed === false &&
  nativeCommandCenterArtifact?.commandCenter?.reactUsed === false &&
  nativeCommandCenterArtifact?.commandCenter?.rightRailDataOwnedByRust === true &&
  nativeCommandCenterArtifact?.commandCenter?.recoverySurface?.operation === "open-recovery" &&
  nativeCommandCenterArtifact?.commandCenter?.aiCliSurface?.operation === "open-ai-cli-launch-plan" &&
  exactNativeSleepResumeRunbook(nativeCommandCenterArtifact?.commandCenter) &&
  nativeCommandCenterArtifact?.commandCenter?.nextProof === "native-command-center-window-ui" &&
  mtime(nativeCommandCenterPath) + 5_000 >= mtime("src-tauri/src/bin/aether_native.rs");
const hasNativeCommandCenterProof = hasNativeCommandCenterClientProof || hasNativeCommandCenterStandaloneProof;
const hasNativeCommandCenterClientWindowProof =
  nativeClient?.nativeCommandCenterWindow?.operation === "command-center-window-proof" &&
  nativeClient?.nativeCommandCenterWindow?.commandCenter?.schema === "aether.native.command-center-proof.v1" &&
  nativeClient?.nativeCommandCenterWindow?.window?.schema === "aether.native.command-center-window-proof.v1" &&
  nativeClient?.nativeCommandCenterWindow?.window?.nativeCommandCenterWindow === true &&
  nativeClient?.nativeCommandCenterWindow?.window?.nativeRightRailWindow === true &&
  nativeClient?.nativeCommandCenterWindow?.window?.windowUi === true &&
  nativeClient?.nativeCommandCenterWindow?.window?.interactiveWindow === true &&
  nativeClient?.nativeCommandCenterWindow?.window?.layered === true &&
  nativeClient?.nativeCommandCenterWindow?.window?.webviewUsed === false &&
  nativeClient?.nativeCommandCenterWindow?.window?.reactUsed === false &&
  nativeClient?.nativeCommandCenterWindow?.window?.evidenceRowsRendered >= 3 &&
  nativeClient?.nativeCommandCenterWindow?.window?.actionRowsRendered >= 4 &&
  nativeClient?.nativeCommandCenterWindow?.window?.actionableUiProof === true &&
  nativeClient?.nativeCommandCenterWindow?.window?.nonBlank === true &&
  nativeClient?.nativeCommandCenterWindow?.window?.rightRailUiStatus === "native-command-center-window-ui-proof" &&
  nativeClient?.nativeCommandCenterWindow?.window?.nextProof === "native-command-center-input-and-scroll" &&
  nativeClient?.checks?.includes?.("native-command-center-window-ui-proof") &&
  nativeClient?.checks?.includes?.("native-command-center-window-action-hit-targets-proof") &&
  nativeClient?.checks?.includes?.("native-command-center-window-nonblank-proof");
const hasNativeCommandCenterStandaloneWindowProof =
  nativeCommandCenterWindowArtifact?.operation === "command-center-window-proof" &&
  nativeCommandCenterWindowArtifact?.commandCenter?.schema === "aether.native.command-center-proof.v1" &&
  nativeCommandCenterWindowArtifact?.window?.schema === "aether.native.command-center-window-proof.v1" &&
  nativeCommandCenterWindowArtifact?.window?.nativeCommandCenterWindow === true &&
  nativeCommandCenterWindowArtifact?.window?.nativeRightRailWindow === true &&
  nativeCommandCenterWindowArtifact?.window?.windowUi === true &&
  nativeCommandCenterWindowArtifact?.window?.interactiveWindow === true &&
  nativeCommandCenterWindowArtifact?.window?.layered === true &&
  nativeCommandCenterWindowArtifact?.window?.webviewUsed === false &&
  nativeCommandCenterWindowArtifact?.window?.reactUsed === false &&
  nativeCommandCenterWindowArtifact?.window?.evidenceRowsRendered >= 3 &&
  nativeCommandCenterWindowArtifact?.window?.actionRowsRendered >= 4 &&
  nativeCommandCenterWindowArtifact?.window?.actionableUiProof === true &&
  nativeCommandCenterWindowArtifact?.window?.nonBlank === true &&
  nativeCommandCenterWindowArtifact?.window?.rightRailUiStatus === "native-command-center-window-ui-proof" &&
  nativeCommandCenterWindowArtifact?.window?.nextProof === "native-command-center-input-and-scroll" &&
  mtime(nativeCommandCenterWindowPath) + 5_000 >= mtime("src-tauri/src/bin/aether_native.rs");
const hasNativeCommandCenterWindowProof =
  hasNativeCommandCenterClientWindowProof || hasNativeCommandCenterStandaloneWindowProof;
const hasNativeCommandCenterClientInputScrollProof =
  nativeClient?.nativeCommandCenterInputScroll?.operation === "command-center-input-scroll-proof" &&
  nativeClient?.nativeCommandCenterInputScroll?.commandCenter?.schema === "aether.native.command-center-proof.v1" &&
  nativeClient?.nativeCommandCenterInputScroll?.inputScroll?.schema ===
    "aether.native.command-center-input-scroll-proof.v1" &&
  nativeClient?.nativeCommandCenterInputScroll?.inputScroll?.nativeCommandCenterInput === true &&
  nativeClient?.nativeCommandCenterInputScroll?.inputScroll?.nativeCommandCenterScroll === true &&
  nativeClient?.nativeCommandCenterInputScroll?.inputScroll?.webviewUsed === false &&
  nativeClient?.nativeCommandCenterInputScroll?.inputScroll?.reactUsed === false &&
  nativeClient?.nativeCommandCenterInputScroll?.inputScroll?.keyboardNavigation === true &&
  nativeClient?.nativeCommandCenterInputScroll?.inputScroll?.scrollModel === true &&
  nativeClient?.nativeCommandCenterInputScroll?.inputScroll?.actionDispatchPlan === true &&
  nativeClient?.nativeCommandCenterInputScroll?.inputScroll?.actionCount >= 4 &&
  nativeClient?.nativeCommandCenterInputScroll?.inputScroll?.visibleActions?.length >= 1 &&
  nativeClient?.nativeCommandCenterInputScroll?.inputScroll?.transitions?.length >= 6 &&
  nativeClient?.nativeCommandCenterInputScroll?.inputScroll?.guardrails?.boundsCheckedSelection === true &&
  nativeClient?.nativeCommandCenterInputScroll?.inputScroll?.guardrails?.scrollOffsetWithinActions === true &&
  nativeClient?.nativeCommandCenterInputScroll?.inputScroll?.guardrails?.dispatchDoesNotRequireReact === true &&
  nativeClient?.nativeCommandCenterInputScroll?.inputScroll?.guardrails?.dispatchDoesNotRequireWebView === true &&
  nativeClient?.nativeCommandCenterInputScroll?.inputScroll?.nextProof === "react-right-rail-compatibility-demotion" &&
  nativeClient?.checks?.includes?.("native-command-center-input-navigation-proof") &&
  nativeClient?.checks?.includes?.("native-command-center-scroll-model-proof") &&
  nativeClient?.checks?.includes?.("native-command-center-action-dispatch-proof");
const hasNativeCommandCenterStandaloneInputScrollProof =
  nativeCommandCenterInputScrollArtifact?.operation === "command-center-input-scroll-proof" &&
  nativeCommandCenterInputScrollArtifact?.commandCenter?.schema === "aether.native.command-center-proof.v1" &&
  nativeCommandCenterInputScrollArtifact?.inputScroll?.schema ===
    "aether.native.command-center-input-scroll-proof.v1" &&
  nativeCommandCenterInputScrollArtifact?.inputScroll?.nativeCommandCenterInput === true &&
  nativeCommandCenterInputScrollArtifact?.inputScroll?.nativeCommandCenterScroll === true &&
  nativeCommandCenterInputScrollArtifact?.inputScroll?.webviewUsed === false &&
  nativeCommandCenterInputScrollArtifact?.inputScroll?.reactUsed === false &&
  nativeCommandCenterInputScrollArtifact?.inputScroll?.keyboardNavigation === true &&
  nativeCommandCenterInputScrollArtifact?.inputScroll?.scrollModel === true &&
  nativeCommandCenterInputScrollArtifact?.inputScroll?.actionDispatchPlan === true &&
  nativeCommandCenterInputScrollArtifact?.inputScroll?.actionCount >= 4 &&
  nativeCommandCenterInputScrollArtifact?.inputScroll?.visibleActions?.length >= 1 &&
  nativeCommandCenterInputScrollArtifact?.inputScroll?.transitions?.length >= 6 &&
  nativeCommandCenterInputScrollArtifact?.inputScroll?.guardrails?.boundsCheckedSelection === true &&
  nativeCommandCenterInputScrollArtifact?.inputScroll?.guardrails?.scrollOffsetWithinActions === true &&
  nativeCommandCenterInputScrollArtifact?.inputScroll?.guardrails?.dispatchDoesNotRequireReact === true &&
  nativeCommandCenterInputScrollArtifact?.inputScroll?.guardrails?.dispatchDoesNotRequireWebView === true &&
  nativeCommandCenterInputScrollArtifact?.inputScroll?.nextProof === "react-right-rail-compatibility-demotion" &&
  mtime(nativeCommandCenterInputScrollPath) + 5_000 >= mtime("src-tauri/src/bin/aether_native.rs");
const hasNativeCommandCenterInputScrollProof =
  hasNativeCommandCenterClientInputScrollProof || hasNativeCommandCenterStandaloneInputScrollProof;
const hasNativeModeShellClientProof =
  nativeClient?.nativeModeShell?.operation === "mode-shell-proof" &&
  exactModeShellProof(nativeClient?.nativeModeShell) &&
  nativeClient?.checks?.includes?.("native-mode-shell-contract-proof") &&
  nativeClient?.checks?.includes?.("native-mode-rail-contract-proof") &&
  nativeClient?.checks?.includes?.("native-inspector-contract-proof");
const hasNativeModeShellStandaloneProof =
  nativeModeShellArtifact?.operation === "mode-shell-proof" &&
  exactModeShellProof(nativeModeShellArtifact) &&
  mtime(nativeModeShellPath) + 5_000 >=
    Math.max(mtime("src-tauri/src/bin/aether_native.rs"), mtime("scripts/verify-full-native-rust-gap-audit.mjs"));
const hasNativeModeShellProof = hasNativeModeShellClientProof || hasNativeModeShellStandaloneProof;
const hasNativeModeRailWindowClientProof =
  exactModeRailWindowProof(nativeClient?.nativeModeRailWindow) &&
  nativeClient?.checks?.includes?.("native-mode-rail-window-ui-proof") &&
  nativeClient?.checks?.includes?.("native-mode-rail-window-hit-targets-proof") &&
  nativeClient?.checks?.includes?.("native-mode-rail-window-keyboard-proof") &&
  nativeClient?.checks?.includes?.("native-mode-rail-window-nonblank-proof");
const hasNativeModeRailWindowStandaloneProof =
  exactModeRailWindowProof(nativeModeRailWindowArtifact) &&
  mtime(nativeModeRailWindowPath) + 5_000 >=
    Math.max(mtime("src-tauri/src/bin/aether_native.rs"), mtime("scripts/verify-full-native-rust-gap-audit.mjs"));
const hasNativeModeRailWindowProof = hasNativeModeRailWindowClientProof || hasNativeModeRailWindowStandaloneProof;
const hasNativeInspectorWindowClientProof =
  exactInspectorWindowProof(nativeClient?.nativeInspectorWindow) &&
  nativeClient?.checks?.includes?.("native-inspector-window-ui-proof") &&
  nativeClient?.checks?.includes?.("native-inspector-window-action-hit-targets-proof") &&
  nativeClient?.checks?.includes?.("native-inspector-window-scroll-keyboard-proof") &&
  nativeClient?.checks?.includes?.("native-inspector-window-nonblank-proof");
const hasNativeInspectorWindowStandaloneProof =
  exactInspectorWindowProof(nativeInspectorWindowArtifact) &&
  mtime(nativeInspectorWindowPath) + 5_000 >=
    Math.max(mtime("src-tauri/src/bin/aether_native.rs"), mtime("scripts/verify-full-native-rust-gap-audit.mjs"));
const hasNativeInspectorWindowProof =
  hasNativeInspectorWindowClientProof || hasNativeInspectorWindowStandaloneProof;
const hasNativeRightRailDemotionClientProof =
  exactRightRailDemotionProof(nativeClient?.nativeRightRailDemotion) &&
  nativeClient?.checks?.includes?.("native-right-rail-demotion-contract-proof") &&
  nativeClient?.checks?.includes?.("native-right-rail-replacement-map-proof") &&
  nativeClient?.checks?.includes?.("native-right-rail-demotion-honesty-proof") &&
  nativeClient?.checks?.includes?.("react-right-rail-compatibility-demotion-proof");
const hasNativeRightRailDemotionStandaloneProof =
  exactRightRailDemotionProof(nativeRightRailDemotionArtifact) &&
  mtime(nativeRightRailDemotionPath) + 5_000 >=
    Math.max(mtime("src-tauri/src/bin/aether_native.rs"), mtime("scripts/verify-full-native-rust-gap-audit.mjs"));
const hasNativeRightRailDemotionProof =
  hasNativeRightRailDemotionClientProof || hasNativeRightRailDemotionStandaloneProof;
const hasNativeRightRail =
  hasNativeCommandCenterInputScrollProof &&
  hasNativeModeShellProof &&
  hasNativeModeRailWindowProof &&
  hasNativeInspectorWindowProof &&
  hasNativeRightRailDemotionProof &&
  rightRailSources.includes("aether.react.right-rail-compatibility-client.v1") &&
  rightRailSources.includes("productTruthOwner: \"rust-native-command-center\"") &&
  rightRailSources.includes("reactOwnsProductTruth: false") &&
  rightRailSources.includes("webviewDispatchRequired: false");
const hasNativeAccessibilityTreeClientProof =
  exactAccessibilityTreeProof(nativeClient?.nativeAccessibility) &&
  nativeClient?.checks?.includes?.("native-accessibility-tree-proof") &&
  nativeClient?.checks?.includes?.("native-accessibility-focus-order-proof") &&
  nativeClient?.checks?.includes?.("native-accessibility-honesty-proof");
const hasNativeAccessibilityTreeStandaloneProof =
  exactAccessibilityTreeProof(nativeAccessibilityArtifact) &&
  mtime(nativeAccessibilityPath) + 5_000 >=
    Math.max(mtime("src-tauri/src/bin/aether_native.rs"), mtime("scripts/verify-full-native-rust-gap-audit.mjs"));
const hasNativeAccessibilityTreeProof =
  hasNativeAccessibilityTreeClientProof || hasNativeAccessibilityTreeStandaloneProof;
const hasNativeUiaProviderClientProof =
  exactUiaProviderProof(nativeClient?.nativeUiaProvider) &&
  nativeClient?.checks?.includes?.("native-uia-provider-dogfood-proof") &&
  nativeClient?.checks?.includes?.("native-uia-provider-name-role-proof") &&
  nativeClient?.checks?.includes?.("native-uia-provider-invoke-proof");
const hasNativeUiaProviderStandaloneProof =
  exactUiaProviderProof(nativeUiaProviderArtifact) &&
  mtime(nativeUiaProviderPath) + 5_000 >=
    Math.max(mtime("src-tauri/src/bin/aether_native.rs"), mtime("scripts/verify-full-native-rust-gap-audit.mjs"));
const hasNativeUiaProviderProof = hasNativeUiaProviderClientProof || hasNativeUiaProviderStandaloneProof;
const hasNativeAccessibility =
  hasNativeAccessibilityTreeProof && hasNativeUiaProviderProof;
const hasNativeVisualQaHarnessClientProof =
  exactVisualQaHarnessProof(nativeClient?.nativeVisualQa) &&
  nativeClient?.checks?.includes?.("native-visual-qa-harness-proof") &&
  nativeClient?.checks?.includes?.("native-visual-qa-contrast-proof") &&
  nativeClient?.checks?.includes?.("native-visual-qa-resize-proof") &&
  nativeClient?.checks?.includes?.("native-sleep-resume-recovery-probe-proof") &&
  nativeClient?.checks?.includes?.("native-visual-qa-honesty-proof");
const hasNativeVisualQaHarnessStandaloneProof =
  exactVisualQaHarnessProof(nativeVisualQaArtifact) &&
  mtime(nativeVisualQaPath) + 5_000 >=
    Math.max(mtime("src-tauri/src/bin/aether_native.rs"), mtime("scripts/verify-full-native-rust-gap-audit.mjs"));
const hasNativeVisualQaHarness =
  hasNativeVisualQaHarnessClientProof || hasNativeVisualQaHarnessStandaloneProof;
const hasNativeVisualQa =
  hasNativeVisualQaHarness && exactRealOsNativeSleepResumeDogfood(realOsSuspendArtifact);
const hasPrimaryNativeShellPromotion =
  (exactPrimaryShellProof(nativeClient?.nativePrimaryShell) &&
    nativeClient?.checks?.includes?.("native-primary-shell-promotion-proof") &&
    nativeClient?.checks?.includes?.("native-primary-shell-window-proof") &&
    nativeClient?.checks?.includes?.("react-webview-compatibility-only-proof")) ||
  (exactPrimaryShellProof(nativePrimaryShellArtifact) &&
    mtime(nativePrimaryShellPath) + 5_000 >=
      Math.max(mtime("src-tauri/src/bin/aether_native.rs"), mtime("scripts/verify-full-native-rust-gap-audit.mjs")));
const hasCompatibilityOnlyShell = !hasReactWebViewShell || hasPrimaryNativeShellPromotion;

const items = [
  item(
    "native-client-contract",
    "No-WebView native client contract",
    0,
    10,
    hasNativeClientContract && nativeClientFresh,
    "aether-native must expose an honest full-native readiness contract and fresh native-client proof.",
    hasNativeClientContract ? ["refresh pnpm verify:terminal:native-client"] : ["add/repair aether-native fullNativeReadiness contract"],
  ),
  item(
    "daemon-and-mux-boundary",
    "Rust daemon/mux product boundary",
    0,
    12,
    nativeBoundaryFresh,
    "Rust mux/session/API boundary must be proven before a native shell becomes the product boundary.",
    ["refresh native boundary contract"],
  ),
  item(
    "render-frame-contract",
    "Renderer-neutral Rust frame contract",
    0,
    10,
    hasRenderFrameContract,
    "Native renderer must consume NativeRenderFrame rather than inventing parallel terminal truth.",
    ["run native client proof", "keep renderer hash parity between frame and renderer"],
  ),
  item(
    "native-window-and-gdi-grid-proof",
    "Native window and grid proof",
    0,
    10,
    hasNoWebViewNativeProof,
    "Current native proof must create a real aether-native window and render grid cells without React/WebView.",
    ["run pnpm verify:terminal:native-client"],
  ),
  item(
    "native-input-bridge",
    "Native input bridge in current shell",
    0,
    8,
    hasNativeInputProof && nativeInputFresh,
    "Current Tauri shell must prove native IME/paste ownership while the native client catches up.",
    ["refresh pnpm verify:terminal:native-input"],
  ),
  item(
    "native-present-loop",
    "Native terminal present loop",
    0,
    8,
    hasNativePresentLoop,
    "aether-native must repeatedly present terminal frames into a native interactive window, not only render offscreen proof images.",
    ["add present-loop-proof to aether-native", "prove multiple nonblank frames from NativeRenderFrame"],
  ),
  item(
    "gpu-render-proof",
    "wgpu offscreen render proof",
    0,
    4,
    hasGpuRenderProof,
    "aether-native must prove it can create a GPU device, compile WGSL, submit a draw, and consume NativeRenderFrame without WebView/React.",
    ["add/refresh gpu-render-proof in aether-native", "prove GPU render frame hash parity"],
  ),
  item(
    "winit-wgpu-surface-proof",
    "visible winit/wgpu GPU surface proof",
    0,
    4,
    hasWinitWgpuSurfaceProof,
    "aether-native must create a winit window, configure a wgpu swapchain, present multiple frames, and keep NativeRenderFrame hash parity without React/WebView.",
    ["add/refresh visible winit/wgpu surface proof", "prove swapchain presentation from NativeRenderFrame"],
  ),
  item(
    "winit-wgpu-dirty-rect-cell-proof",
    "dirty-rect winit/wgpu terminal cell proof",
    0,
    1,
    hasWinitWgpuDirtyRectCellProof,
    "aether-native must consume dirty rects, cursor, and terminal cell quads on the visible GPU surface without React/WebView.",
    ["render terminal cell/cursor quads from NativeRenderFrame", "consume dirty rects in the winit/wgpu present loop"],
  ),
  item(
    "winit-wgpu-terminal",
    "font-atlas winit/wgpu terminal glyph renderer",
    0,
    1,
    hasWinitWgpuFontAtlasTerminal,
    "Full-native still requires actual terminal glyph rasterization through a GPU font atlas, not only cell-quad glyph proxies.",
    ["replace cell-quad proof with a font atlas glyph renderer", "dogfood glyph/cursor dirty-rect rendering in an interactive native window"],
  ),
  item(
    "native-ime-state-proof",
    "Native client IME state/preedit/commit proof",
    0,
    2,
    hasNativeImeStateProof,
    "aether-native must own a renderer-neutral IME preedit anchor and commit state before live OS IME dogfood can be trusted.",
    ["add/refresh aether-native ime-proof", "prove preedit anchor and committed Japanese text in NativeRenderFrame"],
  ),
  item(
    "native-ime-hwnd-dogfood-proof",
    "Native HWND IME/input dogfood proof",
    0,
    2,
    hasNativeImeHwndDogfood,
    "aether-native must dogfood the native HWND input surface and prove Japanese commits are visible at Codex/Claude/Gemini prompt rows without React/WebView.",
    ["add/refresh aether-native ime-dogfood-proof", "prove native HWND message-loop commit and AI CLI prompt-row visibility"],
  ),
  item(
    "native-ime-dogfood",
    "Native client live OS IME dogfood",
    0,
    6,
    hasNativeImeDogfood,
    "Real Windows IME/TSF composition must be owned and rendered inside aether-native, including Codex/Claude/Gemini CLI prompts.",
    ["refresh aether-native ime-os-dogfood-proof", "prove Imm32 preedit/result and Codex/Claude/Gemini prompt rows"],
  ),
  item(
    "native-settings-config-proof",
    "Native settings/theme config proof",
    0,
    2,
    hasNativeSettingsProof,
    "Theme, opacity, material, palette, and wallpaper customization must round-trip through Rust config without React/WebView.",
    ["add/refresh aether-native settings-proof", "prove Rust config save/load and hot reload"],
  ),
  item(
    "native-settings-customization",
    "Native settings/theme customization UI",
    0,
    6,
    hasNativeSettings,
    "Theme, opacity, wallpaper, profile, and keymap customization must work without React settings UI.",
    ["build native settings surface/dialog", "bind Rust config hot reload to the native window UI"],
  ),
  item(
    "native-command-center-data-proof",
    "Native Command Center data/action proof",
    0,
    2,
    hasNativeCommandCenterProof,
    "Command Center data, recovery surfaces, and next actions must be available through the Rust native client before UI parity can be trusted.",
    ["add/refresh aether-native command-center-proof", "prove recovery and AI CLI actions without React/WebView"],
  ),
  item(
    "native-command-center-window-proof",
    "Native Command Center window UI proof",
    0,
    2,
    hasNativeCommandCenterWindowProof,
    "Rust-owned Command Center data must render into a native window with evidence rows, action rows, and hit-target metadata before full native right-rail parity can be claimed.",
    ["add/refresh aether-native command-center-window-proof", "prove native nonblank action/evidence rows without React/WebView"],
  ),
  item(
    "native-command-center-input-scroll-proof",
    "Native Command Center input and scroll proof",
    0,
    2,
    hasNativeCommandCenterInputScrollProof,
    "Native Command Center must own keyboard selection, scroll-window state, and action dispatch guardrails without React/WebView before React right-rail demotion can be trusted.",
    ["add/refresh aether-native command-center-input-scroll-proof", "prove bounded selection, scrolling, and no-React dispatch"],
  ),
  item(
    "native-mode-shell-contract",
    "Native mode shell and contextual inspector contract",
    0,
    2,
    hasNativeModeShellProof,
    "The native product shell must expose a mode rail, selected work-surface route, and Command Center-backed contextual inspector before it can replace the React right rail.",
    ["add/refresh aether-native mode-shell-proof", "prove 8 modes, selected entity route, and native inspector contract"],
  ),
  item(
    "native-mode-rail-window-proof",
    "Native mode rail window proof",
    0,
    2,
    hasNativeModeRailWindowProof,
    "The native mode rail must render as a real native window with all 8 modes, keyboard selection, hit targets, and nonblank pixels before the React shell can be demoted.",
    ["add/refresh aether-native mode-rail-window-proof", "prove native rail rendering, hit targets, and keyboard navigation"],
  ),
  item(
    "native-inspector-window-proof",
    "Native contextual inspector window proof",
    0,
    2,
    hasNativeInspectorWindowProof,
    "The Command Center-backed contextual inspector must render as a real native window with evidence rows, action hit targets, scroll/keyboard selection, and no React/WebView dispatch before the React right rail can be demoted.",
    ["add/refresh aether-native inspector-window-proof", "prove native inspector rendering, scroll, action targets, and dispatch guardrails"],
  ),
  item(
    "native-right-rail-demotion-readiness",
    "Native right-rail demotion readiness proof",
    0,
    2,
    hasNativeRightRailDemotionProof,
    "Native Command Center, mode rail, and inspector replacements must be complete and mapped to the remaining React right-rail compatibility surfaces before the React right rail is demoted.",
    ["add/refresh aether-native right-rail-demotion-proof", "prove native replacements are ready while honestly reporting React compatibility surfaces still present"],
  ),
  item(
    "native-command-center",
    "Native Command Center/right rail",
    0,
    2,
    hasNativeRightRail,
    "The product edge must be actionable in the native shell, not stranded in React panels.",
    ["wire live native input/scroll events to the Command Center model", "demote React right rail to compatibility"],
  ),
  item(
    "native-accessibility",
    "Native accessibility UIA/provider dogfood",
    0,
    2,
    hasNativeAccessibility,
    "A product-grade native shell needs the semantic tree bound to UIAutomation/accesskit and dogfooded by assistive technology.",
    ["bind the native accessibility tree to UIA/accesskit", "dogfood screen-reader traversal and action invocation"],
  ),
  item(
    "native-accessibility-tree-proof",
    "Native accessibility semantic tree proof",
    0,
    2,
    hasNativeAccessibilityTreeProof,
    "The native shell must expose named roles, focus order, and keyboard traversal before UIA/accesskit binding can be trusted.",
    ["add/refresh aether-native accessibility-proof", "prove names, roles, focus order, and no React/WebView dependency"],
  ),
  item(
    "native-visual-qa",
    "Native visual QA sleep/resume dogfood",
    0,
    2,
    hasNativeVisualQa,
    "Native shell still needs real Windows sleep/resume visual dogfood independent of WebView CDP.",
    ["add real Windows sleep/resume visual dogfood", "prove native rendering remains nonblank and focused after resume"],
  ),
  item(
    "native-visual-qa-harness",
    "Native visual QA harness",
    0,
    2,
    hasNativeVisualQaHarness,
    "Native shell needs screenshot/pixel/contrast/focus/resize evidence independent of WebView CDP.",
    ["add/refresh aether-native visual-qa-proof", "prove native pixel probe, contrast, resize, and focus coverage"],
  ),
];

items.push(
  item(
    "react-webview-compat-only",
    "React/WebView compatibility-only status",
    0,
    10,
    hasCompatibilityOnlyShell,
    "Full-native is not done while React/Tauri/WebView remains the primary shipping shell.",
    ["keep React shell as compatibility during migration", "promote aether-native to primary daily-driver shell"],
  ),
);

const total = items.reduce((sum, entry) => sum + entry.points, 0);
const max = items.reduce((sum, entry) => sum + entry.max, 0);
const percent = Math.round((total / max) * 100);
const missing = items.filter((entry) => entry.status !== "complete");
const strict = process.argv.includes("--strict");

const report = {
  version: 1,
  generatedAt: new Date().toISOString(),
  status: missing.length === 0 ? "complete" : "in-progress",
  percent,
  total,
  max,
  grade: percent >= 95 ? "S" : percent >= 85 ? "A" : percent >= 70 ? "B" : percent >= 55 ? "C" : "D",
  fullNativeReady: missing.length === 0,
  currentTruth: {
    currentArchitecture: hasPrimaryNativeShellPromotion
      ? "aether-native primary shell with Tauri/React compatibility available"
      : hasReactWebViewShell
        ? "Tauri/React shell with Rust terminal core and native-client spike"
        : "native shell candidate",
    canClaimFullNative: missing.length === 0,
    canClaimRustCoreProductBoundary: nativeBoundaryFresh,
    canClaimDailyDriverNativeShell:
      hasWinitWgpuFontAtlasTerminal &&
      hasNativeImeDogfood &&
      hasNativeRightRail &&
      hasNativeSettings &&
      hasNativeVisualQa &&
      hasCompatibilityOnlyShell,
    nativeSleepResumePreflight: {
      status: nativeSleepResumePreflightArtifact?.status ?? "missing",
      checks: nativeSleepResumePreflightArtifact?.checks ?? null,
      missing: nativeSleepResumePreflightArtifact?.missing ?? [],
    },
    nativePostcheckPreflight: {
      status: nativePostcheckPreflightArtifact?.status ?? "missing",
      checks: nativePostcheckPreflightArtifact?.checks ?? null,
      missing: nativePostcheckPreflightArtifact?.missing ?? [],
    },
    nativePostcheckWriteSmoke: {
      status: nativePostcheckWriteSmokeArtifact?.status ?? "missing",
      checks: nativePostcheckWriteSmokeArtifact?.checks ?? null,
      missing: nativePostcheckWriteSmokeArtifact?.missing ?? [],
      evidencePath: nativePostcheckWriteSmokeArtifact?.evidencePath ?? null,
    },
    nativeSleepGuard: {
      status: nativeSleepGuardArtifact?.status ?? "missing",
      checks: nativeSleepGuardArtifact?.checks ?? null,
      missing: nativeSleepGuardArtifact?.missing ?? [],
      safetyBoundary: nativeSleepGuardArtifact?.safetyBoundary ?? null,
    },
  },
  items,
  missingImplementation: missing.map((entry) => ({
    id: entry.id,
    label: entry.label,
    missing: entry.missing,
  })),
  nextRequiredAction:
    missing.length === 0
      ? "Full-native Rust goal is complete."
      : "Continue with native visual QA/sleep-resume dogfood, React compatibility demotion, and daily-driver promotion.",
  artifacts: {
    nativeClientPath,
    nativeBoundaryPath,
    nativeInputPath,
    finalGoalPath,
    nativeCommandCenterPath,
    nativeCommandCenterWindowPath,
    nativeCommandCenterInputScrollPath,
    nativeImeDogfoodPath,
    nativeImeOsDogfoodPath,
    nativeAccessibilityPath,
    nativeUiaProviderPath,
    nativeVisualQaPath,
    nativePrimaryShellPath,
    realOsSuspendPath,
    nativeSleepResumePreflightPath,
    nativePostcheckPreflightPath,
    nativePostcheckWriteSmokePath,
    nativeSleepGuardPath,
    nativeSettingsWindowPath,
    nativeModeShellPath,
    nativeModeRailWindowPath,
    nativeInspectorWindowPath,
    nativeRightRailDemotionPath,
  },
};

writeJsonAtomic(OUT, report);

console.log(JSON.stringify({ status: report.status, percent, total, max, missing: report.missingImplementation, artifact: OUT }, null, 2));
if (strict && missing.length > 0) {
  process.exitCode = 1;
}
