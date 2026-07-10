import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import process from "node:process";
import {
  AUTHENTICATED_PROMPT_CANONICAL_COMMAND_ENV,
  AUTHENTICATED_PROMPT_CONSENT_PHRASE,
  AUTHENTICATED_PROMPT_EXECUTION_ID_ENV,
  AUTHENTICATED_PROMPT_OPERATOR_COMMAND,
  AUTHENTICATED_PROMPT_PACKET_ENV,
  AUTHENTICATED_PROMPT_RAW_SCRIPT,
  AUTHENTICATED_PROMPT_SUPPORTED_PROVIDERS,
  issueAuthenticatedPromptExecutionPacket,
} from "./lib/authenticated-prompt-authority.mjs";

const ROOT = resolve(process.cwd());
const PACKET_PATH = join(ROOT, ".codex-auto", "production-smoke", "authenticated-ai-cli-token-execution-packet.json");
const SUMMARY_PATH = join(ROOT, ".codex-auto", "production-smoke", "authenticated-ai-cli-token-execution-summary.json");
const PROMPT_ARTIFACT_PATH = join(ROOT, ".codex-auto", "production-smoke", "authenticated-ai-cli-prompt-smoke.json");
const PROMPT_VERIFIER_PATH = join(ROOT, "scripts", AUTHENTICATED_PROMPT_RAW_SCRIPT);

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function readJson(path) {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function gitHead() {
  const child = spawnSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" });
  const head = String(child.stdout ?? "").trim();
  if (child.status !== 0 || !/^[0-9a-f]{40}$/i.test(head)) {
    throw new Error("TOKEN_OPERATOR_REJECTED: unable to bind consent packet to Git HEAD");
  }
  return head;
}

const generatedAt = new Date().toISOString();
const provider = String(process.env.AELYRIS_AUTH_PROMPT_PROVIDER ?? "")
  .trim()
  .toLowerCase();
const executionId = randomUUID();
const promptVerifierSha256 = sha256File(PROMPT_VERIFIER_PATH);
let packet = null;
let child = null;
let error = null;

try {
  if (!AUTHENTICATED_PROMPT_SUPPORTED_PROVIDERS.includes(provider)) {
    throw new Error("TOKEN_OPERATOR_REJECTED: set AELYRIS_AUTH_PROMPT_PROVIDER=codex|claude|gemini explicitly");
  }
  const head = gitHead();
  packet = issueAuthenticatedPromptExecutionPacket({
    executionId,
    provider,
    gitHead: head,
    promptVerifierSha256,
    issuedAtMs: Date.now(),
  });
  writeJson(PACKET_PATH, packet);

  const env = {
    ...process.env,
    AELYRIS_AUTH_PROMPT_CONSENT: AUTHENTICATED_PROMPT_CONSENT_PHRASE,
    AELYRIS_AUTH_PROMPT_PROVIDER: provider,
    [AUTHENTICATED_PROMPT_PACKET_ENV]: PACKET_PATH,
    [AUTHENTICATED_PROMPT_EXECUTION_ID_ENV]: executionId,
    [AUTHENTICATED_PROMPT_CANONICAL_COMMAND_ENV]: AUTHENTICATED_PROMPT_OPERATOR_COMMAND,
  };
  child = spawnSync(process.execPath, [PROMPT_VERIFIER_PATH], {
    cwd: ROOT,
    env,
    stdio: "inherit",
    timeout: Number.parseInt(process.env.AELYRIS_AUTH_PROMPT_OPERATOR_TIMEOUT_MS ?? "180000", 10),
  });
  if (child.error) throw child.error;
} catch (caught) {
  error = caught instanceof Error ? caught.message : String(caught);
}

const consumedPacket = readJson(PACKET_PATH);
const promptReport = readJson(PROMPT_ARTIFACT_PATH);
const packetConsumedForInvocation =
  consumedPacket?.status === "consumed" &&
  consumedPacket?.executionId === executionId &&
  consumedPacket?.provider === provider;
const promptReportBound =
  promptReport?.executionAuthority?.executionId === executionId &&
  promptReport?.executionAuthority?.provider === provider &&
  promptReport?.executionAuthority?.packetConsumedBeforeCdp === true;
const ok = error == null && child?.status === 0 && packetConsumedForInvocation && promptReportBound;
const summary = {
  version: 1,
  generatedAt,
  finishedAt: new Date().toISOString(),
  ok,
  status: ok ? "pass" : error ? "rejected" : "failed",
  executionId,
  provider: provider || null,
  canonicalCommand: AUTHENTICATED_PROMPT_OPERATOR_COMMAND,
  gitHead: packet?.gitHead ?? null,
  promptVerifierSha256,
  packetPath: relative(ROOT, PACKET_PATH).replaceAll("\\", "/"),
  packetConsumedForInvocation,
  promptReportBound,
  tokenSpendingPromptRequestedByThisRun: packet != null,
  tokenSpendingPromptExecutedByThisRun:
    promptReportBound && promptReport?.tokenSpendingPromptExecutedByThisRun === true,
  childExitCode: child?.status ?? null,
  secretFree: true,
  rawTranscriptStored: false,
  error,
};
writeJson(SUMMARY_PATH, summary);
console.log(JSON.stringify({ artifact: SUMMARY_PATH, ...summary }, null, 2));
if (!ok) process.exitCode = error?.startsWith("TOKEN_OPERATOR_REJECTED") ? 2 : 1;
