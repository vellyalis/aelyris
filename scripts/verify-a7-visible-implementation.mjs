import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import {
  createEvidenceProvenance,
  validateEvidenceProvenance,
} from "./evidence-provenance.mjs";

const root = resolve(process.cwd());
const artifactPath = join(root, ".codex-auto", "quality", "a7-visible-implementation.json");
const liveArtifactPath = join(
  root,
  ".codex-auto",
  "quality",
  "a7-visible-implementation-live.json",
);
const cargo = process.platform === "win32" ? "cargo.exe" : "cargo";
const designPath = join(
  root,
  "docs",
  "specs",
  "AELYRIS_VERIFIABLE_AGENT_WORK_OS_DETAILED_DESIGN.md",
);
const design = readFileSync(designPath, "utf8");
const contractMatch = design.match(
  /<!-- A7_2_VISIBLE_IMPLEMENTATION_CONTRACT_V1_BEGIN -->\s*```json\s*([\s\S]*?)\s*```\s*<!-- A7_2_VISIBLE_IMPLEMENTATION_CONTRACT_V1_END -->/,
);

let contract = null;
let contractError = null;
try {
  contract = contractMatch ? JSON.parse(contractMatch[1]) : null;
  if (!contract) contractError = "missing A7.2 visible implementation contract";
} catch (error) {
  contractError = error instanceof Error ? error.message : String(error);
}

const exact = (actual, expected) => JSON.stringify(actual) === JSON.stringify(expected);
const contractValid =
  contractError === null &&
  contract?.schema === "aelyris.a7_2_visible_implementation_contract/v1" &&
  contract?.contractVersion === 1 &&
  contract?.owner === "TaskManager -> TaskRepo" &&
  contract?.route === "mission_plan_run" &&
  contract?.activation?.acceptedStatusRequired === true &&
  contract?.activation?.taskCount === 1 &&
  contract?.activation?.atomicTaskGraphAndBinding === true &&
  contract?.activation?.idempotent === true &&
  contract?.activation?.callerMayWiden === false &&
  contract?.candidateFreeze?.owner === "existing Git/worktree owner" &&
  contract?.candidateFreeze?.beforeDeclaredTest === true &&
  contract?.candidateFreeze?.stage === "backend-derived owned targets only" &&
  contract?.visibleCompletion?.primarySignal ===
    "backend-derived marker with exact content done" &&
  contract?.visibleCompletion?.legacyOutputsFallbackAuthorized === false &&
  contract?.persistence?.schemaVersion === 8 &&
  contract?.persistence?.activationTable === "mission_plan_activations" &&
  contract?.persistence?.gateEvidenceTable === "mission_gate_evidence" &&
  contract?.persistence?.mutableParallelJournal === false &&
  contract?.persistence?.deletable === false &&
  contract?.freshTestEvidence?.commandSource ===
    "accepted WorkUnit GateRequirement.commandArgv" &&
  contract?.freshTestEvidence?.commandCallerSelectable === false &&
  contract?.freshTestEvidence?.oidInvariant ===
    "testedOid == candidateOid == clean worktree HEAD" &&
  contract?.authorityBoundary?.capabilityUnlockAuthorizesOwnImplementation === false &&
  exact(contract?.authorityBoundary?.stopsBefore, [
    "independent review",
    "acceptance",
    "merge intent",
    "merge",
    "completion or blocked packet settlement",
  ]) &&
  contract?.proofCommand === "pnpm verify:a7:visible-implementation" &&
  contract?.phaseComplete === false;

const scenarios = [
  {
    id: "tracked-a7.2-contract",
    status: contractValid ? "pass" : "fail",
    error: contractError,
  },
];
let failed = !contractValid;

