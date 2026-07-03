// Deterministic PTY sidecar smoke for AI CLI command-session boundaries.
//
// This does not spend real AI CLI tokens. It creates local Codex/Claude/Gemini
// shims, spawns them through POST /commands, then proves stream, input,
// capture, close, auth, and unsafe-program rejection at the daemon boundary.

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const EXTENSION = process.platform === "win32" ? ".exe" : "";
const SIDECAR =
  process.env.AELYRIS_AI_CLI_BOUNDARY_SIDECAR ??
  join(ROOT, "src-tauri", "pty-server", "target", "release", `aelyris-pty-server${EXTENSION}`);
const OUT =
  process.env.AELYRIS_AI_CLI_BOUNDARY_OUT ??
  join(ROOT, ".codex-auto", "production-smoke", "interactive-ai-cli-boundary.json");
const TOKEN = process.env.AELYRIS_AI_CLI_BOUNDARY_TOKEN ?? "ai-cli-boundary-token";
const WAIT_MS = Number.parseInt(process.env.AELYRIS_AI_CLI_BOUNDARY_WAIT_MS ?? "30000", 10);
const CLIS = ["codex", "claude", "gemini"];
const EXISTING_BASE = process.env.AELYRIS_AI_CLI_BOUNDARY_BASE?.replace(/\/+$/, "") ?? null;

if (!existsSync(SIDECAR)) {
  throw new Error(`PTY sidecar not found: ${SIDECAR}\nRun "node scripts/build-pty-sidecar.mjs" first.`);
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
      AELYRIS_API_TOKEN: TOKEN,
      AELYRIS_PTY_SERVER_PORT: String(port),
      AELYRIS_MUX_SNAPSHOT_DIR: join(tempRoot, "mux"),
      AELYRIS_PTY_SCROLLBACK_DIR: join(tempRoot, "scrollback"),
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

function writeShimFiles(binDir) {
  mkdirSync(binDir, { recursive: true });
  writeFileSync(
    join(binDir, "aelyris-ai-cli-shim.mjs"),
    [
      'import readline from "node:readline";',
      'const cli = process.argv[2] || process.env.AELYRIS_AGENT_CLI || "unknown";',
      'const marker = process.env.AELYRIS_CLI_BOUNDARY_MARKER || "NO_MARKER";',
      'const model = process.env.AELYRIS_AGENT_MODEL || "unknown";',
      'process.stdout.write("[" + cli + "] AELYRIS_AI_CLI_READY " + marker + " model=" + model + "\\r\\n");',
      'process.stdout.write(cli + "> ");',
      "const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: false });",
      "let seen = 0;",
      'rl.on("line", (line) => {',
      "  const trimmed = line.trim();",
      '  console.log("[" + cli + "] AELYRIS_AI_CLI_INPUT " + marker + " " + trimmed);',
      "  seen += 1;",
      '  if (trimmed === "/exit" || seen >= 2) {',
      '    console.log("[" + cli + "] AELYRIS_AI_CLI_DONE " + marker);',
      "    process.exit(0);",
      "  }",
      '  process.stdout.write(cli + "> ");',
      "});",
      "setTimeout(() => {",
      '  console.error("[" + cli + "] AELYRIS_AI_CLI_TIMEOUT " + marker);',
      "  process.exit(2);",
      "}, 30000).unref();",
      "",
    ].join("\n"),
  );

  for (const cli of CLIS) {
    if (process.platform === "win32") {
      writeFileSync(join(binDir, `${cli}.cmd`), `@echo off\r\nnode "%~dp0aelyris-ai-cli-shim.mjs" ${cli} %*\r\n`);
    } else {
      writeFileSync(
        join(binDir, cli),
        `#!/usr/bin/env sh\nnode "$(dirname "$0")/aelyris-ai-cli-shim.mjs" ${cli} "$@"\n`,
        {
          mode: 0o755,
        },
      );
    }
  }
}

async function captureContains(base, id, needle) {
  const captured = await request(base, `/sessions/${id}/capture?lines=120&clean=true`);
  return {
    found: (captured.text ?? "").includes(needle),
    text: captured.text ?? "",
  };
}

async function waitForCapture(base, id, needle) {
  const deadline = Date.now() + WAIT_MS;
  let last = { found: false, text: "" };
  while (Date.now() < deadline) {
    last = await captureContains(base, id, needle);
    if (last.found) return last.text;
    await sleep(100);
  }
  throw new Error(`session ${id} capture did not contain ${needle}; tail=${last.text.slice(-800)}`);
}

async function dataToText(data) {
  if (typeof data === "string") return data;
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString("utf8");
  if (ArrayBuffer.isView(data)) return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString("utf8");
  if (data && typeof data.arrayBuffer === "function") return Buffer.from(await data.arrayBuffer()).toString("utf8");
  return String(data ?? "");
}

async function waitForStreamMarker(base, id, marker) {
  const ticket = await request(base, `/sessions/${id}/stream-ticket`, { method: "POST" });
  const wsBase = base.replace(/^http:/, "ws:");
  const url = `${wsBase}/sessions/${id}/stream?ticket=${encodeURIComponent(ticket.ticket)}`;
  return await new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    let text = "";
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error(`WebSocket stream did not receive ${marker}; tail=${text.slice(-400)}`));
    }, WAIT_MS);
    ws.addEventListener("message", async (event) => {
      text += await dataToText(event.data);
      if (!text.includes(marker)) return;
      clearTimeout(timer);
      ws.close();
      resolve({ ticketExpiresInMs: ticket.expires_in_ms, streamText: text.slice(-800) });
    });
    ws.addEventListener("error", () => {
      clearTimeout(timer);
      reject(new Error(`WebSocket stream failed for ${id}`));
    });
  });
}

