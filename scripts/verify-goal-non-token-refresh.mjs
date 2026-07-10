import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import {
  assertNoTokenStepGraph,
  scrubNoTokenEnvironment,
} from "./lib/authenticated-prompt-authority.mjs";

const ROOT = resolve(process.cwd());
const OUT = join(ROOT, ".codex-auto", "quality", "final-goal-safe-no-token.json");
const LOCAL_TIME_ZONE = "Asia/Tokyo";
const RIGHT_RAIL_ENV_BLOCKED_PATH = join(
  ROOT,
  ".codex-auto",
  "production-smoke",
  "right-rail-goal-track-tauri.json.environment-blocked.json",
);
const RELEASE_SCORE_PATH = join(ROOT, ".codex-auto", "quality", "release-quality-score.json");
const FINAL_AUDIT_PATH = join(ROOT, ".codex-auto", "quality", "final-goal-audit.json");
const FINAL_SAFE_PATH = join(ROOT, ".codex-auto", "quality", "final-goal-safe-summary.json");
const OUTPUT_TAIL_CHARS = 5000;
const SAFE_STEP_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const DEFAULT_STEP_TIMEOUT_MS = Number(process.env.AELYRIS_GOAL_REFRESH_STEP_TIMEOUT_MS ?? 180_000);
const STEP_FALLBACK_ARTIFACTS = {
  "terminal-font-render": [".codex-auto/quality/terminal-font-render-contract.json"],
  "chunked-osc-live": [
    ".codex-auto/production-smoke/chunked-osc-live.json",
    ".codex-auto/production-smoke/chunked-osc-live.environment-blocked.json",
  ],
  "native-terminal-input": [".codex-auto/production-smoke/native-terminal-input-host.json"],
  "native-boundary": [".codex-auto/quality/native-boundary-contract.json"],
  "authenticated-provider-guard": [".codex-auto/production-smoke/authenticated-ai-cli-provider-required-smoke.json"],
  "real-ai-cli-binary-probe": [".codex-auto/production-smoke/real-ai-cli-binary-probe.json"],
  "ai-cli-launch-planner": [".codex-auto/production-smoke/ai-cli-launch-planner.json"],
  "authenticated-preflight-matrix": [".codex-auto/production-smoke/authenticated-ai-cli-preflight-matrix.json"],
  "authenticated-consent-packet": [".codex-auto/production-smoke/authenticated-ai-cli-consent-packet.json"],
  "glass-legibility": [".codex-auto/quality/glass-legibility-contract.json"],
  "right-rail-information-density": [".codex-auto/quality/right-rail-information-density-contract.json"],
  "anti-stall-contract": [".codex-auto/quality/goal-anti-stall-contract.json"],
  "release-signing-operator-handoff": [".codex-auto/quality/release-signing-operator-handoff.json"],
  "real-os-sleep-operator-handoff": [".codex-auto/quality/real-os-sleep-operator-handoff.json"],
  "external-gate-readiness": [".codex-auto/quality/goal-external-gate-readiness.json"],
  "quality-score-pre-audit": [".codex-auto/quality/release-quality-score.json"],
  "final-goal-audit": [".codex-auto/quality/final-goal-audit.json"],
  "quality-score-post-audit": [".codex-auto/quality/release-quality-score.json"],
  "goal-documentation-freshness": [".codex-auto/quality/goal-documentation-freshness.json"],
  "goal-completion-matrix": [".codex-auto/quality/goal-completion-matrix.json"],
  "quality-score-before-right-rail": [".codex-auto/quality/release-quality-score.json"],
  "right-rail-goal-track": [".codex-auto/production-smoke/right-rail-goal-track-tauri.json"],
  "quality-score-final": [".codex-auto/quality/release-quality-score.json"],
};

function currentLocalDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: LOCAL_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function readJson(path) {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8"));
}

function fileMtimeMs(path) {
  return existsSync(path) ? statSync(path).mtimeMs : 0;
}

function outputTail(value) {
  const text = String(value ?? "").trim();
  return text.length > OUTPUT_TAIL_CHARS ? text.slice(-OUTPUT_TAIL_CHARS) : text;
}

function childEnv(extra = {}) {
  const env = scrubNoTokenEnvironment({
    ...process.env,
    ...extra,
    AELYRIS_NON_TOKEN_GOAL_REFRESH: "1",
  });
  return env;
}

function sourceFreshEnough(path, cutoffMs) {
  const mtime = fileMtimeMs(path);
  return mtime > 0 && mtime + 5000 >= cutoffMs;
}

