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
  return entries[0][1];
}

function getStyles(): string {
  return readFileSync(join(process.cwd(), "src/styles/global.css"), "utf8");
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
    const canvasIme = readFileSync(join(process.cwd(), "src/features/terminal/hooks/useCanvasIME.ts"), "utf8");
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
    expect(script).toContain("function probeAetherProcesses");
    expect(script).toContain("function probeApiHealth");
    expect(script).toContain("function probeTerminalRoundtrip");
    expect(script).toContain("AETHER_POST_RESUME_TERMINAL_OK_");
    expect(script).toContain("function probeDbPaneLayout");
    expect(script).toContain('runAetherCtl(["db-smoke"]');
    expect(script).toContain('"cargo-run-aetherctl db-smoke"');
    expect(script).toContain("function writePostResumeProbe");
    expect(script).toContain("function writeAppExecutableRefresh");
    expect(script).toContain("binaryIdentityChanged");
    expect(script).toContain('status: evidence.status === "pass" && !binaryIdentityChanged ? "pass" : "pending"');
    expect(script).toContain("function writeSuspendBegin");
    expect(script).toContain("function writeSuspendResume");
    expect(script).toContain("function runGuardedSleepCycle");
    expect(script).toContain("function invokeWindowsSleep");
    expect(script).toContain("function assertWindowsSleepCycleAllowed");
    expect(script).toContain("AETHER_ALLOW_OS_SLEEP");
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
    expect(script).toContain("Launch the release Aether.exe and rerun pnpm verify:production:suspend:postcheck.");
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
    expect(score).toContain("terminalCoreSignalPoints");
    expect(score).toContain("terminalCorePoints = Math.max");
    expect(score).toContain("alacritty_terminal");
    expect(score).toContain("NativeTerminalRegistry");
    expect(score).toContain("native-terminal-input-host.json");
    expect(score).toContain("nativeInputCompositionBlocked");
    expect(score).toContain("frontend-native-default");
    expect(score).toContain("empty-or-non-text-paste-ignored");
    expect(score).toContain("save_clipboard_image");
    expect(score).toContain("terminal IME still crosses the WebView hidden textarea boundary");
    expect(score).toContain("image clipboard ingestion still depends on WebView navigator.clipboard");
    expect(canvasIme).toContain("native_terminal_input_commit");
    expect(canvasIme).toContain("native_terminal_input_focus");
    expect(canvasIme).toContain("native_terminal_input_drain");
    expect(canvasIme).toContain("NATIVE_INPUT_SURFACE_STORAGE_KEY");
    expect(canvasIme).toContain("NATIVE_INPUT_SURFACE_DEFAULT_ENABLED = true");
    expect(canvasIme).toContain("__TAURI_INTERNALS__");
    expect(canvasIme).toContain('source: "webview-ime-bridge"');
    expect(commands).toContain("native_terminal_input_commit");
    expect(commands).toContain("native_terminal_input_focus");
    expect(commands).toContain("native_terminal_input_drain");
    expect(commands).toContain("native_terminal_input_status");
    expect(commands).toContain("terminal_write_async(&app, &terminal_id, &bytes)");
    expect(lib).toContain("term::NativeTerminalInputHost::new()");
    expect(lib).toContain("ipc::native_terminal_input_commit");
    expect(lib).toContain("ipc::native_terminal_input_focus");
    expect(lib).toContain("ipc::native_terminal_input_drain");
    expect(nativeInput).toContain("webview_composition_bridge_required: true");
    expect(nativeInput).toContain("native_composition_surface_ready");
    expect(nativeInput).toContain("CreateWindowExW");
    expect(nativeInput).toContain("WM_IME_STARTCOMPOSITION");
    expect(nativeInput).toContain("WM_KEYDOWN");
    expect(nativeInput).toContain("terminal_bytes_for_native_key");
    expect(nativeInput).toContain("pending_bytes");
    expect(nativeInput).toContain("drain_native_edit_text");
    expect(packageJson).toContain('"verify:terminal:native-input"');
    expect(nativeInputVerify).toContain("composition-surface");
    expect(nativeInputVerify).toContain("surface-key-routing");
    expect(nativeInputVerify).toContain("frontend-native-default");
    expect(nativeInputVerify).toContain("WEBVIEW_IME_FALLBACK_TEST_ID");
    expect(nativeInputVerify).toContain("surface-command");
    expect(nativeInputVerify).toContain("frontend-surface-opt-in");
    expect(nativeInputVerify).toContain("webviewFallbackConditional");
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
    expect(productionGate).toContain("AETHER_RELEASE_SLEEP_CYCLE");
    expect(productionGate).toContain("Guarded real OS sleep/resume cycle");
    expect(productionGate).toContain('"verify:production:suspend:cycle"');
    expect(productionGate.indexOf("Real OS sleep/resume evidence")).toBeLessThan(
      productionGate.indexOf("Production risk closure evidence"),
    );
  });
});

