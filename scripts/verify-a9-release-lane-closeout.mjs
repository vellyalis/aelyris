import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import process from "node:process";

const ROOT = resolve(process.cwd());
const OUT = join(ROOT, ".codex-auto", "quality", "a9-release-lane-closeout.json");
const OWNER_CLASSES = ["repo_owned", "stale_evidence", "policy", "operator", "external", "derived"];
const EXPECTED_FAILED_DESCRIPTOR_IDS = [
  "native-boundary",
  "authenticated-preflight-matrix",
  "authenticated-consent-packet",
  "release-signing-operator-handoff",
  "real-os-sleep-operator-handoff",
  "external-gate-readiness",
  "final-goal-audit",
  "goal-completion-matrix",
];
const EXPECTED_MISSING_REQUIREMENT_IDS = [
  "rust-native-terminal-core",
  "rust-mux-daemon-boundary",
  "right-rail-command-center",
  "fallback-and-stale-visibility",
  "provenance-recovery-context-packs",
  "ai-cli-launch-planner",
  "theme-customization",
  "release-operations-proof",
];
const EXPECTED_AGGREGATE_OUTSIDE_BLOCKERS = [
  "release readiness aggregate artifact is missing or stale",
  "release readiness claim blocked: tmux=missing",
  "release readiness claim blocked: sharedWorkspace=missing",
  "release readiness claim blocked: nativeTerminal=missing",
  "release readiness claim blocked: release=missing",
];
const EXPECTED_NON_IMPLEMENTATION_AUDIT_REJECTION_PATHS = [
  ".codex-auto/quality/release-readiness-aggregate.json",
  ".codex-auto/production-smoke/right-rail-goal-track-tauri.json.environment-blocked.json",
  ".codex-auto/chaos-recovery/p2-07-live-tauri-pty-ai-cli-chaos.json",
  ".codex-auto/production-smoke/authenticated-ai-cli-provider-required-smoke.json",
];
const EXPECTED_SCORE_REJECTION_REGISTRY_DIGEST = "70ea020209d7d75a0abc1c72f37d6d195b6b5d0a324e8517fbd434a182d9dd61";
const SCORE_AREA_CAUSAL_REJECTIONS = {
  "release-doctor": [".codex-auto/release-doctor/p2-08-release-doctor.json"],
  "supply-chain-audit": [".codex-auto/release-doctor/supply-chain-audit.json"],
  "mux-performance": [
    ".codex-auto/performance/mux-performance-smoke.json",
    ".codex-auto/performance/mux-live-restore-smoke.json",
  ],
  scrollback: [".codex-auto/performance/scrollback-gates.json"],
  "native-ime": [
    ".codex-auto/production-smoke/verify-ime.json",
    ".codex-auto/production-smoke/native-terminal-input-host.json",
  ],
  "terminal-core-edge": [
    ".codex-auto/production-smoke/native-terminal-input-host.json",
    ".codex-auto/production-smoke/chunked-osc-live.json",
    ".codex-auto/production-smoke/chunked-osc-live.environment-blocked.json",
    ".codex-auto/production-smoke/native-hwnd-paste-live.json",
  ],
  "terminal-render-fidelity": [".codex-auto/quality/terminal-font-render-contract.json"],
  "native-boundary-contract": [".codex-auto/quality/native-boundary-contract.json"],
  "real-os-soak": [
    ".codex-auto/production-smoke/real-os-suspend-resume.json",
    ".codex-auto/production-smoke/real-os-suspend-resume.diagnostic.json",
    ".codex-auto/production-smoke/real-os-suspend-native-preflight.json",
    ".codex-auto/production-smoke/real-os-suspend-native-postcheck-preflight.json",
    ".codex-auto/production-smoke/postcheck-write-smoke/real-os-suspend-native-postcheck-write-smoke.json",
  ],
  "right-rail-smoke": [".codex-auto/production-smoke/right-rail-suite.json"],
  "right-rail-edge": [".codex-auto/production-smoke/right-rail-iab-proof.json"],
  "right-rail-scale-contract": [".codex-auto/performance/right-rail-scale-contract.json"],
  "command-evidence": [
    ".codex-auto/production-smoke/right-rail-command-evidence.json",
    ".codex-auto/production-smoke/right-rail-command-evidence.json.environment-blocked.json",
  ],
  "live-command-evidence": [
    ".codex-auto/production-smoke/live-command-evidence.json",
    ".codex-auto/production-smoke/live-command-evidence.json.environment-blocked.json",
  ],
  "multipane-command-evidence": [
    ".codex-auto/production-smoke/multipane-command-evidence.json",
    ".codex-auto/production-smoke/multipane-command-evidence.json.environment-blocked.json",
  ],
  "recovered-command-evidence": [
    ".codex-auto/production-smoke/recovered-command-evidence.json",
    ".codex-auto/production-smoke/recovered-command-evidence.json.environment-blocked.json",
  ],
  "process-reconnect-command-evidence": [
    ".codex-auto/production-smoke/process-reconnect-command-evidence.json",
    ".codex-auto/production-smoke/process-reconnect-command-evidence.json.environment-blocked.json",
    ".codex-auto/quality/mux-live-process-preservation.json",
  ],
  "interactive-ai-cli-sidecar-boundary": [".codex-auto/production-smoke/interactive-ai-cli-boundary.json"],
  "real-ai-cli-binary-probe": [".codex-auto/production-smoke/real-ai-cli-binary-probe.json"],
  "live-ai-cli-post-launch-chaos": [
    ".codex-auto/chaos-recovery/p2-07-live-tauri-pty-ai-cli-chaos.json",
    ".codex-auto/chaos-recovery/native-ai-cli-post-launch-chaos.json",
  ],
  "tauri-runtime-hygiene": [".codex-auto/quality/tauri-runtime-hygiene.json"],
  "authenticated-ai-cli-preflight-matrix": [".codex-auto/production-smoke/authenticated-ai-cli-preflight-matrix.json"],
  "ai-cli-launch-planner": [
    ".codex-auto/production-smoke/ai-cli-launch-planner.json",
    ".codex-auto/production-smoke/real-ai-cli-binary-probe.json",
    ".codex-auto/production-smoke/native-terminal-input-host.json",
    ".codex-auto/production-smoke/verify-ime.json",
    ".codex-auto/production-smoke/process-reconnect-command-evidence.json",
    ".codex-auto/quality/mux-live-process-preservation.json",
    ".codex-auto/production-smoke/interactive-ai-cli-boundary.json",
  ],
  "command-center-scenario": [".codex-auto/production-smoke/command-center-scenario.json"],
  "command-recovery-contract": [".codex-auto/production-smoke/command-recovery-contract.json"],
  "right-rail-goal-track": [
    ".codex-auto/production-smoke/right-rail-goal-track-tauri.json",
    ".codex-auto/production-smoke/right-rail-goal-track-tauri.json.environment-blocked.json",
  ],
  "ui-trust-contract": [".codex-auto/quality/ui-trust-contract.json"],
  "theme-customization-guard": [".codex-auto/quality/glass-legibility-contract.json"],
  "frontend-bundle-budget": [".codex-auto/quality/production-bundle-budget.json"],
};
const REQUIREMENT_ROOT_AREAS = {
  "rust-native-terminal-core": [
    "native-ime",
    "terminal-core-edge",
    "terminal-render-fidelity",
    "native-boundary-contract",
  ],
  "rust-mux-daemon-boundary": ["mux-performance", "native-boundary-contract", "process-reconnect-command-evidence"],
  "right-rail-command-center": [
    "right-rail-smoke",
    "right-rail-edge",
    "right-rail-scale-contract",
    "command-evidence",
    "right-rail-goal-track",
  ],
  "fallback-and-stale-visibility": ["native-boundary-contract", "command-recovery-contract"],
  "provenance-recovery-context-packs": ["command-center-scenario", "command-recovery-contract"],
  "ai-cli-launch-planner": [
    "ai-cli-launch-planner",
    "real-ai-cli-binary-probe",
    "live-ai-cli-post-launch-chaos",
    "authenticated-ai-cli-preflight-matrix",
  ],
  "theme-customization": ["theme-customization-guard"],
  "release-operations-proof": [
    "release-doctor",
    "supply-chain-audit",
    "real-os-soak",
    "tauri-runtime-hygiene",
    "frontend-bundle-budget",
  ],
};
const REQUIREMENT_OUTSIDE_OWNER_CLASSES = {
  "rust-native-terminal-core": [],
  "rust-mux-daemon-boundary": [],
  "right-rail-command-center": [],
  "fallback-and-stale-visibility": [],
  "provenance-recovery-context-packs": [],
  "ai-cli-launch-planner": ["policy"],
  "theme-customization": [],
  "release-operations-proof": ["policy", "operator", "aggregate"],
};
const EXPECTED_FALSE_CHECKS = {
  preflightMatrix: [
    "allProvidersReady",
    "tokenPromptExecutedWithConsent",
    "artifactFreshness",
    "postLaunchChaosPass",
    "nativePostLaunchChaosPass",
    "postLaunchChaosDeferred",
  ],
  consentPacket: [
    "noTokenPromptSent",
    "tokenPromptExecutedWithConsent",
    "promptStateValid",
    "promptConsentPacketReady",
    "providerMatrixReady",
    "allProviderOptInCommandsReady",
  ],
  signingHandoff: ["releaseScoreExternalGateShape"],
  sleepHandoff: ["releaseScoreExternalGateShape", "finalAuditExternalGateShape", "completionMatrixExternalGateShape"],
  externalReadiness: [
    "releaseScoreCurrentExternalGateShape",
    "finalAuditExternalGateShape",
    "completionMatrixExternalGateShape",
    "tokenGateReady",
    "tokenPromptExecutedWithConsent",
    "preflightMatrixReady",
    "consentPacketReady",
    "releaseSigningOperatorHandoffReady",
    "realSleepGateReady",
    "realSleepGateHostBlocked",
    "noTokenPromptSent",
    "sourceArtifactsFresh",
    "completeExternalGatesProved",
  ],
  completionMatrix: [
    "scoreCurrentShape",
    "scoreConsentGated",
    "auditEvidenceComplete",
    "auditRequirementsComplete",
    "matrixRequirementsComplete",
    "residualIsOnlyConsentOrExternalGate",
    "consentGateSafe",
    "finalSafeRightRailCurrentProof",
  ],
};

