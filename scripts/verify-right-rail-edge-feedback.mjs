// Browser smoke for right-rail Edge score feedback, stale filtering, reset, and rail scrolling.
//
// Prerequisite:
//   pnpm.cmd dev -- --host 127.0.0.1 --port 1420
//
// Optional env:
//   AETHER_RIGHT_RAIL_EDGE_URL=http://localhost:1420/
//   AETHER_TAURI_PROJECT=C:/Users/owner/Aether_Terminal
//   AETHER_RIGHT_RAIL_EDGE_OUT=.codex-auto/production-smoke/right-rail-edge-feedback.json

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { chromium } from "@playwright/test";

const APP_URL = process.env.AETHER_RIGHT_RAIL_EDGE_URL ?? "http://localhost:1420/";
const PROJECT_PATH = (process.env.AETHER_TAURI_PROJECT ?? process.cwd()).replaceAll("\\", "/");
const OUT = process.env.AETHER_RIGHT_RAIL_EDGE_OUT ?? ".codex-auto/production-smoke/right-rail-edge-feedback.json";
const WAIT_MS = Number.parseInt(process.env.AETHER_RIGHT_RAIL_EDGE_WAIT_MS ?? "30000", 10);
const EDGE_STORAGE_PREFIX = "aether:right-rail-edge-feedback:";

const report = {
  ok: false,
  startedAt: new Date().toISOString(),
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
  url.searchParams.set("aetherVisualQa", "1");
  url.searchParams.set("projectPath", PROJECT_PATH);
  url.searchParams.set("rail", "command");
  url.searchParams.set("state", "blocked");
  url.searchParams.set("v", "right-rail-edge-feedback");
  url.searchParams.set("edgeLoop", JSON.stringify(edgeLoopPayload()));
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
  await page.evaluate((projectPath) => {
    window.localStorage.setItem("aether:visualQa", "1");
    window.localStorage.setItem("aether:visualQaProject", projectPath);
    window.localStorage.setItem("aether:lastProject", projectPath);
    window.localStorage.setItem("aether:onboarding-done", "true");
    window.localStorage.removeItem("aether:dashboardStateUrl");
  }, PROJECT_PATH);
}

async function readRailMetrics(page) {
  return await page.evaluate(() => {
    const content = document.querySelector(".right-panel-content");
    const stack = document.querySelector(".right-panel-stack");
    if (!content || !stack) return { found: false };
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
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    const quality = attachQualityCollectors(page);

    await page.goto(APP_URL, { waitUntil: "domcontentloaded", timeout: WAIT_MS }).catch((error) => {
      throw new Error(`Cannot open ${APP_URL}. Start the dev server first. ${error.message}`);
    });
    await seedQaStorage(page);
    await page.goto(targetQaUrl(), { waitUntil: "domcontentloaded", timeout: WAIT_MS });
    await page.waitForSelector(".right-panel-edge-feedback", { timeout: WAIT_MS });
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
    report.errors.push(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close().catch(() => {});
    const artifact = writeArtifact();
    if (report.ok) {
      console.log(`right rail edge feedback smoke passed: ${artifact}`);
    } else {
      console.error(`right rail edge feedback smoke failed: ${artifact}`);
    }
  }
}

await main();
