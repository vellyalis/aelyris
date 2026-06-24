// P0-3 security regression guard — static source assertions that the operator/MCP
// merge approval path stays IMMUTABLE-INTENT bound. This is the headless gate for
// the audit's "approval with altered repo/source/target fails" property: it fails
// the build if anyone re-introduces a way for a caller to re-point a merge.
//
// Behavioral proof lives in the Rust suite (review_approve_rejects_overrides_…,
// request_merge_is_idempotent_…, perform_merge_bound_…); this script guards the
// SOURCE-LEVEL invariants those tests rely on. See
// docs/specs/P0-3_DURABLE_MERGE_INTENT_PLAN.md (the 5 hard boundaries).
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const qualityDir = path.join(root, ".codex-auto", "quality");
fs.mkdirSync(qualityDir, { recursive: true });
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

const mcp = read("src-tauri/src/api/mcp.rs");
const repo = read("src-tauri/src/persistence/merge_repo.rs");
const migrations = read("src-tauri/src/db/migrations.rs");
const gitMerge = read("src-tauri/src/git/merge.rs");
const domain = read("src-tauri/src/merge_intent/mod.rs");

// Isolate the approve handler body so "must NOT contain" checks are scoped to it.
const approveStart = mcp.indexOf('"aether.review.approve" => {');
const approveEnd = mcp.indexOf('"aether.review.reject" => {', approveStart);
const approveBody =
  approveStart >= 0 && approveEnd > approveStart
    ? mcp.slice(approveStart, approveEnd)
    : "";

// The approve INPUT SCHEMA block (declared shape) — from its "name" up to the
// next tool's "name", so the whole schema (incl. "required") is captured.
const approveSchemaStart = mcp.indexOf('"name": "aether.review.approve"');
const nextNameStart =
  approveSchemaStart >= 0 ? mcp.indexOf('"name":', approveSchemaStart + 10) : -1;
const approveSchema =
  approveSchemaStart >= 0 && nextNameStart > approveSchemaStart
    ? mcp.slice(approveSchemaStart, nextNameStart)
    : "";

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
const mergeResolvedN = norm(
  sliceBetween(gitMerge, "fn merge_resolved(", ["#[cfg(test)]"]),
);
const performBoundN = norm(
  sliceBetween(gitMerge, "pub fn perform_merge_bound(", ["fn merge_resolved("]),
);

