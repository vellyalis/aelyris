import { createHash } from "node:crypto";

export const AUTHENTICATED_PROMPT_OPERATOR_COMMAND = "pnpm verify:goal:operator:token-smoke";
export const AUTHENTICATED_PROMPT_RAW_SCRIPT = "verify-authenticated-ai-cli-prompt-smoke.mjs";
export const AUTHENTICATED_PROMPT_OPERATOR_SCRIPT = "verify-goal-operator-token-smoke.mjs";
export const AUTHENTICATED_PROMPT_PROVIDER_GUARD_SCRIPT = "verify-authenticated-ai-cli-provider-guard.mjs";
export const AUTHENTICATED_PROMPT_CONSENT_PHRASE = "I_UNDERSTAND_THIS_MAY_SPEND_TOKENS";
export const AUTHENTICATED_PROMPT_PACKET_ENV = "AELYRIS_AUTH_PROMPT_EXECUTION_PACKET";
export const AUTHENTICATED_PROMPT_EXECUTION_ID_ENV = "AELYRIS_AUTH_PROMPT_EXECUTION_ID";
export const AUTHENTICATED_PROMPT_CANONICAL_COMMAND_ENV = "AELYRIS_AUTH_PROMPT_CANONICAL_COMMAND";
export const AUTHENTICATED_PROMPT_SUPPORTED_PROVIDERS = Object.freeze(["codex", "claude", "gemini"]);
export const AUTHENTICATED_PROMPT_PACKET_TTL_MS = 2 * 60 * 1000;
export const AUTHENTICATED_PROMPT_PACKET_MAX_TTL_MS = 5 * 60 * 1000;
export const NO_TOKEN_SCRUBBED_ENV_KEYS = Object.freeze([
  "AELYRIS_AUTH_PROMPT_CONSENT",
  "AELYRIS_AUTH_PROMPT_PROVIDER",
  AUTHENTICATED_PROMPT_PACKET_ENV,
  AUTHENTICATED_PROMPT_EXECUTION_ID_ENV,
  AUTHENTICATED_PROMPT_CANONICAL_COMMAND_ENV,
  "AELYRIS_ALLOW_OS_SLEEP",
  "AELYRIS_GOAL_OPERATOR_RUN_SLEEP",
]);

const TOKEN_BEARING_SCRIPTS = new Set([
  AUTHENTICATED_PROMPT_RAW_SCRIPT,
  AUTHENTICATED_PROMPT_OPERATOR_SCRIPT,
  AUTHENTICATED_PROMPT_PROVIDER_GUARD_SCRIPT,
]);

const NO_TOKEN_SCRIPT_ALLOWLIST = new Set([
  "verify-terminal-font-render-contract.mjs",
  "verify-chunked-osc-live-safe.mjs",
  "verify-native-terminal-input-host.mjs",
  "verify-native-boundary-contract.mjs",
  "verify-real-ai-cli-binary-probe.mjs",
  "verify-ai-cli-launch-planner.mjs",
  "verify-authenticated-ai-cli-preflight-matrix.mjs",
  "verify-authenticated-ai-cli-consent-packet.mjs",
  "verify-glass-legibility-contract.mjs",
  "verify-right-rail-information-density.mjs",
  "verify-goal-anti-stall-contract.mjs",
  "verify-release-signing-operator-handoff.mjs",
  "verify-real-os-sleep-operator-handoff.mjs",
  "verify-goal-external-gate-readiness.mjs",
  "score-release-quality.mjs",
  "verify-final-goal-audit.mjs",
  "verify-goal-documentation-freshness.mjs",
  "verify-goal-completion-matrix.mjs",
  "verify-right-rail-goal-track-tauri.mjs",
]);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function scriptBasename(value) {
  return String(value ?? "")
    .replaceAll("\\", "/")
    .split("/")
    .at(-1);
}

function packetError(code, detail) {
  return { code, detail };
}

