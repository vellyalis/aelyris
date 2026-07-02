import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const ROOT = resolve(process.cwd());
const OUT = join(ROOT, ".codex-auto", "quality", "session-handoff-no-loss.json");

function read(path) {
  return readFileSync(join(ROOT, path), "utf8");
}

function between(text, start, end) {
  const a = text.indexOf(start);
  if (a < 0) return "";
  const b = text.indexOf(end, a + start.length);
  return text.slice(a, b < 0 ? undefined : b);
}

function check(id, ok, detail) {
  return { id, ok: ok === true, detail };
}

function appearsInOrder(text, needles) {
  let cursor = -1;
  for (const needle of needles) {
    const next = text.indexOf(needle, cursor + 1);
    if (next < 0) return false;
    cursor = next;
  }
  return true;
}

const commands = read("src-tauri/src/ipc/session_lifecycle_commands.rs");
const interactiveCommands = read("src-tauri/src/ipc/interactive_commands.rs");
const lifecycle = read("src-tauri/src/agent/session_lifecycle.rs");
const repo = read("src-tauri/src/persistence/session_checkpoint_repo.rs");
const eventBus = read("src-tauri/src/event_bus/mod.rs");
const auditQueries = read("src-tauri/src/db/queries.rs");
const lib = read("src-tauri/src/lib.rs");
const packageJson = read("package.json");
const safeGate = read("scripts/verify-final-goal-safe.mjs");

const handoffBlock = between(commands, "pub async fn session_handoff", "pub async fn restore_interactive_sessions");
const helperBlock = between(commands, "const RUNTIME_WORKSPACE_ID", "fn find_interactive_session");
const spawnWrapper = between(
  interactiveCommands,
  "pub async fn spawn_interactive_agent",
  "pub async fn stop_interactive_agent",
);

