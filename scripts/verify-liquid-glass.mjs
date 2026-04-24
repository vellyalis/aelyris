// Attaches over CDP (port 9222) to the running Tauri webview, opens each
// major surface, measures overflow, and captures screenshots into
// C:/tmp/aether-lg/. Run with: pnpm node scripts/verify-liquid-glass.mjs
//
// Prerequisite: `pnpm tauri:dev` must be running.

import { chromium } from "@playwright/test";
import { mkdirSync, existsSync, writeFileSync } from "node:fs";

const CDP = "http://localhost:9222";
const OUT = "C:/tmp/aether-lg";
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

async function measureOverflow(page) {
  return page.evaluate(() => {
    const bands = [];
    const walk = (el, depth = 0) => {
      if (!el || depth > 6 || el.nodeType !== 1) return;
      const cs = getComputedStyle(el);
      // Only consider flex rows / inline-flex / and horizontal nav chrome.
      const isRow = cs.display.includes("flex") && cs.flexDirection !== "column";
      if (isRow && el.scrollWidth > el.clientWidth + 1) {
        const cls =
          typeof el.className === "string"
            ? el.className.slice(0, 60)
            : String(el.className ?? "").slice(0, 60);
        bands.push({
          tag: el.tagName,
          cls,
          scroll: el.scrollWidth,
          client: el.clientWidth,
          overflow: el.scrollWidth - el.clientWidth,
        });
      }
      for (const child of el.children) walk(child, depth + 1);
    };
    walk(document.body);
    return bands;
  });
}

async function main() {
  const browser = await chromium.connectOverCDP(CDP);
  const ctx = browser.contexts()[0];
  const page = ctx.pages().find((p) => p.url().includes("localhost:1420"));
  if (!page) throw new Error("no tauri page");
  console.log(`[verify] attached to ${page.url()}`);

  await page.evaluate(
    ([project]) => {
      localStorage.setItem("aether:lastProject", project);
      localStorage.setItem("aether:onboarding-done", "1");
    },
    ["C:/Users/owner/Aether_Terminal"],
  );
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);

  const report = {};

  const shot = async (name) => {
    await page.screenshot({ path: `${OUT}/${name}.png` });
    const overflows = await measureOverflow(page);
    report[name] = overflows;
    console.log(
      `[verify] ${name} — ${overflows.length === 0 ? "clean" : `${overflows.length} overflow(s)`}`,
    );
  };

  await shot("01-baseline");

  // Settings (gear)
  await page.locator('[aria-label="Settings"]').first().click();
  await page.waitForTimeout(500);
  await shot("02-settings");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);

  // Help (F1)
  await page.keyboard.press("F1");
  await page.waitForTimeout(400);
  await shot("03-help");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);

  // Command Palette
  await page.keyboard.press("Control+Shift+P");
  await page.waitForTimeout(400);
  await shot("04-command-palette");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);

  // Quick Open
  await page.keyboard.press("Control+p");
  await page.waitForTimeout(400);
  await shot("05-quick-open");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);

  // History search
  await page.keyboard.press("Control+r");
  await page.waitForTimeout(400);
  await shot("06-history");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);

  // Orchestra
  const orchestra = page.locator('[aria-label="Orchestra mode"]');
  if ((await orchestra.count()) > 0) {
    await orchestra.first().click();
    await page.waitForTimeout(500);
    await shot("07-orchestra");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
  }

  // Each inspector tab
  for (const label of ["Activity", "Parallel sessions", "Conductor DAG", "File diffs", "Sessions"]) {
    const btn = page.locator(`button[aria-label="${label}"]`).first();
    if ((await btn.count()) > 0) {
      await btn.click();
      await page.waitForTimeout(300);
      await shot(`08-tab-${label.split(" ")[0].toLowerCase()}`);
    }
  }

  writeFileSync(
    `${OUT}/overflow-report.json`,
    JSON.stringify(report, null, 2),
  );

  const total = Object.values(report).reduce((sum, bs) => sum + bs.length, 0);
  console.log(
    `\n[verify] total overflow bands across all surfaces: ${total}`,
  );
  for (const [name, bands] of Object.entries(report)) {
    if (bands.length === 0) continue;
    console.log(`\n  ${name}:`);
    for (const b of bands) {
      console.log(
        `    ${b.tag}.${b.cls} — ${b.client}→${b.scroll} (overflow ${b.overflow}px)`,
      );
    }
  }

  await browser.close();
}

main().catch((e) => {
  console.error("[verify] fatal:", e);
  process.exit(1);
});
