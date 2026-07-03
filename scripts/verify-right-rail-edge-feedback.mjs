// Browser smoke for right-rail Edge score feedback, stale filtering, reset, and rail scrolling.
//
// Prerequisite:
//   pnpm.cmd dev -- --host 127.0.0.1 --port 1420
//
// Optional env:
//   AELYRIS_RIGHT_RAIL_EDGE_URL=http://localhost:1420/
//   AELYRIS_TAURI_PROJECT=C:/repo/aelyris
//   AELYRIS_RIGHT_RAIL_EDGE_OUT=.codex-auto/production-smoke/right-rail-edge-feedback.json

import { createReadStream, existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import http from "node:http";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { chromium } from "@playwright/test";

const STATIC_DIST = process.env.AELYRIS_RIGHT_RAIL_EDGE_STATIC_DIST === "1";
const STATIC_PORT = Number.parseInt(process.env.AELYRIS_RIGHT_RAIL_EDGE_STATIC_PORT ?? "1420", 10);
let APP_URL =
  process.env.AELYRIS_RIGHT_RAIL_EDGE_URL ??
  (STATIC_DIST ? `http://127.0.0.1:${STATIC_PORT}/` : "http://localhost:1420/");
const PROJECT_PATH = (process.env.AELYRIS_TAURI_PROJECT ?? process.cwd()).replaceAll("\\", "/");
const OUT = process.env.AELYRIS_RIGHT_RAIL_EDGE_OUT ?? ".codex-auto/production-smoke/right-rail-edge-feedback.json";
const ENV_BLOCKED_OUT =
  process.env.AELYRIS_RIGHT_RAIL_EDGE_ENV_BLOCKED_OUT ??
  ".codex-auto/production-smoke/right-rail-edge-feedback.environment-blocked.json";
const SCREENSHOT = process.env.AELYRIS_RIGHT_RAIL_EDGE_SCREENSHOT ?? ".codex-auto/visual/right-rail-next-action-qa.png";
const WAIT_MS = Number.parseInt(process.env.AELYRIS_RIGHT_RAIL_EDGE_WAIT_MS ?? "30000", 10);
const EDGE_STORAGE_PREFIX = "aelyris:right-rail-edge-feedback:";

let artifactPathOverride = null;

const report = {
  ok: false,
  startedAt: new Date().toISOString(),
  appUrl: APP_URL,
  projectPath: PROJECT_PATH,
  checks: {},
  errors: [],
};

function outputArtifactMeta(path) {
  const fullPath = resolve(path);
  return {
    path,
    exists: existsSync(fullPath),
    mtimeMs: existsSync(fullPath) ? statSync(fullPath).mtimeMs : 0,
  };
}

function isEnvironmentBlockedError(message) {
  return /browserType\.launch: spawn EPERM|chrome-headless-shell\.exe|spawn EPERM|Cannot open .*Start the dev server first|ECONNREFUSED|ETIMEDOUT|504 \(Outdated Optimize Dep\)|Outdated Optimize Dep/i.test(
    message,
  );
}

function writeArtifact() {
  const outPath = resolve(artifactPathOverride ?? OUT);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify({ ...report, finishedAt: new Date().toISOString() }, null, 2)}\n`);
  return outPath;
}

function workspaceStorageHash(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function edgeFeedbackStorageKey(projectPath) {
  const normalized = projectPath.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  return `${EDGE_STORAGE_PREFIX}${workspaceStorageHash(normalized)}`;
}

function contentTypeFor(filePath) {
  const extension = filePath.slice(filePath.lastIndexOf("."));
  return (
    {
      ".css": "text/css; charset=utf-8",
      ".html": "text/html; charset=utf-8",
      ".ico": "image/x-icon",
      ".js": "text/javascript; charset=utf-8",
      ".json": "application/json; charset=utf-8",
      ".png": "image/png",
      ".svg": "image/svg+xml",
      ".woff2": "font/woff2",
    }[extension] ?? "application/octet-stream"
  );
}

async function startStaticDistServer() {
  if (!STATIC_DIST) return null;
  const distRoot = resolve("dist");
  const indexPath = join(distRoot, "index.html");
  if (!existsSync(indexPath)) {
    throw new Error(`Static dist smoke requested but ${indexPath} is missing. Run pnpm build first.`);
  }
  const server = http.createServer((request, response) => {
    try {
      const url = new URL(request.url ?? "/", APP_URL);
      const requested = decodeURIComponent(url.pathname);
      let filePath = resolve(distRoot, requested.replace(/^\/+/, ""));
      if (!filePath.startsWith(distRoot)) {
        response.writeHead(403);
        response.end("forbidden");
        return;
      }
      if (!existsSync(filePath) || statSync(filePath).isDirectory()) filePath = indexPath;
      response.writeHead(200, { "content-type": contentTypeFor(filePath) });
      createReadStream(filePath).pipe(response);
    } catch (error) {
      response.writeHead(500);
      response.end(error instanceof Error ? error.message : String(error));
    }
  });
  await new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(STATIC_PORT, "127.0.0.1", resolveListen);
  });
  APP_URL = `http://127.0.0.1:${STATIC_PORT}/`;
  return server;
}

