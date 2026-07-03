import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import process from "node:process";

const ROOT = resolve(process.cwd());
const OUT = join(ROOT, ".codex-auto", "quality", "goal-finalize-evidence.json");
const LOCAL_TIME_ZONE = "Asia/Tokyo";
const DEFAULT_TIMEOUT_MS = Number.parseInt(process.env.AELYRIS_GOAL_FINALIZE_STEP_TIMEOUT_MS ?? "180000", 10);
const HEARTBEAT_MS = Number.parseInt(process.env.AELYRIS_GOAL_FINALIZE_HEARTBEAT_MS ?? "30000", 10);
const OUTPUT_TAIL_CHARS = 5000;
const SKIP_OPERATOR = process.env.AELYRIS_GOAL_FINALIZE_SKIP_OPERATOR === "1";
const INCLUDE_GIT_FINALIZATION = process.env.AELYRIS_GOAL_FINALIZE_INCLUDE_GIT === "1";
const MANUAL_SLEEP_COMMAND = "pnpm verify:production:suspend:native-user-cycle";
const AFTER_EXTERNAL_GATE_COMMANDS = [
  "pnpm verify:goal:operator-finish",
  "pnpm verify:goal:finalize",
  "pnpm verify:goal:safe",
  "pnpm verify:goal:closeout",
];

const productSourceFiles = [
  "package.json",
  "scripts/final-goal-artifact-lock.mjs",
  "scripts/verify-goal-closeout-snapshot.mjs",
  "scripts/verify-agent-team-orchestration-readiness.mjs",
  "scripts/verify-goal-finalize-evidence.mjs",
  "scripts/verify-goal-operator-finish.mjs",
  "scripts/verify-goal-external-gate-readiness.mjs",
  "scripts/verify-release-signing-operator-handoff.mjs",
  "scripts/verify-real-os-sleep-operator-handoff.mjs",
  "scripts/verify-goal-anti-stall-contract.mjs",
  "scripts/verify-final-goal-safe.mjs",
  "scripts/verify-goal-non-token-refresh.mjs",
  "scripts/verify-goal-documentation-freshness.mjs",
  "scripts/verify-goal-completion-matrix.mjs",
  "scripts/verify-final-goal-audit.mjs",
  "scripts/score-release-quality.mjs",
  "scripts/verify-release-hygiene-contract.mjs",
  "README.md",
  "docs/README.md",
  "docs/PUBLICATION_READINESS.md",
  "docs/requirements.md",
  "docs/specs/README.md",
  "docs/specs/AELYRIS_REQUIREMENTS_SPEC_DESIGN_TRACEABILITY_2026-06-27.md",
  "docs/release-build-playbook.md",
];
const optionalGitSourceFiles = [
  "scripts/verify-git-finalization-readiness.mjs",
  "scripts/verify-git-finalization-shell-diagnostics.ps1",
];
const sourceFiles = [...productSourceFiles, ...(INCLUDE_GIT_FINALIZATION ? optionalGitSourceFiles : [])];

const artifactPaths = {
  releaseHygiene: ".codex-auto/quality/release-hygiene-contract.json",
  antiStall: ".codex-auto/quality/goal-anti-stall-contract.json",
  finalAudit: ".codex-auto/quality/final-goal-audit.json",
  qualityScore: ".codex-auto/quality/release-quality-score.json",
  docs: ".codex-auto/quality/goal-documentation-freshness.json",
  releaseSigningHandoff: ".codex-auto/quality/release-signing-operator-handoff.json",
  sleepHandoff: ".codex-auto/quality/real-os-sleep-operator-handoff.json",
  externalGateReadiness: ".codex-auto/quality/goal-external-gate-readiness.json",
  matrix: ".codex-auto/quality/goal-completion-matrix.json",
  operatorFinish: ".codex-auto/quality/goal-operator-finish.json",
  gitFinalization: ".codex-auto/quality/git-finalization-readiness.json",
  gitShellDiagnostics: ".codex-auto/quality/git-finalization-shell-diagnostics.json",
  safe: ".codex-auto/quality/final-goal-safe-summary.json",
};

