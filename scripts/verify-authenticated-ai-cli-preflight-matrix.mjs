import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const ROOT = resolve(process.cwd());
const OUT = join(ROOT, ".codex-auto", "production-smoke", "authenticated-ai-cli-preflight-matrix.json");
const PROVIDERS = ["codex", "claude", "gemini"];
const MAX_ARTIFACT_AGE_MS = Number.parseInt(
  process.env.AELYRIS_AUTH_PREFLIGHT_MATRIX_MAX_AGE_MS ?? `${24 * 60 * 60 * 1000}`,
  10,
);
const CONSENT_PHRASE = "I_UNDERSTAND_THIS_MAY_SPEND_TOKENS";
const ARTIFACT_REFRESH_COMMANDS = {
  realAiCliBinaryProbe: {
    command: "pnpm verify:terminal:real-ai-cli",
    costClass: "no-token",
    reason: "Refreshes the real Codex/Claude/Gemini binary capability probe.",
  },
  interactiveAiCliBoundary: {
    command: "pnpm verify:terminal:ai-cli-boundary",
    costClass: "no-token",
    reason: "Refreshes the sidecar command-session boundary proof.",
  },
  nativeInputHost: {
    command: "pnpm verify:terminal:native-input",
    costClass: "no-token",
    reason: "Refreshes the native IME/input host contract proof.",
  },
  ime: {
    command: "node scripts/verify-ime.mjs",
    costClass: "no-token",
    reason: "Refreshes the Japanese IME and paste-position proof without running a prompt.",
  },
  postLaunchChaos: {
    command: "pnpm verify:terminal:ai-cli-post-launch-chaos",
    costClass: "no-token-live-tauri",
    reason: "Refreshes the live Tauri PTY cleanup/chaos proof.",
  },
  nativePostLaunchChaos: {
    command: "pnpm verify:terminal:native-ai-cli-post-launch-chaos",
    costClass: "no-token-native-sidecar",
    reason: "Refreshes the native sidecar AI CLI cleanup/chaos proof without WebView2/CDP.",
  },
  authenticatedPrompt: {
    command: "pnpm verify:terminal:authenticated-ai-cli-prompt",
    costClass: "no-token-unless-consent-env-is-set",
    reason: "Refreshes the opt-in gate proof; without consent env it must not send a prompt.",
  },
  providerGuard: {
    command: "pnpm verify:terminal:authenticated-ai-cli-provider-guard",
    costClass: "no-token",
    reason: "Refreshes the provider-required guard that proves prompts stay blocked without explicit provider opt-in.",
  },
  launchPlanner: {
    command: "pnpm verify:terminal:ai-cli-launch-planner",
    costClass: "no-token",
    reason: "Refreshes provider launch-plan readiness.",
  },
};

function readArtifact(relativePath) {
  const path = join(ROOT, relativePath);
  if (!existsSync(path)) return { path: relativePath, exists: false, fresh: false, data: null };
  const stats = statSync(path);
  const ageMs = Date.now() - stats.mtimeMs;
  let data = null;
  let parseError = null;
  try {
    data = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    parseError = error instanceof Error ? error.message : String(error);
  }
  return {
    path: relativePath,
    exists: true,
    fresh: parseError === null && ageMs <= MAX_ARTIFACT_AGE_MS,
    ageMs,
    mtimeMs: stats.mtimeMs,
    parseError,
    data,
  };
}

function artifactBlockingReason(artifact) {
  if (!artifact.exists) return "missing";
  if (artifact.parseError) return "parse-error";
  if (typeof artifact.ageMs === "number" && artifact.ageMs > MAX_ARTIFACT_AGE_MS) return "stale";
  if (!artifact.fresh) return "not-fresh";
  return null;
}

function artifactSummary(name, artifact) {
  const refresh = ARTIFACT_REFRESH_COMMANDS[name] ?? {
    command: "pnpm verify:terminal:authenticated-ai-cli-preflight-matrix",
    costClass: "no-token",
    reason: "Refreshes the provider preflight matrix.",
  };
  const blockingReason = artifactBlockingReason(artifact);
  return {
    path: artifact.path,
    exists: artifact.exists,
    fresh: artifact.fresh,
    ageMs: artifact.ageMs ?? null,
    expiresAt:
      typeof artifact.mtimeMs === "number" ? new Date(artifact.mtimeMs + MAX_ARTIFACT_AGE_MS).toISOString() : null,
    parseError: artifact.parseError ?? null,
    blockingReason,
    refreshCommand: refresh.command,
    refreshReason: refresh.reason,
    costClass: refresh.costClass,
  };
}

