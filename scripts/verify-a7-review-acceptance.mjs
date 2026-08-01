import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { createEvidenceProvenance } from "./evidence-provenance.mjs";

const root = resolve(process.cwd());
const artifactPath = join(root, ".codex-auto", "quality", "a7-review-acceptance.json");
const designPath = join(root, "docs", "specs", "AELYRIS_VERIFIABLE_AGENT_WORK_OS_DETAILED_DESIGN.md");
const design = readFileSync(designPath, "utf8");
const match = design.match(
  /<!-- A7_3_REVIEW_ACCEPTANCE_CONTRACT_V2_BEGIN -->\s*```json\s*([\s\S]*?)\s*```\s*<!-- A7_3_REVIEW_ACCEPTANCE_CONTRACT_V2_END -->/,
);
let contract = null;
let contractError = null;
try {
  contract = match ? JSON.parse(match[1]) : null;
  if (!contract) contractError = "missing A7.3 review acceptance contract";
} catch (error) {
  contractError = error instanceof Error ? error.message : String(error);
}

const exact = (actual, expected) => JSON.stringify(actual) === JSON.stringify(expected);
const contractValid =
  contractError === null &&
  contract?.schema === "aelyris.a7_3_review_acceptance_contract/v2" &&
  contract?.contractVersion === 2 &&
  contract?.route === "mission_plan_review_accept" &&
  exact(contract?.callerAuthority, ["planId", "planRevision"]) &&
  contract?.reviewerAuthority?.modelCallerSelectable === false &&
  contract?.reviewerAuthority?.policy === "a7-core-reviewer-independence/v1" &&
  contract?.reviewerAuthority?.fixedAdapter?.includes("gpt-5.6-sol") &&
  contract?.reviewerAuthority?.fixedAdapter?.includes("--output-schema <ephemeral-fixed-schema>") &&
  contract?.reviewerAuthority?.outputSchema === "aelyris.a7-review-model-response/v1" &&
  contract?.reviewerAuthority?.windowsTransport ===
    "PowerShell 7 pwsh shim plus process-local prompt environment; no multiline batch argument" &&
  contract?.reviewerAuthority?.builderAdapterFact === "codex-no-hooks" &&
  contract?.reviewerAuthority?.builderProviderFact === "codex" &&
  contract?.reviewerAuthority?.builderModelObservation === "unknown/unobserved" &&
  exact(contract?.reviewerAuthority?.typedRefs, ["VersionedRef", "EvidenceRefV2"]) &&
  contract?.gateRevalidation?.schemaVersion === 9 &&
  contract?.gateRevalidation?.appendOnly === true &&
  contract?.gateRevalidation?.candidateMutation === false &&
  contract?.gateRevalidation?.maxAgeMs === 300000 &&
  contract?.review?.owner === "Review -> ReviewRepo" &&
  contract?.review?.invocationReceiptTable === "mission_reviewer_invocation_receipts" &&
  contract?.review?.exactClauseCoverageRequired === true &&
  contract?.review?.rejectionFence ===
    "Review/EffectStarted -> Review/Committed -> Failed/Committed" &&
  contract?.review?.uncertainFailureFence === "NeedsReconcile" &&
  contract?.review?.rejectionCompletionCredit === false &&
  contract?.merge?.owner === "MergeIntentStore -> MergeRepo -> control::merge" &&
  contract?.merge?.targetBranch === "a7-acceptance" &&
  contract?.merge?.targetMustStartAtAcceptedBase === true &&
  contract?.merge?.successTaskFence === "MergeReady/Merge/Committed" &&
  contract?.merge?.resumeBoundaries?.length === 7 &&
  contract?.merge?.mergingRestartCases?.length === 2 &&
  contract?.merge?.automaticMainMerge === false &&
  contract?.proofCommand === "pnpm verify:a7:review-acceptance" &&
  contract?.phaseComplete === false;

const scenarios = [
  {
    id: "tracked-a7.3-contract",
    status: contractValid ? "pass" : "fail",
    error: contractError,
  },
];
let failed = !contractValid;
const cargo = process.platform === "win32" ? "cargo.exe" : "cargo";
const args = ["test", "--manifest-path", "src-tauri/Cargo.toml", "--lib", "a7_3_"];
const startedAt = Date.now();
try {
  const stdout = execFileSync(cargo, args, {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
    timeout: 600_000,
    env: { ...process.env, NO_COLOR: "1" },
  });
  const executedTests = [...stdout.matchAll(/running (\d+) tests?/g)].reduce(
    (sum, result) => sum + Number(result[1]),
    0,
  );
  if (executedTests < 18) {
    throw new Error(`A7.3 focused filter executed ${executedTests} tests; expected at least 18`);
  }
  scenarios.push({
    id: "a7.3-focused-runtime-contracts",
    status: "pass",
    command: [cargo, ...args].join(" "),
    executedTests,
    durationMs: Date.now() - startedAt,
    outputTail: stdout.trim().split(/\r?\n/).slice(-16),
  });
} catch (error) {
  failed = true;
  scenarios.push({
    id: "a7.3-focused-runtime-contracts",
    status: "fail",
    command: [cargo, ...args].join(" "),
    durationMs: Date.now() - startedAt,
    error: error instanceof Error ? error.message : String(error),
    stdoutTail: String(error?.stdout ?? "").trim().split(/\r?\n/).slice(-20),
    stderrTail: String(error?.stderr ?? "").trim().split(/\r?\n/).slice(-20),
  });
}

const generatedAt = new Date().toISOString();
const report = {
  schema: "aelyris.a7-review-acceptance/v1",
  status: failed ? "failed" : "pass-a7.3-runtime-contract",
  attemptedSlice: "A7.3",
  completedSlice: null,
  nextImplementationSlice: "A7.3",
  implementationReady: !failed,
  sliceComplete: false,
  phaseComplete: false,
  claimBoundary:
    "A7.3 runtime contract and fail-closed focused tests only. A fresh independent live review and exact isolated merge receipt are still required before A7.3 completion; no A7.4, A7, or release-readiness claim.",
  scenarios,
  generatedAt,
  provenance: createEvidenceProvenance({
    root,
    verifierPath: "scripts/verify-a7-review-acceptance.mjs",
    inputPaths: [
      "src-tauri/src/review/mission.rs",
      "src-tauri/src/agent/oneshot.rs",
      "src-tauri/src/persistence/review_repo.rs",
      "src-tauri/src/persistence/merge_repo.rs",
      "src-tauri/src/merge_intent/mod.rs",
      "src-tauri/src/merge_intent/store.rs",
      "src-tauri/src/db/migrations.rs",
      "src-tauri/src/git/merge.rs",
      "src-tauri/src/control/loop_ports.rs",
      "src-tauri/src/ipc/orchestrator_commands.rs",
      "src-tauri/src/task/manager.rs",
      "src-tauri/src/persistence/task_repo.rs",
      "src-tauri/src/startup_reconciliation.rs",
      "src-tauri/src/lib.rs",
      "docs/specs/AELYRIS_VERIFIABLE_AGENT_WORK_OS_DETAILED_DESIGN.md",
      "package.json"
    ],
    generatedAt,
  }),
};

mkdirSync(dirname(artifactPath), { recursive: true });
writeFileSync(artifactPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ artifact: artifactPath, ...report }, null, 2));
if (failed) process.exit(1);