describe("App right rail composition", () => {
  it("keeps the repeatable Edge feedback smoke wired into package scripts", () => {
    const packageJson = readFileSync(join(process.cwd(), "package.json"), "utf8");
    const script = readFileSync(join(process.cwd(), "scripts/verify-right-rail-edge-feedback.mjs"), "utf8");
    const suite = readFileSync(join(process.cwd(), "scripts/verify-right-rail-suite.mjs"), "utf8");
    const score = readFileSync(join(process.cwd(), "scripts/score-release-quality.mjs"), "utf8");

    expect(packageJson).toContain('"verify:right-rail-edge": "node scripts/verify-right-rail-edge-feedback.mjs"');
    expect(packageJson).toContain('"verify:right-rail": "node scripts/verify-right-rail-suite.mjs"');
    expect(packageJson).toContain('"verify:right-rail:strict"');
    expect(script).toContain("right-rail Edge score feedback");
    expect(script).toContain("AETHER_RIGHT_RAIL_EDGE_URL");
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
    expect(suite).toContain("LOCALHOST_CHECKS");
    expect(suite).toContain("CDP_CHECKS");
    expect(suite).toContain("AETHER_RIGHT_RAIL_REQUIRE_CDP");
    expect(suite).toContain("CDP endpoint required but unavailable");
    expect(suite).toContain("scripts/verify-right-rail-edge-feedback.mjs");
    expect(suite).toContain("scripts/verify-right-rail-decisions.mjs");
    expect(suite).toContain("scripts/verify-right-rail-preferences.mjs");
    expect(suite).toContain("scripts/verify-right-rail-negative-path.mjs");
    expect(suite).toContain("scripts/verify-right-rail-audit-jump.mjs");
    expect(suite).toContain('status: "skipped"');
    expect(suite).toContain("CDP endpoint unavailable");
    expect(score).toContain("right-rail-suite.json");
    expect(score).toContain('"right-rail-smoke"');
    expect(score).toContain("Right rail smoke suite");
    expect(score).toContain('check.id === "edge-feedback"');
    expect(score).toContain('check.status === "skipped"');
    expect(score).toContain("rightRailSmokeComplete");
    expect(score).toContain("rightRailSmokePartial");
    expect(score).toContain("right rail CDP/WebView2 smokes are skipped");
    expect(score).toContain("skipped: ");
    expect(score).toContain("right rail smoke suite is missing or failing");
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
    expect(src).toContain('className="right-panel-decision-focus"');
    expect(src).toContain('data-has-decision={decisionInbox.pendingCount > 0 ? "true" : "false"}');
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
    expect(src).toContain('data-widget="decision-inbox"');
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
    expect(src).toContain("changedFilesCount={rightRailChangedFiles.length}");
    expect(src).toContain("changedFiles={rightRailChangedFiles}");
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
    expect(src).toContain('const RIGHT_RAIL_GUARDRAIL_SYNC_EVENT = "aether:right-rail-guardrail-sync"');
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
    expect(src).toContain('const RIGHT_RAIL_WIDGET_STORAGE_PREFIX = "aether:right-rail-widget:"');
    expect(src).toContain('const RIGHT_RAIL_WIDGET_SYNC_EVENT = "aether:right-rail-widget-sync"');
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
    expect(src).toContain('forceOpen={rightRailFocusWidget === "toolkit"}');
    expect(src).toContain('forceOpen={rightRailFocusWidget === "workflow"}');
    expect(src).toContain('forceOpen={rightRailFocusWidget === "context"}');
    expect(src).toContain('forceOpen={rightRailFocusWidget === "audit-timeline"}');
    expect(src).toContain('forceOpen={rightRailFocusWidget === "run-graph"}');

    const commandRail = src.slice(commandStart, reviewStart);
    const observeRail = src.slice(observeStart);
    expect(commandRail).toContain('data-widget="decision-inbox"');
    expect(commandRail).toContain('data-widget="sessions"');
    expect(src.indexOf('className="right-panel-decision-focus"')).toBeLessThan(
      src.indexOf('className="right-panel-now"'),
    );
    expect(src.indexOf('className="right-panel-decision-focus"')).toBeLessThan(
      src.indexOf('className="right-panel-workforce"'),
    );
    expect(src.indexOf('className="right-panel-decision-focus"')).toBeLessThan(
      src.indexOf('className="right-panel-action-stack"'),
    );
    expect(commandRail.indexOf('data-widget="decision-inbox"')).toBeLessThan(commandRail.indexOf('widget="workflow"'));
    expect(commandRail.indexOf('data-widget="sessions"')).toBeLessThan(commandRail.indexOf('widget="toolkit"'));
    expect(observeRail.indexOf('data-widget="processes"')).toBeLessThan(observeRail.indexOf('widget="audit-timeline"'));
    expect(observeRail.indexOf('data-widget="live-panes"')).toBeLessThan(observeRail.indexOf('widget="run-graph"'));
  });

  it("keeps a dev-only negative path fixture for native right rail release smoke", () => {
    const src = getSrc();

    expect(src).toContain('negativePath: "missing-diff" | "stale-pane" | null');
    expect(src).toContain('params.get("negativePath") ?? params.get("rightRailNegativePath")');
    expect(src).toContain("function createDevVisualQaNegativePathAction");
    expect(src).toContain('label: "QA missing diff"');
    expect(src).toContain('auditEvent: "right_rail.qa_missing_diff.opened"');
    expect(src).toContain('operation: "open-primary-diff"');
    expect(src).toContain('label: "QA stale pane"');
    expect(src).toContain('targetPaneRole: "__qa_missing_pane__"');
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
    expect(src).toContain("import.meta.env.DEV");
    expect(src).toContain('params.get("aetherVisualQa") === "1"');
    expect(src).toContain('params.get("diagnostics") === "1"');
    expect(src).toContain('requestedRail === "command"');
    expect(src).toContain('requestedRail === "review"');
    expect(src).toContain("createDevVisualQaPanes");
    expect(src).toContain("visualTerminalPaneTargets");
    expect(src).toContain("setRightRailMode(devVisualQa.railMode)");
    expect(src).toContain('window.localStorage.setItem("aether:onboarding-done", "true")');
    expect(src).toContain("setRootProjectPath(devVisualQa.projectPath)");
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