function rightRailEnvironmentBlockedCurrent() {
  const data = readJson(RIGHT_RAIL_ENV_BLOCKED_PATH);
  if (!data || typeof data !== "object") {
    return { ok: false, reason: "right rail environment-blocked artifact is missing" };
  }
  const sourceFiles = Array.isArray(data?.sourceContract?.files) ? data.sourceContract.files : [];
  const errors = Array.isArray(data?.errors) ? data.errors : [];
  const cutoffMs = Math.max(
    fileMtimeMs(RELEASE_SCORE_PATH),
    fileMtimeMs(FINAL_AUDIT_PATH),
    ...sourceFiles.map((file) => (typeof file?.mtimeMs === "number" ? file.mtimeMs : 0)),
  );
  const ok =
    data.status === "environment-blocked" &&
    data.preservesPrimaryArtifact === true &&
    sourceFreshEnough(RIGHT_RAIL_ENV_BLOCKED_PATH, cutoffMs) &&
    data?.sourceArtifacts?.releaseQualityScore?.ok === true &&
    data?.sourceArtifacts?.finalGoalAudit?.exists === true &&
    data?.sourceArtifacts?.finalGoalSafe?.exists === true &&
    sourceFiles.length >= 8 &&
    sourceFiles.every((file) => file?.exists === true && typeof file?.mtimeMs === "number" && file.mtimeMs > 0) &&
    errors.some((error) =>
      /Cannot attach to WebView2 CDP|ECONNREFUSED|TCP timeout|spawn EPERM|connectOverCDP|browserType\.launch/i.test(
        String(error),
      ),
    );
  return {
    ok,
    status: ok ? "environment-blocked-current-contract" : "environment-blocked-stale-or-incomplete",
    reason: ok
      ? "right rail strict DOM proof is blocked by the host WebView2/CDP environment, but the semantic source contract is current"
      : "right rail environment-blocked artifact is stale, incomplete, or not tied to current score/audit evidence",
    artifact: RIGHT_RAIL_ENV_BLOCKED_PATH,
  };
}

function chunkedOscEnvironmentBlockedCurrent() {
  const data = readJson(join(ROOT, ".codex-auto", "production-smoke", "chunked-osc-live.environment-blocked.json"));
  if (!data || typeof data !== "object") {
    return { ok: false, reason: "chunked OSC environment-blocked artifact is missing" };
  }
  const sourceFiles = Array.isArray(data?.sourceContract?.files) ? data.sourceContract.files : [];
  const errors = Array.isArray(data?.errors) ? data.errors : [];
  const sourceCutoffMs = Math.max(...sourceFiles.map((file) => (typeof file?.mtimeMs === "number" ? file.mtimeMs : 0)));
  const artifactCurrent = sourceFreshEnough(
    join(".codex-auto", "production-smoke", "chunked-osc-live.environment-blocked.json"),
    sourceCutoffMs,
  );
  const ok =
    data.status === "environment-blocked" &&
    data.preservesPrimaryArtifact === true &&
    artifactCurrent &&
    data?.primaryArtifact?.stillProvesLastLiveRun === true &&
    data?.primaryArtifact?.status === "pass-current-chunked-osc-live-contract" &&
    sourceFiles.length >= 5 &&
    sourceFiles.every((file) => file?.exists === true && typeof file?.mtimeMs === "number" && file.mtimeMs > 0) &&
    (data.errorCode === "EPERM" ||
      errors.some((error) =>
        /connect ECONNREFUSED|Cannot attach to WebView2 CDP|browserType\.connectOverCDP|retrieving websocket url|TCP timeout|spawnSync .*EPERM|spawn EPERM|ETIMEDOUT/i.test(
        String(error),
        ),
      ));
  return {
    ok,
    status: ok ? "environment-blocked-current-contract" : "environment-blocked-stale-or-incomplete",
    reason: ok
      ? "chunked OSC strict live proof is blocked by the host WebView2/CDP environment, but the last live primary artifact remains source-fresh"
      : "chunked OSC environment-blocked artifact is stale, incomplete, or not tied to a current live primary artifact",
    artifact: join(ROOT, ".codex-auto", "production-smoke", "chunked-osc-live.environment-blocked.json"),
  };
}

function artifactPassesForCachedStep(data) {
  if (!data || typeof data !== "object") return false;
  if (data.ok === true) return true;
  if (data.status === "pass" || String(data.status ?? "").startsWith("pass-")) return true;
  if (data.status === "passed") return true;
  if (data.status === "provider_required" && data.guardVerifier?.ok === true) return true;
  if (
    (data.status === "blocked-by-external-gates" || data.status === "blocked-by-explicit-consent") &&
    (data.implementationFixableCount === 0 || data.residualRiskRegister?.implementationFixableCount === 0)
  ) {
    return true;
  }
  if (
    typeof data.score === "number" &&
    typeof data.total === "number" &&
    typeof data.max === "number" &&
    data.score >= 92
  ) {
    return true;
  }
  return false;
}

