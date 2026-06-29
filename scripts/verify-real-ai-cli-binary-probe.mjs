// Real AI CLI binary probe through the PTY sidecar.
//
// This verifier intentionally avoids prompts and model calls. It runs
// `codex --version`, `claude --version`, and `gemini --version` inside a
// sidecar PTY, captures their output, and records which real binaries are
// installed and launchable. It is a product-confidence gate for PATH/auth
// boundary truth, not a substitute for full authenticated interactive CLI QA.

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const EXTENSION = process.platform === "win32" ? ".exe" : "";
const SIDECAR =
  process.env.AETHER_REAL_AI_CLI_SIDECAR ??
  join(ROOT, "src-tauri", "pty-server", "target", "release", `aether-pty-server${EXTENSION}`);
const OUT =
  process.env.AETHER_REAL_AI_CLI_OUT ?? join(ROOT, ".codex-auto", "production-smoke", "real-ai-cli-binary-probe.json");
const TOKEN = process.env.AETHER_REAL_AI_CLI_TOKEN ?? "real-ai-cli-probe-token";
const WAIT_MS = Number.parseInt(process.env.AETHER_REAL_AI_CLI_WAIT_MS ?? "60000", 10);
const MAX_ATTEMPTS = Math.max(1, Number.parseInt(process.env.AETHER_REAL_AI_CLI_MAX_ATTEMPTS ?? "2", 10));
const CLIS = ["codex", "claude", "gemini"];
const EXISTING_BASE = process.env.AETHER_REAL_AI_CLI_BASE?.replace(/\/+$/, "") ?? null;

if (!existsSync(SIDECAR)) {
  throw new Error(
    `PTY sidecar not found: ${SIDECAR}\nRun "cargo build --manifest-path src-tauri/pty-server/Cargo.toml --release" first.`,
  );
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function freePort() {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : undefined;
      server.close(() => (port ? resolve(port) : reject(new Error("no port assigned"))));
    });
  });
}

function startSidecar(port, tempRoot) {
  const child = spawn(SIDECAR, [], {
    cwd: ROOT,
    env: {
      ...process.env,
      QUORUM_API_TOKEN: TOKEN,
      QUORUM_PTY_SERVER_PORT: String(port),
      QUORUM_MUX_SNAPSHOT_DIR: join(tempRoot, "mux"),
      QUORUM_PTY_SCROLLBACK_DIR: join(tempRoot, "scrollback"),
    },
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  const output = { stdout: "", stderr: "" };
  child.stdout?.on("data", (chunk) => {
    output.stdout += chunk.toString();
  });
  child.stderr?.on("data", (chunk) => {
    output.stderr += chunk.toString();
  });
  return { child, output };
}

function killProcess(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.kill();
  if (process.platform === "win32" && child.pid) {
    spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    });
  }
}

function environmentBlockedReason(report) {
  const text = report.errors.join("\n");
  if (/spawn\s+EPERM|operation not permitted/i.test(text)) return "sidecar-spawn-blocked";
  if (/ECONNREFUSED|sidecar did not become ready|fetch failed/i.test(text)) return "sidecar-unreachable";
  return null;
}

function writeEnvironmentBlockedArtifact(report) {
  const outPath = `${OUT}.environment-blocked.json`;
  writeFileSync(
    outPath,
    `${JSON.stringify(
      {
        ...report,
        status: "environment-blocked",
        environmentBlockedReason: environmentBlockedReason(report),
        preservesPrimaryArtifact: true,
        finishedAt: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
  );
  return outPath;
}

async function request(base, path, options = {}) {
  const response = await fetch(`${base}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`${options.method ?? "GET"} ${path} -> ${response.status}: ${body}`);
  }
  if (response.status === 204) return null;
  return await response.json();
}

async function waitForReady(base) {
  let lastError;
  for (let i = 0; i < 120; i += 1) {
    try {
      return await request(base, "/daemon/contract");
    } catch (error) {
      lastError = error;
      await sleep(100);
    }
  }
  throw new Error(`sidecar did not become ready: ${lastError?.message ?? "unknown"}`);
}

function pathKey() {
  return Object.keys(process.env).find((key) => key.toLowerCase() === "path") ?? "PATH";
}

function pathEntries() {
  return (process.env[pathKey()] ?? "").split(delimiter).filter(Boolean);
}

function candidateNames(cli) {
  return process.platform === "win32" ? [`${cli}.exe`, `${cli}.cmd`, `${cli}.bat`, cli] : [cli];
}

