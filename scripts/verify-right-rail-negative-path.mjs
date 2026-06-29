// Live Tauri/WebView2 smoke for right-rail recoverable negative paths.
//
// Prerequisite:
//   set AELYRIS_API_TOKEN=dev && pnpm.cmd tauri:dev
//
// Optional env:
//   AELYRIS_TAURI_CDP=http://127.0.0.1:9222
//   AELYRIS_TAURI_PROJECT=C:/repo/aelyris
//   AELYRIS_RIGHT_RAIL_NEGATIVE_OUT=.codex-auto/production-smoke/right-rail-negative-path.json

import { mkdirSync, writeFileSync } from "node:fs";
import net from "node:net";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { chromium } from "@playwright/test";

const CDP = process.env.AELYRIS_TAURI_CDP ?? "http://127.0.0.1:9222";
const PROJECT_PATH = (process.env.AELYRIS_TAURI_PROJECT ?? process.cwd()).replaceAll("\\", "/");
const OUT = process.env.AELYRIS_RIGHT_RAIL_NEGATIVE_OUT ?? ".codex-auto/production-smoke/right-rail-negative-path.json";
const WAIT_MS = Number.parseInt(process.env.AELYRIS_RIGHT_RAIL_NEGATIVE_WAIT_MS ?? "90000", 10);

const CASES = [
  {
    id: "missing-diff",
    label: "QA missing diff",
    state: "idle",
    expectedResult: "No changed file is available for diff.",
    expectedKind: "right_rail.qa_missing_diff.opened.blocked",
  },
  {
    id: "stale-pane",
    label: "QA stale pane",
    state: "running",
    expectedResult: "Pane target changed before it could be focused.",
    expectedKind: "right_rail.qa_stale_pane.opened.blocked",
  },
];

const report = {
  ok: false,
  startedAt: new Date().toISOString(),
  cdp: CDP,
  projectPath: PROJECT_PATH,
  cases: [],
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

function targetQaUrl(rawUrl, testCase) {
  const url = new URL(rawUrl);
  url.searchParams.set("aelyrisVisualQa", "1");
  url.searchParams.set("projectPath", PROJECT_PATH);
  url.searchParams.set("rail", "command");
  url.searchParams.set("state", testCase.state);
  url.searchParams.set("negativePath", testCase.id);
  url.searchParams.set("v", `right-rail-negative-${testCase.id}`);
  url.searchParams.delete("aelyrisDashboardStateUrl");
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
      window.localStorage.setItem("aelyris:visualQa", "1");
      window.localStorage.setItem("aelyris:visualQaProject", projectPath);
      window.localStorage.setItem("aelyris:lastProject", projectPath);
      window.localStorage.setItem("aelyris:onboarding-done", "true");
      window.localStorage.removeItem("aelyris:dashboardStateUrl");
    }, PROJECT_PATH)
    .catch(() => {});
}

async function listOutcomeEvents(page, testCase) {
  const rows = await page.evaluate(
    async ({ workspaceId, kind }) => {
      const w = window;
      return await w.__TAURI_INTERNALS__.invoke("list_audit_events", {
        filter: {
          workspaceId,
          kind,
          source: "right-rail",
          severity: "warn",
          limit: 200,
        },
      });
    },
    { workspaceId: PROJECT_PATH, kind: testCase.expectedKind },
  );
  return [...rows].sort((left, right) => Number(left.sequence ?? 0) - Number(right.sequence ?? 0));
}

