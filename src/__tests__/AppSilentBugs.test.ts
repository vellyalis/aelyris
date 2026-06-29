// @ts-expect-error Node types are intentionally absent from the app tsconfig.
import { readFileSync } from "node:fs";
// @ts-expect-error Node types are intentionally absent from the app tsconfig.
import { join } from "node:path";
import { describe, expect, it } from "vitest";

declare const process: { cwd(): string };

const sources = import.meta.glob("../App.tsx", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

function getSrc(): string {
  const entries = Object.entries(sources);
  expect(entries.length).toBe(1);
  // Normalize CRLF -> LF so source-content regexes (e.g. `\n}\n\n`) are
  // EOL-independent; on Windows checkouts (core.autocrlf=true) the working tree
  // is CRLF, which would otherwise break newline-anchored matches.
  return entries[0][1].replace(/\r\n/g, "\n");
}

function getStyles(): string {
  return readFileSync(join(process.cwd(), "src/styles/global.css"), "utf8");
}

function getRightRailAdvisorSource(): string {
  return readFileSync(join(process.cwd(), "src/shared/lib/rightRailAdvisor.ts"), "utf8");
}

function getTerminalNotificationsSource(): string {
  return readFileSync(join(process.cwd(), "src/shared/hooks/useTerminalNotifications.ts"), "utf8");
}

function getTerminalImagesSource(): string {
  return readFileSync(join(process.cwd(), "src/shared/hooks/useTerminalImages.ts"), "utf8");
}

function getKeyboardShortcutsSource(): string {
  return readFileSync(join(process.cwd(), "src/shared/hooks/useKeyboardShortcuts.ts"), "utf8");
}

function getTerminalCanvasSource(): string {
  return readFileSync(join(process.cwd(), "src/features/terminal/TerminalCanvas.tsx"), "utf8");
}

function getTerminalCanvasInputTestSource(): string {
  return readFileSync(join(process.cwd(), "src/__tests__/TerminalCanvasInput.test.tsx"), "utf8");
}

function cssBlock(source: string, selector: string): string {
  const start = source.indexOf(`${selector} {`);
  expect(start).toBeGreaterThan(-1);
  const end = source.indexOf("\n}", start);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end + 2);
}

function templatePlaceholder(name: string): string {
  return `${"$"}{${name}}`;
}

