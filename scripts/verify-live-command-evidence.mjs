// Live Tauri/WebView2 smoke for native command-block evidence.
//
// Prerequisite:
//   AELYRIS_API_TOKEN=dev pnpm.cmd tauri:dev
//
// Optional env:
//   AELYRIS_COMMAND_EVIDENCE_CDP=http://127.0.0.1:9222
//   AELYRIS_COMMAND_EVIDENCE_URL=http://localhost:1420/
//   AELYRIS_COMMAND_EVIDENCE_PROJECT=C:/repo/aelyris
//   AELYRIS_COMMAND_EVIDENCE_OUT=.codex-auto/production-smoke/live-command-evidence.json

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { chromium } from "@playwright/test";

const CDP = process.env.AELYRIS_COMMAND_EVIDENCE_CDP ?? "http://127.0.0.1:9222";
const APP_URL = process.env.AELYRIS_COMMAND_EVIDENCE_URL ?? "http://localhost:1420/";
const APP_ORIGIN = new URL(APP_URL).origin;
const PROJECT_PATH = (process.env.AELYRIS_COMMAND_EVIDENCE_PROJECT ?? process.cwd()).replaceAll("\\", "/");
const OUT = process.env.AELYRIS_COMMAND_EVIDENCE_OUT ?? ".codex-auto/production-smoke/live-command-evidence.json";
const WAIT_MS = Number.parseInt(process.env.AELYRIS_COMMAND_EVIDENCE_WAIT_MS ?? "90000", 10);

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
    /spawn EPERM|connect ECONNREFUSED|Cannot attach to WebView2 CDP|CDP endpoint did not respond/i.test(String(error)),
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

function targetQaUrl() {
  const url = new URL(APP_URL);
  url.searchParams.set("aelyrisVisualQa", "1");
  url.searchParams.set("projectPath", PROJECT_PATH);
  url.searchParams.set("rail", "command");
  url.searchParams.set("v", "live-command-evidence");
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

async function listTerminalIds(page) {
  return await page.evaluate(async () => {
    const direct = await window.__TAURI_INTERNALS__.invoke("list_terminals", {}).catch(() => []);
    if (Array.isArray(direct) && direct.length > 0) return direct;
    const panes = await window.__TAURI_INTERNALS__.invoke("list_panes_info", {}).catch(() => []);
    const paneIds = Array.isArray(panes)
      ? panes.map((pane) => pane?.terminal_id).filter((id) => typeof id === "string" && id.length > 0)
      : [];
    if (paneIds.length > 0) return paneIds;
    return Array.from(document.querySelectorAll("canvas[data-terminal-id]"))
      .map((canvas) => canvas.getAttribute("data-terminal-id"))
      .filter((id) => typeof id === "string" && id.length > 0);
  });
}

async function waitForTerminalIds(page) {
  const deadline = Date.now() + WAIT_MS;
  while (Date.now() < deadline) {
    const ids = await listTerminalIds(page);
    if (ids.length > 0) return ids;
    await sleep(150);
  }
  return listTerminalIds(page);
}

async function gridContainsMarker(page, marker) {
  return await page.evaluate(async (needle) => {
    const direct = await window.__TAURI_INTERNALS__.invoke("list_terminals", {}).catch(() => []);
    const panes = await window.__TAURI_INTERNALS__.invoke("list_panes_info", {}).catch(() => []);
    const ids =
      Array.isArray(direct) && direct.length > 0
        ? direct
        : Array.isArray(panes)
          ? panes.map((pane) => pane?.terminal_id).filter((id) => typeof id === "string" && id.length > 0)
          : [];
    const hits = [];
    for (const id of ids) {
      const snap = await window.__TAURI_INTERNALS__.invoke("term_snapshot", { id }).catch(() => null);
      if (!snap) continue;
      const text = snap.cells.map((row) => row.map((cell) => cell.ch).join("")).join("\n");
      if (!text.includes(needle)) continue;
      hits.push({
        id,
        sample: text
          .split(/\n/)
          .find((line) => line.includes(needle))
          ?.slice(0, 160),
      });
    }
    return { ids, hits };
  }, marker);
}

async function waitForMarker(page, marker) {
  const deadline = Date.now() + 12000;
  while (Date.now() < deadline) {
    const result = await gridContainsMarker(page, marker);
    if (result.hits.length > 0) return result;
    await sleep(200);
  }
  return gridContainsMarker(page, marker);
}

async function waitForCommandBlock(page, terminalId, marker) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const blocks = await page.evaluate(
      async ({ id, limit }) => window.__TAURI_INTERNALS__.invoke("term_command_blocks", { id, limit }).catch(() => []),
      { id: terminalId, limit: 12 },
    );
    const block = Array.isArray(blocks) ? blocks.find((item) => item?.command?.includes(marker)) : null;
    if (block?.status && block.status !== "running") return { blocks, block };
    await sleep(250);
  }
  const blocks = await page.evaluate(
    async ({ id, limit }) => window.__TAURI_INTERNALS__.invoke("term_command_blocks", { id, limit }).catch(() => []),
    { id: terminalId, limit: 12 },
  );
  return { blocks, block: Array.isArray(blocks) ? blocks.find((item) => item?.command?.includes(marker)) : null };
}

