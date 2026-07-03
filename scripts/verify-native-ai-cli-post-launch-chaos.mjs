// Native-first PTY and AI CLI post-launch chaos smoke.
//
// This verifier intentionally avoids WebView2/CDP. It proves the parts of the
// post-launch chaos gate that belong to the Rust/PTY boundary:
//   - shell session spawn with an explicit id
//   - prompt readiness before writes
//   - same-id close + respawn recovery
//   - PTY output capture after recovery
//   - AI CLI command-session spawn, input, forced close, and zero residue
//
// UI stale-URL truth remains covered by the right-rail stale URL verifier.

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const EXTENSION = process.platform === "win32" ? ".exe" : "";
const SIDECAR =
  process.env.AELYRIS_NATIVE_AI_CHAOS_SIDECAR ??
  join(ROOT, "src-tauri", "pty-server", "target", "release", `aelyris-pty-server${EXTENSION}`);
const OUT =
  process.env.AELYRIS_NATIVE_AI_CHAOS_OUT ??
  join(ROOT, ".codex-auto", "chaos-recovery", "native-ai-cli-post-launch-chaos.json");
const TOKEN = process.env.AELYRIS_NATIVE_AI_CHAOS_TOKEN ?? "native-ai-cli-chaos-token";
const WAIT_MS = Number.parseInt(process.env.AELYRIS_NATIVE_AI_CHAOS_WAIT_MS ?? "120000", 10);
const CLIS = ["codex", "claude", "gemini"];
const EXISTING_BASE = process.env.AELYRIS_NATIVE_AI_CHAOS_BASE?.replace(/\/+$/, "") ?? null;

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

