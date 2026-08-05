import assert from "node:assert/strict";
import test from "node:test";

import {
  validateHandoff,
  validateWorkRecord,
} from "../audit-remediation-continuation-contract.mjs";
import {
  hasProductDeliverySliceAnchor,
  parseProductDeliveryContinuationContract,
  parseProductDeliveryFrontier,
  productDeliverySliceId,
} from "../product-delivery-continuation-contract.mjs";

const status = "## main...origin/main;  M product-delivery-instructions.md";
const worklog = ".codex-auto/worklogs/product-delivery/2026-08-05T16-00-00JST-xpc-1-fresh-clone.md";

const workOrder = `# Product Delivery

STATUS: ACTIVE
PROGRAM: \`product-delivery\`
CURRENT PHASE: \`POST-GMV PRODUCT ACCESS\`
ACTIVE SLICE: \`XPC-1\`
LAST COMPLETED SLICE: \`CM-2\`
NEXT IMPLEMENTATION SLICE: \`XPC-1\`

\`\`\`yaml
continuation_contract:
  tracked_plan: product-delivery-instructions.md
  root_work_order: product-delivery-instructions.md
  worklog_dir: .codex-auto/worklogs/product-delivery
  local_handoff: .claude/agent-memory-local/CODEX_MUST_READ_NEXT_SESSION_PRODUCT_DELIVERY_LOCAL_ONLY.md
  verifier: pnpm verify:product-delivery:continuation
\`\`\`

### CM-2 — Budget binding
### XPC-1 — Portable continuation
`;

function workRecord(nextAction = "Continue exact slice XPC-1 from tracked product-delivery truth.") {
  return `\`\`\`yaml
work_record:
  program: product-delivery
  session_date_jst: 2026-08-05T16:00:00+09:00
  branch: main
  head_at_start: abc1234
  head_at_close: abc1234
  worktree_at_start: "${status}"
  worktree_at_close: "${status}"
  active_phase: "POST-GMV PRODUCT ACCESS"
  active_slice: XPC-1
  completed_slice: CM-2
  next_implementation_slice: XPC-1
  objective: Repair portable continuation.
  files_read: []
  files_changed: []
  commands:
    - command: pnpm verify:product-delivery:continuation
      result: PASS
      artifact: .codex-auto/quality/product-delivery-continuation.json
  decisions: []
  commit: null
  blockers:
    implementation: []
    stale_evidence: []
    policy: []
    external: []
  residual_risk: []
  next_exact_action: ${nextAction}
\`\`\``;
}

function handoff(nextSlice = "XPC-1") {
  return `LOCAL ONLY. DO NOT COMMIT.

\`\`\`yaml
program: product-delivery
active_phase: "POST-GMV PRODUCT ACCESS"
active_slice: XPC-1
last_completed_slice: CM-2
next_implementation_slice: ${nextSlice}
status: active
branch: main
head: abc1234
git_status: "${status}"
worklog: ${worklog}
tracked_paths: ["product-delivery-instructions.md"]
\`\`\`

## Read Order
read

## Current Artifacts And Refresh Commands
refresh

## Commands And Results
PASS

## Blocker Split
none

## Next Exact Action
Continue exact slice ${nextSlice}.

## Forbidden Scope
none

## Pasteable /goal
\`\`\`yaml
continuation_goal:
  program: product-delivery
  current_phase: "POST-GMV PRODUCT ACCESS"
  active_slice: XPC-1
  next_implementation_slice: ${nextSlice}
\`\`\``;
}

test("parses the exact product-delivery frontier and continuation owners", () => {
  const frontier = parseProductDeliveryFrontier(workOrder);
  const contract = parseProductDeliveryContinuationContract(workOrder);
  assert.equal(frontier.ok, true, frontier.problems.join(", "));
  assert.equal(frontier.nextSlice, "XPC-1");
  assert.equal(contract.ok, true, contract.problems.join(", "));
  assert.equal(contract.fields.verifier, "pnpm verify:product-delivery:continuation");
  assert.equal(hasProductDeliverySliceAnchor(workOrder, "CM-2"), true);
  assert.equal(hasProductDeliverySliceAnchor(workOrder, "XPC-1"), true);
});

test("rejects a narrative next slice instead of silently guessing", () => {
  const narrative = workOrder.replace(
    /^NEXT IMPLEMENTATION SLICE:.*$/m,
    "NEXT IMPLEMENTATION SLICE: choose something after `XPC-1`",
  );
  assert.notEqual(narrative, workOrder);
  const frontier = parseProductDeliveryFrontier(narrative);
  assert.equal(frontier.ok, false);
  assert.ok(frontier.problems.includes("next-slice-exact"));
});

test("validates generic work records and handoffs with product slice ids", () => {
  const record = validateWorkRecord({
    source: workRecord(),
    expectedProgram: "product-delivery",
    expectedPhase: "POST-GMV PRODUCT ACCESS",
    expectedActiveSlice: "XPC-1",
    expectedCompletedSlice: "CM-2",
    expectedNextSlice: "XPC-1",
    expectedBranch: "main",
    expectedHead: "abc1234",
    expectedGitStatus: status,
    expectedCommit: null,
    sliceIdParser: productDeliverySliceId,
  });
  assert.equal(record.ok, true, record.missing.join(", "));

  const packet = validateHandoff({
    source: handoff(),
    expectedProgram: "product-delivery",
    expectedPhase: "POST-GMV PRODUCT ACCESS",
    expectedActiveSlice: "XPC-1",
    expectedCompletedSlice: "CM-2",
    expectedNextSlice: "XPC-1",
    expectedBranch: "main",
    expectedHead: "abc1234",
    expectedGitStatus: status,
    expectedWorklog: worklog,
    expectedChangedPaths: ["product-delivery-instructions.md"],
    sliceIdParser: productDeliverySliceId,
  });
  assert.equal(packet.ok, true, packet.missing.join(", "));
});

test("rejects a stale product next action", () => {
  const result = validateWorkRecord({
    source: workRecord("Continue exact slice PB-UI-2."),
    expectedProgram: "product-delivery",
    expectedPhase: "POST-GMV PRODUCT ACCESS",
    expectedActiveSlice: "XPC-1",
    expectedCompletedSlice: "CM-2",
    expectedNextSlice: "XPC-1",
    expectedBranch: "main",
    expectedHead: "abc1234",
    expectedGitStatus: status,
    expectedCommit: null,
    sliceIdParser: productDeliverySliceId,
  });
  assert.equal(result.ok, false);
  assert.ok(result.missing.includes("next-exact-action-slice"));
});