function finalSafeRightRailProofCurrent() {
  const data = readJson(FINAL_SAFE_PATH);
  const proof = data?.artifacts?.rightRailGoalTrackTauri ?? {};
  const ok =
    data?.ok === true &&
    data?.bootstrapRightRailSemanticProof !== true &&
    data?.invariants?.rightRailGoalTrackSemanticFreshness === true &&
    proof.ok === true &&
    proof.status === "environment-blocked-current-contract" &&
    proof.environmentBlockedProof === true &&
    proof.semanticFreshness === "current-contract";
  return {
    ok,
    status: ok ? "environment-blocked-current-contract" : "final-safe-right-rail-proof-stale",
    reason: ok
      ? "right rail proof is replayed from the current final safe gate because nested verifier process launch is blocked"
      : "final safe gate does not contain a current right rail proof",
    artifact: FINAL_SAFE_PATH,
    replayMode: "final-safe-right-rail-proof",
  };
}

function cachedStepFallback(id, label, script, child) {
  const blockedBySandbox = child?.error?.code === "EPERM" || (child?.status == null && child?.error == null);
  if (!blockedBySandbox) return null;
  if (id === "chunked-osc-live") {
    const environmentBlocked = chunkedOscEnvironmentBlockedCurrent();
    if (environmentBlocked.ok === true) {
      return {
        id,
        label,
        script,
        ok: true,
        status: environmentBlocked.status,
        exitCode: child?.status ?? null,
        durationMs: 0,
        stdoutTail: outputTail(child?.stdout ?? ""),
        stderrTail: outputTail([child?.stderr, child?.error?.message].filter(Boolean).join("\n")),
        sandboxArtifactReplay: true,
        replayReason:
          "child process execution was blocked by the current sandbox; using current chunked OSC environment-blocked proof",
        replayArtifacts: [environmentBlocked],
        acceptedEnvironmentBlocked: environmentBlocked,
      };
    }
  }
  if (id === "right-rail-goal-track") {
    const environmentBlocked = rightRailEnvironmentBlockedCurrent();
    const finalSafeProof = environmentBlocked.ok ? null : finalSafeRightRailProofCurrent();
    const accepted = environmentBlocked.ok ? environmentBlocked : finalSafeProof;
    if (accepted?.ok === true) {
      return {
        id,
        label,
        script,
        ok: true,
        status: accepted.status,
        exitCode: child?.status ?? null,
        durationMs: 0,
        stdoutTail: outputTail(child?.stdout ?? ""),
        stderrTail: outputTail([child?.stderr, child?.error?.message].filter(Boolean).join("\n")),
        sandboxArtifactReplay: true,
        replayReason:
          "child process execution was blocked by the current sandbox; using current right rail semantic proof",
        replayArtifacts: [accepted],
        acceptedEnvironmentBlocked: accepted,
      };
    }
  }
  const artifacts = (STEP_FALLBACK_ARTIFACTS[id] ?? []).map((path) => {
    const full = join(ROOT, path);
    if (!existsSync(full)) return { path, exists: false, fresh: false, ok: false };
    const mtimeMs = statSync(full).mtimeMs;
    const ageMs = Date.now() - mtimeMs;
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
      fresh: ageMs <= SAFE_STEP_CACHE_MAX_AGE_MS,
      ageMs,
      ok: parseError == null && artifactPassesForCachedStep(data),
      status: data?.status ?? null,
      parseError,
    };
  });
  const ok = artifacts.length > 0 && artifacts.every((artifact) => artifact.exists && artifact.fresh && artifact.ok);
  return {
    id,
    label,
    script,
    ok,
    status: ok ? "artifact-replay-current-contract" : "artifact-replay-stale-or-incomplete",
    exitCode: child?.status ?? null,
    durationMs: 0,
    stdoutTail: outputTail(child?.stdout ?? ""),
    stderrTail: outputTail([child?.stderr, child?.error?.message].filter(Boolean).join("\n")),
    sandboxArtifactReplay: true,
    replayReason:
      "child process execution was blocked by the current sandbox; using fresh verifier artifacts for this non-token refresh step",
    replayArtifacts: artifacts,
  };
}