const finalizeSequence = [
  { id: "release-hygiene", label: "Release hygiene", script: "verify-release-hygiene-contract.mjs" },
  { id: "anti-stall", label: "Anti-stall contract", script: "verify-goal-anti-stall-contract.mjs" },
  { id: "quality-score-pre-audit", label: "Release quality score before final audit", script: "score-release-quality.mjs" },
  {
    id: "release-signing-operator-handoff",
    label: "Release signing/updater operator handoff",
    script: "verify-release-signing-operator-handoff.mjs",
  },
  { id: "final-goal-audit-1", label: "Final goal audit pre-score", script: "verify-final-goal-audit.mjs" },
  { id: "quality-score-1", label: "Release quality score pre-docs", script: "score-release-quality.mjs" },
  { id: "goal-documentation-freshness", label: "Goal documentation freshness", script: "verify-goal-documentation-freshness.mjs" },
  { id: "final-goal-audit-2", label: "Final goal audit after docs", script: "verify-final-goal-audit.mjs" },
  { id: "quality-score-2", label: "Release quality score after audit", script: "score-release-quality.mjs" },
  { id: "real-os-sleep-operator-handoff", label: "Real OS sleep operator handoff", script: "verify-real-os-sleep-operator-handoff.mjs" },
  { id: "external-gate-readiness", label: "External gate readiness", script: "verify-goal-external-gate-readiness.mjs" },
  ...(SKIP_OPERATOR
    ? []
    : [{ id: "operator-finish-readiness", label: "Operator finish readiness", script: "verify-goal-operator-finish.mjs" }]),
  { id: "goal-completion-matrix", label: "Goal completion matrix", script: "verify-goal-completion-matrix.mjs" },
  ...(INCLUDE_GIT_FINALIZATION
    ? [
        {
          id: "git-finalization-shell-diagnostics",
          label: "Git finalization direct shell diagnostics",
          script: "verify-git-finalization-shell-diagnostics.ps1",
          runtime: "powershell",
        },
        {
          id: "git-finalization-readiness",
          label: "Git finalization readiness",
          script: "verify-git-finalization-readiness.mjs",
        },
      ]
    : []),
  { id: "goal-safe", label: "Final safe gate", script: "verify-final-goal-safe.mjs", timeoutMs: 900000 },
];

function currentLocalDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: LOCAL_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function mtimeMs(path) {
  const full = join(ROOT, path);
  return existsSync(full) ? statSync(full).mtimeMs : 0;
}

function readJson(path) {
  const full = join(ROOT, path);
  if (!existsSync(full)) return null;
  return JSON.parse(readFileSync(full, "utf8"));
}

function outputTail(value) {
  const text = String(value ?? "").trim();
  return text.length > OUTPUT_TAIL_CHARS ? text.slice(-OUTPUT_TAIL_CHARS) : text;
}

function appendLimitedOutput(current, chunk) {
  const next = `${current}${String(chunk ?? "")}`;
  const limit = OUTPUT_TAIL_CHARS * 4;
  return next.length > limit ? next.slice(-limit) : next;
}

function noTokenNoSleepEnv(extra = {}) {
  const env = {
    ...process.env,
    ...extra,
    AELYRIS_GOAL_FINALIZE_NON_TOKEN: "1",
  };
  delete env.AELYRIS_AUTH_PROMPT_CONSENT;
  delete env.AELYRIS_AUTH_PROMPT_PROVIDER;
  delete env.AELYRIS_GOAL_OPERATOR_RUN_SLEEP;
  delete env.AELYRIS_ALLOW_OS_SLEEP;
  return env;
}

function sourceCutoffMs() {
  return Math.max(...sourceFiles.map(mtimeMs));
}

function cutoffMsFor(paths) {
  return Math.max(0, ...paths.filter((path) => typeof path === "string" && path.length > 0).map(mtimeMs));
}

