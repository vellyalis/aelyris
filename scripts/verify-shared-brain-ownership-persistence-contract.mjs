import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const ROOT = resolve(process.cwd());
const OUT = join(ROOT, ".codex-auto", "quality", "shared-brain-ownership-persistence-contract.json");

function read(rel) {
  return readFileSync(join(ROOT, rel), "utf8");
}

function compact(text) {
  return text.replace(/\s+/g, "");
}

function between(source, start, endMarkers = []) {
  const startIndex = source.indexOf(start);
  if (startIndex < 0) return "";
  let endIndex = source.length;
  for (const marker of endMarkers) {
    const markerIndex = source.indexOf(marker, startIndex + start.length);
    if (markerIndex >= 0 && markerIndex < endIndex) endIndex = markerIndex;
  }
  return source.slice(startIndex, endIndex);
}

function check(id, ok, detail, evidence = {}) {
  return { id, ok: Boolean(ok), detail, evidence };
}

const sharedBrain = read("src-tauri/src/shared_brain.rs");
const ownershipRepo = read("src-tauri/src/persistence/ownership_repo.rs");
const persistenceMod = read("src-tauri/src/persistence/mod.rs");
const migrations = read("src-tauri/src/db/migrations.rs");
const lib = read("src-tauri/src/lib.rs");
const ipcMod = read("src-tauri/src/ipc/mod.rs");
const ipcSharedBrain = read("src-tauri/src/ipc/shared_brain_commands.rs");
const ipcOwnership = read("src-tauri/src/ipc/ownership_commands.rs");
const ipcSymbol = read("src-tauri/src/ipc/symbol_ownership_commands.rs");
const loopPorts = read("src-tauri/src/control/loop_ports.rs");
const mcp = read("src-tauri/src/api/mcp.rs");
const restartReplay = read("scripts/verify-shared-brain-restart-replay.mjs");
const fileOwnership = read("src-tauri/src/file_ownership/mod.rs");
const symbolOwnership = read("src-tauri/src/symbol_ownership/mod.rs");

const mcpSnapshotArm = between(mcp, '"aether.shared_brain.snapshot" => {', ['"aether.ownership.assign" => {']);
const mcpSymbolClaimArm = between(mcp, '"aether.symbol.claim" => {', ['"aether.symbol.refresh" => {']);
const mcpDiffArm = between(mcp, '"aether.symbol.claim_from_diff" => {', ['"aether.symbol.claim_from_source" => {']);
const mcpSourceArm = between(mcp, '"aether.symbol.claim_from_source" => {', ['"aether.context.set" => {']);
const ipcSymbolClaim = between(ipcSymbol, "pub fn symbol_claim(", ["/// Extend a live claim"]);
const applyFileLanes = between(loopPorts, "fn apply_file_lanes(", ["/// Release a task's SYMBOL claims"]);
const restoreOwnership = between(lib, "fn restore_ownership(", ["let db_path = db::db_path();"]);

