import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import {
  AUTHENTICATED_PROMPT_PROVIDER_GUARD_SCRIPT,
  assertNoTokenStepGraph,
} from "./lib/authenticated-prompt-authority.mjs";

const ROOT = resolve(process.cwd());
const OUT = join(ROOT, ".codex-auto", "quality", "a9-no-token-provider-guard.json");

const paths = {
  workOrder: "audit-remediation-instructions.md",
  plan: "docs/specs/COMPREHENSIVE_AUDIT_REMEDIATION_PLAN_2026-07-10.md",
  specIndex: "docs/specs/README.md",
  packageJson: "package.json",
  workOsVerifier: "scripts/verify-verifiable-agent-work-os-spec.mjs",
  refreshVerifier: "scripts/verify-goal-non-token-refresh.mjs",
  a9RefreshSplit: ".codex-auto/quality/a9-no-token-refresh-split.json",
  noTokenRefresh: ".codex-auto/quality/final-goal-safe-no-token.json",
  providerGuard: ".codex-auto/production-smoke/authenticated-ai-cli-provider-required-smoke.json",
  preflightMatrix: ".codex-auto/production-smoke/authenticated-ai-cli-preflight-matrix.json",
  consentPacket: ".codex-auto/production-smoke/authenticated-ai-cli-consent-packet.json",
};

const allowedDirtyPaths = new Set([
  "audit-remediation-instructions.md",
  "docs/specs/COMPREHENSIVE_AUDIT_REMEDIATION_PLAN_2026-07-10.md",
  "docs/specs/README.md",
  "package.json",
  "scripts/verify-a9-no-token-provider-guard.mjs",
  "scripts/verify-verifiable-agent-work-os-spec.mjs",
]);

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
};
const artifacts = {
  a9RefreshSplit: readJson(paths.a9RefreshSplit),
  noTokenRefresh: readJson(paths.noTokenRefresh),
  providerGuard: readJson(paths.providerGuard),
  preflightMatrix: readJson(paths.preflightMatrix),
  consentPacket: readJson(paths.consentPacket),
};

const missingPaths = Object.values(paths).filter((path) => !existsSync(fullPath(path)));
const head = git(["rev-parse", "HEAD"]);
const evidenceHead = artifacts.a9RefreshSplit?.git?.head ?? null;
const dirty = dirtyPaths();
const unexpectedDirtyPaths = dirty.filter((path) => !allowedDirtyPaths.has(path));
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
  frontier.activeSlice === "A9.3" &&
  frontier.lastCompletedSlice === "A9.2" &&
  frontier.nextImplementationSlice === "A9.3" &&
  source.plan.includes("### **A9.2 - No-Token Provider-Guard Boundary Correction**") &&
  source.plan.includes("`reject_direct_descriptor`") &&
  source.plan.includes("### **A9.3 - A4 Acceptance Timeout Budget Closure**");

const expectedRejection =
  "NO_TOKEN_GRAPH_REJECTED: authenticated-provider-guard reaches token-bearing script " +
  AUTHENTICATED_PROMPT_PROVIDER_GUARD_SCRIPT;
let observedRejection = null;
try {
  assertNoTokenStepGraph([
    {
      id: "authenticated-provider-guard",
      label: "Authenticated prompt provider-required guard",
      script: AUTHENTICATED_PROMPT_PROVIDER_GUARD_SCRIPT,
      costClass: "no-token",
    },
  ]);
} catch (error) {
  observedRejection = error instanceof Error ? error.message : String(error);
}

const descriptorSection =
  source.refreshVerifier.match(/const stepDescriptors = \[([\s\S]*?)\n\];\n\nconst noTokenStepGraph/)?.[1] ?? "";
const noTokenGraph = artifacts.noTokenRefresh?.noTokenStepGraph;
const descriptorIds = Array.isArray(noTokenGraph?.descriptorIds) ? noTokenGraph.descriptorIds : [];
const runtimeIds = Array.isArray(noTokenGraph?.runtimeExecutedStepIds) ? noTokenGraph.runtimeExecutedStepIds : [];
const a4Step = Array.isArray(artifacts.noTokenRefresh?.steps)
  ? artifacts.noTokenRefresh.steps.find((step) => step?.id === "a4-durability-acceptance")
  : null;
