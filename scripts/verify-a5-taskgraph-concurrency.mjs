import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createEvidenceProvenance } from "./evidence-provenance.mjs";

const root = resolve(process.cwd());
const artifact = join(root, ".codex-auto", "quality", "a5-taskgraph-concurrency.json");
const cargo = process.platform === "win32" ? "cargo.exe" : "cargo";
const scenarios = [
  ["task-manager-revision-matrix", "task::manager::tests"],
  ["autonomy-loop-adapter-regression", "control::loop_ports::tests"],
];
const results = [];
let failed = false;
for (const [id, filter] of scenarios) {
  const args = ["test", "--manifest-path", "src-tauri/Cargo.toml", filter, "--lib"];
  const startedAt = Date.now();
  try {
    const stdout = execFileSync(cargo, args, {
      cwd: root,
      encoding: "utf8",
      windowsHide: true,
      timeout: 240_000,
      env: { ...process.env, NO_COLOR: "1" },
    });
    results.push({
      id,
      status: "pass",
      command: [cargo, ...args].join(" "),
      durationMs: Date.now() - startedAt,
      outputTail: stdout.trim().split(/\r?\n/).slice(-10),
    });
  } catch (error) {
    failed = true;
    results.push({
      id,
      status: "fail",
      command: [cargo, ...args].join(" "),
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
      stdoutTail: String(error?.stdout ?? "").trim().split(/\r?\n/).slice(-16),
      stderrTail: String(error?.stderr ?? "").trim().split(/\r?\n/).slice(-16),
    });
    break;
  }
}

const checks = [
  [
    "revisioned-snapshot-owner",
    "src-tauri/src/task/manager.rs",
    ["struct TaskGraphState", "revision: u64", "fn run_autonomy_step", "expected_revision"],
  ],
  [
    "lease-fail-fast-contract",
    "src-tauri/src/task/manager.rs",
    ["active_autonomy_lease", "MutationInProgress", "catch_unwind"],
  ],
  [
    "unlocked-persistence-contract",
    "src-tauri/src/task/manager.rs",
    ["fn persist_latest", "(state.graph.clone(), state.revision)", "TaskRepo::save_graph"],
  ],
  [
    "loop-uses-snapshot-apply",
    "src-tauri/src/control/loop_ports.rs",
    ["run_autonomy_step(|graph|"],
  ],
];
for (const [id, path, patterns] of checks) {
  const source = readFileSync(join(root, path), "utf8");
  const missing = patterns.filter((pattern) => !source.includes(pattern));
  results.push({ id, status: missing.length === 0 ? "pass" : "fail", path, missing });
  failed ||= missing.length > 0;
}
const managerSource = readFileSync(join(root, "src-tauri/src/task/manager.rs"), "utf8");
const staleEscapeHatch = managerSource.includes("with_graph_mut");
results.push({
  id: "old-live-graph-escape-hatch-removed",
  status: staleEscapeHatch ? "fail" : "pass",
  detail: staleEscapeHatch ? "with_graph_mut still present" : "with_graph_mut absent",
});
failed ||= staleEscapeHatch;

const generatedAt = new Date().toISOString();
const report = {
  schema: "aelyris.a5-taskgraph-concurrency/v1",
  status: failed ? "failed" : "pass-a5.5-taskgraph-concurrency",
  sliceComplete: !failed,
  phaseComplete: false,
  scenarios: results,
  generatedAt,
  provenance: createEvidenceProvenance({
    root,
    verifierPath: "scripts/verify-a5-taskgraph-concurrency.mjs",
    inputPaths: [
      "scripts/evidence-provenance.mjs",
      "src-tauri/src/task/graph.rs",
      "src-tauri/src/task/manager.rs",
      "src-tauri/src/control/loop_ports.rs",
      "src-tauri/src/ipc/task_commands.rs",
      "src-tauri/src/ipc/orchestrator_commands.rs",
      "src-tauri/src/api/mcp.rs",
      "package.json",
    ],
    generatedAt,
  }),
};
mkdirSync(dirname(artifact), { recursive: true });
writeFileSync(artifact, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ artifact, ...report }, null, 2));
if (failed) process.exit(1);