function discoverCli(cli) {
  const names = candidateNames(cli);
  const matches = [];
  for (const dir of pathEntries()) {
    for (const name of names) {
      const fullPath = join(dir, name);
      if (existsSync(fullPath)) matches.push({ name, path: fullPath });
    }
  }
  const preferred = matches[0] ?? null;
  return { cli, found: matches.length > 0, preferred, matches: matches.slice(0, 8) };
}

function commandFor(executablePath, marker) {
  if (process.platform === "win32") {
    const safePath = executablePath.replace(/"/g, "");
    return `${safePath} --version && echo ${marker} & ping -n 2 127.0.0.1 >nul`;
  }
  return `'${executablePath.replace(/'/g, "'\\''")}' --version && echo ${marker}; sleep 1`;
}

async function capture(base, id, lines = 120) {
  const captured = await request(base, `/sessions/${id}/capture?lines=${lines}&clean=true`);
  return captured.text ?? "";
}

async function waitForCapture(base, id, needle) {
  const deadline = Date.now() + WAIT_MS;
  let text = "";
  while (Date.now() < deadline) {
    text = await capture(base, id);
    if (text.includes(needle)) return text;
    await sleep(100);
  }
  throw new Error(`session ${id} did not show ${needle}; tail=${text.slice(-800)}`);
}

async function closeSession(base, id) {
  await fetch(`${base}/sessions/${id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${TOKEN}` },
    signal: AbortSignal.timeout(2500),
  }).catch(() => {});
}

function classifyVersionOutput(cli, text, marker) {
  const normalized = text.replace(/\r/g, "");
  const lines = normalized
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const markerIndex = lines.findIndex((line) => line.includes(marker));
  const beforeMarker = markerIndex >= 0 ? lines.slice(0, markerIndex) : lines;
  const commandNotFound =
    /not recognized|not found|cannot find|is not recognized|認識されていません|見つかりません|指定されたファイルが見つかりません/i.test(
      normalized,
    );
  const versionLike = beforeMarker.some((line) => /\b(v?\d+\.\d+|\d{4}\.\d{1,2}|version)\b/i.test(line));
  const usageLike = beforeMarker.some((line) => /\b(usage|options|commands)\b/i.test(line));
  const fatalLaunchError = beforeMarker.some((line) =>
    /\b(fatal error|failed to relaunch|spawn EPERM|uncaught|unhandled|traceback|exception|panic)\b/i.test(line),
  );
  return {
    cli,
    markerSeen: markerIndex >= 0,
    commandNotFound,
    versionLike,
    usageLike,
    fatalLaunchError,
    outputSample: beforeMarker.join("\n").slice(-1000),
    passed: markerIndex >= 0 && !commandNotFound && !fatalLaunchError && (versionLike || usageLike),
  };
}