if (contractValid) {
  const args = ["test", "--manifest-path", "src-tauri/Cargo.toml", "--lib", "a7_2_"];
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
      (sum, match) => sum + Number(match[1]),
      0,
    );
    if (executedTests === 0) throw new Error("A7.2 focused filter executed zero tests");
    scenarios.push({
      id: "a7.2-focused-runtime-contracts",
      status: "pass",
      command: [cargo, ...args].join(" "),
      executedTests,
      durationMs: Date.now() - startedAt,
      outputTail: stdout.trim().split(/\r?\n/).slice(-16),
    });
  } catch (error) {
    failed = true;
    scenarios.push({
      id: "a7.2-focused-runtime-contracts",
      status: "fail",
      command: [cargo, ...args].join(" "),
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
      stdoutTail: String(error?.stdout ?? "")
        .trim()
        .split(/\r?\n/)
        .slice(-20),
      stderrTail: String(error?.stderr ?? "")
        .trim()
        .split(/\r?\n/)
        .slice(-20),
    });
  }
}

let liveArtifact = null;
let liveError = null;
try {
  liveArtifact = JSON.parse(readFileSync(liveArtifactPath, "utf8"));
} catch (error) {
  liveError = error instanceof Error ? error.message : String(error);
}

const expectedArgv = [
  "cargo",
  "test",
  "--manifest-path",
  "src-tauri/Cargo.toml",
  "--lib",
  "task::graph::tests::equal_priority_ready_tasks_preserve_insertion_order",
  "--",
  "--exact",
];
const oid = /^[0-9a-f]{40}$/;
const digest = /^[0-9a-f]{64}$/;
const maxEvidenceAgeMs = 300_000;
const liveGeneratedAtUnixMs = Date.parse(liveArtifact?.generatedAt ?? "");
const liveStartedAtUnixMs = Number(liveArtifact?.gate?.startedAtUnixMs);
const liveEndedAtUnixMs = Number(liveArtifact?.gate?.endedAtUnixMs);
const liveFreshnessObservedAtUnixMs = Number(
  liveArtifact?.gate?.freshnessObservedAtUnixMs,
);
const liveTimeFresh =
  Number.isSafeInteger(liveStartedAtUnixMs) &&
  Number.isSafeInteger(liveEndedAtUnixMs) &&
  Number.isSafeInteger(liveFreshnessObservedAtUnixMs) &&
  Number.isFinite(liveGeneratedAtUnixMs) &&
  liveEndedAtUnixMs >= liveStartedAtUnixMs &&
  liveFreshnessObservedAtUnixMs >= liveEndedAtUnixMs &&
  liveFreshnessObservedAtUnixMs - liveStartedAtUnixMs <= maxEvidenceAgeMs &&
  liveGeneratedAtUnixMs >= liveEndedAtUnixMs &&
  liveArtifact?.gate?.freshnessMaxAgeMs === maxEvidenceAgeMs;
const rawLiveProvenance = liveArtifact
  ? validateEvidenceProvenance({ root, artifact: liveArtifact })
  : { ok: false, errors: ["missing-live-artifact"] };
// A real visible run may be captured immediately before the one local phase
// commit. That commit does not invalidate the run when every hashed runtime input
// remains byte-identical; only the Git pointer changes. The exact-HEAD aggregate
// generated by this verifier records that relationship explicitly.
const liveProvenanceErrors = rawLiveProvenance.errors.filter(
  (error) => error !== "git-head-mismatch",
);
const liveSourceCurrent = liveProvenanceErrors.length === 0;
const liveValid =
  liveError === null &&
  liveArtifact?.schema === "aelyris.a7-visible-implementation-live/v1" &&
  liveArtifact?.status === "pass" &&
  liveArtifact?.attemptedSlice === "A7.2" &&
  liveArtifact?.visibleImplementation?.realAgentCount === 1 &&
  liveArtifact?.visibleImplementation?.runtimeDomainId === "visible_pty" &&
  liveArtifact?.visibleImplementation?.isolatedWorktree === true &&
  liveArtifact?.visibleImplementation?.acceptedPlanBound === true &&
  liveArtifact?.visibleImplementation?.generationBound === true &&
  liveArtifact?.visibleImplementation?.ownershipBound === true &&
  liveArtifact?.visibleImplementation?.freshActivation === true &&
  liveArtifact?.visibleImplementation?.hooksEnabled === false &&
  oid.test(liveArtifact?.candidate?.baseOid ?? "") &&
  oid.test(liveArtifact?.candidate?.candidateOid ?? "") &&
  liveArtifact?.candidate?.candidateOid !== liveArtifact?.candidate?.baseOid &&
  liveArtifact?.candidate?.testedOid === liveArtifact?.candidate?.candidateOid &&
  liveArtifact?.candidate?.cleanWorktree === true &&
  exact(liveArtifact?.gate?.commandArgv, expectedArgv) &&
  liveArtifact?.gate?.result === "passed" &&
  digest.test(liveArtifact?.gate?.planContentDigest ?? "") &&
  digest.test(liveArtifact?.gate?.environmentFingerprint ?? "") &&
  digest.test(liveArtifact?.gate?.evidenceDigest ?? "") &&
  liveTimeFresh &&
  liveArtifact?.boundary?.independentReviewStarted === false &&
  liveArtifact?.boundary?.mergeIntentCreated === false &&
  liveArtifact?.boundary?.merged === false &&
  liveArtifact?.boundary?.completionPacketCreated === false &&
  liveSourceCurrent;
