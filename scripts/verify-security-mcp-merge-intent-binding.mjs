// Security regression guard for generic merge authority. Raw MCP/Tauri
// request/approve entry points are retired; the supported cockpit freezes a
// backend-owned exact candidate, reviews that immutable tree, and consumes the
// binding through the existing durable OID-bound merge owner.
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const qualityDir = path.join(root, ".codex-auto", "quality");
fs.mkdirSync(qualityDir, { recursive: true });
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

const mcp = [read("src-tauri/src/api/mcp/catalog.rs"), read("src-tauri/src/api/mcp/dispatch.rs")].join("\n");
const repo = read("src-tauri/src/persistence/merge_repo.rs");
const migrations = read("src-tauri/src/db/migrations.rs");
const gitMerge = read("src-tauri/src/git/merge.rs");
const domain = read("src-tauri/src/merge_intent/mod.rs");
const controlMerge = read("src-tauri/src/control/merge.rs");
const worktree = read("src-tauri/src/git/worktree.rs");
const reviewIpc = read("src-tauri/src/ipc/review_commands.rs");
const orchestratorIpc = read("src-tauri/src/ipc/orchestrator_commands.rs");
const loopPorts = read("src-tauri/src/control/loop_ports.rs");
const lib = read("src-tauri/src/lib.rs");

// Isolate the approve handler body so "must NOT contain" checks are scoped to it.
const approveStart = mcp.indexOf('"aelyris.review.approve" => {');
const approveEnd = mcp.indexOf('"aelyris.review.reject" => {', approveStart);
const approveBody = approveStart >= 0 && approveEnd > approveStart ? mcp.slice(approveStart, approveEnd) : "";

// The approve INPUT SCHEMA block (declared shape) — from its "name" up to the
// next tool's "name", so the whole schema (incl. "required") is captured.
const approveSchemaStart = mcp.indexOf('"name": "aelyris.review.approve"');
const nextNameStart = approveSchemaStart >= 0 ? mcp.indexOf('"name":', approveSchemaStart + 10) : -1;
const approveSchema =
  approveSchemaStart >= 0 && nextNameStart > approveSchemaStart ? mcp.slice(approveSchemaStart, nextNameStart) : "";
const requestStart = mcp.indexOf('"aelyris.request_merge" => {');
const requestEnd = mcp.indexOf('"aelyris.spawn_agent" => {', requestStart);
const requestBody = requestStart >= 0 && requestEnd > requestStart ? mcp.slice(requestStart, requestEnd) : "";

// Whitespace-insensitive match so a harmless `cargo fmt` reflow never breaks a
// security assertion (and a real regression still can't hide behind formatting).
const norm = (s) => s.replace(/\s+/g, "");
const approveBodyN = norm(approveBody);

// Isolate the OID-bound merge bodies so ref-mutation assertions are scoped.
const sliceBetween = (src, from, toMarkers) => {
  const start = src.indexOf(from);
  if (start < 0) return "";
  let end = src.length;
  for (const m of toMarkers) {
    const i = src.indexOf(m, start + from.length);
    if (i >= 0 && i < end) end = i;
  }
  return src.slice(start, end);
};
const approveHelper = sliceBetween(controlMerge, "pub fn approve_durable_intent(", ["/// Serialized merge queue"]);
const mergeResolvedN = norm(sliceBetween(gitMerge, "fn merge_resolved(", ["#[cfg(test)]"]));
const performBoundN = norm(sliceBetween(gitMerge, "pub fn perform_merge_bound(", ["fn merge_resolved("]));

