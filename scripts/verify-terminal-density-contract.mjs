import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import process from "node:process";

const ROOT = resolve(process.cwd());
const OUT = join(ROOT, ".codex-auto", "quality", "terminal-density-contract.json");
const ENFORCE = process.argv.includes("--enforce");
const MODES = ["focus", "balanced", "dense"];

const PATHS = {
  packageJson: "package.json",
  globalCss: "src/styles/global.css",
  nativeTerminalArea: "src/features/terminal/NativeTerminalArea.tsx",
  terminalAreaCss: "src/features/terminal/TerminalArea.module.css",
  imeInputBarCss: "src/features/terminal/IMEInputBar.module.css",
  terminalInfoBarCss: "src/features/terminal/TerminalInfoBar.module.css",
  timelineBarCss: "src/features/timeline/TimelineBar.module.css",
  paneTreeCss: "src/features/terminal/pane-tree/PaneTreeRenderer.module.css",
};

function source(path) {
  const full = join(ROOT, path);
  return existsSync(full) ? readFileSync(full, "utf8") : "";
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

function findCssBlock(css, selector) {
  const cssWithoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const index = cssWithoutComments.indexOf(selector);
  if (index < 0) return "";
  const open = cssWithoutComments.indexOf("{", index);
  if (open < 0) return "";
  let depth = 0;
  for (let i = open; i < cssWithoutComments.length; i += 1) {
    const char = cssWithoutComments[i];
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return cssWithoutComments.slice(open + 1, i);
    }
  }
  return "";
}

function declaration(block, property) {
  const matches = [...block.matchAll(new RegExp(`(^|[;\\n])\\s*${property}\\s*:\\s*([^;]+);`, "g"))];
  return matches.length ? matches[matches.length - 1][2].trim() : null;
}

function customProperties(block) {
  const vars = {};
  for (const match of block.matchAll(/(--[a-zA-Z0-9-_]+)\s*:\s*([^;]+);/g)) {
    vars[match[1]] = match[2].trim();
  }
  return vars;
}

function resolvePx(value, vars, seen = new Set()) {
  if (!value) return null;
  const trimmed = value.trim();
  if (trimmed === "0") return 0;
  const px = trimmed.match(/^(-?\d+(?:\.\d+)?)px$/);
  if (px) return Number(px[1]);
  const numeric = trimmed.match(/^(-?\d+(?:\.\d+)?)$/);
  if (numeric) return Number(numeric[1]);
  const varRef = trimmed.match(/^var\((--[a-zA-Z0-9-_]+)(?:,[^)]+)?\)$/);
  if (varRef) {
    const name = varRef[1];
    if (seen.has(name)) return null;
    seen.add(name);
    return resolvePx(vars[name], vars, seen);
  }
  return null;
}

function valueForMode(value, mode, modeVars) {
  return resolvePx(value, modeVars[mode]);
}

function check(id, passed, detail, evidence = {}) {
  return { id, status: passed ? "passed" : "failed", detail, evidence };
}

const packageJson = source(PATHS.packageJson);
const globalCss = source(PATHS.globalCss);
const nativeTerminalArea = source(PATHS.nativeTerminalArea);
const terminalAreaCss = source(PATHS.terminalAreaCss);
const imeInputBarCss = source(PATHS.imeInputBarCss);
const terminalInfoBarCss = source(PATHS.terminalInfoBarCss);
const timelineBarCss = source(PATHS.timelineBarCss);
const paneTreeCss = source(PATHS.paneTreeCss);

const rootVars = {
  ...customProperties(findCssBlock(globalCss, ":root")),
};

const modeVars = Object.fromEntries(
  MODES.map((mode) => [
    mode,
    {
      ...rootVars,
      ...customProperties(findCssBlock(globalCss, `.app-container[data-density="${mode}"]`)),
    },
  ]),
);

