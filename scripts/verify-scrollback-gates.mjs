import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const extension = process.platform === "win32" ? ".exe" : "";
const sidecar =
  process.env.AETHER_SCROLLBACK_SIDECAR ??
  join(root, "src-tauri", "pty-server", "target", "release", `aether-pty-server${extension}`);
const out =
  process.env.AETHER_SCROLLBACK_OUT ?? join(root, ".codex-auto", "performance", "scrollback-gates.json");
const token = process.env.AETHER_SCROLLBACK_TOKEN ?? "scrollback-gate-token";

if (!existsSync(sidecar)) {
  throw new Error(`PTY sidecar not found: ${sidecar}\nRun "node scripts/build-pty-sidecar.mjs" first.`);
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

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function request(base, path, options = {}) {
  const response = await fetch(`${base}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
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
  for (let i = 0; i < 80; i += 1) {
    try {
      return await request(base, "/daemon/contract");
    } catch (error) {
      lastError = error;
      await sleep(100);
    }
  }
  throw new Error(`sidecar did not become ready: ${lastError?.message ?? "unknown"}`);
}

function startSidecar(port, muxDir, scrollbackDir) {
  const child = spawn(sidecar, [], {
    cwd: root,
    env: {
      ...process.env,
      QUORUM_API_TOKEN: token,
      QUORUM_PTY_SERVER_PORT: String(port),
      QUORUM_MUX_SNAPSHOT_DIR: muxDir,
      QUORUM_PTY_SCROLLBACK_DIR: scrollbackDir,
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

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function waitForCapture(base, id, needle, lines = 10_000) {
  let text = "";
  for (let i = 0; i < 120; i += 1) {
    const captured = await request(base, `/sessions/${id}/capture?lines=${lines}&clean=true`);
    text = captured.text ?? "";
    if (text.includes(needle)) return text;
    await sleep(100);
  }
  throw new Error(`capture did not contain ${needle}: ${text.slice(-800)}`);
}

async function main() {
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const tempRoot = join(root, ".codex-auto", "performance", `scrollback-${Date.now()}`);
  const muxDir = join(tempRoot, "mux");
  const scrollbackDir = join(tempRoot, "scrollback");
  const inputFile = join(tempRoot, "scrollback-burst.txt");
  mkdirSync(muxDir, { recursive: true });
  mkdirSync(scrollbackDir, { recursive: true });
  mkdirSync(dirname(out), { recursive: true });
  const burstLines = 3000;
  writeFileSync(
    inputFile,
    Array.from({ length: burstLines }, (_, index) => `AETHER_SCROLLBACK_${index + 1}`).join("\r\n") +
      "\r\n",
  );

  const report = {
    status: "running",
    sidecar,
    base,
    checks: [],
    burstLines,
    outputBytes: 0,
    lineCount: 0,
  };
  let proc = null;

  try {
    proc = startSidecar(port, muxDir, scrollbackDir);
    await waitForReady(base);
    report.checks.push("daemon-ready");

    const created = await request(base, "/sessions", {
      method: "POST",
      body: JSON.stringify({ shell: "cmd", cols: 120, rows: 30, cwd: root }),
    });
    const id = created.id;
    const marker = `AETHER_SCROLLBACK_TAIL_${Date.now()}`;
    const quote = process.platform === "win32" ? `"` : "'";
    const printCommand = process.platform === "win32" ? "type" : "cat";
    const command = `${printCommand} ${quote}${inputFile}${quote}\r\necho ${marker}\r\n`;
    await request(base, `/sessions/${id}/input`, {
      method: "POST",
      body: JSON.stringify({ text: command }),
    });

    const captured = await waitForCapture(base, id, marker, 10_000);
    assert(captured.includes("AETHER_SCROLLBACK_1"), "capture should include the beginning of the large burst");
    assert(
      captured.includes(`AETHER_SCROLLBACK_${burstLines}`),
      "capture should include the end of the large burst",
    );
    assert(captured.includes(marker), "capture should include the final tail marker");
    report.outputBytes = Buffer.byteLength(captured, "utf8");
    report.lineCount = captured.split(/\r?\n/).length;
    report.checks.push("large-capture-preserves-head-tail-and-final-marker");

    const searched = await request(
      base,
      `/sessions/${id}/search?query=${encodeURIComponent(`AETHER_SCROLLBACK_${burstLines}`)}&lines=10000&limit=5`,
    );
    assert(searched.matches?.length >= 1, "scrollback search should find the final burst line");
    assert(
      searched.matches.some((match) => match.text?.includes(`AETHER_SCROLLBACK_${burstLines}`)),
      "scrollback search result should include the matching line text",
    );
    report.checks.push("large-search-finds-final-burst-line");

    killProcess(proc.child);
    proc = null;
    report.status = "passed";
  } catch (error) {
    report.status = "failed";
    report.error = error instanceof Error ? error.stack || error.message : String(error);
    throw error;
  } finally {
    if (proc) {
      report.sidecarOutput = {
        stdoutTail: proc.output.stdout.slice(-4000),
        stderrTail: proc.output.stderr.slice(-4000),
      };
      killProcess(proc.child);
    }
    writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
    if (process.env.AETHER_KEEP_SCROLLBACK_TEMP !== "1") {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  }

  console.log(JSON.stringify({ status: report.status, checks: report.checks, outputBytes: report.outputBytes }, null, 2));
  console.log(`Report: ${out}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
