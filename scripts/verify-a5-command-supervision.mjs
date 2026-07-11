import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createEvidenceProvenance } from "./evidence-provenance.mjs";

const root = resolve(process.cwd());
const artifact = join(root, ".codex-auto", "quality", "a5-command-supervision.json");
const cargo = process.platform === "win32" ? "cargo.exe" : "cargo";
const scenarios = [
  ["supervisor-timeout-cancel-flood", "process::tests::supervised_command"],
  ["proofbook-timeout-map-and-output-cap", "proofbook::step_shell::tests"],
  ["proofbook-supervisor-adoption", "proofbook::runner::tests"],
  ["objective-gate-supervisor-adoption", "control::gate_runner::tests"],
  ["watchdog-supervisor-adoption", "watchdog::auto_repair::tests"],
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
      outputTail: stdout.trim().split(/\r?\n/).slice(-8),
    });
  } catch (error) {
    failed = true;
    results.push({
      id,
      status: "fail",
      command: [cargo, ...args].join(" "),
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
      stdoutTail: String(error?.stdout ?? "").trim().split(/\r?\n/).slice(-12),
      stderrTail: String(error?.stderr ?? "").trim().split(/\r?\n/).slice(-12),
    });
    break;
  }
}

const sourceChecks = [
  {
    id: "proofbook-shared-supervisor",
    path: "src-tauri/src/proofbook/step_shell.rs",
    patterns: ["run_supervised", "timeoutMs", "outputLimitBytes", "command_timeout"],
  },
  {
    id: "objective-gate-shared-supervisor",
    path: "src-tauri/src/control/gate_runner.rs",
    patterns: ["run_supervised", "SupervisedCommandStatus::Exited"],
  },
  {
    id: "watchdog-shared-supervisor",
    path: "src-tauri/src/watchdog/auto_repair.rs",
    patterns: ["run_bounded_command", "command_failure_kind", "AGENT_TIMEOUT", "TEST_TIMEOUT"],
  },
];
for (const check of sourceChecks) {
  const source = readFileSync(join(root, check.path), "utf8");
  const missing = check.patterns.filter((pattern) => !source.includes(pattern));
  results.push({
    id: check.id,
    status: missing.length === 0 ? "pass" : "fail",
    path: check.path,
    missing,
  });
  failed ||= missing.length > 0;
}

const generatedAt = new Date().toISOString();
const report = {
  schema: "aelyris.a5-command-supervision/v1",
  status: failed ? "failed" : "pass-a5.2-command-supervision",
  sliceComplete: !failed,
  phaseComplete: false,
  scenarios: results,
  generatedAt,
  provenance: createEvidenceProvenance({
    root,
    verifierPath: "scripts/verify-a5-command-supervision.mjs",
    inputPaths: [
      "scripts/evidence-provenance.mjs",
      "src-tauri/src/process.rs",
      "src-tauri/src/proofbook/step_shell.rs",
      "src-tauri/src/control/gate_runner.rs",
      "src-tauri/src/watchdog/auto_repair.rs",
      "package.json",
    ],
    generatedAt,
  }),
};
mkdirSync(dirname(artifact), { recursive: true });
writeFileSync(artifact, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ artifact, ...report }, null, 2));
if (failed) process.exit(1);