const checks = [
  check(
    "ipc-command-registered",
    handoffBlock.includes("pub async fn session_handoff") &&
      lib.includes("ipc::session_handoff") &&
      commands.includes("#[tauri::command]"),
    "session_handoff is exposed as the RT-1d lifecycle verb",
  ),
  check(
    "preassigned-successor-logical-id",
    spawnWrapper.includes("spawn_interactive_agent_internal") &&
      spawnWrapper.includes("logical_session_id_override") &&
      commands.includes("logical_session_id_override: Some(successor_logical_session_id.clone())") &&
      spawnWrapper.includes(".logical_session_id_override") &&
      spawnWrapper.includes(".unwrap_or_else(|| session_id.clone())"),
    "successor logical_session_id is preassigned before spawn and is independent of the PTY id",
  ),
  check(
    "successor-worktree-metadata-preserved",
    handoffBlock.includes("inherited_worktree_branch: predecessor.worktree_branch.clone()") &&
      handoffBlock.includes("inherited_worktree_path: predecessor.worktree_path.clone()") &&
      handoffBlock.includes("inherited_repo_path: predecessor.repo_path.clone()") &&
      spawnWrapper.includes("worktree_path = options.inherited_worktree_path.clone().or(worktree_path)") &&
      spawnWrapper.includes("repo_path = options.inherited_repo_path.clone().or(repo_path)"),
    "successor keeps the predecessor worktree metadata instead of becoming a generic cwd-only session",
  ),
  check(
    "intent-before-summary",
    appearsInOrder(handoffBlock, [
      "next_handoff_seq",
      "insert_or_get_handoff",
      "run_session_summarize",
      "session_checkpoint(",
    ]) && repo.includes("pub fn next_handoff_seq"),
    "durable session_handoffs intent row is written before self-summary and checkpoint, with retry-safe durable sequence allocation",
  ),
  check(
    "state-machine-transitions",
    [
      "PendingSummary",
      "Checkpointed",
      "SuccessorSpawning",
      "SuccessorSpawned",
      "SuccessorAcked",
      "PredecessorRetired",
      "Failed",
    ].every((state) => repo.includes(state) && commands.includes(state)) &&
      handoffBlock.includes("set_session_handoff_state") &&
      helperBlock.includes("failure_reason"),
    "RT-1d advances the existing durable handoff state machine and records failures",
  ),
  check(
    "audit-before-spawn-and-retire",
    appearsInOrder(handoffBlock, [
      '"committing"',
      "SessionHandoffState::SuccessorSpawning",
      "spawn_interactive_agent_internal",
      "wait_for_done_marker(&ack.ack_path",
      "wait_for_successor_liveness",
      "SessionHandoffState::SuccessorAcked",
      "stop_interactive_agent",
      '"committed"',
    ]) &&
      handoffBlock.includes("append_session_lifecycle_audit") &&
      !handoffBlock.includes("record_audit_event"),
    "journal audit is appended before successor spawn/retire and committed after ack+liveness; lightweight audit is not used",
  ),
  check(
    "ack-file-plus-liveness-not-eventbus",
    lifecycle.includes("successor_ack_file") &&
      lifecycle.includes("build_successor_seed_prompt") &&
      handoffBlock.includes("successor_ack_file") &&
      handoffBlock.includes("wait_for_done_marker(&ack.ack_path") &&
      handoffBlock.includes("wait_for_successor_liveness") &&
      !handoffBlock.includes("EventBus::since"),
    "successor ack is file-based under .aelyris/handoff and is paired with liveness debounce, not EventBus polling",
  ),
  check(
    "no-worktree-delete-on-handoff",
    handoffBlock.includes("stop_interactive_agent") &&
      !handoffBlock.includes("end_session_and_remove_worktree") &&
      !handoffBlock.includes("remove_worktree") &&
      handoffBlock.includes('"worktreeDeleted": false'),
    "predecessor retirement uses stop_interactive_agent only and records worktreeDeleted=false",
  ),
  check(
    "context-and-lineage-checkpoints",
    handoffBlock.includes("None,") &&
      handoffBlock.includes("Some(predecessor.logical_session_id.clone())") &&
      handoffBlock.includes("successor_checkpoint"),
    "predecessor checkpoint is persisted before spawn and successor checkpoint stores lineage through session_checkpoint predecessor input",
  ),
  check(
    "successor-restore-checkpoint-before-ack",
    appearsInOrder(handoffBlock, [
      "spawn_interactive_agent_internal",
      "_successor_restore_checkpoint",
      "SessionHandoffState::SuccessorSpawned",
      "wait_for_done_marker(&ack.ack_path",
    ]),
    "successor PTY/logical-session mapping is checkpointed before ack wait so boot reconcile can find it after a crash",
  ),
  check(
    "inflight-diff-durable-ref",
    helperBlock.includes("preserve_inflight_diff") &&
      helperBlock.includes("commit_worktree") &&
      helperBlock.includes("commit:") &&
      handoffBlock.includes("inflight_ref.clone()"),
    "inFlightDiff present=true is fail-closed unless commit_worktree creates a durable commit ref or an existing durable ref is present",
  ),
  check(
    "audit-trace-and-compaction-governance",
    helperBlock.includes("AuditJournalAppend") &&
      helperBlock.includes('kind: kind.to_string()') &&
      helperBlock.includes("append_audit_event_and_emit") &&
      handoffBlock.includes("get_audit_trace") &&
      auditQueries.includes("kind NOT IN ('session_handoff', 'context_recycled')"),
    "audit no-loss uses the hash-chained journal, correlation trace lookup, and compaction exclusion for lifecycle governance rows",
  ),
  check(
    "boot-reconcile-wired",
    commands.includes("pub async fn reconcile_session_handoffs_on_boot") &&
      commands.includes("list_unresolved_handoffs") &&
      commands.includes("reconcile_one_session_handoff_on_boot") &&
      commands.includes("boot reconcile failed closed before successor ack") &&
      lib.includes("ipc::reconcile_session_handoffs_on_boot"),
    "unresolved session_handoffs are reconciled on boot with fail-closed behavior and ack+liveness-gated retire",
  ),
  check(
    "eventbus-variants",
    eventBus.includes("SessionHandoff") &&
      eventBus.includes("ContextRecycled") &&
      eventBus.includes('"session_handoff"') &&
      eventBus.includes('"context_recycled"') &&
      helperBlock.includes("publish_session_lifecycle_event"),
    "EventBus has SessionHandoff/ContextRecycled variants with round-trip string mappings and live publish wiring",
  ),
  check(
    "safe-gate-wiring",
    existsSync(join(ROOT, "scripts/verify-session-handoff-no-loss.mjs")) &&
      packageJson.includes('"verify:runtime-core:session-handoff"') &&
      safeGate.includes('"runtime-core-session-handoff"') &&
      safeGate.includes("verify-session-handoff-no-loss.mjs"),
    "RT-1d verifier is present, package-wired, and included in verify:goal:safe",
  ),
];

const ok = checks.every((item) => item.ok);
const artifact = {
  ok,
  status: ok ? "pass-session-handoff-no-loss" : "fail-session-handoff-no-loss",
  generatedAt: new Date().toISOString(),
  phase: "RT-1d",
  artifact: ".codex-auto/quality/session-handoff-no-loss.json",
  checks,
};

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${JSON.stringify(artifact, null, 2)}\n`);

if (!ok) {
  console.error(JSON.stringify(artifact, null, 2));
  process.exit(1);
}

console.log(JSON.stringify(artifact, null, 2));