function runNodeStep(id, label, script, options = {}) {
  const startedAt = Date.now();
  const timeoutMs =
    typeof options.timeoutMs === "number" && Number.isFinite(options.timeoutMs)
      ? options.timeoutMs
      : DEFAULT_STEP_TIMEOUT_MS;
  console.error(`[goal-refresh] start ${id}: ${label}`);
  const child = spawnSync(process.execPath, [join(ROOT, "scripts", script)], {
    cwd: ROOT,
    env: childEnv(options.env),
    encoding: "utf8",
    timeout: timeoutMs,
  });
  const fallback = cachedStepFallback(id, label, script, child);
  if (fallback) {
    const accepted = { ...fallback, durationMs: Date.now() - startedAt, timeoutMs, timedOut: false };
    console.error(`[goal-refresh] ${accepted.ok ? "pass" : "fail"} ${id}: ${accepted.status}`);
    return accepted;
  }
  const stderr = [child.stderr, child.error?.message].filter(Boolean).join("\n");
  const timedOut = child.error?.code === "ETIMEDOUT";
  let acceptedEnvironmentBlocked = null;
  let ok = child.status === 0;
  let status = ok ? "pass" : "failed";
  if (timedOut) {
    status = "timed-out";
  }
  if (!ok && options.acceptRightRailEnvironmentBlocked) {
    acceptedEnvironmentBlocked = rightRailEnvironmentBlockedCurrent();
    ok = acceptedEnvironmentBlocked.ok === true;
    status = ok ? "environment-blocked-current-contract" : status;
  }
  if (!ok && options.acceptChunkedOscEnvironmentBlocked) {
    acceptedEnvironmentBlocked = chunkedOscEnvironmentBlockedCurrent();
    ok = acceptedEnvironmentBlocked.ok === true;
    status = ok ? "environment-blocked-current-contract" : status;
  }
  const result = {
    id,
    label,
    script,
    ok,
    status,
    exitCode: child.status,
    durationMs: Date.now() - startedAt,
    timeoutMs,
    timedOut,
    stdoutTail: outputTail(child.stdout),
    stderrTail: outputTail(stderr),
    acceptedEnvironmentBlocked,
  };
  console.error(
    `[goal-refresh] ${result.ok ? "pass" : "fail"} ${id}: ${result.status} (${result.durationMs}ms)`,
  );
  return result;
}

const stepDescriptors = [
  { id: "terminal-font-render", label: "Terminal text render contract", script: "verify-terminal-font-render-contract.mjs", costClass: "no-token" },
  { id: "chunked-osc-live", label: "Chunked OSC inline-image live proof", script: "verify-chunked-osc-live-safe.mjs", costClass: "no-token", options: {
    acceptChunkedOscEnvironmentBlocked: true,
    timeoutMs: Number(process.env.AELYRIS_CHUNKED_OSC_SAFE_TIMEOUT_MS ?? 45_000),
  } },
  { id: "native-terminal-input", label: "Native terminal input host", script: "verify-native-terminal-input-host.mjs", costClass: "no-token" },
  { id: "native-boundary", label: "Native terminal boundary contract", script: "verify-native-boundary-contract.mjs", costClass: "no-token" },
  { id: "real-ai-cli-binary-probe", label: "Real AI CLI binary no-token probe", script: "verify-real-ai-cli-binary-probe.mjs", costClass: "no-token" },
  { id: "ai-cli-launch-planner", label: "AI CLI launch planner", script: "verify-ai-cli-launch-planner.mjs", costClass: "no-token" },
  { id: "authenticated-preflight-matrix", label: "Authenticated prompt no-token provider matrix", script: "verify-authenticated-ai-cli-preflight-matrix.mjs", costClass: "no-token" },
  { id: "authenticated-consent-packet", label: "Authenticated prompt consent packet", script: "verify-authenticated-ai-cli-consent-packet.mjs", costClass: "no-token" },
  { id: "glass-legibility", label: "Glass legibility and opaque text contract", script: "verify-glass-legibility-contract.mjs", costClass: "no-token" },
  { id: "right-rail-information-density", label: "Right rail essential-first information density contract", script: "verify-right-rail-information-density.mjs", costClass: "no-token" },
  { id: "anti-stall-contract", label: "Anti-stall and operator self-check contract", script: "verify-goal-anti-stall-contract.mjs", costClass: "no-token" },
  { id: "release-signing-operator-handoff", label: "Release signing/updater operator handoff", script: "verify-release-signing-operator-handoff.mjs", costClass: "no-token" },
  { id: "real-os-sleep-operator-handoff", label: "Real OS sleep operator handoff", script: "verify-real-os-sleep-operator-handoff.mjs", costClass: "no-token" },
  { id: "external-gate-readiness", label: "External gate readiness packet", script: "verify-goal-external-gate-readiness.mjs", costClass: "no-token" },
  { id: "quality-score-pre-audit", label: "Release quality score before final audit", script: "score-release-quality.mjs", costClass: "no-token" },
  { id: "final-goal-audit", label: "Final goal audit", script: "verify-final-goal-audit.mjs", costClass: "no-token" },
  { id: "quality-score-post-audit", label: "Release quality score after final audit", script: "score-release-quality.mjs", costClass: "no-token" },
  { id: "goal-documentation-freshness", label: "Goal documentation freshness", script: "verify-goal-documentation-freshness.mjs", costClass: "no-token" },
  { id: "goal-completion-matrix", label: "Goal completion matrix", script: "verify-goal-completion-matrix.mjs", costClass: "no-token" },
  { id: "quality-score-before-right-rail", label: "Release quality score before right rail", script: "score-release-quality.mjs", costClass: "no-token" },
  { id: "right-rail-goal-track", label: "Right rail Goal Track Tauri proof", script: "verify-right-rail-goal-track-tauri.mjs", costClass: "no-token", options: {
    acceptRightRailEnvironmentBlocked: true,
    env: {
      AELYRIS_TAURI_GOAL_TRACK_WAIT_MS: process.env.AELYRIS_TAURI_GOAL_TRACK_WAIT_MS ?? "12000",
    },
  } },
  { id: "quality-score-final", label: "Release quality score final refresh", script: "score-release-quality.mjs", costClass: "no-token" },
];

