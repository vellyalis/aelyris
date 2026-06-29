import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import { dirname, join } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const extension = process.platform === "win32" ? ".exe" : "";
const sidecar =
  process.env.AELYRIS_MUX_PERF_SIDECAR ??
  join(root, "src-tauri", "pty-server", "target", "release", `aelyris-pty-server${extension}`);
const out =
  process.env.AELYRIS_MUX_PERF_OUT ??
  join(root, ".codex-auto", "performance", "mux-performance-smoke.json");
const token = process.env.AELYRIS_MUX_PERF_TOKEN ?? "mux-performance-smoke-token";
const iterations = Number.parseInt(process.env.AELYRIS_MUX_PERF_ITERATIONS ?? "5", 10);
const strictSpawn = process.env.AELYRIS_MUX_PERF_STRICT === "1";
const budgets = {
  readyMs: 5_000,
  createWarnMs: 2_500,
  splitWarnMs: 2_500,
  detachP95Ms: 700,
  attachP95Ms: 700,
  resizeP95Ms: 300,
  closeP95Ms: 700,
};

if (!existsSync(sidecar)) {
  throw new Error(
    `PTY sidecar not found: ${sidecar}\nRun "node scripts/build-pty-sidecar.mjs" first.`,
  );
}

function percentile(values, p) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[index];
}

function round(value) {
  return Math.round(value * 10) / 10;
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

async function timed(name, fn, samples) {
  const started = performance.now();
  const result = await fn();
  const ms = performance.now() - started;
  samples[name].push(ms);
  return result;
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
  const started = performance.now();
  let lastError;
  while (performance.now() - started < budgets.readyMs) {
    try {
      return await request(base, "/daemon/contract");
    } catch (error) {
      lastError = error;
      await sleep(100);
    }
  }
  throw new Error(`sidecar did not become ready within ${budgets.readyMs}ms: ${lastError?.message}`);
}

function killProcess(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill();
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    });
  }
}

async function main() {
  if (!Number.isFinite(iterations) || iterations < 1) {
    throw new Error("AELYRIS_MUX_PERF_ITERATIONS must be a positive integer");
  }

  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const tempRoot = join(root, ".codex-auto", "performance", `mux-smoke-${Date.now()}`);
  const muxDir = join(tempRoot, "mux");
  const scrollbackDir = join(tempRoot, "scrollback");
  mkdirSync(muxDir, { recursive: true });
  mkdirSync(scrollbackDir, { recursive: true });

  const child = spawn(sidecar, [], {
    cwd: root,
    env: {
      ...process.env,
      AELYRIS_API_TOKEN: token,
      AELYRIS_PTY_SERVER_PORT: String(port),
      AELYRIS_MUX_SNAPSHOT_DIR: muxDir,
      AELYRIS_PTY_SCROLLBACK_DIR: scrollbackDir,
    },
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr?.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  const samples = {
    create: [],
    split: [],
    detach: [],
    attach: [],
    resize: [],
    close: [],
  };
  const report = {
    status: "running",
    sidecar,
    base,
    iterations,
    budgets,
    samples: {},
    summary: {},
    warnings: [],
    errors: [],
  };

  try {
    const contract = await waitForReady(base);
    report.contract = contract;
    const cwd = root;

    for (let i = 0; i < iterations; i += 1) {
      const created = await timed(
        "create",
        () =>
          request(base, "/sessions", {
            method: "POST",
            body: JSON.stringify({ shell: "cmd", cols: 100, rows: 30, cwd }),
          }),
        samples,
      );
      const id = created.id;

      await timed(
        "split",
        () =>
          request(base, `/mux/workspaces/${id}/panes/split`, {
            method: "POST",
            body: JSON.stringify({
              targetPaneId: id,
              axis: "horizontal",
              shell: "cmd",
              cwd,
              cols: 100,
              rows: 15,
            }),
          }),
        samples,
      );

      await timed(
        "detach",
        () => request(base, `/mux/workspaces/${id}/detach`, { method: "POST" }),
        samples,
      );
      await timed(
        "attach",
        () => request(base, `/mux/workspaces/${id}/attach`, { method: "POST" }),
        samples,
      );
      await timed(
        "resize",
        () =>
          request(base, `/sessions/${id}/resize`, {
            method: "POST",
            body: JSON.stringify({ cols: 120, rows: 36 }),
          }),
        samples,
      );
      await timed("close", () => request(base, `/sessions/${id}`, { method: "DELETE" }), samples);
    }

    for (const [name, values] of Object.entries(samples)) {
      report.samples[name] = values.map(round);
      report.summary[name] = {
        p50: round(percentile(values, 50)),
        p95: round(percentile(values, 95)),
        max: round(Math.max(...values)),
      };
    }

    if (report.summary.detach.p95 > budgets.detachP95Ms) {
      report.errors.push(`detach p95 ${report.summary.detach.p95}ms > ${budgets.detachP95Ms}ms`);
    }
    if (report.summary.attach.p95 > budgets.attachP95Ms) {
      report.errors.push(`attach p95 ${report.summary.attach.p95}ms > ${budgets.attachP95Ms}ms`);
    }
    if (report.summary.resize.p95 > budgets.resizeP95Ms) {
      report.errors.push(`resize p95 ${report.summary.resize.p95}ms > ${budgets.resizeP95Ms}ms`);
    }
    if (report.summary.close.p95 > budgets.closeP95Ms) {
      report.errors.push(`close p95 ${report.summary.close.p95}ms > ${budgets.closeP95Ms}ms`);
    }

    if (report.summary.create.p95 > budgets.createWarnMs) {
      const message = `create p95 ${report.summary.create.p95}ms > ${budgets.createWarnMs}ms`;
      (strictSpawn ? report.errors : report.warnings).push(message);
    }
    if (report.summary.split.p95 > budgets.splitWarnMs) {
      const message = `split p95 ${report.summary.split.p95}ms > ${budgets.splitWarnMs}ms`;
      (strictSpawn ? report.errors : report.warnings).push(message);
    }

    report.status = report.errors.length === 0 ? "passed" : "failed";
  } catch (error) {
    report.status = "failed";
    report.errors.push(error instanceof Error ? error.message : String(error));
  } finally {
    report.sidecarOutput = {
      stdoutTail: stdout.slice(-2_000),
      stderrTail: stderr.slice(-2_000),
    };
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
    killProcess(child);
    rmSync(tempRoot, { recursive: true, force: true });
  }

  console.log(JSON.stringify(report.summary, null, 2));
  if (report.warnings.length > 0) {
    console.warn(`Warnings:\n- ${report.warnings.join("\n- ")}`);
  }
  if (report.errors.length > 0) {
    console.error(`Errors:\n- ${report.errors.join("\n- ")}`);
    process.exitCode = 1;
  }
  console.log(`Report: ${out}`);
}

await main();
