import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
  AUTHENTICATED_PROMPT_OPERATOR_COMMAND,
  assertNoTokenStepGraph,
  consumeAuthenticatedPromptExecutionPacket,
  issueAuthenticatedPromptExecutionPacket,
  NO_TOKEN_SCRUBBED_ENV_KEYS,
  scrubNoTokenEnvironment,
  validateAuthenticatedPromptExecutionPacket,
} from "./lib/authenticated-prompt-authority.mjs";

const ROOT = resolve(process.cwd());
const OUT = join(ROOT, ".codex-auto", "quality", "goal-authority-contract.json");

function source(path) {
  return readFileSync(join(ROOT, path), "utf8");
}

function requireCheck(condition, message) {
  if (!condition) throw new Error(message);
}

const baseDescriptor = {
  id: "safe-fixture",
  label: "Safe fixture",
  script: "verify-terminal-font-render-contract.mjs",
  costClass: "no-token",
};

const mutations = [
  {
    id: "token-prompt-script",
    descriptor: { ...baseDescriptor, script: "verify-authenticated-ai-cli-prompt-smoke.mjs" },
  },
  {
    id: "provider-guard-script",
    descriptor: { ...baseDescriptor, script: "verify-authenticated-ai-cli-provider-guard.mjs" },
  },
  {
    id: "operator-token-wrapper",
    descriptor: { ...baseDescriptor, script: "verify-goal-operator-token-smoke.mjs" },
  },
  {
    id: "command-indirection",
    descriptor: {
      ...baseDescriptor,
      command: "node scripts/verify-authenticated-ai-cli-prompt-smoke.mjs",
    },
  },
  {
    id: "opaque-wrapper",
    descriptor: { ...baseDescriptor, script: "verify-opaque-wrapper.mjs" },
  },
  {
    id: "path-indirection",
    descriptor: { ...baseDescriptor, script: "../evil/verify-terminal-font-render-contract.mjs" },
  },
];

const mutationResults = mutations.map((mutation) => {
  let spawnCount = 0;
  let rejected = false;
  try {
    assertNoTokenStepGraph([mutation.descriptor]);
    spawnCount += 1;
  } catch (error) {
    rejected = String(error).includes("NO_TOKEN_GRAPH_REJECTED");
  }
  return { id: mutation.id, rejected, spawnCount };
});
requireCheck(
  mutationResults.every((result) => result.rejected && result.spawnCount === 0),
  "token-bearing descriptor mutation reached the spawn boundary",
);

const nowMs = Date.parse("2026-07-10T00:00:00.000Z");
const packet = issueAuthenticatedPromptExecutionPacket({
  executionId: "fixture-execution-id",
  provider: "codex",
  gitHead: "0123456789abcdef0123456789abcdef01234567",
  promptVerifierSha256: "a".repeat(64),
  issuedAtMs: nowMs,
  ttlMs: 60_000,
});
const packetContext = {
  nowMs: nowMs + 1000,
  executionId: packet.executionId,
  provider: packet.provider,
  canonicalCommand: AUTHENTICATED_PROMPT_OPERATOR_COMMAND,
  gitHead: packet.gitHead,
  promptVerifierSha256: packet.promptVerifierSha256,
};
const issuedValidation = validateAuthenticatedPromptExecutionPacket(packet, packetContext);
requireCheck(issuedValidation.ok, "fresh execution packet did not validate");
const consumedPacket = consumeAuthenticatedPromptExecutionPacket(packet, packetContext);
const replayValidation = validateAuthenticatedPromptExecutionPacket(consumedPacket, {
  ...packetContext,
  nowMs: nowMs + 2000,
});
requireCheck(!replayValidation.ok, "consumed execution packet was replayable");
requireCheck(
  replayValidation.errors.some((error) => error.code === "replay"),
  "replay rejection did not identify one-use state",
);

const negativePacketResults = [
  {
    id: "expired",
    packet,
    context: { ...packetContext, nowMs: nowMs + 61_000 },
    expectedCode: "expiry",
  },
  {
    id: "verifier-digest-mismatch",
    packet,
    context: { ...packetContext, promptVerifierSha256: "b".repeat(64) },
    expectedCode: "verifier-digest",
  },
  {
    id: "execution-id-mismatch",
    packet,
    context: { ...packetContext, executionId: "other-execution-id" },
    expectedCode: "execution-id",
  },
  {
    id: "provider-mismatch",
    packet,
    context: { ...packetContext, provider: "claude" },
    expectedCode: "provider",
  },
].map((fixture) => {
  const validation = validateAuthenticatedPromptExecutionPacket(fixture.packet, fixture.context);
  return {
    id: fixture.id,
    rejected: !validation.ok,
    expectedErrorObserved: validation.errors.some((error) => error.code === fixture.expectedCode),
  };
});
requireCheck(
  negativePacketResults.every((result) => result.rejected && result.expectedErrorObserved),
  "packet rejection matrix did not fail closed before the prompt boundary",
);

