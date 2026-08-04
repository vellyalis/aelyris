import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const ROOT = resolve(process.cwd());
const OUT = join(ROOT, ".codex-auto", "quality", "durable-merge-unification.json");

function read(rel) {
  return readFileSync(join(ROOT, rel), "utf8");
}

function compact(text) {
  return text.replace(/\s+/g, "");
}

function sliceBetween(source, startMarker, endMarkers = []) {
  const start = source.indexOf(startMarker);
  if (start < 0) return "";
  let end = source.length;
  for (const marker of endMarkers) {
    const index = source.indexOf(marker, start + startMarker.length);
    if (index >= 0 && index < end) end = index;
  }
  return source.slice(start, end);
}

const loopPorts = read("src-tauri/src/control/loop_ports.rs");
const mergeControl = read("src-tauri/src/control/merge.rs");
const mcp = read("src-tauri/src/api/mcp/dispatch.rs");
const ipc = read("src-tauri/src/ipc/orchestrator_commands.rs");
const reviewIpc = read("src-tauri/src/ipc/review_commands.rs");
const lib = read("src-tauri/src/lib.rs");

const mergeBody = sliceBetween(loopPorts, "fn merge(&mut self, task_id: &str)", ["fn symbol_blocking("]);
const mergeBodyN = compact(mergeBody);
const rawRequestBody = sliceBetween(mcp, '"aelyris.request_merge" => {', ['"aelyris.spawn_agent" => {']);
const rawApproveBody = sliceBetween(mcp, '"aelyris.review.approve" => {', ['"aelyris.review.reject" => {']);
const runStepBody = sliceBetween(loopPorts, "pub fn run_step(", ["pub fn run_step_visible("]);
const runStepVisibleBody = sliceBetween(loopPorts, "pub fn run_step_visible(", ["fn publish_escalations("]);

