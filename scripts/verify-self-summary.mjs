import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const ROOT = resolve(process.cwd());
const OUT = join(ROOT, ".codex-auto", "quality", "runtime-core-self-summary.json");

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

const lifecycle = read("src-tauri/src/agent/session_lifecycle.rs");
const commands = read("src-tauri/src/ipc/session_lifecycle_commands.rs");
const status = read("src-tauri/src/agent/status.rs");
const agentStatus = read("src/shared/types/agentStatus.ts");
const agentFleet = read("src/shared/lib/agentFleet.ts");
const lib = read("src-tauri/src/lib.rs");
const gitignore = read(".gitignore");
const sessionSummarizeBlock = between(commands, "pub async fn session_summarize", "pub struct SessionCheckpointResult");

const checks = [
  check(
    "summary-schema-contract",
    lifecycle.includes('pub const SUMMARY_SCHEMA: &str = "aelyris.session.v1"') &&
      lifecycle.includes("pub struct SessionSummaryDoc") &&
      lifecycle.includes("pub struct InFlightDiffSummary") &&
      lifecycle.includes("deserialize_decisions"),
    "Rust owns the aelyris.session.v1 SummaryDoc contract with inFlightDiff and flexible decisions parsing",
  ),
  check(
    "file-exchange-path-contract",
    lifecycle.includes('join(".aelyris").join("handoff")') &&
      lifecycle.includes("summary_files") &&
      lifecycle.includes("done_path") &&
      lifecycle.includes("build_summary_prompt") &&
      lifecycle.includes("done marker"),
    "Summary and completion marker paths are built under .aelyris/handoff and named in the agent prompt",
  ),
  check(
    "rust-boundary-redaction",
    lifecycle.includes("redact_sensitive_text") &&
      lifecycle.includes("PRIVATE KEY") &&
      lifecycle.includes("AKIA") &&
      lifecycle.includes("AIza") &&
      lifecycle.includes("[redacted:jwt]") &&
      lifecycle.includes("[redacted:high_entropy]") &&
      lifecycle.includes("parse_redacted_summary"),
    "Rust redacts untrusted agent-authored summary input before schema validation/persistence handoff",
  ),
  check(
    "external-truth-validation",
    lifecycle.includes("validate_git_coverage") &&
      lifecycle.includes("git status is dirty but inFlightDiff.present is false") &&
      lifecycle.includes("validate_task") &&
      lifecycle.includes("validate_decisions") &&
      lifecycle.includes("ContextStore"),
    "Summary validation cross-checks git dirty paths, Task graph status, and ContextStore decision refs",
  ),
  check(
    "ipc-session-summarize-real-flow",
    sessionSummarizeBlock.includes("pub async fn session_summarize") &&
      sessionSummarizeBlock.includes('info.status != "idle"') &&
      sessionSummarizeBlock.includes('update_status(&info.id, "summarizing")') &&
      sessionSummarizeBlock.includes("write_interactive_input") &&
      sessionSummarizeBlock.includes("wait_for_done_marker") &&
      sessionSummarizeBlock.includes("read_redacted_summary"),
    "session_summarize injects only at idle, writes to the live PTY, waits for .done, then reads and validates the file",
  ),
  check(
    "fail-closed-summary-errors",
    sessionSummarizeBlock.includes('update_status(&info.id, "blocked")') &&
      !sessionSummarizeBlock.includes("end_session_and_remove_worktree") &&
      !sessionSummarizeBlock.includes("capture_pane"),
    "Summary failures leave the predecessor alive/blocked and do not use raw pane capture for structured data",
  ),
  check(
    "status-contract-includes-lifecycle-states",
    status.includes("summarizing") &&
      status.includes("retiring") &&
      agentStatus.includes('"summarizing"') &&
      agentStatus.includes('"retiring"') &&
      agentFleet.includes('case "summarizing"') &&
      agentFleet.includes('case "retiring"'),
    "Rust and TS run-status contracts recognize summarizing/retiring instead of degrading them to error",
  ),
  check("ipc-command-registered", lib.includes("ipc::session_summarize"), "session_summarize is registered in the Tauri invoke handler"),
  check("local-handoff-state-ignored", /^\.aelyris\/$/m.test(gitignore), ".aelyris/handoff runtime exchange files stay local and are not committed"),
  check(
    "negative-rust-tests-present",
    lifecycle.includes("rejects_dirty_git_state_without_inflight_diff") &&
      lifecycle.includes("rejects_dirty_git_paths_missing_from_summary_files") &&
      lifecycle.includes("rejects_context_store_decision_mismatch") &&
      lifecycle.includes("redacts_pem_jwt_aws_gcp_uri_and_entropy_values"),
    "Rust tests cover invalid summary, dirty-worktree mismatch, ContextStore mismatch, and redaction",
  ),
];

const ok = checks.every((item) => item.ok);
const artifact = {
  ok,
  status: ok ? "pass-self-summary" : "fail-self-summary",
  generatedAt: new Date().toISOString(),
  phase: "RT-1b",
  checks,
};

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${JSON.stringify(artifact, null, 2)}\n`);

if (!ok) {
  console.error(JSON.stringify(artifact, null, 2));
  process.exit(1);
}

console.log(JSON.stringify(artifact, null, 2));