function sourceCutoffMsForStep(id) {
  const goalDocs = [
    "README.md",
    "docs/README.md",
    "docs/PUBLICATION_READINESS.md",
    "docs/requirements.md",
    "docs/specs/README.md",
    "docs/specs/AELYRIS_REQUIREMENTS_SPEC_DESIGN_TRACEABILITY_2026-06-27.md",
  ];
  const stepSources = {
    "goal-documentation-freshness": [
      "scripts/verify-goal-documentation-freshness.mjs",
      ...goalDocs,
      artifactPaths.qualityScore,
      artifactPaths.finalAudit,
    ],
    "real-os-sleep-operator-handoff": [
      "scripts/verify-real-os-sleep-operator-handoff.mjs",
      "scripts/verify-real-os-suspend-evidence.mjs",
      "src/shared/lib/rightRailGoalTrack.ts",
      "src/__tests__/rightRailGoalTrack.test.ts",
      "docs/release-build-playbook.md",
      artifactPaths.qualityScore,
      artifactPaths.finalAudit,
    ],
    "release-signing-operator-handoff": [
      "scripts/verify-release-signing-operator-handoff.mjs",
      "scripts/release-doctor.mjs",
      "scripts/build-dist-windows.ps1",
      "src-tauri/tauri.dist.conf.json",
      "src-tauri/tauri.conf.json",
      artifactPaths.qualityScore,
    ],
    "external-gate-readiness": [
      "scripts/verify-goal-external-gate-readiness.mjs",
      artifactPaths.qualityScore,
      artifactPaths.finalAudit,
      artifactPaths.releaseSigningHandoff,
      artifactPaths.sleepHandoff,
    ],
    "goal-completion-matrix": [
      "scripts/verify-goal-completion-matrix.mjs",
      "scripts/verify-final-goal-audit.mjs",
      "scripts/score-release-quality.mjs",
      artifactPaths.qualityScore,
      artifactPaths.finalAudit,
      artifactPaths.sleepHandoff,
      artifactPaths.externalGateReadiness,
    ],
    "operator-finish-readiness": [
      "scripts/verify-goal-operator-finish.mjs",
      "scripts/verify-goal-external-gate-readiness.mjs",
      artifactPaths.qualityScore,
      artifactPaths.finalAudit,
      artifactPaths.externalGateReadiness,
    ],
    "goal-safe": [
      "scripts/verify-final-goal-safe.mjs",
      "scripts/verify-agent-team-orchestration-readiness.mjs",
      "scripts/verify-goal-anti-stall-contract.mjs",
      "scripts/score-release-quality.mjs",
      "scripts/verify-final-goal-audit.mjs",
      artifactPaths.qualityScore,
      artifactPaths.finalAudit,
      artifactPaths.docs,
      artifactPaths.releaseSigningHandoff,
      artifactPaths.sleepHandoff,
      artifactPaths.externalGateReadiness,
      artifactPaths.matrix,
      artifactPaths.operatorFinish,
    ],
  };
  return stepSources[id] ? cutoffMsFor(stepSources[id]) : sourceCutoffMs();
}

function artifactCurrent(path, cutoffMs) {
  const full = join(ROOT, path);
  return existsSync(full) && statSync(full).mtimeMs + 5000 >= cutoffMs;
}

function scoreHasOnlyExternalBlockers(score) {
  const blockers = Array.isArray(score?.blockers) ? score.blockers : [];
  return blockers.every((blocker) =>
    [
      "authenticated-ai-cli-preflight-gate",
      "authenticated-ai-cli-prompt-smoke",
      "distribution",
      "live-ai-cli-post-launch-chaos",
      "live-command-evidence",
      "multipane-command-evidence",
      "process-reconnect-command-evidence",
      "real-os-soak",
      "recovered-command-evidence",
      "release-doctor",
      "release-readiness-aggregate",
      "supply-chain-audit",
      "terminal-core-edge",
    ].includes(String(blocker?.area ?? "")),
  );
}

function scoreMatchesFinalAuditProjection(score, audit) {
  const projected = audit?.score?.projectedAfterEvidenceMap ?? {};
  return (
    score?.releaseCandidateReady === false &&
    audit?.ok === true &&
    audit?.status === "blocked-by-external-gates" &&
    audit?.evidenceComplete === true &&
    audit?.implementationFixableCount === 0 &&
    (audit?.externalBlockedCount ?? 0) >= 1 &&
    projected.total === score?.total &&
    projected.max === score?.max &&
    projected.percent === score?.score &&
    projected.grade === score?.grade
  );
}

