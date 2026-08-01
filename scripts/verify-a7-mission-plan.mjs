import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { createEvidenceProvenance } from "./evidence-provenance.mjs";

const root = resolve(process.cwd());
const artifact = join(root, ".codex-auto", "quality", "a7-mission-plan.json");
const cargo = process.platform === "win32" ? "cargo.exe" : "cargo";
const design = readFileSync(
  join(root, "docs", "specs", "AELYRIS_VERIFIABLE_AGENT_WORK_OS_DETAILED_DESIGN.md"),
  "utf8",
);
const contractMatch = design.match(
  /<!-- A7_1_INERT_PLAN_CONTRACT_V1_BEGIN -->\s*```json\s*([\s\S]*?)\s*```\s*<!-- A7_1_INERT_PLAN_CONTRACT_V1_END -->/,
);
const scopeLockMatch = design.match(
  /<!-- A7_CORE_SCOPE_LOCK_V1_BEGIN -->\s*```json\s*([\s\S]*?)\s*```\s*<!-- A7_CORE_SCOPE_LOCK_V1_END -->/,
);
let contract;
let scopeLock;
let contractError = null;
try {
  contract = contractMatch ? JSON.parse(contractMatch[1]) : null;
  if (!contract) contractError = "missing A7.1 inert plan contract";
  scopeLock = scopeLockMatch ? JSON.parse(scopeLockMatch[1]) : null;
  if (!scopeLock) contractError ??= "missing A7 Core scope lock";
} catch (error) {
  contractError = error instanceof Error ? error.message : String(error);
}
const exact = (actual, expected) => JSON.stringify(actual) === JSON.stringify(expected);
const expectedStates = {
  initial: "previewed",
  terminal: ["accepted", "rejected", "cancelled"],
  transitions: [
    "previewed -> accepted",
    "previewed -> rejected",
    "previewed -> cancelled",
  ],
};
const expectedRevisionChain = {
  firstRevision: 1,
  nextRevision: "previous + 1",
  alignedVersions: [
    "planRevision",
    "MissionDefinitionRevision.revision",
    "MissionDefinitionRevision.workGraphDefinitionRevision",
    "WorkUnitDefinition.definitionRevision",
  ],
  predecessorTerminalStates: ["rejected", "cancelled"],
  previewedOrAcceptedPredecessorMayBeBypassed: false,
};
const expectedIpc = [
  "mission_plan_preview",
  "mission_plan_get",
  "mission_plan_list",
  "mission_plan_accept",
  "mission_plan_reject",
  "mission_plan_cancel",
];
const expectedCausalFacts = [
  "requestId",
  "normalizedRequest",
  "requestDigest",
  "planId",
  "planRevision",
  "contentDigest",
  "repositoryId",
  "repositoryRoot",
  "acceptedMissionHeadOid",
  "MissionDefinitionRevision",
  "WorkUnitDefinition[]",
  "ownedTargets",
  "expectedTests",
  "reviewRequirement",
  "mergePolicy",
  "explicitRisks",
  "decisionPrincipalId",
  "decisionReason",
  "persistedAtUnixMs",
  "decidedAtUnixMs",
];
const expectedFrozenAdmission = {
  baseOidSource: "accepted_mission_head",
  headReadOwner: "existing read-only Git adapter",
  headCheckedAt: ["preview", "accept"],
  runtimeDomainIds: ["visible_pty"],
  requiredAdapterCapabilities: ["prompt"],
  riskPolicy: "a7-core-risk/v1@1",
  budgetPolicy: "a7-budget/v1@1:wall_time_ms=600000:blocked",
  teamPolicy:
    "implementer=a7-impl/v1;independent_reviewer=a7-review/v1;a7-core-reviewer-independence/v1;a7-exact-path/v1;a7-core/v1",
  ownedTargets: ["src-tauri/src/task/graph.rs"],
  testCommandArgv: [
    "cargo",
    "test",
    "--manifest-path",
    "src-tauri/Cargo.toml",
    "task::graph::tests::equal_priority_ready_tasks_preserve_insertion_order",
    "--",
    "--exact",
  ],
  gateContractVersion: "1",
  freshnessPolicy: {
    policyId: "a7-exact-oid/v1",
    maxAgeMs: "300000",
    requireSameHeadOid: true,
    requireSameContractVersion: true,
    requireSameEnvironmentFingerprint: true,
  },
  requiredResult: "passed_exact_oid",
  capabilityUnlock: "a7.2.activate_visible_implementation",
};
const scopeFaceMap = new Map(
  Array.isArray(scopeLock?.faceDisposition)
    ? scopeLock.faceDisposition.map((entry) => [entry.journeyStep, entry])
    : [],
);
const requestFace = scopeFaceMap.get("request")?.ipc;
const previewFace = scopeFaceMap.get("versioned_plan_preview")?.ipc;
const scopeRevisionRecoveryValid = exact(scopeLock?.fixture?.revisionRecovery, {
  appliesBeforeAcceptance: true,
  headDriftAction: "reject_or_cancel_current_preview",
  nextRevision: "previous + 1",
  alignedVersions: [
    "planRevision",
    "missionRevision",
    "workGraphDefinitionRevision",
    "workUnitDefinitionRevision",
  ],
  previewedOrAcceptedPredecessorMayBeBypassed: false,
});
const scopeFaceValid =
  requestFace?.action === "mission_plan_preview" &&
  requestFace?.disposition === "route" &&
  requestFace?.reason?.includes("task_submit_plan still executes") &&
  previewFace?.action ===
    "mission_plan_get | mission_plan_list | mission_plan_accept | mission_plan_reject | mission_plan_cancel" &&
  previewFace?.disposition === "route" &&
  previewFace?.reason?.includes("orchestrator_plan still executes");