async function runNegativeCase(page, testCase) {
  const caseReport = {
    id: testCase.id,
    label: testCase.label,
    expectedKind: testCase.expectedKind,
    checks: {},
  };
  report.cases.push(caseReport);

  await page.goto(targetQaUrl(page.url(), testCase), { waitUntil: "domcontentloaded", timeout: WAIT_MS });
  await page.waitForSelector(".app-container", { timeout: WAIT_MS });
  await page.waitForSelector("#right-rail-panel", { state: "attached", timeout: WAIT_MS });
  await page.waitForSelector(".right-panel-action", { timeout: WAIT_MS });

  const beforeEvents = await listOutcomeEvents(page, testCase);
  const beforeMaxSequence = beforeEvents.reduce((max, entry) => Math.max(max, Number(entry.sequence ?? 0)), 0);
  caseReport.checks.beforeOutcomeRows = beforeEvents.length;

  const action = page.locator(".right-panel-action", { hasText: testCase.label });
  const actionCount = await action.count();
  caseReport.checks.actionCount = actionCount;
  if (actionCount !== 1) throw new Error(`${testCase.id}: expected one action, found ${actionCount}`);
  await action.click({ timeout: WAIT_MS });

  await page.waitForSelector('.right-panel-action-result[data-tone="warn"]', { timeout: WAIT_MS });
  await page.waitForSelector(".right-panel-action-history-item", { timeout: WAIT_MS });
  await page.waitForSelector(".right-panel-action-result-audit", { timeout: WAIT_MS });

  caseReport.resultText = await page.locator(".right-panel-action-result").innerText({ timeout: WAIT_MS });
  caseReport.historyText = await page
    .locator(".right-panel-action-history-item")
    .first()
    .innerText({ timeout: WAIT_MS });
  if (!caseReport.resultText.includes(testCase.expectedResult)) {
    throw new Error(`${testCase.id}: result did not include "${testCase.expectedResult}"`);
  }
  if (!caseReport.historyText.includes(testCase.expectedResult)) {
    throw new Error(`${testCase.id}: history did not include "${testCase.expectedResult}"`);
  }
  caseReport.checks.recoverableResultVisible = true;
  caseReport.checks.durableHistoryVisible = true;

  await page.waitForFunction(
    async ({ workspaceId, kind, before }) => {
      const w = window;
      const rows = await w.__TAURI_INTERNALS__.invoke("list_audit_events", {
        filter: {
          workspaceId,
          kind,
          source: "right-rail",
          severity: "warn",
          limit: 200,
        },
      });
      return rows.some((entry) => Number(entry.sequence ?? 0) > before);
    },
    { workspaceId: PROJECT_PATH, kind: testCase.expectedKind, before: beforeMaxSequence },
    { timeout: WAIT_MS },
  );
  const afterEvents = await listOutcomeEvents(page, testCase);
  const newOutcome = afterEvents.find((entry) => Number(entry.sequence ?? 0) > beforeMaxSequence);
  if (!newOutcome) throw new Error(`${testCase.id}: no fresh native outcome audit row found`);
  caseReport.outcomeAudit = {
    id: newOutcome.id,
    sequence: newOutcome.sequence,
    kind: newOutcome.kind,
    severity: newOutcome.severity,
    source: newOutcome.source,
  };
  caseReport.checks.nativeOutcomeAuditRow = true;

  await page.locator(".right-panel-action-result-audit").click({ timeout: WAIT_MS });
  await page.waitForFunction(
    () => document.querySelector("#right-rail-panel")?.getAttribute("data-mode") === "observe",
    null,
    { timeout: WAIT_MS },
  );
  await page.waitForSelector('[aria-label="Audit timeline"] article[data-selected="true"]', { timeout: WAIT_MS });
  caseReport.selectedAuditText = await page
    .locator('[aria-label="Audit timeline"] article[data-selected="true"]')
    .innerText({ timeout: WAIT_MS });
  if (!caseReport.selectedAuditText.includes(testCase.expectedKind)) {
    throw new Error(`${testCase.id}: selected audit row did not include ${testCase.expectedKind}`);
  }
  caseReport.checks.auditTimelineFocused = true;
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
    quality.consoleErrors.length = 0;
    quality.pageErrors.length = 0;

    for (const testCase of CASES) {
      await runNegativeCase(page, testCase);
    }

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
      console.log(`right rail negative-path smoke passed: ${artifact}`);
    } else {
      console.error(`right rail negative-path smoke failed: ${artifact}`);
    }
  }
}

await main();
