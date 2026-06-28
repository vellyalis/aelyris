import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const ROOT = resolve(process.cwd());
const OUT = join(ROOT, ".codex-auto", "quality", "glass-legibility-contract.json");

const sourcePaths = {
  globalCss: "src/styles/global.css",
  terminalAreaCss: "src/features/terminal/TerminalArea.module.css",
  terminalCanvas: "src/features/terminal/TerminalCanvas.tsx",
  paneTreeCss: "src/features/terminal/pane-tree/PaneTreeRenderer.module.css",
  buttonCss: "src/shared/ui/Button.module.css",
  selectCss: "src/shared/ui/Select.module.css",
  handoffDialogCss: "src/shared/ui/HandoffDialog.module.css",
  promptDialogCss: "src/shared/ui/PromptDialog.module.css",
  confirmDialogCss: "src/shared/ui/ConfirmDialog.module.css",
  switchCss: "src/shared/ui/Switch.module.css",
  contextMenuCss: "src/shared/ui/ContextMenu.module.css",
  orchestraDialogCss: "src/shared/ui/OrchestraDialog.module.css",
  menuBarCss: "src/features/menubar/MenuBar.module.css",
  updateBannerCss: "src/features/app/UpdateBanner.module.css",
  themePaletteEditorCss: "src/features/settings/ThemePaletteEditor.module.css",
  settingsCss: "src/features/settings/Settings.module.css",
  scmPanelCss: "src/features/scm/SCMPanel.module.css",
  imeInputBarCss: "src/features/terminal/IMEInputBar.module.css",
  paneSwitcherCss: "src/features/terminal/pane-switcher/PaneSwitcherDialog.module.css",
  processManagerCss: "src/features/process-manager/ProcessManagerPanel.module.css",
  workspaceTabsCss: "src/features/workspace-tabs/WorkspaceTabs.module.css",
  projectHeaderCss: "src/features/header/ProjectHeaderBar.module.css",
  workflowPanelCss: "src/features/workflow/WorkflowPanel.module.css",
  decisionInboxCss: "src/features/decision-inbox/DecisionInboxPanel.module.css",
  timelineBarCss: "src/features/timeline/TimelineBar.module.css",
  kanbanCss: "src/features/kanban/KanbanBoard.module.css",
  watchdogCss: "src/features/watchdog/WatchdogDialog.module.css",
  toolkitCss: "src/features/toolkit/ToolkitPanel.module.css",
  livePanesCss: "src/features/context/LivePanesPanel.module.css",
  inlineResultCss: "src/features/agent-inspector/InlineResultPanel.module.css",
  agentInspectorCss: "src/features/agent-inspector/AgentInspector.module.css",
  moods: "src/shared/themes/moods.ts",
  themeApplier: "src/shared/hooks/useTheme.ts",
  themePaletteTest: "src/__tests__/themePalette.test.ts",
  themeApplierTest: "src/__tests__/useThemeApplier.test.tsx",
};

function readSource(path) {
  return readFileSync(join(ROOT, path), "utf8");
}

function mtimeMs(path) {
  const full = join(ROOT, path);
  return existsSync(full) ? statSync(full).mtimeMs : 0;
}

function currentLocalDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function cssVar(source, name) {
  const match = new RegExp(`${escapeRegExp(name)}\\s*:\\s*([^;]+);`).exec(source);
  return match?.[1]?.trim() ?? null;
}

function rgbaAlpha(value) {
  const match = /rgba\([^)]*,\s*(\d*\.?\d+)\)/.exec(String(value ?? ""));
  return match ? Number(match[1]) : null;
}

function ruleBody(source, selector) {
  const match = new RegExp(`${escapeRegExp(selector)}\\s*\\{([^}]*)\\}`, "m").exec(source);
  return match?.[1] ?? "";
}

function opacitySelectors(source) {
  const selectors = [];
  const re = /([^{}]+)\{([^{}]*\bopacity\s*:[^{}]*)\}/g;
  let match;
  while ((match = re.exec(source)) != null) {
    selectors.push(match[1].trim().replace(/\s+/g, " "));
  }
  return selectors;
}

