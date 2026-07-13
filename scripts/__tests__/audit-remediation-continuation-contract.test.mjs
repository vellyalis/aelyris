import assert from "node:assert/strict";
import test from "node:test";

import {
  backtickField,
  granularSliceId,
  hasPlanSliceAnchor,
  phaseForSlice,
  validateCurrentWorklogPath,
  validateHandoff,
  validateWorkRecord,
} from "../audit-remediation-continuation-contract.mjs";

const status = "## main...origin/main [ahead 57]";
const worklogPath = ".codex-auto/worklogs/audit-remediation/2026-07-13T10-30-00JST-A6-2e0-continuation.md";

function workRecord(overrides = {}) {
  const next = overrides.next ?? "Implement exact slice A6.2e1 with its focused dependency-boundary gate.";
  const artifactLine = overrides.omitArtifact
    ? []
    : ["      artifact: .codex-auto/quality/audit-remediation-continuation.json"];
  return [
    "```yaml",
    "work_record:",
    "  program: audit-remediation",
    "  session_date_jst: 2026-07-13T10:30:00+09:00",
    "  branch: main",
    "  head_at_start: 24f644f",
    "  head_at_close: abc1234",
    '  worktree_at_start: "## main...origin/main [ahead 56]"',
    `  worktree_at_close: "${status}"`,
    "  active_phase: A6",
    "  active_slice: A6.2e0",
    "  completed_slice: A6.2e0",
    "  next_implementation_slice: A6.2e1",
    "  objective: Make continuation truth exact and fail closed.",
    "  files_read: []",
    "  files_changed: []",
    "  commands:",
    "    - command: pnpm verify:audit-remediation:continuation",
    "      result: PASS",
    ...artifactLine,
    "  decisions: []",
    "  commit: null",
    "  blockers:",
    "    implementation: []",
    "    stale_evidence: []",
    "    policy: []",
    "    external: []",
    "  residual_risk: []",
    `  next_exact_action: ${next}`,
    "```",
  ].join("\n");
}

function handoff(overrides = {}) {
  const activeSlice = overrides.activeSlice ?? "A6.2e0";
  const nextSlice = overrides.nextSlice ?? "A6.2e1";
  const goalSlice = overrides.goalSlice ?? nextSlice;
  return [
    "LOCAL ONLY. DO NOT COMMIT.",
    "",
    "```yaml",
    "program: audit-remediation",
    "active_phase: A6",
    `active_slice: ${activeSlice}`,
    "last_completed_slice: A6.2e0",
    `next_implementation_slice: ${nextSlice}`,
    "status: active",
    "branch: main",
    "head: abc1234",
    `git_status: "${status}"`,
    `worklog: ${worklogPath}`,
    "tracked_paths: []",
    "```",
    "",
    "## Read Order",
    "",
    "1. Read current truth.",
    "",
    "## Current Artifacts And Refresh Commands",
    "",
    "- continuation artifact",
    "",
    "## Commands And Results",
    "",
    "- continuation PASS",
    "",
    "## Blocker Split",
    "",
    "- implementation: current slice",
    "",
    "## Next Exact Action",
    "",
    `Implement exact slice ${nextSlice}.`,
    "",
    "## Forbidden Scope",
    "",
    "- no later phase",
    "",
    "## Pasteable /goal",
    "",
    "```yaml",
    "continuation_goal:",
    "  program: audit-remediation",
    "  current_phase: A6",
    `  active_slice: ${activeSlice}`,
    `  next_implementation_slice: ${goalSlice}`,
    "```",
    "",
    `Continue exact slice ${goalSlice}.`,
  ].join("\n");
}

test("parses granular slice ids without collapsing them to the coarse phase", () => {
  const workOrder = "ACTIVE SLICE: `A6.2e1`.\nNEXT IMPLEMENTATION SLICE: `A6.2e1`.";
  assert.equal(backtickField(workOrder, "ACTIVE SLICE"), "A6.2e1");
  assert.equal(granularSliceId("Continue A6.2e1 now"), "A6.2e1");
  assert.equal(phaseForSlice("A6.2e1"), "A6");
  assert.equal(granularSliceId("A6"), null);
});

test("requires an exact tracked-plan slice anchor", () => {
  const plan = "1. **A6.2e0 exact continuation**: complete it.\n2. **A6.2e1 neutral utilities**: continue.";
  assert.equal(hasPlanSliceAnchor(plan, "A6.2e1"), true);
  assert.equal(hasPlanSliceAnchor(plan, "A6.2e2"), false);
});

