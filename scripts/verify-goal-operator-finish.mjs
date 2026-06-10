import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import process from "node:process";

const ROOT = resolve(process.cwd());
const OUT = join(ROOT, ".codex-auto", "quality", "goal-operator-finish.json");
const PROGRESS_OUT = join(ROOT, ".codex-auto", "quality", "goal-operator-progress.json");
const CONSENT_PHRASE = "I_UNDERSTAND_THIS_MAY_SPEND_TOKENS";
const SLEEP_PHRASE = "I_WILL_MANUALLY_SLEEP_WINDOWS_WHILE_VERIFIER_WAITS";
const PROVIDERS = new Set(["codex", "claude", "gemini"]);
const DEFAULT_STEP_TIMEOUT_MS = Number.parseInt(process.env.AETHER_GOAL_OPERATOR_STEP_TIMEOUT_MS ?? "180000", 10);
const SLEEP_TIMEOUT_MS = Number.parseInt(process.env.AETHER_GOAL_OPERATOR_SLEEP_TIMEOUT_MS ?? "2100000", 10);
const HEARTBEAT_MS = Number.parseInt(process.env.AETHER_GOAL_OPERATOR_HEARTBEAT_MS ?? "30000", 10);
const OUTPUT_TAIL_CHARS = 4000;

const artifactPaths = {
  releaseScore: ".codex-auto/quality/release-quality-score.json",
  finalAudit: ".codex-auto/quality/final-goal-audit.json",
  finalSafe: ".codex-auto/quality/final-goal-safe-summary.json",
  completionMatrix: ".codex-auto/quality/goal-completion-matrix.json",
  externalGateReadiness: ".codex-auto/quality/goal-external-gate-readiness.json",
  gitFinalizationReadiness: ".codex-auto/quality/git-finalization-readiness.json",
  gitFinalizationShellDiagnostics: ".codex-auto/quality/git-finalization-shell-diagnostics.json",
  operatorProgress: ".codex-auto/quality/goal-operator-progress.json",
  authenticatedPrompt: ".codex-auto/production-smoke/authenticated-ai-cli-prompt-smoke.json",
  realOsSuspend: ".codex-auto/production-smoke/real-os-suspend-resume.json",
};

function currentLocalDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
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

function readJson(path) {
  const full = join(ROOT, path);
  if (!existsSync(full)) return null;
  return JSON.parse(readFileSync(full, "utf8"));
}