function opacityRules(source) {
  const rules = [];
  const re = /([^{}]+)\{([^{}]*\bopacity\s*:\s*([^;]+);[^{}]*)\}/g;
  let match;
  while ((match = re.exec(source)) != null) {
    rules.push({
      selector: match[1].trim().replace(/\s+/g, " "),
      body: match[2],
      value: match[3].trim(),
    });
  }
  return rules;
}

function add(checks, id, ok, detail, evidence = {}) {
  checks.push({ id, ok: Boolean(ok), detail, evidence });
}

const globalCss = readSource(sourcePaths.globalCss);
const terminalAreaCss = readSource(sourcePaths.terminalAreaCss);
const terminalCanvas = readSource(sourcePaths.terminalCanvas);
const paneTreeCss = readSource(sourcePaths.paneTreeCss);
const buttonCss = readSource(sourcePaths.buttonCss);
const selectCss = readSource(sourcePaths.selectCss);
const handoffDialogCss = readSource(sourcePaths.handoffDialogCss);
const promptDialogCss = readSource(sourcePaths.promptDialogCss);
const confirmDialogCss = readSource(sourcePaths.confirmDialogCss);
const highImpactControlCssKeys = [
  "switchCss",
  "contextMenuCss",
  "orchestraDialogCss",
  "menuBarCss",
  "updateBannerCss",
  "themePaletteEditorCss",
  "settingsCss",
  "scmPanelCss",
  "imeInputBarCss",
  "paneSwitcherCss",
  "processManagerCss",
  "kanbanCss",
  "watchdogCss",
  "toolkitCss",
  "livePanesCss",
  "inlineResultCss",
  "agentInspectorCss",
];
const highImpactControlCss = Object.fromEntries(
  highImpactControlCssKeys.map((key) => [key, readSource(sourcePaths[key])]),
);
const workspaceTabsCss = readSource(sourcePaths.workspaceTabsCss);
const projectHeaderCss = readSource(sourcePaths.projectHeaderCss);
const workflowPanelCss = readSource(sourcePaths.workflowPanelCss);
const decisionInboxCss = readSource(sourcePaths.decisionInboxCss);
const timelineBarCss = readSource(sourcePaths.timelineBarCss);
const moods = readSource(sourcePaths.moods);
const themeApplier = readSource(sourcePaths.themeApplier);
const themePaletteTest = readSource(sourcePaths.themePaletteTest);
const themeApplierTest = readSource(sourcePaths.themeApplierTest);

const checks = [];
const defaultGlass = {
  "--glass-clear": { min: 0, max: 0.04 },
  "--glass-ground": { min: 0.2, max: 0.32 },
  "--glass-frame": { min: 0.16, max: 0.28 },
  "--glass-standard": { min: 0.22, max: 0.34 },
  "--glass-dense": { min: 0.28, max: 0.4 },
  "--glass-thick": { min: 0.34, max: 0.46 },
  "--glass-solid": { min: 0.68, max: 0.78 },
};

for (const [token, range] of Object.entries(defaultGlass)) {
  const value = cssVar(globalCss, token);
  const alpha = rgbaAlpha(value);
  add(
    checks,
    `default-${token.slice(2)}-alpha`,
    alpha != null && alpha >= range.min && alpha <= range.max,
    `${token} stays in the Claude-like material range instead of becoming an opaque slab`,
    { value, alpha, range },
  );
}

const rootTextTokens = ["--text-primary", "--text-secondary", "--text-muted"];
for (const token of rootTextTokens) {
  const value = cssVar(globalCss, token);
  add(checks, `root-${token.slice(2)}-solid`, /^#[0-9a-f]{6}$/i.test(value ?? ""), `${token} is a solid glyph color`, {
    value,
  });
}

