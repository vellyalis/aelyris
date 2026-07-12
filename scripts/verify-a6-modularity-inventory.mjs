import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createEvidenceProvenance } from "./evidence-provenance.mjs";

const root = resolve(process.cwd());
const artifact = join(root, ".codex-auto", "quality", "a6-modularity-inventory.json");
const owners = [
  { path: "src/App.tsx", owner: "frontend composition shell", baselineLines: 4867, targetLines: 800, nextSlice: "A6.2" },
  { path: "src/features/right-rail/rightRailModel.tsx", owner: "right-rail projection and action model", baselineLines: 688, targetLines: 800, nextSlice: "A6.2" },
  { path: "src-tauri/src/ipc/commands.rs", owner: "legacy Tauri IPC adapter", baselineLines: 4574, targetLines: 800, nextSlice: "A6.3" },
  { path: "src-tauri/src/api/mcp.rs", owner: "MCP catalog, governance adapter, and dispatcher", baselineLines: 5943, targetLines: 1200, nextSlice: "A6.4" },
  { path: "src-tauri/src/db/queries.rs", owner: "legacy SQLite repository facade", baselineLines: 3330, targetLines: 1200, nextSlice: "A6.5" },
  { path: "src-tauri/src/bin/aelyris_native.rs", owner: "native proof CLI entrypoint", baselineLines: 8827, targetLines: 1200, nextSlice: "A6.6" },
];

const read = (path) => readFileSync(join(root, path), "utf8");
const lineCount = (text) => text.split(/\r?\n/).length;
const results = owners.map((owner) => {
  const lines = lineCount(read(owner.path));
  return { ...owner, lines, status: lines <= owner.baselineLines ? "pass" : "fail", deltaFromBaseline: lines - owner.baselineLines };
});

const commandsSource = read("src-tauri/src/ipc/commands.rs");
const libSource = read("src-tauri/src/lib.rs");
const commandNames = commandsSource
  .split("#[tauri::command]")
  .slice(1)
  .map((chunk) => chunk.slice(0, 400).match(/\bfn\s+([A-Za-z0-9_]+)/)?.[1])
  .filter(Boolean);
const unregistered = commandNames.filter((name) => !libSource.includes(`ipc::${name}`));
const ipcClassification = {
  declaredInLegacyAdapter: commandNames.length,
  registered: commandNames.length - unregistered.length,
  unregistered: unregistered.map((name) => ({ name, classification: "retain-pending-a6.3-callsite-proof", deletionAuthorized: false })),
  rule: "No handler may be deleted until registration, frontend invoke, MCP/HTTP reuse, tests, and compatibility aliases are all classified.",
};

const slices = [
  { id: "A6.2", owner: "frontend shell and right-rail projection", acceptance: "extract state/contract owners, narrow selectors, preserve rendered trust gates, lower both baselines" },
  { id: "A6.3", owner: "Tauri IPC adapter and event registry", acceptance: "typed facade, classify all legacy handlers, preserve command names, lower commands.rs baseline" },
  { id: "A6.4", owner: "MCP catalog and dispatch", acceptance: "separate catalog/schema/governance/domain dispatch with exact verb drift tests, lower mcp.rs baseline" },
  { id: "A6.5", owner: "SQLite domain repositories", acceptance: "split query domains behind one Database connection/migration owner, lower queries.rs baseline" },
  { id: "A6.6", owner: "native proof CLI", acceptance: "split command router and proof domains without changing artifact schemas or host behavior, lower native baseline" },
  { id: "A6.7", owner: "duplicate and unowned infrastructure", acceptance: "remove only callsite-proven dead owners; no parallel state managers remain" },
  { id: "A6.8", owner: "combined modularity acceptance", acceptance: "all ratchets reject growth, target gates pass, and advisory mode is retired" },
];

const failed = results.some((result) => result.status === "fail");
const generatedAt = new Date().toISOString();
const report = {
  schema: "aelyris.a6-modularity-inventory/v1",
  status: failed ? "failed" : "pass-a6.1-inventory-frozen",
  sliceComplete: !failed,
  phaseComplete: false,
  ratchetMode: "reject-growth-from-frozen-baseline",
  owners: results,
  ipcClassification,
  slices,
  generatedAt,
  provenance: createEvidenceProvenance({
    root,
    verifierPath: "scripts/verify-a6-modularity-inventory.mjs",
    inputPaths: ["scripts/evidence-provenance.mjs", "src-tauri/src/lib.rs", ...owners.map((owner) => owner.path), "package.json"],
    generatedAt,
  }),
};
mkdirSync(dirname(artifact), { recursive: true });
writeFileSync(artifact, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ artifact, ...report }, null, 2));
if (failed) process.exit(1);