describe("App unsaved editor guards", () => {
  it("does not clear editor state on project/tab changes without an unsaved confirmation", () => {
    const src = getSrc();

    expect(src).toMatch(/const confirmDiscardUnsavedFiles\s*=\s*useCallback/);
    expect(src).toMatch(/useAppStore\.getState\(\)\.unsavedFiles\.size/);
    expect(src).toMatch(/await confirmDiscardUnsavedFiles\("Switch tabs and discard them"\)/);
    expect(src).toMatch(/await confirmDiscardUnsavedFiles\("Open another project and discard them"\)/);
    expect(src).toMatch(/await confirmDiscardUnsavedFiles\("Close this project and discard them"\)/);

    const tabSwitch = src.match(/const handleTabSwitch\s*=\s*useCallback\([\s\S]*?\n\s*\);/);
    expect(tabSwitch).not.toBeNull();
    const body = tabSwitch?.[0] ?? "";
    expect(body.indexOf("await confirmDiscardUnsavedFiles")).toBeLessThan(body.indexOf("clearFiles()"));
    expect(body).toMatch(/if\s*\(!\(await confirmDiscardUnsavedFiles/);
  });
});

describe("Release evidence gates", () => {
  it("keeps real OS suspend evidence strict while offering a diagnostic path", () => {
    const packageJson = readFileSync(join(process.cwd(), "package.json"), "utf8");
    const script = readFileSync(join(process.cwd(), "scripts/verify-real-os-suspend-evidence.mjs"), "utf8");
    const score = readFileSync(join(process.cwd(), "scripts/score-release-quality.mjs"), "utf8");
    const closeRisks = readFileSync(join(process.cwd(), "scripts/close-production-risks.mjs"), "utf8");
    const productionGate = readFileSync(join(process.cwd(), "scripts/verify-production-release-gate.mjs"), "utf8");
    const nativeInputVerify = readFileSync(
      join(process.cwd(), "scripts/verify-native-terminal-input-host.mjs"),
      "utf8",
    );
    const nativeBoundaryVerify = readFileSync(
      join(process.cwd(), "scripts/verify-native-boundary-contract.mjs"),
      "utf8",
    );
    const nativeHwndPasteVerify = readFileSync(
      join(process.cwd(), "scripts/verify-native-hwnd-paste-live.mjs"),
      "utf8",
    );
    const canvasIme = readFileSync(join(process.cwd(), "src/features/terminal/hooks/useCanvasIME.ts"), "utf8");
    const nativeTerminalArea = readFileSync(
      join(process.cwd(), "src/features/terminal/NativeTerminalArea.tsx"),
      "utf8",
    );
    const terminalMetrics = readFileSync(join(process.cwd(), "src/features/terminal/terminalMetrics.ts"), "utf8");
    const terminalKeymap = readFileSync(join(process.cwd(), "src/features/terminal/keymap.ts"), "utf8");
    const terminalSelection = readFileSync(
      join(process.cwd(), "src/features/terminal/hooks/useTerminalSelection.ts"),
      "utf8",
    );
    const nativeClipboard = readFileSync(join(process.cwd(), "src/shared/lib/nativeClipboard.ts"), "utf8");
    const shellIntegration = readFileSync(
      join(process.cwd(), "src/features/settings/ShellIntegrationSection.tsx"),
      "utf8",
    );
    const keyboardShortcuts = readFileSync(join(process.cwd(), "src/shared/hooks/useKeyboardShortcuts.ts"), "utf8");
    const editableTargetGuard = readFileSync(join(process.cwd(), "src/shared/hooks/useEditableTargetGuard.ts"), "utf8");
    const globalStyles = readFileSync(join(process.cwd(), "src/styles/global.css"), "utf8");
    const gitStatusHook = readFileSync(join(process.cwd(), "src/shared/hooks/useGitStatus.ts"), "utf8");
    const livePanesHook = readFileSync(join(process.cwd(), "src/shared/hooks/useLivePanes.ts"), "utf8");
    const ghostLayersHook = readFileSync(join(process.cwd(), "src/shared/hooks/useGhostLayers.ts"), "utf8");
    const paneTreeContainer = readFileSync(
      join(process.cwd(), "src/features/terminal/pane-tree/PaneTreeContainer.tsx"),
      "utf8",
    );
    const paneTreeHook = readFileSync(join(process.cwd(), "src/features/terminal/pane-tree/usePaneTree.ts"), "utf8");
    const paneTreePersistence = readFileSync(
      join(process.cwd(), "src/features/terminal/pane-tree/persistence.ts"),
      "utf8",
    );
    const commands = readFileSync(join(process.cwd(), "src-tauri/src/ipc/commands.rs"), "utf8");
    const lib = readFileSync(join(process.cwd(), "src-tauri/src/lib.rs"), "utf8");
    const nativeInput = readFileSync(join(process.cwd(), "src-tauri/src/term/native_input.rs"), "utf8");

    expect(packageJson).toContain(
      '"verify:production:suspend:template": "node scripts/verify-real-os-suspend-evidence.mjs --write-template"',
    );
    expect(packageJson).toContain(
      '"verify:production:suspend:begin": "node scripts/verify-real-os-suspend-evidence.mjs --begin"',
    );
    expect(packageJson).toContain(
      '"verify:production:suspend:resume": "node scripts/verify-real-os-suspend-evidence.mjs --resume"',
    );
    expect(packageJson).toContain(
      '"verify:production:suspend:refresh-app": "node scripts/verify-real-os-suspend-evidence.mjs --refresh-app"',
    );
    expect(packageJson).toContain(
      '"verify:production:suspend:postcheck": "node scripts/verify-real-os-suspend-evidence.mjs --postcheck"',
    );
    expect(packageJson).toContain(
      '"verify:production:suspend:diagnose": "node scripts/verify-real-os-suspend-evidence.mjs --diagnose"',
    );
    expect(packageJson).toContain(
      '"verify:production:suspend:cycle": "node scripts/verify-real-os-suspend-evidence.mjs --cycle"',
    );
    expect(script).toContain("real-os-suspend-resume.diagnostic.json");
    expect(script).toContain("real-os-suspend-session.json");
    expect(script).toContain("PACKAGE_VERSION");
    expect(script).toContain("DEFAULT_APP_EXE");
    expect(script).toContain('readFileSync(join(ROOT, "package.json"), "utf8")');
    expect(script).toContain("function sha256");
    expect(script).toContain("function appExecutableInfo");
    expect(script).toContain("function probeAelyrisProcesses");
    expect(script).toContain("function probeApiHealth");
    expect(script).toContain("function probeTerminalRoundtrip");
    expect(script).toContain("AELYRIS_POST_RESUME_TERMINAL_OK_");
    expect(script).toContain("function probeDbPaneLayout");
    expect(script).toContain('runAelys(["db-smoke"]');
    expect(script).toContain('"cargo-run-aelys db-smoke"');
    expect(script).toContain("function writePostResumeProbe");
    expect(script).toContain("function writeAppExecutableRefresh");
    expect(script).toContain("binaryIdentityChanged");
    expect(script).toContain('status: evidence.status === "pass" && !binaryIdentityChanged ? "pass" : "pending"');
    expect(script).toContain("function writeSuspendBegin");
    expect(script).toContain("function writeSuspendResume");
    expect(script).toContain("function runGuardedSleepCycle");
    expect(script).toContain("function invokeWindowsSleep");
    expect(script).toContain("function printUsage");
    expect(script).toContain('if (args.has("--help") || args.has("-h"))');
    expect(script).toContain("--help, -h");
    expect(script).toContain("Show this message and exit without touching evidence or sleeping.");
    expect(script).toContain("function assertWindowsSleepCycleAllowed");
    expect(script).toContain("AELYRIS_ALLOW_OS_SLEEP");
    expect(script).toContain("refusing to put Windows to sleep without explicit opt-in");
    expect(script).toContain("SetSuspendState");
    expect(script).toContain('if (args.has("--cycle"))');
    expect(script).toContain('status: "pending"');
    expect(script).toContain("validatedAt: undefined");
    expect(script).toContain('if (args.has("--refresh-app"))');
    expect(script).toContain('if (args.has("--postcheck"))');
    expect(script).toContain("postResumeProbes");
    expect(script).toContain("terminalRoundtrip");
    expect(script).toContain("dbPaneLayout");
    expect(script).toContain(
      "Automated probes verify app responsiveness, terminal roundtrip, SQLite write, and pane layout preservation",
    );
    expect(script).toContain("appResponsive: processProbe.ok === true && apiProbe.ok === true");
    expect(script).toContain("terminalResponsive: terminalRoundtrip.ok === true");
    expect(script).toContain("sqliteWritable: dbPaneLayout.ok === true");
    expect(script).toContain("paneStatePreserved: dbPaneLayout.ok === true");
    expect(script).toContain("Run pnpm verify:production:suspend:postcheck after the app is running post-resume.");
    expect(script).toContain("Launch the release Aelyris.exe and rerun pnpm verify:production:suspend:postcheck.");
    expect(script).toContain("Ensure the PTY API is reachable and rerun pnpm verify:production:suspend:postcheck.");
    expect(script).toContain(
      "Ensure SQLite pane layout persistence is writable and rerun pnpm verify:production:suspend:postcheck.",
    );
    expect(script).toContain('if (args.has("--begin"))');
    expect(script).toContain('if (args.has("--resume"))');
    expect(script).toContain("function buildMissingFields");
    expect(script).toContain("function safeQueryWindowsPowerEvents");
    expect(script).toContain("function queryWindowsPowerCapabilities");
    expect(script).toContain('spawnSync("powercfg.exe", ["/a"]');
    expect(script).toContain('spawnSync("powercfg.exe", ["/requests"]');
    expect(script).toContain("Id = 1,42,107,187,506,507");
    expect(script).toContain("function isKernelPowerEvent");
    expect(script).toContain("function isPowerTroubleshooterEvent");
    expect(script).toContain("function isSuspendPowerEvent");
    expect(script).toContain("function isResumePowerEvent");
    expect(script).toContain("function isAttemptedSuspendPowerEvent");
    expect(script).toContain('normalizedProviderName(event) === "microsoft-windows-kernel-power"');
    expect(script).toContain('normalizedProviderName(event) === "microsoft-windows-power-troubleshooter"');
    expect(script).toContain("isKernelPowerEvent(event) && (event.id === 42 || event.id === 506)");
    expect(script).toContain("isKernelPowerEvent(event) && (event.id === 107 || event.id === 507)");
    expect(script).toContain("isPowerTroubleshooterEvent(event) && event.id === 1");
    expect(script).toContain("rawEventCount");
    expect(script).toContain("matchedEventIds");
    expect(script).toContain("attemptedSuspendEventFound");
    expect(script).toContain("modernStandbyAvailable");
    expect(script).toContain("This host reports S0 Modern Standby and only attempted-suspend event 187");
    expect(script).toContain("Modern Standby event 506");
    expect(script).toContain("Modern Standby event 507");
    expect(script).toContain("function writeDiagnostic");
    expect(script).toContain("missingFields");
    expect(script).toContain("ready-to-verify");
    expect(script).toContain("powerCapabilities");
    expect(script).toContain("app.version must match package.json version");
    expect(script).toContain("app.sha256 must match the current app.executable");
    expect(script).toContain("app executable hash does not match evidence");
    expect(script).toContain("appExecutable");
    expect(script).toContain("Run pnpm verify:production:suspend to stamp the release evidence as validated.");
    expect(script).toContain('if (args.has("--diagnose"))');
    expect(script).toContain("function validateEvidence");
    expect(script).toContain('if (!promote && evidence.status !== "pass") fail("status must be pass"');
    expect(script).toContain("validateEvidence({ promote: true })");
    expect(script).toContain('evidence.status = "pass"');
    expect(score).toContain("real-os-suspend-resume.diagnostic.json");
    expect(score).toContain("realSuspendMissingFields");
    expect(score).toContain("realSuspendPowerCapabilities");
    expect(score).toContain("realSuspendAppExecutable");
    expect(score).toContain("realSuspendDiagnosticFresh");
    expect(score).toContain("realSuspendPostResumeProbes");
    expect(score).toContain("realSuspendProbeDetail");
    expect(score).toContain("realSuspendPostResumeProbes.dbPaneLayout.command");
    expect(score).toContain('"terminal-core-edge"');
    expect(score).toContain("Terminal core edge readiness");
    expect(score).toContain("hasXtermDependency");
    expect(score).toContain("activeXtermIntegrationBlocked");
    expect(score).toContain("active terminal source still contains xterm integration or legacy focus hooks");
    expect(score).toContain("active-source-no-xterm-integration");
    expect(score).toContain("terminalCoreSignalPoints");
    expect(score).toContain("terminalCorePoints = Math.max");
    expect(score).toContain("alacritty_terminal");
    expect(score).toContain("NativeTerminalRegistry");
    expect(score).toContain("native-terminal-input-host.json");
    expect(score).toContain("native-hwnd-paste-live.json");
    expect(score).toContain("nativeHwndPasteLiveFresh");
    expect(score).toContain("native HWND paste live proof is missing or stale");
    expect(score).toContain("nativeInputCompositionBlocked");
    expect(score).toContain("frontend-native-default");
    expect(score).toContain("surface-paste-guard");
    expect(score).toContain("surface-ime-preedit-hidden");
    expect(score).toContain("surface-window-lifetime");
    expect(score).toContain("native HWND paste guard proof is missing or stale");
    expect(score).toContain("hasWebviewImeFallback");
    expect(score).toContain("webviewImeFallbackContained");
    expect(score).toContain("WEBVIEW_IME_FALLBACK_TEST_ID");
    expect(score).toContain("onInputRef?.(useNativeInputSurface ? null : textareaEl)");
    expect(score).toContain("webview fallback contained");
    expect(score).toContain("empty-or-non-text-paste-ignored");
    expect(score).toContain("save_clipboard_image");
    expect(score).toContain("terminal IME still crosses the WebView hidden textarea boundary");
    expect(score).toContain("native input composition surface proof is missing or stale");
    expect(score).toContain("image clipboard ingestion still depends on WebView navigator.clipboard");
    expect(canvasIme).toContain("native_terminal_input_commit");
    expect(canvasIme).toContain("native_terminal_input_focus");
    expect(canvasIme).toContain("native_terminal_input_drain");
    expect(canvasIme).toContain("NATIVE_INPUT_SURFACE_STORAGE_KEY");
    expect(canvasIme).toContain("NATIVE_INPUT_SURFACE_DEFAULT_ENABLED = true");
    expect(canvasIme).toContain("__TAURI_INTERNALS__");
    expect(canvasIme).toContain('source: "webview-ime-bridge"');
    expect(terminalSelection).toContain("writeClipboardText");
    expect(nativeClipboard).toContain('invoke("write_clipboard_text"');
    expect(nativeClipboard).toContain("write_clipboard_text_browser_fallback");
    expect(nativeClipboard).toContain("browser_write_clipboard_text");
    expect(nativeClipboard).toContain("write_clipboard_text_unavailable");
    expect(nativeClipboard).toContain("userVisible: true");
    expect(nativeClipboard).toContain('boundary: "webview-fallback"');
    expect(nativeClipboard).toContain("nativeBoundaryEscaped: true");
    expect(shellIntegration).toContain("writeClipboardText");
    expect(shellIntegration).toContain('source: "settings.shell-integration"');
    expect(shellIntegration).not.toContain("navigator.clipboard");
    expect(score).toContain("write_clipboard_text_browser_fallback");
    expect(score).toContain("shellIntegrationSource");
    expect(nativeBoundaryVerify).toContain("command-center clipboard/paste is native-first");
    expect(nativeBoundaryVerify).toContain("shellIntegration");
    expect(nativeBoundaryVerify).toContain("native HWND paste guard");
    expect(nativeBoundaryVerify).toContain("IME preedit suppression");
    expect(nativeBoundaryVerify).toContain("active-source-no-xterm-integration");
    expect(nativeBoundaryVerify).toContain(
      "active terminal sources contain no xterm imports/runtime hooks/legacy focus selectors",
    );
    expect(nativeBoundaryVerify).toContain('el.getAttribute("data-native-input-surface") === "true"');
    expect(editableTargetGuard).toContain('el.getAttribute("data-native-input-surface") === "true"');
    expect(editableTargetGuard).toContain('el.getAttribute("role") === "textbox"');
    expect(editableTargetGuard).not.toContain("xterm-screen");
    expect(globalStyles).not.toContain("xterm-screen");
    expect(keyboardShortcuts).toContain("native terminal input");
    expect(keyboardShortcuts).not.toContain("xterm");
    expect(terminalKeymap).toContain("CSI modifier encoding");
    expect(nativeBoundaryVerify).toContain("pane metadata sync");
    expect(nativeBoundaryVerify).toContain("pane layout persistence");
    expect(nativeBoundaryVerify).toContain("backend PTY cleanup failures are telemetry-visible");
    expect(nativeBoundaryVerify).toContain(
      "stale overlays, font-metric drift, watcher leaks, and command-history loss",
    );
    expect(nativeTerminalArea).toContain('source: "terminal.snapshot-overlay"');
    expect(nativeTerminalArea).toContain('operation: "dismiss_ghost_layer"');
    expect(nativeTerminalArea).toContain('operation: "ghost_diff_layer_removed_listener"');
    expect(nativeTerminalArea).toContain('source: "terminal.input-mirror"');
    expect(nativeTerminalArea).toContain('operation: "suggest_next"');
    expect(nativeTerminalArea).toContain('source: "input-mirror"');
    expect(terminalMetrics).toContain('source: "terminal-metrics"');
    expect(terminalMetrics).toContain('operation: "fonts_ready"');
    expect(gitStatusHook).toContain('source: "git-status.watcher"');
    expect(gitStatusHook).toContain("stop_fs_watcher_after_abort");
    expect(score).toContain("nativeClipboardSource");
    expect(score).toContain("nativeTerminalAreaSource");
    expect(score).toContain("terminalMetricsSource");
    expect(score).toContain("gitStatusHookSource");
    expect(score).toContain("livePanesHookSource");
    expect(score).toContain("ghostLayersHookSource");
    expect(score).toContain("paneTreeHookSource");
    expect(score).toContain("paneTreePersistenceSource");
    expect(paneTreeContainer).toContain('source: "pane-metadata"');
    expect(paneTreeContainer).toContain('operation: "rename_pane"');
    expect(paneTreeContainer).toContain('operation: "set_pane_role"');
    expect(paneTreeContainer).toContain('"list_terminals_after_empty_panes"');
    expect(livePanesHook).toContain('source: "live-panes"');
    expect(livePanesHook).toContain('operation: "list_terminals"');
    expect(livePanesHook).toContain("Live terminal truth unavailable");
    expect(ghostLayersHook).toContain('source: "ghost-layers"');
    expect(ghostLayersHook).toContain("if (!isTauriRuntime())");
    expect(ghostLayersHook).toContain('"list_ghost_layers"');
    expect(ghostLayersHook).toContain('"dismiss_ghost_layer"');
    expect(ghostLayersHook).toContain('"get_ghost_layer_file"');
    expect(paneTreeHook).toContain('source: "pane-tree"');
    expect(paneTreeHook).toContain("if (!isTauriRuntime()) return");
    expect(paneTreeHook).toContain("close_all_terminals_close_terminal");
    expect(paneTreePersistence).toContain('source: "pane-tree-persistence"');
    expect(paneTreePersistence).toContain("if (!isTauriRuntime()) return null");
    expect(paneTreePersistence).toContain("if (!isTauriRuntime()) return false");
    expect(paneTreePersistence).toContain('"local_load_snapshot"');
    expect(paneTreePersistence).toContain('"backend_save_snapshot"');
    expect(commands).toContain("native_terminal_input_commit");
    expect(commands).toContain("native_terminal_input_focus");
    expect(commands).toContain("native_terminal_input_drain");
    expect(commands).toContain("native_terminal_input_preedit");
    expect(commands).toContain("native_terminal_input_status");
    expect(commands).toContain("commit_native_terminal_input(&app, host, terminal_id, data, source).await");
    expect(commands).toContain('"native-input-surface".to_string()');
    expect(commands).toContain("terminal_write_async(app, &terminal_id, &bytes)");
    expect(commands).toContain("native_input_rejected");
    expect(lib).toContain("term::NativeTerminalInputHost::new()");
    expect(lib).toContain("ipc::native_terminal_input_commit");
    expect(lib).toContain("ipc::native_terminal_input_focus");
    expect(lib).toContain("ipc::native_terminal_input_drain");
    expect(nativeInput).toContain("webview_composition_bridge_required: true");
    expect(nativeInput).toContain("native_composition_surface_ready");
    expect(nativeInput).toContain("CreateWindowExW");
    expect(nativeInput).toContain("WM_IME_STARTCOMPOSITION");
    expect(nativeInput).toContain("WM_IME_SETCONTEXT");
    expect(nativeInput).toContain("ISC_SHOWUICOMPOSITIONWINDOW");
    expect(nativeInput).toContain("WM_IME_COMPOSITION");
    expect(nativeInput).toContain("GCS_RESULTSTR");
    expect(nativeInput).toContain("GCS_COMPSTR");
    expect(nativeInput).toContain("composition_text");
    expect(nativeInput).toContain("read_native_ime_composition_text");
    expect(canvasIme).toContain("native_terminal_input_preedit");
    expect(nativeInput).toContain("AelyrisNativeTerminalInputSurface");
    expect(nativeInput).toContain("RegisterClassW");
    expect(nativeInput).toContain("apply_native_surface_ime_position");
    expect(nativeInput).toContain("CFS_RECT");
    expect(nativeInput).toContain("terminal_text_for_native_char");
    expect(nativeInput).toContain("OS paint path");
    expect(nativeInput).toContain("WM_NCCREATE");
    expect(nativeInput).toContain("GWLP_USERDATA");
    expect(nativeInput).toContain("WM_NCDESTROY");
    expect(nativeInput).toContain("DefWindowProcW");
    expect(nativeInput).not.toContain("SetWindowSubclass");
    expect(nativeInput).not.toContain("DefSubclassProc");
    expect(nativeInput).not.toContain("GWLP_WNDPROC");
    expect(nativeInput).toContain("WM_KEYDOWN");
    expect(nativeInput).toContain("WM_PASTE");
    expect(nativeInput).toContain("read_native_clipboard_text_for_paste");
    expect(nativeInput).toContain("CLIPBOARD_OPEN_RETRY_COUNT");
    expect(nativeInput).toContain("CLIPBOARD_OPEN_RETRY_DELAY_MS");
    expect(nativeInput).toContain("classify_native_terminal_paste_input");
    expect(nativeInput).toContain("multi-line paste requires explicit UI confirmation");
    expect(nativeInput).toContain("destructive command paste blocked by native input guard");
    expect(nativeInput).toContain("native_paste_guard_event_count");
    expect(nativeInput).toContain("terminal_bytes_for_native_key");
    expect(nativeInput).toContain("pending_bytes");
    expect(nativeInput).toContain("active_terminal_id: Option<String>");
    expect(nativeInput).toContain("push_native_surface_pending_bytes");
    expect(nativeInput).toContain("drain_native_input_text");
    expect(packageJson).toContain('"verify:terminal:native-input"');
    expect(packageJson).toContain('"verify:terminal:native-hwnd-paste"');
    expect(nativeInputVerify).toContain("composition-surface");
    expect(nativeInputVerify).toContain("surface-key-routing");
    expect(nativeInputVerify).toContain("surface-paste-guard");
    expect(nativeInputVerify).toContain("surface-ime-preedit-hidden");
    expect(nativeInputVerify).toContain("surface-window-lifetime");
    expect(nativeInputVerify).toContain("surface-paste-guard-bounded-clipboard-retry");
    expect(nativeInputVerify).toContain("blocks OS preedit painting");
    expect(nativeInputVerify).toContain("no-paint HWND");
    expect(nativeInputVerify).toContain("native HWND paste is intercepted");
    expect(nativeInputVerify).toContain("bounded retry");
    expect(nativeInputVerify).toContain("frontend-native-default");
    expect(nativeInputVerify).toContain("WEBVIEW_IME_FALLBACK_TEST_ID");
    expect(nativeInputVerify).toContain("surface-command");
    expect(nativeInputVerify).toContain("frontend-surface-opt-in");
    expect(nativeInputVerify).toContain("webviewFallbackConditional");
    expect(nativeHwndPasteVerify).toContain("native-hwnd-paste-live.json");
    expect(nativeHwndPasteVerify).toContain("WM_PASTE");
    expect(nativeHwndPasteVerify).toContain("pass-current-native-hwnd-paste-contract");
    expect(nativeHwndPasteVerify).toContain("singleLineLfNormalizedAndExecuted");
    expect(nativeHwndPasteVerify).toContain("destructivePasteBlockedBeforePty");
    expect(nativeHwndPasteVerify).toContain("multilinePasteBlockedBeforePty");
    expect(nativeHwndPasteVerify).toContain("native-input-hwnd-wm-paste");
    expect(nativeHwndPasteVerify).toContain("nativeNoCdpProof");
    expect(nativeHwndPasteVerify).toContain("aelyris-native-paste-guard-proof");
    expect(score).toContain("real-os-soak postcheck is missing; run pnpm verify:production:suspend:postcheck");
    expect(score).toContain("real-os-soak app process probe is not passing");
    expect(score).toContain("real-os-soak PTY API health probe is not passing");
    expect(score).toContain("real-os-soak terminal roundtrip probe is not passing");
    expect(score).toContain("real-os-soak SQLite pane layout probe is not passing");
    expect(score).toContain("realSuspendDiagnosticDetail");
    expect(score).toContain("real-os-soak diagnostic is stale; run pnpm verify:production:suspend:diagnose");
    expect(score).toContain("real-os-soak missing:");
    expect(closeRisks).toContain("REAL_OS_SUSPEND_DIAGNOSTIC");
    expect(closeRisks).toContain('"--diagnose"');
    expect(closeRisks).toContain("diagnosticArtifact");
    expect(closeRisks).toContain("missingFields");
    expect(productionGate).toContain("Real OS sleep/resume diagnostic");
    expect(productionGate).toContain('"verify:production:suspend:diagnose"');
    expect(productionGate).toContain("Real OS sleep/resume evidence");
    expect(productionGate).toContain('"verify:production:suspend"');
    expect(productionGate).toContain("AELYRIS_RELEASE_SLEEP_CYCLE");
    expect(productionGate).toContain("Guarded real OS sleep/resume cycle");
    expect(productionGate).toContain('"verify:production:suspend:cycle"');
    expect(productionGate.indexOf("Real OS sleep/resume evidence")).toBeLessThan(
      productionGate.indexOf("Production risk closure evidence"),
    );
  });

  it("keeps the goal refresh chain non-token and non-sleep by construction", () => {
    const packageJson = readFileSync(join(process.cwd(), "package.json"), "utf8");
    const script = readFileSync(join(process.cwd(), "scripts/verify-goal-non-token-refresh.mjs"), "utf8");

    expect(packageJson).toContain('"verify:goal:refresh-safe": "node scripts/verify-goal-non-token-refresh.mjs"');
    expect(script).toContain("goal-non-token-refresh.json");
    expect(script).toContain("delete env.AELYRIS_AUTH_PROMPT_CONSENT");
    expect(script).toContain("delete env.AELYRIS_AUTH_PROMPT_PROVIDER");
    expect(script).toContain("delete env.AELYRIS_ALLOW_OS_SLEEP");
    expect(script).toContain("verify-terminal-font-render-contract.mjs");
    expect(script).toContain("verify-glass-legibility-contract.mjs");
    expect(script).toContain("verify-native-terminal-input-host.mjs");
    expect(script).toContain("verify-native-boundary-contract.mjs");
    expect(script).toContain("verify-authenticated-ai-cli-preflight-matrix.mjs");
    expect(script).toContain("verify-authenticated-ai-cli-consent-packet.mjs");
    expect(script).toContain("verify-goal-external-gate-readiness.mjs");
    expect(script).toContain("verify-right-rail-goal-track-tauri.mjs");
    expect(script).toContain("AELYRIS_TAURI_GOAL_TRACK_WAIT_MS");
    expect(script).toContain("environment-blocked-current-contract");
    expect(script).toContain("tokenSpendingPromptExecuted: false");
    expect(script).toContain("realOsSleepInvoked: false");
  });

  it("keeps final external gates explicit without running token prompts or OS sleep", () => {
    const packageJson = readFileSync(join(process.cwd(), "package.json"), "utf8");
    const script = readFileSync(join(process.cwd(), "scripts/verify-goal-external-gate-readiness.mjs"), "utf8");
    const finalAudit = readFileSync(join(process.cwd(), "scripts/verify-final-goal-audit.mjs"), "utf8");
    const matrix = readFileSync(join(process.cwd(), "scripts/verify-goal-completion-matrix.mjs"), "utf8");

    expect(packageJson).toContain(
      '"verify:goal:external-gates": "node scripts/verify-goal-external-gate-readiness.mjs"',
    );
    expect(script).toContain("goal-external-gate-readiness.json");
    expect(script).toContain("ready-for-external-operator-gates");
    expect(script).toContain("tokenSpendingPromptExecuted: tokenGateComplete");
    expect(script).toContain("tokenPromptExecutedWithConsent");
    expect(script).toContain("realOsSleepInvoked: false");
    expect(script).toContain("noUnsafeConsentEnvPresent");
    expect(script).toContain("noOsSleepEnvPresent");
    expect(script).toContain("AELYRIS_ALLOW_OS_SLEEP");
    expect(script).toContain("AELYRIS_AUTH_PROMPT_CONSENT");
    expect(script).toContain("pnpm verify:production:suspend:native-user-cycle");
    expect(script).toContain("pnpm verify:terminal:authenticated-ai-cli-prompt");
    expect(script).toContain("pnpm verify:goal:operator-finish");
    expect(script).toContain("token-spending-explicit-consent");
    expect(script).toContain("This readiness verifier does not set AELYRIS_ALLOW_OS_SLEEP");
    expect(script).toContain("external-operator-gates-complete");
    expect(script).toContain("completeExternalGatesProved");
    expect(finalAudit).toContain("externalGateReadinessPath");
    expect(finalAudit).toContain("externalGateReadinessReady");
    expect(finalAudit).toContain("externalGateReadinessComplete");
    expect(finalAudit).toContain("tokenSpendingPromptExecuted === false");
    expect(finalAudit).toContain("realOsSleepInvoked === false");
    expect(matrix).toContain("externalGateReadiness");
    expect(matrix).toContain("ready-for-external-operator-gates");
    expect(matrix).toContain("external-operator-gates-complete");
  });

  it("provides a single safe operator finish handoff for the last external gates", () => {
    const packageJson = readFileSync(join(process.cwd(), "package.json"), "utf8");
    const script = readFileSync(join(process.cwd(), "scripts/verify-goal-operator-finish.mjs"), "utf8");

    expect(packageJson).toContain('"verify:goal:operator-finish": "node scripts/verify-goal-operator-finish.mjs"');
    expect(script).toContain("goal-operator-finish.json");
    expect(script).toContain("I_UNDERSTAND_THIS_MAY_SPEND_TOKENS");
    expect(script).toContain("I_WILL_MANUALLY_SLEEP_WINDOWS_WHILE_VERIFIER_WAITS");
    expect(script).toContain("verify-authenticated-ai-cli-prompt-smoke.mjs");
    expect(script).toContain("verify-real-os-suspend-evidence.mjs");
    expect(script).toContain("--user-sleep-cycle");
    expect(script).toContain("verify-goal-non-token-refresh.mjs");
    expect(script).toContain("verify-final-goal-safe.mjs");
    expect(script).toContain("delete env.AELYRIS_AUTH_PROMPT_CONSENT");
    expect(script).toContain("delete env.AELYRIS_AUTH_PROMPT_PROVIDER");
    expect(script).toContain("delete env.AELYRIS_GOAL_OPERATOR_RUN_SLEEP");
    expect(script).toContain("delete env.AELYRIS_ALLOW_OS_SLEEP");
    expect(script).toContain("externalReadinessArtifactReady");
    expect(script).toContain("spawnBlocked");
    expect(script).toContain("pass-current-artifact-replay");
    expect(script).toContain("tokenSpendingPromptExecutedByThisRun");
    expect(script).toContain("realOsSleepInvokedByThisRun: false");
  });

  it("keeps browser visual QA from reporting desktop-only IPC as runtime fallback", () => {
    const app = readFileSync(join(process.cwd(), "src/App.tsx"), "utf8");
    const paneTreeContainer = readFileSync(
      join(process.cwd(), "src/features/terminal/pane-tree/PaneTreeContainer.tsx"),
      "utf8",
    );
    const ghostLayersHook = readFileSync(join(process.cwd(), "src/shared/hooks/useGhostLayers.ts"), "utf8");

    expect(app).toContain("if (!projectPath || rightRailUsesFixtures || !isTauriRuntime())");
    expect(app).toContain("terminalIds.length === 0 || !isTauriRuntime()");
    expect(app).toContain("if (!isTauriRuntime()) return;");
    expect(app).toContain('operation: "window_setup"');
    expect(app).toContain('operation: "term_command_blocks"');
    expect(paneTreeContainer).toContain("setBackendReconciled(true)");
    expect(paneTreeContainer).toContain("terminalIds.size === 0 || !isTauriRuntime()");
    expect(ghostLayersHook).toContain("setState({ byId: new Map(), seq: 0 })");
  });

  it("keeps the live IME smoke on a clean visual QA URL", () => {
    const script = readFileSync(join(process.cwd(), "scripts/verify-ime.mjs"), "utf8");

    expect(script).toContain("AELYRIS_IME_URL");
    expect(script).toContain("targetImeUrl");
    expect(script).toContain('url.searchParams.set("aelyrisVisualQa", "1")');
    expect(script).toContain('url.searchParams.set("v", "verify-ime-clean")');
    expect(script).toContain('url.searchParams.delete("state")');
    expect(script).toContain('url.searchParams.delete("edgeLoop")');
    expect(script).toContain("page.goto(targetImeUrl()");
  });

  it("keeps live terminal command evidence in the release score", () => {
    const packageJson = readFileSync(join(process.cwd(), "package.json"), "utf8");
    const script = readFileSync(join(process.cwd(), "scripts/verify-live-command-evidence.mjs"), "utf8");
    const score = readFileSync(join(process.cwd(), "scripts/score-release-quality.mjs"), "utf8");
    const promptMarks = readFileSync(join(process.cwd(), "src/shared/hooks/usePromptMarks.ts"), "utf8");
    const promptMarksTest = readFileSync(join(process.cwd(), "src/__tests__/usePromptMarks.test.ts"), "utf8");

    expect(packageJson).toContain(
      '"verify:terminal:command-evidence": "node scripts/verify-live-command-evidence.mjs"',
    );
    expect(script).toContain("term_command_blocks");
    expect(script).toContain("AELYRIS_CMD_EVIDENCE_");
    expect(script).toContain('url.searchParams.delete("state")');
    expect(script).toContain('url.searchParams.delete("edgeLoop")');
    expect(score).toContain("live-command-evidence.json");
    expect(score).toContain('"live-command-evidence"');
    expect(score).toContain("Live terminal command-block evidence");
    expect(score).toContain("live command block is missing prompt-mark/scrollback anchors");
    expect(score).toContain("promptMarksSource");
    expect(promptMarks).toContain('source: "prompt-marks"');
    expect(promptMarks).toContain('"term_prompt_marks"');
    expect(promptMarks).toContain('"prompt_marks_listen"');
    expect(promptMarksTest).toContain("silently losing command evidence anchors");
  });

  it("keeps multi-pane long-scrollback command evidence in the release score", () => {
    const packageJson = readFileSync(join(process.cwd(), "package.json"), "utf8");
    const script = readFileSync(join(process.cwd(), "scripts/verify-multipane-command-evidence.mjs"), "utf8");
    const score = readFileSync(join(process.cwd(), "scripts/score-release-quality.mjs"), "utf8");

    expect(packageJson).toContain(
      '"verify:terminal:multipane-command-evidence": "node scripts/verify-multipane-command-evidence.mjs"',
    );
    expect(script).toContain("mux_split_pane");
    expect(script).toContain("mux_close_pane");
    expect(script).toContain("term_history_rows");
    expect(script).toContain("term_command_blocks");
    expect(script).toContain("AELYRIS_MULTIPANE_COMMAND_EVIDENCE");
    expect(score).toContain("multipane-command-evidence.json");
    expect(score).toContain('"multipane-command-evidence"');
    expect(score).toContain("Multi-pane scrollback command evidence");
    expect(score).toContain("long scrollback markers were not retained in both panes");
  });

  it("keeps recovered command evidence wired into persistence and the release score", () => {
    const packageJson = readFileSync(join(process.cwd(), "package.json"), "utf8");
    const script = readFileSync(join(process.cwd(), "scripts/verify-recovered-command-evidence.mjs"), "utf8");
    const score = readFileSync(join(process.cwd(), "scripts/score-release-quality.mjs"), "utf8");
    const commands = readFileSync(join(process.cwd(), "src-tauri/src/ipc/commands.rs"), "utf8");
    const migrations = readFileSync(join(process.cwd(), "src-tauri/src/db/migrations.rs"), "utf8");
    const queries = readFileSync(join(process.cwd(), "src-tauri/src/db/queries.rs"), "utf8");
    const lib = readFileSync(join(process.cwd(), "src-tauri/src/lib.rs"), "utf8");

    expect(packageJson).toContain(
      '"verify:terminal:recovered-command-evidence": "node scripts/verify-recovered-command-evidence.mjs"',
    );
    expect(script).toContain("term_persisted_command_blocks");
    expect(script).toContain("term_command_blocks");
    expect(script).toContain("AELYRIS_RECOVERED_EVIDENCE_");
    expect(script).toContain('url.searchParams.set("v", "recovered-command-evidence")');
    expect(score).toContain("recovered-command-evidence.json");
    expect(score).toContain('"recovered-command-evidence"');
    expect(score).toContain("Recovered terminal command evidence");
    expect(score).toContain("command block was not persisted for reconnect recovery");
    expect(migrations).toContain("terminal_command_blocks");
    expect(queries).toContain("save_command_block");
    expect(queries).toContain("recent_command_blocks");
    expect(commands).toContain("term_persisted_command_blocks");
    expect(commands).toContain("persist_command_block");
    expect(commands).toContain("adopt_sidecar_terminals");
    expect(lib).toContain("ipc::adopt_sidecar_terminals");
  });

  it("keeps process reconnect command evidence wired into the release score", () => {
    const packageJson = readFileSync(join(process.cwd(), "package.json"), "utf8");
    const script = readFileSync(join(process.cwd(), "scripts/verify-process-reconnect-command-evidence.mjs"), "utf8");
    const score = readFileSync(join(process.cwd(), "scripts/score-release-quality.mjs"), "utf8");

    expect(packageJson).toContain(
      '"verify:terminal:process-reconnect-command-evidence": "node scripts/verify-process-reconnect-command-evidence.mjs"',
    );
    expect(script).toContain("Stop-Process");
    expect(script).toContain("sidecarRetainedTerminal");
    expect(script).toContain("sidecarRetainedSplitTerminal");
    expect(script).toContain("terminalAdoptedAfterRestart");
    expect(script).toContain("splitTerminalAdoptedAfterRestart");
    expect(script).toContain("term_persisted_command_blocks");
    expect(script).toContain("mux_split_pane");
    expect(script).toContain("AELYRIS_PROCESS_RECONNECT_BEFORE_");
    expect(script).toContain("AELYRIS_PROCESS_RECONNECT_AFTER_");
    expect(script).toContain("AELYRIS_PROCESS_RECONNECT_SPLIT_AFTER_");
    expect(score).toContain("process-reconnect-command-evidence.json");
    expect(score).toContain('"process-reconnect-command-evidence"');
    expect(score).toContain("Process reconnect terminal evidence");
    expect(score).toContain("restarted Aelyris did not adopt the sidecar terminal");
    expect(score).toContain("restarted Aelyris did not adopt the split sidecar terminal");
  });

  it("keeps live AI CLI post-launch chaos wired into release confidence", () => {
    const packageJson = readFileSync(join(process.cwd(), "package.json"), "utf8");
    const script = readFileSync(join(process.cwd(), "scripts/verify-live-tauri-pty-ai-cli-chaos.mjs"), "utf8");
    const score = readFileSync(join(process.cwd(), "scripts/score-release-quality.mjs"), "utf8");
    const lib = readFileSync(join(process.cwd(), "src-tauri/src/lib.rs"), "utf8");
    const ptySidecar = readFileSync(join(process.cwd(), "src-tauri/src/pty_sidecar.rs"), "utf8");

    expect(packageJson).toContain(
      '"verify:terminal:ai-cli-post-launch-chaos": "node scripts/verify-live-tauri-pty-ai-cli-chaos.mjs"',
    );
    expect(packageJson).toContain(
      '"verify:terminal:authenticated-ai-cli-prompt": "node scripts/verify-authenticated-ai-cli-prompt-smoke.mjs"',
    );
    expect(packageJson).toContain(
      '"verify:terminal:authenticated-ai-cli-preflight-matrix": "node scripts/verify-authenticated-ai-cli-preflight-matrix.mjs"',
    );
    expect(packageJson).toContain(
      '"verify:terminal:authenticated-ai-cli-consent-packet": "node scripts/verify-authenticated-ai-cli-consent-packet.mjs"',
    );
    expect(packageJson).toContain('"verify:tauri-runtime-hygiene": "node scripts/verify-tauri-runtime-hygiene.mjs"');
    expect(packageJson).toContain(
      '"tauri:dev": "powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-pty-sidecar-dev.ps1 && tauri dev --config src-tauri/tauri.dev.conf.json"',
    );
    const devSidecarBuild = readFileSync(join(process.cwd(), "scripts/build-pty-sidecar-dev.ps1"), "utf8");
    expect(devSidecarBuild).toContain("src-tauri/pty-server/Cargo.toml");
    expect(devSidecarBuild).toContain("AELYRIS_DEV_SIDECAR_REPLACE_RETRIES");
    expect(devSidecarBuild).toContain("Stop-ProcessesUsingPath");
    expect(devSidecarBuild).toContain("Get-CimInstance Win32_Process");
    expect(devSidecarBuild).toContain("Replace-DevSidecarExecutable");
    expect(script).toContain("smokeAiCliKillCleanup");
    expect(script).toContain("spawn_interactive_agent");
    expect(script).toContain("aiCliKillCleanup");
    expect(script).toContain("remainingSessionsAfterCleanup");
    expect(script).toContain("ptyForceRestart");
    expect(script).toContain("waitForPowerShellReady");
    expect(script).toContain("cleanChaosQaUrl");
    expect(script).toContain('url.searchParams.set("v", "live-pty-ai-cli-chaos")');
    expect(script).toContain('const STALE_QA_PARAMS = ["state", "edgeLoop", "dashboardState"]');
    expect(script).toContain("!url.searchParams.has(key)");
    expect(script).toContain('status: "unavailable"');
    expect(script).toContain('report.dashboardTruth.status === "unavailable"');
    const promptSmoke = readFileSync(
      join(process.cwd(), "scripts/verify-authenticated-ai-cli-prompt-smoke.mjs"),
      "utf8",
    );
    expect(promptSmoke).toContain("I_UNDERSTAND_THIS_MAY_SPEND_TOKENS");
    expect(promptSmoke).toContain("requires_opt_in");
    expect(promptSmoke).toContain("wouldSpendTokens");
    expect(promptSmoke).toContain("tokenSpendingExecutionBlocked");
    expect(promptSmoke).toContain("safeNoPromptSent");
    expect(promptSmoke).toContain("consentPacketReady");
    expect(promptSmoke).toContain("nonTokenPreflightReady");
    expect(promptSmoke).toContain("preflight_artifacts_green_without_prompt");
    expect(promptSmoke).toContain("PROVIDER_EXPLICIT");
    expect(promptSmoke).toContain("provider_required");
    expect(promptSmoke).toContain("unsupported_provider");
    expect(promptSmoke).toContain("explicit_provider_required_before_prompt");
    expect(promptSmoke).toContain("real-ai-cli-binary-probe.json");
    expect(promptSmoke).toContain("interactive-ai-cli-boundary.json");
    expect(promptSmoke).toContain("p2-07-live-tauri-pty-ai-cli-chaos.json");
    expect(promptSmoke).toContain("nextCommand");
    expect(promptSmoke).toContain("spawn_interactive_agent");
    expect(promptSmoke).toContain("promptMarkerObserved");
    expect(promptSmoke).toContain("sessionBaseline");
    expect(promptSmoke).toContain("recordCleanup");
    expect(promptSmoke).toContain("cleanupAfterFailure");
    expect(promptSmoke).toContain("unexpectedNewSessions");
    expect(promptSmoke).toContain(
      'ACCEPTED_AGENT_BACKENDS = new Set(["native", "sidecar", "sidecar-command-session"])',
    );
    expect(promptSmoke).toContain("browser.disconnect");
    expect(promptSmoke).toContain("AELYRIS_AUTH_PROMPT_CLOSE_BROWSER");
    expect(promptSmoke).toContain("browserCloseRequested");
    expect(promptSmoke).toContain("createHash");
    expect(promptSmoke).toContain("outputEvidence");
    expect(promptSmoke).toContain("raw terminal output not persisted");
    expect(promptSmoke).not.toContain("report.outputTail");
    expect(promptSmoke).not.toContain("outputTail");
    const promptMatrix = readFileSync(
      join(process.cwd(), "scripts/verify-authenticated-ai-cli-preflight-matrix.mjs"),
      "utf8",
    );
    const consentPacket = readFileSync(
      join(process.cwd(), "scripts/verify-authenticated-ai-cli-consent-packet.mjs"),
      "utf8",
    );
    expect(promptMatrix).toContain('const PROVIDERS = ["codex", "claude", "gemini"]');
    expect(promptMatrix).toContain("tokenSpendingExecutionBlocked");
    expect(promptMatrix).toContain("safeNoPromptSent");
    expect(promptMatrix).toContain("optInCommand(provider)");
    expect(promptMatrix).toContain("ARTIFACT_REFRESH_COMMANDS");
    expect(promptMatrix).toContain("artifactBlockingReason");
    expect(promptMatrix).toContain("refreshCommand");
    expect(promptMatrix).toContain("expiresAt");
    expect(promptMatrix).toContain("blockingArtifacts");
    expect(promptMatrix).toContain("pnpm verify:terminal:ai-cli-post-launch-chaos");
    expect(promptMatrix).toContain("node scripts/verify-ime.mjs");
    expect(promptMatrix).toContain("no-token-unless-consent-env-is-set");
    expect(consentPacket).toContain("authenticated-ai-cli-consent-packet.json");
    expect(consentPacket).toContain("consentPacketSha256");
    expect(consentPacket).toContain("consentPhraseSha256");
    expect(consentPacket).toContain("noRawPromptTextPersisted");
    expect(consentPacket).toContain("allProviderOptInCommandsReady");
    expect(consentPacket).toContain("providerGuardBlocksPrompt");
    expect(consentPacket).toContain("tokenPromptExecutedWithConsent");
    expect(consentPacket).toContain("promptStateValid");
    const runtimeHygiene = readFileSync(join(process.cwd(), "scripts/verify-tauri-runtime-hygiene.mjs"), "utf8");
    expect(runtimeHygiene).toContain("STATUS_HEAP_CORRUPTION");
    expect(runtimeHygiene).toContain("STATUS_ACCESS_VIOLATION");
    expect(runtimeHygiene).toContain("STATUS_ILLEGAL_INSTRUCTION");
    expect(runtimeHygiene).toContain("0xc000001d");
    expect(runtimeHygiene).toContain("probePort");
    expect(runtimeHygiene).toContain("queryDevPortOwners");
    expect(runtimeHygiene).toContain("workspaceOwnedOpen");
    expect(runtimeHygiene).toContain("foreignOpen");
    expect(runtimeHygiene).toContain("queryWorkspaceProcesses");
    expect(runtimeHygiene).toContain("discoverTauriDevLogRuns");
    expect(runtimeHygiene).toContain("activeLogRun");
    expect(runtimeHygiene).toContain("sanitizeLogLine");
    expect(runtimeHygiene).toContain("redactHistoricalMatch");
    expect(runtimeHygiene).toContain("previousRunCrashMatches");
    expect(runtimeHygiene).toContain("previousRunHelperOutputLeaks");
    expect(runtimeHygiene).toContain("historicalIncidentClosure");
    expect(runtimeHygiene).toContain("cleanSuccessorRunCount");
    expect(runtimeHygiene).toContain("historicalIncidentsHaveCleanSuccessor");
    expect(runtimeHygiene).toContain("HELPER_OUTPUT_PATTERN");
    expect(runtimeHygiene).toContain("noHelperOutputLeaks");
    expect(runtimeHygiene).toContain("noStalePidFiles");
    expect(ptySidecar).toContain('hidden_command("icacls")');
    expect(ptySidecar).toContain('hidden_command("attrib")');
    expect(ptySidecar).toContain("stdout(std::process::Stdio::null())");
    expect(ptySidecar).toContain("stderr(std::process::Stdio::null())");
    expect(lib).toContain("apply_windows_app_identity();");
    expect(lib).toContain("AELYRIS_DISABLE_DWM_CHROME");
    expect(lib).toContain("direct DWM chrome disabled by env; using Tauri windowEffects");
    expect(score).toContain("p2-07-live-tauri-pty-ai-cli-chaos.json");
    expect(score).toContain('"live-ai-cli-post-launch-chaos"');
    expect(score).toContain("Live AI CLI post-launch chaos");
    expect(score).toContain("live AI CLI post-launch chaos artifact is missing, stale, or not passing");
    expect(score).toContain("liveAiCliPostLaunchCleanUrl");
    expect(score).toContain("live AI CLI chaos did not prove shell prompt readiness before terminal writes");
    expect(score).toContain("live AI CLI chaos did not prove stale QA URL state was removed");
    expect(score).toContain("live AI CLI chaos did not prove AI CLI spawn/kill cleanup");
    expect(score).toContain("live AI CLI chaos left interactive sessions after cleanup");
    expect(score).toContain('"tauri-runtime-hygiene"');
    expect(score).toContain("Tauri runtime crash and residue hygiene");
    expect(score).toContain(
      "latest Tauri dev logs contain crash markers such as STATUS_HEAP_CORRUPTION or STATUS_ILLEGAL_INSTRUCTION",
    );
    expect(score).toContain("latest Tauri dev logs contain helper command output leaks");
    expect(score).toContain("historical Tauri runtime incidents do not have a newer clean verification run");
    expect(score).toContain("helper output is not silenced");
    expect(score).toContain("direct DWM chrome is not env-gated");
    expect(score).toContain("authenticated-ai-cli-prompt-smoke.json");
    expect(score).toContain('"authenticated-ai-cli-prompt-smoke"');
    expect(score).toContain("Authenticated AI CLI prompt smoke");
    expect(score).toContain("authenticatedAiCliPromptRequiresOptIn");
    expect(score).toContain("authenticatedAiCliPromptNoTokenPreflightReady");
    expect(score).toContain("authenticatedAiCliPromptPreflightArtifactsFresh");
    expect(score).toContain("authenticatedAiCliPromptStructuredCleanup");
    expect(score).toContain("authenticatedAiCliPromptOutputEvidencePrivacy");
    expect(score).toContain("authenticated AI CLI prompt smoke would persist raw terminal output");
    expect(score).toContain('"authenticated-ai-cli-preflight-matrix"');
    expect(score).toContain("Authenticated AI CLI provider preflight matrix");
    expect(score).toContain("authenticatedAiCliConsentPacketPass");
    expect(score).toContain(
      "authenticated prompt consent packet artifact is missing, stale, or not proving exact opt-in command",
    );
    expect(score).toContain("Codex, Claude, and Gemini are all preflight ready");
    expect(score).toContain("authenticatedAiCliPreflightMatrixRefreshMetadataPass");
    expect(score).toContain("authenticatedAiCliPreflightRequiredArtifactIds");
    expect(score).toContain("artifactRefreshCommandsReady");
    expect(score).toContain("refreshCommand");
    expect(score).toContain("right-panel-goal-track-artifact-refresh");
    expect(score).toContain("right-panel-goal-track-freshness-radar");
    expect(score).toContain("AuthenticatedPromptArtifactFreshnessRadar");
    expect(score).toContain("provider preflight matrix does not expose refresh commands for every artifact");
    expect(score).toContain("not all AI CLI providers are no-token preflight ready");
    expect(score).toContain("non-token preflight artifacts are green");
    expect(score).toContain("authenticated AI CLI prompt smoke non-token preflight artifacts are incomplete or stale");
    expect(score).toContain("authenticated AI CLI prompt smoke requires explicit token-spend consent");
    expect(score).toContain("authenticated AI CLI prompt smoke did not capture a session baseline before spawn");
    expect(score).toContain("authenticated AI CLI prompt smoke did not observe the expected prompt marker");
    expect(score).toContain("authenticated AI CLI prompt smoke did not prove structured session cleanup");
  });

  it("keeps theme customization and preset isolation wired into release confidence", () => {
    const score = readFileSync(join(process.cwd(), "scripts/score-release-quality.mjs"), "utf8");
    const settings = readFileSync(join(process.cwd(), "src/features/settings/Settings.tsx"), "utf8");
    const moods = readFileSync(join(process.cwd(), "src/shared/themes/moods/material.ts"), "utf8");
    const themeApplier = readFileSync(join(process.cwd(), "src/shared/hooks/useTheme.ts"), "utf8");
    const appStore = readFileSync(join(process.cwd(), "src/shared/store/appStore.ts"), "utf8");
    const tauriSettings = readFileSync(join(process.cwd(), "src-tauri/src/config/settings.rs"), "utf8");
    const packageJson = readFileSync(join(process.cwd(), "package.json"), "utf8");
    const glassLegibility = readFileSync(join(process.cwd(), "scripts/verify-glass-legibility-contract.mjs"), "utf8");
    const antiStall = readFileSync(join(process.cwd(), "scripts/verify-goal-anti-stall-contract.mjs"), "utf8");
    const finalGoalAudit = readFileSync(join(process.cwd(), "scripts/verify-final-goal-audit.mjs"), "utf8");
    const completionMatrix = readFileSync(join(process.cwd(), "scripts/verify-goal-completion-matrix.mjs"), "utf8");

    expect(score).toContain('"theme-customization-guard"');
    expect(score).toContain("Theme customization and preset isolation");
    expect(score).toContain("mood material defaults are not centralized for every preset");
    expect(score).toContain("theme switching does not explicitly clear old mood CSS tokens");
    expect(score).toContain("settings UI does not expose image picker, opacity, scale, and placement controls");
    expect(score).toContain("Rust config does not round-trip material and wallpaper customization");
    expect(score).toContain(
      "theme palette and glass-legibility contracts do not guard Sakura bleed, white-peach rails, preset contrast, opaque text, and translucent material layers",
    );
    expect(score).toContain(
      "store persistence failures for model, budget, Kanban, or open files are not telemetry-visible",
    );
    expect(packageJson).toContain('"verify:ui:glass-legibility": "node scripts/verify-glass-legibility-contract.mjs"');
    expect(packageJson).toContain('"verify:goal:anti-stall": "node scripts/verify-goal-anti-stall-contract.mjs"');
    expect(glassLegibility).toContain("textFullyPainted");
    expect(glassLegibility).toContain("materialTranslucencyProved");
    expect(glassLegibility).toContain("pass-current-glass-legibility-contract");
    expect(antiStall).toContain("pass-current-anti-stall-contract");
    expect(antiStall).toContain("safeFallbackCoversCriticalSteps");
    expect(antiStall).toContain("operatorFinishRequiresExactHumanOptIn");
    expect(antiStall).toContain("nonTokenRefreshHasProgressAndTimeouts");
    expect(antiStall).toContain("nativeAiChaosDefaultWaitMs");
    expect(finalGoalAudit).toContain("glassLegibilityContractReady");
    expect(finalGoalAudit).toContain("goalAntiStallContractReady");
    expect(finalGoalAudit).toContain("antiStallContract");
    expect(finalGoalAudit).toContain("opaque text, and translucent glass-material contracts");
    expect(finalGoalAudit).toContain("glass-legibility-contract.json");
    expect(finalGoalAudit).toContain("goal-anti-stall-contract.json");
    expect(completionMatrix).toContain("glassLegibilityContract");
    expect(completionMatrix).toContain("goalAntiStallContract");
    expect(completionMatrix).toContain('requiredArtifacts: ["glassLegibilityContract"]');
    expect(moods).toContain("MOOD_MATERIAL_DEFAULTS");
    expect(moods).toContain("SAKURA_MATERIAL_DEFAULTS");
    expect(moods).toContain("materialOverridesToCSS");
    expect(themeApplier).toContain("for (const key of MOOD_CSS_KEYS)");
    expect(themeApplier).toContain("root.style.removeProperty(key)");
    expect(themeApplier).toContain("--aelyris-wallpaper-image");
    expect(themeApplier).toContain("--aelyris-wallpaper-opacity");
    expect(themeApplier).toContain("--aelyris-wallpaper-position-x");
    expect(themeApplier).toContain("--aelyris-wallpaper-size");
    expect(themeApplier).toContain('source: "theme-customization"');
    expect(themeApplier).toContain('"persist_theme_preferences"');
    expect(settings).toContain("chooseWallpaperImage");
    expect(settings).toContain("@tauri-apps/plugin-dialog");
    expect(settings).toContain("settings-wallpaper-opacity");
    expect(settings).toContain("settings-wallpaper-scale");
    expect(settings).toContain("settings-wallpaper-position-x");
    expect(settings).toContain("settings-wallpaper-position-y");
    expect(settings).toContain('aria-label="Window opacity"');
    expect(settings).toContain("aria-label={`" + "$" + "{control.label}" + " opacity`}");
    expect(settings).toContain('aria-label="Choose background image file"');
    expect(settings).toContain('aria-label="Background image opacity"');
    expect(settings).toContain('aria-label="Background image scale"');
    expect(settings).toContain('aria-label="Background image horizontal position"');
    expect(settings).toContain('aria-label="Background image vertical position"');
    expect(appStore).toContain("replaceMoodMaterialOverrides");
    expect(appStore).toContain("replaceWallpaperSettingsByMood");
    expect(appStore).toContain('"persist_selected_model"');
    expect(appStore).toContain('"persist_agent_budget_spent"');
    expect(appStore).toContain('"persist_kanban_tasks"');
    expect(appStore).toContain('"persist_open_files"');
    expect(tauriSettings).toContain("MoodMaterialOverrideConfig");
    expect(tauriSettings).toContain("WallpaperConfig");
    expect(tauriSettings).toContain("appearance_material_and_wallpaper_customization_round_trips");
  });

  it("keeps app-state persistence failures visible to release confidence", () => {
    const score = readFileSync(join(process.cwd(), "scripts/score-release-quality.mjs"), "utf8");
    const appStore = readFileSync(join(process.cwd(), "src/shared/store/appStore.ts"), "utf8");
    const recentCommands = readFileSync(join(process.cwd(), "src/shared/lib/recentCommands.ts"), "utf8");
    const helmPanel = readFileSync(join(process.cwd(), "src/features/helm/HelmPanel.tsx"), "utf8");
    const projectHeader = readFileSync(join(process.cwd(), "src/features/header/ProjectHeaderBar.tsx"), "utf8");

    expect(score).toContain('"app-state-fallback-visibility"');
    expect(score).toContain("App state fallback visibility");
    expect(score).toContain("recent command persistence failures can silently drop command-palette state");
    expect(score).toContain("Helm task persistence failures can silently lose task state");
    expect(score).toContain("window chrome failures can leave minimize, maximize, or close actions as silent no-ops");
    expect(appStore).not.toContain("catch {}");
    expect(recentCommands).toContain('source: "recent-commands"');
    expect(recentCommands).toContain('"persist_recent_commands"');
    expect(helmPanel).toContain('source: "helm-tasks"');
    expect(helmPanel).toContain("Array.isArray(parsed)");
    expect(helmPanel).toContain('"persist_helm_tasks"');
    expect(projectHeader).toContain('source: "window-chrome"');
    expect(projectHeader).toContain('"toggle_maximize_window"');
  });

  it("keeps the Command Center end-to-end scenario wired into release confidence", () => {
    const packageJson = readFileSync(join(process.cwd(), "package.json"), "utf8");
    const score = readFileSync(join(process.cwd(), "scripts/score-release-quality.mjs"), "utf8");
    const script = readFileSync(join(process.cwd(), "scripts/verify-command-center-scenario.mjs"), "utf8");
    const test = readFileSync(join(process.cwd(), "src/__tests__/commandCenterScenario.test.ts"), "utf8");

    expect(packageJson).toContain(
      '"verify:command-center-scenario": "node scripts/verify-command-center-scenario.mjs"',
    );
    expect(script).toContain("AELYRIS_COMMAND_CENTER_SCENARIO_OUT");
    expect(script).toContain("commandCenterScenario.test.ts");
    expect(score).toContain("command-center-scenario.json");
    expect(score).toContain('"command-center-scenario"');
    expect(score).toContain("Command Center end-to-end scenario");
    expect(score).toContain("command center scenario artifact is missing, stale, or failing");
    expect(score).toContain("Plan/Run/Observe/Route/Review/Preserve/Recover");
    expect(score).toContain("command center scenario does not prove final report and context-pack handoff readiness");
    expect(test).toContain("deriveAiCliLaunchPlan");
    expect(test).toContain("deriveRightRailActions");
    expect(test).toContain("traceFileProvenance");
    expect(test).toContain("traceAgentImpact");
    expect(test).toContain("buildContextPack");
    expect(test).toContain("buildRightRailActionAuditPayload");
    expect(test).toContain("command-center-scenario-pack");
    expect(test).toContain("cmd-typecheck-native-terminal");
  });

  it("keeps the final goal track visible in the right rail and release score", () => {
    const src = getSrc();
    const styles = getStyles();
    const score = readFileSync(join(process.cwd(), "scripts/score-release-quality.mjs"), "utf8");
    const packageJson = readFileSync(join(process.cwd(), "package.json"), "utf8");
    const commandEvidenceScript = readFileSync(
      join(process.cwd(), "scripts/verify-right-rail-command-evidence.mjs"),
      "utf8",
    );
    const tauriGoalTrackScript = readFileSync(
      join(process.cwd(), "scripts/verify-right-rail-goal-track-tauri.mjs"),
      "utf8",
    );
    const goalTrack = readFileSync(join(process.cwd(), "src/shared/lib/rightRailGoalTrack.ts"), "utf8");
    const goalTrackTest = readFileSync(join(process.cwd(), "src/__tests__/rightRailGoalTrack.test.ts"), "utf8");
    const releaseQuality = readFileSync(join(process.cwd(), "src/shared/lib/releaseQuality.ts"), "utf8");
    const releaseQualityTest = readFileSync(join(process.cwd(), "src/__tests__/releaseQuality.test.ts"), "utf8");
    const consentPacket = readFileSync(join(process.cwd(), "src/shared/lib/authenticatedPromptConsent.ts"), "utf8");
    const consentPacketTest = readFileSync(
      join(process.cwd(), "src/__tests__/authenticatedPromptConsent.test.ts"),
      "utf8",
    );
    const finalGoalAuditScript = readFileSync(join(process.cwd(), "scripts/verify-final-goal-audit.mjs"), "utf8");
    const finalGoalSafeVerifier = readFileSync(join(process.cwd(), "scripts/verify-final-goal-safe.mjs"), "utf8");
    const goalDocumentationFreshnessScript = readFileSync(
      join(process.cwd(), "scripts/verify-goal-documentation-freshness.mjs"),
      "utf8",
    );

    expect(src).toContain("deriveRightRailGoalTrack");
    expect(src).toContain("deriveReleaseQualityGoalInputs");
    expect(src).toContain("parseReleaseQualityReport");
    expect(src).toContain("deriveFinalGoalResidualRisk");
    expect(src).toContain("parseFinalGoalAuditReport");
    expect(src).toContain("deriveFinalGoalRequirementProofs");
    expect(src).toContain("deriveFinalGoalSafeGate");
    expect(src).toContain("parseFinalGoalSafeSummaryReport");
    expect(src).toContain("deriveAuthenticatedPromptConsentPacket");
    expect(src).toContain("parseAuthenticatedPromptConsentReport");
    expect(src).toContain('invoke<string>("read_file", { path: releaseQualityPath })');
    expect(src).toContain('invoke<string>("read_file", { path: finalGoalAuditPath })');
    expect(src).toContain('invoke<string>("read_file", { path: finalGoalSafePath })');
    expect(src).toContain('invoke<string>("read_file", { path: consentPath })');
    expect(src).toContain('".codex-auto/quality/release-quality-score.json"');
    expect(src).toContain('".codex-auto/quality/final-goal-audit.json"');
    expect(src).toContain('".codex-auto/quality/final-goal-safe-summary.json"');
    expect(src).toContain('".codex-auto/production-smoke/authenticated-ai-cli-prompt-smoke.json"');
    expect(src).toContain('".codex-auto/production-smoke/real-ai-cli-binary-probe.json"');
    expect(src).toContain('".codex-auto/production-smoke/native-terminal-input-host.json"');
    expect(src).toContain('".codex-auto/production-smoke/process-reconnect-command-evidence.json"');
    expect(src).toContain('".codex-auto/production-smoke/interactive-ai-cli-boundary.json"');
    expect(src).toContain("setRightRailAiCliLaunchEvidence");
    expect(src).toContain("rightRailAiCliPromptContract");
    expect(src).toContain("evidence: rightRailAiCliLaunchEvidence.evidence");
    expect(src).toContain("preflight: rightRailAiCliLaunchEvidence.preflight");
    expect(src).toContain("requirePreflight: true");
    expect(src).toContain("requirePromptContract: true");
    expect(src).not.toContain("authenticatedPromptConsentRequired: true");
    expect(src).toContain('className="right-panel-goal-track"');
    expect(src).toContain("rightRailGoalTrack.percent");
    expect(src).toContain("rightRailGoalTrack.qualityEvidence.status");
    expect(src).toContain('className="right-panel-goal-track-source"');
    expect(src).toContain('className="right-panel-goal-track-residual"');
    expect(src).toContain('className="right-panel-goal-track-safe"');
    expect(src).toContain("rightRailGoalTrack.safeGate.status");
    expect(src).toContain("rightRailGoalTrack.safeGate.proofRequirementPassCount");
    expect(src).toContain("rightRailGoalTrack.safeGate.proofArtifactPassCount");
    expect(src).toContain("rightRailGoalTrack.safeGate.nonConsentBlockerCount");
    expect(src).toContain("rightRailGoalTrack.safeGate.noTokenPromptSent");
    expect(src).toContain("rightRailGoalTrack.safeGate.tokenSpendingPromptExecuted");
    expect(src).toContain("rightRailGoalTrack.safeGate.releaseHygieneClean");
    expect(src).toContain("rightRailGoalTrack.safeGate.terminalChunkedOscLivePassed");
    expect(src).toContain("rightRailGoalTrack.safeGate.nativeTerminalInputHostPassed");
    expect(src).toContain("rightRailGoalTrack.safeGate.nativeHwndPasteLivePassed");
    expect(src).toContain("data-release-hygiene-clean");
    expect(src).toContain("data-terminal-chunked-osc-live-passed");
    expect(src).toContain("data-native-terminal-input-host-passed");
    expect(src).toContain("data-native-hwnd-paste-live-passed");
    expect(src).toContain("rightRailGoalTrack.safeGate.semanticFreshness");
    expect(src).toContain("rightRailGoalTrack.safeGate.cycleBoundary");
    expect(src).toContain("data-semantic-freshness");
    expect(src).toContain("data-cycle-boundary");
    expect(src).toContain("rightRailGoalTrack.requirementProofs.map");
    expect(src).toContain('className="right-panel-goal-track-requirements"');
    expect(src).toContain('aria-label="Final goal requirement proofs"');
    expect(src).toContain("data-requirement-id");
    expect(src).toContain("data-proof-status");
    expect(src).toContain("data-evidence-count");
    expect(src).toContain('className="right-panel-goal-track-consent"');
    expect(src).toContain('className="right-panel-goal-track-consent-command"');
    expect(src).toContain('aria-label="Authenticated prompt consent command"');
    expect(src).toContain("rightRailGoalTrackConsentProviderEnv");
    expect(src).toContain("data-provider-env");
    expect(src).toContain("AELYRIS_AUTH_PROMPT_PROVIDER=");
    expect(src).toContain('className="right-panel-goal-track-risks"');
    expect(src).toContain('data-source="runtime-fallback"');
    expect(src).toContain('data-source="qa-fixture"');
    expect(src).toContain("rightRailGoalTrack.consentPacket.status");
    expect(src).toContain("rightRailGoalTrack.residualRisk.state");
    expect(src).toContain("rightRailGoalTrack.residualRisk.implementationFixableCount");
    expect(src).toContain("rightRailGraphRiskSummaries");
    expect(src).toContain("rightRailRuntimeFallbackSummaries");
    expect(src).toContain("native boundary escaped");
    expect(src).toContain("event.nativeBoundaryEscaped");
    expect(src).toContain("rightRailGraphQaRiskSummaries");
    expect(src).toContain("isRightRailQaFixtureRisk");
    expect(src).toContain("rightRailGoalTrack.riskEvidence.map");
    expect(src).toContain("rightRailGoalTrack.runtimeFallbackEvidence.map");
    expect(src).toContain("rightRailGoalTrack.qaRiskEvidence.map");
    expect(src).toContain("rightRailGoalTrack.milestones.map");
    expect(src).toContain("rightRailGoalTrack.remainingItems.slice(0, 3)");
    expect(styles).toContain(".right-panel-goal-track");
    expect(styles).toContain(".right-panel-goal-track-source");
    expect(styles).toContain(".right-panel-goal-track-residual");
    expect(styles).toContain(".right-panel-goal-track-safe");
    expect(styles).toContain('.right-panel-goal-track-safe[data-token-spending-prompt-executed="true"]');
    expect(styles).toContain(".right-panel-goal-track-consent");
    expect(styles).toContain(".right-panel-goal-track-consent-command");
    expect(styles).toContain(".right-panel-goal-track-consent-command dd");
    expect(styles).toContain(".right-panel-goal-track-risks");
    expect(styles).toContain(".right-panel-goal-track-requirements");
    expect(styles).toContain('.right-panel-goal-track-requirements li[data-proof-status="missing"]');
    expect(styles).toContain('.right-panel-goal-track-risks[data-source="qa-fixture"]');
    expect(styles).toContain('.right-panel-goal-track-risks[data-source="runtime-fallback"]');
    expect(styles).toContain(".right-panel-goal-track-milestone");
    expect(styles).toContain(':root[data-mood="aelyris-sakura"] .right-panel-goal-track');
    expect(score).toContain('"right-rail-goal-track"');
    expect(score).toContain("Right rail final goal visibility");
    expect(score).toContain("providerEnvRequirement");
    expect(score).toContain("goal-track contracts pass");
    expect(score).toContain("right rail browser smoke artifact does not prove the release-proof milestone");
    expect(score).toContain(
      "right rail Tauri goal-track artifact does not prove fresh quality source and ready consent packet",
    );
    expect(score).toContain("right rail goal track still uses a hardcoded prompt-smoke blocker");
    expect(score).toContain("right rail goal track does not read and render the final audit residual risk register");
    expect(score).toContain("operationalEvidence");
    expect(score).toContain("previousCrashIncidentCount");
    expect(score).toContain("promptProviderGuardReady");
    expect(score).toContain("finalGoalAuditProjectedScorePass");
    expect(score).toContain("final goal audit projected score does not match the current release score model");
    expect(score).toContain("finalGoalAuditResidualRiskPass");
    expect(score).toContain(
      "final goal audit does not classify residual risks as implementation-fixable vs explicit consent",
    );
    expect(score).toContain("finalGoalAuditConsentGatePass");
    expect(score).toContain("final goal audit does not expose the authenticated prompt consent command and env gate");
    expect(score).toContain("finalGoalAuditProviderReadiness");
    expect(score).toContain("finalGoalAuditProviderReadyPass");
    expect(score).toContain("finalGoalAuditNextActionPass");
    expect(score).toContain("tauriGoalTrackSmokeFresh");
    expect(score).toContain('join(ROOT, "src", "shared", "lib", "releaseQuality.ts")');
    expect(score).not.toContain('join(ROOT, "scripts", "score-release-quality.mjs")');
    const tauriGoalTrackResidualBlock = score.match(
      /const tauriGoalTrackResidualRiskPass =[\s\S]*?;\r?\nconst tauriGoalTrackConsentGateProgressPass/,
    );
    expect(tauriGoalTrackResidualBlock).not.toBeNull();
    expect(tauriGoalTrackResidualBlock?.[0]).toContain("tauriGoalTrackSmoke?.checks?.goalTrack?.residualRisk?.state");
    expect(tauriGoalTrackResidualBlock?.[0]).not.toContain("finalGoalAudit");
    expect(tauriGoalTrackResidualBlock?.[0]).not.toContain("currentFinalGoalResidual");
    expect(packageJson).toContain('"verify:right-rail-goal-track-tauri"');
    expect(packageJson).toContain('"verify:final-goal-audit"');
    expect(packageJson).toContain('"verify:goal:safe"');
    expect(packageJson).toContain('"verify:goal:docs"');
    expect(commandEvidenceScript).toContain("readGoalTrack");
    expect(commandEvidenceScript).toContain("Final goal track was not visible");
    expect(commandEvidenceScript).toContain("listed risk blockers without visible risk evidence labels");
    expect(commandEvidenceScript).toContain("leaked QA fixture risks into release blockers");
    expect(tauriGoalTrackScript).toContain("right-rail-goal-track-tauri.json");
    expect(tauriGoalTrackScript).toContain("final-goal-safe-summary.json");
    expect(tauriGoalTrackScript).toContain("quality proof is not fresh in Tauri runtime");
    expect(tauriGoalTrackScript).toContain("consent packet is not ready in Tauri runtime");
    expect(tauriGoalTrackScript).toContain("consent packet command is not visible in Tauri runtime");
    expect(tauriGoalTrackScript).toContain("consent packet required environment is not visible in Tauri runtime");
    expect(tauriGoalTrackScript).toContain("consent packet token gate is not visible in Tauri runtime");
    expect(tauriGoalTrackScript).toContain("consent packet proof freshness radar is not green");
    expect(tauriGoalTrackScript).toContain("consent packet proof freshness radar does not expose next refresh command");
    expect(tauriGoalTrackScript).toContain("final audit residual risk state is stale");
    expect(tauriGoalTrackScript).toContain("final safe gate state is stale in Tauri runtime");
    expect(tauriGoalTrackScript).toContain("final safe gate detail is stale in Tauri runtime");
    expect(tauriGoalTrackScript).toContain("artifact proof pass count");
    expect(tauriGoalTrackScript).toContain("non-consent blocker count");
    expect(tauriGoalTrackScript).toContain("final safe gate does not expose no-token-prompt-sent proof");
    expect(tauriGoalTrackScript).toContain("token-spending prompt was not executed");
    expect(tauriGoalTrackScript).toContain("final safe gate does not expose release hygiene core proof");
    expect(tauriGoalTrackScript).toContain("final safe gate does not expose inline image terminal core proof");
    expect(tauriGoalTrackScript).toContain("final safe gate does not expose native input host core proof");
    expect(tauriGoalTrackScript).toContain("final safe gate does not expose native HWND paste core proof");
    expect(tauriGoalTrackScript).toContain("core: hygiene/supply chain/inline image/native input/native paste");
    expect(tauriGoalTrackScript).toContain("final safe gate semantic freshness is stale");
    expect(tauriGoalTrackScript).toContain("final safe gate cycle boundary is not visible");
    expect(tauriGoalTrackScript).toContain("final goal requirement proofs are not visible");
    expect(tauriGoalTrackScript).toContain("final goal requirement proof status is stale");
    expect(tauriGoalTrackScript).toContain("risk blockers are listed without visible risk evidence labels");
    expect(tauriGoalTrackScript).toContain("QA fixture risks leaked into release blockers");
    expect(tauriGoalTrackScript).toContain("browser.disconnect");
    expect(tauriGoalTrackScript).toContain("AELYRIS_TAURI_GOAL_TRACK_CLOSE_BROWSER");
    expect(goalTrack).toContain("RightRailGoalMilestone");
    expect(goalTrack).toContain("RightRailGoalConsentPacket");
    expect(goalTrack).toContain("RightRailGoalRiskSummary");
    expect(goalTrack).toContain("RightRailGoalResidualRisk");
    expect(goalTrack).toContain("RightRailGoalSafeGate");
    expect(goalTrack).toContain("RightRailGoalRequirementProof");
    expect(goalTrack).toContain("RightRailGoalBoundaryProof");
    expect(goalTrack).toContain("buildBoundaryProofs");
    expect(goalTrack).toContain("native-input-host");
    expect(goalTrack).toContain("native-hwnd-paste");
    expect(goalTrack).toContain("chunked-osc-inline-image");
    expect(goalTrack).toContain("safe-proof-chain");
    expect(goalTrack).toContain("artifactPath");
    expect(goalTrack).toContain("refreshCommand");
    expect(goalTrack).toContain("pnpm verify:terminal:native-input");
    expect(goalTrack).toContain("pnpm verify:goal:safe");
    expect(goalTrack).toContain("qualityEvidenceLocalDate");
    expect(goalTrack).toContain("qualityEvidenceTimeZone");
    expect(goalTrack).toContain("Final safe gate unavailable; run pnpm verify:goal:safe");
    expect(goalTrack).toContain("qaRiskEvidence");
    expect(goalTrack).toContain("runtimeFallbackEvidence");
    expect(goalTrack).toContain("qa-fixture");
    expect(goalTrack).toContain("formatRiskBlocker");
    expect(goalTrack).toContain("formatRuntimeFallbackBlocker");
    expect(goalTrack).toContain("requiresConsentForRefresh");
    expect(goalTrack).toContain("requiresExplicitConsent: requiresConsentForRefresh");
    expect(goalTrack).toContain("Authenticated prompt consent packet unavailable");
    expect(goalTrack).toContain("Authenticated AI CLI prompt smoke still requires explicit token consent");
    expect(consentPacket).toContain("deriveAuthenticatedPromptConsentPacket");
    expect(consentPacket).toContain("safeNoPromptSent");
    expect(consentPacket).toContain("nonTokenPreflightReady");
    expect(consentPacket).toContain("AuthenticatedPromptPreflightArtifactReadiness");
    expect(consentPacket).toContain("artifactReadiness");
    expect(consentPacket).toContain("AuthenticatedPromptArtifactFreshnessRadar");
    expect(consentPacket).toContain("deriveArtifactFreshnessRadar");
    expect(consentPacket).toContain("parseArtifactReadinessEntry");
    expect(goalTrack).toContain("artifactReadiness");
    expect(goalTrack).toContain("artifactFreshness");
    expect(src).toContain("right-panel-goal-track-artifact-refresh");
    expect(src).toContain("right-panel-goal-track-freshness-radar");
    expect(src).toContain("data-next-refresh-command");
    expect(src).toContain("qualityEvidenceLocalDate: releaseQualityGoalInputs?.localDate");
    expect(src).toContain("qualityEvidenceTimeZone: releaseQualityGoalInputs?.timeZone");
    expect(src).toContain('data-local-date={rightRailGoalTrack.qualityEvidence.localDate ?? ""}');
    expect(src).toContain('data-time-zone={rightRailGoalTrack.qualityEvidence.timeZone ?? ""}');
    expect(src).toContain('data-local-date={rightRailGoalTrack.safeGate.localDate ?? ""}');
    expect(src).toContain('data-time-zone={rightRailGoalTrack.safeGate.timeZone ?? ""}');
    expect(src).toContain('className="right-panel-goal-track-boundaries"');
    expect(src).toContain('aria-label="Terminal boundary proofs"');
    expect(src).toContain("rightRailGoalTrack.boundaryProofs.map");
    expect(src).toContain("data-boundary-status={proof.status}");
    expect(src).toContain("data-boundary-source={proof.source}");
    expect(src).toContain("data-boundary-artifact={proof.artifactPath}");
    expect(src).toContain("data-boundary-refresh-command={proof.refreshCommand}");
    expect(src).toContain('className="right-panel-goal-track-boundary-copy"');
    expect(src).toContain("Boundary proof command copied");
    expect(src).toContain("right-panel-goal-track-artifact-refresh-action");
    expect(src).toContain("Non-token proof refresh actions");
    expect(src).toContain("data-goal-refresh-command={action.command}");
    expect(src).toContain("data-goal-refresh-cost-class={action.costClass}");
    expect(releaseQuality).toContain("deriveReleaseQualityGoalInputs");
    expect(releaseQuality).toContain("deriveFinalGoalResidualRisk");
    expect(releaseQuality).toContain("deriveFinalGoalRequirementProofs");
    expect(releaseQuality).toContain("deriveFinalGoalSafeGate");
    expect(releaseQuality).toContain("proofArtifactPassCount");
    expect(releaseQuality).toContain("proofRequirementPassCount");
    expect(releaseQuality).toContain("noTokenPromptSent");
    expect(releaseQuality).toContain("releaseHygieneClean");
    expect(releaseQuality).toContain("terminalChunkedOscLivePassed");
    expect(releaseQuality).toContain("nativeTerminalInputHostPassed");
    expect(releaseQuality).toContain("nativeHwndPasteLivePassed");
    expect(releaseQuality).toContain("coreProofDetail");
    expect(releaseQuality).toContain("core: $" + "{coreProofDetail}");
    expect(releaseQuality).toContain("rightRailGoalTrackSemanticFreshness");
    expect(releaseQuality).toContain("rightRailGoalTrackCycleBoundaryExplained");
    expect(releaseQuality).toContain("semanticFreshness");
    expect(releaseQuality).toContain("cycleBoundary");
    expect(releaseQuality).toContain("parseFinalGoalAuditReport");
    expect(releaseQuality).toContain("parseFinalGoalSafeSummaryReport");
    expect(releaseQuality).toContain("release-quality-score");
    expect(releaseQuality).toContain("localDate");
    expect(releaseQuality).toContain("timeZone");
    expect(releaseQuality).toContain("Final goal audit unavailable; run pnpm verify:final-goal-audit");
    expect(releaseQuality).toContain("Release quality score stale; run pnpm verify:quality-score");
    expect(releaseQualityTest).toContain("turns stale release-quality-score evidence into an explicit release blocker");
    expect(releaseQualityTest).toContain("parses final-goal-audit residual risk");
    expect(releaseQualityTest).toContain(
      "turns missing final-goal-audit evidence into an explicit implementation risk",
    );
    expect(releaseQualityTest).toContain(
      "clears the prompt blocker once the authenticated prompt smoke is actually proven",
    );
    expect(goalTrackTest).toContain(
      "keeps the final goal blocked until the authenticated prompt smoke is explicitly consented",
    );
    expect(goalTrackTest).toContain("blocks release proof when authenticated prompt consent preflight is unavailable");
    expect(goalTrackTest).toContain("turns broken terminal boundary proofs into visible missing evidence");
    expect(goalTrackTest).toContain("track.boundaryProofs");
    expect(goalTrackTest).toContain("2 risk or blocker nodes open: Missing regression proof, Approval gate");
    expect(goalTrackTest).toContain("track.riskEvidence");
    expect(goalTrackTest).toContain("keeps QA fixture risks visible without turning them into release blockers");
    expect(consentPacketTest).toContain("ready no-token consent packet");
    expect(consentPacketTest).toContain("does not hide a missing consent artifact");
    expect(finalGoalAuditScript).toContain("operationalEvidence");
    expect(finalGoalAuditScript).toContain("currentStateDocPaths");
    expect(finalGoalAuditScript).toContain("currentStateDocFreshness");
    expect(finalGoalAuditScript).toContain("currentLocalDate");
    expect(finalGoalAuditScript).toContain('timeZone: "Asia/Tokyo"');
    expect(finalGoalAuditScript).toContain("localDate: currentLocalDate()");
    expect(finalGoalAuditScript).toContain("timeZone: LOCAL_TIME_ZONE");
    expect(finalGoalAuditScript).toContain("projectedScorePercent");
    expect(finalGoalAuditScript).toContain("goalDocumentationFreshness");
    expect(finalGoalAuditScript).toContain("noStaleReleaseReadyClaim");
    expect(finalGoalAuditScript).toContain("consentPacketNamed");
    expect(finalGoalAuditScript).toContain("consentProviderRequired");
    expect(finalGoalAuditScript).toContain("releaseScoreSourcePaths");
    expect(finalGoalAuditScript).toContain("scripts/verify-final-goal-audit.mjs");
    expect(finalGoalAuditScript).toContain("scripts/verify-final-goal-safe.mjs");
    expect(finalGoalAuditScript).toContain("scripts/verify-goal-documentation-freshness.mjs");
    expect(finalGoalAuditScript).toContain("scripts/verify-native-boundary-contract.mjs");
    expect(finalGoalAuditScript).toContain("scripts/verify-native-terminal-input-host.mjs");
    expect(finalGoalAuditScript).toContain("chunkedOscLivePath");
    expect(finalGoalAuditScript).toContain("chunkedOscLiveChecks");
    expect(finalGoalAuditScript).toContain("pass-current-chunked-osc-live-contract");
    expect(finalGoalAuditScript).toContain("scripts/verify-chunked-osc-live.mjs");
    expect(finalGoalAuditScript).toContain("nativeHwndPasteLivePath");
    expect(finalGoalAuditScript).toContain("nativeHwndPasteLiveChecks");
    expect(finalGoalAuditScript).toContain("pass-current-native-hwnd-paste-contract");
    expect(finalGoalAuditScript).toContain("scripts/verify-native-hwnd-paste-live.mjs");
    expect(finalGoalAuditScript).toContain("README.md");
    expect(finalGoalAuditScript).toContain("docs/README.md");
    expect(finalGoalAuditScript).toContain("docs/PUBLICATION_READINESS.md");
    expect(finalGoalAuditScript).toContain("docs/specs/README.md");
    expect(finalGoalAuditScript).toContain("docs/specs/AELYRIS_REQUIREMENTS_SPEC_DESIGN_TRACEABILITY_2026-06-27.md");
    expect(finalGoalAuditScript).toContain("src/features/terminal/keymap.ts");
    expect(finalGoalAuditScript).toContain("src/features/terminal/hooks/useAICliDetection.ts");
    expect(finalGoalAuditScript).toContain("src/shared/hooks/useKeyboardShortcuts.ts");
    expect(finalGoalAuditScript).toContain("src/shared/hooks/useEditableTargetGuard.ts");
    expect(finalGoalAuditScript).toContain("src/shared/lib/bootMetrics.ts");
    expect(finalGoalAuditScript).toContain("src/styles/global.css");
    expect(finalGoalAuditScript).toContain("src-tauri/Cargo.toml");
    expect(finalGoalAuditScript).toContain("latestReleaseScoreDependency");
    expect(finalGoalAuditScript).toContain("releaseScoreFreshness");
    expect(finalGoalAuditScript).toContain("scoreSelfReferenceNote");
    expect(finalGoalAuditScript).toContain("preAudit");
    expect(finalGoalAuditScript).toContain("projectedAfterEvidenceMap");
    expect(finalGoalAuditScript).toContain("finalGoalEvidenceMap");
    expect(finalGoalAuditScript).toContain("residualRiskRegister");
    expect(finalGoalAuditScript).toContain("minimumEvidenceByRequirement");
    expect(finalGoalAuditScript).toContain("evidenceDensity");
    expect(finalGoalAuditScript).toContain("missingEvidenceDensity");
    expect(finalGoalAuditScript).toContain("evidencePathIntegrity");
    expect(finalGoalAuditScript).toContain("missingEvidencePaths");
    expect(finalGoalAuditScript).toContain("missing-or-invalid-evidence-path");
    expect(finalGoalAuditScript).toContain("tryReadJson");
    expect(finalGoalAuditScript).toContain("insufficient-evidence-density");
    expect(finalGoalAuditScript).toContain("themeCustomizationScore");
    expect(finalGoalAuditScript).toContain("commandRecovery?.ok === true");
    expect(finalGoalAuditScript).toContain("failedCommandRecovery.provenanceHasEvidence");
    expect(finalGoalAuditScript).toContain("implementationFixable");
    expect(finalGoalAuditScript).toContain("implementationFixableRisks");
    expect(finalGoalAuditScript).toContain("policyBlockedRisks");
    expect(finalGoalAuditScript).toContain("blocked-only-by-explicit-token-consent");
    expect(finalGoalAuditScript).toContain("app-state-fallback-visibility");
    expect(finalGoalAuditScript).toContain("runtimeHygieneOperationallyClean");
    expect(finalGoalAuditScript).toContain("previousCrashIncidentCount");
    expect(finalGoalAuditScript).toContain("previousHelperOutputLeakCount");
    expect(finalGoalAuditScript).toContain("summarizeHistoricalIncidentClosure");
    expect(finalGoalAuditScript).toContain("historicalIncidentCount");
    expect(finalGoalAuditScript).toContain("historicalIncidentClosure");
    expect(finalGoalAuditScript).toContain("historicalIncidentsHaveCleanSuccessor");
    expect(finalGoalAuditScript).toContain("noHelperOutputLeaks");
    expect(finalGoalAuditScript).toContain("promptProviderGuardReady");
    expect(finalGoalAuditScript).toContain("promptProviderMatrixReady");
    expect(finalGoalAuditScript).toContain("promptConsentPacketReady");
    expect(finalGoalAuditScript).toContain("promptExecutionGate");
    expect(finalGoalAuditScript).toContain("requiredProviderEnv");
    expect(finalGoalAuditScript).toContain("consentPacketArtifact");
    expect(finalGoalAuditScript).toContain("readyToRunAfterConsent");
    expect(finalGoalAuditScript).toContain("providerReadiness");
    expect(finalGoalAuditScript).toContain("AELYRIS_AUTH_PROMPT_CONSENT");
    expect(finalGoalAuditScript).toContain("Set $" + "{promptExecutionGate.requiredEnv} and $");
    expect(finalGoalAuditScript).toContain("{promptExecutionGate.requiredProviderEnv}, then run");
    expect(finalGoalAuditScript).toContain("authenticated-ai-cli-provider-required-smoke.json");
    expect(finalGoalAuditScript).toContain("authenticated-ai-cli-consent-packet.json");
    expect(score).toContain("finalGoalSafeVerifierSource");
    expect(score).toContain("goalDocumentationFreshnessSource");
    expect(score).toContain("goalDocumentationFreshnessPath");
    expect(score).toContain("CURRENT_STATE_DOCS");
    expect(score).toContain("currentLocalDate");
    expect(score).toContain('timeZone: "Asia/Tokyo"');
    expect(score).toContain("localDate: currentLocalDate()");
    expect(score).toContain("timeZone: LOCAL_TIME_ZONE");
    expect(score).toContain("scoreIsCurrentShape");
    expect(score).toContain("goal-documentation-freshness");
    expect(goalDocumentationFreshnessScript).toContain("consentPacketNamed");
    expect(goalDocumentationFreshnessScript).toContain("consentProviderRequired");
    expect(goalDocumentationFreshnessScript).toContain("AELYRIS_AUTH_PROMPT_PROVIDER=codex|claude|gemini");
    expect(goalDocumentationFreshnessScript).toContain("requiredDocPaths");
    expect(goalDocumentationFreshnessScript).toContain("checkedDocCount");
    expect(score).toContain("REQUIRED_GOAL_DOCUMENT_PATHS");
    expect(score).toContain("docs.length >= REQUIRED_GOAL_DOCUMENT_PATHS.length");
    expect(score).toContain("requiredDocsCovered");
    expect(score).toContain("final-goal-audit-after-goal-docs");
    expect(score).toContain("quality-score-final");
    expect(score).toContain("docs/specs/README.md");
    expect(score).toContain("docs/specs/AELYRIS_REQUIREMENTS_SPEC_DESIGN_TRACEABILITY_2026-06-27.md");
    expect(goalDocumentationFreshnessScript).toContain("README.md");
    expect(goalDocumentationFreshnessScript).toContain("docs/README.md");
    expect(goalDocumentationFreshnessScript).toContain("docs/PUBLICATION_READINESS.md");
    expect(score).toContain('"verify:goal:safe"');
    expect(score).toContain("tokenPromptExecutedWithConsent");
    expect(score).toContain("promptExecutionStateReady");
    expect(finalGoalSafeVerifier).toContain("final-goal-safe-summary.json");
    expect(finalGoalSafeVerifier).toContain("sanitizeStepOutput");
    expect(finalGoalSafeVerifier).toContain("<redacted-log-line>");
    expect(finalGoalSafeVerifier).toContain("verify-authenticated-ai-cli-provider-guard.mjs");
    expect(finalGoalSafeVerifier).toContain("verify-authenticated-ai-cli-preflight-matrix.mjs");
    expect(finalGoalSafeVerifier).toContain("verify-authenticated-ai-cli-consent-packet.mjs");
    expect(finalGoalSafeVerifier).toContain("authenticatedConsentPacketVerdict");
    expect(finalGoalSafeVerifier).toContain("verify-goal-external-gate-readiness.mjs");
    expect(finalGoalSafeVerifier).toContain("externalGateReadinessVerdict");
    expect(finalGoalSafeVerifier).toContain("ready-for-external-operator-gates");
    expect(finalGoalSafeVerifier).toContain("operator-gate-no-token-no-sleep-proof");
    expect(finalGoalSafeVerifier).toContain("verify-goal-operator-finish.mjs");
    expect(finalGoalSafeVerifier).toContain("operatorFinishVerdict");
    expect(finalGoalSafeVerifier).toContain("pass-current-operator-finish-contract");
    expect(finalGoalSafeVerifier).toContain("operator-finish-no-stall-handoff");
    expect(finalGoalSafeVerifier).toContain("safeStepEnv");
    expect(finalGoalSafeVerifier).toContain("verify-ai-cli-launch-planner.mjs");
    expect(finalGoalSafeVerifier).toContain("verify-tauri-runtime-hygiene.mjs");
    expect(finalGoalSafeVerifier).toContain("score-release-quality.mjs");
    expect(finalGoalSafeVerifier).toContain("verify-final-goal-audit.mjs");
    expect(finalGoalSafeVerifier).toContain("verify-goal-documentation-freshness.mjs");
    expect(finalGoalSafeVerifier).toContain("final-goal-audit-after-goal-docs");
    expect(finalGoalSafeVerifier).toContain("quality-score-final");
    expect(finalGoalSafeVerifier).toContain("goalDocumentationFreshnessVerdict");
    expect(finalGoalSafeVerifier).toContain("pass-current-goal-docs-contract");
    expect(finalGoalSafeVerifier).toContain("blocked-by-explicit-consent");
    expect(finalGoalSafeVerifier).toContain("implementationFixableCount");
    expect(finalGoalSafeVerifier).toContain("policyBlockedCount");
    expect(finalGoalSafeVerifier).toContain("residualTopLevelMirrors");
    expect(finalGoalSafeVerifier).toContain("proofChain");
    expect(finalGoalSafeVerifier).toContain("artifacts");
    expect(finalGoalSafeVerifier).toContain("invariants");
    expect(finalGoalSafeVerifier).toContain("coverage");
    expect(finalGoalSafeVerifier).toContain("nonTokenRequirementsProved");
    expect(finalGoalSafeVerifier).toContain("finalAuditRequirementsProved");
    expect(finalGoalSafeVerifier).toContain("evidenceDensityComplete");
    expect(finalGoalSafeVerifier).toContain("missingEvidenceDensity");
    expect(finalGoalSafeVerifier).toContain("evidencePathIntegrityComplete");
    expect(finalGoalSafeVerifier).toContain("missingEvidencePaths");
    expect(finalGoalSafeVerifier).toContain("releaseQualityScoreVerdict");
    expect(finalGoalSafeVerifier).toContain("finalGoalAuditVerdict");
    expect(finalGoalSafeVerifier).toContain("providerGuardVerdict");
    expect(finalGoalSafeVerifier).toContain("realAiCliBinaryProbeVerdict");
    expect(finalGoalSafeVerifier).toContain("verify-real-ai-cli-binary-probe.mjs");
    expect(finalGoalSafeVerifier).toContain("real-ai-cli-binary-probe.json");
    expect(finalGoalSafeVerifier).toContain("pass-current-real-cli-binary-contract");
    expect(finalGoalSafeVerifier).toContain("authenticatedPreflightMatrixVerdict");
    expect(finalGoalSafeVerifier).toContain("aiCliLaunchPlannerVerdict");
    expect(finalGoalSafeVerifier).toContain("tauriRuntimeHygieneVerdict");
    expect(finalGoalSafeVerifier).toContain("workspaceOwnedOpen");
    expect(finalGoalSafeVerifier).toContain("foreignOpen");
    expect(finalGoalSafeVerifier).toContain("ownershipUnknownEnvironmentBlocked");
    expect(score).toContain("portOwnershipQueryEnvironmentBlocked");
    expect(score).toContain("portOwnershipEnvironmentBlockedClean");
    expect(finalGoalSafeVerifier).toContain("releaseHygieneContractVerdict");
    expect(finalGoalSafeVerifier).toContain("verify-release-hygiene-contract.mjs");
    expect(finalGoalSafeVerifier).toContain("pass-current-release-hygiene-contract");
    expect(finalGoalSafeVerifier).toContain("releaseHygieneClean");
    expect(finalGoalSafeVerifier).toContain("terminalChunkedOscLiveVerdict");
    expect(finalGoalSafeVerifier).toContain("chunked-osc-live.json");
    expect(finalGoalSafeVerifier).toContain("pass-current-chunked-osc-live-contract");
    expect(finalGoalSafeVerifier).toContain("terminalChunkedOscLivePassed");
    expect(finalGoalSafeVerifier).toContain("nativeHwndPasteLiveVerdict");
    expect(finalGoalSafeVerifier).toContain("native-hwnd-paste-live.json");
    expect(finalGoalSafeVerifier).toContain("pass-current-native-hwnd-paste-contract");
    expect(finalGoalSafeVerifier).toContain("nativeHwndPasteLivePassed");
    expect(finalGoalSafeVerifier).toContain("nativeTerminalInputHostVerdict");
    expect(finalGoalSafeVerifier).toContain("native-terminal-input-host.json");
    expect(finalGoalSafeVerifier).toContain("pass-current-native-input-host-contract");
    expect(finalGoalSafeVerifier).toContain("surface-ime-preedit-hidden");
    expect(finalGoalSafeVerifier).toContain("surface-window-lifetime");
    expect(finalGoalSafeVerifier).toContain("nativeTerminalInputHostPassed");
    expect(finalGoalSafeVerifier).toContain("rightRailStaleUrlTruthVerdict");
    expect(finalGoalSafeVerifier).toContain("right-rail-stale-url-truth.json");
    expect(finalGoalSafeVerifier).toContain("pass-current-stale-url-truth-contract");
    expect(finalGoalSafeVerifier).toContain("rightRailGoalTrackVerdict");
    expect(finalGoalSafeVerifier).toContain("rightRailGoalTrackArtifactFresh");
    expect(finalGoalSafeVerifier).toContain("RIGHT_RAIL_GOAL_TRACK_SOURCE_PATHS");
    expect(finalGoalSafeVerifier).toContain("currentRightRailGoalTrackSourceCutoffMs");
    expect(finalGoalSafeVerifier).toContain("capturedRightRailGoalTrackSourceCutoffMs");
    expect(finalGoalSafeVerifier).toContain("rightRailGoalTrackCaptureCutoffMs");
    expect(finalGoalSafeVerifier).toContain("right rail Goal Track artifact is stale in source/capture time");
    expect(finalGoalSafeVerifier).toContain("pass-current-contract");
    expect(finalGoalSafeVerifier).toContain("pass-current-audit-contract");
    expect(finalGoalSafeVerifier).toContain("pass-current-preflight-matrix-contract");
    expect(finalGoalSafeVerifier).toContain("pass-current-launch-planner-contract");
    expect(finalGoalSafeVerifier).toContain("pass-current-runtime-hygiene-contract");
    expect(finalGoalSafeVerifier).toContain("glassLegibilityContractVerdict");
    expect(finalGoalSafeVerifier).toContain("glassLegibilityContractPassed");
    expect(finalGoalSafeVerifier).toContain("antiStallContractVerdict");
    expect(finalGoalSafeVerifier).toContain("goalAntiStallContractPassed");
    expect(finalGoalSafeVerifier).toContain("pass-current-glass-legibility-contract");
    expect(finalGoalSafeVerifier).toContain("pass-current-anti-stall-contract");
    expect(finalGoalSafeVerifier).toContain(".codex-auto/quality/glass-legibility-contract.json");
    expect(finalGoalSafeVerifier).toContain(".codex-auto/quality/goal-anti-stall-contract.json");
    expect(finalGoalSafeVerifier).toContain("historical incident closure");
    expect(finalGoalSafeVerifier).toContain("expectedQualityDetail");
    expect(finalGoalSafeVerifier).toContain("artifactMeta requires an explicit contract verdict");
    expect(finalGoalSafeVerifier).toContain("externalGateReadinessPassed");
    expect(finalGoalSafeVerifier).toContain("operatorFinishHandoffPassed");
    expect(finalGoalSafeVerifier).toContain("expectedSafeGate.detail === safeGate.detail");
    expect(finalGoalSafeVerifier).toContain("rightRailGoalTrackSemanticFreshness");
    expect(finalGoalSafeVerifier).toContain("rightRailGoalTrackCycleBoundaryExplained");
    expect(finalGoalSafeVerifier).toContain("right-rail-safe-gate-mutual-proof");
    expect(finalGoalSafeVerifier).toContain('safeGate.semanticFreshness === "current-contract"');
    expect(finalGoalSafeVerifier).toContain('safeGate.cycleBoundary === "right-rail-safe-gate-mutual-proof"');
    expect(finalGoalSafeVerifier).toContain("provider-required-safe");
    expect(finalGoalSafeVerifier).toContain("proofArtifactPassCount");
    expect(finalGoalSafeVerifier).toContain("proofArtifactsPassed");
    expect(finalGoalSafeVerifier).toContain("delete env.AELYRIS_GOAL_OPERATOR_RUN_SLEEP");
    expect(finalGoalSafeVerifier).toContain("localDate: currentLocalDate()");
    expect(finalGoalSafeVerifier).toContain("timeZone: LOCAL_TIME_ZONE");
    expect(finalGoalSafeVerifier).toContain("const tokenSpendingPromptExecuted");
    expect(finalGoalSafeVerifier).toContain("authenticatedPromptConsentedReady");
    expect(tauriGoalTrackScript).toContain("sourceArtifacts");
    expect(tauriGoalTrackScript).toContain("sourceContract");
    expect(tauriGoalTrackScript).toContain("SOURCE_CONTRACT_PATHS");
    expect(finalGoalSafeVerifier).not.toContain("AELYRIS_AUTH_PROMPT_CONSENT:");
    expect(goalDocumentationFreshnessScript).toContain("CURRENT_STATE_DOCS");
    expect(goalDocumentationFreshnessScript).toContain("FINAL_GOAL_SAFE_VERIFIER_PATH");
    expect(goalDocumentationFreshnessScript).toContain("expectedSafeProofArtifactCount");
    expect(goalDocumentationFreshnessScript).toContain("currentSafeProofArtifactCount");
    expect(goalDocumentationFreshnessScript).toContain("safeProofArtifactRegistryCurrent");
    expect(goalDocumentationFreshnessScript).toContain("intentionally does not read final-goal-safe-summary.json");
    expect(goalDocumentationFreshnessScript).toContain("noStaleSafeProofArtifactClaim");
    expect(goalDocumentationFreshnessScript).toContain("proofArtifactPassCount");
    expect(goalDocumentationFreshnessScript).toContain("currentLocalDate");
    expect(goalDocumentationFreshnessScript).toContain('timeZone: "Asia/Tokyo"');
    expect(goalDocumentationFreshnessScript).toContain("timeZone: LOCAL_TIME_ZONE");
    expect(goalDocumentationFreshnessScript).toContain("scoreIsCurrentShape");
    expect(goalDocumentationFreshnessScript).toContain("noStaleReleaseReadyClaim");
    expect(goalDocumentationFreshnessScript).toContain("pass-current-goal-docs-contract");
    expect(finalGoalSafeVerifier).toContain("verify-glass-legibility-contract.mjs");
    expect(finalGoalSafeVerifier).toContain("verify-goal-anti-stall-contract.mjs");
    expect(goalTrackTest).toContain("terminal fallback, human gates, and graph risks");
    expect(goalTrackTest).toContain("promotes the track to a release candidate");
  });
});

describe("App right rail composition", () => {
  it("keeps the Clauge-inspired mode rail visible and routed to the inspector", () => {
    const src = getSrc();
    const styles = getStyles();
    const packageJson = readFileSync(join(process.cwd(), "package.json"), "utf8");
    const plan = readFileSync(join(process.cwd(), "docs/history/CLAUGE_UI_REFRESH_FINAL_GOAL_2026-05-26.md"), "utf8");
    const verifier = readFileSync(join(process.cwd(), "scripts/verify-clauge-ui-refresh-contract.mjs"), "utf8");

    expect(src).toContain("type ProductModeId");
    expect(src).toContain("const PRODUCT_MODE_RAIL");
    expect(src).toContain("const PRODUCT_MODE_ROUTES");
    expect(src).toContain("const PRODUCT_MODE_INSPECTOR_SUMMARY");
    expect(src).toContain("function formatInspectorProof");
    expect(src).toContain('id: "terminal"');
    expect(src).toContain('id: "agents"');
    expect(src).toContain('id: "workspace"');
    expect(src).toContain('id: "review"');
    expect(src).toContain('id: "git"');
    expect(src).toContain('id: "context"');
    expect(src).toContain('id: "history"');
    expect(src).toContain('id: "settings"');
    expect(src).toContain('shortcut: "Alt+1"');
    expect(src).toContain('shortcut: "Alt+8"');
    expect(src).toContain("handleProductModeSelect(mode.id)");
    expect(src).toContain('className="mode-rail"');
    expect(src).toContain("data-product-mode={mode.id}");
    expect(src).toContain('aria-label="Contextual inspector"');
    expect(src).toContain('aria-label="Inspector mode"');
    expect(src).toContain('className="right-panel-inspector-hero"');
    expect(src).toContain("rightRailInspectorPrimaryAction");
    expect(src).toContain("rightRailInspectorProof");
    expect(src).toContain("data-proof-state={rightRailInspectorProofState}");
    expect(src).toContain('aria-label="Selected mode target and proof"');
    expect(src).toContain(">Orchestra Command</span>");
    expect(src).toContain('className="right-panel-advanced-drawer"');
    expect(src).not.toContain(">Project tools</span>");
    expect(src).not.toContain("Mission Control");
    expect(styles).toContain(".mode-rail");
    expect(styles).toContain(".mode-rail-button");
    expect(styles).toContain(".right-panel-inspector-hero");
    expect(styles).toContain(".right-panel-inspector-grid");
    expect(styles).toContain(".right-panel-inspector-open");
    expect(styles).toContain(':root[data-mood="aelyris-sakura"] .mode-rail');
    expect(styles).toContain(':root[data-mood="aelyris-sakura"] .right-panel-inspector-hero');
    expect(plan).toContain("Left Mode Rail -> Center Work Surface -> Right Contextual Inspector");
    expect(plan).toContain("Phase 1: Visible Shell Recomposition");
    expect(plan).toContain("Phase 2: Inspector Simplification");
    expect(verifier).toContain("aelyris.clauge-ui-refresh-contract.v1");
    expect(verifier).toContain("inspector-summary");
    expect(packageJson).toContain('"verify:clauge-ui-refresh"');
  });

  it("keeps the right rail orchestra-first instead of front-loading telemetry detail", () => {
    const src = getSrc();
    const styles = getStyles();
    const packageJson = readFileSync(join(process.cwd(), "package.json"), "utf8");
    const suite = readFileSync(join(process.cwd(), "scripts/verify-right-rail-suite.mjs"), "utf8");
    const density = readFileSync(join(process.cwd(), "scripts/verify-right-rail-information-density.mjs"), "utf8");
    const score = readFileSync(join(process.cwd(), "scripts/score-release-quality.mjs"), "utf8");
    const finalSafe = readFileSync(join(process.cwd(), "scripts/verify-final-goal-safe.mjs"), "utf8");

    expect(src).toContain('className="right-panel-essential-grid"');
    expect(src).toContain("rightRailEssentialChecks");
    expect(src).toContain("rightRailToolkitSummary");
    expect(src).toContain("rightRailToolkitDetail");
    expect(src).toContain("Toolkit status:");
    expect(src).toContain("Agent lanes:");
    expect(src).toContain("Review lane:");
    expect(src).toContain("rightRailOrchestraLanes");
    expect(src).toContain("handleStartRightRailOrchestra");
    expect(src).toContain("showOrchestra({");
    expect(src).toContain("buildOrchestraPrompts({");
    expect(src).toContain('className="right-panel-advanced-drawer"');
    expect(src).toContain('className="right-panel-evidence-drawer"');
    expect(src).toContain('className="right-panel-health-drawer"');
    expect(src).toContain('className="right-panel-queue-drawer"');
    expect(src).toContain("rightRailEvidenceDrawerSummary");
    expect(src).toContain("rightRailHealthDrawerSummary");
    expect(src).toContain("rightRailQueueCount");
    expect(src).toContain("const rightRailHasBlockingDecision = decisionInbox.pendingCount > 0");
    expect(src).toContain("{rightRailHasBlockingDecision && (");
    expect(src.indexOf('className="right-panel-now"')).toBeGreaterThan(
      src.indexOf('className="right-panel-health-drawer"'),
    );
    expect(styles).toContain(".right-panel-essential-grid");
    expect(styles).toContain(".right-panel-essential-card");
    expect(styles).toContain(".right-panel-evidence-drawer > summary");
    expect(styles).toContain(".right-panel-health-drawer > summary");
    expect(styles).toContain(".right-panel-queue-drawer > summary");
    expect(packageJson).toContain('"verify:right-rail-density"');
    expect(suite).toContain("information-density");
    expect(density).toContain("pass-current-right-rail-information-density-contract");
    expect(density).toContain("default orchestra command keeps dispatch lanes");
    expect(density).toContain("right rail exposes role lanes and a first-class Orchestra dispatch action");
    expect(density).toContain("Decision focus is an urgent exception surface");
    expect(density).toContain("final-goal proof and edge-score evidence stay behind the Evidence drawer");
    expect(score).toContain("rightRailInformationDensityPass");
    expect(score).toContain("orchestra-first density");
    expect(finalSafe).toContain("right-rail-information-density");
    expect(finalSafe).toContain("rightRailInformationDensityVerdict");
  });

  it("labels ranked actions with the command-center run-loop phase", () => {
    const src = getSrc();
    const styles = getStyles();
    const advisor = getRightRailAdvisorSource();
    const score = readFileSync(join(process.cwd(), "scripts/score-release-quality.mjs"), "utf8");

    expect(src).toContain("const RIGHT_RAIL_ACTION_PHASE");
    expect(src).toContain("FALLBACK_TELEMETRY_EVENT");
    expect(src).toContain("recordFallbackTelemetry(detail)");
    expect(src).toContain("fallbackTelemetryEvents");
    expect(src).toContain("recentFallbackEvents: fallbackTelemetryEvents");
    expect(src).toContain('"plan-cli-launch": "Plan"');
    expect(src).toContain('"ready-command": "Run"');
    expect(src).toContain('"track-run": "Observe"');
    expect(src).toContain('"parallel-run": "Route"');
    expect(src).toContain('"review-queue": "Review"');
    expect(src).toContain('"handoff-context": "Preserve"');
    expect(src).toContain('"recover-attention": "Recover"');
    expect(src).toContain("function formatRightRailActionOwner");
    expect(src).toContain("compactRightRailOwnerId");
    expect(src).toContain("formatRightRailPathOwner");
    expect(src).toContain("const actionOwnerLabel = formatRightRailActionOwner(action)");
    expect(src).toContain("data-owner-kind={action.target.kind}");
    expect(src).toContain("data-owner-label={actionOwnerLabel}");
    expect(src).toContain('className="right-panel-action-owner"');
    expect(src).toContain("Owner:");
    expect(src).toContain("const rightRailPrimaryAction = rightRailModeActions[0] ?? rightRailActions[0] ?? null");
    expect(src).toContain("const rightRailRunLoopPhase");
    expect(src).toContain('className="right-panel-run-loop right-panel-orchestra-command"');
    expect(src).toContain("data-phase={rightRailRunLoopPhase}");
    expect(src).toContain('data-action-id={rightRailPrimaryAction?.id ?? "none"}');
    expect(src).toContain('data-operation={rightRailPrimaryAction?.execution.operation ?? "none"}');
    expect(src).toContain("const rightRailRunLoopTraceItems");
    expect(src).toContain('className="right-panel-run-loop-trace"');
    expect(src).toContain('aria-label="Primary action trace"');
    expect(src).toContain('label: "Evidence"');
    expect(src).toContain('label: "Target"');
    expect(src).toContain('label: "Recovery"');
    expect(src).toContain("rightRailRunLoopRecovery");
    expect(src).toContain(">Orchestra Command</span>");
    expect(src).toContain('className="right-panel-run-loop-action"');
    expect(src).toContain("handleRightRailAction(rightRailPrimaryAction)");
    expect(src).toContain('className="right-panel-action-phase"');
    expect(styles).toContain(".right-panel-run-loop");
    expect(styles).toContain(".right-panel-run-loop-trace");
    expect(styles).toContain(".right-panel-run-loop-action");
    expect(styles).toContain(':root[data-mood="aelyris-sakura"] .right-panel-run-loop');
    expect(styles).toContain(':root[data-mood="aelyris-sakura"] .right-panel-run-loop-trace div');
    expect(styles).toContain(".right-panel-action-phase");
    expect(styles).toContain(".right-panel-action-owner");
    expect(styles).toContain('.right-panel-action[data-owner-kind="session"] .right-panel-action-owner');
    expect(styles).toContain(':root[data-mood="aelyris-sakura"] .right-panel-action-owner');
    expect(styles).toContain(':root[data-mood="aelyris-sakura"] .right-panel-action-phase');
    expect(advisor).toContain("recentFallbackEvents");
    expect(advisor).toContain("fallbackTelemetryCount");
    expect(advisor).toContain("Runtime fallbacks are routed to Reliability");
    expect(score).toContain("rightRailTestsCoverFallbackTelemetry");
    expect(score).toContain("rightRailTestsCoverRunLoopSummary");
    expect(score).toContain("rightRailTestsCoverRunLoopTrace");
    expect(score).toContain("rightRailTestsCoverActionOwnership");
    expect(score).toContain("right rail run-loop summary coverage");
    expect(score).toContain("right rail action owner coverage");
    expect(score).toContain("fallback telemetry routing");
  });

  it("keeps terminal notification fallback paths visible to fallback telemetry", () => {
    const notifications = getTerminalNotificationsSource();
    const images = getTerminalImagesSource();
    const keyboardShortcuts = getKeyboardShortcutsSource();
    const canvasIme = readFileSync(join(process.cwd(), "src/features/terminal/hooks/useCanvasIME.ts"), "utf8");
    const terminalCanvas = getTerminalCanvasSource();
    const terminalCanvasInputTest = getTerminalCanvasInputTestSource();
    const score = readFileSync(join(process.cwd(), "scripts/score-release-quality.mjs"), "utf8");

    expect(notifications).toContain("reportFallback");
    expect(notifications).toContain('source: "terminal.notifications"');
    expect(notifications).toContain('operation: "listen_terminal_bell"');
    expect(notifications).toContain('operation: "send_windows_notification"');
    expect(notifications).toContain("formatFallbackError(err)");
    expect(notifications).toContain("userVisible: true");
    expect(notifications).not.toContain("silent fallback");
    expect(images).toContain('source: "terminal.images"');
    expect(images).toContain('operation: "term_image_data"');
    expect(images).toContain('operation: "create_image_bitmap_unavailable"');
    expect(images).toContain("formatFallbackError(err)");
    expect(images).not.toContain("skips it\n * silently");
    expect(keyboardShortcuts).toContain('source: "terminal.input"');
    expect(keyboardShortcuts).toContain('operation: "focus_webview_ime_fallback"');
    expect(keyboardShortcuts).toContain('operation: "focus_terminal_unavailable"');
    expect(canvasIme).toContain('source: "terminal.clipboard"');
    expect(canvasIme).toContain('operation: "read_clipboard_text_browser_fallback"');
    expect(canvasIme).toContain('operation: "browser_read_clipboard_text"');
    expect(canvasIme).toContain('operation: "read_clipboard_text_unavailable"');
    expect(canvasIme).toContain("Native clipboard read failed; using browser clipboard fallback.");
    expect(canvasIme).toContain('boundary: "webview-fallback"');
    expect(canvasIme).toContain("nativeBoundaryEscaped: true");
    expect(terminalCanvas).toContain('source: "terminal.input"');
    expect(terminalCanvas).toContain('operation: "focus_webview_ime_fallback"');
    expect(terminalCanvas).toContain('operation: "focus_native_surface_unavailable"');
    expect(terminalCanvas).toContain('operation: "focus_terminal_unavailable"');
    expect(terminalCanvas).toContain("TerminalCanvas focused the WebView IME fallback");
    expect(terminalCanvasInputTest).toContain(
      "does not report fallback telemetry when the native input surface owns focus",
    );
    expect(score).toContain("terminal bell notification fallbacks emit telemetry");
    expect(score).toContain("terminal image data fallbacks emit telemetry");
    expect(score).toContain("terminal focus fallbacks emit telemetry");
    expect(score).toContain("terminal canvas focus fallbacks emit telemetry");
    expect(score).toContain("terminal native focus path avoids fallback telemetry");
    expect(score).toContain("terminal paste clipboard read fallbacks emit telemetry");
  });

  it("keeps the repeatable Edge feedback smoke wired into package scripts", () => {
    const packageJson = readFileSync(join(process.cwd(), "package.json"), "utf8");
    const script = readFileSync(join(process.cwd(), "scripts/verify-right-rail-edge-feedback.mjs"), "utf8");
    const suite = readFileSync(join(process.cwd(), "scripts/verify-right-rail-suite.mjs"), "utf8");
    const score = readFileSync(join(process.cwd(), "scripts/score-release-quality.mjs"), "utf8");

    expect(packageJson).toContain('"verify:right-rail-edge": "node scripts/verify-right-rail-edge-feedback.mjs"');
    expect(packageJson).toContain('"verify:right-rail": "node scripts/verify-right-rail-suite.mjs"');
    expect(packageJson).toContain(
      '"verify:right-rail-command-evidence": "node scripts/verify-right-rail-command-evidence.mjs"',
    );
    expect(packageJson).toContain('"verify:right-rail:strict"');
    expect(script).toContain("right-rail Edge score feedback");
    expect(script).toContain("AELYRIS_RIGHT_RAIL_EDGE_URL");
    expect(script).toContain("edgeLoop");
    expect(script).toContain("legacy_axis");
    expect(script).toContain("Removed Guardrail");
    expect(script).toContain("right-panel-edge-feedback-filter");
    expect(script).toContain("right-panel-edge-feedback-clear");
    expect(script).toContain("right-panel-edge-feedback-stale-group");
    expect(script).toContain("right-panel-edge-feedback-list");
    expect(script).toContain("right-panel-edge-feedback-stale-count-description");
    expect(script).toContain("contentOverflowY");
    expect(script).toContain("stackOverflowY");
    expect(script).toContain("Score loop cleared");
    expect(suite).toContain("CONTRACT_CHECKS");
    expect(suite).toContain("LOCALHOST_CHECKS");
    expect(suite).toContain("CDP_CHECKS");
    expect(suite).toContain("AELYRIS_RIGHT_RAIL_REQUIRE_CDP");
    expect(suite).toContain("CDP endpoint required but unavailable");
    expect(suite).toContain("scripts/verify-right-rail-scale-contract.mjs");
    expect(suite).toContain("scripts/verify-right-rail-information-density.mjs");
    expect(suite).toContain("scripts/verify-right-rail-edge-feedback.mjs");
    expect(suite).toContain("scripts/verify-right-rail-command-evidence.mjs");
    expect(suite).toContain("scripts/verify-right-rail-stale-url-truth.mjs");
    expect(suite).toContain("scripts/verify-right-rail-decisions.mjs");
    expect(suite).toContain("scripts/verify-right-rail-preferences.mjs");
    expect(suite).toContain("scripts/verify-right-rail-negative-path.mjs");
    expect(suite).toContain("scripts/verify-right-rail-audit-jump.mjs");
    expect(suite).toContain("scripts/verify-right-rail-goal-track-tauri.mjs");
    expect(suite).toContain('status: "skipped"');
    expect(suite).toContain("CDP endpoint unavailable");
    expect(score).toContain("right-rail-suite.json");
    expect(score).toContain('"right-rail-smoke"');
    expect(score).toContain("Right rail smoke suite");
    expect(score).toContain("rightRailRequiredSmokeIds");
    expect(score).toContain('"scale-contract"');
    expect(score).toContain('"information-density"');
    expect(score).toContain('"stale-url-truth"');
    expect(score).toContain('"goal-track-tauri"');
    expect(score).toContain('check.id === "edge-feedback"');
    expect(score).toContain('check.status === "skipped"');
    expect(score).toContain("rightRailSmokeComplete");
    expect(score).toContain("rightRailSmokePartial");
    expect(score).toContain("missing required smoke");
    expect(score).toContain("right rail CDP/WebView2 smokes are skipped");
    expect(score).toContain("skipped: ");
    expect(score).toContain("right rail smoke suite is missing or failing");
    expect(score).toContain('"command-evidence"');
    expect(score).toContain("Command evidence jump coverage");
    expect(score).toContain("right-rail-command-evidence.json");
    expect(score).toContain("right-rail-review-fixture-command-evidence.png");
    expect(score).toContain("command evidence smoke artifact is missing");
    expect(score).toContain("command evidence fixture E2E is missing");
  });

  it("keeps the entire right rail vertically scrollable", () => {
    const styles = getStyles();
    const rightPanel = cssBlock(styles, ".right-panel");
    const rightPanelContent = cssBlock(styles, ".right-panel-content");
    const rightPanelStack = cssBlock(styles, ".right-panel-stack");

    expect(rightPanel).toContain("display: flex;");
    expect(rightPanel).toContain("flex-direction: column;");
    expect(rightPanel).toContain("min-height: 0;");
    expect(rightPanelContent).toContain("overflow-y: auto;");
    expect(rightPanelContent).toContain("overflow-x: hidden;");
    expect(rightPanelContent).toContain("flex: 1 1 auto;");
    expect(rightPanelContent).toContain("min-height: 0;");
    expect(rightPanelContent).toContain("overscroll-behavior: contain;");
    expect(rightPanelContent).toContain("scrollbar-gutter: stable;");
    expect(rightPanelContent).not.toContain("overflow: hidden;");
    expect(rightPanelStack).toContain("flex: 0 0 auto;");
    expect(rightPanelStack).toContain("overflow: visible;");
    expect(rightPanelStack).not.toContain("overflow-y: auto;");
  });

  it("keeps debug logs out of the default workstation rail", () => {
    const src = getSrc();
    const commandStart = src.indexOf('{rightRailMode === "command"');
    const reviewStart = src.indexOf('{rightRailMode === "review"', commandStart);
    const observeStart = src.indexOf('{rightRailMode === "observe"', reviewStart);

    expect(commandStart).toBeGreaterThan(-1);
    expect(reviewStart).toBeGreaterThan(commandStart);
    expect(observeStart).toBeGreaterThan(reviewStart);

    const commandRail = src.slice(commandStart, reviewStart);
    const reviewRail = src.slice(reviewStart, observeStart);
    const observeRail = src.slice(observeStart);

    expect(src).toContain('const [rightRailMode, setRightRailMode] = useState<RightRailMode>("command")');
    expect(src).toContain("RIGHT_RAIL_MODES");
    expect(src).toContain("deriveRightRailRecommendation");
    expect(src).toContain("deriveRightRailWorkforceSummary");
    expect(src).toContain('className="right-panel-workforce"');
    expect(src).toContain("rightRailWorkforce.guardrailProfile");
    expect(src).toContain("right-panel-advisor");
    expect(src).toContain("const rightRailDecisionFocus = {");
    expect(src).toContain("const rightRailHasBlockingDecision = decisionInbox.pendingCount > 0");
    expect(src).toContain('className="right-panel-decision-focus"');
    expect(src).toContain("{rightRailHasBlockingDecision && (");
    expect(src).toContain('data-has-decision={rightRailHasBlockingDecision ? "true" : "false"}');
    expect(src).toContain('setRightRailFocusWidget("decision-inbox")');
    expect(src).toContain('import("./features/context/ContextPanel")');
    expect(src).toContain('import("./features/context/WorkstationPulse")');
    expect(src).toContain('import("./features/context/RunGraphPanel")');
    expect(src).toContain('import("./features/context/ToolLedgerPanel")');
    expect(src).toContain('import("./features/context/ReliabilityPanel")');
    expect(src).toContain('import("./features/decision-inbox")');
    expect(src).toContain('import("./features/review/ReviewQueuePanel")');
    expect(src).toContain("filterWorkspaceScopedEvents");
    expect(src).toContain("const workspaceProfile = useMemo(");
    const densityShells =
      src.match(/className="app-container" data-density=\{workspaceProfile\.visualDensity\}/g) ?? [];
    expect(densityShells).toHaveLength(2);
    expect(src).toContain("const scopedOperationalAuditEvents = useMemo(");
    expect(src).toContain("setWorkspaceThreadRunState(projectPath, activeTabId");
    expect(src).toContain("buildDecisionInbox({");
    expect(src).toContain("decisionInbox.pendingCount");
    expect(src).toContain("deriveRightRailEdgeScore");
    expect(src).toContain("const rightRailEdgeScore = deriveRightRailEdgeScore({");
    expect(src).toContain('className="right-panel-edge-score"');
    expect(src).toContain(
      `aria-label={\`Command center edge score ${templatePlaceholder("rightRailEdgeScore.score")}\`}`,
    );
    expect(src).toContain('className="right-panel-edge-score-grid" aria-label="Command center score breakdown"');
    expect(src).toContain("rightRailEdgeScore.items.map((item)");
    expect(src).toContain("const handleOpenRightRailEdgeScoreItem = useCallback");
    expect(src).toContain("setRightRailMode(item.routeMode)");
    expect(src).toContain("setRightRailFocusWidget(item.focusWidget)");
    expect(src).toContain("isRightRailWidgetId(item.focusWidget)");
    expect(src).toContain('className="right-panel-edge-score-action"');
    expect(src).toContain("onClick={() => handleOpenRightRailEdgeScoreItem(item)}");
    expect(src).toContain('actionLabel: pendingDecisionCount > 0 ? "Open inbox" : "Inspect inbox"');
    expect(src).toContain('focusWidget: "decision-inbox"');
    expect(src).toContain("interface RightRailDestinationPrompt");
    expect(src).toContain("function RightRailDestinationPromptCard");
    expect(src).toContain("const [rightRailDestinationPrompt, setRightRailDestinationPrompt]");
    expect(src).toContain("setRightRailDestinationPrompt({");
    expect(src).toContain("promptTitle:");
    expect(src).toContain("promptDetail:");
    expect(src).toContain("appendRightRailEdgeScoreInteractionAudit");
    expect(src).toContain("appendRightRailEdgeFeedbackStaleAudit");
    expect(src).toContain(`kind: \`right_rail.edge_score.${templatePlaceholder("stage")}\``);
    expect(src).toContain('stage: "clicked"');
    expect(src).toContain('stage: "destination-reached"');
    expect(src).toContain("interface RightRailEdgeScoreFeedbackEntry");
    expect(src).toContain("axisId: string");
    expect(src).toContain("RIGHT_RAIL_EDGE_FEEDBACK_LIMIT");
    expect(src).toContain("RIGHT_RAIL_EDGE_FEEDBACK_STORAGE_PREFIX");
    expect(src).toContain("RIGHT_RAIL_EDGE_FEEDBACK_HISTORY_STATE_KEY");
    expect(src).toContain("RIGHT_RAIL_EDGE_FEEDBACK_URL_PARAM");
    expect(src).toContain("RIGHT_RAIL_EDGE_FEEDBACK_AXIS_IDS");
    expect(src).toContain("RIGHT_RAIL_EDGE_FEEDBACK_ACTION_LABELS");
    expect(src).toContain("RIGHT_RAIL_EDGE_FEEDBACK_TARGET_WIDGETS");
    expect(src).toContain("createRightRailEdgeScoreFeedbackEntry");
    expect(src).toContain("axisId: item.id");
    expect(src).toContain("rightRailWorkspaceStorageHash");
    expect(src).toContain("rightRailEdgeFeedbackStorageKey");
    expect(src).toContain("sanitizeRightRailEdgeFeedbackEntry");
    expect(src).toContain("sanitizeRightRailEdgeFeedbackHistory");
    expect(src).toContain("isSafeRightRailEdgeFeedbackAxisId");
    expect(src).toContain("sanitizeRightRailEdgeFeedbackAxisLabel");
    expect(src).toContain("Legacy axis");
    expect(src).toContain("if (!isSafeRightRailEdgeFeedbackAxisId(rawAxisId)) return null");
    expect(src).toContain("axisLabel: sanitizeRightRailEdgeFeedbackAxisLabel(rawAxisId, value.axisLabel)");
    expect(src).toContain("readRightRailEdgeFeedbackHistoryState");
    expect(src).toContain("writeRightRailEdgeFeedbackHistoryState");
    expect(src).toContain("readRightRailEdgeFeedbackHistoryUrl");
    expect(src).toContain("writeRightRailEdgeFeedbackHistoryUrl");
    expect(src).toContain("clearRightRailEdgeFeedbackHistory");
    expect(src).toContain("const RIGHT_RAIL_EDGE_FEEDBACK_LIST_ID");
    expect(src).toContain("const RIGHT_RAIL_EDGE_FEEDBACK_STALE_COUNT_ID");
    expect(src).toContain("loadRightRailEdgeFeedbackHistory");
    expect(src).toContain("saveRightRailEdgeFeedbackHistory");
    expect(src).toContain("deriveRightRailEdgeFeedbackAxisSummary");
    expect(src).toContain("deriveRightRailEdgeNextBestAction");
    expect(src).toContain("formatRightRailEdgeFeedbackStaleReason");
    expect(src).toContain("deriveRightRailEdgeFeedbackStaleEntries");
    expect(src).toContain("deriveRightRailEdgeRecommendationOutcome");
    expect(src).toContain("interface RightRailEdgeNextBestAction");
    expect(src).toContain("interface RightRailEdgeRecommendationOutcome");
    expect(src).toContain("interface RightRailEdgeFeedbackAxisSummary");
    expect(src).toContain("interface RightRailEdgeFeedbackResetNotice");
    expect(src).toContain("const [rightRailEdgeFeedbackHistory, setRightRailEdgeFeedbackHistory]");
    expect(src).toContain("const [rightRailEdgeFeedbackStaleOnly, setRightRailEdgeFeedbackStaleOnly]");
    expect(src).toContain("const [rightRailEdgeFeedbackResetNotice, setRightRailEdgeFeedbackResetNotice]");
    expect(src).toContain("setRightRailEdgeFeedbackHistory((history) =>");
    expect(src).toContain("const nextHistory = [");
    expect(src).toContain("saveRightRailEdgeFeedbackHistory(projectPath, nextHistory)");
    expect(src).toContain("const rightRailEdgeFeedbackHydratedKeyRef = useRef<string | null>(null)");
    expect(src).toContain("const rightRailEdgeFeedbackSkipSaveKeyRef = useRef<string | null>(null)");
    expect(src).toContain("const rightRailEdgeFeedbackStaleTelemetryRef = useRef<Set<string>>(new Set())");
    expect(src).toContain("const rightRailEdgeFeedbackResetNoticeTimerRef = useRef<number | null>(null)");
    expect(src).toContain("const handleClearRightRailEdgeFeedbackHistory = useCallback");
    expect(src).toContain("clearRightRailEdgeFeedbackHistory(projectPath)");
    expect(src).toContain("setRightRailEdgeFeedbackHistory([])");
    expect(src).toContain("setRightRailEdgeFeedbackResetNotice({");
    expect(src).toContain('label: "Score loop cleared"');
    expect(src).toContain('detail: "Workspace guidance was reset."');
    expect(src).toContain("setRightRailEdgeFeedbackResetNotice(null)");
    expect(src).toContain("window.clearTimeout(rightRailEdgeFeedbackResetNoticeTimerRef.current)");
    expect(src).toContain("window.localStorage.removeItem(key)");
    expect(src).toContain("delete state[RIGHT_RAIL_EDGE_FEEDBACK_HISTORY_STATE_KEY]");
    expect(src).toContain("url.searchParams.delete(RIGHT_RAIL_EDGE_FEEDBACK_URL_PARAM)");
    expect(src).toContain("setRightRailEdgeFeedbackHistory(loadRightRailEdgeFeedbackHistory(projectPath))");
    expect(src).toContain("saveRightRailEdgeFeedbackHistory(projectPath, rightRailEdgeFeedbackHistory)");
    expect(src).toContain("rightRailEdgeFeedbackSkipSaveKeyRef.current === key");
    expect(src).toContain(
      "({ id, axisId, axisLabel, actionLabel, targetWidget, score, grade, previousScore, delta, trend, createdAt }) => ({",
    );
    expect(src).toContain("axisId,");
    expect(src).toContain("writeRightRailEdgeFeedbackHistoryState(key, persisted)");
    expect(src).toContain("writeRightRailEdgeFeedbackHistoryUrl(key, persisted)");
    expect(src).toContain("const stateHistory = readRightRailEdgeFeedbackHistoryState(key)");
    expect(src).toContain("readRightRailEdgeFeedbackHistoryUrl(key)");
    expect(src).toContain("if (persisted.length === 0)");
    expect(src).toContain("JSON.stringify(persisted)");
    expect(src).not.toContain("JSON.stringify(history)");
    expect(src).toContain(
      "const rightRailEdgeFeedbackAxisSummary = deriveRightRailEdgeFeedbackAxisSummary(rightRailEdgeFeedbackHistory)",
    );
    expect(src).toContain("interface RightRailEdgeFeedbackStaleGroup");
    expect(src).toContain("function deriveRightRailEdgeFeedbackStaleGroups(");
    expect(src).toContain("const rightRailEdgeFeedbackStaleEntries = useMemo(");
    expect(src).toContain("deriveRightRailEdgeFeedbackStaleEntries(rightRailEdgeFeedbackHistory, rightRailEdgeScore)");
    expect(src).toContain("const rightRailEdgeFeedbackStaleIds = useMemo(");
    expect(src).toContain("new Set(rightRailEdgeFeedbackStaleEntries.map(({ entry }) => entry.id))");
    expect(src).toContain("const rightRailEdgeFeedbackVisibleHistory = useMemo(");
    expect(src).toContain(
      "rightRailEdgeFeedbackHistory.filter((entry) => rightRailEdgeFeedbackStaleIds.has(entry.id))",
    );
    expect(src).toContain("const rightRailEdgeFeedbackStaleGroups = useMemo(");
    expect(src).toContain("deriveRightRailEdgeFeedbackStaleGroups(rightRailEdgeFeedbackStaleEntries)");
    expect(src).toContain("const rightRailEdgeFeedbackStaleCount = rightRailEdgeFeedbackStaleEntries.length");
    expect(src).toContain("const rightRailEdgeFeedbackStaleCountLabel =");
    expect(src).toContain("rightRailEdgeFeedbackStaleEntries.length === 0");
    expect(src).toContain("setRightRailEdgeFeedbackStaleOnly(false)");
    expect(src).toContain("rightRailEdgeFeedbackStaleTelemetryRef.current.has(telemetryKey)");
    expect(src).toContain("rightRailEdgeFeedbackStaleTelemetryRef.current.add(telemetryKey)");
    expect(src).toContain("void appendRightRailEdgeFeedbackStaleAudit({");
    expect(src).toContain("const rightRailEdgeNextBestAction = deriveRightRailEdgeNextBestAction(");
    expect(src).toContain("const rightRailEdgeRecommendationOutcome = deriveRightRailEdgeRecommendationOutcome({");
    expect(src).toContain('className="right-panel-edge-next-action"');
    expect(src).toContain("data-reason={rightRailEdgeNextBestAction.reason}");
    expect(src).toContain("onClick={() => handleOpenRightRailEdgeScoreItem(rightRailEdgeNextBestAction.item)}");
    expect(src).toContain("Next best action");
    expect(src).toContain("rightRailEdgeRecommendationOutcome.status");
    expect(src).toContain("reachedAt");
    expect(src).toContain("Destination reached");
    expect(src).toContain("Action replayed");
    expect(src).toContain("Recommendation changed");
    expect(src).toContain('rightRailEdgeNextBestAction.reason === "repeated-axis" ? "Repeated axis" : "Weakest axis"');
    expect(src).toContain('className="right-panel-edge-feedback"');
    expect(src).toContain('aria-label="Recent Edge score feedback"');
    expect(src).toContain('className="right-panel-edge-feedback-summary"');
    expect(src).toContain('className="right-panel-edge-feedback-clear"');
    expect(src).toContain('className="right-panel-edge-feedback-filter"');
    expect(src).toContain('data-active={rightRailEdgeFeedbackStaleOnly ? "true" : "false"}');
    expect(src).toContain("aria-pressed={rightRailEdgeFeedbackStaleOnly}");
    expect(src).toContain('{rightRailEdgeFeedbackStaleOnly ? "All" : "Stale only"}');
    expect(src).toContain('className="right-panel-edge-feedback-stale-count"');
    expect(src).toContain('aria-hidden="true"');
    expect(src).toContain("id={RIGHT_RAIL_EDGE_FEEDBACK_STALE_COUNT_ID}");
    expect(src).toContain("{rightRailEdgeFeedbackStaleCountLabel}");
    expect(src).toContain("Stale {rightRailEdgeFeedbackStaleCount}");
    expect(src).toContain("Show all score loop entries;");
    expect(src).toContain("Show only stale score loop entries;");
    expect(src).toContain("aria-controls={RIGHT_RAIL_EDGE_FEEDBACK_LIST_ID}");
    expect(src).toContain("aria-describedby={RIGHT_RAIL_EDGE_FEEDBACK_STALE_COUNT_ID}");
    expect(src).toContain("id={RIGHT_RAIL_EDGE_FEEDBACK_LIST_ID}");
    expect(src).toContain("rightRailEdgeFeedbackStaleOnly && rightRailEdgeFeedbackStaleGroups.length > 0");
    expect(src).toContain('className="right-panel-edge-feedback-stale-groups"');
    expect(src).toContain("Grouped stale score feedback,");
    expect(src).toContain("rightRailEdgeFeedbackStaleGroups.length");
    expect(src).toContain('className="right-panel-edge-feedback-stale-group"');
    expect(src).toContain("data-axis-id={group.axisId}");
    expect(src).toContain("<legend>Stale group</legend>");
    expect(src).toContain("{group.count} entries");
    expect(src).toContain("{group.staleReason}");
    expect(src).toContain('className="right-panel-edge-feedback-reset"');
    expect(src).toContain('role="status"');
    expect(src).toContain('aria-live="polite"');
    expect(src).toContain('aria-label="Clear workspace Edge score feedback history"');
    expect(src).toContain("onClick={handleClearRightRailEdgeFeedbackHistory}");
    expect(src).toContain("rightRailEdgeFeedbackAxisSummary.axisLabel");
    expect(src).toContain("rightRailEdgeFeedbackAxisSummary.axisId");
    expect(src).toContain("rightRailEdgeFeedbackAxisSummary.count");
    expect(src).toContain("data-trend={entry.trend}");
    expect(src).toContain('data-stale={staleReason ? "true" : "false"}');
    expect(src).toContain("rightRailEdgeFeedbackVisibleHistory.map((entry) =>");
    expect(src).toContain("entry.actionLabel} -&gt; {entry.targetWidget");
    expect(src).toContain("(item) => item.id === entry.axisId || item.label === entry.axisLabel");
    expect(src).toContain("const staleReason = replayItem ? null : formatRightRailEdgeFeedbackStaleReason(entry)");
    expect(src).toContain('className="right-panel-edge-feedback-stale"');
    expect(src).toContain("Stale axis:");
    expect(src).toContain("if (replayItem) handleOpenRightRailEdgeScoreItem(replayItem)");
    expect(src).toContain("disabled={!replayItem}");
    expect(src).toContain(
      `aria-label={\`Replay ${templatePlaceholder("entry.axisLabel")} score action: ${templatePlaceholder("entry.actionLabel")}\`}`,
    );
    expect(src).toContain(
      "rightRailEdgeScoreRef.current = { score: rightRailEdgeScore.score, grade: rightRailEdgeScore.grade }",
    );
    expect(src).toContain("rightRailProjectPathRef.current = projectPath");
    expect(src).toContain("rightRailDestinationReachedTelemetryRef");
    expect(src).toContain('privacy: "no command text, prompt text, file path, or user input captured"');
    expect(src).toContain("targetWidget: item.focusWidget");
    expect(src).toContain("const allowDebugUrlFallback = isExplicitDevVisualQaRequest()");
    expect(src).toContain("if (!allowDebugUrlFallback) return []");
    expect(src).toContain("if (shouldMirrorRightRailEdgeFeedbackHistoryUrl())");
    expect(src).not.toContain("promptDetail: item.promptDetail,");
    expect(src).not.toContain("promptText");
    const staleAudit = src.match(
      /async function appendRightRailEdgeFeedbackStaleAudit[\s\S]*?\n}\n\nfunction formatRightRailRecoveryDetail/,
    );
    expect(staleAudit).not.toBeNull();
    const staleAuditBody = staleAudit?.[0] ?? "";
    expect(staleAuditBody).toContain('kind: "right_rail.edge_feedback.stale"');
    expect(staleAuditBody).toContain("axisId: entry.axisId");
    expect(staleAuditBody).toContain("axisLabel: entry.axisLabel");
    expect(staleAuditBody).toContain("score: entry.score");
    expect(staleAuditBody).toContain("grade: entry.grade");
    expect(staleAuditBody).toContain("staleReason");
    expect(staleAuditBody).not.toContain("actionLabel");
    expect(staleAuditBody).not.toContain("targetWidget");
    expect(staleAuditBody).not.toContain("promptText");
    expect(staleAuditBody).not.toContain("promptDetail");
    expect(staleAuditBody).not.toContain("filePath");
    expect(src).toContain("const renderRightRailDestinationPrompt = (widget: string)");
    expect(src).toContain('className="right-panel-destination-prompt"');
    expect(src).toContain(`aria-label={\`${templatePlaceholder("prompt.axisLabel")} remediation prompt\`}`);
    expect(src).toContain('{renderRightRailDestinationPrompt("decision-inbox")}');
    expect(src).toContain('{renderRightRailDestinationPrompt("review-queue")}');
    expect(src).toContain('{renderRightRailDestinationPrompt("audit-timeline")}');
    expect(src).toContain('{renderRightRailDestinationPrompt("reliability")}');
    expect(src).toContain('{renderRightRailDestinationPrompt("live-panes")}');
    expect(src).toContain('{renderRightRailDestinationPrompt("processes")}');
    expect(src).toContain("Weakest:");
    expect(src).toContain(
      'blockedReason: "Destructive file-system write requires explicit approval before deleting generated output."',
    );
    expect(src).toContain('nextActor: "human"');
    expect(src).toContain('widget="decision-inbox"');
    expect(src).toContain("<DecisionInboxPanel");
    expect(src).toContain("onOpenWorkflow={handleOpenDecisionWorkflow}");
    expect(src).toContain("onOpenAudit={handleOpenDecisionAudit}");
    expect(src).toContain('setRightRailFocusWidget("workflow")');
    expect(src).toContain("const [rightRailRouteConfirmation, setRightRailRouteConfirmation]");
    expect(src).toContain("showRightRailRouteConfirmation");
    expect(src).toContain("focusConfirmation={");
    expect(src).toContain("right-panel-widget-focus-confirmation");
    expect(src).toContain("setSelectedAuditTraceFilter(traceId)");
    expect(src).toContain("const rightRailGraph = useMemo(");
    expect(src).toContain("buildWorkstationGraph({");
    expect(src).toContain("const focusedRightRailGraph = useMemo(");
    expect(src).toContain("filterWorkstationGraph(rightRailGraph");
    expect(src).toContain("workstationGraph={focusedRightRailGraph}");
    expect(src).toContain('data-widget="review-queue"');
    expect(src).toContain('widget="context"');
    expect(src).toContain('widget="run-graph"');
    expect(src).toContain('widget="tool-ledger"');
    expect(src).toContain('data-widget="reliability"');
    expect(src).toContain("<RunGraphPanel");
    expect(src).toContain("<ToolLedgerPanel");
    expect(src).toContain("<ReliabilityPanel");
    expect(src).toContain("const rightRailChangedFiles = useMemo(");
    expect(src).toContain("const rightRailAllChangedFiles = useMemo(");
    expect(src).toContain("changedFilesCount={rightRailAllChangedFiles.length}");
    expect(src).toContain("changedFiles={rightRailAllChangedFiles}");
    expect(commandRail).not.toContain('data-widget="logs"');
    expect(commandRail).not.toContain("LogsPanel");
    expect(commandRail).not.toContain('density="compact"');
    expect(reviewRail).toContain('density="compact"');
    expect(observeRail).toContain('density="compact"');
    expect(observeRail).toContain('data-widget="reliability"');
    expect(observeRail).toContain("devVisualQa.diagnosticsEnabled");
    expect(observeRail).toContain("<LogsPanel defaultCollapsed />");
  });

  it("keeps right rail tabs operable with the ARIA keyboard pattern", () => {
    const src = getSrc();

    expect(src).toContain("function getNextRightRailMode(current: RightRailMode, key: string): RightRailMode | null");
    expect(src).toContain('key === "ArrowRight" || key === "ArrowDown"');
    expect(src).toContain('key === "ArrowLeft" || key === "ArrowUp"');
    expect(src).toContain('if (key === "Home") return RIGHT_RAIL_MODES[0]?.id ?? null');
    expect(src).toContain('if (key === "End") return RIGHT_RAIL_MODES.at(-1)?.id ?? null');
    expect(src).toContain("const handleRightRailModeKeyDown = useCallback");
    expect(src).toContain("setRightRailMode(nextMode)");
    expect(src).toContain(
      `document.querySelector<HTMLButtonElement>(\`[data-right-rail-mode="${templatePlaceholder("nextMode")}"]\`)?.focus()`,
    );
    expect(src).toContain(`id={\`right-rail-tab-${templatePlaceholder("mode.id")}\`}`);
    expect(src).toContain("data-right-rail-mode={mode.id}");
    expect(src).toContain('aria-controls="right-rail-panel"');
    expect(src).toContain(
      `aria-label={\`${templatePlaceholder("mode.label")}: ${templatePlaceholder("mode.description")}\`}`,
    );
    expect(src).toContain("tabIndex={rightRailMode === mode.id ? 0 : -1}");
    expect(src).toContain("onKeyDown={handleRightRailModeKeyDown}");
    expect(src).toContain('id="right-rail-purpose"');
    expect(src).toContain("activeRightRailMode.description");
    expect(src).toContain('role="tabpanel"');
    expect(src).toContain(`aria-labelledby={\`right-rail-tab-${templatePlaceholder("rightRailMode")}\`}`);
    expect(src).toContain('aria-describedby="right-rail-purpose"');
  });

  it("keeps right rail action results visible inside the rail instead of toast-only feedback", () => {
    const src = getSrc();
    const advisor = getRightRailAdvisorSource();

    expect(src).toContain(
      "const [rightRailActionResult, setRightRailActionResult] = useState<RightRailActionResult | null>(null)",
    );
    expect(src).toContain(
      "const [rightRailActionHistory, setRightRailActionHistory] = useState<RightRailActionResult[]>([])",
    );
    expect(src).toContain("RIGHT_RAIL_ACTION_HISTORY_LIMIT");
    expect(src).toContain("const [rightRailGuardrailSelection, setRightRailGuardrailSelection]");
    expect(src).toContain("RIGHT_RAIL_GUARDRAIL_OPTIONS");
    expect(src).toContain("RIGHT_RAIL_GUARDRAIL_SELECTION_STORAGE_KEY");
    expect(src).toContain('const RIGHT_RAIL_GUARDRAIL_SYNC_EVENT = "aelyris:right-rail-guardrail-sync"');
    expect(src).toContain("loadRightRailGuardrailSelection");
    expect(src).toContain("saveRightRailGuardrailSelection");
    expect(src).toContain("saveRightRailGuardrailSelectionToNativeConfig");
    expect(src).toContain("hydrateRightRailGuardrailSelectionFromConfig");
    expect(src).toContain("right_rail_guardrail_profile");
    expect(src).toContain('operation: "save_right_rail_guardrail_config"');
    expect(src).toContain('rightRailGuardrailSelection === "Auto"');
    expect(src).toContain("rightRailGuardrailProfileRef.current = rightRailGuardrailProfile");
    expect(src).toContain("allowedToolsForGuardrailProfile(rightRailGuardrailProfile).join");
    expect(src).toContain('className="right-panel-workforce-profile"');
    expect(src).toContain("setRightRailGuardrailSelection(event.currentTarget.value as RightRailGuardrailSelection)");
    expect(src).toContain("rightRailActionResultTimerRef");
    expect(src).toContain("window.setTimeout");
    expect(src).toContain("window.clearTimeout(rightRailActionResultTimerRef.current)");
    expect(src).toContain(
      "setRightRailActionHistory((history) => [result, ...history].slice(0, RIGHT_RAIL_ACTION_HISTORY_LIMIT))",
    );
    expect(src).toContain("showRightRailActionResult(action");
    expect(src).toContain("createRightRailDestinationResult");
    expect(src).toContain("routeWidget?: RightRailWidgetId | null");
    expect(src).toContain("routeLabel?: string | null");
    expect(src).toContain("routeDetail?: string | null");
    expect(src).toContain("showRightRailDestinationOutcome");
    expect(src).toContain("onDestinationOutcome={showRightRailDestinationOutcome}");
    expect(src).toContain('className="right-panel-action-result"');
    expect(src).toContain('className="right-panel-action-history"');
    expect(src).toContain('aria-label="Recent right rail action history"');
    expect(src).toContain('role="status"');
    expect(src).toContain('aria-live="polite"');
    expect(src).toContain("rightRailActionResult.detail");
    expect(src).toContain("payloadJson: buildRightRailActionAuditPayload(action, previousMode)");
    expect(advisor).toContain("evidence: action.execution.evidence");
    expect(advisor).toContain("target: action.target");
    expect(src).toContain(`Evidence: ${templatePlaceholder("action.execution.evidence")}`);
    expect(src).toContain("{action.target.label}");
    expect(src).toContain("action.execution.evidence");
    expect(src).toContain("Promise<AuditJournalEventRecord | null>");
    expect(src).toContain("appendRightRailActionOutcomeAudit");
    expect(src).toContain("formatRightRailRecoveryDetail");
    expect(src).toContain("showRecoverableActionResult");
    expect(src).toContain("append_right_rail_action_outcome_audit");
    expect(src).toContain("Recovery:");
    expect(src).toContain("auditEventId: auditRecord?.id ?? null");
    expect(src).toContain("auditCorrelationId: auditRecord?.correlationId ?? null");
    expect(src).toContain("const handleOpenRightRailActionAudit = useCallback");
    expect(src).toContain("const handleOpenRightRailOutcomeSource = useCallback");
    expect(src).toContain("rightRailModeForOutcomeWidget");
    expect(src).toContain('setRightRailMode("observe")');
    expect(src).toContain('setRightRailFocusWidget("audit-timeline")');
    expect(src).toContain("setSelectedAuditEventId(auditEventId)");
    expect(src).toContain("setSelectedAuditTraceFilter(traceId)");
    expect(src).toContain('className="right-panel-action-result-audit"');
    expect(src).toContain('className="right-panel-action-history-audit"');
    expect(src).toContain("handleOpenRightRailOutcomeSource");
    expect(src).toContain('rightRailActionResult.routeLabel ?? "Audit"');
    expect(src).toContain('result.routeLabel ?? "Audit"');
  });

  it("persists secondary right rail widget collapse preferences without hiding core flows", () => {
    const src = getSrc();
    const commandStart = src.indexOf('{rightRailMode === "command"');
    const reviewStart = src.indexOf('{rightRailMode === "review"', commandStart);
    const observeStart = src.indexOf('{rightRailMode === "observe"', reviewStart);

    expect(src).toContain("type RightRailWidgetId");
    expect(src).toContain("function RightRailWidgetFrame");
    expect(src).toContain("loadRightRailWidgetOpen");
    expect(src).toContain("saveRightRailWidgetOpen");
    expect(src).toContain('const RIGHT_RAIL_WIDGET_STORAGE_PREFIX = "aelyris:right-rail-widget:"');
    expect(src).toContain('const RIGHT_RAIL_WIDGET_SYNC_EVENT = "aelyris:right-rail-widget-sync"');
    expect(src).toContain("hydrateRightRailWidgetOpenFromConfig");
    expect(src).toContain("saveRightRailWidgetOpenToNativeConfig");
    expect(src).toContain("right_rail_widgets");
    expect(src).toContain('operation: "save_right_rail_widget_config"');
    expect(src).toContain("if (!forceOpen) return");
    expect(src).toContain("saveRightRailWidgetOpen(widget, true)");
    expect(src).toContain("right-panel-widget-frame-header");
    expect(src).toContain('widget="workflow"');
    expect(src).toContain('widget="toolkit"');
    expect(src).toContain('widget="context"');
    expect(src).toContain('widget="audit-timeline"');
    expect(src).toContain('widget="run-graph"');
    expect(src).toContain('widget="tool-ledger"');
    expect(src).toContain('widget="logs"');
    expect(src).toContain('data-rail-focus={rightRailFocusWidget === "toolkit" ? "true" : undefined}');
    expect(src).toContain('forceExpanded={rightRailFocusWidget === "toolkit"}');
    expect(src).toContain('forceOpen={rightRailFocusWidget === "workflow"}');
    expect(src).toContain('forceOpen={rightRailFocusWidget === "context"}');
    expect(src).toContain('forceOpen={rightRailFocusWidget === "audit-timeline"}');
    expect(src).toContain('forceOpen={rightRailFocusWidget === "run-graph"}');

    const commandRail = src.slice(commandStart, reviewStart);
    const observeRail = src.slice(observeStart);
    expect(commandRail).toContain('widget="decision-inbox"');
    expect(commandRail).toContain('widget="sessions"');
    expect(src.indexOf("{rightRailHasBlockingDecision && (")).toBeLessThan(
      src.indexOf('className="right-panel-decision-focus"'),
    );
    expect(src.indexOf('className="right-panel-decision-focus"')).toBeLessThan(
      src.indexOf('className="right-panel-essential-grid"'),
    );
    expect(src.indexOf('className="right-panel-decision-focus"')).toBeLessThan(
      src.indexOf('className="right-panel-workforce"'),
    );
    expect(src.indexOf('className="right-panel-decision-focus"')).toBeLessThan(
      src.indexOf('className="right-panel-action-stack"'),
    );
    expect(commandRail.indexOf('data-widget="toolkit"')).toBeLessThan(commandRail.indexOf('widget="sessions"'));
    expect(commandRail.indexOf('widget="sessions"')).toBeLessThan(commandRail.indexOf('widget="workflow"'));
    expect(commandRail.indexOf('widget="decision-inbox"')).toBeGreaterThan(
      commandRail.indexOf("rightRailHasBlockingDecision"),
    );
    expect(observeRail.indexOf('data-widget="processes"')).toBeLessThan(observeRail.indexOf('widget="audit-timeline"'));
    expect(observeRail.indexOf('data-widget="live-panes"')).toBeLessThan(observeRail.indexOf('widget="run-graph"'));
  });

  it("keeps the right rail focused by collapsing secondary proof detail", () => {
    const src = getSrc();
    const styles = getStyles();

    expect(src).toContain("].slice(0, 3)");
    expect(src).toContain("rightRailVisibleActions.slice(0, 1)");
    expect(src).toContain('className="right-panel-advanced-drawer"');
    expect(src).toContain('className="right-panel-essential-grid"');
    expect(src).toContain("Toolkit status:");
    expect(src).toContain("Agent lanes:");
    expect(src).toContain("Review lane:");
    expect(src).toContain('setRightRailFocusWidget("toolkit")');
    expect(src).toContain('setRightRailFocusWidget("sessions")');
    expect(src).toContain('setRightRailFocusWidget("review-queue")');
    expect(src).toContain('className="right-panel-evidence-drawer"');
    expect(src).toContain('className="right-panel-queue-drawer"');
    expect(src).toContain('className="right-panel-health-drawer"');
    expect(src).toContain('className="right-panel-run-loop-disclosure"');
    expect(src).toContain('className="right-panel-edge-score-breakdown"');
    expect(src).toContain('className="right-panel-goal-track-disclosure" data-kind="proofs"');
    expect(src).toContain('className="right-panel-goal-track-disclosure" data-kind="prompt-command"');
    expect(src).toContain('className="right-panel-goal-track-disclosure" data-kind="prompt-proof"');
    expect(src).toContain('className="right-panel-goal-track-disclosure" data-kind="remaining"');
    expect(styles).toContain(".right-panel-run-loop-disclosure > summary");
    expect(styles).toContain(".right-panel-advanced-drawer > summary");
    expect(styles).toContain(".right-panel-essential-card");
    expect(styles).toContain(".right-panel-evidence-drawer > summary");
    expect(styles).toContain(".right-panel-queue-drawer > summary");
    expect(styles).toContain(".right-panel-health-drawer > summary");
    expect(styles).toContain(".right-panel-edge-score-breakdown > summary");
    expect(styles).toContain(".right-panel-goal-track-disclosure > summary");
    expect(styles).toContain(".right-panel-goal-track-disclosure > summary small");
  });

  it("keeps a dev-only negative path fixture for native right rail release smoke", () => {
    const src = getSrc();

    expect(src).toContain('negativePath: "missing-diff" | "stale-pane" | null');
    expect(src).toContain('params.get("negativePath") ?? params.get("rightRailNegativePath")');
    expect(src).toContain("function createDevVisualQaNegativePathAction");
    expect(src).toContain('label: "QA missing diff"');
    expect(src).toContain('reason: "Negative-path fixture intentionally omits a file target."');
    expect(src).toContain('evidence: "QA URL requested a missing diff target fixture."');
    expect(src).toContain('auditEvent: "right_rail.qa_missing_diff.opened"');
    expect(src).toContain('operation: "open-primary-diff"');
    expect(src).toContain('label: "QA stale pane"');
    expect(src).toContain('targetPaneRole: "__qa_missing_pane__"');
    expect(src).toContain('reason: "Negative-path fixture intentionally points at a stale pane role."');
    expect(src).toContain('evidence: "QA URL requested a stale pane target fixture."');
    expect(src).toContain('auditEvent: "right_rail.qa_stale_pane.opened"');
    expect(src).toContain('operation: "focus-pane"');
    expect(src).toContain(
      "const rightRailNegativePathAction = createDevVisualQaNegativePathAction(devVisualQa.negativePath)",
    );
    expect(src).toContain("? [rightRailNegativePathAction, ...rightRailBaseActions]");
  });

  it("keeps the terminal as the project home instead of showing an operations dashboard", () => {
    const src = getSrc();

    expect(src).not.toContain('import("./features/dashboard/MissionControlHome")');
    expect(src).not.toContain("MissionControlHome");
    expect(src).not.toContain("missionControlHome");
    expect(src).toContain("{terminalSurface}");
  });
});

describe("App visual QA bootstrap", () => {
  it("has a dev-only project view entrypoint for browser-based UI inspection", () => {
    const src = getSrc();

    expect(src).toContain("function readDevVisualQaState()");
    expect(src).toContain("function isExplicitDevVisualQaRequest()");
    expect(src).toContain("import.meta.env.DEV");
    expect(src).toContain('params.get("aelyrisVisualQa") === "1"');
    expect(src).not.toContain('window.localStorage.getItem("aelyris:visualQa") === "1"');
    expect(src).toContain('params.get("diagnostics") === "1"');
    expect(src).toContain("railScenarioParam");
    expect(src).toContain("usesDeprecatedStateAlias");
    expect(src).toContain("hasUrlEdgeLoop");
    expect(src).toContain("rightRailTruthNotice");
    expect(src).toContain('className="right-panel-truth-notice"');
    expect(src).toContain("Visual QA simulation");
    expect(src).toContain("runtime truth is unchanged");
    expect(src).toContain('requestedRail === "command"');
    expect(src).toContain('requestedRail === "review"');
    expect(src).toContain("createDevVisualQaPanes");
    expect(src).toContain("visualTerminalPaneTargets");
    expect(src).toContain("setRightRailMode(devVisualQa.railMode)");
    expect(src).toContain('window.localStorage.setItem("aelyris:onboarding-done", "true")');
    expect(src).toContain("setRootProjectPath(devVisualQa.projectPath)");
  });

  it("keeps stale URL debug state separated from runtime truth", () => {
    const src = getSrc();
    const packageJson = readFileSync(join(process.cwd(), "package.json"), "utf8");
    const script = readFileSync(join(process.cwd(), "scripts/verify-right-rail-stale-url-truth.mjs"), "utf8");
    const score = readFileSync(join(process.cwd(), "scripts/score-release-quality.mjs"), "utf8");

    expect(src).toContain("rightRailTruthNotice");
    expect(src).toContain("Visual QA simulation");
    expect(src).toContain("runtime truth is unchanged");
    expect(src).toContain("edgeLoop is replay evidence, not current runtime state.");
    expect(src).toContain("Use railState instead of the deprecated state alias.");
    expect(src).toContain("const allowDebugUrlFallback = isExplicitDevVisualQaRequest()");
    expect(src).toContain("function shouldMirrorRightRailEdgeFeedbackHistoryUrl()");
    expect(src).toContain("url.searchParams.has(RIGHT_RAIL_EDGE_FEEDBACK_URL_PARAM)");
    expect(src).toContain("shouldMirrorRightRailEdgeFeedbackHistoryUrl()");
    expect(packageJson).toContain(
      '"verify:right-rail-stale-url": "node scripts/verify-right-rail-stale-url-truth.mjs"',
    );
    expect(script).toContain("normal runtime replayed stale edgeLoop URL feedback");
    expect(script).toContain("explicit visual-QA URL did not render a truth-source notice");
    expect(script).toContain("state=blocked is fixture state");
    expect(script).toContain("edgeLoop is replay evidence");
    expect(score).toContain("right-rail-stale-url-truth.json");
    expect(score).toContain("right rail stale URL truth smoke is missing");
  });
});

describe("App config bootstrap", () => {
  it("hydrates appearance customization from config.toml at startup", () => {
    const src = getSrc();

    expect(src).toContain('invoke<BootstrapAppConfig>("load_app_config")');
    expect(src).toContain("store.setThemeId(cfg.appearance.theme)");
    expect(src).toContain("store.setMoodPresetId(normalizeMoodPreset");
    expect(src).toContain("store.replaceThemeOverrides(cfg.appearance.theme_overrides ?? {})");
    expect(src).toContain("store.replaceMoodMaterialOverrides(cfg.appearance.mood_material_overrides ?? {})");
    expect(src).toContain("store.replaceWallpaperSettingsByMood(cfg.appearance.wallpaper_settings_by_mood ?? {})");
    expect(src).toContain("store.setAppWindowOpacity(cfg.appearance.opacity)");
    expect(src).toContain('operation: "load_app_config_bootstrap"');
  });
});

describe("App active terminal routing", () => {
  it("does not send workstation commands to the first backend terminal implicitly", () => {
    const src = getSrc();

    expect(src).toContain("interface ActiveTerminalTarget");
    expect(src).toContain("const activeTerminalTarget = useMemo<ActiveTerminalTarget>");
    expect(src).toContain("const visualActiveTerminalTargetLabel = formatTerminalTarget");
    expect(src).toContain("activeTargetLabel={visualActiveTerminalTargetLabel}");
    expect(src).toContain("activeTargetReady={activeTerminalTarget.ready}");
    expect(src).toContain("const writeToActiveTerminal = useCallback");
    expect(src).toContain("No active terminal");
    expect(src).toContain("activeTerminalTarget.terminalId");
    expect(src).toContain(`return \`${templatePlaceholder("shellLabel")} · starting\``);
    expect(src).not.toContain("no active pane");
    expect(src).not.toContain('invoke<string[]>("list_terminals")');
    expect(src).not.toContain("terminals[0]");

    const runHandler = src.match(/const handleRunCommand\s*=\s*useCallback\([\s\S]*?\n\s*\);/);
    expect(runHandler?.[0] ?? "").toContain(`writeToActiveTerminal(\`${templatePlaceholder("command")}\\r\`)`);

    const historyHandler = src.match(/const handleHistoryAccept\s*=\s*useCallback\([\s\S]*?\n\s*\);/);
    expect(historyHandler?.[0] ?? "").toContain("writeToActiveTerminal(hit.entry.command");
  });
});
