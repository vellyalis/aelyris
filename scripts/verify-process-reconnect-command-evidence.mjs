// Live Tauri/WebView2 smoke for app-process reconnect to a long-lived sidecar.
//
// Prerequisite:
//   QUORUM_API_TOKEN=dev pnpm.cmd tauri:dev
//
// This smoke intentionally stops the current Aether.exe process, verifies the
// PTY sidecar still owns the test terminal, starts the debug Aether.exe again,
// and proves the restarted app adopts the same terminal id with persisted
// command evidence plus fresh post-reconnect input.
//
// Optional env:
//   AETHER_PROCESS_RECONNECT_CDP=http://127.0.0.1:9222
//   AETHER_PROCESS_RECONNECT_URL=http://localhost:1420/
//   AETHER_PROCESS_RECONNECT_PROJECT=C:/repo/aether-terminal
//   AETHER_PROCESS_RECONNECT_TOKEN=dev
//   AETHER_PROCESS_RECONNECT_OUT=.codex-auto/production-smoke/process-reconnect-command-evidence.json

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { chromium } from "@playwright/test";

const ROOT = resolve(process.cwd());
const CDP = process.env.AETHER_PROCESS_RECONNECT_CDP ?? "http://127.0.0.1:9222";
const APP_URL = process.env.AETHER_PROCESS_RECONNECT_URL ?? "http://localhost:1420/";
const APP_ORIGIN = new URL(APP_URL).origin;
const PROJECT_PATH = (process.env.AETHER_PROCESS_RECONNECT_PROJECT ?? ROOT).replaceAll("\\", "/");
const TOKEN = process.env.AETHER_PROCESS_RECONNECT_TOKEN ?? readSidecarToken() ?? process.env.QUORUM_API_TOKEN ?? "dev";
const OUT =
  process.env.AETHER_PROCESS_RECONNECT_OUT ?? ".codex-auto/production-smoke/process-reconnect-command-evidence.json";
const WAIT_MS = Number.parseInt(process.env.AETHER_PROCESS_RECONNECT_WAIT_MS ?? "90000", 10);
const DEBUG_APP_EXE = join(ROOT, "src-tauri", "target", "debug", "Aether.exe");
const SIDECAR_URL = process.env.AETHER_PROCESS_RECONNECT_SIDECAR_URL ?? "http://127.0.0.1:9334";

const report = {
  ok: false,
  startedAt: new Date().toISOString(),
  cdp: CDP,
  appUrl: APP_URL,
  projectPath: PROJECT_PATH,
  debugAppExe: DEBUG_APP_EXE,
  checks: {},
  errors: [],
};

function writeArtifact() {
  const outPath = resolve(OUT);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify({ ...report, finishedAt: new Date().toISOString() }, null, 2)}\n`);
  return outPath;
}

function isEnvironmentUnavailable() {
  return report.errors.some((error) =>
    /spawn EPERM|connect ECONNREFUSED|Cannot attach to WebView2 CDP|CDP endpoint did not respond|browserType\.launch|PowerShell failed \(null\)|No running debug\/release Aether\.exe process found|Debug app executable missing|Vite dev server/i.test(
      String(error),
    ),
  );
}

function writeDiagnosticArtifact() {
  const outPath = resolve(`${OUT}.environment-blocked.json`);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(
    outPath,
    `${JSON.stringify(
      {
        ...report,
        status: "environment-blocked",
        preservesPrimaryArtifact: true,
        finishedAt: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
  );
  return outPath;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function appUrlNeedsDevServer() {
  try {
    const url = new URL(APP_URL);
    return url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1";
  } catch {
    return false;
  }
}

async function devServerReady() {
  try {
    const response = await fetch(APP_URL, { method: "GET" });
    return response.ok || response.status < 500;
  } catch {
    return false;
  }
}

async function ensureDevServer() {
  if (!appUrlNeedsDevServer() || (await devServerReady())) return null;
  const child = spawn("pnpm.cmd", ["dev"], {
    cwd: ROOT,
    env: { ...process.env, QUORUM_API_TOKEN: TOKEN },
    stdio: "ignore",
    windowsHide: true,
  });
  const deadline = Date.now() + WAIT_MS;
  while (Date.now() < deadline) {
    if (await devServerReady()) return child;
    if (child.exitCode !== null) {
      throw new Error(`Vite dev server exited early with code ${child.exitCode}`);
    }
    await sleep(500);
  }
  child.kill();
  throw new Error(`Vite dev server did not become ready at ${APP_URL}`);
}

function readSidecarToken() {
  const candidates = [
    process.env.QUORUM_PTY_SERVER_TOKEN_FILE,
    process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, "Aether Terminal", "aether-pty-server.token") : null,
    process.env.USERPROFILE ? join(process.env.USERPROFILE, ".aether", "aether-pty-server.token") : null,
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      const token = readFileSync(candidate, "utf8").trim();
      if (token) return token;
    } catch {}
  }
  return null;
}