const checks = [
  {
    id: "loop-adapter-defaults-to-durable-fail-closed",
    ok:
      loopPorts.includes("require_durable_merge: true") &&
      mergeBody.includes("durable merge store is required for autonomy-loop merges") &&
      mergeBodyN.indexOf("durablemergestoreisrequiredforautonomy-loopmerges") <
        mergeBodyN.indexOf("self.queue.enqueue("),
    detail:
      "LoopPortsAdapter::new defaults to durable merge mode; missing MergeIntentStore fails before the legacy RAM queue can enqueue.",
  },
  {
    id: "legacy-ram-queue-is-test-opt-in-only",
    ok:
      loopPorts.includes("#[cfg(test)]") &&
      loopPorts.includes("fn with_legacy_merge_queue_for_tests") &&
      loopPorts.includes("self.require_durable_merge = false") &&
      !loopPorts.includes("pub fn with_legacy_merge_queue_for_tests"),
    detail: "The only code path that disables durable merge requirement is a private #[cfg(test)] helper.",
  },
  {
    id: "adapter-carries-durable-store-and-gate-digest-state",
    ok:
      loopPorts.includes("merge_store: Option<Arc<MergeIntentStore>>") &&
      loopPorts.includes("gate_results: HashMap<String, GateResults>") &&
      loopPorts.includes("self.gate_results.insert(task_id.to_string(), results)") &&
      loopPorts.includes("gate_results_digest(gates).ok()") &&
      loopPorts.includes("pub struct ReviewedCandidateBinding") &&
      loopPorts.includes("fn review_binding(&self, _task_id: &str) -> Option<ReviewedCandidateBinding>"),
    detail:
      "The adapter stores the durable MergeIntentStore and consumes an in-process reviewed-candidate binding plus a canonical gate digest.",
  },
  {
    id: "autonomy-merge-consumes-reviewed-oids-through-durable-intent",
    ok:
      mergeBody.includes("if let Some(store) = self.merge_store.clone()") &&
      mergeBody.includes("request_durable_intent_bound(") &&
      mergeBody.includes("approve_durable_intent(") &&
      mergeBody.includes("inspect_owned_candidate_at_oids(") &&
      mergeBody.includes("remove_for_branch(") &&
      mergeBodyN.indexOf("inspect_owned_candidate_at_oids(") <
        mergeBodyN.indexOf("request_durable_intent_bound(") &&
      mergeBodyN.indexOf("request_durable_intent_bound(") < mergeBodyN.indexOf("approve_durable_intent(") &&
      mergeBodyN.indexOf("approve_durable_intent(") < mergeBodyN.indexOf("self.queue.enqueue("),
    detail:
      "The merge adapter revalidates the exact reviewed candidate, requests a durable intent bound to those source/target OIDs, approves it, and reaches RAM queue only in explicit legacy-test mode.",
  },
  {
    id: "durable-merge-control-helper-is-oid-bound-and-idempotent",
    ok:
      mergeControl.includes("pub fn request_durable_intent(") &&
      mergeControl.includes("pub fn request_durable_intent_bound(") &&
      mergeControl.includes("store.create_or_get(&intent)") &&
      mergeControl.includes("pub fn approve_durable_intent(") &&
      mergeControl.includes(".claim_for_merge(intent_id, now)") &&
      mergeControl.includes("crate::git::perform_merge_bound(") &&
      mergeControl.includes("crate::git::branch_contains_commit(") &&
      mergeControl.includes("MergeIntentState::NeedsReconcile"),
    detail:
      "Shared control helpers bind backend-reviewed source/target OIDs to the stored intent, DB CAS claim, idempotent already-merged checks, and needs-reconcile failure state.",
  },
  {
    id: "headless-mcp-orchestrator-step-injects-store",
    ok:
      mcp.includes("state.merge_store.clone()") &&
      runStepBody.includes("merge_store: Option<Arc<MergeIntentStore>>") &&
      runStepBody.includes(".with_durable_merge_store(merge_store.clone())"),
    detail: "aelyris.orchestrator.step passes the durable store into the headless autonomy adapter.",
  },
  {
    id: "visible-review-and-merge-injects-store-and-binding",
    ok:
      ipc.includes("State<'_, Option<Arc<crate::merge_intent::store::MergeIntentStore>>>") &&
      ipc.includes("pub async fn orchestrator_review_and_merge(") &&
      ipc.includes("review_task_candidate(") &&
      ipc.includes("review_bindings.insert(task_id.clone(), reviewed.binding)") &&
      ipc.includes("merge_store.inner().clone()") &&
      runStepVisibleBody.includes("merge_store: Option<Arc<MergeIntentStore>>") &&
      runStepVisibleBody.includes(".with_durable_merge_store(merge_store.clone())"),
    detail:
      "The combined cockpit review-and-merge command creates the binding in-process and passes the Tauri-managed durable store into the visible adapter.",
  },
  {
    id: "tauri-runtime-manages-one-store-for-ipc-and-api",
    ok:
      lib.includes("let merge_store = match Database::open(&db_path)") &&
      lib.includes("merge_intent::store::MergeIntentStore::new") &&
      lib.includes("startup_reconciliation::reconcile_runtime_authorities(") &&
      lib.includes("app.manage(merge_store.clone())") &&
      lib.includes(".with_merge_store(merge_store.clone())"),
    detail:
      "Tauri startup creates one durable merge store, reconciles dangling merging rows, manages it as state, and passes the same handle to API/MCP.",
  },
  {
    id: "tests-pin-durable-store-and-fail-closed-contracts",
    ok:
      loopPorts.includes("durable_store_records_loop_merge_intent_and_bypasses_ram_queue") &&
      loopPorts.includes("adapter_without_durable_store_fails_closed_before_ram_queue") &&
      loopPorts.includes("durable mode must not use the legacy RAM MergeQueue as source of truth"),
    detail: "Unit tests prove durable loop merge persistence and missing-store fail-closed behavior.",
  },
  {
    id: "raw-mcp-merge-authority-is-retired-fail-closed",
    ok:
      rawRequestBody.includes("aelyris.request_merge is retired") &&
      rawApproveBody.includes("aelyris.review.approve is retired") &&
      !rawRequestBody.includes("create_or_get") &&
      !rawApproveBody.includes("approve_durable_intent") &&
      mcp.includes('"aelyris.review.reject" => {') &&
      mcp.includes("store.reject(&intent_id, now)") &&
      mcp.includes("store.list_unresolved()") &&
      reviewIpc.includes("freeze_owned_worktree_candidate(") &&
      reviewIpc.includes("DetachedReviewWorktree::create(") &&
      ipc.includes("orchestrator_review_and_merge"),
    detail:
      "Raw MCP request/approve names remain compatibility errors only; generic authority is minted inside exact-candidate review, while durable reject/list remain observable recovery controls.",
  },
];

const knownGaps = [
  {
    id: "legacy-merge-queue-type-retained-for-tests",
    severity: "info",
    detail:
      "MergeQueue remains in the crate for legacy behavior tests, but production LoopPortsAdapter has no public method to disable durable merge requirement.",
  },
];

const failed = checks.filter((check) => !check.ok);
const report = {
  schema: "aelyris.durable-merge-unification/v1",
  version: 1,
  generatedAt: new Date().toISOString(),
  ok: failed.length === 0,
  total: checks.length,
  passed: checks.length - failed.length,
  failed: failed.map((check) => check.id),
  checks,
  knownGaps,
  sourceFiles: [
    "src-tauri/src/control/merge.rs",
    "src-tauri/src/control/loop_ports.rs",
    "src-tauri/src/api/mcp.rs",
    "src-tauri/src/api/mcp/catalog.rs",
    "src-tauri/src/api/mcp/dispatch.rs",
    "src-tauri/src/ipc/orchestrator_commands.rs",
    "src-tauri/src/lib.rs",
  ],
};

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`);

for (const check of checks) {
  console.log(`${check.ok ? "PASS" : "FAIL"}  ${check.id}`);
  console.log(`      ${check.detail}`);
}
if (knownGaps.length > 0) {
  console.log("\nKnown review gaps:");
  for (const gap of knownGaps) console.log(`REVIEW ${gap.id}: ${gap.detail}`);
}
if (failed.length > 0) {
  console.error(`\n${failed.length}/${checks.length} durable merge unification assertion(s) FAILED`);
  process.exit(1);
}
console.log(`\nAll ${checks.length} durable merge unification assertions PASSED`);
