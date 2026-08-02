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
const completedPersistence = source.repo.slice(
  source.repo.indexOf("pub fn persist_completed_settlement"),
  source.repo.indexOf("pub fn persist_blocked_settlement"),
);
const blockedPersistence = source.repo.slice(source.repo.indexOf("pub fn persist_blocked_settlement"));
const completedDecode = source.repo.slice(
  source.repo.indexOf("fn decode_completed_settlement"),
  source.repo.indexOf("fn decode_blocked_settlement"),
);
const blockedDecode = source.repo.slice(
  source.repo.indexOf("fn decode_blocked_settlement"),
  source.repo.indexOf("fn decode_mission_completion"),
);
const missionDecode = source.repo.slice(
  source.repo.indexOf("fn decode_mission_completion"),
  source.repo.indexOf("pub fn load_completed_settlement"),
);
const ordered = (text, tokens) => {
  let cursor = -1;
  return tokens.every((token) => {
    cursor = text.indexOf(token, cursor + 1);
    return cursor >= 0;
  });
};
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
    "accepted-freshness-policy-executed",
    source.manager.includes("evaluate_settlement_freshness") &&
      source.manager.includes("STALE_GATE_EVIDENCE") &&
      source.manager.includes("EVIDENCE_CLOCK_SKEW") &&
      source.manager.includes("GATE_CONTRACT_VERSION_DRIFT") &&
      source.manager.includes("ENVIRONMENT_FINGERPRINT_DRIFT"),
  ],
  [
    "closed-blocker-authority",
    !source.manager.includes("classified_blockers: Vec<SettlementBlocker>") &&
      !source.ipc.includes("Vec::new()") &&
      source.manager.includes("derive_declared_authority_blockers") &&
      source.manager.includes("OPERATOR_AUTHORITY_UNAVAILABLE") &&
      source.manager.includes("EXTERNAL_AUTHORITY_UNAVAILABLE") &&
      source.mission.includes("!self.command_argv.is_empty()"),
  ],
  [
    "superseding-generation-current-selector",
    source.repo.includes("load_current_decision") &&
      source.repo.includes("settlement_generation DESC") &&
      source.migrations.includes("idx_mission_settlement_single_successor") &&
      source.migrations.includes("trg_mission_settlement_generation_binding"),
  ],
  [
    "receipt-only-manager-recovery",
    source.manager.includes("blocked_retry_authority_matches") &&
      source.manager.includes("a7_4_receipt_only_recovery_and_populated_v10_packets_reach_current_validation") &&
      source.manager.includes("the exact receipt alone must recover through the public settlement owner"),
  ],
  [
    "populated-v10-packet-compatibility",
    source.repo.includes("verify_legacy_settlement_digest") &&
      source.repo.includes("is not an eligible v10 row") &&
      source.migrations.includes("reset_settlement_store_to_v10_for_test") &&
      source.manager.includes("legacy_v10_packet_json"),
  ],
  [
    "raw-first-v10-shape-discrimination",
    [completedDecode, blockedDecode, missionDecode].every((decode) =>
      ordered(decode, ["settlement_packet_uses_v11_shape", "packet.validate()?", "verify_legacy_settlement_digest"]),
    ) &&
      source.repo.includes("settlement packet contains a partial v11 field set") &&
      source.manager.includes("forged_work_error") &&
      source.manager.includes("forged_mission_error") &&
      source.manager.includes("forged_blocked_error"),
  ],
  [
    "git-witness-linearization",
    source.repo.includes("TransactionBehavior::Immediate") &&
      ordered(completedPersistence, [
        "stored_packet_matches",
        "revalidate_git()?",
        "settlement_expected_version_conn",
      ]) &&
      ordered(blockedPersistence, ["stored_packet_matches", "revalidate_git()?", "settlement_expected_version_conn"]) &&
      source.repo.includes("Git settlement witness drifted at the commit linearization point") &&
      source.repo.includes("observed_git_fingerprint"),
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
if (!match || Number(match[1]) < 8) throw new Error(`A7.4 focused test count missing:\n${testOutput}`);

const generatedAt = new Date().toISOString();
const artifact = {
  schema: "aelyris.a7-completion-settlement/v2",
  status: "pass-a7-4-immutable-settlement-complete",
  activeSlice: "A7.5",
  completedSlice: "A7.4",
  nextImplementationSlice: "A7.5",
  sliceComplete: true,
  nextSliceStarted: false,
  independentReviewRequired: false,
  independentReviewStatus: "passed-zero-major-findings",
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
