// P2-05 native Tauri/WebView2 Settings + density + DPI smoke.
//
// This verifier intentionally attaches to a live Tauri WebView2 CDP target.
// It records the WebView2 page's current native window/DPR signals and avoids
// using Chromium device emulation as DPI proof.
//
// Prerequisite:
//   QUORUM_API_TOKEN=dev pnpm.cmd tauri:dev
//
// Optional env:
//   AETHER_TAURI_CDP=http://127.0.0.1:9222
//   AETHER_TAURI_PROJECT=C:/repo/aether-terminal
//   AETHER_TAURI_SMOKE_OUT=.codex-auto/visual-qa/p2-05/tauri-dpi-settings-smoke.json
//   AETHER_TAURI_SMOKE_WAIT_MS=60000

import { mkdirSync, writeFileSync } from "node:fs";
import net from "node:net";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { chromium } from "@playwright/test";

const CDP = process.env.AETHER_TAURI_CDP ?? process.env.AETHER_IME_CDP ?? "http://127.0.0.1:9222";
const PROJECT_PATH = (process.env.AETHER_TAURI_PROJECT ?? process.cwd()).replaceAll("\\", "/");
const OUT = process.env.AETHER_TAURI_SMOKE_OUT ?? ".codex-auto/visual-qa/p2-05/tauri-dpi-settings-smoke.json";
const WAIT_MS = Number.parseInt(process.env.AETHER_TAURI_SMOKE_WAIT_MS ?? "60000", 10);
const APP_READY_WAIT_MS = Number.parseInt(process.env.AETHER_TAURI_APP_READY_WAIT_MS ?? "60000", 10);
const DENSITIES = ["focus", "balanced", "dense"];

function isAetherPage(page) {
  const url = page.url();
  return (
    url.includes("localhost:1420") ||
    url.includes("127.0.0.1:1420") ||
    url.startsWith("tauri://localhost") ||
    url.startsWith("https://tauri.localhost")
  );
}