const graphUnchanged =
  descriptorIds.length === 23 &&
  runtimeIds.length === 23 &&
  runtimeIds.every((id, index) => id === descriptorIds[index]) &&
  !descriptorIds.includes("authenticated-provider-guard") &&
  !descriptorSection.includes('id: "authenticated-provider-guard"') &&
  noTokenGraph?.validatedBeforeSpawn === true &&
  noTokenGraph?.tokenBearingStepCount === 0 &&
  noTokenGraph?.runtimeTokenBearingStepCount === 0;

const standaloneGuardSafe =
  artifacts.providerGuard?.status === "provider_required" &&
  artifacts.providerGuard?.tokenSpendingPromptExecutedByThisRun === false &&
  artifacts.providerGuard?.guardVerifier?.ok === true &&
  artifacts.providerGuard?.guardVerifier?.checks?.noPromptSent === true &&
  artifacts.providerGuard?.guardVerifier?.checks?.noSessionSpawned === true;

const matrixBlockingNames = Array.isArray(artifacts.preflightMatrix?.blockingArtifacts)
  ? artifacts.preflightMatrix.blockingArtifacts.map((entry) => entry.name).sort()
  : [];
const expectedMatrixBlockers = ["interactiveAiCliBoundary", "nativePostLaunchChaos", "postLaunchChaos"].sort();
const matrixBoundaryCurrent =
  artifacts.preflightMatrix?.artifacts?.providerGuard?.fresh === true &&
  artifacts.preflightMatrix?.artifacts?.providerGuard?.blockingReason == null &&
  !matrixBlockingNames.includes("providerGuard") &&
  matrixBlockingNames.length === expectedMatrixBlockers.length &&
  matrixBlockingNames.every((name, index) => name === expectedMatrixBlockers[index]);

const consentFailClosed =
  artifacts.consentPacket?.checks?.providerGuardBlocksPrompt === true &&
  artifacts.consentPacket?.packet?.promptState === "blocked_without_consent" &&
  artifacts.consentPacket?.packet?.tokenSpendingPromptExecuted === false;
const a4TimeoutPreserved =
  a4Step?.ok === false && a4Step?.status === "timed-out" && a4Step?.timedOut === true && a4Step?.timeoutMs === 180_000;