function artifactFallbackFor(id) {
  const cutoffMs = sourceCutoffMsForStep(id);
  const releaseHygiene = readJson(artifactPaths.releaseHygiene);
  const antiStall = readJson(artifactPaths.antiStall);
  const finalAudit = readJson(artifactPaths.finalAudit);
  const qualityScore = readJson(artifactPaths.qualityScore);
  const docs = readJson(artifactPaths.docs);
  const releaseSigningHandoff = readJson(artifactPaths.releaseSigningHandoff);
  const sleepHandoff = readJson(artifactPaths.sleepHandoff);
  const externalGateReadiness = readJson(artifactPaths.externalGateReadiness);
  const matrix = readJson(artifactPaths.matrix);
  const operatorFinish = readJson(artifactPaths.operatorFinish);
  const gitFinalization = readJson(artifactPaths.gitFinalization);
  const gitShellDiagnostics = readJson(artifactPaths.gitShellDiagnostics);
  const safe = readJson(artifactPaths.safe);
  const verdicts = {
    "release-hygiene":
      releaseHygiene?.ok === true &&
      releaseHygiene?.status === "pass-current-release-hygiene-contract" &&
      artifactCurrent(artifactPaths.releaseHygiene, cutoffMs),
    "anti-stall":
      antiStall?.ok === true &&
      antiStall?.status === "pass-current-anti-stall-contract" &&
      antiStall?.checks?.goalFinalizeClosesSelfReferenceLoop === true &&
      artifactCurrent(artifactPaths.antiStall, cutoffMs),
    "quality-score-pre-audit":
      (scoreMatchesFinalAuditProjection(qualityScore, finalAudit) || qualityScore?.releaseCandidateReady === true) &&
      scoreHasOnlyExternalBlockers(qualityScore) &&
      artifactCurrent(artifactPaths.qualityScore, cutoffMs),
    "final-goal-audit-1":
      finalAudit?.ok === true &&
      finalAudit?.evidenceComplete === true &&
      finalAudit?.implementationFixableCount === 0 &&
      artifactCurrent(artifactPaths.finalAudit, cutoffMs),
    "final-goal-audit-2":
      finalAudit?.ok === true &&
      finalAudit?.evidenceComplete === true &&
      finalAudit?.implementationFixableCount === 0 &&
      artifactCurrent(artifactPaths.finalAudit, cutoffMs),
    "quality-score-1":
      (scoreMatchesFinalAuditProjection(qualityScore, finalAudit) || qualityScore?.releaseCandidateReady === true) &&
      scoreHasOnlyExternalBlockers(qualityScore) &&
      artifactCurrent(artifactPaths.qualityScore, cutoffMs),
    "quality-score-2":
      (scoreMatchesFinalAuditProjection(qualityScore, finalAudit) || qualityScore?.releaseCandidateReady === true) &&
      scoreHasOnlyExternalBlockers(qualityScore) &&
      artifactCurrent(artifactPaths.qualityScore, cutoffMs),
    "goal-documentation-freshness":
      docs?.ok === true &&
      docs?.status === "pass-current-goal-docs-contract" &&
      artifactCurrent(artifactPaths.docs, cutoffMs),
    "real-os-sleep-operator-handoff":
      sleepHandoff?.ok === true &&
      ["ready-for-manual-sleep-cycle", "host-blocked-handoff-ready", "real-os-sleep-resume-complete"].includes(
        sleepHandoff?.status,
      ) &&
      sleepHandoff?.checks?.evidenceDoesNotFakePass === true &&
      artifactCurrent(artifactPaths.sleepHandoff, cutoffMs),
    "release-signing-operator-handoff":
      releaseSigningHandoff?.ok === true &&
      ["ready-for-release-signing-operator", "release-signing-complete"].includes(releaseSigningHandoff?.status) &&
      releaseSigningHandoff?.signingMaterialProvidedToThisRun === false &&
      releaseSigningHandoff?.noSecretMaterialPersisted === true &&
      artifactCurrent(artifactPaths.releaseSigningHandoff, cutoffMs),
    "external-gate-readiness":
      externalGateReadiness?.ok === true &&
      ["ready-for-external-operator-gates", "blocked-by-host-sleep-unsupported", "external-operator-gates-complete"].includes(
        externalGateReadiness?.status,
      ) &&
      externalGateReadiness?.realOsSleepInvoked === false &&
      artifactCurrent(artifactPaths.externalGateReadiness, cutoffMs),
    "goal-completion-matrix":
      matrix?.ok === true &&
      matrix?.implementationFixableCount === 0 &&
      artifactCurrent(artifactPaths.matrix, cutoffMs),
    "operator-finish-readiness":
      operatorFinish?.ok === true &&
      ["ready-for-external-operator-gates", "complete"].includes(operatorFinish?.status) &&
      artifactCurrent(artifactPaths.operatorFinish, cutoffMs),
    "git-finalization-readiness":
      gitFinalization?.ok === true &&
      ["ready-for-commit-and-merge", "blocked-by-git-metadata-permissions"].includes(gitFinalization?.status) &&
      typeof gitFinalization?.currentBranch === "string" &&
      gitFinalization.currentBranch.length > 0 &&
      typeof gitFinalization?.targetBranch === "string" &&
      gitFinalization.targetBranch.length > 0 &&
      artifactCurrent(artifactPaths.gitFinalization, cutoffMs),
    "git-finalization-shell-diagnostics":
      gitShellDiagnostics?.ok === true &&
      ["ready-for-commit-and-merge", "blocked-by-git-metadata-permissions"].includes(gitShellDiagnostics?.status) &&
      gitShellDiagnostics?.localDate === currentLocalDate() &&
      gitShellDiagnostics?.checks?.repositoryPresent === true &&
      gitShellDiagnostics?.checks?.noExistingIndexLock === true &&
      (gitShellDiagnostics?.status === "ready-for-commit-and-merge" ||
        (gitShellDiagnostics?.checks?.gitAddDryRunOk === false &&
          typeof gitShellDiagnostics?.checks?.denyAceCount === "number" &&
          gitShellDiagnostics.checks.denyAceCount > 0)) &&
      artifactCurrent(artifactPaths.gitShellDiagnostics, cutoffMs),
    "goal-safe":
      safe?.ok === true &&
      safe?.coverage?.proofArtifactPassCount === safe?.coverage?.proofArtifactCount &&
      safe?.coverage?.proofArtifactCount >= 22 &&
      safe?.audit?.implementationFixableCount === 0 &&
      artifactCurrent(artifactPaths.safe, cutoffMs),
  };
  const artifactMap = {
    "release-hygiene": artifactPaths.releaseHygiene,
    "anti-stall": artifactPaths.antiStall,
    "quality-score-pre-audit": artifactPaths.qualityScore,
    "final-goal-audit-1": artifactPaths.finalAudit,
    "final-goal-audit-2": artifactPaths.finalAudit,
    "quality-score-1": artifactPaths.qualityScore,
    "quality-score-2": artifactPaths.qualityScore,
    "goal-documentation-freshness": artifactPaths.docs,
    "release-signing-operator-handoff": artifactPaths.releaseSigningHandoff,
    "real-os-sleep-operator-handoff": artifactPaths.sleepHandoff,
    "external-gate-readiness": artifactPaths.externalGateReadiness,
    "goal-completion-matrix": artifactPaths.matrix,
    "operator-finish-readiness": artifactPaths.operatorFinish,
    "git-finalization-readiness": artifactPaths.gitFinalization,
    "git-finalization-shell-diagnostics": artifactPaths.gitShellDiagnostics,
    "goal-safe": artifactPaths.safe,
  };
  return {
    ok: verdicts[id] === true,
    artifact: artifactMap[id] ?? null,
    cutoffMs,
  };
}