async function closeSessionIfPresent(base, id) {
  const response = await rawRequest(base, `/sessions/${id}`, { method: "DELETE" });
  if (response.status === 204) return "closed";
  if (response.status === 404) return "already-closed";
  const body = await response.text().catch(() => "");
  throw new Error(`DELETE /sessions/${id} -> ${response.status}: ${body}`);
}

async function mintInputApproval(base, id, text) {
  const approval = await request(base, `/sessions/${id}/input-approval`, {
    method: "POST",
    body: JSON.stringify({ text }),
  });
  return {
    approvalId: approval.approvalId ?? null,
    status: approval.status,
    severity: approval.severity,
    requiresApproval: approval.requiresApproval === true,
    commandHash: approval.commandHash,
    targetScopeHash: approval.targetScopeHash,
  };
}

async function assertSecurityGuards(base) {
  const noAuth = await rawRequest(base, "/commands", {
    method: "POST",
    auth: false,
    body: JSON.stringify({ program: "cmd.exe", args: ["/c", "echo", "no-auth"], cols: 80, rows: 12 }),
  });
  const unsafe = await rawRequest(base, "/commands", {
    method: "POST",
    body: JSON.stringify({
      program: "C:/Windows/System32/cmd.exe",
      args: ["/c", "echo", "unsafe"],
      cols: 80,
      rows: 12,
    }),
  });
  return {
    unauthorizedCommandRejected: noAuth.status === 401,
    unauthorizedStatus: noAuth.status,
    unsafeProgramRejected: unsafe.status === 400,
    unsafeProgramStatus: unsafe.status,
  };
}