const blocks = {
  terminalArea: findCssBlock(terminalAreaCss, ".terminalArea"),
  terminalViewport: findCssBlock(terminalAreaCss, ".terminalViewport"),
  imeBar: findCssBlock(imeInputBarCss, ".bar"),
  imeBarCollapsed: findCssBlock(imeInputBarCss, '.bar[data-collapsed="true"]'),
  terminalInfoBar: findCssBlock(terminalInfoBarCss, ".bar"),
  timelineRoot: findCssBlock(timelineBarCss, ".root"),
  timelineEmpty: findCssBlock(timelineBarCss, '.root[data-empty="true"]'),
  terminalMount: findCssBlock(paneTreeCss, ".terminalMount"),
};

const declarations = {
  headerMinHeight: declaration(blocks.terminalInfoBar, "min-height"),
  timelineMinHeight: declaration(blocks.timelineRoot, "min-height"),
  timelineEmptyMinHeight: declaration(blocks.timelineEmpty, "min-height"),
  imeMinHeight: declaration(blocks.imeBar, "min-height"),
  imeCollapsedMinHeight: declaration(blocks.imeBarCollapsed, "min-height"),
  imeCollapsedHeight: declaration(blocks.imeBarCollapsed, "height"),
  terminalAreaPadding: declaration(blocks.terminalArea, "padding"),
  terminalAreaGap: declaration(blocks.terminalArea, "gap"),
  terminalViewportPadding: declaration(blocks.terminalViewport, "padding"),
  terminalMountPadding: declaration(blocks.terminalMount, "padding"),
  terminalMountGap: declaration(blocks.terminalMount, "gap"),
};