function optInCommand(provider) {
  return {
    command: "pnpm verify:terminal:authenticated-ai-cli-prompt",
    env: {
      AELYRIS_AUTH_PROMPT_CONSENT: CONSENT_PHRASE,
      AELYRIS_AUTH_PROMPT_PROVIDER: provider,
    },
  };
}

const artifacts = {
  realAiCliBinaryProbe: readArtifact(".codex-auto/production-smoke/real-ai-cli-binary-probe.json"),
  interactiveAiCliBoundary: readArtifact(".codex-auto/production-smoke/interactive-ai-cli-boundary.json"),
  nativeInputHost: readArtifact(".codex-auto/production-smoke/native-terminal-input-host.json"),
  ime: readArtifact(".codex-auto/production-smoke/verify-ime.json"),
  postLaunchChaos: readArtifact(".codex-auto/chaos-recovery/p2-07-live-tauri-pty-ai-cli-chaos.json"),
  nativePostLaunchChaos: readArtifact(".codex-auto/chaos-recovery/native-ai-cli-post-launch-chaos.json"),
  authenticatedPrompt: readArtifact(".codex-auto/production-smoke/authenticated-ai-cli-prompt-smoke.json"),
  providerGuard: readArtifact(".codex-auto/production-smoke/authenticated-ai-cli-provider-required-smoke.json"),
  launchPlanner: readArtifact(".codex-auto/production-smoke/ai-cli-launch-planner.json"),
};
const artifactSummaries = Object.fromEntries(
  Object.entries(artifacts).map(([name, artifact]) => [name, artifactSummary(name, artifact)]),
);
const authenticatedPromptChecks = artifacts.authenticatedPrompt.data?.checks ?? {};
const providerGuardChecks = artifacts.providerGuard.data?.guardVerifier?.checks ?? {};
const providerGuardBlocksPrompt =
  artifacts.providerGuard.fresh &&
  artifacts.providerGuard.data?.status === "provider_required" &&
  artifacts.providerGuard.data?.guardVerifier?.ok === true &&
  providerGuardChecks.tokenBlocked === true &&
  providerGuardChecks.noPromptSent === true &&
  providerGuardChecks.noSessionSpawned === true;
const authenticatedPromptBlockedWithoutConsent =
  artifacts.authenticatedPrompt.fresh &&
  artifacts.authenticatedPrompt.data?.status === "requires_opt_in" &&
  authenticatedPromptChecks.tokenSpendingExecutionBlocked === true &&
  authenticatedPromptChecks.safeNoPromptSent === true &&
  authenticatedPromptChecks.nonTokenPreflightReady === true;
const authenticatedPromptExecutedWithConsent =
  artifacts.authenticatedPrompt.fresh &&
  artifacts.authenticatedPrompt.data?.status === "pass" &&
  artifacts.authenticatedPrompt.data?.ok === true &&
  authenticatedPromptChecks.consent === true &&
  authenticatedPromptChecks.preflightReadyBeforePrompt === true &&
  authenticatedPromptChecks.promptMarkerObserved === true &&
  artifacts.authenticatedPrompt.data?.outputEvidence?.privacy === "raw terminal output not persisted" &&
  artifacts.authenticatedPrompt.data?.outputEvidence?.markerPresent === true &&
  authenticatedPromptChecks.cleanup === true;
const authenticatedPromptGateReady =
  authenticatedPromptBlockedWithoutConsent || authenticatedPromptExecutedWithConsent || providerGuardBlocksPrompt;
const postLaunchChaosPass =
  artifacts.postLaunchChaos.fresh &&
  artifacts.postLaunchChaos.data?.status === "pass" &&
  artifacts.postLaunchChaos.data?.aiCliKillCleanup?.status === "pass" &&
  artifacts.postLaunchChaos.data?.aiCliKillCleanup?.remainingSessionsAfterCleanup === 0;
