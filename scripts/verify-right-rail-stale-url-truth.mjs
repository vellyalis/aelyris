// Browser smoke for stale right-rail URL truth separation.
//
// Prerequisite:
//   pnpm.cmd dev -- --host 127.0.0.1 --port 1420
//
// Optional env:
//   AETHER_RIGHT_RAIL_STALE_URL_URL=http://localhost:1420/
//   AETHER_TAURI_PROJECT=C:/Users/owner/Aether_Terminal
//   AETHER_RIGHT_RAIL_STALE_URL_OUT=.codex-auto/production-smoke/right-rail-stale-url-truth.json

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { chromium } from "@playwright/test";

const APP_URL = process.env.AETHER_RIGHT_RAIL_STALE_URL_URL ?? "http://localhost:1420/";
const PROJECT_PATH = (process.env.AETHER_TAURI_PROJECT ?? process.cwd()).replaceAll("\\", "/");
const OUT =
  process.env.AETHER_RIGHT_RAIL_STALE_URL_OUT ?? ".codex-auto/production-smoke/right-rail-stale-url-truth.json";
const WAIT_MS = Number.parseInt(process.env.AETHER_RIGHT_RAIL_STALE_URL_WAIT_MS ?? "30000", 10);
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

function staleEdgeLoopPayload() {
  const base = Date.now() - 60_000;
  return {
    key: edgeFeedbackStorageKey(PROJECT_PATH),
    history: [
      {
        id: `stale_url:${base}`,
        axisId: "stale_url",
        axisLabel: "Stale URL",
        actionLabel: "Open risks",
        targetWidget: "reliability",
        score: 40,
        grade: "D",
        previousScore: null,
        delta: 0,
        trend: "baseline",
        createdAt: base,
      },
    ],
  };
}

function targetUrl({ visualQa }) {
  const url = new URL(APP_URL);
  url.searchParams.set("projectPath", PROJECT_PATH);
  url.searchParams.set("rail", "observe");
  url.searchParams.set("state", "blocked");
  url.searchParams.set("edgeLoop", JSON.stringify(staleEdgeLoopPayload()));
  url.searchParams.set("v", visualQa ? "stale-url-truth-qa" : "stale-url-truth-normal");
  if (visualQa) {
    url.searchParams.set("aetherVisualQa", "1");
  } else {
    url.searchParams.delete("aetherVisualQa");
    url.searchParams.delete("visualQa");
  }
  return url.toString();
}