test("accepts a complete current work record", () => {
  const result = validateWorkRecord({
    source: workRecord(),
    expectedProgram: "audit-remediation",
    expectedPhase: "A6",
    expectedActiveSlice: "A6.2e0",
    expectedCompletedSlice: "A6.2e0",
    expectedNextSlice: "A6.2e1",
    expectedBranch: "main",
    expectedHead: "abc1234",
    expectedGitStatus: status,
    expectedCommit: null,
  });
  assert.equal(result.ok, true, result.missing.join(", "));
  assert.equal(result.commandCount, 1);
});

test("rejects incomplete command evidence and a stale next action", () => {
  const result = validateWorkRecord({
    source: workRecord({ omitArtifact: true, next: "Implement exact slice A6.2e2." }),
    expectedProgram: "audit-remediation",
    expectedPhase: "A6",
    expectedActiveSlice: "A6.2e0",
    expectedCompletedSlice: "A6.2e0",
    expectedNextSlice: "A6.2e1",
    expectedBranch: "main",
    expectedHead: "abc1234",
    expectedGitStatus: status,
    expectedCommit: null,
  });
  assert.equal(result.ok, false);
  assert.ok(result.missing.includes("commands-exact-result-artifact"));
  assert.ok(result.missing.includes("next-exact-action-slice"));
});

test("rejects duplicate fields, lowercase results, and unsafe artifact paths", () => {
  const duplicate = workRecord().replace("  active_slice: A6.2e0", "  active_slice: A6.2e0\n  active_slice: A6.2e0");
  const lowercase = workRecord().replace("      result: PASS", "      result: pass");
  const unsafe = workRecord().replace(
    "      artifact: .codex-auto/quality/audit-remediation-continuation.json",
    "      artifact: ../../outside.json",
  );
  for (const source of [duplicate, lowercase, unsafe]) {
    const result = validateWorkRecord({
      source,
      expectedProgram: "audit-remediation",
      expectedPhase: "A6",
      expectedActiveSlice: "A6.2e0",
      expectedCompletedSlice: "A6.2e0",
      expectedNextSlice: "A6.2e1",
      expectedBranch: "main",
      expectedHead: "abc1234",
      expectedGitStatus: status,
      expectedCommit: null,
    });
    assert.equal(result.ok, false);
  }
});

test("accepts CRLF machine records", () => {
  const result = validateWorkRecord({
    source: workRecord().replace(/\n/g, "\r\n"),
    expectedProgram: "audit-remediation",
    expectedPhase: "A6",
    expectedActiveSlice: "A6.2e0",
    expectedCompletedSlice: "A6.2e0",
    expectedNextSlice: "A6.2e1",
    expectedBranch: "main",
    expectedHead: "abc1234",
    expectedGitStatus: status,
    expectedCommit: null,
  });
  assert.equal(result.ok, true, result.missing.join(", "));
});

test("requires handoff identity and pasteable goal to match the exact frontier", () => {
  const passing = validateHandoff({
    source: handoff(),
    expectedProgram: "audit-remediation",
    expectedPhase: "A6",
    expectedActiveSlice: "A6.2e0",
    expectedCompletedSlice: "A6.2e0",
    expectedNextSlice: "A6.2e1",
    expectedBranch: "main",
    expectedHead: "abc1234",
    expectedGitStatus: status,
    expectedWorklog: worklogPath,
    expectedChangedPaths: [],
  });
  assert.equal(passing.ok, true, passing.missing.join(", "));

  const stale = validateHandoff({
    source: handoff({ goalSlice: "A6.2e2" }),
    expectedProgram: "audit-remediation",
    expectedPhase: "A6",
    expectedActiveSlice: "A6.2e0",
    expectedCompletedSlice: "A6.2e0",
    expectedNextSlice: "A6.2e1",
    expectedBranch: "main",
    expectedHead: "abc1234",
    expectedGitStatus: status,
    expectedWorklog: worklogPath,
    expectedChangedPaths: [],
  });
  assert.equal(stale.ok, false);
  assert.ok(stale.missing.includes("pasteable-goal-next_implementation_slice"));
});

test("accepts only a direct repo-owned current worklog path", () => {
  assert.equal(validateCurrentWorklogPath(worklogPath, ".codex-auto/worklogs/audit-remediation").ok, true);
  assert.equal(
    validateCurrentWorklogPath(
      ".codex-auto/worklogs/audit-remediation/../stale.md",
      ".codex-auto/worklogs/audit-remediation",
    ).ok,
    false,
  );
  assert.equal(validateCurrentWorklogPath("C:/tmp/record.md", ".codex-auto/worklogs/audit-remediation").ok, false);
});