const checks = [
  {
    id: "raw-mcp-request-and-approve-are-retired-before-side-effects",
    ok:
      requestBody.includes("aelyris.request_merge is retired") &&
      approveBody.includes("aelyris.review.approve is retired") &&
      !requestBody.includes("merge_store") &&
      !requestBody.includes("create_or_get") &&
      !approveBody.includes("approve_durable_intent") &&
      !approveBody.includes("perform_merge"),
    detail:
      "legacy MCP request/approve names fail closed before repository, store, claim, or merge effects",
  },
  {
    id: "raw-approve-schema-has-no-target-overrides",
    ok:
      approveSchema.length > 0 &&
      approveSchema.includes('"required": ["intentId"]') &&
      !approveSchema.includes('"repoPath"') &&
      !approveSchema.includes('"sourceBranch"') &&
      !approveSchema.includes('"targetBranch"'),
    detail: "the retired compatibility schema exposes no repository or branch override",
  },
  {
    id: "tauri-raw-request-and-approve-commands-are-unregistered",
    ok:
      !lib.includes("ipc::request_merge_intent") &&
      !lib.includes("ipc::approve_merge_intent") &&
      !read("src-tauri/src/ipc/merge_commands.rs").includes("pub fn request_merge_intent") &&
      !read("src-tauri/src/ipc/merge_commands.rs").includes("pub fn approve_merge_intent"),
    detail: "the desktop face cannot invoke a raw merge request or raw approval command",
  },
  {
    id: "candidate-freeze-validates-dirty-and-every-introduced-commit",
    ok:
      worktree.includes("fn ensure_worktree_changes_are_owned(") &&
      worktree.includes("fn validate_owned_commit_history(") &&
      worktree.includes("fn require_fast_forward_candidate(") &&
      worktree.includes("rebase onto the current target and run fresh review") &&
      worktree.includes("walk.hide(target)") &&
      worktree.includes("candidate commit history contains undeclared path") &&
      worktree.includes("cockpit_candidate_rejects_undeclared_paths_added_then_deleted_in_history"),
    detail:
      "candidate freeze rejects undeclared dirty files and every undeclared path in introduced commit history, including add-then-delete cases",
  },
  {
    id: "review-runs-on-clean-exact-candidate-and-immutable-diff",
    ok:
      reviewIpc.includes("freeze_owned_worktree_candidate(") &&
      reviewIpc.includes("diff_between_oids(") &&
      reviewIpc.includes("DetachedReviewWorktree::create(") &&
      reviewIpc.includes("review::detect_gate_commands(detached.path())") &&
      reviewIpc.includes("review::review_branch(&input, review::spawn_run") &&
      gitMerge.includes("semantic-review limit") &&
      gitMerge.includes("if !allow_truncation"),
    detail:
      "deterministic gates and semantic review consume a clean detached checkout and complete diff rendered from fixed OIDs; truncation cannot authorize merge",
  },
  {
    id: "review-binding-never-roundtrips-through-frontend",
    ok:
      orchestratorIpc.includes("pub async fn orchestrator_review_and_merge(") &&
      orchestratorIpc.includes("review_task_candidate(") &&
      orchestratorIpc.includes("review_bindings.insert(task_id.clone(), reviewed.binding)") &&
      loopPorts.includes("pub struct ReviewedCandidateBinding") &&
      loopPorts.includes("request_durable_intent_bound(") &&
      loopPorts.includes("inspect_owned_candidate_at_oids("),
    detail:
      "reviewed source/target OIDs, reviewer identity, gates, and digest remain in-process until the bound intent is consumed",
  },
  {
    id: "internal-durable-intent-and-merge-stay-oid-bound",
    ok:
      controlMerge.includes("pub fn request_durable_intent_bound(") &&
      controlMerge.includes("readiness.source_oid != expected_source_oid") &&
      approveHelper.includes(".claim_for_merge(intent_id, now)") &&
      approveHelper.includes("crate::git::perform_merge_bound(") &&
      approveHelper.includes("&intent.source_oid") &&
      approveHelper.includes("&intent.target_oid"),
    detail:
      "the internal durable intent rechecks reviewed OIDs, CAS-claims the row, and merges only the stored source/target commits",
  },
  {
    id: "oid-bound-merge-uses-atomic-ref-cas",
    ok:
      mergeResolvedN.length > 0 &&
      performBoundN.length > 0 &&
      mergeResolvedN.split("reference_matching(").length - 1 >= 2 &&
      mergeResolvedN.split("true,target_oid,").length - 1 >= 2 &&
      mergeResolvedN.includes(".commit(None,") &&
      performBoundN.includes("BoundMergeResult::StaleTips") &&
      performBoundN.includes("source_oid!=expected_source||target_oid!=expected_target"),
    detail:
      "both target-ref mutation sites use old-OID CAS and any branch drift yields StaleTips",
  },
  {
    id: "merge-state-remains-durable-and-immutable",
    ok:
      repo.includes("WHERE intent_id = ?1 AND state IN ('queued','ready_to_merge')") &&
      repo.includes("ON CONFLICT(task_id, source_oid, target_oid) DO NOTHING") &&
      migrations.includes("CREATE TABLE IF NOT EXISTS merge_intents") &&
      migrations.includes("idx_merge_intents_idempotency") &&
      migrations.includes("trg_merge_intents_immutable") &&
      migrations.includes("trg_merge_intents_no_delete") &&
      migrations.includes('pragma_update(None, "recursive_triggers", "ON")'),
    detail: "merge_intents remains the append-only, idempotent, DB-CAS source of truth",
  },
  {
    id: "merge-states-cover-the-audit-lifecycle",
    ok: [
      "Queued",
      "Reviewing",
      "ReadyToMerge",
      "Merging",
      "Merged",
      "Conflict",
      "Rejected",
      "CleanupFailed",
      "NeedsReconcile",
    ].every((state) => domain.includes(state)),
    detail: "the 9 audit lifecycle states remain modeled for internal authority and recovery",
  },
];

const failed = checks.filter((c) => !c.ok);
const report = {
  schema: "aelyris.security.merge-intent-binding.v1",
  generatedFromSource: true,
  ok: failed.length === 0,
  total: checks.length,
  passed: checks.length - failed.length,
  checks,
};
fs.writeFileSync(path.join(qualityDir, "security-merge-intent-binding.json"), JSON.stringify(report, null, 2));

for (const c of checks) {
  console.log(`${c.ok ? "PASS" : "FAIL"}  ${c.id}\n      ${c.detail}`);
}
if (failed.length) {
  console.error(`\n${failed.length}/${checks.length} merge-intent-binding assertion(s) FAILED`);
  process.exit(1);
}
console.log(`\nAll ${checks.length} P0-3 merge-intent-binding assertions PASSED`);