const nativePostLaunchChaosChecks = artifacts.nativePostLaunchChaos.data?.checks ?? {};
const nativePostLaunchChaosPass =
  artifacts.nativePostLaunchChaos.fresh &&
  artifacts.nativePostLaunchChaos.data?.ok === true &&
  artifacts.nativePostLaunchChaos.data?.status === "pass" &&
  nativePostLaunchChaosChecks.commandSessionCapability === true &&
  nativePostLaunchChaosChecks.webviewRequiredForToolCalls === true &&
  nativePostLaunchChaosChecks.sameIdRespawned === true &&
  nativePostLaunchChaosChecks.ptyPromptReadyBeforeWrite === true &&
  nativePostLaunchChaosChecks.ptyPromptReadyAfterRestart === true &&
  nativePostLaunchChaosChecks.ptyRestartBeforeVisible === true &&
  nativePostLaunchChaosChecks.ptyRestartAfterVisible === true &&
  nativePostLaunchChaosChecks.ptyNoResidue === true &&
  nativePostLaunchChaosChecks.aiCliAllProvidersCovered === true &&
  nativePostLaunchChaosChecks.aiCliReadyVisible === true &&
  nativePostLaunchChaosChecks.aiCliInputRoundtrip === true &&
  nativePostLaunchChaosChecks.aiCliKillCleanup === true &&
  nativePostLaunchChaosChecks.noSessionResidue === true;
const postLaunchChaosDeferred =
  !nativePostLaunchChaosPass &&
  artifacts.postLaunchChaos.fresh &&
  artifacts.postLaunchChaos.data?.status === "external_dependency" &&
  /CDP|WebView2|Cannot attach/i.test(
    `${artifacts.postLaunchChaos.data?.error ?? ""}\n${artifacts.postLaunchChaos.data?.errors?.join?.("\n") ?? ""}`,
  );

function nativeInputCheck(id) {
  const status = artifacts.nativeInputHost.data?.status;
  return (
    artifacts.nativeInputHost.fresh &&
    (status === "pass" || status === "blocked") &&
    Array.isArray(artifacts.nativeInputHost.data?.checks) &&
    artifacts.nativeInputHost.data.checks.some((check) => check?.id === id && check?.status === "passed")
  );
}

const nativeImeHostReady =
  nativeInputCheck("frontend-native-default") &&
  nativeInputCheck("composition-surface") &&
  nativeInputCheck("surface-ime-preedit-hidden") &&
  nativeInputCheck("surface-custom-hwnd-runway") &&
  nativeInputCheck("commit-command");
const nativeInputHostReady = nativeImeHostReady && nativeInputCheck("surface-paste-guard");
const cdpImeReady =
  artifacts.ime.fresh &&
  artifacts.ime.data?.status === "pass" &&
  artifacts.ime.data?.checks?.some?.((check) => /Long Japanese preedit/i.test(check)) === true &&
  artifacts.ime.data?.checks?.some?.((check) => /native input surface geometry inside canvas/i.test(check)) === true;
const imeReady = nativeImeHostReady || cdpImeReady;
const promptArtifactFreshnessReady = artifacts.authenticatedPrompt.fresh || providerGuardBlocksPrompt;

function artifactFreshnessSatisfied(name, artifact) {
  if (name === "authenticatedPrompt") return promptArtifactFreshnessReady;
  if (name === "postLaunchChaos" && nativePostLaunchChaosPass) return true;
  // The legacy CDP IME proof is optional when the native IME host is current.
  if (name === "ime" && nativeImeHostReady) return true;
  return artifact.fresh === true;
}

const blockingArtifacts = Object.entries(artifactSummaries)
  .filter(([name, artifact]) => artifact.blockingReason !== null && !artifactFreshnessSatisfied(name, artifacts[name]))
  .map(([name, artifact]) => ({
    name,
    path: artifact.path,
    blockingReason: artifact.blockingReason,
    refreshCommand: artifact.refreshCommand,
  }));
