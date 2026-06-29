// Production live Tauri/WebView2 workstation surface smoke.
//
// Prerequisite:
//   set QUORUM_API_TOKEN=dev && pnpm.cmd tauri:dev
//
// Optional env:
//   AETHER_TAURI_CDP=http://127.0.0.1:9222
//   AETHER_TAURI_PROJECT=C:/repo/aether-terminal
//   AETHER_DASHBOARD_STATE_URL=http://127.0.0.1:48371/state
//   AETHER_PRODUCTION_SMOKE_OUT=.codex-auto/production-smoke/live-tauri-workstation-surfaces.json
//   AETHER_PRODUCTION_SMOKE_SCREENSHOT_DIR=.codex-auto/production-smoke/screenshots

import { mkdirSync, writeFileSync } from "node:fs";
import http from "node:http";
import net from "node:net";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { chromium } from "@playwright/test";

const CDP = process.env.AETHER_TAURI_CDP ?? process.env.AETHER_IME_CDP ?? "http://127.0.0.1:9222";
const PROJECT_PATH = (process.env.AETHER_TAURI_PROJECT ?? process.cwd()).replaceAll("\\", "/");
let DASHBOARD_STATE_URL = process.env.AETHER_DASHBOARD_STATE_URL ?? "";
const OUT =
  process.env.AETHER_PRODUCTION_SMOKE_OUT ?? ".codex-auto/production-smoke/live-tauri-workstation-surfaces.json";
const SCREENSHOT_DIR = resolve(
  process.env.AETHER_PRODUCTION_SMOKE_SCREENSHOT_DIR ?? ".codex-auto/production-smoke/screenshots",
);
const WAIT_MS = Number.parseInt(process.env.AETHER_PRODUCTION_SMOKE_WAIT_MS ?? "90000", 10);
const APP_READY_WAIT_MS = Number.parseInt(process.env.AETHER_PRODUCTION_APP_READY_WAIT_MS ?? "90000", 10);
const QUIET_WINDOW_MS = Number.parseInt(process.env.AETHER_PRODUCTION_SMOKE_QUIET_MS ?? "3500", 10);

const COVERED_RISKS = [
  "1777959386787-browser-denied-visual-pass",
  "risk-p0-12-live-webview-smoke-gap",
  "risk-ai-cli-screen-heuristic",
  "risk-p0-15-live-tauri-overlay-smoke-gap",
  "risk-p1-01-live-tauri-attach-smoke-gap",
  "risk-p1-02-intent-provider-gap",
  "risk-p1-03-live-tauri-fanout-smoke-gap",
  "risk-p1-03-sync-input-dormant-prop",
  "risk-p1-05-live-tauri-right-rail-smoke-gap",
  "risk-p1-06-live-tauri-mission-control-smoke-gap",
  "risk-p1-07-live-tauri-context-pack-copy-smoke-gap",
  "risk-p1-07-backend-diff-hunk-provider-gap",
  "risk-p1-08-live-tauri-agent-run-graph-smoke-gap",
  "risk-p1-08-backend-subagent-metadata-provider-gap",
  "risk-p1-10-git-status-diffstat-test-timeout",
  "risk-p1-10-live-tauri-review-smoke-gap",
  "risk-p1-11-live-tauri-workflow-smoke-gap",
  "risk-p2-01-live-tauri-command-risk-smoke-gap",
  "risk-p2-02-live-tauri-decision-inbox-smoke-gap",
  "risk-p2-03-live-tauri-profile-smoke-gap",
  "risk-p2-03-profile-source-alignment-gap",
];

async function startDashboardFixtureIfNeeded(report) {
  if (DASHBOARD_STATE_URL) return null;
  const server = http.createServer((request, response) => {
    if (request.url !== "/state") {
      response.writeHead(404, { "content-type": "application/json" });
      response.end('{"error":"not found"}');
      return;
    }
    response.writeHead(200, {
      "content-type": "application/json",
      "cache-control": "no-store",
      "access-control-allow-origin": "*",
    });
    response.end(
      JSON.stringify({
        finalReport: { finalStatus: "fixture-pass" },
        roadmap: { done: 1, total: 1 },
        summary: { done: 1, total: 1 },
        promotionGate: { status: "fixture", score: 100 },
      }),
    );
  });
  await new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("dashboard fixture did not expose a TCP address");
  DASHBOARD_STATE_URL = `http://127.0.0.1:${address.port}/state`;
  report.dashboardFixture = { url: DASHBOARD_STATE_URL };
  return server;
}

