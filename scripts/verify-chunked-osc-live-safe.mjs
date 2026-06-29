import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import net from "node:net";
import { dirname, join, resolve } from "node:path";
import process from "node:process";

const ROOT = resolve(process.cwd());
const STRICT_SCRIPT = join(ROOT, "scripts", "verify-chunked-osc-live.mjs");
const PRIMARY_ARTIFACT = join(ROOT, ".codex-auto", "production-smoke", "chunked-osc-live.json");
const ENV_BLOCKED_ARTIFACT = join(ROOT, ".codex-auto", "production-smoke", "chunked-osc-live.environment-blocked.json");
const DEFAULT_TIMEOUT_MS = Number(process.env.AELYRIS_CHUNKED_OSC_SAFE_TIMEOUT_MS ?? 45_000);
const CDP = process.env.AELYRIS_TAURI_CDP ?? "http://127.0.0.1:9222";

const sourceFiles = [
  "scripts/verify-chunked-osc-live.mjs",
  "scripts/aelyris-imgcat.ps1",
  "scripts/aelyris-imgcat.sh",
  "e2e/fixtures/inline-image-1x1.png",
  "e2e/fixtures/inline-image-32x32.png",
].map((path) => {
  const fullPath = join(ROOT, path);
  return {
    path,
    exists: existsSync(fullPath),
    mtimeMs: existsSync(fullPath) ? statSync(fullPath).mtimeMs : 0,
  };
});

function readJson(path) {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    return {
      parseError: error instanceof Error ? error.message : String(error),
    };
  }
}

function outputTail(value) {
  const text = String(value ?? "").trim();
  return text.length > 5000 ? text.slice(-5000) : text;
}

function isEnvironmentBlocked(text, errorCode) {
  return (
    errorCode === "EPERM" ||
    /connect ECONNREFUSED|Cannot attach to WebView2 CDP|browserType\.connectOverCDP|retrieving websocket url|TCP timeout|spawn EPERM|ETIMEDOUT/i.test(
      text,
    )
  );
}

function cdpEndpoint() {
  try {
    const url = new URL(CDP);
    return {
      ok: true,
      host: url.hostname,
      port: Number(url.port || (url.protocol === "https:" ? 443 : 80)),
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function checkCdpReachable(timeoutMs = 1500) {
  const endpoint = cdpEndpoint();
  if (!endpoint.ok) {
    return Promise.resolve({ ok: false, code: "INVALID_CDP_URL", message: endpoint.error });
  }
  return new Promise((resolveCheck) => {
    const socket = net.createConnection({ host: endpoint.host, port: endpoint.port });
    const done = (result) => {
      socket.removeAllListeners();
      socket.destroy();
      resolveCheck(result);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => done({ ok: true }));
    socket.once("timeout", () => done({ ok: false, code: "ETIMEDOUT", message: `TCP timeout connecting to ${CDP}` }));
    socket.once("error", (error) =>
      done({
        ok: false,
        code: error?.code ?? "CDP_CONNECT_ERROR",
        message: error instanceof Error ? error.message : String(error),
      }),
    );
  });
}

function writeEnvironmentBlockedReport(child, combinedOutput) {
  const primary = readJson(PRIMARY_ARTIFACT);
  const primaryExists = existsSync(PRIMARY_ARTIFACT);
  const sourceCutoffMs = Math.max(...sourceFiles.map((file) => file.mtimeMs));
  const primaryMtimeMs = primaryExists ? statSync(PRIMARY_ARTIFACT).mtimeMs : 0;
  const primarySourceFresh = primaryMtimeMs + 5000 >= sourceCutoffMs;
  const primaryStillProvesLastLiveRun =
    primaryExists &&
    primary?.ok === true &&
    primary?.status === "pass-current-chunked-osc-live-contract" &&
    primary?.checks?.allCasesPassed === true &&
    primary?.checks?.shellsCovered === true &&
    primary?.checks?.pngSignatureVerified === true &&
    primarySourceFresh;
  const environmentBlocked = isEnvironmentBlocked(combinedOutput, child.error?.code);
  const report = {
    version: 1,
    generatedAt: new Date().toISOString(),
    ok: false,
    status: environmentBlocked ? "environment-blocked" : "failed",
    preservesPrimaryArtifact: true,
    strictCommand: "node scripts/verify-chunked-osc-live.mjs",
    cdp: CDP,
    exitCode: child.status ?? null,
    errorCode: child.error?.code ?? null,
    timedOut: child.error?.code === "ETIMEDOUT",
    stdoutTail: outputTail(child.stdout),
    stderrTail: outputTail([child.stderr, child.error?.message].filter(Boolean).join("\n")),
    errors: [combinedOutput].filter(Boolean),
    sourceContract: {
      sourceCutoffMs,
      files: sourceFiles,
    },
    primaryArtifact: {
      path: ".codex-auto/production-smoke/chunked-osc-live.json",
      exists: primaryExists,
      mtimeMs: primaryMtimeMs,
      sourceFresh: primarySourceFresh,
      stillProvesLastLiveRun: primaryStillProvesLastLiveRun,
      ok: primary?.ok === true,
      status: primary?.status ?? null,
      generatedAt: primary?.generatedAt ?? null,
      parseError: primary?.parseError ?? null,
    },
    nextRequiredAction: environmentBlocked
      ? "Start pnpm tauri dev with AELYRIS_TAURI_CDP reachable, then rerun pnpm verify:terminal:chunked-osc-live."
      : "Inspect the strict verifier failure, fix the live inline-image path, and rerun pnpm verify:terminal:chunked-osc-live.",
  };
  mkdirSync(dirname(ENV_BLOCKED_ARTIFACT), { recursive: true });
  writeFileSync(ENV_BLOCKED_ARTIFACT, `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

if (process.env.AELYRIS_CHUNKED_OSC_SKIP_CDP_PREFLIGHT !== "1") {
  const cdpPreflight = await checkCdpReachable();
  if (cdpPreflight.ok !== true) {
    const child = {
      status: null,
      stdout: "",
      stderr: `CDP preflight failed for ${CDP}: ${cdpPreflight.message}`,
      error: { code: cdpPreflight.code ?? "CDP_UNREACHABLE" },
    };
    const report = writeEnvironmentBlockedReport(child, child.stderr);
    console.error(JSON.stringify({ artifact: ENV_BLOCKED_ARTIFACT, ...report }, null, 2));
    process.exit(1);
  }
}

const child = spawnSync(process.execPath, [STRICT_SCRIPT], {
  cwd: ROOT,
  env: process.env,
  encoding: "utf8",
  timeout: DEFAULT_TIMEOUT_MS,
});

if (child.status === 0) {
  if (child.stdout) process.stdout.write(child.stdout);
  if (child.stderr) process.stderr.write(child.stderr);
  process.exit(0);
}

const combinedOutput = [child.stdout, child.stderr, child.error?.message].filter(Boolean).join("\n");
const report = writeEnvironmentBlockedReport(child, combinedOutput);
console.error(JSON.stringify({ artifact: ENV_BLOCKED_ARTIFACT, ...report }, null, 2));
process.exit(child.status ?? 1);
