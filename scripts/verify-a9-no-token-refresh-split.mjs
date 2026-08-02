import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { validateEvidenceDependencyGraph } from "./evidence-provenance.mjs";

const ROOT = resolve(process.cwd());
const OUT = join(ROOT, ".codex-auto", "quality", "a9-no-token-refresh-split.json");

const paths = {
  workOrder: "audit-remediation-instructions.md",
  plan: "docs/specs/COMPREHENSIVE_AUDIT_REMEDIATION_PLAN_2026-07-10.md",
  specIndex: "docs/specs/README.md",
  packageJson: "package.json",
  workOsVerifier: "scripts/verify-verifiable-agent-work-os-spec.mjs",
  refreshVerifier: "scripts/verify-goal-non-token-refresh.mjs",
  a9Inventory: ".codex-auto/quality/a9-release-evidence-inventory.json",
  noTokenRefresh: ".codex-auto/quality/final-goal-safe-no-token.json",
  score: ".codex-auto/quality/release-quality-score.json",
  finalAudit: ".codex-auto/quality/final-goal-audit.json",
  preflightMatrix: ".codex-auto/production-smoke/authenticated-ai-cli-preflight-matrix.json",
};

const allowedDirtyPaths = new Set([
  "audit-remediation-instructions.md",
  "docs/specs/COMPREHENSIVE_AUDIT_REMEDIATION_PLAN_2026-07-10.md",
  "docs/specs/README.md",
  "package.json",
  "scripts/verify-a9-no-token-refresh-split.mjs",
  "scripts/verify-verifiable-agent-work-os-spec.mjs",
]);

const failedStepClassification = [
  { id: "native-boundary", evidenceKind: "direct", ownerClass: "repo_owned", actionable: true },
  {
    id: "authenticated-preflight-matrix",
    evidenceKind: "direct",
    ownerClass: "repo_owned",
    actionable: true,
  },
  {
    id: "authenticated-consent-packet",
    evidenceKind: "direct",
    ownerClass: "policy",
    actionable: false,
  },
  {
    id: "a4-durability-acceptance",
    evidenceKind: "direct",
    ownerClass: "repo_owned",
    actionable: true,
  },
  {
    id: "right-rail-information-density",
    evidenceKind: "direct",
    ownerClass: "repo_owned",
    actionable: true,
  },
  { id: "anti-stall-contract", evidenceKind: "direct", ownerClass: "repo_owned", actionable: true },
  {
    id: "release-signing-operator-handoff",
    evidenceKind: "direct",
    ownerClass: "operator",
    actionable: false,
  },
  {
    id: "real-os-sleep-operator-handoff",
    evidenceKind: "direct",
    ownerClass: "operator",
    actionable: false,
  },
  {
    id: "external-gate-readiness",
    evidenceKind: "direct",
    ownerClass: "external",
    actionable: false,
  },
  {
    id: "final-goal-audit",
    evidenceKind: "derived",
    ownerClass: "repo_owned",
    actionable: false,
  },
  {
    id: "goal-completion-matrix",
    evidenceKind: "aggregate",
    ownerClass: "repo_owned",
    actionable: false,
  },
];

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

function git(args, options = {}) {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8", ...options }).trim();
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
};
const artifacts = {
  a9Inventory: readJson(paths.a9Inventory),
  noTokenRefresh: readJson(paths.noTokenRefresh),
  score: readJson(paths.score),
  finalAudit: readJson(paths.finalAudit),
  preflightMatrix: readJson(paths.preflightMatrix),
};

const requiredPaths = Object.values(paths);
const missingPaths = requiredPaths.filter((path) => !existsSync(fullPath(path)));
const head = git(["rev-parse", "HEAD"]);
const dirty = dirtyPaths();
const unexpectedDirtyPaths = dirty.filter((path) => !allowedDirtyPaths.has(path));
const evidenceHead = artifacts.score?.provenance?.gitHead ?? null;
const commitDeltaPaths = changedPathsBetween(evidenceHead, head);
const unexpectedCommitDeltaPaths = commitDeltaPaths.filter((path) => !allowedDirtyPaths.has(path));
const evidenceHeadAllowed =
  isGitAncestor(evidenceHead, head) && unexpectedCommitDeltaPaths.length === 0 && commitDeltaPaths.length <= 6;

