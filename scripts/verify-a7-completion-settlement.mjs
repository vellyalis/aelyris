import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { createEvidenceProvenance } from "./evidence-provenance.mjs";

const root = resolve(process.cwd());
const artifactPath = join(root, ".codex-auto", "quality", "a7-completion-settlement.json");
const files = {
  mission: "src-tauri/src/task/mission.rs",
  manager: "src-tauri/src/task/manager.rs",
  repo: "src-tauri/src/persistence/task_repo.rs",
  migrations: "src-tauri/src/db/migrations.rs",
  status: "src-tauri/src/task/status.rs",
  ipc: "src-tauri/src/ipc/orchestrator_commands.rs",
  lib: "src-tauri/src/lib.rs",
};
const source = Object.fromEntries(
  Object.entries(files).map(([key, path]) => [key, readFileSync(join(root, path), "utf8")]),
);
const checks = [
  [
    "immutable-packet-schemas",
    ["CompletedWorkPacket", "BlockedWorkPacket", "MissionCompletionPacket", "packet_digest"].every((token) =>
      source.mission.includes(token),
    ),
  ],
  [
    "typed-zero-credit-blockers",
    source.mission.includes("completion_credit != 0") &&
      source.mission.includes("SettlementNextActionKind") &&
      source.mission.includes("category-compatible data"),
  ],
  [
    "taskrepo-owned-atomic-cas",
    source.repo.includes("persist_completed_settlement") &&
      source.repo.includes("persist_blocked_settlement") &&
      source.repo.includes("settlement compare-and-swap drift requires re-proof") &&
      source.repo.includes("Self::save_graph_tx(&tx, graph)"),
  ],
  [
    "immutable-persistence-migration",
    source.migrations.includes("CREATE TABLE mission_settlement_packets") &&
      source.migrations.includes("trg_mission_settlement_immutable") &&
      source.migrations.includes("trg_mission_settlement_no_delete"),
  ],
  [
    "runtime-derived-settlement",
    source.manager.includes("pub fn settle_mission_plan") &&
      source.manager.includes("inspect_exact_owned_candidate") &&
      source.manager.includes("required_ids !=") &&
      source.ipc.includes("pub async fn mission_plan_settle") &&
      source.lib.includes("ipc::mission_plan_settle"),
  ],
  [
    "trusted-done-or-blocked-only",
    source.manager.includes("TaskStatus::Done") &&
      source.manager.includes("TaskStatus::Blocked") &&
      source.status.includes("(Review, Blocked)"),
  ],
  [
    "no-second-completion-barrier",
    !Object.values(source).some((text) => text.includes("struct CompletionBarrier")) &&
      !source.migrations.includes("CREATE TABLE completion_barrier"),
  ],
];
const failed = checks.filter(([, passed]) => !passed).map(([id]) => id);
if (failed.length) throw new Error(`A7.4 source contract failed: ${failed.join(", ")}`);

const testOutput = execFileSync("cargo", ["test", "--manifest-path", "src-tauri/Cargo.toml", "--lib", "a7_4_"], {
  cwd: root,
  encoding: "utf8",
  windowsHide: true,
  stdio: ["ignore", "pipe", "pipe"],
});
const match = testOutput.match(/test result: ok\. (\d+) passed; 0 failed/);
if (!match || Number(match[1]) < 5) throw new Error(`A7.4 focused test count missing:\n${testOutput}`);

const generatedAt = new Date().toISOString();
const artifact = {
  schema: "aelyris.a7-completion-settlement/v1",
  status: "pass",
  completedSlice: "A7.4",
  nextImplementationSlice: "A7.5",
  phaseComplete: false,
  focusedTests: Number(match[1]),
  checks: checks.map(([id, passed]) => ({ id, status: passed ? "passed" : "failed" })),
  generatedAt,
  provenance: createEvidenceProvenance({
    root,
    verifierPath: "scripts/verify-a7-completion-settlement.mjs",
    inputPaths: [...Object.values(files), "scripts/verify-a7-completion-settlement.mjs"],
    generatedAt,
  }),
};
mkdirSync(dirname(artifactPath), { recursive: true });
writeFileSync(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`);
console.log(JSON.stringify({ artifact: artifactPath, ...artifact }, null, 2));
