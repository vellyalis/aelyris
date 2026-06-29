import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const ROOT = resolve(process.cwd());
const OUT = join(ROOT, ".codex-auto", "quality", "modularity-boundary-contract.json");
const LOCAL_TIME_ZONE = "Asia/Tokyo";

const sourcePaths = {
  handoff: "docs/specs/CODEX_HANDOFF.md",
  worldClassDesign: "docs/specs/QUORUM_GAP_CLOSURE_DESIGN_2026-06-25.md",
  controlMod: "src-tauri/src/control/mod.rs",
  app: "src/App.tsx",
  ipcCommands: "src-tauri/src/ipc/commands.rs",
  mcpApi: "src-tauri/src/api/mcp.rs",
  nativeBin: "src-tauri/src/bin/aether_native.rs",
};

const godFileBaselines = [
  { path: sourcePaths.app, boundary: "frontend-app-shell", maxDesiredLines: 800 },
  { path: sourcePaths.ipcCommands, boundary: "tauri-ipc-adapter", maxDesiredLines: 800 },
  { path: sourcePaths.mcpApi, boundary: "mcp-api-adapter", maxDesiredLines: 1200 },
  { path: sourcePaths.nativeBin, boundary: "native-proof-cli", maxDesiredLines: 1200 },
];

function fullPath(path) {
  return join(ROOT, path);
}

function read(path) {
  const full = fullPath(path);
  if (!existsSync(full)) return "";
  return readFileSync(full, "utf8");
}

function lineCount(path) {
  const text = read(path);
  if (!text) return 0;
  return text.split(/\r?\n/).length;
}

function mtimeMs(path) {
  const full = fullPath(path);
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

function check(id, ok, detail, severity = "block", evidence = {}) {
  return { id, ok: Boolean(ok), severity, detail, evidence };
}

const handoff = read(sourcePaths.handoff);
const worldClassDesign = read(sourcePaths.worldClassDesign);
const controlMod = read(sourcePaths.controlMod);

const baseline = godFileBaselines.map((item) => {
  const lines = lineCount(item.path);
  return {
    ...item,
    exists: existsSync(fullPath(item.path)),
    lines,
    overDesiredLineBudget: lines > item.maxDesiredLines,
    mtimeMs: mtimeMs(item.path),
  };
});

const checks = [
  check(
    "handoff-defines-capability-layer",
    handoff.includes("Capability layer") &&
      handoff.includes("src-tauri/src/control/") &&
      handoff.includes("Tauri IPC and the MCP server are thin adapters"),
    "CODEX_HANDOFF keeps domain behavior in the backend capability layer and adapters thin.",
  ),
  check(
    "handoff-defines-god-file-decomposition",
    handoff.includes("God-file decomposition") &&
      handoff.includes("commands.rs") &&
      handoff.includes("App.tsx"),
    "CODEX_HANDOFF keeps god-file decomposition in scope.",
  ),
  check(
    "world-class-design-defines-modularity-standard",
    worldClassDesign.includes("Modularity And Changeability Standard") &&
      worldClassDesign.includes("Boundary Rules") &&
      worldClassDesign.includes("Work Unit Grain Rules") &&
      worldClassDesign.includes("Rollback And Changeability Rule"),
    "World-class design includes explicit modularity, grain, and rollback rules.",
  ),
  check(
    "control-domain-modules-present",
    ["agent", "approval", "diff", "merge", "pane", "pane_fleet", "worktree"].every((name) =>
      controlMod.includes(`pub mod ${name};`),
    ),
    "Control layer exposes per-domain modules.",
  ),
  check(
    "god-file-baseline-recorded",
    baseline.every((item) => item.exists && item.lines > 0),
    "Known god-file line-count baselines are recorded so future growth can be detected.",
    "warn",
    { baseline },
  ),
  check(
    "known-god-files-remain-advisory-baseline",
    true,
    "Existing large files are recorded as advisory debt; this initial gate does not fail solely because the baseline is already large.",
    "warn",
    { overBudget: baseline.filter((item) => item.overDesiredLineBudget) },
  ),
  check(
    "wu-template-fields-defined",
    worldClassDesign.includes("owner boundary") &&
      worldClassDesign.includes("contract changes") &&
      worldClassDesign.includes("rollback plan") &&
      worldClassDesign.includes("gates"),
    "Future WUs must declare owner boundary, contract changes, rollback plan, and gates.",
  ),
  check(
    "no-frontend-source-of-truth-policy",
    worldClassDesign.includes("frontend source-of-truth fields for durable mux, merge, ownership, or shared") &&
      worldClassDesign.includes("The frontend pane tree renders") &&
      worldClassDesign.includes("it does not own it"),
    "Design blocks frontend-only durable state for mux, merge, ownership, and shared brain.",
  ),
];

const blockingFailures = checks.filter((item) => item.severity === "block" && !item.ok);
const warnings = [
  ...checks.filter((item) => item.severity === "warn" && !item.ok),
  ...baseline
    .filter((item) => item.overDesiredLineBudget)
    .map((item) => ({
      id: `large-file-${item.path}`,
      severity: "warn",
      detail: `${item.path} has ${item.lines} lines; future work must extract rather than grow this owner boundary.`,
      evidence: item,
    })),
];
const ok = blockingFailures.length === 0;
const report = {
  schema: "aether.modularity-boundary-contract/v1",
  version: 1,
  generatedAt: new Date().toISOString(),
  localDate: currentLocalDate(),
  timeZone: LOCAL_TIME_ZONE,
  ok,
  status: ok ? (warnings.length > 0 ? "pass-advisory-baseline" : "pass") : "failed",
  mode: "advisory-until-baseline-ratified",
  blockingFailureCount: blockingFailures.length,
  warningCount: warnings.length,
  checks,
  warnings,
  baselines: baseline,
};

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ artifact: OUT, ...report }, null, 2));
if (!ok) process.exitCode = 1;