const frontier = {
  phase: backtickField(source.workOrder, "CURRENT PHASE"),
  activeSlice: backtickField(source.workOrder, "ACTIVE SLICE"),
  lastCompletedSlice: backtickField(source.workOrder, "LAST COMPLETED SLICE"),
  nextImplementationSlice: backtickField(source.workOrder, "NEXT IMPLEMENTATION SLICE"),
};
const frontierClosed =
  frontier.phase === "A9" &&
  frontier.activeSlice === "A9.2" &&
  frontier.lastCompletedSlice === "A9.1" &&
  frontier.nextImplementationSlice === "A9.2" &&
  source.plan.includes("### **A9.2 - No-Token Provider-Guard Dependency Closure**") &&
  source.plan.includes("`repair_dependency_graph`");

const noTokenGraph = artifacts.noTokenRefresh?.noTokenStepGraph;
const descriptorIds = Array.isArray(noTokenGraph?.descriptorIds) ? noTokenGraph.descriptorIds : [];
const runtimeIds = Array.isArray(noTokenGraph?.runtimeExecutedStepIds) ? noTokenGraph.runtimeExecutedStepIds : [];
const graphExecutedExactly =
  descriptorIds.length === 23 &&
  runtimeIds.length === descriptorIds.length &&
  runtimeIds.every((id, index) => id === descriptorIds[index]);
const noForbiddenExecution =
  artifacts.noTokenRefresh?.tokenSpendingPromptExecutedByThisRun === false &&
  artifacts.noTokenRefresh?.realOsSleepInvoked === false &&
  noTokenGraph?.tokenBearingStepCount === 0 &&
  noTokenGraph?.runtimeTokenBearingStepCount === 0 &&
  noTokenGraph?.validatedBeforeSpawn === true;

const steps = Array.isArray(artifacts.noTokenRefresh?.steps) ? artifacts.noTokenRefresh.steps : [];
const failedSteps = steps.filter((step) => step?.ok !== true);
const failedStepIds = failedSteps.map((step) => step.id).sort();
const classifiedStepIds = failedStepClassification.map((step) => step.id).sort();
const exactFailedStepClassification =
  failedStepIds.length === classifiedStepIds.length &&
  failedStepIds.every((id, index) => id === classifiedStepIds[index]);
const actionableDirectSteps = failedStepClassification.filter(
  (step) => step.evidenceKind === "direct" && step.actionable,
);
const nonDirectSteps = failedStepClassification.filter((step) => step.evidenceKind !== "direct");

const ownerCounts = Object.fromEntries(
  ["repo_owned", "policy", "operator", "external"].map((ownerClass) => [
    ownerClass,
    failedStepClassification.filter((step) => step.ownerClass === ownerClass).length,
  ]),
);
const staleEvidencePaths = Array.isArray(artifacts.score?.provenanceRejections)
  ? artifacts.score.provenanceRejections.map((entry) => ({
      path: entry.path,
      ownerClass: "stale_evidence",
      errors: entry.errors,
    }))
  : [];
const finalAuditProvenanceRejectionCount = Array.isArray(artifacts.finalAudit?.provenanceRejections)
  ? artifacts.finalAudit.provenanceRejections.length
  : 0;

const selectedDefect = {
  id: "authenticated-provider-guard-descriptor-missing",
  ownerClass: "repo_owned",
  candidateType: "verification_strategy",
  nextSlice: "A9.2",
  refreshCommand: "pnpm verify:terminal:authenticated-ai-cli-provider-guard",
  reason:
    "the no-token fallback registry and fresh matrix name the provider guard, but the descriptor graph omits it before dependent consumers",
};
const providerGuardEvidence = artifacts.preflightMatrix?.artifacts?.providerGuard;
const providerGuardDefectObserved =
  source.refreshVerifier.includes('"authenticated-provider-guard": [') &&
  providerGuardEvidence?.fresh === false &&
  providerGuardEvidence?.blockingReason === "stale" &&
  providerGuardEvidence?.refreshCommand === selectedDefect.refreshCommand &&
  !descriptorIds.includes("authenticated-provider-guard");
const a4TimeoutSeparated = failedSteps.some(
  (step) => step.id === "a4-durability-acceptance" && step.status === "timed-out" && step.timedOut === true,
);