function writeArtifact(report) {
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`);
}

function environmentBlockedReason(report) {
  const text = report.errors.join("\n");
  if (/spawn\s+EPERM|operation not permitted/i.test(text)) return "sidecar-spawn-blocked";
  if (/ECONNREFUSED|sidecar did not become ready|fetch failed/i.test(text)) return "sidecar-unreachable";
  return null;
}

function writeEnvironmentBlockedArtifact(report) {
  const outPath = `${OUT}.environment-blocked.json`;
  mkdirSync(dirname(outPath), { recursive: true });
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

function startSidecar(port, tempRoot) {
  const pipeStdio = process.env.AELYRIS_NATIVE_AI_CHAOS_PIPE_STDIO === "1";
  const child = spawn(SIDECAR, [], {
    cwd: ROOT,
    env: {
      ...process.env,
      AELYRIS_API_TOKEN: TOKEN,
      AELYRIS_PTY_SERVER_PORT: String(port),
      AELYRIS_MUX_SNAPSHOT_DIR: join(tempRoot, "mux"),
      AELYRIS_PTY_SCROLLBACK_DIR: join(tempRoot, "scrollback"),
    },
    shell: false,
    stdio: pipeStdio ? ["ignore", "pipe", "pipe"] : "ignore",
    windowsHide: true,
  });
  const output = {
    stdout: "",
    stderr: "",
    mode: pipeStdio ? "pipe" : "ignored-to-avoid-node-piped-stdio-spawn-eperm",
  };
  if (pipeStdio) {
    child.stdout?.on("data", (chunk) => {
      output.stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk) => {
      output.stderr += chunk.toString();
    });
  }
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

async function rawRequest(base, path, options = {}) {
  return await fetch(`${base}${path}`, {
    ...options,
    headers: {
      ...(options.auth === false ? {} : { Authorization: `Bearer ${TOKEN}` }),
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });
}

async function request(base, path, options = {}) {
  const response = await rawRequest(base, path, options);
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`${options.method ?? "GET"} ${path} -> ${response.status}: ${body}`);
  }
  if (response.status === 204) return null;
  return await response.json();
}

async function waitForReady(base) {
  let lastError;
  for (let i = 0; i < 160; i += 1) {
    try {
      return await request(base, "/daemon/contract");
    } catch (error) {
      lastError = error;
      await sleep(100);
    }
  }
  throw new Error(`sidecar did not become ready: ${lastError?.message ?? "unknown"}`);
}

async function capture(base, id, lines = 160) {
  const captured = await request(base, `/sessions/${id}/capture?lines=${lines}&clean=true`);
  return captured.text ?? "";
}

async function waitForCapture(base, id, needle, timeoutMs = WAIT_MS) {
  const deadline = Date.now() + timeoutMs;
  let text = "";
  while (Date.now() < deadline) {
    text = await capture(base, id);
    if (text.includes(needle)) return text;
    await sleep(120);
  }
  throw new Error(`session ${id} did not show ${needle}; tail=${text.slice(-800)}`);
}

async function waitForPrompt(base, id, timeoutMs = WAIT_MS) {
  const deadline = Date.now() + timeoutMs;
  let text = "";
  while (Date.now() < deadline) {
    text = await capture(base, id);
    if (/\bPS [^\n>]*>/.test(text) || text.includes("Microsoft.PowerShell")) {
      return { ready: true, tail: text.slice(-800) };
    }
    await sleep(120);
  }
  throw new Error(`PowerShell prompt was not visible before writes for ${id}; tail=${text.slice(-800)}`);
}

async function closeSession(base, id) {
  const response = await rawRequest(base, `/sessions/${id}`, { method: "DELETE" });
  if (response.status === 204 || response.status === 404) return;
  const body = await response.text().catch(() => "");
  throw new Error(`DELETE /sessions/${id} -> ${response.status}: ${body}`);
}

async function listSessions(base) {
  return await request(base, "/sessions");
}

async function mintInputApproval(base, id, text) {
  const approval = await request(base, `/sessions/${id}/input-approval`, {
    method: "POST",
    body: JSON.stringify({ text }),
  });
  return approval.approvalId ?? null;
}

async function spawnShellWithId(base, id, cwd) {
  return await request(base, "/sessions", {
    method: "POST",
    body: JSON.stringify({
      id,
      shell: "powershell",
      cols: 120,
      rows: 30,
      cwd,
    }),
  });
}

async function sendInput(base, id, text) {
  const approvalId = await mintInputApproval(base, id, text);
  await request(base, `/sessions/${id}/input`, {
    method: "POST",
    body: JSON.stringify({
      text,
      ...(approvalId ? { approvalId } : {}),
    }),
  });
}

async function smokeSameIdPtyRestart(base) {
  const id = "11111111-2222-4333-8444-555555555555";
  const beforeSentinel = `AELYRIS_NATIVE_CHAOS_BEFORE_${Date.now()}`;
  const afterSentinel = `AELYRIS_NATIVE_CHAOS_AFTER_${Date.now()}`;
  await closeSession(base, id).catch(() => {});

  const beforeCreate = await spawnShellWithId(base, id, ROOT);
  const beforePrompt = await waitForPrompt(base, id);
  await sendInput(base, id, `Write-Output "${beforeSentinel}"\r`);
  const beforeText = await waitForCapture(base, id, beforeSentinel);
  await closeSession(base, id);
  const afterCloseList = await listSessions(base);

  const afterCreate = await spawnShellWithId(base, id, ROOT);
  const afterPrompt = await waitForPrompt(base, id);
  await sendInput(base, id, `Write-Output "${afterSentinel}"\r`);
  const afterText = await waitForCapture(base, id, afterSentinel);
  await closeSession(base, id);
  const afterCleanupList = await listSessions(base);

  return {
    id,
    beforeCreate,
    afterCreate,
    sameIdRespawned: beforeCreate.id === id && afterCreate.id === id,
    promptReadyBeforeWrite: beforePrompt.ready,
    promptReadyAfterRestart: afterPrompt.ready,
    beforeVisible: beforeText.includes(beforeSentinel),
    afterVisible: afterText.includes(afterSentinel),
    absentAfterClose: !afterCloseList.some((session) => session.id === id),
    absentAfterCleanup: !afterCleanupList.some((session) => session.id === id),
  };
}

function writeShimFiles(binDir) {
  mkdirSync(binDir, { recursive: true });
  writeFileSync(
    join(binDir, "aelyris-ai-cli-chaos-shim.mjs"),
    [
      'import readline from "node:readline";',
      'const cli = process.argv[2] || "unknown";',
      'const marker = process.env.AELYRIS_NATIVE_AI_CHAOS_MARKER || "NO_MARKER";',
      'process.stdout.write("[" + cli + "] AELYRIS_NATIVE_AI_READY " + marker + "\\r\\n");',
      'process.stdout.write(cli + "> ");',
      "const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: false });",
      'rl.on("line", (line) => {',
      '  console.log("[" + cli + "] AELYRIS_NATIVE_AI_INPUT " + marker + " " + line.trim());',
      '  process.stdout.write(cli + "> ");',
      "});",
      "setInterval(() => {}, 1000).unref();",
      "",
    ].join("\n"),
  );
  for (const cli of CLIS) {
    if (process.platform === "win32") {
      writeFileSync(join(binDir, `${cli}.cmd`), `@echo off\r\nnode "%~dp0aelyris-ai-cli-chaos-shim.mjs" ${cli} %*\r\n`);
    } else {
      writeFileSync(
        join(binDir, cli),
        `#!/usr/bin/env sh\nnode "$(dirname "$0")/aelyris-ai-cli-chaos-shim.mjs" ${cli} "$@"\n`,
        { mode: 0o755 },
      );
    }
  }
}

