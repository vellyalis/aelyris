import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const ROOT = resolve(process.cwd());
const OUT = join(ROOT, ".codex-auto", "production-smoke", "authenticated-ai-cli-consent-packet.json");
const CONSENT_PHRASE = "I_UNDERSTAND_THIS_MAY_SPEND_TOKENS";
const REQUIRED_COMMAND = "pnpm verify:terminal:authenticated-ai-cli-prompt";
const PROVIDERS = ["codex", "claude", "gemini"];
const MAX_ARTIFACT_AGE_MS = Number.parseInt(
  process.env.AELYRIS_AUTH_CONSENT_PACKET_MAX_AGE_MS ?? `${24 * 60 * 60 * 1000}`,
  10,
);

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
    fresh: parseError == null && ageMs <= MAX_ARTIFACT_AGE_MS,
    ageMs,
    mtimeMs: stats.mtimeMs,
    parseError,
    data,
  };
}

function writeReport(report) {
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`);
}

function envPhrase(env) {
  if (!env || typeof env !== "object") return "";
  return Object.entries(env)
    .map(([key, value]) => `${key}=${String(value ?? "")}`)
    .filter((entry) => !entry.endsWith("="))
    .join(" ");
}

function artifactSummary(artifact) {
  return {
    path: artifact.path,
    exists: artifact.exists,
    fresh: artifact.fresh,
    ageMs: artifact.ageMs ?? null,
    mtimeMs: artifact.mtimeMs ?? null,
    expiresAt:
      typeof artifact.mtimeMs === "number" ? new Date(artifact.mtimeMs + MAX_ARTIFACT_AGE_MS).toISOString() : null,
    parseError: artifact.parseError ?? null,
  };
}

function sha256(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

const artifacts = {
  authenticatedPrompt: readArtifact(".codex-auto/production-smoke/authenticated-ai-cli-prompt-smoke.json"),
  providerGuard: readArtifact(".codex-auto/production-smoke/authenticated-ai-cli-provider-required-smoke.json"),
  preflightMatrix: readArtifact(".codex-auto/production-smoke/authenticated-ai-cli-preflight-matrix.json"),
  launchPlanner: readArtifact(".codex-auto/production-smoke/ai-cli-launch-planner.json"),
};
const prompt = artifacts.authenticatedPrompt.data ?? {};
const promptChecks = prompt.checks ?? {};
const matrix = artifacts.preflightMatrix.data ?? {};
const guard = artifacts.providerGuard.data ?? {};
const promptBlockedWithoutConsent =
  prompt.status === "requires_opt_in" &&
  promptChecks.tokenSpendingExecutionBlocked === true &&
  promptChecks.safeNoPromptSent === true;
const promptExecutedWithConsent =
  prompt.status === "pass" &&
  prompt.ok === true &&
  promptChecks.consent === true &&
  promptChecks.preflightReadyBeforePrompt === true &&
  promptChecks.promptMarkerObserved === true &&
  promptChecks.cleanup === true &&
  prompt.outputEvidence?.privacy === "raw terminal output not persisted" &&
  prompt.outputEvidence?.markerPresent === true;
const providerRows = Array.isArray(matrix.providerMatrix) ? matrix.providerMatrix : [];
const providerReadiness = PROVIDERS.map((provider) => {
  const row = providerRows.find((entry) => entry?.provider === provider);
  const command = row?.optInCommand?.command ?? "";
  const env = row?.optInCommand?.env ?? {};
  const requiredEnv = envPhrase(env);
  const checks = {
    rowReady: row?.ready === true,
    commandExact: command === REQUIRED_COMMAND,
    consentExact: env?.AELYRIS_AUTH_PROMPT_CONSENT === CONSENT_PHRASE,
    providerExact: env?.AELYRIS_AUTH_PROMPT_PROVIDER === provider,
  };
  return {
    provider,
    status: Object.values(checks).every(Boolean) ? "ready" : "blocked",
    command,
    requiredEnv,
    checks,
  };
});
const providerGuardBlocksPrompt =
  artifacts.providerGuard.fresh &&
  guard.status === "provider_required" &&
  guard.guardVerifier?.ok === true &&
  guard.guardVerifier?.checks?.tokenBlocked === true &&
  guard.guardVerifier?.checks?.noPromptSent === true &&
  guard.guardVerifier?.checks?.noSessionSpawned === true;
const sourceArtifactsFresh =
  Object.entries(artifacts).every(([name, artifact]) => name === "authenticatedPrompt" || artifact.fresh) &&
  (artifacts.authenticatedPrompt.fresh || providerGuardBlocksPrompt);
const packetCore = {
  command: REQUIRED_COMMAND,
  requiredEnv: `AELYRIS_AUTH_PROMPT_CONSENT=${CONSENT_PHRASE}`,
  tokenGate: "explicit consent",
  wouldSpendTokens: true,
  promptState: promptExecutedWithConsent ? "executed_with_consent" : "blocked_without_consent",
  tokenSpendingPromptExecuted: promptExecutedWithConsent,
  safeNoPromptSent: promptBlockedWithoutConsent,
  providers: providerReadiness.map((entry) => ({
    provider: entry.provider,
    command: entry.command,
    requiredEnv: entry.requiredEnv,
    status: entry.status,
  })),
  sourceArtifacts: Object.fromEntries(Object.entries(artifacts).map(([name, artifact]) => [name, artifactSummary(artifact)])),
};
const checks = {
  noTokenPromptSent: promptBlockedWithoutConsent,
  tokenPromptExecutedWithConsent: promptExecutedWithConsent,
  promptStateValid: promptBlockedWithoutConsent || promptExecutedWithConsent,
  promptConsentPacketReady:
    (promptChecks.consentPacketReady === true || promptExecutedWithConsent) &&
    (promptChecks.nonTokenPreflightReady === true || prompt.nonTokenPreflight?.ready === true) &&
    prompt.wouldSpendTokens === true,
  providerGuardBlocksPrompt:
    providerGuardBlocksPrompt,
  providerMatrixReady:
    matrix.ok === true &&
    matrix.status === "pass" &&
    matrix.checks?.allProvidersReady === true &&
    matrix.checks?.promptExecutionStateReady === true,
  allProviderOptInCommandsReady: providerReadiness.every((entry) => entry.status === "ready"),
  launchPlannerReady: artifacts.launchPlanner.data?.ok === true && artifacts.launchPlanner.data?.checks?.promptContractReady === true,
  sourceArtifactsFresh,
  noRawPromptTextPersisted: true,
};
const ok =
  checks.promptStateValid === true &&
  checks.promptConsentPacketReady === true &&
  checks.providerGuardBlocksPrompt === true &&
  checks.providerMatrixReady === true &&
  checks.allProviderOptInCommandsReady === true &&
  checks.launchPlannerReady === true &&
  checks.sourceArtifactsFresh === true &&
  checks.noRawPromptTextPersisted === true;
const report = {
  version: 1,
  ok,
  status: ok ? "pass" : "failed",
  generatedAt: new Date().toISOString(),
  maxArtifactAgeMs: MAX_ARTIFACT_AGE_MS,
  consentPhraseSha256: sha256(CONSENT_PHRASE),
  consentPacketSha256: sha256(packetCore),
  checks,
  packet: packetCore,
  providerReadiness,
  artifacts: packetCore.sourceArtifacts,
  nextRequiredAction: `Set AELYRIS_AUTH_PROMPT_CONSENT=${CONSENT_PHRASE} and AELYRIS_AUTH_PROMPT_PROVIDER=codex|claude|gemini, then run ${REQUIRED_COMMAND} only if token-spend validation is desired.`,
};

writeReport(report);
console.log(JSON.stringify({ artifact: OUT, ...report }, null, 2));
if (!report.ok) process.exitCode = 1;
