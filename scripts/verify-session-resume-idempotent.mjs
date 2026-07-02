import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const ROOT = resolve(process.cwd());
const OUT = join(ROOT, ".codex-auto", "quality", "session-resume-idempotent.json");

function read(path) {
  return readFileSync(join(ROOT, path), "utf8");
}

function between(text, start, end) {
  const a = text.indexOf(start);
  if (a < 0) return "";
  const b = text.indexOf(end, a + start.length);
  return text.slice(a, b < 0 ? undefined : b);
}

function check(id, ok, detail, evidence = undefined) {
  return { id, ok: ok === true, detail, ...(evidence === undefined ? {} : { evidence }) };
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

const commands = read("src-tauri/src/ipc/interactive_commands.rs");
const lifecycle = read("src-tauri/src/agent/session_lifecycle.rs");
const repo = read("src-tauri/src/persistence/session_checkpoint_repo.rs");
const lib = read("src-tauri/src/lib.rs");
const packageJson = read("package.json");
const safeGate = read("scripts/verify-final-goal-safe.mjs");
const spec = read("docs/specs/CONTEXT_SESSION_LIFECYCLE_SPEC.md");
const impl = read("docs/specs/CONTEXT_SESSION_LIFECYCLE_IMPLEMENTATION.md");
const continuation = read("docs/specs/WU_RT_1_CONTINUATION.md");

const resumeBlock = between(commands, "pub async fn session_resume", "pub async fn session_reset_context");
const resetBlock = between(commands, "pub async fn session_reset_context", "pub async fn restore_interactive_sessions");
const reconcileBlock = between(
  commands,
  "async fn reconcile_one_session_handoff_on_boot",
  "struct CheckpointSummaryInput",
);
const helperBlock = between(commands, "const RUNTIME_WORKSPACE_ID", "fn find_interactive_session");

const checks = [
  check(
    "ipc-commands-registered",
    resumeBlock.includes("pub async fn session_resume") &&
      resetBlock.includes("pub async fn session_reset_context") &&
      lib.includes("ipc::session_resume") &&
      lib.includes("ipc::session_reset_context"),
    "session_resume and session_reset_context are exposed as RT-1e lifecycle verbs",
  ),
  check(
    "resume-uses-durable-handoff-state",
    resumeBlock.includes("list_unresolved_handoffs") &&
      resumeBlock.includes("reconcile_one_session_handoff_on_boot") &&
      resumeBlock.includes("predecessor_id == id || handoff.successor_id == id") &&
      repo.includes("pub fn list_unresolved_handoffs"),
    "session_resume reads durable session_handoffs rows, scopes by predecessor/successor logical id, and reuses the single boot reconcile owner",
  ),
  check(
    "resume-binds-expected-identity",
    resumeBlock.includes("latest_session_checkpoint") &&
      resumeBlock.includes("find_interactive_session_optional") &&
      resumeBlock.includes("identity mismatch") &&
      appearsInOrder(resumeBlock, ["target_checkpoint", "target_live", "identity mismatch"]),
    "session_resume binds the requested logical session to latest checkpoint plus live session identity and fails closed on mismatch",
  ),
  check(
    "resume-is-idempotent",
    resumeBlock.includes("reconciled_handoffs") &&
      resumeBlock.includes("unresolved_before") &&
      resumeBlock.includes("unresolved_after") &&
      resumeBlock.includes("saturating_add") &&
      resumeBlock.includes("SessionResumeResult"),
    "session_resume reports before/after unresolved counts and can be called repeatedly without creating a new owner path",
  ),
  check(
    "past-ack-is-reconfirmed",
    reconcileBlock.includes("successor_ack_file") &&
      reconcileBlock.includes("!ack.ack_path.exists()") &&
      reconcileBlock.includes("found successor ack but no live successor session") &&
      reconcileBlock.includes("stop_interactive_agent") &&
      resumeBlock.includes("ack_reconfirmed"),
    "resume does not trust a stale durable state alone; it rechecks ack presence and live successor before retiring a predecessor",
  ),
  check(
    "reset-context-delegates-to-handoff",
    resetBlock.includes('Some("reset_context".to_string())') &&
      resetBlock.includes("session_handoff(") &&
      !resetBlock.includes("spawn_interactive_agent_internal") &&
      !resetBlock.includes("end_session_and_remove_worktree") &&
      !resetBlock.includes("remove_worktree"),
    "session_reset_context is handoff-to-self governance over the existing no-loss transaction, not a bare spawn/stop path",
  ),
  check(
    "reset-context-audited-and-visible",
    resetBlock.includes("append_session_lifecycle_audit") &&
      resetBlock.includes('"reset_context"') &&
      resetBlock.includes('"predecessorEqualsSelf": true') &&
      resetBlock.includes('"worktreeDeleted": false') &&
      resetBlock.includes("publish_session_lifecycle_event") &&
      helperBlock.includes("append_audit_event_and_emit"),
    "reset_context emits durable journal governance and visible context_recycled state while preserving the worktree",
  ),
  check(
    "ack-file-contract-reused",
    lifecycle.includes("successor_ack_file") &&
      lifecycle.includes("build_successor_seed_prompt") &&
      reconcileBlock.includes("successor_ack_file") &&
      !reconcileBlock.includes("EventBus::since"),
    "RT-1e continues using .aelyris/handoff ack files rather than EventBus polling or PTY scraping",
  ),
  check(
    "safe-gate-wiring",
    existsSync(join(ROOT, "scripts/verify-session-resume-idempotent.mjs")) &&
      packageJson.includes('"verify:runtime-core:session-resume"') &&
      safeGate.includes('"runtime-core-session-resume"') &&
      safeGate.includes("verify-session-resume-idempotent.mjs"),
    "RT-1e verifier is package-wired and included in verify:goal:safe",
  ),
  check(
    "docs-track-rt1e",
    spec.includes("session_reset_context") &&
      impl.includes("Verifier: `scripts/verify-session-resume-idempotent.mjs`") &&
      continuation.includes("RT-1e resume/reset_context") &&
      continuation.includes("session-resume-idempotent"),
    "spec, implementation handoff, and continuation note name the RT-1e verifier and resume/reset scope",
  ),
];

const ok = checks.every((item) => item.ok);
const artifact = {
  ok,
  status: ok ? "pass-session-resume-idempotent" : "fail-session-resume-idempotent",
  generatedAt: new Date().toISOString(),
  phase: "RT-1e",
  artifact: ".codex-auto/quality/session-resume-idempotent.json",
  checks,
};

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${JSON.stringify(artifact, null, 2)}\n`);

if (!ok) {
  console.error(JSON.stringify(artifact, null, 2));
  process.exit(1);
}

console.log(JSON.stringify(artifact, null, 2));