function writeArtifact(report) {
  const path = resolve(OUT);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`);
  return path;
}

function withVisualQaParams(rawUrl) {
  try {
    const url = new URL(rawUrl);
    url.searchParams.set("aetherVisualQa", "1");
    url.searchParams.set("rail", "observe");
    url.searchParams.set("projectPath", PROJECT_PATH);
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

async function seedDensity(page, density) {
  await page.evaluate(
    ({ density: nextDensity, projectPath }) => {
      const workspaceKey = projectPath.toLowerCase();
      localStorage.setItem("aether:visualQa", "1");
      localStorage.setItem("aether:visualQaProject", projectPath);
      localStorage.setItem("aether:lastProject", projectPath);
      localStorage.setItem("aether:onboarding-done", "true");
      localStorage.setItem(
        "aether:workspaceProfiles",
        JSON.stringify({
          version: 1,
          workspaceOverrides: {
            [workspaceKey]: {
              visualDensity: nextDensity,
              paneLayout: { density: nextDensity },
            },
          },
          threadRunState: {},
        }),
      );
    },
    { density, projectPath: PROJECT_PATH },
  );
}

async function openDensityPage(page, density) {
  await seedDensity(page, density);
  const targetUrl = withVisualQaParams(page.url());
  if (targetUrl !== page.url()) {
    await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: WAIT_MS });
  } else {
    await page.reload({ waitUntil: "domcontentloaded", timeout: WAIT_MS });
  }
  await page.waitForFunction(
    (expectedDensity) => {
      const app = document.querySelector(".app-container");
      const main = document.querySelector(".app-main");
      return !!app && !!main && app.getAttribute("data-density") === expectedDensity;
    },
    density,
    { timeout: APP_READY_WAIT_MS },
  );
}

async function readNativeSignals(page) {
  return page.evaluate(() => {
    const app = document.querySelector(".app-container");
    const main = document.querySelector(".app-main");
    const vv = window.visualViewport;
    const body = document.body;
    const doc = document.documentElement;
    return {
      hasTauriInternals: !!window.__TAURI_INTERNALS__,
      hasTauriApi: !!window.__TAURI__,
      url: location.href,
      title: document.title,
      userAgent: navigator.userAgent,
      language: navigator.language,
      devicePixelRatio: window.devicePixelRatio,
      visualViewport: vv
        ? {
            width: Math.round(vv.width),
            height: Math.round(vv.height),
            scale: vv.scale,
            offsetLeft: Math.round(vv.offsetLeft),
            offsetTop: Math.round(vv.offsetTop),
          }
        : null,
      window: {
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight,
        outerWidth: window.outerWidth,
        outerHeight: window.outerHeight,
        screenX: window.screenX,
        screenY: window.screenY,
      },
      screen: {
        width: screen.width,
        height: screen.height,
        availWidth: screen.availWidth,
        availHeight: screen.availHeight,
        colorDepth: screen.colorDepth,
        pixelDepth: screen.pixelDepth,
      },
      media: {
        dppx1: matchMedia("(resolution: 1dppx)").matches,
        dppx125: matchMedia("(resolution: 1.25dppx)").matches,
        dppx15: matchMedia("(resolution: 1.5dppx)").matches,
        dppx2: matchMedia("(resolution: 2dppx)").matches,
        reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
      },
      layout: {
        density: app?.getAttribute("data-density") ?? null,
        appVisible: !!app,
        mainVisible: !!main,
        bodyOverflowX: body.scrollWidth - body.clientWidth,
        documentOverflowX: doc.scrollWidth - doc.clientWidth,
      },
    };
  });
}

async function smokeSettings(page) {
  await page.keyboard.press("Control+,");
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("heading", { name: "Settings" }).waitFor({ state: "visible", timeout: 15000 });
  const report = await dialog.evaluate((node) => {
    const el = node;
    const rect = el.getBoundingClientRect();
    const visibleFields = Array.from(el.querySelectorAll("input,button,select,textarea,[role='button']")).filter((child) => {
      const box = child.getBoundingClientRect();
      const style = getComputedStyle(child);
      return box.width > 0 && box.height > 0 && style.visibility !== "hidden" && style.display !== "none";
    });
    return {
      headingVisible: !!el.querySelector("h1,h2,h3,[data-radix-dialog-title]"),
      rect: {
        left: Math.round(rect.left),
        top: Math.round(rect.top),
        right: Math.round(rect.right),
        bottom: Math.round(rect.bottom),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      },
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
      },
      insideViewport:
        rect.left >= 0 &&
        rect.top >= 0 &&
        rect.right <= window.innerWidth + 1 &&
        rect.bottom <= window.innerHeight + 1,
      overflowX: el.scrollWidth - el.clientWidth,
      visibleControlCount: visibleFields.length,
    };
  });
  await page.getByRole("button", { name: "Close settings" }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden", timeout: 10000 }).catch(() => {});
  return report;
}

async function main() {
  const report = {
    version: 1,
    taskId: "auto-1778008060952-p2-05-live-tauri-webview2-dpi-settings-smoke",
    roadmapId: "P2-05",
    parentRoadmapId: "P2-05",
    reason: "blocker-decomposition",
    cdp: CDP,
    projectPath: PROJECT_PATH,
    startedAt: new Date().toISOString(),
    status: "running",
    notes: [
      "This is live Tauri/WebView2 CDP evidence only.",
      "The script does not use deviceScaleFactor or CDP emulation as DPI proof.",
      "Per-monitor transition proof requires moving the native window across differently scaled monitors; this smoke records the current native scale exposed by WebView2.",
    ],
  };

  let browser;
  let activePage = null;
  try {
    const connected = await connectWithWait();
    browser = connected.browser;
    report.cdpWaitedMs = connected.waitedMs;

    const pages = browser.contexts().flatMap((context) => context.pages());
    report.pages = pages.map((page) => page.url());
    const page = pages.find(isAetherPage);
    if (!page) {
      report.status = "external_dependency";
      report.dependency = "Aether Tauri WebView2 page";
      report.error = `CDP attached, but no Aether page was exposed. Pages: ${report.pages.join(", ") || "none"}`;
      writeArtifact(report);
      console.error(`[tauri-smoke] ${report.error}`);
      process.exit(2);
    }

    await page.bringToFront().catch(() => {});
    activePage = page;
    report.attachedUrl = page.url();
    report.initialNativeSignals = await readNativeSignals(page);

    if (!report.initialNativeSignals.hasTauriInternals && !report.initialNativeSignals.hasTauriApi) {
      throw new Error("Attached page does not expose Tauri APIs; refusing to count it as native WebView2 evidence.");
    }

    report.densityChecks = [];
    for (const density of DENSITIES) {
      await openDensityPage(page, density);
      const nativeSignals = await readNativeSignals(page);
      const settings = await smokeSettings(page);
      const pass =
        nativeSignals.layout.density === density &&
        nativeSignals.layout.bodyOverflowX <= 1 &&
        nativeSignals.layout.documentOverflowX <= 1 &&
        settings.insideViewport &&
        settings.overflowX <= 1 &&
        settings.visibleControlCount > 0;
      report.densityChecks.push({
        density,
        pass,
        nativeSignals,
        settings,
      });
      if (!pass) {
        throw new Error(`Native Settings/density smoke failed for ${density}; see ${OUT}`);
      }
    }

    report.status = "pass";
    report.completedAt = new Date().toISOString();
    const artifact = writeArtifact(report);
    console.log(`[tauri-smoke] pass: ${artifact}`);
    console.log(
      `[tauri-smoke] native current scale dpr=${report.initialNativeSignals.devicePixelRatio}, viewport=${report.initialNativeSignals.window.innerWidth}x${report.initialNativeSignals.window.innerHeight}`,
    );
  } catch (error) {
    report.error = error?.message ?? String(error);
    if (activePage) {
      report.failureDiagnostics = await activePage
        .evaluate(() => ({
          href: location.href,
          readyState: document.readyState,
          title: document.title,
          appContainerPresent: !!document.querySelector(".app-container"),
          appMainPresent: !!document.querySelector(".app-main"),
          density: document.querySelector(".app-container")?.getAttribute("data-density") ?? null,
          bodyText: document.body.innerText.slice(0, 600),
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
    console.error(`[tauri-smoke] ${report.status}: ${artifact}`);
    console.error(`[tauri-smoke] ${report.error}`);
    process.exit(report.status === "external_dependency" ? 2 : 1);
  } finally {
    if (browser) {
      if (typeof browser.disconnect === "function") browser.disconnect();
      else await browser.close().catch(() => {});
    }
  }
}

main();
