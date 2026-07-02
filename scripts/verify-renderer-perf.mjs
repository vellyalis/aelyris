import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { chromium } from "@playwright/test";
import { createServer } from "vite";

const ROOT = resolve(process.cwd());
const OUT = join(ROOT, ".codex-auto", "quality", "renderer-perf.json");

function writeJsonAtomic(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(tmp, path);
}

async function main() {
  const server = await createServer({
    root: ROOT,
    configFile: false,
    appType: "custom",
    logLevel: "error",
    optimizeDeps: {
      entries: ["e2e/renderer-harness.html"],
    },
    server: { host: "127.0.0.1", port: 0 },
  });
  let browser;
  try {
    server.middlewares.use("/__renderer_harness__", (_req, res) => {
      res.statusCode = 200;
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end('<!doctype html><html><body><script type="module" src="/e2e/renderer-harness.ts"></script></body></html>');
    });
    await server.listen();
    const baseUrl = server.resolvedUrls?.local?.[0];
    if (!baseUrl) throw new Error("Vite did not expose a local renderer harness URL");
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 1 });
    const diagnostics = [];
    page.on("console", (message) => diagnostics.push(`console.${message.type()}: ${message.text()}`));
    page.on("pageerror", (error) => diagnostics.push(`pageerror: ${error.stack ?? error.message}`));
    page.on("requestfailed", (request) =>
      diagnostics.push(`requestfailed: ${request.url()} ${request.failure()?.errorText ?? "unknown"}`),
    );
    await page.goto(`${baseUrl}__renderer_harness__`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    try {
      await page.waitForFunction(() => Boolean(window.__AELYRIS_RENDERER_HARNESS__), null, { timeout: 60_000 });
    } catch (error) {
      throw new Error(`renderer harness did not initialize: ${error.message}\n${diagnostics.slice(-20).join("\n")}`);
    }
    const report = await page.evaluate(async () => window.__AELYRIS_RENDERER_HARNESS__.runPerf());
    writeJsonAtomic(OUT, report);
    console.log(JSON.stringify(report, null, 2));
    if (!report.ok) process.exitCode = 1;
  } finally {
    await browser?.close().catch(() => {});
    await server.close();
  }
}

await main();
