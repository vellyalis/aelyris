import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const ROOT = resolve(process.cwd());
const OUT = join(ROOT, ".codex-auto", "quality", "right-rail-information-density-contract.json");
const LOCAL_TIME_ZONE = "Asia/Tokyo";

const sourcePaths = {
  app: "src/App.tsx",
  styles: "src/styles/global.css",
  packageJson: "package.json",
  suite: "scripts/verify-right-rail-suite.mjs",
  score: "scripts/score-release-quality.mjs",
  appSilentBugs: "src/__tests__/AppSilentBugs.test.ts",
};

function read(path) {
  return readFileSync(join(ROOT, path), "utf8");
}

function mtimeMs(path) {
  const full = join(ROOT, path);
  return existsSync(full) ? statSync(full).mtimeMs : 0;
}

function currentLocalDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: LOCAL_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function countOccurrences(source, needle) {
  return source.split(needle).length - 1;
}

function ruleBody(source, selector) {
  const match = new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`, "m").exec(source);
  return match?.[1] ?? "";
}

function drawerCollapsedByDefault(source, className) {
  const pattern = new RegExp(`<details\\s+className="${className}"\\s*>`);
  const openPattern = new RegExp(`<details\\s+[^>]*className="${className}"[^>]*\\sopen[\\s>]`);
  return pattern.test(source) && !openPattern.test(source);
}

function add(checks, id, ok, detail, evidence = {}) {
  checks.push({ id, ok: Boolean(ok), detail, evidence });
}

const app = read(sourcePaths.app);
const styles = read(sourcePaths.styles);
const packageJson = read(sourcePaths.packageJson);
const suite = read(sourcePaths.suite);
const score = read(sourcePaths.score);
const appSilentBugs = read(sourcePaths.appSilentBugs);

const checks = [];
const rightRailStart = app.indexOf('<div className="right-panel-content">');
const advancedDrawer = app.indexOf('className="right-panel-advanced-drawer"', rightRailStart);
const runLoop = app.indexOf('className="right-panel-run-loop"', rightRailStart);
const decisionFocusGate = app.indexOf("rightRailHasBlockingDecision && (", rightRailStart);
const decisionFocus = app.indexOf('className="right-panel-decision-focus"', rightRailStart);
const nowCard = app.indexOf('className="right-panel-now"', rightRailStart);
const essentialGrid = app.indexOf('className="right-panel-essential-grid"', rightRailStart);
const evidenceDrawer = app.indexOf('className="right-panel-evidence-drawer"', rightRailStart);
const healthDrawer = app.indexOf('className="right-panel-health-drawer"', rightRailStart);
const queueDrawer = app.indexOf('className="right-panel-queue-drawer"', rightRailStart);
const goalTrack = app.indexOf('className="right-panel-goal-track"', rightRailStart);
const edgeScore = app.indexOf('className="right-panel-edge-score"', rightRailStart);
const workforce = app.indexOf('className="right-panel-workforce"', rightRailStart);
const advisor = app.indexOf('className="right-panel-advisor"', rightRailStart);
const decisionFocusIsConditional =
  decisionFocusGate > runLoop && decisionFocus > decisionFocusGate && decisionFocus < essentialGrid;
const visiblePrimaryCount =
  [runLoop, essentialGrid].filter((index) => index > rightRailStart).length +
  (decisionFocus > rightRailStart && !decisionFocusIsConditional ? 1 : 0);
const conditionalPrimaryMax = visiblePrimaryCount + (decisionFocusIsConditional ? 1 : 0);
const defaultDrawers = [
  "right-panel-advanced-drawer",
  "right-panel-evidence-drawer",
  "right-panel-health-drawer",
  "right-panel-queue-drawer",
];
const collapsedDrawerCount = defaultDrawers.filter((className) => drawerCollapsedByDefault(app, className)).length;
const essentialCardCount = countOccurrences(app.slice(essentialGrid, evidenceDrawer > essentialGrid ? evidenceDrawer : app.length), 'className="right-panel-essential-card"');
const drawerSummaryCount = defaultDrawers.filter((className) => styles.includes(`.${className} > summary`)).length;
const essentialGridRule = ruleBody(styles, ".right-panel-essential-grid");
const essentialCardRule = ruleBody(styles, ".right-panel-essential-card");

add(
  checks,
  "command-center-purpose",
  app.includes(">Command Center</span>") && !app.includes(">Inspector</span>") && !app.includes("Mission Control"),
  "default right rail names the task surface as Command Center without legacy Inspector/Mission Control copy",
);
add(
  checks,
  "essential-cards-first",
  rightRailStart >= 0 &&
    advancedDrawer > rightRailStart &&
    runLoop > advancedDrawer &&
    decisionFocusIsConditional &&
    essentialGrid > runLoop &&
    evidenceDrawer > essentialGrid &&
    healthDrawer > evidenceDrawer &&
    queueDrawer > healthDrawer,
  "default command center keeps the actionable spine before deferred evidence, health, and queue details",
  {
    rightRailStart,
    advancedDrawer,
    runLoop,
    decisionFocusGate,
    decisionFocus,
    essentialGrid,
    evidenceDrawer,
    healthDrawer,
    queueDrawer,
  },
);
add(
  checks,
  "decision-focus-exception-only",
  decisionFocusIsConditional &&
    app.includes("const rightRailHasBlockingDecision = decisionInbox.pendingCount > 0") &&
    app.includes('data-has-decision={rightRailHasBlockingDecision ? "true" : "false"}'),
  "Decision focus is an urgent exception surface shown only when a human gate is blocking progress",
  { decisionFocusGate, decisionFocus, essentialGrid },
);
add(
  checks,
  "git-vscode-health-essentials",
  essentialCardCount === 3 &&
    app.includes("Git status:") &&
    app.includes("VS Code target:") &&
    app.includes("Health snapshot:") &&
    app.includes('setRightRailFocusWidget("scm")') &&
    app.includes("openGitDiffInVSCode(projectPath, rightRailPrimaryChangedFile.path)") &&
    app.includes("openInVSCode(rightRailVsCodeTargetPath)"),
  "default essentials are limited to Git, VS Code, and Health",
  { essentialCardCount },
);
add(
  checks,
  "deferred-drawers-collapsed",
  collapsedDrawerCount === defaultDrawers.length,
  "Mode target, Evidence, Health, and Queue are native details drawers collapsed by default",
  { collapsedDrawerCount, required: defaultDrawers.length, defaultDrawers },
);
add(
  checks,
  "evidence-stays-deferred",
  evidenceDrawer > essentialGrid && goalTrack > evidenceDrawer && edgeScore > evidenceDrawer,
  "final-goal proof and edge-score evidence stay behind the Evidence drawer instead of crowding the first view",
  { evidenceDrawer, goalTrack, edgeScore },
);
add(
  checks,
  "operational-health-stays-deferred",
  healthDrawer > evidenceDrawer && nowCard > healthDrawer && workforce > nowCard,
  "workspace state, workforce, score-loop, and workstation pulse details stay behind the Health drawer",
  { healthDrawer, nowCard, workforce },
);
add(
  checks,
  "queue-stays-deferred",
  queueDrawer > healthDrawer && advisor > queueDrawer,
  "advisor recommendation and ranked action queue stay behind the Queue drawer",
  { queueDrawer, advisor },
);
add(
  checks,
  "visible-primary-budget",
  visiblePrimaryCount <= 2 && conditionalPrimaryMax <= 3,
  "default surface keeps the visible command-center spine to two primary surfaces, or three only when a human decision blocks progress",
  { visiblePrimaryCount, conditionalPrimaryMax, defaultBudget: 2, blockingDecisionBudget: 3 },
);
add(
  checks,
  "drawer-summary-affordance",
  drawerSummaryCount === defaultDrawers.length &&
    styles.includes(".right-panel-essential-grid") &&
    styles.includes(".right-panel-essential-card") &&
    /grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/.test(essentialGridRule) &&
    essentialCardRule.includes("background:") &&
    essentialCardRule.includes("var(--rail-control-bg)") &&
    essentialCardRule.includes("color-mix"),
  "deferred drawers and essential cards have stable glass affordances without adding more first-view text",
  { drawerSummaryCount },
);
add(
  checks,
  "opaque-text-covered-elsewhere",
  packageJson.includes('"verify:ui:glass-legibility"') &&
    score.includes("glassLegibilityContractFresh") &&
    !/\.right-panel-essential-card[^{]*\{[^}]*opacity\s*:/m.test(styles),
  "this density gate delegates glyph opacity to the glass legibility contract and does not dim essential-card text",
);
add(
  checks,
  "release-chain-wired",
  packageJson.includes('"verify:right-rail-density"') &&
    suite.includes("information-density") &&
    score.includes("rightRailInformationDensityPass") &&
    appSilentBugs.includes("rightRailInformationDensityPass"),
  "information density is wired into package scripts, the right-rail suite, release score, and source tests",
);

const failedChecks = checks.filter((check) => !check.ok);
const generatedAt = new Date().toISOString();
const sourceMtims = Object.fromEntries(Object.entries(sourcePaths).map(([key, path]) => [key, mtimeMs(path)]));
const report = {
  version: 1,
  generatedAt,
  localDate: currentLocalDate(),
  timeZone: LOCAL_TIME_ZONE,
  ok: failedChecks.length === 0,
  status:
    failedChecks.length === 0
      ? "pass-current-right-rail-information-density-contract"
      : "failed-right-rail-information-density-contract",
  essentialFirst: essentialGrid > runLoop && evidenceDrawer > essentialGrid,
  defaultDrawerCount: collapsedDrawerCount,
  visiblePrimaryCount,
  conditionalPrimaryMax,
  sourceMtims,
  checks,
  failedChecks,
};

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`);

if (!report.ok) {
  console.error(`right rail information density contract failed: ${OUT}`);
  process.exit(1);
}

console.log(`right rail information density contract passed: ${OUT}`);