const checks = [
  check(
    "shared-brain-snapshot-aggregates-runtime-state",
    sharedBrain.includes("pub struct SharedBrainSnapshot") &&
      sharedBrain.includes("pub struct SharedBrainInputs") &&
      sharedBrain.includes("SharedBrainMergeIntent") &&
      sharedBrain.includes("blockers_from_events") &&
      sharedBrain.includes("context_store") &&
      sharedBrain.includes("file_ownership") &&
      sharedBrain.includes("symbol_ownership") &&
      sharedBrain.includes("merge_store"),
    "SharedBrainSnapshot is a backend formatter over agents, ownership, merge intents, blockers, and decisions.",
  ),
  check(
    "shared-brain-ipc-is-registered",
    ipcSharedBrain.includes("pub fn shared_brain_snapshot(") &&
      ipcSharedBrain.includes("snapshot(SharedBrainInputs") &&
      ipcMod.includes("mod shared_brain_commands;") &&
      ipcMod.includes("pub use shared_brain_commands::*;") &&
      lib.includes("ipc::shared_brain_snapshot"),
    "Tauri IPC exposes shared_brain_snapshot through the same backend formatter.",
  ),
  check(
    "shared-brain-mcp-is-registered-and-delegates",
    mcp.includes('"aether.shared_brain.snapshot"') &&
      mcpSnapshotArm.includes("crate::shared_brain::snapshot") &&
      mcpSnapshotArm.includes("SharedBrainInputs") &&
      mcpSnapshotArm.includes("state.merge_store.as_ref()") &&
      mcpSnapshotArm.includes("state.context_store.as_ref()"),
    "MCP advertises and executes aether.shared_brain.snapshot through the backend formatter.",
  ),
  check(
    "ownership-core-supports-restore-without-io",
    fileOwnership.includes("pub fn hydrate(&mut self, claims: Vec<OwnershipClaim>)") &&
      fileOwnership.includes("pub fn snapshot(&self) -> Vec<OwnershipClaim>") &&
      fileOwnership.includes("pub fn expire(&mut self, now: u64)") &&
      symbolOwnership.includes("pub fn hydrate(&mut self, claims: Vec<SymbolClaim>, now: u64)") &&
      symbolOwnership.includes("pub fn snapshot(&self) -> Vec<SymbolClaim>") &&
      symbolOwnership.includes("#[derive(Debug, Default, Clone)]"),
    "FileOwnership and SymbolOwnership remain pure cores with hydrate/snapshot helpers for persistence.",
  ),
  check(
    "ownership-schema-is-migrated",
    migrations.includes("CREATE TABLE IF NOT EXISTS file_ownership_claims") &&
      migrations.includes("CREATE TABLE IF NOT EXISTS symbol_ownership_claims") &&
      migrations.includes("idx_file_ownership_agent_pattern") &&
      migrations.includes("idx_symbol_ownership_lease") &&
      migrations.includes("INSERT INTO file_ownership_claims") &&
      migrations.includes("INSERT INTO symbol_ownership_claims"),
    "SQLite migrations create and smoke-test file/symbol ownership tables and indexes.",
  ),
  check(
    "ownership-repo-roundtrip-and-reconcile-contracts-exist",
    persistenceMod.includes("pub mod ownership_repo;") &&
      persistenceMod.includes("pub use ownership_repo::OwnershipRepo;") &&
      ownershipRepo.includes("pub fn load_file_claims") &&
      ownershipRepo.includes("pub fn upsert_file_claim") &&
      ownershipRepo.includes("pub fn load_symbol_claims") &&
      ownershipRepo.includes("pub fn upsert_symbol_claim") &&
      ownershipRepo.includes("pub fn reconcile_symbol_claims") &&
      ownershipRepo.includes("BEGIN IMMEDIATE") &&
      ownershipRepo.includes("fresh_owners_hydrate_from_same_database_like_restart") &&
      ownershipRepo.includes("expired_claims_are_pruned_before_restore"),
    "OwnershipRepo owns load/upsert/prune/reconcile SQL and tests restart-style restore plus expiry.",
  ),
  check(
    "startup-restores-ownership-from-db",
    restoreOwnership.includes("OwnershipRepo::load_file_claims") &&
      restoreOwnership.includes("OwnershipRepo::load_symbol_claims") &&
      restoreOwnership.includes("owner.hydrate(claims)") &&
      restoreOwnership.includes("owner.hydrate(claims, now)") &&
      lib.includes("restore_ownership(app.handle(), &managed);"),
    "Tauri setup restores durable file/symbol ownership into live state during DB initialization.",
  ),
  check(
    "mcp-ownership-fails-closed-without-db",
    mcp.includes("fn ownership_db(state: &ApiState)") &&
      mcp.includes("ownership persistence is not attached to this process") &&
      mcp.includes("OwnershipRepo::upsert_file_claim") &&
      mcp.includes("OwnershipRepo::prune_expired"),
    "MCP ownership tools require an attached ManagedDb instead of reporting RAM-only success.",
  ),
  check(
    "mcp-symbol-claims-use-staging-and-durable-reconcile",
    mcpSymbolClaimArm.includes("let mut staging = owner.clone()") &&
      mcpSymbolClaimArm.includes("OwnershipRepo::upsert_symbol_claim") &&
      mcpSymbolClaimArm.includes("*owner = staging") &&
      mcpDiffArm.includes("reconcile_symbol_claims") &&
      mcpDiffArm.includes("delete_claim_ids") &&
      mcpSourceArm.includes("reconcile_symbol_claims") &&
      mcpSourceArm.includes("reconcile_prefix"),
    "MCP symbol claim/update paths stage memory changes and commit them only after durable SQL succeeds.",
    {
      symbolClaimArmLength: compact(mcpSymbolClaimArm).length,
      diffArmLength: compact(mcpDiffArm).length,
      sourceArmLength: compact(mcpSourceArm).length,
    },
  ),
  check(
    "ipc-ownership-tools-are-write-through",
    ipcOwnership.includes("State<'_, ManagedDb>") &&
      ipcOwnership.includes("OwnershipRepo::upsert_file_claim") &&
      ipcOwnership.includes("OwnershipRepo::prune_expired") &&
      ipcSymbol.includes("State<'_, ManagedDb>") &&
      ipcSymbolClaim.includes("let mut staging = owner.clone()") &&
      ipcSymbol.includes("OwnershipRepo::upsert_symbol_claim") &&
      ipcSymbol.includes("OwnershipRepo::delete_symbol_claims_for_task"),
    "Tauri IPC ownership tools use the same durable repo and staging pattern as MCP.",
  ),
  check(
    "autonomy-loop-file-lanes-are-write-through",
    applyFileLanes.includes("OwnershipClaim::new") &&
      applyFileLanes.includes("claim.task_id = Some(id.clone())") &&
      applyFileLanes.includes("OwnershipRepo::upsert_file_claim") &&
      applyFileLanes.includes("OwnershipRepo::delete_file_claims_for_task") &&
      applyFileLanes.includes("OwnershipRepo::delete_file_claim") &&
      applyFileLanes.includes("file ownership lane persist failed") &&
      loopPorts.includes("apply_file_lanes(ownership, events, &lanes, &report, db)"),
    "Autonomy-loop dispatch/merge file lanes write through OwnershipRepo and surface durability failures.",
  ),
  check(
    "restart-replay-live-verifier-exists",
    restartReplay.includes("--phase seed") &&
      restartReplay.includes("--phase verify") &&
      restartReplay.includes("aether.shared_brain.snapshot") &&
      restartReplay.includes("aether.ownership.claims") &&
      restartReplay.includes("aether.symbol.claims") &&
      restartReplay.includes("aether.event.since"),
    "A two-phase live restart replay verifier exists for shared brain, ownership, and durable events.",
  ),
];

