import { describe, expect, it } from "vitest";

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

describe("App right rail composition", () => {
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
    expect(src).toContain("right-panel-advisor");
    expect(src).toContain('import("./features/context/ContextPanel")');
    expect(src).toContain('import("./features/context/WorkstationPulse")');
    expect(src).toContain('import("./features/context/RunGraphPanel")');
    expect(src).toContain('import("./features/context/ToolLedgerPanel")');
    expect(src).toContain('import("./features/context/ReliabilityPanel")');
    expect(src).toContain('import("./features/decision-inbox")');
    expect(src).toContain('import("./features/review/ReviewQueuePanel")');
    expect(src).toContain("filterWorkspaceScopedEvents");
    expect(src).toContain("const workspaceProfile = useMemo(");
    const densityShells = src.match(/className="app-container" data-density=\{workspaceProfile\.visualDensity\}/g) ?? [];
    expect(densityShells).toHaveLength(2);
    expect(src).toContain("const scopedOperationalAuditEvents = useMemo(");
    expect(src).toContain("setWorkspaceThreadRunState(projectPath, activeTabId");
    expect(src).toContain("buildDecisionInbox({");
    expect(src).toContain("decisionInbox.pendingCount");
    expect(src).toContain('data-widget="decision-inbox"');
    expect(src).toContain("<DecisionInboxPanel");
    expect(src).toContain("const rightRailGraph = useMemo(");
    expect(src).toContain("buildWorkstationGraph({");
    expect(src).toContain("const focusedRightRailGraph = useMemo(");
    expect(src).toContain("filterWorkstationGraph(rightRailGraph");
    expect(src).toContain("workstationGraph={focusedRightRailGraph}");
    expect(src).toContain('data-widget="review-queue"');
    expect(src).toContain('data-widget="context"');
    expect(src).toContain('data-widget="run-graph"');
    expect(src).toContain('data-widget="tool-ledger"');
    expect(src).toContain('data-widget="reliability"');
    expect(src).toContain("<RunGraphPanel");
    expect(src).toContain("<ToolLedgerPanel");
    expect(src).toContain("<ReliabilityPanel");
    expect(src).toContain("changedFilesCount={changedFiles.length}");
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
    expect(src).toContain('document.querySelector<HTMLButtonElement>(`[data-right-rail-mode="${nextMode}"]`)?.focus()');
    expect(src).toContain("id={`right-rail-tab-${mode.id}`}");
    expect(src).toContain("data-right-rail-mode={mode.id}");
    expect(src).toContain('aria-controls="right-rail-panel"');
    expect(src).toContain("tabIndex={rightRailMode === mode.id ? 0 : -1}");
    expect(src).toContain("onKeyDown={handleRightRailModeKeyDown}");
    expect(src).toContain('role="tabpanel"');
    expect(src).toContain("aria-labelledby={`right-rail-tab-${rightRailMode}`}");
  });

  it("renders Mission Control as the project home without replacing terminal work", () => {
    const src = getSrc();

    expect(src).toContain('import("./features/dashboard/MissionControlHome")');
    expect(src).toContain("const missionControlHome = (");
    expect(src).toContain("<MissionControlHome");
    expect(src).toContain("projectName={projectName}");
    expect(src).toContain("projectPath={projectPath}");
    expect(src).toContain("panes={visualTerminalPaneTargets}");
    expect(src).toContain("sessions={sessions}");
    expect(src).toContain("interactiveSessionCount={interactiveSessions.length}");
    expect(src).toContain("changedFiles={changedFiles}");
    expect(src).toContain("auditEvents={scopedOperationalAuditEvents}");
    expect(src).toContain("workstationGraph={rightRailGraph}");
    expect(src).toContain("contextWarnPct={contextWarnPct}");
    expect(src).toContain("onOpenReview={() => setRightRailMode(\"review\")}");
    expect(src).toContain("className={appStyles.workspaceHome}");
    expect(src).toContain("{missionControlHome}");
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

describe("App active terminal routing", () => {
  it("does not send workstation commands to the first backend terminal implicitly", () => {
    const src = getSrc();

    expect(src).toContain("interface ActiveTerminalTarget");
    expect(src).toContain("const activeTerminalTarget = useMemo<ActiveTerminalTarget>");
    expect(src).toContain("const writeToActiveTerminal = useCallback");
    expect(src).toContain("No active terminal");
    expect(src).toContain("activeTerminalTarget.terminalId");
    expect(src).not.toContain('invoke<string[]>("list_terminals")');
    expect(src).not.toContain("terminals[0]");

    const runHandler = src.match(/const handleRunCommand\s*=\s*useCallback\([\s\S]*?\n\s*\);/);
    expect(runHandler?.[0] ?? "").toContain("writeToActiveTerminal(`${command}\\r`)");

    const historyHandler = src.match(/const handleHistoryAccept\s*=\s*useCallback\([\s\S]*?\n\s*\);/);
    expect(historyHandler?.[0] ?? "").toContain("writeToActiveTerminal(hit.entry.command");
  });
});