function targetQaUrl() {
  const url = new URL(APP_URL);
  url.searchParams.set("aetherVisualQa", "1");
  url.searchParams.set("projectPath", PROJECT_PATH);
  url.searchParams.set("rail", "command");
  url.searchParams.set("v", "process-reconnect-command-evidence");
  url.searchParams.delete("state");
  url.searchParams.delete("edgeLoop");
  url.searchParams.delete("aetherDashboardStateUrl");
  return url.toString();
}

function isAetherPage(page) {
  const url = page.url();
  return (
    url.startsWith(APP_ORIGIN) ||
    url.includes("localhost:1420") ||
    url.includes("127.0.0.1:1420") ||
    url.startsWith("tauri://localhost") ||
    url.startsWith("http://tauri.localhost") ||
    url.startsWith("https://tauri.localhost")
  );
}

function pickAetherPage(context) {
  const pages = context?.pages() ?? [];
  return pages.find(isAetherPage) ?? pages.find((page) => page.url() === "about:blank") ?? pages[0] ?? null;
}

function describePages(context) {
  const pages = context?.pages() ?? [];
  if (pages.length === 0) return "no CDP pages were exposed";
  return pages.map((page, index) => `  ${index + 1}. ${page.url() || "(blank)"}`).join("\n");
}

function powershell(command) {
  const result = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command], {
    cwd: ROOT,
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.status !== 0) {
    const errorMessage = result.error?.message ? `${result.error.message} ` : "";
    throw new Error(
      `PowerShell failed (${result.status ?? "null"}): ${errorMessage}${result.stderr || result.stdout || command}`,
    );
  }
  return result.stdout.trim();
}

function findAetherPids() {
  const output = powershell(`
    Get-Process Aether -ErrorAction SilentlyContinue |
      Where-Object { $_.Path -and ($_.Path -like '*Aether_Terminal*target*debug*Aether.exe' -or $_.Path -like '*Aether_Terminal*target*release*Aether.exe') } |
      Select-Object -ExpandProperty Id
  `);
  return output
    .split(/\r?\n/)
    .map((line) => Number.parseInt(line.trim(), 10))
    .filter(Number.isFinite);
}

function stopAetherPids(pids) {
  if (pids.length === 0) return;
  powershell(`Stop-Process -Id ${pids.join(",")} -Force -ErrorAction SilentlyContinue`);
}

async function connectOverCdpWithRetry() {
  const deadline = Date.now() + WAIT_MS;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      return await chromium.connectOverCDP(CDP);
    } catch (error) {
      lastError = error;
      await sleep(1000);
    }
  }
  throw new Error(
    `Cannot attach to WebView2 CDP at ${CDP}. Start Aether with QUORUM_API_TOKEN=dev pnpm.cmd tauri:dev. ${
      lastError?.message ?? "CDP endpoint did not respond"
    }`,
  );
}

async function waitForCdpDown() {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try {
      await fetch(`${CDP.replace(/\/$/, "")}/json/version`, { signal: AbortSignal.timeout(800) });
    } catch {
      return true;
    }
    await sleep(500);
  }
  return false;
}

async function ensureCleanApp(page) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await page.waitForLoadState("domcontentloaded", { timeout: 5000 }).catch(() => {});
      await page.evaluate((projectPath) => {
        localStorage.setItem("aether:lastProject", projectPath);
        localStorage.setItem("aether:onboarding-done", "1");
        localStorage.removeItem("aether:dashboardStateUrl");
      }, PROJECT_PATH);
      break;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/localStorage|Access is denied|SecurityError/.test(message)) {
        await page.goto(targetQaUrl(), { waitUntil: "domcontentloaded", timeout: WAIT_MS }).catch(() => {});
        await sleep(500);
        continue;
      }
      if (!/Execution context was destroyed|Cannot find context|Target page/.test(message) || attempt === 4) {
        throw error;
      }
      await sleep(500);
    }
  }
  await page.goto(targetQaUrl(), { waitUntil: "domcontentloaded", timeout: WAIT_MS });
  await page.waitForSelector(".app-container", { timeout: WAIT_MS });
}

