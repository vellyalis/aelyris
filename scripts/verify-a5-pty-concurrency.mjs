import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createEvidenceProvenance } from "./evidence-provenance.mjs";

const root = resolve(process.cwd());
const artifact = join(root, ".codex-auto", "quality", "a5-pty-concurrency.json");
const cargo = process.platform === "win32" ? "cargo.exe" : "cargo";
const args = [
  "test",
  "--manifest-path",
  "src-tauri/Cargo.toml",
  "pty::manager::tests",
  "--lib",
  "--",
  "--test-threads=1",
];
const results = [];
let failed = false;
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
    id: "pty-handle-concurrency-matrix",
    status: "pass",
    command: [cargo, ...args].join(" "),
    durationMs: Date.now() - startedAt,
    outputTail: stdout.trim().split(/\r?\n/).slice(-10),
  });
} catch (error) {
  failed = true;
  results.push({
    id: "pty-handle-concurrency-matrix",
    status: "fail",
    command: [cargo, ...args].join(" "),
    durationMs: Date.now() - startedAt,
    error: error instanceof Error ? error.message : String(error),
    stdoutTail: String(error?.stdout ?? "").trim().split(/\r?\n/).slice(-16),
    stderrTail: String(error?.stderr ?? "").trim().split(/\r?\n/).slice(-16),
  });
}

const sourcePath = "src-tauri/src/pty/manager.rs";
const source = readFileSync(join(root, sourcePath), "utf8");
const sourceChecks = [
  ["spawn-reservation", ["enum PtySlot", "Initializing", "reservation was cancelled"]],
  ["per-instance-handle", ["Ready(Arc<Mutex<PtyInstance>>)", "fn instance_handle"]],
  ["short-map-snapshot", ["fn ready_handles", "Arc::ptr_eq"]],
  [
    "concurrency-regressions",
    [
      "concurrent_same_id_spawn_has_exactly_one_published_child",
      "stale_reaper_cannot_remove_a_reused_terminal_id",
      "one_locked_instance_does_not_block_another_terminal_lookup",
    ],
  ],
];
for (const [id, patterns] of sourceChecks) {
  const missing = patterns.filter((pattern) => !source.includes(pattern));
  results.push({ id, status: missing.length === 0 ? "pass" : "fail", path: sourcePath, missing });
  failed ||= missing.length > 0;
}

const generatedAt = new Date().toISOString();
const report = {
  schema: "aelyris.a5-pty-concurrency/v1",
  status: failed ? "failed" : "pass-a5.4-pty-concurrency",
  sliceComplete: !failed,
  phaseComplete: false,
  scenarios: results,
  generatedAt,
  provenance: createEvidenceProvenance({
    root,
    verifierPath: "scripts/verify-a5-pty-concurrency.mjs",
    inputPaths: [
      "scripts/evidence-provenance.mjs",
      "src-tauri/src/pty/manager.rs",
      "package.json",
    ],
    generatedAt,
  }),
};
mkdirSync(dirname(artifact), { recursive: true });
writeFileSync(artifact, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ artifact, ...report }, null, 2));
if (failed) process.exit(1);