const scoreGraphValidation = validateEvidenceDependencyGraph(artifacts.score?.dependencyGraph);
const finalAuditGraphValidation = validateEvidenceDependencyGraph(artifacts.finalAudit?.dependencyGraph);
const finalAuditDownstream = artifacts.finalAudit?.dependencyGraph?.nodes?.some?.(
  (node) =>
    node?.id === "final-goal-audit" &&
    node?.kind === "derived" &&
    Array.isArray(node?.dependsOn) &&
    node.dependsOn.length === 1 &&
    node.dependsOn[0] === "release-score",
);
const generatedAtMs = Date.parse(artifacts.noTokenRefresh?.generatedAt ?? "");
const inventoryGeneratedAtMs = Date.parse(artifacts.a9Inventory?.generatedAt ?? "");
const evidenceRunCurrentAtBase =
  Number.isFinite(generatedAtMs) &&
  Number.isFinite(inventoryGeneratedAtMs) &&
  generatedAtMs > inventoryGeneratedAtMs &&
  artifacts.score?.provenance?.gitHead === evidenceHead &&
  artifacts.finalAudit?.provenance?.gitHead === evidenceHead &&
  evidenceHeadAllowed;

const checks = [
  check("required-paths", missingPaths.length === 0, "all A9.1 authority and evidence paths exist", {
    missingPaths,
  }),
  check("frontier-advanced", frontierClosed, "A9.1 advances only to exact slice A9.2", { frontier }),
  check(
    "descriptor-graph-executed",
    graphExecutedExactly,
    "all 23 declared no-token descriptors executed once in order",
    { descriptorIds, runtimeIds },
  ),
  check(
    "forbidden-actions-absent",
    noForbiddenExecution,
    "the refresh executed no token-bearing prompt and did not invoke real OS sleep",
    {
      tokenSpendingPromptExecutedByThisRun: artifacts.noTokenRefresh?.tokenSpendingPromptExecutedByThisRun,
      realOsSleepInvoked: artifacts.noTokenRefresh?.realOsSleepInvoked,
      tokenBearingStepCount: noTokenGraph?.tokenBearingStepCount,
      runtimeTokenBearingStepCount: noTokenGraph?.runtimeTokenBearingStepCount,
    },
  ),
  check(
    "fresh-at-evidence-head",
    evidenceRunCurrentAtBase,
    "score and final audit were regenerated at the exact evidence HEAD before the bounded A9.1 closeout diff",
    { evidenceHead, head, commitDeltaPaths, unexpectedCommitDeltaPaths },
  ),
  check(
    "blocked-honestly",
    artifacts.noTokenRefresh?.ok === false &&
      artifacts.noTokenRefresh?.status === "failed" &&
      artifacts.score?.releaseCandidateReady === false &&
      artifacts.finalAudit?.status === "blocked",
    "A9.1 preserves the aggregate BLOCK and grants no release credit",
    {
      score: artifacts.score?.score,
      max: artifacts.score?.max,
      grade: artifacts.score?.grade,
      finalAuditStatus: artifacts.finalAudit?.status,
    },
  ),
  check(
    "failed-step-owner-split",
    exactFailedStepClassification &&
      actionableDirectSteps.length === 5 &&
      ownerCounts.policy === 1 &&
      ownerCounts.operator === 2 &&
      ownerCounts.external === 1,
    "every failed refresh step has one owner and only five direct repo-owned steps remain actionable",
    { failedStepIds, failedStepClassification, ownerCounts },
  ),
  check(
    "downstream-views-not-direct",
    nonDirectSteps.length === 2 &&
      nonDirectSteps.some((step) => step.id === "final-goal-audit" && step.evidenceKind === "derived") &&
      nonDirectSteps.some((step) => step.id === "goal-completion-matrix" && step.evidenceKind === "aggregate") &&
      scoreGraphValidation.ok &&
      finalAuditGraphValidation.ok &&
      finalAuditDownstream,
    "aggregate and derived failures remain downstream views rather than duplicate direct defects",
    { nonDirectSteps, scoreGraphValidation, finalAuditGraphValidation },
  ),
  check(
    "stale-evidence-preserved",
    staleEvidencePaths.length === 58 &&
      finalAuditProvenanceRejectionCount === 69 &&
      staleEvidencePaths.every((entry) => entry.ownerClass === "stale_evidence"),
    "score input rejections remain stale evidence and stay separate from downstream audit rejections",
    {
      scoreStaleEvidenceCount: staleEvidencePaths.length,
      finalAuditProvenanceRejectionCount,
    },
  ),
  check(
    "selected-defect-causal",
    providerGuardDefectObserved && selectedDefect.nextSlice === frontier.activeSlice,
    "A9.2 selects the missing provider-guard descriptor before its matrix and consent consumers",
    { selectedDefect, providerGuardEvidence },
  ),
  check(
    "a4-timeout-separated",
    a4TimeoutSeparated,
    "the A4 timeout remains a separate root cause and is not folded into provider-guard closure",
    {},
  ),
  check(
    "package-command",
    source.packageJson.includes('"verify:a9:no-token-refresh-split"') &&
      source.packageJson.includes("node scripts/verify-a9-no-token-refresh-split.mjs"),
    "package.json exposes the focused A9.1 verifier",
    {},
  ),
  check("dirty-scope", unexpectedDirtyPaths.length === 0, "the A9.1 candidate contains only owned paths", {
    dirtyPaths: dirty,
    unexpectedDirtyPaths,
  }),
];

