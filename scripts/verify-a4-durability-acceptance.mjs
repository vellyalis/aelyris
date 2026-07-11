import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createEvidenceProvenance } from "./evidence-provenance.mjs";

const root = resolve(process.cwd());
const artifact = join(root, ".codex-auto", "quality", "a4-durability-acceptance.json");
const cargo = process.platform === "win32" ? "cargo.exe" : "cargo";
const scenarios = [
  {
    id: "numbered-upgrade-and-newer-schema",
    command: cargo,
    args: ["test", "--manifest-path", "src-tauri/Cargo.toml", "db::migrations::tests", "--lib"],
  },
  {
    id: "restart-and-mutation-rollback",
    command: cargo,
    args: ["test", "--manifest-path", "src-tauri/Cargo.toml", "agent::interactive::tests", "--lib"],
  },
  {
    id: "locked-db-and-multi-connection",
    command: cargo,
    args: [
      "test",
      "--manifest-path",
      "src-tauri/Cargo.toml",
      "persistence::session_checkpoint_repo::tests",
      "--lib",
    ],
  },
  {
    id: "corrupt-db-fail-closed",
    command: cargo,
    args: [
      "test",
      "--manifest-path",
      "src-tauri/Cargo.toml",
      "corrupt_database_fails_closed_without_replacing_source_bytes",
      "--lib",
    ],
  },
  {
    id: "power-loss-and-disk-quota",
    command: cargo,
    args: ["test", "--manifest-path", "src-tauri/Cargo.toml", "durable_file::tests", "--lib"],
  },
  {
    id: "file-store-round-trips",
    command: cargo,
    args: ["test", "--manifest-path", "src-tauri/Cargo.toml", "mux::store::tests", "--lib"],
  },
  {
    id: "workflow-durable-restore",
    command: cargo,
    args: ["test", "--manifest-path", "src-tauri/Cargo.toml", "workflow::executor::tests", "--lib"],
  },
  {
    id: "proofbook-durable-restore",
    command: cargo,
    args: ["test", "--manifest-path", "src-tauri/Cargo.toml", "proofbook::runner::tests", "--lib"],
  },
  {
    id: "settings-round-trip",
    command: cargo,
    args: ["test", "--manifest-path", "src-tauri/Cargo.toml", "config::settings::tests", "--lib"],
  },
  {
    id: "session-checkpoint-contract",
    command: process.execPath,
    args: ["scripts/verify-session-checkpoint-restore.mjs"],
  },
  {
    id: "session-resume-idempotence",
    command: process.execPath,
    args: ["scripts/verify-session-resume-idempotent.mjs"],
  },
  {
    id: "injectable-sleep-gap",
    command: process.execPath,
    args: ["scripts/verify-sleep-resume-db-lock-chaos.mjs"],
  },
];

const results = [];
let failed = false;
for (const scenario of scenarios) {
  const startedAt = Date.now();
  try {
    const stdout = execFileSync(scenario.command, scenario.args, {
      cwd: root,
      encoding: "utf8",
      windowsHide: true,
      timeout: 240_000,
      env: { ...process.env, NO_COLOR: "1" },
    });
    results.push({
      id: scenario.id,
      status: "pass",
      command: [scenario.command, ...scenario.args].join(" "),
      durationMs: Date.now() - startedAt,
      outputTail: stdout.trim().split(/\r?\n/).slice(-8),
    });
  } catch (error) {
    failed = true;
    results.push({
      id: scenario.id,
      status: "fail",
      command: [scenario.command, ...scenario.args].join(" "),
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
      stdoutTail: String(error?.stdout ?? "").trim().split(/\r?\n/).slice(-12),
      stderrTail: String(error?.stderr ?? "").trim().split(/\r?\n/).slice(-12),
    });
    break;
  }
}

const generatedAt = new Date().toISOString();
const report = {
  schema: "aelyris.a4-durability-acceptance/v1",
  status: failed ? "failed" : "pass-repo-owned-a4-durability",
  repoOwnedComplete: !failed,
  phaseComplete: !failed,
  scenarios: results,
  externalProof: {
    realOsSleepResumeExecuted: false,
    abruptHostPowerLossExecuted: false,
    status: "deferred-to-a9-operator-proof",
    requiredArtifact: ".codex-auto/operator-evidence/real-sleep-power-loss-durability.json",
  },
  generatedAt,
  provenance: createEvidenceProvenance({
    root,
    verifierPath: "scripts/verify-a4-durability-acceptance.mjs",
    inputPaths: [
      "scripts/evidence-provenance.mjs",
      "scripts/verify-a4-durability-contract.mjs",
      "scripts/verify-sleep-resume-db-lock-chaos.mjs",
      "src-tauri/src/db/migrations.rs",
      "src-tauri/src/db/queries.rs",
      "src-tauri/src/persistence/session_checkpoint_repo.rs",
      "src-tauri/src/agent/interactive.rs",
      "src-tauri/src/startup_reconciliation.rs",
      "src-tauri/src/durable_file.rs",
      "src-tauri/src/mux/store.rs",
      "src-tauri/src/workflow/executor.rs",
      "src-tauri/src/proofbook/ledger.rs",
      "src-tauri/src/config/settings.rs",
      "package.json",
    ],
    generatedAt,
  }),
};
mkdirSync(dirname(artifact), { recursive: true });
writeFileSync(artifact, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ artifact, ...report }, null, 2));
if (failed) process.exit(1);
