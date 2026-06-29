import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const ROOT = resolve(process.cwd());
const OUT = join(ROOT, ".codex-auto", "quality", "modularity-boundary-contract.json");
const LOCAL_TIME_ZONE = "Asia/Tokyo";

const sourcePaths = {
  phaseArchitecture: "docs/specs/PHASE_0_1_ARCHITECTURE_SPEC.md",
  visiblePaneSpec: "docs/specs/VISIBLE_AGENT_PANE_RUNTIME_SPEC.md",
  fleetManifest: "scripts/fleet/wu-manifest.json",
  controlMod: "src-tauri/src/control/mod.rs",
  app: "src/App.tsx",
  ipcCommands: "src-tauri/src/ipc/commands.rs",
  mcpApi: "src-tauri/src/api/mcp.rs",
  nativeBin: "src-tauri/src/bin/aelyris_native.rs",
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

const phaseArchitecture = read(sourcePaths.phaseArchitecture);
const visiblePaneSpec = read(sourcePaths.visiblePaneSpec);
const fleetManifest = read(sourcePaths.fleetManifest);
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
    "phase-architecture-defines-capability-layer",
    phaseArchitecture.includes("## 0.5 Capability layer") &&
      phaseArchitecture.includes("Aelyris Control API") &&
      phaseArchitecture.includes("Tauri IPC adapter") &&
      phaseArchitecture.includes("'aelyris' MCP server adapter".replace(/'/g, "'")) &&
      phaseArchitecture.includes("No capability logic lives in an adapter"),
    "PHASE_0_1 architecture keeps domain behavior in the backend capability layer and adapters thin.",
  ),
  check(
    "phase-architecture-defines-god-file-decomposition",
    phaseArchitecture.includes("## 2. God-file decomposition") &&
      phaseArchitecture.includes("commands.rs") &&
      phaseArchitecture.includes("App.tsx"),
    "PHASE_0_1 architecture keeps god-file decomposition in scope.",
  ),
  check(
    "architecture-defines-modularity-standard",
    phaseArchitecture.includes("The two adapters are *thin*") &&
      phaseArchitecture.includes("No capability logic lives in an adapter") &&
      phaseArchitecture.includes("No command renames") &&
      phaseArchitecture.includes("The migration is incremental and *additive*"),
    "Current architecture spec includes explicit adapter, migration, and no-command-rename modularity rules.",
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
    fleetManifest.includes('"workUnits"') &&
      fleetManifest.includes('"files"') &&
      fleetManifest.includes('"deps"') &&
      fleetManifest.includes('"spec"') &&
      fleetManifest.includes('"notes"'),
    "Future WUs must declare files, dependencies, spec sections, and notes.",
  ),
  check(
    "no-frontend-source-of-truth-policy",
    phaseArchitecture.includes("No capability logic lives in an adapter") &&
      phaseArchitecture.includes("both faces are thin adapters over it") &&
      phaseArchitecture.includes("Aelyris Control API") &&
      visiblePaneSpec.includes("If visible PTY spawn falls back from sidecar to in-process native"),
    "Specs block frontend-only ownership of durable mux and coordination behavior.",
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
  schema: "aelyris.modularity-boundary-contract/v1",
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
