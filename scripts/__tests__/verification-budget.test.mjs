import assert from "node:assert/strict";
import test from "node:test";

import {
  alreadyPassed,
  classifyRisks,
  createPlan,
  isExpensiveCommand,
  learnedWarnings,
  sanitizeCommand,
  selectLane,
} from "../verification-budget.mjs";

test("classifies concrete risk owners without treating ordinary docs as high risk", () => {
  assert.deepEqual(classifyRisks(["docs/AGENT_WORKFLOWS.md"]), []);
  assert.ok(classifyRisks(["src-tauri/src/db/migrations.rs"]).includes("persistence"));
  assert.ok(classifyRisks(["src-tauri/src/api/mod.rs"]).includes("public_contract"));
  assert.ok(classifyRisks(["package.json"]).includes("dependency"));
  assert.ok(classifyRisks(["src-tauri/src/command_risk/gate.rs"]).includes("security"));
});

test("selects policy, local, owner, and repository lanes from material risk", () => {
  assert.equal(selectLane(["docs/AGENT_WORKFLOWS.md"], [], "routine"), "policy_only");
  assert.equal(selectLane(["src/features/panel.tsx"], [], "routine"), "local_fast");
  assert.equal(selectLane(["src-tauri/src/db/mod.rs"], ["persistence"], "routine"), "owner_full");
  assert.equal(selectLane(["Cargo.lock"], ["dependency"], "critical"), "repository_full");
});

test("expensive commands cover full suites, all-targets, benches, and release aggregates", () => {
  assert.equal(isExpensiveCommand("pnpm verify:rust:full"), true);
  assert.equal(isExpensiveCommand("cargo test --manifest-path src-tauri/Cargo.toml --all-targets"), true);
  assert.equal(isExpensiveCommand("pnpm test:full"), true);
  assert.equal(isExpensiveCommand("cargo bench"), true);
  assert.equal(isExpensiveCommand("pnpm verify:quality-score"), true);
  assert.equal(isExpensiveCommand("cargo test --lib api::continuity::tests"), false);
  assert.equal(isExpensiveCommand("pnpm verify:fast"), false);
});

test("full gate stays blocked until final stage and is not recommended for a local lane", () => {
  const implementation = createPlan({
    paths: ["src/features/panel.tsx"],
    fingerprint: "one",
    claim: "panel behavior",
    stage: "implementation",
  });
  assert.equal(implementation.fullGatePolicy, "blocked_until_final");

  const final = createPlan({
    paths: ["src/features/panel.tsx"],
    fingerprint: "two",
    claim: "panel behavior",
    stage: "final",
  });
  assert.equal(final.fullGatePolicy, "not_recommended");
});

test("same fingerprint and command suppress an already passed expensive gate", () => {
  const history = [
    {
      type: "verification_run",
      fingerprint: "abc",
      command: "PNPM   verify:rust:full",
      status: "passed",
    },
  ];
  assert.equal(alreadyPassed(history, "abc", "pnpm verify:rust:full"), true);
  assert.equal(alreadyPassed(history, "different", "pnpm verify:rust:full"), false);
});

test("repeated unrelated failures become visible learning warnings", () => {
  const history = [
    {
      type: "verification_note",
      kind: "unrelated_failure",
      command: "pnpm verify:rust:full",
      summary: "Windows manifest path",
    },
    {
      type: "verification_note",
      kind: "unrelated_failure",
      command: "pnpm verify:rust:full",
      summary: "Windows manifest path",
    },
  ];
  assert.deepEqual(learnedWarnings(history), [
    {
      command: "pnpm verify:rust:full",
      summary: "Windows manifest path",
      count: 2,
    },
  ]);
});

test("journal commands redact common credential forms without changing execution input", () => {
  const sanitized = sanitizeCommand(
    "AELYRIS_API_TOKEN=secret pnpm test --token abc --password=def Authorization: Bearer xyz",
  );
  assert.equal(sanitized.includes("secret"), false);
  assert.equal(sanitized.includes("abc"), false);
  assert.equal(sanitized.includes("def"), false);
  assert.equal(sanitized.includes("xyz"), false);
  assert.match(sanitized, /AELYRIS_API_TOKEN=<redacted>/);
});
