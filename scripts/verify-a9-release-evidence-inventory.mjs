import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { validateEvidenceDependencyGraph, validateEvidenceProvenance } from "./evidence-provenance.mjs";

const ROOT = resolve(process.cwd());
const OUT = join(ROOT, ".codex-auto", "quality", "a9-release-evidence-inventory.json");
const OWNER_CLASSES = ["repo_owned", "stale_evidence", "policy", "operator", "external"];

const paths = {
  workOrder: "audit-remediation-instructions.md",
  plan: "docs/specs/COMPREHENSIVE_AUDIT_REMEDIATION_PLAN_2026-07-10.md",
  specIndex: "docs/specs/README.md",
  packageJson: "package.json",
  score: ".codex-auto/quality/release-quality-score.json",
  finalAudit: ".codex-auto/quality/final-goal-audit.json",
  currentReadiness: ".codex-auto/quality/current-readiness-source.json",
  releaseReadiness: ".codex-auto/quality/release-readiness-aggregate.json",
  a8Disposition: ".codex-auto/quality/a8-native-terminal-disposition.json",
  continuation: ".codex-auto/quality/audit-remediation-continuation.json",
};

const allowedDirtyPaths = new Set([
  "audit-remediation-instructions.md",
  "docs/specs/COMPREHENSIVE_AUDIT_REMEDIATION_PLAN_2026-07-10.md",
  "docs/specs/README.md",
  "package.json",
  "scripts/verify-a9-release-evidence-inventory.mjs",
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

function backtickField(text, label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text.match(new RegExp(`^${escaped}:\\s*\\x60([^\\x60]+)\\x60`, "m"))?.[1] ?? null;
}

function check(id, passed, detail, evidence = {}) {
  return { id, status: passed ? "passed" : "failed", detail, evidence };
}

function writeJsonAtomic(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(tmp, path);
}

function provenanceState(path, artifact) {
  const validation = validateEvidenceProvenance({ root: ROOT, artifact });
  return {
    path,
    exists: artifact != null,
    generatedAt: artifact?.generatedAt ?? artifact?.provenance?.generatedAt ?? null,
    mtimeMs: mtime(path),
    sourceHead: artifact?.provenance?.gitHead ?? null,
    current: validation.ok,
    classification: validation.ok ? "repo_owned" : "stale_evidence",
    provenanceErrors: validation.errors,
  };
}

const source = {
  workOrder: readText(paths.workOrder),
  plan: readText(paths.plan),
  specIndex: readText(paths.specIndex),
  packageJson: readText(paths.packageJson),
};
const artifacts = {
  score: readJson(paths.score),
  finalAudit: readJson(paths.finalAudit),
  currentReadiness: readJson(paths.currentReadiness),
  releaseReadiness: readJson(paths.releaseReadiness),
  a8Disposition: readJson(paths.a8Disposition),
  continuation: readJson(paths.continuation),
};

const requiredPaths = Object.values(paths);
const missingPaths = requiredPaths.filter((path) => !existsSync(fullPath(path)));
const head = git(["rev-parse", "HEAD"]);
const shortHead = git(["rev-parse", "--short", "HEAD"]);
const dirty = dirtyPaths();
const unexpectedDirtyPaths = dirty.filter((path) => !allowedDirtyPaths.has(path));
const frontier = {
  phase: backtickField(source.workOrder, "CURRENT PHASE"),
  activeSlice: backtickField(source.workOrder, "ACTIVE SLICE"),
  lastCompletedSlice: backtickField(source.workOrder, "LAST COMPLETED SLICE"),
  nextImplementationSlice: backtickField(source.workOrder, "NEXT IMPLEMENTATION SLICE"),
};

const snapshots = {
  releaseQualityScore: provenanceState(paths.score, artifacts.score),
  finalGoalAudit: provenanceState(paths.finalAudit, artifacts.finalAudit),
  currentReadinessSource: provenanceState(paths.currentReadiness, artifacts.currentReadiness),
  releaseReadinessAggregate: provenanceState(paths.releaseReadiness, artifacts.releaseReadiness),
};
const snapshotList = Object.values(snapshots);
const allReleaseSnapshotsStale = snapshotList.every(
  (snapshot) => snapshot.exists && snapshot.current === false && snapshot.classification === "stale_evidence",
);

const observedScores = Array.isArray(artifacts.score?.scores) ? artifacts.score.scores : [];
const observedBlockers = Array.isArray(artifacts.score?.allBlockers) ? artifacts.score.allBlockers : [];
const evidenceKinds = ["direct", "aggregate", "derived"];
const observedScoreRows = observedScores.map((row) => ({
  id: row.id,
  label: row.label,
  evidenceKind: row.kind,
  observedPoints: row.points,
  observedMax: row.max,
  observedBlockerCount: Array.isArray(row.blockers) ? row.blockers.length : 0,
  ownerClass: "stale_evidence",
  currentClaimAllowed: false,
  refreshCommand: "pnpm verify:goal:safe:no-token",
}));
const observedGateInventory = observedBlockers.map((blocker, index) => ({
  id: `observed:${blocker.area}:${String(index + 1).padStart(3, "0")}`,
  area: blocker.area,
  evidenceKind: blocker.kind,
  blocker: blocker.blocker,
  ownerClass: "stale_evidence",
  currentClaimAllowed: false,
  refreshCommand: "pnpm verify:goal:safe:no-token",
}));
const computedBlockerCounts = Object.fromEntries(
  evidenceKinds.map((kind) => [kind, observedBlockers.filter((blocker) => blocker.kind === kind).length]),
);

const stableGateInventory = [
  {
    id: "no-token-release-evidence-refresh",
    evidenceKind: "direct",
    ownerClass: "repo_owned",
    state: "executable_next",
    command: "pnpm verify:goal:safe:no-token",
    reason: "refresh current score and downstream final-goal truth before selecting a source defect",
  },
  {
    id: "alpha-claim-policy",
    evidenceKind: "direct",
    ownerClass: "policy",
    state: "blocking_claim",
    command: null,
    reason: "alpha and not-release-ready remains authoritative until current aggregate gates pass",
  },
  {
    id: "signed-distribution-updater-lifecycle",
    evidenceKind: "direct",
    ownerClass: "operator",
    state: "not_run_in_inventory",
    command: "pnpm verify:goal:release-signing-handoff",
    reason: "signing identity, timestamp, install, relaunch, and rollback proof require the release operator boundary",
  },
  {
    id: "real-sleep-power-loss-cycle",
    evidenceKind: "direct",
    ownerClass: "operator",
    state: "not_run_in_inventory",
    command: "pnpm verify:goal:sleep-handoff",
    reason: "real Windows sleep and abrupt power-loss evidence requires an explicit live operator cycle",
  },
  {
    id: "authenticated-provider-token-smoke",
    evidenceKind: "direct",
    ownerClass: "operator",
    state: "not_run_in_inventory",
    command: "pnpm verify:goal:operator:token-smoke",
    reason: "provider-selected token-spending execution is outside the A9.0 inventory",
  },
  {
    id: "rendered-webview2-dwm-signoff",
    evidenceKind: "direct",
    ownerClass: "operator",
    state: "not_run_in_inventory",
    command: "pnpm verify:right-rail:strict",
    reason: "strict rendered and DWM-visible proof requires the live Windows/WebView2 operator surface",
  },
  {
    id: "upstream-supply-chain-and-production-metadata",
    evidenceKind: "direct",
    ownerClass: "external",
    state: "not_run_in_inventory",
    command: "pnpm verify:supply-chain",
    reason: "upstream dependency movement and production metadata reachability are external to repo implementation",
  },
];

const ownerCounts = Object.fromEntries(
  OWNER_CLASSES.map((ownerClass) => [
    ownerClass,
    [...observedGateInventory, ...stableGateInventory].filter((gate) => gate.ownerClass === ownerClass).length,
  ]),
);
const everyGateHasOneOwner = [...observedGateInventory, ...stableGateInventory].every(
  (gate) => OWNER_CLASSES.includes(gate.ownerClass) && typeof gate.ownerClass === "string",
);
const scoreGraphValidation = validateEvidenceDependencyGraph(artifacts.score?.dependencyGraph);
const finalAuditGraphValidation = validateEvidenceDependencyGraph(artifacts.finalAudit?.dependencyGraph);
const finalAuditIsDownstreamOnly =
  finalAuditGraphValidation.ok &&
  artifacts.finalAudit?.dependencyGraph?.nodes?.some?.(
    (node) =>
      node?.id === "final-goal-audit" &&
      node?.kind === "derived" &&
      Array.isArray(node?.dependsOn) &&
      node.dependsOn.length === 1 &&
      node.dependsOn[0] === "release-score",
  );

const frontierClosed =
  frontier.phase === "A9" &&
  frontier.activeSlice === "A9.1" &&
  frontier.lastCompletedSlice === "A9.0" &&
  frontier.nextImplementationSlice === "A9.1" &&
  source.plan.includes("### **A9.1 - No-Token Release Evidence Refresh And Fresh Owner Split**") &&
  source.plan.includes("`refresh_before_fix`");
const currentA8Boundary =
  artifacts.a8Disposition?.status === "pass-a8.1-do-not-promote-committed" &&
  isGitAncestor(artifacts.a8Disposition?.git?.head, head) &&
  artifacts.a8Disposition?.releaseReady === false;
const currentContinuation =
  artifacts.continuation?.status === "pass-current-audit-remediation-continuation" &&
  artifacts.continuation?.head === shortHead &&
  artifacts.continuation?.activePhase === "A9";

const checks = [
  check("required-paths", missingPaths.length === 0, "all A9.0 authority and observed artifact paths exist", {
    missingPaths,
  }),
  check("frontier-advanced", frontierClosed, "A9.0 closes only by advancing the single frontier to A9.1", {
    frontier,
  }),
  check(
    "observed-snapshots-stale",
    allReleaseSnapshotsStale,
    "release score, final audit, current readiness, and release readiness remain stale snapshots",
    { snapshots },
  ),
  check(
    "numeric-claims-blocked",
    allReleaseSnapshotsStale && observedScoreRows.every((row) => row.currentClaimAllowed === false),
    "expired numeric scores and blocker counts cannot be promoted to current truth",
    {
      observedScore: artifacts.score?.score ?? null,
      observedGrade: artifacts.score?.grade ?? null,
      observedReleaseCandidateReady: artifacts.score?.releaseCandidateReady ?? null,
    },
  ),
  check(
    "score-kind-identity",
    scoreGraphValidation.ok &&
      observedScoreRows.length > 0 &&
      observedScoreRows.every((row) => evidenceKinds.includes(row.evidenceKind)) &&
      computedBlockerCounts.direct === artifacts.score?.blockerCounts?.uniqueDirect &&
      computedBlockerCounts.aggregate === artifacts.score?.blockerCounts?.aggregate &&
      computedBlockerCounts.derived === artifacts.score?.blockerCounts?.derived,
    "observed direct, aggregate, and derived identities remain distinct and count-preserving",
    { computedBlockerCounts, artifactBlockerCounts: artifacts.score?.blockerCounts ?? null, scoreGraphValidation },
  ),
  check(
    "final-audit-downstream-only",
    finalAuditIsDownstreamOnly,
    "the final-goal audit remains a derived downstream consumer of the release score",
    { finalAuditGraphValidation, dependencyGraph: artifacts.finalAudit?.dependencyGraph ?? null },
  ),
  check(
    "stale-blockers-not-implementation",
    observedGateInventory.length === observedBlockers.length &&
      observedGateInventory.every((gate) => gate.ownerClass === "stale_evidence"),
    "every blocker from the expired score is preserved as stale evidence rather than invented implementation debt",
    { observedGateCount: observedGateInventory.length },
  ),
  check(
    "stable-owner-split",
    everyGateHasOneOwner && OWNER_CLASSES.every((ownerClass) => ownerCounts[ownerClass] >= 1),
    "stable repo, policy, operator, and external gates each have exactly one owner class",
    { ownerCounts },
  ),
  check(
    "next-repo-owned-slice",
    stableGateInventory[0]?.id === "no-token-release-evidence-refresh" &&
      stableGateInventory[0]?.ownerClass === "repo_owned" &&
      stableGateInventory[0]?.command === "pnpm verify:goal:safe:no-token" &&
      source.workOrder.includes("A9.1 is the exact next slice"),
    "A9.1 refreshes no-token evidence before choosing an implementation defect",
    { nextGate: stableGateInventory[0] },
  ),
  check(
    "operator-actions-not-executed",
    source.workOrder.includes("does not run child") &&
      source.workOrder.includes("token prompts, signing, sleep/power-loss, publication") &&
      stableGateInventory
        .filter((gate) => ["operator", "external"].includes(gate.ownerClass))
        .every((gate) => gate.state === "not_run_in_inventory"),
    "A9.0 records but does not execute operator or external gates",
    {},
  ),
  check("a8-boundary-current", currentA8Boundary, "the last fresh terminal disposition remains A8.1 do_not_promote", {
    status: artifacts.a8Disposition?.status ?? null,
    evidenceHead: artifacts.a8Disposition?.git?.head ?? null,
    currentHead: head,
  }),
  check("continuation-current", currentContinuation, "the pre-edit continuation packet matched the current A9 HEAD", {
    status: artifacts.continuation?.status ?? null,
    head: artifacts.continuation?.head ?? null,
  }),
  check(
    "package-command",
    source.packageJson.includes('"verify:a9:release-evidence-inventory"') &&
      source.packageJson.includes("node scripts/verify-a9-release-evidence-inventory.mjs"),
    "package.json exposes the focused A9.0 inventory verifier",
    {},
  ),
  check("dirty-scope", unexpectedDirtyPaths.length === 0, "the A9.0 candidate contains only owned paths", {
    dirtyPaths: dirty,
    unexpectedDirtyPaths,
  }),
];

const failed = checks.filter((item) => item.status !== "passed");
const contractPass = failed.length === 0;
const committedAtHead = contractPass && dirty.length === 0;
const report = {
  schema: "aelyris.a9_0_release_evidence_inventory/v1",
  contractVersion: 1,
  ok: contractPass,
  status: !contractPass
    ? "fail-a9.0-release-evidence-inventory"
    : committedAtHead
      ? "pass-a9.0-refresh-before-fix-committed"
      : "pass-a9.0-refresh-before-fix-ready-to-commit",
  generatedAt: new Date().toISOString(),
  git: { head, branch: git(["branch", "--show-current"]), dirtyPaths: dirty },
  completedSlice: "A9.0",
  activeSlice: "A9.1",
  nextImplementationSlice: "A9.1",
  decision: "refresh_before_fix",
  phaseComplete: committedAtHead,
  readyToCommit: contractPass && !committedAtHead,
  releaseReady: false,
  currentScoreClaimAllowed: false,
  tokenSpendingPromptExecutedByThisRun: false,
  realOsSleepInvokedByThisRun: false,
  signingInvokedByThisRun: false,
  publicationInvokedByThisRun: false,
  snapshots,
  observedSnapshot: {
    score: artifacts.score
      ? {
          generatedAt: artifacts.score.generatedAt ?? null,
          sourceHead: artifacts.score.provenance?.gitHead ?? null,
          score: artifacts.score.score ?? null,
          total: artifacts.score.total ?? null,
          max: artifacts.score.max ?? null,
          grade: artifacts.score.grade ?? null,
          releaseCandidateReady: artifacts.score.releaseCandidateReady === true,
          rowCount: observedScoreRows.length,
        }
      : null,
    finalAudit: artifacts.finalAudit
      ? {
          generatedAt: artifacts.finalAudit.generatedAt ?? null,
          sourceHead: artifacts.finalAudit.provenance?.gitHead ?? null,
          status: artifacts.finalAudit.status ?? null,
          implementationFixableCount: artifacts.finalAudit.implementationFixableCount ?? null,
          policyBlockedCount: artifacts.finalAudit.policyBlockedCount ?? null,
          externalBlockedCount: artifacts.finalAudit.externalBlockedCount ?? null,
        }
      : null,
    label: "historical-only; refresh required before current implementation or release claims",
  },
  observedScoreRows,
  observedGateInventory,
  stableGateInventory,
  ownerCounts,
  checks,
  inputs: Object.fromEntries(
    Object.entries(paths).map(([id, path]) => [id, { path, mtimeMs: mtime(path), sha256: sha256(path) }]),
  ),
  artifact: ".codex-auto/quality/a9-release-evidence-inventory.json",
};

writeJsonAtomic(OUT, report);
console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exitCode = 1;
