import { chromium } from "@playwright/test";

const CDP = "http://localhost:9222";

async function main() {
  const browser = await chromium.connectOverCDP(CDP);
  const page = browser.contexts()[0].pages().find((p) => p.url().includes("localhost:1420"));
  await page.evaluate(() => {
    localStorage.setItem("aether:lastProject", "C:/repo/aether-terminal");
    localStorage.setItem("aether:onboarding-done", "1");
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  await page.locator('[aria-label="Settings"]').first().click();
  await page.waitForTimeout(500);

  // Full-page screenshot, crop to dialog, save larger resolution for inspection.
  await page.screenshot({ path: "C:/tmp/aether-lg/settings-full.png", fullPage: false });

  const info = await page.evaluate(() => {
    const dlg = document.querySelector('[role="dialog"]');
    if (!dlg) return { noDialog: true };
    const rect = dlg.getBoundingClientRect();
    const cs = getComputedStyle(dlg);
    // Find major text elements inside dialog
    const texts = [];
    dlg.querySelectorAll("h1, h2, h3, label, .label, button, span").forEach((e) => {
      const t = e.textContent?.trim();
      if (!t || t.length < 2) return;
      const ts = getComputedStyle(e);
      const r = e.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        texts.push({
          text: t.slice(0, 40),
          color: ts.color,
          fontSize: ts.fontSize,
          visible: r.width > 0 && r.height > 0 && ts.visibility !== "hidden" && ts.opacity !== "0",
        });
      }
    });
    return {
      rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
      panelBg: cs.backgroundColor,
      textSample: texts.slice(0, 10),
      totalTextCount: texts.length,
    };
  });

  console.log(JSON.stringify(info, null, 2));

  // Take a cropped screenshot of just the dialog
  const { rect } = info;
  if (rect) {
    await page.screenshot({
      path: "C:/tmp/aether-lg/settings-crop.png",
      clip: { x: rect.x, y: rect.y, width: rect.w, height: rect.h },
    });
    console.log("wrote settings-crop.png");
  }
  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