const failed = checks.filter((item) => item.status !== "passed");
const contractPass = failed.length === 0;
const committedAtHead = contractPass && dirty.length === 0 && head !== evidenceHead;
const report = {
  schema: "aelyris.a9_1_no_token_refresh_split/v1",
  contractVersion: 1,
  ok: contractPass,
  status: !contractPass
    ? "fail-a9.1-no-token-refresh-split"
    : committedAtHead
      ? "pass-a9.1-repair-dependency-graph-committed"
      : "pass-a9.1-repair-dependency-graph-ready-to-commit",
  generatedAt: new Date().toISOString(),
  git: {
    head,
    evidenceHead,
    branch: git(["branch", "--show-current"]),
    dirtyPaths: dirty,
    commitDeltaPaths,
  },
  completedSlice: "A9.1",
  activeSlice: "A9.2",
  nextImplementationSlice: "A9.2",
  decision: "repair_dependency_graph",
  phaseComplete: committedAtHead,
  readyToCommit: contractPass && !committedAtHead,
  releaseReady: false,
  currentScoreClaimAllowed: false,
  tokenSpendingPromptExecutedByThisRun: false,
  realOsSleepInvokedByThisRun: false,
  signingInvokedByThisRun: false,
  publicationInvokedByThisRun: false,
  noTokenRun: {
    generatedAt: artifacts.noTokenRefresh?.generatedAt ?? null,
    status: artifacts.noTokenRefresh?.status ?? null,
    descriptorCount: descriptorIds.length,
    executedCount: runtimeIds.length,
    passedStepCount: steps.filter((step) => step?.ok === true).length,
    failedStepCount: failedSteps.length,
  },
  observedScore: {
    score: artifacts.score?.score ?? null,
    max: artifacts.score?.max ?? null,
    grade: artifacts.score?.grade ?? null,
    releaseCandidateReady: artifacts.score?.releaseCandidateReady === true,
    directBlockerCount: artifacts.score?.blockerCounts?.uniqueDirect ?? null,
    aggregateBlockerCount: artifacts.score?.blockerCounts?.aggregate ?? null,
    derivedBlockerCount: artifacts.score?.blockerCounts?.derived ?? null,
    label: "fresh at evidence HEAD only; the A9.1 closeout diff intentionally invalidates current-score claims",
  },
  observedFinalAudit: {
    status: artifacts.finalAudit?.status ?? null,
    implementationFixableCount: artifacts.finalAudit?.implementationFixableCount ?? null,
    policyBlockedCount: artifacts.finalAudit?.policyBlockedCount ?? null,
    externalBlockedCount: artifacts.finalAudit?.externalBlockedCount ?? null,
    provenanceRejectionCount: finalAuditProvenanceRejectionCount,
  },
  failedStepClassification,
  staleEvidencePaths,
  ownerCounts: { ...ownerCounts, stale_evidence: staleEvidencePaths.length },
  selectedDefect,
  deferredRootCauses: [
    "a4-durability-acceptance-timeout",
    "right-rail-information-density-source-contract-drift",
    "anti-stall-operator-progress-artifact-not-resume-ready",
  ],
  checks,
  inputs: Object.fromEntries(
    Object.entries(paths).map(([id, path]) => [id, { path, mtimeMs: mtime(path), sha256: sha256(path) }]),
  ),
  artifact: ".codex-auto/quality/a9-no-token-refresh-split.json",
};

writeJsonAtomic(OUT, report);
console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exitCode = 1;