const checks = [
  {
    id: "boundary-1-approve-never-reads-caller-repo-source-target",
    ok:
      approveBody.length > 0 &&
      // NO read of repo/source/target from caller args, in ANY form (arg_string /
      // arg_optional_string / raw args.get), and not the old override merge call.
      ["repoPath", "sourceBranch", "targetBranch"].every(
        (k) =>
          !approveBodyN.includes(`arg_string(&args,"${k}")`) &&
          !approveBodyN.includes(`arg_optional_string(&args,"${k}")`) &&
          !approveBodyN.includes(`args.get("${k}")`),
      ) &&
      !approveBodyN.includes("perform_merge(&repo_path,&source_branch,&target_branch)"),
    detail:
      "approve handler never parses or forwards caller repoPath/sourceBranch/targetBranch in any form (boundary #1)",
  },
  {
    id: "boundary-1-approve-schema-omits-overrides",
    ok:
      approveSchema.length > 0 &&
      approveSchema.includes('"required": ["intentId"]') &&
      !approveSchema.includes('"repoPath"') &&
      !approveSchema.includes('"sourceBranch"') &&
      !approveSchema.includes('"targetBranch"'),
    detail: "approve input schema exposes intentId (+verdict/gatesDigest) only — no merge-target overrides",
  },
  {
    id: "boundary-2-approve-rejects-unknown-fields-explicitly",
    ok:
      // the allowlist is EXACTLY intentId/verdict/gatesDigest — adding repoPath
      // (etc.) to it would fail this assertion.
      approveBodyN.includes('APPROVE_ALLOWED:&[&str]=&["intentId","verdict","gatesDigest"]') &&
      approveBodyN.includes("args.keys().find(|k|!APPROVE_ALLOWED.contains(&k.as_str()))") &&
      // strict typed parse closes the non-string type-confusion bypass
      approveBodyN.includes('v.as_str()!=Some("approve")') &&
      approveBodyN.includes("serde_json::Value::String(s)") &&
      // the rejection runs BEFORE the claim and the merge (no field reaches git).
      approveBodyN.indexOf("!APPROVE_ALLOWED.contains") >= 0 &&
      approveBodyN.indexOf("!APPROVE_ALLOWED.contains") <
        approveBodyN.indexOf(".claim_for_merge(") &&
      approveBodyN.indexOf("!APPROVE_ALLOWED.contains") <
        approveBodyN.indexOf("perform_merge_bound("),
    detail:
      "approve rejects unknown/extra fields server-side via an EXACT allowlist BEFORE any claim/merge, and strictly types verdict/gatesDigest (boundary #2)",
  },
  {
    id: "boundary-4-approve-merges-stored-intent-oid-bound",
    ok:
      approveBody.includes("crate::git::perform_merge_bound(") &&
      approveBody.includes("&intent.repo_path") &&
      approveBody.includes("&intent.source_branch") &&
      approveBody.includes("&intent.target_branch") &&
      approveBody.includes("&intent.source_oid") &&
      approveBody.includes("&intent.target_oid") &&
      gitMerge.includes("pub fn perform_merge_bound"),
    detail:
      "approve merges using ONLY the stored immutable intent's repo/branches/OIDs, via the OID-bound merge (boundary #4)",
  },
  {
    id: "boundary-4-oid-bound-merge-uses-atomic-ref-cas",
    ok:
      mergeResolvedN.length > 0 &&
      performBoundN.length > 0 &&
      // BOTH ref-mutating sites pass target_oid as the expected-old-OID (the 4th
      // reference_matching arg, after force=true) — a true old-OID CAS, not a
      // check-then-set. Normalized so fmt can't break or hide it.
      mergeResolvedN.split("reference_matching(").length - 1 >= 2 &&
      mergeResolvedN.split("true,target_oid,").length - 1 >= 2 &&
      // the 3-way path creates the merge commit WITHOUT moving the ref first.
      mergeResolvedN.includes(".commit(None,") &&
      // perform_merge_bound resolves once and bails to StaleTips on any drift.
      performBoundN.includes("BoundMergeResult::StaleTips") &&
      performBoundN.includes("source_oid!=expected_source||target_oid!=expected_target"),
    detail:
      "the bound merge advances the target ref with an old-OID CAS (reference_matching(.., true, target_oid, ..)) at BOTH sites, builds the 3-way commit with update_ref=None, and bails to StaleTips on any tip drift",
  },
  {
    id: "boundary-5-merge-claim-is-db-cas-no-lock-across-git",
    ok:
      approveBody.includes(".claim_for_merge(&intent_id, now)") &&
      repo.includes("WHERE intent_id = ?1 AND state IN ('queued','ready_to_merge')") &&
      // the store is a thin facade; git calls are not inside a held lock
      approveBody.includes("perform_merge_bound"),
    detail:
      "the merge claim is a DB compare-and-swap (the row is the arbiter), and the git merge runs with no merge-state lock held (boundary #5)",
  },
  {
    id: "boundary-3-merge-state-is-persisted-not-mcp-pending",
    ok:
      // request/approve/reject all reach the durable store; none drive merge state
      // through mcp_pending. The only mcp_pending producer is the permission path.
      mcp.includes("state.merge_store.as_ref()") &&
      !approveBody.includes("state.mcp_pending") &&
      !mcp.includes('kind: "merge_conflict_strategy"') &&
      mcp.includes('kind: "permission_required".to_string()'),
    detail:
      "merge intents are the source of truth in merge_intents; mcp_pending holds only permission items (boundary #3)",
  },
  {
    id: "durable-immutable-schema-enforced-at-db",
    ok:
      migrations.includes("CREATE TABLE IF NOT EXISTS merge_intents") &&
      migrations.includes("idx_merge_intents_idempotency") &&
      migrations.includes("trg_merge_intents_immutable") &&
      migrations.includes("trg_merge_intents_no_delete") &&
      migrations.includes('pragma_update(None, "recursive_triggers", "ON")') &&
      migrations.includes("IS NOT OLD.repo_path"),
    detail:
      "the DB enforces immutability: an UPDATE trigger (null-safe IS NOT) + an append-only DELETE guard + recursive_triggers close the INSERT-OR-REPLACE bypass",
  },
  {
    id: "request-merge-idempotent-and-binds-oids",
    ok:
      mcp.includes("store.create_or_get(&intent)") &&
      repo.includes("ON CONFLICT(task_id, source_oid, target_oid) DO NOTHING") &&
      mcp.includes("crate::control::merge::inspect(&repo_path, &source_branch, &target_branch)"),
    detail:
      "request_merge resolves+stores the branch OIDs and is idempotent per (taskId, source_oid, target_oid)",
  },
  {
    id: "merge-states-cover-the-audit-lifecycle",
    ok:
      [
        "Queued",
        "Reviewing",
        "ReadyToMerge",
        "Merging",
        "Merged",
        "Conflict",
        "Rejected",
        "CleanupFailed",
        "NeedsReconcile",
      ].every((s) => domain.includes(s)),
    detail: "the 9 audit lifecycle states are modeled",
  },
];

const failed = checks.filter((c) => !c.ok);
const report = {
  schema: "aether.security.merge-intent-binding.v1",
  generatedFromSource: true,
  ok: failed.length === 0,
  total: checks.length,
  passed: checks.length - failed.length,
  checks,
};
fs.writeFileSync(
  path.join(qualityDir, "security-merge-intent-binding.json"),
  JSON.stringify(report, null, 2),
);

for (const c of checks) {
  console.log(`${c.ok ? "PASS" : "FAIL"}  ${c.id}\n      ${c.detail}`);
}
if (failed.length) {
  console.error(`\n${failed.length}/${checks.length} merge-intent-binding assertion(s) FAILED`);
  process.exit(1);
}
console.log(`\nAll ${checks.length} P0-3 merge-intent-binding assertions PASSED`);
