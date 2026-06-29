// Live Tauri/WebView2 smoke for multi-pane command-block evidence.
//
// Prerequisite:
//   AELYRIS_API_TOKEN=dev pnpm.cmd tauri:dev
//
// Optional env:
//   AELYRIS_MULTIPANE_COMMAND_EVIDENCE_CDP=http://127.0.0.1:9222
//   AELYRIS_MULTIPANE_COMMAND_EVIDENCE_URL=http://localhost:1420/
//   AELYRIS_MULTIPANE_COMMAND_EVIDENCE_PROJECT=C:/repo/aelyris
//   AELYRIS_MULTIPANE_COMMAND_EVIDENCE_OUT=.codex-auto/production-smoke/multipane-command-evidence.json

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { chromium } from "@playwright/test";

const CDP = process.env.AELYRIS_MULTIPANE_COMMAND_EVIDENCE_CDP ?? "http://127.0.0.1:9222";
const APP_URL = process.env.AELYRIS_MULTIPANE_COMMAND_EVIDENCE_URL ?? "http://localhost:1420/";
const APP_ORIGIN = new URL(APP_URL).origin;
const PROJECT_PATH = (process.env.AELYRIS_MULTIPANE_COMMAND_EVIDENCE_PROJECT ?? process.cwd()).replaceAll("\\", "/");
const OUT =
  process.env.AELYRIS_MULTIPANE_COMMAND_EVIDENCE_OUT ?? ".codex-auto/production-smoke/multipane-command-evidence.json";
const WAIT_MS = Number.parseInt(process.env.AELYRIS_MULTIPANE_COMMAND_EVIDENCE_WAIT_MS ?? "90000", 10);
const LONG_OUTPUT_LINES = Number.parseInt(process.env.AELYRIS_MULTIPANE_COMMAND_EVIDENCE_LINES ?? "96", 10);

