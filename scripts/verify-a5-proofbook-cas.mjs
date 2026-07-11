import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createEvidenceProvenance } from "./evidence-provenance.mjs";

const root = resolve(process.cwd());
const artifact = join(root, ".codex-auto", "quality", "a5-proofbook-cas.json");
const cargo = process.platform === "win32" ? "cargo.exe" : "cargo";
const args = ["test", "--manifest-path", "src-tauri/Cargo.toml", "proofbook::runner::tests", "--lib"];
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
    id: "proofbook-runner-cas-matrix",
    status: "pass",
    command: [cargo, ...args].join(" "),
    durationMs: Date.now() - startedAt,
    outputTail: stdout.trim().split(/\r?\n/).slice(-12),
  });
} catch (error) {
  failed = true;
  results.push({
    id: "proofbook-runner-cas-matrix",
    status: "fail",
    command: [cargo, ...args].join(" "),
    durationMs: Date.now() - startedAt,
    error: error instanceof Error ? error.message : String(error),
    stdoutTail: String(error?.stdout ?? "").trim().split(/\r?\n/).slice(-16),
    stderrTail: String(error?.stderr ?? "").trim().split(/\r?\n/).slice(-16),
  });
}

if (!failed) {
  const legacyArgs = [
    "test",
    "--manifest-path",
    "src-tauri/Cargo.toml",
    "proofbook::ledger::tests",
    "--lib",
  ];
  const legacyStartedAt = Date.now();
  try {
    const stdout = execFileSync(cargo, legacyArgs, {
      cwd: root,
      encoding: "utf8",
      windowsHide: true,
      timeout: 240_000,
      env: { ...process.env, NO_COLOR: "1" },
    });
    results.push({
      id: "legacy-ledger-revision-adoption",
      status: "pass",
      command: [cargo, ...legacyArgs].join(" "),
      durationMs: Date.now() - legacyStartedAt,
      outputTail: stdout.trim().split(/\r?\n/).slice(-8),
    });
  } catch (error) {
    failed = true;
    results.push({
      id: "legacy-ledger-revision-adoption",
      status: "fail",
      command: [cargo, ...legacyArgs].join(" "),
      durationMs: Date.now() - legacyStartedAt,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

const runnerSource = readFileSync(join(root, "src-tauri/src/proofbook/runner.rs"), "utf8");
const productionSource = runnerSource.split("\n#[cfg(test)]", 1)[0];
const sourceChecks = [
  ["revisioned-ledger-schema", "src-tauri/src/proofbook/ledger.rs", ["pub revision: u64", "#[serde(default)]"]],
  ["typed-stale-revision", "src-tauri/src/proofbook/errors.rs", ["StaleLedgerRevision"]],
  [
    "per-run-cas-owner",
    "src-tauri/src/proofbook/runner.rs",
    ["Arc<Mutex<ProofbookRunLedger>>", "fn commit_ledger", "durable.revision != ledger.revision"],
  ],
];
for (const [id, path, patterns] of sourceChecks) {
  const source = readFileSync(join(root, path), "utf8");
  const missing = patterns.filter((pattern) => !source.includes(pattern));
  results.push({ id, status: missing.length === 0 ? "pass" : "fail", path, missing });
  failed ||= missing.length > 0;
}
const rawProductionWrites = [...productionSource.matchAll(/ledger::write_ledger/g)].length;
results.push({
  id: "raw-write-limited-to-initialization",
  status: rawProductionWrites === 2 ? "pass" : "fail",
  detail: `production raw write count=${rawProductionWrites}; expected initializer and CAS durable write only`,
});
failed ||= rawProductionWrites !== 2;

const generatedAt = new Date().toISOString();
const report = {
  schema: "aelyris.a5-proofbook-cas/v1",
  status: failed ? "failed" : "pass-a5.3-proofbook-cas",
  sliceComplete: !failed,
  phaseComplete: false,
  scenarios: results,
  generatedAt,
  provenance: createEvidenceProvenance({
    root,
    verifierPath: "scripts/verify-a5-proofbook-cas.mjs",
    inputPaths: [
      "scripts/evidence-provenance.mjs",
      "src-tauri/src/proofbook/errors.rs",
      "src-tauri/src/proofbook/ledger.rs",
      "src-tauri/src/proofbook/runner.rs",
      "package.json",
    ],
    generatedAt,
  }),
};
mkdirSync(dirname(artifact), { recursive: true });
writeFileSync(artifact, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ artifact, ...report }, null, 2));
if (failed) process.exit(1);