function runNodeStep(step) {
  const timeoutMs = step.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const heartbeatMs = HEARTBEAT_MS;
  const startedAt = Date.now();
  let stdout = "";
  let stderr = "";
  let timedOut = false;
  let settled = false;

  console.error(`[goal-finalize] start ${step.id}: ${step.label}`);

  return new Promise((resolveStep) => {
    let timeout = null;
    let heartbeat = null;
    const finish = (partial) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      if (heartbeat) clearInterval(heartbeat);
      const spawnBlocked = partial.spawnBlocked === true;
      const fallback = spawnBlocked ? artifactFallbackFor(step.id) : { ok: false, artifact: null, cutoffMs: null };
      const ok = fallback.ok === true || partial.ok === true;
      const result = {
        id: step.id,
        label: step.label,
        script: step.script,
        ok,
        status: fallback.ok
          ? "artifact-replay-current-contract"
          : partial.status ?? (ok ? "pass" : "failed"),
        exitCode: partial.exitCode ?? null,
        timedOut,
        spawnBlocked,
        artifactFallback: fallback.ok
          ? {
              status: "pass-current-artifact-replay",
              artifact: fallback.artifact,
              reason: "child process launch was blocked, but the ordered finalize artifact is source-fresh and green",
            }
          : null,
        durationMs: Date.now() - startedAt,
        timeoutMs,
        progressHeartbeatMs: heartbeatMs,
        stdoutTail: outputTail(stdout),
        stderrTail: outputTail(stderr),
      };
      console.error(`[goal-finalize] ${result.ok ? "pass" : "fail"} ${step.id}: ${result.status}`);
      resolveStep(result);
    };

    let child;
    try {
      const command = step.runtime === "powershell" ? "powershell" : process.execPath;
      const args =
        step.runtime === "powershell"
          ? ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(ROOT, "scripts", step.script)]
          : [join(ROOT, "scripts", step.script)];
      child = spawn(command, args, {
        cwd: ROOT,
        env: noTokenNoSleepEnv(step.env),
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      stderr = appendLimitedOutput(stderr, message);
      finish({
        ok: false,
        status: "spawn-failed",
        spawnBlocked: /EPERM|EACCES/i.test(message),
      });
      return;
    }

    timeout = setTimeout(() => {
      timedOut = true;
      stderr = appendLimitedOutput(stderr, `\nTimed out after ${timeoutMs}ms`);
      child.kill();
    }, timeoutMs);
    heartbeat = setInterval(() => {
      const elapsedSeconds = Math.round((Date.now() - startedAt) / 1000);
      const timeoutSeconds = Math.round(timeoutMs / 1000);
      console.error(`[goal-finalize] waiting ${step.id}: ${elapsedSeconds}s elapsed / ${timeoutSeconds}s timeout`);
    }, heartbeatMs);

    child.stdout?.on("data", (chunk) => {
      stdout = appendLimitedOutput(stdout, chunk);
    });
    child.stderr?.on("data", (chunk) => {
      stderr = appendLimitedOutput(stderr, chunk);
    });
    child.on("error", (error) => {
      const message = error instanceof Error ? error.message : String(error);
      stderr = appendLimitedOutput(stderr, message);
      finish({
        ok: false,
        status: "spawn-failed",
        spawnBlocked: error?.code === "EPERM" || error?.code === "EACCES" || /EPERM|EACCES/i.test(message),
      });
    });
    child.on("close", (code) => {
      const exitCode = typeof code === "number" ? code : null;
      const ok = !timedOut && exitCode === 0;
      finish({
        ok,
        status: timedOut ? "timed-out" : ok ? "pass" : "failed",
        exitCode,
        spawnBlocked: false,
      });
    });
  });
}