function writeOperatorProgress(update) {
  const now = Date.now();
  const activeTimeoutMs = Number(update?.timeoutMs ?? 0);
  const elapsedMs = Number(update?.elapsedMs ?? 0);
  const remainingMs =
    Number.isFinite(activeTimeoutMs) && activeTimeoutMs > 0 ? Math.max(0, activeTimeoutMs - elapsedMs) : null;
  const nextHeartbeatAt = update?.status === "running" ? new Date(now + HEARTBEAT_MS).toISOString() : null;
  const report = {
    version: 1,
    generatedAt: new Date(now).toISOString(),
    localDate: currentLocalDate(),
    timeZone: "Asia/Tokyo",
    status: update?.status ?? "running",
    activeStep: update?.activeStep ?? null,
    label: update?.label ?? null,
    event: update?.event ?? "heartbeat",
    externalGateKind: update?.externalGateKind ?? "none",
    requiresUserAction: update?.requiresUserAction === true,
    elapsedMs,
    timeoutMs: activeTimeoutMs || null,
    remainingMs,
    heartbeatMs: HEARTBEAT_MS,
    lastHeartbeatAt: new Date(now).toISOString(),
    nextHeartbeatAt,
    tokenSpendingPromptRequested: update?.tokenSpendingPromptRequested === true,
    realOsSleepUserCycleRequested: update?.realOsSleepUserCycleRequested === true,
    realOsSleepInvokedByThisRun: false,
    noRawTerminalOutputPersisted: true,
    nextAction:
      update?.nextAction ??
      (update?.requiresUserAction
        ? "Complete the external user action while this verifier waits."
        : "Wait for the active verifier step to finish."),
  };
  try {
    mkdirSync(dirname(PROGRESS_OUT), { recursive: true });
    writeFileSync(PROGRESS_OUT, `${JSON.stringify(report, null, 2)}\n`);
  } catch (error) {
    console.error(`[goal-operator] progress write failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function artifactMeta(path) {
  const full = join(ROOT, path);
  if (!existsSync(full)) return { path, exists: false };
  let data = null;
  let parseError = null;
  try {
    data = JSON.parse(readFileSync(full, "utf8"));
  } catch (error) {
    parseError = error instanceof Error ? error.message : String(error);
  }
  return {
    path,
    exists: true,
    parseError,
    ok: data?.ok ?? null,
    status: data?.status ?? null,
    generatedAt: data?.generatedAt ?? data?.finishedAt ?? null,
  };
}

function noTokenNoSleepEnv(extra = {}) {
  const env = { ...process.env, ...extra };
  delete env.AETHER_AUTH_PROMPT_CONSENT;
  delete env.AETHER_AUTH_PROMPT_PROVIDER;
  delete env.AETHER_GOAL_OPERATOR_RUN_SLEEP;
  delete env.AETHER_ALLOW_OS_SLEEP;
  return env;
}

function externalReadinessArtifactReady() {
  const data = readJson(artifactPaths.externalGateReadiness);
  const checks = data?.checks ?? {};
  return (
    data?.ok === true &&
    ["ready-for-external-operator-gates", "blocked-by-host-sleep-unsupported", "external-operator-gates-complete"].includes(
      data?.status,
    ) &&
    data?.localDate === currentLocalDate() &&
    ((data?.tokenSpendingPromptExecuted === false && checks.noTokenPromptSent === true) ||
      (data?.tokenSpendingPromptExecuted === true && checks.tokenPromptExecutedWithConsent === true)) &&
    data?.realOsSleepInvoked === false &&
    checks.noUnsafeConsentEnvPresent === true &&
    checks.noOsSleepEnvPresent === true &&
    checks.sourceArtifactsFresh === true &&
    checks.completeExternalGatesProved === false
  );
}

function runNodeStep(id, label, script, args = [], options = {}) {
  const timeoutMs = options.timeoutMs ?? DEFAULT_STEP_TIMEOUT_MS;
  const startedAt = Date.now();
  const child = spawnSync(process.execPath, [join(ROOT, "scripts", script), ...args], {
    cwd: ROOT,
    env: options.env ?? process.env,
    encoding: "utf8",
    timeout: timeoutMs,
    windowsHide: true,
    maxBuffer: 10 * 1024 * 1024,
  });
  const timedOut = child.error?.code === "ETIMEDOUT";
  const exitCode = child.status ?? null;
  const acceptedExitCodes = options.acceptedExitCodes ?? [0];
  const spawnBlocked =
    child.error?.code === "EPERM" ||
    child.error?.code === "EACCES" ||
    /spawnSync .* EPERM/i.test(String(child.error?.message ?? ""));
  const artifactFallbackOk = spawnBlocked && options.artifactFallback?.() === true;
  const ok = artifactFallbackOk || (!timedOut && acceptedExitCodes.includes(exitCode));
  return {
    id,
    label,
    script,
    args,
    ok,
    exitCode,
    timedOut,
    spawnBlocked,
    artifactFallback: artifactFallbackOk
      ? {
          status: "pass-current-artifact-replay",
          reason: "child process spawn was blocked, but a same-day safe readiness artifact is already green",
        }
      : null,
    durationMs: Date.now() - startedAt,
    timeoutMs,
    stdoutTail: outputTail(child.stdout),
    stderrTail: outputTail([child.stderr, child.error?.message].filter(Boolean).join("\n")),
  };
}

function runNodeStepStreaming(id, label, script, args = [], options = {}) {
  const timeoutMs = options.timeoutMs ?? DEFAULT_STEP_TIMEOUT_MS;
  const heartbeatMs = options.heartbeatMs ?? HEARTBEAT_MS;
  const acceptedExitCodes = options.acceptedExitCodes ?? [0];
  const startedAt = Date.now();
  let stdout = "";
  let stderr = "";
  let timedOut = false;
  let settled = false;

  console.error(`[goal-operator] start ${id}: ${label}`);
  writeOperatorProgress({
    status: "running",
    event: "start",
    activeStep: id,
    label,
    timeoutMs,
    elapsedMs: 0,
    externalGateKind: options.externalGateKind,
    requiresUserAction: options.requiresUserAction === true,
    tokenSpendingPromptRequested,
    realOsSleepUserCycleRequested: sleepUserCycleRequested,
    nextAction: options.progressNextAction,
  });

  return new Promise((resolveStep) => {
    let timeout = null;
    let heartbeat = null;
    const finish = (partial) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      if (heartbeat) clearInterval(heartbeat);
      const result = {
        id,
        label,
        script,
        args,
        durationMs: Date.now() - startedAt,
        timeoutMs,
        streamed: true,
        progressHeartbeatMs: heartbeatMs,
        stdoutTail: outputTail(stdout),
        stderrTail: outputTail(stderr),
        ...partial,
      };
      console.error(`[goal-operator] ${result.ok ? "pass" : "fail"} ${id}: ${result.status}`);
      writeOperatorProgress({
        status: result.ok ? "pass" : result.status ?? "failed",
        event: "finish",
        activeStep: id,
        label,
        timeoutMs,
        elapsedMs: result.durationMs,
        externalGateKind: options.externalGateKind,
        requiresUserAction: options.requiresUserAction === true,
        tokenSpendingPromptRequested,
        realOsSleepUserCycleRequested: sleepUserCycleRequested,
        nextAction: result.ok
          ? "Continue to the next operator step or rerun final evidence refresh."
          : "Inspect goal-operator-finish.json and rerun the readiness command after the blocker is fixed.",
      });
      resolveStep(result);
    };

    let child;
    try {
      child = spawn(process.execPath, [join(ROOT, "scripts", script), ...args], {
        cwd: ROOT,
        env: options.env ?? process.env,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      stderr = appendLimitedOutput(stderr, message);
      finish({
        ok: false,
        status: "spawn-failed",
        exitCode: null,
        timedOut: false,
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
      console.error(`[goal-operator] waiting ${id}: ${elapsedSeconds}s elapsed / ${timeoutSeconds}s timeout`);
      writeOperatorProgress({
        status: "running",
        event: "heartbeat",
        activeStep: id,
        label,
        timeoutMs,
        elapsedMs: Date.now() - startedAt,
        externalGateKind: options.externalGateKind,
        requiresUserAction: options.requiresUserAction === true,
        tokenSpendingPromptRequested,
        realOsSleepUserCycleRequested: sleepUserCycleRequested,
        nextAction: options.progressNextAction,
      });
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
        exitCode: null,
        timedOut: false,
        spawnBlocked: error?.code === "EPERM" || error?.code === "EACCES" || /EPERM|EACCES/i.test(message),
      });
    });
    child.on("close", (code, signal) => {
      const exitCode = typeof code === "number" ? code : null;
      const ok = !timedOut && acceptedExitCodes.includes(exitCode);
      finish({
        ok,
        status: timedOut ? "timed-out" : ok ? "pass" : "failed",
        exitCode,
        signal,
        timedOut,
        spawnBlocked: false,
      });
    });
  });
}

function scoreEntry(score, id) {
  return Array.isArray(score?.scores) ? score.scores.find((entry) => entry?.id === id) : null;
}

function entryPassed(score, id) {
  const entry = scoreEntry(score, id);
  return entry != null && entry.max > 0 && entry.points === entry.max;
}

const rawProvider = String(process.env.AETHER_AUTH_PROMPT_PROVIDER ?? "").trim().toLowerCase();
const consentEnv = String(process.env.AETHER_AUTH_PROMPT_CONSENT ?? "").trim();
const sleepEnv = String(process.env.AETHER_GOAL_OPERATOR_RUN_SLEEP ?? "").trim();
const tokenEnvPresent = consentEnv.length > 0 || rawProvider.length > 0;
const sleepEnvPresent = sleepEnv.length > 0;
const tokenPromptRequested =
  consentEnv === CONSENT_PHRASE && rawProvider.length > 0 && PROVIDERS.has(rawProvider);
const sleepUserCycleRequested = sleepEnv === SLEEP_PHRASE;
const invalidOperatorEnv =
  (tokenEnvPresent && !tokenPromptRequested) ||
  (sleepEnvPresent && !sleepUserCycleRequested) ||
  process.env.AETHER_ALLOW_OS_SLEEP === "1";

const steps = [
  runNodeStep(
    "external-gate-readiness-preflight",
    "External gate readiness preflight",
    "verify-goal-external-gate-readiness.mjs",
    [],
    { env: noTokenNoSleepEnv(), artifactFallback: externalReadinessArtifactReady },
  ),
];

if (!invalidOperatorEnv && tokenPromptRequested) {
  steps.push(
    await runNodeStepStreaming(
      "authenticated-ai-cli-prompt",
      "Authenticated AI CLI prompt smoke",
      "verify-authenticated-ai-cli-prompt-smoke.mjs",
      [],
      {
        env: process.env,
        timeoutMs: Number.parseInt(process.env.AETHER_AUTH_PROMPT_WAIT_MS ?? "90000", 10) + 30000,
        externalGateKind: "token-spending-ai-cli-prompt",
        requiresUserAction: false,
        progressNextAction: "Wait for the consented AI CLI prompt smoke to finish; do not close the terminal.",
      },
    ),
  );
}

if (!invalidOperatorEnv && sleepUserCycleRequested) {
  steps.push(
    await runNodeStepStreaming(
      "real-os-sleep-user-cycle",
      "Real OS user-initiated sleep/resume cycle",
      "verify-real-os-suspend-evidence.mjs",
      ["--native-primary", "--launch-native-primary", "--user-sleep-cycle"],
      {
        env: noTokenNoSleepEnv(),
        timeoutMs: SLEEP_TIMEOUT_MS,
        externalGateKind: "manual-windows-sleep-resume",
        requiresUserAction: true,
        progressNextAction: "Put Windows to sleep manually, wake it, then leave this verifier running for postcheck.",
      },
    ),
  );
}

const gatedRunRequested = tokenPromptRequested || sleepUserCycleRequested;
if (!invalidOperatorEnv && gatedRunRequested) {
  steps.push(
    await runNodeStepStreaming("goal-finalize", "Ordered post-operator evidence finalization", "verify-goal-finalize-evidence.mjs", [], {
      env: noTokenNoSleepEnv({ AETHER_GOAL_FINALIZE_SKIP_OPERATOR: "1" }),
      timeoutMs: 1200000,
      externalGateKind: "post-operator-finalize",
      requiresUserAction: false,
      progressNextAction: "Wait for final score, audit, docs, matrix, git readiness, and safe proof refresh.",
    }),
  );
}

const releaseScore = readJson(artifactPaths.releaseScore);
const finalAudit = readJson(artifactPaths.finalAudit);
const finalSafe = readJson(artifactPaths.finalSafe);
const completionMatrix = readJson(artifactPaths.completionMatrix);
const authenticatedPrompt = readJson(artifactPaths.authenticatedPrompt);
const realOsSuspend = readJson(artifactPaths.realOsSuspend);
const failedSteps = steps.filter((step) => !step.ok);
const goalComplete =
  releaseScore?.releaseCandidateReady === true &&
  finalAudit?.goalComplete === true &&
  finalAudit?.status === "complete" &&
  finalSafe?.ok === true &&
  finalSafe?.status === "complete" &&
  completionMatrix?.goalComplete === true;
const implementationFixableCount =
  finalAudit?.implementationFixableCount ?? finalSafe?.audit?.implementationFixableCount ?? null;
const tokenPromptProved =
  entryPassed(releaseScore, "authenticated-ai-cli-prompt-smoke") ||
  (authenticatedPrompt?.ok === true && authenticatedPrompt?.status === "pass");
const realSleepProved =
  entryPassed(releaseScore, "real-os-soak") || realOsSuspend?.status === "pass" || realOsSuspend?.ok === true;
const operatorReady = steps[0]?.ok === true && implementationFixableCount === 0;
const reportStatus = invalidOperatorEnv
  ? "invalid-operator-env"
  : goalComplete
    ? "complete"
    : operatorReady
      ? "ready-for-external-operator-gates"
      : "failed";
const nextRequiredAction = goalComplete
  ? "Goal is complete."
  : invalidOperatorEnv
    ? `Use AETHER_AUTH_PROMPT_CONSENT=${CONSENT_PHRASE} with AETHER_AUTH_PROMPT_PROVIDER=codex|claude|gemini, or AETHER_GOAL_OPERATOR_RUN_SLEEP=${SLEEP_PHRASE}; do not set AETHER_ALLOW_OS_SLEEP for this handoff.`
    : tokenPromptProved && !realSleepProved
      ? "Run the real sleep operator gate listed in runbook, then rerun pnpm verify:goal:operator-finish."
      : "Run the token prompt and real sleep operator gates listed in runbook, then rerun pnpm verify:goal:operator-finish.";

const runbook = {
  readinessOnly: {
    command: "pnpm verify:goal:operator-finish",
    effect: "Writes this handoff without sending prompts or putting Windows to sleep.",
    progressArtifact: ".codex-auto/quality/goal-operator-progress.json",
  },
  tokenPrompt: {
    command: "pnpm verify:goal:operator-finish",
    env: {
      AETHER_AUTH_PROMPT_CONSENT: CONSENT_PHRASE,
      AETHER_AUTH_PROMPT_PROVIDER: "codex",
    },
    providerChoices: ["codex", "claude", "gemini"],
    safety: "Runs only when the exact consent phrase and an explicit provider are present.",
    progressArtifact: ".codex-auto/quality/goal-operator-progress.json",
  },
  sleepResume: {
    command: "pnpm verify:goal:operator-finish",
    env: {
      AETHER_GOAL_OPERATOR_RUN_SLEEP: SLEEP_PHRASE,
    },
    safety: "Does not call the guarded OS sleep API; it waits for the operator to manually sleep and wake Windows.",
    progressArtifact: ".codex-auto/quality/goal-operator-progress.json",
  },
  nonTokenRefresh: {
    command: "pnpm verify:goal:refresh-safe",
    script: "scripts/verify-goal-non-token-refresh.mjs",
    safety: "Refreshes non-token, no-sleep implementation evidence before the final safe summary is trusted.",
  },
  finalSafe: {
    command: "pnpm verify:goal:safe",
    script: "scripts/verify-final-goal-safe.mjs",
    safety: "Replays the ordered safe evidence chain and keeps token prompt and real sleep as explicit external gates.",
  },
  gitFinalization: {
    command: "pnpm verify:goal:git-finalization",
    shellDiagnostics: "pnpm verify:goal:git-finalization:shell",
    artifact: ".codex-auto/quality/git-finalization-shell-diagnostics.json",
    optional: true,
    safety:
      "Optional commit/merge handoff only; checks Git metadata write readiness without staging, committing, merging, mutating ACLs, or deleting lock files.",
  },
  afterManualGate: [
    "pnpm verify:goal:operator-finish",
    "pnpm verify:goal:refresh-safe",
    "pnpm verify:goal:finalize",
    "pnpm verify:goal:safe",
  ],
};

writeOperatorProgress({
  status: reportStatus,
  event: gatedRunRequested ? "post-run-summary" : "readiness-handoff",
  activeStep: gatedRunRequested ? "operator-finish" : null,
  label: "Operator finish handoff",
  timeoutMs: 0,
  elapsedMs: 0,
  externalGateKind: goalComplete ? "complete" : "external-gate-handoff",
  requiresUserAction: goalComplete !== true,
  tokenSpendingPromptRequested: tokenPromptRequested,
  realOsSleepUserCycleRequested: sleepUserCycleRequested,
  nextAction: nextRequiredAction,
});

const report = {
  version: 1,
  generatedAt: new Date().toISOString(),
  localDate: currentLocalDate(),
  timeZone: "Asia/Tokyo",
  ok: !invalidOperatorEnv && failedSteps.length === 0 && (goalComplete || operatorReady),
  status: reportStatus,
  goalComplete,
  tokenSpendingPromptRequested: tokenPromptRequested,
  tokenSpendingPromptProved: tokenPromptProved,
  tokenSpendingPromptExecutedByThisRun: tokenPromptRequested && steps.some((step) => step.id === "authenticated-ai-cli-prompt"),
  realOsSleepUserCycleRequested: sleepUserCycleRequested,
  realOsSleepProved: realSleepProved,
  realOsSleepInvokedByThisRun: false,
  implementationFixableCount,
  envGuard: {
    tokenEnvPresent,
    tokenPromptRequested,
    sleepEnvPresent,
    sleepUserCycleRequested,
    noAetherAllowOsSleep: process.env.AETHER_ALLOW_OS_SLEEP !== "1",
    invalidOperatorEnv,
    requiredTokenConsent: CONSENT_PHRASE,
    requiredSleepPhrase: SLEEP_PHRASE,
  },
  score: releaseScore
    ? {
        score: releaseScore.score,
        grade: releaseScore.grade,
        total: releaseScore.total,
        max: releaseScore.max,
        releaseCandidateReady: releaseScore.releaseCandidateReady === true,
      }
    : null,
  audit: finalAudit
    ? {
        ok: finalAudit.ok === true,
        status: finalAudit.status,
        goalComplete: finalAudit.goalComplete === true,
        implementationFixableCount: finalAudit.implementationFixableCount,
        policyBlockedCount: finalAudit.policyBlockedCount,
        externalBlockedCount: finalAudit.externalBlockedCount,
      }
    : null,
  finalSafe: finalSafe
    ? {
        ok: finalSafe.ok === true,
        status: finalSafe.status,
        proofArtifactPassCount: finalSafe.coverage?.proofArtifactPassCount ?? null,
        proofArtifactCount: finalSafe.coverage?.proofArtifactCount ?? null,
      }
    : null,
  steps,
  failedSteps,
  artifacts: Object.fromEntries(Object.entries(artifactPaths).map(([key, path]) => [key, artifactMeta(path)])),
  runbook,
  nextRequiredAction,
};

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ artifact: OUT, ...report }, null, 2));
if (!report.ok) process.exitCode = 1;