const report = {
  ok: false,
  startedAt: new Date().toISOString(),
  cdp: CDP,
  appUrl: APP_URL,
  projectPath: PROJECT_PATH,
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
    /spawn EPERM|connect ECONNREFUSED|Cannot attach to WebView2 CDP|CDP endpoint did not respond|browserType\.launch/i.test(
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

function isAelyrisPage(page) {
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

function describePages(context) {
  const pages = context.pages();
  if (pages.length === 0) return "no CDP pages were exposed";
  return pages.map((page, index) => `  ${index + 1}. ${page.url() || "(blank)"}`).join("\n");
}

function pickAelyrisPage(context) {
  const pages = context?.pages() ?? [];
  return pages.find(isAelyrisPage) ?? pages.find((page) => page.url() === "about:blank") ?? pages[0] ?? null;
}

function targetQaUrl() {
  const url = new URL(APP_URL);
  url.searchParams.set("aelyrisVisualQa", "1");
  url.searchParams.set("projectPath", PROJECT_PATH);
  url.searchParams.set("rail", "command");
  url.searchParams.set("v", "multipane-command-evidence");
  url.searchParams.delete("state");
  url.searchParams.delete("edgeLoop");
  url.searchParams.delete("aelyrisDashboardStateUrl");
  return url.toString();
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
    `Cannot attach to WebView2 CDP at ${CDP}. Start Aelyris with AELYRIS_API_TOKEN=dev pnpm.cmd tauri:dev. ${
      lastError?.message ?? "CDP endpoint did not respond"
    }`,
  );
}

async function ensureCleanApp(page) {
  await page.evaluate((projectPath) => {
    localStorage.setItem("aelyris:lastProject", projectPath);
    localStorage.setItem("aelyris:onboarding-done", "1");
    localStorage.removeItem("aelyris:dashboardStateUrl");
  }, PROJECT_PATH);
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
    await sleep(150);
  }
  const ids = await listTerminalIds(page);
  if (!ids.includes(terminalId)) {
    throw new Error(`Terminal ${terminalId} was not listed by the backend: ${JSON.stringify(ids)}`);
  }
  return ids;
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
  const deadline = Date.now() + 18000;
  while (Date.now() < deadline) {
    const text = await gridText(page, terminalId);
    if (text.includes(needle)) return text;
    await sleep(250);
  }
  const text = await gridText(page, terminalId);
  if (text.includes(needle)) return text;
  throw new Error(`Terminal ${terminalId} did not show ${needle}; sample=${text.slice(-600)}`);
}

async function waitForCommandBlock(page, terminalId, marker) {
  const deadline = Date.now() + 18000;
  while (Date.now() < deadline) {
    const blocks = await call(page, "term_command_blocks", { id: terminalId, limit: 24 }).catch(() => []);
    const block = Array.isArray(blocks) ? blocks.find((item) => item?.command?.includes(marker)) : null;
    if (block?.status && block.status !== "running") return { blocks, block };
    await sleep(250);
  }
  const blocks = await call(page, "term_command_blocks", { id: terminalId, limit: 24 }).catch(() => []);
  return { blocks, block: Array.isArray(blocks) ? blocks.find((item) => item?.command?.includes(marker)) : null };
}

async function historyContains(page, terminalId, marker) {
  const historySize = await call(page, "term_history_size", { id: terminalId }).catch(() => 0);
  const rows = await call(page, "term_history_rows", {
    id: terminalId,
    fromN: 0,
    count: Math.min(Math.max(historySize, 1), 160),
  }).catch(() => []);
  const text = Array.isArray(rows) ? rows.map((row) => row.map((cell) => cell.ch).join("")).join("\n") : "";
  return { historySize, found: text.includes(marker), sample: text.slice(0, 800) };
}

async function waitForHistoryContains(page, terminalId, marker) {
  const deadline = Date.now() + 12000;
  let last = null;
  while (Date.now() < deadline) {
    last = await historyContains(page, terminalId, marker);
    if (last.historySize >= Math.max(10, LONG_OUTPUT_LINES - 40) && last.found) return last;
    await sleep(250);
  }
  return last ?? (await historyContains(page, terminalId, marker));
}

async function submitLongCommand(page, terminalId, label) {
  const marker = `AELYRIS_${label}_${Math.random().toString(36).slice(2, 8)}`.toUpperCase();
  const done = `${marker}_DONE`;
  const command = `for ($i=1; $i -le ${LONG_OUTPUT_LINES}; $i++) { Write-Output "${marker}_$i" }; Write-Output "${done}"`;
  await call(page, "send_keys", { terminalId, data: `${command}\r` });
  const visibleText = await waitForGridText(page, terminalId, done);
  const { blocks, block } = await waitForCommandBlock(page, terminalId, marker);
  if (!block) throw new Error(`No command block found for ${marker}`);
  if (block.terminalId !== terminalId) throw new Error(`Command block terminal mismatch for ${marker}`);
  if (block.status !== "passed") throw new Error(`Command block did not pass for ${marker}: ${JSON.stringify(block)}`);
  if (block.exitCode !== 0)
    throw new Error(`Command block exit code was not 0 for ${marker}: ${JSON.stringify(block)}`);
  if (typeof block.endSequence !== "number" || typeof block.endHistorySize !== "number") {
    throw new Error(`Command block missing end anchors for ${marker}: ${JSON.stringify(block)}`);
  }
  const history = await waitForHistoryContains(page, terminalId, `${marker}_1`);
  if (history.historySize < Math.max(10, LONG_OUTPUT_LINES - 40)) {
    throw new Error(`History did not grow for ${marker}: ${JSON.stringify(history)}`);
  }
  if (!history.found) {
    throw new Error(`Scrollback rows did not retain first marker for ${marker}: ${JSON.stringify(history)}`);
  }
  return { terminalId, marker, done, command, visibleSample: visibleText.slice(-800), block, history, blocks };
}

async function main() {
  let browser = null;
  try {
    browser = await connectOverCdpWithRetry();
    const context = browser.contexts()[0];
    const page = pickAelyrisPage(context);
    if (!page) {
      throw new Error(`No Aelyris Tauri page found over CDP.\n${describePages(context)}`);
    }

    await ensureCleanApp(page);

    const consoleErrors = [];
    const pageErrors = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text().slice(0, 1000));
    });
    page.on("pageerror", (error) => pageErrors.push(error.message));

    const baseTerminalId = await call(page, "spawn_terminal", {
      shell: "powershell",
      cols: 100,
      rows: 16,
      cwd: PROJECT_PATH,
    });
    await waitForTerminal(page, baseTerminalId);

    const splitTerminalId = await call(page, "mux_split_pane", {
      workspaceId: baseTerminalId,
      targetPaneId: baseTerminalId,
      axis: "horizontal",
      shell: "powershell",
      cols: 100,
      rows: 16,
      cwd: PROJECT_PATH,
      title: "evidence-split",
    });
    const terminalIdsAfterSplit = await waitForTerminal(page, splitTerminalId);
    if (!terminalIdsAfterSplit.includes(baseTerminalId)) {
      throw new Error(`Base terminal ${baseTerminalId} disappeared after split`);
    }

    report.checks.terminals = { baseTerminalId, splitTerminalId, terminalIdsAfterSplit };
    report.checks.base = await submitLongCommand(page, baseTerminalId, "BASE_SCROLL");
    report.checks.split = await submitLongCommand(page, splitTerminalId, "SPLIT_SCROLL");

    await call(page, "mux_close_pane", { workspaceId: baseTerminalId, paneId: splitTerminalId });
    const terminalIdsAfterClose = await listTerminalIds(page);
    report.checks.terminalIdsAfterClose = terminalIdsAfterClose;
    if (!terminalIdsAfterClose.includes(baseTerminalId)) {
      throw new Error(`Base terminal ${baseTerminalId} disappeared after closing split pane`);
    }
    if (terminalIdsAfterClose.includes(splitTerminalId)) {
      throw new Error(`Split terminal ${splitTerminalId} remained listed after mux_close_pane`);
    }
    const baseAfterClose = await waitForCommandBlock(page, baseTerminalId, report.checks.base.marker);
    report.checks.baseAfterClose = baseAfterClose.block ?? null;
    if (baseAfterClose.block?.status !== "passed" || typeof baseAfterClose.block?.endHistorySize !== "number") {
      throw new Error(`Base command evidence did not survive split close: ${JSON.stringify(baseAfterClose.block)}`);
    }

    if (consoleErrors.length > 0 || pageErrors.length > 0) {
      throw new Error(`Runtime errors detected: ${[...consoleErrors, ...pageErrors].slice(0, 4).join(" | ")}`);
    }

    report.checks.consoleErrors = consoleErrors;
    report.checks.pageErrors = pageErrors;
    report.ok = true;
  } catch (error) {
    report.errors.push(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  } finally {
    if (browser) {
      if (typeof browser.disconnect === "function") browser.disconnect();
      else await browser.close().catch(() => {});
    }
    const artifact = !report.ok && isEnvironmentUnavailable() ? writeDiagnosticArtifact() : writeArtifact();
    if (report.ok) {
      console.log(`multipane command evidence smoke passed: ${artifact}`);
    } else if (isEnvironmentUnavailable()) {
      console.error(`multipane command evidence smoke environment-blocked; primary artifact preserved: ${artifact}`);
    } else {
      console.error(`multipane command evidence smoke failed: ${artifact}`);
    }
  }
}

await main();