const poisonedEnvironment = Object.fromEntries(NO_TOKEN_SCRUBBED_ENV_KEYS.map((key) => [key, `poison-${key}`]));
const scrubbedEnvironment = scrubNoTokenEnvironment({ SAFE_FIXTURE: "preserved", ...poisonedEnvironment });
const envScrubChecks = {
  safeValuePreserved: scrubbedEnvironment.SAFE_FIXTURE === "preserved",
  authorityEnvRemoved: NO_TOKEN_SCRUBBED_ENV_KEYS.every((key) => scrubbedEnvironment[key] == null),
};
requireCheck(Object.values(envScrubChecks).every(Boolean), "no-token environment scrub failed");

const packageJson = source("package.json");
const authority = source("scripts/lib/authenticated-prompt-authority.mjs");
const runner = source("scripts/verify-goal-non-token-refresh.mjs");
const wrapper = source("scripts/verify-goal-operator-token-smoke.mjs");
const prompt = source("scripts/verify-authenticated-ai-cli-prompt-smoke.mjs");
const operatorFinish = source("scripts/verify-goal-operator-finish.mjs");
const descriptorStart = runner.indexOf("const stepDescriptors = [");
const assertionIndex = runner.indexOf("const noTokenStepGraph = assertNoTokenStepGraph(stepDescriptors)");
const spawnIndex = runner.indexOf("const steps = stepDescriptors.map");
const descriptorEnd = runner.indexOf("];", descriptorStart);
const descriptorManifest = runner.slice(descriptorStart, descriptorEnd);
const packetConsumeIndex = prompt.indexOf("const executionAuthority = consumeExecutionPacketBeforeCdp()");
const playwrightImportIndex = prompt.indexOf('await import("@playwright/test")');

const sourceChecks = {
  explicitNoTokenPackageCommand: packageJson.includes(
    '"verify:goal:safe:no-token": "node scripts/verify-goal-non-token-refresh.mjs"',
  ),
  explicitOperatorPackageCommand: packageJson.includes(
    '"verify:goal:operator:token-smoke": "node scripts/verify-goal-operator-token-smoke.mjs"',
  ),
  legacyAliasRemoved: !packageJson.includes('"verify:goal:refresh-safe"'),
  descriptorManifestPresent: descriptorStart >= 0 && descriptorEnd > descriptorStart,
  providerGuardExcluded: !descriptorManifest.includes("verify-authenticated-ai-cli-provider-guard.mjs"),
  strictNoTokenAllowlist: authority.includes("NO_TOKEN_SCRIPT_ALLOWLIST"),
  bareAllowlistedScriptRequired: authority.includes("rawScript !== script"),
  graphAssertedBeforeSpawn: assertionIndex > descriptorEnd && spawnIndex > assertionIndex,
  explicitNoTokenArtifact: runner.includes("final-goal-safe-no-token.json"),
  thisRunTokenField: runner.includes("tokenSpendingPromptExecutedByThisRun: false"),
  historicalTokenField: runner.includes("historicalTokenSpendingEvidenceObserved"),
  runtimeStepIdsRecorded: runner.includes("runtimeExecutedStepIds: steps.map"),
  envScrubApplied: runner.includes("scrubNoTokenEnvironment"),
  wrapperIssuesPacket: wrapper.includes("issueAuthenticatedPromptExecutionPacket"),
  wrapperBindsPromptDigest: wrapper.includes("promptVerifierSha256"),
  rawPromptHasNoTopLevelPlaywrightImport: !prompt.includes('import { chromium } from "@playwright/test"'),
  packetConsumedBeforePlaywright: packetConsumeIndex >= 0 && playwrightImportIndex > packetConsumeIndex,
  rawTranscriptNotStored: wrapper.includes("rawTranscriptStored: false"),
  operatorFinishCannotSpendTokens:
    operatorFinish.includes("tokenSpendingPromptExecutedByThisRun: false") &&
    !operatorFinish.includes("verify-goal-operator-token-smoke.mjs") &&
    !operatorFinish.includes("verify-authenticated-ai-cli-prompt-smoke.mjs"),
};
requireCheck(
  Object.values(sourceChecks).every(Boolean),
  `authority source contract failed: ${Object.entries(sourceChecks)
    .filter(([, ok]) => !ok)
    .map(([id]) => id)
    .join(", ")}`,
);

const report = {
  version: 1,
  generatedAt: new Date().toISOString(),
  ok: true,
  status: "pass",
  mutationResults,
  packetChecks: {
    issuedValidation: issuedValidation.ok,
    consumedStatus: consumedPacket.status,
    replayRejected: !replayValidation.ok,
    negativePacketResults,
  },
  envScrubChecks,
  sourceChecks,
  tokenSpendingPromptExecutedByThisRun: false,
};
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ artifact: OUT, ...report }, null, 2));