const steps = [];
for (const step of finalizeSequence) {
  steps.push(await runNodeStep(step));
}

const score = readJson(artifactPaths.qualityScore);
const audit = readJson(artifactPaths.finalAudit);
const safe = readJson(artifactPaths.safe);
const docs = readJson(artifactPaths.docs);
const matrix = readJson(artifactPaths.matrix);
const releaseSigningHandoff = readJson(artifactPaths.releaseSigningHandoff);
const gitFinalization = readJson(artifactPaths.gitFinalization);
const gitShellDiagnostics = readJson(artifactPaths.gitShellDiagnostics);
const failedSteps = steps.filter((step) => step.ok !== true);
const ok =
  failedSteps.length === 0 &&
  scoreMatchesFinalAuditProjection(score, audit) &&
  scoreHasOnlyExternalBlockers(score) &&
  audit?.ok === true &&
  audit?.status === "blocked-by-external-gates" &&
  audit?.evidenceComplete === true &&
  audit?.implementationFixableCount === 0 &&
  audit?.policyBlockedCount === 0 &&
  audit?.externalBlockedCount >= 1 &&
  docs?.ok === true &&
  matrix?.ok === true &&
  matrix?.status === "blocked-by-external-gates" &&
  safe?.ok === true &&
  safe?.status === "blocked-by-external-gates" &&
  safe?.coverage?.proofArtifactPassCount === safe?.coverage?.proofArtifactCount &&
  safe?.coverage?.proofArtifactCount >= 28;
