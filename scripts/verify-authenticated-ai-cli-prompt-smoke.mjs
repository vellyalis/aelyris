// Internal authenticated AI CLI prompt smoke.
//
// Canonical public entrypoint: pnpm verify:goal:operator:token-smoke
// This verifier may spend real provider tokens. The static consent phrase and
// provider are not sufficient: the operator wrapper must mint a current,
// HEAD- and verifier-bound one-use execution packet, which this script consumes
// before loading Playwright, reaching CDP, or sending a prompt.
//
// Required for token-spending execution:
//   AELYRIS_AUTH_PROMPT_CONSENT=I_UNDERSTAND_THIS_MAY_SPEND_TOKENS
//
// Optional:
//   AELYRIS_AUTH_PROMPT_PROVIDER=codex|claude|gemini
//   AELYRIS_AUTH_PROMPT_TEXT="..."
//   AELYRIS_TAURI_CDP=http://127.0.0.1:9222
//   AELYRIS_AUTH_PROMPT_APP_URL=http://localhost:1420/

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import net from "node:net";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  AUTHENTICATED_PROMPT_CANONICAL_COMMAND_ENV,
  AUTHENTICATED_PROMPT_CONSENT_PHRASE,
  AUTHENTICATED_PROMPT_EXECUTION_ID_ENV,
  AUTHENTICATED_PROMPT_OPERATOR_COMMAND,
  AUTHENTICATED_PROMPT_PACKET_ENV,
  consumeAuthenticatedPromptExecutionPacket,
  validateAuthenticatedPromptExecutionPacket,
} from "./lib/authenticated-prompt-authority.mjs";

const CONSENT_PHRASE = AUTHENTICATED_PROMPT_CONSENT_PHRASE;
const CDP = process.env.AELYRIS_TAURI_CDP ?? process.env.AELYRIS_IME_CDP ?? "http://127.0.0.1:9222";
const APP_URL = process.env.AELYRIS_AUTH_PROMPT_APP_URL ?? "http://localhost:1420/";
const APP_ORIGIN = new URL(APP_URL).origin;
const PROJECT_PATH = (process.env.AELYRIS_TAURI_PROJECT ?? process.cwd()).replaceAll("\\", "/");
const ROOT = resolve(process.cwd());
const OUT = process.env.AELYRIS_AUTH_PROMPT_OUT ?? ".codex-auto/production-smoke/authenticated-ai-cli-prompt-smoke.json";
const WAIT_MS = Number.parseInt(process.env.AELYRIS_AUTH_PROMPT_WAIT_MS ?? "90000", 10);
const RAW_PROVIDER = process.env.AELYRIS_AUTH_PROMPT_PROVIDER;
const PROVIDER_EXPLICIT = typeof RAW_PROVIDER === "string" && RAW_PROVIDER.trim().length > 0;
const PROVIDER = String(RAW_PROVIDER ?? "codex").toLowerCase();
const SUPPORTED_PROVIDERS = new Set(["codex", "claude", "gemini"]);
const ACCEPTED_AGENT_BACKENDS = new Set(["native", "sidecar", "sidecar-command-session"]);
const MAX_PREFLIGHT_ARTIFACT_AGE_MS = Number.parseInt(
  process.env.AELYRIS_AUTH_PROMPT_PREFLIGHT_MAX_AGE_MS ?? `${24 * 60 * 60 * 1000}`,
  10,
);
const MARKER = `AELYRIS_AUTH_PROMPT_${Date.now().toString(36).toUpperCase()}`;
const PROMPT =
  process.env.AELYRIS_AUTH_PROMPT_TEXT ??
  `Aelyris authenticated prompt smoke. Reply with the exact marker ${MARKER}, then stop.`;
const PROMPT_VERIFIER_PATH = fileURLToPath(import.meta.url);
const EXPECTED_EXECUTION_PACKET_PATH = resolve(
  ROOT,
  ".codex-auto",
  "production-smoke",
  "authenticated-ai-cli-token-execution-packet.json",
);
let chromium = null;

