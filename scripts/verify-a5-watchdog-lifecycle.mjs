import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createEvidenceProvenance } from "./evidence-provenance.mjs";

const root = resolve(process.cwd());
const artifact = join(root, ".codex-auto", "quality", "a5-watchdog-lifecycle.json");
const cargo = process.platform === "win32" ? "cargo.exe" : "cargo";
const args = ["test", "--manifest-path", "src-tauri/Cargo.toml", "watchdog::auto_repair::tests", "--lib", "--", "--test-threads=1"];
const results = [];
let failed = false;
const startedAt = Date.now();
try {
  const stdout = execFileSync(cargo, args, { cwd: root, encoding: "utf8", windowsHide: true, timeout: 240_000, env: { ...process.env, NO_COLOR: "1" } });
  results.push({ id: "watchdog-lifecycle-tests", status: "pass", command: [cargo, ...args].join(" "), durationMs: Date.now() - startedAt, outputTail: stdout.trim().split(/\r?\n/).slice(-12) });
} catch (error) {
  failed = true;
  results.push({ id: "watchdog-lifecycle-tests", status: "fail", command: [cargo, ...args].join(" "), durationMs: Date.now() - startedAt, error: error instanceof Error ? error.message : String(error) });
}
const path = "src-tauri/src/watchdog/auto_repair.rs";
const source = readFileSync(join(root, path), "utf8");
for (const [id, patterns] of [
  ["typed-outcomes", ["pub enum RepairOutcome", "TimedOut {", "Cancelled {"]],
  ["owned-worker", ["worker: Option<JoinHandle<()>>", "impl Drop for AutoRepairManager"]],
  ["cancellation-contract", ["pub fn cancel(&mut self", "cancellation,", "RepairPhase::Cancelling"]],
  ["bounded-worktree-cleanup", ["fn create_worktree_bounded", "fn cleanup_worktree", "GIT_TIMEOUT"]],
  ["spawn-failure-terminal", ["worker-spawn", "Auto-repair worker could not start"]],
]) {
  const missing = patterns.filter((pattern) => !source.includes(pattern));
  results.push({ id, status: missing.length === 0 ? "pass" : "fail", path, missing });
  failed ||= missing.length > 0;
}
const generatedAt = new Date().toISOString();
const report = { schema: "aelyris.a5-watchdog-lifecycle/v1", status: failed ? "failed" : "pass-a5.7-watchdog-lifecycle", sliceComplete: !failed, phaseComplete: false, scenarios: results, generatedAt, provenance: createEvidenceProvenance({ root, verifierPath: "scripts/verify-a5-watchdog-lifecycle.mjs", inputPaths: ["scripts/evidence-provenance.mjs", path, "src-tauri/src/ipc/repair_commands.rs", "src-tauri/src/lib.rs", "package.json"], generatedAt }) };
mkdirSync(dirname(artifact), { recursive: true });
writeFileSync(artifact, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ artifact, ...report }, null, 2));
if (failed) process.exit(1);