const providerMatrix = PROVIDERS.map((provider) => {
  const realProbeEntry = artifacts.realAiCliBinaryProbe.data?.checks?.clis?.find((entry) => entry?.cli === provider);
  const boundaryEntry = artifacts.interactiveAiCliBoundary.data?.checks?.clis?.find((entry) => entry?.cli === provider);
  const launchProvider = artifacts.launchPlanner.data?.checks?.providerMatrix?.providers?.find(
    (entry) => entry?.provider === provider || entry?.cli === provider,
  );
  const checks = {
    realProviderBinary:
      artifacts.realAiCliBinaryProbe.fresh &&
      artifacts.realAiCliBinaryProbe.data?.status === "pass" &&
      realProbeEntry?.status === "pass" &&
      realProbeEntry?.markerSeen === true &&
      realProbeEntry?.commandNotFound === false &&
      typeof realProbeEntry?.executablePath === "string" &&
      realProbeEntry.executablePath.length > 0 &&
      Number.isInteger(realProbeEntry?.attemptCount) &&
      realProbeEntry.attemptCount >= 1 &&
      Array.isArray(realProbeEntry?.attempts) &&
      realProbeEntry.attempts.length === realProbeEntry.attemptCount &&
      realProbeEntry?.fatalLaunchError !== true &&
      (realProbeEntry?.versionLike === true || realProbeEntry?.usageLike === true),
    interactiveBoundary:
      artifacts.interactiveAiCliBoundary.fresh &&
      artifacts.interactiveAiCliBoundary.data?.ok === true &&
      boundaryEntry?.backend === "sidecar-command-session" &&
      boundaryEntry?.streamReceivedMarker === true &&
      boundaryEntry?.inputRoundtrip === true &&
      boundaryEntry?.closed === true,
    launchPlannerProviderReady:
      artifacts.launchPlanner.fresh &&
      artifacts.launchPlanner.data?.ok === true &&
      artifacts.launchPlanner.data?.checks?.providerMatrix?.allProvidersReady === true &&
      (launchProvider ? launchProvider.ready !== false && launchProvider.status !== "fail" : true),
    nativeInputHost: nativeInputHostReady,
    ime: imeReady,
    postLaunchChaos: nativePostLaunchChaosPass || postLaunchChaosPass || postLaunchChaosDeferred,
    promptGateReady: authenticatedPromptGateReady,
  };
  return {
    provider,
    ready: Object.values(checks).every(Boolean),
    checks,
    optInCommand: optInCommand(provider),
  };
});

const checks = {
  allProvidersPresent: providerMatrix.length === PROVIDERS.length,
  allProvidersReady: providerMatrix.every((entry) => entry.ready),
  artifactRefreshCommandsReady: Object.values(artifactSummaries).every(
    (artifact) => typeof artifact.refreshCommand === "string" && artifact.refreshCommand.length > 0,
  ),
  tokenSpendingExecutionBlocked: authenticatedPromptBlockedWithoutConsent || providerGuardBlocksPrompt,
  noPromptSent: authenticatedPromptBlockedWithoutConsent || providerGuardBlocksPrompt,
  tokenPromptExecutedWithConsent: authenticatedPromptExecutedWithConsent,
  promptExecutionStateReady: authenticatedPromptGateReady,
  artifactFreshness: Object.entries(artifacts).every(([name, artifact]) => artifactFreshnessSatisfied(name, artifact)),
  postLaunchChaosPass: nativePostLaunchChaosPass || postLaunchChaosPass,
  nativePostLaunchChaosPass,
  postLaunchChaosDeferred,
};
const ok =
  checks.allProvidersPresent === true &&
  checks.allProvidersReady === true &&
  checks.artifactRefreshCommandsReady === true &&
  checks.promptExecutionStateReady === true &&
  checks.artifactFreshness === true;

const report = {
  version: 1,
  ok,
  status: ok ? "pass" : "failed",
  generatedAt: new Date().toISOString(),
  providers: PROVIDERS,
  maxArtifactAgeMs: MAX_ARTIFACT_AGE_MS,
  checks,
  blockingArtifacts,
  providerMatrix,
  artifacts: artifactSummaries,
};

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ artifact: OUT, ...report }, null, 2));
if (!report.ok) process.exitCode = 1;
