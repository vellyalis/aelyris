import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createEvidenceProvenance } from "./evidence-provenance.mjs";

const root = resolve(process.cwd());
const read = (path) => readFileSync(join(root, path), "utf8");
const state = read("src-tauri/src/startup_reconciliation.rs");
const lib = read("src-tauri/src/lib.rs");
const terminal = read("src-tauri/src/ipc/commands.rs");
const interactive = read("src-tauri/src/ipc/interactive_commands.rs");
const ptyManager = read("src-tauri/src/pty/manager.rs");
const migrations = read("src-tauri/src/db/migrations.rs");
const queries = read("src-tauri/src/db/queries.rs");
const checkpointRepo = read("src-tauri/src/persistence/session_checkpoint_repo.rs");
const interactiveManager = read("src-tauri/src/agent/interactive.rs");
const lifecycle = read("src-tauri/src/ipc/session_lifecycle_commands.rs");
const packageJson = JSON.parse(read("package.json"));

const adoption = lib.indexOf("ipc::adopt_sidecar_terminals");
const restore = lib.indexOf("ipc::restore_interactive_sessions");
const reconcile = lib.indexOf("ipc::reconcile_session_handoffs_on_boot");
const ready = lib.indexOf("state.complete(adopted, restored, reconciled)");

const checks = {
  numberedSchemaVersion:
    migrations.includes("CURRENT_SCHEMA_VERSION: i64 = 2") &&
    migrations.includes('pragma_update(None, "user_version", 1)') &&
    migrations.includes('pragma_update(None, "user_version", 2)') &&
    migrations.includes('execute_batch("BEGIN IMMEDIATE")') &&
    migrations.includes('execute_batch("ROLLBACK")'),
  newerSchemaFailsClosed:
    migrations.includes("version > CURRENT_SCHEMA_VERSION") &&
    migrations.includes("newer_schema_is_rejected_without_mutation"),
  legacyBackupBeforeMigration:
    queries.includes("create_pre_migration_backup(&conn, path)?") &&
    queries.includes('query_row("PRAGMA quick_check"') &&
    queries.includes('conn.execute("VACUUM INTO ?1"') &&
    queries.includes("file_open_backs_up_legacy_schema_once_before_versioned_migration"),
  typedStartupOwner:
    state.includes("pub enum StartupReconciliationPhase") &&
    state.includes("pub struct StartupReconciliationReport") &&
    state.includes("pub struct StartupReconciliationState"),
  terminalStartupTransitions:
    state.includes("failure_is_terminal_and_cannot_be_overwritten_by_late_success") &&
    state.includes("timeout_fails_only_a_pending_state"),
  boundedStartup:
    state.includes("STARTUP_RECONCILIATION_TIMEOUT_SECS: u64 = 15") &&
    lib.includes("fail_if_pending()"),
  reconciliationOrder:
    adoption >= 0 && adoption < restore && restore < reconcile && reconcile < ready,
  databaseReadinessPrecedesCompletion:
    lib.indexOf(".mark_database_ready()") >= 0 &&
    lib.indexOf(".mark_database_ready()") < adoption &&
    state.includes("cannot complete before database readiness"),
  allSpawnFacesFailClosed:
    terminal.match(/require_spawn_admitted\(\)\?/g)?.length >= 2 &&
    interactive.includes("require_spawn_admitted()?") &&
    ptyManager.includes("with_startup_reconciliation") &&
    ptyManager.includes("state.require_spawn_admitted()?") &&
    lib.includes("with_startup_reconciliation(startup_reconciliation.clone())") &&
    state.includes("startup_reconciliation_pending") &&
    state.includes("startup_reconciliation_failed") &&
    state.includes("production_pty_owner_rejects_spawn_before_reconciliation"),
  typedStatusIsPublished:
    terminal.includes("pub fn startup_reconciliation_status") &&
    lib.includes("ipc::startup_reconciliation_status"),
  approvalCheckpointSchema:
    migrations.includes("ALTER TABLE session_checkpoints ADD COLUMN approval_prompt TEXT") &&
    checkpointRepo.includes("pub approval_prompt: Option<String>") &&
    lifecycle.includes("approval_prompt: checkpoint.approval_prompt.clone()") &&
    migrations.includes("version_one_upgrades_to_approval_checkpoint_schema"),
  automaticMutationCheckpointing:
    interactiveManager.includes("attach_checkpoint_db") &&
    checkpointRepo.includes("pub fn append_checkpoint") &&
    interactiveManager.includes("SessionCheckpointRepo::append_checkpoint") &&
    lifecycle.includes("SessionCheckpointRepo::append_checkpoint") &&
    interactiveManager.includes("self.persist_snapshot(&info)?") &&
    interactiveManager.includes("self.persist_snapshot(session)?") &&
    interactiveManager.includes("self.persist_snapshot(&candidate)?") &&
    interactiveManager.includes(
      "durable_mutations_append_identity_status_lineage_and_approval_checkpoints",
    ),
  mutationFailureRollsBack:
    interactiveManager.includes("checkpoint_failure_rolls_back_in_memory_mutation") &&
    interactiveManager.includes("persist interactive session checkpoint") &&
    interactive.includes("close_interactive_pty(&app, &pty_id).await"),
  packageEntryPoint:
    packageJson.scripts?.["verify:a4:durability"] ===
    "node scripts/verify-a4-durability-contract.mjs",
};

const failures = Object.entries(checks)
  .filter(([, passed]) => !passed)
  .map(([name]) => name);
if (failures.length > 0) {
  throw new Error(`A4 durability contract failed: ${failures.join(", ")}`);
}

const generatedAt = new Date().toISOString();
const output = join(root, ".codex-auto", "quality", "a4-durability-contract.json");
const report = {
  schema: "aelyris.a4-durability-contract/v1",
  status: "pass-a4.2-a4.4-foundation",
  activeSlice: "A4.4",
  phaseComplete: false,
  remainingSlices: ["A4.5", "A4.6"],
  checks,
  generatedAt,
  provenance: createEvidenceProvenance({
    root,
    verifierPath: "scripts/verify-a4-durability-contract.mjs",
    inputPaths: [
      "scripts/evidence-provenance.mjs",
      "src-tauri/src/startup_reconciliation.rs",
      "src-tauri/src/lib.rs",
      "src-tauri/src/ipc/commands.rs",
      "src-tauri/src/ipc/interactive_commands.rs",
      "src-tauri/src/pty/manager.rs",
      "src-tauri/src/db/migrations.rs",
      "src-tauri/src/db/queries.rs",
      "src-tauri/src/persistence/session_checkpoint_repo.rs",
      "src-tauri/src/agent/interactive.rs",
      "src-tauri/src/ipc/session_lifecycle_commands.rs",
      "package.json",
    ],
    generatedAt,
  }),
};
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ artifact: output, ...report }, null, 2));