export function assertNoTokenStepGraph(descriptors) {
  if (!Array.isArray(descriptors) || descriptors.length === 0) {
    throw new Error("NO_TOKEN_GRAPH_REJECTED: descriptor manifest is empty");
  }

  const ids = new Set();
  const normalized = descriptors.map((descriptor, index) => {
    if (!descriptor || typeof descriptor !== "object") {
      throw new Error(`NO_TOKEN_GRAPH_REJECTED: descriptor ${index} is not an object`);
    }
    const id = String(descriptor.id ?? "").trim();
    const label = String(descriptor.label ?? "").trim();
    const rawScript = String(descriptor.script ?? "").trim();
    const script = scriptBasename(rawScript);
    const command = String(descriptor.command ?? "").trim();
    if (!id || !label || !script) {
      throw new Error(`NO_TOKEN_GRAPH_REJECTED: descriptor ${index} is missing id, label, or script`);
    }
    if (ids.has(id)) throw new Error(`NO_TOKEN_GRAPH_REJECTED: duplicate descriptor id ${id}`);
    ids.add(id);
    if (descriptor.costClass !== "no-token") {
      throw new Error(`NO_TOKEN_GRAPH_REJECTED: ${id} costClass must be no-token`);
    }
    if (descriptor.spawnsTokenPrompt === true || TOKEN_BEARING_SCRIPTS.has(script)) {
      throw new Error(`NO_TOKEN_GRAPH_REJECTED: ${id} reaches token-bearing script ${script}`);
    }
    if (command) {
      throw new Error(`NO_TOKEN_GRAPH_REJECTED: ${id} uses unsupported opaque command ${command}`);
    }
    if (rawScript !== script) {
      throw new Error(`NO_TOKEN_GRAPH_REJECTED: ${id} script must be a bare allowlisted filename`);
    }
    if (!NO_TOKEN_SCRIPT_ALLOWLIST.has(script)) {
      throw new Error(`NO_TOKEN_GRAPH_REJECTED: ${id} script ${script} is not in the strict no-token allowlist`);
    }
    return { id, label, script, costClass: descriptor.costClass };
  });

  return Object.freeze({
    version: 1,
    policy: "descriptor-first-no-token",
    descriptorCount: normalized.length,
    descriptorIds: Object.freeze(normalized.map((descriptor) => descriptor.id)),
    descriptorDigestSha256: sha256(canonicalJson(normalized)),
    tokenBearingStepCount: 0,
    validatedBeforeSpawn: true,
  });
}

export function scrubNoTokenEnvironment(environment) {
  const scrubbed = { ...(environment ?? {}) };
  for (const key of NO_TOKEN_SCRUBBED_ENV_KEYS) delete scrubbed[key];
  return scrubbed;
}

export function issueAuthenticatedPromptExecutionPacket({
  executionId,
  provider,
  gitHead,
  promptVerifierSha256,
  issuedAtMs,
  ttlMs = AUTHENTICATED_PROMPT_PACKET_TTL_MS,
}) {
  const normalizedProvider = String(provider ?? "")
    .trim()
    .toLowerCase();
  if (!AUTHENTICATED_PROMPT_SUPPORTED_PROVIDERS.includes(normalizedProvider)) {
    throw new Error(`TOKEN_PACKET_ISSUE_REJECTED: unsupported provider ${normalizedProvider || "missing"}`);
  }
  if (!executionId || !gitHead || !promptVerifierSha256) {
    throw new Error("TOKEN_PACKET_ISSUE_REJECTED: executionId, gitHead, and prompt verifier digest are required");
  }
  if (
    !Number.isFinite(issuedAtMs) ||
    !Number.isFinite(ttlMs) ||
    ttlMs <= 0 ||
    ttlMs > AUTHENTICATED_PROMPT_PACKET_MAX_TTL_MS
  ) {
    throw new Error("TOKEN_PACKET_ISSUE_REJECTED: packet expiry must be short-lived");
  }
  return Object.freeze({
    version: 1,
    kind: "aelyris-authenticated-prompt-execution",
    status: "issued",
    oneUse: true,
    executionId: String(executionId),
    provider: normalizedProvider,
    canonicalCommand: AUTHENTICATED_PROMPT_OPERATOR_COMMAND,
    gitHead: String(gitHead),
    promptVerifierSha256: String(promptVerifierSha256),
    issuedAt: new Date(issuedAtMs).toISOString(),
    expiresAt: new Date(issuedAtMs + ttlMs).toISOString(),
    consumedAt: null,
    secretFree: true,
    rawTranscriptStored: false,
  });
}