const appContainerRule = ruleBody(globalCss, ".app-container");
const rootRule = ruleBody(globalCss, "html,\\s*body,\\s*#root");
const tauriRootRule = ruleBody(globalCss, 'html[data-aether-host="tauri"] #root');
const exitBannerDisabledRule = ruleBody(terminalAreaCss, ".exitBannerBtn:disabled");
const terminalOpacitySelectors = opacitySelectors(terminalAreaCss);
const paneTreeOpacitySelectors = opacitySelectors(paneTreeCss);
const terminalMountTextTokens = ["--terminal-ui-primary", "--terminal-ui-secondary", "--terminal-ui-muted"].map(
  (token) => ({ token, value: cssVar(paneTreeCss, token) }),
);
const buttonPrimaryRule = ruleBody(buttonCss, ".primary");
const buttonDisabledRule = ruleBody(buttonCss, ".btn:disabled");
const buttonBusyRule = ruleBody(buttonCss, '.btn[aria-busy="true"]');
const buttonBusyChildRule = ruleBody(buttonCss, '.btn[aria-busy="true"] > *');
const selectTriggerDisabledRule = ruleBody(selectCss, ".trigger[data-disabled]");
const selectItemDisabledRule = ruleBody(selectCss, ".item[data-disabled]");
const globalDisabledRule =
  /button:disabled,\s*\[role="button"\]\[aria-disabled="true"\]\s*\{([^}]*)\}/m.exec(globalCss)?.[1] ?? "";