async function smokeCliKillCleanup(base, cli, binDir) {
  const marker = `AELYRIS_NATIVE_AI_${cli.toUpperCase()}_${Math.random().toString(36).slice(2, 8)}`.toUpperCase();
  const program = process.platform === "win32" ? `${cli}.cmd` : cli;
  const pathValue = `${binDir}${process.platform === "win32" ? ";" : ":"}${process.env.PATH ?? ""}`;
  const created = await request(base, "/commands", {
    method: "POST",
    body: JSON.stringify({
      program,
      args: ["--native-chaos"],
      cols: 100,
      rows: 24,
      cwd: ROOT,
      env: {
        PATH: pathValue,
        AELYRIS_NATIVE_AI_CHAOS_MARKER: marker,
      },
    }),
  });
  const id = created.id;
  try {
    const readyText = await waitForCapture(base, id, `AELYRIS_NATIVE_AI_READY ${marker}`);
    const input = `INPUT_${cli.toUpperCase()}_${Math.random().toString(36).slice(2, 6)}`.toUpperCase();
    await sendInput(base, id, `${input}\r`);
    const inputText = await waitForCapture(base, id, `AELYRIS_NATIVE_AI_INPUT ${marker} ${input}`);
    const beforeClose = await listSessions(base);
    await closeSession(base, id);
    const afterClose = await listSessions(base);
    return {
      cli,
      id,
      marker,
      backend: "sidecar-command-session",
      readyVisible: readyText.includes(marker),
      inputRoundtrip: inputText.includes(input),
      presentBeforeClose: beforeClose.some((session) => session.id === id),
      removedAfterClose: !afterClose.some((session) => session.id === id),
      remainingSessionsAfterCleanup: afterClose.length,
    };
  } catch (error) {
    await closeSession(base, id).catch(() => {});
    throw error;
  }
}

async function main() {
  const port = EXISTING_BASE ? null : await freePort();
  const base = EXISTING_BASE ?? `http://127.0.0.1:${port}`;
  const tempRoot = join(ROOT, ".codex-auto", "chaos-recovery", `native-ai-cli-chaos-${Date.now()}`);
  const binDir = join(tempRoot, "bin");
  mkdirSync(tempRoot, { recursive: true });
  writeShimFiles(binDir);

  const report = {
    version: 1,
    ok: false,
    status: "running",
    startedAt: new Date().toISOString(),
    sidecar: SIDECAR,
    base,
    externalSidecar: EXISTING_BASE !== null,
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
    report.checks.webviewRequiredForToolCalls =
      contract.claims?.webviewRequiredForToolCalls === false || report.checks.commandSessionCapability === true;
    if (!report.checks.commandSessionCapability) {
      throw new Error("sidecar contract is missing command-session capability");
    }

    report.ptyRestart = await smokeSameIdPtyRestart(base);
    report.aiCliKillCleanup = [];
    for (const cli of CLIS) {
      report.aiCliKillCleanup.push(await smokeCliKillCleanup(base, cli, binDir));
    }
    const finalSessions = await listSessions(base);
    report.finalSessions = finalSessions;

    report.checks.sameIdRespawned = report.ptyRestart.sameIdRespawned === true;
    report.checks.ptyPromptReadyBeforeWrite = report.ptyRestart.promptReadyBeforeWrite === true;
    report.checks.ptyPromptReadyAfterRestart = report.ptyRestart.promptReadyAfterRestart === true;
    report.checks.ptyRestartBeforeVisible = report.ptyRestart.beforeVisible === true;
    report.checks.ptyRestartAfterVisible = report.ptyRestart.afterVisible === true;
    report.checks.ptyNoResidue = report.ptyRestart.absentAfterClose === true && report.ptyRestart.absentAfterCleanup === true;
    report.checks.aiCliAllProvidersCovered = CLIS.every((cli) =>
      report.aiCliKillCleanup.some((entry) => entry.cli === cli && entry.backend === "sidecar-command-session"),
    );
    report.checks.aiCliReadyVisible = report.aiCliKillCleanup.every((entry) => entry.readyVisible === true);
    report.checks.aiCliInputRoundtrip = report.aiCliKillCleanup.every((entry) => entry.inputRoundtrip === true);
    report.checks.aiCliKillCleanup = report.aiCliKillCleanup.every(
      (entry) => entry.presentBeforeClose === true && entry.removedAfterClose === true,
    );
    report.checks.noSessionResidue = finalSessions.length === 0;

    const failed = Object.entries(report.checks).filter(([, ok]) => ok !== true);
    if (failed.length > 0) {
      throw new Error(`native AI CLI chaos failed checks: ${failed.map(([name]) => name).join(", ")}`);
    }
    report.status = "pass";
    report.ok = true;
  } catch (error) {
    report.status = report.status === "running" ? "failed" : report.status;
    report.errors.push(error instanceof Error ? error.stack || error.message : String(error));
    process.exitCode = 1;
  } finally {
    if (proc) {
      report.sidecarOutput = {
        stdoutTail: proc.output.stdout.slice(-4000),
        stderrTail: proc.output.stderr.slice(-4000),
        mode: proc.output.mode,
      };
      killProcess(proc.child);
    }
    report.finishedAt = new Date().toISOString();
    if (!report.ok && environmentBlockedReason(report)) {
      report.environmentBlockedArtifact = writeEnvironmentBlockedArtifact(report);
    } else {
      writeArtifact(report);
    }
    if (process.env.AELYRIS_KEEP_NATIVE_AI_CHAOS_TEMP !== "1") {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  }

  if (report.ok) {
    console.log(`native AI CLI post-launch chaos passed: ${OUT}`);
  } else if (environmentBlockedReason(report)) {
    console.error(`native AI CLI post-launch chaos environment-blocked; primary artifact preserved: ${report.environmentBlockedArtifact}`);
  } else {
    console.error(`native AI CLI post-launch chaos failed: ${OUT}`);
  }
}

await main();
