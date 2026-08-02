import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import process from "node:process";

const ROOT = resolve(process.cwd());
const OUT = join(ROOT, ".codex-auto", "quality", "a9-a4-timeout-budget.json");

const paths = {
  workOrder: "audit-remediation-instructions.md",
  plan: "docs/specs/COMPREHENSIVE_AUDIT_REMEDIATION_PLAN_2026-07-10.md",
  specIndex: "docs/specs/README.md",
  packageJson: "package.json",
  workOsVerifier: "scripts/verify-verifiable-agent-work-os-spec.mjs",
  refreshVerifier: "scripts/verify-goal-non-token-refresh.mjs",
  a4Verifier: "scripts/verify-a4-durability-acceptance.mjs",
  app: "src/App.tsx",
  rightRailShell: "src/features/right-rail/RightRailShell.tsx",
  a9ProviderGuard: ".codex-auto/quality/a9-no-token-provider-guard.json",
  noTokenRefresh: ".codex-auto/quality/final-goal-safe-no-token.json",
  a4Acceptance: ".codex-auto/quality/a4-durability-acceptance.json",
  rightRailDensity: ".codex-auto/quality/right-rail-information-density-contract.json",
};

const allowedDirtyPaths = new Set([
  "audit-remediation-instructions.md",
  "docs/specs/COMPREHENSIVE_AUDIT_REMEDIATION_PLAN_2026-07-10.md",
  "docs/specs/README.md",
  "package.json",
  "scripts/verify-a9-a4-timeout-budget.mjs",
  "scripts/verify-goal-non-token-refresh.mjs",
  "scripts/verify-verifiable-agent-work-os-spec.mjs",
]);

const expectedFailedStepIds = [
  "anti-stall-contract",
  "authenticated-consent-packet",
  "authenticated-preflight-matrix",
  "external-gate-readiness",
  "final-goal-audit",
  "goal-completion-matrix",
  "native-boundary",
  "real-os-sleep-operator-handoff",
  "release-signing-operator-handoff",
  "right-rail-information-density",
].sort();

function fullPath(path) {
  return join(ROOT, path);
}

function readText(path) {
  return existsSync(fullPath(path)) ? readFileSync(fullPath(path), "utf8") : "";
}

function readJson(path) {
  try {
    return JSON.parse(readText(path));
  } catch {
    return null;
  }
}

function mtime(path) {
  return existsSync(fullPath(path)) ? statSync(fullPath(path)).mtimeMs : 0;
}

function sha256(path) {
  return existsSync(fullPath(path))
    ? createHash("sha256")
        .update(readFileSync(fullPath(path)))
        .digest("hex")
    : null;
}

function git(args) {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();
}

