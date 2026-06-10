import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import process from "node:process";

const ROOT = resolve(process.cwd());
const OUT = join(ROOT, ".codex-auto", "production-smoke", "authenticated-ai-cli-provider-required-smoke.json");
const CONSENT_PHRASE = "I_UNDERSTAND_THIS_MAY_SPEND_TOKENS";

function readJson(path) {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, data) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
}

const env = { ...process.env };
env.AETHER_AUTH_PROMPT_CONSENT = CONSENT_PHRASE;
env.AETHER_AUTH_PROMPT_OUT = OUT;
delete env.AETHER_AUTH_PROMPT_PROVIDER;

const child = spawnSync(process.execPath, [join(ROOT, "scripts", "verify-authenticated-ai-cli-prompt-smoke.mjs")], {
  cwd: ROOT,
  env,
  encoding: "utf8",
});
const childSpawnBlocked =
  child.status == null &&
  (child.error != null ||
    /spawn\s+EPERM|operation not permitted/i.test(`${child.stderr ?? ""}\n${child.stdout ?? ""}`));
const report = readJson(OUT) ?? {
  version: 1,
  ok: false,
  status: "missing_artifact",
  errors: [],
};

const checks = {
  exitCode: child.status === 4 || (childSpawnBlocked && report.status === "provider_required"),
  providerRequired: report.status === "provider_required",
  explicitProviderRejected: report.checks?.explicitProvider === false,
  tokenBlocked: report.checks?.tokenSpendingExecutionBlocked === true,
  noPromptSent: report.checks?.safeNoPromptSent === true,
  promptNotReached: report.checks?.preflightReadyBeforePrompt === false,
  noSessionSpawned: report.spawnResult == null && report.cdpWaitedMs == null && report.pages == null,
};
const ok = Object.values(checks).every(Boolean);
const output = {
  ...report,
  guardVerifier: {
    ok,
    generatedAt: new Date().toISOString(),
    checks,
    childExitCode: child.status,
    childSpawnBlocked,
    stdoutTail: String(child.stdout ?? "").slice(-1000),
    stderrTail: String(child.stderr ?? "").slice(-1000),
  },
};

writeJson(OUT, output);
console.log(JSON.stringify({ artifact: OUT, ...output.guardVerifier }, null, 2));
if (!ok) process.exitCode = 1;
