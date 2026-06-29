import { chromium } from "@playwright/test";

const CDP = "http://localhost:9222";
const REPO = process.env.AELYRIS_REPO_PATH ?? process.cwd();

async function main() {
  console.log(`[cdp-probe] connecting to ${CDP}`);
  const browser = await chromium.connectOverCDP(CDP);
  const contexts = browser.contexts();
  console.log(`[cdp-probe] contexts: ${contexts.length}`);

  const pages = [];
  for (const ctx of contexts) {
    for (const page of ctx.pages()) pages.push(page);
  }
  console.log(`[cdp-probe] pages: ${pages.length}`);
  for (const page of pages) {
    console.log(`  url=${page.url()} title=${await page.title()}`);
  }

  const tauri =
    pages.find((p) => p.url().includes("localhost:1420")) ?? pages[0];
  if (!tauri) {
    console.log("[cdp-probe] no Tauri page found");
    await browser.close();
    return;
  }

  console.log(`[cdp-probe] target page: ${tauri.url()}`);

  const tauriCheck = await tauri.evaluate(() => {
    const w = /** @type {any} */ (window);
    return {
      hasTauri: !!w.__TAURI__,
      hasTauriInternals: !!w.__TAURI_INTERNALS__,
      keys: Object.keys(w).filter((k) => k.toLowerCase().includes("tauri")),
    };
  });
  console.log("[cdp-probe] tauri surface:", JSON.stringify(tauriCheck));

  const invokeResult = await tauri.evaluate(async (repo) => {
    const w = /** @type {any} */ (window);
    try {
      const invoke =
        w.__TAURI__?.core?.invoke ??
        w.__TAURI__?.invoke ??
        w.__TAURI_INTERNALS__?.invoke;
      if (!invoke) return { ok: false, err: "invoke not found" };
      const branches = await invoke("list_branches", { repoPath: repo });
      return {
        ok: true,
        count: Array.isArray(branches) ? branches.length : null,
        sample: Array.isArray(branches) ? branches.slice(0, 5) : branches,
      };
    } catch (e) {
      return { ok: false, err: String(e) };
    }
  }, REPO);
  console.log("[cdp-probe] list_branches:", JSON.stringify(invokeResult, null, 2));

  await browser.close();
}

main().catch((e) => {
  console.error("[cdp-probe] fatal:", e);
  process.exit(1);
});