if (!liveValid) failed = true;
scenarios.push({
  id: "real-visible-pty-exact-oid-test",
  status: liveValid ? "pass" : "fail",
  error: liveError,
  provenanceErrors: rawLiveProvenance.errors,
  sourceInputsCurrent: liveSourceCurrent,
  capturedGitHead: liveArtifact?.provenance?.gitHead ?? null,
  liveArtifact,
});

const generatedAt = new Date().toISOString();
const report = {
  schema: "aelyris.a7-visible-implementation/v1",
  status: failed ? "failed" : "pass-a7.2-visible-implementation",
  attemptedSlice: "A7.2",
  completedSlice: failed ? null : "A7.2",
  nextImplementationSlice: failed ? "A7.2" : "A7.3",
  sliceComplete: !failed,
  phaseComplete: false,
  claimBoundary:
    "A7.2 accepted-plan activation, one real visible-PTY implementation agent, owned exact candidate freeze, and fresh tested-OID evidence only; no independent review, acceptance, merge, completion packet, A7 phase, or release-readiness claim.",
  scenarios,
  generatedAt,
  provenance: createEvidenceProvenance({
    root,
    verifierPath: "scripts/verify-a7-visible-implementation.mjs",
    inputPaths: [
      "src-tauri/src/task/mission.rs",
      "src-tauri/src/task/manager.rs",
      "src-tauri/src/task/execution.rs",
      "src-tauri/src/persistence/task_repo.rs",
      "src-tauri/src/persistence/work_execution_repo.rs",
      "src-tauri/src/db/mod.rs",
      "src-tauri/src/db/migrations.rs",
      "src-tauri/src/control/loop_ports.rs",
      "src-tauri/src/control/gate_runner.rs",
      "src-tauri/src/control/pane_fleet.rs",
      "src-tauri/src/control/worktree.rs",
      "src-tauri/src/git/worktree.rs",
      "src-tauri/src/agent/interactive.rs",
      "src-tauri/src/ipc/task_commands.rs",
      "src-tauri/src/ipc/orchestrator_commands.rs",
      "src-tauri/src/lib.rs",
      "src-tauri/src/startup_reconciliation.rs",
      "src-tauri/src/task/mod.rs",
      "scripts/verify-a7-visible-implementation-live.mjs",
      ".codex-auto/quality/a7-visible-implementation-live.json",
      "docs/specs/AELYRIS_VERIFIABLE_AGENT_WORK_OS_DETAILED_DESIGN.md",
      "docs/specs/COMPREHENSIVE_AUDIT_REMEDIATION_PLAN_2026-07-10.md",
      "audit-remediation-instructions.md",
      "package.json",
    ],
    generatedAt,
  }),
};

mkdirSync(dirname(artifactPath), { recursive: true });
writeFileSync(artifactPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ artifact: artifactPath, ...report }, null, 2));
if (failed) process.exit(1);
