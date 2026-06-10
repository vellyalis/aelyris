import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import process from "node:process";

const ROOT = resolve(process.cwd());
const OUT = join(ROOT, ".codex-auto", "quality", "native-boundary-contract.json");

function source(path) {
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

function check(id, passed, detail, evidence = {}) {
  return { id, status: passed ? "passed" : "failed", detail, evidence };
}

function nearlyEqual(actual, expected, epsilon = 0.001) {
  return Math.abs(Number(actual) - expected) <= epsilon;
}

function writeJsonAtomic(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(tmp, path);
}

const packageJson = source("package.json");
const nativeTerminalArea = source("src/features/terminal/NativeTerminalArea.tsx");
const terminalCanvas = source("src/features/terminal/TerminalCanvas.tsx");
const terminalMetrics = source("src/features/terminal/terminalMetrics.ts");
const terminalSelection = source("src/features/terminal/hooks/useTerminalSelection.ts");
const keymap = source("src/features/terminal/keymap.ts");
const nativeClipboard = source("src/shared/lib/nativeClipboard.ts");
const shellIntegration = source("src/features/settings/ShellIntegrationSection.tsx");
const keyboardShortcuts = source("src/shared/hooks/useKeyboardShortcuts.ts");
const editableTargetGuard = source("src/shared/hooks/useEditableTargetGuard.ts");
const paneTreeContainer = source("src/features/terminal/pane-tree/PaneTreeContainer.tsx");
const paneTreeHook = source("src/features/terminal/pane-tree/usePaneTree.ts");
const paneTreePersistence = source("src/features/terminal/pane-tree/persistence.ts");
const canvasIme = source("src/features/terminal/hooks/useCanvasIME.ts");
const gitStatusHook = source("src/shared/hooks/useGitStatus.ts");
const fallbackTelemetry = source("src/shared/lib/fallbackTelemetry.ts");
const commandRecovery = source("src/shared/lib/commandRecovery.ts");
const globalStyles = source("src/styles/global.css");
const cargoToml = source("src-tauri/Cargo.toml");
const nativeInput = source("src-tauri/src/term/native_input.rs");
const commands = source("src-tauri/src/ipc/commands.rs");
const lib = source("src-tauri/src/lib.rs");
const api = source("src-tauri/src/api/mod.rs");
const aetherctl = source("src-tauri/src/bin/aetherctl.rs");
const aetherNative = source("src-tauri/src/bin/aether_native.rs");
const termMod = source("src-tauri/src/term/mod.rs");
const termRenderFrame = source("src-tauri/src/term/render_frame.rs");
const termRenderPipeline = source("src-tauri/src/term/render_pipeline.rs");
const ptySidecar = source("src-tauri/src/pty_sidecar.rs");
const interactiveCommands = source("src-tauri/src/ipc/interactive_commands.rs");

const nativeInputArtifactPath = ".codex-auto/production-smoke/native-terminal-input-host.json";
const interactiveBoundaryArtifactPath = ".codex-auto/production-smoke/interactive-ai-cli-boundary.json";
const commandRecoveryArtifactPath = ".codex-auto/production-smoke/command-recovery-contract.json";
const aiCliLaunchPlannerArtifactPath = ".codex-auto/production-smoke/ai-cli-launch-planner.json";
const muxLiveArtifactPath = ".codex-auto/performance/mux-live-restore-smoke.json";
const nativeClientArtifactPath = ".codex-auto/quality/native-client-spike.json";

const nativeInputArtifact = readJson(nativeInputArtifactPath);
const interactiveBoundary = readJson(interactiveBoundaryArtifactPath);
const commandRecoveryArtifact = readJson(commandRecoveryArtifactPath);
const aiCliLaunchPlanner = readJson(aiCliLaunchPlannerArtifactPath);
const muxLiveArtifact = readJson(muxLiveArtifactPath);
const nativeClientArtifact = readJson(nativeClientArtifactPath);
const expectedModeShellIds = ["terminal", "agents", "workspace", "review", "git", "context", "history", "settings"];
const expectedModeShellShortcuts = ["Alt+1", "Alt+2", "Alt+3", "Alt+4", "Alt+5", "Alt+6", "Alt+7", "Alt+8"];
const nativeModeShellIds = nativeClientArtifact?.nativeModeShell?.modeShell?.modes?.map?.((mode) => mode.id) ?? [];
const nativeModeShellShortcuts =
  nativeClientArtifact?.nativeModeShell?.modeShell?.modes?.map?.((mode) => mode.shortcut) ?? [];
const nativeModeShellModeSetExact =
  nativeModeShellIds.length === expectedModeShellIds.length &&
  nativeModeShellIds.every((id, index) => id === expectedModeShellIds[index]);
const nativeModeShellShortcutsExact =
  nativeModeShellShortcuts.length === expectedModeShellShortcuts.length &&
  nativeModeShellShortcuts.every((shortcut, index) => shortcut === expectedModeShellShortcuts[index]);
const nativeModeShellRoutes = new Map(
  (nativeClientArtifact?.nativeModeShellRoutes ?? []).map((entry) => [entry.mode, entry.selectedEntityRoute]),
);
const nativeModeShellAllRoutesExact =
  nativeModeShellRoutes.get("terminal")?.kind === "pane" &&
  nativeModeShellRoutes.get("terminal")?.source === "mux-daemon" &&
  nativeModeShellRoutes.get("terminal")?.route === "pane:active" &&
  nativeModeShellRoutes.get("agents")?.kind === "agent-session" &&
  nativeModeShellRoutes.get("agents")?.source === "ai-cli-orchestrator" &&
  nativeModeShellRoutes.get("agents")?.route === "agent:active" &&
  nativeModeShellRoutes.get("workspace")?.kind === "workspace-item" &&
  nativeModeShellRoutes.get("workspace")?.source === "project-index" &&
  nativeModeShellRoutes.get("workspace")?.route === "workspace:selected" &&
  nativeModeShellRoutes.get("review")?.kind === "review-queue" &&
  nativeModeShellRoutes.get("review")?.source === "command-center" &&
  nativeModeShellRoutes.get("review")?.route === "review:ready" &&
  nativeModeShellRoutes.get("git")?.kind === "git-worktree" &&
  nativeModeShellRoutes.get("git")?.source === "git2" &&
  nativeModeShellRoutes.get("git")?.route === "git:worktree" &&
  nativeModeShellRoutes.get("context")?.kind === "context-pack" &&
  nativeModeShellRoutes.get("context")?.source === "context-index" &&
  nativeModeShellRoutes.get("context")?.route === "context:active" &&
  nativeModeShellRoutes.get("history")?.kind === "history-index" &&
  nativeModeShellRoutes.get("history")?.source === "sqlite-scrollback" &&
  nativeModeShellRoutes.get("history")?.route === "history:recent-command" &&
  nativeModeShellRoutes.get("settings")?.kind === "settings-profile" &&
  nativeModeShellRoutes.get("settings")?.source === "rust-config" &&
  nativeModeShellRoutes.get("settings")?.route === "settings:active-profile";

const nativeInputFresh =
  nativeInputArtifact?.status === "pass" &&
  mtime(nativeInputArtifactPath) + 5_000 >=
    Math.max(
      mtime("scripts/verify-native-terminal-input-host.mjs"),
      mtime("src-tauri/src/term/native_input.rs"),
      mtime("src-tauri/src/ipc/commands.rs"),
      mtime("src-tauri/src/lib.rs"),
      mtime("src/features/terminal/TerminalCanvas.tsx"),
      mtime("src/features/terminal/hooks/useCanvasIME.ts"),
    );

const interactiveBoundaryFresh =
  interactiveBoundary?.ok === true &&
  (interactiveBoundary?.status === undefined || interactiveBoundary?.status === "pass") &&
  mtime(interactiveBoundaryArtifactPath) + 5_000 >=
    Math.max(
      mtime("scripts/verify-interactive-ai-cli-boundary.mjs"),
      mtime("src-tauri/src/api/mod.rs"),
      mtime("src-tauri/src/pty_sidecar.rs"),
      mtime("src-tauri/src/ipc/interactive_commands.rs"),
    );

const commandRecoveryFresh =
  commandRecoveryArtifact?.ok === true &&
  commandRecoveryArtifact?.status === "pass" &&
  mtime(commandRecoveryArtifactPath) + 5_000 >=
    Math.max(
      mtime("scripts/verify-command-recovery-contract.mjs"),
      mtime("src/shared/lib/commandRecovery.ts"),
      mtime("src/__tests__/commandRecoveryContract.test.ts"),
    );

const muxLiveFresh =
  muxLiveArtifact?.status === "passed" &&
  mtime(muxLiveArtifactPath) + 5_000 >=
    Math.max(
      mtime("scripts/verify-mux-live-restore.mjs"),
      mtime("src-tauri/src/bin/aetherctl.rs"),
      mtime("src-tauri/src/api/mod.rs"),
      mtime("src-tauri/src/pty_sidecar.rs"),
      mtime("src-tauri/src/mux/graph.rs"),
      mtime("src-tauri/src/mux/manager.rs"),
      mtime("src-tauri/src/mux/layout.rs"),
      mtime("src-tauri/src/mux/store.rs"),
    );

const nativeClientFresh =
  nativeClientArtifact?.status === "passed" &&
  mtime(nativeClientArtifactPath) + 5_000 >=
    Math.max(
      mtime("scripts/verify-native-client-spike.mjs"),
      mtime("src-tauri/Cargo.toml"),
      mtime("src-tauri/src/bin/aether_native.rs"),
      mtime("src-tauri/src/term/mod.rs"),
      mtime("src-tauri/src/term/render_frame.rs"),
      mtime("src-tauri/src/term/render_pipeline.rs"),
      mtime("src-tauri/src/api/mod.rs"),
      mtime("src-tauri/src/pty_sidecar.rs"),
    );

const nativeInputCheckIds = new Set((nativeInputArtifact?.checks ?? []).map((item) => item?.id));
const interactiveCliEntries = Array.isArray(interactiveBoundary?.checks?.clis) ? interactiveBoundary.checks.clis : [];
const interactiveCliNames = new Set(interactiveCliEntries.map((entry) => entry?.cli));
const muxOperations = [
  "mux_split_pane",
  "mux_close_pane",
  "mux_apply_layout",
  "mux_swap_panes",
  "mux_set_panes_synchronized",
  "mux_set_pane_zoom",
];
const activeXtermPattern =
  /@xterm|xterm\.js|xterm-screen|from\s+["'][^"']*xterm|require\(["'][^"']*xterm|new\s+Terminal\s*\(|\bFitAddon\b|\bWebglAddon\b/i;
const activeTerminalSourceContracts = [
  ["package.json", packageJson],
  ["src/features/terminal/NativeTerminalArea.tsx", nativeTerminalArea],
  ["src/features/terminal/TerminalCanvas.tsx", terminalCanvas],
  ["src/features/terminal/hooks/useCanvasIME.ts", canvasIme],
  ["src/features/terminal/keymap.ts", keymap],
  ["src/shared/hooks/useKeyboardShortcuts.ts", keyboardShortcuts],
  ["src/shared/hooks/useEditableTargetGuard.ts", editableTargetGuard],
  ["src/styles/global.css", globalStyles],
  ["src-tauri/Cargo.toml", cargoToml],
];
const activeXtermHits = activeTerminalSourceContracts
  .filter(([, text]) => activeXtermPattern.test(text))
  .map(([path]) => path);

const checks = [
  check(
    "no-xterm-boundary",
    !/"@?xterm\b|xterm\.js/i.test(packageJson) && packageJson.includes('"verify:terminal:native-boundary"'),
    "package declares the native-boundary verifier and does not ship xterm as the terminal core",
    { verifier: "verify:terminal:native-boundary" },
  ),
  check(
    "active-source-no-xterm-integration",
    activeXtermHits.length === 0 &&
      editableTargetGuard.includes('el.getAttribute("data-native-input-surface") === "true"') &&
      editableTargetGuard.includes('el.getAttribute("role") === "textbox"') &&
      !editableTargetGuard.includes("xterm-screen") &&
      !globalStyles.includes("xterm-screen") &&
      !keyboardShortcuts.includes("xterm"),
    "active terminal sources contain no xterm imports/runtime hooks/legacy focus selectors, and native input surfaces are treated as editable shortcut boundaries",
    { scanned: activeTerminalSourceContracts.map(([path]) => path), hits: activeXtermHits },
  ),
  check(
    "native-input-rust-host",
    nativeInput.includes("pub struct NativeTerminalInputHost") &&
      nativeInput.includes("native_composition_surface_ready") &&
      nativeInput.includes("webview_composition_bridge_required: true") &&
      nativeInput.includes("state.webview_composition_bridge_required = false") &&
      nativeInput.includes("WM_IME_SETCONTEXT") &&
      nativeInput.includes("ISC_SHOWUICOMPOSITIONWINDOW") &&
      nativeInput.includes("AetherNativeTerminalInputSurface") &&
      nativeInput.includes("WM_IME_COMPOSITION") &&
      nativeInput.includes("GCS_RESULTSTR") &&
      nativeInput.includes("RegisterClassW") &&
      nativeInput.includes("GWLP_USERDATA") &&
      nativeInput.includes("DefWindowProcW") &&
      nativeInput.includes("WM_PASTE") &&
      nativeInput.includes("classify_native_terminal_paste_input") &&
      nativeInput.includes("native_paste_guard_event_count") &&
      commands.includes("native_terminal_input_commit") &&
      commands.includes("commit_native_terminal_input(&app, host, terminal_id, data, source).await") &&
      commands.includes('"native-input-surface".to_string()') &&
      commands.includes("terminal_write_async(app, &terminal_id, &bytes)") &&
      commands.includes("native_input_rejected") &&
      lib.includes("ipc::native_terminal_input_commit"),
    "Rust owns terminal input commits, native paste guard, and exposes the native composition surface state honestly",
  ),
  check(
    "native-input-artifact",
    nativeInputFresh &&
      nativeInputCheckIds.has("commit-command") &&
      nativeInputCheckIds.has("surface-drain-no-precommit-metadata") &&
      nativeInputCheckIds.has("behavioral-native-hwnd-paste-live") &&
      nativeInputCheckIds.has("frontend-native-default") &&
      nativeInputCheckIds.has("surface-paste-guard") &&
      nativeInputCheckIds.has("surface-ime-preedit-hidden") &&
      nativeInputCheckIds.has("surface-window-lifetime") &&
      nativeInputCheckIds.has("surface-paste-guard-bounded-clipboard-retry") &&
      nativeInputCheckIds.has("composition-surface"),
    "native input artifact proves commit routing, no pre-validation drain commit metadata, behavioral native HWND paste, Tauri-native default, native HWND paste guard, IME preedit suppression, no-paint HWND lifetime safety, bounded clipboard retry, and composition-surface readiness",
    { artifact: nativeInputArtifactPath, fresh: nativeInputFresh },
  ),
  check(
    "webview-ime-fallback-contained",
    terminalCanvas.includes("nativeTerminalInputSurfaceEnabled") &&
      terminalCanvas.includes("textarea: useNativeInputSurface ? null : textareaEl") &&
      terminalCanvas.includes("data-native-input-surface") &&
      terminalCanvas.includes("WEBVIEW_IME_FALLBACK_TEST_ID") &&
      !terminalCanvas.includes('data-testid="terminal-ime-textarea"') &&
      canvasIme.includes("NATIVE_INPUT_SURFACE_DEFAULT_ENABLED = true") &&
      canvasIme.includes("native_terminal_input_focus") &&
      canvasIme.includes("native_terminal_input_drain") &&
      canvasIme.includes("native_terminal_input_commit"),
    "WebView IME fallback is conditional and normal Tauri input goes through the native surface/commit path",
  ),
  check(
    "clipboard-native-first",
    canvasIme.includes('invoke<string>("read_clipboard_text")') &&
      canvasIme.includes("read_clipboard_text_browser_fallback") &&
      canvasIme.includes("browser_read_clipboard_text") &&
      canvasIme.includes("read_clipboard_text_unavailable") &&
      canvasIme.includes('boundary: "webview-fallback"') &&
      canvasIme.includes("nativeBoundaryEscaped: true") &&
      canvasIme.includes('source: "terminal.clipboard"') &&
      canvasIme.includes("TERMINAL_CLIPBOARD_PASTE_EVENT") &&
      canvasIme.includes("classifyTerminalPasteInput") &&
      canvasIme.includes("normalizeTerminalPasteInput") &&
      canvasIme.includes("dispatchPasteGuardEvent") &&
      terminalCanvas.includes("handleNativeInputSurfacePaste") &&
      nativeInput.includes("WM_PASTE") &&
      nativeInput.includes("read_native_clipboard_text_for_paste") &&
      nativeInput.includes("multi-line paste requires explicit UI confirmation") &&
      terminalSelection.includes("writeClipboardText") &&
      nativeClipboard.includes('invoke("write_clipboard_text"') &&
      nativeClipboard.includes("write_clipboard_text_browser_fallback") &&
      nativeClipboard.includes("browser_write_clipboard_text") &&
      nativeClipboard.includes("write_clipboard_text_unavailable") &&
      nativeClipboard.includes('boundary: "webview-fallback"') &&
      nativeClipboard.includes("nativeBoundaryEscaped: true") &&
      nativeClipboard.includes("userVisible: true") &&
      shellIntegration.includes("writeClipboardText") &&
      shellIntegration.includes('source: "settings.shell-integration"') &&
      !shellIntegration.includes("navigator.clipboard"),
    "terminal and command-center clipboard/paste is native-first, guarded before bytes are written, and copy/paste fallback loss is telemetry-visible with WebView boundary escape provenance",
  ),
  check(
    "sidecar-command-session-boundary",
    api.includes('.route("/commands", post(create_command_session))') &&
      api.includes("validate_command_program") &&
      ptySidecar.includes("pub async fn spawn_command") &&
      ptySidecar.includes('.post(format!("{}/commands", self.base_url))') &&
      interactiveCommands.includes("try_state::<PtySidecarState>()") &&
      /client\s*\.\s*spawn_command/.test(interactiveCommands) &&
      /client\s*\.\s*subscribe_output/.test(interactiveCommands) &&
      interactiveCommands.includes('"sidecar".to_string()'),
    "AI CLI sessions enter through authenticated sidecar command sessions before native fallback is considered",
  ),
  check(
    "daemon-contract-policy",
    api.includes("contract_schema_version: u32") &&
      api.includes("mux_graph_version: u32") &&
      api.includes('transport: "loopback-http-websocket"') &&
      api.includes('auth_policy: "bearer-token-or-disabled-test-mode"') &&
      api.includes('client_detach_policy: "detach-keeps-live-pty-while-daemon-running"') &&
      api.includes("restart_restore_policy:") &&
      api.includes("snapshot-restores-graph-as-restore-pending-with-durable-scrollback") &&
      api.includes('attach_policy: "reattach-respawns-only-missing-or-restore-pending-pty-bindings"') &&
      api.includes('shutdown_policy: "explicit-workspace-close-terminates-owned-child-ptys"') &&
      api.includes("terminal_core_policy: TerminalCorePolicyResponse") &&
      api.includes("fn terminal_core_policy()") &&
      api.includes('native_input_owner: "rust-native-input-host"') &&
      api.includes('renderer_truth_source: "rust-term-engine-render-pipeline"') &&
      api.includes('render_frame_schema: "aether.native.render-frame.v1"') &&
      api.includes('render_diff_schema: "aether.native.render-diff.v1"') &&
      api.includes('render_commit_schema: "aether.native.render-commit.v1"') &&
      api.includes('render_pipeline_boundary: "rust-native-render-pipeline"') &&
      api.includes('current_presentation_surface: "react-canvas-presentation-with-rust-term-engine-truth"') &&
      api.includes("native_renderer_status:") &&
      api.includes('"aether-native-no-webview-spike-proved-full-product-renderer-pending"') &&
      api.includes("renderer_claim_policy:") &&
      api.includes('"do-not-claim-main-window-full-native-renderer-until-native-present-loop-dogfooded"') &&
      api.includes('webview_terminal_renderer_policy: "fallback-contained-not-source-of-truth"') &&
      api.includes('react_terminal_renderer_policy: "control-plane-only-not-terminal-core"') &&
      api.includes('fallback_visibility_policy: "release-blocking-telemetry"') &&
      muxLiveFresh &&
      muxLiveArtifact?.firstContract?.contractSchemaVersion === 1 &&
      muxLiveArtifact?.secondContract?.contractSchemaVersion === 1 &&
      muxLiveArtifact?.firstContract?.muxGraphVersion === 1 &&
      muxLiveArtifact?.secondContract?.muxGraphVersion === 1 &&
      muxLiveArtifact?.firstContract?.clientDetachPolicy === "detach-keeps-live-pty-while-daemon-running" &&
      muxLiveArtifact?.secondContract?.clientDetachPolicy === "detach-keeps-live-pty-while-daemon-running" &&
      muxLiveArtifact?.firstContract?.restartRestorePolicy ===
        "snapshot-restores-graph-as-restore-pending-with-durable-scrollback" &&
      muxLiveArtifact?.secondContract?.restartRestorePolicy ===
        "snapshot-restores-graph-as-restore-pending-with-durable-scrollback" &&
      muxLiveArtifact?.firstContract?.attachPolicy ===
        "reattach-respawns-only-missing-or-restore-pending-pty-bindings" &&
      muxLiveArtifact?.secondContract?.attachPolicy ===
        "reattach-respawns-only-missing-or-restore-pending-pty-bindings" &&
      muxLiveArtifact?.firstContract?.shutdownPolicy === "explicit-workspace-close-terminates-owned-child-ptys" &&
      muxLiveArtifact?.secondContract?.shutdownPolicy === "explicit-workspace-close-terminates-owned-child-ptys" &&
      muxLiveArtifact?.firstContract?.terminalCorePolicy?.nativeInputOwner === "rust-native-input-host" &&
      muxLiveArtifact?.secondContract?.terminalCorePolicy?.nativeInputOwner === "rust-native-input-host" &&
      muxLiveArtifact?.aetherctlContract?.terminalCorePolicy?.nativeInputOwner === "rust-native-input-host" &&
      muxLiveArtifact?.firstContract?.terminalCorePolicy?.rendererTruthSource === "rust-term-engine-render-pipeline" &&
      muxLiveArtifact?.secondContract?.terminalCorePolicy?.rendererTruthSource === "rust-term-engine-render-pipeline" &&
      muxLiveArtifact?.aetherctlContract?.terminalCorePolicy?.rendererTruthSource ===
        "rust-term-engine-render-pipeline" &&
      muxLiveArtifact?.firstContract?.terminalCorePolicy?.renderFrameSchema === "aether.native.render-frame.v1" &&
      muxLiveArtifact?.secondContract?.terminalCorePolicy?.renderFrameSchema === "aether.native.render-frame.v1" &&
      muxLiveArtifact?.firstContract?.terminalCorePolicy?.renderDiffSchema === "aether.native.render-diff.v1" &&
      muxLiveArtifact?.secondContract?.terminalCorePolicy?.renderDiffSchema === "aether.native.render-diff.v1" &&
      muxLiveArtifact?.firstContract?.terminalCorePolicy?.renderCommitSchema === "aether.native.render-commit.v1" &&
      muxLiveArtifact?.secondContract?.terminalCorePolicy?.renderCommitSchema === "aether.native.render-commit.v1" &&
      muxLiveArtifact?.aetherctlContract?.terminalCorePolicy?.renderCommitSchema === "aether.native.render-commit.v1" &&
      muxLiveArtifact?.firstContract?.terminalCorePolicy?.renderPipelineBoundary === "rust-native-render-pipeline" &&
      muxLiveArtifact?.secondContract?.terminalCorePolicy?.renderPipelineBoundary === "rust-native-render-pipeline" &&
      muxLiveArtifact?.firstContract?.terminalCorePolicy?.currentPresentationSurface ===
        "react-canvas-presentation-with-rust-term-engine-truth" &&
      muxLiveArtifact?.secondContract?.terminalCorePolicy?.currentPresentationSurface ===
        "react-canvas-presentation-with-rust-term-engine-truth" &&
      muxLiveArtifact?.firstContract?.terminalCorePolicy?.nativeRendererStatus ===
        "aether-native-no-webview-spike-proved-full-product-renderer-pending" &&
      muxLiveArtifact?.secondContract?.terminalCorePolicy?.nativeRendererStatus ===
        "aether-native-no-webview-spike-proved-full-product-renderer-pending" &&
      muxLiveArtifact?.firstContract?.terminalCorePolicy?.rendererClaimPolicy ===
        "do-not-claim-main-window-full-native-renderer-until-native-present-loop-dogfooded" &&
      muxLiveArtifact?.secondContract?.terminalCorePolicy?.rendererClaimPolicy ===
        "do-not-claim-main-window-full-native-renderer-until-native-present-loop-dogfooded" &&
      muxLiveArtifact?.firstContract?.terminalCorePolicy?.webviewTerminalRendererPolicy ===
        "fallback-contained-not-source-of-truth" &&
      muxLiveArtifact?.secondContract?.terminalCorePolicy?.webviewTerminalRendererPolicy ===
        "fallback-contained-not-source-of-truth" &&
      muxLiveArtifact?.firstContract?.terminalCorePolicy?.reactTerminalRendererPolicy ===
        "control-plane-only-not-terminal-core" &&
      muxLiveArtifact?.secondContract?.terminalCorePolicy?.reactTerminalRendererPolicy ===
        "control-plane-only-not-terminal-core" &&
      muxLiveArtifact?.firstContract?.terminalCorePolicy?.muxTruthSource === "daemon-api" &&
      muxLiveArtifact?.secondContract?.terminalCorePolicy?.muxTruthSource === "daemon-api" &&
      muxLiveArtifact?.firstContract?.terminalCorePolicy?.fallbackVisibilityPolicy === "release-blocking-telemetry" &&
      muxLiveArtifact?.secondContract?.terminalCorePolicy?.fallbackVisibilityPolicy === "release-blocking-telemetry" &&
      ["terminal-core-policy", "native-input-boundary-contract", "native-render-pipeline-contract"].every(
        (capability) => muxLiveArtifact?.firstContract?.capabilities?.includes?.(capability),
      ) &&
      ["mux-live-attach-detach", "mux-snapshot-restore-pending", "mux-export-import", "durable-scrollback"].every(
        (capability) => muxLiveArtifact?.firstContract?.capabilities?.includes?.(capability),
      ) &&
      muxLiveArtifact?.checks?.includes?.("daemon-contract-policies-machine-readable") &&
      muxLiveArtifact?.checks?.includes?.("terminal-core-policy-machine-readable") &&
      muxLiveArtifact?.checks?.includes?.("daemon-contract-stable-after-restart") &&
      muxLiveArtifact?.checks?.includes?.("terminal-core-policy-stable-after-restart") &&
      muxLiveArtifact?.checks?.includes?.("aetherctl-daemon-contract-parity") &&
      muxLiveArtifact?.checks?.includes?.("aetherctl-scrollback-search-parity") &&
      muxLiveArtifact?.checks?.includes?.("aetherctl-mux-export-parity") &&
      muxLiveArtifact?.checks?.includes?.("aetherctl-mux-import-parity") &&
      muxLiveArtifact?.checks?.includes?.("mux-import-restore-pending") &&
      muxLiveArtifact?.checks?.includes?.("mux-import-replace-closes-live-pty") &&
      aetherctl.includes('"search" | "scrollback-search"') &&
      aetherctl.includes('"mux-export"') &&
      aetherctl.includes('"mux-import"') &&
      aetherctl.includes("/mux/workspaces/{workspace_id}/export") &&
      aetherctl.includes("/mux/workspaces/import?replace={replace}") &&
      aetherctl.includes("/sessions/{id}/search?query={}") &&
      aetherctl.includes("query_component(&query)") &&
      aetherctl.includes('"daemon" | "contract"'),
    "daemon contract exposes machine-readable detach, attach, restart-restore, shutdown, graph-version, transport, auth, honest terminal-core render/input/fallback policies, and aetherctl parity policies, and the live mux proof validates them before and after restart",
    { artifact: muxLiveArtifactPath, fresh: muxLiveFresh },
  ),
  check(
    "native-client-spike",
    cargoToml.includes('name = "aether-native"') &&
      packageJson.includes('"verify:terminal:native-client"') &&
      aetherNative.includes('"aether.native.client.v1"') &&
      aetherNative.includes('"uiBoundary": "no-webview"') &&
      aetherNative.includes('"muxTruthSource": "daemon-api"') &&
      aetherNative.includes('"pending-native-terminal-renderer-after-window-proof"') &&
      aetherNative.includes('"native-window-proof"') &&
      aetherNative.includes('"native-text-render-proof"') &&
      aetherNative.includes('"native-grid-render-proof"') &&
      aetherNative.includes('"native-present-loop-proof"') &&
      aetherNative.includes('"native-gpu-render-proof"') &&
      aetherNative.includes('"native-winit-wgpu-surface-proof"') &&
      aetherNative.includes('"native-ime-hwnd-dogfood-proof"') &&
      aetherNative.includes('"native-ime-os-dogfood-proof"') &&
      aetherNative.includes('"native-settings-window-ui"') &&
      aetherNative.includes('"native-mode-shell-proof"') &&
      aetherNative.includes('"native-mode-rail-window-ui-proof"') &&
      aetherNative.includes('"native-inspector-window-ui-proof"') &&
      aetherNative.includes('"native-right-rail-demotion-proof"') &&
      aetherNative.includes('"native-accessibility-tree-proof"') &&
      aetherNative.includes('"native-visual-qa-harness-proof"') &&
      aetherNative.includes('"native-primary-shell-promotion-proof"') &&
      aetherNative.includes('"aether.native.sleep-resume-recovery-probe.v1"') &&
      aetherNative.includes('"present-loop-proof"') &&
      aetherNative.includes('"gpu-render-proof"') &&
      aetherNative.includes('"winit-wgpu-proof"') &&
      aetherNative.includes('"ime-dogfood-proof"') &&
      aetherNative.includes('"ime-os-dogfood-proof"') &&
      aetherNative.includes('"settings-window-proof"') &&
      aetherNative.includes('"mode-shell-proof"') &&
      aetherNative.includes('"mode-rail-window-proof"') &&
      aetherNative.includes('"inspector-window-proof"') &&
      aetherNative.includes('"right-rail-demotion-proof"') &&
      aetherNative.includes('"accessibility-proof"') &&
      aetherNative.includes('"uia-provider-proof"') &&
      aetherNative.includes('"visual-qa-proof"') &&
      aetherNative.includes('"primary-shell-proof"') &&
      aetherNative.includes('"aether.native.mode-shell.v1"') &&
      aetherNative.includes('"aether.native.ime-dogfood-proof.v1"') &&
      aetherNative.includes('"aether.native.ime-os-dogfood-proof.v1"') &&
      aetherNative.includes('"aether.native.settings-window-proof.v1"') &&
      aetherNative.includes('"aether.native.mode-rail.v1"') &&
      aetherNative.includes('"aether.native.inspector.v1"') &&
      aetherNative.includes('"aether.native.mode-rail-window-proof.v1"') &&
      aetherNative.includes('"aether.native.inspector-window-proof.v1"') &&
      aetherNative.includes('"aether.native.right-rail-demotion-proof.v1"') &&
      aetherNative.includes('"aether.native.accessibility-proof.v1"') &&
      aetherNative.includes('"aether.native.uia-provider-proof.v1"') &&
      aetherNative.includes('"aether.native.visual-qa-proof.v1"') &&
      aetherNative.includes('"aether.native.primary-shell-proof.v1"') &&
      aetherNative.includes('"aether.native.primary-shell-window-proof.v1"') &&
      aetherNative.includes("native-accessibility-manual-screen-reader-sweep") &&
      aetherNative.includes("native-sleep-resume-visual-dogfood") &&
      aetherNative.includes("UIAutomation") &&
      aetherNative.includes("accesskit") &&
      aetherNative.includes("native_gpu_render_proof") &&
      aetherNative.includes("native_winit_wgpu_surface_proof") &&
      aetherNative.includes("CreateWindowExW") &&
      aetherNative.includes("SetLayeredWindowAttributes") &&
      aetherNative.includes("TextOutW") &&
      aetherNative.includes("native-gdi-text-proof") &&
      aetherNative.includes("native-gdi-grid-proof") &&
      aetherNative.includes("native-win32-present-loop-proof") &&
      aetherNative.includes("wgpu-offscreen-frame-proof") &&
      aetherNative.includes("native-winit-wgpu-terminal") &&
      aetherNative.includes("TermEngine::new") &&
      aetherNative.includes("NativeRenderFrame::from_snapshot") &&
      aetherNative.includes("NativeRenderPipeline::new") &&
      aetherNative.includes("commit_snapshot") &&
      aetherNative.includes("renderCommitSeries") &&
      termMod.includes("NativeRenderFrame") &&
      termMod.includes("NativeRenderFrameDiff") &&
      termMod.includes("NativeRenderPipeline") &&
      termRenderFrame.includes("aether.native.render-frame.v1") &&
      termRenderFrame.includes("aether.native.render-diff.v1") &&
      termRenderPipeline.includes("aether.native.render-commit.v1") &&
      termRenderPipeline.includes("rust-native-render-pipeline") &&
      termRenderPipeline.includes("winit-wgpu-present-loop") &&
      aetherNative.includes("/mux/workspaces/{workspace_id}/attach") &&
      aetherNative.includes("/sessions/{id}/capture?lines={lines}&clean={clean}") &&
      nativeClientFresh &&
      nativeClientArtifact?.nativeContract?.client?.process === "aether-native" &&
      nativeClientArtifact?.nativeContract?.client?.uiBoundary === "no-webview" &&
      nativeClientArtifact?.nativeContract?.claims?.webviewUsed === false &&
      nativeClientArtifact?.nativeContract?.claims?.muxTruthSource === "daemon-api" &&
      nativeClientArtifact?.nativeContract?.daemon?.instanceId === nativeClientArtifact?.directContract?.instanceId &&
      nativeClientArtifact?.nativeWindow?.daemonInstanceId === nativeClientArtifact?.directContract?.instanceId &&
      nativeClientArtifact?.nativeWindow?.window?.nativeWindowCreated === true &&
      nativeClientArtifact?.nativeWindow?.window?.webviewUsed === false &&
      nativeClientArtifact?.nativeWindow?.window?.reactUsed === false &&
      nativeClientArtifact?.nativeWindow?.window?.layered === true &&
      nativeClientArtifact?.nativeWindow?.window?.alpha === 218 &&
      nativeClientArtifact?.nativeWindow?.window?.processIdentity?.process === "aether-native" &&
      nativeClientArtifact?.nativeRender?.daemonInstanceId === nativeClientArtifact?.directContract?.instanceId &&
      nativeClientArtifact?.nativeRender?.source?.expectedFound === true &&
      nativeClientArtifact?.nativeRender?.renderer?.terminalRenderer === "native-gdi-text-proof" &&
      nativeClientArtifact?.nativeRender?.renderer?.webviewUsed === false &&
      nativeClientArtifact?.nativeRender?.renderer?.reactUsed === false &&
      nativeClientArtifact?.nativeRender?.renderer?.nativeTextDrawn === true &&
      nativeClientArtifact?.nativeRender?.renderer?.nonBlank === true &&
      nativeClientArtifact?.nativeRender?.renderer?.nonBackgroundSamples > 0 &&
      nativeClientArtifact?.nativeRender?.window?.nativeWindowCreated === true &&
      nativeClientArtifact?.nativeGridRender?.daemonInstanceId === nativeClientArtifact?.directContract?.instanceId &&
      nativeClientArtifact?.nativeGridRender?.source?.expectedFound === true &&
      nativeClientArtifact?.nativeGridRender?.grid?.cols === 100 &&
      nativeClientArtifact?.nativeGridRender?.grid?.rows === 24 &&
      nativeClientArtifact?.nativeGridRender?.grid?.nonBlankCells > 0 &&
      nativeClientArtifact?.nativeGridRender?.renderFrame?.schema === "aether.native.render-frame.v1" &&
      nativeClientArtifact?.nativeGridRender?.renderFrame?.rendererBoundary === "rust-native-render-frame" &&
      nativeClientArtifact?.nativeGridRender?.renderFrame?.webviewUsed === false &&
      nativeClientArtifact?.nativeGridRender?.renderFrame?.reactUsed === false &&
      nativeClientArtifact?.nativeGridRender?.renderFrame?.frameSha256?.length === 64 &&
      nativeClientArtifact?.nativeGridRender?.renderDiff?.schema === "aether.native.render-diff.v1" &&
      nativeClientArtifact?.nativeGridRender?.renderDiff?.currentFrameSha256 ===
        nativeClientArtifact?.nativeGridRender?.renderFrame?.frameSha256 &&
      nativeClientArtifact?.nativeGridRender?.renderDiff?.rendererBoundary === "rust-native-render-frame-diff" &&
      nativeClientArtifact?.nativeGridRender?.renderDiff?.webviewUsed === false &&
      nativeClientArtifact?.nativeGridRender?.renderDiff?.reactUsed === false &&
      nativeClientArtifact?.nativeGridRender?.renderDiff?.dirtyCells > 0 &&
      nativeClientArtifact?.nativeGridRender?.renderDiff?.dirtyRects?.length > 0 &&
      nativeClientArtifact?.nativeGridRender?.renderCommit?.schema === "aether.native.render-commit.v1" &&
      nativeClientArtifact?.nativeGridRender?.renderCommit?.rendererBoundary === "rust-native-render-pipeline" &&
      nativeClientArtifact?.nativeGridRender?.renderCommit?.webviewUsed === false &&
      nativeClientArtifact?.nativeGridRender?.renderCommit?.reactUsed === false &&
      nativeClientArtifact?.nativeGridRender?.renderCommit?.sequence === 2 &&
      nativeClientArtifact?.nativeGridRender?.renderCommit?.repaintMode === "partial" &&
      nativeClientArtifact?.nativeGridRender?.renderCommit?.frame?.frameSha256 ===
        nativeClientArtifact?.nativeGridRender?.renderFrame?.frameSha256 &&
      nativeClientArtifact?.nativeGridRender?.renderCommit?.diff?.currentFrameSha256 ===
        nativeClientArtifact?.nativeGridRender?.renderFrame?.frameSha256 &&
      nativeClientArtifact?.nativeGridRender?.renderCommit?.diff?.dirtyRects?.length > 0 &&
      Array.isArray(nativeClientArtifact?.nativeGridRender?.renderCommitSeries) &&
      nativeClientArtifact.nativeGridRender.renderCommitSeries.length === 3 &&
      nativeClientArtifact.nativeGridRender.renderCommitSeries[0]?.sequence === 1 &&
      nativeClientArtifact.nativeGridRender.renderCommitSeries[0]?.repaintMode === "full" &&
      nativeClientArtifact.nativeGridRender.renderCommitSeries[0]?.diff?.fullRepaint === true &&
      nativeClientArtifact.nativeGridRender.renderCommitSeries[1]?.sequence === 2 &&
      nativeClientArtifact.nativeGridRender.renderCommitSeries[1]?.repaintMode === "partial" &&
      nativeClientArtifact.nativeGridRender.renderCommitSeries[1]?.frame?.frameSha256 ===
        nativeClientArtifact?.nativeGridRender?.renderFrame?.frameSha256 &&
      nativeClientArtifact.nativeGridRender.renderCommitSeries[2]?.sequence === 3 &&
      nativeClientArtifact.nativeGridRender.renderCommitSeries[2]?.repaintMode === "unchanged" &&
      nativeClientArtifact.nativeGridRender.renderCommitSeries[2]?.diff?.dirtyCells === 0 &&
      nativeClientArtifact.nativeGridRender.renderCommitSeries[2]?.frame?.frameSha256 ===
        nativeClientArtifact?.nativeGridRender?.renderFrame?.frameSha256 &&
      nativeClientArtifact?.nativeGridRender?.renderer?.terminalRenderer === "native-gdi-grid-proof" &&
      nativeClientArtifact?.nativeGridRender?.renderer?.renderFrameSha256 ===
        nativeClientArtifact?.nativeGridRender?.renderFrame?.frameSha256 &&
      nativeClientArtifact?.nativeGridRender?.renderer?.rendererBoundary === "rust-native-render-frame" &&
      nativeClientArtifact?.nativeGridRender?.renderer?.nativeCellGrid === true &&
      nativeClientArtifact?.nativeGridRender?.renderer?.webviewUsed === false &&
      nativeClientArtifact?.nativeGridRender?.renderer?.reactUsed === false &&
      nativeClientArtifact?.nativeGridRender?.renderer?.nonBlank === true &&
      nativeClientArtifact?.nativeGridRender?.renderer?.nonBackgroundSamples > 0 &&
      nativeClientArtifact?.nativeGridRender?.window?.nativeWindowCreated === true &&
      nativeClientArtifact?.nativePresentLoop?.daemonInstanceId === nativeClientArtifact?.directContract?.instanceId &&
      nativeClientArtifact?.nativePresentLoop?.source?.expectedFound === true &&
      nativeClientArtifact?.nativePresentLoop?.renderFrame?.schema === "aether.native.render-frame.v1" &&
      nativeClientArtifact?.nativePresentLoop?.presentLoop?.terminalRenderer === "native-win32-present-loop-proof" &&
      nativeClientArtifact?.nativePresentLoop?.presentLoop?.presentLoop === true &&
      nativeClientArtifact?.nativePresentLoop?.presentLoop?.interactiveWindow === true &&
      nativeClientArtifact?.nativePresentLoop?.presentLoop?.framesPresented >= 2 &&
      nativeClientArtifact?.nativePresentLoop?.presentLoop?.nonBlank === true &&
      nativeClientArtifact?.nativePresentLoop?.presentLoop?.webviewUsed === false &&
      nativeClientArtifact?.nativePresentLoop?.presentLoop?.reactUsed === false &&
      nativeClientArtifact?.nativePresentLoop?.presentLoop?.renderFrameSha256 ===
        nativeClientArtifact?.nativePresentLoop?.renderFrame?.frameSha256 &&
      nativeClientArtifact?.nativeGpuRender?.daemonInstanceId === nativeClientArtifact?.directContract?.instanceId &&
      nativeClientArtifact?.nativeGpuRender?.source?.expectedFound === true &&
      nativeClientArtifact?.nativeGpuRender?.renderFrame?.schema === "aether.native.render-frame.v1" &&
      nativeClientArtifact?.nativeGpuRender?.gpu?.terminalRenderer === "wgpu-offscreen-frame-proof" &&
      nativeClientArtifact?.nativeGpuRender?.gpu?.gpuRenderer === true &&
      nativeClientArtifact?.nativeGpuRender?.gpu?.drawCalls === 1 &&
      nativeClientArtifact?.nativeGpuRender?.gpu?.vertices === 3 &&
      nativeClientArtifact?.nativeGpuRender?.gpu?.webviewUsed === false &&
      nativeClientArtifact?.nativeGpuRender?.gpu?.reactUsed === false &&
      nativeClientArtifact?.nativeGpuRender?.gpu?.renderFrameSha256 ===
        nativeClientArtifact?.nativeGpuRender?.renderFrame?.frameSha256 &&
      nativeClientArtifact?.nativeGpuRender?.gpu?.nextRenderer === "winit-wgpu-surface-present-loop" &&
      nativeClientArtifact?.nativeWinitWgpu?.daemonInstanceId === nativeClientArtifact?.directContract?.instanceId &&
      nativeClientArtifact?.nativeWinitWgpu?.source?.expectedFound === true &&
      nativeClientArtifact?.nativeWinitWgpu?.renderFrame?.schema === "aether.native.render-frame.v1" &&
      nativeClientArtifact?.nativeWinitWgpu?.winitWgpu?.terminalRenderer === "native-winit-wgpu-terminal" &&
      nativeClientArtifact?.nativeWinitWgpu?.winitWgpu?.renderer === "winit-wgpu-surface-present-loop" &&
      nativeClientArtifact?.nativeWinitWgpu?.winitWgpu?.gpuRenderer === true &&
      nativeClientArtifact?.nativeWinitWgpu?.winitWgpu?.presentableSurface === true &&
      nativeClientArtifact?.nativeWinitWgpu?.winitWgpu?.surfaceConfigured === true &&
      nativeClientArtifact?.nativeWinitWgpu?.winitWgpu?.framesPresented >= 2 &&
      nativeClientArtifact?.nativeWinitWgpu?.winitWgpu?.drawCalls >= 2 &&
      nativeClientArtifact?.nativeWinitWgpu?.winitWgpu?.glyphMode === "font-atlas" &&
      nativeClientArtifact?.nativeWinitWgpu?.winitWgpu?.fontAtlas === true &&
      nativeClientArtifact?.nativeWinitWgpu?.winitWgpu?.fontAtlasGlyphs > 0 &&
      nativeClientArtifact?.nativeWinitWgpu?.winitWgpu?.fontAtlasFontPath &&
      nativeClientArtifact?.nativeWinitWgpu?.winitWgpu?.terminalGlyphQuads > 0 &&
      nativeClientArtifact?.nativeWinitWgpu?.winitWgpu?.cursorQuads >= 1 &&
      nativeClientArtifact?.nativeWinitWgpu?.winitWgpu?.dirtyRectDogfood === true &&
      nativeClientArtifact?.nativeWinitWgpu?.winitWgpu?.dirtyRectsRendered > 0 &&
      nativeClientArtifact?.nativeWinitWgpu?.winitWgpu?.dirtyCells > 0 &&
      nativeClientArtifact?.nativeWinitWgpu?.winitWgpu?.webviewUsed === false &&
      nativeClientArtifact?.nativeWinitWgpu?.winitWgpu?.reactUsed === false &&
      nativeClientArtifact?.nativeWinitWgpu?.winitWgpu?.renderFrameSha256 ===
        nativeClientArtifact?.nativeWinitWgpu?.renderFrame?.frameSha256 &&
      nativeClientArtifact?.nativeWinitWgpu?.winitWgpu?.nextRenderer === "native-ime-dogfood-terminal-input" &&
      nativeClientArtifact?.nativeIme?.operation === "ime-proof" &&
      nativeClientArtifact?.nativeIme?.ime?.schema === "aether.native.ime-proof.v1" &&
      nativeClientArtifact?.nativeIme?.ime?.nativeImeStateMachine === true &&
      nativeClientArtifact?.nativeIme?.ime?.nativePreeditOverlay === true &&
      nativeClientArtifact?.nativeIme?.ime?.nativeCommitPath === true &&
      nativeClientArtifact?.nativeIme?.ime?.preedit?.active === true &&
      nativeClientArtifact?.nativeIme?.ime?.preedit?.text === "あああ" &&
      nativeClientArtifact?.nativeIme?.ime?.commit?.active === false &&
      nativeClientArtifact?.nativeIme?.ime?.commit?.text === "あいう" &&
      nativeClientArtifact?.nativeIme?.ime?.committedLineVisible === true &&
      nativeClientArtifact?.nativeIme?.ime?.webviewUsed === false &&
      nativeClientArtifact?.nativeIme?.ime?.reactUsed === false &&
      nativeClientArtifact?.nativeIme?.ime?.realOsImeDogfood === false &&
      nativeClientArtifact?.nativeImeDogfood?.operation === "ime-dogfood-proof" &&
      nativeClientArtifact?.nativeImeDogfood?.imeDogfood?.schema === "aether.native.ime-dogfood-proof.v1" &&
      nativeClientArtifact?.nativeImeDogfood?.imeDogfood?.mode === "native-hwnd-message-loop-dogfood" &&
      nativeClientArtifact?.nativeImeDogfood?.imeDogfood?.nativeHwndImeDogfood === true &&
      nativeClientArtifact?.nativeImeDogfood?.imeDogfood?.nativeCompositionSurfaceReady === true &&
      nativeClientArtifact?.nativeImeDogfood?.imeDogfood?.webviewCompositionBridgeRequired === false &&
      nativeClientArtifact?.nativeImeDogfood?.imeDogfood?.imeStartCompositionObserved === true &&
      nativeClientArtifact?.nativeImeDogfood?.imeDogfood?.committedText === "あいう" &&
      nativeClientArtifact?.nativeImeDogfood?.imeDogfood?.committedTextMatches === true &&
      nativeClientArtifact?.nativeImeDogfood?.imeDogfood?.directPtyCommitCount === 1 &&
      nativeClientArtifact?.nativeImeDogfood?.imeDogfood?.aiCliPromptRows?.length === 3 &&
      nativeClientArtifact?.nativeImeDogfood?.imeDogfood?.aiCliPromptRows?.every?.(
        (row) => ["codex", "claude", "gemini"].includes(row.provider) && row.committedLineVisible === true,
      ) &&
      nativeClientArtifact?.nativeImeDogfood?.imeDogfood?.aiCliPromptDogfood === true &&
      nativeClientArtifact?.nativeImeDogfood?.imeDogfood?.webviewUsed === false &&
      nativeClientArtifact?.nativeImeDogfood?.imeDogfood?.reactUsed === false &&
      nativeClientArtifact?.nativeImeDogfood?.imeDogfood?.realOsImeDogfood === false &&
      nativeClientArtifact?.nativeImeDogfood?.imeDogfood?.nextProof === "real-os-ime-composition-dogfood" &&
      nativeClientArtifact?.nativeImeOsDogfood?.operation === "ime-os-dogfood-proof" &&
      nativeClientArtifact?.nativeImeOsDogfood?.imeOsDogfood?.schema === "aether.native.ime-os-dogfood-proof.v1" &&
      nativeClientArtifact?.nativeImeOsDogfood?.imeOsDogfood?.mode === "win32-imm32-composition-dogfood" &&
      nativeClientArtifact?.nativeImeOsDogfood?.imeOsDogfood?.nativeOsImeDogfood === true &&
      nativeClientArtifact?.nativeImeOsDogfood?.imeOsDogfood?.imeApi === "Imm32" &&
      nativeClientArtifact?.nativeImeOsDogfood?.imeOsDogfood?.imeContextAvailable === true &&
      nativeClientArtifact?.nativeImeOsDogfood?.imeOsDogfood?.imeSetOpenStatusOk === true &&
      nativeClientArtifact?.nativeImeOsDogfood?.imeOsDogfood?.immSetPreeditOk === true &&
      nativeClientArtifact?.nativeImeOsDogfood?.imeOsDogfood?.immSetResultOk === true &&
      nativeClientArtifact?.nativeImeOsDogfood?.imeOsDogfood?.immNotifyCompleteOk === true &&
      nativeClientArtifact?.nativeImeOsDogfood?.imeOsDogfood?.nativeCompositionSurfaceReady === true &&
      nativeClientArtifact?.nativeImeOsDogfood?.imeOsDogfood?.webviewCompositionBridgeRequired === false &&
      nativeClientArtifact?.nativeImeOsDogfood?.imeOsDogfood?.imeStartCompositionObserved === true &&
      (nativeClientArtifact?.nativeImeOsDogfood?.imeOsDogfood?.preeditTextMatches === true ||
        nativeClientArtifact?.nativeImeOsDogfood?.imeOsDogfood?.manualJapaneseImeCandidateDogfood === false) &&
      nativeClientArtifact?.nativeImeOsDogfood?.imeOsDogfood?.committedText === "あいう" &&
      nativeClientArtifact?.nativeImeOsDogfood?.imeOsDogfood?.committedTextMatches === true &&
      nativeClientArtifact?.nativeImeOsDogfood?.imeOsDogfood?.directPtyCommitCount === 1 &&
      nativeClientArtifact?.nativeImeOsDogfood?.imeOsDogfood?.aiCliPromptRows?.length === 3 &&
      nativeClientArtifact?.nativeImeOsDogfood?.imeOsDogfood?.aiCliPromptRows?.every?.(
        (row) => ["codex", "claude", "gemini"].includes(row.provider) && row.committedLineVisible === true,
      ) &&
      nativeClientArtifact?.nativeImeOsDogfood?.imeOsDogfood?.aiCliPromptDogfood === true &&
      nativeClientArtifact?.nativeImeOsDogfood?.imeOsDogfood?.webviewUsed === false &&
      nativeClientArtifact?.nativeImeOsDogfood?.imeOsDogfood?.reactUsed === false &&
      nativeClientArtifact?.nativeImeOsDogfood?.imeOsDogfood?.realOsImeDogfood === true &&
      nativeClientArtifact?.nativeImeOsDogfood?.imeOsDogfood?.manualJapaneseImeCandidateDogfood === false &&
      nativeClientArtifact?.nativeImeOsDogfood?.imeOsDogfood?.guardrails?.noWmCharCommitFallback === true &&
      nativeClientArtifact?.nativeImeOsDogfood?.imeOsDogfood?.guardrails?.commitReadFromNativeImeResultString ===
        true &&
      nativeClientArtifact?.nativeImeOsDogfood?.imeOsDogfood?.nextProof ===
        "native-ime-manual-japanese-candidate-sweep" &&
      nativeClientArtifact?.nativeSettings?.operation === "settings-proof" &&
      nativeClientArtifact?.nativeSettings?.settings?.schema === "aether.native.settings-proof.v1" &&
      nativeClientArtifact?.nativeSettings?.settings?.nativeSettings === true &&
      nativeClientArtifact?.nativeSettings?.settings?.webviewUsed === false &&
      nativeClientArtifact?.nativeSettings?.settings?.reactUsed === false &&
      nativeClientArtifact?.nativeSettings?.settings?.theme === "sakura-hub" &&
      nativeClientArtifact?.nativeSettings?.settings?.mood === "aether-sakura" &&
      nativeClientArtifact?.nativeSettings?.settings?.hotReloadProof?.changedWithoutReact === true &&
      nativeClientArtifact?.nativeSettings?.settings?.paletteProof?.accentCount >= 3 &&
      nativeClientArtifact?.nativeSettings?.settings?.materialProof?.panelColor === "#fff2f7" &&
      nativeClientArtifact?.nativeSettings?.settings?.wallpaperProof?.imagePath ===
        "C:\\Images\\aether-native-sakura.jpg" &&
      nearlyEqual(nativeClientArtifact?.nativeSettings?.settings?.wallpaperProof?.opacity, 0.31) &&
      nativeClientArtifact?.nativeCommandCenter?.operation === "command-center-proof" &&
      nativeClientArtifact?.nativeCommandCenter?.commandCenter?.schema ===
        "aether.native.command-center-proof.v1" &&
      nativeClientArtifact?.nativeCommandCenter?.commandCenter?.nativeCommandCenter === true &&
      nativeClientArtifact?.nativeCommandCenter?.commandCenter?.mode === "data-contract-proof" &&
      nativeClientArtifact?.nativeCommandCenter?.commandCenter?.webviewUsed === false &&
      nativeClientArtifact?.nativeCommandCenter?.commandCenter?.reactUsed === false &&
      nativeClientArtifact?.nativeCommandCenter?.commandCenter?.rightRailDataOwnedByRust === true &&
      nativeClientArtifact?.nativeCommandCenter?.commandCenter?.recoverySurface?.operation === "open-recovery" &&
      nativeClientArtifact?.nativeCommandCenter?.commandCenter?.aiCliSurface?.operation ===
        "open-ai-cli-launch-plan" &&
      nativeClientArtifact?.nativeCommandCenter?.commandCenter?.nextProof === "native-command-center-window-ui" &&
      nativeClientArtifact?.nativeCommandCenterWindow?.operation === "command-center-window-proof" &&
      nativeClientArtifact?.nativeCommandCenterWindow?.commandCenter?.schema ===
        "aether.native.command-center-proof.v1" &&
      nativeClientArtifact?.nativeCommandCenterWindow?.window?.schema ===
        "aether.native.command-center-window-proof.v1" &&
      nativeClientArtifact?.nativeCommandCenterWindow?.window?.nativeCommandCenterWindow === true &&
      nativeClientArtifact?.nativeCommandCenterWindow?.window?.nativeRightRailWindow === true &&
      nativeClientArtifact?.nativeCommandCenterWindow?.window?.windowUi === true &&
      nativeClientArtifact?.nativeCommandCenterWindow?.window?.interactiveWindow === true &&
      nativeClientArtifact?.nativeCommandCenterWindow?.window?.layered === true &&
      nativeClientArtifact?.nativeCommandCenterWindow?.window?.webviewUsed === false &&
      nativeClientArtifact?.nativeCommandCenterWindow?.window?.reactUsed === false &&
      nativeClientArtifact?.nativeCommandCenterWindow?.window?.evidenceRowsRendered >= 3 &&
      nativeClientArtifact?.nativeCommandCenterWindow?.window?.actionRowsRendered >= 4 &&
      nativeClientArtifact?.nativeCommandCenterWindow?.window?.actionableUiProof === true &&
      nativeClientArtifact?.nativeCommandCenterWindow?.window?.nonBlank === true &&
      nativeClientArtifact?.nativeCommandCenterWindow?.window?.rightRailUiStatus ===
        "native-command-center-window-ui-proof" &&
      nativeClientArtifact?.nativeCommandCenterWindow?.window?.nextProof ===
        "native-command-center-input-and-scroll" &&
      nativeClientArtifact?.nativeCommandCenterInputScroll?.operation ===
        "command-center-input-scroll-proof" &&
      nativeClientArtifact?.nativeCommandCenterInputScroll?.commandCenter?.schema ===
        "aether.native.command-center-proof.v1" &&
      nativeClientArtifact?.nativeCommandCenterInputScroll?.inputScroll?.schema ===
        "aether.native.command-center-input-scroll-proof.v1" &&
      nativeClientArtifact?.nativeCommandCenterInputScroll?.inputScroll?.nativeCommandCenterInput === true &&
      nativeClientArtifact?.nativeCommandCenterInputScroll?.inputScroll?.nativeCommandCenterScroll === true &&
      nativeClientArtifact?.nativeCommandCenterInputScroll?.inputScroll?.webviewUsed === false &&
      nativeClientArtifact?.nativeCommandCenterInputScroll?.inputScroll?.reactUsed === false &&
      nativeClientArtifact?.nativeCommandCenterInputScroll?.inputScroll?.keyboardNavigation === true &&
      nativeClientArtifact?.nativeCommandCenterInputScroll?.inputScroll?.scrollModel === true &&
      nativeClientArtifact?.nativeCommandCenterInputScroll?.inputScroll?.actionDispatchPlan === true &&
      nativeClientArtifact?.nativeCommandCenterInputScroll?.inputScroll?.actionCount >= 4 &&
      nativeClientArtifact?.nativeCommandCenterInputScroll?.inputScroll?.visibleActions?.length >= 1 &&
      nativeClientArtifact?.nativeCommandCenterInputScroll?.inputScroll?.transitions?.length >= 6 &&
      nativeClientArtifact?.nativeCommandCenterInputScroll?.inputScroll?.guardrails
        ?.boundsCheckedSelection === true &&
      nativeClientArtifact?.nativeCommandCenterInputScroll?.inputScroll?.guardrails
        ?.scrollOffsetWithinActions === true &&
      nativeClientArtifact?.nativeCommandCenterInputScroll?.inputScroll?.guardrails
        ?.dispatchDoesNotRequireReact === true &&
      nativeClientArtifact?.nativeCommandCenterInputScroll?.inputScroll?.guardrails
        ?.dispatchDoesNotRequireWebView === true &&
      nativeClientArtifact?.nativeCommandCenterInputScroll?.inputScroll?.nextProof ===
        "react-right-rail-compatibility-demotion" &&
      nativeClientArtifact?.nativeModeShell?.operation === "mode-shell-proof" &&
      nativeClientArtifact?.nativeModeShell?.commandCenter?.schema === "aether.native.command-center-proof.v1" &&
      nativeClientArtifact?.nativeModeShell?.modeShell?.schema === "aether.native.mode-shell.v1" &&
      nativeClientArtifact?.nativeModeShell?.modeShell?.nativeModeShell === true &&
      nativeClientArtifact?.nativeModeShell?.modeShell?.webviewUsed === false &&
      nativeClientArtifact?.nativeModeShell?.modeShell?.reactUsed === false &&
      nativeModeShellModeSetExact &&
      nativeModeShellShortcutsExact &&
      nativeClientArtifact?.nativeModeShell?.modeShell?.selectedMode === "terminal" &&
      nativeClientArtifact?.nativeModeShell?.modeShell?.selectedEntityRoute?.kind === "pane" &&
      nativeClientArtifact?.nativeModeShell?.modeShell?.selectedEntityRoute?.source === "mux-daemon" &&
      nativeClientArtifact?.nativeModeShell?.modeShell?.selectedEntityRoute?.route === "pane:active" &&
      nativeClientArtifact?.nativeModeShell?.modeShell?.selectedEntityRoute?.owner === "rust" &&
      nativeClientArtifact?.nativeModeShell?.modeShell?.modeRail?.schema === "aether.native.mode-rail.v1" &&
      nativeClientArtifact?.nativeModeShell?.modeShell?.modeRail?.modeCount === 8 &&
      nativeClientArtifact?.nativeModeShell?.modeShell?.modeRail?.keyboardFirst === true &&
      nativeClientArtifact?.nativeModeShell?.modeShell?.modeRail?.shortcutsStable === true &&
      nativeClientArtifact?.nativeModeShell?.modeShell?.modeRail?.shortcuts?.join?.("|") ===
        expectedModeShellShortcuts.join("|") &&
      nativeClientArtifact?.nativeModeShell?.modeShell?.modeRail?.webviewUsed === false &&
      nativeClientArtifact?.nativeModeShell?.modeShell?.modeRail?.reactUsed === false &&
      nativeClientArtifact?.nativeModeShell?.modeShell?.inspector?.schema === "aether.native.inspector.v1" &&
      nativeClientArtifact?.nativeModeShell?.modeShell?.inspector?.contextualInspector === true &&
      nativeClientArtifact?.nativeModeShell?.modeShell?.inspector?.commandCenterBacked === true &&
      nativeClientArtifact?.nativeModeShell?.modeShell?.inspector?.evidenceRows ===
        nativeClientArtifact?.nativeModeShell?.commandCenter?.evidence?.length &&
      nativeClientArtifact?.nativeModeShell?.modeShell?.inspector?.actionsCount ===
        nativeClientArtifact?.nativeModeShell?.commandCenter?.actions?.length &&
      nativeClientArtifact?.nativeModeShell?.modeShell?.inspector?.blockerCount ===
        nativeClientArtifact?.nativeModeShell?.commandCenter?.blockerCount &&
      nativeClientArtifact?.nativeModeShell?.modeShell?.inspector?.webviewUsed === false &&
      nativeClientArtifact?.nativeModeShell?.modeShell?.inspector?.reactUsed === false &&
      nativeClientArtifact?.nativeModeShell?.modeShell?.rightInspectorContractId ===
        "aether.native.inspector.v1:command-center" &&
      nativeClientArtifact?.nativeModeShell?.modeShell?.guardrails?.modeCountAtLeastEight === true &&
      nativeClientArtifact?.nativeModeShell?.modeShell?.guardrails?.selectedIndexInBounds === true &&
      nativeClientArtifact?.nativeModeShell?.modeShell?.guardrails?.noReactDependency === true &&
      nativeClientArtifact?.nativeModeShell?.modeShell?.guardrails?.noWebViewDependency === true &&
      nativeModeShellAllRoutesExact &&
      nativeClientArtifact?.nativeModeShell?.modeShell?.readyForReactDemotion === false &&
      nativeClientArtifact?.nativeModeShell?.modeShell?.nextProof === "native-mode-rail-window-proof" &&
      nativeClientArtifact?.nativeModeRailWindow?.operation === "mode-rail-window-proof" &&
      nativeClientArtifact?.nativeModeRailWindow?.modeShell?.schema === "aether.native.mode-shell.v1" &&
      nativeClientArtifact?.nativeModeRailWindow?.window?.schema === "aether.native.mode-rail-window-proof.v1" &&
      nativeClientArtifact?.nativeModeRailWindow?.window?.nativeModeRailWindow === true &&
      nativeClientArtifact?.nativeModeRailWindow?.window?.nativeModeRail === true &&
      nativeClientArtifact?.nativeModeRailWindow?.window?.windowUi === true &&
      nativeClientArtifact?.nativeModeRailWindow?.window?.interactiveWindow === true &&
      nativeClientArtifact?.nativeModeRailWindow?.window?.layered === true &&
      nativeClientArtifact?.nativeModeRailWindow?.window?.webviewUsed === false &&
      nativeClientArtifact?.nativeModeRailWindow?.window?.reactUsed === false &&
      nativeClientArtifact?.nativeModeRailWindow?.window?.selectedMode === "terminal" &&
      nativeClientArtifact?.nativeModeRailWindow?.window?.focusedMode === "terminal" &&
      nativeClientArtifact?.nativeModeRailWindow?.window?.modeRowsRendered === 8 &&
      nativeClientArtifact?.nativeModeRailWindow?.window?.hitTargetCount === 8 &&
      nativeClientArtifact?.nativeModeRailWindow?.window?.hitTargets?.length === 8 &&
      nativeClientArtifact?.nativeModeRailWindow?.window?.hitTargets?.every?.(
        (target, index) => target.id === expectedModeShellIds[index] && target.shortcut === expectedModeShellShortcuts[index],
      ) &&
      nativeClientArtifact?.nativeModeRailWindow?.window?.keyboardNavigation === true &&
      nativeClientArtifact?.nativeModeRailWindow?.window?.keyboardTransitions?.length >= 5 &&
      nativeClientArtifact?.nativeModeRailWindow?.window?.nonBlank === true &&
      nativeClientArtifact?.nativeModeRailWindow?.window?.readyForReactDemotion === false &&
      nativeClientArtifact?.nativeModeRailWindow?.window?.nextProof === "native-inspector-window-proof" &&
      nativeClientArtifact?.nativeInspectorWindow?.operation === "inspector-window-proof" &&
      nativeClientArtifact?.nativeInspectorWindow?.commandCenter?.schema ===
        "aether.native.command-center-proof.v1" &&
      nativeClientArtifact?.nativeInspectorWindow?.modeShell?.schema === "aether.native.mode-shell.v1" &&
      nativeClientArtifact?.nativeInspectorWindow?.window?.schema === "aether.native.inspector-window-proof.v1" &&
      nativeClientArtifact?.nativeInspectorWindow?.window?.nativeInspectorWindow === true &&
      nativeClientArtifact?.nativeInspectorWindow?.window?.nativeContextualInspector === true &&
      nativeClientArtifact?.nativeInspectorWindow?.window?.windowUi === true &&
      nativeClientArtifact?.nativeInspectorWindow?.window?.interactiveWindow === true &&
      nativeClientArtifact?.nativeInspectorWindow?.window?.layered === true &&
      nativeClientArtifact?.nativeInspectorWindow?.window?.webviewUsed === false &&
      nativeClientArtifact?.nativeInspectorWindow?.window?.reactUsed === false &&
      nativeClientArtifact?.nativeInspectorWindow?.window?.selectedMode === "terminal" &&
      nativeClientArtifact?.nativeInspectorWindow?.window?.rightInspectorContractId ===
        "aether.native.inspector.v1:command-center" &&
      nativeClientArtifact?.nativeInspectorWindow?.window?.inspector?.schema === "aether.native.inspector.v1" &&
      nativeClientArtifact?.nativeInspectorWindow?.window?.commandCenterBacked === true &&
      nativeClientArtifact?.nativeInspectorWindow?.window?.contextualInspector === true &&
      nativeClientArtifact?.nativeInspectorWindow?.window?.evidenceRowsTotal ===
        nativeClientArtifact?.nativeInspectorWindow?.commandCenter?.evidence?.length &&
      nativeClientArtifact?.nativeInspectorWindow?.window?.actionRowsTotal ===
        nativeClientArtifact?.nativeInspectorWindow?.commandCenter?.actions?.length &&
      nativeClientArtifact?.nativeInspectorWindow?.window?.evidenceRowsRendered ===
        Math.min(nativeClientArtifact?.nativeInspectorWindow?.commandCenter?.evidence?.length ?? 0, 5) &&
      nativeClientArtifact?.nativeInspectorWindow?.window?.actionRowsRendered ===
        Math.min(
          nativeClientArtifact?.nativeInspectorWindow?.commandCenter?.actions?.length ?? 0,
          nativeClientArtifact?.nativeInspectorWindow?.window?.visibleRows ?? 0,
        ) &&
      nativeClientArtifact?.nativeInspectorWindow?.window?.actionHitTargets?.length >= 1 &&
      nativeClientArtifact?.nativeInspectorWindow?.window?.keyboardSelection === true &&
      nativeClientArtifact?.nativeInspectorWindow?.window?.scrollModel === true &&
      nativeClientArtifact?.nativeInspectorWindow?.window?.keyboardTransitions?.length >= 5 &&
      nativeClientArtifact?.nativeInspectorWindow?.window?.guardrails?.selectedActionInBounds === true &&
      nativeClientArtifact?.nativeInspectorWindow?.window?.guardrails?.scrollOffsetInBounds === true &&
      nativeClientArtifact?.nativeInspectorWindow?.window?.guardrails?.dispatchDoesNotRequireReact === true &&
      nativeClientArtifact?.nativeInspectorWindow?.window?.guardrails?.dispatchDoesNotRequireWebView === true &&
      nativeClientArtifact?.nativeInspectorWindow?.window?.nonBlank === true &&
      nativeClientArtifact?.nativeInspectorWindow?.window?.readyForReactDemotion === false &&
      nativeClientArtifact?.nativeInspectorWindow?.window?.nextProof === "react-right-rail-compatibility-demotion" &&
      nativeClientArtifact?.nativeRightRailDemotion?.operation === "right-rail-demotion-proof" &&
      nativeClientArtifact?.nativeRightRailDemotion?.rightRailDemotion?.schema ===
        "aether.native.right-rail-demotion-proof.v1" &&
      nativeClientArtifact?.nativeRightRailDemotion?.rightRailDemotion?.nativeRightRailDemotionProof === true &&
      nativeClientArtifact?.nativeRightRailDemotion?.rightRailDemotion?.sourceOfTruth ===
        "rust-native-command-center-mode-shell-inspector" &&
      nativeClientArtifact?.nativeRightRailDemotion?.rightRailDemotion?.webviewUsed === false &&
      nativeClientArtifact?.nativeRightRailDemotion?.rightRailDemotion?.reactUsed === false &&
      nativeClientArtifact?.nativeRightRailDemotion?.rightRailDemotion?.nativeProductPathReady === true &&
      nativeClientArtifact?.nativeRightRailDemotion?.rightRailDemotion?.nativePrerequisites?.length >= 7 &&
      nativeClientArtifact?.nativeRightRailDemotion?.rightRailDemotion?.nativePrerequisites?.every?.(
        (entry) => entry.complete === true,
      ) &&
      nativeClientArtifact?.nativeRightRailDemotion?.rightRailDemotion?.reactCompatibilityOnly === true &&
      nativeClientArtifact?.nativeRightRailDemotion?.rightRailDemotion?.reactRightRailSourcesPresent === true &&
      nativeClientArtifact?.nativeRightRailDemotion?.rightRailDemotion?.reactSourcesMarkedCompatibilityOnly === true &&
      nativeClientArtifact?.nativeRightRailDemotion?.rightRailDemotion?.compatibilityStatus ===
        "react-right-rail-compatibility-only" &&
      nativeClientArtifact?.nativeRightRailDemotion?.rightRailDemotion?.compatibilityClients?.length >= 4 &&
      nativeClientArtifact?.nativeRightRailDemotion?.rightRailDemotion?.compatibilityClients?.every?.(
        (entry) =>
          entry.compatibilityMarkerPresent === true &&
          entry.compatibilityRole === "legacy-tauri-react-client" &&
          entry.reactOwnsProductTruth === false &&
          entry.webviewDispatchRequired === false,
      ) &&
      nativeClientArtifact?.nativeRightRailDemotion?.rightRailDemotion?.nativeReplacementMap?.length >= 4 &&
      nativeClientArtifact?.nativeRightRailDemotion?.rightRailDemotion?.guardrails?.doesNotClaimReactRemoved ===
        true &&
      nativeClientArtifact?.nativeRightRailDemotion?.rightRailDemotion?.guardrails
        ?.compatibilityOnlyClaimBackedByMarkers === true &&
      nativeClientArtifact?.nativeRightRailDemotion?.rightRailDemotion?.guardrails
        ?.reactSourcesMarkedCompatibilityOnly === true &&
      nativeClientArtifact?.nativeRightRailDemotion?.rightRailDemotion?.guardrails?.reactProductTruthDisabled ===
        true &&
      nativeClientArtifact?.nativeRightRailDemotion?.rightRailDemotion?.guardrails
        ?.nativeReplacementReadyBeforeDemotion === true &&
      nativeClientArtifact?.nativeRightRailDemotion?.rightRailDemotion?.reactDemotionComplete === true &&
      nativeClientArtifact?.nativeRightRailDemotion?.rightRailDemotion?.readyForReactDemotion === false &&
      nativeClientArtifact?.nativeRightRailDemotion?.rightRailDemotion?.readyForFullNativeClaim === false &&
      nativeClientArtifact?.nativeRightRailDemotion?.rightRailDemotion?.nextProof ===
        "aether-native-primary-daily-driver-promotion" &&
      nativeClientArtifact?.nativeAccessibility?.operation === "accessibility-proof" &&
      nativeClientArtifact?.nativeAccessibility?.accessibility?.schema === "aether.native.accessibility-proof.v1" &&
      nativeClientArtifact?.nativeAccessibility?.accessibility?.nativeAccessibilityTreeProof === true &&
      nativeClientArtifact?.nativeAccessibility?.accessibility?.webviewUsed === false &&
      nativeClientArtifact?.nativeAccessibility?.accessibility?.reactUsed === false &&
      nativeClientArtifact?.nativeAccessibility?.accessibility?.namedNodes >= 16 &&
      nativeClientArtifact?.nativeAccessibility?.accessibility?.unnamedNodes === 0 &&
      nativeClientArtifact?.nativeAccessibility?.accessibility?.focusableNodes >= 12 &&
      nativeClientArtifact?.nativeAccessibility?.accessibility?.keyboardTraversal === true &&
      nativeClientArtifact?.nativeAccessibility?.accessibility?.roles?.includes?.("terminal") &&
      nativeClientArtifact?.nativeAccessibility?.accessibility?.roles?.includes?.("button") &&
      nativeClientArtifact?.nativeAccessibility?.accessibility?.guardrails?.noUnnamedFocusableNodes === true &&
      nativeClientArtifact?.nativeAccessibility?.accessibility?.guardrails?.actionsDoNotRequireReact === true &&
      nativeClientArtifact?.nativeAccessibility?.accessibility?.guardrails?.actionsDoNotRequireWebView === true &&
      nativeClientArtifact?.nativeAccessibility?.accessibility?.readyForNativeUiaProvider === true &&
      nativeClientArtifact?.nativeAccessibility?.accessibility?.screenReaderProviderReady === false &&
      nativeClientArtifact?.nativeAccessibility?.accessibility?.readyForFullNativeClaim === false &&
      nativeClientArtifact?.nativeAccessibility?.accessibility?.nextProof === "native-uia-provider-dogfood" &&
      nativeClientArtifact?.nativeUiaProvider?.operation === "uia-provider-proof" &&
      nativeClientArtifact?.nativeUiaProvider?.uiaProvider?.schema === "aether.native.uia-provider-proof.v1" &&
      nativeClientArtifact?.nativeUiaProvider?.uiaProvider?.nativeUiaProviderDogfood === true &&
      nativeClientArtifact?.nativeUiaProvider?.uiaProvider?.webviewUsed === false &&
      nativeClientArtifact?.nativeUiaProvider?.uiaProvider?.reactUsed === false &&
      nativeClientArtifact?.nativeUiaProvider?.uiaProvider?.uiaProviderBound === true &&
      nativeClientArtifact?.nativeUiaProvider?.uiaProvider?.elementFromHandle === true &&
      nativeClientArtifact?.nativeUiaProvider?.uiaProvider?.root?.name ===
        "Aether Native Accessibility Dogfood" &&
      nativeClientArtifact?.nativeUiaProvider?.uiaProvider?.descendantCount >= 3 &&
      nativeClientArtifact?.nativeUiaProvider?.uiaProvider?.dogfoodChecks?.terminalNameReadable === true &&
      nativeClientArtifact?.nativeUiaProvider?.uiaProvider?.dogfoodChecks?.actionNameReadable === true &&
      nativeClientArtifact?.nativeUiaProvider?.uiaProvider?.dogfoodChecks?.settingsNameReadable === true &&
      nativeClientArtifact?.nativeUiaProvider?.uiaProvider?.dogfoodChecks?.buttonInvokePatternAvailable === true &&
      nativeClientArtifact?.nativeUiaProvider?.uiaProvider?.dogfoodChecks?.buttonInvokedThroughUia === true &&
      nativeClientArtifact?.nativeUiaProvider?.uiaProvider?.screenReaderProviderReady === true &&
      nativeClientArtifact?.nativeUiaProvider?.uiaProvider?.manualNarratorDogfood === false &&
      nativeClientArtifact?.nativeUiaProvider?.uiaProvider?.readyForFullNativeClaim === false &&
      nativeClientArtifact?.nativeUiaProvider?.uiaProvider?.nextProof ===
        "native-accessibility-manual-screen-reader-sweep" &&
      nativeClientArtifact?.nativeVisualQa?.operation === "visual-qa-proof" &&
      nativeClientArtifact?.nativeVisualQa?.visualQa?.schema === "aether.native.visual-qa-proof.v1" &&
      nativeClientArtifact?.nativeVisualQa?.visualQa?.nativeVisualQaHarness === true &&
      nativeClientArtifact?.nativeVisualQa?.visualQa?.webviewUsed === false &&
      nativeClientArtifact?.nativeVisualQa?.visualQa?.reactUsed === false &&
      nativeClientArtifact?.nativeVisualQa?.visualQa?.allRequiredSurfacesComplete === true &&
      nativeClientArtifact?.nativeVisualQa?.visualQa?.allRequiredSurfacesNonBlank === true &&
      nativeClientArtifact?.nativeVisualQa?.visualQa?.contrastPass === true &&
      nativeClientArtifact?.nativeVisualQa?.visualQa?.pixelProbePass === true &&
      nativeClientArtifact?.nativeVisualQa?.visualQa?.resizeProbePass === true &&
      nativeClientArtifact?.nativeVisualQa?.visualQa?.focusCoveragePass === true &&
      nativeClientArtifact?.nativeVisualQa?.visualQa?.pixelProbe?.webviewCdpUsed === false &&
      nativeClientArtifact?.nativeVisualQa?.visualQa?.sleepResumeRecoveryProbe?.schema ===
        "aether.native.sleep-resume-recovery-probe.v1" &&
      nativeClientArtifact?.nativeVisualQa?.visualQa?.sleepResumeRecoveryProbe?.syntheticPowerBroadcastDogfood ===
        true &&
      nativeClientArtifact?.nativeVisualQa?.visualQa?.sleepResumeRecoveryProbe?.realWindowsSleepResumeDogfood ===
        false &&
      nativeClientArtifact?.nativeVisualQa?.visualQa?.sleepResumeRecoveryProbe?.doesNotClaimMachineSleep === true &&
      nativeClientArtifact?.nativeVisualQa?.visualQa?.sleepResumeRecoveryProbe?.wmPowerBroadcastObserved === true &&
      nativeClientArtifact?.nativeVisualQa?.visualQa?.sleepResumeRecoveryProbe?.postResumeVisualNonBlank === true &&
      nativeClientArtifact?.nativeVisualQa?.visualQa?.sleepResumeRecoveryProbe?.readyForRealSleepResumeDogfood ===
        true &&
      nativeClientArtifact?.nativeVisualQa?.visualQa?.sleepResumeRecoveryProbePass === true &&
      nativeClientArtifact?.nativeVisualQa?.visualQa?.sleepResumeDogfood === false &&
      nativeClientArtifact?.nativeVisualQa?.visualQa?.readyForFullNativeClaim === false &&
      nativeClientArtifact?.nativeVisualQa?.visualQa?.nextProof === "native-sleep-resume-visual-dogfood" &&
      nativeClientArtifact?.nativePrimaryShell?.operation === "primary-shell-proof" &&
      nativeClientArtifact?.nativePrimaryShell?.primaryShell?.schema === "aether.native.primary-shell-proof.v1" &&
      nativeClientArtifact?.nativePrimaryShell?.primaryShell?.nativePrimaryShellPromotion === true &&
      nativeClientArtifact?.nativePrimaryShell?.primaryShell?.primarySurface === "aether-native" &&
      nativeClientArtifact?.nativePrimaryShell?.primaryShell?.reactWebViewCompatibilityOnly === true &&
      nativeClientArtifact?.nativePrimaryShell?.primaryShell?.reactOwnsProductTruth === false &&
      nativeClientArtifact?.nativePrimaryShell?.primaryShell?.webviewOwnsTerminal === false &&
      nativeClientArtifact?.nativePrimaryShell?.primaryShell?.promotionReady === true &&
      nativeClientArtifact?.nativePrimaryShell?.primaryShell?.prerequisites?.length >= 8 &&
      nativeClientArtifact?.nativePrimaryShell?.primaryShell?.prerequisites?.every?.(
        (entry) => entry.complete === true,
      ) &&
      nativeClientArtifact?.nativePrimaryShell?.primaryShell?.primaryShellWindow?.schema ===
        "aether.native.primary-shell-window-proof.v1" &&
      nativeClientArtifact?.nativePrimaryShell?.primaryShell?.primaryShellWindow?.nativePrimaryShellWindow === true &&
      nativeClientArtifact?.nativePrimaryShell?.primaryShell?.primaryShellWindow?.nonBlank === true &&
      nativeClientArtifact?.nativePrimaryShell?.primaryShell?.primaryShellWindow?.modeRowsRendered >= 8 &&
      nativeClientArtifact?.nativePrimaryShell?.primaryShell?.primaryShellWindow?.actionRowsRendered >= 4 &&
      nativeClientArtifact?.nativePrimaryShell?.primaryShell?.readyForFullNativeClaim === false &&
      nativeClientArtifact?.nativeSettingsWindow?.operation === "settings-window-proof" &&
      nativeClientArtifact?.nativeSettingsWindow?.window?.schema === "aether.native.settings-window-proof.v1" &&
      nativeClientArtifact?.nativeSettingsWindow?.window?.nativeSettingsWindow === true &&
      nativeClientArtifact?.nativeSettingsWindow?.window?.nativeSettingsCustomization === true &&
      nativeClientArtifact?.nativeSettingsWindow?.window?.windowUi === true &&
      nativeClientArtifact?.nativeSettingsWindow?.window?.layered === true &&
      nativeClientArtifact?.nativeSettingsWindow?.window?.webviewUsed === false &&
      nativeClientArtifact?.nativeSettingsWindow?.window?.reactUsed === false &&
      nativeClientArtifact?.nativeSettingsWindow?.window?.controlRowsRendered >= 8 &&
      nativeClientArtifact?.nativeSettingsWindow?.window?.controlHitTargets?.length >= 8 &&
      nativeClientArtifact?.nativeSettingsWindow?.window?.keyboardNavigation === true &&
      nativeClientArtifact?.nativeSettingsWindow?.window?.hotReloadBound === true &&
      nativeClientArtifact?.nativeSettingsWindow?.window?.nonBlank === true &&
      nativeClientArtifact?.nativeSettingsWindow?.window?.settingsUiStatus === "native-settings-window-ui" &&
      nativeClientArtifact?.nativeSettingsWindow?.window?.readyForReactSettingsDemotion === true &&
      nativeClientArtifact?.nativeSettingsWindow?.window?.readyForFullNativeClaim === false &&
      nativeClientArtifact?.checks?.includes?.("native-contract-attaches-same-daemon") &&
      nativeClientArtifact?.checks?.includes?.("native-client-no-webview-boundary") &&
      nativeClientArtifact?.checks?.includes?.("native-window-proof-no-webview") &&
      nativeClientArtifact?.checks?.includes?.("native-window-layered-alpha") &&
      nativeClientArtifact?.checks?.includes?.("native-render-proof-uses-daemon-capture") &&
      nativeClientArtifact?.checks?.includes?.("native-render-proof-nonblank-text") &&
      nativeClientArtifact?.checks?.includes?.("native-grid-render-proof-uses-term-engine") &&
      nativeClientArtifact?.checks?.includes?.("native-grid-render-proof-nonblank-cells") &&
      nativeClientArtifact?.checks?.includes?.("native-render-frame-contract") &&
      nativeClientArtifact?.checks?.includes?.("native-render-diff-contract") &&
      nativeClientArtifact?.checks?.includes?.("native-render-pipeline-contract") &&
      nativeClientArtifact?.checks?.includes?.("native-render-commit-series-contract") &&
      nativeClientArtifact?.checks?.includes?.("native-present-loop-proof") &&
      nativeClientArtifact?.checks?.includes?.("native-present-loop-nonblank-frames") &&
      nativeClientArtifact?.checks?.includes?.("native-gpu-render-proof") &&
      nativeClientArtifact?.checks?.includes?.("native-gpu-render-frame-contract") &&
      nativeClientArtifact?.checks?.includes?.("native-winit-wgpu-surface-proof") &&
      nativeClientArtifact?.checks?.includes?.("native-winit-wgpu-frame-contract") &&
      nativeClientArtifact?.checks?.includes?.("native-winit-wgpu-dirty-rect-cell-proof") &&
      nativeClientArtifact?.checks?.includes?.("native-winit-wgpu-cursor-cell-proof") &&
      nativeClientArtifact?.checks?.includes?.("native-winit-wgpu-font-atlas-proof") &&
      nativeClientArtifact?.checks?.includes?.("native-ime-state-machine-proof") &&
      nativeClientArtifact?.checks?.includes?.("native-ime-preedit-anchor-proof") &&
      nativeClientArtifact?.checks?.includes?.("native-ime-commit-render-frame-proof") &&
      nativeClientArtifact?.checks?.includes?.("native-ime-hwnd-dogfood-proof") &&
      nativeClientArtifact?.checks?.includes?.("native-ime-ai-cli-prompt-row-proof") &&
      nativeClientArtifact?.checks?.includes?.("native-ime-dogfood-honesty-proof") &&
      nativeClientArtifact?.checks?.includes?.("native-ime-os-composition-proof") &&
      nativeClientArtifact?.checks?.includes?.("native-ime-os-result-commit-proof") &&
      nativeClientArtifact?.checks?.includes?.("native-ime-os-ai-cli-prompt-proof") &&
      nativeClientArtifact?.checks?.includes?.("native-settings-config-roundtrip-proof") &&
      nativeClientArtifact?.checks?.includes?.("native-settings-hot-reload-proof") &&
      nativeClientArtifact?.checks?.includes?.("native-settings-wallpaper-customization-proof") &&
      nativeClientArtifact?.checks?.includes?.("native-settings-material-customization-proof") &&
      nativeClientArtifact?.checks?.includes?.("native-settings-window-ui-proof") &&
      nativeClientArtifact?.checks?.includes?.("native-settings-window-controls-proof") &&
      nativeClientArtifact?.checks?.includes?.("native-settings-window-hot-reload-proof") &&
      nativeClientArtifact?.checks?.includes?.("native-settings-window-nonblank-proof") &&
      nativeClientArtifact?.checks?.includes?.("native-command-center-data-contract-proof") &&
      nativeClientArtifact?.checks?.includes?.("native-command-center-actions-proof") &&
      nativeClientArtifact?.checks?.includes?.("native-command-center-recovery-surface-proof") &&
      nativeClientArtifact?.checks?.includes?.("native-command-center-ai-cli-surface-proof") &&
      nativeClientArtifact?.checks?.includes?.("native-command-center-window-ui-proof") &&
      nativeClientArtifact?.checks?.includes?.("native-command-center-window-action-hit-targets-proof") &&
      nativeClientArtifact?.checks?.includes?.("native-command-center-window-nonblank-proof") &&
      nativeClientArtifact?.checks?.includes?.("native-command-center-input-navigation-proof") &&
      nativeClientArtifact?.checks?.includes?.("native-command-center-scroll-model-proof") &&
      nativeClientArtifact?.checks?.includes?.("native-command-center-action-dispatch-proof") &&
      nativeClientArtifact?.checks?.includes?.("native-mode-shell-contract-proof") &&
      nativeClientArtifact?.checks?.includes?.("native-mode-rail-contract-proof") &&
      nativeClientArtifact?.checks?.includes?.("native-inspector-contract-proof") &&
      nativeClientArtifact?.checks?.includes?.("native-mode-rail-window-ui-proof") &&
      nativeClientArtifact?.checks?.includes?.("native-mode-rail-window-hit-targets-proof") &&
      nativeClientArtifact?.checks?.includes?.("native-mode-rail-window-keyboard-proof") &&
      nativeClientArtifact?.checks?.includes?.("native-mode-rail-window-nonblank-proof") &&
      nativeClientArtifact?.checks?.includes?.("native-inspector-window-ui-proof") &&
      nativeClientArtifact?.checks?.includes?.("native-inspector-window-action-hit-targets-proof") &&
      nativeClientArtifact?.checks?.includes?.("native-inspector-window-scroll-keyboard-proof") &&
      nativeClientArtifact?.checks?.includes?.("native-inspector-window-nonblank-proof") &&
      nativeClientArtifact?.checks?.includes?.("native-right-rail-demotion-contract-proof") &&
      nativeClientArtifact?.checks?.includes?.("native-right-rail-replacement-map-proof") &&
      nativeClientArtifact?.checks?.includes?.("native-right-rail-demotion-honesty-proof") &&
      nativeClientArtifact?.checks?.includes?.("react-right-rail-compatibility-demotion-proof") &&
      nativeClientArtifact?.checks?.includes?.("native-accessibility-tree-proof") &&
      nativeClientArtifact?.checks?.includes?.("native-accessibility-focus-order-proof") &&
      nativeClientArtifact?.checks?.includes?.("native-accessibility-honesty-proof") &&
      nativeClientArtifact?.checks?.includes?.("native-uia-provider-dogfood-proof") &&
      nativeClientArtifact?.checks?.includes?.("native-uia-provider-name-role-proof") &&
      nativeClientArtifact?.checks?.includes?.("native-uia-provider-invoke-proof") &&
      nativeClientArtifact?.checks?.includes?.("native-visual-qa-harness-proof") &&
      nativeClientArtifact?.checks?.includes?.("native-visual-qa-contrast-proof") &&
      nativeClientArtifact?.checks?.includes?.("native-visual-qa-resize-proof") &&
      nativeClientArtifact?.checks?.includes?.("native-sleep-resume-recovery-probe-proof") &&
      nativeClientArtifact?.checks?.includes?.("native-visual-qa-honesty-proof") &&
      nativeClientArtifact?.checks?.includes?.("native-primary-shell-promotion-proof") &&
      nativeClientArtifact?.checks?.includes?.("native-primary-shell-window-proof") &&
      nativeClientArtifact?.checks?.includes?.("react-webview-compatibility-only-proof") &&
      nativeClientArtifact?.checks?.includes?.("native-list-reads-mux-workspaces") &&
      nativeClientArtifact?.checks?.includes?.("native-send-and-capture-roundtrip") &&
      nativeClientArtifact?.checks?.includes?.("native-detach-updates-mux-graph") &&
      nativeClientArtifact?.checks?.includes?.("native-attach-updates-mux-graph"),
    "aether-native exists as a Rust-native, no-WebView attaching client and live proof shows it uses the same mux daemon plus layered Win32 native window, native GDI text rendering, a Rust native render-frame contract, TermEngine-backed grid rendering, and a native present loop for list, send, capture, detach, and attach",
    { artifact: nativeClientArtifactPath, fresh: nativeClientFresh },
  ),
  check(
    "sidecar-command-session-artifact",
    interactiveBoundaryFresh &&
      interactiveBoundary?.checks?.commandSessionCapability === true &&
      interactiveBoundary?.checks?.security?.unauthorizedCommandRejected === true &&
      interactiveBoundary?.checks?.security?.unsafeProgramRejected === true &&
      ["codex", "claude", "gemini"].every((cli) => interactiveCliNames.has(cli)) &&
      interactiveCliEntries.every((entry) => entry?.backend === "sidecar-command-session"),
    "deterministic Codex/Claude/Gemini shims prove stream, input, close, auth, and unsafe-program rejection",
    { artifact: interactiveBoundaryArtifactPath, fresh: interactiveBoundaryFresh },
  ),
  check(
    "mux-ui-rust-owned",
    paneTreeContainer.includes("loadPaneTreeSnapshotFromMux") &&
      paneTreeContainer.includes("savePaneTreeSnapshotToBackend") &&
      paneTreeContainer.includes("suspendTerminalMounts={layoutStorageKey ? !backendReconciled : false}") &&
      paneTreeContainer.includes("orphanedBackendPanes") &&
      muxOperations.every((operation) => paneTreeContainer.includes(operation)),
    "pane topology restores from Rust mux snapshots and drives split/close/layout/swap/sync/zoom through mux IPC",
    { operations: muxOperations },
  ),
  check(
    "mux-fallback-visible",
    paneTreeContainer.includes("reportFallback") &&
      paneTreeContainer.includes("reportInvokeFailure") &&
      paneTreeContainer.includes('source: "pane-mux"') &&
      paneTreeContainer.includes('source: "pane-metadata"') &&
      paneTreeHook.includes("reportInvokeFailure") &&
      paneTreeHook.includes('source: "pane-tree"') &&
      paneTreeHook.includes("close_all_terminals_close_terminal") &&
      paneTreePersistence.includes('source: "pane-tree-persistence"') &&
      paneTreePersistence.includes('"local_load_snapshot"') &&
      paneTreePersistence.includes('"backend_save_snapshot"') &&
      paneTreePersistence.includes('"mux_load_snapshot"') &&
      muxOperations.every((operation) => paneTreeContainer.includes(`operation: "${operation}"`)) &&
      ["rename_pane", "set_pane_role", "load_tauri_core"].every((operation) =>
        paneTreeContainer.includes(`operation: "${operation}"`),
      ) &&
      paneTreeContainer.includes("local split recovery") &&
      paneTreeContainer.includes("local layout recovery"),
    "mux fallback, pane metadata sync, pane layout persistence, local recovery, and backend PTY cleanup failures are telemetry-visible rather than console-only",
  ),
  check(
    "no-silent-fallback-contract",
    fallbackTelemetry.includes("FALLBACK_TELEMETRY_EVENT") &&
      commandRecovery.includes("fallback-visible") &&
      commandRecovery.includes("stale-state-visible") &&
      nativeTerminalArea.includes('source: "terminal.snapshot-overlay"') &&
      nativeTerminalArea.includes('operation: "dismiss_ghost_layer"') &&
      nativeTerminalArea.includes('source: "input-mirror"') &&
      nativeTerminalArea.includes('operation: "save_command_history"') &&
      terminalMetrics.includes('source: "terminal-metrics"') &&
      terminalMetrics.includes('operation: "fonts_ready"') &&
      gitStatusHook.includes('source: "git-status.watcher"') &&
      gitStatusHook.includes("operation,") &&
      gitStatusHook.includes("stop_fs_watcher_after_abort") &&
      commandRecoveryFresh &&
      commandRecoveryArtifact?.checks?.failedCommandRecovery?.checks?.noSilentFallback === true &&
      commandRecoveryArtifact?.checks?.deniedToolRecovery?.checks?.noSilentFallback === true,
    "fallback, stale state, stale overlays, font-metric drift, watcher leaks, and command-history loss are explicit release blockers with command recovery proof",
    { artifact: commandRecoveryArtifactPath, fresh: commandRecoveryFresh },
  ),
  check(
    "planner-sidecar-preflight",
    aiCliLaunchPlanner?.ok === true &&
      aiCliLaunchPlanner?.plan?.recommendedBackend === "sidecar-command-session" &&
      aiCliLaunchPlanner?.plan?.trace?.recommendedBackend === "sidecar-command-session" &&
      Array.isArray(aiCliLaunchPlanner?.plan?.trace?.preflightChecks) &&
      aiCliLaunchPlanner.plan.trace.preflightChecks.every((item) => item?.status === "ready"),
    "AI CLI launch planner refuses blind prompt-pasting until sidecar/native/clipboard/reconnect preflight is ready",
    { artifact: aiCliLaunchPlannerArtifactPath },
  ),
];

const failures = checks.filter((item) => item.status !== "passed").map((item) => item.detail);
const report = {
  ok: failures.length === 0,
  status: failures.length === 0 ? "pass" : "blocked",
  generatedAt: new Date().toISOString(),
  summary: {
    checks: checks.length,
    passed: checks.length - failures.length,
    failed: failures.length,
  },
  checks,
  blockers: failures,
};

writeJsonAtomic(OUT, { version: 1, ...report });
console.log(JSON.stringify({ artifact: OUT, ...report }, null, 2));

if (failures.length > 0) {
  process.exitCode = 1;
}
