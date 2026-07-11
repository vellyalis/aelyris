import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const ROOT = resolve(process.cwd());
const OUT = join(ROOT, ".codex-auto", "quality", "session-checkpoint-restore.json");

function read(path) {
  return readFileSync(join(ROOT, path), "utf8");
}

function check(id, ok, detail) {
  return { id, ok: ok === true, detail };
}

function between(text, start, end) {
  const a = text.indexOf(start);
  if (a < 0) return "";
  const b = text.indexOf(end, a + start.length);
  return text.slice(a, b < 0 ? undefined : b);
}

const migrations = read("src-tauri/src/db/migrations.rs");
const repo = read("src-tauri/src/persistence/session_checkpoint_repo.rs");
const persistenceMod = read("src-tauri/src/persistence/mod.rs");
const lifecycle = read("src-tauri/src/agent/session_lifecycle.rs");
const contextLifecycle = read("src-tauri/src/agent/context_lifecycle.rs");
const contextTelemetry = read("src/shared/lib/contextTelemetry.ts");
const commands = read("src-tauri/src/ipc/session_lifecycle_commands.rs");
const lib = read("src-tauri/src/lib.rs");
const packageJson = read("package.json");
const safeGate = read("scripts/verify-final-goal-safe.mjs");
const checkpointCommand = between(commands, "pub fn session_checkpoint", "pub async fn restore_interactive_sessions");
const restoreBlock = between(commands, "pub async fn restore_interactive_sessions", "struct CheckpointSummaryInput");
const newVerifierScripts = [
  "scripts/verify-runtime-core-rt1a0-live.mjs",
  "scripts/verify-context-proxy.mjs",
  "scripts/verify-self-summary.mjs",
  "scripts/verify-session-checkpoint-restore.mjs",
];