async function call(page, command, args = {}) {
  return await page.evaluate(async ({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args), {
    command,
    args,
  });
}

async function listTerminalIds(page) {
  return await page.evaluate(async () => {
    const direct = await window.__TAURI_INTERNALS__.invoke("list_terminals", {}).catch(() => []);
    if (Array.isArray(direct) && direct.length > 0) return direct;
    const panes = await window.__TAURI_INTERNALS__.invoke("list_panes_info", {}).catch(() => []);
    return Array.isArray(panes)
      ? panes.map((pane) => pane?.terminal_id).filter((id) => typeof id === "string" && id.length > 0)
      : [];
  });
}

async function waitForTerminal(page, terminalId) {
  const deadline = Date.now() + WAIT_MS;
  while (Date.now() < deadline) {
    const ids = await listTerminalIds(page);
    if (ids.includes(terminalId)) return ids;
    await sleep(250);
  }
  const ids = await listTerminalIds(page);
  throw new Error(`Terminal ${terminalId} was not listed by the restarted app: ${JSON.stringify(ids)}`);
}

async function gridText(page, terminalId) {
  return await page.evaluate(
    async ({ id }) => {
      const snap = await window.__TAURI_INTERNALS__.invoke("term_snapshot", { id }).catch(() => null);
      if (!snap) return "";
      return snap.cells.map((row) => row.map((cell) => cell.ch).join("")).join("\n");
    },
    { id: terminalId },
  );
}

async function waitForGridText(page, terminalId, needle) {
  const deadline = Date.now() + 22000;
  while (Date.now() < deadline) {
    const text = await gridText(page, terminalId);
    if (text.includes(needle)) return text;
    await sleep(250);
  }
  const text = await gridText(page, terminalId);
  if (text.includes(needle)) return text;
  throw new Error(`Terminal ${terminalId} did not show ${needle}; sample=${text.slice(-600)}`);
}

async function waitForShellReady(page, terminalId) {
  const deadline = Date.now() + 30000;
  let text = "";
  while (Date.now() < deadline) {
    text = await gridText(page, terminalId);
    if (/PS\s+.*>\s*$/m.test(text) || text.includes("PowerShell")) return text;
    await sleep(250);
  }
  throw new Error(`Terminal ${terminalId} did not become shell-ready; sample=${text.slice(-600)}`);
}

async function waitForBlock(page, commandName, terminalId, marker) {
  const deadline = Date.now() + 22000;
  while (Date.now() < deadline) {
    const blocks = await call(page, commandName, { id: terminalId, limit: 32 }).catch(() => []);
    const block = Array.isArray(blocks) ? blocks.find((item) => item?.command?.includes(marker)) : null;
    if (block?.status && block.status !== "running") return { blocks, block };
    await sleep(250);
  }
  const blocks = await call(page, commandName, { id: terminalId, limit: 32 }).catch(() => []);
  return { blocks, block: Array.isArray(blocks) ? blocks.find((item) => item?.command?.includes(marker)) : null };
}

function assertAnchoredPassed(block, label) {
  if (!block) throw new Error(`${label} command block is missing`);
  if (block.status !== "passed") throw new Error(`${label} command block did not pass: ${JSON.stringify(block)}`);
  if (block.exitCode !== 0) throw new Error(`${label} command block exit code was not 0: ${JSON.stringify(block)}`);
  if (typeof block.endSequence !== "number" || typeof block.endHistorySize !== "number") {
    throw new Error(`${label} command block is missing anchors: ${JSON.stringify(block)}`);
  }
}

async function sidecarSessions() {
  const response = await fetch(`${SIDECAR_URL}/sessions`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
    signal: AbortSignal.timeout(2500),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`sidecar sessions failed ${response.status}: ${body}`);
  }
  return await response.json();
}

async function waitForSidecarTerminal(terminalId) {
  const deadline = Date.now() + 30000;
  let last = [];
  while (Date.now() < deadline) {
    last = await sidecarSessions();
    if (Array.isArray(last) && last.some((session) => session?.id === terminalId)) return last;
    await sleep(500);
  }
  throw new Error(`Sidecar did not retain terminal ${terminalId}: ${JSON.stringify(last)}`);
}

function startDebugApp() {
  if (!existsSync(DEBUG_APP_EXE)) {
    throw new Error(`Debug app executable missing: ${DEBUG_APP_EXE}. Run pnpm tauri:dev once first.`);
  }
  return spawn(DEBUG_APP_EXE, [], {
    cwd: join(ROOT, "src-tauri"),
    env: { ...process.env, QUORUM_API_TOKEN: TOKEN },
    stdio: "ignore",
    windowsHide: true,
  });
}