function writeArtifact(report) {
  const path = resolve(OUT);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify({ ...report, finishedAt: new Date().toISOString() }, null, 2)}\n`);
  return path;
}

function readArtifact(relativePath) {
  const path = resolve(ROOT, relativePath);
  if (!existsSync(path)) {
    return { path, exists: false, fresh: false, data: null };
  }
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
    path,
    exists: true,
    fresh: parseError === null && ageMs <= MAX_PREFLIGHT_ARTIFACT_AGE_MS,
    ageMs,
    parseError,
    data,
  };
}

function passedChecks(checks) {
  return Array.isArray(checks) && checks.length > 0 && checks.every((check) => check?.status === "passed");
}

function isPostLaunchChaosDeferred(artifact) {
  return (
    artifact.fresh === true &&
    artifact.data?.status === "external_dependency" &&
    /CDP|WebView2|Cannot attach/i.test(`${artifact.data?.error ?? ""}\n${artifact.data?.errors?.join?.("\n") ?? ""}`)
  );
}

function nativeInputCheck(artifact, id) {
  const status = artifact.data?.status;
  return (
    artifact.fresh === true &&
    (status === "pass" || status === "blocked") &&
    Array.isArray(artifact.data?.checks) &&
    artifact.data.checks.some((check) => check?.id === id && check?.status === "passed")
  );
}

function buildNoTokenPreflight(provider) {
  const artifacts = {
    realAiCliBinaryProbe: readArtifact(".codex-auto/production-smoke/real-ai-cli-binary-probe.json"),
    interactiveAiCliBoundary: readArtifact(".codex-auto/production-smoke/interactive-ai-cli-boundary.json"),
    nativeInputHost: readArtifact(".codex-auto/production-smoke/native-terminal-input-host.json"),
    ime: readArtifact(".codex-auto/production-smoke/verify-ime.json"),
    postLaunchChaos: readArtifact(".codex-auto/chaos-recovery/p2-07-live-tauri-pty-ai-cli-chaos.json"),
    nativePostLaunchChaos: readArtifact(".codex-auto/chaos-recovery/native-ai-cli-post-launch-chaos.json"),
  };
  const realProbeEntry = artifacts.realAiCliBinaryProbe.data?.checks?.clis?.find((entry) => entry?.cli === provider);
  const boundaryEntry = artifacts.interactiveAiCliBoundary.data?.checks?.clis?.find((entry) => entry?.cli === provider);
  const postLaunchChaosPass =
    artifacts.postLaunchChaos.fresh &&
    artifacts.postLaunchChaos.data?.status === "pass" &&
    artifacts.postLaunchChaos.data?.aiCliKillCleanup?.status === "pass" &&
    artifacts.postLaunchChaos.data?.aiCliKillCleanup?.remainingSessionsAfterCleanup === 0;
  const postLaunchChaosDeferred = isPostLaunchChaosDeferred(artifacts.postLaunchChaos);
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
  const nativeImeHostReady =
    nativeInputCheck(artifacts.nativeInputHost, "frontend-native-default") &&
    nativeInputCheck(artifacts.nativeInputHost, "composition-surface") &&
    nativeInputCheck(artifacts.nativeInputHost, "surface-ime-preedit-hidden") &&
    nativeInputCheck(artifacts.nativeInputHost, "surface-custom-hwnd-runway") &&
    nativeInputCheck(artifacts.nativeInputHost, "commit-command");
  const nativeInputHostReady = nativeImeHostReady && nativeInputCheck(artifacts.nativeInputHost, "surface-paste-guard");
  const cdpImeReady =
    artifacts.ime.fresh &&
    artifacts.ime.data?.status === "pass" &&
    artifacts.ime.data?.checks?.some?.((check) => /Long Japanese preedit/i.test(String(check?.detail ?? check))) ===
      true &&
    artifacts.ime.data?.checks?.some?.((check) => /LF paste submitted/i.test(String(check?.detail ?? check))) ===
      true;
  const checks = {
    realProviderBinary:
      artifacts.realAiCliBinaryProbe.fresh &&
      artifacts.realAiCliBinaryProbe.data?.status === "pass" &&
      realProbeEntry?.status === "pass" &&
      realProbeEntry?.commandNotFound === false,
    commandSessionCapability:
      artifacts.realAiCliBinaryProbe.fresh &&
      artifacts.interactiveAiCliBoundary.fresh &&
      artifacts.realAiCliBinaryProbe.data?.checks?.commandSessionCapability === true &&
      artifacts.interactiveAiCliBoundary.data?.checks?.commandSessionCapability === true,
    interactiveBoundary:
      artifacts.interactiveAiCliBoundary.fresh &&
      artifacts.interactiveAiCliBoundary.data?.ok === true &&
      boundaryEntry?.backend === "sidecar-command-session" &&
      boundaryEntry?.streamReceivedMarker === true &&
      boundaryEntry?.inputRoundtrip === true &&
      boundaryEntry?.closed === true,
    nativeInputHost: nativeInputHostReady,
    ime: nativeImeHostReady || cdpImeReady,
    postLaunchChaos: nativePostLaunchChaosPass || postLaunchChaosPass || postLaunchChaosDeferred,
  };
  return {
    provider,
    maxArtifactAgeMs: MAX_PREFLIGHT_ARTIFACT_AGE_MS,
    ready: Object.values(checks).every(Boolean),
    postLaunchChaosPass: nativePostLaunchChaosPass || postLaunchChaosPass,
    nativePostLaunchChaosPass,
    postLaunchChaosDeferred,
    postLaunchChaosReadiness: nativePostLaunchChaosPass
      ? "native-sidecar-passed"
      : postLaunchChaosPass
      ? "passed"
      : postLaunchChaosDeferred
        ? "deferred_external_live_tauri_cdp"
        : "missing_or_failed",
    imeReadiness: nativeImeHostReady ? "native-input-host-passed" : cdpImeReady ? "cdp-ime-passed" : "missing_or_failed",
    checks,
    artifacts: Object.fromEntries(
      Object.entries(artifacts).map(([name, artifact]) => [
        name,
        {
          path: artifact.path,
          exists: artifact.exists,
          fresh: artifact.fresh,
          ageMs: artifact.ageMs ?? null,
          parseError: artifact.parseError ?? null,
        },
      ]),
    ),
  };
}

function isAelyrisPage(page) {
  const url = page.url();
  return (
    url.startsWith(APP_ORIGIN) ||
    url.includes("localhost:1420") ||
    url.includes("127.0.0.1:1420") ||
    url.startsWith("tauri://localhost") ||
    url.startsWith("https://tauri.localhost")
  );
}

function probeCdpTcp(timeoutMs = 750) {
  return new Promise((resolveProbe, rejectProbe) => {
    const url = new URL(CDP);
    const host = url.hostname || "127.0.0.1";
    const port = Number.parseInt(url.port || (url.protocol === "https:" ? "443" : "80"), 10);
    const socket = net.connect({ host, port });
    let done = false;
    const finish = (error) => {
      if (done) return;
      done = true;
      socket.destroy();
      if (error) rejectProbe(error);
      else resolveProbe();
    };
    socket.setTimeout(timeoutMs, () => finish(new Error(`TCP timeout ${host}:${port}`)));
    socket.once("connect", () => finish());
    socket.once("error", (error) => finish(error));
  });
}

async function connectWithWait() {
  const startedAt = Date.now();
  let lastError = null;
  do {
    try {
      await probeCdpTcp();
      const browser = await chromium.connectOverCDP(CDP);
      return { browser, waitedMs: Date.now() - startedAt };
    } catch (error) {
      lastError = error;
      await new Promise((resolveWait) => setTimeout(resolveWait, 1000));
    }
  } while (Date.now() - startedAt < WAIT_MS);
  throw new Error(
    `Cannot attach to WebView2 CDP at ${CDP} after ${WAIT_MS}ms. Last error: ${lastError?.message ?? "unknown"}`,
  );
}

async function waitForAelyrisPage(browser) {
  const deadline = Date.now() + WAIT_MS;
  let pages = [];
  while (Date.now() < deadline) {
    pages = browser.contexts().flatMap((context) => context.pages());
    const page = pages.find(isAelyrisPage);
    if (page) return { page, pages };
    await new Promise((resolveWait) => setTimeout(resolveWait, 500));
  }
  throw new Error(`CDP attached, but no Aelyris page was exposed. Pages: ${pages.map((page) => page.url()).join(", ")}`);
}

async function waitForAppReady(page) {
  await page.waitForFunction(
    () => !!document.querySelector(".app-container") && !!document.querySelector(".app-main"),
    null,
    { timeout: WAIT_MS },
  );
}

async function call(page, cmd, args = {}) {
  return page.evaluate(
    async ({ cmd: command, args: commandArgs }) => {
      const internals = window.__TAURI_INTERNALS__;
      if (!internals || typeof internals.invoke !== "function") {
        throw new Error("__TAURI_INTERNALS__.invoke unavailable");
      }
      return internals.invoke(command, commandArgs);
    },
    { cmd, args },
  );
}

function gridText(snapshot) {
  if (!snapshot?.cells) return "";
  return snapshot.cells.map((row) => row.map((cell) => cell?.ch ?? " ").join("")).join("\n");
}

function redactTerminalOutputEvidence(text) {
  const value = String(text ?? "");
  return {
    privacy: "raw terminal output not persisted",
    outputCharCount: value.length,
    outputSha256: createHash("sha256").update(value).digest("hex"),
    markerPresent: value.includes(MARKER),
  };
}

function identityKeys(session) {
  return [session?.id, session?.session_id, session?.sessionId, session?.pty_id, session?.ptyId]
    .filter((value) => typeof value === "string" && value.length > 0)
    .map((value) => String(value));
}

async function waitForMarker(page, terminalId) {
  const deadline = Date.now() + WAIT_MS;
  let lastText = "";
  while (Date.now() < deadline) {
    const snapshot = await call(page, "term_snapshot", { id: terminalId });
    lastText = gridText(snapshot);
    if (lastText.includes(MARKER)) {
      return { markerObserved: true, outputEvidence: redactTerminalOutputEvidence(lastText) };
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 1000));
  }
  return { markerObserved: false, outputEvidence: redactTerminalOutputEvidence(lastText) };
}

function providerModel(provider) {
  if (provider === "claude") return "claude";
  if (provider === "gemini") return "gemini";
  return "codex";
}

function optInCommand() {
  return {
    command: AUTHENTICATED_PROMPT_OPERATOR_COMMAND,
    env: {
      AELYRIS_AUTH_PROMPT_PROVIDER: PROVIDER,
      AELYRIS_TAURI_CDP: CDP,
      AELYRIS_AUTH_PROMPT_APP_URL: APP_URL,
    },
  };
}

function currentGitHead() {
  const child = spawnSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" });
  const head = String(child.stdout ?? "").trim();
  return child.status === 0 ? head : "";
}

function consumeExecutionPacketBeforeCdp() {
  const packetPath = resolve(String(process.env[AUTHENTICATED_PROMPT_PACKET_ENV] ?? ""));
  const executionId = String(process.env[AUTHENTICATED_PROMPT_EXECUTION_ID_ENV] ?? "").trim();
  const canonicalCommand = String(process.env[AUTHENTICATED_PROMPT_CANONICAL_COMMAND_ENV] ?? "").trim();
  if (!executionId || packetPath !== EXPECTED_EXECUTION_PACKET_PATH || !existsSync(packetPath)) {
    return {
      ok: false,
      executionId: executionId || null,
      errors: [{ code: "packet-required", detail: "current operator execution packet is required" }],
    };
  }

  const claimPath = `${packetPath}.consuming-${executionId}`;
  try {
    renameSync(packetPath, claimPath);
    const packet = JSON.parse(readFileSync(claimPath, "utf8"));
    const nowMs = Date.now();
    const context = {
      nowMs,
      executionId,
      provider: PROVIDER,
      canonicalCommand,
      gitHead: currentGitHead(),
      promptVerifierSha256: createHash("sha256").update(readFileSync(PROMPT_VERIFIER_PATH)).digest("hex"),
    };
    const validation = validateAuthenticatedPromptExecutionPacket(packet, context);
    if (!validation.ok) {
      writeFileSync(
        packetPath,
        `${JSON.stringify({ ...packet, status: "rejected", rejectedAt: new Date(nowMs).toISOString(), validationErrors: validation.errors }, null, 2)}\n`,
      );
      return { ok: false, executionId, errors: validation.errors, checks: validation.checks };
    }
    const consumed = consumeAuthenticatedPromptExecutionPacket(packet, context);
    writeFileSync(packetPath, `${JSON.stringify(consumed, null, 2)}\n`);
    return {
      ok: true,
      executionId,
      provider: PROVIDER,
      canonicalCommand,
      packetConsumedBeforeCdp: true,
      checks: validation.checks,
    };
  } catch (error) {
    return {
      ok: false,
      executionId,
      errors: [{ code: "packet-consume", detail: error instanceof Error ? error.message : String(error) }],
    };
  } finally {
    if (existsSync(claimPath)) unlinkSync(claimPath);
  }
}

async function main() {
  const report = {
    version: 1,
    ok: false,
    status: "running",
    startedAt: new Date().toISOString(),
    cdp: CDP,
    appUrl: APP_URL,
    projectPath: PROJECT_PATH,
    provider: PROVIDER,
    marker: MARKER,
    wouldSpendTokens: true,
    tokenSpendingPromptExecutedByThisRun: false,
    checks: {},
    errors: [],
  };
  const noTokenPreflight = buildNoTokenPreflight(PROVIDER);
  report.nonTokenPreflight = noTokenPreflight;

  if (process.env.AELYRIS_AUTH_PROMPT_CONSENT !== CONSENT_PHRASE) {
    report.status = "requires_opt_in";
    report.checks = {
      consent: false,
      requiredEnv: "AELYRIS_AUTH_PROMPT_PROVIDER=codex|claude|gemini",
      tokenSpendingExecutionBlocked: true,
      safeNoPromptSent: true,
      consentPacketReady: true,
      nonTokenPreflightReady: noTokenPreflight.ready,
      runtimeReadiness: noTokenPreflight.ready
        ? "preflight_artifacts_green_without_prompt"
        : "preflight_artifacts_incomplete_without_prompt",
    };
    report.nonTokenPreflight = noTokenPreflight;
    report.nextCommand = optInCommand();
    const artifact = writeArtifact(report);
    console.error(`authenticated AI CLI prompt smoke is internal; use ${AUTHENTICATED_PROMPT_OPERATOR_COMMAND}: ${artifact}`);
    process.exit(2);
  }

  if (!PROVIDER_EXPLICIT || !SUPPORTED_PROVIDERS.has(PROVIDER)) {
    report.status = PROVIDER_EXPLICIT ? "unsupported_provider" : "provider_required";
    report.checks = {
      consent: true,
      requiredEnv: `AELYRIS_AUTH_PROMPT_CONSENT=${CONSENT_PHRASE} AELYRIS_AUTH_PROMPT_PROVIDER=codex|claude|gemini`,
      explicitProvider: PROVIDER_EXPLICIT,
      supportedProvider: SUPPORTED_PROVIDERS.has(PROVIDER),
      tokenSpendingExecutionBlocked: true,
      safeNoPromptSent: true,
      consentPacketReady: false,
      nonTokenPreflightReady: noTokenPreflight.ready,
      preflightReadyBeforePrompt: false,
      runtimeReadiness: PROVIDER_EXPLICIT
        ? "unsupported_provider_blocked_before_prompt"
        : "explicit_provider_required_before_prompt",
    };
    report.nextCommand = optInCommand();
    const artifact = writeArtifact(report);
    console.error(
      `authenticated AI CLI prompt smoke blocked before prompt by missing/unsupported provider: ${artifact}`,
    );
    process.exit(4);
  }

  const executionAuthority = consumeExecutionPacketBeforeCdp();
  report.executionAuthority = executionAuthority;
  if (!executionAuthority.ok) {
    report.status = "execution_packet_required";
    report.checks = {
      consent: true,
      explicitProvider: true,
      tokenSpendingExecutionBlocked: true,
      safeNoPromptSent: true,
      consentPacketReady: false,
      executionPacketValidated: false,
      executionPacketConsumedBeforeCdp: false,
      nonTokenPreflightReady: true,
      preflightReadyBeforePrompt: false,
    };
    const artifact = writeArtifact(report);
    console.error(`authenticated AI CLI prompt smoke requires a current one-use execution packet: ${artifact}`);
    process.exit(5);
  }

  if (!noTokenPreflight.ready) {
    report.status = "preflight_blocked";
    report.checks = {
      consent: true,
      requiredEnv: "AELYRIS_AUTH_PROMPT_PROVIDER=codex|claude|gemini",
      tokenSpendingExecutionBlocked: true,
      safeNoPromptSent: true,
      consentPacketReady: false,
      executionPacketValidated: true,
      executionPacketConsumedBeforeCdp: true,
      nonTokenPreflightReady: false,
      preflightReadyBeforePrompt: false,
      runtimeReadiness: "preflight_artifacts_incomplete_before_prompt",
    };
    const artifact = writeArtifact(report);
    console.error(`authenticated AI CLI prompt smoke blocked before prompt by stale/incomplete preflight: ${artifact}`);
    process.exit(3);
  }

  ({ chromium } = await import("@playwright/test"));

  let browser;
  let page = null;
  let sessionId = null;
  let ptyId = null;
  let baselineSessionKeys = new Set();
  const recordCleanup = async (label) => {
    if (!page || !sessionId) {
      return { label, checked: false, reason: "page_or_session_unavailable", sessionId, ptyId };
    }
    const result = { label, checked: false, attemptedStop: true, sessionId, ptyId };
    try {
      await call(page, "stop_interactive_agent", { id: sessionId });
    } catch (error) {
      result.stopError = error instanceof Error ? error.message : String(error);
    }
    try {
      const remaining = await call(page, "list_interactive_agents");
      const remainingSessions = Array.isArray(remaining) ? remaining : [];
      const unexpectedSessions = remainingSessions.filter((item) => {
        const keys = identityKeys(item);
        const isBaseline = keys.some((key) => baselineSessionKeys.has(key));
        const isSpawned = keys.some((key) => key === sessionId || key === ptyId);
        return !isBaseline && !isSpawned;
      });
      result.checked = true;
      result.remainingSessions = remainingSessions.length;
      result.baselineSessions = baselineSessionKeys.size;
      result.unexpectedNewSessions = unexpectedSessions.length;
      result.stillPresent = remainingSessions.some((item) =>
        identityKeys(item).some((key) => key === sessionId || key === ptyId),
      );
    } catch (error) {
      result.listError = error instanceof Error ? error.message : String(error);
    }
    return result;
  };
  try {
    const connected = await connectWithWait();
    browser = connected.browser;
    report.cdpWaitedMs = connected.waitedMs;
    const ready = await waitForAelyrisPage(browser);
    page = ready.page;
    const pages = ready.pages;
    report.pages = pages.map((candidate) => candidate.url());
    await page.bringToFront().catch(() => {});
    await waitForAppReady(page);
    try {
      const beforeSessions = await call(page, "list_interactive_agents");
      const sessions = Array.isArray(beforeSessions) ? beforeSessions : [];
      baselineSessionKeys = new Set(sessions.flatMap(identityKeys));
      report.sessionBaseline = {
        checked: true,
        sessions: sessions.length,
        identityKeys: baselineSessionKeys.size,
      };
    } catch (error) {
      report.sessionBaseline = {
        checked: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }

    report.tokenSpendingPromptExecutedByThisRun = true;
    const spawnResult = await call(page, "spawn_interactive_agent", {
      cwd: PROJECT_PATH,
      model: providerModel(PROVIDER),
      initialPrompt: PROMPT,
      branchName: null,
      cols: 100,
      rows: 28,
    });
    sessionId = spawnResult.session_id ?? spawnResult.sessionId ?? spawnResult.pty_id ?? spawnResult.ptyId;
    ptyId = spawnResult.pty_id ?? spawnResult.ptyId ?? sessionId;
    const markerResult = await waitForMarker(page, ptyId);
    const cleanupAfterSuccess = await recordCleanup("success");

    report.spawnResult = spawnResult;
    report.outputEvidence = markerResult.outputEvidence;
    report.cleanupAfterSuccess = cleanupAfterSuccess;
    report.checks = {
      consent: true,
      executionPacketValidated: true,
      executionPacketConsumedBeforeCdp: true,
      nonTokenPreflightReady: true,
      preflightReadyBeforePrompt: true,
      sessionBaseline: report.sessionBaseline?.checked === true,
      spawned: typeof sessionId === "string" && typeof ptyId === "string",
      sidecarBackend: ACCEPTED_AGENT_BACKENDS.has(String(spawnResult.backend ?? "")),
      promptMarkerObserved: markerResult.markerObserved,
      cleanup:
        cleanupAfterSuccess.checked === true &&
        cleanupAfterSuccess.stillPresent === false &&
        cleanupAfterSuccess.unexpectedNewSessions === 0 &&
        !cleanupAfterSuccess.stopError &&
        !cleanupAfterSuccess.listError,
    };
    const failed = Object.entries(report.checks).filter(([, ok]) => ok !== true);
    if (failed.length > 0) {
      throw new Error(`authenticated prompt smoke failed checks: ${failed.map(([name]) => name).join(", ")}`);
    }
    report.ok = true;
    report.status = "pass";
  } catch (error) {
    report.status = "failed";
    report.errors.push(error instanceof Error ? error.stack || error.message : String(error));
    if (sessionId) {
      report.cleanupAttempted = true;
      report.cleanupAfterFailure = await recordCleanup("failure");
    }
    process.exitCode = 1;
  } finally {
    const cdpShutdown = {
      browserCloseRequested: process.env.AELYRIS_AUTH_PROMPT_CLOSE_BROWSER === "1",
      cdpDetached: false,
      browserClosed: false,
      error: null,
    };
    if (browser) {
      try {
        if (cdpShutdown.browserCloseRequested) {
          await browser.close();
          cdpShutdown.browserClosed = true;
        } else if (typeof browser.disconnect === "function") {
          await browser.disconnect();
          cdpShutdown.cdpDetached = true;
        }
      } catch (error) {
        cdpShutdown.error = error instanceof Error ? error.message : String(error);
      }
    }
    report.cdpShutdown = cdpShutdown;
    const artifact = writeArtifact(report);
    if (report.ok) {
      console.log(`authenticated AI CLI prompt smoke passed: ${artifact}`);
    } else {
      console.error(`authenticated AI CLI prompt smoke ${report.status}: ${artifact}`);
    }
    process.exit(report.ok ? 0 : process.exitCode || 1);
  }
}

await main();