async function probeCliAttempt(base, discovery, attempt) {
  if (!discovery.preferred) {
    return {
      cli: discovery.cli,
      status: "external_dependency",
      reason: "CLI executable not found on PATH",
      discovery,
    };
  }

  const marker = `AETHER_REAL_AI_CLI_${discovery.cli.toUpperCase()}_${Math.random()
    .toString(36)
    .slice(2, 8)}`.toUpperCase();
  const launcher = process.platform === "win32" ? "cmd.exe" : "sh";
  const executableCommand = process.platform === "win32" ? discovery.preferred.name : discovery.preferred.path;
  const resolvedPath =
    process.platform === "win32"
      ? [dirname(discovery.preferred.path), process.env[pathKey()] ?? ""].filter(Boolean).join(delimiter)
      : (process.env[pathKey()] ?? "");
  const launcherArgs =
    process.platform === "win32"
      ? ["/d", "/s", "/c", commandFor(executableCommand, marker)]
      : ["-lc", commandFor(executableCommand, marker)];
  const created = await request(base, "/commands", {
    method: "POST",
    body: JSON.stringify({
      program: launcher,
      args: launcherArgs,
      cols: 120,
      rows: 24,
      cwd: ROOT,
      env: {
        [pathKey()]: resolvedPath,
        AETHER_REAL_AI_CLI_PROBE: discovery.cli,
        ...(discovery.cli === "gemini" ? { GEMINI_CLI_NO_RELAUNCH: "1" } : {}),
      },
    }),
  });
  const id = created.id;
  try {
    const text = await waitForCapture(base, id, marker);
    const classified = classifyVersionOutput(discovery.cli, text, marker);
    await closeSession(base, id);
    return {
      cli: discovery.cli,
      status: classified.passed ? "pass" : "failed",
      id,
      marker,
      attempt,
      executablePath: discovery.preferred.path,
      launcher,
      launcherArgs,
      discovery,
      ...classified,
    };
  } catch (error) {
    await closeSession(base, id);
    return {
      cli: discovery.cli,
      status: "failed",
      id,
      marker,
      attempt,
      executablePath: discovery.preferred.path,
      launcher,
      launcherArgs,
      discovery,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function probeCli(base, discovery) {
  const attempts = [];
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const result = await probeCliAttempt(base, discovery, attempt);
    attempts.push(result);
    if (result.status !== "failed") {
      return {
        ...result,
        attempts,
        attemptCount: attempts.length,
        retried: attempts.length > 1,
      };
    }
    if (attempt < MAX_ATTEMPTS) {
      await sleep(500 * attempt);
    }
  }
  const last = attempts.at(-1);
  return {
    ...last,
    attempts,
    attemptCount: attempts.length,
    retried: attempts.length > 1,
  };
}

async function main() {
  const port = EXISTING_BASE ? null : await freePort();
  const base = EXISTING_BASE ?? `http://127.0.0.1:${port}`;
  const tempRoot = join(ROOT, ".codex-auto", "production-smoke", `real-ai-cli-${Date.now()}`);
  mkdirSync(tempRoot, { recursive: true });
  mkdirSync(dirname(OUT), { recursive: true });

  const report = {
    version: 1,
    ok: false,
    status: "running",
    startedAt: new Date().toISOString(),
    sidecar: SIDECAR,
    base,
    externalSidecar: EXISTING_BASE !== null,
    maxAttempts: MAX_ATTEMPTS,
    checks: {},
    errors: [],
  };
  let proc = null;
  try {
    if (!EXISTING_BASE) {
      proc = startSidecar(port, tempRoot);
    }
    const contract = await waitForReady(base);
    report.checks.daemonReady = true;
    report.checks.commandSessionCapability = Array.isArray(contract.capabilities)
      ? contract.capabilities.includes("command-session")
      : false;
    if (!report.checks.commandSessionCapability) {
      throw new Error("sidecar contract is missing command-session capability");
    }

    report.checks.discovery = CLIS.map(discoverCli);
    report.checks.clis = [];
    for (const discovery of report.checks.discovery) {
      report.checks.clis.push(await probeCli(base, discovery));
    }

    const failed = report.checks.clis.filter((entry) => entry.status === "failed");
    const missing = report.checks.clis.filter((entry) => entry.status === "external_dependency");
    report.checks.passCount = report.checks.clis.filter((entry) => entry.status === "pass").length;
    report.checks.missingCount = missing.length;
    report.status = failed.length > 0 ? "failed" : missing.length > 0 ? "external_dependency" : "pass";
    report.ok = report.status === "pass";
    if (failed.length > 0) {
      throw new Error(`Real AI CLI probe failed: ${failed.map((entry) => entry.cli).join(", ")}`);
    }
  } catch (error) {
    report.errors.push(error instanceof Error ? error.stack || error.message : String(error));
    if (report.status === "running") report.status = "failed";
    process.exitCode = 1;
  } finally {
    if (proc) {
      report.sidecarOutput = {
        stdoutTail: proc.output.stdout.slice(-4000),
        stderrTail: proc.output.stderr.slice(-4000),
      };
      killProcess(proc.child);
    }
    report.finishedAt = new Date().toISOString();
    if (!report.ok && environmentBlockedReason(report)) {
      report.environmentBlockedArtifact = writeEnvironmentBlockedArtifact(report);
    } else {
      writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`);
    }
    if (process.env.AETHER_KEEP_REAL_AI_CLI_TEMP !== "1") {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  }

  if (report.status === "pass") {
    console.log(`real AI CLI binary probe passed: ${OUT}`);
  } else if (report.status === "external_dependency") {
    console.warn(`real AI CLI binary probe found external dependencies: ${OUT}`);
    process.exitCode = 2;
  } else if (environmentBlockedReason(report)) {
    console.error(`real AI CLI binary probe environment-blocked; primary artifact preserved: ${report.environmentBlockedArtifact}`);
  } else {
    console.error(`real AI CLI binary probe failed: ${OUT}`);
  }
}

await main();
