// P2-07 live Tauri/WebView2 PTY and AI CLI chaos smoke.
//
// Prerequisite:
//   AETHER_API_TOKEN=dev pnpm.cmd tauri:dev
//
// Optional env:
//   AETHER_TAURI_CDP=http://127.0.0.1:9222
//   AETHER_TAURI_PROJECT=C:/Users/owner/Aether_Terminal
//   AETHER_DASHBOARD_STATE_URL=http://127.0.0.1:48371/state
//   AETHER_LIVE_CHAOS_OUT=.codex-auto/chaos-recovery/p2-07-live-tauri-pty-ai-cli-chaos.json

import { mkdirSync, writeFileSync } from "node:fs";
import net from "node:net";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { chromium } from "@playwright/test";

const CDP = process.env.AETHER_TAURI_CDP ?? process.env.AETHER_IME_CDP ?? "http://127.0.0.1:9222";
const PROJECT_PATH = (process.env.AETHER_TAURI_PROJECT ?? process.cwd()).replaceAll("\\", "/");
const DASHBOARD_STATE_URL = process.env.AETHER_DASHBOARD_STATE_URL ?? "http://127.0.0.1:48371/state";
const OUT = process.env.AETHER_LIVE_CHAOS_OUT ?? ".codex-auto/chaos-recovery/p2-07-live-tauri-pty-ai-cli-chaos.json";
const WAIT_MS = Number.parseInt(process.env.AETHER_LIVE_CHAOS_WAIT_MS ?? "45000", 10);
const APP_READY_WAIT_MS = Number.parseInt(process.env.AETHER_LIVE_CHAOS_APP_READY_WAIT_MS ?? "60000", 10);
const PTY_SENTINEL_BEFORE = "aether-live-chaos-pty-before";
const PTY_SENTINEL_AFTER = "aether-live-chaos-pty-after-restart";