function isGitAncestor(candidate, descendant) {
  if (!candidate || !descendant) return false;
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", candidate, descendant], {
      cwd: ROOT,
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

function dirtyPaths() {
  const raw = execFileSync("git", ["status", "--porcelain=v1", "--untracked-files=all"], {
    cwd: ROOT,
    encoding: "utf8",
  }).trimEnd();
  if (!raw) return [];
  return raw
    .split(/\r?\n/)
    .map((line) => line.slice(3).trim())
    .map((path) => (path.includes(" -> ") ? path.split(" -> ").at(-1) : path))
    .map((path) => path.replace(/^"|"$/g, "").replaceAll("\\", "/"));
}

function changedPathsBetween(base, head) {
  if (!base || !head || base === head) return [];
  try {
    const raw = git(["diff", "--name-only", `${base}..${head}`]);
    return raw ? raw.split(/\r?\n/).map((path) => path.replaceAll("\\", "/")) : [];
  } catch {
    return ["<unresolvable-commit-delta>"];
  }
}

function backtickField(text, label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text.match(new RegExp(`^${escaped}:\\s*\\x60([^\\x60]+)\\x60`, "m"))?.[1] ?? null;
}

function check(id, passed, detail, evidence = {}) {
  return { id, status: passed ? "passed" : "failed", detail, evidence };
}

function writeJsonAtomic(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(temporary, path);
}

const source = {
  workOrder: readText(paths.workOrder),
  plan: readText(paths.plan),
  specIndex: readText(paths.specIndex),
  packageJson: readText(paths.packageJson),
  workOsVerifier: readText(paths.workOsVerifier),
  refreshVerifier: readText(paths.refreshVerifier),
  a4Verifier: readText(paths.a4Verifier),
  app: readText(paths.app),
  rightRailShell: readText(paths.rightRailShell),
};
const artifacts = {
  a9ProviderGuard: readJson(paths.a9ProviderGuard),
  noTokenRefresh: readJson(paths.noTokenRefresh),
  a4Acceptance: readJson(paths.a4Acceptance),
  rightRailDensity: readJson(paths.rightRailDensity),
};

const missingPaths = Object.values(paths).filter((path) => !existsSync(fullPath(path)));
const head = git(["rev-parse", "HEAD"]);
const evidenceHead = artifacts.a9ProviderGuard?.git?.head ?? null;
const dirty = dirtyPaths();
const unexpectedDirtyPaths = dirty.filter((path) => !allowedDirtyPaths.has(path));
const commitDeltaPaths = changedPathsBetween(evidenceHead, head);
const unexpectedCommitDeltaPaths = commitDeltaPaths.filter((path) => !allowedDirtyPaths.has(path));
const evidenceHeadAllowed =
  isGitAncestor(evidenceHead, head) && unexpectedCommitDeltaPaths.length === 0 && commitDeltaPaths.length <= 7;

const frontier = {
  phase: backtickField(source.workOrder, "CURRENT PHASE"),
  activeSlice: backtickField(source.workOrder, "ACTIVE SLICE"),
  lastCompletedSlice: backtickField(source.workOrder, "LAST COMPLETED SLICE"),
  nextImplementationSlice: backtickField(source.workOrder, "NEXT IMPLEMENTATION SLICE"),
};
const frontierClosed =
  frontier.phase === "A9" &&
  frontier.activeSlice === "A9.4" &&
  frontier.lastCompletedSlice === "A9.3" &&
  frontier.nextImplementationSlice === "A9.4" &&
  source.plan.includes("### **A9.3 - A4 Acceptance Timeout Budget Closure**") &&
  source.plan.includes("`close_outer_timeout`") &&
  source.plan.includes("### **A9.4 - Right-Rail Information-Density Verifier Ownership Reconciliation**");

const a4DescriptorBudget =
  /id:\s*"a4-durability-acceptance"[\s\S]*?options:\s*\{\s*timeoutMs:\s*600_000\s*\}/.test(source.refreshVerifier) &&
  (source.refreshVerifier.match(/timeoutMs:\s*600_000/g) ?? []).length === 1;
const a4ScenarioBudgetPreserved =
  source.a4Verifier.includes("const scenarios = [") &&
  source.a4Verifier.includes("timeout: 240_000") &&
  source.a4Verifier.includes("minimumPassed: 12") &&
  source.a4Verifier.includes("minimumPassed: 16") &&
  source.a4Verifier.includes("requiredOutputMarkers");

const a4Scenarios = Array.isArray(artifacts.a4Acceptance?.scenarios) ? artifacts.a4Acceptance.scenarios : [];
const a4FocusedPass =
  artifacts.a4Acceptance?.status === "pass-current-a4-durability-evidence" &&
  artifacts.a4Acceptance?.phaseComplete === true &&
  artifacts.a4Acceptance?.repoOwnedComplete === true &&
  a4Scenarios.length === 25 &&
  a4Scenarios.every((scenario) => scenario.status === "pass") &&
  artifacts.a4Acceptance?.combinedRuntimeIntegrityMatrix?.status === "pass" &&
  artifacts.a4Acceptance?.externalProof?.realOsSleepResumeExecuted === false &&
  artifacts.a4Acceptance?.externalProof?.abruptHostPowerLossExecuted === false;

const noTokenGraph = artifacts.noTokenRefresh?.noTokenStepGraph;
const noTokenSteps = Array.isArray(artifacts.noTokenRefresh?.steps) ? artifacts.noTokenRefresh.steps : [];
const a4Step = noTokenSteps.find((step) => step?.id === "a4-durability-acceptance");
const a4AggregatePass =
  a4Step?.ok === true &&
  a4Step?.status === "pass" &&
  a4Step?.timedOut === false &&
  a4Step?.timeoutMs === 600_000 &&
  Number.isFinite(a4Step?.durationMs) &&
  a4Step.durationMs < a4Step.timeoutMs;
const graphPreserved =
  noTokenGraph?.descriptorCount === 23 &&
  noTokenGraph?.descriptorIds?.length === 23 &&
  noTokenGraph?.runtimeExecutedStepIds?.length === 23 &&
  noTokenGraph.runtimeExecutedStepIds.every((id, index) => id === noTokenGraph.descriptorIds[index]) &&
  noTokenGraph?.tokenBearingStepCount === 0 &&
  noTokenGraph?.runtimeTokenBearingStepCount === 0 &&
  noTokenGraph?.validatedBeforeSpawn === true;

const failedStepIds = noTokenSteps
  .filter((step) => step?.ok !== true)
  .map((step) => step.id)
  .sort();
const otherFailuresPreserved =
  !failedStepIds.includes("a4-durability-acceptance") &&
  failedStepIds.length === expectedFailedStepIds.length &&
  failedStepIds.every((id, index) => id === expectedFailedStepIds[index]);
const evidenceChronologyValid =
  Date.parse(artifacts.a9ProviderGuard?.generatedAt ?? "") < Date.parse(artifacts.a4Acceptance?.generatedAt ?? "") &&
  Date.parse(artifacts.a4Acceptance?.generatedAt ?? "") < Date.parse(artifacts.noTokenRefresh?.generatedAt ?? "");

const rightRailFailedIds = Array.isArray(artifacts.rightRailDensity?.checks)
  ? artifacts.rightRailDensity.checks
      .filter((item) => item.ok !== true)
      .map((item) => item.id)
      .sort()
  : [];
const expectedRightRailFailures = ["command-stack-toolkit-first", "orchestra-spine-first"].sort();
const rightRailOwnerDriftSelected =
  rightRailFailedIds.length === expectedRightRailFailures.length &&
  rightRailFailedIds.every((id, index) => id === expectedRightRailFailures[index]) &&
  !source.app.includes('<div className="right-panel-content">') &&
  source.rightRailShell.includes('<div className="right-panel-content">') &&
  source.app.includes("<RightRailShell") &&
  frontier.activeSlice === "A9.4";

const checks = [
  check("required-paths", missingPaths.length === 0, "all A9.3 source and evidence paths exist", {
    missingPaths,
  }),
  check("frontier-advanced", frontierClosed, "A9.3 advances only to exact slice A9.4", { frontier }),
  check(
    "a4-descriptor-budget-bounded",
    a4DescriptorBudget,
    "only the A4 aggregate descriptor receives the explicit 600-second outer budget",
  ),
  check(
    "a4-scenario-budget-preserved",
    a4ScenarioBudgetPreserved,
    "scenario-local timeout, minimum counts, and output markers remain unchanged",
  ),
  check(
    "a4-focused-acceptance",
    a4FocusedPass,
    "all 25 unchanged A4 scenarios pass without real sleep or abrupt host power loss",
    { scenarioCount: a4Scenarios.length },
  ),
  check(
    "a4-aggregate-timeout-closed",
    a4AggregatePass,
    "the aggregate records A4 pass inside the explicit 600-second budget",
    { a4Step },
  ),
  check(
    "no-token-graph-preserved",
    graphPreserved &&
      artifacts.noTokenRefresh?.tokenSpendingPromptExecutedByThisRun === false &&
      artifacts.noTokenRefresh?.realOsSleepInvoked === false,
    "all 23 descriptors execute under the unchanged token-free pre-spawn authority",
  ),
  check(
    "independent-blockers-preserved",
    otherFailuresPreserved,
    "A4 leaves the ten independent failed steps visible",
    { failedStepIds, expectedFailedStepIds },
  ),
  check(
    "evidence-chronology",
    evidenceChronologyValid,
    "focused A4 evidence precedes the single post-change aggregate and follows A9.2",
    {
      a9ProviderGuard: artifacts.a9ProviderGuard?.generatedAt ?? null,
      a4Acceptance: artifacts.a4Acceptance?.generatedAt ?? null,
      noTokenRefresh: artifacts.noTokenRefresh?.generatedAt ?? null,
    },
  ),
  check(
    "right-rail-owner-drift-selected-next",
    rightRailOwnerDriftSelected,
    "A9.4 selects the reproducible App/RightRailShell verifier ownership drift",
    { rightRailFailedIds },
  ),
  check(
    "release-block-preserved",
    artifacts.noTokenRefresh?.ok === false &&
      artifacts.noTokenRefresh?.status === "failed" &&
      artifacts.noTokenRefresh?.score?.releaseCandidateReady === false,
    "A9.3 grants no release or capability credit",
  ),
  check(
    "package-command",
    source.packageJson.includes('"verify:a9:a4-timeout-budget"') &&
      source.packageJson.includes("node scripts/verify-a9-a4-timeout-budget.mjs"),
    "package.json exposes the focused A9.3 verifier",
  ),
  check(
    "evidence-head-bounded",
    evidenceHeadAllowed,
    "A9.3 is evaluated from the committed A9.2 evidence head with only owned commit paths",
    { evidenceHead, head, commitDeltaPaths, unexpectedCommitDeltaPaths },
  ),
  check("dirty-scope", unexpectedDirtyPaths.length === 0, "the A9.3 candidate contains only owned paths", {
    dirtyPaths: dirty,
    unexpectedDirtyPaths,
  }),
];

const failed = checks.filter((item) => item.status !== "passed");
const contractPass = failed.length === 0;
const committedAtHead = contractPass && dirty.length === 0 && head !== evidenceHead;
const report = {
  schema: "aelyris.a9_3_a4_timeout_budget/v1",
  contractVersion: 1,
  ok: contractPass,
  status: !contractPass
    ? "fail-a9.3-a4-timeout-budget"
    : committedAtHead
      ? "pass-a9.3-close-outer-timeout-committed"
      : "pass-a9.3-close-outer-timeout-ready-to-commit",
  generatedAt: new Date().toISOString(),
  git: {
    head,
    evidenceHead,
    branch: git(["branch", "--show-current"]),
    dirtyPaths: dirty,
    commitDeltaPaths,
  },
  completedSlice: "A9.3",
  activeSlice: "A9.4",
  nextImplementationSlice: "A9.4",
  decision: "close_outer_timeout",
  phaseComplete: committedAtHead,
  readyToCommit: contractPass && !committedAtHead,
  releaseReady: false,
  tokenSpendingPromptExecutedByThisRun: false,
  realOsSleepInvokedByThisRun: false,
  signingInvokedByThisRun: false,
  publicationInvokedByThisRun: false,
  a4Evidence: {
    focusedScenarioCount: a4Scenarios.length,
    aggregateStep: a4Step,
    descriptorTimeoutMs: 600_000,
    scenarioTimeoutMs: 240_000,
  },
  selectedNextDefect: {
    id: "right-rail-information-density-owner-drift",
    ownerClass: "repo_owned",
    candidateType: "verification_strategy",
    nextSlice: "A9.4",
    failedChecks: rightRailFailedIds,
  },
  checks,
  inputs: Object.fromEntries(
    Object.entries(paths).map(([id, path]) => [id, { path, mtimeMs: mtime(path), sha256: sha256(path) }]),
  ),
  artifact: ".codex-auto/quality/a9-a4-timeout-budget.json",
};

writeJsonAtomic(OUT, report);
console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exitCode = 1;
