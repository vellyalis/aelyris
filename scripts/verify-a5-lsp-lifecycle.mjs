import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createEvidenceProvenance } from "./evidence-provenance.mjs";

const root = resolve(process.cwd());
const artifact = join(root, ".codex-auto", "quality", "a5-lsp-lifecycle.json");
const cargo = process.platform === "win32" ? "cargo.exe" : "cargo";
const args = [
  "test",
  "--manifest-path",
  "src-tauri/Cargo.toml",
  "lsp::manager::tests",
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
    id: "lsp-framing-lifecycle-matrix",
    status: "pass",
    command: [cargo, ...args].join(" "),
    durationMs: Date.now() - startedAt,
    outputTail: stdout.trim().split(/\r?\n/).slice(-12),
  });
} catch (error) {
  failed = true;
  results.push({
    id: "lsp-framing-lifecycle-matrix",
    status: "fail",
    command: [cargo, ...args].join(" "),
    durationMs: Date.now() - startedAt,
    error: error instanceof Error ? error.message : String(error),
    stdoutTail: String(error?.stdout ?? "").trim().split(/\r?\n/).slice(-16),
    stderrTail: String(error?.stderr ?? "").trim().split(/\r?\n/).slice(-16),
  });
}

const path = "src-tauri/src/lsp/manager.rs";
const source = readFileSync(join(root, path), "utf8");
const checks = [
  [
    "strict-framing-caps",
    ["MAX_HEADER_LINE_BYTES", "MAX_HEADER_BLOCK_BYTES", "MAX_HEADER_COUNT", "MAX_BODY_BYTES"],
  ],
  ["bounded-reader", ["fn read_bounded_line", "HeaderLineTooLarge", "BodyTooLarge"]],
  ["per-server-owner", ["Ready(Arc<LspProcess>)", "fn process_handle", "LspManagerInner"]],
  ["bounded-stop", ["STOP_TIMEOUT", "recv_timeout", "terminate_process_tree"]],
  ["reader-retirement", ["retire_after_reader_exit", "Arc::downgrade"]],
];
for (const [id, patterns] of checks) {
  const missing = patterns.filter((pattern) => !source.includes(pattern));
  results.push({ id, status: missing.length === 0 ? "pass" : "fail", path, missing });
  failed ||= missing.length > 0;
}

const generatedAt = new Date().toISOString();
const report = {
  schema: "aelyris.a5-lsp-lifecycle/v1",
  status: failed ? "failed" : "pass-a5.6-lsp-lifecycle",
  sliceComplete: !failed,
  phaseComplete: false,
  scenarios: results,
  generatedAt,
  provenance: createEvidenceProvenance({
    root,
    verifierPath: "scripts/verify-a5-lsp-lifecycle.mjs",
    inputPaths: [
      "scripts/evidence-provenance.mjs",
      "src-tauri/src/lsp/manager.rs",
      "src-tauri/src/process.rs",
      "package.json",
    ],
    generatedAt,
  }),
};
mkdirSync(dirname(artifact), { recursive: true });
writeFileSync(artifact, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ artifact, ...report }, null, 2));
if (failed) process.exit(1);