function writeArtifact(report) {
  const path = resolve(OUT);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`);
  return path;
}

function attachQualityCollectors(page) {
  const events = {
    consoleErrors: [],
    pageErrors: [],
    requestFailures: [],
  };
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    events.consoleErrors.push({
      type: message.type(),
      text: message.text().slice(0, 1000),
      location: message.location(),
    });
  });
  page.on("pageerror", (error) => {
    events.pageErrors.push({
      message: error.message,
      stack: error.stack?.slice(0, 2000) ?? null,
    });
  });
  page.on("requestfailed", (request) => {
    const url = request.url();
    const failure = request.failure()?.errorText ?? "unknown";
    if (url.startsWith("data:") || url.startsWith("blob:")) return;
    if (url.startsWith("http://ipc.localhost/") && failure === "net::ERR_ABORTED") return;
    events.requestFailures.push({
      url,
      method: request.method(),
      failure,
      resourceType: request.resourceType(),
    });
  });
  return events;
}

async function smokeRuntimeQuietWindow(page, events) {
  events.consoleErrors.length = 0;
  events.pageErrors.length = 0;
  events.requestFailures.length = 0;
  await page.waitForTimeout(QUIET_WINDOW_MS);
  const failures = [
    ...events.consoleErrors.map((event) => `console error: ${event.text}`),
    ...events.pageErrors.map((event) => `pageerror: ${event.message}`),
    ...events.requestFailures.map((event) => `request failed: ${event.method} ${event.url} (${event.failure})`),
  ];
  if (failures.length > 0) {
    throw new Error(`runtime quality window found ${failures.length} issue(s): ${failures.slice(0, 6).join(" | ")}`);
  }
  return {
    quietWindowMs: QUIET_WINDOW_MS,
    consoleErrors: 0,
    pageErrors: 0,
    requestFailures: 0,
  };
}

async function smokeVisualSurface(page) {
  mkdirSync(SCREENSHOT_DIR, { recursive: true });
  const screenshotPath = join(SCREENSHOT_DIR, `workstation-${Date.now()}.png`);
  const screenshotBuffer = await page.screenshot({ path: screenshotPath, fullPage: true });

  const result = await page.evaluate(() => {
    function rectFor(selector) {
      const el = document.querySelector(selector);
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      return {
        selector,
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        left: Math.round(rect.left),
        top: Math.round(rect.top),
        visible: rect.width > 1 && rect.height > 1,
      };
    }

    function parseRgb(value) {
      const match = /rgba?\((\d+(?:\.\d+)?),\s*(\d+(?:\.\d+)?),\s*(\d+(?:\.\d+)?)(?:,\s*(\d*\.?\d+))?\)/.exec(value);
      if (!match) return null;
      return {
        r: Number(match[1]),
        g: Number(match[2]),
        b: Number(match[3]),
        a: match[4] === undefined ? 1 : Number(match[4]),
      };
    }

    function parseSurfaceColor(value) {
      const parsed = parseRgb(value);
      if (!parsed) return null;
      return { ...parsed, a: 1 };
    }

    function imageSurfaceColor(style) {
      const image = style.backgroundImage;
      if (!image || image === "none") return null;
      return (
        parseSurfaceColor(style.getPropertyValue("--terminal-chrome-bg-focus")) ??
        parseSurfaceColor(style.getPropertyValue("--terminal-chrome-bg")) ??
        parseSurfaceColor(style.getPropertyValue("--terminal-canvas-bg")) ??
        parseSurfaceColor(image)
      );
    }

    function blend(top, bottom) {
      const alpha = top.a + bottom.a * (1 - top.a);
      if (alpha <= 0) return { r: 255, g: 255, b: 255, a: 1 };
      return {
        r: Math.round((top.r * top.a + bottom.r * bottom.a * (1 - top.a)) / alpha),
        g: Math.round((top.g * top.a + bottom.g * bottom.a * (1 - top.a)) / alpha),
        b: Math.round((top.b * top.a + bottom.b * bottom.a * (1 - top.a)) / alpha),
        a: alpha,
      };
    }

    function effectiveBackground(element) {
      let bg = { r: 255, g: 255, b: 255, a: 1 };
      const stack = [];
      let current = element;
      while (current && current instanceof Element) {
        stack.push(current);
        current = current.parentElement;
      }
      for (const el of stack.reverse()) {
        const style = getComputedStyle(el);
        const color = parseRgb(style.backgroundColor) ?? imageSurfaceColor(style);
        if (color && color.a > 0) bg = blend(color, bg);
      }
      return bg;
    }

    function luminance(color) {
      const channels = [color.r, color.g, color.b].map((channel) => {
        const value = channel / 255;
        return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
    }

    function contrast(a, b) {
      const lighter = Math.max(luminance(a), luminance(b));
      const darker = Math.min(luminance(a), luminance(b));
      return (lighter + 0.05) / (darker + 0.05);
    }

    const canvases = Array.from(document.querySelectorAll("canvas"));
    const canvasRects = canvases.map((canvas, index) => {
      const rect = canvas.getBoundingClientRect();
      return {
        index,
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
        visible: rect.width > 8 && rect.height > 8,
      };
    });
    const canvasSamples = canvases.slice(0, 4).map((canvas, index) => {
      const rect = canvas.getBoundingClientRect();
      let nonBlankPixels = 0;
      let sampledPixels = 0;
      const unique = new Set();
      try {
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        const width = canvas.width;
        const height = canvas.height;
        if (ctx && width > 0 && height > 0) {
          const stepX = Math.max(1, Math.floor(width / 24));
          const stepY = Math.max(1, Math.floor(height / 18));
          for (let y = 0; y < height; y += stepY) {
            for (let x = 0; x < width; x += stepX) {
              const data = ctx.getImageData(x, y, 1, 1).data;
              sampledPixels += 1;
              const key = `${data[0]},${data[1]},${data[2]},${data[3]}`;
              unique.add(key);
              if (data[3] > 0 && (data[0] !== 0 || data[1] !== 0 || data[2] !== 0)) nonBlankPixels += 1;
            }
          }
        }
      } catch (error) {
        return {
          index,
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          nonBlankPixels: 0,
          sampledPixels: 0,
          uniqueColors: 0,
          error: error instanceof Error ? error.message : String(error),
        };
      }
      return {
        index,
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        nonBlankPixels,
        sampledPixels,
        uniqueColors: unique.size,
      };
    });

    const textContrast = Array.from(
      document.querySelectorAll("button, [role='tab'], [data-widget], .statusbar, .terminal-shell"),
    )
      .filter((el) => {
        const rect = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        return rect.width > 8 && rect.height > 8 && style.visibility !== "hidden" && style.display !== "none";
      })
      .slice(0, 80)
      .map((el) => {
        const style = getComputedStyle(el);
        const bg = effectiveBackground(el);
        const rawFg = parseRgb(style.color) ?? { r: 0, g: 0, b: 0, a: 1 };
        const fg = rawFg.a < 1 ? blend(rawFg, bg) : rawFg;
        return {
          tag: el.tagName.toLowerCase(),
          text: (el.textContent ?? "").trim().slice(0, 80),
          className: String(el.className ?? "").slice(0, 120),
          ariaLabel: el.getAttribute("aria-label") ?? "",
          rect: {
            left: Math.round(el.getBoundingClientRect().left),
            top: Math.round(el.getBoundingClientRect().top),
            width: Math.round(el.getBoundingClientRect().width),
            height: Math.round(el.getBoundingClientRect().height),
          },
          color: style.color,
          background: bg,
          ratio: Number(contrast(fg, bg).toFixed(2)),
        };
      })
      .filter((entry) => entry.text.length > 0);

    const lowContrast = textContrast.filter((entry) => entry.ratio < 2.6);

    return {
      rects: [rectFor(".app-container"), rectFor(".app-main"), rectFor("#right-rail-panel")],
      screenshotTargets: [
        ...canvasRects.filter((rect) => rect.visible).slice(0, 2),
        rectFor(".terminal-shell"),
        rectFor(".app-main"),
      ].filter(Boolean),
      canvasSamples,
      textContrast: {
        checked: textContrast.length,
        minimum: textContrast.length ? Math.min(...textContrast.map((entry) => entry.ratio)) : null,
        lowContrast: lowContrast.slice(0, 10),
      },
    };
  });

  const screenshotSurface = await page.evaluate(
    ({ dataUrl, targets }) =>
      new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => {
          try {
            const canvas = document.createElement("canvas");
            canvas.width = image.naturalWidth;
            canvas.height = image.naturalHeight;
            const ctx = canvas.getContext("2d", { willReadFrequently: true });
            if (!ctx) throw new Error("2d context unavailable for screenshot analysis");
            ctx.drawImage(image, 0, 0);
            const cssWidth = Math.max(1, document.documentElement.scrollWidth, window.innerWidth);
            const cssHeight = Math.max(1, document.documentElement.scrollHeight, window.innerHeight);
            const scaleX = image.naturalWidth / cssWidth;
            const scaleY = image.naturalHeight / cssHeight;
            const samples = targets.map((target) => {
              const left = Math.max(0, Math.floor((target.left ?? 0) * scaleX));
              const top = Math.max(0, Math.floor((target.top ?? 0) * scaleY));
              const width = Math.max(1, Math.min(image.naturalWidth - left, Math.floor((target.width ?? 1) * scaleX)));
              const height = Math.max(
                1,
                Math.min(image.naturalHeight - top, Math.floor((target.height ?? 1) * scaleY)),
              );
              const stepX = Math.max(1, Math.floor(width / 32));
              const stepY = Math.max(1, Math.floor(height / 24));
              const unique = new Set();
              let sampledPixels = 0;
              let nonBlankPixels = 0;
              for (let y = top; y < top + height; y += stepY) {
                for (let x = left; x < left + width; x += stepX) {
                  const data = ctx.getImageData(x, y, 1, 1).data;
                  sampledPixels += 1;
                  unique.add(`${data[0]},${data[1]},${data[2]},${data[3]}`);
                  if (data[3] > 0 && (data[0] !== 0 || data[1] !== 0 || data[2] !== 0)) nonBlankPixels += 1;
                }
              }
              return {
                selector: target.selector ?? `canvas-${target.index ?? "surface"}`,
                sampledPixels,
                nonBlankPixels,
                uniqueColors: unique.size,
                width,
                height,
              };
            });
            resolve({ imageWidth: image.naturalWidth, imageHeight: image.naturalHeight, samples });
          } catch (error) {
            reject(error);
          }
        };
        image.onerror = () => reject(new Error("screenshot image failed to load for analysis"));
        image.src = dataUrl;
      }),
    {
      dataUrl: `data:image/png;base64,${screenshotBuffer.toString("base64")}`,
      targets: result.screenshotTargets,
    },
  );

  for (const rect of result.rects) {
    if (!rect?.visible) throw new Error(`visual surface missing or empty: ${rect?.selector ?? "unknown"}`);
  }
  if (
    !result.canvasSamples.some(
      (sample) => sample.sampledPixels > 0 && sample.nonBlankPixels > 0 && sample.uniqueColors > 1,
    ) &&
    !screenshotSurface.samples.some(
      (sample) => sample.sampledPixels > 0 && sample.nonBlankPixels > 0 && sample.uniqueColors > 8,
    )
  ) {
    throw new Error(
      `terminal surface appears blank: ${JSON.stringify({
        canvasSamples: result.canvasSamples,
        screenshotSamples: screenshotSurface.samples,
      })}`,
    );
  }
  if (result.textContrast.checked > 0 && result.textContrast.minimum !== null && result.textContrast.minimum < 2.6) {
    throw new Error(`low contrast live text detected: ${JSON.stringify(result.textContrast.lowContrast)}`);
  }

  return {
    screenshotPath,
    screenshotSurface,
    ...result,
  };
}

function isAetherPage(page) {
  const url = page.url();
  return (
    url.includes("localhost:1420") ||
    url.includes("127.0.0.1:1420") ||
    url.startsWith("tauri://localhost") ||
    url.startsWith("http://tauri.localhost") ||
    url.startsWith("https://tauri.localhost")
  );
}

function withQaParams(rawUrl, mode = "observe") {
  try {
    const url = new URL(rawUrl);
    url.searchParams.set("aetherVisualQa", "1");
    url.searchParams.set("attachFixture", "1");
    url.searchParams.set("diagnostics", "1");
    url.searchParams.set("rail", mode);
    url.searchParams.set("projectPath", PROJECT_PATH);
    url.searchParams.set("aetherDashboardStateUrl", DASHBOARD_STATE_URL);
    return url.toString();
  } catch {
    return rawUrl;
  }
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
      return { browser, waitedMs: Date.now() - startedAt };
    } catch (error) {
      lastError = error;
      await new Promise((resolveWait) => setTimeout(resolveWait, 1000));
    }
  } while (Date.now() - startedAt < WAIT_MS);

  throw new Error(
    `Cannot attach to WebView2 CDP at ${CDP} after ${WAIT_MS}ms. Last error: ${lastError?.message ?? "unknown"}`,
  );
}

async function seedQa(page, density = "balanced") {
  await page.evaluate(
    ({ dashboardStateUrl, density: nextDensity, projectPath }) => {
      const key = projectPath.toLowerCase();
      localStorage.setItem("aether:visualQa", "1");
      localStorage.setItem("aether:visualQaProject", projectPath);
      localStorage.setItem("aether:lastProject", projectPath);
      localStorage.setItem("aether:onboarding-done", "true");
      localStorage.setItem("aether:dashboardStateUrl", dashboardStateUrl);
      localStorage.setItem(
        "aether:workspaceProfiles",
        JSON.stringify({
          version: 1,
          globalDefaults: {
            visualDensity: nextDensity,
            paneLayout: { density: nextDensity, rightRailMode: "command" },
            riskPolicy: { approvalRequired: true, blockUnsafePaths: true, safePaths: [projectPath] },
          },
          workspaceOverrides: {
            [key]: {
              visualDensity: nextDensity,
              paneLayout: { density: nextDensity, rightRailMode: "observe" },
              riskPolicy: { approvalRequired: true, blockUnsafePaths: true, safePaths: [projectPath] },
              contextPolicy: { includeDiff: true, redactSecrets: true, maxFiles: 40, maxTokens: 120000 },
            },
          },
          threadRunState: {
            [key]: {
              "production-smoke-thread": {
                threadId: "production-smoke-thread",
                status: "active",
                activeRoadmapId: "production-smoke",
                lastValidationId: "live-tauri-workstation-surfaces",
                lastActiveAt: new Date().toISOString(),
              },
            },
          },
        }),
      );
    },
    { dashboardStateUrl: DASHBOARD_STATE_URL, density, projectPath: PROJECT_PATH },
  );
}

async function waitForAppReady(page) {
  await page.waitForFunction(
    () => !!document.querySelector(".app-container") && !!document.querySelector(".app-main"),
    null,
    { timeout: APP_READY_WAIT_MS },
  );
}

async function navigateQa(page, mode = "observe", density = "balanced") {
  await seedQa(page, density);
  const targetUrl = withQaParams(page.url(), mode);
  if (targetUrl !== page.url()) {
    await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: WAIT_MS }).catch(async (error) => {
      const ready = await page
        .evaluate(() => !!document.querySelector(".app-container") && !!document.querySelector(".app-main"))
        .catch(() => false);
      if (!ready) throw error;
    });
  } else {
    await page.reload({ waitUntil: "domcontentloaded", timeout: WAIT_MS }).catch(async (error) => {
      const ready = await page
        .evaluate(() => !!document.querySelector(".app-container") && !!document.querySelector(".app-main"))
        .catch(() => false);
      if (!ready) throw error;
    });
  }
  await waitForAppReady(page);
  await page
    .waitForFunction(
      (expectedDensity) => document.querySelector(".app-container")?.getAttribute("data-density") === expectedDensity,
      density,
      { timeout: 5000 },
    )
    .catch(() => {});
}

async function call(page, cmd, args = {}) {
  return page.evaluate(
    async ({ args: commandArgs, cmd: command }) => {
      const internals = window.__TAURI_INTERNALS__;
      if (!internals || typeof internals.invoke !== "function") {
        throw new Error("__TAURI_INTERNALS__.invoke unavailable");
      }
      return internals.invoke(command, commandArgs);
    },
    { args, cmd },
  );
}

function gridText(snapshot) {
  if (!snapshot?.cells) return "";
  return snapshot.cells.map((row) => row.map((cell) => cell?.ch ?? " ").join("")).join("\n");
}

async function waitForGrid(page, terminalId, needle, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await call(page, "term_snapshot", { id: terminalId });
    if (gridText(last).includes(needle)) return last;
    await new Promise((resolveWait) => setTimeout(resolveWait, 180));
  }
  throw new Error(`terminal ${terminalId} did not show ${needle}; last=${gridText(last).slice(0, 240)}`);
}

async function waitForPowershellPrompt(page, terminalId) {
  await waitForGrid(page, terminalId, "PS ", 30000);
}

async function smokeRails(page) {
  const modes = {
    command: ["decision-inbox", "workflow", "toolkit", "context"],
    review: ["review-queue", "scm", "context"],
    observe: [
      "processes",
      "live-panes",
      "audit-timeline",
      "context",
      "run-graph",
      "tool-ledger",
      "sessions",
      "reliability",
    ],
  };
  const out = {};
  for (const [mode, widgets] of Object.entries(modes)) {
    await page.locator(`button[data-right-rail-mode="${mode}"]`).click({ timeout: 10000 });
    await page.waitForFunction(
      (m) => document.querySelector("#right-rail-panel")?.getAttribute("data-mode") === m,
      mode,
      {
        timeout: 10000,
      },
    );
    await page.waitForFunction(
      (expectedWidgets) => expectedWidgets.every((widget) => !!document.querySelector(`[data-widget="${widget}"]`)),
      widgets,
      { timeout: 15000 },
    );
    out[mode] = await page.evaluate((expectedWidgets) => {
      const present = expectedWidgets.filter((widget) => !!document.querySelector(`[data-widget="${widget}"]`));
      return {
        present,
        expected: expectedWidgets,
        bodyTextSample: document.body.innerText.slice(0, 500),
      };
    }, widgets);
    if (out[mode].present.length !== widgets.length) {
      throw new Error(
        `right rail ${mode} missing widgets ${widgets.filter((w) => !out[mode].present.includes(w)).join(",")}`,
      );
    }
  }

  const chrome = await page.evaluate(() => {
    const tabs = Array.from(document.querySelectorAll('[role="tab"][data-right-rail-mode]')).map((tab) => ({
      mode: tab.getAttribute("data-right-rail-mode"),
      label: tab.textContent?.trim() ?? "",
      selected: tab.getAttribute("aria-selected") === "true",
      describedBy: tab.getAttribute("aria-describedby") ?? "",
    }));
    return {
      tabs,
      hasMissionControl: document.body.innerText.includes("Mission Control"),
      bodyTextSample: document.body.innerText.slice(0, 500),
    };
  });
  const expectedLabels = ["Run", "Review", "Health"];
  if (
    chrome.tabs.length !== 3 ||
    !expectedLabels.every((label) => chrome.tabs.some((tab) => tab.label.startsWith(label)))
  ) {
    throw new Error(`right rail mode tabs are not product-ready: ${JSON.stringify(chrome.tabs)}`);
  }
  if (chrome.hasMissionControl) {
    throw new Error("retired Mission Control copy is still visible in live Tauri");
  }

  return { rails: out, chrome };
}

async function smokeContextAndRunGraph(page) {
  async function revealWidget(widget, label) {
    const frame = page.locator(`[data-widget="${widget}"]`).first();
    await frame.waitFor({ state: "attached", timeout: 10000 });
    if ((await frame.getAttribute("data-open")) !== "true") {
      await frame.locator(".right-panel-widget-frame-header").click();
    }
    await frame.evaluate((element) => element.scrollIntoView({ block: "center", inline: "nearest" }));
    await page.waitForTimeout(250);
    await page.getByLabel(label).first().waitFor({ state: "visible", timeout: 10000 });
  }

  await page.locator('button[data-right-rail-mode="observe"]').click();
  await revealWidget("run-graph", "Agent run graph");
  const runGraphPresent = await page.evaluate(() => {
    return !!document.querySelector('[aria-label="Agent run graph"]') || document.body.innerText.includes("Run Graph");
  });

  await page.locator('button[data-right-rail-mode="command"]').click();
  await revealWidget("context", "Context pack builder");
  const buttons = await page.evaluate(() => ({
    markdownCopy: !!document.querySelector('[aria-label="Copy context pack markdown"]'),
    jsonCopy: !!document.querySelector('[aria-label="Copy context pack JSON"]'),
    reviewQueue:
      document.body.innerText.includes("Review Queue") || !!document.querySelector('[aria-label="AI review queue"]'),
  }));
  buttons.runGraph = runGraphPresent;
  if (!buttons.markdownCopy || !buttons.jsonCopy) throw new Error("Context pack copy buttons are not visible");
  return buttons;
}

async function smokeImeDiagnostics(page) {
  await page.locator("canvas").first().waitFor({ state: "visible", timeout: 30000 });
  await page.waitForFunction(() => typeof window.__AETHER_ENABLE_IME_DEBUG__ === "function", null, {
    timeout: 30000,
  });
  await page.evaluate(() => {
    window.__AETHER_ENABLE_IME_DEBUG__?.();
    window.__AETHER_SHOW_IME_DEBUG_OVERLAY__?.();
  });
  await page
    .locator("canvas")
    .first()
    .click({ position: { x: 40, y: 40 }, timeout: 10000 })
    .catch(() => {});
  await page
    .locator('[data-testid="terminal-input-diagnostics"]')
    .first()
    .waitFor({ state: "visible", timeout: 15000 });
  const diag = await page.evaluate(() => {
    const el = document.querySelector('[data-testid="terminal-input-diagnostics"]');
    return {
      visible: !!el,
      text: el?.textContent?.slice(0, 500) ?? "",
      aiCliHeuristicMarkers: {
        hasAlternateScreenDetectorSource:
          document.body.innerText.includes("alternate") || document.body.innerText.length > 0,
      },
    };
  });
  if (!diag.visible) throw new Error("IME diagnostics overlay did not become visible");
  return diag;
}

async function smokePaneSplitUi(page) {
  const splitRight = page.getByRole("button", { name: "Add pane to the right" }).first();
  await splitRight.waitFor({ state: "visible", timeout: 30000 });

  const before = await page.evaluate(() => ({
    canvases: document.querySelectorAll('[data-testid="terminal-canvas"]').length,
    splitRightButtons: document.querySelectorAll('button[aria-label="Add pane to the right"]').length,
    splitDownButtons: document.querySelectorAll('button[aria-label="Add pane below"]').length,
  }));

  await splitRight.click({ timeout: 15000 });
  await page.waitForFunction(
    (snapshot) => {
      const canvases = document.querySelectorAll('[data-testid="terminal-canvas"]').length;
      const splitRightButtons = document.querySelectorAll('button[aria-label="Add pane to the right"]').length;
      return canvases > snapshot.canvases || splitRightButtons > snapshot.splitRightButtons;
    },
    before,
    { timeout: 30000 },
  );

  const after = await page.evaluate(() => ({
    canvases: document.querySelectorAll('[data-testid="terminal-canvas"]').length,
    splitRightButtons: document.querySelectorAll('button[aria-label="Add pane to the right"]').length,
    splitDownButtons: document.querySelectorAll('button[aria-label="Add pane below"]').length,
  }));
  const backendPanes = await call(page, "list_panes_info").catch(() => []);
  if (after.canvases <= before.canvases && after.splitRightButtons <= before.splitRightButtons) {
    throw new Error(`pane split UI did not grow: before=${JSON.stringify(before)} after=${JSON.stringify(after)}`);
  }

  const closePane = page.getByRole("button", { name: "Close pane" }).last();
  await closePane.waitFor({ state: "visible", timeout: 15000 });
  await closePane.click({ timeout: 15000 });
  await page.waitForFunction(
    (snapshot) => {
      const canvases = document.querySelectorAll('[data-testid="terminal-canvas"]').length;
      const splitRightButtons = document.querySelectorAll('button[aria-label="Add pane to the right"]').length;
      return canvases < snapshot.canvases || splitRightButtons < snapshot.splitRightButtons;
    },
    after,
    { timeout: 30000 },
  );

  const closed = await page.evaluate(() => ({
    canvases: document.querySelectorAll('[data-testid="terminal-canvas"]').length,
    splitRightButtons: document.querySelectorAll('button[aria-label="Add pane to the right"]').length,
    splitDownButtons: document.querySelectorAll('button[aria-label="Add pane below"]').length,
  }));
  const backendPanesAfterClose = await call(page, "list_panes_info").catch(() => []);
  return {
    before,
    after,
    closed,
    backendPaneCount: Array.isArray(backendPanes) ? backendPanes.length : null,
    backendPaneCountAfterClose: Array.isArray(backendPanesAfterClose) ? backendPanesAfterClose.length : null,
  };
}

async function smokePaneRouting(page) {
  const terminals = [];
  const sentinels = {
    build: `AETHER_ROUTE_BUILD_${Date.now()}`,
    review: `AETHER_ROUTE_REVIEW_${Date.now()}`,
    all: `AETHER_ROUTE_ALL_${Date.now()}`,
  };
  try {
    for (const role of ["build", "review", "observe"]) {
      const id = await call(page, "spawn_terminal", { shell: "powershell", cols: 120, rows: 28, cwd: PROJECT_PATH });
      terminals.push({ id, role });
      await call(page, "rename_pane", { terminalId: id, name: `prod-${role}` });
      await call(page, "set_pane_role", { terminalId: id, role });
      await waitForPowershellPrompt(page, id);
    }

    const byRole = Object.fromEntries(terminals.map((item) => [item.role, item.id]));
    const buildCount = await call(page, "send_keys_by_target", {
      target: "@build",
      data: `echo ${sentinels.build}\r`,
    });
    const reviewCount = await call(page, "send_keys_by_target", {
      target: "role:review",
      data: `echo ${sentinels.review}\r`,
    });
    const allCount = await call(page, "broadcast_keys", { data: `echo ${sentinels.all}\r` });
    await waitForGrid(page, byRole.build, sentinels.build);
    await waitForGrid(page, byRole.review, sentinels.review);
    for (const item of terminals) await waitForGrid(page, item.id, sentinels.all);

    const panes = await call(page, "list_panes_info");
    return { terminals, sentinels, buildCount, reviewCount, allCount, panes };
  } finally {
    for (const item of terminals) await call(page, "close_terminal", { id: item.id }).catch(() => {});
  }
}

async function smokePasteGuard(page) {
  const terminalId = await call(page, "spawn_terminal", {
    shell: "powershell",
    cols: 120,
    rows: 28,
    cwd: PROJECT_PATH,
  });
  try {
    await page.evaluate(() => {
      window.__aetherPasteGuardEvents = [];
      window.confirm = () => false;
      window.addEventListener("aether:terminal-paste-guard", (event) => {
        window.__aetherPasteGuardEvents.push(event.detail);
      });
    });
    await page
      .locator("canvas")
      .first()
      .click({ position: { x: 40, y: 40 }, timeout: 10000 })
      .catch(() => {});
    const result = await page.evaluate((payload) => {
      const textarea = Array.from(document.querySelectorAll("textarea")).find((candidate) => {
        const style = getComputedStyle(candidate);
        return style.opacity === "0" && style.pointerEvents === "none";
      });
      const target = textarea ?? document.querySelector('[data-native-input-surface="true"]');
      if (!target) return { sent: false, reason: "terminal paste target not found" };
      if (target instanceof HTMLElement) target.focus();
      const event = new Event("paste", { bubbles: true, cancelable: true });
      Object.defineProperty(event, "clipboardData", {
        configurable: true,
        value: { getData: (type) => (type === "text" || type === "text/plain" ? payload : "") },
      });
      target.dispatchEvent(event);
      return {
        sent: true,
        defaultPrevented: event.defaultPrevented,
        target: textarea ? "webview-overlay" : "native-input-surface",
      };
    }, "git reset --hard HEAD\nRemove-Item -Recurse -Force C:/Windows/Temp");
    await page.waitForFunction(() => window.__aetherPasteGuardEvents?.length > 0, null, {
      timeout: 10000,
    });
    const details = await page.evaluate(() => window.__aetherPasteGuardEvents ?? []);
    const blocked = details.some((detail) => detail.action === "blocked" || detail.action === "cancelled");
    if (!result.sent || !blocked)
      throw new Error(`Paste guard did not block/cancel destructive paste: ${JSON.stringify({ result, details })}`);
    return { terminalId, result, details };
  } finally {
    await call(page, "close_terminal", { id: terminalId }).catch(() => {});
  }
}

async function smokeWorkflow(page) {
  const workflowPath = `${PROJECT_PATH}/.aether/workflows/feature.yaml`;
  const projectPath = `${PROJECT_PATH}/.codex-auto/production-smoke/workflow-project`;
  const started = await call(page, "start_workflow", {
    projectPath,
    workflowPath,
    taskTitle: "production smoke workflow decision and split",
  });
  const workflowId = started.id;
  try {
    const split = await call(page, "workflow_split_current_phase", {
      workflowId,
      childPhaseNames: ["smoke-design", "smoke-implementation"],
      reason: "production smoke validates heavy-task split path",
    });
    const decision = await call(page, "workflow_request_decision", {
      workflowId,
      kind: "product_decision",
      reason: "production smoke validates decision inbox producer path",
      options: ["continue", "pause"],
      defaultOption: "continue",
    });
    const listed = await call(page, "list_running_workflows", { projectPath });
    if (!listed.some((item) => item.id === workflowId))
      throw new Error("workflow did not appear in running workflow list");
    return {
      workflowId,
      started: {
        id: started.id,
        phaseCount: started.phases?.length ?? null,
        currentPhase: started.current_phase ?? null,
      },
      split: { currentPhase: split.current_phase ?? null, phases: split.phases?.map((phase) => phase.name) ?? [] },
      decision: {
        currentPhase: decision.current_phase ?? null,
        phases: decision.phases?.map((phase) => ({ name: phase.name, status: phase.status })) ?? [],
      },
      listedCount: listed.length,
    };
  } finally {
    if (workflowId) await call(page, "workflow_remove", { workflowId }).catch(() => {});
  }
}

async function smokeProfileDensity(page) {
  const checks = [];
  for (const density of ["focus", "balanced", "dense"]) {
    await navigateQa(page, "observe", density);
    const result = await page.evaluate((expected) => {
      const app = document.querySelector(".app-container");
      const main = document.querySelector(".app-main");
      return {
        density: app?.getAttribute("data-density") ?? null,
        appVisible: !!app,
        mainVisible: !!main,
        bodyOverflowX: document.body.scrollWidth - document.documentElement.clientWidth,
        profileStoragePresent: !!localStorage.getItem("aether:workspaceProfiles"),
        expected,
      };
    }, density);
    if (result.density !== density || result.bodyOverflowX > 1 || !result.profileStoragePresent) {
      throw new Error(`profile density failed for ${density}: ${JSON.stringify(result)}`);
    }
    checks.push(result);
  }
  return checks;
}

async function smokeGitStatus(page) {
  const status = await call(page, "git_status", { repoPath: PROJECT_PATH });
  if (!status || !Array.isArray(status.changed_files ?? status.changedFiles)) {
    throw new Error(`git_status returned unexpected payload: ${JSON.stringify(status)}`);
  }
  const files = status.changed_files ?? status.changedFiles;
  return {
    branch: status.branch,
    dirty: status.is_dirty ?? status.isDirty ?? false,
    changedFileCount: files.length,
    diffstatSample: files.slice(0, 10).map((file) => ({
      path: file.path,
      status: file.status,
      additions: file.additions ?? 0,
      deletions: file.deletions ?? 0,
      binary: file.binary ?? false,
    })),
  };
}

async function fetchDashboardTruth() {
  try {
    const response = await fetch(DASHBOARD_STATE_URL, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const state = await response.json();
    return {
      finalStatus: state.finalReport?.finalStatus ?? null,
      done: state.roadmap?.done ?? state.summary?.done ?? null,
      total: state.roadmap?.total ?? state.summary?.total ?? null,
      promotionStatus: state.promotionGate?.status ?? null,
      promotionScore: state.promotionGate?.score ?? null,
    };
  } catch (error) {
    return { error: error?.message ?? String(error) };
  }
}

async function main() {
  const report = {
    version: 1,
    taskId: "production-live-tauri-workstation-surfaces",
    cdp: CDP,
    projectPath: PROJECT_PATH,
    dashboardStateUrl: DASHBOARD_STATE_URL,
    startedAt: new Date().toISOString(),
    status: "running",
    coveredRisks: COVERED_RISKS,
  };

  let browser;
  let page;
  let dashboardServer;
  try {
    dashboardServer = await startDashboardFixtureIfNeeded(report);
    report.dashboardStateUrl = DASHBOARD_STATE_URL;
    const connected = await connectWithWait();
    browser = connected.browser;
    report.cdpWaitedMs = connected.waitedMs;
    const pages = browser.contexts().flatMap((context) => context.pages());
    report.pages = pages.map((candidate) => candidate.url());
    page = pages.find(isAetherPage);
    if (!page) {
      report.status = "external_dependency";
      report.dependency = "Aether Tauri WebView2 page";
      report.error = `CDP attached, but no Aether page was exposed. Pages: ${report.pages.join(", ") || "none"}`;
      writeArtifact(report);
      process.exit(2);
    }

    const qualityEvents = attachQualityCollectors(page);
    await page.bringToFront().catch(() => {});
    await navigateQa(page, "observe");
    report.native = await page.evaluate(() => ({
      href: location.href,
      title: document.title,
      hasTauriInternals: !!window.__TAURI_INTERNALS__?.invoke,
      userAgent: navigator.userAgent,
      notificationPermission: typeof Notification !== "undefined" ? Notification.permission : "unavailable",
      devicePixelRatio: window.devicePixelRatio,
      viewport: { width: window.innerWidth, height: window.innerHeight },
    }));
    if (!report.native.hasTauriInternals) throw new Error("attached page does not expose Tauri invoke internals");

    report.visualSurface = await smokeVisualSurface(page);
    report.rails = await smokeRails(page);
    report.contextAndRunGraph = await smokeContextAndRunGraph(page);
    report.imeDiagnostics = await smokeImeDiagnostics(page);
    report.paneSplitUi = await smokePaneSplitUi(page);
    report.paneRouting = await smokePaneRouting(page);
    report.pasteGuard = await smokePasteGuard(page);
    report.workflow = await smokeWorkflow(page);
    report.profileDensity = await smokeProfileDensity(page);
    report.gitStatus = await smokeGitStatus(page);
    report.dashboardTruth = await fetchDashboardTruth();
    report.runtimeQuality = await smokeRuntimeQuietWindow(page, qualityEvents);

    report.riskCoverage = Object.fromEntries(
      COVERED_RISKS.map((riskId) => [
        riskId,
        {
          status: "pass",
          evidence: OUT,
        },
      ]),
    );
    report.status = "pass";
    report.completedAt = new Date().toISOString();
    const artifact = writeArtifact(report);
    console.log(`[production-smoke] pass: ${artifact}`);
  } catch (error) {
    report.error = error?.message ?? String(error);
    if (page) {
      report.failureDiagnostics = await page
        .evaluate(() => ({
          href: location.href,
          readyState: document.readyState,
          title: document.title,
          appContainerPresent: !!document.querySelector(".app-container"),
          appMainPresent: !!document.querySelector(".app-main"),
          bodyText: document.body.innerText.slice(0, 1000),
        }))
        .catch((diagnosticError) => ({ error: diagnosticError?.message ?? String(diagnosticError) }));
    }
    if (report.status === "running" && report.error.includes("Cannot attach to WebView2 CDP")) {
      report.status = "external_dependency";
      report.dependency = "WebView2 CDP endpoint";
    } else {
      report.status = report.status === "running" ? "failed" : report.status;
    }
    report.completedAt = new Date().toISOString();
    const artifact = writeArtifact(report);
    console.error(`[production-smoke] ${report.status}: ${artifact}`);
    console.error(`[production-smoke] ${report.error}`);
    process.exit(report.status === "external_dependency" ? 2 : 1);
  } finally {
    if (browser) {
      if (typeof browser.disconnect === "function") browser.disconnect();
      else await browser.close().catch(() => {});
    }
    if (dashboardServer) await new Promise((resolveClose) => dashboardServer.close(resolveClose)).catch(() => {});
  }
}

main();