const canvasGutterMatch = nativeTerminalArea.match(/const\s+CANVAS_GUTTER\s*=\s*(\d+)/);
const canvasGutter = canvasGutterMatch ? Number(canvasGutterMatch[1]) : null;
const timelineMountGated =
  /shouldRenderTimelineBar\s*&&\s*\(?\s*<TimelineBar/s.test(nativeTerminalArea) ||
  /\(\s*timelineSnapshots\.length\s*>\s*0\s*\|\|\s*snapshotOverlay\s*\)\s*&&\s*\(?\s*<TimelineBar/s.test(
    nativeTerminalArea,
  );
const imeCollapsedProp =
  /<IMEInputBar[\s\S]*\bcollapsed=\{/.test(nativeTerminalArea) ||
  /<IMEInputBar[\s\S]*\bvisuallyCollapsed=\{/.test(nativeTerminalArea);
const imeCollapsedCss =
  blocks.imeBarCollapsed.length > 0 &&
  (resolvePx(declarations.imeCollapsedMinHeight, rootVars) === 0 ||
    resolvePx(declarations.imeCollapsedHeight, rootVars) === 0);

function modeMeasurement(mode) {
  const values = {
    headerHeight: valueForMode(declarations.headerMinHeight, mode, modeVars),
    timelineHeight: valueForMode(declarations.timelineMinHeight, mode, modeVars),
    timelineEmptyHeight: valueForMode(declarations.timelineEmptyMinHeight, mode, modeVars),
    imeHeight: valueForMode(declarations.imeMinHeight, mode, modeVars),
    terminalAreaPadding: valueForMode(declarations.terminalAreaPadding, mode, modeVars),
    terminalAreaGap: valueForMode(declarations.terminalAreaGap, mode, modeVars),
    terminalViewportPadding: valueForMode(declarations.terminalViewportPadding, mode, modeVars),
    terminalMountPadding: valueForMode(declarations.terminalMountPadding, mode, modeVars),
    terminalMountGap: valueForMode(declarations.terminalMountGap, mode, modeVars),
  };
  const timelineFixed = timelineMountGated ? 0 : (values.timelineEmptyHeight ?? values.timelineHeight ?? 0);
  const imeFixed = imeCollapsedCss && imeCollapsedProp ? 0 : (values.imeHeight ?? 0);
  const denseVerticalChrome =
    (values.headerHeight ?? 0) +
    timelineFixed +
    imeFixed +
    (values.terminalViewportPadding ?? 0) * 2 +
    (values.terminalAreaPadding ?? 0) * 2 +
    (values.terminalMountPadding ?? 0) * 2 +
    (values.terminalAreaGap ?? 0) +
    (values.terminalMountGap ?? 0);
  return {
    ...values,
    timelineMountGated,
    imeCollapsedCss,
    imeCollapsedProp,
    canvasGutter,
    fixedVerticalChromePx: denseVerticalChrome,
  };
}

const measurements = Object.fromEntries(MODES.map((mode) => [mode, modeMeasurement(mode)]));
const gutterValues = MODES.map((mode) => measurements[mode].terminalViewportPadding);
const gutterSync = canvasGutter !== null && gutterValues.every((value) => value === canvasGutter);

const sourceCutoffMs = Math.max(
  mtime("scripts/verify-terminal-density-contract.mjs"),
  ...Object.values(PATHS).map(mtime),
);

const checks = [
  check(
    "package-script",
    packageJson.includes('"verify:terminal:density"') &&
      packageJson.includes("scripts/verify-terminal-density-contract.mjs"),
    "package.json exposes the terminal density source contract verifier",
  ),
  check(
    "density-tokens-present",
    MODES.every((mode) =>
      [
        "--terminal-chrome-header-height",
        "--terminal-chrome-timeline-height",
        "--terminal-chrome-ime-height",
        "--terminal-canvas-gutter",
        "--terminal-chrome-gap",
        "--terminal-chrome-mount-padding",
        "--terminal-chrome-area-padding",
      ].every((name) => Object.hasOwn(modeVars[mode], name)),
    ),
    "all density modes own the terminal chrome height/gutter/gap/padding tokens",
    {
      modes: Object.fromEntries(
        MODES.map((mode) => [mode, Object.keys(modeVars[mode]).filter((key) => key.startsWith("--terminal-"))]),
      ),
    },
  ),
  check(
    "timeline-conditional-mount",
    timelineMountGated,
    "TimelineBar mount is gated in NativeTerminalArea, not merely hidden by CSS",
  ),
  check(
    "ime-collapsed-state",
    imeCollapsedProp && imeCollapsedCss,
    "IMEInputBar keeps the component mounted while exposing a collapsed visual state",
    { propPresent: imeCollapsedProp, cssPresent: imeCollapsedCss },
  ),
  check(
    "gutter-constant-sync",
    gutterSync,
    "terminalViewport padding resolves to the same px value as CANVAS_GUTTER for every density mode",
    {
      canvasGutter,
      cssPaddingByMode: Object.fromEntries(MODES.map((mode) => [mode, measurements[mode].terminalViewportPadding])),
    },
  ),
  check(
    "dense-fixed-chrome-budget",
    measurements.dense.fixedVerticalChromePx <= 40,
    "dense mode fixed per-pane vertical chrome stays within UR-2 budget",
    { budgetPx: 40, measuredPx: measurements.dense.fixedVerticalChromePx },
  ),
];

const failed = checks.filter((item) => item.status !== "passed");
const report = {
  status: ENFORCE ? (failed.length === 0 ? "pass" : "fail") : "baseline-recorded",
  mode: ENFORCE ? "enforce" : "baseline",
  generatedAt: new Date().toISOString(),
  sourceCutoffMs,
  requirements: {
    "UR-1": "empty TimelineBar and unfocused IMEInputBar must not reserve chrome",
    "UR-2": "dense fixed per-pane vertical chrome <= 40px",
    "UR-3": "data-density modes own terminal chrome dimensions",
    "UR-5": "terminalViewport padding stays in sync with CANVAS_GUTTER",
  },
  files: PATHS,
  declarations,
  measurements,
  checks,
};

writeJsonAtomic(OUT, report);

const passed = checks.length - failed.length;
console.log(`[terminal-density-contract] ${report.status}: ${passed}/${checks.length} checks passed; artifact=${OUT}`);
if (failed.length > 0) {
  for (const item of failed) {
    console.log(`  - ${item.id}: ${item.detail}`);
  }
}

if (ENFORCE && failed.length > 0) {
  process.exitCode = 1;
}