const checks = [
  check("required-paths", missingPaths.length === 0, "all A9.2 source and evidence paths exist", {
    missingPaths,
  }),
  check("frontier-advanced", frontierClosed, "A9.2 advances only to exact slice A9.3", { frontier }),
  check(
    "direct-insertion-rejected-before-spawn",
    observedRejection === expectedRejection,
    "the authority rejects the provider guard as token-bearing before any child spawn",
    { expectedRejection, observedRejection, childSpawnedByOracle: false },
  ),
  check(
    "no-token-current-best-preserved",
    graphUnchanged &&
      artifacts.noTokenRefresh?.tokenSpendingPromptExecutedByThisRun === false &&
      artifacts.noTokenRefresh?.realOsSleepInvoked === false,
    "the unchanged 23-step descriptor graph remains validated and token-free",
    { descriptorCount: descriptorIds.length, runtimeCount: runtimeIds.length },
  ),
  check(
    "standalone-provider-guard-safe",
    standaloneGuardSafe,
    "standalone policy proof rejects missing provider without prompt or session spawn",
    { status: artifacts.providerGuard?.status, guardVerifier: artifacts.providerGuard?.guardVerifier },
  ),
  check(
    "matrix-boundary-current",
    matrixBoundaryCurrent,
    "the matrix consumes fresh standalone guard proof and preserves three independent blockers",
    { matrixBlockingNames, providerGuard: artifacts.preflightMatrix?.artifacts?.providerGuard ?? null },
  ),
  check("consent-remains-fail-closed", consentFailClosed, "consent remains blocked without token execution", {
    promptState: artifacts.consentPacket?.packet?.promptState ?? null,
    tokenSpendingPromptExecuted: artifacts.consentPacket?.packet?.tokenSpendingPromptExecuted ?? null,
  }),
  check(
    "a4-timeout-selected-next",
    a4TimeoutPreserved && frontier.activeSlice === "A9.3",
    "A9.3 selects the independent A4 outer-timeout defect without weakening scenarios",
    { a4Step },
  ),
  check(
    "release-block-preserved",
    artifacts.noTokenRefresh?.ok === false && artifacts.noTokenRefresh?.status === "failed",
    "A9.2 grants no release or capability credit",
    { noTokenStatus: artifacts.noTokenRefresh?.status ?? null },
  ),
  check(
    "package-command",
    source.packageJson.includes('"verify:a9:no-token-provider-guard"') &&
      source.packageJson.includes("node scripts/verify-a9-no-token-provider-guard.mjs"),
    "package.json exposes the focused A9.2 verifier",
  ),
  check(
    "evidence-head-bounded",
    evidenceHeadAllowed,
    "A9.2 is evaluated from the committed A9.1 evidence head with only owned commit paths",
    { evidenceHead, head, commitDeltaPaths, unexpectedCommitDeltaPaths },
  ),
  check("dirty-scope", unexpectedDirtyPaths.length === 0, "the A9.2 candidate contains only owned paths", {
    dirtyPaths: dirty,
    unexpectedDirtyPaths,
  }),
];

const failed = checks.filter((item) => item.status !== "passed");
const contractPass = failed.length === 0;
const committedAtHead = contractPass && dirty.length === 0 && head !== evidenceHead;
const report = {
  schema: "aelyris.a9_2_no_token_provider_guard_boundary/v1",
  contractVersion: 1,
  ok: contractPass,
  status: !contractPass
    ? "fail-a9.2-provider-guard-boundary"
    : committedAtHead
      ? "pass-a9.2-reject-direct-descriptor-committed"
      : "pass-a9.2-reject-direct-descriptor-ready-to-commit",
  generatedAt: new Date().toISOString(),
  git: {
    head,
    evidenceHead,
    branch: git(["branch", "--show-current"]),
    dirtyPaths: dirty,
    commitDeltaPaths,
  },
  completedSlice: "A9.2",
  activeSlice: "A9.3",
  nextImplementationSlice: "A9.3",
  decision: "reject_direct_descriptor",
  phaseComplete: committedAtHead,
  readyToCommit: contractPass && !committedAtHead,
  releaseReady: false,
  tokenSpendingPromptExecutedByThisRun: false,
  realOsSleepInvokedByThisRun: false,
  signingInvokedByThisRun: false,
  publicationInvokedByThisRun: false,
  descriptorBoundary: {
    descriptorCount: descriptorIds.length,
    runtimeCount: runtimeIds.length,
    expectedRejection,
    observedRejection,
    directInsertionAdopted: false,
  },
  focusedEvidence: {
    providerGuardStatus: artifacts.providerGuard?.status ?? null,
    matrixStatus: artifacts.preflightMatrix?.status ?? null,
    matrixBlockingNames,
    consentStatus: artifacts.consentPacket?.status ?? null,
    consentPromptState: artifacts.consentPacket?.packet?.promptState ?? null,
  },
  selectedNextDefect: {
    id: "a4-durability-acceptance-timeout-budget",
    ownerClass: "repo_owned",
    candidateType: "verification_strategy",
    nextSlice: "A9.3",
  },
  checks,
  inputs: Object.fromEntries(
    Object.entries(paths).map(([id, path]) => [id, { path, mtimeMs: mtime(path), sha256: sha256(path) }]),
  ),
  artifact: ".codex-auto/quality/a9-no-token-provider-guard.json",
};

writeJsonAtomic(OUT, report);
console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exitCode = 1;