function cleanVisualQaUrl() {
  const url = new URL(APP_URL);
  url.searchParams.set("aetherVisualQa", "1");
  url.searchParams.set("projectPath", PROJECT_PATH);
  url.searchParams.set("rail", "observe");
  url.searchParams.set("v", "stale-url-truth-clean-qa");
  url.searchParams.delete("state");
  url.searchParams.delete("edgeLoop");
  url.searchParams.delete("dashboardState");
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

async function seedProjectStorage(page) {
  await page.goto(APP_URL, { waitUntil: "domcontentloaded", timeout: WAIT_MS });
  await page.evaluate(
    ({ projectPath, storagePrefix }) => {
      window.localStorage.setItem("aether:lastProject", projectPath);
      window.localStorage.setItem("aether:onboarding-done", "true");
      window.localStorage.removeItem("aether:visualQa");
      window.localStorage.removeItem("aether:dashboardStateUrl");
      for (const key of Object.keys(window.localStorage)) {
        if (key.startsWith(storagePrefix)) {
          window.localStorage.removeItem(key);
        }
      }
    },
    { projectPath: PROJECT_PATH, storagePrefix: EDGE_STORAGE_PREFIX },
  );
}

async function seedPersistedEdgeFeedback(page) {
  await page.evaluate(
    ({ storagePrefix, projectPath, payload }) => {
      let hash = 2166136261;
      const normalized = projectPath.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
      for (let index = 0; index < normalized.length; index += 1) {
        hash ^= normalized.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
      }
      const key = `${storagePrefix}${(hash >>> 0).toString(36)}`;
      window.localStorage.setItem(key, JSON.stringify(payload.history));
    },
    { storagePrefix: EDGE_STORAGE_PREFIX, projectPath: PROJECT_PATH, payload: staleEdgeLoopPayload() },
  );
}

async function readTruthState(page) {
  return await page.evaluate(() => {
    const notice = document.querySelector(".right-panel-truth-notice");
    const runLoop = document.querySelector(".right-panel-run-loop");
    const now = document.querySelector(".right-panel-now");
    const edgeFeedback = document.querySelector(".right-panel-edge-feedback");
    const url = new URL(window.location.href);
    const runtimeText = [runLoop?.textContent, now?.textContent]
      .filter((part) => typeof part === "string" && part.length > 0)
      .join(" ");
    return {
      url: window.location.href,
      hasEdgeLoopParam: url.searchParams.has("edgeLoop"),
      truthNoticeVisible: Boolean(notice),
      truthNoticeSource: notice?.getAttribute("data-source") ?? null,
      truthNoticeText: notice?.textContent?.replace(/\s+/g, " ").trim() ?? "",
      nowState: now?.getAttribute("data-state") ?? runLoop?.getAttribute("data-phase") ?? null,
      nowTone: now?.getAttribute("data-tone") ?? runLoop?.getAttribute("data-phase") ?? null,
      nowText: runtimeText.replace(/\s+/g, " ").trim(),
      edgeFeedbackVisible: Boolean(edgeFeedback),
      edgeFeedbackText: edgeFeedback?.textContent?.replace(/\s+/g, " ").trim() ?? "",
    };
  });
}

function assertNoConsoleFailures(quality) {
  if (quality.consoleErrors.length > 0 || quality.pageErrors.length > 0) {
    throw new Error(
      `browser errors during stale URL truth smoke: console=${quality.consoleErrors.join(" | ")} page=${quality.pageErrors.join(" | ")}`,
    );
  }
}

async function main() {
  let browser = null;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    const quality = attachQualityCollectors(page);

    await seedProjectStorage(page);
    await page.goto(targetUrl({ visualQa: false }), { waitUntil: "domcontentloaded", timeout: WAIT_MS });
    await page.waitForSelector(".right-panel-run-loop", { timeout: WAIT_MS });
    report.checks.normalRuntime = await readTruthState(page);

    if (report.checks.normalRuntime.truthNoticeVisible) {
      throw new Error("normal runtime URL rendered the Visual QA truth notice");
    }
    if (/Visual QA simulation|fixture state|runtime truth is unchanged/i.test(report.checks.normalRuntime.nowText)) {
      throw new Error("normal runtime state was contaminated by visual-QA copy");
    }
    if (/Stale URL|edgeLoop is replay evidence/i.test(report.checks.normalRuntime.edgeFeedbackText)) {
      throw new Error("normal runtime replayed stale edgeLoop URL feedback");
    }

    await seedProjectStorage(page);
    await seedPersistedEdgeFeedback(page);
    await page.goto(cleanVisualQaUrl(), { waitUntil: "domcontentloaded", timeout: WAIT_MS });
    await page.waitForSelector(".right-panel-truth-notice", { timeout: WAIT_MS });
    await page.waitForSelector(".right-panel-run-loop", { timeout: WAIT_MS });
    report.checks.visualQaCleanUrl = await readTruthState(page);

    if (report.checks.visualQaCleanUrl.hasEdgeLoopParam) {
      throw new Error("clean visual-QA URL resurrected stale edgeLoop from persisted score history");
    }
    if (/edgeLoop is replay evidence/i.test(report.checks.visualQaCleanUrl.truthNoticeText)) {
      throw new Error("clean visual-QA URL labeled persisted score history as URL replay evidence");
    }

    await seedProjectStorage(page);
    await page.goto(targetUrl({ visualQa: true }), { waitUntil: "domcontentloaded", timeout: WAIT_MS });
    await page.waitForSelector(".right-panel-truth-notice", { timeout: WAIT_MS });
    await page.waitForSelector(".right-panel-run-loop", { timeout: WAIT_MS });
    report.checks.visualQaRuntime = await readTruthState(page);

    if (!report.checks.visualQaRuntime.truthNoticeVisible) {
      throw new Error("explicit visual-QA URL did not render a truth-source notice");
    }
    if (report.checks.visualQaRuntime.truthNoticeSource !== "visual-qa") {
      throw new Error("truth-source notice did not identify visual-QA as the source");
    }
    for (const requiredText of [
      "Visual QA simulation",
      "state=blocked is fixture state",
      "runtime truth is unchanged",
      "edgeLoop is replay evidence",
      "Use railState instead",
    ]) {
      if (!report.checks.visualQaRuntime.truthNoticeText.includes(requiredText)) {
        throw new Error(`truth-source notice missing required copy: ${requiredText}`);
      }
    }
    if (!report.checks.visualQaRuntime.edgeFeedbackText.includes("Stale URL")) {
      throw new Error("explicit visual-QA URL did not replay the diagnostic edgeLoop evidence");
    }

    assertNoConsoleFailures(quality);
    report.ok = true;
    report.status = "pass";
  } catch (error) {
    report.status = "failed";
    report.errors.push(error instanceof Error ? error.stack || error.message : String(error));
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close().catch(() => {});
    const artifact = writeArtifact();
    if (report.ok) {
      console.log(`right rail stale URL truth smoke passed: ${artifact}`);
    } else {
      console.error(`right rail stale URL truth smoke failed: ${artifact}`);
    }
  }
}

await main();
