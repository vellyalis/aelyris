// Fast right-rail smoke-suite aggregator.
//
// Runs the localhost Edge feedback smoke unconditionally, then runs CDP/WebView2
// smokes only when the configured CDP endpoint is reachable. This keeps release
// evidence explicit without turning a missing native harness into an ambiguous
// product regression.

import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import net from "node:net";
import { dirname, resolve } from "node:path";
import process from "node:process";

const OUT = process.env.AETHER_RIGHT_RAIL_SUITE_OUT ?? ".codex-auto/production-smoke/right-rail-suite.json";
const CDP = process.env.AETHER_TAURI_CDP ?? "http://127.0.0.1:9222";
const REQUIRE_CDP = process.env.AETHER_RIGHT_RAIL_REQUIRE_CDP === "1";
const NODE = process.execPath;

const report = {
  ok: false,
  startedAt: new Date().toISOString(),
  cdp: CDP,
  requireCdp: REQUIRE_CDP,
  checks: [],
  errors: [],
};

const LOCALHOST_CHECKS = [
  {
    id: "edge-feedback",
    label: "Right rail Edge feedback smoke",
    script: "scripts/verify-right-rail-edge-feedback.mjs",
  },
];

const CDP_CHECKS = [
  {
    id: "decisions",
    label: "Right rail decisions smoke",
    script: "scripts/verify-right-rail-decisions.mjs",
  },
  {
    id: "preferences",
    label: "Right rail preferences smoke",
    script: "scripts/verify-right-rail-preferences.mjs",
  },
  {
    id: "negative-path",
    label: "Right rail negative-path smoke",
    script: "scripts/verify-right-rail-negative-path.mjs",
  },
  {
    id: "audit-jump",
    label: "Right rail audit jump smoke",
    script: "scripts/verify-right-rail-audit-jump.mjs",
  },
];

function writeArtifact() {
  const outPath = resolve(OUT);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify({ ...report, finishedAt: new Date().toISOString() }, null, 2)}\n`);
  return outPath;
}

function probeTcp(urlString, timeoutMs = 750) {
  return new Promise((resolveProbe) => {
    const url = new URL(urlString);
    const host = url.hostname || "127.0.0.1";
    const port = Number.parseInt(url.port || (url.protocol === "https:" ? "443" : "80"), 10);
    const socket = net.connect({ host, port });
    let done = false;
    const finish = (ok, message = "") => {
      if (done) return;
      done = true;
      socket.destroy();
      resolveProbe({ ok, message: message || `${host}:${port}` });
    };
    socket.setTimeout(timeoutMs, () => finish(false, `TCP timeout ${host}:${port}`));
    socket.once("connect", () => finish(true, `${host}:${port}`));
    socket.once("error", (error) => finish(false, error.message));
  });
}

function runCheck(check, env = {}) {
  return new Promise((resolveRun) => {
    const startedAt = Date.now();
    const child = spawn(NODE, [check.script], {
      cwd: process.cwd(),
      env: { ...process.env, ...env },
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("close", (code) => {
      resolveRun({
        id: check.id,
        label: check.label,
        status: code === 0 ? "passed" : "failed",
        code,
        durationMs: Date.now() - startedAt,
        stdout: stdout.trim().slice(-2000),
        stderr: stderr.trim().slice(-2000),
      });
    });
    child.on("error", (error) => {
      resolveRun({
        id: check.id,
        label: check.label,
        status: "failed",
        code: null,
        durationMs: Date.now() - startedAt,
        stdout: stdout.trim().slice(-2000),
        stderr: error.message,
      });
    });
  });
}

async function main() {
  try {
    for (const check of LOCALHOST_CHECKS) {
      report.checks.push(await runCheck(check));
    }

    const cdpProbe = await probeTcp(CDP);
    report.cdpReachable = cdpProbe.ok;
    report.cdpProbe = cdpProbe.message;

    if (cdpProbe.ok) {
      for (const check of CDP_CHECKS) {
        report.checks.push(await runCheck(check, { AETHER_TAURI_CDP: CDP }));
      }
    } else if (REQUIRE_CDP) {
      for (const check of CDP_CHECKS) {
        report.checks.push({
          id: check.id,
          label: check.label,
          status: "failed",
          reason: `CDP endpoint required but unavailable at ${CDP}: ${cdpProbe.message}`,
        });
      }
    } else {
      for (const check of CDP_CHECKS) {
        report.checks.push({
          id: check.id,
          label: check.label,
          status: "skipped",
          reason: `CDP endpoint unavailable at ${CDP}: ${cdpProbe.message}`,
        });
      }
    }

    const failed = report.checks.filter((check) => check.status === "failed");
    if (failed.length > 0) {
      throw new Error(`Right rail smoke suite failed: ${failed.map((check) => check.id).join(", ")}`);
    }
    report.ok = true;
  } catch (error) {
    report.errors.push(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  } finally {
    const artifact = writeArtifact();
    if (report.ok) {
      console.log(`right rail smoke suite passed: ${artifact}`);
    } else {
      console.error(`right rail smoke suite failed: ${artifact}`);
    }
  }
}

await main();