async function runCliBoundary(base, cli, binDir) {
  const marker = `AELYRIS_AI_CLI_${cli.toUpperCase()}_${Math.random().toString(36).slice(2, 8)}`.toUpperCase();
  const program = process.platform === "win32" ? `${cli}.cmd` : cli;
  const created = await request(base, "/commands", {
    method: "POST",
    body: JSON.stringify({
      program,
      args: ["--aelyris-boundary-smoke"],
      cols: 100,
      rows: 24,
      cwd: ROOT,
      env: {
        PATH: `${binDir}${process.platform === "win32" ? ";" : ":"}${process.env.PATH ?? ""}`,
        AELYRIS_AGENT_CLI: cli,
        AELYRIS_AGENT_MODEL: `${cli}-boundary-smoke`,
        AELYRIS_CLI_BOUNDARY_MARKER: marker,
      },
    }),
  });
  const id = created.id;
  let stream = null;
  try {
    stream = await waitForStreamMarker(base, id, marker);
    const readyText = await waitForCapture(base, id, `AELYRIS_AI_CLI_READY ${marker}`);
    const input = `BOUNDARY_INPUT_${cli.toUpperCase()}_${Math.random().toString(36).slice(2, 6)}`;
    const inputApproval = await mintInputApproval(base, id, input);
    await request(base, `/sessions/${id}/input`, {
      method: "POST",
      body: JSON.stringify({
        text: `${input}\r`,
        ...(inputApproval.approvalId ? { approvalId: inputApproval.approvalId } : {}),
      }),
    });
    const inputText = await waitForCapture(base, id, `AELYRIS_AI_CLI_INPUT ${marker} ${input}`);
    const exitApproval = await mintInputApproval(base, id, "/exit");
    await request(base, `/sessions/${id}/input`, {
      method: "POST",
      body: JSON.stringify({
        text: "/exit\r",
        ...(exitApproval.approvalId ? { approvalId: exitApproval.approvalId } : {}),
      }),
    });
    const doneText = await waitForCapture(base, id, `AELYRIS_AI_CLI_DONE ${marker}`);
    const closeState = await closeSessionIfPresent(base, id);
    const sessions = await request(base, "/sessions");
    return {
      cli,
      id,
      marker,
      backend: "sidecar-command-session",
      program,
      streamReceivedMarker: stream.streamText.includes(marker),
      ticketExpiresInMs: stream.ticketExpiresInMs,
      inputApproval,
      exitApproval,
      readyVisible: readyText.includes(marker),
      inputRoundtrip: inputText.includes(input),
      doneVisible: doneText.includes(`AELYRIS_AI_CLI_DONE ${marker}`),
      closeState,
      closed: !sessions.some((session) => session?.id === id),
    };
  } catch (error) {
    await closeSessionIfPresent(base, id).catch(() => {});
    throw error;
  }
}

async function main() {
  const port = EXISTING_BASE ? null : await freePort();
  const base = EXISTING_BASE ?? `http://127.0.0.1:${port}`;
  const tempRoot = join(ROOT, ".codex-auto", "production-smoke", `ai-cli-boundary-${Date.now()}`);
  const binDir = join(tempRoot, "bin");
  mkdirSync(tempRoot, { recursive: true });
  mkdirSync(dirname(OUT), { recursive: true });
  writeShimFiles(binDir);

  const report = {
    version: 1,
    ok: false,
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
    if (!report.checks.commandSessionCapability) {
      throw new Error(`daemon contract is missing command-session capability: ${JSON.stringify(contract)}`);
    }

    const security = await assertSecurityGuards(base);
    report.checks.security = security;
    if (!security.unauthorizedCommandRejected || !security.unsafeProgramRejected) {
      throw new Error(`command-session security guard failed: ${JSON.stringify(security)}`);
    }

    report.checks.clis = [];
    for (const cli of CLIS) {
      report.checks.clis.push(await runCliBoundary(base, cli, binDir));
    }
    const badCli = report.checks.clis.find(
      (entry) =>
        !entry.streamReceivedMarker ||
        !entry.readyVisible ||
        !entry.inputRoundtrip ||
        !entry.doneVisible ||
        !entry.closed,
    );
    if (badCli) throw new Error(`CLI boundary checks failed for ${badCli.cli}: ${JSON.stringify(badCli)}`);

    report.ok = true;
  } catch (error) {
    report.errors.push(error instanceof Error ? error.stack || error.message : String(error));
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
    if (process.env.AELYRIS_KEEP_AI_CLI_BOUNDARY_TEMP !== "1") {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  }

  if (report.ok) {
    console.log(`interactive AI CLI boundary smoke passed: ${OUT}`);
  } else if (environmentBlockedReason(report)) {
    console.error(`interactive AI CLI boundary smoke environment-blocked; primary artifact preserved: ${report.environmentBlockedArtifact}`);
  } else {
    console.error(`interactive AI CLI boundary smoke failed: ${OUT}`);
  }
}

await main();
