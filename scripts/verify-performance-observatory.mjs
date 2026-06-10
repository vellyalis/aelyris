// P2-06 live Tauri/WebView2 Performance Observatory smoke.
//
// Prerequisite:
//   AETHER_API_TOKEN=dev pnpm.cmd tauri:dev
//
// Optional env:
//   AETHER_TAURI_CDP=http://127.0.0.1:9222
//   AETHER_TAURI_PROJECT=C:/Users/owner/Aether_Terminal
//   AETHER_DASHBOARD_STATE_URL=http://127.0.0.1:48371/state
//   AETHER_PERF_SMOKE_OUT=.codex-auto/performance-observatory/p2-06-webview2-flood-smoke.json

import { mkdirSync, writeFileSync } from "node:fs";
import net from "node:net";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { chromium } from "@playwright/test";

const CDP = process.env.AETHER_TAURI_CDP ?? process.env.AETHER_IME_CDP ?? "http://127.0.0.1:9222";
const PROJECT_PATH = (process.env.AETHER_TAURI_PROJECT ?? process.cwd()).replaceAll("\\", "/");
const DASHBOARD_STATE_URL = process.env.AETHER_DASHBOARD_STATE_URL ?? "http://127.0.0.1:48371/state";
const OUT = process.env.AETHER_PERF_SMOKE_OUT ?? ".codex-auto/performance-observatory/p2-06-webview2-flood-smoke.json";
const WAIT_MS = Number.parseInt(process.env.AETHER_PERF_SMOKE_WAIT_MS ?? "60000", 10);
const APP_READY_WAIT_MS = Number.parseInt(process.env.AETHER_PERF_APP_READY_WAIT_MS ?? "60000", 10);
const FLOOD_LINES = Number.parseInt(process.env.AETHER_PERF_FLOOD_LINES ?? "420", 10);
const SENTINEL = `aether-perf-flood-${FLOOD_LINES}`;

function isAetherPage(page) {
  const url = page.url();
  return (
    url.includes("localhost:1420") ||
    url.includes("127.0.0.1:1420") ||
    url.startsWith("tauri://localhost") ||
    url.startsWith("https://tauri.localhost")
  );
}

