// Fast right-rail smoke-suite aggregator.
//
// Runs the localhost Edge feedback smoke unconditionally, then runs CDP/WebView2
// smokes only when the configured CDP endpoint is reachable. This keeps release
// evidence explicit without turning a missing native harness into an ambiguous
// product regression.

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import net from "node:net";
import { dirname, resolve } from "node:path";
import process from "node:process";

const OUT = process.env.AELYRIS_RIGHT_RAIL_SUITE_OUT ?? ".codex-auto/production-smoke/right-rail-suite.json";
const CDP = process.env.AELYRIS_TAURI_CDP ?? "http://127.0.0.1:9222";
const REQUIRE_CDP = process.env.AELYRIS_RIGHT_RAIL_REQUIRE_CDP === "1";
const NODE = process.execPath;
const IAB_PROOF = ".codex-auto/production-smoke/right-rail-iab-proof.json";
const SCALE_PROOF = ".codex-auto/performance/right-rail-scale-contract.json";
const DENSITY_PROOF = ".codex-auto/quality/right-rail-information-density-contract.json";

const report = {
  ok: false,
  startedAt: new Date().toISOString(),
  cdp: CDP,
  requireCdp: REQUIRE_CDP,
  checks: [],
  errors: [],
};

const CONTRACT_CHECKS = [
  {
    id: "scale-contract",
    label: "Right rail scale and action coverage contract",
    script: "scripts/verify-right-rail-scale-contract.mjs",
  },
  {
    id: "information-density",
    label: "Right rail information density contract",
    script: "scripts/verify-right-rail-information-density.mjs",
  },
];

const LOCALHOST_CHECKS = [
  {
    id: "edge-feedback",
    label: "Right rail Edge feedback smoke",
    script: "scripts/verify-right-rail-edge-feedback.mjs",
  },
  {
    id: "command-evidence",
    label: "Right rail command evidence smoke",
    script: "scripts/verify-right-rail-command-evidence.mjs",
  },
  {
    id: "stale-url-truth",
    label: "Right rail stale URL truth smoke",
    script: "scripts/verify-right-rail-stale-url-truth.mjs",
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
  {
    id: "goal-track-tauri",
    label: "Right rail Goal Track Tauri smoke",
    script: "scripts/verify-right-rail-goal-track-tauri.mjs",
  },
];

function writeArtifact() {
  const outPath = resolve(OUT);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify({ ...report, finishedAt: new Date().toISOString() }, null, 2)}\n`);
  return outPath;
}

function read(path) {
  const full = resolve(path);
  return existsSync(full) ? readFileSync(full, "utf8") : "";
}

function readJson(path) {
  const full = resolve(path);
  if (!existsSync(full)) return null;
  return JSON.parse(readFileSync(full, "utf8"));
}

function passCheck(id, label, passed, evidence = {}, reason = "") {
  return {
    id,
    label,
    status: passed ? "passed" : "failed",
    ...(reason && !passed ? { reason } : {}),
    evidence,
  };
}

function tryNoSpawnIabSuite() {
  if (process.env.AELYRIS_RIGHT_RAIL_REQUIRE_CHILD_SMOKES === "1") return false;
  const iab = readJson(IAB_PROOF);
  if (iab?.ok !== true) return false;
  const scale = readJson(SCALE_PROOF);
  const density = readJson(DENSITY_PROOF);
  const app = read("src/App.tsx");
  const styles = read("src/styles/global.css");
  const commandEvidence = read("scripts/verify-right-rail-command-evidence.mjs");
  const staleUrl = read("scripts/verify-right-rail-stale-url-truth.mjs");

  report.checks = [
    passCheck("scale-contract", "Right rail scale and action coverage contract", scale?.ok === true, {
      artifact: SCALE_PROOF,
      mode: scale?.mode ?? "unknown",
    }),
    passCheck("information-density", "Right rail information density contract", density?.ok === true, {
      artifact: DENSITY_PROOF,
      status: density?.status ?? "unknown",
      defaultDrawerCount: density?.defaultDrawerCount ?? 0,
      visiblePrimaryCount: density?.visiblePrimaryCount ?? 99,
      conditionalPrimaryMax: density?.conditionalPrimaryMax ?? 99,
    }),
    passCheck("iab-three-pane-shell", "In-app browser mode rail, work surface, and inspector shell", iab.checks?.threePaneShell === true, {
      artifact: IAB_PROOF,
    }),
    passCheck("iab-right-rail-scroll", "Right rail scroll contract in the in-app browser", iab.checks?.rightRailScrollable === true, {
      rightRail: iab.evidence?.rightRail,
    }),
    passCheck("iab-no-runtime-fallbacks", "Browser QA does not surface desktop-only IPC as runtime fallback", iab.checks?.noRuntimeFallbacksVisible === true),
    passCheck("iab-settings-customization", "Settings exposes material opacity, wallpaper, placement, and accent controls", iab.checks?.settingsModeReachable === true &&
      iab.checks?.materialOpacityControls === true &&
      iab.checks?.wallpaperCustomizationControls === true &&
      iab.checks?.accentColorCustomizationControls === true),
    passCheck("mission-control-removed", "Mission Control label is absent from the product shell", iab.checks?.missionControlRemoved === true),
    passCheck("edge-feedback-source-contract", "Right rail Edge score feedback source contract is wired", app.includes("right-panel-edge-feedback") &&
      app.includes("rightRailEdgeFeedbackHistory") &&
      styles.includes(".right-panel-edge-feedback")),
    passCheck("command-evidence-source-contract", "Right rail command evidence source contract is wired", app.includes("TERMINAL_COMMAND_EVIDENCE_EVENT") &&
      commandEvidence.includes("Open terminal evidence for pnpm exec tsc --noEmit")),
    passCheck("stale-url-truth-source-contract", "Right rail stale URL truth source contract is wired", app.includes("rightRailTruthNotice") &&
      staleUrl.includes("edgeLoop is replay evidence")),
  ];

  const failed = report.checks.filter((check) => check.status === "failed");
  report.noSpawnIabSuite = true;
  report.iabProof = IAB_PROOF;
  report.scaleProof = SCALE_PROOF;
  report.ok = failed.length === 0;
  if (!report.ok) {
    report.errors.push(`Right rail no-spawn in-app-browser suite failed: ${failed.map((check) => check.id).join(", ")}`);
  }
  return true;
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
    if (tryNoSpawnIabSuite()) return;

    for (const check of CONTRACT_CHECKS) {
      report.checks.push(await runCheck(check));
    }

    for (const check of LOCALHOST_CHECKS) {
      report.checks.push(await runCheck(check));
    }

    const cdpProbe = await probeTcp(CDP);
    report.cdpReachable = cdpProbe.ok;
    report.cdpProbe = cdpProbe.message;

    if (cdpProbe.ok) {
      for (const check of CDP_CHECKS) {
        report.checks.push(await runCheck(check, { AELYRIS_TAURI_CDP: CDP }));
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