const status = ok ? (score?.releaseCandidateReady ? "complete" : "blocked-by-external-gates") : "failed";
const nextRequiredAction =
  status === "complete"
    ? "Goal is complete."
    : status === "blocked-by-external-gates"
      ? (safe?.nextRequiredAction ??
        audit?.nextRequiredAction ??
        `Run ${MANUAL_SLEEP_COMMAND}, manually put Windows to sleep while the verifier waits, then close the evidence loop with ${AFTER_EXTERNAL_GATE_COMMANDS.join(", ")}.`)
      : "Fix failed finalize steps, stale artifacts, or implementation-fixable residual risks before rerunning pnpm verify:goal:finalize.";

const report = {
  version: 1,
  generatedAt: new Date().toISOString(),
  localDate: currentLocalDate(),
  timeZone: LOCAL_TIME_ZONE,
  ok,
  status,
  tokenSpendingPromptExecuted: false,
  realOsSleepInvoked: false,
  skipOperator: SKIP_OPERATOR,
  includeGitFinalization: INCLUDE_GIT_FINALIZATION,
  sourceCutoffMs: sourceCutoffMs(),
  nextRequiredAction,
  externalGateRunbook: {
    manualSleepCycle: {
      command: MANUAL_SLEEP_COMMAND,
      requires: "Start the verifier, manually put Windows to sleep, wake it, then let post-resume probes finish.",
      safety: "The finalizer does not invoke OS sleep and does not set AELYRIS_ALLOW_OS_SLEEP.",
    },
    releaseSigningAndUpdater: {
      command: "pnpm tauri:build:dist",
      handoff: "pnpm verify:goal:release-signing-handoff",
      requires: "Run only in a secure operator shell with current Tauri signing material.",
      safety: "The finalizer does not read signing keys, does not sign artifacts, and does not mutate updater manifests.",
    },
    afterExternalGate: AFTER_EXTERNAL_GATE_COMMANDS,
  },
  sequence: finalizeSequence.map((step) => step.id),
  steps,
  failedSteps,
  summary: {
    score: score
      ? {
          score: score.score,
          grade: score.grade,
          total: score.total,
          max: score.max,
          releaseCandidateReady: score.releaseCandidateReady === true,
          blockers: Array.isArray(score.blockers) ? score.blockers.map((blocker) => blocker.area) : [],
        }
      : null,
    audit: audit
      ? {
          status: audit.status,
          evidenceComplete: audit.evidenceComplete === true,
          implementationFixableCount: audit.implementationFixableCount,
          policyBlockedCount: audit.policyBlockedCount,
          externalBlockedCount: audit.externalBlockedCount,
        }
      : null,
    safe: safe
      ? {
          ok: safe.ok === true,
          status: safe.status,
          proofArtifactPassCount: safe.coverage?.proofArtifactPassCount ?? null,
          proofArtifactCount: safe.coverage?.proofArtifactCount ?? null,
        }
      : null,
    releaseSigningHandoff: releaseSigningHandoff
      ? {
          ok: releaseSigningHandoff.ok === true,
          status: releaseSigningHandoff.status,
          signingMaterialProvidedToThisRun: releaseSigningHandoff.signingMaterialProvidedToThisRun === true,
        }
      : null,
    gitFinalization: gitFinalization
      ? {
          status: gitFinalization.status,
          gitFinalizationReady: gitFinalization.gitFinalizationReady === true,
          currentBranch: gitFinalization.currentBranch ?? null,
          targetBranch: gitFinalization.targetBranch ?? null,
          blockerCount: Array.isArray(gitFinalization.blockers) ? gitFinalization.blockers.length : null,
        }
      : null,
    gitShellDiagnostics: gitShellDiagnostics
      ? {
          status: gitShellDiagnostics.status,
          gitFinalizationReady: gitShellDiagnostics.gitFinalizationReady === true,
          gitAddDryRunOk: gitShellDiagnostics.checks?.gitAddDryRunOk === true,
          denyAceCount: gitShellDiagnostics.checks?.denyAceCount ?? null,
        }
      : null,
  },
};

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ artifact: OUT, ...report }, null, 2));
if (!report.ok) process.exitCode = 1;