function edgeLoopPayload() {
  const key = edgeFeedbackStorageKey(PROJECT_PATH);
  const base = Date.now() - 10_000;
  const history = [
    {
      id: `legacy_axis:${base + 1}`,
      axisId: "legacy_axis",
      axisLabel: "Legacy Clarity",
      actionLabel: "Open risks",
      targetWidget: "reliability",
      score: 55,
      grade: "C",
      previousScore: null,
      delta: 0,
      trend: "baseline",
      createdAt: base + 1,
    },
    {
      id: `legacy_axis:${base + 2}`,
      axisId: "legacy_axis",
      axisLabel: "Legacy Clarity",
      actionLabel: "Open audit",
      targetWidget: "audit-timeline",
      score: 58,
      grade: "C",
      previousScore: 55,
      delta: 3,
      trend: "improved",
      createdAt: base + 2,
    },
    {
      id: `removed_axis:${base + 3}`,
      axisId: "removed_axis",
      axisLabel: "Removed Guardrail",
      actionLabel: "Open review",
      targetWidget: "review-queue",
      score: 42,
      grade: "D",
      previousScore: 50,
      delta: -8,
      trend: "regressed",
      createdAt: base + 3,
    },
    {
      id: `evidence:${base + 4}`,
      axisId: "evidence",
      axisLabel: "Evidence",
      actionLabel: "Open audit",
      targetWidget: "audit-timeline",
      score: 78,
      grade: "B",
      previousScore: 76,
      delta: 2,
      trend: "improved",
      createdAt: base + 4,
    },
  ];
  return { key, history };
}