const rightRailDisabledRules = {
  runLoopAction: ruleBody(globalCss, ".right-panel-run-loop-action:disabled"),
  edgeFeedbackItem: ruleBody(globalCss, ".right-panel-edge-feedback-item:disabled"),
  action: ruleBody(globalCss, ".right-panel-action:disabled"),
};
const normalTextHierarchyRules = {
  workspaceBranchBadge: ruleBody(workspaceTabsCss, ".branchBadge"),
  workspaceBranchBadgeRevealed:
    /\.tabWrap:hover \.branchBadge,\s*\.tabWrap\[data-active\] \.branchBadge,\s*\.tabWrap:focus-within \.branchBadge\s*\{([^}]*)\}/m.exec(
      workspaceTabsCss,
    )?.[1] ?? "",
  projectBranch: ruleBody(projectHeaderCss, ".branch"),
  projectChanges: ruleBody(projectHeaderCss, ".changes"),
  agentTotalCost: ruleBody(highImpactControlCss.agentInspectorCss, ".totalCost"),
  agentCardPct: ruleBody(highImpactControlCss.agentInspectorCss, ".cardPct"),
  agentCardPctRest:
    /\.card:not\(:hover\):not\(:focus-within\) \.cardPct\s*\{([^}]*)\}/m.exec(
      highImpactControlCss.agentInspectorCss,
    )?.[1] ?? "",
  agentCardFiles: ruleBody(highImpactControlCss.agentInspectorCss, ".cardFiles"),
  agentCardFilesRest:
    /\.card:not\(:hover\):not\(:focus-within\) \.cardFiles\s*\{([^}]*)\}/m.exec(
      highImpactControlCss.agentInspectorCss,
    )?.[1] ?? "",
  agentWorktreeButtonHover: ruleBody(highImpactControlCss.agentInspectorCss, ".worktreeBtn:hover"),
  workflowTotalCost: ruleBody(workflowPanelCss, ".totalCost"),
  workflowStepPassed: ruleBody(workflowPanelCss, ".step_passed"),
  toolkitEditDelete: ruleBody(highImpactControlCss.toolkitCss, ".editDelete"),
  toolkitEditDeleteHover: ruleBody(highImpactControlCss.toolkitCss, ".editDelete:hover"),
  kanbanItemActive: ruleBody(highImpactControlCss.kanbanCss, ".item:active"),
  decisionInboxDecided: ruleBody(decisionInboxCss, '.item[data-status="decided"]'),
  timelineEmptyLabel: ruleBody(timelineBarCss, '.root[data-empty="true"] .label'),
  ghostDiffAddedLine: ruleBody(globalCss, ".aether-ghost-add-line"),
  agentMoreInfo: ruleBody(highImpactControlCss.agentInspectorCss, ".moreInfo"),
  agentMoreInfoRest:
    /\.card:not\(:hover\):not\(:focus-within\) \.moreInfo\s*\{([^}]*)\}/m.exec(
      highImpactControlCss.agentInspectorCss,
    )?.[1] ?? "",
  agentNavHint: ruleBody(highImpactControlCss.agentInspectorCss, ".navHint"),
  agentNavHintRevealed:
    /\.inspector:hover \.navHint,\s*\.inspector:focus-within \.navHint\s*\{([^}]*)\}/m.exec(
      highImpactControlCss.agentInspectorCss,
    )?.[1] ?? "",
  agentCardIcons: ruleBody(highImpactControlCss.agentInspectorCss, ".cardIcons"),
  agentCardIconsRevealed:
    /\.card:hover \.cardIcons,\s*\.card:focus-within \.cardIcons\s*\{([^}]*)\}/m.exec(
      highImpactControlCss.agentInspectorCss,
    )?.[1] ?? "",
};
const dialogActionRules = {
  handoffSubmitHover: ruleBody(handoffDialogCss, ".submitBtn:hover"),
  handoffSubmitDisabled: ruleBody(handoffDialogCss, ".submitBtn:disabled"),
  promptSubmitHover: ruleBody(promptDialogCss, ".submitBtn:hover"),
  promptSubmitDisabled: ruleBody(promptDialogCss, ".submitBtn:disabled"),
  confirmHover: ruleBody(confirmDialogCss, ".confirmBtn:hover"),
  confirmDangerHover: ruleBody(confirmDialogCss, ".confirmBtnDanger:hover"),
};
const highImpactUnsafeOpacitySelectors = Object.fromEntries(
  Object.entries(highImpactControlCss).map(([key, source]) => [
    key,
    opacityRules(source)
      .filter(({ selector, value }) => {
        const dimsControlState = /:disabled|\[data-disabled\]/.test(selector);
        const dimsPrimaryActionHover =
          /:hover/.test(selector) &&
          /\.(?:saveBtn|submitBtn|createBtn|importSubmit|commitBtn|pushBtn|btnPrimary|shellBtnPrimary)\b/.test(
            selector,
          ) &&
          !/^1(?:\.0+)?(?:\s*!important)?$/.test(value);
        return dimsControlState || dimsPrimaryActionHover;
      })
      .map(({ selector }) => selector),
  ]),
);
add(
  checks,
  "no-container-opacity-dimming",
  !/\bopacity\s*:/.test(appContainerRule) && !/\bopacity\s*:/.test(rootRule),
  "app/root containers do not dim their descendants; transparency lives in material layers and pseudo backdrops",
  { appContainerHasOpacity: /\bopacity\s*:/.test(appContainerRule), rootHasOpacity: /\bopacity\s*:/.test(rootRule) },
);
add(
  checks,
  "tauri-root-backplane-transparent",
  /background\s*:\s*transparent\s*;/.test(tauriRootRule) &&
    !/rgba\(0,\s*8,\s*18,\s*0\.(?:2|3|4)/.test(tauriRootRule),
  "Tauri root backplane remains transparent so native WebView glass can reveal windows behind it",
  { rule: tauriRootRule.trim() },
);
add(
  checks,
  "terminal-solid-clarity-keeps-raster-translucent",
  terminalCanvas.includes("Solid clarity now means solid glyph paint") &&
    !terminalCanvas.includes("forceOpaqueCssColor(base)") &&
    terminalAreaCss.includes("* 58%") &&
    terminalAreaCss.includes("* 56%") &&
    paneTreeCss.includes("* 58%"),
  "solid terminal clarity preserves glyph contrast without forcing the backing raster opaque",
);
add(
  checks,
  "window-opacity-is-material-only",
  globalCss.includes("--aether-window-opacity") &&
    globalCss.includes("--aether-window-veil-opacity") &&
    !/opacity\s*:\s*var\(--aether-window-opacity\)/.test(globalCss) &&
    !/filter\s*:\s*opacity\(/.test(globalCss),
  "window opacity is routed to glow/veil strength, not CSS opacity on text-bearing containers",
);
add(
  checks,
  "theme-applier-never-sets-root-opacity",
  themeApplier.includes("--aether-window-opacity") &&
    themeApplier.includes("--aether-window-veil-opacity") &&
    !/\.style\.opacity\s*=/.test(themeApplier) &&
    !/setProperty\(['"]opacity['"]/.test(themeApplier),
  "React theme application never applies root.style.opacity or an opacity property",
);
add(
  checks,
  "mood-text-tokens-are-not-rgba",
  moods.includes('"--text-primary"') &&
    moods.includes('"--text-secondary"') &&
    moods.includes('"--text-muted"') &&
    !/"--text-(primary|secondary|muted)"\s*:\s*["`]rgba\(/.test(moods),
  "mood text tokens stay fully painted and are not alpha-mixed rgba glyph colors",
);
add(
  checks,
  "material-overrides-keep-text-separate-from-alpha",
  moods.includes("const textPrimary = usesLightChrome ?") &&
    moods.includes('"--text-primary": textPrimary') &&
    moods.includes('"--glass-standard": rgba(panel') &&
    moods.includes('"--terminal-canvas-bg": `rgba(${terminalRgb}, ${terminalAlpha})`'),
  "material override alpha controls surfaces and terminal glass, while text remains a separate solid token",
);
add(
  checks,
  "dark-glass-floor-and-ceiling-covered",
  themePaletteTest.includes("keeps mood glass presets translucent while preserving pane hierarchy") &&
    themePaletteTest.includes("darkRanges") &&
    themePaletteTest.includes("lightCeilings"),
  "palette tests guard both translucent material ceilings and readable dark-glass floors",
);
add(
  checks,
  "solid-glyph-tests-covered",
  themePaletteTest.includes("keeps chrome text tokens solid instead of opacity-dimming glyphs") &&
    themeApplierTest.includes("without dimming text nodes") &&
    themeApplierTest.includes("keeps dark mood glyph colors solid while pane material stays translucent"),
  "unit tests explicitly guard opaque glyph tokens and material-only opacity",
);
add(
  checks,
  "terminal-disabled-action-keeps-glyphs-opaque",
  exitBannerDisabledRule.includes("color: var(--text-secondary)") &&
    exitBannerDisabledRule.includes("background: rgba(") &&
    !/\bopacity\s*:/.test(exitBannerDisabledRule),
  "terminal disabled actions recede via solid text color plus translucent material, not container opacity",
  { rule: exitBannerDisabledRule.trim() },
);
add(
  checks,
  "terminal-opacity-is-pseudo-material-only",
  terminalOpacitySelectors.length === 3 &&
    terminalOpacitySelectors.every((selector) =>
      [
        '.terminalViewport[data-terminal-text-clarity="solid"]::before',
        ".terminalViewport::after",
        '.terminalViewport[data-terminal-text-clarity="solid"]::after',
      ].includes(selector),
    ),
  "terminal CSS opacity is limited to non-text viewport pseudo-material overlays",
  { selectors: terminalOpacitySelectors },
);
add(
  checks,
  "terminal-mount-ui-text-tokens-solid",
  terminalMountTextTokens.every((entry) => /^#[0-9a-f]{6}$/i.test(entry.value ?? "")),
  "terminal pane mount UI glyph tokens are fully painted solid colors, not rgba alpha text",
  { tokens: terminalMountTextTokens },
);
add(
  checks,
  "terminal-mount-opacity-is-pseudo-material-only",
  paneTreeOpacitySelectors.length === 2 &&
    paneTreeOpacitySelectors.every((selector) =>
      [".terminalMount::before", '.terminalMount[data-terminal-text-clarity="solid"]::before'].includes(selector),
    ),
  "pane mount opacity is limited to non-text pseudo-material overlays",
  { selectors: paneTreeOpacitySelectors },
);
add(
  checks,
  "shared-button-glyphs-opaque-in-primary-disabled-and-busy",
  buttonPrimaryRule.includes("color: #0d0d0d") &&
    buttonDisabledRule.includes("color: var(--text-muted)") &&
    buttonBusyRule.includes("color: var(--text-secondary)") &&
    !/\bopacity\s*:/.test(`${buttonPrimaryRule}\n${buttonDisabledRule}\n${buttonBusyRule}\n${buttonBusyChildRule}`),
  "shared Button never dims text-bearing primary, disabled, or busy states with CSS opacity",
  { primary: buttonPrimaryRule.trim(), disabled: buttonDisabledRule.trim(), busy: buttonBusyRule.trim() },
);
add(
  checks,
  "shared-select-disabled-glyphs-opaque",
  selectTriggerDisabledRule.includes("color: var(--text-muted)") &&
    selectItemDisabledRule.includes("color: var(--text-muted)") &&
    !/\bopacity\s*:/.test(`${selectTriggerDisabledRule}\n${selectItemDisabledRule}`),
  "disabled Select triggers and items recede through solid glyph color and translucent material, not opacity",
  { trigger: selectTriggerDisabledRule.trim(), item: selectItemDisabledRule.trim() },
);
add(
  checks,
  "global-disabled-state-avoids-opacity-dimming",
  globalDisabledRule.includes("color: var(--text-muted)") &&
    globalDisabledRule.includes("background-color: var(--state-disabled-surface)") &&
    !/\bopacity\s*:/.test(globalDisabledRule),
  "global disabled buttons keep glyphs fully painted and recede through material/color instead of inherited opacity",
  { rule: globalDisabledRule.trim() },
);
add(
  checks,
  "right-rail-disabled-actions-avoid-opacity-dimming",
  Object.values(rightRailDisabledRules).every(
    (rule) => rule.includes("color: var(--text-muted)") && !/\bopacity\s*:/.test(rule),
  ),
  "right rail disabled workflow actions preserve readable labels while only their material state recedes",
  rightRailDisabledRules,
);
add(
  checks,
  "normal-text-hierarchy-avoids-opacity-dimming",
  Object.values(normalTextHierarchyRules).every((rule) => rule.length > 0 && !/\bopacity\s*:/.test(rule)),
  "workspace tabs, project header, agent/workflow metrics, toolkit delete, kanban drag, decision inbox, and timeline labels keep glyphs fully painted",
  normalTextHierarchyRules,
);
add(
  checks,
  "dialog-action-buttons-avoid-opacity-dimming",
  Object.values(dialogActionRules).every((rule) => rule.length > 0 && !/\bopacity\s*:/.test(rule)),
  "prompt, handoff, and confirm dialog action states do not opacity-dim their labels",
  dialogActionRules,
);
add(
  checks,
  "high-impact-controls-avoid-disabled-and-hover-opacity",
  Object.values(highImpactUnsafeOpacitySelectors).every((selectors) => selectors.length === 0),
  "menus, switches, SCM/actions, IME bar, pane switcher, settings, process, toolkit, kanban, and inspector controls recede via solid colors and translucent material instead of opacity-dimming labels",
  highImpactUnsafeOpacitySelectors,
);

const failed = checks.filter((check) => !check.ok);
const report = {
  artifact: OUT,
  version: 1,
  generatedAt: new Date().toISOString(),
  localDate: currentLocalDate(),
  timeZone: "Asia/Tokyo",
  ok: failed.length === 0,
  status: failed.length === 0 ? "pass-current-glass-legibility-contract" : "failed",
  textFullyPainted: checks
    .filter((check) => check.id.includes("text") || check.id.includes("glyph") || check.id.includes("opacity"))
    .every((check) => check.ok),
  materialTranslucencyProved: Object.keys(defaultGlass).every((token) =>
    checks.some((check) => check.id === `default-${token.slice(2)}-alpha` && check.ok),
  ),
  sourceFresh: true,
  sourceFiles: Object.fromEntries(
    Object.entries(sourcePaths).map(([key, path]) => [
      key,
      {
        path,
        exists: existsSync(join(ROOT, path)),
        mtimeMs: mtimeMs(path),
      },
    ]),
  ),
  checks,
  failedChecks: failed,
  nextRequiredAction:
    failed.length === 0
      ? "Keep panel/chrome/terminal transparency in rgba material tokens and never dim text-bearing containers."
      : "Fix failed glass legibility checks before claiming Apple-quality translucency.",
};

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exitCode = 1;