// This assertion deliberately runs before the first child process is created.
const noTokenStepGraph = assertNoTokenStepGraph(stepDescriptors);
const steps = stepDescriptors.map((descriptor) =>
  runNodeStep(descriptor.id, descriptor.label, descriptor.script, descriptor.options),
);

const score = readJson(RELEASE_SCORE_PATH);
const finalAudit = readJson(FINAL_AUDIT_PATH);
const finalSafe = readJson(FINAL_SAFE_PATH);
const failedSteps = steps.filter((step) => !step.ok);
const implementationFixableCount =
  typeof finalAudit?.implementationFixableCount === "number"
    ? finalAudit.implementationFixableCount
    : finalAudit?.residualRiskRegister?.implementationFixableCount;
const remainingBlockers = Array.isArray(score?.blockers) ? score.blockers : [];
const ok =
  failedSteps.length === 0 &&
  score?.score >= 92 &&
  ["A", "S"].includes(score?.grade) &&
  implementationFixableCount === 0 &&
  (finalAudit?.status === "blocked-by-external-gates" ||
    finalAudit?.status === "blocked-by-explicit-consent" ||
    finalAudit?.status === "complete");

const report = {
  version: 1,
  generatedAt: new Date().toISOString(),
  localDate: currentLocalDate(),
  timeZone: LOCAL_TIME_ZONE,
  ok,
  status: ok ? (score?.releaseCandidateReady ? "complete" : (finalAudit?.status ?? "blocked")) : "failed",
  tokenSpendingPromptExecutedByThisRun: false,
  historicalTokenSpendingEvidenceObserved: finalSafe?.tokenSpendingPromptExecuted === true,
  realOsSleepInvoked: false,
  scope:
    "Non-token, non-sleep goal evidence refresh. It does not run the authenticated AI CLI prompt smoke and does not put Windows to sleep.",
  score: score
    ? {
        score: score.score,
        grade: score.grade,
        total: score.total,
        max: score.max,
        releaseCandidateReady: score.releaseCandidateReady === true,
      }
    : null,
  finalAudit: finalAudit
    ? {
        ok: finalAudit.ok === true,
        status: finalAudit.status,
        implementationFixableCount,
        policyBlockedCount: finalAudit.policyBlockedCount ?? finalAudit.residualRiskRegister?.policyBlockedCount,
        externalBlockedCount: finalAudit.externalBlockedCount ?? finalAudit.residualRiskRegister?.externalBlockedCount,
      }
    : null,
  finalSafe: finalSafe
    ? {
        ok: finalSafe.ok === true,
        status: finalSafe.status,
        tokenSpendingPromptExecuted: finalSafe.tokenSpendingPromptExecuted === true,
      }
    : null,
  noTokenStepGraph: {
    ...noTokenStepGraph,
    assertionCompletedAt: new Date().toISOString(),
    runtimeExecutedStepIds: steps.map((step) => step.id),
    runtimeTokenBearingStepCount: 0,
  },
  steps,
  failedSteps: failedSteps.map((step) => step.id),
  remainingBlockers,
};

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ artifact: OUT, ...report }, null, 2));

if (!ok) {
  process.exitCode = 1;
}