async function attachPage() {
  const browser = await connectOverCdpWithRetry();
  const context = browser.contexts()[0];
  const page = pickAetherPage(context);
  if (!page) {
    throw new Error(`No Aether Tauri page found over CDP.\n${describePages(context)}`);
  }
  return { browser, page };
}

async function main() {
  let firstBrowser = null;
  let secondBrowser = null;
  let restartedApp = null;
  let devServer = null;
  let terminalId = null;
  let splitTerminalId = null;
  try {
    const initialPids = findAetherPids();
    if (initialPids.length === 0) {
      throw new Error("No running debug/release Aether.exe process found. Start pnpm tauri:dev first.");
    }
    report.checks.initialAetherPids = initialPids;

    const first = await attachPage();
    firstBrowser = first.browser;
    await ensureCleanApp(first.page);

    terminalId = await call(first.page, "spawn_terminal", {
      shell: "powershell",
      cols: 100,
      rows: 24,
      cwd: PROJECT_PATH,
    });
    await waitForTerminal(first.page, terminalId);
    await waitForShellReady(first.page, terminalId);
    report.checks.terminalId = terminalId;

    const firstMarker = `AETHER_PROCESS_RECONNECT_BEFORE_${Math.random().toString(36).slice(2, 8)}`.toUpperCase();
    const firstCommand = `Write-Output "${firstMarker}"`;
    await call(first.page, "send_keys", { terminalId, data: `${firstCommand}\r` });
    await waitForGridText(first.page, terminalId, firstMarker);
    const liveBefore = await waitForBlock(first.page, "term_command_blocks", terminalId, firstMarker);
    const persistedBefore = await waitForBlock(first.page, "term_persisted_command_blocks", terminalId, firstMarker);
    assertAnchoredPassed(liveBefore.block, "before-stop live");
    assertAnchoredPassed(persistedBefore.block, "before-stop persisted");
    report.checks.beforeStopBlock = liveBefore.block;
    report.checks.beforeStopPersistedBlock = persistedBefore.block;

    splitTerminalId = await call(first.page, "mux_split_pane", {
      workspaceId: terminalId,
      targetPaneId: terminalId,
      axis: "horizontal",
      shell: "powershell",
      cols: 100,
      rows: 16,
      cwd: PROJECT_PATH,
      title: "process-reconnect-split",
    });
    await waitForTerminal(first.page, splitTerminalId);
    await waitForShellReady(first.page, splitTerminalId);
    report.checks.splitTerminalId = splitTerminalId;

    const splitBeforeMarker =
      `AETHER_PROCESS_RECONNECT_SPLIT_BEFORE_${Math.random().toString(36).slice(2, 8)}`.toUpperCase();
    const splitBeforeCommand = `Write-Output "${splitBeforeMarker}"`;
    await call(first.page, "send_keys", { terminalId: splitTerminalId, data: `${splitBeforeCommand}\r` });
    await waitForGridText(first.page, splitTerminalId, splitBeforeMarker);
    const splitLiveBefore = await waitForBlock(first.page, "term_command_blocks", splitTerminalId, splitBeforeMarker);
    const splitPersistedBefore = await waitForBlock(
      first.page,
      "term_persisted_command_blocks",
      splitTerminalId,
      splitBeforeMarker,
    );
    assertAnchoredPassed(splitLiveBefore.block, "split before-stop live");
    assertAnchoredPassed(splitPersistedBefore.block, "split before-stop persisted");
    report.checks.splitBeforeStopBlock = splitLiveBefore.block;
    report.checks.splitBeforeStopPersistedBlock = splitPersistedBefore.block;

    if (typeof firstBrowser.disconnect === "function") firstBrowser.disconnect();
    else await firstBrowser.close().catch(() => {});
    firstBrowser = null;

    stopAetherPids(initialPids);
    report.checks.cdpStopped = await waitForCdpDown();
    const sidecarAfterStop = await waitForSidecarTerminal(terminalId);
    const retainedIds = new Set(sidecarAfterStop.map((session) => session?.id).filter(Boolean));
    report.checks.sidecarRetainedTerminal = retainedIds.has(terminalId);
    report.checks.sidecarRetainedSplitTerminal = retainedIds.has(splitTerminalId);
    report.checks.sidecarSessionCountAfterStop = sidecarAfterStop.length;

    devServer = await ensureDevServer();
    restartedApp = startDebugApp();
    report.checks.restartedPid = restartedApp.pid;
    await sleep(1000);

    const second = await attachPage();
    secondBrowser = second.browser;
    await ensureCleanApp(second.page);
    await waitForTerminal(second.page, terminalId);
    const idsAfterRestart = await waitForTerminal(second.page, splitTerminalId);
    report.checks.idsAfterRestart = idsAfterRestart;
    report.checks.terminalAdoptedAfterRestart = idsAfterRestart.includes(terminalId);
    report.checks.splitTerminalAdoptedAfterRestart = idsAfterRestart.includes(splitTerminalId);

    const recovered = await waitForBlock(second.page, "term_command_blocks", terminalId, firstMarker);
    assertAnchoredPassed(recovered.block, "after-process-restart recovered");
    report.checks.recoveredBlock = recovered.block;
    const splitRecovered = await waitForBlock(second.page, "term_command_blocks", splitTerminalId, splitBeforeMarker);
    assertAnchoredPassed(splitRecovered.block, "split after-process-restart recovered");
    report.checks.splitRecoveredBlock = splitRecovered.block;

    const secondMarker = `AETHER_PROCESS_RECONNECT_AFTER_${Math.random().toString(36).slice(2, 8)}`.toUpperCase();
    const secondCommand = `Write-Output "${secondMarker}"`;
    await call(second.page, "send_keys", { terminalId, data: `${secondCommand}\r` });
    await waitForGridText(second.page, terminalId, secondMarker);
    const afterRestart = await waitForBlock(second.page, "term_command_blocks", terminalId, secondMarker);
    const afterRestartPersisted = await waitForBlock(
      second.page,
      "term_persisted_command_blocks",
      terminalId,
      secondMarker,
    );
    assertAnchoredPassed(afterRestart.block, "after-restart live");
    assertAnchoredPassed(afterRestartPersisted.block, "after-restart persisted");
    report.checks.afterRestartBlock = afterRestart.block;
    report.checks.afterRestartPersistedBlock = afterRestartPersisted.block;

    const splitAfterMarker =
      `AETHER_PROCESS_RECONNECT_SPLIT_AFTER_${Math.random().toString(36).slice(2, 8)}`.toUpperCase();
    const splitAfterCommand = `Write-Output "${splitAfterMarker}"`;
    await call(second.page, "send_keys", { terminalId: splitTerminalId, data: `${splitAfterCommand}\r` });
    await waitForGridText(second.page, splitTerminalId, splitAfterMarker);
    const splitAfterRestart = await waitForBlock(second.page, "term_command_blocks", splitTerminalId, splitAfterMarker);
    const splitAfterRestartPersisted = await waitForBlock(
      second.page,
      "term_persisted_command_blocks",
      splitTerminalId,
      splitAfterMarker,
    );
    assertAnchoredPassed(splitAfterRestart.block, "split after-restart live");
    assertAnchoredPassed(splitAfterRestartPersisted.block, "split after-restart persisted");
    report.checks.splitAfterRestartBlock = splitAfterRestart.block;
    report.checks.splitAfterRestartPersistedBlock = splitAfterRestartPersisted.block;

    report.ok = true;
  } catch (error) {
    report.errors.push(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  } finally {
    if (secondBrowser) {
      if (typeof secondBrowser.disconnect === "function") secondBrowser.disconnect();
      else await secondBrowser.close().catch(() => {});
    }
    if (firstBrowser) {
      if (typeof firstBrowser.disconnect === "function") firstBrowser.disconnect();
      else await firstBrowser.close().catch(() => {});
    }
    for (const id of [terminalId, splitTerminalId].filter(Boolean)) {
      await fetch(`${SIDECAR_URL}/sessions/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${TOKEN}` },
        signal: AbortSignal.timeout(2500),
      }).catch(() => {});
    }
    if (restartedApp?.pid) {
      stopAetherPids([restartedApp.pid]);
    }
    if (devServer?.pid) {
      devServer.kill();
    }
    const artifact = !report.ok && isEnvironmentUnavailable() ? writeDiagnosticArtifact() : writeArtifact();
    if (report.ok) {
      console.log(`process reconnect command evidence smoke passed: ${artifact}`);
    } else if (isEnvironmentUnavailable()) {
      console.error(
        `process reconnect command evidence smoke environment-blocked; primary artifact preserved: ${artifact}`,
      );
    } else {
      console.error(`process reconnect command evidence smoke failed: ${artifact}`);
    }
  }
}

await main();