const failed = checks.filter((item) => !item.ok);
const report = {
  schema: "aether.shared-brain-ownership-persistence-contract/v1",
  version: 1,
  generatedAt: new Date().toISOString(),
  ok: failed.length === 0,
  total: checks.length,
  passed: checks.length - failed.length,
  failed: failed.map((item) => item.id),
  checks,
  knownGaps: [
    {
      id: "live-restart-replay-not-yet-automated",
      severity: "review",
      detail:
        "A two-phase live verifier exists, but it still requires an operator-controlled app restart between seed and verify.",
    },
    {
      id: "loop-file-lane-errors-are-evented-not-step-fatal",
      severity: "review",
      detail:
        "Autonomy-loop file lane persistence now writes through the repo, but StepReport is not yet fallible; DB write errors are surfaced through tracing and blocker events while live lane state is maintained.",
    },
  ],
};

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`);

for (const item of checks) {
  console.log(`${item.ok ? "PASS" : "FAIL"}  ${item.id}`);
  console.log(`      ${item.detail}`);
}
if (report.knownGaps.length > 0) {
  console.log("\nKnown review gaps:");
  for (const gap of report.knownGaps) console.log(`REVIEW ${gap.id}: ${gap.detail}`);
}
if (failed.length > 0) {
  console.error(`\n${failed.length}/${checks.length} shared-brain ownership assertion(s) FAILED`);
  process.exit(1);
}
console.log(`\nAll ${checks.length} shared-brain ownership persistence assertions PASSED`);