const paths = {
  workOrder: "audit-remediation-instructions.md",
  plan: "docs/specs/COMPREHENSIVE_AUDIT_REMEDIATION_PLAN_2026-07-10.md",
  specIndex: "docs/specs/README.md",
  packageJson: "package.json",
  workOsVerifier: "scripts/verify-verifiable-agent-work-os-spec.mjs",
  noToken: ".codex-auto/quality/final-goal-safe-no-token.json",
  releaseScore: ".codex-auto/quality/release-quality-score.json",
  nativeBoundary: ".codex-auto/quality/native-boundary-contract.json",
  preflightMatrix: ".codex-auto/production-smoke/authenticated-ai-cli-preflight-matrix.json",
  consentPacket: ".codex-auto/production-smoke/authenticated-ai-cli-consent-packet.json",
  signingHandoff: ".codex-auto/quality/release-signing-operator-handoff.json",
  sleepHandoff: ".codex-auto/quality/real-os-sleep-operator-handoff.json",
  externalReadiness: ".codex-auto/quality/goal-external-gate-readiness.json",
  finalAudit: ".codex-auto/quality/final-goal-audit.json",
  completionMatrix: ".codex-auto/quality/goal-completion-matrix.json",
};

const allowedDirtyPaths = new Set([
  "audit-remediation-instructions.md",
  "docs/specs/COMPREHENSIVE_AUDIT_REMEDIATION_PLAN_2026-07-10.md",
  "docs/specs/README.md",
  "package.json",
  "scripts/verify-a9-release-lane-closeout.mjs",
  "scripts/score-release-quality.mjs",
  "scripts/verify-final-goal-safe.mjs",
  "scripts/verify-verifiable-agent-work-os-spec.mjs",
]);
const A9_6_OWNED_PATHS = [...allowedDirtyPaths];
const ORIGINAL_EVIDENCE_HEAD = "42d6eae1a65e45f442e92d3239834102cbff83b9";
const CLOSEOUT_COMMIT = "a1db7c3d940e429dfb23baf9307afbfd2634fe90";

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

function changedPathsBetween(from, to) {
  if (!from || !to) return [];
  try {
    return execFileSync("git", ["diff", "--name-only", `${from}..${to}`], {
      cwd: ROOT,
      encoding: "utf8",
    })
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
      .map((path) => path.replaceAll("\\", "/"));
  } catch {
    return [];
  }
}

function commitCountBetween(from, to) {
  if (!from || !to) return null;
  try {
    const value = execFileSync("git", ["rev-list", "--count", `${from}..${to}`], {
      cwd: ROOT,
      encoding: "utf8",
    }).trim();
    const count = Number.parseInt(value, 10);
    return Number.isInteger(count) ? count : null;
  } catch {
    return null;
  }
}

function commitSubjectsBetween(from, to) {
  if (!from || !to) return [];
  try {
    return execFileSync("git", ["log", "--reverse", "--format=%s", `${from}..${to}`], {
      cwd: ROOT,
      encoding: "utf8",
    })
      .trim()
      .split(/\r?\n/)
      .filter(Boolean);
  } catch {
    return [];
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

function exactStringSet(actual, expected) {
  return (
    Array.isArray(actual) &&
    actual.length === expected.length &&
    [...actual].sort().every((value, index) => value === [...expected].sort()[index])
  );
}

function falseCheckPaths(value, prefix = "") {
  if (value === false) return [prefix];
  if (value == null || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, nested]) => falseCheckPaths(nested, prefix ? `${prefix}.${key}` : key));
}

function canonicalPair(value) {
  return JSON.stringify([value?.area ?? null, value?.blocker ?? null]);
}

function digestCanonicalPairs(values) {
  return createHash("sha256")
    .update([...values].sort().join("\n"))
    .digest("hex");
}

function canonicalRejectionRegistry(entries) {
  return entries
    .map((entry) => [entry?.path ?? null, Array.isArray(entry?.errors) ? [...entry.errors].sort() : null])
    .sort(([left], [right]) => String(left).localeCompare(String(right)));
}