async function main() {
  let browser = null;
  try {
    browser = await connectOverCdpWithRetry();
    const context = browser.contexts()[0];
    const page = context?.pages().find(isAelyrisPage);
    if (!page) {
      throw new Error(`No Aelyris Tauri page found over CDP.\n${describePages(context)}`);
    }

    const consoleErrors = [];
    const pageErrors = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text().slice(0, 1000));
    });
    page.on("pageerror", (error) => pageErrors.push(error.message));

    await ensureCleanApp(page);
    const terminalId = await page.evaluate(
      async ({ cwd }) =>
        window.__TAURI_INTERNALS__.invoke("spawn_terminal", {
          shell: "powershell",
          cols: 100,
          rows: 30,
          cwd,
        }),
      { cwd: PROJECT_PATH },
    );
    report.checks.spawnedTerminalId = terminalId;
    await sleep(1200);
    const terminalIds = await waitForTerminalIds(page);
    report.checks.terminalIds = terminalIds;
    if (!terminalIds.includes(terminalId)) {
      throw new Error(`Spawned terminal ${terminalId} was not listed by the backend`);
    }

    const marker = `AELYRIS_CMD_EVIDENCE_${Math.random().toString(36).slice(2, 8)}`;
    report.checks.marker = marker;

    await page.evaluate(
      async ({ id, command, cwd }) => {
        await window.__TAURI_INTERNALS__.invoke("save_command_history", {
          terminalId: id,
          command,
          cwd,
        });
        await window.__TAURI_INTERNALS__.invoke("send_keys", {
          terminalId: id,
          data: `${command}\r`,
        });
      },
      { id: terminalId, command: `echo ${marker}`, cwd: PROJECT_PATH },
    );
    report.checks.sentCommand = `echo ${marker}`;

    const markerHit = await waitForMarker(page, marker);
    report.checks.markerHit = markerHit;
    if (markerHit.hits.length === 0) {
      throw new Error(`Command marker ${marker} did not appear in terminal output`);
    }

    const { blocks, block } = await waitForCommandBlock(page, terminalId, marker);
    report.checks.commandBlocks = blocks;
    report.checks.matchedBlock = block ?? null;
    report.checks.promptMarks = await page.evaluate(
      async ({ id }) => window.__TAURI_INTERNALS__.invoke("term_prompt_marks", { id }).catch(() => []),
      { id: terminalId },
    );
    if (!block) throw new Error(`No native command block found for ${marker}`);
    if (block.terminalId !== terminalId) throw new Error(`Command block terminal mismatch: ${block.terminalId}`);
    if (block.status !== "passed") throw new Error(`Command block did not pass: ${JSON.stringify(block)}`);
    if (block.exitCode !== 0) throw new Error(`Command block exit code was not 0: ${JSON.stringify(block)}`);
    if (!block.endSequence || block.endHistorySize == null) {
      throw new Error(`Command block is missing prompt-mark or scrollback anchor: ${JSON.stringify(block)}`);
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
      console.log(`live command evidence smoke passed: ${artifact}`);
    } else if (isEnvironmentUnavailable()) {
      console.error(`live command evidence smoke environment-blocked; primary artifact preserved: ${artifact}`);
    } else {
      console.error(`live command evidence smoke failed: ${artifact}`);
    }
  }
}

await main();