function targetQaUrl() {
  const url = new URL(APP_URL);
  url.searchParams.set("aelyrisVisualQa", "1");
  url.searchParams.set("projectPath", PROJECT_PATH);
  url.searchParams.set("rail", "command");
  url.searchParams.set("state", "blocked");
  url.searchParams.set("v", "right-rail-edge-feedback");
  url.searchParams.set("edgeLoop", JSON.stringify(edgeLoopPayload()));
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

async function seedQaStorage(page) {
  await page.evaluate((projectPath) => {
    window.localStorage.setItem("aelyris:visualQa", "1");
    window.localStorage.setItem("aelyris:visualQaProject", projectPath);
    window.localStorage.setItem("aelyris:lastProject", projectPath);
    window.localStorage.setItem("aelyris:onboarding-done", "true");
    window.localStorage.removeItem("aelyris:dashboardStateUrl");
  }, PROJECT_PATH);
}

async function openDeferredHealthDrawer(page) {
  const drawer = page.locator(".right-panel-health-drawer").first();
  await drawer.waitFor({ state: "attached", timeout: WAIT_MS });
  const openedBefore = await drawer.evaluate((element) => element.hasAttribute("open"));
  if (!openedBefore) {
    await page.locator(".right-panel-health-drawer > summary").click({ timeout: WAIT_MS });
  }
  await page.waitForFunction(
    () => document.querySelector(".right-panel-health-drawer")?.hasAttribute("open") === true,
    null,
    { timeout: WAIT_MS },
  );
  const state = await drawer.evaluate((element) => ({
    open: element.hasAttribute("open"),
    containsEdgeFeedback: Boolean(element.querySelector(".right-panel-edge-feedback")),
  }));
  return { openedBefore, ...state };
}

async function readRailMetrics(page) {
  return await page.evaluate(() => {
    const content = document.querySelector(".right-panel-content");
    const stack = document.querySelector(".right-panel-stack");
    if (!content || !stack) return { found: false };
    content.scrollTop = 0;
    const before = content.scrollTop;
    content.scrollTop = Math.min(220, Math.max(0, content.scrollHeight - content.clientHeight));
    const after = content.scrollTop;
    return {
      found: true,
      contentOverflowY: getComputedStyle(content).overflowY,
      stackOverflowY: getComputedStyle(stack).overflowY,
      stackFlex: getComputedStyle(stack).flex,
      clientHeight: content.clientHeight,
      scrollHeight: content.scrollHeight,
      before,
      after,
      moved: after > before,
    };
  });
}

async function readWorkflowState(page, mode) {
  await page.locator(`.right-panel-mode-tab[data-right-rail-mode="${mode}"]`).click({ timeout: WAIT_MS });
  await page.waitForFunction(
    (expectedMode) => document.querySelector(".right-panel-stack")?.getAttribute("data-mode") === expectedMode,
    mode,
    { timeout: WAIT_MS },
  );
  return await page.evaluate(() => {
    const stack = document.querySelector(".right-panel-stack");
    const runLoop = document.querySelector(".right-panel-run-loop");
    const actionButtons = Array.from(document.querySelectorAll(".right-panel-action"));
    const widgets = Array.from(document.querySelectorAll(".right-panel-stack [data-widget]"));
    const widgetIds = widgets
      .map((widget) => widget.getAttribute("data-widget"))
      .filter((widget) => typeof widget === "string" && widget.length > 0);
    const duplicateWidgets = widgetIds.filter((widget, index) => widgetIds.indexOf(widget) !== index);
    const toolkit = document.querySelector('.right-panel-stack [data-widget="toolkit"]');
    const toolkitCompactText = (toolkit?.textContent ?? "").replace(/\s+/g, "");
    return {
      mode: stack?.getAttribute("data-mode") ?? null,
      runLoopActionId: runLoop?.getAttribute("data-action-id") ?? null,
      runLoopActionMode: runLoop?.getAttribute("data-action-mode") ?? null,
      runLoopTarget: runLoop?.getAttribute("data-target") ?? null,
      actionModes: actionButtons.map((button) => button.getAttribute("data-mode")),
      firstActionMode: actionButtons[0]?.getAttribute("data-mode") ?? null,
      widgetIds,
      duplicateWidgets: Array.from(new Set(duplicateWidgets)),
      toolkitCompactText,
      toolkitHasRepeatedTitle: toolkitCompactText.includes("ToolkitsavedcommandsToolkitsavedcommands"),
    };
  });
}

async function readFeedbackState(page) {
  return await page.evaluate(() => {
    const section = document.querySelector(".right-panel-edge-feedback");
    const items = Array.from(document.querySelectorAll(".right-panel-edge-feedback-item"));
    const groups = Array.from(document.querySelectorAll(".right-panel-edge-feedback-stale-group"));
    const filter = document.querySelector(".right-panel-edge-feedback-filter");
    const clear = document.querySelector(".right-panel-edge-feedback-clear");
    return {
      hasSection: Boolean(section),
      text: section?.textContent ?? "",
      staleCountText: document.querySelector(".right-panel-edge-feedback-stale-count")?.textContent?.trim() ?? "",
      itemCount: items.length,
      staleItemCount: items.filter((item) => item.getAttribute("data-stale") === "true").length,
      disabledItemCount: items.filter((item) => item.disabled).length,
      enabledItemCount: items.filter((item) => !item.disabled).length,
      groupCount: groups.length,
      groupText: groups.map((group) => group.textContent ?? ""),
      filterActive: filter?.getAttribute("data-active") ?? null,
      filterAriaControls: filter?.getAttribute("aria-controls") ?? null,
      filterAriaDescribedBy: filter?.getAttribute("aria-describedby") ?? null,
      clearAriaControls: clear?.getAttribute("aria-controls") ?? null,
    };
  });
}

async function main() {
  let browser = null;
  let staticServer = null;
  try {
    staticServer = await startStaticDistServer();
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    const quality = attachQualityCollectors(page);

    await page.goto(APP_URL, { waitUntil: "domcontentloaded", timeout: WAIT_MS }).catch((error) => {
      throw new Error(`Cannot open ${APP_URL}. Start the dev server first. ${error.message}`);
    });
    await seedQaStorage(page);
    await page.goto(targetQaUrl(), { waitUntil: "domcontentloaded", timeout: WAIT_MS });
    report.checks.deferredHealthDrawer = await openDeferredHealthDrawer(page);
    if (!report.checks.deferredHealthDrawer.containsEdgeFeedback) {
      throw new Error(`Score loop is not contained in the deferred Health drawer`);
    }
    await page.waitForSelector(".right-panel-edge-feedback", { state: "visible", timeout: WAIT_MS });
    await page.waitForFunction(
      () => document.querySelector(".right-panel-edge-feedback-stale-count")?.textContent?.includes("Stale 3"),
      null,
      { timeout: WAIT_MS },
    );
    report.checks.initialScoreLoopLoaded = true;

    const railMetrics = await readRailMetrics(page);
    report.checks.railMetrics = railMetrics;
    if (
      !railMetrics.found ||
      railMetrics.contentOverflowY !== "auto" ||
      railMetrics.stackOverflowY !== "visible" ||
      !railMetrics.moved
    ) {
      throw new Error(`Right rail scroll regression: ${JSON.stringify(railMetrics)}`);
    }

    const beforeFilter = await readFeedbackState(page);
    report.checks.beforeFilter = beforeFilter;
    if (
      beforeFilter.staleCountText !== "Stale 3" ||
      beforeFilter.itemCount !== 4 ||
      beforeFilter.staleItemCount !== 3 ||
      beforeFilter.enabledItemCount !== 1 ||
      beforeFilter.groupCount !== 0
    ) {
      throw new Error(`Unexpected Score loop state before filter: ${JSON.stringify(beforeFilter)}`);
    }

    const commandWorkflow = await readWorkflowState(page, "command");
    const reviewWorkflow = await readWorkflowState(page, "review");
    const observeWorkflow = await readWorkflowState(page, "observe");
    report.checks.workflowLinkage = {
      command: commandWorkflow,
      review: reviewWorkflow,
      observe: observeWorkflow,
    };
    if (
      commandWorkflow.mode !== "command" ||
      commandWorkflow.runLoopActionMode !== "command" ||
      commandWorkflow.firstActionMode !== "command" ||
      commandWorkflow.duplicateWidgets.length > 0 ||
      commandWorkflow.toolkitHasRepeatedTitle
    ) {
      throw new Error(`Command rail workflow is ambiguous: ${JSON.stringify(commandWorkflow)}`);
    }
    if (
      reviewWorkflow.mode !== "review" ||
      reviewWorkflow.runLoopActionMode !== "review" ||
      reviewWorkflow.firstActionMode !== "review" ||
      reviewWorkflow.duplicateWidgets.length > 0
    ) {
      throw new Error(`Review rail workflow is not review-scoped: ${JSON.stringify(reviewWorkflow)}`);
    }
    if (
      observeWorkflow.mode !== "observe" ||
      observeWorkflow.runLoopActionMode !== "observe" ||
      observeWorkflow.firstActionMode !== "observe" ||
      observeWorkflow.duplicateWidgets.length > 0
    ) {
      throw new Error(`Health rail workflow is not observe-scoped: ${JSON.stringify(observeWorkflow)}`);
    }
    await page.locator('.right-panel-mode-tab[data-right-rail-mode="command"]').click({ timeout: WAIT_MS });
    await page.waitForFunction(
      () => document.querySelector(".right-panel-stack")?.getAttribute("data-mode") === "command",
      null,
      { timeout: WAIT_MS },
    );

    const screenshotPath = resolve(SCREENSHOT);
    mkdirSync(dirname(screenshotPath), { recursive: true });
    await page.screenshot({ path: screenshotPath, fullPage: false });
    report.checks.screenshot = screenshotPath;

    await page.locator(".right-panel-edge-feedback-filter").click({ timeout: WAIT_MS });
    await page.waitForFunction(
      () => document.querySelector(".right-panel-edge-feedback-filter")?.getAttribute("data-active") === "true",
      null,
      { timeout: WAIT_MS },
    );
    const afterFilter = await readFeedbackState(page);
    report.checks.afterFilter = afterFilter;
    if (
      afterFilter.itemCount !== 3 ||
      afterFilter.disabledItemCount !== 3 ||
      afterFilter.groupCount !== 1 ||
      !afterFilter.groupText.some((text) => text.includes("Legacy Clarity") && text.includes("2 entries")) ||
      !afterFilter.text.includes("Removed Guardrail") ||
      afterFilter.filterAriaControls !== "right-panel-edge-feedback-list" ||
      afterFilter.clearAriaControls !== "right-panel-edge-feedback-list" ||
      afterFilter.filterAriaDescribedBy !== "right-panel-edge-feedback-stale-count-description"
    ) {
      throw new Error(`Unexpected Score loop state after stale filter: ${JSON.stringify(afterFilter)}`);
    }

    await page.locator(".right-panel-edge-feedback-clear").click({ timeout: WAIT_MS });
    await page.waitForFunction(() => !document.querySelector(".right-panel-edge-feedback"), null, {
      timeout: WAIT_MS,
    });
    const reset = await page.evaluate((key) => {
      const url = new URL(window.location.href);
      return {
        hasSection: Boolean(document.querySelector(".right-panel-edge-feedback")),
        hasEdgeLoopParam: url.searchParams.has("edgeLoop"),
        localStorageValue: window.localStorage.getItem(key),
        resetText: document.querySelector(".right-panel-edge-feedback-reset")?.textContent ?? "",
      };
    }, edgeFeedbackStorageKey(PROJECT_PATH));
    report.checks.reset = reset;
    if (reset.hasSection || reset.hasEdgeLoopParam || reset.localStorageValue != null) {
      throw new Error(`Score loop reset did not clear state: ${JSON.stringify(reset)}`);
    }
    if (!reset.resetText.includes("Score loop cleared")) {
      throw new Error(`Score loop reset status missing: ${JSON.stringify(reset)}`);
    }

    if (quality.consoleErrors.length > 0 || quality.pageErrors.length > 0) {
      throw new Error(
        `Runtime errors detected: ${[...quality.consoleErrors, ...quality.pageErrors].slice(0, 3).join(" | ")}`,
      );
    }
    report.ok = true;
    report.checks.noRuntimeErrors = true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    report.errors.push(message);
    if (isEnvironmentBlockedError(message)) {
      artifactPathOverride = ENV_BLOCKED_OUT;
      report.status = "environment-blocked";
      report.preservesPrimaryArtifact = true;
      report.primaryArtifact = outputArtifactMeta(OUT);
      report.nextRequiredAction = STATIC_DIST
        ? "Run this smoke on a host where Playwright Chromium can launch, or attach the in-app/browser tool to the static dist URL."
        : "Start the dev server on a host where browser launch is allowed, then rerun pnpm verify:right-rail-edge.";
    }
    process.exitCode = 1;
  } finally {
    if (browser) {
      if (typeof browser.disconnect === "function") browser.disconnect();
      else await browser.close().catch(() => {});
    }
    if (staticServer) {
      await new Promise((resolveClose) => staticServer.close(resolveClose));
    }
    const artifact = writeArtifact();
    if (report.ok) {
      console.log(`right rail edge feedback smoke passed: ${artifact}`);
    } else {
      console.error(`right rail edge feedback smoke failed: ${artifact}`);
    }
  }
}

await main();
