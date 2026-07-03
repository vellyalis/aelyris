// Vitest runs this source-contract test in Node. The app tsconfig does not
// include @types/node, so keep the Node-only imports scoped and ignored here.
// @ts-expect-error Node types are intentionally absent from the app tsconfig.
import { readdirSync, readFileSync, statSync } from "node:fs";
// @ts-expect-error Node types are intentionally absent from the app tsconfig.
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

declare const process: { cwd(): string };

function collectCssFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir) as string[]) {
    const absolute = join(dir, entry);
    const stat = statSync(absolute);
    if (stat.isDirectory()) {
      files.push(...collectCssFiles(absolute));
    } else if (absolute.endsWith(".css")) {
      files.push(absolute);
    }
  }
  return files;
}

const srcDir = join(process.cwd(), "src");

const cssSources = Object.fromEntries(
  collectCssFiles(srcDir).map((file) => [
    `../${relative(srcDir, file).replace(/\\/g, "/")}`,
    readFileSync(file, "utf8"),
  ]),
) as Record<string, string>;

describe("design token usage", () => {
  it("does not use transparent surface tokens as foreground colors", () => {
    const offenders = Object.entries(cssSources)
      .map(([file, source]) => ({
        file,
        matches: source.match(/color\s*:\s*var\(--aelyris-bg\)/g) ?? [],
      }))
      .filter((entry) => entry.matches.length > 0)
      .map((entry) => `${entry.file} (${entry.matches.length})`);

    expect(offenders).toEqual([]);
  });

  it("keeps terminal chrome integrated without hard horizontal separator borders", () => {
    const terminalChromeFileSuffixes = [
      "features/terminal/TerminalInfoBar.module.css",
      "features/timeline/TimelineBar.module.css",
      "features/terminal/IMEInputBar.module.css",
    ];

    const sources = terminalChromeFileSuffixes.map((suffix) => {
      const entry = Object.entries(cssSources).find(([file]) => file.includes(suffix));
      expect(entry, suffix).toBeDefined();
      return { file: entry?.[0] ?? suffix, source: entry?.[1] ?? "" };
    });

    const offenders = sources
      .map(({ file, source }) => ({
        file,
        matches: source.match(/border-(?:top|bottom)\s*:\s*1px\s+solid/g) ?? [],
      }))
      .filter((entry) => entry.matches.length > 0)
      .map((entry) => `${entry.file} (${entry.matches.length})`);

    expect(offenders).toEqual([]);
  });

  it("keeps the OS title chrome stronger than workspace navigation rails", () => {
    const header =
      Object.entries(cssSources).find(([file]) => file.includes("features/header/ProjectHeaderBar.module.css"))?.[1] ??
      "";
    const workspaceTabs =
      Object.entries(cssSources).find(([file]) =>
        file.includes("features/workspace-tabs/WorkspaceTabs.module.css"),
      )?.[1] ?? "";
    const statusbar =
      Object.entries(cssSources).find(([file]) => file.includes("features/statusbar/StatusBar.module.css"))?.[1] ?? "";
    const editorTabs = Object.entries(cssSources).find(([file]) => file.includes("App.module.css"))?.[1] ?? "";

    expect(header).toContain("var(--chrome-frame-bg)");
    expect(header).toContain("var(--chrome-frame-filter)");
    expect(workspaceTabs).not.toContain("var(--chrome-frame-shadow)");
    expect(statusbar).not.toContain("var(--chrome-frame-bg)");
    expect(statusbar).not.toContain("var(--chrome-frame-filter)");
    expect(editorTabs).not.toContain("var(--chrome-frame-shadow)");
  });

  it("keeps the terminal canvas recessed instead of drawing an outer card shadow", () => {
    const entry = Object.entries(cssSources).find(([file]) =>
      file.includes("features/terminal/TerminalArea.module.css"),
    );
    expect(entry).toBeDefined();
    const source = entry?.[1] ?? "";

    expect(source).not.toContain("0 16px 34px");
    expect(source).toContain("var(--terminal-viewport-shadow)");
  });

  it("does not double-paint the live terminal viewport behind canvas rows", () => {
    const entry = Object.entries(cssSources).find(([file]) =>
      file.includes("features/terminal/TerminalArea.module.css"),
    );
    expect(entry).toBeDefined();
    const source = entry?.[1] ?? "";
    const viewportRule = source.match(/\.terminalViewport\s*{[\s\S]*?}/)?.[0] ?? "";

    expect(viewportRule).not.toContain("var(--terminal-canvas-bg)");
    expect(viewportRule).toContain("var(--terminal-well-bg)");
  });

  it("uses the terminal shell as the single textured acrylic layer", () => {
    const entry = Object.entries(cssSources).find(([file]) =>
      file.includes("features/terminal/pane-tree/PaneTreeRenderer.module.css"),
    );
    expect(entry).toBeDefined();
    const source = entry?.[1] ?? "";

    expect(source).toContain("var(--terminal-shell-filter)");
    expect(source).toContain("var(--terminal-shell-depth)");
    expect(source).not.toContain("var(--terminal-shell-shadow)");
  });

  it("keeps empty timeline chrome compact instead of a permanent feature strip", () => {
    const entry = Object.entries(cssSources).find(([file]) =>
      file.includes("features/timeline/TimelineBar.module.css"),
    );
    expect(entry).toBeDefined();
    const source = entry?.[1] ?? "";
    const emptyRule = source.match(/\.root\[data-empty="true"\]\s*{[\s\S]*?}/)?.[0] ?? "";

    expect(emptyRule).toContain("min-height: 18px");
    expect(emptyRule).toContain("background: transparent");
    expect(emptyRule).toContain("box-shadow: none");
    expect(source).not.toContain("No snapshots yet");
  });

  it("keeps the workspace stage transparent so native Acrylic remains visible", () => {
    const entry = Object.entries(cssSources).find(([file]) => file.includes("styles/global.css"));
    expect(entry).toBeDefined();
    const source = entry?.[1] ?? "";
    const appMainRule = source.match(/\.app-main\s*{[\s\S]*?}/)?.[0] ?? "";
    const rootGlowRule = source.match(/#root::before\s*{[\s\S]*?}/)?.[0] ?? "";

    expect(appMainRule).toContain("background: transparent");
    expect(rootGlowRule).toContain("opacity: calc(var(--mood-root-glow-opacity) * var(--aelyris-window-opacity))");
  });

  it("keeps localhost preview and native Tauri backplanes separated", () => {
    const entry = Object.entries(cssSources).find(([file]) => file.includes("styles/global.css"));
    expect(entry).toBeDefined();
    const source = entry?.[1] ?? "";

    expect(source).toContain('html[data-aelyris-host="browser"]');
    expect(source).toContain('html[data-aelyris-host="browser"] body');
    expect(source).toContain('html[data-aelyris-host="tauri"] #root');
    expect(source).toContain("--native-backdrop-veil");
    expect(source).toContain("background: var(--native-backdrop-veil), var(--mood-root-glow)");
    expect(source).not.toContain('html[data-aelyris-host="tauri"] body');
  });

  it("keeps inactive-window glass translucent instead of turning into a slab", () => {
    const entry = Object.entries(cssSources).find(([file]) => file.includes("styles/global.css"));
    expect(entry).toBeDefined();
    const source = entry?.[1] ?? "";
    const inactiveRule = source.match(/body\[data-window-focused="false"\]\s*{[\s\S]*?}/)?.[0] ?? "";

    expect(inactiveRule).toContain("--glass-thick: rgba(5, 15, 26, 0.36)");
    expect(inactiveRule).toContain("--glass-ground: rgba(2, 7, 13, 0.22)");
    expect(inactiveRule).not.toContain("0.54");
    expect(inactiveRule).not.toContain("0.48");
    expect(inactiveRule).not.toContain("0.8");
    expect(inactiveRule).not.toContain("0.9");
  });

  it("keeps nested bento veils nearly invisible so glass does not turn milky", () => {
    const entry = Object.entries(cssSources).find(([file]) => file.includes("styles/global.css"));
    expect(entry).toBeDefined();
    const source = entry?.[1] ?? "";
    const veilRule = source.match(/\.bento-widget::before\s*{[\s\S]*?}/)?.[0] ?? "";

    expect(veilRule).toContain("opacity: 0.012");
    expect(veilRule).not.toContain("opacity: 0.78");
  });

  it("keeps right-panel widgets as sections inside one inspector material", () => {
    const entry = Object.entries(cssSources).find(([file]) => file.includes("styles/global.css"));
    expect(entry).toBeDefined();
    const source = entry?.[1] ?? "";
    const widgetRule = source.match(/\.bento-widget\s*{[\s\S]*?}/)?.[0] ?? "";
    const siblingRule = source.match(/\.bento-widget \+ \.bento-widget\s*{[\s\S]*?}/)?.[0] ?? "";

    expect(widgetRule).toContain("background: transparent");
    expect(widgetRule).toContain("box-shadow: none");
    expect(siblingRule).toContain("box-shadow: none");
    expect(siblingRule).not.toContain("box-shadow: inset 0 1px 0");
  });

  it("keeps collapsed right-panel widgets from stretching into empty slabs", () => {
    const entry = Object.entries(cssSources).find(([file]) => file.includes("styles/global.css"));
    expect(entry).toBeDefined();
    const source = entry?.[1] ?? "";
    const bottomGridRule = source.match(/\.right-panel-bottom-grid\s*{[\s\S]*?}/)?.[0] ?? "";
    const contextRule = source.match(/\.bento-widget\[data-widget="context"\]\s*{[\s\S]*?}/)?.[0] ?? "";

    expect(bottomGridRule).toContain("align-items: start");
    expect(bottomGridRule).toContain("grid-template-columns: minmax(0, 1fr)");
    expect(contextRule).toContain("align-self: stretch");
  });

  it("keeps right-rail action results compact and ellipsized", () => {
    const source = Object.entries(cssSources).find(([file]) => file.includes("styles/global.css"))?.[1] ?? "";
    const resultRule = source.match(/\.right-panel-action-result\s*{[\s\S]*?}/)?.[0] ?? "";
    const resultSharedRule =
      source.match(/\.right-panel-action-result-label,\s*\n\.right-panel-action-result-detail\s*{[\s\S]*?}/)?.[0] ?? "";
    const auditButtonRule = source.match(/\.right-panel-action-result-audit\s*{[\s\S]*?}/)?.[0] ?? "";

    expect(resultRule).toContain("min-width: 0");
    expect(resultRule).toContain("grid-template-columns: auto minmax(0, 1fr) auto");
    expect(resultSharedRule).toContain("overflow: hidden");
    expect(resultSharedRule).toContain("text-overflow: ellipsis");
    expect(resultSharedRule).toContain("white-space: nowrap");
    expect(source).toContain("grid-column: 1 / 3");
    expect(auditButtonRule).toContain("grid-column: 3");
    expect(auditButtonRule).toContain("min-width: 44px");
  });

  it("keeps review-mode surfaces from forcing the right rail wider", () => {
    const global = Object.entries(cssSources).find(([file]) => file.includes("styles/global.css"))?.[1] ?? "";
    const panelHeader =
      Object.entries(cssSources).find(([file]) => file.includes("shared/ui/PanelHeader.module.css"))?.[1] ?? "";
    const scm =
      Object.entries(cssSources).find(([file]) => file.includes("features/scm/SCMPanel.module.css"))?.[1] ?? "";
    const review =
      Object.entries(cssSources).find(([file]) => file.includes("features/review/ReviewQueuePanel.module.css"))?.[1] ??
      "";
    const workflow =
      Object.entries(cssSources).find(([file]) => file.includes("features/workflow/WorkflowPanel.module.css"))?.[1] ??
      "";
    const pulse =
      Object.entries(cssSources).find(([file]) => file.includes("features/context/WorkstationPulse.module.css"))?.[1] ??
      "";
    const ledger =
      Object.entries(cssSources).find(([file]) => file.includes("features/context/ToolLedgerPanel.module.css"))?.[1] ??
      "";
    const inspector =
      Object.entries(cssSources).find(([file]) =>
        file.includes("features/agent-inspector/AgentInspector.module.css"),
      )?.[1] ?? "";
    const inlineResult =
      Object.entries(cssSources).find(([file]) =>
        file.includes("features/agent-inspector/InlineResultPanel.module.css"),
      )?.[1] ?? "";
    const conductor =
      Object.entries(cssSources).find(([file]) =>
        file.includes("features/agent-inspector/ConductorView.module.css"),
      )?.[1] ?? "";
    const collapsible =
      Object.entries(cssSources).find(([file]) => file.includes("shared/ui/CollapsibleSection.module.css"))?.[1] ?? "";

    const rightPanelRule = global.match(/\.right-panel\s*{[\s\S]*?}/)?.[0] ?? "";
    const rightPanelContentRule = global.match(/\.right-panel-content\s*{[\s\S]*?}/)?.[0] ?? "";
    const rightModeSwitchRule = global.match(/\.right-panel-mode-switch\s*{[\s\S]*?}/)?.[0] ?? "";
    const rightModeTabRule = global.match(/\.right-panel-mode-tab\s*{[\s\S]*?}/)?.[0] ?? "";
    const rightModeFocusRule = global.match(/\.right-panel-mode-tab:focus-visible\s*{[\s\S]*?}/)?.[0] ?? "";
    const rightModeBadgeRule = global.match(/\.right-panel-mode-badge\s*{[\s\S]*?}/)?.[0] ?? "";
    const advisorRule = global.match(/\.right-panel-advisor\s*{[\s\S]*?}/)?.[0] ?? "";
    const advisorFocusRule = global.match(/\.right-panel-advisor:focus-visible\s*{[\s\S]*?}/)?.[0] ?? "";
    const advisorCopyRule = global.match(/\.right-panel-advisor-copy\s*{[\s\S]*?}/)?.[0] ?? "";
    const stackRule = global.match(/\.right-panel-stack\s*{[\s\S]*?}/)?.[0] ?? "";
    const widgetRule = global.match(/\.bento-widget\s*{[\s\S]*?}/)?.[0] ?? "";
    const advisorTargetRule = global.match(/\.right-panel-advisor-target\s*{[\s\S]*?}/)?.[0] ?? "";
    const headerRule = panelHeader.match(/\.header\s*{[\s\S]*?}/)?.[0] ?? "";
    const headerTitleRule = panelHeader.match(/\.title\s*{[\s\S]*?}/)?.[0] ?? "";
    const headerCountRule = panelHeader.match(/\.count\s*{[\s\S]*?}/)?.[0] ?? "";
    const panelFocusRule =
      panelHeader.match(/\.header\[data-collapsible="true"\]:focus-within\s*{[\s\S]*?}/)?.[0] ?? "";
    const sectionFocusRule = collapsible.match(/\.header:focus-visible\s*{[\s\S]*?}/)?.[0] ?? "";
    const sectionOpenRule = collapsible.match(/\.content\[data-state="open"\]\s*{[\s\S]*?}/)?.[0] ?? "";
    const sectionClosedRule = collapsible.match(/\.content\[data-state="closed"\]\s*{[\s\S]*?}/)?.[0] ?? "";
    const inspectorTabRule = inspector.match(/\.tab\s*{[\s\S]*?}/)?.[0] ?? "";
    const inspectorTabLabelRule = inspector.match(/\.tabLabel\s*{[\s\S]*?}/)?.[0] ?? "";
    const inspectorRule = inspector.match(/\.inspector\s*{[\s\S]*?}/)?.[0] ?? "";
    const inspectorCardsRule = inspector.match(/\.cards\s*{[\s\S]*?}/)?.[0] ?? "";
    const inspectorCardRule = inspector.match(/\.card\s*{[\s\S]*?}/)?.[0] ?? "";
    const inspectorCardWatchdogRule = inspector.match(/\.cardWatchdog\s*{[\s\S]*?}/)?.[0] ?? "";
    const inspectorCardSelectedRule = inspector.match(/\.cardSelected\s*{[\s\S]*?}/)?.[0] ?? "";
    const inspectorLogListRule = inspector.match(/\.logList\s*{[\s\S]*?}/)?.[0] ?? "";
    const inspectorLogContentRule = inspector.match(/^\.logContent\s*{[\s\S]*?^}/m)?.[0] ?? "";
    const inspectorParallelViewRule = inspector.match(/\.parallelView\s*{[\s\S]*?}/)?.[0] ?? "";
    const inspectorParallelLogsRule = inspector.match(/\.parallelLogs\s*{[\s\S]*?}/)?.[0] ?? "";
    const inlinePanelRule = inlineResult.match(/\.panel\s*{[\s\S]*?}/)?.[0] ?? "";
    const inlineFileTabsRule = inlineResult.match(/\.fileTabs\s*{[\s\S]*?}/)?.[0] ?? "";
    const inlineFileTabRule = inlineResult.match(/\.fileTab\s*{[\s\S]*?}/)?.[0] ?? "";
    const inlineNavRule = inlineResult.match(/\.nav\s*{[\s\S]*?}/)?.[0] ?? "";
    const inlineFilePathRule = inlineResult.match(/\.filePath\s*{[\s\S]*?}/)?.[0] ?? "";
    const inlineNavActionsRule = inlineResult.match(/\.navActions\s*{[\s\S]*?}/)?.[0] ?? "";
    const inlineActionLabelRule = inlineResult.match(/\.actionLabel\s*{[\s\S]*?}/)?.[0] ?? "";
    const inlineAiFixRule = inlineResult.match(/\.aiFixBtn\s*{[\s\S]*?}/)?.[0] ?? "";
    const inlineRevertRule = inlineResult.match(/\.revertBtn\s*{[\s\S]*?}/)?.[0] ?? "";
    const inlineDiffAreaRule = inlineResult.match(/\.diffArea\s*{[\s\S]*?}/)?.[0] ?? "";
    const conductorViewRule = conductor.match(/\.view\s*{[\s\S]*?}/)?.[0] ?? "";
    const conductorRoleSummaryRule = conductor.match(/\.roleSummary\s*{[\s\S]*?}/)?.[0] ?? "";
    const conductorRoleChipRule = conductor.match(/\.roleChip\s*{[\s\S]*?}/)?.[0] ?? "";
    const conductorRoleChipTextRule = conductor.match(/\.roleChipText\s*{[\s\S]*?}/)?.[0] ?? "";
    const fileRowRule = scm.match(/\.fileRow\s*{[\s\S]*?}/)?.[0] ?? "";
    const commitActionsRule = scm.match(/\.commitActions\s*{[\s\S]*?}/)?.[0] ?? "";
    const scmGroupsRule = scm.match(/\.groups\s*{[\s\S]*?}/)?.[0] ?? "";
    const itemMetaRule = review.match(/\.itemMeta\s*{[\s\S]*?}/)?.[0] ?? "";
    const sessionChipsRule = review.match(/\.sessionChips\s*{[\s\S]*?}/)?.[0] ?? "";
    const reviewAgentBtnRule = review.match(/\.reviewAgentBtn\s*{[\s\S]*?}/)?.[0] ?? "";
    const reviewMetricRule = review.match(/\.metric\s*{[\s\S]*?}/)?.[0] ?? "";
    const reviewListRule = review.match(/\.list\s*{[\s\S]*?}/)?.[0] ?? "";
    const reviewItemRule = review.match(/\.item\s*{[\s\S]*?}/)?.[0] ?? "";
    const templateBtnRule = workflow.match(/\.templateBtn\s*{[\s\S]*?}/)?.[0] ?? "";
    const templatePhasesRule = workflow.match(/\.templatePhases\s*{[\s\S]*?}/)?.[0] ?? "";
    const pulseRule = pulse.match(/\.pulse\s*{[\s\S]*?}/)?.[0] ?? "";
    const pulseSignalRule = pulse.match(/\.signal\s*{[\s\S]*?}/)?.[0] ?? "";
    const pulseMetricsRule = pulse.match(/\.metrics\s*{[\s\S]*?}/)?.[0] ?? "";
    const pulseMetricRule = pulse.match(/\.metric\s*{[\s\S]*?}/)?.[0] ?? "";
    const pulseMedia = pulse.match(/@container \(max-width: 360px\)\s*{[\s\S]*?}/)?.[0] ?? "";
    const ledgerPanelRule = ledger.match(/\.panel\s*{[\s\S]*?}/)?.[0] ?? "";
    const ledgerRowRule = ledger.match(/\.row\s*{[\s\S]*?}/)?.[0] ?? "";
    const ledgerMedia = ledger.match(/@container \(max-width: 330px\)\s*{[\s\S]*?}/)?.[0] ?? "";

    expect(rightPanelRule).toContain("overflow-y: hidden");
    expect(rightPanelContentRule).toContain("overflow-x: hidden");
    expect(rightPanelContentRule).toContain("overflow-y: auto");
    expect(rightModeSwitchRule).toContain("grid-auto-rows: 26px");
    expect(rightModeTabRule).toContain("display: grid");
    expect(rightModeTabRule).toContain("grid-template-columns: 12px minmax(0, 1fr)");
    expect(rightModeTabRule).toContain("padding: 0 8px 0 6px");
    expect(rightModeTabRule).toContain("overflow: hidden");
    expect(rightModeTabRule).toContain("contain: layout paint");
    expect(rightModeFocusRule).toContain("outline-offset: -2px !important");
    expect(rightModeBadgeRule).toContain("position: absolute");
    expect(rightModeBadgeRule).toContain("right: 4px");
    expect(rightModeBadgeRule).toContain("max-width: 28px");
    expect(rightModeBadgeRule).toContain("text-overflow: ellipsis");
    expect(global).toContain('.right-panel-mode-tab[data-has-badge="true"]');
    expect(global).toContain(".right-panel-mode-tab svg");
    expect(global).toContain("display: inline");
    expect(advisorRule).toContain("height: 40px");
    expect(advisorRule).toContain("min-height: 40px");
    expect(advisorFocusRule).toContain("outline-offset: -2px !important");
    expect(advisorCopyRule).toContain("height: 24px");
    expect(advisorCopyRule).toContain("justify-content: center");
    expect(stackRule).toContain("min-width: 0");
    expect(stackRule).toContain("display: flex");
    expect(stackRule).toContain("flex-direction: column");
    expect(stackRule).toContain("overflow: visible");
    expect(stackRule).not.toContain("both-edges");
    expect(stackRule).not.toContain("display: grid");
    expect(widgetRule).toContain("flex: 0 0 auto");
    expect(widgetRule).toContain("overflow: hidden");
    expect(widgetRule).toContain("min-height: min-content");
    expect(widgetRule).toContain("min-width: 0");
    expect(widgetRule).toContain("max-width: 100%");
    expect(global).toContain("@container (max-width: 330px)");
    expect(global).toContain("@media (max-width: 860px)");
    expect(global).toContain("@media (max-width: 720px)");
    expect(global).toContain("width: clamp(280px, 42vw, 320px) !important");
    expect(global).toContain("flex-basis: clamp(224px, 38vw, 240px) !important");
    expect(global).toContain("width: clamp(224px, 38vw, 240px) !important");
    expect(advisorTargetRule).toContain("text-overflow: ellipsis");
    expect(headerRule).toContain("min-width: 0");
    expect(headerRule).toContain("min-height: 32px");
    expect(headerTitleRule).toContain("text-overflow: ellipsis");
    expect(headerCountRule).toContain("font-variant-numeric: tabular-nums");
    expect(headerCountRule).toContain("flex: 0 0 auto");
    expect(panelHeader).toContain("max-width: min(46%, 132px)");
    expect(collapsible).toContain("max-width: min(44%, 116px)");
    expect(sectionOpenRule).toContain("animation: none");
    expect(sectionClosedRule).toContain("animation: none");
    expect(collapsible).not.toContain("@keyframes collapsibleOpen");
    expect(collapsible).not.toContain("@keyframes collapsibleClose");
    expect(panelFocusRule).toContain("box-shadow:");
    expect(panelFocusRule).toContain("outline: none !important");
    expect(panelFocusRule).not.toContain("outline: 2px solid");
    expect(sectionFocusRule).toContain("box-shadow:");
    expect(sectionFocusRule).toContain("outline: none !important");
    expect(inspectorTabRule).toContain("flex: 0 0 24px");
    expect(inspectorTabRule).toContain("width: 24px");
    expect(inspectorTabLabelRule).toContain("display: none");
    expect(inspectorRule).toContain("min-height: 0");
    expect(inspectorCardsRule).toContain("overflow: hidden");
    expect(inspectorCardsRule).toContain("flex: 0 0 auto");
    expect(inspectorCardsRule).not.toContain("overflow-y: auto");
    expect(inspectorCardsRule).not.toContain("scrollbar-gutter: stable");
    expect(inspectorCardRule).toContain("border: 1px solid");
    expect(inspectorCardRule).toContain("var(--rim-top)");
    expect(inspectorCardWatchdogRule).toContain("border-color:");
    expect(inspectorCardWatchdogRule).toContain("box-shadow:");
    expect(inspectorCardSelectedRule).toContain("var(--rim-top)");
    expect(inspectorCardSelectedRule).toContain("inset 0 0 0 2px");
    expect(inspectorLogListRule).toContain("overflow: hidden");
    expect(inspectorLogListRule).not.toContain("overflow-y: auto");
    expect(inspectorLogContentRule).toContain("overflow-wrap: anywhere");
    expect(inspectorLogContentRule).toContain("word-break: normal");
    expect(inspectorParallelViewRule).toContain("overflow: hidden");
    expect(inspectorParallelViewRule).not.toContain("overflow-y: auto");
    expect(inspectorParallelLogsRule).toContain("overflow: hidden");
    expect(inspectorParallelLogsRule).not.toContain("overflow-y: auto");
    expect(inlinePanelRule).toContain("min-width: 0");
    expect(inlinePanelRule).toContain("min-height: 0");
    expect(inlineFileTabsRule).toContain("display: grid");
    expect(inlineFileTabsRule).toContain("grid-auto-columns: minmax(74px, 1fr)");
    expect(inlineFileTabsRule).toContain("overflow: hidden");
    expect(inlineFileTabsRule).not.toContain("overflow-x: auto");
    expect(inlineFileTabRule).toContain("text-overflow: ellipsis");
    expect(inlineNavRule).toContain("display: grid");
    expect(inlineNavRule).toContain("grid-template-columns: 18px 34px 18px minmax(0, 1fr) minmax(88px, auto)");
    expect(inlineFilePathRule).toContain("text-overflow: ellipsis");
    expect(inlineNavActionsRule).toContain("justify-content: end");
    expect(inlineNavActionsRule).toContain("overflow: hidden");
    expect(inlineActionLabelRule).toContain("text-overflow: ellipsis");
    expect(inlineAiFixRule).toContain("max-width: 70px");
    expect(inlineAiFixRule).not.toContain("display: none");
    expect(inlineRevertRule).not.toContain("display: none");
    expect(inlineDiffAreaRule).toContain("min-height: 0");
    expect(conductorViewRule).toContain("min-width: 0");
    expect(conductorViewRule).toContain("overflow: hidden");
    expect(conductorRoleSummaryRule).toContain("grid-template-columns: repeat(auto-fit, minmax(78px, 1fr))");
    expect(conductorRoleSummaryRule).toContain("overflow: hidden");
    expect(conductorRoleChipRule).toContain("min-width: 0");
    expect(conductorRoleChipRule).not.toContain("position: absolute");
    expect(conductorRoleChipRule).not.toContain("width: 260px");
    expect(conductorRoleChipTextRule).toContain("text-overflow: ellipsis");
    expect(fileRowRule).toContain("display: grid");
    expect(fileRowRule).toContain("minmax(0, 0.82fr)");
    expect(fileRowRule).toContain("min-height: 22px");
    expect(commitActionsRule).toContain("display: grid");
    expect(commitActionsRule).toContain("grid-auto-rows: 24px");
    expect(scmGroupsRule).toContain("scrollbar-gutter: stable");
    expect(itemMetaRule).toContain("display: grid");
    expect(sessionChipsRule).toContain("grid-column: 1 / -1");
    expect(sessionChipsRule).toContain("flex-wrap: wrap");
    expect(sessionChipsRule).toContain("overflow: clip");
    expect(reviewAgentBtnRule).toContain("width: 72px");
    expect(reviewMetricRule).toContain("min-height: 36px");
    expect(reviewListRule).toContain("scrollbar-gutter: stable");
    expect(reviewItemRule).toContain("min-height: 58px");
    expect(templateBtnRule).toContain("min-width: 0");
    expect(templateBtnRule).toContain("min-height: 28px");
    expect(templatePhasesRule).toContain("flex: 0 0 64px");
    expect(templatePhasesRule).toContain("text-overflow: ellipsis");
    expect(pulseRule).toContain("min-width: 0");
    expect(pulseRule).toContain("min-height: 50px");
    expect(pulseRule).toContain("minmax(0, 1.08fr)");
    expect(pulseSignalRule).toContain("min-height: 32px");
    expect(pulseMetricsRule).toContain("height: 32px");
    expect(pulseMetricRule).toContain("height: 32px");
    expect(pulseMedia).toContain("min-height: 84px");
    expect(pulseMedia).toContain("grid-template-columns: 1fr");
    expect(ledgerPanelRule).toContain("min-width: 0");
    expect(ledgerRowRule).toContain("display: grid");
    expect(ledgerRowRule).toContain("minmax(0, 1fr)");
    expect(ledgerMedia).toContain("grid-template-columns: 22px minmax(0, 1fr)");
  });

  it("reserves scrollbar gutters on everyday scroll surfaces to prevent tab-to-tab width drift", () => {
    const surfaces = [
      "features/file-tree/FileTree.module.css",
      "features/logs/LogsPanel.module.css",
      "features/command-palette/CommandPalette.module.css",
      "features/quick-open/QuickOpen.module.css",
      "features/search/SearchPanel.module.css",
      "features/settings/Settings.module.css",
      "features/pr-inspector/PRInspector.module.css",
      "features/ghost-diff/GhostDiffPanel.module.css",
      "features/worktree/WorktreeManager.module.css",
    ];

    for (const suffix of surfaces) {
      const source = Object.entries(cssSources).find(([file]) => file.includes(suffix))?.[1] ?? "";
      expect(source, suffix).toContain("scrollbar-gutter: stable");
    }
  });

  it("keeps panel filtering glassy without using opaque slabs", () => {
    const entry = Object.entries(cssSources).find(([file]) => file.includes("styles/global.css"));
    expect(entry).toBeDefined();
    const source = entry?.[1] ?? "";

    // Panel filter must be a plain blur: brightness/contrast/saturate in a backdrop-filter
    // force OPACITY on a transparent (see-through) window, defeating the glass effect.
    expect(source).toContain("--material-panel-filter: blur(8px)");
    expect(source).not.toMatch(/--material-panel-filter:[^;]*\b(brightness|contrast)\(/);
    expect(source).toContain("linear-gradient(145deg, rgba(0, 126, 190, 0.042), transparent 48%)");
    expect(source).toContain("backdrop-filter: var(--material-panel-filter)");
    expect(source).not.toContain("--material-panel-filter: blur(20px)");
  });

  it("routes floating inspector panels through the clear panel filter", () => {
    const toolkit =
      Object.entries(cssSources).find(([file]) => file.includes("features/toolkit/ToolkitPanel.module.css"))?.[1] ?? "";
    const inspector =
      Object.entries(cssSources).find(([file]) =>
        file.includes("features/agent-inspector/AgentInspector.module.css"),
      )?.[1] ?? "";

    expect(toolkit).toContain("backdrop-filter: var(--material-panel-filter)");
    expect(inspector).toContain("backdrop-filter: var(--material-panel-filter)");
    expect(`${toolkit}\n${inspector}`).not.toContain("saturate(1.18) contrast(1.04)");
  });

  it("routes popover chrome through the clear popup material", () => {
    const global = Object.entries(cssSources).find(([file]) => file.includes("styles/global.css"))?.[1] ?? "";
    const popupSources = [
      "features/menubar/MenuBar.module.css",
      "features/file-tree/FileTree.module.css",
      "features/statusbar/StatusBar.module.css",
      "features/command-palette/CommandPalette.module.css",
      "features/quick-open/QuickOpen.module.css",
      "shared/ui/ContextMenu.module.css",
      "shared/ui/Toast.module.css",
    ].map((suffix) => Object.entries(cssSources).find(([file]) => file.includes(suffix))?.[1] ?? "");
    const combined = popupSources.join("\n");

    expect(global).toContain("--popup-glass-bg");
    expect(combined).toContain("var(--popup-glass-bg)");
    expect(combined).not.toContain("var(--dialog-surface)");
    expect(combined).not.toContain("blur(20px)");
  });

  it("keeps terminal shell gutters collapsed while preserving the active focus ring", () => {
    const entry = Object.entries(cssSources).find(([file]) =>
      file.includes("features/terminal/pane-tree/PaneTreeRenderer.module.css"),
    );
    const terminalAreaEntry = Object.entries(cssSources).find(([file]) =>
      file.includes("features/terminal/TerminalArea.module.css"),
    );
    expect(entry).toBeDefined();
    expect(terminalAreaEntry).toBeDefined();
    const source = entry?.[1] ?? "";
    const terminalAreaSource = terminalAreaEntry?.[1] ?? "";
    const mountRule = source.match(/\.terminalMount\s*{[\s\S]*?}/)?.[0] ?? "";
    const activeMountRule = source.match(/\.terminalMount\[data-active="true"\]\s*{[\s\S]*?}/)?.[0] ?? "";
    const terminalAreaRule = terminalAreaSource.match(/\.terminalArea\s*{[\s\S]*?}/)?.[0] ?? "";
    const viewportRule = terminalAreaSource.match(/\.terminalViewport\s*{[\s\S]*?}/)?.[0] ?? "";

    expect(mountRule).toContain("gap: var(--space-1)");
    expect(mountRule).toContain("padding: 0");
    expect(mountRule).not.toContain("padding: var(--space-2)");
    expect(activeMountRule).toContain("inset 0 0 0 1px");
    expect(terminalAreaRule).toContain("padding: 0");
    expect(viewportRule).toContain("padding: 4px");
  });

  it("keeps terminal water effects free of generated-looking screen glints", () => {
    const global = Object.entries(cssSources).find(([file]) => file.includes("styles/global.css"))?.[1] ?? "";
    const terminalArea =
      Object.entries(cssSources).find(([file]) => file.includes("features/terminal/TerminalArea.module.css"))?.[1] ??
      "";
    const paneTree =
      Object.entries(cssSources).find(([file]) =>
        file.includes("features/terminal/pane-tree/PaneTreeRenderer.module.css"),
      )?.[1] ?? "";

    expect(terminalArea).not.toContain("mix-blend-mode: screen");
    expect(paneTree).not.toContain("repeating-linear-gradient");
    expect(global).not.toContain("repeating-linear-gradient");
  });

  it("does not suppress focus rings on div role buttons", () => {
    const entry = Object.entries(cssSources).find(([file]) => file.includes("styles/global.css"));
    expect(entry).toBeDefined();
    const source = entry?.[1] ?? "";

    expect(source).toContain('div:focus-visible:not([role="button"])');
    expect(source).not.toContain("div:focus-visible,\nsection:focus-visible");
  });

  it("keeps expanded logs from becoming a dark slab inside the right rail", () => {
    const logs =
      Object.entries(cssSources).find(([file]) => file.includes("features/logs/LogsPanel.module.css"))?.[1] ?? "";
    const listRule = logs.match(/\.list\s*{[\s\S]*?}/)?.[0] ?? "";

    expect(listRule).toContain("rgba(3, 9, 16, 0.18)");
    expect(listRule).not.toContain("0.34");
    expect(listRule).not.toContain("0.42");
  });

  it("keeps log severity readable without badge-like colored slabs", () => {
    const logs =
      Object.entries(cssSources).find(([file]) => file.includes("features/logs/LogsPanel.module.css"))?.[1] ?? "";
    const rowRule = logs.match(/\.row\s*{[\s\S]*?}/)?.[0] ?? "";
    const levelRule = logs.match(/\.level\s*{[\s\S]*?}/)?.[0] ?? "";
    const severityRules = logs.match(/\.level(?:TRACE|DEBUG|INFO|WARN|ERROR)\s*{[\s\S]*?}/g)?.join("\n") ?? "";

    expect(rowRule).toContain("grid-template-columns: 50px 40px minmax(0, 1fr)");
    expect(rowRule).toContain("border-left: 1px solid transparent");
    expect(levelRule).not.toContain("border-radius");
    expect(severityRules).not.toContain("background:");
  });

  it("keeps sidebar sections flat inside the parent glass panel", () => {
    const entry = Object.entries(cssSources).find(([file]) => file.includes("shared/ui/CollapsibleSection.module.css"));
    expect(entry).toBeDefined();
    const source = entry?.[1] ?? "";
    const rootRule = source.match(/\.root\s*{[\s\S]*?}/)?.[0] ?? "";
    const hoverRule = source.match(/\.root:hover\s*{[\s\S]*?}/)?.[0] ?? "";

    expect(rootRule).toContain("background: transparent");
    expect(rootRule).toContain("box-shadow: none");
    expect(hoverRule).toContain("transform: none");
  });

  it("keeps empty states compact enough for workstation side panels", () => {
    const componentSources = import.meta.glob("../shared/ui/EmptyState.tsx", {
      query: "?raw",
      import: "default",
      eager: true,
    }) as Record<string, string>;
    const source = Object.values(componentSources)[0] ?? "";
    const cssSource =
      Object.entries(cssSources).find(([file]) => file.includes("shared/ui/EmptyState.module.css"))?.[1] ?? "";
    const rootRule = cssSource.match(/\.root\s*{[\s\S]*?}/)?.[0] ?? "";
    const iconRule = cssSource.match(/\.presetIcon\s*{[\s\S]*?}/)?.[0] ?? "";
    const titleRule = cssSource.match(/\.title\s*{[\s\S]*?}/)?.[0] ?? "";
    const compactRule = cssSource.match(/@container \(max-width: 320px\)\s*{[\s\S]*?}/)?.[0] ?? "";

    expect(source).toContain("EmptyState.module.css");
    expect(source).not.toContain('padding: "var(--space-16)"');
    expect(rootRule).toContain("padding: var(--space-8) var(--space-4)");
    expect(rootRule).toContain("container-type: inline-size");
    expect(iconRule).toContain("width: 34px");
    expect(titleRule).toContain("font-size: var(--type-empty-title)");
    expect(compactRule).toContain("padding: var(--space-5) var(--space-3)");
  });

  it("keeps browser previews from calling Tauri event listeners", () => {
    const sources = import.meta.glob("../**/*.{ts,tsx}", {
      query: "?raw",
      import: "default",
      eager: true,
    }) as Record<string, string>;

    const guardedFiles = [
      "../main.tsx",
      "../shared/hooks/useAgentManager.ts",
      "../shared/hooks/useInteractiveAgent.ts",
      "../shared/hooks/useGitStatus.ts",
      "../features/terminal/NativeTerminalArea.tsx",
    ];

    for (const file of guardedFiles) {
      expect(sources[file], file).toContain("isTauriRuntime");
    }
  });

  it("keeps header branch metadata quiet instead of decorative telemetry", () => {
    const sources = import.meta.glob("../features/header/ProjectHeaderBar.tsx", {
      query: "?raw",
      import: "default",
      eager: true,
    }) as Record<string, string>;
    const src = Object.values(sources)[0] ?? "";

    expect(src).not.toContain("⚡");
    expect(src).not.toContain("assets/logo");
    expect(src).not.toContain("className={styles.logo}");
    expect(src).toContain("<span className={styles.branch}>{branch}</span>");
    expect(src).not.toContain("className={styles.model}");
    expect(src).not.toContain("className={styles.cost}");
  });

  it("keeps terminal surfaces free of decorative center watermarks", () => {
    const sources = import.meta.glob("../features/terminal/NativeTerminalArea.tsx", {
      query: "?raw",
      import: "default",
      eager: true,
    }) as Record<string, string>;
    const cssSource =
      Object.entries(cssSources).find(([file]) => file.includes("features/terminal/TerminalArea.module.css"))?.[1] ??
      "";
    const src = Object.values(sources)[0] ?? "";

    expect(src).not.toContain("logo-watermark");
    expect(src).not.toContain("terminalWatermark");
    expect(cssSource).not.toContain(".terminalWatermark");
  });

  it("keeps terminal pane info bars lean and free of duplicated branch chrome", () => {
    const sources = import.meta.glob("../features/terminal/TerminalInfoBar.tsx", {
      query: "?raw",
      import: "default",
      eager: true,
    }) as Record<string, string>;
    const cssSource =
      Object.entries(cssSources).find(([file]) => file.includes("features/terminal/TerminalInfoBar.module.css"))?.[1] ??
      "";
    const src = Object.values(sources)[0] ?? "";
    const barRule = cssSource.match(/\.bar\s*{[\s\S]*?}/)?.[0] ?? "";
    const shellRule = cssSource.match(/\.shell\s*{[\s\S]*?}/)?.[0] ?? "";

    expect(src).not.toContain("GitBranch");
    expect(src).not.toContain("styles.branch");
    expect(cssSource).not.toContain(".branch");
    expect(barRule).toContain("min-height: 22px");
    expect(shellRule).toContain("background: transparent");
    expect(shellRule).toContain("box-shadow: none");
  });

  it("defines dark foreground aliases used on accent fills", () => {
    const entry = Object.entries(cssSources).find(([file]) => file.includes("styles/global.css"));
    expect(entry).toBeDefined();
    const source = entry?.[1] ?? "";

    expect(source).toContain("--ctp-base: var(--aelyris-ink)");
  });

  it("does not use negative tracking in UI chrome", () => {
    const offenders = Object.entries(cssSources)
      .map(([file, source]) => ({
        file,
        matches: source.match(/letter-spacing\s*:\s*-[^;]+|--tracking-[\w-]+\s*:\s*-[^;]+/g) ?? [],
      }))
      .filter((entry) => entry.matches.length > 0)
      .map((entry) => `${entry.file} (${entry.matches.length})`);

    expect(offenders).toEqual([]);
  });

  it("defines scoped density modes and role typography tokens", () => {
    const global = Object.entries(cssSources).find(([file]) => file.includes("styles/global.css"))?.[1] ?? "";
    const button = Object.entries(cssSources).find(([file]) => file.includes("shared/ui/Button.module.css"))?.[1] ?? "";
    const panelHeader =
      Object.entries(cssSources).find(([file]) => file.includes("shared/ui/PanelHeader.module.css"))?.[1] ?? "";
    const emptyState =
      Object.entries(cssSources).find(([file]) => file.includes("shared/ui/EmptyState.module.css"))?.[1] ?? "";
    const statusbar =
      Object.entries(cssSources).find(([file]) => file.includes("features/statusbar/StatusBar.module.css"))?.[1] ?? "";

    expect(global).toContain("--density-mode: balanced");
    expect(global).toContain("--density-rail-inset");
    expect(global).toContain("--density-panel-gap");
    expect(global).toContain("--density-scrollbar-gutter: stable");
    expect(global).toContain("--type-terminal-chrome");
    expect(global).toContain("--type-rail-section-title");
    expect(global).toContain("--type-card-title");
    expect(global).toContain("--type-metadata-label");
    expect(global).toContain("--type-mono-telemetry");
    expect(global).toContain("--type-empty-title");
    expect(global).toContain("--type-button-label");
    expect(global).toContain("--radius-card: var(--radius)");
    expect(global).toContain('.app-container[data-density="focus"]');
    expect(global).toContain('.app-container[data-density="balanced"]');
    expect(global).toContain('.app-container[data-density="dense"]');
    expect(global).toContain("gap: var(--density-panel-gap)");
    expect(global).toContain("padding: var(--density-panel-padding)");
    expect(global).toContain("padding: var(--density-rail-inset)");
    expect(global).toContain("gap: var(--density-widget-gap)");
    expect(global).toContain("border-radius: var(--radius-card)");
    expect(button).toContain("font-size: var(--type-button-label)");
    expect(panelHeader).toContain("font-size: var(--type-rail-section-title)");
    expect(panelHeader).toContain("font-size: var(--type-mono-telemetry)");
    expect(emptyState).toContain("font-size: var(--type-empty-title)");
    expect(statusbar).toContain("font-size: var(--type-terminal-chrome)");
  });

  it("keeps workspace tab chrome quiet and branch metadata compact", () => {
    const source =
      Object.entries(cssSources).find(([file]) =>
        file.includes("features/workspace-tabs/WorkspaceTabs.module.css"),
      )?.[1] ?? "";
    const tsxSources = import.meta.glob("../features/workspace-tabs/WorkspaceTabs.tsx", {
      query: "?raw",
      import: "default",
      eager: true,
    }) as Record<string, string>;
    const tsx = Object.values(tsxSources)[0] ?? "";
    const branchRule = source.match(/\.branchBadge\s*{[\s\S]*?}/)?.[0] ?? "";
    const tabWrapRule = source.match(/\.tabWrap\s*{[\s\S]*?}/)?.[0] ?? "";
    const activeRule = source.match(/\.tabWrap\[data-active\]::after\s*{[\s\S]*?}/)?.[0] ?? "";
    const activeBranchRule =
      source.match(/\.tabWrap:hover \.branchBadge,[\s\S]*?\.tabWrap:focus-within \.branchBadge\s*{[\s\S]*?}/)?.[0] ??
      "";

    expect(tabWrapRule).toContain("flex: 0 1 clamp(112px, 12vw, 190px)");
    expect(branchRule).toContain("display: inline-flex");
    expect(branchRule).toContain("width: 72px");
    expect(branchRule).toContain("transition: color");
    expect(branchRule).toContain("background: transparent");
    expect(branchRule).toContain("box-shadow: none");
    expect(branchRule).not.toContain("opacity:");
    expect(branchRule).not.toContain("border-radius: var(--radius-pill)");
    expect(activeBranchRule).not.toContain("max-width");
    expect(activeRule).not.toContain("linear-gradient");
    expect(source).not.toContain("animation: statusBreathe");
    expect(tsx).not.toContain("PixelAvatar");
    expect(source).not.toContain(".tabWrap[data-active] .tabClose");
  });

  it("keeps sidebar and footer chrome from turning into milky telemetry strips", () => {
    const fileTree =
      Object.entries(cssSources).find(([file]) => file.includes("features/file-tree/FileTree.module.css"))?.[1] ?? "";
    const statusbar =
      Object.entries(cssSources).find(([file]) => file.includes("features/statusbar/StatusBar.module.css"))?.[1] ?? "";
    const statusbarTsx =
      Object.values(
        import.meta.glob("../features/statusbar/StatusBar.tsx", {
          query: "?raw",
          import: "default",
          eager: true,
        }) as Record<string, string>,
      )[0] ?? "";
    const global = Object.entries(cssSources).find(([file]) => file.includes("styles/global.css"))?.[1] ?? "";
    const leftPanelRule = global.match(/\.left-panel\s*{[\s\S]*?}/)?.[0] ?? "";
    const rootHeader = fileTree.match(/\.rootHeader\s*{[\s\S]*?}/)?.[0] ?? "";
    const changedRules = fileTree.match(/\.fileChanged(?:\[data-status="[^"]+"\])?\s*{[\s\S]*?}/g)?.join("\n") ?? "";
    const statusRule = statusbar.match(/\.statusbar\s*{[\s\S]*?}/)?.[0] ?? "";
    const actionBtnRule = statusbar.match(/\.actionBtn\s*{[\s\S]*?}/)?.[0] ?? "";
    const repairBadgeRule = statusbar.match(/\.repairBadge\s*{[\s\S]*?}/)?.[0] ?? "";

    expect(leftPanelRule).toContain("border-radius: var(--radius)");
    // The text-dense sidebar now frosts via the stronger legibility filter (a
    // per-mood token: blur+saturate+brightness) instead of the plain chrome
    // blur, so file-tree rows stay readable over a busy/bright wallpaper. The
    // intent is unchanged — the panel still filters through a single mood token,
    // never a hardcoded blur or the card shadow.
    expect(leftPanelRule).toContain("var(--panel-legibility-filter)");
    expect(leftPanelRule).toContain("var(--panel-text-scrim)");
    expect(leftPanelRule).not.toContain("var(--material-panel-shadow)");
    expect(rootHeader).toContain("text-transform: none");
    expect(rootHeader).toContain("letter-spacing: 0");
    expect(changedRules).not.toContain("var(--status-edit)");
    expect(changedRules).not.toContain("var(--status-idle)");
    expect(changedRules).not.toContain("var(--ctp-red)");
    expect(statusRule).toContain("background: var(--statusbar-bg)");
    expect(statusRule).toContain("var(--statusbar-filter)");
    expect(statusRule).toContain("color: var(--text-secondary)");
    expect(statusbar).not.toContain(".separator");
    expect(statusbar).not.toContain(".shellBtn");
    expect(statusbar).not.toContain(".picker");
    expect(statusbar).not.toContain(".repairBtn");
    expect(actionBtnRule).toContain("width: 26px");
    expect(actionBtnRule).toContain("flex: 0 0 26px");
    expect(repairBadgeRule).toContain("position: absolute");
    expect(statusbarTsx).not.toContain("{shell}</span>");
  });

  it("keeps inspector prompt focus visible on glass surfaces", () => {
    const inspector =
      Object.entries(cssSources).find(([file]) =>
        file.includes("features/agent-inspector/AgentInspector.module.css"),
      )?.[1] ?? "";
    const modelFocus = inspector.match(/\.modelSelect:focus-visible\s*{[\s\S]*?}/)?.[0] ?? "";
    const promptFocus = inspector.match(/\.promptField:focus-visible\s*{[\s\S]*?}/)?.[0] ?? "";

    expect(modelFocus).toContain("outline: 2px solid var(--focus-ring)");
    expect(promptFocus).toContain("outline: 2px solid var(--focus-ring)");
    expect(`${modelFocus}\n${promptFocus}`).not.toContain("outline: none !important");
  });

  it("keeps toolkit and settings controls keyboard-visible on glass", () => {
    const toolkit =
      Object.entries(cssSources).find(([file]) => file.includes("features/toolkit/ToolkitPanel.module.css"))?.[1] ?? "";
    const settings =
      Object.entries(cssSources).find(([file]) => file.includes("features/settings/Settings.module.css"))?.[1] ?? "";
    const editInputFocus = toolkit.match(/\.editInput:focus-visible\s*{[\s\S]*?}/)?.[0] ?? "";
    const importFocus = toolkit.match(/\.importTextarea:focus-visible\s*{[\s\S]*?}/)?.[0] ?? "";
    const moodFocus = settings.match(/\.moodCard:focus-visible\s*{[\s\S]*?}/)?.[0] ?? "";

    expect(editInputFocus).toContain("outline: 2px solid var(--focus-ring)");
    expect(importFocus).toContain("outline: 2px solid var(--focus-ring)");
    expect(moodFocus).toContain("outline: 2px solid var(--focus-ring)");
    expect(`${editInputFocus}\n${importFocus}\n${moodFocus}`).not.toContain("outline: none !important");
  });

  it("keeps utility micro-panels in dark-water territory instead of prismatic frost", () => {
    const toolkit =
      Object.entries(cssSources).find(([file]) => file.includes("features/toolkit/ToolkitPanel.module.css"))?.[1] ?? "";
    const logs =
      Object.entries(cssSources).find(([file]) => file.includes("features/logs/LogsPanel.module.css"))?.[1] ?? "";
    const workflow =
      Object.entries(cssSources).find(([file]) => file.includes("features/workflow/WorkflowPanel.module.css"))?.[1] ??
      "";
    const collapsible =
      Object.entries(cssSources).find(([file]) => file.includes("shared/ui/CollapsibleSection.module.css"))?.[1] ?? "";

    expect(toolkit).toContain("var(--toolkit-grid-bg)");
    expect(toolkit).toContain("var(--toolkit-tile-bg)");
    expect(toolkit).toContain("var(--toolkit-icon-bg)");
    expect(toolkit).not.toContain("rgba(0, 6, 14, 0.3)");
    expect(logs).toContain("rgba(5, 16, 28, 0.34)");
    expect(logs).not.toContain("var(--white-3)");
    expect(logs).not.toContain("var(--white-6)");
    expect(workflow).toContain("rgba(4, 11, 18, 0.16)");
    expect(collapsible).not.toContain("rgba(255, 255, 255, 0.012)");
  });

  it("keeps the everyday workspace in a translucent native glass tone", () => {
    const global = Object.entries(cssSources).find(([file]) => file.includes("styles/global.css"))?.[1] ?? "";
    const tauriRootRule = global.match(/html\[data-aelyris-host="tauri"\] #root\s*{[\s\S]*?}/)?.[0] ?? "";
    const leftPanelBg = global.match(/--mood-left-panel-bg:\s*[\s\S]*?;/)?.[0] ?? "";
    const rightPanelBg = global.match(/--mood-right-panel-bg:\s*[\s\S]*?;/)?.[0] ?? "";
    const bentoCardRule = global.match(/\.bento-card\s*{[\s\S]*?}/)?.[0] ?? "";

    expect(tauriRootRule).toContain("background: transparent");
    expect(tauriRootRule).toContain("rgba(0, 8, 18, 0.035)");
    expect(tauriRootRule).not.toContain("rgba(0, 8, 18, 0.28)");
    expect(leftPanelBg).toContain("rgba(4, 13, 23, 0.4)");
    expect(rightPanelBg).toContain("rgba(4, 13, 23, 0.46)");
    expect(global).toContain("--row-hover: rgba(6, 18, 30, 0.24)");
    expect(bentoCardRule).toContain("rgba(0, 126, 190, 0.026)");
    expect(bentoCardRule).toContain("backdrop-filter: var(--material-panel-filter)");
  });

  it("keeps the settings dialog theme-aware instead of a solid black slab", () => {
    const settings =
      Object.entries(cssSources).find(([file]) => file.includes("features/settings/Settings.module.css"))?.[1] ?? "";
    const overlayRule = settings.match(/\.overlay\s*{[\s\S]*?}/)?.[0] ?? "";
    const panelRule = settings.match(/\.panel\s*{[\s\S]*?}/)?.[0] ?? "";

    expect(overlayRule).toContain("var(--scrim-standard-bg)");
    expect(overlayRule).toContain("var(--scrim-standard-blur)");
    expect(panelRule).toContain("var(--dialog-surface)");
    expect(panelRule).toContain("var(--dialog-surface-blur)");
    expect(panelRule).toContain("var(--shadow-dialog)");
    expect(panelRule).not.toContain("rgba(4, 13, 23, 0.76)");
  });

  it("keeps Sakura right-rail decision surfaces theme-aware", () => {
    const global = Object.entries(cssSources).find(([file]) => file.includes("styles/global.css"))?.[1] ?? "";
    const sakuraDecisionSurface =
      global.match(
        /:root\[data-mood="aelyris-sakura"\] \.right-panel-now,[\s\S]*?\.right-panel-action-history\s*{[\s\S]*?}/,
      )?.[0] ?? "";
    const sakuraDecisionWarn =
      global.match(
        /:root\[data-mood="aelyris-sakura"\] \.right-panel-now\[data-tone="warn"\],[\s\S]*?\.right-panel-action\[data-tone="warn"\]\s*{[\s\S]*?}/,
      )?.[0] ?? "";
    const sakuraDecisionChip =
      global.match(
        /:root\[data-mood="aelyris-sakura"\] \.right-panel-now-state,[\s\S]*?\.right-panel-action-guardrail\s*{[\s\S]*?}/,
      )?.[0] ?? "";

    expect(sakuraDecisionSurface).toContain(".right-panel-decision-focus");
    expect(sakuraDecisionSurface).toContain("rgba(255, 247, 251, 0.84)");
    expect(sakuraDecisionWarn).toContain('.right-panel-decision-focus[data-tone="warn"]');
    expect(sakuraDecisionChip).toContain(".right-panel-decision-kicker");
    expect(sakuraDecisionChip).toContain(".right-panel-decision-action");
    expect(global).toContain(':root[data-mood="aelyris-sakura"] .right-panel-decision-detail');
  });

  it("keeps shared chrome from drifting into prismatic AI styling", () => {
    const button = Object.entries(cssSources).find(([file]) => file.includes("shared/ui/Button.module.css"))?.[1] ?? "";
    const scrollArea =
      Object.entries(cssSources).find(([file]) => file.includes("shared/ui/ScrollArea.module.css"))?.[1] ?? "";

    expect(button).not.toContain("var(--gradient-prismatic)");
    expect(button).not.toContain("translateY(-2px)");
    expect(scrollArea).not.toContain("rgba(255, 255, 255, 0.25)");
    expect(scrollArea).toContain("rgba(124, 214, 235, 0.07)");
  });
});