export function validateAuthenticatedPromptExecutionPacket(packet, context) {
  const nowMs = Number(context?.nowMs);
  const issuedAtMs = Date.parse(String(packet?.issuedAt ?? ""));
  const expiresAtMs = Date.parse(String(packet?.expiresAt ?? ""));
  const errors = [];
  const expectedProvider = String(context?.provider ?? "")
    .trim()
    .toLowerCase();

  if (packet?.version !== 1 || packet?.kind !== "aelyris-authenticated-prompt-execution") {
    errors.push(packetError("schema", "packet schema is not recognized"));
  }
  if (packet?.status !== "issued" || packet?.oneUse !== true || packet?.consumedAt != null) {
    errors.push(packetError("replay", "packet is not in one-use issued state"));
  }
  if (packet?.executionId !== context?.executionId) {
    errors.push(packetError("execution-id", "packet execution ID does not match invocation"));
  }
  if (!AUTHENTICATED_PROMPT_SUPPORTED_PROVIDERS.includes(expectedProvider) || packet?.provider !== expectedProvider) {
    errors.push(packetError("provider", "packet provider does not match explicit invocation provider"));
  }
  if (
    packet?.canonicalCommand !== AUTHENTICATED_PROMPT_OPERATOR_COMMAND ||
    context?.canonicalCommand !== AUTHENTICATED_PROMPT_OPERATOR_COMMAND
  ) {
    errors.push(packetError("command", "packet is not bound to the canonical operator command"));
  }
  if (packet?.gitHead !== context?.gitHead) {
    errors.push(packetError("git-head", "packet Git HEAD does not match current checkout"));
  }
  if (packet?.promptVerifierSha256 !== context?.promptVerifierSha256) {
    errors.push(packetError("verifier-digest", "packet prompt verifier digest does not match current source"));
  }
  if (!Number.isFinite(nowMs) || !Number.isFinite(issuedAtMs) || !Number.isFinite(expiresAtMs)) {
    errors.push(packetError("time", "packet timestamps are invalid"));
  } else {
    if (nowMs < issuedAtMs || nowMs >= expiresAtMs) {
      errors.push(packetError("expiry", "packet is not currently valid"));
    }
    if (expiresAtMs - issuedAtMs > AUTHENTICATED_PROMPT_PACKET_MAX_TTL_MS) {
      errors.push(packetError("expiry-window", "packet validity window exceeds the maximum"));
    }
  }
  if (packet?.secretFree !== true || packet?.rawTranscriptStored !== false) {
    errors.push(packetError("privacy", "packet privacy contract is invalid"));
  }

  return Object.freeze({
    ok: errors.length === 0,
    errors: Object.freeze(errors),
    checks: Object.freeze({
      executionIdBound: packet?.executionId === context?.executionId,
      providerBound: packet?.provider === expectedProvider,
      canonicalCommandBound:
        packet?.canonicalCommand === AUTHENTICATED_PROMPT_OPERATOR_COMMAND &&
        context?.canonicalCommand === AUTHENTICATED_PROMPT_OPERATOR_COMMAND,
      gitHeadBound: packet?.gitHead === context?.gitHead,
      promptVerifierDigestBound: packet?.promptVerifierSha256 === context?.promptVerifierSha256,
      shortLived:
        Number.isFinite(expiresAtMs) &&
        Number.isFinite(issuedAtMs) &&
        expiresAtMs - issuedAtMs <= AUTHENTICATED_PROMPT_PACKET_MAX_TTL_MS,
      unconsumed: packet?.status === "issued" && packet?.consumedAt == null,
    }),
  });
}

export function consumeAuthenticatedPromptExecutionPacket(packet, context) {
  const validation = validateAuthenticatedPromptExecutionPacket(packet, context);
  if (!validation.ok) {
    throw new Error(`TOKEN_PACKET_CONSUME_REJECTED: ${validation.errors.map((error) => error.code).join(",")}`);
  }
  return Object.freeze({
    ...packet,
    status: "consumed",
    consumedAt: new Date(context.nowMs).toISOString(),
  });
}