const contractValid =
  contractError === null &&
  contract?.schema === "aelyris.a7_1_inert_plan_contract/v1" &&
  contract?.contractVersion === 1 &&
  contract?.owner === "TaskManager -> TaskRepo" &&
  contract?.previewSchema === "aelyris.mission_plan_preview/v1" &&
  contract?.canonicalization === "rfc8785_json_utf8" &&
  contract?.persistence?.schemaVersion === 7 &&
  contract?.persistence?.table === "mission_plan_revisions" &&
  contract?.persistence?.contentMutable === false &&
  contract?.persistence?.deletable === false &&
  contract?.persistence?.oneAcceptedPlanPerMissionDefinitionRevision === true &&
  exact(contract?.states, expectedStates) &&
  exact(contract?.revisionChain, expectedRevisionChain) &&
  exact(contract?.ipc, expectedIpc) &&
  exact(contract?.causalFacts, expectedCausalFacts) &&
  exact(contract?.frozenAdmission, expectedFrozenAdmission) &&
  exact(contract?.compatibilityWithoutA7Authority, ["task_submit_plan", "orchestrator_plan"]) &&
  scopeFaceValid &&
  scopeRevisionRecoveryValid &&
  contract?.acceptedNextAction === "A7.2 explicit visible activation" &&
  contract?.proofCommand === "pnpm verify:a7:mission-plan" &&
  contract?.phaseComplete === false;
const scenarios = [
  ["typed-request-and-canonical-preview", "task::mission::tests"],
  ["task-repo-durability-cas-and-tamper", "persistence::task_repo::tests"],
  ["manager-inert-state-and-restart", "task::manager::tests::a7_"],
  [
    "sqlite-v6-v7-immutable-state-machine",
    "db::migrations::tests",
  ],
];

const results = [
  {
    id: "tracked-a7.1-inert-contract",
    status: contractValid ? "pass" : "fail",
    error: contractError,
    contract,
    scopeFaceValid,
    scopeRevisionRecoveryValid,
  },
];
let failed = !contractValid;
for (const [id, filter] of contractValid ? scenarios : []) {
  const args = ["test", "--manifest-path", "src-tauri/Cargo.toml", "--lib", filter];
  const startedAt = Date.now();
  try {
    const stdout = execFileSync(cargo, args, {
      cwd: root,
      encoding: "utf8",
      windowsHide: true,
      timeout: 300_000,
      env: { ...process.env, NO_COLOR: "1" },
    });
    results.push({
      id,
      status: "pass",
      command: [cargo, ...args].join(" "),
      durationMs: Date.now() - startedAt,
      outputTail: stdout.trim().split(/\r?\n/).slice(-12),
    });
  } catch (error) {
    failed = true;
    results.push({
      id,
      status: "fail",
      command: [cargo, ...args].join(" "),
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
      stdoutTail: String(error?.stdout ?? "")
        .trim()
        .split(/\r?\n/)
        .slice(-16),
      stderrTail: String(error?.stderr ?? "")
        .trim()
        .split(/\r?\n/)
        .slice(-16),
    });
    break;
  }
}

const generatedAt = new Date().toISOString();
const report = {
  schema: "aelyris.a7-mission-plan/v1",
  status: failed ? "failed" : "pass-a7.1-inert-mission-plan",
  attemptedSlice: "A7.1",
  completedSlice: failed ? null : "A7.1",
  nextImplementationSlice: "A7.2",
  sliceComplete: !failed,
  phaseComplete: false,
  claimBoundary:
    "A7.1 request contract and durable inert plan preview only; no TaskGraph activation, worktree, PTY, lease, execution, test evidence, review, merge, packet, A7 phase, or release-readiness claim.",
  scenarios: results,
  generatedAt,
  provenance: createEvidenceProvenance({
    root,
    verifierPath: "scripts/verify-a7-mission-plan.mjs",
    inputPaths: [
      "src-tauri/src/task/mission.rs",
      "src-tauri/src/task/mod.rs",
      "src-tauri/src/task/manager.rs",
      "src-tauri/src/git/status.rs",
      "src-tauri/src/persistence/task_repo.rs",
      "src-tauri/src/db/migrations.rs",
      "src-tauri/src/ipc/task_commands.rs",
      "src-tauri/src/lib.rs",
      "docs/specs/AELYRIS_VERIFIABLE_AGENT_WORK_OS_DETAILED_DESIGN.md",
      "docs/specs/COMPREHENSIVE_AUDIT_REMEDIATION_PLAN_2026-07-10.md",
      "audit-remediation-instructions.md",
      "package.json",
    ],
    generatedAt,
  }),
};

mkdirSync(dirname(artifact), { recursive: true });
writeFileSync(artifact, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ artifact, ...report }, null, 2));
if (failed) process.exit(1);
