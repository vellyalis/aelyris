// Live Tauri/WebView2 smoke for right-rail human decision prominence.
//
// Prerequisite:
//   set QUORUM_API_TOKEN=dev && pnpm.cmd tauri:dev
//
// Optional env:
//   AETHER_TAURI_CDP=http://127.0.0.1:9222
//   AETHER_TAURI_PROJECT=C:/repo/aether-terminal
//   AETHER_RIGHT_RAIL_DECISIONS_OUT=.codex-auto/production-smoke/right-rail-decisions.json

import { mkdirSync, writeFileSync } from "node:fs";
import net from "node:net";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { chromium } from "@playwright/test";

const CDP = process.env.AETHER_TAURI_CDP ?? "http://127.0.0.1:9222";
const PROJECT_PATH = (process.env.AETHER_TAURI_PROJECT ?? process.cwd()).replaceAll("\\", "/");
const OUT = process.env.AETHER_RIGHT_RAIL_DECISIONS_OUT ?? ".codex-auto/production-smoke/right-rail-decisions.json";
const WAIT_MS = Number.parseInt(process.env.AETHER_RIGHT_RAIL_DECISIONS_WAIT_MS ?? "90000", 10);

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
  url.searchParams.set("aetherVisualQa", "1");
  url.searchParams.set("projectPath", PROJECT_PATH);
  url.searchParams.set("rail", "observe");
  url.searchParams.set("state", "blocked");
  url.searchParams.set("v", "right-rail-decisions");
  url.searchParams.delete("aetherDashboardStateUrl");
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

async function seedQaStorage(page) {
  await page
    .evaluate((projectPath) => {
      window.localStorage.setItem("aether:visualQa", "1");
      window.localStorage.setItem("aether:visualQaProject", projectPath);
      window.localStorage.setItem("aether:lastProject", projectPath);
      window.localStorage.setItem("aether:onboarding-done", "true");
      window.localStorage.removeItem("aether:dashboardStateUrl");
    }, PROJECT_PATH)
    .catch(() => {});
}

async function main() {
  let browser = null;
  try {
    browser = await connectWithWait();
    const ctx = browser.contexts()[0];
    const pages = ctx?.pages() ?? [];
    report.pages = pages.map((candidate) => candidate.url());
    const page = pages.find(
      (candidate) => candidate.url().includes("localhost:1420") || candidate.url().includes("tauri"),
    );
    if (!page) throw new Error("No Tauri WebView page found over CDP");
    const quality = attachQualityCollectors(page);

    await seedQaStorage(page);
    await page.goto(targetQaUrl(page.url()), { waitUntil: "domcontentloaded", timeout: WAIT_MS });
    await page.waitForSelector(".right-panel-decision-focus", { timeout: WAIT_MS });
    quality.consoleErrors.length = 0;
    quality.pageErrors.length = 0;

    await page.waitForFunction(
      () => {
        const decision = document.querySelector(".right-panel-decision-focus");
        return (
          decision?.getAttribute("data-tone") === "warn" &&
          decision.getAttribute("data-has-decision") === "true" &&
          decision.textContent?.includes("Needs your decision") &&
          decision.textContent?.includes("1 human gate")
        );
      },
      null,
      { timeout: WAIT_MS },
    );
    report.checks.warnDecisionFocus = true;

    const order = await page.evaluate(() => {
      const decision = document.querySelector(".right-panel-decision-focus");
      const essentials = document.querySelector(".right-panel-essential-grid");
      const workforce = document.querySelector(".right-panel-workforce");
      const actions = document.querySelector(".right-panel-action-stack");
      const isBefore = (a, b) =>
        Boolean(a && b && (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING));
      return {
        decisionBeforeEssentials: isBefore(decision, essentials),
        decisionBeforeWorkforce: isBefore(decision, workforce),
        decisionBeforeActions: isBefore(decision, actions),
      };
    });
    if (!order.decisionBeforeEssentials || !order.decisionBeforeWorkforce || !order.decisionBeforeActions) {
      throw new Error(`Decision focus order regression: ${JSON.stringify(order)}`);
    }
    report.checks.decisionBeforeTelemetry = order;

    await page.locator(".right-panel-decision-focus").click({ timeout: WAIT_MS });
    await page.waitForFunction(
      () =>
        document.querySelector('.right-panel-mode-tab[data-right-rail-mode="command"]')?.getAttribute("data-active") ===
          "true" && Boolean(document.querySelector('[data-widget="decision-inbox"]')),
      null,
      { timeout: WAIT_MS },
    );
    report.checks.clickOpensDecisionInbox = true;

    const decisionWidgetVisible = await page.locator('[data-widget="decision-inbox"]').isVisible({ timeout: WAIT_MS });
    if (!decisionWidgetVisible) throw new Error("Decision Inbox widget is not visible after clicking Decision focus");
    report.checks.decisionInboxVisible = true;

    await page.waitForFunction(
      () => {
        const inbox = document.querySelector('[data-widget="decision-inbox"]');
        const text = inbox?.textContent ?? "";
        return (
          text.includes("Critical") &&
          text.includes("Action") &&
          text.includes("Evidence") &&
          text.includes("Focus session") &&
          text.includes("Destructive Operation")
        );
      },
      null,
      { timeout: WAIT_MS },
    );
    report.checks.decisionItemActionQuality = true;

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
      console.log(`right rail decisions smoke passed: ${artifact}`);
    } else {
      console.error(`right rail decisions smoke failed: ${artifact}`);
    }
  }
}

await main();