function writeArtifact(report) {
  const path = resolve(OUT);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`);
  return path;
}

function withPerformanceQaParams(rawUrl) {
  try {
    const url = new URL(rawUrl);
    url.searchParams.set("aetherVisualQa", "1");
    url.searchParams.set("rail", "observe");
    url.searchParams.set("projectPath", PROJECT_PATH);
    url.searchParams.set("aetherDashboardStateUrl", DASHBOARD_STATE_URL);
    return url.toString();
  } catch {
    return rawUrl;
  }
}

function probeCdpTcp(timeoutMs = 750) {
  return new Promise((resolveProbe, rejectProbe) => {
    const url = new URL(CDP);
    const host = url.hostname || "127.0.0.1";
    const port = Number.parseInt(url.port || (url.protocol === "https:" ? "443" : "80"), 10);
    const socket = net.connect({ host, port });
    let done = false;
    const finish = (error) => {
      if (done) return;
      done = true;
      socket.destroy();
      if (error) rejectProbe(error);
      else resolveProbe();
    };
    socket.setTimeout(timeoutMs, () => finish(new Error(`TCP timeout ${host}:${port}`)));
    socket.once("connect", () => finish());
    socket.once("error", (error) => finish(error));
  });
}

async function connectWithWait() {
  const startedAt = Date.now();
  let lastError = null;
  do {
    try {
      await probeCdpTcp();
      const browser = await chromium.connectOverCDP(CDP);
      return { browser, waitedMs: Date.now() - startedAt };
    } catch (error) {
      lastError = error;
      await new Promise((resolveWait) => setTimeout(resolveWait, 1000));
    }
  } while (Date.now() - startedAt < WAIT_MS);

  throw new Error(
    `Cannot attach to WebView2 CDP at ${CDP} after ${WAIT_MS}ms. Last error: ${lastError?.message ?? "unknown"}`,
  );
}

async function seedPerformanceQa(page) {
  await page.evaluate(
    ({ dashboardStateUrl, projectPath }) => {
      localStorage.setItem("aether:visualQa", "1");
      localStorage.setItem("aether:visualQaProject", projectPath);
      localStorage.setItem("aether:lastProject", projectPath);
      localStorage.setItem("aether:onboarding-done", "true");
      localStorage.setItem("aether:dashboardStateUrl", dashboardStateUrl);
    },
    { dashboardStateUrl: DASHBOARD_STATE_URL, projectPath: PROJECT_PATH },
  );
}

async function openPerformanceQaPage(page) {
  await seedPerformanceQa(page);
  const targetUrl = withPerformanceQaParams(page.url());
  if (targetUrl !== page.url()) {
    await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: WAIT_MS });
  } else {
    await page.reload({ waitUntil: "domcontentloaded", timeout: WAIT_MS });
  }
  await page.waitForFunction(
    () => !!document.querySelector(".app-container") && !!document.querySelector(".app-main"),
    null,
    { timeout: APP_READY_WAIT_MS },
  );
}

async function installPerformanceSampleCollector(page) {
  await page.evaluate(() => {
    window.__aetherPerfSamples = [];
    window.addEventListener("aether:terminal-performance-sample", (event) => {
      window.__aetherPerfSamples.push(event.detail);
      if (window.__aetherPerfSamples.length > 24) window.__aetherPerfSamples.shift();
    });
  });
}

async function readPerformanceSamples(page) {
  return page.evaluate(() => window.__aetherPerfSamples ?? []);
}

async function call(page, cmd, args = {}) {
  return page.evaluate(
    async ({ cmd: command, args: commandArgs }) => {
      const internals = window.__TAURI_INTERNALS__;
      if (!internals || typeof internals.invoke !== "function") {
        throw new Error("__TAURI_INTERNALS__.invoke unavailable");
      }
      return internals.invoke(command, commandArgs);
    },
    { cmd, args },
  );
}

function gridContains(snapshot, needle) {
  if (!snapshot?.cells) return false;
  for (const row of snapshot.cells) {
    const line = row.map((cell) => cell?.ch ?? " ").join("");
    if (line.includes(needle)) return true;
  }
  return false;
}

async function waitForGrid(page, terminalId, needle, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await call(page, "term_snapshot", { id: terminalId });
    if (gridContains(last, needle)) return last;
    await new Promise((resolveWait) => setTimeout(resolveWait, 150));
  }
  throw new Error(`terminal flood sentinel not visible after ${timeoutMs}ms; last rows=${last?.rows ?? "n/a"}`);
}

async function waitForHistoryRows(page, terminalId, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  let history = 0;
  while (Date.now() < deadline) {
    history = await call(page, "term_history_size", { id: terminalId });
    if (history > 0) return history;
    await new Promise((resolveWait) => setTimeout(resolveWait, 150));
  }
  return history;
}

async function openObservatoryPanel(page) {
  const button = page.getByRole("button", { name: "Performance observatory" });
  await button.waitFor({ state: "visible", timeout: 15000 });
  await button.click();
  const panel = page.getByRole("dialog", { name: "Performance Observatory" });
  await panel.waitFor({ state: "visible", timeout: 15000 });
  return panel.evaluate((node) => ({
    text: node.textContent ?? "",
    rowCount: node.querySelectorAll("[class*='perfRow']").length,
    warningCount: node.querySelectorAll("[class*='perfWarning']").length,
  }));
}

async function main() {
  const report = {
    version: 1,
    taskId: "auto-1778005841170-2-performance-observatory",
    roadmapId: "P2-06",
    parentRoadmapId: "P2-06",
    reason: "blocker-decomposition",
    cdp: CDP,
    projectPath: PROJECT_PATH,
    dashboardStateUrl: DASHBOARD_STATE_URL,
    startedAt: new Date().toISOString(),
    status: "running",
  };

  let browser;
  let page;
  let spawnedTerminalId = null;
  try {
    const connected = await connectWithWait();
    browser = connected.browser;
    report.cdpWaitedMs = connected.waitedMs;

    const pages = browser.contexts().flatMap((context) => context.pages());
    report.pages = pages.map((candidate) => candidate.url());
    page = pages.find(isAetherPage);
    if (!page) {
      report.status = "external_dependency";
      report.dependency = "Aether Tauri WebView2 page";
      report.error = `CDP attached, but no Aether page was exposed. Pages: ${report.pages.join(", ") || "none"}`;
      writeArtifact(report);
      console.error(`[perf-smoke] ${report.error}`);
      process.exit(2);
    }

    await page.bringToFront().catch(() => {});
    await openPerformanceQaPage(page);
    await installPerformanceSampleCollector(page);

    const hasInternals = await page.evaluate(() => !!window.__TAURI_INTERNALS__?.invoke);
    if (!hasInternals) throw new Error("Attached page does not expose __TAURI_INTERNALS__.invoke");

    spawnedTerminalId = await call(page, "spawn_terminal", {
      shell: "powershell",
      cols: 120,
      rows: 30,
      cwd: PROJECT_PATH,
    });
    await new Promise((resolveWait) => setTimeout(resolveWait, 700));

    const beforeMetrics = await call(page, "performance_observatory_metrics", { terminalId: spawnedTerminalId });
    await call(page, "write_terminal", {
      id: spawnedTerminalId,
      data: `1..${FLOOD_LINES} | ForEach-Object { Write-Output "aether-perf-flood-$_" }\r`,
    });
    const snapshot = await waitForGrid(page, spawnedTerminalId, SENTINEL);
    const historyRows = await waitForHistoryRows(page, spawnedTerminalId);
    await new Promise((resolveWait) => setTimeout(resolveWait, 1200));
    const afterMetrics = await call(page, "performance_observatory_metrics", { terminalId: spawnedTerminalId });
    const samples = await readPerformanceSamples(page);
    const panel = await openObservatoryPanel(page);

    const checks = {
      webviewAttached: hasInternals,
      floodReachedVisibleGrid: gridContains(snapshot, SENTINEL),
      scrollbackGrew: historyRows > 0,
      backendReportsTerminal: afterMetrics.terminalId === spawnedTerminalId,
      backendReportsPanes: afterMetrics.activeTerminalCount > 0 && afterMetrics.paneCount > 0,
      backendReportsScrollbackBytes: afterMetrics.scrollbackEstimatedBytes > 0,
      backendReportsDbWriteLatency: afterMetrics.dbWriteLatencyMs !== null && afterMetrics.dbWriteLatencyMs !== undefined,
      panelExposesMetrics: panel.text.includes("Performance Observatory") && panel.text.includes("IPC / DB"),
      dashboardProbeConfigured: panel.text.includes("Dashboard"),
    };

    report.flood = {
      lines: FLOOD_LINES,
      sentinel: SENTINEL,
      historyRows,
      visibleCols: snapshot.cols,
      visibleRows: snapshot.rows,
    };
    report.beforeMetrics = beforeMetrics;
    report.afterMetrics = afterMetrics;
    report.renderSamples = {
      count: samples.length,
      latest: samples.at(-1) ?? null,
    };
    report.panel = {
      rowCount: panel.rowCount,
      warningCount: panel.warningCount,
      containsTerminal: panel.text.includes("Terminal"),
      containsIpcDb: panel.text.includes("IPC / DB"),
      containsUiProcesses: panel.text.includes("UI / Processes"),
    };
    report.checks = checks;

    const failed = Object.entries(checks).filter(([, ok]) => !ok);
    if (failed.length > 0) {
      throw new Error(`Performance smoke failed checks: ${failed.map(([name]) => name).join(", ")}`);
    }

    report.status = "pass";
    report.completedAt = new Date().toISOString();
    const artifact = writeArtifact(report);
    console.log(`[perf-smoke] pass: ${artifact}`);
    console.log(
      `[perf-smoke] terminal=${spawnedTerminalId} historyRows=${historyRows} dbWrite=${afterMetrics.dbWriteLatencyMs}ms panelRows=${panel.rowCount}`,
    );
  } catch (error) {
    report.error = error?.message ?? String(error);
    if (page) {
      report.failureDiagnostics = await page
        .evaluate(() => ({
          href: location.href,
          readyState: document.readyState,
          title: document.title,
          appContainerPresent: !!document.querySelector(".app-container"),
          appMainPresent: !!document.querySelector(".app-main"),
          bodyText: document.body.innerText.slice(0, 800),
        }))
        .catch((diagnosticError) => ({ error: diagnosticError?.message ?? String(diagnosticError) }));
    }
    if (report.status === "running" && report.error.includes("Cannot attach to WebView2 CDP")) {
      report.status = "external_dependency";
      report.dependency = "WebView2 CDP endpoint";
    } else {
      report.status = report.status === "running" ? "failed" : report.status;
    }
    report.completedAt = new Date().toISOString();
    const artifact = writeArtifact(report);
    console.error(`[perf-smoke] ${report.status}: ${artifact}`);
    console.error(`[perf-smoke] ${report.error}`);
    process.exit(report.status === "external_dependency" ? 2 : 1);
  } finally {
    if (page && spawnedTerminalId) {
      await call(page, "close_terminal", { id: spawnedTerminalId }).catch(() => {});
    }
    if (browser) {
      if (typeof browser.disconnect === "function") browser.disconnect();
      else await browser.close().catch(() => {});
    }
  }
}

main();
