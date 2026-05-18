// Live Tauri/WebView2 smoke for right-rail native preference sync.
//
// Prerequisite:
//   set AETHER_API_TOKEN=dev && pnpm.cmd tauri:dev
//
// Optional env:
//   AETHER_TAURI_CDP=http://127.0.0.1:9222
//   AETHER_TAURI_PROJECT=C:/Users/owner/Aether_Terminal
//   AETHER_RIGHT_RAIL_PREFS_OUT=.codex-auto/production-smoke/right-rail-preferences.json

import { mkdirSync, writeFileSync } from "node:fs";
import net from "node:net";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { chromium } from "@playwright/test";

const CDP = process.env.AETHER_TAURI_CDP ?? "http://127.0.0.1:9222";
const PROJECT_PATH = (process.env.AETHER_TAURI_PROJECT ?? process.cwd()).replaceAll("\\", "/");
const OUT = process.env.AETHER_RIGHT_RAIL_PREFS_OUT ?? ".codex-auto/production-smoke/right-rail-preferences.json";
const WAIT_MS = Number.parseInt(process.env.AETHER_RIGHT_RAIL_PREFS_WAIT_MS ?? "90000", 10);

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
  url.searchParams.set("rail", "command");
  url.searchParams.set("v", "right-rail-preferences");
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
      window.localStorage.setItem("aether:visualQa", "1");
      window.localStorage.setItem("aether:visualQaProject", projectPath);
      window.localStorage.setItem("aether:lastProject", projectPath);
      window.localStorage.setItem("aether:onboarding-done", "true");
      window.localStorage.removeItem("aether:dashboardStateUrl");
    }, PROJECT_PATH)
    .catch(() => {});
}

async function loadConfig(page) {
  return await page.evaluate(async () => await window.__TAURI_INTERNALS__.invoke("load_app_config"));
}

async function saveConfig(page, config) {
  await page.evaluate(
    async (cfg) => await window.__TAURI_INTERNALS__.invoke("save_app_config", { config: cfg }),
    config,
  );
}

async function restoreUiStorage(page, snapshot) {
  await page.evaluate((state) => {
    if (state.guardrail == null) window.localStorage.removeItem("aether:right-rail-guardrail-selection");
    else window.localStorage.setItem("aether:right-rail-guardrail-selection", state.guardrail);
    if (state.workflow == null) window.localStorage.removeItem("aether:right-rail-widget:workflow");
    else window.localStorage.setItem("aether:right-rail-widget:workflow", state.workflow);
    window.dispatchEvent(
      new CustomEvent("aether:right-rail-guardrail-sync", { detail: { selection: state.guardrail ?? "Auto" } }),
    );
    window.dispatchEvent(
      new CustomEvent("aether:right-rail-widget-sync", {
        detail: { widget: "workflow", open: state.workflow === "1" },
      }),
    );
  }, snapshot);
}

async function main() {
  let browser = null;
  let page = null;
  let configBackup = null;
  let storageBackup = null;
  try {
    browser = await connectWithWait();
    const ctx = browser.contexts()[0];
    const pages = ctx?.pages() ?? [];
    report.pages = pages.map((candidate) => candidate.url());
    page = pages.find((candidate) => candidate.url().includes("localhost:1420") || candidate.url().includes("tauri"));
    if (!page) throw new Error("No Tauri WebView page found over CDP");
    const quality = attachQualityCollectors(page);

    await assertTauriInternals(page);
    await seedQaStorage(page);
    configBackup = await loadConfig(page);
    storageBackup = await page.evaluate(() => ({
      guardrail: window.localStorage.getItem("aether:right-rail-guardrail-selection"),
      workflow: window.localStorage.getItem("aether:right-rail-widget:workflow"),
    }));

    await page.goto(targetQaUrl(page.url()), { waitUntil: "domcontentloaded", timeout: WAIT_MS });
    await page.waitForSelector(".right-panel-workforce-profile", { timeout: WAIT_MS });
    await page.waitForSelector('[data-widget="workflow"] .right-panel-widget-frame-header', { timeout: WAIT_MS });
    quality.consoleErrors.length = 0;
    quality.pageErrors.length = 0;

    await page.locator(".right-panel-workforce-profile").selectOption("Builder", { timeout: WAIT_MS });
    await page.waitForFunction(
      async () => {
        const select = document.querySelector(".right-panel-workforce-profile");
        const config = await window.__TAURI_INTERNALS__.invoke("load_app_config");
        return (
          select?.value === "Builder" &&
          window.localStorage.getItem("aether:right-rail-guardrail-selection") === "Builder" &&
          config.workspace_profile?.global_defaults?.pane_layout?.right_rail_guardrail_profile === "Builder"
        );
      },
      null,
      { timeout: WAIT_MS },
    );
    report.checks.guardrailNativeSync = true;

    const workflowOpenBefore = await page
      .locator('[data-widget="workflow"]')
      .getAttribute("data-open", { timeout: WAIT_MS });
    await page.locator('[data-widget="workflow"] .right-panel-widget-frame-header').click({ timeout: WAIT_MS });
    await page.waitForFunction(
      async (previous) => {
        const open = document.querySelector('[data-widget="workflow"]')?.getAttribute("data-open");
        const config = await window.__TAURI_INTERNALS__.invoke("load_app_config");
        const expected = previous !== "true";
        return (
          open === String(expected) &&
          window.localStorage.getItem("aether:right-rail-widget:workflow") === (expected ? "1" : "0") &&
          config.workspace_profile?.global_defaults?.pane_layout?.right_rail_widgets?.workflow === expected
        );
      },
      workflowOpenBefore,
      { timeout: WAIT_MS },
    );
    report.checks.widgetNativeSync = true;

    await page.reload({ waitUntil: "domcontentloaded", timeout: WAIT_MS });
    await page.waitForSelector(".right-panel-workforce-profile", { timeout: WAIT_MS });
    await page.waitForFunction(
      () => document.querySelector(".right-panel-workforce-profile")?.value === "Builder",
      null,
      { timeout: WAIT_MS },
    );
    report.checks.reloadRestoresGuardrail = true;

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
    if (page && configBackup) await saveConfig(page, configBackup).catch(() => {});
    if (page && storageBackup) await restoreUiStorage(page, storageBackup).catch(() => {});
    if (browser) await browser.close().catch(() => {});
    const artifact = writeArtifact();
    if (report.ok) {
      console.log(`right rail preferences smoke passed: ${artifact}`);
    } else {
      console.error(`right rail preferences smoke failed: ${artifact}`);
    }
  }
}

await main();
