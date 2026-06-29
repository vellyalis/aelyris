// Live Tauri/WebView2 smoke for the right-rail Last action -> Audit Timeline path.
//
// Prerequisite:
//   set AELYRIS_API_TOKEN=dev && pnpm.cmd tauri:dev
//
// Optional env:
//   AELYRIS_TAURI_CDP=http://127.0.0.1:9222
//   AELYRIS_TAURI_PROJECT=C:/repo/aelyris
//   AELYRIS_RIGHT_RAIL_AUDIT_OUT=.codex-auto/production-smoke/right-rail-audit-jump.json

import { mkdirSync, writeFileSync } from "node:fs";
import net from "node:net";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { chromium } from "@playwright/test";

const CDP = process.env.AELYRIS_TAURI_CDP ?? "http://127.0.0.1:9222";
const PROJECT_PATH = (process.env.AELYRIS_TAURI_PROJECT ?? process.cwd()).replaceAll("\\", "/");
const OUT = process.env.AELYRIS_RIGHT_RAIL_AUDIT_OUT ?? ".codex-auto/production-smoke/right-rail-audit-jump.json";
const WAIT_MS = Number.parseInt(process.env.AELYRIS_RIGHT_RAIL_AUDIT_WAIT_MS ?? "90000", 10);

const report = {
  ok: false,
  startedAt: new Date().toISOString(),
  cdp: CDP,
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
      report.checks.cdpWaitMs = Date.now() - startedAt;
      return browser;
    } catch (error) {
      lastError = error;
      await new Promise((resolveWait) => setTimeout(resolveWait, 1000));
    }
  } while (Date.now() - startedAt < WAIT_MS);
  throw new Error(`Cannot attach to WebView2 CDP at ${CDP}. Last error: ${lastError?.message ?? "unknown"}`);
}

function targetQaUrl(rawUrl) {
  const url = new URL(rawUrl);
  url.searchParams.set("aelyrisVisualQa", "1");
  url.searchParams.set("projectPath", PROJECT_PATH);
  url.searchParams.set("rail", "command");
  return url.toString();
}

function attachQualityCollectors(page) {
  const events = {
    consoleErrors: [],
    pageErrors: [],
  };
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    events.consoleErrors.push(message.text().slice(0, 1000));
  });
  page.on("pageerror", (error) => {
    events.pageErrors.push(error.message);
  });
  return events;
}

async function assertTauriInternals(page) {
  const hasInternals = await page.evaluate(() => {
    const w = window;
    return typeof w.__TAURI_INTERNALS__?.invoke === "function";
  });
  if (!hasInternals) throw new Error("__TAURI_INTERNALS__.invoke unavailable");
  report.checks.tauriInternals = true;
}

async function seedQaStorage(page) {
  await page
    .evaluate((projectPath) => {
      localStorage.setItem("aelyris:visualQa", "1");
      localStorage.setItem("aelyris:visualQaProject", projectPath);
      localStorage.setItem("aelyris:lastProject", projectPath);
      localStorage.setItem("aelyris:onboarding-done", "true");
      localStorage.removeItem("aelyris:dashboardStateUrl");
    }, PROJECT_PATH)
    .catch(() => {});
}

async function main() {
  let browser = null;
  try {
    browser = await connectWithWait();
    const ctx = browser.contexts()[0];
    const pages = ctx?.pages() ?? [];
    report.pages = pages.map((page) => page.url());
    const page = pages.find(
      (candidate) => candidate.url().includes("localhost:1420") || candidate.url().includes("tauri"),
    );
    if (!page) throw new Error("No Tauri WebView page found over CDP");
    const quality = attachQualityCollectors(page);

    await assertTauriInternals(page);
    await seedQaStorage(page);
    await page.goto(targetQaUrl(page.url()), { waitUntil: "domcontentloaded", timeout: WAIT_MS });
    await page.waitForSelector(".app-container", { timeout: WAIT_MS });
    await page.waitForSelector("#right-rail-panel", { timeout: WAIT_MS });
    report.checks.commandRailReady = true;
    quality.consoleErrors.length = 0;
    quality.pageErrors.length = 0;

    const actions = page.locator(".right-panel-action:not([disabled])");
    const actionCount = await actions.count();
    report.checks.actionCount = actionCount;
    if (actionCount < 1) throw new Error("No enabled right rail action found");
    const action = actions.nth(0);
    report.actionText = await action.innerText({ timeout: WAIT_MS });
    await action.click({ timeout: WAIT_MS });
    await page.waitForSelector(".right-panel-action-result", { timeout: WAIT_MS });
    await page.waitForSelector(".right-panel-action-result-audit", { timeout: WAIT_MS });
    report.checks.auditButtonVisible = true;
    report.resultText = await page.locator(".right-panel-action-result").innerText({ timeout: WAIT_MS });

    await page.locator(".right-panel-action-result-audit").click({ timeout: WAIT_MS });
    await page.waitForFunction(
      () => document.querySelector("#right-rail-panel")?.getAttribute("data-mode") === "observe",
      null,
      { timeout: WAIT_MS },
    );
    await page.waitForSelector(
      '[data-widget="audit-timeline"][data-rail-focus="true"], [data-widget="audit-timeline"]',
      {
        timeout: WAIT_MS,
      },
    );
    await page.waitForSelector('[aria-label="Audit timeline"] article[data-selected="true"]', { timeout: WAIT_MS });
    report.checks.auditTimelineFocused = true;
    report.selectedAuditText = await page
      .locator('[aria-label="Audit timeline"] article[data-selected="true"]')
      .innerText({ timeout: WAIT_MS });

    if (quality.consoleErrors.length > 0 || quality.pageErrors.length > 0) {
      throw new Error(
        `Runtime errors detected: ${[...quality.consoleErrors, ...quality.pageErrors].slice(0, 3).join(" | ")}`,
      );
    }
    report.ok = true;
    report.checks.noRuntimeErrors = true;
  } catch (error) {
    report.errors.push(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  } finally {
    if (browser) {
      if (typeof browser.disconnect === "function") browser.disconnect();
      else await browser.close().catch(() => {});
    }
    const artifact = writeArtifact();
    if (report.ok) {
      console.log(`right rail audit jump smoke passed: ${artifact}`);
    } else {
      console.error(`right rail audit jump smoke failed: ${artifact}`);
    }
  }
}

await main();