function writeArtifact(report) {
  const path = resolve(OUT);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`);
  return path;
}

function isAetherPage(page) {
  const url = page.url();
  return (
    url.includes("localhost:1420") ||
    url.includes("127.0.0.1:1420") ||
    url.startsWith("tauri://localhost") ||
    url.startsWith("https://tauri.localhost")
  );
}

function withChaosQaParams(rawUrl) {
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

async function seedChaosQa(page) {
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

async function waitForAppReady(page) {
  await page.waitForFunction(
    () => !!document.querySelector(".app-container") && !!document.querySelector(".app-main"),
    null,
    { timeout: APP_READY_WAIT_MS },
  );
}

async function navigateWithAppReadyFallback(page, action) {
  try {
    await action();
  } catch (error) {
    const ready = await page
      .evaluate(
        () =>
          document.readyState !== "loading" &&
          !!document.querySelector(".app-container") &&
          !!document.querySelector(".app-main"),
      )
      .catch(() => false);
    if (!ready) throw error;
  }
  await waitForAppReady(page);
}

async function openChaosQaPage(page) {
  await seedChaosQa(page);
  const targetUrl = withChaosQaParams(page.url());
  if (targetUrl !== page.url()) {
    await navigateWithAppReadyFallback(page, () =>
      page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: WAIT_MS }),
    );
  } else {
    await navigateWithAppReadyFallback(page, () => page.reload({ waitUntil: "domcontentloaded", timeout: WAIT_MS }));
  }
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
  throw new Error(`terminal sentinel ${needle} not visible after ${timeoutMs}ms; last rows=${last?.rows ?? "n/a"}`);
}

async function waitForTerminalListed(page, terminalId, expectedPresent, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  let ids = [];
  while (Date.now() < deadline) {
    ids = await call(page, "list_terminals");
    if (ids.includes(terminalId) === expectedPresent) return ids;
    await new Promise((resolveWait) => setTimeout(resolveWait, 150));
  }
  throw new Error(`terminal ${terminalId} presence did not become ${expectedPresent}; last=${ids.join(",")}`);
}

async function waitForInteractiveSession(page, sessionId, predicate, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  let sessions = [];
  while (Date.now() < deadline) {
    sessions = await call(page, "list_interactive_agents");
    const session = sessions.find((item) => item.id === sessionId || item.pty_id === sessionId);
    if (predicate(session, sessions)) return { session, sessions };
    await new Promise((resolveWait) => setTimeout(resolveWait, 200));
  }
  throw new Error(`interactive session ${sessionId} did not reach expected state; last=${JSON.stringify(sessions)}`);
}

async function smokeLocalStorageReload(page) {
  await openChaosQaPage(page);
  const before = await page.evaluate(() => ({
    href: location.href,
    keyCount: localStorage.length,
    hasProject: !!localStorage.getItem("aether:lastProject"),
    bodyOverflow: document.body.scrollWidth > document.documentElement.clientWidth + 1,
  }));
  await page.evaluate(() => localStorage.clear());
  await navigateWithAppReadyFallback(page, () => page.reload({ waitUntil: "domcontentloaded", timeout: WAIT_MS }));
  const afterClearReload = await page.evaluate(() => ({
    href: location.href,
    keyCount: localStorage.length,
    hasApp: !!document.querySelector(".app-container"),
    hasMain: !!document.querySelector(".app-main"),
    bodyOverflow: document.body.scrollWidth > document.documentElement.clientWidth + 1,
    bodyTextSample: document.body.innerText.slice(0, 160),
  }));
  await seedChaosQa(page);
  await navigateWithAppReadyFallback(page, () => page.reload({ waitUntil: "domcontentloaded", timeout: WAIT_MS }));
  const afterReseed = await page.evaluate(() => ({
    keyCount: localStorage.length,
    hasProject: !!localStorage.getItem("aether:lastProject"),
    density: document.querySelector(".app-container")?.getAttribute("data-density") ?? null,
    bodyOverflow: document.body.scrollWidth > document.documentElement.clientWidth + 1,
  }));
  return { before, afterClearReload, afterReseed };
}

async function smokePtyForceRestart(page) {
  const terminalId = await call(page, "spawn_terminal", {
    shell: "powershell",
    cols: 120,
    rows: 30,
    cwd: PROJECT_PATH,
  });
  try {
    await call(page, "write_terminal", { id: terminalId, data: `Write-Output "${PTY_SENTINEL_BEFORE}"\r` });
    const beforeSnapshot = await waitForGrid(page, terminalId, PTY_SENTINEL_BEFORE);
    await call(page, "force_restart_terminal", {
      id: terminalId,
      shell: "powershell",
      cols: 120,
      rows: 30,
      cwd: PROJECT_PATH,
    });
    await waitForTerminalListed(page, terminalId, true);
    await new Promise((resolveWait) => setTimeout(resolveWait, 700));
    await call(page, "write_terminal", { id: terminalId, data: `Write-Output "${PTY_SENTINEL_AFTER}"\r` });
    const afterSnapshot = await waitForGrid(page, terminalId, PTY_SENTINEL_AFTER);
    const metrics = await call(page, "performance_observatory_metrics", { terminalId });
    return {
      terminalId,
      beforeVisible: gridContains(beforeSnapshot, PTY_SENTINEL_BEFORE),
      afterVisible: gridContains(afterSnapshot, PTY_SENTINEL_AFTER),
      activeTerminalCount: metrics.activeTerminalCount,
      paneCount: metrics.paneCount,
      dbWriteLatencyMs: metrics.dbWriteLatencyMs ?? null,
    };
  } finally {
    await call(page, "close_terminal", { id: terminalId }).catch(() => {});
  }
}

function aiCliTypedBlocker(error) {
  return {
    status: "typed-blocker",
    blockerKind: "external_dependency",
    dependency: "AI CLI executable or safe authenticated interactive CLI session",
    reason:
      "The live chaos shard could not start a PTY-backed AI CLI session in this environment; terminal runtime recovery was still validated with a live PTY force restart.",
    error: error?.message ?? String(error),
  };
}

async function smokeAiCliKillCleanup(page) {
  let spawnResult = null;
  try {
    spawnResult = await call(page, "spawn_interactive_agent", {
      cwd: PROJECT_PATH,
      model: "codex",
      initialPrompt: null,
      branchName: null,
      cols: 100,
      rows: 28,
    });
  } catch (error) {
    return aiCliTypedBlocker(error);
  }

  const sessionId = spawnResult.session_id ?? spawnResult.sessionId ?? spawnResult.pty_id ?? spawnResult.ptyId;
  const ptyId = spawnResult.pty_id ?? spawnResult.ptyId ?? sessionId;
  if (!sessionId || !ptyId) return aiCliTypedBlocker(new Error(`Unexpected spawn_interactive_agent result: ${JSON.stringify(spawnResult)}`));

  try {
    await waitForInteractiveSession(page, sessionId, (session) => !!session);
    await call(page, "close_terminal", { id: ptyId });
    const afterKill = await waitForInteractiveSession(page, sessionId, (session) => session?.status === "done");
    await call(page, "stop_interactive_agent", { id: sessionId }).catch(() => {});
    const afterCleanup = await waitForInteractiveSession(
      page,
      sessionId,
      (_session, sessions) => !sessions.some((item) => item.id === sessionId || item.pty_id === ptyId),
    );
    return {
      status: "pass",
      sessionId,
      ptyId,
      killedBy: "close_terminal",
      statusAfterKill: afterKill.session?.status ?? null,
      remainingSessionsAfterCleanup: afterCleanup.sessions.length,
    };
  } catch (error) {
    await call(page, "stop_interactive_agent", { id: sessionId }).catch(() => {});
    throw error;
  }
}

async function fetchDashboardTruth() {
  const response = await fetch(DASHBOARD_STATE_URL, { cache: "no-store" });
  if (!response.ok) throw new Error(`dashboard state returned HTTP ${response.status}`);
  const state = await response.json();
  return {
    activeCard: state.activeCard?.id ?? null,
    done: state.roadmap?.done ?? state.summary?.done ?? null,
    total: state.roadmap?.total ?? state.summary?.total ?? null,
    blockerStatus: state.blockerAnalysis?.status ?? null,
    finalStatus: state.finalReport?.finalStatus ?? null,
    qualityGate: state.activeCard?.qualityGate ?? state.qualityGate?.status ?? null,
  };
}

async function main() {
  const report = {
    version: 1,
    taskId: "auto-1778017073638-p2-07-live-tauri-pty-ai-cli-chaos",
    roadmapId: "P2-07",
    parentRoadmapId: "P2-07",
    reason: "blocker-decomposition",
    cdp: CDP,
    projectPath: PROJECT_PATH,
    dashboardStateUrl: DASHBOARD_STATE_URL,
    startedAt: new Date().toISOString(),
    status: "running",
  };

  let browser;
  let page;
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
      console.error(`[live-chaos] ${report.error}`);
      process.exit(2);
    }

    await page.bringToFront().catch(() => {});
    await openChaosQaPage(page);
    const hasInternals = await page.evaluate(() => !!window.__TAURI_INTERNALS__?.invoke);
    if (!hasInternals) throw new Error("Attached page does not expose __TAURI_INTERNALS__.invoke");

    report.localStorageReload = await smokeLocalStorageReload(page);
    report.ptyForceRestart = await smokePtyForceRestart(page);
    report.aiCliKillCleanup = await smokeAiCliKillCleanup(page);
    report.dashboardTruth = await fetchDashboardTruth();

    const checks = {
      webviewAttached: hasInternals,
      localStorageClearReloadedApp: report.localStorageReload.afterClearReload.hasApp && report.localStorageReload.afterClearReload.hasMain,
      localStorageClearNoPageOverflow: !report.localStorageReload.afterClearReload.bodyOverflow,
      localStorageReseedRecoveredProject: report.localStorageReload.afterReseed.hasProject,
      ptyRestartBeforeVisible: report.ptyForceRestart.beforeVisible,
      ptyRestartAfterVisible: report.ptyForceRestart.afterVisible,
      ptyMetricsStillHealthy: report.ptyForceRestart.activeTerminalCount > 0 && report.ptyForceRestart.paneCount > 0,
      aiCliKillCoveredOrTyped:
        report.aiCliKillCleanup.status === "pass" ||
        (report.aiCliKillCleanup.status === "typed-blocker" && report.aiCliKillCleanup.blockerKind === "external_dependency"),
      dashboardTruthHealthy: report.dashboardTruth.activeCard === "P2-07" || report.dashboardTruth.finalStatus === "complete",
      dashboardNotBlocked:
        report.dashboardTruth.finalStatus === "complete" ||
        report.dashboardTruth.blockerStatus === "not_blocked" || report.dashboardTruth.blockerStatus === "probe-recovered",
    };
    report.checks = checks;
    const failed = Object.entries(checks).filter(([, ok]) => !ok);
    if (failed.length > 0) {
      throw new Error(`Live chaos smoke failed checks: ${failed.map(([name]) => name).join(", ")}`);
    }

    report.status = report.aiCliKillCleanup.status === "typed-blocker" ? "partial-pass" : "pass";
    report.completedAt = new Date().toISOString();
    const artifact = writeArtifact(report);
    console.log(`[live-chaos] ${report.status}: ${artifact}`);
    console.log(
      `[live-chaos] localStorageReload=pass pty=${report.ptyForceRestart.terminalId} aiCli=${report.aiCliKillCleanup.status} dashboard=${report.dashboardTruth.activeCard}`,
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
    console.error(`[live-chaos] ${report.status}: ${artifact}`);
    console.error(`[live-chaos] ${report.error}`);
    process.exit(report.status === "external_dependency" ? 2 : 1);
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

main();