const checks = [
  check(
    "migration-session-checkpoint-table",
    migrations.includes("CREATE TABLE IF NOT EXISTS session_checkpoints") &&
      migrations.includes("PRIMARY KEY (logical_session_id, checkpoint_seq)") &&
      migrations.includes("predecessor_session_id") &&
      migrations.includes("idx_session_checkpoints_lineage"),
    "SQLite migration creates idempotent checkpoints with durable lineage source-of-record",
  ),
  check(
    "migration-handoff-intent-table",
    migrations.includes("CREATE TABLE IF NOT EXISTS session_handoffs") &&
      migrations.includes("pending_summary") &&
      migrations.includes("successor_acked") &&
      migrations.includes("trg_session_handoffs_immutable") &&
      migrations.includes("trg_session_handoffs_no_delete"),
    "SQLite migration creates durable handoff intent rows with immutable defining columns and no delete",
  ),
  check(
    "repo-contract-and-idempotency",
    repo.includes("pub struct SessionCheckpointRecord") &&
      repo.includes("pub enum SessionHandoffState") &&
      repo.includes("next_checkpoint_seq") &&
      repo.includes("append_checkpoint") &&
      repo.includes("upsert_checkpoint") &&
      repo.includes("load_latest_all") &&
      repo.includes("insert_or_get_handoff") &&
      repo.includes("list_unresolved_handoffs") &&
      persistenceMod.includes("SessionCheckpointRepo"),
    "SessionCheckpointRepo owns checkpoint and handoff SQL without duplicating live session ownership",
  ),
  check(
    "repo-negative-tests",
    repo.includes("checkpoint_upsert_is_idempotent_for_same_sequence") &&
      repo.includes("handoff_intent_is_idempotent_and_stateful") &&
      repo.includes("handoff_defining_columns_are_immutable_and_rows_are_permanent"),
    "Rust tests cover idempotent checkpoint writes, durable handoff intent de-duplication, and immutable/no-delete guards",
  ),
  check(
    "sec1-no-caller-summary-path",
    checkpointCommand.includes("summary_seq: Option<u64>") &&
      !checkpointCommand.includes("summary_path: Option<String>") &&
      !checkpointCommand.includes("std::fs::read_to_string(path)") &&
      commands.includes("canonical_summary_files_for_checkpoint") &&
      commands.includes("checkpoint_summary_from_backend_file"),
    "SEC-1: session_checkpoint accepts inline summary_json or backend summary_seq only; caller-provided summary_path is gone",
  ),
  check(
    "sec1-canonical-base-validation-tests",
    lifecycle.includes("canonical_summary_files_for_checkpoint") &&
      lifecycle.includes("reject_parent_dir_components") &&
      lifecycle.includes("ensure_under_handoff_dir") &&
      lifecycle.includes("checkpoint_summary_files_are_backend_built_and_canonical") &&
      lifecycle.includes("checkpoint_summary_files_reject_parent_dir_components") &&
      lifecycle.includes("checkpoint_summary_files_require_done_marker"),
    "SEC-1: backend summary file resolution rejects parent dirs, canonicalizes, verifies .aelyris/handoff base, and has regression tests",
  ),
  check(
    "ipc-session-checkpoint-redacts-before-persist",
    commands.includes("parse_redacted_summary") &&
      checkpointCommand.includes("SessionCheckpointRepo::append_checkpoint") &&
      checkpointCommand.includes("summary_json: summary.summary_json.clone()") &&
      checkpointCommand.includes("persist_agent_identity_context") &&
      !checkpointCommand.includes("end_session_and_remove_worktree"),
    "session_checkpoint validates/redacts summary input at Rust boundary, persists checkpoint, updates existing context_usage_json, and never retires/removes worktree",
  ),
  check(
    "agent-identity-context-usage-reuse",
    commands.includes("AgentIdentityRecord") &&
      commands.includes('"schema": "aelyris.context_usage.v1"') &&
      commands.includes('"source": "session_checkpoint"') &&
      commands.includes("context_usage_json") &&
      commands.includes("upsert_agent_identity"),
    "Per-session context proxy is written to existing agent_identity_records.context_usage_json instead of a competing owner",
  ),
  check(
    "cx3-restore-does-not-resubscribe-adopted-sidecar",
    restoreBlock.includes("sidecar.list_info().await") &&
      restoreBlock.includes("live_ids.contains(&checkpoint.pty_id)") &&
      restoreBlock.includes("session_mgr.register_restored(info)") &&
      restoreBlock.includes("already wires the surviving sidecar PTY") &&
      !restoreBlock.includes("sidecar.subscribe_output") &&
      !restoreBlock.includes("run_output_monitor") &&
      lib.indexOf("ipc::adopt_sidecar_terminals") >= 0 &&
      lib.indexOf("ipc::adopt_sidecar_terminals") < lib.indexOf("ipc::restore_interactive_sessions") &&
      lib.includes("restore_interactive_sessions(&app_handle, client).await"),
    "CX-3: restore attaches session/status metadata over the stream adopted by adopt_sidecar_terminals and never re-subscribes",
  ),
  check(
    "tauri-command-registered",
    lib.includes("ipc::session_checkpoint") && commands.includes("#[tauri::command]") && commands.includes("pub fn session_checkpoint"),
    "session_checkpoint is exposed as the RT-1c lifecycle verb",
  ),
  check(
    "cx1-new-files-and-safe-gate-wired",
    existsSync(join(ROOT, "src-tauri/src/agent/context_lifecycle.rs")) &&
      existsSync(join(ROOT, "src-tauri/src/agent/session_lifecycle.rs")) &&
      existsSync(join(ROOT, "src-tauri/src/persistence/session_checkpoint_repo.rs")) &&
      existsSync(join(ROOT, "src/shared/lib/contextTelemetry.ts")) &&
      newVerifierScripts.every((path) => existsSync(join(ROOT, path))) &&
      contextLifecycle.includes("pub struct ContextRemaining") &&
      contextTelemetry.includes("normalizeContextRemaining") &&
      packageJson.includes('"verify:runtime-core:session-checkpoint"') &&
      safeGate.includes('"runtime-core-session-checkpoint"') &&
      safeGate.includes("verify-session-checkpoint-restore.mjs"),
    "CX-1: new lifecycle files, four verifier scripts, package script, and verify:goal:safe wiring are present together",
  ),
];

const ok = checks.every((item) => item.ok);
const artifact = {
  ok,
  status: ok ? "pass-session-checkpoint-restore" : "fail-session-checkpoint-restore",
  generatedAt: new Date().toISOString(),
  phase: "RT-1c",
  gates: {
    sec1: checks.find((item) => item.id === "sec1-no-caller-summary-path")?.ok === true &&
      checks.find((item) => item.id === "sec1-canonical-base-validation-tests")?.ok === true,
    cx1: checks.find((item) => item.id === "cx1-new-files-and-safe-gate-wired")?.ok === true,
    cx3: checks.find((item) => item.id === "cx3-restore-does-not-resubscribe-adopted-sidecar")?.ok === true,
  },
  checks,
};

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${JSON.stringify(artifact, null, 2)}\n`);

if (!ok) {
  console.error(JSON.stringify(artifact, null, 2));
  process.exit(1);
}

console.log(JSON.stringify(artifact, null, 2));