function digestRejectionRegistry(entries) {
  return createHash("sha256")
    .update(JSON.stringify(canonicalRejectionRegistry(entries)))
    .digest("hex");
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

const source = {
  workOrder: readText(paths.workOrder),
  plan: readText(paths.plan),
  specIndex: readText(paths.specIndex),
  packageJson: readText(paths.packageJson),
  workOsVerifier: readText(paths.workOsVerifier),
};
const artifacts = Object.fromEntries(
  Object.entries(paths)
    .filter(([id]) => !Object.hasOwn(source, id))
    .map(([id, path]) => [id, readJson(path)]),
);

const missingPaths = Object.values(paths).filter((path) => !existsSync(fullPath(path)));
const unparsableArtifactIds = Object.keys(artifacts).filter((id) => artifacts[id] == null);
const head = git(["rev-parse", "HEAD"]);
const dirty = dirtyPaths();
const unexpectedDirtyPaths = dirty.filter((path) => !allowedDirtyPaths.has(path));
const evidenceHead = artifacts.releaseScore?.provenance?.gitHead ?? null;
const commitDeltaPaths = changedPathsBetween(evidenceHead, head);
const unexpectedCommitDeltaPaths = commitDeltaPaths.filter((path) => !allowedDirtyPaths.has(path));
const commitCount = commitCountBetween(evidenceHead, head);
const commitSubjects = commitSubjectsBetween(evidenceHead, head);
const headParent = git(["rev-parse", `${head}^`]);
const headSubject = git(["show", "-s", "--format=%s", head]);
const headCommitPaths = changedPathsBetween(headParent, head);
const headParentParent = git(["rev-parse", `${headParent}^`]);
const headParentSubject = git(["show", "-s", "--format=%s", headParent]);
const headParentCommitPaths = changedPathsBetween(headParentParent, headParent);
const closeoutCommitValid =
  head === CLOSEOUT_COMMIT &&
  headParent === ORIGINAL_EVIDENCE_HEAD &&
  headSubject === "feat(a9): close repo-owned release lane" &&
  exactStringSet(headCommitPaths, A9_6_OWNED_PATHS);
const correctiveCommitSequenceValid =
  headParent === CLOSEOUT_COMMIT &&
  headSubject === "fix(a9): stabilize postcommit evidence refresh" &&
  exactStringSet(headCommitPaths, ["scripts/verify-a9-release-lane-closeout.mjs"]) &&
  headParentSubject === "feat(a9): close repo-owned release lane" &&
  exactStringSet(headParentCommitPaths, A9_6_OWNED_PATHS);
const freshPrecommitState =
  head === ORIGINAL_EVIDENCE_HEAD &&
  evidenceHead === head &&
  commitCount === 0 &&
  commitDeltaPaths.length === 0 &&
  exactStringSet(dirty, A9_6_OWNED_PATHS);
const freshPostcommitState =
  head === CLOSEOUT_COMMIT &&
  evidenceHead === ORIGINAL_EVIDENCE_HEAD &&
  commitCount === 1 &&
  commitSubjects.length === 1 &&
  commitSubjects[0] === "feat(a9): close repo-owned release lane" &&
  exactStringSet(commitDeltaPaths, A9_6_OWNED_PATHS) &&
  closeoutCommitValid &&
  dirty.length === 0;
const correctivePostcommitState =
  evidenceHead === CLOSEOUT_COMMIT &&
  commitCount === 1 &&
  commitSubjects.length === 1 &&
  commitSubjects[0] === "fix(a9): stabilize postcommit evidence refresh" &&
  exactStringSet(commitDeltaPaths, ["scripts/verify-a9-release-lane-closeout.mjs"]) &&
  correctiveCommitSequenceValid &&
  dirty.length === 0;
const refreshedCleanHeadState =
  evidenceHead === head && commitCount === 0 && commitDeltaPaths.length === 0 && dirty.length === 0;
const evidenceCommitState = freshPrecommitState
  ? "a9_6_precommit"
  : freshPostcommitState
    ? "a9_6_postcommit"
    : correctivePostcommitState
      ? "a9_6_corrective_postcommit"
      : refreshedCleanHeadState
        ? "a9_6_refreshed_clean_head"
        : "invalid";
const evidenceHeadAllowed =
  isGitAncestor(evidenceHead, head) && unexpectedCommitDeltaPaths.length === 0 && evidenceCommitState !== "invalid";
const frontier = {
  phase: backtickField(source.workOrder, "CURRENT PHASE"),
  activeSlice: backtickField(source.workOrder, "ACTIVE SLICE"),
  lastCompletedSlice: backtickField(source.workOrder, "LAST COMPLETED SLICE"),
  nextImplementationSlice: backtickField(source.workOrder, "NEXT IMPLEMENTATION SLICE"),
};

const noTokenSteps = Array.isArray(artifacts.noToken?.steps) ? artifacts.noToken.steps : [];
const failedSteps = noTokenSteps.filter((step) => step?.ok !== true);
const failedStepIds = failedSteps.map((step) => step.id);
const noTokenGraph = artifacts.noToken?.noTokenStepGraph;
const descriptorIds = Array.isArray(noTokenGraph?.descriptorIds) ? noTokenGraph.descriptorIds : [];
const runtimeIds = Array.isArray(noTokenGraph?.runtimeExecutedStepIds) ? noTokenGraph.runtimeExecutedStepIds : [];

const nativeBoundaryFailedChecks = Array.isArray(artifacts.nativeBoundary?.checks)
  ? artifacts.nativeBoundary.checks.filter((item) => item?.status !== "passed")
  : [];
const nativeBoundaryEvidenceValid =
  artifacts.nativeBoundary?.ok === false &&
  exactStringSet(
    nativeBoundaryFailedChecks.map((item) => item.id),
    ["daemon-contract-policy", "sidecar-command-session-artifact"],
  ) &&
  nativeBoundaryFailedChecks.some(
    (item) =>
      item.id === "daemon-contract-policy" &&
      item.evidence?.restartRestoreFresh === false &&
      item.evidence?.processPreservationFresh === false,
  ) &&
  nativeBoundaryFailedChecks.some(
    (item) => item.id === "sidecar-command-session-artifact" && item.evidence?.fresh === false,
  );

const preflightBlockingArtifacts = Array.isArray(artifacts.preflightMatrix?.blockingArtifacts)
  ? artifacts.preflightMatrix.blockingArtifacts
  : [];
const expectedPreflightRefreshCommands = [
  "pnpm verify:terminal:ai-cli-boundary",
  "pnpm verify:terminal:ai-cli-post-launch-chaos",
  "pnpm verify:terminal:native-ai-cli-post-launch-chaos",
];
const preflightMatrixEvidenceValid =
  artifacts.preflightMatrix?.ok === false &&
  exactStringSet(falseCheckPaths(artifacts.preflightMatrix?.checks), EXPECTED_FALSE_CHECKS.preflightMatrix) &&
  artifacts.preflightMatrix?.checks?.tokenSpendingExecutionBlocked === true &&
  artifacts.preflightMatrix?.checks?.noPromptSent === true &&
  artifacts.preflightMatrix?.checks?.artifactRefreshCommandsReady === true &&
  preflightBlockingArtifacts.every((item) => item?.blockingReason === "stale") &&
  exactStringSet(
    preflightBlockingArtifacts.map((item) => item.refreshCommand),
    expectedPreflightRefreshCommands,
  );

const consentPacketEvidenceValid =
  artifacts.consentPacket?.ok === false &&
  exactStringSet(falseCheckPaths(artifacts.consentPacket?.checks), EXPECTED_FALSE_CHECKS.consentPacket) &&
  artifacts.consentPacket?.checks?.providerGuardBlocksPrompt === true &&
  artifacts.consentPacket?.packet?.promptState === "blocked_without_consent" &&
  artifacts.consentPacket?.packet?.tokenSpendingPromptExecuted === false &&
  artifacts.consentPacket?.packet?.command === "pnpm verify:goal:operator:token-smoke" &&
  artifacts.consentPacket?.packet?.requiredEnv === "AELYRIS_AUTH_PROMPT_PROVIDER=codex|claude|gemini";

const signingHandoffEvidenceValid =
  artifacts.signingHandoff?.ok === false &&
  exactStringSet(falseCheckPaths(artifacts.signingHandoff?.checks), EXPECTED_FALSE_CHECKS.signingHandoff) &&
  exactStringSet(artifacts.signingHandoff?.failedChecks, EXPECTED_FALSE_CHECKS.signingHandoff) &&
  artifacts.signingHandoff?.releaseSigningComplete === false &&
  artifacts.signingHandoff?.signingMaterialProvidedToThisRun === false &&
  artifacts.signingHandoff?.noSecretMaterialPersisted === true &&
  artifacts.signingHandoff?.runbook?.updaterSigning?.command === "pnpm tauri:build:dist" &&
  artifacts.signingHandoff?.runbook?.windowsCodeSigning?.command ===
    "signtool sign /fd SHA256 /tr <trusted-rfc3161-url> /td SHA256 <app-exe> <nsis-exe> <msi>";

const sleepHandoffEvidenceValid =
  artifacts.sleepHandoff?.ok === false &&
  exactStringSet(falseCheckPaths(artifacts.sleepHandoff?.checks), EXPECTED_FALSE_CHECKS.sleepHandoff) &&
  exactStringSet(artifacts.sleepHandoff?.failedChecks, EXPECTED_FALSE_CHECKS.sleepHandoff) &&
  artifacts.sleepHandoff?.realOsSleepInvoked === false &&
  artifacts.sleepHandoff?.realOsSleepAlreadyProved === false &&
  artifacts.sleepHandoff?.runbook?.manualSleepCycle?.command === "pnpm verify:production:suspend:native-user-cycle" &&
  artifacts.sleepHandoff?.runbook?.operatorFinish?.command === "pnpm verify:goal:operator-finish" &&
  artifacts.sleepHandoff?.runbook?.operatorFinish?.env?.AELYRIS_GOAL_OPERATOR_RUN_SLEEP ===
    "I_WILL_MANUALLY_SLEEP_WINDOWS_WHILE_VERIFIER_WAITS";

const externalReadinessEvidenceValid =
  artifacts.externalReadiness?.ok === false &&
  exactStringSet(falseCheckPaths(artifacts.externalReadiness?.checks), EXPECTED_FALSE_CHECKS.externalReadiness) &&
  artifacts.externalReadiness?.tokenSpendingPromptExecuted === false &&
  artifacts.externalReadiness?.realOsSleepInvoked === false &&
  artifacts.externalReadiness?.realOsSleepAttempted === false &&
  artifacts.externalReadiness?.runbook?.beforeExternalGate?.includes?.("pnpm verify:goal:external-gates") &&
  artifacts.externalReadiness?.runbook?.finalizeClosure?.command === "pnpm verify:goal:finalize" &&
  artifacts.externalReadiness?.runbook?.closeoutSnapshot?.command === "pnpm verify:goal:closeout";

const finalAuditDependencyGraphValid =
  artifacts.finalAudit?.dependencyGraph?.schema === "aelyris.evidence-dependency-graph/v1" &&
  Array.isArray(artifacts.finalAudit?.dependencyGraph?.nodes) &&
  artifacts.finalAudit.dependencyGraph.nodes.length === 2 &&
  artifacts.finalAudit.dependencyGraph.nodes.some(
    (node) => node?.id === "release-score" && node?.kind === "aggregate" && exactStringSet(node?.dependsOn, []),
  ) &&
  artifacts.finalAudit.dependencyGraph.nodes.some(
    (node) =>
      node?.id === "final-goal-audit" && node?.kind === "derived" && exactStringSet(node?.dependsOn, ["release-score"]),
  );
const completionMatrixFailureSetValid = exactStringSet(
  falseCheckPaths(artifacts.completionMatrix?.checks),
  EXPECTED_FALSE_CHECKS.completionMatrix,
);
const downstreamViewsEvidenceValid =
  artifacts.finalAudit?.ok === false &&
  artifacts.finalAudit?.status === "blocked" &&
  finalAuditDependencyGraphValid &&
  artifacts.completionMatrix?.ok === false &&
  artifacts.completionMatrix?.status === "blocked" &&
  completionMatrixFailureSetValid;
const observedInternalFailureModes = {
  nativeBoundary: nativeBoundaryFailedChecks.map((item) => item.id),
  preflightMatrix: falseCheckPaths(artifacts.preflightMatrix?.checks),
  consentPacket: falseCheckPaths(artifacts.consentPacket?.checks),
  signingHandoff: falseCheckPaths(artifacts.signingHandoff?.checks),
  sleepHandoff: falseCheckPaths(artifacts.sleepHandoff?.checks),
  externalReadiness: falseCheckPaths(artifacts.externalReadiness?.checks),
  completionMatrix: falseCheckPaths(artifacts.completionMatrix?.checks),
};
const knownDescriptorFailureModesExhaustive =
  exactStringSet(observedInternalFailureModes.nativeBoundary, [
    "daemon-contract-policy",
    "sidecar-command-session-artifact",
  ]) &&
  Object.entries(EXPECTED_FALSE_CHECKS).every(([artifactId, expected]) =>
    exactStringSet(observedInternalFailureModes[artifactId], expected),
  ) &&
  finalAuditDependencyGraphValid;

const classificationRegistry = new Map([
  [
    "native-boundary",
    {
      evidenceKind: "direct",
      ownerClass: "stale_evidence",
      actionOwner: "operator",
      causalEvidenceValid: nativeBoundaryEvidenceValid,
      refreshCommands: [
        "pnpm verify:mux-live",
        "pnpm verify:mux-live-process-preservation",
        "pnpm verify:terminal:ai-cli-boundary",
      ],
      reason: "only stale mux restart/process-preservation and interactive sidecar boundary artifacts fail",
    },
  ],
  [
    "authenticated-preflight-matrix",
    {
      evidenceKind: "direct",
      ownerClass: "stale_evidence",
      actionOwner: "operator",
      causalEvidenceValid: preflightMatrixEvidenceValid,
      refreshCommands: expectedPreflightRefreshCommands,
      reason: "the current matrix blocks only on three explicitly stale live boundary/chaos artifacts",
    },
  ],
  [
    "authenticated-consent-packet",
    {
      evidenceKind: "direct",
      ownerClass: "policy",
      actionOwner: "operator",
      causalEvidenceValid: consentPacketEvidenceValid,
      refreshCommands: ["pnpm verify:terminal:authenticated-ai-cli-consent-packet"],
      operatorCommand: {
        command: "pnpm verify:goal:operator:token-smoke",
        requiredEnv: "AELYRIS_AUTH_PROMPT_PROVIDER=codex|claude|gemini",
      },
      reason: "the provider guard keeps token execution blocked until the operator selects one provider",
    },
  ],
  [
    "release-signing-operator-handoff",
    {
      evidenceKind: "direct",
      ownerClass: "operator",
      actionOwner: "operator",
      causalEvidenceValid: signingHandoffEvidenceValid,
      refreshCommands: ["pnpm verify:goal:release-signing-handoff"],
      operatorCommand: {
        command: "pnpm tauri:build:dist",
        requiredEnv:
          "TAURI_SIGNING_PRIVATE_KEY=<operator-provided>; TAURI_SIGNING_PRIVATE_KEY_PASSWORD=<operator-provided-if-encrypted>",
      },
      reason: "signing identity, timestamp, updater lifecycle, and rollback evidence remain operator-controlled",
    },
  ],
  [
    "real-os-sleep-operator-handoff",
    {
      evidenceKind: "direct",
      ownerClass: "operator",
      actionOwner: "operator",
      causalEvidenceValid: sleepHandoffEvidenceValid,
      refreshCommands: ["pnpm verify:goal:sleep-handoff"],
      operatorCommand: {
        command: "pnpm verify:goal:operator-finish",
        requiredEnv: "AELYRIS_GOAL_OPERATOR_RUN_SLEEP=I_WILL_MANUALLY_SLEEP_WINDOWS_WHILE_VERIFIER_WAITS",
      },
      manualCommand: "pnpm verify:production:suspend:native-user-cycle",
      reason: "real Windows sleep/wake evidence requires a physical operator cycle",
    },
  ],
  [
    "external-gate-readiness",
    {
      evidenceKind: "direct",
      ownerClass: "external",
      actionOwner: "external",
      causalEvidenceValid: externalReadinessEvidenceValid,
      refreshCommands: ["pnpm verify:goal:external-gates"],
      reason: "upstream reachability and production metadata remain outside repo implementation ownership",
    },
  ],
  [
    "final-goal-audit",
    {
      evidenceKind: "derived",
      ownerClass: "derived",
      actionOwner: "repository_verifier",
      causalEvidenceValid: downstreamViewsEvidenceValid,
      refreshCommands: ["pnpm verify:final-goal-audit"],
      reason: "the final audit is a downstream view and must refresh only after direct owners change",
    },
  ],
  [
    "goal-completion-matrix",
    {
      evidenceKind: "aggregate",
      ownerClass: "derived",
      actionOwner: "repository_verifier",
      causalEvidenceValid: downstreamViewsEvidenceValid,
      refreshCommands: ["pnpm verify:goal:completion-matrix"],
      reason: "the completion matrix aggregates direct owner evidence and is not an independent defect",
    },
  ],
]);

const failedDescriptorClassifications = failedSteps.map((step) => {
  const classification = classificationRegistry.get(step.id);
  if (!classification) {
    return {
      id: step.id,
      label: step.label ?? null,
      script: step.script ?? null,
      evidenceKind: "direct",
      ownerClass: "repo_owned",
      actionOwner: "repository",
      causalEvidenceValid: false,
      repoOwnedExecutableDefect: true,
      refreshCommands: [],
      reason: "unclassified failed descriptor fails closed as a repo-owned executable defect",
    };
  }
  return {
    id: step.id,
    label: step.label ?? null,
    script: step.script ?? null,
    ...classification,
    repoOwnedExecutableDefect: false,
  };
});

const implementationRisks = Array.isArray(artifacts.finalAudit?.implementationFixableRisks)
  ? artifacts.finalAudit.implementationFixableRisks
  : [];
const releaseBlockerRisks = implementationRisks.filter((risk) => risk?.kind === "release-blocker");
const missingEvidencePathRisks = implementationRisks.filter(
  (risk) => risk?.kind === "missing-or-invalid-evidence-path",
);
const missingRequirementRisks = implementationRisks.filter((risk) => risk?.kind === "missing-requirement");
const implementationRiskPairs = implementationRisks.map(canonicalPair);
const releaseRiskPairs = releaseBlockerRisks.map(canonicalPair);
const releaseRiskPairSet = new Set(releaseRiskPairs);
const scoreBlockers = Array.isArray(artifacts.releaseScore?.allBlockers) ? artifacts.releaseScore.allBlockers : [];
const scoreBlockerPairs = scoreBlockers.map(canonicalPair);
const scoreBlockersByPair = new Map(scoreBlockers.map((blocker) => [canonicalPair(blocker), blocker]));
const scoreRowsById = new Map(
  (Array.isArray(artifacts.releaseScore?.scores) ? artifacts.releaseScore.scores : []).map((row) => [row.id, row]),
);
const finalAuditReleaseScoreInput = Array.isArray(artifacts.finalAudit?.provenance?.inputs)
  ? artifacts.finalAudit.provenance.inputs.find((input) => input?.path === paths.releaseScore)
  : null;
const finalAuditNoTokenStep = noTokenSteps.find((step) => step?.id === "final-goal-audit");
const currentReleaseScoreSha = sha256(paths.releaseScore);
const releaseScoreBoundToFinalAudit =
  /^[0-9a-f]{64}$/.test(finalAuditReleaseScoreInput?.sha256 ?? "") &&
  /^[0-9a-f]{64}$/.test(currentReleaseScoreSha ?? "") &&
  finalAuditReleaseScoreInput.sha256 !== currentReleaseScoreSha &&
  finalAuditNoTokenStep?.stdoutTail?.includes(paths.releaseScore) === true &&
  finalAuditNoTokenStep?.stdoutTail?.includes(finalAuditReleaseScoreInput.sha256) === true &&
  artifacts.finalAudit?.provenance?.gitHead === evidenceHead &&
  artifacts.releaseScore?.provenance?.gitHead === evidenceHead &&
  artifacts.finalAudit?.score?.preAudit?.total === artifacts.releaseScore?.total &&
  artifacts.finalAudit?.score?.preAudit?.max === artifacts.releaseScore?.max &&
  artifacts.finalAudit?.score?.preAudit?.percent === artifacts.releaseScore?.score &&
  artifacts.finalAudit?.score?.preAudit?.grade === artifacts.releaseScore?.grade &&
  artifacts.finalAudit?.score?.preAudit?.releaseCandidateReady === artifacts.releaseScore?.releaseCandidateReady;
const scoreProvenanceRejections = Array.isArray(artifacts.releaseScore?.provenanceRejections)
  ? artifacts.releaseScore.provenanceRejections
  : [];
const scoreRejectionsByPath = new Map(scoreProvenanceRejections.map((entry) => [entry?.path, entry]));
const scoreRejectionRegistryDigest = digestRejectionRegistry(scoreProvenanceRejections);
const staleOrProvenanceError = (error) =>
  error === "git-head-mismatch" ||
  error === "expired" ||
  error === "missing-provenance-sidecar" ||
  (typeof error === "string" && error.startsWith("input-hash-mismatch:"));
const scoreStaleProvenanceBasisValid =
  scoreProvenanceRejections.length === 57 &&
  new Set(scoreProvenanceRejections.map((entry) => entry?.path)).size === 57 &&
  scoreRejectionRegistryDigest === EXPECTED_SCORE_REJECTION_REGISTRY_DIGEST &&
  scoreProvenanceRejections.every(
    (entry) =>
      typeof entry?.path === "string" &&
      Array.isArray(entry?.errors) &&
      entry.errors.some((error) => staleOrProvenanceError(error)),
  );
const releaseBlockerRiskClassifications = releaseBlockerRisks.map((risk, index) => {
  const pair = canonicalPair(risk);
  const scoreBlocker = scoreBlockersByPair.get(pair);
  const scoreRow = scoreRowsById.get(risk.area);
  const configuredPaths = SCORE_AREA_CAUSAL_REJECTIONS[risk.area];
  const rejectedSources = Array.isArray(configuredPaths)
    ? configuredPaths.map((path) => scoreRejectionsByPath.get(path)).filter(Boolean)
    : [];
  const scorePairValid =
    risk.canAutoResolve === true &&
    scoreBlocker?.kind === "direct" &&
    scoreRow?.kind === "direct" &&
    Array.isArray(scoreRow?.blockers) &&
    scoreRow.blockers.filter((blocker) => blocker === risk.blocker).length === 1;
  const causalSourcesValid =
    Array.isArray(configuredPaths) &&
    configuredPaths.length > 0 &&
    rejectedSources.length === configuredPaths.length &&
    rejectedSources.every((entry) => entry.errors.some((error) => staleOrProvenanceError(error)));
  return {
    id: `implementation-risk-${String(index + 1).padStart(3, "0")}`,
    kind: risk.kind,
    area: risk.area,
    blocker: risk.blocker,
    pair,
    ownerClass: scorePairValid && causalSourcesValid ? "stale_evidence" : "repo_owned",
    causalSources: [
      { type: "release-score-row", area: risk.area, scoreKind: scoreBlocker?.kind ?? null, pair },
      ...rejectedSources.map((entry) => ({
        type: "release-score-provenance-rejection",
        path: entry.path,
        errors: entry.errors,
      })),
    ],
    causalEvidenceValid: scorePairValid && causalSourcesValid,
  };
});
const releaseBlockerRiskClassificationValid =
  releaseBlockerRisks.length === 158 &&
  new Set(releaseRiskPairs).size === 158 &&
  scoreBlockers.length === 176 &&
  new Set(scoreBlockerPairs).size === 176 &&
  exactStringSet(Object.keys(SCORE_AREA_CAUSAL_REJECTIONS), [
    ...new Set(releaseBlockerRisks.map((risk) => risk.area)),
  ]) &&
  releaseBlockerRiskClassifications.every(
    (classification) => classification.ownerClass !== "repo_owned" && classification.causalEvidenceValid === true,
  ) &&
  releaseScoreBoundToFinalAudit &&
  scoreStaleProvenanceBasisValid;

const evidencePathPrefix = "Final goal evidence path is missing, empty, or invalid JSON: ";
const auditProvenanceRejections = Array.isArray(artifacts.finalAudit?.provenanceRejections)
  ? artifacts.finalAudit.provenanceRejections
  : [];
const auditRejectedPaths = new Set(auditProvenanceRejections.map((entry) => entry?.path));
const missingEvidencePathMappings = missingEvidencePathRisks.map((risk) => ({
  pair: canonicalPair(risk),
  path:
    typeof risk?.blocker === "string" && risk.blocker.startsWith(evidencePathPrefix)
      ? risk.blocker.slice(evidencePathPrefix.length)
      : null,
}));
const missingEvidenceRiskPaths = new Set(missingEvidencePathMappings.map((item) => item.path).filter(Boolean));
const missingEvidencePathRiskClassifications = missingEvidencePathRisks.map((risk, index) => {
  const mapping = missingEvidencePathMappings[index];
  const rejections = auditProvenanceRejections.filter((entry) => entry?.path === mapping.path);
  const causalEvidenceValid =
    risk.canAutoResolve === true &&
    typeof mapping.path === "string" &&
    mapping.path.length > 0 &&
    rejections.length > 0;
  return {
    id: `implementation-risk-${String(releaseBlockerRisks.length + index + 1).padStart(3, "0")}`,
    kind: risk.kind,
    area: risk.area,
    blocker: risk.blocker,
    pair: mapping.pair,
    ownerClass: causalEvidenceValid ? "stale_evidence" : "repo_owned",
    causalSources: rejections.map((entry) => ({
      type: "final-audit-provenance-rejection",
      path: entry.path,
      errors: entry.errors,
    })),
    causalEvidenceValid,
  };
});
const missingEvidencePathRiskClassificationValid =
  missingEvidencePathRisks.length === 36 &&
  new Set(missingEvidencePathMappings.map((item) => item.pair)).size === 36 &&
  missingEvidenceRiskPaths.size === 31 &&
  missingEvidencePathRisks.every((risk) => risk.canAutoResolve === true) &&
  missingEvidencePathRiskClassifications.every(
    (classification) => classification.ownerClass !== "repo_owned" && classification.causalEvidenceValid === true,
  ) &&
  missingEvidencePathMappings.every(
    (mapping) => typeof mapping.path === "string" && mapping.path.length > 0 && auditRejectedPaths.has(mapping.path),
  ) &&
  exactStringSet(
    [...auditRejectedPaths],
    [...missingEvidenceRiskPaths, ...EXPECTED_NON_IMPLEMENTATION_AUDIT_REJECTION_PATHS],
  );

const auditRequirements = Array.isArray(artifacts.finalAudit?.requirements) ? artifacts.finalAudit.requirements : [];
const auditRequirementsById = new Map(auditRequirements.map((requirement) => [requirement.id, requirement]));
const missingRequirementRiskShapeValid =
  missingRequirementRisks.length === 8 &&
  exactStringSet(artifacts.finalAudit?.missingRequirements, EXPECTED_MISSING_REQUIREMENT_IDS) &&
  exactStringSet(
    missingRequirementRisks.map((risk) => risk.area),
    EXPECTED_MISSING_REQUIREMENT_IDS,
  ) &&
  new Set(missingRequirementRisks.map(canonicalPair)).size === 8 &&
  missingRequirementRisks.every((risk) => {
    const requirement = auditRequirementsById.get(risk.area);
    return requirement?.status === "missing" && requirement?.detail === risk.blocker && risk.canAutoResolve === true;
  });

const policyRisks = Array.isArray(artifacts.finalAudit?.policyBlockedRisks)
  ? artifacts.finalAudit.policyBlockedRisks
  : [];
const policyRiskPairs = new Set(
  policyRisks.filter((risk) => risk?.kind === "explicit-token-spend-consent").map(canonicalPair),
);
const auditExternalRisks = Array.isArray(artifacts.finalAudit?.externalBlockedRisks)
  ? artifacts.finalAudit.externalBlockedRisks
  : [];
const expectedDistributionOperatorKinds = [
  "release-signing-updater-operator-gate",
  "signed-distribution-operator-gate",
];
const operatorRisks = auditExternalRisks.filter((risk) => expectedDistributionOperatorKinds.includes(risk?.kind));
const operatorRiskPairs = new Set(operatorRisks.map(canonicalPair));
const externalRiskPairs = new Set(
  auditExternalRisks.filter((risk) => !expectedDistributionOperatorKinds.includes(risk?.kind)).map(canonicalPair),
);
const outsideScoreBlockers = scoreBlockers.filter((blocker) => !releaseRiskPairSet.has(canonicalPair(blocker)));
const outsideScoreBlockerClassifications = outsideScoreBlockers.map((blocker, index) => {
  const pair = canonicalPair(blocker);
  const matches = [
    ...(policyRiskPairs.has(pair) ? ["policy"] : []),
    ...(operatorRiskPairs.has(pair) ? ["operator"] : []),
    ...(externalRiskPairs.has(pair) ? ["external"] : []),
    ...(blocker.area === "release-readiness-aggregate" &&
    blocker.kind === "aggregate" &&
    EXPECTED_AGGREGATE_OUTSIDE_BLOCKERS.includes(blocker.blocker)
      ? ["aggregate"]
      : []),
  ];
  const ownerClass = matches.length === 1 ? matches[0] : "repo_owned";
  return {
    id: `outside-score-blocker-${String(index + 1).padStart(2, "0")}`,
    pair,
    area: blocker.area,
    kind: blocker.kind,
    ownerClass,
    causalSources:
      ownerClass === "policy"
        ? [{ type: "final-audit-policy-risk", pair }]
        : ownerClass === "operator"
          ? operatorRisks.map((risk) => ({ type: "final-audit-operator-risk", kind: risk.kind, pair }))
          : ownerClass === "external"
            ? [{ type: "final-audit-external-risk", pair }]
            : ownerClass === "aggregate"
              ? [{ type: "release-score-aggregate-row", area: blocker.area, pair }]
              : [],
  };
});
const outsideScoreBlockerClassCounts = Object.fromEntries(
  ["policy", "operator", "external", "aggregate", "repo_owned"].map((ownerClass) => [
    ownerClass,
    outsideScoreBlockerClassifications.filter((item) => item.ownerClass === ownerClass).length,
  ]),
);
const outsideScoreBlockerClassificationValid =
  outsideScoreBlockers.length === 18 &&
  new Set(outsideScoreBlockers.map(canonicalPair)).size === 18 &&
  policyRisks.length === 12 &&
  policyRiskPairs.size === 12 &&
  operatorRisks.length === 2 &&
  exactStringSet(
    operatorRisks.map((risk) => risk.kind),
    expectedDistributionOperatorKinds,
  ) &&
  operatorRisks.every((risk) => risk.canAutoResolve === false) &&
  operatorRiskPairs.size === 1 &&
  outsideScoreBlockerClassCounts.policy === 12 &&
  outsideScoreBlockerClassCounts.operator === 1 &&
  outsideScoreBlockerClassCounts.external === 0 &&
  outsideScoreBlockerClassCounts.aggregate === 5 &&
  outsideScoreBlockerClassCounts.repo_owned === 0;
const missingRequirementRiskClassifications = missingRequirementRisks.map((risk, index) => {
  const requirement = auditRequirementsById.get(risk.area);
  const requiredRootAreas = REQUIREMENT_ROOT_AREAS[risk.area];
  const requiredOutsideClasses = REQUIREMENT_OUTSIDE_OWNER_CLASSES[risk.area];
  const rootRiskReferences = Array.isArray(requiredRootAreas)
    ? releaseBlockerRiskClassifications
        .filter((classification) => requiredRootAreas.includes(classification.area))
        .map((classification) => ({
          type: "classified-implementation-risk",
          id: classification.id,
          pair: classification.pair,
          ownerClass: classification.ownerClass,
        }))
    : [];
  const outsideRootReferences = Array.isArray(requiredOutsideClasses)
    ? outsideScoreBlockerClassifications
        .filter((classification) => requiredOutsideClasses.includes(classification.ownerClass))
        .map((classification) => ({
          type: "classified-outside-score-blocker",
          id: classification.id,
          pair: classification.pair,
          ownerClass: classification.ownerClass,
        }))
    : [];
  const requirementRejectedEvidence = Array.isArray(requirement?.evidence)
    ? requirement.evidence
        .filter((path) => scoreRejectionsByPath.has(path))
        .map((path) => ({
          type: "requirement-evidence-provenance-rejection",
          path,
          errors: scoreRejectionsByPath.get(path).errors,
        }))
    : [];
  const rootAreasCovered =
    Array.isArray(requiredRootAreas) &&
    requiredRootAreas.every((area) =>
      rootRiskReferences.some((reference) =>
        releaseBlockerRiskClassifications.some(
          (classification) => classification.id === reference.id && classification.area === area,
        ),
      ),
    );
  const outsideClassesCovered =
    Array.isArray(requiredOutsideClasses) &&
    requiredOutsideClasses.every((ownerClass) =>
      outsideRootReferences.some((reference) => reference.ownerClass === ownerClass),
    );
  const causalEvidenceValid =
    requirement?.status === "missing" &&
    requirement?.detail === risk.blocker &&
    risk.canAutoResolve === true &&
    requirementRejectedEvidence.length > 0 &&
    rootAreasCovered &&
    outsideClassesCovered &&
    rootRiskReferences.every((reference) => reference.ownerClass !== "repo_owned") &&
    outsideRootReferences.every((reference) => reference.ownerClass !== "repo_owned");
  return {
    id: `implementation-risk-${String(releaseBlockerRisks.length + missingEvidencePathRisks.length + index + 1).padStart(3, "0")}`,
    kind: risk.kind,
    area: risk.area,
    blocker: risk.blocker,
    pair: canonicalPair(risk),
    ownerClass: causalEvidenceValid ? "derived" : "repo_owned",
    causalSources: [...requirementRejectedEvidence, ...rootRiskReferences, ...outsideRootReferences],
    causalEvidenceValid,
  };
});
const missingRequirementRiskClassificationValid =
  missingRequirementRiskShapeValid &&
  exactStringSet(Object.keys(REQUIREMENT_ROOT_AREAS), EXPECTED_MISSING_REQUIREMENT_IDS) &&
  exactStringSet(Object.keys(REQUIREMENT_OUTSIDE_OWNER_CLASSES), EXPECTED_MISSING_REQUIREMENT_IDS) &&
  missingRequirementRiskClassifications.every(
    (classification) => classification.ownerClass !== "repo_owned" && classification.causalEvidenceValid === true,
  );
const perRiskClassifications = [
  ...releaseBlockerRiskClassifications,
  ...missingEvidencePathRiskClassifications,
  ...missingRequirementRiskClassifications,
];
const implementationRiskKindCounts = Object.fromEntries(
  ["release-blocker", "missing-or-invalid-evidence-path", "missing-requirement"].map((kind) => [
    kind,
    implementationRisks.filter((risk) => risk?.kind === kind).length,
  ]),
);
const implementationRiskClassificationValid =
  implementationRisks.length === 202 &&
  artifacts.finalAudit?.implementationFixableCount === 202 &&
  new Set(implementationRiskPairs).size === 202 &&
  perRiskClassifications.length === 202 &&
  new Set(perRiskClassifications.map((classification) => classification.id)).size === 202 &&
  exactStringSet(
    perRiskClassifications.map((classification) => classification.pair),
    implementationRiskPairs,
  ) &&
  perRiskClassifications.every(
    (classification) =>
      classification.ownerClass !== "repo_owned" &&
      classification.causalEvidenceValid === true &&
      classification.causalSources.length > 0,
  ) &&
  Object.values(implementationRiskKindCounts).reduce((sum, count) => sum + count, 0) === 202 &&
  releaseBlockerRiskClassificationValid &&
  missingEvidencePathRiskClassificationValid &&
  missingRequirementRiskClassificationValid &&
  outsideScoreBlockerClassificationValid;
const implementationRiskClassification = {
  valid: implementationRiskClassificationValid,
  total: implementationRisks.length,
  uniqueCanonicalPairs: new Set(implementationRiskPairs).size,
  kindCounts: implementationRiskKindCounts,
  ownerClassCounts: Object.fromEntries(
    ["stale_evidence", "policy", "operator", "external", "aggregate", "derived", "repo_owned"].map((ownerClass) => [
      ownerClass,
      perRiskClassifications.filter((classification) => classification.ownerClass === ownerClass).length,
    ]),
  ),
  canonicalPairDigest: digestCanonicalPairs(implementationRiskPairs),
  scoreRejectionRegistry: {
    count: scoreProvenanceRejections.length,
    digest: scoreRejectionRegistryDigest,
    expectedDigest: EXPECTED_SCORE_REJECTION_REGISTRY_DIGEST,
    entries: canonicalRejectionRegistry(scoreProvenanceRejections).map(([path, errors]) => ({ path, errors })),
  },
  releaseBlockers: {
    count: releaseBlockerRisks.length,
    exactScorePairMatches: releaseBlockerRisks.filter((risk) => scoreBlockersByPair.has(canonicalPair(risk))).length,
    causalBasis:
      "final audit consumed the recorded release-score SHA; the aggregate regenerated later at the same evidence HEAD with the exact score projection and blocker-pair partition",
    scoreBoundToFinalAudit: releaseScoreBoundToFinalAudit,
    recordedReleaseScoreSha: finalAuditReleaseScoreInput?.sha256 ?? null,
    currentReleaseScoreSha,
    scoreRegeneratedAfterAudit: finalAuditReleaseScoreInput?.sha256 !== currentReleaseScoreSha,
    staleProvenanceRejectionCount: scoreProvenanceRejections.length,
    valid: releaseBlockerRiskClassificationValid,
  },
  missingEvidencePaths: {
    count: missingEvidencePathRisks.length,
    mappedToAuditProvenanceRejections: missingEvidencePathMappings.filter((item) => auditRejectedPaths.has(item.path))
      .length,
    valid: missingEvidencePathRiskClassificationValid,
  },
  missingRequirements: {
    count: missingRequirementRisks.length,
    ids: missingRequirementRisks.map((risk) => risk.area),
    valid: missingRequirementRiskClassificationValid,
  },
  outsideScoreBlockers: {
    count: outsideScoreBlockers.length,
    classCounts: outsideScoreBlockerClassCounts,
    classifications: outsideScoreBlockerClassifications,
    valid: outsideScoreBlockerClassificationValid,
  },
  perRiskClassifications,
};
const perRiskRepoOwnedDefects = perRiskClassifications
  .filter((classification) => classification.ownerClass === "repo_owned")
  .map((classification) => ({
    id: classification.id,
    ownerClass: "repo_owned",
    reason: "implementation risk lacks an exact non-repo causal owner",
    evidence: classification,
  }));
const implementationRiskDefects = implementationRiskClassificationValid
  ? []
  : perRiskRepoOwnedDefects.length > 0
    ? perRiskRepoOwnedDefects
    : [
        {
          id: "final-goal-audit-implementation-risk-registry",
          ownerClass: "repo_owned",
          reason: "the exact risk, rejection, root, or outside-blocker registry drifted",
          evidence: {
            total: implementationRiskClassification.total,
            uniqueCanonicalPairs: implementationRiskClassification.uniqueCanonicalPairs,
            scoreRejectionRegistry: implementationRiskClassification.scoreRejectionRegistry,
          },
        },
      ];
const repoOwnedExecutableDefects = failedDescriptorClassifications
  .filter((item) => item.repoOwnedExecutableDefect === true || item.ownerClass === "repo_owned")
  .concat(implementationRiskDefects);
const categoryCounts = Object.fromEntries(
  OWNER_CLASSES.map((ownerClass) => [
    ownerClass,
    failedDescriptorClassifications.filter((item) => item.ownerClass === ownerClass).length,
  ]),
);
const everyFailureClassifiedExactlyOnce =
  failedDescriptorClassifications.length === failedSteps.length &&
  new Set(failedDescriptorClassifications.map((item) => item.id)).size === failedSteps.length &&
  failedDescriptorClassifications.every((item) => OWNER_CLASSES.includes(item.ownerClass));
const everyClassificationCausal = failedDescriptorClassifications.every((item) => item.causalEvidenceValid === true);
const graphExecutedExactly =
  descriptorIds.length === 23 &&
  runtimeIds.length === descriptorIds.length &&
  runtimeIds.every((id, index) => id === descriptorIds[index]);
const noForbiddenExecution =
  artifacts.noToken?.tokenSpendingPromptExecutedByThisRun === false &&
  artifacts.noToken?.realOsSleepInvoked === false &&
  artifacts.noToken?.finalSafe?.tokenSpendingPromptExecuted === false &&
  noTokenGraph?.tokenBearingStepCount === 0 &&
  noTokenGraph?.runtimeTokenBearingStepCount === 0 &&
  noTokenGraph?.validatedBeforeSpawn === true;
const noTokenRunIsCurrentLocalDate =
  artifacts.noToken?.localDate === new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo" }).format(new Date());
const noTokenGeneratedAtMs = Date.parse(artifacts.noToken?.generatedAt ?? "");
const releaseScoreGeneratedAtMs = Date.parse(artifacts.releaseScore?.generatedAt ?? "");
const finalAuditGeneratedAtMs = Date.parse(artifacts.finalAudit?.generatedAt ?? "");
const runDurationMs = noTokenSteps.reduce((total, step) => total + (step?.durationMs ?? 0), 0);
const runWindowStartMs = noTokenGeneratedAtMs - runDurationMs - 5_000;
const provenanceInputs = {
  releaseScore: Array.isArray(artifacts.releaseScore?.provenance?.inputs)
    ? artifacts.releaseScore.provenance.inputs
    : [],
  finalAudit: Array.isArray(artifacts.finalAudit?.provenance?.inputs) ? artifacts.finalAudit.provenance.inputs : [],
};
const directArtifactBindingSpecs = [
  { id: "nativeBoundary", path: paths.nativeBoundary, requiredSources: ["releaseScore", "finalAudit"] },
  { id: "preflightMatrix", path: paths.preflightMatrix, requiredSources: ["releaseScore", "finalAudit"] },
  { id: "consentPacket", path: paths.consentPacket, requiredSources: ["releaseScore", "finalAudit"] },
  { id: "signingHandoff", path: paths.signingHandoff, requiredSources: ["finalAudit"] },
  { id: "externalReadiness", path: paths.externalReadiness, requiredSources: ["finalAudit"] },
];
const directArtifactBindings = directArtifactBindingSpecs.map((spec) => {
  const currentSha256 = sha256(spec.path);
  const recorded = Object.fromEntries(
    spec.requiredSources.map((sourceId) => [
      sourceId,
      provenanceInputs[sourceId].find((input) => input?.path === spec.path)?.sha256 ?? null,
    ]),
  );
  return {
    ...spec,
    currentSha256,
    recorded,
    coherent:
      currentSha256 != null &&
      spec.requiredSources.every(
        (sourceId) => typeof recorded[sourceId] === "string" && recorded[sourceId] === currentSha256,
      ),
  };
});
const unrecordedRunWindowArtifacts = [
  { id: "sleepHandoff", path: paths.sleepHandoff },
  { id: "completionMatrix", path: paths.completionMatrix },
].map((spec) => {
  const generatedAtMs = Date.parse(artifacts[spec.id]?.generatedAt ?? "");
  const mtimeMs = mtime(spec.path);
  return {
    ...spec,
    generatedAt: artifacts[spec.id]?.generatedAt ?? null,
    generatedAtMs,
    mtimeMs,
    coherent:
      Number.isFinite(runWindowStartMs) &&
      Number.isFinite(generatedAtMs) &&
      generatedAtMs >= runWindowStartMs &&
      generatedAtMs <= noTokenGeneratedAtMs &&
      mtimeMs >= runWindowStartMs &&
      mtimeMs <= mtime(paths.noToken),
  };
});
const mutableArtifactCoherenceValid =
  directArtifactBindings.every((binding) => binding.coherent) &&
  unrecordedRunWindowArtifacts.every((artifact) => artifact.coherent);
const noTokenEvidenceHeadCoherent =
  Number.isFinite(noTokenGeneratedAtMs) &&
  Number.isFinite(releaseScoreGeneratedAtMs) &&
  Number.isFinite(finalAuditGeneratedAtMs) &&
  noTokenGeneratedAtMs >= releaseScoreGeneratedAtMs &&
  noTokenGeneratedAtMs >= finalAuditGeneratedAtMs &&
  artifacts.releaseScore?.provenance?.gitHead === evidenceHead &&
  artifacts.finalAudit?.provenance?.gitHead === evidenceHead &&
  artifacts.noToken?.score?.score === artifacts.releaseScore?.score &&
  artifacts.noToken?.score?.total === artifacts.releaseScore?.total &&
  artifacts.noToken?.score?.max === artifacts.releaseScore?.max &&
  artifacts.noToken?.score?.grade === artifacts.releaseScore?.grade &&
  artifacts.noToken?.score?.releaseCandidateReady === artifacts.releaseScore?.releaseCandidateReady &&
  artifacts.noToken?.finalAudit?.status === artifacts.finalAudit?.status &&
  artifacts.noToken?.finalAudit?.implementationFixableCount === artifacts.finalAudit?.implementationFixableCount &&
  artifacts.noToken?.finalAudit?.policyBlockedCount === artifacts.finalAudit?.policyBlockedCount &&
  artifacts.noToken?.finalAudit?.externalBlockedCount === artifacts.finalAudit?.externalBlockedCount &&
  evidenceHeadAllowed;
const frontierClosed =
  frontier.phase === "A9" &&
  frontier.activeSlice === "A9.6" &&
  frontier.lastCompletedSlice === "A9.6" &&
  frontier.nextImplementationSlice === "A9.6" &&
  source.workOrder.includes("A9.6 closed with `close_repo_owned_release_lane`") &&
  source.plan.includes("Status: complete with `close_repo_owned_release_lane`") &&
  source.specIndex.includes("A9.6 repo-owned release-lane closeout is complete") &&
  source.workOrder.includes("A9.6 closes repo-owned R0-A9") &&
  source.workOrder.includes("release readiness remains false");

const checks = [
  check("required-paths", missingPaths.length === 0, "all A9.6 authority and evidence paths exist", {
    missingPaths,
  }),
  check("parseable-artifacts", unparsableArtifactIds.length === 0, "every A9.6 input artifact is parseable JSON", {
    unparsableArtifactIds,
  }),
  check("frontier-closed", frontierClosed, "A9.6 closes repo-owned R0-A9 without activating post-A9 work", {
    frontier,
  }),
  check(
    "descriptor-graph-executed",
    graphExecutedExactly,
    "all 23 declared no-token descriptors executed exactly once in order",
    { descriptorIds, runtimeIds },
  ),
  check(
    "current-no-token-artifact",
    noTokenRunIsCurrentLocalDate &&
      noTokenEvidenceHeadCoherent &&
      artifacts.noToken?.ok === false &&
      artifacts.noToken?.status === "failed",
    "the classified no-token artifact is coherent with score/final-audit provenance at the bounded evidence HEAD",
    {
      generatedAt: artifacts.noToken?.generatedAt ?? null,
      localDate: artifacts.noToken?.localDate ?? null,
      status: artifacts.noToken?.status ?? null,
      evidenceHead,
      currentHead: head,
      commitDeltaPaths,
      unexpectedCommitDeltaPaths,
      commitCount,
      commitSubjects,
      evidenceCommitState,
      headCommit: {
        subject: headSubject,
        paths: headCommitPaths,
      },
      parentCommit: {
        subject: headParentSubject,
        paths: headParentCommitPaths,
      },
    },
  ),
  check(
    "evidence-artifact-coherence",
    mutableArtifactCoherenceValid,
    "mutable direct artifacts match recorded provenance hashes and unrecorded artifacts remain inside the no-token run window",
    {
      runWindow: {
        start: Number.isFinite(runWindowStartMs) ? new Date(runWindowStartMs).toISOString() : null,
        end: artifacts.noToken?.generatedAt ?? null,
        durationMs: runDurationMs,
      },
      directArtifactBindings,
      unrecordedRunWindowArtifacts,
    },
  ),
  check(
    "forbidden-actions-absent",
    noForbiddenExecution &&
      artifacts.signingHandoff?.signingMaterialProvidedToThisRun === false &&
      artifacts.sleepHandoff?.realOsSleepInvoked === false &&
      artifacts.externalReadiness?.realOsSleepAttempted === false,
    "the evidence chain executed no token prompt, signing, real OS sleep, or publication action",
    {
      tokenSpendingPromptExecutedByThisRun: artifacts.noToken?.tokenSpendingPromptExecutedByThisRun,
      realOsSleepInvoked: artifacts.noToken?.realOsSleepInvoked,
      signingMaterialProvidedToThisRun: artifacts.signingHandoff?.signingMaterialProvidedToThisRun,
      realOsSleepAttempted: artifacts.externalReadiness?.realOsSleepAttempted,
    },
  ),
  check(
    "exact-failed-descriptor-set",
    exactStringSet(failedStepIds, EXPECTED_FAILED_DESCRIPTOR_IDS) &&
      exactStringSet(artifacts.noToken?.failedSteps, EXPECTED_FAILED_DESCRIPTOR_IDS),
    "the current eight failed descriptors match the bounded A9.6 classification set",
    { failedStepIds, artifactFailedSteps: artifacts.noToken?.failedSteps ?? null },
  ),
  check(
    "known-descriptor-internal-failure-modes",
    knownDescriptorFailureModesExhaustive,
    "every known failed descriptor has the exact bounded internal failure set and downstream dependency identity",
    {
      observedInternalFailureModes,
      expectedFalseChecks: EXPECTED_FALSE_CHECKS,
      finalAuditDependencyGraph: artifacts.finalAudit?.dependencyGraph ?? null,
      finalAuditDependencyGraphValid,
    },
  ),
  check(
    "failed-descriptors-classified-once",
    everyFailureClassifiedExactlyOnce && everyClassificationCausal,
    "every remaining failed descriptor has exactly one evidence-backed owner classification",
    { failedDescriptorClassifications },
  ),
  check(
    "exact-category-split",
    categoryCounts.repo_owned === 0 &&
      categoryCounts.stale_evidence === 2 &&
      categoryCounts.policy === 1 &&
      categoryCounts.operator === 2 &&
      categoryCounts.external === 1 &&
      categoryCounts.derived === 2,
    "stale, policy, operator, external, and downstream-view categories remain distinct",
    { categoryCounts },
  ),
  check(
    "implementation-fixable-risks-classified",
    implementationRiskClassificationValid,
    "all final-audit implementation risks map exactly to bounded score, provenance, or missing-requirement causes",
    implementationRiskClassification,
  ),
  check(
    "no-repo-owned-executable-defect",
    repoOwnedExecutableDefects.length === 0,
    "no current failed descriptor or implementation-fixable risk is an executable repo-owned defect",
    { repoOwnedExecutableDefects },
  ),
  check(
    "release-credit-denied",
    artifacts.noToken?.score?.releaseCandidateReady === false &&
      artifacts.noToken?.finalAudit?.status === "blocked" &&
      artifacts.noToken?.finalSafe?.status === "blocked",
    "repo-owned closeout grants no release or capability credit",
    {
      score: artifacts.noToken?.score ?? null,
      finalAudit: artifacts.noToken?.finalAudit ?? null,
      finalSafe: artifacts.noToken?.finalSafe ?? null,
    },
  ),
  check(
    "package-command",
    source.packageJson.includes('"verify:a9:release-lane-closeout"') &&
      source.packageJson.includes("node scripts/verify-a9-release-lane-closeout.mjs"),
    "package.json exposes the focused A9.6 verifier",
    {},
  ),
  check(
    "work-os-frontier-contract",
    source.workOsVerifier.includes("a9ReleaseLaneCloseoutFrontierValid") &&
      source.workOsVerifier.includes("A9.6 closes repo-owned R0-A9"),
    "the Work OS verifier accepts only the explicit A9.6 repo-owned closeout frontier",
    {},
  ),
  check("dirty-scope", unexpectedDirtyPaths.length === 0, "the A9.6 candidate contains only owned paths", {
    dirtyPaths: dirty,
    unexpectedDirtyPaths,
  }),
];

const failedChecks = checks.filter((item) => item.status !== "passed");
const contractPass = failedChecks.length === 0;
const committedAtHead = contractPass && dirty.length === 0;
const report = {
  schema: "aelyris.a9_6_release_lane_closeout/v1",
  contractVersion: 1,
  ok: contractPass,
  status: !contractPass
    ? "fail-a9.6-release-lane-closeout"
    : committedAtHead
      ? "pass-a9.6-close-repo-owned-release-lane-committed"
      : "pass-a9.6-close-repo-owned-release-lane-ready-to-commit",
  generatedAt: new Date().toISOString(),
  git: {
    head,
    evidenceHead,
    branch: git(["branch", "--show-current"]),
    dirtyPaths: dirty,
    commitDeltaPaths,
    commitCount,
    commitSubjects,
    evidenceCommitState,
  },
  completedSlice: "A9.6",
  activeSlice: "A9.6",
  nextImplementationSlice: "A9.6",
  decision: "close_repo_owned_release_lane",
  repoOwnedCloseoutComplete: committedAtHead,
  readyToCommit: contractPass && !committedAtHead,
  phaseComplete: false,
  overallProgramComplete: false,
  releaseReady: false,
  releaseCandidateReady: false,
  currentScoreClaimAllowed: false,
  postA9Activated: false,
  tokenSpendingPromptExecutedByThisRun: false,
  realOsSleepInvokedByThisRun: false,
  signingInvokedByThisRun: false,
  publicationInvokedByThisRun: false,
  repoOwnedExecutableDefectCount: repoOwnedExecutableDefects.length,
  categoryCounts,
  implementationRiskClassification,
  noTokenRun: {
    generatedAt: artifacts.noToken?.generatedAt ?? null,
    localDate: artifacts.noToken?.localDate ?? null,
    status: artifacts.noToken?.status ?? null,
    descriptorCount: descriptorIds.length,
    executedCount: runtimeIds.length,
    passedStepCount: noTokenSteps.filter((step) => step?.ok === true).length,
    failedStepCount: failedSteps.length,
  },
  failedDescriptorClassifications,
  artifactCoherence: {
    mutableArtifactCoherenceValid,
    runWindowStart: Number.isFinite(runWindowStartMs) ? new Date(runWindowStartMs).toISOString() : null,
    runWindowEnd: artifacts.noToken?.generatedAt ?? null,
    directArtifactBindings,
    unrecordedRunWindowArtifacts,
  },
  exactHandoff: {
    staleEvidenceRefresh: [
      "pnpm verify:mux-live",
      "pnpm verify:mux-live-process-preservation",
      "pnpm verify:terminal:ai-cli-boundary",
      ...expectedPreflightRefreshCommands.slice(1),
    ],
    authenticatedProvider: {
      refresh: "pnpm verify:terminal:authenticated-ai-cli-consent-packet",
      command: "pnpm verify:goal:operator:token-smoke",
      requiredEnv: "AELYRIS_AUTH_PROMPT_PROVIDER=codex|claude|gemini",
    },
    signing: {
      refresh: "pnpm verify:goal:release-signing-handoff",
      build: "pnpm tauri:build:dist",
      codeSign: "signtool sign /fd SHA256 /tr <trusted-rfc3161-url> /td SHA256 <app-exe> <nsis-exe> <msi>",
    },
    realSleep: {
      refresh: "pnpm verify:goal:sleep-handoff",
      manualCycle: "pnpm verify:production:suspend:native-user-cycle",
      operatorFinish: "pnpm verify:goal:operator-finish",
      requiredEnv: "AELYRIS_GOAL_OPERATOR_RUN_SLEEP=I_WILL_MANUALLY_SLEEP_WINDOWS_WHILE_VERIFIER_WAITS",
    },
    external: "pnpm verify:goal:external-gates",
    afterOwnerEvidence: [
      "pnpm verify:goal:operator-finish",
      "pnpm verify:goal:finalize",
      "pnpm verify:goal:safe",
      "pnpm verify:goal:closeout",
    ],
    derivedOnly: ["pnpm verify:final-goal-audit", "pnpm verify:goal:completion-matrix"],
  },
  checks,
  inputs: Object.fromEntries(Object.entries(paths).map(([id, path]) => [id, { path, mtimeMs: mtime(path) }])),
  artifact: ".codex-auto/quality/a9-release-lane-closeout.json",
};

writeJsonAtomic(OUT, report);
console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exitCode = 1;
